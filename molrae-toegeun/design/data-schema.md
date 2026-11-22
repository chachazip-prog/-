# 몰래퇴근 데이터 스키마 v2 (schemaVersion: 2)

- 작성: mt-game-designer / T-121 / 2026-11-22
- 대상 파일: `game/data/*.json` (클라이언트는 `src/data/loader.ts`로 읽기만 함. 파일명 = 테이블 이름, `strings.ko.json` → `strings.ko`)
- 규칙(GDD)은 `design/gdd.md` v2. 이 문서는 **필드·타입·단위와 개발 타입 대응**만 정의합니다.
- 검사: `python3 -I design/tools/validate_data.py` (§10)
- 상태: **구현 착수 가능**. 개발 T-123 인터페이스(`core/floorSim.ts` LevelDef·FloorRules, `core/patrol.ts` NpcDef, `core/suspicion.ts` SuspicionRules)에 맞췄습니다. 같은 이름 = 같은 의미입니다. 새 필드는 🔧로 표시했고 §9에 모았습니다.

## 0. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 버전 | 모든 파일 최상위 `schemaVersion: 2`. 필드 의미가 바뀌면 +1, §11 변경 이력에 기록 |
| 시간 | 초(sec) 실수. 접미사 `Sec` |
| 게이지·확률 | 0~1 실수. 확률은 v2부터 `chance`(개발 `lookChance`와 통일) 또는 `Prob`(기존 필드) |
| 거리 | 타일(16px). `range`, `radius`, `*Tiles`. 속도 `speedTilesPerSec` |
| 좌표 | 타일 정수 `{x, y}` 또는 `[x, y]`, 원점 왼쪽 위, y는 아래로 증가. 연속 좌표에서 타일 중심 = (x+0.5, y+0.5) (`grid.ts`) |
| 방향 | `Dir = 'up' \| 'down' \| 'left' \| 'right'` (`vision.ts` `DIR_ANGLE`) |
| 범위 | `[min, max]` (`*Range`). 균등 추첨. 개발 코어가 단일값만 받으면 로더가 시드 RNG로 추첨하거나, 같은 이름의 단일값 필드(예: `tellSec`)를 씀 |
| 시각 | `"HH:MM"` (게임 시계) |
| ID | snake_case. 방해 이벤트만 `INT-01` 형식(기획 문서 참조용) + `key` |
| 문자열 | 화면 문구는 `*Key`로 `strings.ko.json` 참조. 스프라이트 이름은 `iconSprite`, `visual`, `sfx`, `props`(아트·사운드 ID) |
| 메모 | `_comment`, `_designNote`, `_toneNote`, `_note`는 사람용. 런타임은 무시 |
| 난수 | 모든 추첨은 `core/rng.ts` 시드 RNG. 시드 규칙은 §7 `generator` |

```ts
type Sec = number; type Ratio01 = number; type Prob = number; type Tiles = number;
type Range<T = number> = [T, T];
type Dir = 'up' | 'down' | 'left' | 'right';
type StringKey = string;
type RankId = 'intern' | 'staff' | 'assistant_manager' | 'manager' | 'deputy_general_manager' | 'general_manager' | 'executive';
type BossId = 'senior' | 'team_lead' | 'director' | 'ceo';
type NpcId = 'security_guard' | 'snitch' | 'accomplice' | 'hr_inspector';
type ActorId = BossId | NpcId;
type EventId = 'coffee' | 'restroom' | 'nap' | 'shopping' | 'snack' | 'leave';
type InterruptId = `INT-${string}`;
```

### 0-1. 개발 타입으로 조립하는 법 (로더 책임)

```ts
// LevelDef (core/floorSim.ts)
level = {
  id: map.id, rows: map.rows,
  legend: map.legend,                    // {kind, walkable, blocksSight, zone?} 그대로(확장 필드는 무시 가능)
  playerStart: map.playerStart, exitZone: map.exitZone,
  npcs: day.castPatrols.map(toNpcDef),   // + 방해 이벤트가 등장시키는 순찰은 런타임에 추가
};
// NpcDef (core/patrol.ts)
toNpcDef(patrolId) = {
  ...interpolate(actor.sim, rank, t),    // bosses/npcs.json 의 sim 블록, §0-2 보간 후
  ...patrol.overrides,                   // speedOverride 등
  id: patrol.id, name: strings[actor.nameKey], role: actor.role ?? actor.renderRole,
  waypoints: patrol.waypoints,           // {x, y, waitSec, lookChance?, lookDirs?} + 🔧 확장
  talk: actor.sim.talk && isEnabled(actor.sim.talk.enabledBy, day) ? actor.sim.talk : undefined,
};
// FloorRules
rules = { fixedStepSec, maxAdvanceSec, playerSpeedTilesPerSec, tapSnapRadius, suspicion, threat } // rules.json 최상위 그대로
```

