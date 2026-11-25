/**
 * 순찰 NPC: 웨이포인트 이동 + 전조(tell) → 돌아보기(look) 상태 머신. 렌더링 무관.
 *
 * ── 기본(걷는 사람, T-123/T-127) ──
 *   walk ──웨이포인트 도착──▶ (확률 lookChance) tell → look → wait → walk(다음 구간)
 *                          └ (아니면) wait → walk
 *   walk ──타일 도착(구간 중간)──▶ (확률 glanceBackChancePerTile) tell(뒤쪽) → look → walk
 *   walk|wait ──말걸기 전조(D-043)──▶ tell(talk) ──성립──▶ talk → (원래 상태 복귀)
 *                                             └ 취소 ──▶ (피해 나감: 그쪽 look) | (위장·반경 미진입: 조용히 복귀)
 *
 * ── 앉은 모드(X1, NpcDef.seated) ──
 *   wait(idle, waypoint.waitSec 또는 useActorIdle → idleSecRange 추첨) → (phone 기회) | tell → look → return(returnSec) → wait …
 *   시선 콘은 coneActiveIn에 든 상태에서만 켜진다(앉은 상사 = ['look']). look 후 waypoint.facing으로 복귀.
 *
 * ── X2 ──
 *   tell/look 길이는 tellSecRange/lookSecRange에서 추첨. 페이크: 전조 후 시선 없이 afterFakeSec 멈춤(연속 페이크 금지 옵션).
 *   연속 두 번 보기: look 후 gapSec 쉬고 secondTellSec 전조 → 두 번째 look.
 *
 * ── X7 ──
 *   loop:false면 마지막 웨이포인트에서 끝(ended). despawnAtEnd면 FloorSim이 제거, thenPatrol은 FloorSim/DaySim이 교체.
 *   spawnTellSec 동안은 'spawn'(정지, 시선 없음 = 등장 전조).
 *   holdForQte/holdForReport 웨이포인트에서는 'hold'로 멈추고 release()를 기다린다.
 *
 * tell 동안 NPC는 멈추고, 시선 콘은 '현재' 방향을 유지한다. pendingFacing이 곧 돌아볼 방향(전조 표시용).
 * 모든 무작위 결정은 외부에서 주입한 시드 RNG로만 한다.
 *
 * ── 방향 전환 전조 규칙 (BUG-001, D-038 / D-044 조건부) ──
 * 모퉁이(경로 노드), 대기·돌아보기 후 재출발, 말걸기 종료 후 원래 방향 복귀처럼 '예정에 없던' 전환이 생기면
 * NPC는 그 순간 StepContext.shouldTellTurn(npc, 새 방향)을 묻는다(전환 후 상태에서 콘이 켜질 때만).
 *  - true  → 그 자리에 멈춰 tell(turnTellSec, 새 방향 점선 표시) → 새 방향으로 회전(look, 유지 0초) → 원래 동작 재개
 *  - false → 즉시 회전(전조 없음)
 */
import { tileCenter, type GridMap, type Vec } from './grid';
import { findPath } from './pathfinding';
import type { Rng } from './rng';
import { DIR_ANGLE, angleDiff, normAngle, type ConeDef, type Dir } from './vision';

export interface WaypointDef {
  readonly x: number;
  readonly y: number;
  readonly waitSec: number;
  /** 이 지점에서 돌아볼 확률. 없으면 NpcDef.lookChance */
  readonly lookChance?: number;
  /** 돌아볼 후보 방향. 없으면 현재 방향을 제외한 4방향 */
  readonly lookDirs?: readonly Dir[];
  /** 대기 중 바라보는 방향(앉은 상사: look 후 이 방향으로 복귀, X1) */
  readonly facing?: Dir;
  /** waitSec 대신 NpcDef.idleSecRange 추첨(X1) */
  readonly useActorIdle?: boolean;
  /** 방해·연출이 참조하는 정지 이름 */
  readonly stopId?: string;
  /** 이 지점에서 대기하는 동안 시선 없음 */
  readonly coneOff?: boolean;
  /** 도착하면 'hold'로 멈추고 release()를 기다림 */
  readonly holdForQte?: boolean;
  readonly holdForReport?: boolean;
  readonly lookIsRecheck?: boolean;
  /** 이 지점 돌아보기 전조 길이(초). 없으면 stopLookTellSec·tellSec(범위). 대표님 재확인 = sim.fake.tellSec(T-136 ③) */
  readonly lookTellSec?: number;
}

