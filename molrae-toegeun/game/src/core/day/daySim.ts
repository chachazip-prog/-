/**
 * 하루 한 판 시뮬레이션 (X9: 하루 시계·업무 게이지·미션, 방해 이벤트 런타임, 퇴근 시퀀스) — 렌더링 무관.
 * FloorSim(이동·시선·의심)을 감싸고 훅으로 상위 규칙을 넣는다. 씬과 QA 봇이 같은 API를 쓴다.
 *
 * 결정성: 고정 스텝(rules.fixedStepSec) + 시드 RNG(FloorSim.rng 하나를 공유) + 고정된 갱신 순서.
 *  매 스텝: (1) 하루 규칙 전처리(시계·방해 시작·미션 해금) → (2) FloorSim.step → (3) 후처리(미션 진행·퇴근·결과)
 *
 * 입력(T-170 방향 패드, design/control-dpad.md — 씬과 QA 봇이 같은 API):
 *  - setPad(dir | null): 방향 패드. 행동 중 잠김(화장실 = 나가기), 얼음 중 freezeStartHoldSec 꾹, 자동 연출 중 잠김
 *  - pressAction() / releaseAction(pressSec) / tapAction(): 행동 버튼(§4-2 우선순위 9단계, actionState())
 *  - pressPlayfield() / releasePlayfield(pressSec) / tapPlayfield(): 게임 화면 톡. 집중 상황(QTE·말걸기·미션 행동·게이트·가방)이면 행동 버튼과 같음
 *  - tapChip(id): 미션 칩 = 길 안내(§4-5). 시작 칸에 서 있으면 시작. 'leave' = 퇴근 아이콘
 *  - tapWorld·tapMission: 옛 API 호환(화면 톡·칩 톡으로 연결, 이동하지 않음)
 */
