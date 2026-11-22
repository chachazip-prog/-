/**
 * 한 층(하루 한 판) 시뮬레이션 — 렌더링 무관. 씬과 QA 헤드리스 봇이 같은 API를 쓴다.
 * 결정성: 고정 스텝(rules.fixedStepSec) 적분 + 시드 RNG + 고정된 NPC 갱신 순서.
 * 같은 시드 + 같은 스텝 시점의 같은 입력 → 같은 결과.
 */
import {
  buildGridMap, isWalkable, kindAt, nearCover, nearestWalkable, tileOf, zoneAt,
  type GridMap, type LegendEntry, type Tile,
} from './grid';
import { distanceField, findPath } from './pathfinding';
import { CameraModel, type CameraRules, type CameraView } from './camera';
import { PatrolNpc, type NpcDef, type StepContext } from './patrol';
import { PlayerMover } from './player';
import { createRng, type Rng } from './rng';
import { createSuspicion, exposureRate, updateSuspicionRate, type SuspicionRules, type SuspicionState } from './suspicion';
import { canSee, hasLineOfSight, inCone } from './vision';

/** 레벨(층) 정의. 지금은 src/dev/ 임시 데이터, 추후 game/data/ 로더가 같은 모양으로 공급 */
export interface LevelDef {
  readonly id: string;
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly playerStart: Tile;
  /** 이 구역 타일에 도달하면 퇴근 성공 */
  readonly exitZone: string;
  readonly npcs: readonly NpcDef[];
}

export interface FloorRules {
  readonly fixedStepSec: number;
  /** 한 번의 advance에서 처리할 최대 시간(탭 전환·프레임 드랍 시 폭주 방지) */
  readonly maxAdvanceSec: number;
  readonly playerSpeedTilesPerSec: number;
  /** 통행 불가 타일을 탭했을 때 가까운 통행 가능 타일을 찾을 반경 */
  readonly tapSnapRadius: number;
  readonly suspicion: SuspicionRules;
  readonly threat: {
    /** 경고용 넓은 콘: 실제 콘 거리 + 이 값 (화면 위로 약 11타일, 아래로 약 8타일이 보이므로 그보다 커야 화면 밖 경고가 의미 있음) */
    readonly approachExtraRange: number;
    /** 경고용 넓은 콘: 실제 콘 반각 + 이 값 */
    readonly approachExtraAngleDeg: number;
    /** X6: 넓은 콘 경고에 가림(LOS) 반영 */
    readonly approachRequiresLineOfSight?: boolean;
    /** X6: NPC→플레이어 통행 경로가 이 타일 이하이고 줄어드는 중이면 approaching */
    readonly approachPathTilesWithin?: number;
    readonly approachPathMustBeDecreasing?: boolean;
  };
  // ── v2 확장(rules.json). 없으면 T-127 동작 ──
  readonly input?: { readonly tapOnSelfWhileStopped?: string };
  readonly movement?: {
    readonly blockedWaitSec?: number;
    readonly rerouteMaxExtraTiles?: number;
    readonly rerouteRecheckSec?: number;
    readonly postTalkHoldSec?: number;
  };
  readonly disguise?: { readonly closeCallWindowSec: readonly [number, number]; readonly closeCallMaxPerDay: number };
  /** X10: 콘 주인이 화면 밖이면 의심 상승 없음(카메라 모델 필요) */
  readonly offscreenSourceNoGain?: boolean;
}