### 0-2. 직급 스케일링 (v1과 같음)
| 방식 | 테이블 | 형식 | 해석 |
|---|---|---|---|
| 덮어쓰기 | `events` | `rankScaling[rankId] = { 필드: 값 }` | 해당 직급에서 `params`의 같은 필드를 교체. 누적 아님. 점 경로(`"pack.sec"`)는 `params.phases`에서 `id == "pack"`인 원소의 `sec` |
| 보간 | `bosses`, `npcs`, `interrupts` | `rankScaling[rankId] = { start: {...}, end: {...} }` | 직급 내 진행도 `t`로 선형 보간. 숫자·Range는 원소별, 정수 필드(`perDayRange`, `maxPerDay`)는 반올림, 그 외는 `t < 0.5`면 start |

키는 액터 기준 점 경로입니다. 예: `"sim.tellSecRange"`, `"sim.fake.chance"`, `"patrols.perDayRange"`, `"opportunities.phone_call.probPerCycle"`(배열은 `type`으로 찾음), `"gate.windowRatio"`, `"spawn.dayChance"`.

**불변식**(검사기가 확인)
- 모든 전조(`tellSec`, `tellSecRange[0]`, `secondTellSec`, `stopLookTellSec`, `tell.sec`, 보간 후 값) ≥ `rules.tell.minSec`(0.4). 말걸기 전조는 ≥ `rules.talk.tellSecMin`(0.5, D-043)
- `fake.chance ≤ fake.capChance ≤ rules.fake.absoluteCapProb(0.35)`, `doubleLook.chance ≤ doubleLook.capChance`
- 상사 `props`에 `lanyard_red`, NPC는 경비 `lanyard_black` / 정의로운 `lanyard_blue` / 공범 `lanyard_green` / 인사팀 `lanyard_purple`, NPC 소품에 red·orange 금지(D-037)
- 층 동시 인원 ≤ `rules.characters.maxOnFloor`(8)

---

## 1. rules.json — 전역 규칙

```ts
interface RulesTable {
  schemaVersion: 2;
  // ── 개발 FloorRules와 같은 이름 ──
  fixedStepSec: Sec;              // 1/60
  maxAdvanceSec: Sec;             // 0.1
  playerSpeedTilesPerSec: number; // 3.0
  tapSnapRadius: Tiles;           // 2
  suspicion: SuspicionRulesV2;
  threat: ThreatRules;
  // ── 확장 ──
  input: { tapMaxPressSec: Sec; inputGraceSec: Sec; hudTapDoesNotStop: boolean;
           tapWhileMoving: 'stop_and_disguise'; tapWhileStopped: 'move_to_tile';
           tapOnSelfWhileStopped: 'resume_previous_destination' };          // 🔧 마지막 항목
  movement: { pathfinding: 'astar_4dir'; tapNonWalkable: string; tapInteractable: 'go_to_use_spot';
              blockedWaitSec: Sec; rerouteMaxExtraTiles: Tiles; rerouteRecheckSec: Sec;
              npcPassThroughPlayerAfterSec: Sec; resumeAfterTalk: boolean;     // D-039
              postTalkHoldSec: Sec; showPathPreviewSec: Sec };                 // 🔧
  leavePhase: { suspicionOverrides: Partial<SuspicionRulesV2> };              // v2 현재 비어 있음(D-043)
  talk: { tellSecMin: Sec; tellVisual: string; approachMotion: boolean;
          skipIfPlayerDisguised: boolean; suspicionDuringTalk: 0; suspicionAfterTalk: 0 };  // 🔧 D-043
  disguise: { closeCallWindowSec: Range<Sec>; closeCallBonusPoints: number; closeCallMaxPerDay: number;
              poseByZone: Record<string, string> };
  sight: { losModel: 'grid_raycast_dda'; renderEqualsJudgement: true; seatedConeOnlyWhileLooking: boolean;
           cornerTurnTellSec: Sec; cornerTellCondition: 'new_facing_real_cone_could_cover_player';  // D-038/D-044
           returnSec: Sec };
  tell: { minSec: Sec; mustHaveVisual: boolean; mustHaveAudio: boolean };
  fake: { absoluteCapProb: Prob; noConsecutiveFakes: boolean };
  offscreenWarning: { sources: string[]; showWhenThreat: ('approaching'|'turning')[]; minLeadSecBeforeGaze: Sec;
                      offscreenSourceNoGain: boolean; arrowColorBy: 'lanyard'; pulseOnTell: boolean; missionMarkerArrows: boolean };
  characters: { maxOnFloor: number };
  work: { fillPerSec: number; fillOnlyWhen: 'seated_working'; max: Ratio01 };
  day: { clockStart; dayPhaseClockEnd; leaveClockStart; leaveGameMinutesPerSec; earlyLeaveBefore; overtimeAt;
         introSec; targetDurationSec: Range; tutorialDayDurationSec: Range; clockPausedDuring: string[] };
  stars: { caught: 0; overtimeEnding: 1; missionsShortLeave: 1; leaveSuccess: 2; leaveSuccessAndPeakSuspicionBelow: 3 };
  salary: { starMultiplier: [number, number, number, number]; slackPointsPerWon: number };
  slack: { restroomInsidePointsPerSec; ceoTalkWindowMultiplier; ceoEyeContactPoints; earlyLeavePoints; ... };
  snackStock: { startPerDay; max; gainOnSnackSuccess };
  continueAd: { maxPerDay; restorePlayerTo: 'last_checkpoint'; checkpoints: string[] };
  assist: { consecutiveCaughtThreshold; suspicionGainMultiplier; showHint; showRouteHint };
}

interface SuspicionRulesV2 {           // 개발 SuspicionRules + 확장
  max: 1; movingPerSec: 0.45; idlePerSec: 0; disguisedPerSec: 0; talkedPerSec: 0;
  disguiseSettleSec: 0.15; graceSec: 0.12; decayPerSec: 0.02;
  seatedWorkingPerSec: 0; activityPerSec: 0.55; activityPausedPerSec: 0;           // 🔧 미션 상태
  disguiseStaleAfterSec: 3.0; disguiseStalePerSec: 0.03; disguiseStaleExemptNearCover: true;  // 🔧
  anyStopIsDisguised: true;                                                          // 🔧 멈춤 = 위장
  gazeStacking: 'max'; star3PeakBelow: 0.3; continueResetTo: 0.6;
}

interface ThreatRules {                // 개발 FloorRules.threat + 확장
  approachExtraRange: 9; approachExtraAngleDeg: 25;
  approachRequiresLineOfSight: true;   // 🔧 넓은 콘에도 가림 반영(T-124: 벽 뒤 경고 76%)
  approachPathTilesWithin: 6; approachPathMustBeDecreasing: true;  // 🔧 문 너머 접근
  stages: { id: 'seeing'|'turning'|'approaching'; rule: string; onScreen: string; offScreen: string }[];
}
```

