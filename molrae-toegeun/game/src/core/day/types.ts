/**
 * 하루(한 판) 시뮬레이션 입력. src/content/buildDay.ts가 game/data/*.json v2를 조립해 만든다(QA는 헤드리스로 같은 함수 사용).
 * 수치는 모두 데이터에서 오고, 이 파일에는 모양만 있다.
 */
import type { CameraRules } from '../camera';
import type { FloorContent } from '../floorSim';
import type { Tile } from '../grid';
import type { NpcDef } from '../patrol';
import type { Dir } from '../vision';

export type MissionState = 'locked' | 'open' | 'active' | 'carry' | 'done' | 'failed';
export type Mechanic = 'pour_tap_stop' | 'trip_safe_zone' | 'nap_tap_toggle' | 'screen_swap_tap' | 'rhythm_tap';

export interface MissionDef {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  readonly iconSprite: string;
  readonly mechanic: Mechanic;
  readonly unlockAtSec: number;
  /** 행동 위치(타일) */
  readonly spot: Tile;
  readonly startsAt: 'arrive_spot' | 'chip_tap_at_seat';
  readonly completeAt: 'return_to_seat' | 'on_success';
  readonly awayFromDesk: boolean;
  readonly timeLimitSec: number;
  readonly reward: { readonly slackPoints: number; readonly snackStock?: number };
  readonly failPenalty: number;
  readonly timeoutPenalty: number;
  /** mechanic별 params (직급 덮어쓰기 적용 후) */
  readonly params: Readonly<Record<string, unknown>>;
  readonly tutorialId?: string;
  /** 공범 합류 시 적용(events[].accompliceEffect, T-136: 제안 수락 순간 적용). cupsRequired = 덮어쓰기, bitesRequiredMultiplier = 한 입 수 배율 */
  readonly accompliceEffect?: { readonly cupsRequired?: number; readonly bitesRequiredMultiplier?: number };
}

export interface GateDef {
  readonly spot: Tile;
  readonly guardActorId: string;
  readonly markerCycleSec: number;
  readonly windowRatio: number;
  readonly maxAttempts: number;
  readonly beepSuspicion: number;
  readonly beepAttractsGuardLook: boolean;
  /** 처음 N번 시도의 창 배율(1일차 튜토리얼) */
  readonly firstTryWindowScale: number;
  readonly firstTryAttempts: number;
  /** 판정 창 중심(T-134 ③, 기본 0.5) */
  readonly windowCenter?: number;
  /** 게이트 사용 칸 대기 = 위장(T-134 ③ waitingCountsAsDisguised). true면 도착 직후 위장 안착 시간 없음(BUG-012) */
  readonly waitingCountsAsDisguised?: boolean;
}

export interface LeaveDef {
  readonly packSec: number;
  readonly packTapPauses: boolean;
  readonly gate: GateDef;
  readonly exitSpot: Tile;
  readonly elevatorWaitSecRange: readonly [number, number];
  readonly safeAfterGate: boolean;
  readonly reward: number;
  readonly earlyLeaveBonusPoints: number;
}

export interface DayInterruptDef {
  readonly id: string;
  readonly category: string;
  readonly nameKey: string;
  readonly phase: 'day' | 'leave';
  /** 근무 구간 기준 시각(초). 0 = 하루 종일(근접형), -1 = trigger로만 */
  readonly atSec: number;
  readonly trigger?: string;
  /** interrupts.json trigger 원본 */
  readonly triggerDef: Readonly<Record<string, unknown>>;
  readonly tell: { readonly sec: number; readonly textKey?: string };
  readonly effect: Readonly<Record<string, unknown>>;
  readonly cooldownSec: number;
  readonly maxPerDay: number;
}

export interface ActorInfo {
  readonly id: string;
  readonly nameKey: string;
  /** boss | gate | obstruct | assist | inspect | background */
  readonly role: string;
  /** 사원증 줄 색 역할(D-037): boss / guard / snitch / accomplice / hr / background */
  readonly lanyard: string;
  readonly reactionKeys: readonly string[];
  /** 정의로운 동료 발견 규칙 */
  readonly spot?: { readonly dwellSec: number; readonly triggerStates: readonly string[]; readonly startsInterrupt: string };
  readonly talkEnabledBy?: string;
  readonly talkOnlyWhilePlayerAway?: boolean;
  readonly talkOnlyWhen?: string;
  /** 말걸기 전조 말풍선 문구 키 / 피했을 때 혼잣말 키 (sim.talk, T-132) */
  readonly warnLineKey?: string;
  readonly dodgedLineKey?: string;
  readonly hierarchy?: Readonly<Record<string, unknown>>;
  /** 아트 캐릭터 키(bosses/npcs.json spriteKey, T-134) */
  readonly spriteKey?: string;
}

/** 배경 동료(D-049). 메카닉 없음(시선·말걸기 없음), 표시 전용 */
export interface BackgroundDef {
  readonly sprite: string;
  readonly behavior: 'sit' | 'stand' | 'walk';
  /** 앉은·선 동안 가끔 재생할 프레임(아트 프레임 접미사) */
  readonly idleAnims: readonly string[];
  readonly idleAnimEverySecRange: readonly [number, number];
  readonly npc: NpcDef;
}