/** DaySim 등 상위 규칙이 FloorSim 판정에 끼어드는 지점 (모두 선택) */
export interface FloorHooks {
  /** 플레이어 상태별 기본 상승률(base)을 덮어씀(자리 업무·미션 상태, X9) */
  playerRate?(base: number): number;
  /** 이 NPC의 시선을 지금 판정에 넣는가(대표님 얼음·로비 안전 등) */
  gazeAllowed?(npc: PatrolNpc): boolean;
  /** 이 NPC가 지금 말을 걸 수 있는가(enabledBy·onlyWhilePlayerAway·onlyWhen) */
  talkAllowed?(npc: PatrolNpc): boolean;
  /** 플레이어에게 추가로 막힌 타일(게이트 등) */
  blockedForPlayer?(x: number, y: number): boolean;
  /** 순찰이 끝난 NPC 처리: 새 NpcDef(thenPatrol)를 돌려주면 교체, null이면 제거(despawnAtEnd)·유지 */
  onNpcEnded?(npc: PatrolNpc): NpcDef | null;
}

export interface FloorOptions {
  readonly camera?: { readonly rules: CameraRules; readonly view: CameraView };
  readonly hooks?: FloorHooks;
  /** exitZone 도달 시 자동 탈출(기본 true). DaySim은 퇴근 단계가 직접 처리 */
  readonly autoEscape?: boolean;
}

export interface FloorContent {
  readonly level: LevelDef;
  readonly rules: FloorRules;
}

export type Outcome = 'playing' | 'escaped' | 'caught';
/**
 * - stopped: 이동 중 탭 → 정지·위장
 * - moving: 경로 이동 시작
 * - here: 탭(보정 결과 포함)한 타일이 지금 서 있는 타일 → 아무 변화 없음(idle은 idle, 위장은 위장 유지). '못 가요' 피드백 대상 아님 (BUG-004)
 * - unreachable: 보정 반경 안에 통행 타일이 없거나 경로가 없음
 * - ignored: 입력을 받지 않는 상태(말걸기 중·판 종료)
 */
export type TapResult = 'stopped' | 'moving' | 'here' | 'unreachable' | 'ignored' | 'nod';
/** 위협 수준: 지금 보는 중 > 돌아보기 직전(전조) 방향에 내가 있음 > 근처에서 이쪽을 향함 */
export type Threat = 'seeing' | 'turning' | 'approaching' | 'none';

export type SimEvent =
  | { t: number; type: 'tap'; x: number; y: number; result: TapResult }
  | { t: number; type: 'talkWarn'; npc: string }
  | { t: number; type: 'talk'; npc: string }
  | { t: number; type: 'tell'; npc: string }
  | { t: number; type: 'spotted'; npc: string }
  | { t: number; type: 'talkCancel'; npc: string; reason: 'disguised' | 'escaped' | 'missed' }
  | { t: number; type: 'talkEnd'; npc: string }
  | { t: number; type: 'closeCall' }
  | { t: number; type: 'blocked' }
  | { t: number; type: 'npcEnded'; npc: string; patrol: string }
  | { t: number; type: 'escaped' }
  | { t: number; type: 'caught' };

/** advance() 경계 비교 허용 오차(초). 수치 튜닝값이 아니라 부동소수 보정값 */
const STEP_EPS = 1e-9;

export class FloorSim {
  readonly map: GridMap;
  readonly level: LevelDef;
  readonly rules: FloorRules;
  readonly player: PlayerMover;
  readonly npcs: PatrolNpc[];
  readonly suspicion: SuspicionState = createSuspicion();
  outcome: Outcome = 'playing';
  /** 경과 시간(초, 고정 스텝 누적) */
  time = 0;
  steps = 0;
  /** npc 인덱스별 이번 스텝 시선 여부 */
  seeing: boolean[];
  /** 마지막 이동 목적지 (경로 표시용) */
  destination: Tile | null = null;
  private readonly rng: Rng;
  /** advance()에 받았지만 아직 스텝으로 소비하지 않은 시간(초). 부동소수 오차로 h보다 아주 약간 작을 수 있다 */
  private acc = 0;
  private events: SimEvent[] = [];