📐 의심 최종 상승률 = `suspicion[상태별]` × 보는 사람 `gazeMultiplier`(동시 시선은 최댓값). 상태 대응: 개발 `PlayerMode` `moving`→`movingPerSec`, `disguised`→`disguisedPerSec`(settle 동안은 moving), `idle`→`idlePerSec`(v2는 0, 멈춤 = 위장), `talked`→`talkedPerSec`. 🔧 추가 모드 `seated`(자리 업무), `activity`, `activity_paused`.

---

## 2. maps.json — 층 맵 (신규)

```ts
interface MapsTable { schemaVersion: 2; maps: MapDef[] }
interface MapDef {
  id: string; nameKey: StringKey; mvp: boolean;
  tileSizePx: 16; widthTiles: number; heightTiles: number; pixelSize: [number, number];
  playerStart: { x: number; y: number };      // = LevelDef.playerStart
  exitZone: string;                            // = LevelDef.exitZone ('exit')
  camera: { viewportTiles: [number, number]; visibleAboveTiles: number; visibleBelowTiles: number;
            followAxis: 'y'; deadZoneTiles: Tiles; lerpPerFrame: number; clampToMap: boolean };
  legend: Record<string, LegendEntryV2>;
  rows: string[];                              // = LevelDef.rows. 길이 heightTiles, 각 행 widthTiles
  zones: { id: string; nameKey: StringKey; rect: [x: number, y: number, w: number, h: number];
           parent?: string; outsideOffice?: boolean }[];   // 구역 이름·판정용. legend.zone이 있는 칸은 그쪽 우선
  spots: Record<string, { tile: [number, number]; type: 'seat'|'stand'|'use'|'door'|'spawn';
                          facing?: Dir; target?: string }>;
  coverSpots: { tile: [number, number]; by: 'partition'|'plant'|'copier'; hidesFrom: string }[];  // 바닥 반짝임 표시용
  routeNodes: Record<string, [number, number]>;            // 순찰 작성용 이름표
  playerRoutes: { id; labelKey; from: string; to: string; via: [number, number][]; lengthTiles; risk: string }[];  // 튜토리얼 점선·힌트
  chokepoints: { id: string; tiles: [number, number][]; bypass: string | null }[];
  measuredPathsTiles: Record<string, number>;               // 설계 실측(QA 재현용)
}
interface LegendEntryV2 {                     // = grid.ts LegendEntry + 확장
  kind: string; walkable: boolean; blocksSight: boolean; zone?: string;
  cover?: boolean; disguiseSpot?: boolean;     // 엄폐물(아트), 옆에서 멈추면 전용 위장 포즈
  gateOnly?: boolean;                          // 🔧 플레이어는 게이트 태그 성공 시에만 통과
  safeZone?: boolean;                          // 화장실 칸(blocksSight=true라 자동으로 안 보임)
}
```

- MVP 맵 `office_floor_1`: **11×47 타일(176×752px)**. 세로 스크롤 약 2.35화면.
- legend 문자: `# . @ h = D P T C g G e E B K M X S r` (의미는 파일 안 `kind`·`_note`).
- `h`(다른 사람 의자)는 통행 가능 칸이지만, 주인이 앉아 있으면 점유로 처리(🔧 점유 = 경로 탐색 시 임시 통행 불가).

---

## 3. bosses.json / npcs.json — 액터

