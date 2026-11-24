/**
 * 하루 한 판 시뮬레이션 (X9: 하루 시계·업무 게이지·미션, 방해 이벤트 런타임, 퇴근 시퀀스) — 렌더링 무관.
 * FloorSim(이동·시선·의심)을 감싸고 훅으로 상위 규칙을 넣는다. 씬과 QA 봇이 같은 API를 쓴다.
 *
 * 결정성: 고정 스텝(rules.fixedStepSec) + 시드 RNG(FloorSim.rng 하나를 공유) + 고정된 갱신 순서.
 *  매 스텝: (1) 하루 규칙 전처리(시계·방해 시작·미션 해금) → (2) FloorSim.step → (3) 후처리(미션 진행·퇴근·결과)
 *
 * 입력:
 *  - tapWorld(tx, ty): 화면(지도) 탭. 미션 행동 중이면 미션 입력, 퇴근 가방·게이트 단계면 그 입력, 아니면 이동/정지(FloorSim.tap)
 *  - tapMission(id): HUD 미션 칩. 화면 탭이 아니므로 이동 중에도 멈추지 않고 목적지만 바꾼다(rules.input.hudTapDoesNotStop)
 */
import { FloorSim, type SimEvent } from '../floorSim';
import { tileOf, zoneAt, type Tile } from '../grid';
import { DIR_ANGLE, canSee, type Dir } from '../vision';
import { Follower } from './follower';
import { GreetQte, type QteResult } from './qte';
import { findPath } from '../pathfinding';
import type { NpcDef, PatrolNpc, WaypointDef } from '../patrol';
import { addSuspicion } from '../suspicion';
import { PrintJob, createActivity, createGrabActivity, emptyEffects, type Activity, type ActivityEffects, type ActivityView } from './missions';
import { evaluateMissionConditions } from './modifiers';
import type { CameraView } from '../camera';
import type {
  BossTourDef, DayContent, DayInterruptDef, DayOutcome, DayPhase, DayResult, LeaveStage, MissionDef, MissionState,
} from './types';

export type CeoVisitState = 'none' | 'skipped' | 'pending' | 'tell' | 'freeze' | 'qte' | 'talk' | 'exit' | 'resume' | 'done' | 'cancelled';
export type ElevatorCeoState = 'none' | 'tell' | 'qte' | 'done';

export type DayEvent =
  | { t: number; type: 'phase'; phase: DayPhase }
  | { t: number; type: 'hint'; key: string }
  | { t: number; type: 'toast'; key: string }
  | { t: number; type: 'missionUnlocked'; id: string }
  | { t: number; type: 'missionStart'; id: string }
  | { t: number; type: 'missionSuccess'; id: string }
  | { t: number; type: 'missionDone'; id: string; points: number; bonus?: readonly string[] }
  | { t: number; type: 'missionFail'; id: string; reason: 'fail' | 'timeout' }
  | { t: number; type: 'interrupt'; id: string; textKey?: string }
  | { t: number; type: 'leaveStage'; stage: LeaveStage }
  | { t: number; type: 'gate'; result: 'pass' | 'fail' }
  | { t: number; type: 'hrAbsent' }
  | { t: number; type: 'report'; result: 'start' | 'arrive' | 'doubt' | 'blocked' | 'giveUp' }
  | { t: number; type: 'closeCall'; points: number }
  | { t: number; type: 'result'; result: DayResult }
  // ── T-133 ──
  | { t: number; type: 'ceo'; stage: CeoVisitState }
  | { t: number; type: 'qte'; source: 'ceo' | 'elevator'; stage: 'precue' | 'cue' | 'result'; result?: QteResult }
  | { t: number; type: 'eyeContact'; points: number }
  | { t: number; type: 'offer'; missionId: string; textKey: string; forced: boolean }
  | { t: number; type: 'offerEnd'; missionId: string; accepted: boolean }
  | { t: number; type: 'accomplice'; action: 'join' | 'leave' | 'cough' }
  | { t: number; type: 'say'; npc: string; key: string; sec: number }
  | { t: number; type: 'routeHint'; routes: { id: string; kind: 'hint' | 'caution'; tiles: Tile[] }[]; sec: number }
  | { t: number; type: 'offscreenDemo'; actor: string; sec: number }
  | { t: number; type: 'continued' }
  // ── T-144 팀장 순회(D-075): stand = 일어나기 전조 시작, seated = 자리 복귀 완료, skipped = 늦어져 취소 ──
  | { t: number; type: 'tour'; actor: string; stage: 'stand' | 'seated' | 'skipped'; index: number; npc?: string; icon?: string; lineKey?: string; sfx?: readonly string[] }
  // ── T-145 ──
  /** 순회 목적지에서 복귀 전조 시작(endTell) */
  | { t: number; type: 'tourEndTell'; npc: string; lineKey?: string; sfx?: readonly string[] }
  /** 미션 세부 단계(사운드·연출): printStart·printPause·printResume·printGrab·cupReady·cupPicked·cafeMiss·parcelPicked·trayExposed */
  | { t: number; type: 'missionStage'; id: string; stage: string }
  | { t: number; type: 'couponStamp'; total: number };

/** 미션 런타임 상태 */
export interface MissionRuntime {
  readonly def: MissionDef;
  state: MissionState;
  /** 시작(자리를 뜬 순간) 시각(floor.time). null = 아직 */
  startedAt: number | null;
  /** 잠김 사유(회의 중) */
  blocked: boolean;
  /** 변형 조건 판정용 기록(T-144·T-145 MissionRunStats). 시작 시점에 생김 */
  run?: { susAtStart: number; seenSec: number; seenSecBy: Record<string, number>; noise: number; cover: Set<number>; closeCalls: number; tlAway: boolean };
  /** 원격 출력 작업(remote_start_fetch) */
  job?: PrintJob;
}

export interface DaySimOptions {
  /** 화면 밖 판정용 화면 배치(HUD가 가리는 행). 표시 설정 — config/display.ts의 값을 넘긴다 */
  readonly view: CameraView;
  /** 출근 준비 화면에서 CEO 순시 패스(보상형 광고)를 받음(D-027): 순시 없음, 눈도장 없음 */
  readonly skipCeoVisit?: boolean;
  /** 이미 본 튜토리얼 문구 키(재방문 생략, GDD §13). 이 키의 hint 이벤트는 다시 나오지 않음 */
  readonly seenHints?: Iterable<string>;
}

/** 직업 표시용 단계: 지금 플레이어 상태(의심 상승률 선택에 씀) */
export type PlayerPosture = 'moving' | 'still' | 'seated' | 'activity' | 'paused' | 'safe' | 'talked' | 'lobby';

/** 데이터에 없는 튜토리얼 id → 트리거: tut_<미션 id> = start:<미션 id>, tut_tour = tourStand(T-145) */
function tutorialTrigger(id: string): string | undefined {
  if (TUTORIAL_ON[id]) return TUTORIAL_ON[id];
  if (id === 'tut_tour') return 'tourStand';
  return id.startsWith('tut_') ? `start:${id.slice(4)}` : undefined;
}

const TUTORIAL_ON: Readonly<Record<string, string>> = {
  // tutorialId → 트리거 이름 (트리거가 오면 tutorial.<id> 문구를 한 번 띄움)
  tut_tap_move: 'dayStart',
  tut_work: 'firstSeatedWork',
  tut_coffee: 'start:coffee',
  tut_restroom: 'start:restroom',
  tut_nap: 'start:nap',
  tut_shopping: 'start:shopping',
  tut_snack: 'start:snack',
  tut_leave: 'leaveStart',
  tut_gate: 'gateStart',
  tut_hr: 'int:INT-05',
  tut_gossip: 'int:INT-04',
  tut_meeting: 'int:INT-08',
  tut_badge: 'int:INT-06',
  tut_snitch: 'int:INT-03',
  tut_accomplice: 'offer',
  tut_director: 'int:INT-10',
  tut_ceo: 'ceoTell',
  tut_ceo_2: 'ceoTalk',
  tut_ceo_elevator: 'int:INT-11',
};

/** 공범 망보기 헛기침 대상(상사) */
const BOSS_ROLE = 'boss';

interface TourState { next: number; npc: PatrolNpc | null; index: number; route: BossTourDef['routes'][number]; endTellShown: Set<number>; cutShort?: boolean }

export class DaySim {
  readonly content: DayContent;
  readonly floor: FloorSim;
  phase: DayPhase = 'intro';
  /** 현재 단계 경과(초) */
  phaseTime = 0;
  /** 근무 구간 경과(초) */
  dayTime = 0;
  /** 퇴근 단계 경과(초) */
  leaveTime = 0;
  work = 0;
  points = 0;
  snackStock: number;
  readonly missions: MissionRuntime[];
  /** 진행 중인 미션 행동 */
  activity: Activity | null = null;
  activeMission: MissionRuntime | null = null;
  /** 지금 행동 중인 미션 정의(HUD 문구) */
  get activeMissionDef(): MissionDef | null { return this.activeMission?.def ?? null; }
  /** 칩으로 고른 미션(도착하면 시작) */
  pendingMission: MissionRuntime | null = null;
  leaveStage: LeaveStage = 'pack';
  packProgress = 0;
  packPaused = false;
  gateAttempts = 0;
  /** 게이트 막대 위치(0~1) */
  gateMarker = 0;
  gateOpen = false;
  elevatorLeft = 0;
  result: DayResult | null = null;
  /** 인사팀 근태 점검 카운트다운(초). null = 없음 */
  hrCountdown: number | null = null;
  /** 정의로운 동료 보고 달리기 진행 중 */
  reportActive = false;

  private events: DayEvent[] = [];
  private acc = 0;
  private leftSeatAt: number | null = null;
  private wasAtSeat = true;
  private gateTime = 0;
  private hintsShown = new Set<string>();
  private intState = new Map<string, { started: number; count: number; lastAt: number }>();
  /**
   * 말걸기 성립 횟수(방해 id별, 하루 단위). BUG-007: 순찰 등장(intState)과 분리한다.
   * walker_talk(INT-06)은 등장이 intState를 1로 만들어 maxPerDay 1이면 말걸기가 영영 막혔다
   */
  private talkState = new Map<string, { count: number; lastAt: number }>();
  private scriptDone = new Set<number>();
  private snitchDwell = 0;
  private reportWait = 0;
  private reportCancelled = false;
  private hrChecked = false;
  private caughtBy: string | null = null;
  private seatedWorkSeen = false;

  // ── 대표님 순시(INT-09) ──
  ceoState: CeoVisitState = 'none';
  /** 진행 중인 인사 QTE(순시·엘리베이터 공용). 표시용 */
  qte: GreetQte | null = null;
  qteSource: 'ceo' | 'elevator' | null = null;
  eyeContact = false;
  /** 대표님 대화 구간(점수 ×slackMultiplier, 팀장·본부장 시선 OFF) */
  ceoTalkWindow = false;
  private ceoNpc: PatrolNpc | null = null;
  private ceoTimer = 0;
  private ceoGain = 0;
  private ceoQteOk = false;
  private frozenAll = false;
  private wasMovingInFreeze = false;
  private ceoStarted = false;
  // ── 엘리베이터 대표님(INT-11) ──
  elevatorCeo: ElevatorCeoState = 'none';
  private elevNpc: PatrolNpc | null = null;
  // ── 공범(INT-12) ──
  /** 지금 떠 있는 공범 제안(말풍선 탭 = acceptOffer) */
  offer: { missionId: string; left: number; forced: boolean; textKey: string } | null = null;
  follower: Follower | null = null;
  private joinedMission: MissionRuntime | null = null;
  private offered = new Set<string>();
  /** 공범 제안 기준으로 확정된 미션(T-136 ①) */
  private committed = new Set<string>();
  private coughed = new Set<PatrolNpc>();
  // ── 위계 연쇄 H1·H2 ──
  private greetState: 'idle' | 'greeting' | 'returning' = 'idle';
  private greetTimer = 0;
  // ── 스크립트·연출 ──
  private slowMoLeft = 0;
  private slowMoScale = 1;
  private scriptCount = new Map<number, number>();
  // ── 팀장 순회(D-075, T-144·T-145) ──
  private tours = new Map<BossTourDef, TourState>();
  /** 오늘 받은 카페 쿠폰 도장 */
  couponStamps = 0;
  private coverSet = new Set<number>();
  // ── 이어하기(D-050) ──
  continued = false;
  private endedFrom: { phase: DayPhase; leaveStage: LeaveStage } | null = null;

  constructor(content: DayContent, opts: DaySimOptions, seed: string = content.seed) {
    this.content = content;
    this.floor = new FloorSim(content.floor, seed, {
      camera: { rules: content.camera, view: opts.view },
      autoEscape: false,
      hooks: {
        playerRate: (base) => this.playerRate(base),
        gazeAllowed: (npc) => this.gazeAllowed(npc),
        talkAllowed: (npc) => this.talkAllowed(npc),
        settleExempt: () => this.atGateWaiting(),
        blockedForPlayer: (x, y) => this.gateBlocked(x, y),
        onNpcEnded: (npc) => this.onNpcEnded(npc),
        npcFrozen: (npc) => this.frozenAll && npc !== this.ceoNpc,
        extraGaze: () => this.followerGaze(),
      },
    });
    for (const b of content.background) this.floor.addNpc(b.npc);
    if (content.ceoVisit) this.ceoState = opts.skipCeoVisit ? 'skipped' : 'pending';
    if (opts.seenHints) for (const k of opts.seenHints) this.hintsShown.add(k);
    this.snackStock = content.scoring.snackStockStart;
    this.missions = content.missions.map((def) => ({ def, state: 'locked' as MissionState, startedAt: null, blocked: false }));
    for (const c of content.coverSpots) this.coverSet.add(c.y * this.floor.map.width + c.x);
    this.push({ t: 0, type: 'phase', phase: 'intro' });
  }

