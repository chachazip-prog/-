# 몰래퇴근 데이터 스키마 v1 (schemaVersion: 1)

- 작성: mt-game-designer / T-101 / 2026-11-22
- 대상 파일: `game/data/*.json` (클라이언트는 `src/data/loader.ts`로 읽기만 함)
- 규칙(GDD)은 `design/gdd.md`. 이 문서는 **필드·타입·단위**만 정의합니다.

## 0. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 버전 | 모든 파일 최상위에 `schemaVersion: 1`. 필드 의미가 바뀌면 +1 하고 §9 변경 이력에 기록 |
| 시간 | **초(sec), 실수**. 클라이언트 내부가 ms라면 로드 시 ×1000. 필드명 접미사 `Sec` |
| 게이지·확률 | **0~1 실수**. 접미사 `Prob`(확률), `Multiplier`(배수), 게이지 값은 접미사 없음 |
| 거리 | **타일(16px)**. 접미사 `Tiles`. 속도는 `TilesPerSec` |
| 범위 | `[min, max]` 2원소 배열(`Range`). 균등 추첨. min==max면 고정값 |
| 시각 | `"HH:MM"` 문자열(게임 내 시계) |
| ID | 소문자 snake_case 문자열. 테이블 간 참조는 ID로만 |
| 문자열 | 화면 문구는 직접 넣지 않고 `*Key`로 `strings.ko.json` 참조 |
| `_comment`, `_toneNote`, `_designNote` | 사람용 메모. 런타임은 무시 |
| 난수 | 모든 추첨은 `core/rng.ts`의 시드 RNG. 시드 규칙은 §6 `generator` |

```ts
type Sec = number;            // 초
type Ratio01 = number;        // 0~1
type Prob = number;           // 0~1 확률
type Tiles = number;          // 16px 타일 단위
type Range<T = number> = [T, T];
type ClockHHMM = string;      // "17:52"
type StringKey = string;      // strings.ko.json 키
type RankId = 'intern' | 'staff' | 'assistant_manager' | 'manager'
  | 'deputy_general_manager' | 'general_manager' | 'executive';
type BossId = 'senior' | 'team_lead' | 'director' | 'ceo';
type NpcId = 'security_guard' | 'snitch' | 'accomplice' | 'hr_inspector';
type EventId = 'coffee' | 'restroom' | 'nap' | 'shopping' | 'snack' | 'leave';
```

### 0-1. 직급 스케일링 두 가지 방식

| 방식 | 사용 테이블 | 형식 | 해석 |
|---|---|---|---|
| **덮어쓰기** | `events` | `rankScaling[rankId] = { 필드: 값 }` | 해당 직급에서 `params`의 같은 필드를 교체. **누적 아님**(직급마다 독립). 없는 직급은 기본 `params` |
| **보간** | `bosses`, `npcs` | `rankScaling[rankId] = { start: {...}, end: {...} }` | 직급 내 진행도 `t`(§6)로 선형 보간. 숫자·Range는 원소별 보간, 정수 필드(`patrolsPerDay`, `maxPerDay`)는 반올림, 그 외 타입은 `t<0.5`면 start. 없는 직급은 기본값 |

키는 **점 경로**입니다. 예: `"tell.durationSec"`는 `boss.tell.durationSec`, `"gate.windowRatio"`는 `leave.params.phases`에서 `id == "gate"`인 원소의 `windowRatio`.

**불변식(로더에서 검사 권장)**
- 보간·덮어쓰기 후에도 모든 `tell.durationSec[0] ≥ rules.tell.minSec(0.4)`
- 모든 `fake.prob ≤ fake.capProb ≤ rules.fake.absoluteCapProb(0.35)`
- 모든 `doubleLook.prob ≤ doubleLook.capProb`

---

## 1. rules.json — 전역 규칙