```ts
interface BossesTable { schemaVersion: 2; bosses: BossDef[] }
interface NpcsTable { schemaVersion: 2; npcs: NpcDefData[] }

interface ActorSim {                 // = 개발 NpcDef에서 id·name·role·waypoints를 뺀 부분 + 확장
  cone: { range: Tiles; halfAngleDeg: number };
  speedTilesPerSec: number;
  gazeMultiplier: number;            // 의심 배율(0 = 의심 없음, 발견 트리거 전용)
  tellSec: Sec; lookSec: Sec; lookChance: Prob; glanceBackChancePerTile: Prob;
  tellSecRange?: Range<Sec>; lookSecRange?: Range<Sec>;   // 🔧 범위 추첨
  idleSecRange?: Range<Sec>;                              // 🔧 앉은 순찰의 대기(waypoint.useActorIdle)
  coneActiveIn: ('walk'|'wait'|'tell'|'look')[];          // 🔧 앉은 상사 = ['look']
  stopLookTellSec?: Sec;                                  // 정지 후 둘러보기 전조
  fake?: { chance: Prob; capChance: Prob; type?: 'recheck'; afterFakeSec?: Sec; tellSec?: Sec; visual?: string; sfx?: string };  // 🔧
  doubleLook?: { chance: Prob; capChance: Prob; gapSec?: Sec; secondTellSec?: Sec; secondLookSecRange?: Range<Sec> };          // 🔧
  talk?: TalkDefV2;
  spot?: { dwellSec: Sec; triggerStates: string[]; startsInterrupt: InterruptId };  // 정의로운 동료 발견
}
interface TalkDefV2 {                // = 개발 TalkDef {radius, durationSec, cooldownSec} + 확장(D-043)
  radius: Tiles; durationSec: Sec; cooldownSec: Sec;
  noticeRadius: Tiles; tellSec: Sec;           // 🔧 이 반경에서 말풍선 전조 시작(≥ 0.5초)
  approachMotion: boolean;                     // 🔧 전조 동안 플레이어 쪽으로 한 걸음
  skipIfPlayerDisguised: boolean;              // 🔧 위장 중이면 말 걸지 않음
  nodShortenSec: Sec; minDurationSec: Sec;     // 🔧 맞장구 탭
  onlyWhilePlayerAway?: boolean; onlyWhen?: string;  // 🔧 조건
  enabledBy: InterruptId;                      // 이 방해가 그날 켜져 있을 때만 talk 활성
}

interface BossDef {
  id: BossId; nameKey; codexKey; tier: 1|2|3|4; unlockRank: RankId; firstDay: number;
  role: 'boss'; props: string[];               // 첫 원소 lanyard_red (D-037)
  tell: { visual: string; sfx: string; bgm?: 'stop' };
  sim: ActorSim;
  opportunities: { type: 'phone_call'|'meeting'|'coffee_spill'; probPerCycle?; probPerPatrol?; atStop?: string;
                   durationSecRange?: Range; gazeOff: boolean; talkOff?: boolean; seatEmpty?: boolean;
                   byInterrupt?: InterruptId; visual?: string; endTellSec?: Sec }[];
  patrols?: { variants: string[]; perDayRange: Range<number>; minGapSec: Sec };     // 본부장
  visit?: { patrolId; spawnRequires: 'player_seated';
            freeze: { global: true; untilStop: string; maxSec: Sec; moveStartInstantSuspicion: Ratio01;
                      gainWhile: string[]; safeStates: string[] };
            talkWindow: { atStop: string; durationSec: Sec; gazeOffFor: BossId[]; slackMultiplier: number };
            exitResumeDelaySec: Sec };                                            // 대표님
  greetingQte?: { preCueSecRange: Range; windowSec; maxPressSec; earlyPenalty; missPenalty; longPressPenalty };
  occurrence?: { scheduledWeekday: 0|1|2|3|4; randomChancePerDay: Prob; maxPerDay: number;
                 announcedOnPrepScreen: boolean; skippableByAd: boolean };
  survival?: { maxSuspicionGain; requireQteSuccess; rewardSlackPoints; codexKey };
  hierarchy: { suppressedBy: BossId[]; suppressedState?: 'greeting'|'frozen'; suppresses?: BossId[];
               freezesNpcs?: NpcId[]; resumeDelaySec: Sec; greetSpot?: string; greetTriggerZone?: string;
               receivesSnitchReport?: boolean;
               snitchForcedLook?: { tellSec; lookSec; coneRange: Tiles; aimAtPlayer: boolean } };
  reactionKeys: StringKey[];
  rankScaling: Partial<Record<RankId, { start: Record<string, unknown>; end: Record<string, unknown> }>>;
}

interface NpcDefData {
  id: NpcId; nameKey; codexKey; role: 'gate'|'obstruct'|'assist'|'inspect'; renderRole: string;
  mvp: boolean; unlockRank: RankId; firstDay: number; ambientFromDay?: number;   // 배경 동료로 먼저 앉아 있음
  props: string[]; defaultPatrol: string | null;
  sim: ActorSim;
  gate?: { useSpot; markerCycleSec; windowRatio; maxAttempts; beepSuspicion; beepAttractsGuardLook; firstTryWindowMultiplierOnDay1 };
  offer?: { eventIds: EventId[]; offerProb: Prob; offerSec: Sec; maxPerDay; acceptInput: 'tap_bubble'; startsInterrupt };
  effects?: { rewardMultiplier; suspicionGainMultiplier; hitboxIncludesAccomplice; lookoutCoughLeadSec; lookoutRadiusTiles };
  inspection?: { patrolId; countdownSec: 'eta_to_stop_inspect'; countdownMinSec; inspectSec; mustBeSeated; absentSuspicion; activitySeenUsesCone };
  spawn?: { dayChance: Prob; maxPerDay; notDuringCeo; minDayTimeSec };
  frozenByCeo: boolean; reactionKeys: StringKey[]; rankScaling: ...;
}
```