import { FloorSim, type SimEvent } from '../floorSim';
import { tileOf, zoneAt, type Tile } from '../grid';
import { DIR_ANGLE, canSee, type Dir } from '../vision';
import { DIR_VEC } from '../player';
import { Follower } from './follower';
import { GreetQte, type QteResult } from './qte';
import { findPath } from '../pathfinding';
import type { NpcDef, PatrolNpc, WaypointDef } from '../patrol';
import { addSuspicion } from '../suspicion';
import { PrintJob, createActivity, createGrabActivity, emptyEffects, type Activity, type ActivityEffects, type ActivityView } from './missions';
import { evaluateMissionConditions } from './modifiers';
import type { CameraView } from '../camera';
import type {
  BossTourDef, DayContent, DayInterruptDef, DayOutcome, DayPhase, DayResult, LeaveStage, MissionDef, MissionState, TalkZoneDef,
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
  | { t: number; type: 'couponStamp'; total: number }
  // ── T-151 성별 시설 ──
  /** 본부장 화장실 들름(C2·C3): tell = 들어가기 전조(same일 때만 경고 문구·소리), enter, seen = 세면대·바닥에서 마주침, exit. cleaning = C4 청소 시작 */
  | { t: number; type: 'facility'; stage: 'tell' | 'enter' | 'seen' | 'exit' | 'cleaning'; relation?: 'same' | 'other'; npc?: string }
  // ── T-170 방향 패드 ──
  /** 길 안내 켜짐·꺼짐(칩 톡·자동). reason: chip(칩 톡) · auto(튜토리얼·퇴근) · arrive · timeout · toggle */
  | { t: number; type: 'guide'; on: boolean; id: string; reason: 'chip' | 'auto' | 'arrive' | 'timeout' | 'toggle' | 'replaced' }
  /** 행동 버튼 입력 결과(사운드·연출) */
  | { t: number; type: 'action'; kind: ActionKind; source: 'button' | 'playfield' | 'chip' };

/** 행동 버튼 상태(control-dpad §4-2, 위가 먼저) */
export type ActionKind = 'greet' | 'nod' | 'activity' | 'gate' | 'pack' | 'accept' | 'use' | 'start' | 'none';

export interface ActionState {
  readonly kind: ActionKind;
  /** 우선순위 1~9 */
  readonly rank: number;
  /** 아이콘 이름(ui/action_icon/<icon>, fx/head_icon/<icon>) */
  readonly icon: string;
  /** 버튼 아래 라벨 문구 키(없으면 null) */
  readonly labelKey: string | null;
  /** 아이콘이 없을 때 쓸 미션 아이콘(iconSprite) */
  readonly missionIcon?: string;
  readonly missionId?: string;
  /** 집중 상황: 게임 화면 톡도 행동 버튼과 같음(§4-1 ③) */
  readonly focus: boolean;
  /** 사용 가능(아니면 흐리게) */
  readonly enabled: boolean;
  /** 사용 칸 1칸 보정이면 그 사물 칸(머리 위 화살표 fx/use_hint 표시용) */
  readonly useTile?: Tile;
}

/** 길 안내(control-dpad §4-5): 발자국 trail(앞 guideTrailTiles칸) + 목적지 핀 */
export interface GuideView {
  readonly id: string;
  readonly goal: Tile;
  readonly trail: readonly Tile[];
  /** 남은 시간(초, Infinity = 도착까지) */
  readonly left: number;
}

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
  /** zone_only: 정확한 장소가 드러남(그날 끝까지 유지, T-155) */
  revealed?: boolean;
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
  // T-170: tut_tap_move(폐지 키, control-dpad §10-4)는 띄우지 않음. 패드 튜토리얼(§6-1)
  tut_tap_move: 'never',
  // T-171 days[1] _t171Note: tut_pad_move = 하루 첫 순간, tut_sit = 자리를 떠났다가 처음 자리 칸에서 멈춰 앉음, tut_use = 처음 사용 가능한 사물 옆
  tut_pad_move: 'dayStart',
  tut_use: 'useAvailable',
  tut_sit: 'seatArrive',
  tut_guide: 'chipGuide',
  tut_hand_setting: 'never', // 결과 화면에서 씬이 띄움
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
  // T-151 성별 시설(layout.genderFacilities.debuts)
  tut_gender_restroom: 'unlock:restroom',
  tut_director_restroom: 'facilityTell:same',
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
  /** D-124: 인사 자리에서 기다린 시간(hold 상한용) */
  private greetHeld = 0;
  /** D-124: 상한으로 인사를 끝냄 → 본부장이 구역을 떠날 때까지 다시 인사하지 않음 */
  private greetSkipUntilLeave = false;
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
  // ── T-151 성별 시설 ──
  private facMine = new Set<number>();
  private facOther = new Set<number>();
  private facOtherDoors = new Set<number>();
  private facMineDoor = -1;
  /** C4 청소 끝 시각(floor.time). null = 없음 */
  private cleaningUntil: number | null = null;
  private facRun: { npc: PatrolNpc; stage: 'tell' | 'walk' | 'inside'; seen: boolean } | null = null;
  private facStops = 0;
  private facCueLeft = 0;
  // ── T-170 방향 패드 ──
  /** 씬·봇이 누른 원래 방향(잠금 적용 전) */
  private padRaw: Dir | null = null;
  /** 지금 방향을 누르고 있는 시간(얼음 중 꾹 판정) */
  private padHeldSec = 0;
  /** 1~3일차 '지금은 버튼을 톡!'(하루 1번) */
  private padLockedHinted = false;
  /** 1~3일차 '이동은 아래 패드로 해요'(하루 mapTapHintMaxPerDay번) */
  private mapTapHints = 0;
  /** 행동 버튼(또는 집중 상황 화면 톡)이 눌린 채인 입력: 뗄 때 판정할 대상 */
  private actionDown: 'qte' | 'activity' | null = null;
  /** 길 안내 */
  private guideState: { id: string; goal: Tile; left: number; trail: Tile[]; at: string } | null = null;
  /** 이동 구간 효율(디버그·QA): 출발 칸, 이동 시간 */
  private trip: { from: Tile; moving: number } | null = null;
  private lastStillTile: Tile | null = null;
  /** η = Σ최단 시간 ÷ Σ실제 이동 시간(이동 구간: 멈춘 곳 → 미션 시작·자리 앉기·게이트) */
  readonly padMetrics = { trips: 0, shortestSec: 0, movingSec: 0 };
  private firstUnlockSeen = false;
  private wasAtSeatStill = true;

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
        talkDisguisedFor: (npc) => this.talkDisguisedFor(npc),
        talkCatchRadiusAdd: () => this.carryTalkCatchAdd(),
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
    const fac = content.facility;
    if (fac) {
      const W = this.floor.map.width, ix = (t: Tile) => t.y * W + t.x;
      for (const sd of [fac.restroom.mine, fac.locker?.mine]) if (sd) for (const t of sd.tiles) this.facMine.add(ix(t));
      for (const sd of [fac.restroom.other, fac.locker?.other]) if (sd) { for (const t of sd.tiles) this.facOther.add(ix(t)); this.facOtherDoors.add(ix(sd.door)); }
      this.facMineDoor = ix(fac.restroom.mine.door);
    }
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
    this.guideState = null; this.trip = null; this.actionDown = null;
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

  // ── 입력(T-170 방향 패드) ───────────────────────────────

  get controls(): DayContent['controls'] { return this.content.controls; }

  /** 대표님 얼음(전조 ~ 대화 종료): 패드를 freezeStartHoldSec 꾹 눌러야 출발(control-dpad §3-4) */
  get padFreezeGuard(): boolean {
    const st = this.ceoState;
    return st === 'tell' || st === 'freeze' || st === 'qte' || st === 'talk';
  }

  /** 얼음 중 꾹 누름 진행(0~1, 표시용). 얼음이 아니면 null */
  get padFreezeProgress(): number | null {
    if (!this.padFreezeGuard) return null;
    const h = this.controls.freezeStartHoldSec;
    return this.padRaw ? Math.min(1, h > 0 ? this.padHeldSec / h : 1) : 0;
  }

  /** 패드 잠김: 미션 행동 중(화장실 제외), 자동 연출(게이트 → 엘리베이터, 사용 칸 1칸 보정) */
  get padLocked(): boolean {
    if (this.phase === 'intro' || this.phase === 'ended') return true;
    if (this.phase === 'leave' && (this.gateOpen || this.leaveStage === 'lobby' || this.leaveStage === 'elevator' || this.leaveStage === 'done')) return true;
    if (this.floor.player.onPath) return true;
    if (this.activity && this.controls.lockedDuringActivity && !this.restroomPadExit()) return true;
    return false;
  }

  /** 화장실 행동 중 패드 = 나가기(events.restroom.params.padExits) */
  private restroomPadExit(): boolean {
    const m = this.activeMission;
    if (!this.activity || !m || m.def.mechanic !== 'trip_safe_zone') return false;
    const pe = m.def.params['padExits'];
    return typeof pe === 'boolean' ? pe : this.controls.restroomPadExits;
  }

  /** 지금 패드 입력(잠금 적용 전, 표시용) */
  get padInput(): Dir | null { return this.padRaw; }

  /**
   * 방향 패드 입력(씬·QA 봇 공용). null = 손 뗌(정지 = 위장).
   * 화장실 행동 중 누르면 나가기 + 그 방향으로 걷기, 다른 행동 중에는 잠김(1~3일차 첫 1회 안내)
   */
  setPad(dir: Dir | null): void {
    const prev = this.padRaw;
    this.padRaw = dir;
    if (dir !== prev) this.padHeldSec = 0;
    if (dir && dir !== prev && this.activity && this.activeMission && this.phase !== 'ended') {
      if (this.restroomPadExit()) {
        this.activityTap(undefined);
      } else if (this.controls.lockedDuringActivity && this.tutorialDay() && !this.padLockedHinted) {
        this.padLockedHinted = true;
        this.push({ t: this.time, type: 'toast', key: 'hud.pad_locked_hint' });
      }
    }
    this.applyPad();
  }

  /** 잠금·얼음 규칙을 적용해 FloorSim에 전달 */
  private applyPad(): void {
    let eff = this.padRaw;
    if (eff) {
      if (this.padLocked || this.floor.outcome !== 'playing') eff = null;
      else if (this.padFreezeGuard && this.floor.player.mode !== 'moving' && this.padHeldSec + 1e-9 < this.controls.freezeStartHoldSec) eff = null;
    }
    if (eff !== this.floor.padDir) this.floor.setPad(eff);
  }

  private tutorialDay(): boolean {
    const [a, b] = this.controls.mapTapHintDays;
    return this.content.day >= a && this.content.day <= b;
  }

  /** 미션 행동 입력(옛 tapWorld의 미션 분기) */
  private activityTap(pressSec: number | undefined): void {
    if (!this.activity || !this.activeMission) return;
    const fx = emptyEffects();
    const ctx = pressSec !== undefined ? { ...this.activityCtx(), pressSec } : this.activityCtx();
    if (this.commitRule(this.activeMission) === 'first_input') this.commitMission(this.activeMission);
    const st = this.activity.tap(ctx, fx);
    this.applyEffects(fx);
    this.resolveActivity(st);
  }

  /** 뗄 때 판정하는 행동인가(간식·수다 judgeOn release, 길게 누름 = 바스락) */
  private activityJudgesOnRelease(): boolean {
    const m = this.activeMission;
    if (!this.activity || !m) return false;
    const j = m.def.params['judgeOn'];
    return j === 'release' || (j === undefined && m.def.mechanic === 'rhythm_tap');
  }

  /** 시작 방식(데이터 없으면 화장실만 auto_on_stop) */
  private startByOf(m: MissionRuntime): 'action' | 'auto_on_stop' {
    return m.def.startBy ?? (m.def.mechanic === 'trip_safe_zone' ? 'auto_on_stop' : 'action');
  }

  /** 자리에서 시작하는 미션(쇼핑·간식·공과금·출력 걸기) */
  private seatMission(m: MissionRuntime): boolean {
    return m.def.startsAt === 'chip_tap_at_seat' || (m.def.mechanic === 'remote_start_fetch' && !m.job);
  }

  /** 미션을 시작하는 칸(자리 미션 = 내 자리, 청소 우회 칸, 드러나기 전 = 구역 입구) */
  missionStartTile(m: MissionRuntime): Tile {
    if (this.seatMission(m)) return this.content.playerSeat;
    const d = this.cleaningDetourFor(m);
    return d ?? this.missionTarget(m);
  }

  /** 행동 버튼 순위 7: 사용 칸 1칸 안에 멈춰 있는 사물(위험한 행동 = 버튼 시작) */
  private usableMission(): { m: MissionRuntime; tile: Tile; dist: number } | null {
    if (this.phase !== 'day' || this.activity) return null;
    const p = this.floor.player;
    if (!p.stoppedAtCenter) return null;
    const here = p.tile;
    const r = this.controls.useSpotAssistTiles;
    let best: { m: MissionRuntime; tile: Tile; dist: number } | null = null;
    for (const m of this.missions) {
      if (m.state !== 'open' || m.blocked || this.seatMission(m) || this.startByOf(m) !== 'action') continue;
      if (m.def.zoneEntry && !m.revealed) continue;
      if (this.cleaningDetourFor(m) === null) continue;
      const t = this.missionStartTile(m);
      const d = Math.abs(t.x - here.x) + Math.abs(t.y - here.y);
      if (d > r) continue;
      if (d > 0) { const path = this.floor.pathTo(t); if (!path || path.length > r) continue; }
      if (!best || d < best.dist) best = { m, tile: t, dist: d };
    }
    return best;
  }

  /** 행동 버튼 순위 8: 자리에 앉아 있고 열린 자리 미션(가장 먼저 열린 것) */
  private seatStartMission(): MissionRuntime | null {
    if (this.phase !== 'day' || this.activity || !this.playerAtSeat || !this.floor.player.stoppedAtCenter) return null;
    let best: MissionRuntime | null = null;
    for (const m of this.missions) {
      if (m.state !== 'open' || m.blocked || !this.seatMission(m)) continue;
      if (!best || m.def.unlockAtSec < best.def.unlockAtSec) best = m;
    }
    return best;
  }

  private activityIcon(m: MissionRuntime): { icon: string; labelKey: string } {
    const v = this.activity?.view();
    switch (v?.kind) {
      case 'pour': return { icon: m.def.id === 'window' ? 'breath' : 'stop', labelKey: 'action.stop' };
      case 'restroom': return { icon: 'exit', labelKey: 'action.exit' };
      case 'nap': return { icon: 'head', labelKey: 'action.head' };
      case 'shop': return { icon: 'switch', labelKey: 'action.switch' };
      case 'snack': return m.def.id === 'chat' ? { icon: 'nod', labelKey: 'action.chat' } : { icon: 'bite', labelKey: 'action.bite' };
      case 'fetch': return { icon: 'stop', labelKey: 'action.pause' };
      case 'remote_start': return { icon: 'start', labelKey: 'action.start' };
      case 'grab': return v.done ? { icon: 'grab', labelKey: 'action.grab' } : { icon: 'stop', labelKey: 'action.pause' };
      case 'queue': return v.stage === 'window' ? { icon: 'pickup', labelKey: 'action.pickup' } : { icon: 'stop', labelKey: 'action.pause' };
      default: return { icon: 'use', labelKey: 'action.use' };
    }
  }

  /** 사물 사용 라벨(택배 받기·출력 집기·카페 주문·그 밖 사용) */
  private useIcon(m: MissionRuntime): { icon: string; labelKey: string } {
    switch (m.def.mechanic) {
      case 'fetch_carry': return { icon: 'pickup', labelKey: 'action.pickup' };
      case 'remote_start_fetch': return { icon: 'grab', labelKey: 'action.grab' };
      case 'queue_wait_tap': return { icon: 'order', labelKey: 'action.order' };
      default: return { icon: 'use', labelKey: 'action.use' };
    }
  }

  /** 행동 버튼 상태(control-dpad §4-2 우선순위 1~9). 씬이 매 프레임 그림 */
  actionState(): ActionState {
    const none: ActionState = { kind: 'none', rank: 9, icon: 'idle', labelKey: null, focus: false, enabled: false };
    if (this.phase === 'intro' || this.phase === 'ended' || this.floor.outcome !== 'playing') return none;
    const p = this.floor.player;
    const focusOn = (k: string) => this.controls.playfieldTapCountsIn.includes(k);
    if (this.qteActive) return { kind: 'greet', rank: 1, icon: 'greet', labelKey: 'action.greet', focus: focusOn('qte'), enabled: true };
    if (p.mode === 'talked') {
      const t = this.floor.talkingNpc?.def.talk;
      const can = !!t?.nodShortenSec && t.nodShortenSec > 0;
      return { kind: 'nod', rank: 2, icon: 'nod', labelKey: 'action.nod', focus: focusOn('talk'), enabled: can };
    }
    if (this.activity && this.activeMission) {
      const a = this.activityIcon(this.activeMission);
      return { kind: 'activity', rank: 3, ...a, missionIcon: this.activeMission.def.iconSprite, missionId: this.activeMission.def.id, focus: focusOn('activity'), enabled: true };
    }
    if (this.phase === 'leave') {
      if (this.leaveStage === 'gate') return { kind: 'gate', rank: 4, icon: 'tag', labelKey: 'action.tag', focus: focusOn('gate'), enabled: true };
      if (this.leaveStage === 'pack' && this.playerAtSeat && this.floor.playerStill && this.content.leave.packTapPauses) {
        return { kind: 'pack', rank: 5, icon: 'pack', labelKey: this.packPaused ? 'action.pack_resume' : 'action.pack_pause', focus: focusOn('pack'), enabled: true };
      }
      return none;
    }
    if (this.offer && this.phase === 'day' && !this.frozenAll) return { kind: 'accept', rank: 6, icon: 'accept', labelKey: 'action.accept', missionId: this.offer.missionId, focus: false, enabled: true };
    const u = this.usableMission();
    if (u) {
      const a = this.useIcon(u.m);
      return { kind: 'use', rank: 7, ...a, missionIcon: u.m.def.iconSprite, missionId: u.m.def.id, focus: false, enabled: true, useTile: u.m.def.spot };
    }
    const sm = this.seatStartMission();
    if (sm) return { kind: 'start', rank: 8, icon: 'start', labelKey: 'action.start', missionIcon: sm.def.iconSprite, missionId: sm.def.id, focus: false, enabled: true };
    return none;
  }

  /** 행동 버튼 누름. 반환: 실행한 행동 종류('none' = 아무 일 없음) */
  pressAction(source: 'button' | 'playfield' = 'button'): ActionKind {
    const st = this.actionState();
    this.actionDown = null;
    switch (st.kind) {
      case 'greet': this.pressQte(); this.actionDown = 'qte'; break;
      case 'nod': if (!this.floor.nod()) return 'none'; break;
      case 'activity':
        if (this.activityJudgesOnRelease()) this.actionDown = 'activity';
        else this.activityTap(undefined);
        break;
      case 'gate': this.gateTap(); break;
      case 'pack': this.packPaused = !this.packPaused; break;
      case 'accept': if (!this.acceptOffer()) return 'none'; break;
      case 'use': {
        const u = this.usableMission();
        if (!u) return 'none';
        this.startUse(u.m, u.tile, u.dist);
        break;
      }
      case 'start': { const m = this.seatStartMission(); if (!m) return 'none'; this.startActivity(m); break; }
      case 'none': return 'none';
    }
    this.push({ t: this.time, type: 'action', kind: st.kind, source });
    return st.kind;
  }

  /** 행동 버튼 뗌(누른 시간). QTE·뗄 때 판정 행동만 의미 있음 */
  releaseAction(pressSec: number): void {
    const d = this.actionDown;
    this.actionDown = null;
    if (d === 'qte') this.releaseQte(pressSec);
    else if (d === 'activity' && this.activity) this.activityTap(pressSec);
  }

  /** 짧게 톡(QA 봇용) */
  tapAction(pressSec = 0.1): ActionKind { const k = this.pressAction(); this.releaseAction(pressSec); return k; }

  /** 지금 집중 상황인가(게임 화면 톡 = 행동 버튼) */
  get playfieldFocus(): boolean { return this.actionState().focus; }

  /**
   * 게임 화면 누름. 집중 상황이면 행동 버튼과 같고, 아니면 아무 일도 없음(1~3일차 첫 2번 '이동은 아래 패드로' 안내)
   */
  pressPlayfield(): ActionKind | 'ignored' {
    if (this.phase === 'intro' || this.phase === 'ended' || this.floor.outcome !== 'playing') return 'ignored';
    if (this.playfieldFocus) return this.pressAction('playfield');
    this.actionDown = null;
    if (this.phase === 'day' && this.tutorialDay() && this.mapTapHints < this.controls.mapTapHintMaxPerDay) {
      this.mapTapHints++;
      this.push({ t: this.time, type: 'toast', key: 'hud.map_tap_hint' });
    }
    return 'ignored';
  }

  releasePlayfield(pressSec: number): void { if (this.actionDown) this.releaseAction(pressSec); }

  tapPlayfield(pressSec = 0.1): ActionKind | 'ignored' { const k = this.pressPlayfield(); this.releasePlayfield(pressSec); return k; }

  /** @deprecated T-170: 옛 화면 탭 API. 게임 화면 톡(tapPlayfield)으로 연결(이동 없음). pressSec가 있으면 누름·뗌 */
  tapWorld(_tx: number, _ty: number, pressSec?: number): string {
    if (this.phase === 'intro' || this.phase === 'ended' || this.floor.outcome !== 'playing') return 'ignored';
    const k = this.pressPlayfield();
    this.releasePlayfield(pressSec ?? 0.1);
    return k === 'greet' ? 'qte' : k === 'activity' ? 'mission' : k;
  }

  /** @deprecated T-170: 옛 칩 API = tapChip */
  tapMission(id: string): boolean { return this.tapChip(id); }

  /**
   * 미션 칩 톡(control-dpad §4-5): 길 안내 켜기·끄기·바꾸기. 그 미션 시작 칸에 서 있으면(자리 미션은 앉아 있으면) 시작.
   * 들고 복귀 중인 미션 = 내 자리로 안내. 'leave' = 퇴근 아이콘(6일차부터 퇴근 안내)
   */
  tapChip(id: string): boolean {
    if (this.phase === 'leave' && id === 'leave') { const g = this.leaveGoal(); return g ? this.setGuide('leave', g, Infinity, 'chip') : false; }
    if (this.phase !== 'day' || this.activity) return false;
    const m = this.missions.find((x) => x.def.id === id);
    if (!m) return false;
    if (m.state === 'carry') return this.setGuide(`carry:${id}`, this.content.playerSeat, this.controls.guideSec, 'chip');
    if (m.state !== 'open' || m.blocked) return false;
    this.routeHintFor(m);
    const p = this.floor.player;
    const atStart = (t: Tile) => p.stoppedAtCenter && p.tile.x === t.x && p.tile.y === t.y;
    if (this.seatMission(m)) {
      if (this.controls.startIfAtStartSpot && this.playerAtSeat && p.stoppedAtCenter) { this.startActivity(m); this.push({ t: this.time, type: 'action', kind: 'start', source: 'chip' }); return true; }
      return this.setGuide(id, this.content.playerSeat, this.controls.guideSec, 'chip');
    }
    // T-151 C4: 청소 중이면 내 쪽 탈의실 구석 칸으로 우회(있을 때). 없으면 안내만
    const detour = this.cleaningDetourFor(m);
    if (detour === null) { this.cleaningToast(); return false; }
    const t = this.missionStartTile(m);
    if (atStart(t)) {
      if (t === m.def.zoneEntry) return true; // 구역 입구에 이미 있음: 장소가 드러날 때까지 둘러보기
      if (this.controls.startIfAtStartSpot) { this.startActivity(m); this.push({ t: this.time, type: 'action', kind: 'use', source: 'chip' }); return true; }
    }
    return this.setGuide(id, t, this.controls.guideSec, 'chip');
  }

  /** 사용 칸 보정(§4-3): 0칸이면 바로 시작, 1칸이면 자동으로 한 칸 걷고(이동으로 계산) 도착하면 시작 */
  private startUse(m: MissionRuntime, t: Tile, dist: number): void {
    if (dist === 0) { this.startActivity(m); return; }
    if (this.floor.moveTo(t)) { this.pendingMission = m; this.applyPad(); }
  }

  // ── 길 안내 ──

  /** 지금 길 안내(표시용) */
  get guide(): GuideView | null {
    const g = this.guideState;
    return g ? { id: g.id, goal: g.goal, trail: g.trail, left: g.left } : null;
  }

  /** 안내 켜기. 같은 id를 다시 켜면(칩 다시 톡) 끔. 반환: 처리했는가 */
  private setGuide(id: string, goal: Tile, sec: number, reason: 'chip' | 'auto'): boolean {
    const cur = this.guideState;
    if (cur && cur.id === id && reason === 'chip') { this.guideOff('toggle'); return true; }
    if (cur) this.guideOff('replaced');
    const here = this.floor.player.tile;
    if (here.x === goal.x && here.y === goal.y) return true;
    this.guideState = { id, goal, left: sec, trail: [], at: '' };
    this.updateGuideTrail();
    this.push({ t: this.time, type: 'guide', on: true, id, reason });
    if (reason === 'chip') this.tutorial('chipGuide');
    return true;
  }

  private guideOff(reason: 'arrive' | 'timeout' | 'toggle' | 'replaced'): void {
    const g = this.guideState;
    if (!g) return;
    this.guideState = null;
    this.push({ t: this.time, type: 'guide', on: false, id: g.id, reason });
  }

  private updateGuideTrail(): void {
    const g = this.guideState;
    if (!g) return;
    const here = this.floor.player.tile;
    const key = `${here.x},${here.y}`;
    if (key === g.at) return;
    g.at = key;
    const path = this.floor.pathTo(g.goal);
    g.trail = path ? path.slice(0, Math.max(0, this.controls.guideTrailTiles)) : [];
  }

  private guideStep(dt: number): void {
    const g = this.guideState;
    if (!g) return;
    const here = this.floor.player.tile;
    if (here.x === g.goal.x && here.y === g.goal.y) { this.guideOff('arrive'); return; }
    if (Number.isFinite(g.left)) { g.left -= dt; if (g.left <= 0) { this.guideOff('timeout'); return; } }
    // 칩 대상 미션이 끝났으면 끔
    if (!g.id.startsWith('leave') && !g.id.startsWith('carry:') && g.id !== 'seat') {
      const m = this.missions.find((x) => x.def.id === g.id);
      if (!m || m.state === 'done' || m.state === 'failed' || m.state === 'active') { this.guideOff('arrive'); return; }
    }
    this.updateGuideTrail();
  }

  /** 퇴근 안내 목표: 가방 전 = 자리, 걷기 = 게이트, 게이트 통과 뒤 = 엘리베이터(로비 출구) */
  private leaveGoal(): Tile | null {
    if (this.phase !== 'leave') return null;
    if (this.leaveStage === 'pack') return this.playerAtSeat ? null : this.content.playerSeat;
    if (this.leaveStage === 'walk') return this.content.leave.gate.spot;
    return null;
  }

  /** 1~5일차(leaveGuideAutoUntilDay) 퇴근 안내 자동 */
  private autoLeaveGuide(): void {
    if (this.content.day > this.controls.leaveGuideAutoUntilDay) return;
    const g = this.leaveGoal();
    if (g) this.setGuide(`leave:${this.leaveStage}`, g, Infinity, 'auto');
  }

  /** 디버그·QA: 이동 구간 η(최단 시간 ÷ 실제 이동 시간). 구간이 없으면 null */
  get padEta(): number | null { const m = this.padMetrics; return m.movingSec > 0 ? m.shortestSec / m.movingSec : null; }

  private tripStep(dt: number): void {
    const p = this.floor.player;
    if (p.stoppedAtCenter && !this.trip) this.lastStillTile = p.tile;
    if (p.mode === 'moving' && !p.onPath) {
      if (!this.trip) this.trip = { from: this.lastStillTile ?? p.tile, moving: 0 };
      this.trip.moving += dt;
    }
  }

  /** 이동 구간 끝(미션 시작·자리 앉기·게이트 단계) */
  private tripEnd(): void {
    const tr = this.trip;
    this.trip = null;
    const here = this.floor.player.tile;
    this.lastStillTile = here;
    if (!tr || tr.moving <= 0) return;
    const path = findPath(this.floor.map, tr.from, here);
    if (!path || path.length === 0) return;
    this.padMetrics.trips++;
    this.padMetrics.shortestSec += path.length / this.content.floor.rules.playerSpeedTilesPerSec;
    this.padMetrics.movingSec += tr.moving;
  }

  /** zone_only(gdd-v3 §10): 드러나기 전에는 칩·화살표 목표 = 구역 입구, 드러난 뒤 = 장소 */
  missionTarget(m: MissionRuntime): Tile {
    return m.def.zoneEntry && !m.revealed ? m.def.zoneEntry : m.def.spot;
  }

  /** zone_only: 장소와 직선 거리 ≤ revealRadiusTiles(시선 가림 무시)면 드러남 */
  private zoneRevealStep(): void {
    const p = this.floor.player;
    for (const m of this.missions) {
      const r = m.def.zoneOnlyRevealTiles;
      if (r === undefined || m.revealed || !m.def.zoneEntry) continue;
      if (Math.hypot(p.x - (m.def.spot.x + 0.5), p.y - (m.def.spot.y + 0.5)) > r + 1e-9) continue;
      m.revealed = true;
      this.push({ t: this.time, type: 'missionStage', id: m.def.id, stage: 'revealed' });
    }
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
    // T-170: 패드 잠금·얼음 꾹 판정을 매 스텝 다시 적용(행동이 끝나면 누르고 있던 방향으로 출발)
    if (this.padRaw) this.padHeldSec += dt;
    this.applyPad();
    this.facilityTalkCancel();
    if (!this.playerOnGate()) this.offGateStill = this.floor.playerStill && !this.floor.player.paused;
    this.floor.step();
    this.collectFloorEvents();
    if (this.floor.outcome === 'caught') { this.end('caught'); return; }

    this.tripStep(dt);
    this.trackSeat();
    if (this.phase === 'day') { this.zoneRevealStep(); this.dayAfterStep(dt); }
    else if (this.phase === 'leave') this.leaveAfterStep(dt);
    if ((this.phase as DayPhase) === 'ended') return;
    this.afterInterrupts(dt);
    this.facilityStopStep();
    if (this.facCueLeft > 0) this.facCueLeft = Math.max(0, this.facCueLeft - dt);
    this.ceoPostStep(dt, wasMoving);
    this.elevatorCeoStep();
    this.accompliceStep(dt);
    this.greetingStep(dt);
    this.deferredStep();
    this.tourStep();
    this.scriptWatchers();
    this.guideStep(dt);
    if ((this.phase as DayPhase) !== 'ended' && this.actionState().kind === 'use') this.tutorial('useAvailable');
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
    // D-107 경비 말걸기 구역(gate_approach): 게이트 칸 대기 중엔 새 전조 없음, 경로상 게이트까지 1~6칸에서 움직이는 중일 때만
    if (actor.talkZone && !this.inTalkZone(actor.talkZone)) return false;
    const phase = this.phase === 'leave' ? 'leave' : 'day';
    const int = this.content.interrupts.find((i) => i.id === intId && i.phase === phase);
    if (!int) return false;
    if (this.activity) return false;
    if (this.gateOpen) return false;
    if (this.frozenAll || this.qteActive) return false;
    // T-151: 내 쪽 시설 안·문에서는 아무도 말을 걸지 않음(access.talkCancelAtMineDoor)
    if (this.playerInMineFacility()) return false;
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

  /** 플레이어가 게이트 사용 칸 위에 있는가 */
  private playerOnGate(): boolean {
    const t = this.floor.player.tile, g = this.content.leave.gate.spot;
    return t.x === g.x && t.y === g.y;
  }

  /** 경로상 게이트 사용 칸까지 남은 칸 수(게이트 칸 포함 걸음 수). 경로에 게이트가 없으면 null */
  private pathStepsToGate(): number | null {
    const p = this.floor.player;
    const g = this.content.leave.gate.spot;
    const here = p.tile;
    // T-170 직접 조작: 경로가 없으므로 지금 칸에서 게이트 사용 칸까지 최단 걸음 수(같은 스텝 안 캐시)
    if (!p.onPath) {
      if (this.gateStepsCache.step !== this.floor.steps) {
        const path = this.floor.pathTo(g);
        this.gateStepsCache = { step: this.floor.steps, n: path ? path.length : null };
      }
      return this.gateStepsCache.n;
    }
    let steps = 0, last = `${here.x},${here.y}`;
    for (const v of p.remainingPath()) {
      const t = tileOf(v);
      const k = `${t.x},${t.y}`;
      if (k === last) continue;
      last = k;
      steps++;
      if (t.x === g.x && t.y === g.y) return steps;
    }
    return null;
  }

  private gateStepsCache: { step: number; n: number | null } = { step: -1, n: null };

  /** D-107: 경비 말걸기 전조를 지금 시작할 수 있는 구역인가 */
  private inTalkZone(z: TalkZoneDef): boolean {
    if (z.type !== 'gate_approach') return true;
    if (z.noStartWhileAtGate && this.playerOnGate()) return false;
    if (!z.startOnlyInZone) return true;
    if (this.floor.player.mode !== 'moving') return false;
    const n = this.pathStepsToGate();
    // 남은 칸 = 게이트까지 걸음 수(게이트 칸에 서 있으면 0 = 구역 밖). 6칸 = 3.0타일/초로 2.0초(gdd-v3 §3-6 근거와 같은 셈)
    return n !== null && n >= z.pathTilesToGateUse[0] && n <= z.pathTilesToGateUse[1];
  }

  /** D-107: 전조 중 게이트에 도착했으면 위장 판정은 도착 전 마지막 이동 상태 */
  private offGateStill = false;
  private talkDisguisedFor(npc: PatrolNpc): boolean | undefined {
    const z = npc.def.actorId ? this.content.actors[npc.def.actorId]?.talkZone : undefined;
    if (!z || this.phase !== 'leave') return undefined;
    // [해석] 길막 자동 대기(경로 보관 중 일시정지, 말을 걸려고 멈춘 경비 자신에게 막힌 경우 포함)는 '멈춤 = 위장'이 아니라 이동 중으로 봄
    if (this.floor.player.paused) return false;
    if (!z.tellSurvivesGateArrival || !this.playerOnGate()) return undefined;
    return this.offGateStill;
  }

  /** 말걸기 성립 후 게이트 단계 보류(막대 정지·시도 미소모) */
  private gateHeldByTalk(): boolean {
    const n = this.floor.talkingNpc;
    if (!n || this.floor.player.mode !== 'talked') return false;
    const z = n.def.actorId ? this.content.actors[n.def.actorId]?.talkZone : undefined;
    return !!z?.gateStageHoldWhileTalk;
  }

  /** carry 변형(carryTalkCatchRadiusAdd): 물건을 집은 뒤 ~ 자리 완료까지 모든 말걸기 액터의 붙잡는 반경 가산(여럿이면 최댓값) */
  private carryTalkCatchAdd(): number {
    let k = 0;
    for (const m of this.missions) if (m.state === 'carry' && typeof m.def.params['carryTalkCatchRadiusAdd'] === 'number') k = Math.max(k, m.def.params['carryTalkCatchRadiusAdd'] as number);
    return k;
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
    const m = this.floor.map;
    // T-151: 다른 쪽 시설 문 = 플레이어 경로에서 벽(access.otherDoorForPlayer), 청소 중인 내 화장실 문 = 밖에서 못 들어감(C4)
    if (this.facOtherDoors.size > 0 || this.cleaningUntil !== null) {
      const i = y * m.width + x;
      if (this.facOtherDoors.has(i)) return true;
      if (i === this.facMineDoor && this.cleaningActive && !this.facMine.has(this.floor.player.tile.y * m.width + this.floor.player.tile.x)) return true;
    }
    if (this.gateOpen) return false;
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
    // T-170: 자리로 자동 이동(ifAwayWalkToSeatFirst)은 폐지 — 1~5일차는 자리 → 게이트 길 안내를 자동으로 켬(control-dpad §4-5)
    this.pendingMission = null;
    this.guideOff('replaced');
    this.autoLeaveGuide();
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
        if (m.def.facilityMission) this.tutorial(`unlock:${m.def.id}`);
        if (!this.firstUnlockSeen) {
          this.firstUnlockSeen = true;
          // 1일차 ③(control-dpad §6-1): 첫 미션이 열리면 패드 안내 + 길 안내 자동(도착까지)
          if (this.content.tutorialIds.includes('tut_pad_move')) this.setGuide(m.def.id, this.missionStartTile(m), Infinity, 'auto');
        }
        if (this.offerTriggerOf(m) === 'unlock') this.maybeOffer(m);
        const cl = this.content.facility?.cleaning;
        if (cl && cl.missionId === m.def.id && this.cleaningUntil === null) {
          this.cleaningUntil = this.time + cl.windowSec;
          this.push({ t: this.time, type: 'facility', stage: 'cleaning' });
        }
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
      // T-170 공범 제안 시점(control-dpad §4-5): 원정 미션이 열린 뒤 자리에서 처음 일어날 때
      if (this.phase === 'day') for (const m of this.missions) if (m.state === 'open' && !m.blocked && this.offerTriggerOf(m) === 'leave_seat') { this.maybeOffer(m); break; }
    }
    // 자리 도착해 앉음 = 이동 구간 끝(η)
    const still = at && this.floor.player.stoppedAtCenter;
    if (still && !this.wasAtSeatStill) { this.tripEnd(); if (this.leftSeatAt !== null) this.tutorial('seatArrive'); }
    this.wasAtSeatStill = still;
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
    } else if (p.stoppedAtCenter) {
      // T-170(control-dpad §4-3): 사용 칸 1칸 보정 도착 → 시작. 그 밖에는 '멈추면 자동'(화장실 칸)만. 위험한 행동은 버튼(pressAction)
      const here = p.tile;
      const pend = this.pendingMission;
      if (pend && this.matchesSpot(pend, here) && pend.state === 'open' && !pend.blocked) this.startActivity(pend);
      else {
        if (pend) this.pendingMission = null;
        const auto = this.controls.autoStartOnStop.includes('restroom_stall');
        const cand = auto ? this.missions.find((m) => m.state === 'open' && !m.blocked && !this.seatMission(m) && this.startByOf(m) === 'auto_on_stop' && this.matchesSpot(m, here)) : undefined;
        if (cand) this.startActivity(cand);
      }
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
    const cl = this.content.facility?.cleaning;
    if (cl?.detourStall && cl.missionId === m.def.id && cl.detourStall.x === t.x && cl.detourStall.y === t.y) return true;
    return s.x === t.x && s.y === t.y;
  }

  private activityCtx(): { seen: boolean; elapsed: number } {
    return { seen: this.floor.gazeNow > 0, elapsed: this.activeMission?.startedAt !== null && this.activeMission ? this.time - (this.activeMission.startedAt ?? this.time) : 0 };
  }

  private startActivity(m: MissionRuntime): void {
    // zone_only: 드러나기 전 장소를 직접 톡해 도착해도 정상 시작(찾은 것으로 침)
    if (m.def.zoneEntry && !m.revealed) { m.revealed = true; this.push({ t: this.time, type: 'missionStage', id: m.def.id, stage: 'revealed' }); }
    this.floor.player.halt();
    // T-170: 칩이 목적지를 정하지 않으므로, 원정 미션 제한 시간은 자리를 뜬 순간부터(옛 tapMission과 같은 기준)
    if (m.startedAt === null) m.startedAt = m.def.awayFromDesk && !this.playerAtSeat ? (this.leftSeatAt ?? this.time) : this.time;
    m.state = 'active';
    if (this.guideState && (this.guideState.id === m.def.id)) this.guideOff('arrive');
    this.tripEnd();
    this.activeMission = m;
    this.pendingMission = null;
    this.activity = this.makeActivity(m);
    this.ensureRun(m);
    this.push({ t: this.time, type: 'missionStart', id: m.def.id });
    if (this.commitRule(m) === 'activity_start') this.commitMission(m);
    this.tutorial(`start:${m.def.id}`);
    if (this.offerTriggerOf(m) === 'start_activity') this.maybeOffer(m);
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
      this.push({ t: this.time, type: 'missionStage', id: m.def.id, stage: 'printStart' });
      // T-170: 프린터로 자동 이동 폐지 → 길 안내(집기는 프린터에서 행동 버튼)
      this.setGuide(m.def.id, this.missionTarget(m), this.controls.guideSec, 'auto');
      return;
    }
    this.push({ t: this.time, type: 'missionSuccess', id: m.def.id });
    if (m.def.completeAt === 'return_to_seat') {
      m.state = 'carry';
      // 1일차 ⑦: 들고 돌아갈 때 '멈추면 앉아요' + 자리로 길 안내 자동
      if (this.content.tutorialIds.includes('tut_sit')) { this.setGuide(`carry:${m.def.id}`, this.content.playerSeat, Infinity, 'auto'); }
    } else this.completeMission(m);
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
          if (this.packProgress >= L.packSec) { this.setLeaveStage('walk'); this.autoLeaveGuide(); }
        }
        break;
      case 'walk': {
        const t = p.tile, g = L.gate.spot;
        // T-170: 게이트 사용 칸에서 멈추거나 게이트 쪽으로 밀면(범프 = 멈춤) 게이트 단계
        if (p.stoppedAtCenter && t.x === g.x && t.y === g.y) { this.setLeaveStage('gate'); this.gateTime = 0; this.tutorial('gateStart'); this.tripEnd(); }
        break;
      }
      case 'gate': {
        const t = p.tile, g = L.gate.spot;
        if (t.x !== g.x || t.y !== g.y) { this.setLeaveStage('walk'); break; }
        if (this.gateHeldByTalk()) break; // D-107: 말걸기 중 막대 정지(탭은 맞장구로 가므로 시도 소모 없음)
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

  /** BUG-019(T-164): 같은 사람이 이미 층을 걷고 있어 미룬 방해(그 사람이 퇴장하면 같은 단계 안에서 시작) */
  private deferredInts: DayInterruptDef[] = [];

  /** 이 방해가 새로 등장시키는(addNpc) 사람이 이미 층에서 걷는 중인가 — 같은 인물(인사팀 등)이 두 곳에 동시에 나오지 않게 */
  private spawnActorBusy(int: DayInterruptDef): boolean {
    if (!['walker', 'walker_talk', 'countdown'].includes(int.category)) return false;
    const e = int.effect;
    const ids: string[] = [];
    for (const k of ['patrolId', 'leaveVariant']) if (typeof e[k] === 'string') ids.push(e[k] as string);
    for (const k of ['patrolVariants']) if (Array.isArray(e[k])) for (const x of e[k] as unknown[]) if (typeof x === 'string') ids.push(x);
    const actors = new Set(ids.map((id) => this.content.patrols[id]?.actorId).filter((a): a is string => !!a));
    return this.floor.npcs.some((n) => !!n.def.actorId && actors.has(n.def.actorId) && !n.def.seated && !n.ended);
  }

  private deferredStep(): void {
    if (this.deferredInts.length === 0) return;
    const ph = this.phase;
    this.deferredInts = this.deferredInts.filter((int) => int.phase === ph);
    for (const int of this.deferredInts.slice()) {
      if (this.spawnActorBusy(int)) continue;
      this.deferredInts.splice(this.deferredInts.indexOf(int), 1);
      this.startInterrupt(int);
    }
  }

  private startInterrupt(int: DayInterruptDef): void {
    const pat = this.content.patrols;
    const e = int.effect;
    let started = true;
    if (this.spawnActorBusy(int)) {
      // 같은 사람이 아직 다른 순찰 중 → 퇴장 뒤로 미룸(intState는 그때 기록). 단계가 바뀌면 버림
      if (!this.deferredInts.includes(int)) this.deferredInts.push(int);
      if (!this.intState.has(int.id)) this.intState.set(int.id, { started: this.time, count: 0, lastAt: -Infinity });
      return;
    }
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
        // 통화 기회는 자리에 앉아 있을 때만(T-164: 순회 목적지 대기 중 통화 → 자리 비움이 4초 늘어 퇴근 전 복귀를 못 지킴). 순회 중이면 복귀 뒤로 미룸
        if (npc && npc.mode === 'wait' && npc.def.seated) { npc.startPhone(numOr(b['durationSec'], 3)); this.scriptDone.add(i); }
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
        // T-162: 입장 지연으로 QTE가 안전장치(freezeMaxSec + 3)에서 먼저 시작되면 결과 처리의 release()가 걷는 중이라 무시됨 →
        // 뒤늦게 인사 지점(holdForQte)에 닿아 영원히 멈추고 근무 시계도 멈췄음(대표님 날 순회 미출발의 원인 중 하나). QTE가 끝났으니 바로 놓아 줌
        if (npc && npc.mode === 'hold') npc.release();
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

  /** T-170 제안 시점(npcs.accomplice.offer.trigger): forced = 열림, 원정 = 자리에서 일어날 때, 자리 미션 = 시작할 때 */
  private offerTriggerOf(m: MissionRuntime): string | null {
    const acc = this.content.accomplice;
    const o = acc?.offers.find((x) => x.eventId === m.def.id);
    if (!acc || !o) return null;
    const tr = acc.offerTrigger ?? {};
    if (o.forced) return tr['forced'] ?? 'unlock';
    return tr[m.def.id] ?? (m.def.awayFromDesk ? 'leave_seat' : 'start_activity');
  }

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
    // T-170: 강제 제안은 열리는 순간부터 확정 때까지(다른 제안·얼음에 막혔으면 다시 시도)
    if (acc && !this.offer && !this.follower && this.phase === 'day') {
      for (const m of this.missions) if (m.state === 'open' && !this.offered.has(m.def.id) && this.offerTriggerOf(m) === 'unlock') { this.maybeOffer(m); break; }
    }
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
    // T-164: 이미 자리에 돌아와 앉는 중(stop_tour_sit)이거나, 목적지 칸이 아닌 곳의 멈춤(걷는 중 말걸기 뒤 대기 등)에서는 끊지 않음
    if (npc.stopId === 'stop_tour_sit' || npc.waypointIndex >= npc.def.waypoints.length - 1) return;
    const left = this.content.dayPhaseSec - this.dayTime;
    if (left > must + 25) return;
    const seatWp = npc.def.waypoints[npc.def.waypoints.length - 1]!;
    const here = tileOf(npc);
    const cwp = npc.def.waypoints[npc.waypointIndex];
    if (!cwp || cwp.x !== here.x || cwp.y !== here.y) return;
    const path = findPath(this.floor.map, here, { x: seatWp.x, y: seatWp.y });
    const rt = def.returnTellSec ?? 0;
    // 복귀 = 복귀 전조 + 걷기 + 모퉁이 전조(조건부지만 상한으로 모두 셈) + 앉기
    let corners = 0;
    if (path) for (let i = 2; i < path.length; i++) if (path[i]!.x - path[i - 1]!.x !== path[i - 1]!.x - path[i - 2]!.x || path[i]!.y - path[i - 1]!.y !== path[i - 1]!.y - path[i - 2]!.y) corners++;
    const ret = rt + (path ? path.length - 1 : 0) / Math.max(0.1, npc.def.speedTilesPerSec) + corners * (npc.def.turnTellSec ?? npc.def.tellSec) + (def.sitSec ?? 0);
    if (left > must + ret) return;
    // BUG-018: 바로 걷지 않고 복귀 전조(몸 돌림, 시선 없음) 뒤 출발
    const back: NpcDef = {
      ...npc.def, id: `${npc.def.id}_back`,
      waypoints: [{ x: here.x, y: here.y, waitSec: 0, lookChance: 0, ...(rt > 0 ? { departTellSec: rt, stopId: 'stop_tour_return' } : {}) }, seatWp],
    };
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
            if (st!.endTellShown.has(i)) return;
            const n = st!.npc!;
            if (n.waypointIndex !== this.stopWpIndex(st!.route, i, true)) return;
            if (s.endTell && n.mode !== 'walk') {
              st!.endTellShown.add(i);
              this.push({ t: this.time, type: 'tourEndTell', npc: n.def.id, ...(s.endTell.lineKey ? { lineKey: s.endTell.lineKey } : {}), ...(s.endTell.sfx ? { sfx: s.endTell.sfx } : {}) });
            } else if (!s.endTell && n.mode === 'tell' && n.tellKind === 'turn' && def.returnTellLineKey) {
              // endTell 없는 목적지의 복귀 전조(BUG-018) 말풍선
              st!.endTellShown.add(i);
              this.push({ t: this.time, type: 'tourEndTell', npc: n.def.id, lineKey: def.returnTellLineKey });
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
      // T-162: 통화(phone, 시선 없음) 중이면 끝날 때까지 기다리되, 이번 스텝이 출발 마감의 마지막 기회면 통화를 끊고 출발(계획 = 출발).
      // 돌아보기·전조 중에는 마감이어도 끊지 않음(시선 규칙 유지)
      const lastChance = this.dayTime + this.content.floor.rules.fixedStepSec > latest;
      if (!seat || seat.suppressed || !(seat.mode === 'wait' || (seat.mode === 'phone' && lastChance))) continue;
      const route = def.routes[st.next] ?? def.routes[def.routes.length - 1] ?? [];
      if (route.length === 0) { st.next++; continue; }
      const sw = seat.def.waypoints[0]!;
      // BUG-018: 일어나기·목적지 대기·복귀 전조의 끝은 모두 '걷기 방향 몸 돌림 전조'(departTellSec, 시선 없음, 화면 밖 화살표 선행)로 끝난다
      const rt = def.returnTellSec ?? 0;
      const wps: WaypointDef[] = [
        { x: sw.x, y: sw.y, waitSec: def.standTellSec, departTellSec: def.standTellSec, lookChance: 0, coneOff: true, stopId: 'stop_tour_stand', ...(sw.facing ? { facing: sw.facing } : {}) },
      ];
      for (const s of route) {
        wps.push({
          x: s.tile.x, y: s.tile.y, waitSec: s.waitSec, lookChance: s.lookChance ?? 0, stopId: `stop_tour_${s.id}`,
          ...(!s.endTell && rt > 0 ? { departTellSec: rt } : {}),
          ...(s.facing ? { facing: s.facing } : {}),
        });
        // 복귀 전조(endTell): 같은 칸에서 sec 동안 시선 없이 몸 돌림 전조
        if (s.endTell) wps.push({ x: s.tile.x, y: s.tile.y, waitSec: s.endTell.sec, departTellSec: s.endTell.sec, lookChance: 0, coneOff: true, stopId: `stop_tour_end_${s.id}`, ...(s.facing ? { facing: s.facing } : {}) });
      }
      // 자리 도착 → 앉기(sitSec, 콘 없음, T-155). 없으면 바로 앉은 순찰로 교체
      wps.push({ x: sw.x, y: sw.y, waitSec: def.sitSec ?? 0, lookChance: 0, ...(def.sitSec ? { coneOff: true, stopId: 'stop_tour_sit', ...(sw.facing ? { facing: sw.facing } : {}) } : {}) });
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
      st.cutShort = false;
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
      if (!inZ) { this.greetSkipUntilLeave = false; return; }
      if (this.greetSkipUntilLeave) return;
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
      this.greetHeld = 0;
      if (g.lineKey) this.push({ t: this.time, type: 'say', npc: n.def.id, key: g.lineKey, sec: 1.8 });
      return;
    }
    const greeter = this.floor.findNpc((n) => n.def.actorId === g.greeterActorId);
    if (!greeter || greeter.def.seated) { this.greetState = 'idle'; return; }
    if (this.greetState === 'greeting') {
      if (greeter.mode === 'hold') this.greetHeld += dt;
      const cap = this.content.greeting?.holdMaxSec;
      if (cap !== undefined && greeter.mode === 'hold' && this.greetHeld >= cap) {
        greeter.release(); this.greetState = 'returning'; this.greetSkipUntilLeave = inZ;
        return;
      }
      if (inZ) { this.greetTimer = 0; return; }
      this.greetTimer += dt;
      if (this.greetTimer >= g.resumeDelaySec && greeter.mode === 'hold') { greeter.release(); this.greetState = 'returning'; }
    }
  }

  // ── T-151 성별 시설 ─────────────────────────────────────

  private playerInMineFacility(): boolean {
    if (this.facMine.size === 0) return false;
    const t = this.floor.player.tile;
    return this.facMine.has(t.y * this.floor.map.width + t.x);
  }

  /** C4 청소 중인가 */
  get cleaningActive(): boolean { return this.cleaningUntil !== null && this.time < this.cleaningUntil; }
  /** C4 청소 남은 초(표지·칩 표시) */
  get cleaningLeftSec(): number { return this.cleaningUntil === null ? 0 : Math.max(0, this.cleaningUntil - this.time); }

  /** 청소 중 이 미션의 목적지: 우회 칸 / undefined = 평소대로 / null = 갈 곳 없음(기다리기) */
  private cleaningDetourFor(m: MissionRuntime): Tile | undefined | null {
    const cl = this.content.facility?.cleaning;
    if (!cl || cl.missionId !== m.def.id || !this.cleaningActive || this.playerInMineFacility()) return undefined;
    return cl.detourStall ?? null;
  }

  private cleaningToast(): void {
    const cl = this.content.facility?.cleaning;
    if (cl) this.push({ t: this.time, type: 'toast', key: cl.signKey });
  }

  /** 다른 쪽 시설(문·안) 탭 = 안내만, 경로 없음. 청소 중인 내 화장실 탭 = 표지 안내 */
  private facilityTapBlocked(tx: number, ty: number): boolean {
    const fac = this.content.facility;
    if (!fac) return false;
    const i = ty * this.floor.map.width + tx;
    if (this.facOther.has(i)) { this.push({ t: this.time, type: 'toast', key: fac.otherDoorHintKey }); return true; }
    if (this.cleaningActive && !this.playerInMineFacility() && fac.restroom.mine.tiles.some((t) => t.x === tx && t.y === ty)) { this.cleaningToast(); return true; }
    return false;
  }

  /** 말걸기 전조 중 내 쪽 시설 문을 지나면 취소(D-054 시설 버전, S-05: 말 걸던 인물은 제자리 정지 후 원래 경로) */
  private facilityTalkCancel(): void {
    const fac = this.content.facility;
    if (!fac?.talkCancelAtMineDoor || !this.playerInMineFacility()) return;
    for (const n of this.floor.npcs) {
      if (n.mode === 'tell' && n.tellKind === 'talk' && n.cancelTalkInPlace(this.content.facility?.talkCancelNpcHoldMinSec ?? 0)) {
        this.floor.pushEvent({ t: this.time, type: 'talkCancel', npc: n.def.id, reason: 'door' });
        this.push({ t: this.time, type: 'say', npc: n.def.id, key: fac.talkCancelLineKey, sec: 1.4 });
      }
    }
  }

  /** 지금 본부장 화장실 들름 중인 NPC와 상태(표시: 같은/다른 성별 표식, 머리 위 '!', 문 '!') */
  facilityStopView(): { npc: PatrolNpc; relation: 'same' | 'other'; stage: 'tell' | 'walk' | 'inside'; cue: boolean; door: Tile } | null {
    const st = this.content.facility?.stop;
    if (!st || !this.facRun) return null;
    return { npc: this.facRun.npc, relation: st.relation, stage: this.facRun.stage, cue: this.facCueLeft > 0, door: st.target.door };
  }

  /** INT-10 facilityStop: 길목 노드 → (전조 tellSec) → 문 → 세면대 insideSec → 문 → 노드 → 원래 경로 */
  private facilityStopStep(): void {
    const st = this.content.facility?.stop;
    if (!st) return;
    const inTarget = (t: Tile) => st.target.tiles.some((q) => q.x === t.x && q.y === t.y);
    const run = this.facRun;
    if (run) {
      const npc = run.npc;
      if (!this.floor.npcs.includes(npc)) { this.facRun = null; return; }
      const nt = tileOf(npc);
      const inside = inTarget(nt);
      if (run.stage === 'tell' && npc.waypointIndex >= 1) run.stage = 'walk';
      if (inside && run.stage !== 'inside') {
        run.stage = 'inside';
        npc.suppressed = true; // 시설 안: 층 콘 끔 + 콘 그래픽 없음(S-01, insideCone.renderCone false)
        this.push({ t: this.time, type: 'facility', stage: 'enter', relation: st.relation, npc: npc.def.id });
        if (st.relation === 'other' && st.awayToastKey) this.push({ t: this.time, type: 'toast', key: st.awayToastKey });
      } else if (!inside && run.stage === 'inside') {
        npc.suppressed = false;
        this.push({ t: this.time, type: 'facility', stage: 'exit', relation: st.relation, npc: npc.def.id });
        this.facRun = null;
        return;
      }
      // C3 판정만(콘 그래픽 없음): 같은 성별 날, 내 화장실 세면대·바닥(칸 제외)에서 판정용 시선에 걸리면 한 번만
      if (run.stage === 'inside' && st.relation === 'same' && !run.seen) {
        const p = this.floor.player;
        const pt = p.tile;
        const inStall = pt.x === st.target.stall.x && pt.y === st.target.stall.y;
        if (inTarget(pt) && !inStall && canSee(this.floor.map, npc.pos, npc.facing, st.cone, p.pos)) {
          run.seen = true;
          if (st.suspicionOnce > 0) addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, st.suspicionOnce);
          this.facCueLeft = Math.max(st.cueMinSec, st.stopSec);
          if (st.stopSec > 0) p.forceTalk(st.stopSec);
          this.push({ t: this.time, type: 'facility', stage: 'seen', relation: 'same', npc: npc.def.id });
          if (st.meetLineKey) this.push({ t: this.time, type: 'say', npc: npc.def.id, key: st.meetLineKey, sec: Math.max(st.stopSec, st.cueMinSec) });
          if (st.reactionKey) this.push({ t: this.time, type: 'toast', key: st.reactionKey });
          if (this.floor.suspicion.value >= this.content.floor.rules.suspicion.max) this.caughtBy = 'director';
        }
      }
      return;
    }
    if (this.phase !== 'day' || this.facStops >= st.maxPerDay || this.frozenAll) return;
    if (st.skipIfCeo && this.ceoOnFloor) return;
    const dt = this.content.floor.rules.fixedStepSec;
    for (const npc of this.floor.npcs) {
      if (npc.def.actorId !== 'director' || npc.mode !== 'walk' || npc.def.seated) continue;
      // T-157 trigger enter_node_tile: 노드 칸(floor) 기준. 'center'면 기존(노드 중심 통과)
      const node = st.triggerMode === 'tile'
        ? st.nodes.find((q) => Math.floor(npc.x) === q.x && Math.floor(npc.y) === q.y)
        : st.nodes.find((q) => Math.hypot(npc.x - (q.x + 0.5), npc.y - (q.y + 0.5)) <= npc.def.speedTilesPerSec * dt + 1e-6);
      if (!node) continue;
      const d = npc.def;
      const rest = d.waypoints.slice(npc.waypointIndex + 1);
      const sink = st.target.sink ?? st.target.stall;
      const at = (t: Tile, waitSec: number, extra: Partial<WaypointDef> = {}): WaypointDef => ({ x: t.x, y: t.y, waitSec, lookChance: 0, ...extra });
      const wps: WaypointDef[] = [
        at(node, st.tellSec), at(st.target.door, 0), at(sink, st.insideSec, st.sinkFacing ? { facing: st.sinkFacing } : {}), at(st.target.door, 0), at(node, 0), ...rest,
      ];
      const { spawnTellSec: _s, ...base } = d;
      const nd: NpcDef = { ...base, waypoints: wps, loop: false, despawnAtEnd: d.despawnAtEnd === true || d.loop === false };
      const nn = this.floor.replaceNpc(npc, nd);
      this.facRun = { npc: nn, stage: 'tell', seen: false };
      this.facStops++;
      this.push({ t: this.time, type: 'facility', stage: 'tell', relation: st.relation, npc: nn.def.id });
      if (st.relation === 'same') this.tutorial('facilityTell:same');
      return;
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
      if (e.type === 'bump') {
        // M9: 다른 쪽 시설 문·청소 중인 내 화장실 문에 부딪히면 기존 안내 토스트
        const [vx, vy] = DIR_VEC[e.dir];
        this.facilityTapBlocked(e.x + vx, e.y + vy);
      } else if (e.type === 'closeCall') {
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