```ts
interface RulesTable {
  schemaVersion: 1;
  input: {
    tapMaxPressSec: Sec;      // 0.25. 이보다 짧게 눌렀다 떼면 '탭'
    inputGraceSec: Sec;       // 0.12. 시선 시작 후 이 시간 동안은 홀드해도 의심 0 (입력 지연 보정)
  };
  suspicion: {
    max: Ratio01;                     // 1.0 도달 시 적발
    decayPerSec: number;              // 0.02/초
    decayRequires: 'released_and_unobserved';
    gazeStacking: 'max';              // 동시에 여러 시선이면 가장 높은 상승률 하나만 적용
    star3PeakBelow: Ratio01;          // 0.3. 하루 최고 의심도가 이 값 미만이면 ★3 조건 충족
    continueResetTo: Ratio01;         // 0.6. 이어하기 광고 후 의심도
  };
  work: { fillPerSec: number; fillOnlyInWorkSegment: boolean; max: Ratio01 };  // 0.04/초
  slack: { pointsPerSecInWorkSegment: number; eventRewardsAreSlackPoints: boolean }; // 10점/초
  tell: { minSec: Sec; mustHaveVisual: boolean; mustHaveAudio: boolean };  // 0.4
  fake: { absoluteCapProb: Prob; noConsecutiveFakes: boolean };            // 0.35
  day: {
    clockStart: ClockHHMM; finaleClockStart: ClockHHMM; clockEnd: ClockHHMM;
    introSec: Sec; targetDurationSec: Range<Sec>; tutorialDayDurationSec: Range<Sec>;
  };
  stars: { caught: 0; overtimeEnding: 1; leaveSuccess: 2; leaveSuccessAndPeakSuspicionBelow: 3 };
  salary: { starMultiplier: [number, number, number, number]; slackPointsPerWon: number };
  snackStock: { startPerDay: number; max: number; gainOnSnackSuccess: number };
  continueAd: { maxPerDay: number; restartCurrentEvent: boolean };
  assist: { consecutiveCaughtThreshold: number; suspicionGainMultiplier: number; showHint: boolean };
}
```

예시: `"suspicion": { "decayPerSec": 0.02, "star3PeakBelow": 0.3 }`

---

## 2. events.json — 이벤트

```ts
interface EventsTable { schemaVersion: 1; events: EventDef[] }

type Mechanic = 'pour' | 'sneak_walk' | 'nap_balance' | 'screen_swap' | 'rhythm_tap' | 'leave_sequence';

interface EventDef {
  id: EventId;
  nameKey: StringKey; descKey: StringKey;
  mvp: boolean;
  mechanic: Mechanic;
  input: 'hold' | 'tap';                // 주 입력
  location: 'desk' | 'pantry' | 'corridor' | 'office_to_lobby';
  awayFromDesk: boolean;                // true면 인사팀 점검 시 '부재'
  observable: boolean;                  // 상사 시선이 적용되는가
  isFinale: boolean;                    // 하루 마지막 이벤트(퇴근)
  unlockRank: RankId;
  timeLimitSec: Sec;                    // 초과 시 timeout
  expectedDurationSec: Sec;             // 일정 예산·시뮬 기준값(판정에 쓰지 않음)
  suspicionGainMultiplier: number;      // 이벤트 중 시선 상승률 배수
  accompliceAllowed: boolean;
  hrInspectionAllowed: boolean;
  reward: { slackPoints: number; snackStock?: number; earlyLeaveBonusPoints?: number };
  failPenalty: { suspicion: Ratio01; result?: 'overtime_ending' };
  timeoutPenalty: { suspicion: Ratio01; result?: 'overtime_ending' };
  params: PourParams | SneakWalkParams | NapParams | ScreenSwapParams | RhythmTapParams | LeaveParams;
  rankScaling: Partial<Record<RankId, Record<string, unknown>>>;   // 덮어쓰기 방식(§0-1)
  accompliceEffect?: { cupsRequired?: number; bitesRequiredMultiplier?: number };
  failReactionKeys: StringKey[];
  tutorialId: string;                   // strings 'tutorial.<id>'
}

interface PourParams {          // coffee
  pourRatePerSec: number;       // 0.45/초. 컵 수위 증가 속도
  targetBand: Range<Ratio01>;   // [0.75, 0.92]. 이 안에서 떼면 성공
  overflowAt: Ratio01;          // 1.0. 도달 즉시 실패
  cupsRequired: number;         // 1 (공범 수락 시 2)
}
interface SneakWalkParams {     // restroom
  walkSpeedTilesPerSec: number; // 2.0
  distanceTiles: Tiles;         // 6 (편도)
  hideSpotTiles: Tiles[];       // 책상 기준 화분 위치 [2, 4]
  hideSpotWidthTiles: Tiles;    // 0.8. 중심 ±0.4 안에서 멈추면 은신
  walkingSuspicionMultiplier: number;      // 1.2. 걷는 중 시선
  exposedStandSuspicionMultiplier: number; // 0.5. 은신처 밖에서 멈춘 채 시선
  insideRestSec: Sec;           // 3.0. 화장실 안(시선 없음)
  insideHoldPointsPerSec: number; // 20. 안에서 홀드 시 추가 점수
  urgentReturnSpeedMultiplier: number; // 1.5. 인사팀 급복귀 시
}
interface NapParams {
  fatigueStart: Ratio01;        // 1.0 → 0이 되면 성공
  fatigueRecoverPerSec: number; // 0.25 (홀드 중)
  headDropPerSec: number;       // 0.35 (홀드 중 고개 각도 증가)
  headRaisePerSec: number;      // 0.7 (떼는 중 감소)
  headThudAt: Ratio01;          // 1.0 도달 시 '쿵' 실패
  headDownSuspicionThreshold: Ratio01;  // 0.5. 떼고 있어도 이 이상이면 시선에 걸림
  headDownSuspicionMultiplier: number;  // 0.5
}
interface ScreenSwapParams {    // shopping
  cartFillPerSec: number;       // 0.3. 아이템 1개 = 진행도 1.0
  itemsRequired: number;        // 3 (마지막 1개는 결제 단계)
  checkoutHoldSec: Sec;         // 0.8. 마지막 결제는 연속 홀드
  checkoutResetsOnRelease: boolean;
  releaseShowsSpreadsheet: boolean;
}
interface RhythmTapParams {     // snack
  bitesRequired: number;        // 6
  minIntervalSec: Sec;          // 0.55. 직전 탭 이후 이보다 빠르면 소음
  perfectWindowSec: Range<Sec>; // [0.55, 1.1]. 링 초록 구간
  maxPressSec: Sec;             // 0.35. 이보다 길게 누르면 소음
  noiseSuspicion: Ratio01;      // 0.08 즉시 가산
  noiseShortensBossIdleTo: Sec; // 0.0. 소음 시 현재 상사 idle 잔여를 이 값으로(전조는 그대로 재생)
  biteUnderGazeSuspicion: Ratio01; // 0.12. 시선 중 한 입마다 즉시 가산
  perfectBonusPoints: number;   // 10
}
interface LeaveParams {
  clockStart: ClockHHMM;        // "17:52"
  gameMinutesPerSec: number;    // 1.0 (실제 1초 = 게임 1분)
  phases: LeavePhase[];
}
type LeavePhase =
  | { id: 'pack'; type: 'hold_progress'; holdSec: Sec }
  | ({ id: 'walk'; type: 'sneak_walk' } & Omit<SneakWalkParams, 'insideRestSec' | 'insideHoldPointsPerSec' | 'urgentReturnSpeedMultiplier'>)
  | { id: 'gate'; type: 'timing_tap'; npc: 'security_guard'; markerCycleSec: Sec; windowRatio: Ratio01;
      maxAttempts: number; beepSuspicion: Ratio01; earlyQuestionBeforeClock: ClockHHMM; earlyQuestionDelaySec: Sec }
  | { id: 'elevator'; type: 'wait_hold'; waitSec: Range<Sec>; doorCloseHoldSec: Sec; releaseIsSafe: boolean };
```