---

## 4. patrols.json — 순찰 경로 (신규)

```ts
interface PatrolsTable { schemaVersion: 2; patrols: PatrolDef[] }
interface PatrolDef {
  id: string; actorId: ActorId; mapId: string;
  kind: 'seated' | 'loop' | 'route' | 'follow';
  loop: boolean;                     // 🔧 false면 마지막 웨이포인트에서 멈춤(개발 코어는 현재 항상 순환)
  waypoints: WaypointDefV2[];
  despawnAtEnd?: boolean;            // 🔧 route 끝에서 퇴장(엘리베이터 등)
  thenPatrol?: string;               // 🔧 끝나면 이 순찰로 전환(예: 회의 → 자리)
  spawnTellSec?: Sec;                // 등장 전 전조(문 열림·발소리·띵). 이 동안 정지
  speedOverride?: number;            // actor.sim.speedTilesPerSec 대신
  coneOff?: boolean;                 // 이 순찰 전체 시선 없음
  followGapTiles?: Tiles;            // kind: 'follow' (공범 합류)
  instance?: number;                 // 같은 액터의 두 번째 인스턴스(옆 팀 팀장 = 2)
}
interface WaypointDefV2 {            // = 개발 WaypointDef {x, y, waitSec, lookChance?, lookDirs?} + 확장
  x: number; y: number; waitSec: Sec; lookChance?: Prob; lookDirs?: Dir[];
  facing?: Dir;                      // 🔧 대기 중 바라보는 방향(앉은 상사: look 후 이 방향으로 복귀)
  useActorIdle?: boolean;            // 🔧 waitSec 대신 actor.sim.idleSecRange 추첨
  stopId?: string;                   // 방해·연출이 참조하는 정지 이름(예: stop_ceo_greet)
  coneOff?: boolean; holdForQte?: boolean; holdForReport?: boolean; lookIsRecheck?: boolean;  // 🔧
}
```

| id | 액터 | 종류 | 요약 |
|---|---|---|---|
| p_senior_seat / p_tl_seat | 선배 / 팀장 | seated | (5,30) 북쪽 대기, 남쪽 돌아보기 |
| p_tl2_seat | 팀장 #2 | seated | (5,13), 차장~ |
| p_snitch_seat | 정의로운 동료 | seated | (6,33), 왼쪽 힐끔 |
| p_accomplice_seat | 공범 | seated | (7,36) |
| p_guard_gatehall | 경비 | loop | 게이트 홀 3점 왕복 |
| p_director_walkdown / walkup | 본부장 | route | 본부장실 ↔ 화물 엘리베이터, 정지 3곳 |
| p_hr_attendance / p_hr_corridor | 인사팀 | route | 근태 점검 / 복도 사원증 |
| p_tl_meeting | 팀장 | route | 자리 → 회의실 10초 → 자리 |
| p_ceo_visit / p_ceo_elevator | 대표님 | route | 순시 / 퇴근 엘리베이터 |
| p_gossip_snitch / p_gossip_accomplice | 동료 2 | route | 병목 (5,23)(5,24) 길막 |
| p_snitch_report | 정의로운 동료 | route | 자리 → 팀장 옆 (6,30) |
| p_accomplice_follow | 공범 | follow | 플레이어 1타일 뒤 |

---

## 5. interrupts.json — 방해·개입 이벤트 (신규)

```ts
interface InterruptsTable { schemaVersion: 2; interrupts: InterruptDef[] }
interface InterruptDef {
  id: InterruptId; key: string; nameKey: StringKey;
  category: 'talk_stop'|'block'|'report_run'|'countdown'|'walker'|'walker_talk'|'walker_opportunity'|'freeze'|'qte'|'assist';
  actors: ActorId[]; mvp: boolean; unlockDay: number; lastDay?: number;
  phases: ('day'|'leave')[];                      // leave 포함 = '퇴근 방해'
  trigger:
    | { type: 'proximity_talk'; talkDefOf: ActorId; requiresPlayerAway?: boolean; condition?: string }
    | { type: 'spotted_by'; actor: ActorId; dwellSec: Sec; states: string[] }
    | { type: 'scheduled'; dayAtSec: 'from_day_plan'; leaveTrigger?: 'on_leave_start'|'player_enters_zone'; leaveZone?: string;
        leaveUnlockDay?: number; notDuring?: string[] }
    | { type: 'scheduled_when'; dayAtSec: 'from_day_plan'; condition: 'player_seated' }
    | { type: 'chance_on_exit_wait'; chance: Prob; notOnCeoVisitDays: boolean }
    | { type: 'mission_offer'; offerRef: string };
  tell: { sec: Sec; visual: string; sfx: string; bgm?: 'stop'; textKey?: StringKey };   // sec ≥ 0.4 (말걸기 ≥ 0.5)
  effect: Record<string, unknown>;                // category별(아래)
  counters: { id: string; input: string; result: string; [k: string]: unknown }[];
  cooldownSec: Sec; maxPerDay: number;
  rankScaling?: ...;                              // 보간 방식
  reactionKeys: StringKey[];
}
```