  // ── 공개 상태 ─────────────────────────────────────────

  get time(): number { return this.floor.time; }
  get suspicion(): number { return this.floor.suspicion.value; }

  /** 게임 시계(분, 0시 기준) */
  get clockMin(): number {
    const c = this.content.clock;
    if (this.phase === 'intro') return c.startMin;
    if (this.phase === 'day') return c.startMin + (Math.min(this.dayTime, this.content.dayPhaseSec) / this.content.dayPhaseSec) * (c.dayEndMin - c.startMin);
    return c.leaveStartMin + this.leaveTime * c.leaveMinPerSec;
  }

  get playerAtSeat(): boolean {
    const t = this.floor.player.tile, s = this.content.playerSeat;
    return t.x === s.x && t.y === s.y;
  }

  /** 자리에서 일하는 중(업무 게이지가 차는 상태) */
  get seatedWorking(): boolean {
    return this.phase === 'day' && this.playerAtSeat && this.floor.playerStill && this.activity === null && this.floor.player.mode !== 'talked';
  }

  get posture(): PlayerPosture {
    const p = this.floor.player;
    if (this.gateOpen && this.content.leave.safeAfterGate) return 'lobby';
    if (p.mode === 'talked') return 'talked';
    if (this.activity) return this.activity.posture;
    if (this.phase === 'leave' && this.leaveStage === 'pack' && this.playerAtSeat && this.floor.playerStill) return this.packPaused ? 'paused' : 'activity';
    if (this.seatedWorking) return 'seated';
    return p.mode === 'moving' ? 'moving' : 'still';
  }

  /** 가방을 들고 있는가(퇴근 단계에서 가방을 챙긴 뒤) */
  get carryingBag(): boolean { return this.phase === 'leave' && this.leaveStage !== 'pack'; }

  activityView(): ActivityView | null { return this.activity ? this.activity.view() : null; }

  missionsDone(): number { return this.missions.filter((m) => m.state === 'done').length; }

  drainEvents(): DayEvent[] { const e = this.events; this.events = []; return e; }

  /** 표시 시간 배율(튜토리얼 슬로모 days.scripted slowMo, 첫 순시 전조 slowMoTell). 씬이 advance(dt × timeScale)로 쓴다. 판정 무관 */
  get timeScale(): number { return this.slowMoLeft > 0 ? this.slowMoScale : 1; }

  /** 근무 구간 시계가 멈춰 있는가(대표님 순시 ①~⑤) */
  get clockPaused(): boolean {
    return this.ceoState === 'tell' || this.ceoState === 'freeze' || this.ceoState === 'qte' || this.ceoState === 'talk';
  }

  /** 대표님 얼음(전조~퇴장 후 복귀 전): 하위 상사·NPC 정지 */
  get frozen(): boolean { return this.frozenAll; }

  /** 지금 대표님이 층에 있는가(표시용) */
  get ceoOnFloor(): PatrolNpc | null { return this.ceoNpc ?? this.elevNpc; }

  get qteActive(): boolean { return this.qte !== null && this.qte.phase !== 'done'; }

  /** QTE 누름(씬: pointerdown). 헤드리스는 tapQte() */
  pressQte(): void {
    if (!this.qteActive) return;
    const r = this.qte!.press();
    if (r) this.resolveQte(r);
  }

  /** QTE 뗌(씬: pointerup, 실제 누른 시간) */
  releaseQte(pressSec: number): void {
    if (!this.qteActive) return;
    const r = this.qte!.release(pressSec);
    if (r) this.resolveQte(r);
  }

  /** 짧은 탭 한 번(QA 봇용) */
  tapQte(pressSec = 0.1): void { this.pressQte(); this.releaseQte(pressSec); }

  /** 공범 제안 수락(말풍선 탭 — HUD 입력이라 화면 탭으로 치지 않음) */
  acceptOffer(): boolean {
    const o = this.offer;
    const acc = this.content.accomplice;
    if (!o || !acc || this.phase !== 'day' || this.frozenAll) return false;
    const m = this.missions.find((x) => x.def.id === o.missionId);
    const seat = this.floor.findNpc((n) => n.def.actorId === 'accomplice' && !!n.def.seated);
    this.offer = null;
    this.push({ t: this.time, type: 'offerEnd', missionId: o.missionId, accepted: !!(m && seat) });
    if (!m || !seat || m.state === 'done' || m.state === 'failed') return false;
    const start = tileOf(seat);
    this.floor.removeNpc(seat);
    this.follower = new Follower(start, this.floor.player.tile, this.floor.map, acc.followGapTiles, acc.speedTilesPerSec);
    this.joinedMission = m;
    // T-136 ①: accompliceEffect는 수락 순간 적용. 이미 시작했지만 확정 전인 활동(간식 첫 입 전)은 효과를 넣어 다시 만든다
    if (this.activeMission === m && this.activity && !this.committed.has(m.def.id)) this.activity = this.makeActivity(m);
    this.push({ t: this.time, type: 'accomplice', action: 'join' });
    this.push({ t: this.time, type: 'toast', key: 'npc.accomplice.accept' });
    return true;
  }

  /** 이어하기 가능 상태(적발로 끝났고 이 판에서 아직 안 씀). 광고 가능 여부·하루 횟수는 광고 계층이 판단 */
  get canContinue(): boolean {
    return this.phase === 'ended' && this.result?.outcome === 'caught' && !this.continued && !!this.endedFrom;
  }

  /**
   * 이어하기(D-050 ⑤: 보상 수령 시에만 호출). 의심 rules.continueAd 값으로 자리(퇴근 중 가방을 챙긴 뒤면 게이트 앞)에서 재개.
   * 진행 중이던 미션은 다시 열림(제한 시간 초기화), 대표님 순시는 종료(눈도장 없음).
   */
  continueFromCheckpoint(): boolean {
    const c = this.content;
    const cont = c.continueAd;
    if (!this.canContinue || !this.endedFrom || !cont) return false;
    const from = this.endedFrom;
    const atGate = from.phase === 'leave' && from.leaveStage !== 'pack';
    const tile = atGate ? c.leave.gate.spot : c.playerSeat;
    this.floor.revive();
    this.floor.suspicion.value = cont.resumeSuspicion;
    this.floor.player.teleport(tile);
    this.floor.camera?.snap(this.floor.player.y);
    for (const n of this.floor.npcs) if (n.mode === 'talk' || n.mode === 'tell' || n.mode === 'look') n.interruptLook(this.floor.rng);
    if (this.activeMission) { this.activeMission.state = 'open'; this.activeMission.startedAt = null; delete this.activeMission.run; }
    for (const m of this.missions) if (m.state === 'carry' || m.state === 'active') { m.state = 'open'; m.startedAt = null; delete m.run; }
    this.activity = null; this.activeMission = null; this.pendingMission = null;
    this.dismissAccomplice();
    this.endCeoVisit(false);
    this.qte = null; this.qteSource = null;
    this.phase = from.phase;
    this.phaseTime = 0;
    if (atGate) { this.leaveStage = 'walk'; this.gateTime = 0; }
    else if (from.phase === 'leave') this.leaveStage = 'pack';
    this.wasAtSeat = !atGate;
    this.result = null;
    this.caughtBy = null;
    this.continued = true;
    this.endedFrom = null;
    this.push({ t: this.time, type: 'continued' });
    this.push({ t: this.time, type: 'phase', phase: this.phase });
    return true;
  }

  // ── 입력 ─────────────────────────────────────────────

  tapWorld(tx: number, ty: number, pressSec?: number): string {
    if (this.phase === 'intro' || this.phase === 'ended' || this.floor.outcome !== 'playing') return 'ignored';
    if (this.qteActive) { this.tapQte(pressSec ?? 0.1); return 'qte'; }
    const p = this.floor.player;
    if (p.mode === 'talked') return this.floor.tap(tx, ty);
    if (this.activity && this.activeMission) {
      const fx = emptyEffects();
      const ctx = pressSec !== undefined ? { ...this.activityCtx(), pressSec } : this.activityCtx();
      if (this.commitRule(this.activeMission) === 'first_input') this.commitMission(this.activeMission);
      const st = this.activity.tap(ctx, fx);
      this.applyEffects(fx);
      this.resolveActivity(st);
      return 'mission';
    }
    if (this.phase === 'leave') {
      if (this.leaveStage === 'pack' && this.playerAtSeat && this.floor.playerStill && this.content.leave.packTapPauses) {
        const self = tx === p.tile.x && ty === p.tile.y;
        // 자리 근처 탭 = 가방 멈춤/재개, 다른 곳 탭 = 이동(가방은 자리에서만 챙김)
        if (self || Math.abs(tx - p.tile.x) + Math.abs(ty - p.tile.y) <= 1) { this.packPaused = !this.packPaused; return 'pack'; }
      }
      if (this.leaveStage === 'gate') { this.gateTap(); return 'gate'; }
      if (this.leaveStage === 'elevator' || this.leaveStage === 'done') return 'ignored';
    }
    return this.floor.tap(tx, ty);
  }

  /** HUD 미션 칩 */
  tapMission(id: string): boolean {
    if (this.phase !== 'day' || this.activity) return false;
    const m = this.missions.find((x) => x.def.id === id);
    if (!m) return false;
    if (m.state === 'carry') return this.floor.moveTo(this.content.playerSeat);
    if (m.state !== 'open' || m.blocked) return false;
    this.pendingMission = m;
    this.maybeOffer(m);
    this.routeHintFor(m);
    if (m.def.startsAt === 'chip_tap_at_seat' || (m.def.mechanic === 'remote_start_fetch' && !m.job)) {
      if (this.playerAtSeat && this.floor.player.mode !== 'moving') { this.startActivity(m); return true; }
      return this.floor.moveTo(this.content.playerSeat);
    }
    if (!this.playerAtSeat && m.startedAt === null) m.startedAt = this.leftSeatAt ?? this.time;
    const t = m.def.spot;
    const here = this.floor.player.tile;
    if (here.x === t.x && here.y === t.y && this.floor.player.mode !== 'moving') { this.startActivity(m); return true; }
    return this.floor.moveTo(t);
  }

  // ── 진행 ─────────────────────────────────────────────

  advance(dtSec: number): void {
    const r = this.content.floor.rules;
    this.acc += Math.min(Math.max(0, dtSec), r.maxAdvanceSec);
    const h = r.fixedStepSec;
    while (this.acc >= h - 1e-9) {
      this.acc -= h;
      this.step();
    }
  }

  step(): void {
    if (this.phase === 'ended') return;
    const dt = this.content.floor.rules.fixedStepSec;
    this.phaseTime += dt;
    if (this.phase === 'intro') {
      if (this.phaseTime >= this.content.introSec) this.setPhase('day');
      return;
    }
    if (this.slowMoLeft > 0) this.slowMoLeft = Math.max(0, this.slowMoLeft - dt);
    if (this.phase === 'day') {
      this.ceoPreStep();
      if (!this.clockPaused) {
        this.dayTime += dt;
        this.unlockMissions();
        this.runScheduledInterrupts();
        this.runScripted();
        if (this.dayTime >= this.content.dayPhaseSec) this.startLeave();
      } else {
        // 시계 정지(①~⑤): 미션 제한 시간도 멈춤
        for (const m of this.missions) if (m.startedAt !== null) m.startedAt += dt;
      }
      // T-139 bosses.ceo.visit.missionTimersPausedWhileFrozen: 얼음 표시 중(⑥ 퇴장 포함) 내내 미션 제한 시간 정지(근무 시계는 그대로)
      if (!this.clockPaused && this.frozenAll && this.content.ceoVisit?.missionTimersPausedWhileFrozen) {
        for (const m of this.missions) if (m.startedAt !== null) m.startedAt += dt;
      }
    } else this.leaveTime += dt;

    const s0 = this.floor.suspicion.value;
    const wasMoving = this.floor.player.mode === 'moving';
    this.floor.step();
    this.collectFloorEvents();
    if (this.floor.outcome === 'caught') { this.end('caught'); return; }

    this.trackSeat();
    if (this.phase === 'day') this.dayAfterStep(dt);
    else if (this.phase === 'leave') this.leaveAfterStep(dt);
    if ((this.phase as DayPhase) === 'ended') return;
    this.afterInterrupts(dt);
    this.ceoPostStep(dt, wasMoving);
    this.elevatorCeoStep();
    this.accompliceStep(dt);
    this.greetingStep(dt);
    this.tourStep();
    this.scriptWatchers();
    if (this.ceoState !== 'none' && this.ceoState !== 'pending' && this.ceoState !== 'skipped' && this.ceoState !== 'done' && this.ceoState !== 'cancelled') {
      this.ceoGain += Math.max(0, this.floor.suspicion.value - s0);
    }
    if (this.floor.suspicion.value >= this.content.floor.rules.suspicion.max && this.caughtBy === null) {
      if (this.ceoState === 'freeze' || this.ceoState === 'qte' || this.ceoState === 'tell') this.caughtBy = 'ceo';
    }
    // 즉시 가산(미션 실패·보고·게이트 삐빅 등)으로 100%가 된 경우
    if ((this.phase as DayPhase) !== 'ended' && this.floor.suspicion.value >= this.content.floor.rules.suspicion.max) this.end('caught');
  }

