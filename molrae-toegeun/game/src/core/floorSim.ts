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
import { PlayerMover, type ManualMoveRules } from './player';
import type { Dir } from './vision';
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
  readonly input?: {
    readonly tapOnSelfWhileStopped?: string;
    /** T-170: 'dpad'(방향 패드 직접 조작) | 'tap_to_move'(T-123 프로토). 데이터에 없으면 FloorSim은 패드를 처음 쓸 때 켠다 */
    readonly inputScheme?: string;
    /** T-170 rules.input.dpad(design/data-schema.md §12-1). 없으면 control-dpad.md 기본값 */
    readonly dpad?: {
      readonly firstTileCommit?: boolean;
      readonly releaseSnapMaxSec?: number;
      readonly turnAssistAheadTiles?: number;
      readonly playerPassesThreatNpc?: boolean;
      readonly heldResumeAfterTalkSec?: number;
    };
  };
  readonly movement?: {
    readonly blockedWaitSec?: number;
    readonly rerouteMaxExtraTiles?: number;
    readonly rerouteRecheckSec?: number;
    readonly postTalkHoldSec?: number;
  };
  readonly disguise?: { readonly closeCallWindowSec: readonly [number, number]; readonly closeCallMaxPerDay: number };
  /** X10: 콘 주인이 화면 밖이면 의심 상승 없음(카메라 모델 필요) */
  readonly offscreenSourceNoGain?: boolean;
  /**
   * BUG-010(rules.offscreenWarning.minLeadSecBeforeGaze): 전조 중 'turning' 판정에 쓰는 예측 구간(초).
   * 전조가 끝난 뒤 이 시간 안에 플레이어와 NPC가 서로 다가가 실제 콘에 들어올 수 있으면 지금부터 turning.
   * 없으면 예측하지 않음(실제 콘 = 지금 위치 기준)
   */
  readonly turnWarnLeadSec?: number;
}