| category | 주요 effect 필드 |
|---|---|
| talk_stop | `forcedStop`, `talkLineKey`, `leaveLineKey?`, `leaveExtraSuspicion`(v2 = 0, D-043), `earlyLeavePoints?` |
| report_run | `patrolId`, `showPath`, `arrivalSuspicion`, `forcedLookBy`, `forcedLook{tellSec, lookSec, coneRange, aimAtPlayer}`, `waitIfReceiverSuppressedMaxSec` |
| block | `patrolIds[]`, `blockTiles`, `blockSec`, `leavePrePositioned`, `leaveBlockSec`, `talkIfAdjacent{radius, durationSec, lineKey}` |
| countdown | `patrolId`, `countdownSec: 'eta_to_stop_inspect'`, `countdownMinSec`, `inspectSec`, `absentSuspicion` |
| walker / walker_talk / walker_opportunity | `patrolId` 또는 `patrolVariants[]`, `leaveVariant`, `teamLeadGreeting{whenDirectorInZone, moveTo, gazeOff, talkOff}`, `meetingSec`, `letoutTellSec`, `blocksMissions[]` |
| freeze | `seeBoss: 'ceo.visit'`, `clockPaused` |
| qte | `patrolId`, `qteRef`, `successPoints`, `failSuspicion` |
| assist | `patrolId`, `effectsRef` |

---

## 6. events.json — 미션 (개정)

```ts
interface EventsTable { schemaVersion: 2; events: EventDef[] }
interface EventDef {
  id: EventId; nameKey; descKey; iconSprite: string; mvp: boolean;
  mechanic: 'pour_tap_stop'|'trip_safe_zone'|'nap_tap_toggle'|'screen_swap_tap'|'rhythm_tap'|'leave_sequence';
  location: { spot: string; zone: string };         // maps.spots / zones 참조
  startsAt: 'arrive_spot'|'chip_tap_at_seat'|'clock_leave_start';
  completeAt: 'return_to_seat'|'on_success'|'exit_elevator';
  awayFromDesk: boolean; isFinale: boolean; unlockRank: RankId;
  timeLimitSec: Sec;                  // 미션 시작(자리를 뜬 순간)부터
  expectedDurationSec: Sec;           // 시간 예산·시뮬 기준(판정에 안 씀)
  accompliceAllowed: boolean;
  reward: { slackPoints: number; snackStock?: number; earlyLeaveBonusPoints?: number };
  failPenalty: { suspicion: Ratio01; result?: 'overtime_ending' };
  timeoutPenalty: { suspicion: Ratio01; result?: 'overtime_ending' };
  params: Record<string, unknown>;    // mechanic별(아래)
  accompliceEffect?: { cupsRequired?: number; bitesRequiredMultiplier?: number };
  rankScaling: Partial<Record<RankId, Record<string, unknown>>>;   // 덮어쓰기
  failReactionKeys: StringKey[]; tutorialId: string;
}
```
| mechanic | params |
|---|---|
| pour_tap_stop (coffee) | `pourRatePerSec`, `targetBand`, `overflowAt`, `cupsRequired`, `tapBelowBand: 'pause'`, `tapInBand: 'success'`, `carryCupWhileReturning` |
| trip_safe_zone (restroom) | `insideRestSec`, `insideBonusMaxSec`, `insidePointsPerSec`, `tapInsideAfterRest: 'leave_stall'`, `stallIsSafeZone` |
| nap_tap_toggle (nap) | `fatigueStart`, `fatigueRecoverPerSec`, `headDropPerSec`, `headRaisePerSec`, `headThudAt`, `headDownVisibleThreshold`, `headDownVisibleStateMultiplier`, `tapToggles`, `lockedDuringInterrupt` |
| screen_swap_tap (shopping) | `cartFillPerSec`, `itemsRequired`, `checkoutHoldSec`, `tapDuringCheckout`, `pausedShowsSpreadsheet` |
| rhythm_tap (snack) | `bitesRequired`, `minIntervalSec`, `perfectWindowSec`, `maxPressSec`, `noiseSuspicion`, `noiseAlertsRadiusTiles`, `noiseShortensBossIdleTo`, `biteUnderGazeSuspicion`, `activityStateAfterBiteSec`, `perfectBonusPoints` |
| leave_sequence | `clockStart`, `gameMinutesPerSec`, `phases[]`: `pack{sec, tapPauses, ifAwayWalkToSeatFirst}` → `walk{to, carryingBag}` → `gate{npc, ref}` → `elevator{waitSecRange, safeAfterGate, interruptHook}` |

---

## 7. ranks.json / days.json (개정)