  // ── FloorSim 훅 ──────────────────────────────────────

  private playerRate(base: number): number {
    // 공범 합류 중: 둘이라 더 눈에 띔(npcs.accomplice.effects.suspicionGainMultiplier)
    const k = this.follower ? (this.content.accomplice?.suspicionGainMultiplier ?? 1) : 1;
    return this.postureRate(base) * k * this.carryMul();
  }

  /** 들고 돌아오는 중(택배 상자·출력물·컵, carry 변형) 이동 의심 배율(params.carryMovingMul, 여럿이면 최댓값) */
  private carryMul(): number {
    if (this.floor.player.mode !== 'moving') return 1;
    let k = 1;
    for (const m of this.missions) if (m.state === 'carry' && typeof m.def.params['carryMovingMul'] === 'number') k = Math.max(k, m.def.params['carryMovingMul'] as number);
    return k;
  }

  /** 지금 들고 있는 소품(표시용): params.carryProp */
  carryProp(): string | null {
    for (const m of this.missions) if (m.state === 'carry' && typeof m.def.params['carryProp'] === 'string') return m.def.params['carryProp'] as string;
    return null;
  }

  /** 출력 중인 작업이 있는가(sfx_printer_run 루프) */
  get printing(): boolean { return this.missions.some((m) => !!m.job?.printing && m.state !== 'failed' && m.state !== 'done'); }

  private postureRate(base: number): number {
    const s = this.content.floor.rules.suspicion;
    switch (this.posture) {
      case 'lobby': return 0;
      case 'seated': return s.seatedWorkingPerSec ?? base;
      case 'activity': return (s.activityPerSec ?? s.movingPerSec) * (this.activity?.activityScale ?? 1);
      case 'paused': return s.activityPausedPerSec ?? base;
      case 'safe': return 0;
      default: return base;
    }
  }

  private gazeAllowed(npc: PatrolNpc): boolean {
    if (this.gateOpen && this.content.leave.safeAfterGate) return false;
    // 얼음 중 대표님 시선은 전역 규칙(ceoPostStep)이 대신함. 대화 구간 팀장·본부장 OFF(H5)는 얼음이 덮음
    if (npc === this.ceoNpc && (this.ceoState === 'tell' || this.ceoState === 'freeze' || this.ceoState === 'qte')) return false;
    const actor = npc.def.actorId;
    if (actor && this.content.ambientActors.includes(actor)) return false;
    return true;
  }

  private talkAllowed(npc: PatrolNpc): boolean {
    const actor = npc.def.actorId ? this.content.actors[npc.def.actorId] : undefined;
    const intId = actor?.talkEnabledBy;
    if (!intId) return false;
    const phase = this.phase === 'leave' ? 'leave' : 'day';
    const int = this.content.interrupts.find((i) => i.id === intId && i.phase === phase);
    if (!int) return false;
    if (this.activity) return false;
    if (this.gateOpen) return false;
    if (this.frozenAll || this.qteActive) return false;
    if (actor.talkOnlyWhilePlayerAway && this.playerAtSeat) return false;
    const cond = actor.talkOnlyWhen ?? (typeof int.triggerDef['condition'] === 'string' ? int.triggerDef['condition'] as string : undefined);
    // BUG-011: 조건 이름의 '1800'은 데이터 식별자일 뿐이고 기준 시각은 항상 rules.day.earlyLeaveBefore(데이터)
    const early = cond !== undefined ? EARLY_LEAVE_CONDS[cond] : undefined;
    if (early === 'leave' && !(this.phase === 'leave' && this.clockMin < this.content.clock.earlyLeaveBeforeMin)) return false;
    if (early === 'any' && !(this.clockMin < this.content.clock.earlyLeaveBeforeMin)) return false;
    const st = this.talkState.get(intId);
    if (st && st.count >= int.maxPerDay) return false;
    if (st && this.time - st.lastAt < int.cooldownSec) return false;
    return true;
  }

  /** BUG-012(§19-3 ③): 퇴근 중 게이트 사용 칸에 멈춰 있음 = 위장(안착 시간 없음). 정체 규칙은 그대로 */
  private atGateWaiting(): boolean {
    const L = this.content.leave;
    if (this.phase !== 'leave' || !L.gate.waitingCountsAsDisguised || this.gateOpen) return false;
    if (this.leaveStage !== 'walk' && this.leaveStage !== 'gate') return false;
    const t = this.floor.player.tile, g = L.gate.spot;
    return t.x === g.x && t.y === g.y;
  }

  private gateBlocked(x: number, y: number): boolean {
    if (this.gateOpen) return false;
    const m = this.floor.map;
    return x >= 0 && y >= 0 && x < m.width && y < m.height && m.gateOnly[y * m.width + x] === 1;
  }

  private onNpcEnded(npc: PatrolNpc): NpcDef | null {
    const next = npc.def.thenPatrol;
    if (next) {
      // 순회 복귀(T-145): '<앉은 순찰>#after_tour' = 앉은 순찰 + 첫 돌아보기 정상 전조
      const [base, tag] = next.split('#');
      const def = this.content.patrols[base!];
      if (def) return tag === 'after_tour' ? { ...def, plainFirstLook: true } : def;
    }
    return null;
  }

  /** 점수 가산(대표님 대화 구간 ×slackMultiplier, GDD §6-3) */
  private addPoints(n: number): void {
    const k = this.ceoTalkWindow ? (this.content.ceoVisit?.talkSlackMultiplier ?? 1) : 1;
    this.points += n * k;
  }

  // ── 단계 ─────────────────────────────────────────────

  private setPhase(p: DayPhase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.push({ t: this.time, type: 'phase', phase: p });
    if (p === 'day') this.tutorial('dayStart');
  }

  private startLeave(): void {
    // 진행 중인 미션은 중단(벌점 없음, 미완료로 남음)
    if (this.activeMission) { this.activeMission.state = 'failed'; this.activeMission = null; this.activity = null; }
    for (const m of this.missions) if (m.state === 'carry' || m.state === 'active') m.state = 'failed';
    this.pendingMission = null;
    this.offer = null;
    this.dismissAccomplice();
    // D-070 INT-05.effect.cancelOnLeaveStart: 퇴근이 시작되면 근태 점검 카운트다운·점검 취소(인사팀은 그대로 퇴장 동선)
    const hr = this.content.interrupts.find((i) => i.category === 'countdown');
    if (hr && hr.effect['cancelOnLeaveStart'] === true && (this.hrCountdown !== null || !this.hrChecked)) {
      if (this.hrCountdown !== null) this.push({ t: this.time, type: 'interrupt', id: hr.id, textKey: '' });
      this.hrCountdown = null;
      this.hrChecked = true;
    }
    if (this.ceoState === 'pending') { this.ceoState = 'cancelled'; this.push({ t: this.time, type: 'ceo', stage: 'cancelled' }); }
    else if (this.ceoState === 'exit' || this.ceoState === 'resume') this.endCeoVisit(true);
    this.setPhase('leave');
    this.leaveStage = 'pack';
    this.push({ t: this.time, type: 'leaveStage', stage: 'pack' });
    this.push({ t: this.time, type: 'toast', key: 'hud.leave_start' });
    this.tutorial('leaveStart');
    if (!this.playerAtSeat) this.floor.moveTo(this.content.playerSeat); // ifAwayWalkToSeatFirst
    // 퇴근 방해: on_leave_start 트리거
    for (const int of this.content.interrupts) {
      if (int.phase !== 'leave') continue;
      const lt = int.triggerDef['leaveTrigger'];
      if (lt === 'on_leave_start') this.startInterrupt(int);
    }
  }

  private end(outcome: DayOutcome): void {
    if (this.phase === 'ended') return;
    this.endedFrom = { phase: this.phase, leaveStage: this.leaveStage };
    const c = this.content;
    const peak = this.floor.suspicion.peak;
    const done = this.missionsDone();
    let stars = 0;
    let outc = outcome;
    let titleKey = 'result.title_caught';
    if (outcome === 'leave' || outcome === 'leave_short') {
      if (this.work < c.work.quota) { outc = 'overtime'; stars = 1; titleKey = 'result.title_overtime'; }
      else if (done < c.missionsRequired) { outc = 'leave_short'; stars = 1; titleKey = 'result.title_leave_short'; }
      else { stars = peak < c.scoring.star3PeakBelow ? 3 : 2; titleKey = 'result.title_leave'; }
    } else if (outcome === 'overtime') { stars = 1; titleKey = 'result.title_overtime'; }
    if (outcome === 'caught') this.floor.finish('caught');
    else this.floor.finish('escaped');
    const mul = c.scoring.starMultiplier[stars] ?? 0;
    const points = Math.floor(this.points);
    const salary = Math.round(c.scoring.salaryBase * mul) + Math.floor(points / c.scoring.slackPointsPerWon);
    const by = this.caughtBy;
    let reaction = outcome === 'caught' && by ? (c.actors[by]?.reactionKeys[0] ?? null)
      : outcome === 'overtime' ? 'react.leave.overtime' : null;
    if (outcome === 'caught' && this.follower && c.accomplice?.reactionKey) reaction = c.accomplice.reactionKey;
    const ceoVisit: DayResult['ceoVisit'] = this.ceoState === 'none' ? 'none' : this.ceoState === 'skipped' ? 'skipped'
      : this.ceoState === 'cancelled' || this.ceoState === 'pending' ? 'cancelled' : 'done';
    this.result = {
      outcome: outc, stars, titleKey, peakSuspicion: peak, work: this.work, quota: c.work.quota,
      missionsDone: done, missionsTotal: this.missions.length, missionsRequired: c.missionsRequired,
      slackPoints: points, salary, timeSec: this.content.introSec + this.time, clockMin: this.clockMin, caughtBy: by, reactionKey: reaction,
      continued: this.continued, eyeContact: this.eyeContact, ceoVisit,
      ...(this.couponStamps > 0 ? { couponStamps: this.couponStamps } : {}),
    };
    this.phase = 'ended';
    this.push({ t: this.time, type: 'phase', phase: 'ended' });
    this.push({ t: this.time, type: 'result', result: this.result });
  }

  // ── 근무 구간 ─────────────────────────────────────────

  private unlockMissions(): void {
    for (const m of this.missions) {
      if (m.state === 'locked' && this.dayTime >= m.def.unlockAtSec) {
        m.state = 'open';
        this.push({ t: this.time, type: 'missionUnlocked', id: m.def.id });
      }
      // 회의 중 잠김(INT-08 blocksMissions)
      m.blocked = this.missionBlocked(m.def.id);
    }
  }

  private missionBlocked(id: string): boolean {
    const m = this.missions.find((x) => x.def.id === id);
    // during_tour(availability while_actor_away): 시작 전에는 그 사람이 순회 중일 때만 칩이 켜짐
    if (m && m.def.availability?.type === 'while_actor_away' && m.startedAt === null && m.state !== 'active' && !this.actorAway(m.def.availability.actorId)) return true;
    // 순회 목적지 locksMissions(회의 중 낮잠): 회의실로 가는 중~회의 끝 전조까지
    for (const lk of this.tourLocks()) if (lk.includes(id)) return true;
    for (const int of this.content.interrupts) {
      const bm = int.effect['blocksMissions'];
      if (!Array.isArray(bm) || !bm.includes(id)) continue;
      const pid = int.effect['patrolId'];
      if (typeof pid === 'string' && this.floor.npcs.some((n) => n.def.patrolId === pid)) return true;
    }
    return false;
  }

  private trackSeat(): void {
    const at = this.playerAtSeat;
    if (this.wasAtSeat && !at) {
      this.leftSeatAt = this.time;
      if (this.pendingMission && this.pendingMission.startedAt === null && this.pendingMission.def.awayFromDesk) this.pendingMission.startedAt = this.time;
    }
    this.wasAtSeat = at;
  }