export interface ScriptedBeat {
  readonly type: string;
  readonly [k: string]: unknown;
}

/** 인사 QTE(bosses.ceo.greetingQte). INT-09·INT-11 공용 */
export interface QteDef {
  readonly preCueSecRange: readonly [number, number];
  readonly windowSec: number;
  readonly maxPressSec: number;
  readonly earlyPenalty: number;
  readonly missPenalty: number;
  readonly longPressPenalty: number;
}

/** 대표님 순시(INT-09, bosses.ceo.visit). buildDay가 그날 순시가 있을 때만 채운다 */
export interface CeoVisitDef {
  /** 'scheduled'(수요일 정기) | 'random'(시드로 미리 정해진 랜덤) */
  readonly kind: 'scheduled' | 'random';
  /** 예정 시각(근무 구간 초). 이후 플레이어가 자리에 앉아 있는 첫 순간 시작 */
  readonly atSec: number;
  readonly patrolId: string;
  readonly tellSec: number;
  readonly tellTextKey?: string;
  readonly greetStop: string;
  readonly talkStop: string;
  readonly freezeMaxSec: number;
  readonly moveStartInstantSuspicion: number;
  /** 얼음 중 이동·행동 상승률 = movingPerSec × 대표님 gazeMultiplier */
  readonly freezeGazeMultiplier: number;
  readonly talkWindowSec: number;
  readonly talkSlackMultiplier: number;
  readonly exitResumeDelaySec: number;
  readonly qte: QteDef;
  /** 첫 순시(28일차) QTE 창 배율, 전조 슬로모 */
  readonly qteWindowScale: number;
  readonly slowMoTell: number;
  /** 눈도장(생존) 조건·보상 */
  readonly survivalMaxGain: number;
  readonly survivalRequiresQte: boolean;
  readonly eyeContactPoints: number;
  readonly reactionEarly?: string;
  readonly reactionLong?: string;
}

/** 엘리베이터 대표님(INT-11). 발생 여부는 시드로 미리 정해 둔다(난이도·연출 확률) */
export interface CeoElevatorDef {
  readonly patrolId: string;
  readonly tellSec: number;
  readonly tellTextKey?: string;
  readonly qte: QteDef;
  readonly successPoints: number;
  readonly failSuspicion: number;
  readonly successLineKey?: string;
  readonly failLineKey?: string;
}

/** 공범 동료 제안·합류(INT-12, npcs.accomplice.offer/effects) */
export interface AccompliceDef {
  /** 이 날 제안할 미션 id와 강제 여부(1~15일차 = days.scripted, 16일차~ = 시드 판정 결과) */
  readonly offers: readonly { readonly eventId: string; readonly forced: boolean }[];
  readonly offerSec: number;
  readonly offerTextKeys: Readonly<Record<string, string>>;
  readonly rewardMultiplier: number;
  readonly suspicionGainMultiplier: number;
  readonly hitboxIncludesAccomplice: boolean;
  readonly lookoutCoughLeadSec: number;
  readonly lookoutRadiusTiles: number;
  readonly followGapTiles: number;
  readonly seatPatrolId: string;
  readonly speedTilesPerSec: number;
  readonly reactionKey?: string;
  /**
   * 제안이 끝나는 '미션 확정' 시점(npcs.accomplice.offer.missionCommit, T-136 ①).
   * 원정 미션(awayFromDesk) = activity_start, 자리 미션 = first_input(간식 첫 입). 없으면 둘 다 activity_start
   */
  readonly missionCommit?: { readonly awayFromDesk: 'activity_start' | 'first_input'; readonly atDesk: 'activity_start' | 'first_input' };
  /** 확정 순간 제안 종료(forced 포함). false면 forced는 활동 시작(원정)·완료/실패까지 유지(T-133 동작) */
  readonly endsAtMissionCommit?: boolean;
}

/** 위계 연쇄 H1·H2: 본부장이 구역에 들어오면 팀장이 나와 인사(INT-10 effect.teamLeadGreeting) */
export interface GreetingDef {
  readonly bossActorId: string;
  readonly greeterActorId: string;
  readonly zoneId: string;
  readonly greetSpot: { readonly x: number; readonly y: number };
  readonly lineKey?: string;
  readonly resumeDelaySec: number;
}

/** 튜토리얼 경로 힌트(maps.playerRoutes) */
export interface RouteDef {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly via: readonly { readonly x: number; readonly y: number }[];
}