```ts
interface RanksTable { schemaVersion: 2; budgetModel: {...}; ranks: RankDef[] }
interface RankDef {
  id: RankId; order; nameKey; dayRange: [number, number | null]; contentTier: 'authored'|'generated'|'endless'; mvp;
  starsToPromote: number | null; maxStars: number | null;
  dayPhaseSec: Sec;                    // 09:00→17:48 실시간 길이 (v1 workSegmentSec 대체)
  ceoDayPhaseReductionSec: Sec;
  missionsPerDay: Range<number>; missionsRequired: Range<number>;   // [t<0.5, t≥0.5]
  workQuota: Ratio01; salaryBase: number;
  cast: { bosses: Partial<Record<BossId, number>>; npcs: NpcId[] };
  eventPool: { eventId: EventId; weight: number }[];
  dayInterrupts: { countRange: Range<number>; pool: { id: InterruptId; weight: number }[] };
  leaveInterrupts: { countRange: Range<number>; pool: { id: InterruptId; weight: number }[] };
  promotionTitleKey: StringKey | null;
}

interface DaysTable { schemaVersion: 2; authoredDays: AuthoredDay[]; generator: DayGenerator }
interface AuthoredDay {
  day; rankId; weekday: 0|1|2|3|4; seed: `day-${number}`; mapId; titleKey; tutorialIds: string[];
  dayPhaseSec: Sec; workQuotaOverride?: Ratio01;
  missions: { eventId: EventId; unlockAtSec: Sec }[];   // 근무 구간 시작 기준
  missionsRequired: number;
  castPatrols: string[];                                 // 하루 종일 있는 순찰
  ambientOnly?: NpcId[];                                 // 앉아만 있는 배경 동료(상호작용 없음)
  dayInterrupts: { id: InterruptId; atSec: Sec; trigger?: string }[];   // atSec 0 = 하루 종일 활성(근접형), -1 = trigger로만
  leaveInterrupts: { id: InterruptId }[];
  scripted: ScriptedBeat[];                              // type별 자유 필드(튜토리얼 연출)
  ceo: 'none'|'scheduled'|'random';
  expectedDurationSec: Sec;
}
```
- `generator`는 16일차 이후 규칙(자연어 + 수식). 개발은 `generateDay(day): AuthoredDay`로 같은 모양을 돌려주면 됩니다. RNG 스트림 `day-{n}-{plan|boss|npc|event|leave}`.
- `t = (day − dayRange[0]) / (dayRange[1] − dayRange[0])`, 엔드리스 t = 0.

---

## 8. ads.json (신규) / strings.ko.json

```ts
interface AdsTable {
  schemaVersion: 2;
  global: { neverDuringPlay: true; playStates: string[]; bannerEnabled: false; shareReward: false };
  interstitial: { enabled; placement: 'result_to_next_day'; noticeKey; noticeSec; installDayMaxShows: 0;
                  exemptFirstGamesLifetime: 5; everyNGames: 3; maxPerDay: 5; minIntervalSec: 180;
                  skipIfRewardedWatchedThisGame: true; removedByIap: 'remove_ads'; dayBoundary: 'local_midnight' };
  rewarded: { enabled; maxPerDay: 12;
              placements: { id: 'ceo_pass'|'continue'|'salary_double'; screen: 'prep'|'caught_offer'|'result';
                            labelKey; descKey?; condition: string; maxPerDay: number; effect: string }[] };
  iap: { remove_ads: { priceKrw: 2900; removes: ['interstitial']; keepsRewarded: true; featureFlag: string; enabledUntilBusinessApproved: false } };
  counters: { persist: string[]; storage: 'apps_in_toss_storage' };
}
```
- 전면광고 판정 순서(개발): `iap 구매` → `global.neverDuringPlay` → `설치 당일` → `평생 판수 < 5` → `오늘 횟수 ≥ 5` → `마지막 광고 후 < 180초` → `이번 판 보상형 봄` → `판수 % 3`. 하나라도 걸리면 건너뜀.
- strings: `{ schemaVersion, locale, strings: Record<key, string | string[]>, uiIcons?: Record<key, spriteId> }`. 새 접두사 `prep.` `map.` `zone.` `route.` `int.`. `uiIcons`는 해당 문구 앞에 그릴 UI 스프라이트(이모지 대체, D-042). 이모지 금지, 특수문자 `… · — ★`만.

---

## 9. 🔧 개발 확장 요청 목록 (T-123 코어 대비)