/** DaySim 등 상위 규칙이 FloorSim 판정에 끼어드는 지점 (모두 선택) */
export interface FloorHooks {
  /** 플레이어 상태별 기본 상승률(base)을 덮어씀(자리 업무·미션 상태, X9) */
  playerRate?(base: number): number;
  /** 이 NPC의 시선을 지금 판정에 넣는가(대표님 얼음·로비 안전 등) */
  gazeAllowed?(npc: PatrolNpc): boolean;
  /** 이 NPC가 지금 말을 걸 수 있는가(enabledBy·onlyWhilePlayerAway·onlyWhen) */
  talkAllowed?(npc: PatrolNpc): boolean;
  /** 말걸기 전조 끝 판정의 위장 덮어쓰기(D-107). undefined면 지금 위장 상태 */
  talkDisguisedFor?(npc: PatrolNpc): boolean | undefined;
  /** 붙잡는 반경 가산(carry 변형, 모든 말걸기 액터) */
  talkCatchRadiusAdd?(): number;
  /** 지금 플레이어의 정지를 위장 안착 없이 바로 위장으로 칠지(BUG-012: 게이트 앞 대기). 시선 판정 직전에 호출 */
  settleExempt?(): boolean;
  /** 플레이어에게 추가로 막힌 타일(게이트 등) */
  blockedForPlayer?(x: number, y: number): boolean;
  /** 순찰이 끝난 NPC 처리: 새 NpcDef(thenPatrol)를 돌려주면 교체, null이면 제거(despawnAtEnd)·유지 */
  onNpcEnded?(npc: PatrolNpc): NpcDef | null;
  /** 얼어붙은 NPC(대표님 순시 H3·H4): 갱신·시선·말걸기·경고 모두 없음 */
  npcFrozen?(npc: PatrolNpc): boolean;
  /** 플레이어 외 '나로 계산되는 몸'(공범 동료, INT-12)에 대한 시선 배율. 0 = 없음 */
  extraGaze?(): number;
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
  | { t: number; type: 'talkCancel'; npc: string; reason: 'disguised' | 'escaped' | 'missed' | 'door' }
  | { t: number; type: 'talkEnd'; npc: string }
  | { t: number; type: 'closeCall' }
  | { t: number; type: 'blocked' }
  /** T-170 M6: 막힌 쪽으로 누름(그 칸 중심에 서서 그쪽을 봄 = 위장) */
  | { t: number; type: 'bump'; dir: Dir; x: number; y: number }
  /** T-170 M5: 코너 보정 발동(back = 뒤 칸 중심으로 붙어 꺾음, ahead = 앞 1칸 더 가서 꺾음) */
  | { t: number; type: 'cornerAssist'; kind: 'back' | 'ahead' }
  /** T-170: 패드 정지(release = 손 뗌, arrive = 첫 칸 보장 끝, bump = 막혀서 섬). 아슬아슬 판정 기준 시각 */
  | { t: number; type: 'padStop'; reason: 'release' | 'arrive' | 'bump' }
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
  /** 현재 층에 있는 NPC. 방해 이벤트로 런타임에 추가·제거된다(X7) — 인덱스가 바뀔 수 있으니 표시 쪽은 객체로 추적할 것 */
  readonly npcs: PatrolNpc[];
  readonly suspicion: SuspicionState = createSuspicion();
  /** 화면 밖 판정용 카메라(옵션). 없으면 모두 화면 안으로 본다 */
  readonly camera: CameraModel | null;
  hooks: FloorHooks;
  outcome: Outcome = 'playing';
  /** 경과 시간(초, 고정 스텝 누적) */
  time = 0;
  steps = 0;
  /** npc 인덱스별 이번 스텝 시선 여부(의심 판정에 들어간 시선) */
  seeing: boolean[];
  /** 마지막 이동 목적지 (경로 표시용) */
  destination: Tile | null = null;
  /** 탭으로 멈췄을 때의 목적지 (내 캐릭터 탭 → 이어 가기, rules.input.tapOnSelfWhileStopped) */
  resumeDestination: Tile | null = null;
  /** 이번 판 아슬아슬 횟수 */
  closeCalls = 0;
  /** 지금 시선 배율(동시 시선 최댓값). HUD용 */
  gazeNow = 0;
  /** 지금 말을 걸고 있는 NPC */
  talkingNpc: PatrolNpc | null = null;
  readonly rng: Rng;
  private readonly autoEscape: boolean;
  /** advance()에 받았지만 아직 스텝으로 소비하지 않은 시간(초). 부동소수 오차로 h보다 아주 약간 작을 수 있다 */
  private acc = 0;
  private events: SimEvent[] = [];
  private lastStopAt = -Infinity;
  /** 콘 안에서 멈춰(위장) 있던 연속 시간(초). 위장 정체 판정용 */
  private stillExposedSec = 0;
  private blockTimer = -1;
  private pathDist = new Map<PatrolNpc, { cur: number; prev: number }>();
  private distField: Int32Array | null = null;
  private distFieldStep = -1;
  /** T-170 패드 통계(디버그 오버레이·QA): 범프 수, 코너 보정 수 */
  readonly padStats = { bumps: 0, cornerAssists: 0 };

  constructor(content: FloorContent, seed: string | number, opts: FloorOptions = {}) {
    this.level = content.level;
    this.rules = content.rules;
    this.hooks = opts.hooks ?? {};
    this.autoEscape = opts.autoEscape ?? true;
    this.map = buildGridMap(content.level.rows, content.level.legend);
    const s = content.level.playerStart;
    if (!isWalkable(this.map, s.x, s.y)) throw new Error('sim: 시작 타일 통행 불가');
    this.rng = createRng(seed);
    this.player = new PlayerMover(s);
    this.npcs = content.level.npcs.map((d) => new PatrolNpc(d, this.map, this.rng));
    this.seeing = this.npcs.map(() => false);
    this.camera = opts.camera ? new CameraModel(opts.camera.rules, opts.camera.view, this.map.height, this.player.y) : null;
    this.player.canEnter = (x, y) => this.playerCanEnter(x, y);
    if (this.rules.input?.inputScheme === 'dpad') this.enableManual();
  }

  // ── 방향 패드(T-170, design/control-dpad.md §1-3) ──