export interface DayContent {
  readonly day: number;
  readonly seed: string;
  readonly rankId: string;
  /** 직급 내 진행도(0~1) */
  readonly t: number;
  readonly weekday: number;
  readonly titleKey: string;
  readonly floor: FloorContent;
  readonly camera: CameraRules;
  readonly spots: Readonly<Record<string, { readonly tile: Tile; readonly facing?: Dir }>>;
  readonly zones: readonly { readonly id: string; readonly nameKey: string; readonly rect: readonly [number, number, number, number]; readonly outsideOffice?: boolean }[];
  readonly playerSeat: Tile;
  /** 엄폐 칸(maps.coverSpots, 바닥 반짝임 표시용) */
  readonly coverSpots: readonly Tile[];
  readonly introSec: number;
  readonly dayPhaseSec: number;
  readonly clock: {
    readonly startMin: number; readonly dayEndMin: number; readonly leaveStartMin: number;
    readonly leaveMinPerSec: number; readonly earlyLeaveBeforeMin: number; readonly overtimeAtMin: number;
  };
  readonly work: { readonly fillPerSec: number; readonly max: number; readonly quota: number };
  readonly missions: readonly MissionDef[];
  readonly missionsRequired: number;
  readonly leave: LeaveDef;
  readonly interrupts: readonly DayInterruptDef[];
  /** 이 날 쓸 수 있는 모든 순찰(런타임 등장·thenPatrol 교체용), id → NpcDef */
  readonly patrols: Readonly<Record<string, NpcDef>>;
  readonly actors: Readonly<Record<string, ActorInfo>>;
  /** 배경으로만 앉아 있는 액터(상호작용 없음) */
  readonly ambientActors: readonly string[];
  readonly background: readonly BackgroundDef[];
  readonly scripted: readonly ScriptedBeat[];
  readonly tutorialIds: readonly string[];
  readonly scoring: {
    readonly closeCallBonusPoints: number;
    readonly snackStockStart: number;
    readonly snackStockMax: number;
    readonly star3PeakBelow: number;
    readonly starMultiplier: readonly number[];
    readonly slackPointsPerWon: number;
    readonly salaryBase: number;
  };
  readonly poseByZone: Readonly<Record<string, string>>;
  /** 결과 화면 표시 직후 탭 무시(rules.input.resultInputGuardSec, BUG-006) */
  readonly resultInputGuardSec: number;
  /** 무음 대응 시각 신호(rules.visualCues, 표시 전용 원본) */
  readonly visualCues: Readonly<Record<string, unknown>>;
  // ── T-133 확장(선택 필드: 손으로 만든 DayContent와 호환) ──
  /** 대표님 순시(없으면 순시 없는 날) */
  readonly ceoVisit?: CeoVisitDef;
  /** 엘리베이터 대표님(이 날 발생이 확정된 경우만) */
  readonly ceoElevator?: CeoElevatorDef;
  readonly accomplice?: AccompliceDef;
  readonly greeting?: GreetingDef;
  readonly routes?: readonly RouteDef[];
  /** 출근 준비 화면 표시용 */
  readonly prep?: { readonly ceoPassAvailable: boolean };
  /** 플레이어 아트 키(rules.characters.playerSpriteKey, T-134) */
  readonly playerSpriteKey?: string;
  /** 이어하기(rules.continueAd) */
  readonly continueAd?: { readonly resumeSuspicion: number; readonly submitScoreToLeaderboard: boolean };
  /** 적발 컷인 길이(초, rules.caughtCutin.durationSec, T-136). 플레이 상태라 광고 없음 */
  readonly caughtCutinSec?: number;
  /** H7 런타임 보조(days.generator.dayInterrupts.h7, T-136 ④) */
  readonly h7?: { readonly ceoStartWaitsWhileDirectorOnFloor: boolean; readonly directorStartWaitsWhileCeoOnFloor: boolean };
}

export type DayPhase = 'intro' | 'day' | 'leave' | 'ended';
export type LeaveStage = 'pack' | 'walk' | 'gate' | 'lobby' | 'elevator' | 'done';
export type DayOutcome = 'leave' | 'leave_short' | 'overtime' | 'caught';

export interface DayResult {
  readonly outcome: DayOutcome;
  readonly stars: number;
  readonly titleKey: string;
  readonly peakSuspicion: number;
  readonly work: number;
  readonly quota: number;
  readonly missionsDone: number;
  readonly missionsTotal: number;
  readonly missionsRequired: number;
  readonly slackPoints: number;
  readonly salary: number;
  /** 1판 길이(초) = 인트로(introSec) + 플레이 시간(FloorSim). GDD §1 '인트로 시작~결과 화면 진입'(BUG-013). 들킴 컷인·광고 시간은 제외 */
  readonly timeSec: number;
  readonly clockMin: number;
  /** 잡은 사람(적발 리액션) */
  readonly caughtBy: string | null;
  readonly reactionKey: string | null;
  // ── T-133 ──
  /** 이어하기 광고로 이어간 판(D-056: 리더보드 미제출) */
  readonly continued?: boolean;
  /** 대표님 눈도장 */
  readonly eyeContact?: boolean;
  /** 대표님 순시 결과: none(없음) / skipped(CEO 패스) / cancelled(끝까지 안 앉음) / done */
  readonly ceoVisit?: 'none' | 'skipped' | 'cancelled' | 'done';
}