예시(축약):
```json
{ "id": "coffee", "mechanic": "pour", "params": { "pourRatePerSec": 0.45, "targetBand": [0.75, 0.92] },
  "rankScaling": { "manager": { "targetBand": [0.8, 0.9], "pourRatePerSec": 0.5 } } }
```

---

## 3. bosses.json — 상사

```ts
interface BossesTable { schemaVersion: 1; bosses: BossDef[] }

interface BossDef {
  id: BossId; nameKey: StringKey; codexKey: StringKey;
  tier: 1 | 2 | 3 | 4;                 // 위계. 높을수록 상위
  unlockRank: RankId;
  behavior: 'periodic' | 'seated_random' | 'patrol' | 'freeze_event';
  props: string[];                     // 아트 구분용 소품 ID (D-009, 외형 아닌 소품·실루엣)
  gaze: {
    type: 'facing' | 'cone' | 'global';
    suspicionPerSec: number;           // 홀드 중 시선에 걸리면 초당 의심 증가
    coneLengthTiles?: Tiles; coneAngleDeg?: number;
    deskWarnLeadSec?: Sec;             // cone이 책상에 닿기 N초 전 책상 테두리 깜빡(전조 보장)
    holdStartInstantSuspicion?: Ratio01; // CEO 얼음 중 누르기 시작하는 순간 즉시 가산
  };
  tell: { durationSec: Range<Sec>; visual: string; sfx: string; bgm?: 'stop' };
  timing: Record<string, number | Range>;  // behavior별(아래)
  fake: { prob: Prob; capProb: Prob; type?: 'recheck'; afterFakeSec?: Sec; tellSec?: Sec; lookSec?: Sec;
          visual?: string; sfx?: string };
  doubleLook: { prob: Prob; capProb: Prob; gapSec?: Sec; secondTellSec?: Sec; secondLookSec?: Range<Sec> };
  opportunity: null | {
    type: 'phone_call' | 'coffee_spill' | 'talk_to_team_lead';
    probPerCycle?: Prob; probPerPatrol?: Prob; durationSec?: Range<Sec>;
    gazeOff: boolean; visual?: string; endTellSec?: Sec; affects?: BossId[];
  };
  greetingQte?: { preCueSec: Range<Sec>; windowSec: Sec; maxPressSec: Sec;
                  earlyPenalty: Ratio01; missPenalty: Ratio01; longPressPenalty: Ratio01 };  // CEO 전용
  occurrence?: { scheduledWeekday: 0|1|2|3|4; randomChancePerDay: Prob; maxPerDay: number; skippableByAd: boolean };
  survival?: { maxSuspicionGain: Ratio01; requireQteSuccess: boolean; rewardSlackPoints: number; codexKey: StringKey };
  hierarchy: {
    suppressedBy: BossId[];            // 이 상사가 있으면 나의 시선 OFF
    suppressedState?: 'greeting' | 'frozen';
    suppresses?: BossId[];
    freezesNpcs?: NpcId[];
    resumeDelaySec: Sec;               // 상위 상사 퇴장 후 복귀까지(복귀 직후 첫 시선도 반드시 전조부터)
    receivesSnitchReport?: boolean;
    snitchForcedLook?: { tellSec: Sec; lookSec: Sec };
  };
  reactionKeys: StringKey[];
  rankScaling: Partial<Record<RankId, { start: Record<string, unknown>; end: Record<string, unknown> }>>; // 보간(§0-1)
}
```