  /** 직접 조작 규칙(rules.input.dpad, 없으면 사양서 기본값) */
  private enableManual(): void {
    if (this.player.manual) return;
    const d = this.rules.input?.dpad ?? {};
    const m: ManualMoveRules = {
      speedTilesPerSec: this.rules.playerSpeedTilesPerSec,
      firstTileCommit: d.firstTileCommit !== false,
      releaseSnapMaxSec: d.releaseSnapMaxSec ?? this.rules.suspicion.disguiseSettleSec ?? 0.15,
      turnAssistAheadTiles: d.turnAssistAheadTiles ?? 1,
      heldResumeAfterTalkSec: d.heldResumeAfterTalkSec ?? this.rules.movement?.postTalkHoldSec ?? 0.5,
    };
    this.player.manual = m;
  }

  /**
   * 플레이어가 직접 걸어 들어갈 수 있는 칸: 지도 통행 + 동적 차단(앉은 사람·서 있는 사람·게이트·다른 쪽 시설 문).
   * M7: 위협 NPC(passable 아님)는 걷는 중이어도 뚫고 지나가지 못함(배경 동료는 passable이라 겹쳐 지나감)
   */
  playerCanEnter(x: number, y: number): boolean {
    if (!isWalkable(this.map, x, y) || this.blockedForPlayer(x, y)) return false;
    if (this.rules.input?.dpad?.playerPassesThreatNpc === true || !this.rules.movement) return true;
    for (const n of this.npcs) {
      if (n.def.passable || n.mode === 'spawn') continue;
      const t = tileOf(n);
      if (t.x === x && t.y === y) return false;
    }
    return true;
  }

  /** 지금 패드 방향(DaySim이 잠금 규칙을 적용한 값) */
  get padDir(): Dir | null { return this.player.heldDir; }

  /**
   * 패드 입력(씬·QA 봇 공용). null = 손 뗌 → 즉시 정지·위장(M3). 판 종료 뒤에는 무시.
   * 정지 시각 = 이 호출 시각(아슬아슬 판정 기준, control-dpad §3-1)
   */
  setPad(dir: Dir | null): void {
    this.enableManual();
    if (this.outcome !== 'playing') { this.player.heldDir = null; return; }
    const stopped = this.player.setHeldDir(dir);
    this.drainManual();
    if (stopped) this.destination = null;
  }

  private drainManual(): void {
    for (const e of this.player.drainManualEvents()) {
      if (e.type === 'bump') { this.padStats.bumps++; this.events.push({ t: this.time, type: 'bump', dir: e.dir, x: e.tile.x, y: e.tile.y }); }
      else if (e.type === 'cornerAssist') { this.padStats.cornerAssists++; this.events.push({ t: this.time, type: 'cornerAssist', kind: e.kind }); }
      else {
        this.lastStopAt = this.time;
        this.checkCloseCallOnStop();
        this.blockTimer = -1;
        this.events.push({ t: this.time, type: 'padStop', reason: e.reason });
      }
    }
  }

  /** 쌓인 이벤트를 꺼낸다 (QA 로그·사운드 트리거용) */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 상위 규칙(DaySim)이 이벤트를 같은 스트림에 넣을 때 */
  pushEvent(e: SimEvent): void { this.events.push(e); }

  // ── NPC 런타임 추가·제거 (X7) ──

  addNpc(def: NpcDef): PatrolNpc {
    const n = new PatrolNpc(def, this.map, this.rng);
    this.npcs.push(n);
    this.seeing.push(false);
    return n;
  }

  removeNpc(npc: PatrolNpc): void {
    const i = this.npcs.indexOf(npc);
    if (i < 0) return;
    this.npcs.splice(i, 1);
    this.seeing.splice(i, 1);
    this.pathDist.delete(npc);
    if (this.talkingNpc === npc) this.talkingNpc = null;
  }

  /** 같은 자리에서 순찰 교체(thenPatrol, 방해 이벤트가 앉은 사람을 일으킬 때) */
  replaceNpc(old: PatrolNpc, def: NpcDef): PatrolNpc {
    const i = this.npcs.indexOf(old);
    const n = new PatrolNpc(def, this.map, this.rng);
    if (i < 0) { this.npcs.push(n); this.seeing.push(false); return n; }
    this.npcs[i] = n;
    this.seeing[i] = false;
    this.pathDist.delete(old);
    if (this.talkingNpc === old) this.talkingNpc = null;
    return n;
  }