export interface TalkDef {
  /** 이 거리(타일) 안에 들어오면 말걸기 '발동'. noticeRadius가 없으면 이 반경에서 전조 시작(T-127 방식) */
  readonly radius: number;
  readonly durationSec: number;
  readonly cooldownSec: number;
  /** 이 반경에서 말풍선 전조 시작(v2, D-043). 전조 중 radius 안에 한 번이라도 들어와야 말걸기 성립 */
  readonly noticeRadius?: number;
  /** 말걸기 전조 길이(v2 데이터 talk.tellSec). 없으면 warnSec */
  readonly tellSec?: number;
  /** 말걸기 전조(말풍선) 길이(초, T-127 임시 필드). 실제 길이는 max(이 값, NpcDef.tellSec) */
  readonly warnSec?: number;
  /** 전조가 끝날 때 플레이어가 이 거리 이내면 말걸기 성립, 밖이면 취소(D-054). 없으면 noticeRadius, 그것도 없으면 radius × 2 */
  readonly catchRadius?: number;
  /** 말걸기 종료 후 이 시간 동안 이 NPC의 시선은 플레이어 의심에 반영하지 않는다(D-054). 없으면 기본값 */
  readonly releaseSec?: number;
  /** 위장 중인 플레이어에게는 말을 걸지 않음(D-043, T-124) */
  readonly skipIfPlayerDisguised?: boolean;
  /** 맞장구 탭 1회당 줄어드는 시간, 최소 대화 길이 */
  readonly nodShortenSec?: number;
  readonly minDurationSec?: number;
}

/** 데이터에 값이 없을 때 쓰는 기본값 (D-054: 기획이 데이터에 추가 예정. 개발 임시값) */
export const TALK_DEFAULTS = { warnSec: 0.5, catchRadiusMul: 2, releaseSec: 1.0 } as const;

/** NPC 한 스텝 갱신 시 시뮬레이션이 주는 정보 (NPC는 플레이어를 직접 알지 못한다) */
export interface StepContext {
  /** 지금 방향을 newFacing으로 바꾸려 할 때 전조가 필요한가 (D-044) */
  shouldTellTurn(npc: PatrolNpc, newFacing: number): boolean;
  /** 플레이어 위치 */
  readonly player: Vec;
  /** 플레이어에게 지금 말을 걸 수 있는가 (다른 NPC와 말하는 중이 아님 등) */
  readonly playerTalkable: boolean;
  /** 플레이어가 위장(멈춤) 중인가 — talk.skipIfPlayerDisguised용 */
  readonly playerDisguised?: boolean;
  /** 말걸기 전조 끝 판정용 위장 덮어쓰기(D-107: 전조 중 게이트 도착 = 도착 전 이동 상태). 없으면 playerDisguised */
  talkDisguisedFor?(npc: PatrolNpc): boolean | undefined;
  /** 붙잡는 반경 가산(carry 변형 carryTalkCatchRadiusAdd). 실제 = min(catchRadius + 이 값, radius × 2) */
  readonly talkCatchRadiusAdd?: number;
}

/** 컨텍스트 없이 step을 부를 때: 모든 전환에 전조(보수적) */
const ALWAYS_TELL: StepContext = { shouldTellTurn: () => true, player: { x: Infinity, y: Infinity }, playerTalkable: false };

/** 이보다 작은 각 변화는 '방향 전환'으로 보지 않는다(라디안) */
const TURN_EPS = 1e-3;

/** 콘이 켜질 수 있는 상태 이름 (bosses/npcs.json sim.coneActiveIn) */
export type ConeState = 'walk' | 'wait' | 'tell' | 'look';
const ALL_CONE_STATES: readonly ConeState[] = ['walk', 'wait', 'tell', 'look'];

export interface FakeDef {
  readonly chance: number;
  readonly capChance: number;
  readonly afterFakeSec?: number;
}
export interface DoubleLookDef {
  readonly chance: number;
  readonly capChance: number;
  readonly gapSec?: number;
  readonly secondTellSec?: number;
  readonly secondLookSecRange?: readonly [number, number];
}
export interface PhoneDef {
  readonly probPerCycle: number;
  readonly durationSecRange: readonly [number, number];
}