  constructor(content: FloorContent, seed: string | number) {
    this.level = content.level;
    this.rules = content.rules;
    this.map = buildGridMap(content.level.rows, content.level.legend);
    const s = content.level.playerStart;
    if (!isWalkable(this.map, s.x, s.y)) throw new Error('sim: 시작 타일 통행 불가');
    this.rng = createRng(seed);
    this.player = new PlayerMover(s);
    this.npcs = content.level.npcs.map((d) => new PatrolNpc(d, this.map, this.rng));
    this.seeing = this.npcs.map(() => false);
  }

  /** 쌓인 이벤트를 꺼낸다 (QA 로그·사운드 트리거용) */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * 화면 탭(타일 좌표). D-033: 이동 중이면 정지·위장, 아니면 그 타일로 경로 이동.
   */
  tap(tx: number, ty: number): TapResult {
    let result: TapResult;
    if (this.outcome !== 'playing' || this.player.mode === 'talked') result = 'ignored';
    else if (this.player.mode === 'moving') {
      this.player.stop();
      this.destination = null;
      result = 'stopped';
    } else {
      const goal = nearestWalkable(this.map, tx, ty, this.rules.tapSnapRadius);
      const path = goal ? findPath(this.map, this.player.tile, goal) : null;
      if (goal && path && path.length === 0 && this.player.centered) {
        result = 'here'; // 이미 그 타일 중심에 있음 (BUG-004)
      } else if (goal && path && this.player.move(path)) {
        this.destination = goal;
        result = 'moving';
      } else result = 'unreachable';
    }
    this.events.push({ t: this.time, type: 'tap', x: tx, y: ty, result });
    return result;
  }

  /**
   * 실시간 경과를 고정 스텝으로 나눠 진행.
   * BUG-005: 0.1·1/90 같은 dt를 누적하면 잔여가 h보다 ~1e-13 작아져 경계 스텝이 다음 호출로 밀렸다.
   * 누적 보정: 잔여가 h - STEP_EPS 이상이면 스텝을 진행하고, 그만큼 acc가 음수(최대 -STEP_EPS)가 되는 것을 허용해
   * 총합을 보존한다. STEP_EPS(1e-9초)는 1스텝(16.7ms)에 비해 무시할 수준이고, 누적 오차(약 1e-12/분)보다는 훨씬 크다.
   */
  advance(dtSec: number): void {
    this.acc += Math.min(Math.max(0, dtSec), this.rules.maxAdvanceSec);
    const h = this.rules.fixedStepSec;
    while (this.acc >= h - STEP_EPS) {
      this.acc -= h;
      this.step();
    }
  }