  findNpc(pred: (n: PatrolNpc) => boolean): PatrolNpc | undefined { return this.npcs.find(pred); }

  // ── 플레이어 통행 (X8) ──

  /** 플레이어에게 지금 막힌 타일: 사람이 앉은 의자·서 있는 사람·게이트(훅) */
  blockedForPlayer = (x: number, y: number): boolean => {
    if (this.hooks.blockedForPlayer?.(x, y)) return true;
    if (!this.rules.movement) return false; // T-123 호환: 동적 차단 없음
    for (const n of this.npcs) {
      if (n.mode === 'walk' || n.mode === 'spawn' || n.def.passable) continue;
      const t = tileOf(n);
      if (t.x === x && t.y === y) return true;
    }
    return false;
  };

  /** 플레이어 경로(동적 차단 반영). 출발 = 현재 타일 */
  pathTo(goal: Tile): Tile[] | null {
    return findPath(this.map, this.player.tile, goal, this.blockedForPlayer);
  }

  /** 지정 타일로 이동 명령(미션 칩·자동 이동). 탭 판정 없이 경로만 */
  moveTo(goal: Tile): boolean {
    if (this.outcome !== 'playing' || this.player.mode === 'talked') return false;
    const path = this.pathTo(goal);
    if (!path) return false;
    if (path.length === 0 && this.player.centered) { this.destination = null; return true; }
    if (!this.player.move(path)) return false;
    this.destination = goal;
    this.resumeDestination = null;
    return true;
  }

  /**
   * 화면 탭(타일 좌표). D-033: 이동 중이면 정지·위장, 아니면 그 타일로 경로 이동.
   * 말걸기 중이면 맞장구(nodShortenSec가 있는 경우, 아니면 ignored).
   */
  tap(tx: number, ty: number): TapResult {
    let result: TapResult;
    const p = this.player;
    if (this.outcome !== 'playing') result = 'ignored';
    else if (p.mode === 'talked') result = this.nod() ? 'nod' : 'ignored';
    else if (p.mode === 'moving' || p.paused) {
      const dest = this.destination;
      p.stop();
      this.lastStopAt = this.time;
      this.checkCloseCallOnStop();
      this.resumeDestination = dest;
      this.destination = null;
      this.blockTimer = -1;
      result = 'stopped';
    } else {
      const goal = nearestWalkable(this.map, tx, ty, this.rules.tapSnapRadius, this.blockedForPlayer);
      const self = goal !== null && goal.x === p.tile.x && goal.y === p.tile.y;
      if (self && this.resumeDestination && this.rules.input?.tapOnSelfWhileStopped === 'resume_previous_destination') {
        const dest = this.resumeDestination;
        result = this.moveTo(dest) ? 'moving' : 'unreachable';
        if (result === 'moving') this.destination = dest;
      } else {
        const path = goal ? this.pathTo(goal) : null;
        if (goal && path && path.length === 0 && p.centered) {
          result = 'here'; // 이미 그 타일 중심에 있음 (BUG-004)
        } else if (goal && path && p.move(path)) {
          this.destination = goal;
          this.resumeDestination = null;
          result = 'moving';
        } else result = 'unreachable';
      }
    }
    this.events.push({ t: this.time, type: 'tap', x: tx, y: ty, result });
    return result;
  }