  private dayAfterStep(dt: number): void {
    const c = this.content;
    // 업무 게이지
    if (this.seatedWorking) {
      this.work = Math.min(c.work.max, this.work + c.work.fillPerSec * dt);
      if (!this.seatedWorkSeen && this.dayTime > 1) { this.seatedWorkSeen = true; this.tutorial('firstSeatedWork'); }
    }
    const p = this.floor.player;
    // 미션 행동 진행
    if (this.activity && this.activeMission) {
      if (p.mode !== 'talked') {
        const fx = emptyEffects();
        const st = this.activity.tick(dt, this.activityCtx(), fx);
        this.applyEffects(fx);
        this.resolveActivity(st);
      }
    } else if (p.mode === 'idle') {
      // 도착 → 행동 시작 (칩으로 고른 미션, 또는 열린 미션 장소를 직접 탭해 도착)
      const here = p.tile;
      const cand = this.pendingMission && this.matchesSpot(this.pendingMission, here) ? this.pendingMission
        : this.missions.find((m) => m.state === 'open' && !m.blocked && m.def.startsAt === 'arrive_spot' && !(m.def.mechanic === 'remote_start_fetch' && !m.job) && this.matchesSpot(m, here));
      if (cand && cand.state === 'open' && !cand.blocked) this.startActivity(cand);
    }
    // 들고 돌아오기 → 자리 도착하면 완료
    for (const m of this.missions) {
      if (m.state === 'carry' && this.playerAtSeat && this.floor.playerStill) this.completeMission(m);
    }
    // 변형 조건 기록(T-144·T-145): 시작 후 의심 증가·시선 시간(액터별 = 화면 안 콘)·밟은 엄폐 칸
    const pt = this.floor.player.tile;
    const onCover = this.coverSet.has(pt.y * this.floor.map.width + pt.x);
    for (const m of this.missions) {
      if (m.startedAt === null || m.state === 'done' || m.state === 'failed' || m.state === 'locked') continue;
      if (!m.run) { this.ensureRun(m); continue; }
      if (this.floor.gazeNow > 0) m.run.seenSec += dt;
      this.floor.npcs.forEach((n, i) => {
        const a = n.def.actorId;
        if (a && n.coneActive && this.floor.isOnScreen(n) && seesPlayer(this.floor, n)) m.run!.seenSecBy[a] = (m.run!.seenSecBy[a] ?? 0) + dt;
        void i;
      });
      if (onCover) m.run.cover.add(pt.y * this.floor.map.width + pt.x);
    }
    // 원격 출력 진행 + 쟁반 노출(다 나온 종이가 trayExposeSec 넘게 있는데 지정 인물이 반경 안이면 들킴)
    for (const m of this.missions) {
      const j = m.job;
      if (!j || m.state === 'done' || m.state === 'failed') continue;
      const wasDone = j.done;
      j.step(dt, this.time);
      if (!wasDone && j.done) this.push({ t: this.time, type: 'missionStage', id: m.def.id, stage: 'printDone' });
      const p = m.def.params;
      if (j.doneAt !== null && !j.grabbed && this.time - j.doneAt > (typeof p['trayExposeSec'] === 'number' ? p['trayExposeSec'] as number : 6)) {
        const by = Array.isArray(p['trayExposedBy']) ? (p['trayExposedBy'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const r = typeof p['trayExposedRadiusTiles'] === 'number' ? p['trayExposedRadiusTiles'] as number : 2;
        const sp = m.def.spot;
        const near = this.floor.npcs.some((n) => !!n.def.actorId && by.includes(n.def.actorId) && Math.hypot(n.x - (sp.x + 0.5), n.y - (sp.y + 0.5)) <= r);
        if (near) {
          this.push({ t: this.time, type: 'missionStage', id: m.def.id, stage: 'trayExposed' });
          const pen = typeof p['trayExposedPenalty'] === 'number' ? p['trayExposedPenalty'] as number : m.def.failPenalty;
          if (this.activeMission === m) { this.activity = null; this.activeMission = null; }
          m.state = 'failed';
          if (this.pendingMission === m) this.pendingMission = null;
          if (pen > 0) addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, pen);
          this.push({ t: this.time, type: 'missionFail', id: m.def.id, reason: 'fail' });
        }
      }
    }
    // 제한 시간
    for (const m of this.missions) {
      if ((m.state === 'active' || m.state === 'carry' || (m.state === 'open' && (m === this.pendingMission || !!m.job))) && m.startedAt !== null
        && this.time - m.startedAt > m.def.timeLimitSec) this.failMission(m, 'timeout');
    }
  }

  private matchesSpot(m: MissionRuntime, t: Tile): boolean {
    const atSeat = m.def.startsAt === 'chip_tap_at_seat' || (m.def.mechanic === 'remote_start_fetch' && !m.job);
    const s = atSeat ? this.content.playerSeat : m.def.spot;
    return s.x === t.x && s.y === t.y;
  }

  private activityCtx(): { seen: boolean; elapsed: number } {
    return { seen: this.floor.gazeNow > 0, elapsed: this.activeMission?.startedAt !== null && this.activeMission ? this.time - (this.activeMission.startedAt ?? this.time) : 0 };
  }

  private startActivity(m: MissionRuntime): void {
    this.floor.player.halt();
    m.state = 'active';
    if (m.startedAt === null) m.startedAt = this.time;
    this.activeMission = m;
    this.pendingMission = null;
    this.activity = this.makeActivity(m);
    this.ensureRun(m);
    this.push({ t: this.time, type: 'missionStart', id: m.def.id });
    if (this.commitRule(m) === 'activity_start') this.commitMission(m);
    this.tutorial(`start:${m.def.id}`);
    if (m.def.mechanic === 'trip_safe_zone') this.fireTrigger('restroom_inside_rest_start');
  }

  /** 미션 행동 생성. 공범 합류 미션이면 accompliceEffect(커피 cupsRequired 덮어쓰기, 간식 한 입 수 배율) 적용 */
  private makeActivity(m: MissionRuntime): ReturnType<typeof createActivity> {
    if (m.def.mechanic === 'remote_start_fetch' && m.job) return createGrabActivity(m.job, m.def.params);
    const fx = m === this.joinedMission ? m.def.accompliceEffect : undefined;
    if (!fx) return createActivity(m.def.mechanic, m.def.params);
    const params = fx.cupsRequired !== undefined ? { ...m.def.params, cupsRequired: fx.cupsRequired } : m.def.params;
    return createActivity(m.def.mechanic, params, fx.bitesRequiredMultiplier !== undefined ? { snackBiteMul: fx.bitesRequiredMultiplier } : {});
  }

  /** 공범 제안 기준 '미션 확정' 시점(npcs.accomplice.offer.missionCommit) */
  private commitRule(m: MissionRuntime): 'activity_start' | 'first_input' {
    const mc = this.content.accomplice?.missionCommit;
    if (!mc) return 'activity_start';
    return m.def.awayFromDesk ? mc.awayFromDesk : mc.atDesk;
  }

  /** 미션 확정: 이 미션에 걸린 제안은 끝(endsAtMissionCommit — forced 포함, 일반은 offerSec와 먼저 오는 쪽) */
  private commitMission(m: MissionRuntime): void {
    if (this.committed.has(m.def.id)) return;
    this.committed.add(m.def.id);
    if (this.offer && this.offer.missionId === m.def.id && this.content.accomplice?.endsAtMissionCommit) {
      this.push({ t: this.time, type: 'offerEnd', missionId: m.def.id, accepted: false });
      this.offer = null;
    }
  }

  private applyEffects(fx: ActivityEffects): void {
    const NOISE = ['snackNoise', 'coffeeOverflow', 'cafeMiss'];
    if ((fx.noise || (fx.event && NOISE.includes(fx.event))) && this.activeMission?.run) this.activeMission.run.noise++;
    if (fx.event && this.activeMission && ['printPause', 'printResume', 'printGrab', 'cupReady', 'cupPicked', 'cafeMiss', 'parcelPicked', 'snackNoise', 'coffeeOverflow'].includes(fx.event)) {
      this.push({ t: this.time, type: 'missionStage', id: this.activeMission.def.id, stage: fx.event });
    }
    if (fx.suspicion !== 0) addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, fx.suspicion);
    if (fx.points !== 0) this.addPoints(fx.points);
    if (fx.toastKey) this.push({ t: this.time, type: 'toast', key: fx.toastKey });
    if (fx.noise) {
      const p = this.floor.player.pos;
      for (const n of this.floor.npcs) {
        if (n.def.seated && fx.noise.radius > 0 && Math.hypot(n.x - p.x, n.y - p.y) <= fx.noise.radius) n.shortenIdle(fx.noise.idleTo);
      }
    }
  }

  private resolveActivity(st: 'running' | 'success' | 'fail'): void {
    const m = this.activeMission;
    if (!m || st === 'running') return;
    this.activity = null;
    this.activeMission = null;
    if (st === 'fail') { this.failMission(m, 'fail'); return; }
    if (m.def.mechanic === 'remote_start_fetch' && !m.job) {
      // 자리에서 출력 시작 → 프린터로(출력은 걷는 동안에도 진행)
      const p = m.def.params;
      m.job = new PrintJob(Math.max(1, Math.round(typeof p['pagesRequired'] === 'number' ? p['pagesRequired'] as number : 4)), typeof p['secPerPage'] === 'number' ? p['secPerPage'] as number : 0.7);
      m.state = 'open';
      this.pendingMission = m;
      this.push({ t: this.time, type: 'missionStage', id: m.def.id, stage: 'printStart' });
      this.floor.moveTo(m.def.spot);
      return;
    }
    this.push({ t: this.time, type: 'missionSuccess', id: m.def.id });
    if (m.def.completeAt === 'return_to_seat') m.state = 'carry';
    else this.completeMission(m);
  }