| # | 확장 | 위치 | 근거 |
|---|---|---|---|
| X1 | 앉은 모드: `coneActiveIn`, waypoint `facing`(look 후 복귀 0.3초), `useActorIdle` + `idleSecRange` | patrol.ts | 앉은 상사는 돌아볼 때만 시선 |
| X2 | 범위 추첨 `tellSecRange`/`lookSecRange`, 페이크(전조 후 시선 없음, 연속 금지)·연속 두 번 보기 | patrol.ts | v1 팀장 패턴 계승 |
| X3 | **D-043** 말걸기 전조: `noticeRadius`에서 말풍선 `tellSec`(≥ 0.5) + 다가오는 동작 → 끝났을 때 `radius` 안이면 시작. `skipIfPlayerDisguised`. 말걸기 중 의심 0 | floorSim.ts | QA: 전조 없는 말걸기 판당 0.36회 |
| X4 | **D-044** 조건부 모퉁이·재출발 전조: 새 방향 실제 콘이 플레이어를 덮을 수 있으면 `cornerTurnTellSec` 0.5 | patrol.ts `walk()`·wait→walk | QA: 모퉁이·재출발 판당 0.12~0.20회 |
| X5 | `anyStopIsDisguised`(멈춤 = 위장), `disguiseStaleAfterSec`, `postTalkHoldSec`, D-039 자동 재개 | player.ts·suspicion.ts | T-124: 위장이 손해였음 |
| X6 | `threat.approaching`에 가림·경로 거리 조건(`stages`) | floorSim.ts `threatOf` | T-124: 벽 뒤 경고 76% |
| X7 | `loop: false`, `despawnAtEnd`, `thenPatrol`, `spawnTellSec`, 순찰 런타임 추가·제거 | patrol.ts·floorSim.ts | 방해 이벤트 등장·퇴장 |
| X8 | 의자 점유(`h`), `gateOnly`, NPC가 1초 뒤 플레이어 통과 | grid/pathfinding | 길막·게이트 |
| X9 | 미션 상태 `seated`/`activity`/`activity_paused`, 업무 게이지, 시계 | 신규 | 하루 루프 |
| X10 | `offscreenSourceNoGain`(화면 밖 콘 주인 판정 제외) | floorSim.ts | 억울한 실패 0 |

---

## 10. 검사기 `design/tools/validate_data.py`
`python3 -I molrae-toegeun/design/tools/validate_data.py` → `OK` 또는 오류 목록(종료 코드 1). 검사 항목: schemaVersion, `*Key`·`reactionKeys` 문자열 존재, 전조 최소·페이크 상한(보간 값 포함), 맵 크기·legend·스폿/웨이포인트 통행·도달, 테이블 간 ID 참조, 방해 phase·unlockDay, 하루 예상 길이 범위, 층 인원 ≤ 8, D-037 사원증 색. 데이터를 고칠 때마다 실행하세요. CI 편입은 개발·QA 판단입니다.

---

## 11. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| 1 | 2026-11-22 | 최초 작성(T-101, 측면 홀드/떼기 기준) |
| 2 | 2026-11-22 | **탑다운 전면 개정(T-121)**. 아래 상세 |

### v1 → v2 상세
- **신규 테이블**: `maps`, `patrols`, `interrupts`, `ads`.
- **rules**: `input.inputGraceSec`(유지) 외 v1 `input`·`work.fillOnlyInWorkSegment`·`slack.pointsPerSecInWorkSegment` 삭제. 최상위에 개발 `FloorRules` 필드 추가. `suspicion`을 개발 `SuspicionRules` 이름으로 교체(`decayRequires` 삭제). `movement`·`talk`·`disguise`·`sight`·`threat`·`offscreenWarning`·`characters`·`leavePhase` 추가. `day.finaleClockStart` → `leaveClockStart`(17:52 → 17:48), `overtimeAt` 추가. `stars.missionsShortLeave` 추가.
- **bosses**: `behavior`·`gaze`·`timing` 삭제 → `sim`(개발 NpcDef 모양) + `patrols`(본부장) + `visit`(대표님). `fake.prob`/`doubleLook.prob` → `sim.fake.chance`/`sim.doubleLook.chance`. `opportunity`(단일) → `opportunities[]`. 사원증 줄 전원 `lanyard_red`(D-037). rankScaling 키 `tell.durationSec`→`sim.tellSecRange`, `timing.idleSec`→`sim.idleSecRange`, `timing.lookSec`→`sim.lookSecRange`, `timing.stopProb`→`sim.lookChance`, `timing.patrolsPerDay`→`patrols.perDayRange`, `timing.freezeSec` 삭제(얼음 = 입장 걷기 시간).
- **npcs**: `spawn.while_holding`·`counters`·`tell`·`gaze`·`params` 삭제 → `sim`, `gate`, `offer`, `effects`, `inspection`, `spawn`. 방해 행동은 `interrupts`로 이동. 공범 줄 주황 → 초록(D-037). `ambientFromDay` 추가.
- **events**: `input`·`observable`·`suspicionGainMultiplier`·`hrInspectionAllowed` 삭제, `location`을 문자열 → `{spot, zone}`, `startsAt`·`completeAt`·`iconSprite` 추가. mechanic 이름과 params 전부 교체(§6).
- **ranks**: `regularEventsPerDay`·`workSegmentSec`·`bosses`·`npcs` → `missionsPerDay`·`missionsRequired`·`dayPhaseSec`·`cast`·`dayInterrupts`·`leaveInterrupts`. `budgetModel` 추가. 할당량 하향(0.45~0.65 → 0.40~0.50).
- **days**: `slots`·`bosses`·`npc`·`scripted(boss_look 등 슬롯 기준)` → `missions`·`castPatrols`·`dayInterrupts`·`leaveInterrupts`·`scripted(자유)`. `generator` 재작성(스트림 `leave` 추가).
- **strings**: 홀드/떼기 문구 전부 탭 기준으로 교체, `prep.` `map.` `zone.` `route.` `int.` 추가.
- **T-124 반영(같은 날, 버전 유지)**: 위장 0/초 + 3초 초과 시 0.03, `anyStopIsDisguised`, 말걸기 전조·위장 시 생략·의심 0(D-043), 조건부 모퉁이 전조(D-044), `threat.stages`(가림·경로 거리).