  /** 말걸기 중 맞장구(행동 버튼·화면 톡, control-dpad §4-2 순위 2) */
  nod(): boolean {
    const npc = this.talkingNpc;
    const t = npc?.def.talk;
    if (!npc || !t || !t.nodShortenSec || t.nodShortenSec <= 0) return false;
    const left = this.player.shortenTalk(t.nodShortenSec, t.minDurationSec ?? 0);
    npc.syncTalkRemaining(left);
    return true;
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

  /** 지금 플레이어가 '멈춤 = 위장' 상태인가 (X5) */
  get playerStill(): boolean {
    const m = this.player.mode;
    return m === 'disguised' || (m === 'idle' && this.rules.suspicion.anyStopIsDisguised === true);
  }

  step(): void {
    if (this.outcome !== 'playing') return;
    const dt = this.rules.fixedStepSec;
    this.steps++;
    this.time = this.steps * dt;
    const p = this.player;
    const wasTalked = p.mode === 'talked';
    this.handleBlocking(dt);
    p.step(dt, this.rules.playerSpeedTilesPerSec);
    this.drainManual();
    // 말걸기 중에는 목적지를 지우지 않는다(D-039: 종료 후 같은 목적지로 자동 재개)
    if (p.mode !== 'moving' && p.mode !== 'talked' && !p.paused) this.destination = null;
    if (wasTalked && p.mode !== 'talked') {
      if (this.talkingNpc) this.events.push({ t: this.time, type: 'talkEnd', npc: this.talkingNpc.def.id });
      this.talkingNpc = null;
      // D-039 + postTalkHoldSec: 재개 시점에 콘 안이면 잠깐 위장 상태로 기다렸다 출발
      const hold = this.rules.movement?.postTalkHoldSec ?? 0;
      // BUG-009(D-043): 말걸기로 이미 멈춰 있었으므로 대기 첫 disguiseSettleSec도 위장 상승률(안착 면제)
      if (p.mode === 'moving' && hold > 0 && this.anyConeCoversPlayer()) p.pauseFor(hold, true);
    }

    const ctx: StepContext = {
      shouldTellTurn: (npc, facing) => this.turnNeedsTell(npc, facing),
      player: p.pos,
      playerTalkable: p.mode !== 'talked',
      playerDisguised: this.playerStill,
      ...(this.hooks.talkDisguisedFor ? { talkDisguisedFor: (npc: PatrolNpc) => this.hooks.talkDisguisedFor!(npc) } : {}),
      ...(this.hooks.talkCatchRadiusAdd ? { talkCatchRadiusAdd: this.hooks.talkCatchRadiusAdd() } : {}),
    };
    const ended: PatrolNpc[] = [];
    const frozen = (n: PatrolNpc) => this.hooks.npcFrozen?.(n) === true;
    for (const npc of this.npcs.slice()) {
      if (frozen(npc)) continue;
      const before = npc.mode;
      const beforeKind = npc.tellKind;
      npc.step(dt, this.rng, ctx);
      if (npc.mode === 'tell' && before !== 'tell') this.events.push({ t: this.time, type: 'tell', npc: npc.def.id });
      // 말걸기 전조가 끝나 성립(D-043) → 플레이어 강제 정지
      if (npc.mode === 'talk' && before !== 'talk' && npc.def.talk && p.forceTalk(npc.def.talk.durationSec)) {
        this.talkingNpc = npc;
        this.events.push({ t: this.time, type: 'talk', npc: npc.def.id });
      } else if (before === 'tell' && beforeKind === 'talk' && npc.tellKind !== 'talk' && npc.lastTalkCancel) {
        // BUG-015: 회피 취소(escaped)는 곧바로 돌아보기 전조(tell/look)로 넘어가 mode가 계속 tell이므로 tellKind로 판정
        this.events.push({ t: this.time, type: 'talkCancel', npc: npc.def.id, reason: npc.lastTalkCancel });
      }
      if (npc.ended) ended.push(npc);
    }
    for (const npc of ended) {
      this.events.push({ t: this.time, type: 'npcEnded', npc: npc.def.id, patrol: npc.def.patrolId ?? '' });
      const next = this.hooks.onNpcEnded?.(npc) ?? null;
      if (next) this.replaceNpc(npc, next);
      else if (npc.def.despawnAtEnd) this.removeNpc(npc);
      else npc.ended = false; // 끝 지점에 서 있음(done)
    }

    // 말걸기 전조 시작(반경 진입). 플레이어는 아직 조작 가능 — 전조 동안 피하거나 위장하면 취소된다
    for (const npc of this.npcs) {
      const talk = npc.def.talk;
      if (!talk || !npc.canTalk() || p.mode === 'talked' || frozen(npc)) continue;
      if (this.hooks.talkAllowed && !this.hooks.talkAllowed(npc)) continue;
      if (talk.skipIfPlayerDisguised && this.playerStill) continue; // 위장 중인 플레이어에게는 말을 걸지 않음
      const dx = p.x - npc.x, dy = p.y - npc.y;
      if (Math.hypot(dx, dy) <= npc.talkNoticeRadius) {
        npc.startTalk(Math.atan2(dy, dx));
        this.events.push({ t: this.time, type: 'talkWarn', npc: npc.def.id });
      }
    }

    if (this.camera) this.camera.step(p.y, dt * 60, p.mode === 'moving' ? p.moveDy : 0);

    // 시선 판정: 동시 시선은 배율 최댓값 하나만. 말걸기 중·보내 준 직후 NPC의 시선은 제외(D-043). 화면 밖 콘 주인 제외(X10)
    let mult = 0;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i]!;
      const sees = this.npcSees(npc);
      if (sees && !this.seeing[i]) this.events.push({ t: this.time, type: 'spotted', npc: npc.def.id });
      this.seeing[i] = sees;
      if (sees) mult = Math.max(mult, npc.gazeMultiplier);
    }
    if (this.hooks.extraGaze) mult = Math.max(mult, this.hooks.extraGaze());
    const startedExposure = mult > 0 && this.gazeNow === 0;
    this.gazeNow = mult;
    if (startedExposure) this.checkCloseCallOnExposure();
    // 안착 면제(BUG-009 말걸기 종료 직후, BUG-012 상위 규칙이 지정한 대기 칸 도착)
    if (this.playerStill && this.hooks.settleExempt?.() === true) p.markSettled();
    const base = exposureRate(this.rules.suspicion, p.mode, p.settled ? Infinity : p.modeTime);
    const rate = this.hooks.playerRate ? this.hooks.playerRate(base) : base;
    const t = p.tile;
    const stale = this.playerStill && !(this.rules.suspicion.disguiseStaleExemptNearCover && nearCover(this.map, t.x, t.y));
    // 위장 정체(X5)는 '콘 안에서 멈춰 있던 시간'으로 판정(T-140, rules.suspicion._designNote '콘 안에서 3초 넘게 서 있을 때만')
    this.stillExposedSec = mult > 0 && this.playerStill ? this.stillExposedSec + dt : 0;
    updateSuspicionRate(this.suspicion, this.rules.suspicion, mult, rate, dt, { decay: p.mode !== 'moving', stale, staleSec: this.stillExposedSec });