`timing` 필드(behavior별)

| behavior | 필드 | 단위 | 의미 |
|---|---|---|---|
| periodic / seated_random | `idleSec: Range` | 초 | 등 돌리고 일하는 시간 |
| | `lookSec: Range` | 초 | 돌아보는 시간 |
| | `returnSec` | 초 | 다시 돌아서는 애니메이션(시선 OFF) |
| patrol | `walkSpeedTilesPerSec`, `corridorLengthTiles` | 타일 | 복도 통과 |
| | `stopProb`, `stopSec: Range`, `sweepTurnTellSec` | 확률/초 | 정지 후 좌우 둘러보기, 방향 전환 전 고개 돌림 전조 |
| | `patrolsPerDay: Range<int>` | 회 | 하루 순찰 횟수 |
| freeze_event | `freezeSec: Range`, `freezeMaxSec` | 초 | 얼음 구간(최대 5초) |
| | `talkWindowSec`, `talkSlackMultiplier` | 초/배수 | 팀장과 대화 = 기회 구간, 땡땡이 점수 배수 |
| | `exitSec` | 초 | 퇴장 연출 |

---

## 4. npcs.json — NPC

```ts
interface NpcsTable { schemaVersion: 1; npcs: NpcDef[] }

interface NpcDef {
  id: NpcId; nameKey: StringKey; codexKey: StringKey;
  role: 'gate' | 'obstruct' | 'assist' | 'inspect';
  mvp: boolean; unlockRank: RankId; firstDay: number;
  props: string[];
  spawn:
    | { type: 'event_phase'; eventId: EventId; phaseId: string }
    | { type: 'while_holding'; segments: ('work'|'event')[]; probPerHoldSec: Prob; maxPerDay: number;
        minDayTimeSec: Sec; requiresBoss: BossId; cooldownSec: Sec }
    | { type: 'event_offer'; eventIds: EventId[]; offerProb: Prob; offerSec: Sec; maxPerDay: number }
    | { type: 'day_chance'; dayChance: Prob; maxPerDay: number; allowedSegments: ('work'|'event')[];
        allowedEventFlag: 'hrInspectionAllowed'; notDuringCeo: boolean; notInFinale: boolean; minDayTimeSec: Sec };
  tell: null | { durationSec: Range<Sec>; visual: string; sfx: string };
  gaze: null | { type: 'global'; suspicionPerSec: number };
  params: Record<string, number | boolean | string>;
  counters: { id: string; input: 'tap' | 'hold' | 'release_continuous'; durationSec?: Sec | null;
              cost?: { snackStock: number }; result: string }[];
  frozenByCeo: boolean;
  reactionKeys: StringKey[];
  rankScaling: Partial<Record<RankId, { start: Record<string, unknown>; end: Record<string, unknown> }>>;
}
```