  step(): void {
    if (this.outcome !== 'playing') return;
    const dt = this.rules.fixedStepSec;
    this.steps++;
    this.time = this.steps * dt;
    const p = this.player;
    p.step(dt, this.rules.playerSpeedTilesPerSec);
    // 말걸기 중에는 목적지를 지우지 않는다(D-039: 종료 후 같은 목적지로 자동 재개)
    if (p.mode !== 'moving' && p.mode !== 'talked') this.destination = null;

    const ctx: StepContext = {
      shouldTellTurn: (npc, facing) => this.turnNeedsTell(npc, facing),
      player: p.pos,
      playerTalkable: p.mode !== 'talked',
    };
    for (const npc of this.npcs) {
      const before = npc.mode;
      npc.step(dt, this.rng, ctx);
      if (npc.mode === 'tell' && before !== 'tell') this.events.push({ t: this.time, type: 'tell', npc: npc.def.id });
      // 말걸기 전조가 끝나 성립(D-043) → 플레이어 강제 정지
      if (npc.mode === 'talk' && before !== 'talk' && npc.def.talk && p.forceTalk(npc.def.talk.durationSec)) {
        this.events.push({ t: this.time, type: 'talk', npc: npc.def.id });
      }
    }

    // 말걸기 전조 시작(반경 진입). 플레이어는 아직 조작 가능 — 전조 동안 반경(catchRadius) 밖으로 피하면 취소된다
    for (const npc of this.npcs) {
      const talk = npc.def.talk;
      if (!talk || !npc.canTalk() || p.mode === 'talked') continue;
      const dx = p.x - npc.x, dy = p.y - npc.y;
      if (Math.hypot(dx, dy) <= talk.radius) {
        npc.startTalk(Math.atan2(dy, dx));
        this.events.push({ t: this.time, type: 'talkWarn', npc: npc.def.id });
      }
    }

    // 시선 판정: 동시 시선은 배율 최댓값 하나만. 말걸기 중·보내 준 직후 NPC의 시선은 제외(D-043)
    let mult = 0;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i]!;
      const sees = !npc.ignoresPlayer && canSee(this.map, npc.pos, npc.facing, npc.def.cone, p.pos);
      if (sees && !this.seeing[i]) this.events.push({ t: this.time, type: 'spotted', npc: npc.def.id });
      this.seeing[i] = sees;
      if (sees) mult = Math.max(mult, npc.def.gazeMultiplier);
    }
    updateSuspicion(this.suspicion, this.rules.suspicion, mult, p.mode, p.modeTime, dt);

    if (this.suspicion.value >= this.rules.suspicion.max) {
      this.outcome = 'caught';
      this.events.push({ t: this.time, type: 'caught' });
    } else {
      const t = p.tile;
      if (zoneAt(this.map, t.x, t.y) === this.level.exitZone) {
        this.outcome = 'escaped';
        this.events.push({ t: this.time, type: 'escaped' });
      }
    }
  }

  /** 경고용 '넓은 콘'(가림 무시): 실제 콘 + rules.threat 여유. 실제 콘을 항상 포함한다 */
  private wideCone(npc: PatrolNpc): { range: number; halfAngleDeg: number } {
    const t = this.rules.threat;
    return {
      range: npc.def.cone.range + t.approachExtraRange,
      halfAngleDeg: npc.def.cone.halfAngleDeg + t.approachExtraAngleDeg,
    };
  }

  /**
   * D-044 방향 전환 전조 판정 (BUG-001): "새 시선이 플레이어 쪽을 향할 수 있는가"
   * = 새 방향의 경고 콘(wideCone, 가림 무시) 안에 플레이어가 있으면 true → 전조(tellSec) 후 회전.
   * 경고 콘 ⊇ 실제 콘이므로 전조 없이 회전한 직후 실제 시선에 플레이어가 들어오는 경우는 생기지 않는다.
   * 이 기준은 화면 밖 경고의 'turning'(빨강 화살표)과 같은 콘이라 표시와 판정이 일치한다.
   */
  private turnNeedsTell(npc: PatrolNpc, facing: number): boolean {
    return inCone(npc.pos, facing, this.wideCone(npc), this.player.pos);
  }

  /** NPC가 플레이어에게 주는 위협 수준 (화면 밖 경고 표시용) */
  threatOf(index: number): Threat {
    const npc = this.npcs[index];
    if (!npc) return 'none';
    if (this.seeing[index]) return 'seeing';
    const pp = this.player.pos;
    // 화면 밖 NPC는 보통 실제 시야보다 멀리 있으므로 실제 콘으로는 경고가 거의 뜨지 않아 넓은 콘을 쓴다
    const wide = this.wideCone(npc);
    if (npc.mode === 'tell' && npc.pendingFacing !== null && inCone(npc.pos, npc.pendingFacing, wide, pp)) return 'turning';
    if (npc.mode !== 'talk' && inCone(npc.pos, npc.facing, wide, pp)) return 'approaching';
    return 'none';
  }

  /** 결정성 검증용 상태 요약 문자열 */
  fingerprint(): string {
    const r = (v: number) => v.toFixed(4);
    const parts = [
      this.steps, this.outcome, r(this.suspicion.value), r(this.player.x), r(this.player.y), this.player.mode,
      ...this.npcs.map((n) => `${n.def.id}:${r(n.x)},${r(n.y)},${r(n.facing)},${n.mode}`),
    ];
    return parts.join('|');
  }
}