export interface NpcDef {
  readonly id: string;
  readonly name: string;
  /** 렌더링 분류 (boss = 상사, 빨강 위험색 / guard / ...) */
  readonly role: string;
  readonly cone: ConeDef;
  readonly speedTilesPerSec: number;
  /** 의심 상승 배율 */
  readonly gazeMultiplier: number;
  /** 전조 길이(초). 기획 기준 ≥ 0.4 (rules.json tell.minSec) */
  readonly tellSec: number;
  readonly lookSec: number;
  readonly lookChance: number;
  readonly glanceBackChancePerTile: number;
  readonly waypoints: readonly WaypointDef[];
  readonly talk?: TalkDef;
  // ── v2 확장 (없으면 T-127 동작) ──
  /** 액터 id(bosses/npcs.json). 렌더링·방해 이벤트 연결용 */
  readonly actorId?: string;
  /** 순찰 id(patrols.json) */
  readonly patrolId?: string;
  readonly coneActiveIn?: readonly ConeState[];
  readonly tellSecRange?: readonly [number, number];
  readonly lookSecRange?: readonly [number, number];
  readonly idleSecRange?: readonly [number, number];
  /** 웨이포인트에서 멈춰 둘러보기·뒤돌아보기 전조(걷는 사람). 없으면 tellSec(범위) */
  readonly stopLookTellSec?: number;
  /** 모퉁이·재출발 회전 전조(rules.sight.cornerTurnTellSec). 없으면 tellSec */
  readonly turnTellSec?: number;
  /** 앉은 모드 look 후 원래 방향 복귀 시간(rules.sight.returnSec) */
  readonly returnSec?: number;
  /** 앉은 모드(대기 → 전조 → 돌아보기 순서) */
  readonly seated?: boolean;
  /** false면 마지막 웨이포인트에서 끝 */
  readonly loop?: boolean;
  readonly despawnAtEnd?: boolean;
  readonly spawnTellSec?: number;
  /** 이 순찰 전체 시선 없음 */
  readonly coneOff?: boolean;
  readonly fake?: FakeDef;
  readonly doubleLook?: DoubleLookDef;
  /** rules.fake */
  readonly fakeAbsoluteCap?: number;
  readonly noConsecutiveFakes?: boolean;
  /** 통화 기회(bosses.opportunities phone_call): 대기 주기마다 확률 */
  readonly phone?: PhoneDef;
  /** 이 순찰이 끝나면 전환할 순찰 id */
  readonly thenPatrol?: string;
  /** 플레이어 길막 판정에서 제외(배경 동료 blocksPlayer:false) */
  readonly passable?: boolean;
  /**
   * 말걸기 전조 중 반경에 들어왔다가 피해 나갔을 때 돌아보기 전 전조(T-134 ④ rules.talk.dodgeAfterEnterLooksAtPlayer,
   * 길이 = rules.sight.cornerTurnTellSec). 없으면 전조 없이 바로 돌아봄(T-127 동작)
   */
  readonly escapeLookTellSec?: number;
  /** T-145: 첫 돌아보기는 정상 전조(페이크·연속 보기 없음) — 팀장 순회 복귀 직후(leadRoaming 확장) */
  readonly plainFirstLook?: boolean;
}

export type NpcMode = 'spawn' | 'walk' | 'wait' | 'tell' | 'look' | 'return' | 'fake' | 'talk' | 'phone' | 'hold' | 'done';

const ALL_DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];
const DEFAULT_RETURN_SEC = 0.3;
const DEFAULT_AFTER_FAKE_SEC = 0.3;

type Resume = 'walk' | 'wait' | 'next';

interface LookOpts {
  tellSec?: number;
  lookSec?: number;
  noFake?: boolean;
  coneRange?: number;
  gazeScale?: number;
  second?: boolean;
}

export class PatrolNpc {
  readonly def: NpcDef;
  x: number;
  y: number;
  facing = 0;
  mode: NpcMode = 'wait';
  modeTime = 0;
  /** tell 중일 때 돌아볼 방향 */
  pendingFacing: number | null = null;
  /** 현재 tell의 종류: look(돌아보기) / turn(경로 방향 전환, D-044) / talk(말걸기 전조, D-043) */
  tellKind: 'look' | 'turn' | 'talk' | null = null;
  talkCooldown = 0;
  /** 말걸기 종료 후 남은 '보내 줌' 시간(초) */
  releaseLeft = 0;
  /** 순찰이 끝났는가(loop:false). despawnAtEnd면 제거 대상 */
  ended = false;
  /** 외부(DaySim)에서 시선을 끔(통화·회의·얼음 등). true면 콘 없음 */
  suppressed = false;
  /** 마지막 말걸기 전조가 취소된 이유(표시용) */
  lastTalkCancel: 'disguised' | 'escaped' | 'missed' | 'door' | null = null;
  /** 현재 대기 중인 웨이포인트의 stopId (hold·도착 판정용) */
  get stopId(): string | undefined { return this.def.waypoints[this.wpIndex]?.stopId; }

  private readonly segments: Vec[][];
  private readonly loop: boolean;
  private wpIndex = 0;
  private nodeIndex = 0;
  private timer = 0;
  private waitLeft = 0;
  private resume: Resume = 'wait';
  private lookHold = 0;
  private talkResume: 'walk' | 'wait' = 'wait';
  private talkPrevFacing = 0;
  private talkArmed = false;
  private tellIsFake = false;
  private lastWasFake = false;
  private inSecondLook = false;
  private pendingSecond: LookOpts | null = null;
  private returnFacing: number | null = null;
  private coneRangeOverride: number | null = null;
  private gazeScaleOverride: number | null = null;
  private seatLookPending = false;
  /** 지금 look의 출처: 돌아보기 / 경로 회전(유지 0초) / 말걸기 취소 */
  private curLookKind: 'look' | 'turn' | 'cancel' = 'look';

  constructor(def: NpcDef, map: GridMap, rng: Rng) {
    if (def.waypoints.length === 0) throw new Error(`npc ${def.id}: 웨이포인트 없음`);
    this.def = def;
    this.plainPending = def.plainFirstLook === true;
    this.loop = def.loop !== false;
    const wps = def.waypoints;
    const n = wps.length;
    this.segments = wps.map((wp, i) => {
      if (!this.loop && i === n - 1) return [];
      const next = wps[(i + 1) % n]!;
      const p = findPath(map, { x: wp.x, y: wp.y }, { x: next.x, y: next.y });
      if (!p) throw new Error(`npc ${def.id}: 웨이포인트 ${i}→${(i + 1) % n} 경로 없음`);
      return p.map(tileCenter);
    });
    const c = tileCenter(wps[0]!);
    this.x = c.x;
    this.y = c.y;
    const first = this.segments[0]![0];
    const f0 = wps[0]!.facing;
    this.facing = f0 ? DIR_ANGLE[f0] : first ? Math.atan2(first.y - c.y, first.x - c.x) : 0;
    if (def.spawnTellSec && def.spawnTellSec > 0) {
      this.timer = def.spawnTellSec;
      this.setMode('spawn');
    } else this.arrive(0, rng, null);
  }