`probPerHoldSec`: 플레이어가 **홀드 중일 때 1초마다** 한 번 판정하는 확률(0.04 = 홀드 1초당 4%).

---

## 5. ranks.json — 직급

```ts
interface RanksTable { schemaVersion: 1; ranks: RankDef[] }
interface RankDef {
  id: RankId; order: number; nameKey: StringKey;
  dayRange: [number, number | null];   // null = 엔드리스
  contentTier: 'authored' | 'generated' | 'endless';
  mvp: boolean;
  starsToPromote: number | null;       // 직급 내 '날짜별 최고 별' 합계 기준
  maxStars: number | null;
  regularEventsPerDay: Range<number>;  // 퇴근 제외 일반 이벤트 수 (정수)
  workSegmentSec: Sec;                 // 업무 구간 1개 길이
  workQuota: Ratio01;                  // 업무 게이지 할당량
  salaryBase: number;                  // 월급 기준(원, 소프트 재화)
  bosses: Partial<Record<BossId, number>>;  // 등장 상사와 인스턴스 수
  npcs: NpcId[];
  eventPool: { eventId: EventId; weight: number }[];
  promotionTitleKey: StringKey | null;
}
```

---

## 6. days.json — 하루 구성

```ts
interface DaysTable { schemaVersion: 1; authoredDays: AuthoredDay[]; generator: DayGenerator }

interface AuthoredDay {
  day: number; rankId: RankId; weekday: 0|1|2|3|4; seed: string;  // "day-<n>" (core/rng.ts daySeed와 동일)
  titleKey: StringKey;
  tutorialIds: string[];
  workQuotaOverride?: Ratio01;         // 1일차 0.35
  bosses: Partial<Record<BossId, number>>;
  slots: ({ type: 'work'; sec: Sec } | { type: 'event'; eventId: EventId })[];  // 마지막은 반드시 leave
  scripted: ScriptedBeat[];
  npc: { accompliceOffer: boolean; snitch: boolean; hrInspector: boolean };
  ceo: 'none' | 'scheduled' | 'random';
  expectedDurationSec: Sec;            // intro + 슬롯 합 + 이벤트 expectedDuration (+튜토리얼 여유)
}
type ScriptedBeat =
  | { type: 'boss_look'; bossId: BossId; slot: number; atSec: Sec; tellSec: Sec; suspicionGainMultiplier: number }
  | { type: 'boss_opportunity'; bossId: BossId; opportunity: string; slot: number; atSec: Sec; durationSec: Sec }
  | { type: 'accomplice_offer'; eventId: EventId; forced: boolean }
  | { type: 'snitch_spawn'; slot: number; atSec: Sec; requiresHolding: boolean; fallbackAtSec: Sec }
  | { type: 'hr_inspection'; slot: number; trigger: 'restroom_inside_rest_start' };
```
- `slot`은 `slots` 배열 인덱스(0부터). `atSec`은 해당 슬롯 시작 기준.
- `generator`는 16일차 이후 생성 규칙(자연어+수식). 개발자는 `generateDay(day: number): AuthoredDay`를 구현해 같은 형태로 돌려주면 됩니다. RNG 스트림은 `"day-{day}-{stream}"`(plan / boss / npc / event)로 분리해, 한 요소를 고쳐도 다른 요소의 추첨이 밀리지 않게 합니다.
- `t = (day - dayRange[0]) / (dayRange[1] - dayRange[0])`, 엔드리스는 0.

---

## 7. strings.ko.json — 문구

```ts
interface StringsTable {
  schemaVersion: 1; locale: 'ko-KR';
  strings: Record<StringKey, string | string[]>;  // 배열 = 변형 대사(표시용 무작위)
}
```
- 치환자: `{name}`(플레이어 호칭, 기본 `ui.player_default_name`), `{n}`, `{total}`, `{time}`, `{rank}`, `{weekday}`
- 키 접두사: `ui.` `hud.` `result.` `ad.` `rank.` `day.` `event.` `boss.` `npc.` `tutorial.` `react.` `codex.`
- `react.*` 키는 리액션 도감 항목 ID를 겸합니다(처음 보면 해금).

---

## 8. 예약 테이블 (이번 버전 미작성)
- `modifiers.json`(요일·시즌 수정자), `items.json`(위장 아이템·책상 꾸미기): MVP 후순위. `design/backlog.md` 참고.

## 9. 변경 이력
| 버전 | 날짜 | 내용 |
|---|---|---|
| 1 | 2026-11-22 | 최초 작성 (T-101). `rules.json` 추가(에이전트 기본 테이블 목록 외, 전역 상수용) |