    this.updatePathDistances();

    if (this.suspicion.value >= this.rules.suspicion.max) {
      this.outcome = 'caught';
      this.events.push({ t: this.time, type: 'caught' });
    } else if (this.autoEscape && zoneAt(this.map, t.x, t.y) === this.level.exitZone) {
      this.outcome = 'escaped';
      this.events.push({ t: this.time, type: 'escaped' });
    }
  }

  /** 판 종료(상위 규칙이 결정: 퇴근 성공·야근 등) */
  finish(outcome: Exclude<Outcome, 'playing'>): void {
    if (this.outcome !== 'playing') return;
    this.outcome = outcome;
    this.events.push({ t: this.time, type: outcome === 'caught' ? 'caught' : 'escaped' });
  }

  /** NPC가 지금 플레이어를 '의심 판정에 들어가게' 보고 있는가 */
  npcSees(npc: PatrolNpc, target: { x: number; y: number } = this.player.pos): boolean {
    if (!npc.coneActive || npc.ignoresPlayer) return false;
    if (this.hooks.npcFrozen?.(npc)) return false;
    if (this.hooks.gazeAllowed && !this.hooks.gazeAllowed(npc)) return false;
    if (this.rules.offscreenSourceNoGain && this.camera && !this.camera.isOnScreen(npc.y)) return false;
    return canSee(this.map, npc.pos, npc.facing, npc.cone, target);
  }

  /** 이어하기(D-050): 상위 규칙이 판을 다시 진행 상태로 되돌림 */
  revive(): void {
    this.outcome = 'playing';
    this.talkingNpc = null;
    this.destination = null;
    this.resumeDestination = null;
    this.blockTimer = -1;
    this.suspicion.exposedSec = 0;
    this.gazeNow = 0;
    this.stillExposedSec = 0;
    this.seeing = this.npcs.map(() => false);
  }

  /** 화면 안 여부(카메라 없으면 항상 true) */
  isOnScreen(npc: PatrolNpc): boolean { return !this.camera || this.camera.isOnScreen(npc.y); }

  private anyConeCoversPlayer(): boolean {
    return this.npcs.some((n) => n.coneActive && !n.ignoresPlayer && n.gazeMultiplier > 0
      && canSee(this.map, n.pos, n.facing, n.cone, this.player.pos));
  }

  // ── 아슬아슬(D-035 ④, rules.disguise.closeCallWindowSec) ──

  private closeCall(): void {
    const d = this.rules.disguise;
    if (!d || this.closeCalls >= d.closeCallMaxPerDay) return;
    this.closeCalls++;
    this.events.push({ t: this.time, type: 'closeCall' });
  }

  /** 위장 직후 콘이 덮음: 위장 시각이 덮기 |window[0]|초 전 이내 */
  private checkCloseCallOnExposure(): void {
    const d = this.rules.disguise;
    if (!d || this.player.mode !== 'disguised') return;
    if (this.time - this.lastStopAt <= -d.closeCallWindowSec[0] + 1e-9) this.closeCall();
  }

  /** 덮인 직후 위장: 노출 시작 뒤 window[1]초 이내 */
  private checkCloseCallOnStop(): void {
    const d = this.rules.disguise;
    if (!d || this.gazeNow <= 0) return;
    if (this.suspicion.exposedSec <= d.closeCallWindowSec[1] + 1e-9) this.closeCall();
  }

  // ── 길막 대기·우회 (X8, rules.movement) ──

  private handleBlocking(dt: number): void {
    const mv = this.rules.movement;
    if (!mv || mv.blockedWaitSec === undefined) return;
    const p = this.player;
    const here = p.tile;
    const nextOf = (): Tile | null => {
      const n = p.paused ? (p.remainingPath()[0] ?? null) : p.nextNode();
      if (!n) return null;
      const t = tileOf(n);
      return t.x === here.x && t.y === here.y ? null : t;
    };
    if (p.mode === 'moving') {
      const nx = nextOf();
      if (nx && this.blockedForPlayer(nx.x, nx.y)) {
        p.pauseFor(Infinity);
        this.blockTimer = mv.blockedWaitSec;
        this.events.push({ t: this.time, type: 'blocked' });
      }
      return;
    }
    if (!p.paused || this.blockTimer < 0) return;
    const nx = nextOf();
    if (!nx || !this.blockedForPlayer(nx.x, nx.y)) { this.blockTimer = -1; p.resumePaused(); return; }
    this.blockTimer -= dt;
    if (this.blockTimer > 0) return;
    const dest = this.destination;
    const remaining = p.remainingPath().length;
    const alt = dest ? this.pathTo(dest) : null;
    if (alt && alt.length > 0 && alt.length <= remaining + (mv.rerouteMaxExtraTiles ?? 0)) {
      p.replacePausedPath(alt);
      this.blockTimer = -1;
      p.resumePaused();
    } else this.blockTimer = mv.rerouteRecheckSec ?? mv.blockedWaitSec;
  }

  /** 경고용 '넓은 콘'(가림 무시): 실제 콘 + rules.threat 여유. 실제 콘을 항상 포함한다 */
  private wideCone(npc: PatrolNpc): { range: number; halfAngleDeg: number } {
    const t = this.rules.threat;
    return {
      range: npc.cone.range + t.approachExtraRange,
      halfAngleDeg: npc.cone.halfAngleDeg + t.approachExtraAngleDeg,
    };
  }

  /**
   * BUG-010: 전조 중 경고(turning)용 콘. 실제 콘 거리에 '전조 남은 시간 + turnWarnLeadSec' 동안
   * 플레이어와 NPC가 서로 다가갈 수 있는 최대 거리(두 속도의 합 × 시간)를 더한다(넓은 콘 거리를 넘지 않음).
   * 원인: 화면 밖에서 회전 전조가 시작될 때 플레이어가 실제 콘 거리 바로 밖(예: 6타일 콘, 7.4타일)에서 다가오면
   * 전조 동안 turning이 거짓이고, 회전 직후 서로 다가가 시선이 시작될 때 화면 안 노출이 0.4초에 못 미쳤다.
   * 각도는 실제 콘 그대로(가림 반영) — 넓은 콘 전체로 키우면 앉은 상사 돌아보기마다 화살표가 떠 노이즈가 된다.
   */
  private turnWarnCone(npc: PatrolNpc, wide: { range: number; halfAngleDeg: number }): { range: number; halfAngleDeg: number } {
    const lead = this.rules.turnWarnLeadSec;
    const cone = npc.cone;
    if (lead === undefined || lead <= 0) return cone;
    const closing = (this.rules.playerSpeedTilesPerSec + Math.max(0, npc.def.speedTilesPerSec)) * (npc.tellRemaining + lead);
    return { range: Math.min(wide.range, cone.range + closing), halfAngleDeg: cone.halfAngleDeg };
  }

  /**
   * D-044 방향 전환 전조 판정 (BUG-001): "새 시선이 플레이어 쪽을 향할 수 있는가"
   * = 새 방향의 경고 콘(wideCone, 가림 무시) 안에 플레이어가 있으면 true → 전조 후 회전.
   * 경고 콘 ⊇ 실제 콘이므로 전조 없이 회전한 직후 실제 시선에 플레이어가 들어오는 경우는 생기지 않는다.
   * (rules.sight.cornerTellCondition 'new_facing_real_cone_could_cover_player'보다 넓은 보수적 판정)
   */
  private turnNeedsTell(npc: PatrolNpc, facing: number): boolean {
    return inCone(npc.pos, facing, this.wideCone(npc), this.player.pos);
  }

  private updatePathDistances(): void {
    const within = this.rules.threat.approachPathTilesWithin;
    if (within === undefined) return;
    if (this.distFieldStep !== this.steps) {
      this.distField = distanceField(this.map, this.player.tile);
      this.distFieldStep = this.steps;
    }
    const f = this.distField!;
    for (const n of this.npcs) {
      const t = tileOf(n);
      const d = t.x >= 0 && t.y >= 0 && t.x < this.map.width && t.y < this.map.height ? f[t.y * this.map.width + t.x]! : -1;
      const rec = this.pathDist.get(n);
      if (!rec) this.pathDist.set(n, { cur: d, prev: d });
      else if (rec.cur !== d) { rec.prev = rec.cur; rec.cur = d; }
    }
  }

  /** NPC가 플레이어에게 주는 위협 수준 (화면 밖 경고 표시용, rules.threat.stages) */
  threatOf(index: number): Threat {
    const npc = this.npcs[index];
    if (!npc) return 'none';
    if (this.seeing[index]) return 'seeing';
    return this.threatOfNpc(npc);
  }

  threatOfNpc(npc: PatrolNpc): Threat {
    const i = this.npcs.indexOf(npc);
    if (i >= 0 && this.seeing[i]) return 'seeing';
    if (this.hooks.npcFrozen?.(npc)) return 'none';
    const pp = this.player.pos;
    const th = this.rules.threat;
    const wide = this.wideCone(npc);
    const los = th.approachRequiresLineOfSight === true;
    if (npc.mode === 'tell' && npc.pendingFacing !== null) {
      const turning = los
        ? canSee(this.map, npc.pos, npc.pendingFacing, this.turnWarnCone(npc, wide), pp)
        : inCone(npc.pos, npc.pendingFacing, wide, pp);
      if (turning) return 'turning';
    }
    if (npc.mode === 'talk') return 'none';
    if (los && !npc.coneActive && npc.mode !== 'tell' && !npc.coneResumesWalking) return 'none';
    if (inCone(npc.pos, npc.facing, wide, pp) && (!los || hasLineOfSight(this.map, npc.pos, pp))) return 'approaching';
    if (th.approachPathTilesWithin !== undefined && npc.mode === 'walk') {
      const rec = this.pathDist.get(npc);
      if (rec && rec.cur >= 0 && rec.cur <= th.approachPathTilesWithin
        && (!th.approachPathMustBeDecreasing || rec.cur < rec.prev)) return 'approaching';
    }
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

  /** 디버그: 타일 종류 */
  kindAt(x: number, y: number): string | null { return kindAt(this.map, x, y); }
}