  get pos(): Vec { return { x: this.x, y: this.y }; }
  get waypointIndex(): number { return this.wpIndex; }
  /** 전조(tell) 남은 시간(초). 전조 중이 아니면 0 (BUG-010: 경고 판정의 예측 구간) */
  get tellRemaining(): number { return this.mode === 'tell' ? Math.max(0, this.timer) : 0; }

  /** 지금 판정에 쓰는 콘 (강제 시선의 거리 덮어쓰기 반영) */
  get cone(): ConeDef {
    return this.coneRangeOverride !== null ? { range: this.coneRangeOverride, halfAngleDeg: this.def.cone.halfAngleDeg } : this.def.cone;
  }

  /** 의심 배율 (스크립트 시선 배율 반영) */
  get gazeMultiplier(): number { return this.def.gazeMultiplier * (this.gazeScaleOverride ?? 1); }

  /** 이 상태에서 콘이 켜지는가 (coneActiveIn, X1) */
  coneOnIn(state: ConeState): boolean {
    return (this.def.coneActiveIn ?? ALL_CONE_STATES).includes(state);
  }

  /** 지금 시선 콘이 켜져 있는가 (판정·렌더링 공통) */
  get coneActive(): boolean {
    if (this.def.coneOff || this.suppressed || this.cone.range <= 0) return false;
    switch (this.mode) {
      case 'walk': return this.coneOnIn('walk');
      case 'wait': case 'return': case 'hold': case 'done':
        return !this.def.waypoints[this.wpIndex]?.coneOff && this.coneOnIn('wait');
      case 'tell': case 'fake': return this.coneOnIn('tell');
      case 'look': return this.coneOnIn('look') || this.coneRangeOverride !== null;
      default: return false; // spawn, talk, phone
    }
  }

  private setMode(m: NpcMode): void { this.mode = m; this.modeTime = 0; }
  /** 첫 돌아보기를 정상 전조로 강제하는 중(plainFirstLook) */
  private plainPending = false;
  private plainThisLook = false;

  private drawRange(r: readonly [number, number] | undefined, fallback: number, rng: Rng): number {
    if (!r) return fallback;
    return r[0] === r[1] ? r[0] : rng.range(r[0], r[1]);
  }

  /** 돌아보기 전조 시작. resume: 끝나고 돌아갈 상태 */
  private startLook(facing: number, resume: Resume, rng: Rng, opts: LookOpts = {}, stopLook = false): void {
    this.pendingFacing = normAngle(facing);
    this.resume = resume;
    this.tellKind = 'look';
    const defaultTell = stopLook && this.def.stopLookTellSec !== undefined
      ? this.def.stopLookTellSec : this.drawRange(this.def.tellSecRange, this.def.tellSec, rng);
    this.timer = opts.tellSec ?? defaultTell;
    this.lookHold = opts.lookSec ?? this.drawRange(this.def.lookSecRange, this.def.lookSec, rng);
    this.inSecondLook = opts.second === true;
    this.coneRangeOverride = opts.coneRange ?? null;
    this.gazeScaleOverride = opts.gazeScale ?? null;
    // 페이크(X2): 상한 = min(chance, capChance, 전역 상한). 연속 페이크 금지면 직전이 페이크일 때 진짜
    this.tellIsFake = false;
    this.plainThisLook = this.plainPending && !opts.second;
    if (this.plainThisLook) this.plainPending = false;
    const f = this.def.fake;
    if (f && !opts.noFake && !opts.second && !this.plainThisLook && f.chance > 0) {
      if (this.def.noConsecutiveFakes && this.lastWasFake) this.lastWasFake = false;
      else {
        const p = Math.min(f.chance, f.capChance, this.def.fakeAbsoluteCap ?? 1);
        this.tellIsFake = rng.chance(p);
        this.lastWasFake = this.tellIsFake;
      }
    }
    this.setMode('tell');
  }

  /** 경로 방향 전환 전조(D-044) */
  private startTurnTell(facing: number, resume: Resume): void {
    this.pendingFacing = normAngle(facing);
    this.resume = resume;
    this.tellKind = 'turn';
    this.timer = this.def.turnTellSec ?? this.def.tellSec;
    this.lookHold = 0;
    this.tellIsFake = false;
    this.setMode('tell');
  }