  private completeMission(m: MissionRuntime): void {
    // 변형 조건(T-144): 충족한 변형의 rewardMul을 곱하고, onFail 'fail' 조건을 놓치면 실패 처리
    let modMul = 1;
    let bonus: string[] = [];
    if (m.def.modifiers && m.def.modifiers.length > 0) {
      const r = evaluateMissionConditions(m.def, {
        elapsedSec: m.startedAt !== null ? this.time - m.startedAt : 0,
        suspicionGain: Math.max(0, this.floor.suspicion.value - (m.run?.susAtStart ?? this.floor.suspicion.value)),
        seenSec: m.run?.seenSec ?? 0,
        timeLimitSec: m.def.timeLimitSec,
        seenSecBy: m.run?.seenSecBy ?? {},
        noiseCount: m.run?.noise ?? 0,
        coverTilesVisited: m.run?.cover.size ?? 0,
        closeCalls: m.run?.closeCalls ?? 0,
        startState: { tlAway: m.run?.tlAway ?? false },
        completedAtClock: this.clockMin,
      });
      if (r.fail) { this.failMission(m, 'fail'); return; }
      modMul = r.rewardMul;
      bonus = r.met;
    }
    m.state = 'done';
    const mul = (m === this.joinedMission ? (this.content.accomplice?.rewardMultiplier ?? 1) : 1) * modMul;
    this.addPoints(m.def.reward.slackPoints * mul);
    if (m.def.reward.snackStock) this.snackStock = Math.min(this.content.scoring.snackStockMax, this.snackStock + m.def.reward.snackStock);
    // 창가: 성공 시 의심 감소 / 카페: 쿠폰 도장(결정적, 성공 1회 = 1)
    if (m.def.reward.suspicionRelief) addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, -m.def.reward.suspicionRelief);
    if (m.def.reward.couponStamp) { this.couponStamps += m.def.reward.couponStamp; this.push({ t: this.time, type: 'couponStamp', total: this.couponStamps }); }
    this.push(bonus.length > 0
      ? { t: this.time, type: 'missionDone', id: m.def.id, points: m.def.reward.slackPoints * mul, bonus }
      : { t: this.time, type: 'missionDone', id: m.def.id, points: m.def.reward.slackPoints * mul });
    if (m === this.joinedMission) this.dismissAccomplice();
  }

  private failMission(m: MissionRuntime, reason: 'fail' | 'timeout'): void {
    if (this.activeMission === m) { this.activity = null; this.activeMission = null; }
    if (this.pendingMission === m) this.pendingMission = null;
    m.state = 'failed';
    if (m === this.joinedMission) this.dismissAccomplice();
    if (this.offer?.missionId === m.def.id) this.offer = null;
    const pen = reason === 'fail' ? m.def.failPenalty : m.def.timeoutPenalty;
    if (pen > 0) addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, pen);
    this.push({ t: this.time, type: 'missionFail', id: m.def.id, reason });
  }

  // ── 퇴근 ─────────────────────────────────────────────

  private leaveAfterStep(dt: number): void {
    const c = this.content, L = c.leave;
    const p = this.floor.player;
    if (this.clockMin >= c.clock.overtimeAtMin && this.leaveStage !== 'elevator') { this.end('overtime'); return; }
    switch (this.leaveStage) {
      case 'pack':
        if (this.playerAtSeat && this.floor.playerStill && p.mode !== 'talked' && !this.packPaused) {
          this.packProgress += dt;
          if (this.packProgress >= L.packSec) this.setLeaveStage('walk');
        }
        break;
      case 'walk': {
        const t = p.tile, g = L.gate.spot;
        if (p.mode === 'idle' && t.x === g.x && t.y === g.y) { this.setLeaveStage('gate'); this.gateTime = 0; this.tutorial('gateStart'); }
        break;
      }
      case 'gate': {
        const t = p.tile, g = L.gate.spot;
        if (t.x !== g.x || t.y !== g.y) { this.setLeaveStage('walk'); break; }
        this.gateTime += dt;
        const ph = (this.gateTime / L.gate.markerCycleSec) % 1;
        this.gateMarker = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        break;
      }
      case 'lobby': {
        const t = p.tile;
        if (zoneAt(this.floor.map, t.x, t.y) === c.floor.level.exitZone && p.mode !== 'moving') {
          this.setLeaveStage('elevator');
          const [a, b] = L.elevatorWaitSecRange;
          this.elevatorLeft = a === b ? a : this.floor.rng.range(a, b);
        }
        break;
      }
      case 'elevator':
        if (this.content.ceoElevator && this.elevatorCeo === 'none') this.startElevatorCeo();
        if (this.elevatorCeo === 'tell' || this.elevatorCeo === 'qte') break; // 대표님 인사가 끝날 때까지 엘리베이터 대기
        this.elevatorLeft -= dt;
        if (this.elevatorLeft <= 0) {
          this.addPoints(L.reward);
          if (this.clockMin < c.clock.earlyLeaveBeforeMin) { this.addPoints(L.earlyLeaveBonusPoints); this.push({ t: this.time, type: 'toast', key: 'event.leave.early_bonus' }); }
          this.setLeaveStage('done');
          this.end('leave');
        }
        break;
      case 'done':
        break;
    }
  }

  private setLeaveStage(s: LeaveStage): void {
    this.leaveStage = s;
    this.push({ t: this.time, type: 'leaveStage', stage: s });
  }

  /** 게이트 막대 창(배율 반영) */
  get gateWindow(): number {
    const g = this.content.leave.gate;
    return Math.min(1, g.windowRatio * (this.gateAttempts < g.firstTryAttempts ? g.firstTryWindowScale : 1));
  }

  private gateTap(): void {
    const g = this.content.leave.gate;
    const hit = Math.abs(this.gateMarker - (g.windowCenter ?? 0.5)) <= this.gateWindow / 2;
    this.gateAttempts++;
    if (hit) {
      this.gateOpen = true;
      this.push({ t: this.time, type: 'gate', result: 'pass' });
      this.setLeaveStage('lobby');
      this.floor.moveTo(this.content.leave.exitSpot);
      return;
    }
    this.push({ t: this.time, type: 'gate', result: 'fail' });
    addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, g.beepSuspicion);
    if (g.beepAttractsGuardLook) {
      const guard = this.floor.findNpc((n) => n.def.actorId === g.guardActorId);
      if (guard) {
        const p = this.floor.player.pos;
        guard.forceLook(Math.atan2(p.y - guard.y, p.x - guard.x), this.floor.rng, { tellSec: guard.def.tellSec, lookSec: guard.def.lookSec });
      }
    }
    if (this.gateAttempts >= g.maxAttempts) this.end('overtime');
    this.gateTime = 0;
  }

  // ── 방해 이벤트 ───────────────────────────────────────

  private runScheduledInterrupts(): void {
    for (const int of this.content.interrupts) {
      if (int.phase !== 'day' || int.atSec <= 0) continue;
      if (this.intState.has(int.id)) continue;
      if (this.dayTime < int.atSec) continue;
      // H7 반대 방향(T-136 ④): 대표님이 층에 있는 동안(전조~퇴장 디스폰) 본부장 등장은 디스폰 뒤로 미룸
      if (this.content.h7?.directorStartWaitsWhileCeoOnFloor && this.ceoPresent && this.interruptSpawns(int, 'director')) continue;
      this.startInterrupt(int);
    }
  }

  /** 대표님 순시 NPC가 층에 있음(전조 시작 ~ 퇴장 디스폰) */
  private get ceoPresent(): boolean {
    return !!this.ceoNpc && this.floor.npcs.includes(this.ceoNpc);
  }

  /** 이 방해가 등장시키는 순찰의 액터 중 actorId가 있는가 */
  private interruptSpawns(int: DayInterruptDef, actorId: string): boolean {
    const e = int.effect;
    const ids: string[] = [];
    for (const k of ['patrolId', 'leaveVariant']) if (typeof e[k] === 'string') ids.push(e[k] as string);
    for (const k of ['patrolVariants', 'patrolIds']) if (Array.isArray(e[k])) for (const x of e[k] as unknown[]) if (typeof x === 'string') ids.push(x);
    return ids.some((id) => this.content.patrols[id]?.actorId === actorId);
  }

  /** 하루 계획의 trigger 이름(예: restroom_inside_rest_start)으로 시작하는 방해 */
  private fireTrigger(name: string): void {
    for (const int of this.content.interrupts) {
      if (int.phase === (this.phase === 'leave' ? 'leave' : 'day') && int.trigger === name && !this.intState.has(int.id)) this.startInterrupt(int);
    }
  }

  private noteInterrupt(id: string): void {
    const st = this.intState.get(id) ?? { started: this.time, count: 0, lastAt: -Infinity };
    st.count++;
    st.lastAt = this.time;
    this.intState.set(id, st);
  }

  private noteTalk(id: string): void {
    const st = this.talkState.get(id) ?? { count: 0, lastAt: -Infinity };
    st.count++;
    st.lastAt = this.time;
    this.talkState.set(id, st);
  }

  /** 오늘 말걸기 성립 횟수(QA·표시용) */
  talkCount(interruptId: string): number { return this.talkState.get(interruptId)?.count ?? 0; }

  private startInterrupt(int: DayInterruptDef): void {
    const pat = this.content.patrols;
    const e = int.effect;
    let started = true;
    switch (int.category) {
      case 'walker':
      case 'walker_talk': {
        const variants = Array.isArray(e['patrolVariants']) ? e['patrolVariants'] as string[] : [];
        const id = int.phase === 'leave' && typeof e['leaveVariant'] === 'string' ? e['leaveVariant'] as string
          : typeof e['patrolId'] === 'string' ? e['patrolId'] as string : this.floor.rng.pick(variants);
        const def = id ? pat[id] : undefined;
        if (def) this.floor.addNpc(def); else started = false;
        break;
      }
      case 'walker_opportunity': {
        const id = e['patrolId'];
        const def = typeof id === 'string' ? pat[id] : undefined;
        const actor = def?.actorId;
        const cur = actor ? this.floor.findNpc((n) => n.def.actorId === actor && !!n.def.seated) : undefined;
        if (def && cur) {
          let d = def;
          if (int.phase === 'leave' && typeof e['leaveStartsAt'] === 'string') d = sliceFromStop(def, e['leaveStartsAt'] as string, numOr(e['leaveStopWaitSec'], numOr(e['letoutTellSec'], 1)));
          this.floor.replaceNpc(cur, d);
        } else started = false;
        break;
      }
      case 'countdown': {
        const id = e['patrolId'];
        const def = typeof id === 'string' ? pat[id] : undefined;
        if (!def) { started = false; break; }
        this.floor.addNpc(def);
        this.hrChecked = false;
        this.hrCountdown = Math.max(numOr(e['countdownMinSec'], 0), etaToStop(def, 'stop_inspect', this.floor));
        break;
      }
      case 'block': {
        const ids = Array.isArray(e['patrolIds']) ? e['patrolIds'] as string[] : [];
        let any = false;
        for (const id of ids) {
          let def = pat[id];
          if (!def) continue;
          if (int.phase === 'leave' && e['leavePrePositioned']) def = sliceFromStop(def, numStr(e['leaveStartsAt']) || 'stop_gossip', numOr(e['leaveBlockSec'], def.waypoints[1]?.waitSec ?? 4), true);
          const cur = this.floor.findNpc((n) => n.def.actorId === def!.actorId && !!n.def.seated);
          if (cur) this.floor.replaceNpc(cur, def); else this.floor.addNpc(def);
          any = true;
        }
        started = any;
        break;
      }
      case 'report_run': {
        const id = e['patrolId'];
        const def = typeof id === 'string' ? pat[id] : undefined;
        const cur = this.floor.findNpc((n) => n.def.actorId === 'snitch' && !!n.def.seated);
        if (def && cur) { this.floor.replaceNpc(cur, def); this.reportActive = true; this.reportWait = 0; this.reportCancelled = false; this.push({ t: this.time, type: 'report', result: 'start' }); }
        else started = false;
        break;
      }
      case 'talk_stop':
        started = false; // 근접형: 말걸기 훅이 처리(talkAllowed)
        break;
      default:
        // freeze(INT-09)·qte(INT-11)·assist(INT-12)는 일정 시각 방해가 아니라 전용 런타임이 처리(ceoPreStep·startElevatorCeo·maybeOffer)
        started = false;
    }
    if (!this.intState.has(int.id)) this.intState.set(int.id, { started: this.time, count: 0, lastAt: -Infinity });
    if (started) {
      this.noteInterrupt(int.id);
      const ev: DayEvent = int.tell.textKey ? { t: this.time, type: 'interrupt', id: int.id, textKey: int.tell.textKey } : { t: this.time, type: 'interrupt', id: int.id };
      this.push(ev);
      this.tutorial(`int:${int.id}`);
      this.scriptHint('interrupt_hint', int.id);
    }
  }

  private afterInterrupts(dt: number): void {
    const p = this.floor.player;
    // 인사팀 근태 점검(INT-05): 점검 지점 도착 시 자리에 없으면 가산
    if (this.hrCountdown !== null) {
      this.hrCountdown = Math.max(0, this.hrCountdown - dt);
      const hr = this.floor.findNpc((n) => n.def.patrolId === 'p_hr_attendance');
      if (!hr) this.hrCountdown = null;
      else if (!this.hrChecked && hr.stopId === 'stop_inspect' && hr.mode !== 'walk' && hr.mode !== 'spawn') {
        this.hrChecked = true;
        this.hrCountdown = null;
        const int = this.content.interrupts.find((i) => i.category === 'countdown');
        if (!this.playerAtSeat && int) {
          addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, numOr(int.effect['absentSuspicion'], 0));
          this.push({ t: this.time, type: 'hrAbsent' });
          this.caughtBy = this.floor.suspicion.value >= 1 ? 'hr_inspector' : this.caughtBy;
        }
      }
    }
    // 정의로운 동료 발견 → 보고 달리기(INT-03)
    const rep = this.content.interrupts.find((i) => i.category === 'report_run' && i.phase === (this.phase === 'leave' ? 'leave' : 'day'));
    if (rep && !this.reportActive) {
      const st = this.intState.get(rep.id);
      const snitch = this.floor.findNpc((n) => n.def.actorId === 'snitch' && !!n.def.seated);
      const actor = this.content.actors['snitch'];
      const states = actor?.spot?.triggerStates ?? [];
      const posture = this.posture;
      const trig = (posture === 'activity' && states.includes('activity')) || (this.carryingBag && states.includes('leaving_with_bag'));
      const sees = snitch && snitch.coneActive && this.floor.isOnScreen(snitch) && seesPlayer(this.floor, snitch);
      if (sees && trig && (!st || st.count < rep.maxPerDay)) {
        this.snitchDwell += dt;
        if (this.snitchDwell >= (actor?.spot?.dwellSec ?? 0.4)) { this.snitchDwell = 0; this.startInterrupt(rep); }
      } else this.snitchDwell = 0;
    }
    if (this.reportActive && rep) {
      const run = this.floor.findNpc((n) => n.def.patrolId === numStr(rep.effect['patrolId']));
      if (!run) { this.reportActive = false; return; }
      // 몸으로 막기: 간식이 있으면 옆에 서서 나눠 주기
      if (!this.reportCancelled && run.mode === 'walk' && this.snackStock > 0 && Math.hypot(run.x - p.x, run.y - p.y) <= 1.1) {
        this.snackStock--;
        this.reportCancelled = true;
        this.push({ t: this.time, type: 'report', result: 'blocked' });
        this.push({ t: this.time, type: 'toast', key: 'npc.snitch.snack_thanks' });
      }
      if (run.mode === 'hold') {
        const tl = this.floor.findNpc((n) => n.def.actorId === 'team_lead');
        const busy = !tl || !tl.def.seated || tl.mode === 'phone' || tl.mode === 'talk' || tl.suppressed;
        if (this.reportCancelled) { run.release(); this.reportActive = false; return; }
        if (busy) {
          this.reportWait += dt;
          if (this.reportWait >= numOr(rep.effect['waitIfReceiverSuppressedMaxSec'], 8)) {
            this.push({ t: this.time, type: 'report', result: 'giveUp' });
            this.push({ t: this.time, type: 'toast', key: 'npc.snitch.give_up' });
            run.release(); this.reportActive = false;
          }
          return;
        }
        if (this.playerAtSeat && this.floor.playerStill && this.activity === null) {
          this.push({ t: this.time, type: 'report', result: 'doubt' });
          this.push({ t: this.time, type: 'toast', key: 'react.snitch.doubt' });
        } else {
          this.push({ t: this.time, type: 'report', result: 'arrive' });
          addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, numOr(rep.effect['arrivalSuspicion'], 0));
          const fl = rep.effect['forcedLook'] as Record<string, unknown> | undefined;
          if (tl && fl) {
            const pp = this.floor.player.pos;
            const o: { tellSec: number; lookSec: number; coneRange?: number } = { tellSec: numOr(fl['tellSec'], 0.5), lookSec: numOr(fl['lookSec'], 2.5) };
            if (typeof fl['coneRange'] === 'number') o.coneRange = fl['coneRange'];
            tl.forceLook(Math.atan2(pp.y - tl.y, pp.x - tl.x), this.floor.rng, o);
          }
          if (this.floor.suspicion.value >= 1) this.caughtBy = 'snitch';
        }
        run.release();
        this.reportActive = false;
      }
    }
    // 퇴근: 구역 진입 트리거(INT-06, INT-10)
    if (this.phase === 'leave') {
      const t = p.tile;
      const z = zoneAt(this.floor.map, t.x, t.y);
      for (const int of this.content.interrupts) {
        if (int.phase !== 'leave' || this.intState.has(int.id)) continue;
        if (int.triggerDef['leaveTrigger'] === 'player_enters_zone' && inZone(this.content, int.triggerDef['leaveZone'], t, z)) this.startInterrupt(int);
      }
    }
  }

  // ── 스크립트(튜토리얼 연출) ─────────────────────────────

  private runScripted(): void {
    this.content.scripted.forEach((b, i) => {
      if (this.scriptDone.has(i)) return;
      const at = typeof b['atSec'] === 'number' ? b['atSec'] as number : null;
      if (at === null || this.dayTime < at) return;
      if (b.type === 'boss_look') {
        const npc = this.floor.findNpc((n) => n.def.actorId === b['actor']);
        if (!npc) { this.scriptDone.add(i); return; }
        const wp = npc.def.waypoints[0];
        const dir = wp?.lookDirs?.[0] ?? 'down';
        const ang = dir === 'down' ? Math.PI / 2 : dir === 'up' ? -Math.PI / 2 : dir === 'left' ? Math.PI : 0;
        const o: { tellSec: number; lookSec: number; gazeScale?: number } = { tellSec: numOr(b['tellSec'], npc.def.tellSec), lookSec: npc.def.lookSec };
        if (typeof b['gazeMultiplierScale'] === 'number') o.gazeScale = b['gazeMultiplierScale'] as number;
        if (npc.forceLook(ang, this.floor.rng, o)) {
          this.scriptDone.add(i);
          if (typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
          this.slowMo(b['slowMo'], o.tellSec);
        }
      } else if (b.type === 'boss_opportunity' && b['opportunity'] === 'phone_call') {
        const npc = this.floor.findNpc((n) => n.def.actorId === b['actor']);
        if (npc && npc.mode === 'wait') { npc.startPhone(numOr(b['durationSec'], 3)); this.scriptDone.add(i); }
      } else this.scriptDone.add(i);
    });
  }

  /** 조건형 스크립트(atSec 없음): 매 스텝 조건 검사, maxTimes까지 */
  private scriptWatchers(): void {
    const c = this.content, f = this.floor, p = f.player;
    c.scripted.forEach((b, i) => {
      const used = this.scriptCount.get(i) ?? 0;
      const max = typeof b['maxTimes'] === 'number' ? b['maxTimes'] as number : 1;
      if (used >= max) return;
      const fire = () => this.scriptCount.set(i, used + 1);
      switch (b.type) {
        case 'boss_look_when': {
          // day1: 걷는 중 선배가 돌아볼 방향의 콘이 나를 덮을 수 있으면 스크립트 시선(전조 tellSec, 상승 배율, 슬로모)
          if (this.phase !== 'day' || b['condition'] !== 'player_moving_in_cone_path' || p.mode !== 'moving') return;
          const npc = f.findNpc((n) => n.def.actorId === b['actor']);
          if (!npc || npc.mode !== 'wait' || f.hooks.npcFrozen?.(npc)) return;
          const dir: Dir = npc.def.waypoints[0]?.lookDirs?.[0] ?? 'down';
          if (!canSee(f.map, npc.pos, DIR_ANGLE[dir], npc.cone, p.pos)) return;
          const o: { tellSec: number; lookSec: number; gazeScale?: number } = { tellSec: numOr(b['tellSec'], npc.def.tellSec), lookSec: npc.def.lookSec };
          if (typeof b['gazeMultiplierScale'] === 'number') o.gazeScale = b['gazeMultiplierScale'] as number;
          if (npc.forceLook(DIR_ANGLE[dir], f.rng, o)) {
            fire();
            if (typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
            this.slowMo(b['slowMo'], o.tellSec);
          }
          return;
        }
        case 'offscreen_demo': {
          if (b['when'] !== 'player_in_zone') return;
          const z = zoneAt(f.map, p.tile.x, p.tile.y);
          if (!inZone(c, b['zone'], p.tile, z)) return;
          const npc = f.findNpc((n) => n.def.actorId === b['actor']);
          if (!npc || f.isOnScreen(npc)) return;
          fire();
          if (typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
          this.push({ t: this.time, type: 'offscreenDemo', actor: numStr(b['actor']), sec: 2.5 });
          return;
        }
        case 'snitch_spot': {
          // day8: 첫 행동 중 반드시 발견(시선 체류 없이), 없으면 fallbackAtSec에 발견
          if (this.phase !== 'day' || this.reportActive || this.frozenAll) return;
          const rep = c.interrupts.find((x) => x.category === 'report_run' && x.phase === 'day');
          if (!rep) { fire(); return; }
          const trig = this.posture === 'activity' || (typeof b['fallbackAtSec'] === 'number' && this.dayTime >= (b['fallbackAtSec'] as number));
          if (!trig) return;
          fire();
          if (typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
          this.startInterrupt(rep);
          return;
        }
        default: return;
      }
    });
  }

  /** day3 cover_hint: 전조가 시작될 때 엄폐 칸 radiusTiles 안이면 안내 */
  private coverHintOnTell(npcId: string): void {
    const c = this.content;
    const npc = this.floor.findNpc((n) => n.def.id === npcId);
    if (!npc || npc.gazeMultiplier <= 0 || npc.tellKind === 'talk') return;
    c.scripted.forEach((b, i) => {
      if (b.type !== 'cover_hint' || b['when'] !== 'tell_starts_near_cover') return;
      const used = this.scriptCount.get(i) ?? 0;
      if (used >= numOr(b['maxTimes'], 1)) return;
      const r = numOr(b['radiusTiles'], 3);
      const t = this.floor.player.tile;
      if (!c.coverSpots.some((cs) => Math.abs(cs.x - t.x) + Math.abs(cs.y - t.y) <= r)) return;
      this.scriptCount.set(i, used + 1);
      if (typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
    });
  }

  /** day2 route_hint: 미션 칩을 누르면 지름길(주의)과 우회로(힌트)를 점선으로 보여 줌(maps.playerRoutes via) */
  private routeHintFor(m: MissionRuntime): void {
    const c = this.content;
    c.scripted.forEach((b, i) => {
      if (b.type !== 'route_hint' || b['missionId'] !== m.def.id || this.scriptCount.has(i)) return;
      this.scriptCount.set(i, 1);
      const goal = m.def.startsAt === 'chip_tap_at_seat' ? c.playerSeat : m.def.spot;
      const ids = Array.isArray(b['showRoutes']) ? (b['showRoutes'] as unknown[]).map(String) : [];
      const routes: { id: string; kind: 'hint' | 'caution'; tiles: Tile[] }[] = [];
      for (const id of ids) {
        const r = c.routes?.find((x) => x.id === id);
        const pts: Tile[] = [this.floor.player.tile, ...(r?.via ?? []), goal];
        const tiles: Tile[] = [];
        let ok = true;
        for (let k = 0; k < pts.length - 1 && ok; k++) {
          const seg = findPath(this.floor.map, pts[k]!, pts[k + 1]!, this.floor.blockedForPlayer);
          if (!seg) ok = false; else tiles.push(...seg);
        }
        if (ok) routes.push({ id, kind: (r?.via.length ?? 0) === 0 ? 'caution' : 'hint', tiles });
      }
      if (typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
      if (routes.length > 0) this.push({ t: this.time, type: 'routeHint', routes, sec: 4 });
    });
  }

  private slowMo(scale: unknown, sec: number): void {
    if (typeof scale !== 'number' || scale <= 0 || scale >= 1) return;
    this.slowMoScale = scale;
    this.slowMoLeft = sec;
  }

  // ── 대표님 순시(INT-09, bosses.ceo.visit, GDD §8-3) ─────────────────

  /** 시작 판정: 예정 시각 이후 '내가 자리에 앉아 있는 첫 순간'. H7: 본부장이 층에 있으면 기다림 */
  private ceoPreStep(): void {
    const v = this.content.ceoVisit;
    if (!v || this.ceoState !== 'pending' || this.dayTime < v.atSec) return;
    const p = this.floor.player;
    if (!this.playerAtSeat || p.mode === 'moving' || p.mode === 'talked' || this.reportActive) return;
    if (this.content.h7?.ceoStartWaitsWhileDirectorOnFloor !== false && this.floor.findNpc((n) => n.def.actorId === 'director')) return;
    // leadRoaming.conflicts: 순시 시작 조건에 '팀장이 자리에 앉아 있음' 추가(순회 중이면 복귀까지 대기)
    if (this.content.bossTours?.some((t) => t.ceoWaitsForSeat && this.actorAway(t.actorId))) return;
    const def = this.content.patrols[v.patrolId];
    if (!def) { this.ceoState = 'cancelled'; return; }
    this.ceoNpc = this.floor.addNpc(def);
    this.frozenAll = true;
    this.ceoStarted = true;
    this.ceoGain = 0;
    this.ceoQteOk = false;
    this.ceoTimer = 0;
    this.setCeo('tell');
    const int = this.content.interrupts.find((x) => x.id === 'INT-09');
    this.push(v.tellTextKey ? { t: this.time, type: 'interrupt', id: 'INT-09', textKey: v.tellTextKey } : { t: this.time, type: 'interrupt', id: 'INT-09' });
    void int;
    this.tutorial('ceoTell');
    if (v.slowMoTell > 0 && v.slowMoTell < 1) this.slowMo(v.slowMoTell, v.tellSec);
    // 대화 중이던 사람·미션 제안 정리
    this.offer = null;
  }

  private setCeo(st: CeoVisitState): void {
    this.ceoState = st;
    this.ceoTimer = 0;
    this.push({ t: this.time, type: 'ceo', stage: st });
  }

  private ceoPostStep(dt: number, wasMoving: boolean): void {
    const v = this.content.ceoVisit;
    if (!v) return;
    const st = this.ceoState;
    if (st === 'none' || st === 'pending' || st === 'skipped' || st === 'done' || st === 'cancelled') return;
    this.ceoTimer += dt;
    const npc = this.ceoNpc && this.floor.npcs.includes(this.ceoNpc) ? this.ceoNpc : null;
    switch (st) {
      case 'tell':
        if (npc && npc.mode !== 'spawn') { this.setCeo('freeze'); this.wasMovingInFreeze = wasMoving; }
        break;
      case 'freeze': {
        // 얼음 전역 규칙: 움직이기 시작하는 순간 +moveStartInstant, 이동·행동 중 movingPerSec × 대표님 배율
        const sr = this.content.floor.rules.suspicion;
        const moving = this.floor.player.mode === 'moving';
        if (moving && !this.wasMovingInFreeze) addSuspicion(this.floor.suspicion, sr, v.moveStartInstantSuspicion);
        this.wasMovingInFreeze = moving;
        const pos = this.posture;
        if (pos === 'moving' || pos === 'activity') addSuspicion(this.floor.suspicion, sr, sr.movingPerSec * v.freezeGazeMultiplier * dt);
        const atGreet = npc && npc.mode === 'hold' && npc.stopId === v.greetStop;
        if (atGreet || !npc || this.ceoTimer >= v.freezeMaxSec + 3) this.startCeoQte(); // freezeMaxSec 초과는 경로 지연 안전장치
        break;
      }
      case 'qte':
        this.stepQte(dt);
        break;
      case 'talk': {
        // 대화 구간: 대화 지점 도착 ~ 떠날 때. 시계는 대표님이 대화 지점을 떠날 때까지 멈춤
        const atTalk = !!npc && npc.stopId === v.talkStop && npc.mode !== 'walk';
        if (atTalk && !this.ceoTalkWindow) { this.ceoTalkWindow = true; this.tutorial('ceoTalk'); }
        if (!npc || (this.ceoTalkWindow && !atTalk)) { this.ceoTalkWindow = false; this.setCeo('exit'); }
        break;
      }
      case 'exit':
        if (!npc) { this.ceoNpc = null; this.setCeo('resume'); }
        break;
      case 'resume':
        if (this.ceoTimer >= v.exitResumeDelaySec) this.endCeoVisit(true);
        break;
      default: break;
    }
  }

  private startCeoQte(): void {
    const v = this.content.ceoVisit!;
    this.setCeo('qte');
    this.qte = new GreetQte(v.qte, this.floor.rng, v.qteWindowScale);
    this.qteSource = 'ceo';
    this.push({ t: this.time, type: 'qte', source: 'ceo', stage: 'precue' });
  }

  private stepQte(dt: number): void {
    const q = this.qte;
    if (!q || q.phase === 'done') return;
    const before = q.phase;
    const r = q.step(dt);
    if (before === 'precue' && q.phase === 'window') this.push({ t: this.time, type: 'qte', source: this.qteSource ?? 'ceo', stage: 'cue' });
    if (r) this.resolveQte(r);
  }

  private resolveQte(r: QteResult): void {
    const q = this.qte;
    const src = this.qteSource;
    if (!q || !src) return;
    this.push({ t: this.time, type: 'qte', source: src, stage: 'result', result: r });
    const sr = this.content.floor.rules.suspicion;
    if (src === 'ceo') {
      const v = this.content.ceoVisit!;
      const pen = q.penaltyOf(r);
      if (pen > 0) addSuspicion(this.floor.suspicion, sr, pen);
      this.ceoQteOk = r === 'success';
      const npc = this.ceoNpc;
      if (npc) {
        const key = r === 'success' ? 'boss.ceo.talk' : r === 'early' ? v.reactionEarly : r === 'long' ? v.reactionLong : 'boss.ceo.question';
        if (key) this.push({ t: this.time, type: 'say', npc: npc.def.id, key, sec: 1.6 });
        npc.release();
      }
      if (this.floor.suspicion.value >= sr.max) this.caughtBy = 'ceo';
      this.setCeo('talk');
    } else {
      const e = this.content.ceoElevator!;
      const npc = this.elevNpc;
      if (r === 'success') this.addPoints(e.successPoints);
      else {
        // 실패해도 적발로는 이어지지 않음(INT-11 _designNote): 상한 바로 아래까지만
        const room = Math.max(0, sr.max - this.floor.suspicion.value - 1e-6);
        addSuspicion(this.floor.suspicion, sr, Math.min(e.failSuspicion, room));
      }
      const key = r === 'success' ? e.successLineKey : e.failLineKey;
      if (npc && key) this.push({ t: this.time, type: 'say', npc: npc.def.id, key, sec: 1.8 });
      npc?.release();
      this.elevatorCeo = 'done';
    }
    this.qte = null;
    this.qteSource = null;
  }

  /** 순시 종료: 하위 상사·NPC 복귀(다음 시선은 전조부터), 눈도장 판정 */
  private endCeoVisit(evaluate: boolean): void {
    if (!this.ceoStarted) return;
    const v = this.content.ceoVisit;
    if (this.ceoNpc && this.floor.npcs.includes(this.ceoNpc)) this.floor.removeNpc(this.ceoNpc);
    this.ceoNpc = null;
    if (this.frozenAll) {
      this.frozenAll = false;
      for (const n of this.floor.npcs) n.interruptLook(this.floor.rng);
    }
    this.ceoTalkWindow = false;
    if (this.qteSource === 'ceo') { this.qte = null; this.qteSource = null; }
    this.ceoStarted = false;
    if (evaluate && v) {
      const ok = this.ceoGain < v.survivalMaxGain && (!v.survivalRequiresQte || this.ceoQteOk);
      if (ok) {
        this.eyeContact = true;
        this.points += v.eyeContactPoints;
        this.push({ t: this.time, type: 'eyeContact', points: v.eyeContactPoints });
        this.push({ t: this.time, type: 'toast', key: 'boss.ceo.eye_contact' });
      }
    }
    this.ceoState = 'done';
    this.push({ t: this.time, type: 'ceo', stage: 'done' });
  }

  // ── 엘리베이터 대표님(INT-11) ─────────────────────────

  private startElevatorCeo(): void {
    const e = this.content.ceoElevator!;
    const def = this.content.patrols[e.patrolId];
    if (!def) { this.elevatorCeo = 'done'; return; }
    this.elevNpc = this.floor.addNpc(def);
    this.elevatorCeo = 'tell';
    this.push(e.tellTextKey ? { t: this.time, type: 'interrupt', id: 'INT-11', textKey: e.tellTextKey } : { t: this.time, type: 'interrupt', id: 'INT-11' });
    this.tutorial('int:INT-11');
  }

  private elevatorCeoStep(): void {
    if (this.elevatorCeo === 'none' || this.elevatorCeo === 'done') return;
    const npc = this.elevNpc;
    if (!npc || !this.floor.npcs.includes(npc)) { this.elevatorCeo = 'done'; return; }
    if (this.elevatorCeo === 'tell' && npc.mode === 'hold') {
      this.elevatorCeo = 'qte';
      this.qte = new GreetQte(this.content.ceoElevator!.qte, this.floor.rng, 1);
      this.qteSource = 'elevator';
      this.push({ t: this.time, type: 'qte', source: 'elevator', stage: 'precue' });
    } else if (this.elevatorCeo === 'qte') this.stepQte(this.content.floor.rules.fixedStepSec);
  }

  // ── 공범 동료(INT-12) ────────────────────────────────

  private maybeOffer(m: MissionRuntime): void {
    const acc = this.content.accomplice;
    if (!acc || this.offer || this.follower || this.offered.has(m.def.id) || this.frozenAll) return;
    const o = acc.offers.find((x) => x.eventId === m.def.id);
    if (!o) return;
    const seat = this.floor.findNpc((n) => n.def.actorId === 'accomplice' && !!n.def.seated);
    if (!seat || seat.mode === 'talk') return;
    this.offered.add(m.def.id);
    const textKey = acc.offerTextKeys[m.def.id] ?? 'npc.accomplice.offer';
    this.offer = { missionId: m.def.id, left: o.forced ? Infinity : acc.offerSec, forced: o.forced, textKey };
    this.push({ t: this.time, type: 'offer', missionId: m.def.id, textKey, forced: o.forced });
    this.push({ t: this.time, type: 'interrupt', id: 'INT-12' });
    this.tutorial('offer');
  }

  private accompliceStep(dt: number): void {
    const acc = this.content.accomplice;
    if (this.offer) {
      const m = this.missions.find((x) => x.def.id === this.offer!.missionId);
      this.offer.left -= dt;
      // 확정(commit)으로 끝나는 경우는 commitMission이 처리. endsAtMissionCommit가 없으면 T-133 동작(forced 원정 미션은 활동 시작에서 종료)
      const gone = !m || m.state === 'done' || m.state === 'failed'
        || (!acc?.endsAtMissionCommit && this.offer.forced && m.state === 'active' && m.def.awayFromDesk);
      if (this.offer.left <= 0 || gone || this.phase !== 'day') {
        this.push({ t: this.time, type: 'offerEnd', missionId: this.offer.missionId, accepted: false });
        this.offer = null;
      }
    }
    const f = this.follower;
    if (!f || !acc) return;
    f.step(dt, this.floor.player.pos, this.frozenAll);
    // 망보기: 반경 안 앉은 상사의 전조 lookoutCoughLeadSec 전에 헛기침
    const pp = this.floor.player.pos;
    for (const n of this.floor.npcs) {
      if (n.def.role !== BOSS_ROLE) continue;
      const left = n.upcomingTellSec;
      if (left === null) { this.coughed.delete(n); continue; }
      if (left <= acc.lookoutCoughLeadSec && !this.coughed.has(n) && Math.hypot(n.x - pp.x, n.y - pp.y) <= acc.lookoutRadiusTiles) {
        this.coughed.add(n);
        this.push({ t: this.time, type: 'accomplice', action: 'cough' });
      }
    }
  }

  /** 공범이 걸려도 나로 계산(hitboxIncludesAccomplice): 공범 위치를 보는 시선 배율 */
  private followerGaze(): number {
    const f = this.follower;
    if (!f || !this.content.accomplice?.hitboxIncludesAccomplice) return 0;
    let m = 0;
    for (const n of this.floor.npcs) if (n.gazeMultiplier > m && this.floor.npcSees(n, f.pos)) m = n.gazeMultiplier;
    return m;
  }

  /** 공범 복귀: 지금 위치에서 자리로 걸어가 앉음(시선·길막 없음) */
  private dismissAccomplice(): void {
    const f = this.follower, acc = this.content.accomplice;
    if (!f || !acc) { this.follower = null; this.joinedMission = null; return; }
    this.follower = null;
    this.joinedMission = null;
    const seatDef = this.content.patrols[acc.seatPatrolId];
    if (seatDef) {
      const seat = seatDef.waypoints[0]!;
      const from = tileOf(f.pos);
      const ok = !!findPath(this.floor.map, from, seat);
      const back: NpcDef = {
        ...seatDef, id: `${seatDef.id}_return`, patrolId: `${acc.seatPatrolId}_return`, seated: false, loop: false, coneOff: true, passable: true,
        speedTilesPerSec: acc.speedTilesPerSec, thenPatrol: acc.seatPatrolId,
        waypoints: [{ x: from.x, y: from.y, waitSec: 0 }, { x: seat.x, y: seat.y, waitSec: 0 }],
      };
      const { phone: _p, talk: _t, ...rest } = back;
      this.floor.addNpc(ok ? rest : seatDef);
    }
    this.push({ t: this.time, type: 'accomplice', action: 'leave' });
  }

  // ── 팀장 순회(D-075, T-144) ─────────────────────────────

  /** 지금 순회 중인 상사 NPC(표시·QA용) */
  touringNpcs(): PatrolNpc[] {
    const out: PatrolNpc[] = [];
    for (const st of this.tours.values()) if (st.npc && this.floor.npcs.includes(st.npc)) out.push(st.npc);
    return out;
  }

  /** 오늘 시작한 순회 횟수(actorId별, QA용) */
  tourCount(actorId: string): number {
    let n = 0;
    for (const [def, st] of this.tours) if (def.actorId === actorId) n += st.index;
    return n;
  }

  /** 퇴근 mustBeSeatedBeforeLeaveSec 전 복귀(leadRoaming.schedule.rule): 목적지 대기 중 남은 시간이 부족하면 체류를 끊고 바로 자리로 */
  private tourReturnEarly(def: BossTourDef, st: TourState): void {
    const npc = st.npc!;
    const must = def.mustBeSeatedBeforeLeaveSec;
    if (must === undefined || st.cutShort || this.phase !== 'day' || npc.mode !== 'wait' || npc.stopId === 'stop_tour_stand') return;
    const left = this.content.dayPhaseSec - this.dayTime;
    if (left > must + 25) return;
    const seatWp = npc.def.waypoints[npc.def.waypoints.length - 1]!;
    const here = tileOf(npc);
    const path = findPath(this.floor.map, here, { x: seatWp.x, y: seatWp.y });
    const ret = (path ? path.length - 1 : 0) / Math.max(0.1, npc.def.speedTilesPerSec) + 0.5;
    if (left > must + ret) return;
    const back: NpcDef = { ...npc.def, id: `${npc.def.id}_back`, waypoints: [{ x: here.x, y: here.y, waitSec: 0, lookChance: 0 }, seatWp] };
    try { st.npc = this.floor.replaceNpc(npc, back); st.cutShort = true; st.route = []; } catch { /* 경로 없음: 그대로 */ }
  }

  /** 미션 진행 기록 시작(T-145 MissionRunStats) */
  private ensureRun(m: MissionRuntime): void {
    if (m.run) return;
    m.run = { susAtStart: this.floor.suspicion.value, seenSec: 0, seenSecBy: {}, noise: 0, cover: new Set(), closeCalls: 0, tlAway: this.actorAway('team_lead') };
  }

  /** 이 액터가 지금 순회 중(자리 비움)인가 */
  actorAway(actorId: string): boolean {
    for (const [def, st] of this.tours) if (def.actorId === actorId && st.npc && this.floor.npcs.includes(st.npc)) return true;
    return false;
  }

  /** 지금 순회 경로에서 잠긴 미션 목록(목적지 locksMissions: 출발 ~ 그 목적지 복귀 전조 끝) */
  private tourLocks(): (readonly string[])[] {
    const out: (readonly string[])[] = [];
    for (const st of this.tours.values()) {
      if (!st.npc || !this.floor.npcs.includes(st.npc)) continue;
      const wi = st.npc.waypointIndex;
      st.route.forEach((s, i) => { if (s.locksMissions && wi <= this.stopWpIndex(st.route, i, true)) out.push(s.locksMissions); });
    }
    return out;
  }

  /** 순회 웨이포인트 배치: 0 = 일어나기, 그다음 목적지마다 [도착 대기, (복귀 전조)], 마지막 = 자리. last=true면 그 목적지의 마지막 웨이포인트 */
  private stopWpIndex(route: BossTourDef['routes'][number], i: number, last: boolean): number {
    let k = 1;
    for (let j = 0; j < i; j++) k += route[j]!.endTell ? 2 : 1;
    return last && route[i]!.endTell ? k + 1 : k;
  }

  /** 회의실 문 '사용 중' 표시(순회 목적지 meetingDoorBusy에 머무는 중) — 표시용 */
  meetingDoorBusy(): boolean {
    for (const st of this.tours.values()) {
      if (!st.npc || !this.floor.npcs.includes(st.npc)) continue;
      const wi = st.npc.waypointIndex;
      if (st.route.some((s, i) => s.meetingDoorBusy && wi >= this.stopWpIndex(st.route, i, false) && wi <= this.stopWpIndex(st.route, i, true) && st.npc!.mode !== 'walk')) return true;
    }
    return false;
  }

  /** 순회 중인 상사의 지금 목적지(표시: 바닥 대기 표시·포즈) */
  tourStopOf(npc: PatrolNpc): BossTourDef['routes'][number][number] | null {
    for (const st of this.tours.values()) {
      if (st.npc !== npc) continue;
      const wi = npc.waypointIndex;
      for (let i = 0; i < st.route.length; i++) if (wi >= this.stopWpIndex(st.route, i, false) && wi <= this.stopWpIndex(st.route, i, true)) return st.route[i]!;
    }
    return null;
  }

  /**
   * 앉은 상사 순회. 예정 시각이 지나면 '앉아서 대기(wait) 중'일 때만 출발한다(전조·돌아보기·통화·말걸기 중이면 다음 스텝으로 미룸).
   * 출발 = 앉은 순찰을 순회 순찰로 교체: 0번 웨이포인트(자리)에서 standTellSec 동안 시선 없이 서 있음(일어나기 전조 + 의자 소리 + 목적지 아이콘) →
   * 목적지(대기 → 있으면 복귀 전조 endTell) → 자리 → '<앉은 순찰>#after_tour'(첫 돌아보기 정상 전조)로 복귀.
   * 회차별 출발 마감(latestStartByTour)을 넘기면 그 회차는 취소(퇴근 mustBeSeatedBeforeLeaveSec 전 복귀 보장).
   */
  private tourStep(): void {
    const defs = this.content.bossTours;
    if (!defs || defs.length === 0) return;
    for (const def of defs) {
      let st = this.tours.get(def);
      if (!st) { st = { next: 0, npc: null, index: 0, route: [], endTellShown: new Set() }; this.tours.set(def, st); }
      if (st.npc) {
        if (this.floor.npcs.includes(st.npc)) {
          this.tourReturnEarly(def, st);
          // 복귀 전조 시작 알림(표시·사운드)
          st.route.forEach((s, i) => {
            if (!s.endTell || st!.endTellShown.has(i)) return;
            if (st!.npc!.waypointIndex === this.stopWpIndex(st!.route, i, true) && st!.npc!.mode !== 'walk') {
              st!.endTellShown.add(i);
              this.push({ t: this.time, type: 'tourEndTell', npc: st!.npc!.def.id, ...(s.endTell.lineKey ? { lineKey: s.endTell.lineKey } : {}), ...(s.endTell.sfx ? { sfx: s.endTell.sfx } : {}) });
            }
          });
          continue;
        }
        // 교체됨(thenPatrol로 앉음 또는 다른 규칙이 바꿈)
        const back = this.floor.findNpc((n) => n.def.actorId === def.actorId && !!n.def.seated && n.def.patrolId === def.seatPatrolId);
        st.npc = null;
        if (back) this.push({ t: this.time, type: 'tour', actor: def.actorId, stage: 'seated', index: st.index - 1, npc: back.def.id });
        continue;
      }
      if (this.phase !== 'day' || st.next >= def.atSec.length) continue;
      if (this.dayTime < def.atSec[st.next]!) continue;
      const latest = Math.min(def.latestStartSec, def.latestStartByTour?.[st.next] ?? Infinity);
      if (this.dayTime > latest) {
        this.push({ t: this.time, type: 'tour', actor: def.actorId, stage: 'skipped', index: st.next });
        st.next++;
        continue;
      }
      if (this.frozenAll || this.qteActive || this.greetState !== 'idle') continue;
      if (this.ceoState !== 'none' && this.ceoState !== 'pending' && this.ceoState !== 'skipped' && this.ceoState !== 'done' && this.ceoState !== 'cancelled') continue;
      const seat = this.floor.findNpc((n) => n.def.actorId === def.actorId && !!n.def.seated && n.def.patrolId === def.seatPatrolId);
      if (!seat || seat.mode !== 'wait' || seat.suppressed) continue;
      const route = def.routes[st.next] ?? def.routes[def.routes.length - 1] ?? [];
      if (route.length === 0) { st.next++; continue; }
      const sw = seat.def.waypoints[0]!;
      const wps: WaypointDef[] = [
        { x: sw.x, y: sw.y, waitSec: def.standTellSec, lookChance: 0, coneOff: true, stopId: 'stop_tour_stand', ...(sw.facing ? { facing: sw.facing } : {}) },
      ];
      for (const s of route) {
        wps.push({
          x: s.tile.x, y: s.tile.y, waitSec: s.waitSec, lookChance: s.lookChance ?? 0, stopId: `stop_tour_${s.id}`,
          ...(s.facing ? { facing: s.facing } : {}),
        });
        // 복귀 전조(endTell): 같은 칸에서 sec 동안 시선 없이 서 있음
        if (s.endTell) wps.push({ x: s.tile.x, y: s.tile.y, waitSec: s.endTell.sec, lookChance: 0, coneOff: true, stopId: `stop_tour_end_${s.id}`, ...(s.facing ? { facing: s.facing } : {}) });
      }
      wps.push({ x: sw.x, y: sw.y, waitSec: 0, lookChance: 0 });
      const { phone: _p, coneActiveIn: _c, idleSecRange: _i, ...base } = seat.def;
      const tour: NpcDef = {
        ...base, id: `${seat.def.id}_tour`, patrolId: `${def.seatPatrolId}_tour`, seated: false, loop: false,
        thenPatrol: def.firstLookPlain ? `${def.seatPatrolId}#after_tour` : def.seatPatrolId, waypoints: wps,
        ...(def.speedTilesPerSec !== undefined ? { speedTilesPerSec: def.speedTilesPerSec } : {}),
        ...(def.coneActiveIn ? { coneActiveIn: def.coneActiveIn } : {}),
      };
      let npc: PatrolNpc;
      try { npc = this.floor.replaceNpc(seat, tour); } catch { st.next++; continue; } // 경로 없음(생성 층 오류) → 이 회차 건너뜀
      const from = def.fromInterrupt?.[st.next] ?? null;
      st.npc = npc;
      st.route = route;
      st.endTellShown = new Set();
      st.next++;
      st.index++;
      const first = route[0]!;
      this.push({
        t: this.time, type: 'tour', actor: def.actorId, stage: 'stand', index: st.index - 1, npc: npc.def.id,
        ...(first.bubbleIcon ? { icon: first.bubbleIcon } : {}), ...(first.lineKey ? { lineKey: first.lineKey } : {}), ...(def.standSfx ? { sfx: def.standSfx } : {}),
      });
      this.tutorial('tourStand');
      if (from) { this.noteInterrupt(from); this.tutorial(`int:${from}`); }
    }
  }

  // ── 위계 연쇄 H1·H2(본부장 → 팀장 인사·길막) ─────────────────

  private greetingStep(dt: number): void {
    const g = this.content.greeting;
    if (!g || this.frozenAll) return;
    const boss = this.floor.findNpc((n) => n.def.actorId === g.bossActorId && n.mode !== 'spawn');
    const z = this.content.zones.find((zz) => zz.id === g.zoneId);
    const inZ = !!boss && !!z && (() => { const t = tileOf(boss); const [x, y, w, h] = z.rect; return t.x >= x && t.y >= y && t.x < x + w && t.y < y + h; })();
    if (this.greetState === 'idle') {
      if (!inZ) return;
      const tl = this.floor.findNpc((n) => n.def.actorId === g.greeterActorId && !!n.def.seated && n.def.patrolId === this.content.patrols['p_tl_seat']?.patrolId);
      if (!tl || tl.mode === 'talk' || (tl.mode === 'tell' && tl.tellKind === 'talk')) return;
      const seat = tl.def.waypoints[0]!;
      const def: NpcDef = {
        ...tl.def, id: `${tl.def.id}_greet`, patrolId: `${tl.def.patrolId ?? 'tl'}_greet`, seated: false, loop: false, coneOff: true,
        thenPatrol: tl.def.patrolId ?? 'p_tl_seat',
        waypoints: [
          { x: seat.x, y: seat.y, waitSec: 0 },
          { x: g.greetSpot.x, y: g.greetSpot.y, waitSec: 0, stopId: 'stop_tl_greet', holdForReport: true, facing: 'down', coneOff: true },
          { x: seat.x, y: seat.y, waitSec: 0 },
        ],
      };
      const { talk: _t, phone: _p, fake: _f, doubleLook: _d, ...rest } = def;
      const n = this.floor.replaceNpc(tl, rest);
      this.greetState = 'greeting';
      this.greetTimer = 0;
      if (g.lineKey) this.push({ t: this.time, type: 'say', npc: n.def.id, key: g.lineKey, sec: 1.8 });
      return;
    }
    const greeter = this.floor.findNpc((n) => n.def.actorId === g.greeterActorId);
    if (!greeter || greeter.def.seated) { this.greetState = 'idle'; return; }
    if (this.greetState === 'greeting') {
      if (inZ) { this.greetTimer = 0; return; }
      this.greetTimer += dt;
      if (this.greetTimer >= g.resumeDelaySec && greeter.mode === 'hold') { greeter.release(); this.greetState = 'returning'; }
    }
  }

  private scriptHint(type: string, interruptId: string): void {
    for (const b of this.content.scripted) {
      if (b.type === type && b['interruptId'] === interruptId && typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
    }
  }

  private tutorial(trigger: string): void {
    for (const id of this.content.tutorialIds) if (tutorialTrigger(id) === trigger) this.hint(`tutorial.${id}`);
  }

  private hint(key: string): void {
    if (this.hintsShown.has(key)) return;
    this.hintsShown.add(key);
    this.push({ t: this.time, type: 'hint', key });
  }

  // ── FloorSim 이벤트 후처리 ──────────────────────────────

  private floorEvents: SimEvent[] = [];

  /** FloorSim 이벤트(이번 스텝). 표시 쪽이 사운드·연출에 씀 */
  drainFloorEvents(): SimEvent[] { const e = this.floorEvents; this.floorEvents = []; return e; }

  private collectFloorEvents(): void {
    for (const e of this.floor.drainEvents()) {
      this.floorEvents.push(e);
      if (e.type === 'closeCall') {
        for (const m of this.missions) if (m.run && m.startedAt !== null && (m.state === 'active' || m.state === 'carry' || m.state === 'open')) m.run.closeCalls++;
        this.addPoints(this.content.scoring.closeCallBonusPoints);
        this.push({ t: this.time, type: 'closeCall', points: this.content.scoring.closeCallBonusPoints });
      } else if (e.type === 'talkWarn') {
        const npc = this.floor.findNpc((n) => n.def.id === e.npc);
        const intId = npc?.def.actorId ? this.content.actors[npc.def.actorId]?.talkEnabledBy : undefined;
        if (intId) this.scriptHint('talk_hint', intId);
      } else if (e.type === 'talk') {
        const npc = this.floor.findNpc((n) => n.def.id === e.npc);
        const intId = npc?.def.actorId ? this.content.actors[npc.def.actorId]?.talkEnabledBy : undefined;
        if (intId) {
          this.noteTalk(intId);
          const int = this.content.interrupts.find((i) => i.id === intId);
          const pts = int ? numOr(int.effect['earlyLeavePoints'], 0) : 0;
          if (pts > 0) this.addPoints(pts);
        }
      } else if (e.type === 'tell') {
        this.coverHintOnTell(e.npc);
      } else if (e.type === 'caught') {
        let best: PatrolNpc | null = null;
        this.floor.npcs.forEach((n, i) => { if (this.floor.seeing[i] && (!best || n.gazeMultiplier > best.gazeMultiplier)) best = n; });
        const b = best as PatrolNpc | null;
        if (b) this.caughtBy = b.def.actorId ?? null;
      }
    }
  }

  private push(e: DayEvent): void { this.events.push(e); }
}

// ── 보조 함수 ─────────────────────────────────────────────

/** 말걸기 시계 조건(데이터 이름 → 범위). 기준 시각 = content.clock.earlyLeaveBeforeMin. *_early_leave는 이름 변경 대비 별칭 */
const EARLY_LEAVE_CONDS: Readonly<Record<string, 'leave' | 'any'>> = {
  leave_phase_before_1800: 'leave', clock_before_1800: 'any',
  leave_phase_before_early_leave: 'leave', clock_before_early_leave: 'any',
};

function numOr(v: unknown, d: number): number { return typeof v === 'number' ? v : d; }
function numStr(v: unknown): string { return typeof v === 'string' ? v : ''; }

function seesPlayer(floor: FloorSim, npc: PatrolNpc): boolean {
  const i = floor.npcs.indexOf(npc);
  return i >= 0 && floor.seeing[i] === true;
}

function inZone(c: DayContent, zoneId: unknown, t: Tile, legendZone: string | null): boolean {
  if (typeof zoneId !== 'string') return false;
  if (legendZone === zoneId) return true;
  const z = c.zones.find((zz) => zz.id === zoneId);
  if (!z) return false;
  const [x, y, w, h] = z.rect;
  return t.x >= x && t.y >= y && t.x < x + w && t.y < y + h;
}

/** stopId 웨이포인트부터 시작하는 순찰(퇴근 '미리 서 있음'·'회의 끝'), 그 지점 대기 = waitSec */
function sliceFromStop(def: NpcDef, stopId: string, waitSec: number, dropSpawnTell = true): NpcDef {
  const i = def.waypoints.findIndex((w) => w.stopId === stopId);
  if (i < 0) return def;
  const wps: WaypointDef[] = def.waypoints.slice(i).map((w, k) => (k === 0 ? { ...w, waitSec } : w));
  const out: NpcDef = { ...def, waypoints: wps };
  if (dropSpawnTell) { const { spawnTellSec: _s, ...rest } = out; return rest; }
  return out;
}

/** 순찰이 stopId에 도착하기까지 예상 시간(등장 전조 + 경로 길이 ÷ 속도 + 앞 정지 대기) */
function etaToStop(def: NpcDef, stopId: string, floor: FloorSim): number {
  let sec = def.spawnTellSec ?? 0;
  const wps = def.waypoints;
  for (let i = 0; i < wps.length - 1; i++) {
    if (wps[i]!.stopId === stopId) break;
    if (i > 0) sec += wps[i]!.waitSec;
    const a = wps[i]!, b = wps[i + 1]!;
    sec += pathLen(floor, a, b) / def.speedTilesPerSec;
    if (b.stopId === stopId) break;
  }
  return sec;
}

function pathLen(floor: FloorSim, a: Tile, b: Tile): number {
  // NPC는 동적 차단 없이 지도만 본다
  const path = floorPath(floor, a, b);
  return path ?? Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function floorPath(floor: FloorSim, a: Tile, b: Tile): number | null {
  const p = findPath(floor.map, a, b);
  return p ? p.length : null;
}
