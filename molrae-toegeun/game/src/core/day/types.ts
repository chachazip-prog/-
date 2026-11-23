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
  readonly timeSec: number;
  readonly clockMin: number;
  /** 잡은 사람(적발 리액션) */
  readonly caughtBy: string | null;
  readonly reactionKey: string | null;
}