  /**
   * 예정된 방향 전환. D-044 규칙에 따라 전조가 필요하면 tell을 시작하고 true(이번 스텝 동작 중단),
   * 아니면 즉시 회전하고 false. 전환 후 상태에서 콘이 꺼져 있으면 전조 없이 회전한다.
   */
  private turnTo(facing: number, resume: Resume, ctx: StepContext): boolean {
    if (angleDiff(facing, this.facing) <= TURN_EPS) { this.facing = facing; return false; }
    const after: ConeState = resume === 'walk' ? 'walk' : 'wait';
    const coneAfter = !this.def.coneOff && !this.suppressed && this.coneOnIn(after);
    if (coneAfter && ctx.shouldTellTurn(this, facing)) { this.startTurnTell(facing, resume); return true; }
    this.facing = facing;
    return false;
  }

  /** 시선이 지금 플레이어 의심에 반영되지 않는가 (말걸기 중·보내 준 직후, D-043) */
  get ignoresPlayer(): boolean { return this.mode === 'talk' || this.releaseLeft > 0; }

  private arrive(i: number, rng: Rng, ctx: StepContext | null): void {
    this.wpIndex = i;
    this.nodeIndex = 0;
    const wp = this.def.waypoints[i]!;
    const waitSec = wp.useActorIdle && this.def.idleSecRange ? this.drawRange(this.def.idleSecRange, wp.waitSec, rng) : wp.waitSec;
    this.waitLeft = waitSec;
    if (wp.facing && this.def.seated) this.facing = DIR_ANGLE[wp.facing];
    else if (wp.facing && ctx && this.turnTo(DIR_ANGLE[wp.facing], waitSec > 0 ? 'wait' : 'next', ctx)) return;
    else if (wp.facing) this.facing = DIR_ANGLE[wp.facing];
    if (wp.holdForQte || wp.holdForReport) { this.setMode('hold'); return; }
    if (this.def.seated) {
      // X1: 대기 먼저, 대기가 끝날 때 돌아볼지 정한다
      this.seatLookPending = true;
      // 돌아보지도 않고 대기도 0인 자리(공범 동료 등)는 계속 앉아 있음(매 스텝 walk↔wait 반복 방지)
      if (waitSec <= 0 && (wp.lookChance ?? this.def.lookChance) <= 0 && !this.def.phone && this.def.waypoints.length === 1) {
        this.waitLeft = Infinity;
        this.setMode('wait');
        return;
      }
      if (waitSec > 0) this.setMode('wait');
      else this.endSeatWait(rng);
      return;
    }
    const chance = wp.lookChance ?? this.def.lookChance;
    if (waitSec > 0 && rng.chance(chance)) {
      this.startLook(DIR_ANGLE[this.pickDir(wp, rng)], 'wait', rng, wp.lookTellSec !== undefined ? { tellSec: wp.lookTellSec } : {}, true);
    } else if (waitSec > 0) {
      this.setMode('wait');
    } else {
      this.proceed();
    }
  }

  private pickDir(wp: WaypointDef, rng: Rng): Dir {
    const cands = wp.lookDirs && wp.lookDirs.length > 0
      ? wp.lookDirs
      : ALL_DIRS.filter((d) => angleDiff(DIR_ANGLE[d], this.facing) > 0.1);
    return rng.pick(cands) ?? 'down';
  }

  /** 앉은 모드: 대기가 끝남 → 통화 기회 / 돌아보기 / 다음 주기 */
  private endSeatWait(rng: Rng): void {
    this.seatLookPending = false;
    const ph = this.def.phone;
    if (ph && ph.probPerCycle > 0 && rng.chance(ph.probPerCycle)) {
      this.startPhone(this.drawRange(ph.durationSecRange, ph.durationSecRange[0], rng));
      return;
    }
    const wp = this.def.waypoints[this.wpIndex]!;
    const chance = wp.lookChance ?? this.def.lookChance;
    if (rng.chance(chance)) this.startLook(DIR_ANGLE[this.pickDir(wp, rng)], 'next', rng, wp.lookTellSec !== undefined ? { tellSec: wp.lookTellSec } : {});
    else this.proceed();
  }

  /** 다음 구간으로 (끝이면 종료) */
  private proceed(): void {
    if (!this.loop && this.wpIndex >= this.def.waypoints.length - 1) {
      this.ended = true;
      this.setMode('done');
      return;
    }
    this.setMode('walk');
  }

  /** 통화 시작(시선·말걸기 꺼짐). 스크립트(boss_opportunity)에서도 호출 */
  startPhone(sec: number): void {
    this.pendingFacing = null;
    this.tellKind = null;
    this.timer = sec;
    this.setMode('phone');
  }

  /** hold 웨이포인트에서 다시 출발 */
  release(): void {
    if (this.mode !== 'hold') return;
    this.proceed();
  }

  /** 앉은 대기 시간을 줄인다(간식 바스락 → 상사 idle 즉시 종료, 전조는 정상) */
  shortenIdle(toSec: number): void {
    if (this.mode === 'wait' && this.seatLookPending) this.waitLeft = Math.min(this.waitLeft, toSec);
  }

  /**
   * 강제 시선(스크립트 boss_look, 보고받은 팀장, 게이트 삐빅 경비). 반드시 전조(tellSec)부터 시작한다.
   * 걷기·대기·정지 상태에서만 받는다. 성공 여부 반환
   */
  forceLook(angle: number, rng: Rng, opts: { tellSec: number; lookSec: number; coneRange?: number; gazeScale?: number }): boolean {
    if (!(this.mode === 'walk' || this.mode === 'wait' || this.mode === 'done' || this.mode === 'hold')) return false;
    const resume: Resume = this.mode === 'walk' ? 'walk' : this.mode === 'wait' && this.waitLeft > 0 ? 'wait' : 'next';
    const lo: LookOpts = { tellSec: opts.tellSec, lookSec: opts.lookSec, noFake: true };
    if (opts.coneRange !== undefined) lo.coneRange = opts.coneRange;
    if (opts.gazeScale !== undefined) lo.gazeScale = opts.gazeScale;
    const wasDone = this.mode === 'done' || this.mode === 'hold';
    this.startLook(angle, resume, rng, lo);
    if (wasDone) this.resume = 'wait';
    return true;
  }

  /** 말걸기 가능 여부 */
  canTalk(): boolean {
    return !!this.def.talk && this.talkCooldown <= 0 && (this.mode === 'walk' || this.mode === 'wait');
  }

  /** 말걸기 전조를 시작할 반경 */
  get talkNoticeRadius(): number {
    const t = this.def.talk;
    return t ? (t.noticeRadius ?? t.radius) : 0;
  }

  /**
   * 말걸기 전조 시작 (D-043). NPC는 멈추고 방향은 그대로, pendingFacing = 플레이어 쪽.
   * 전조가 끝나는 스텝에 성립 조건을 만족하면 talk(이때 FloorSim이 플레이어를 강제 정지), 아니면 취소.
   */
  startTalk(towardAngle: number): void {
    const t = this.def.talk;
    if (!t) return;
    this.talkResume = this.mode === 'walk' ? 'walk' : 'wait';
    this.talkPrevFacing = this.facing;
    this.pendingFacing = normAngle(towardAngle);
    this.resume = this.talkResume;
    this.tellKind = 'talk';
    this.tellIsFake = false;
    this.timer = t.tellSec !== undefined
      ? Math.max(t.tellSec, TALK_DEFAULTS.warnSec)
      : Math.max(t.warnSec ?? TALK_DEFAULTS.warnSec, this.def.tellSec);
    this.lookHold = this.def.lookSec;
    // noticeRadius가 없으면(T-127) 전조 시작 = 발동 반경 진입
    this.talkArmed = t.noticeRadius === undefined;
    this.lastTalkCancel = null;
    this.setMode('tell');
  }

  private finishTalkWarn(ctx: StepContext): void {
    const t = this.def.talk!;
    const dx = ctx.player.x - this.x, dy = ctx.player.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= t.radius) this.talkArmed = true;
    const catchR0 = t.catchRadius ?? t.noticeRadius ?? t.radius * TALK_DEFAULTS.catchRadiusMul;
    const add = ctx.talkCatchRadiusAdd ?? 0;
    const catchR = add > 0 ? Math.max(catchR0, Math.min(catchR0 + add, t.radius * TALK_DEFAULTS.catchRadiusMul)) : catchR0;
    const disg = ctx.talkDisguisedFor?.(this) ?? ctx.playerDisguised;
    const disguisedSkip = t.skipIfPlayerDisguised === true && disg === true;
    this.pendingFacing = null;
    this.tellKind = null;
    if (ctx.playerTalkable && this.talkArmed && !disguisedSkip && dist <= catchR) {
      this.facing = normAngle(Math.atan2(dy, dx));
      this.timer = t.durationSec;
      this.talkCooldown = t.cooldownSec + t.durationSec;
      this.setMode('talk');
      return;
    }
    this.talkCooldown = t.cooldownSec;
    if (disguisedSkip || !this.talkArmed) {
      // 위장했거나 발동 반경에 들어오지 않음: 조용히 원래 상태로("…아니다, 바빠 보이네")
      this.lastTalkCancel = disguisedSkip ? 'disguised' : 'missed';
      this.setMode(this.talkResume);
      return;
    }
    // 피해 나감(D-054): 플레이어 쪽을 돌아본다. T-134 ④: 정상 시선이므로 고개 먼저 + 점선 콘 전조(escapeLookTellSec) 뒤 look(lookSec)
    this.lastTalkCancel = 'escaped';
    const toward = normAngle(Math.atan2(dy, dx));
    this.lookHold = this.def.lookSec;
    if (this.def.escapeLookTellSec !== undefined && this.def.escapeLookTellSec > 0) {
      this.pendingFacing = toward;
      this.tellKind = 'look';
      this.tellIsFake = false;
      this.escapeLookPending = true;
      this.timer = this.def.escapeLookTellSec;
      this.resume = this.talkResume;
      this.setMode('tell');
      return;
    }
    this.curLookKind = 'cancel';
    this.facing = toward;
    this.timer = this.lookHold;
    this.returnFacing = this.def.seated ? this.talkPrevFacing : null;
    this.setMode('look');
  }

  private escapeLookPending = false;

  /**
   * T-151(S-05, genderFacilities.access.talkCancelNpcBehavior 'stop_in_place'): 말걸기 전조를 시설 문에서 취소.
   * 플레이어 쪽으로 돌아보지 않고(문 쪽 시선·접근 없음) 그 자리에서 남은 전조 시간만큼 멈췄다가 원래 경로로 돌아간다.
   * 반환: 취소했는가
   */
  cancelTalkInPlace(minHoldSec = 0): boolean {
    if (this.mode !== 'tell' || this.tellKind !== 'talk' || !this.def.talk) return false;
    const hold = Math.max(0, this.timer, minHoldSec);
    this.pendingFacing = null;
    this.tellKind = null;
    this.talkArmed = false;
    this.facing = this.talkPrevFacing;
    this.talkCooldown = this.def.talk.cooldownSec;
    this.lastTalkCancel = 'door';
    if (this.talkResume === 'walk') { this.resume = 'walk'; this.waitLeft = hold; this.doorHold = true; this.setMode('wait'); return true; }
    this.waitLeft = Math.max(this.waitLeft, hold);
    this.setMode('wait');
    return true;
  }
  /** 문 취소 정지 뒤 걷기 재개(웨이포인트 도착 처리 없이 같은 구간을 이어 걸음) */
  private doorHold = false;

  /**
   * 진행 중인 전조·돌아보기를 끊고 원래 상태로(대표님 얼음 해제·위계 연쇄 복귀 H2). 다음 시선은 반드시 전조부터 시작한다.
   * 앉은 사람은 새 대기 주기, 걷는 사람은 걷기·대기로 재개.
   */
  interruptLook(rng: Rng): void {
    if (!(this.mode === 'tell' || this.mode === 'look' || this.mode === 'fake' || this.mode === 'return' || this.mode === 'talk')) return;
    this.pendingFacing = null;
    this.tellKind = null;
    this.coneRangeOverride = null;
    this.gazeScaleOverride = null;
    this.pendingSecond = null;
    this.inSecondLook = false;
    this.escapeLookPending = false;
    if (this.returnFacing !== null) { this.facing = this.returnFacing; this.returnFacing = null; }
    if (this.mode === 'talk') this.facing = this.talkPrevFacing;
    if (this.def.seated) { this.arrive(this.wpIndex, rng, null); return; }
    this.resumeAfter(rng, ALWAYS_TELL);
  }

  /** 앉은 사람이 다음 전조를 시작하기까지 남은 대기(초). 모르면 null (공범 망보기 헛기침, INT-12) */
  get upcomingTellSec(): number | null {
    if (this.mode === 'wait' && this.def.seated && this.seatLookPending && Number.isFinite(this.waitLeft)) return this.waitLeft;
    return null;
  }

  /** 맞장구로 대화 길이를 줄였을 때 NPC 쪽 타이머 동기화 */
  syncTalkRemaining(sec: number): void {
    if (this.mode === 'talk') this.timer = Math.min(this.timer, sec);
  }

  step(dt: number, rng: Rng, ctx: StepContext = ALWAYS_TELL): void {
    this.modeTime += dt;
    if (this.talkCooldown > 0) this.talkCooldown -= dt;
    if (this.releaseLeft > 0) this.releaseLeft = Math.max(0, this.releaseLeft - dt);
    switch (this.mode) {
      case 'spawn':
        this.timer -= dt;
        if (this.timer <= 0) this.arrive(0, rng, ctx);
        return;
      case 'tell':
        if (this.tellKind === 'talk' && this.def.talk
          && Math.hypot(ctx.player.x - this.x, ctx.player.y - this.y) <= this.def.talk.radius) this.talkArmed = true;
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.tellKind === 'talk') { this.finishTalkWarn(ctx); return; }
          this.pendingFacing = this.tellKind === 'look' && this.tellIsFake ? null : this.pendingFacing;
          if (this.tellIsFake) {
            // 페이크: 시선 없이 잠깐 멈췄다가 재개
            this.tellKind = null;
            this.timer = this.def.fake?.afterFakeSec ?? DEFAULT_AFTER_FAKE_SEC;
            this.setMode('fake');
            return;
          }
          const wasLook = this.tellKind === 'look';
          this.curLookKind = this.escapeLookPending ? 'cancel' : wasLook ? 'look' : 'turn';
          const wasEscape = this.escapeLookPending;
          this.escapeLookPending = false;
          this.facing = this.pendingFacing ?? this.facing;
          this.pendingFacing = null;
          this.tellKind = null;
          this.timer = this.lookHold;
          if (wasEscape) this.returnFacing = this.def.seated ? this.talkPrevFacing : null;
          else if (wasLook && this.def.seated) this.returnFacing = DIR_ANGLE[this.def.waypoints[this.wpIndex]?.facing ?? 'up'];
          this.setMode('look');
        }
        return;
      case 'fake':
        this.timer -= dt;
        if (this.timer <= 0) this.afterLook(rng, ctx);
        return;
      case 'look':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.coneRangeOverride = null;
          this.gazeScaleOverride = null;
          this.afterLook(rng, ctx);
        }
        return;
      case 'return':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.returnFacing !== null) this.facing = this.returnFacing;
          this.returnFacing = null;
          if (this.pendingSecond) {
            const o = this.pendingSecond;
            this.pendingSecond = null;
            this.startLook(this.lastLookFacing, this.resume, rng, o);
            return;
          }
          this.resumeAfter(rng, ctx);
        }
        return;
      case 'talk':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.releaseLeft = this.def.talk?.releaseSec ?? TALK_DEFAULTS.releaseSec;
          if (this.def.seated) { this.facing = this.talkPrevFacing; this.setMode(this.talkResume); return; }
          // 원래 방향 복귀도 방향 전환 규칙(D-044)을 따른다
          if (!this.turnTo(this.talkPrevFacing, this.talkResume, ctx)) this.setMode(this.talkResume);
        }
        return;
      case 'phone':
        this.timer -= dt;
        if (this.timer <= 0) {
          // 통화 끝: 새 대기 주기(다음 시선은 반드시 전조부터)
          if (this.def.seated) this.arrive(this.wpIndex, rng, ctx);
          else this.setMode('wait');
        }
        return;
      case 'wait':
        this.waitLeft -= dt;
        if (this.waitLeft <= 0 && this.doorHold) { this.doorHold = false; this.setMode('walk'); return; }
        if (this.waitLeft <= 0) {
          if (this.def.seated && this.seatLookPending) { this.endSeatWait(rng); return; }
          this.proceed();
        }
        return;
      case 'walk':
        this.walk(dt, rng, ctx);
        return;
      case 'hold':
      case 'done':
        return;
    }
  }

  private lastLookFacing = 0;

  /** look(또는 페이크)이 끝난 뒤: 연속 두 번 보기 → 복귀(return) → 재개 */
  private afterLook(rng: Rng, ctx: StepContext): void {
    const dl = this.def.doubleLook;
    const wasFake = this.mode === 'fake';
    if (this.curLookKind === 'turn' && !wasFake) { this.resumeAfter(rng, ctx); return; }
    const plain = this.plainThisLook;
    this.plainThisLook = false;
    if (dl && !wasFake && !plain && this.curLookKind === 'look' && !this.inSecondLook && dl.chance > 0 && rng.chance(Math.min(dl.chance, dl.capChance))) {
      this.lastLookFacing = this.facing;
      const o: LookOpts = { second: true, noFake: true };
      if (dl.secondTellSec !== undefined) o.tellSec = dl.secondTellSec;
      if (dl.secondLookSecRange) o.lookSec = this.drawRange(dl.secondLookSecRange, this.def.lookSec, rng);
      this.pendingSecond = o;
      this.timer = dl.gapSec ?? DEFAULT_RETURN_SEC;
      this.setMode('return');
      return;
    }
    this.inSecondLook = false;
    if (this.returnFacing !== null || (this.def.seated && !wasFake)) {
      if (this.returnFacing === null) this.returnFacing = DIR_ANGLE[this.def.waypoints[this.wpIndex]?.facing ?? 'up'];
      this.timer = this.def.returnSec ?? DEFAULT_RETURN_SEC;
      this.setMode('return');
      return;
    }
    this.resumeAfter(rng, ctx);
  }

  private resumeAfter(_rng: Rng, _ctx: StepContext): void {
    if (this.resume === 'wait' && this.waitLeft > 0) this.setMode('wait');
    else if (this.resume === 'walk') this.setMode('walk');
    else this.proceed();
  }

  private walk(dt: number, rng: Rng, ctx: StepContext): void {
    let budget = this.def.speedTilesPerSec * dt;
    while (budget > 0) {
      const seg = this.segments[this.wpIndex]!;
      const target = seg[this.nodeIndex];
      if (!target) { // 길이 0 구간 (연속 같은 웨이포인트)
        if (!this.loop && this.wpIndex >= this.segments.length - 1) { this.proceed(); return; }
        this.arrive((this.wpIndex + 1) % this.segments.length, rng, ctx);
        return;
      }
      const dx = target.x - this.x, dy = target.y - this.y;
      const d = Math.hypot(dx, dy);
      // 모퉁이·재출발 방향 전환: D-044 규칙(전조가 필요하면 여기서 멈춘다)
      if (d > 1e-9 && this.turnTo(Math.atan2(dy, dx), 'walk', ctx)) return;
      if (d > budget) {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        return;
      }
      this.x = target.x; this.y = target.y;
      budget -= d;
      this.nodeIndex++;
      if (this.nodeIndex >= seg.length) {
        this.arrive((this.wpIndex + 1) % this.segments.length, rng, ctx);
        if (this.mode !== 'walk') return;
      } else if (this.def.glanceBackChancePerTile > 0 && rng.chance(this.def.glanceBackChancePerTile)) {
        this.startLook(this.facing + Math.PI, 'walk', rng, {}, true);
        return;
      }
    }
  }
}
