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
- 층 동시 인원 ≤ `rules.characters.maxOnFloor`(12, 배경 동료 포함), 화면(세로 20타일 창) 안 ≤ `maxOnScreen`(8) (D-049, T-132)
- 플레이어 줄 `rules.characters.playerProps = ['lanyard_sky']`(D-052), 배경 동료 `lanyard_gray`. 역할 줄 색끼리 겹치지 않음

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
           tapOnSelfWhileStopped: 'resume_previous_destination';            // 🔧
           resultInputGuardSec: Sec };                                      // 🔧 T-132 결과 화면 뜬 뒤 탭 무시(0.6, BUG-006)
  movement: { pathfinding: 'astar_4dir'; tapNonWalkable: string; tapInteractable: 'go_to_use_spot';
              blockedWaitSec: Sec; rerouteMaxExtraTiles: Tiles; rerouteRecheckSec: Sec;
              npcPassThroughPlayerAfterSec: Sec; resumeAfterTalk: boolean;     // D-039
              postTalkHoldSec: Sec; showPathPreviewSec: Sec };                 // 🔧
  leavePhase: { suspicionOverrides: Partial<SuspicionRulesV2> };              // v2 현재 비어 있음(D-043)
  talk: { tellSecMin: Sec; tellVisual: string; approachMotion: boolean;
          skipIfPlayerDisguised: boolean; suspicionDuringTalk: 0; suspicionAfterTalk: 0;   // 🔧 D-043
          warnSecDefault: 0.5; catchRadiusRule: string; releaseSecRule: string };          // 🔧 T-132 (사람용 규칙, 검사기가 강제)
  disguise: { closeCallWindowSec: Range<Sec>; closeCallBonusPoints: number; closeCallMaxPerDay: number;
              poseByZone: Record<string, string> };
  sight: { losModel: 'grid_raycast_dda'; renderEqualsJudgement: true; seatedConeOnlyWhileLooking: boolean;
           cornerTurnTellSec: Sec; cornerTurnTellSfx: string;              // T-132 sfx_look_swish cornerTellCondition: 'new_facing_real_cone_could_cover_player';  // D-038/D-044
           returnSec: Sec };
  tell: { minSec: Sec; mustHaveVisual: boolean; mustHaveAudio: boolean; defaultWalkTellSfx: string };  // T-132
  visualCues: VisualCues;                                                       // 🔧 T-132 무음 대응 시각 신호
  fake: { absoluteCapProb: Prob; noConsecutiveFakes: boolean };
  offscreenWarning: { sources: string[]; showWhenThreat: ('approaching'|'turning')[]; minLeadSecBeforeGaze: Sec;
                      offscreenSourceNoGain: boolean; arrowColorBy: 'lanyard'; pulseOnTell: boolean; missionMarkerArrows: boolean };
  characters: { maxOnFloor: 12; maxOnScreen: 8; screenRowsTiles: 20; backgroundCountsTowardLimits: true;
                playerProps: string[];                                        // T-132: D-049·D-052
                playerSpriteKey: 'player' };                                  // T-134: 아트 anims.json 캐릭터 키
  work: { fillPerSec: number; fillOnlyWhen: 'seated_working'; max: Ratio01 };
  day: { clockStart; dayPhaseClockEnd; leaveClockStart; leaveGameMinutesPerSec; earlyLeaveBefore; overtimeAt;
         introSec; targetDurationSec: Range; tutorialDayDurationSec: Range; clockPausedDuring: string[] };
  stars: { caught: 0; overtimeEnding: 1; missionsShortLeave: 1; leaveSuccess: 2; leaveSuccessAndPeakSuspicionBelow: 3 };
  salary: { starMultiplier: [number, number, number, number]; slackPointsPerWon: number };
  slack: { restroomInsidePointsPerSec; ceoTalkWindowMultiplier; ceoEyeContactPoints; earlyLeavePoints; ... };
  snackStock: { startPerDay; max; gainOnSnackSuccess };
  continueAd: { maxPerDay; restorePlayerTo: 'last_checkpoint'; checkpoints: string[];
                resumeSuspicion: Ratio01;                                      // 🔧 T-136: 0.6(D-064). suspicion.continueResetTo 대체
                submitScoreToLeaderboard: false };                             // T-132: D-056
  caughtCutin: { durationSec: Sec; isPlayState: true };                        // 🔧 T-136: 적발 컷인 2.0초(1.5~3.0, 광고 금지 구간)
  assist: { consecutiveCaughtThreshold; suspicionGainMultiplier; showHint; showRouteHint };
}

interface SuspicionRulesV2 {           // 개발 SuspicionRules + 확장
  max: 1; movingPerSec: 0.45; idlePerSec: 0; disguisedPerSec: 0;
  talkedPerSec: 0;                     // ⛔ T-132 폐지(D-043). 런타임 무시·0 고정, 타입 호환용으로만 남김. v3에서 삭제
  _deprecated?: Record<string, string>;
  disguiseSettleSec: 0.15; graceSec: 0.12; decayPerSec: 0.02;
  seatedWorkingPerSec: 0; activityPerSec: 0.55; activityPausedPerSec: 0;           // 🔧 미션 상태
  disguiseStaleAfterSec: 3.0; disguiseStalePerSec: 0.03; disguiseStaleExemptNearCover: true;  // 🔧
  anyStopIsDisguised: true;                                                          // 🔧 멈춤 = 위장
  gazeStacking: 'max'; star3PeakBelow: 0.3;
  continueResetTo: 0.6;                // ⛔ T-136: continueAd.resumeSuspicion으로 대체(같은 값, 검사기 일치 확인). 런타임 무시, v3에서 삭제
}

interface ThreatRules {                // 개발 FloorRules.threat + 확장
  approachExtraRange: 9; approachExtraAngleDeg: 25;
  approachRequiresLineOfSight: true;   // 🔧 넓은 콘에도 가림 반영(T-124: 벽 뒤 경고 76%)
  approachPathTilesWithin: 6; approachPathMustBeDecreasing: true;  // 🔧 문 너머 접근
  stages: { id: 'seeing'|'turning'|'approaching'; rule: string; onScreen: string; offScreen: string }[];
}
```

📐 의심 최종 상승률 = `suspicion[상태별]` × 보는 사람 `gazeMultiplier`(동시 시선은 최댓값). 상태 대응: 개발 `PlayerMode` `moving`→`movingPerSec`, `disguised`→`disguisedPerSec`(settle 동안은 moving), `idle`→`idlePerSec`(v2는 0, 멈춤 = 위장), `talked`→**항상 0**(코드 고정, `talkedPerSec` 폐지). 🔧 추가 모드 `seated`(자리 업무), `activity`, `activity_paused`.

```ts
interface VisualCues {                 // T-132: 효과음·BGM과 짝을 이루는 화면 신호. 소리 설정과 무관하게 항상 표시. 시각 ID = 아트 T-130
  alwaysOn: true;
  gateFail:        { pairsWith: 'sfx_gate_beep'; visual: 'gate_fail_flash'; overlayIcon: 'ui/gate_fail'; flashes: 3; durationSec: 0.6; showAttemptsLeftKey; showAttemptsLeftSec: 1.0 };
  gateOk:          { pairsWith: 'sfx_gate_ok'; visual: 'gate_pass_flash'; overlayIcon: 'hud/gate_pass'; durationSec: 0.3; iconRiseSec: 0.6; textKey };
  tapDestination:  { pairsWith: 'sfx_tap'; visual: 'fx/dest'; unreachableTextKey };
  missionChipDone: { pairsWith: 'sfx_mission_complete'; visual: string; overlayIcon: 'icon_done'; textKey };
  suspicionHigh:   { pairsWith: 'sfx_suspicion_loop'; threshold: 0.7; visual: 'gauge_danger'; pulseHz: 2.0 };
  dangerBorder:    { pairsWith: 'bgm_office.stages'; followsBgmHysteresis: true;
                     alertSuspicionMin: 0.4;   // 🔧 T-136: alert 진입 의심(BGM·테두리 공용). danger = suspicionHigh.threshold
                     byStage: Record<'calm'|'alert'|'finale'|'danger'|'freeze'|'stopped', { show: boolean; visual?: string; color?: string; borderPx?: number; pulseHz?: number }> };
}
```
- 단계 이름과 전환 조건은 `game/assets/audio/audio-manifest.json` `bgm.bgm_office.stages`·`stagePriority`·`hysteresis`를 그대로 따릅니다(사운드 소유). 모든 `pulseHz` ≤ 3(광과민, 검사기).

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
            followAxis: 'y'; deadZoneTiles: Tiles; lerpPerFrame: number; clampToMap: boolean;
            clampIncludesHudInset: true;        // T-134: clamp 때 HUD 높이만큼 여유(맵 끝 행이 HUD에 안 가림)
            hudCoveredRowsAreOffscreen: true }; // T-134: HUD가 가리는 행의 인물 = 화면 밖(offscreenSourceNoGain·화살표)
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
  // ── T-132 (D-043·D-054, 개발 core/patrol.ts TalkDef와 같은 이름) ──
  warnSec: Sec;          // 말풍선 전조 길이. 실제 = max(warnSec, sim.tellSec). ≥ rules.talk.tellSecMin(0.5)
  catchRadius: Tiles;    // 전조 끝에 이 거리 안이면 성립, 밖이면 취소(그쪽을 돌아봄 = look). radius < c ≤ 2×radius
  releaseSec: Sec;       // 말걸기 끝난 뒤 이 NPC 시선을 의심에 반영하지 않는 시간. ≥ 최대 실제 전조 + postTalkHoldSec
  warnLineKey: StringKey;    // 말풍선 문구(없으면 talk.warn_default '저기요?')
  dodgedLineKey: StringKey;  // 조용한 취소(위장 또는 radius 미진입) 때만 혼잣말
}
// T-134 전조 끝 판정(rules.talk.catchRequiresEnterRadiusDuringTell · silentCancelSaysDodgedLine · dodgeAfterEnterLooksAtPlayer = true)
//   성립 = 전조 중 radius 안에 한 번이라도 들어옴 && 지금 catchRadius 안 && 위장 아님
//   위장 또는 radius 미진입 → 조용히 취소 + dodgedLineKey (돌아보지 않음)
//   radius 진입 후 catchRadius 밖 → 취소 + 플레이어 쪽 돌아보기(전조 rules.sight.cornerTurnTellSec → lookSec, releaseSec 미적용, 혼잣말 없음)
```

| 액터 | radius | warnSec(실제) | catchRadius | releaseSec | 반응 없이 지나침 → 성립 | 0.3초 안에 피함 → 취소 |
|---|---|---|---|---|---|---|
| 경비 | 1.1 | 0.5 | 1.25 | 1.0 | 82% | 41% |
| 인사팀 | 1.1 | 0.6 | 1.5 | 1.1 | 83% | 46% |
| 팀장 | 1.5 | 0.6 (sim 0.4~0.8) | 1.8 | 1.3 | 91%(0.6초)~75%(0.8초) | 45%~100% |
| 선배 | 1.5 | 1.0 | 2.5 | 1.5 | 83% | 100%(0.4초 반응 54%) |

📐 기획 의도: 말걸기는 '멍하니 지나가면 붙잡히고, 말풍선을 보고 바로 피하면 빠져나갈 수 있는' 공정한 방해입니다(D-054). 개발 임시값 2.0(= radius×2 근사)은 경비·인사팀에서 반응해도 회피율 0~9%라 피할 여지가 사실상 없었습니다. 수치는 플레이어 3.0타일/초, 반경 진입점에서 직선 통과(오프셋 균등) vs 반응 후 NPC 반대로 직진하는 2만 회 기하 시뮬레이션 결과입니다. 🧪 QA: 실제 FloorSim에서 같은 두 봇(무반응·0.3초 반응)으로 재측정. 피한 뒤 NPC가 돌아보는 콘은 정상 판정이므로 피하고 나서 멈춰 위장하는 것이 정답 플레이입니다.

```ts

interface BossDef {
  id: BossId; spriteKey: string;               // T-134: anims.json 캐릭터 키(senior·teamlead·exec·ceo). `{spriteKey}/idle_down` 등
  nameKey; codexKey; tier: 1|2|3|4; unlockRank: RankId; firstDay: number;
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
  id: NpcId; spriteKey: string;                // T-134: guard·snitch·accomplice·hr. 배경 동료는 background[].sprite(bg_a/b/c)
  nameKey; codexKey; role: 'gate'|'obstruct'|'assist'|'inspect'; renderRole: string;
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
// T-132 추가 필드
//   sim.walkTellSfx?: { lookAround; glanceBack; cornerTurn; stopLook: AudioKey; onScreenOnly: true }  // 본부장·팀장·경비·인사팀
//   gate.failSfx 'sfx_gate_beep' · okSfx 'sfx_gate_ok' · failVisual · failVisualSec · failShowsAttemptsLeftKey · okVisual · okTextKey
// T-134 추가 필드
//   gate.windowCenter 0.5 · markerMotion 'ping_pong' · waitingCountsAsDisguised true   // 창 가운데 고정, 게이트 앞 = 위장(정체 규칙은 적용)
//   offer.authoredDaysScriptedOnly: true · offerRollStream: 'npc'   // 1~15일차 공범 제안은 days.scripted로만(시드 고정)

interface NpcsTable { ...; background: BackgroundCoworker[] }   // T-132, D-049
interface BackgroundCoworker {
  id: string; kind: 'ambient_coworker'; renderRole: 'background'; sprite: 'bg_a'|'bg_b'|'bg_c';   // 아트 T-130
  props: string[];                         // lanyard_gray 필수, red·orange 금지
  fromDay: number; untilRank: RankId | null;   // 마지막으로 나오는 직급(null = 끝까지)
  behavior: 'sit' | 'stand' | 'walk';
  seat?: { x; y; facing: Dir };            // sit: 다른 사람 의자 'h'
  spot?: { x; y; facing: Dir };            // stand
  speedTilesPerSec?: number; loop?: true; waypoints?: { x; y; waitSec }[];   // walk
  idleAnims?: string[]; idleAnimEverySecRange?: Range<Sec>; _artRequest?: string;   // 아트 프레임 이름
  mechanics: { cone: false; talk: false; suspicion: false; blocksPlayer: false; offscreenArrow: false };  // 전부 false
  frozenByCeo: boolean;
}
```
- 배경 동료는 `NpcDef`로 만들지 않아도 됩니다(시선·말걸기·충돌 없음). 렌더 + 단순 경유점 이동만. `NpcId` 타입에도 넣지 않습니다.
- 현재 3명: `bg_next_team_a`(옆 팀 (2,15) 앉기, 인턴~과장), `bg_pantry_phone`(탕비실 (9,44) 서기), `bg_pantry_walker`(탕비실 순환 걷기, 2일차~). 인원은 1일차 2 / 2일차~과장 3 / 차장~ 2명.
- 📐 `bg_next_team_a`가 차장부터 빠지는 이유: 차장부터 옆 팀에 팀장 2(5,13)·본부장 동선이 겹쳐 y 6~25 창에서 9명이 됩니다(검사기 계산).

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
| block | `patrolIds[]`, `blockTiles`, `blockSec`, `leavePrePositioned`, `leaveBlockSec`, `leaveStartsAt`(T-134: 퇴근 땐 이 stopId 웨이포인트에 서서 시작, 대기 = leaveBlockSec), `talkIfAdjacent{radius, durationSec, lineKey}` |
| countdown | `patrolId`, `countdownSec: 'eta_to_stop_inspect'`, `countdownMinSec`, `inspectSec`, `absentSuspicion` |
| walker / walker_talk / walker_opportunity | `patrolId` 또는 `patrolVariants[]`, `leaveVariant`, `teamLeadGreeting{whenDirectorInZone, moveTo, gazeOff, talkOff}`, `meetingSec`, `letoutTellSec`, `blocksMissions[]`, `leaveStartsAt`(stopId), `leaveStopWaitSec`(T-134: 퇴근 땐 그 웨이포인트에서 시작해 이만큼 대기 = letoutTellSec 1.0) |
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
| pour_tap_stop (coffee) | `pourRatePerSec`, `targetBand`, `overflowAt`, `cupsRequired`, `tapBelowBand: 'pause'`, `tapInBand: 'success'`, `tapAboveBand: 'fail'`(T-134, failPenalty 적용), `carryCupWhileReturning` |
| trip_safe_zone (restroom) | `insideRestSec`, `insideBonusMaxSec`, `insidePointsPerSec`, `tapInsideAfterRest: 'leave_stall'`, `stallIsSafeZone` |
| nap_tap_toggle (nap) | `fatigueStart`, `fatigueRecoverPerSec`, `headDropPerSec`, `headRaisePerSec`, `headThudAt`, `headDownVisibleThreshold`, `headDownVisibleStateMultiplier`, `tapToggles`, `lockedDuringInterrupt` |
| screen_swap_tap (shopping) | `cartFillPerSec`, `itemsRequired`(T-134: 결제 전 상품 수, 결제는 안 셈. 값 2), `checkoutHoldSec`, `tapDuringCheckout`, `pausedShowsSpreadsheet` |
| rhythm_tap (snack) | `bitesRequired`, `minIntervalSec`, `perfectWindowSec`, `maxPressSec`, `noiseSuspicion`, `noiseAlertsRadiusTiles`, `noiseShortensBossIdleTo`, `biteUnderGazeSuspicion`, `activityStateAfterBiteSec`, `perfectBonusPoints` |
| leave_sequence | `clockStart`, `gameMinutesPerSec`, `phases[]`: `pack{sec, tapPauses, ifAwayWalkToSeatFirst}` → `walk{to, carryingBag}` → `gate{npc, ref}` → `elevator{waitSecRange, safeAfterGate, interruptHook}` |

---

## 7. ranks.json / days.json (개정)

```ts
interface RanksTable { schemaVersion: 2; budgetModel: {...}; ranks: RankDef[] }
// budgetModel: { introSec; leaveBaseSec; perLeaveInterruptSec; detourSec; ceoVisitPausedSec;
//   missionExpectedSec: Record<EventId(퇴근 제외), Sec>;
//   dayInterruptReserveSec?: Partial<Record<InterruptId, Sec>> }   // 🔧 T-139: 생성기 budgetCheck 전용(근무 방해 예약분)
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
  ambientOnly?: NpcId[];                                 // 앉아만 있는 NPC(상호작용 없음). D-049 배경 동료는 npcs.background(fromDay·untilRank)로 자동
  dayInterrupts: { id: InterruptId; atSec: Sec; trigger?: string }[];   // atSec 0 = 하루 종일 활성(근접형), -1 = trigger로만
  leaveInterrupts: { id: InterruptId }[];
  scripted: ScriptedBeat[];                              // type별 자유 필드(튜토리얼 연출)
  ceo: 'none'|'scheduled'|'random';
  expectedDurationSec: Sec;
}
```
- T-132: 1~15일차 공범 제안은 `scripted`의 `{type:'accomplice_offer', eventId, forced}`가 있는 날만(7·10·12·14일차). `offerProb`를 굴리지 않습니다. 16일차부터는 `day-{n}-npc` 스트림으로 판정. `generator.background` = 배경 동료 배치 규칙.
- `generator`는 16일차 이후 규칙(자연어 + 수식). 개발은 `generateDay(day): AuthoredDay`로 같은 모양을 돌려주면 됩니다. RNG 스트림 `day-{n}-{plan|boss|npc|event|leave}`.
- `t = (day − dayRange[0]) / (dayRange[1] − dayRange[0])`, 엔드리스 t = 0.

---

## 8. ads.json (신규) / strings.ko.json

```ts
interface AdsTable {
  schemaVersion: 2;
  global: { neverDuringPlay: true; playStates: string[]; bannerEnabled: false; shareReward: false };
  interstitial: { enabled; placement: 'result_to_next_day'; noticeKey; noticeSec; installDayMaxShows: 0;
                  everyNGames: 3; maxPerDay: 5; minIntervalSec: 180;      // T-132: exemptFirstGamesLifetime 삭제(D-048)
                  skipIfRewardedWatchedThisGame: true; removedByIap: 'remove_ads'; dayBoundary: 'local_midnight' };
  rewarded: { enabled; maxPerDay: 12;
              dailyCapReachedKey: 'ad.today_done';                    // 🔧 T-136: 하루 상한 도달 토스트(D-031)
              placements: { id: 'ceo_pass'|'continue'|'salary_double'; screen: 'prep'|'caught_offer'|'result';
                            labelKey; descKey?; condition: string; maxPerDay: number; effect: string;
                            // continue 전용(T-132, D-050 ①~⑧·D-056)
                            declineLabelKey?; notCompletedKey?; unavailableKey?;   // T-136: ceo_pass도 notCompletedKey·unavailableKey 사용
                            onNotEarned?: 'go_to_result_no_retry' | 'keep_visit_button_reenabled';   // T-136: ceo_pass는 후자 declineButtonSameSize?: true; autoCountdown?: false;
                            onNotEarned?: 'go_to_result_no_retry'; onAdUnavailable?: 'skip_offer_screen'; submitScoreToLeaderboard?: false;
                            // salary_double 전용
                            buttonOnlyNoPopup?: true }[] };
  iap: { remove_ads: { priceKrw: 2900; removes: ['interstitial']; keepsRewarded: true; featureFlag: string; enabledUntilBusinessApproved: false } };
  counters: { persist: string[]; storage: 'apps_in_toss_storage' };
}
```
- 전면광고 판정 순서(개발): `iap 구매` → `global.neverDuringPlay` → `설치 당일` → `오늘 횟수 ≥ 5` → `마지막 광고 후 < 180초` → `이번 판 보상형 봄` → `판수 % 3`. 하나라도 걸리면 건너뜀.
- strings: `{ schemaVersion, locale, strings: Record<key, string | string[]>, uiIcons?: Record<key, spriteId> }`. 새 접두사 `prep.` `map.` `zone.` `route.` `int.`. `uiIcons`는 해당 문구 앞에 그릴 UI 스프라이트(이모지 대체, D-042). 이모지 금지, 특수문자 `… · — ★`만.
- T-132 문자열: 게임 속 화폐 단위는 `닢`(`ui.currency_unit`, `result.salary`). 실제 화폐 단위 `{n}원`과 내부 ID(`snitch` 등)가 문구에 들어가면 검사기 오류.

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
`python3 -I molrae-toegeun/design/tools/validate_data.py` → `OK` 또는 오류 목록(종료 코드 1). 검사 항목: schemaVersion, `*Key`·`reactionKeys` 문자열 존재, 전조 최소·페이크 상한(보간 값 포함), 맵 크기·legend·스폿/웨이포인트 통행·도달, 테이블 간 ID 참조, 방해 phase·unlockDay, 하루 예상 길이 범위, D-037 사원증 색. **T-132 추가**: 층 인원 ≤ 12·화면 안 ≤ 8(수작업 날은 그날 구성, 생성 날은 직급별 방해 countRange 최대 개수의 모든 조합 중 최악, 대표님 날 H7 반영. 각 캐릭터가 있을 수 있는 y 범위로 보수적 계산), 배경 동료(2~3명·메카닉 전부 false·회색 줄·자리/경로 유효), 말걸기 `warnSec`·`catchRadius`·`releaseSec`·문구 키, `talkedPerSec = 0`, `resultInputGuardSec ≥ 0.4`, 유리벽 walkable=false·blocksSight=false(D-053), 플레이어 줄 하늘색(D-052), `exemptFirstGamesLifetime` 없음(D-048), 이어하기 조건(D-050·D-056), 문자열 이모지·내부 ID·`{n}원`, 수작업 날 공범 제안 미션 존재, sfx 키 ⊂ `game/assets/audio/audio-manifest.json`(읽기 전용), 걷는 NPC `walkTellSfx`, 게이트 sfx, `visualCues` 6종·깜빡임 ≤ 3Hz. **T-134 추가**: `spriteKey`·`playerSpriteKey`·배경 `sprite` ⊂ `game/assets/sprites/anims.json`(idle·walk 4방향). **T-136 추가**: 이어하기 재개 의심(구 필드와 일치)·컷인 길이·alert 임계(매니페스트 숫자 일치)·H7 간격·대표님 재확인 플래그와 전조·얼음 안전장치·공범 제안 종료 규칙·간식 판정 시점·광고 문구 키. **T-139 추가**: 예산 모델 키(`missionExpectedSec`·`dayInterruptReserveSec`·`perLeaveInterruptSec`), `budgetCheck` 형식, 인사 QTE 창 ≥ 0.4(보간 포함), 생존 상승 범위, 대표님 `coneActiveIn`, 탈출 보너스 시각 범위, `star3PeakBelow` 0.1~0.3, INT-05 `cancelOnLeaveStart`. 실행 끝에 직급별 화면 안 최악 인원을 출력합니다. 데이터를 고칠 때마다 실행하세요. CI 편입은 개발·QA 판단입니다.

---

## 11. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| 1 | 2026-11-22 | 최초 작성(T-101, 측면 홀드/떼기 기준) |
| 2 | 2026-11-22 | **탑다운 전면 개정(T-121)**. 아래 상세 |
| 2 (T-132) | 2026-11-22 | 개발 T-127·아트 T-125·사운드 T-113·컴플라이언스 리뷰 반영. **필드 추가·값 수정만, 키 이름·계층 변경 없음 → schemaVersion 2 유지**. 아래 상세 |
| 2 (T-134) | 2026-11-23 | 개발 T-129 해석 6건 확정(`design/gdd.md` §19-3) + spriteKey 데이터 요청. **필드 추가·값 수정 1건만, 구조 변경 없음 → schemaVersion 2 유지**. 아래 상세 |
| 2 (T-136) | 2026-11-23 | 개발 T-133 코드 상수 → 데이터(숫자 4, 문구 키 2), T-133 해석 6건 확정(`design/gdd.md` §19-4). **필드 추가만, 값·키 이름·계층 변경 없음 → schemaVersion 2 유지**. 아래 상세 |
| 2 (T-139) | 2026-11-23 | QA T-131 밸런스 제안 10건 + D-070 반영(`design/gdd.md` §19-5). **필드 추가·값 수정만, 키 이름·계층 변경 없음 → schemaVersion 2 유지**. 아래 상세 |
| 3-draft (T-142) | 2026-11-23 | 새 테이블 `layout.json`·`missions.json`(schemaVersion 3) 추가. 상세 스키마는 `design/data-schema-v3-draft.md`. **v2 테이블은 변경 없음**(키·값 그대로). 검사기는 테이블별 버전 확인(layout·missions = 3, 나머지 = 2)과 v3 기본 검사를 추가 |
| 2 (T-148) | 2026-11-24 | 성별 다양화(REQ-016, D-087·D-088). **필드 추가만, 키 이름·계층·기존 값 변경 없음 → schemaVersion 2 유지**(v3 테이블도 3 유지). 아래 상세 |
| 2 (T-152) | 2026-11-24 | 컴플라이언스 성별 검토(T-150) 반영, D-090·D-095. **필드 추가·값 수정만, 키 이름·계층 변경 없음 → schemaVersion 2 유지**(v3 테이블도 3 유지). 아래 상세 |

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

### T-132 상세 (v2 유지)
- **추가**
  - npcs `gate` 시각 ID는 아트와 같은 `gate_fail_flash`·`gate_pass_flash`.
  - bosses·npcs `sim.talk`: `warnSec`·`catchRadius`·`releaseSec`·`warnLineKey`·`dodgedLineKey`(§3 표).
  - bosses(director·team_lead)·npcs(security_guard·hr_inspector): `sim.walkTellSfx`.
  - npcs `gate`: `failSfx`·`okSfx`·`failVisual`·`failVisualSec`·`failShowsAttemptsLeftKey`·`okVisual`·`okTextKey`.
  - npcs `accomplice.offer`: `authoredDaysScriptedOnly`·`offerRollStream`·`_offerNote`.
  - npcs 최상위 `background[]`(배경 동료 3명, D-049).
  - rules: `input.resultInputGuardSec` 0.6, `talk.warnSecDefault`·`catchRadiusRule`·`releaseSecRule`, `sight.cornerTurnTellSfx`, `tell.defaultWalkTellSfx`, `visualCues`, `characters.maxOnScreen`·`screenRowsTiles`·`backgroundCountsTowardLimits`·`playerProps`, `continueAd.submitScoreToLeaderboard` false, `suspicion._deprecated`.
  - ads `rewarded.placements[continue]`: `declineLabelKey`·`notCompletedKey`·`unavailableKey`·`declineButtonSameSize`·`autoCountdown`·`onNotEarned`·`onAdUnavailable`·`submitScoreToLeaderboard`. `salary_double.buttonOnlyNoPopup`.
  - days: 10·12·14일차 `scripted`에 `accomplice_offer`, `generator.background`.
  - strings: §「개발 전달 키」(design/gdd.md §19) 참고.
- **값 수정**
  - `rules.characters.maxOnFloor` 8 → 12(D-049).
  - `result.salary` '원' → '닢'. `ad.salary_double`에 '(게임 속 월급)'. `ad.continue_desc`에 '광고를 끝까지 보면'.
  - `react.director.caught`: 보복 뉘앙스 제거. `react.hr_inspector.badge`: 외모 언급 제거.
- **삭제·폐지**
  - `ads.interstitial.exemptFirstGamesLifetime` 삭제(D-048).
  - `rules.suspicion.talkedPerSec` 폐지 표시. 값 0으로 남기고 런타임은 무시하며, v3에서 삭제합니다.
- **확인만** (변경 없음)
  - `maps.legend.g`(유리벽): walkable=false, blocksSight=false(D-053). 검사기가 고정합니다.
  - 문자열 이모지: 없음. `★`(U+2605)만 허용 특수문자로 남겼습니다.
  - 화면 문구에 내부 ID가 노출된 곳: 없음.

### T-134 상세 (v2 유지)
- **추가**
  - bosses `spriteKey`: senior→`senior`, team_lead→`teamlead`, director→`exec`, ceo→`ceo`.
  - npcs `spriteKey`: security_guard→`guard`, snitch→`snitch`, accomplice→`accomplice`, hr_inspector→`hr`.
  - rules `characters.playerSpriteKey` `player`. 배경 동료는 기존 `background[].sprite`(bg_a/b/c)를 그대로 씀(필드 이름 변경 없음).
  - events `coffee.params.tapAboveBand` `fail`, `shopping.params._itemsRequiredNote`.
  - npcs `security_guard.gate`: `windowCenter` 0.5, `markerMotion` `ping_pong`, `waitingCountsAsDisguised` true, `_t134Note`.
  - rules `talk`: `catchRequiresEnterRadiusDuringTell`·`silentCancelSaysDodgedLine`·`dodgeAfterEnterLooksAtPlayer`(모두 true), `_resolveRule`.
  - maps `office_floor_1.camera`: `clampIncludesHudInset`·`hudCoveredRowsAreOffscreen`(true), `_t134Note`.
  - interrupts `INT-04.effect.leaveStartsAt` `stop_gossip`(개발 하드코딩 대체용), `INT-08.effect.leaveStopWaitSec` 1.0, 둘 다 `_leaveNote`.
- **값 수정**
  - `events.shopping.params.itemsRequired` 3 → **2**. 뜻은 '결제 전 상품 수'(개발 해석과 같음). GDD 본문·`_designNote`·예상 9초가 2개 기준이었고, 데이터 3은 오기였습니다.
- **검사기**: `spriteKey`·`playerSpriteKey`는 문자열 키 검사에서 제외합니다. 대신 이 키와 배경 `sprite`마다 `game/assets/sprites/anims.json`(아트 출력, 읽기 전용)에 `idle_*`·`walk_*` 4방향 애니가 있는지 검사합니다. 파일이 없으면 경고만 냅니다.
- 개발 영향: 새 플래그(`tapAboveBand`, `windowCenter`, `talk.*`, `camera.*`)는 모두 개발 현재 구현을 명시한 값이라 동작 변화가 없습니다. 동작이 바뀌는 것은 `itemsRequired` 2 하나입니다. `spriteKey`는 `render/sprites.ts` `ACTOR_SPRITE`와 값이 같습니다.

### T-136 상세 (v2 유지)
- **추가(숫자, 개발 상수 대체)**
  - rules `continueAd.resumeSuspicion` 0.6 (`DEFAULTS.continueResumeSuspicion` 대체). 기존 `suspicion.continueResetTo`는 같은 값으로 남기고 `_deprecated`에 표시. 검사기가 두 값 일치 확인. v3에서 `continueResetTo` 삭제.
  - rules `caughtCutin.durationSec` 2.0, `isPlayState` true (`GameScene.CUTIN_SEC` 대체). 검사기 1.5~3.0, `ads.global.playStates`에 `caught_cutin` 포함 확인.
  - rules `visualCues.dangerBorder.alertSuspicionMin` 0.4 (`GameScene.ALERT_SUSPICION`·`dangerStage.ts` 대체). 검사기: `star3PeakBelow` ≤ 값 < `suspicionHigh.threshold`, 오디오 매니페스트 `alert.when` 문장 숫자와 일치.
  - days `generator.dayInterrupts.h7`: `ceoDirectorMinGapSec` 25 (`buildDay.H7_GAP_SEC` 대체), `onPlanConflict` `drop_director_patrol`, `ceoStartWaitsWhileDirectorOnFloor` true, `directorStartWaitsWhileCeoOnFloor` true, `hrInterruptsOnCeoDay` `none`. `constraints` 문장은 사람용으로 유지. 검사기 ≥ 20.
- **추가(문구 키)**
  - strings `ad.today_done`, `ad.ceo_pass_not_completed`.
  - ads `rewarded.dailyCapReachedKey` `ad.today_done`. `placements[ceo_pass]`: `notCompletedKey` `ad.ceo_pass_not_completed`, `unavailableKey` `ad.continue_unavailable`(범용 문구 재사용), `onNotEarned` `keep_visit_button_reenabled`.
- **추가(해석 확정용 플래그)**
  - npcs `accomplice.offer`: `forcedHoldsUntil` `mission_commit`, `endsAtMissionCommit` true, `missionCommit` `{awayFromDesk: 'activity_start', atDesk: 'first_input'}`.
  - bosses `ceo.sim.fake.asRealLookAtRecheckWaypoint` true(재확인 = 진짜 시선, 확률은 보간된 `fake.chance`, 전조는 `fake.tellSec` 0.5).
  - bosses `ceo.visit.freeze.safetyExtraSec` 3.0(개발 `freezeMaxSec + 3` 대체).
  - events `snack.params.judgeOn` `release`.
- **검사기**: 위 항목 전부(§10 T-136). 음성 테스트(값을 일부러 틀리게 한 복사본)로 오류 검출 확인.
- 개발 영향: 동작이 바뀌는 것은 ① 공범 제안이 자리 미션(간식)에서 첫 입 때 끝남 ② 대표님 재확인 확률이 직급 보간(과장 초반 0.30)·전조 0.5초 ③ 대표님이 층에 있는 동안 본부장 등장 연기 ④ 하루 보상형 상한일 때 보상형 버튼 숨김. 나머지는 현재 구현과 같은 값을 데이터로 옮긴 것입니다.

### T-139 상세 (v2 유지)
- **추가(🔧 개발 구현 필요)**
  - days `generator.missions.budgetCheck`: `{enabled: true, minRequired: 2, minSlackSec: 0, onOver: "drop_required", expectedSecFrom, reserveSecFrom, rule, order}`.
    - 규칙: need = (이 날 미션의 `missionExpectedSec` 큰 순서로 required개 합) + rank.workQuota ÷ rules.work.fillPerSec + Σ `dayInterruptReserveSec`[H7 필터 뒤 dayInterrupts의 id].
    - need > dayPhaseSec − minSlackSec이고 required > minRequired이면 required −1 후 다시 계산합니다(반복).
    - 미션 목록·해금 시각은 바꾸지 않습니다. 모든 추첨 뒤에 적용하므로 RNG 소비는 바뀌지 않습니다. 대표님 날 −1을 먼저 적용한 값에서 시작합니다.
  - ranks `budgetModel.dayInterruptReserveSec`: INT-04 2.0, INT-05 3.0, INT-06 1.5, INT-08 2.0, INT-10 3.0.
  - bosses `ceo.visit.missionTimersPausedWhileFrozen` true: 미션 제한 시간을 얼음 표시 내내 멈춥니다(전조~퇴장 뒤 복귀 전, `frozenAll`). 근무 시계는 지금처럼 ①~⑤만 멈춥니다.
  - interrupts `INT-05.effect.cancelOnLeaveStart` true(D-070): 퇴근 단계가 시작되면 카운트다운·점검을 취소합니다.
- **추가(메모만, 런타임 무시)**: `_t139*Note`(days 2·4, ranks budgetModel, events shopping params, npcs security_guard, bosses team_lead talk·ceo sim/greetingQte/survival/visit, rules suspicion/day), INT-05 `_cancelNote`.
- **값 수정**

  | 위치 | 이전 | 이후 |
  |---|---|---|
  | `days[2].dayPhaseSec` / `expectedDurationSec` | 40 / 63.3 | 44 / 67.3 |
  | `days[4].missionsRequired` | 2 | 1 |
  | `ranks.budgetModel.perLeaveInterruptSec` | 2.0 | 1.7 |
  | `ranks.budgetModel.missionExpectedSec` | 13/16/15/9/7 | 12.5/17.5/14/10/7.5 (커피/화장실/낮잠/쇼핑/간식) |
  | `ranks[manager·deputy].ceoDayPhaseReductionSec` | 6 | 12 |
  | `ranks[general_manager·executive].ceoDayPhaseReductionSec` | 7 | 13 |
  | `events.shopping.timeLimitSec` | 13 | 15 |
  | `npcs.security_guard.sim.talk.catchRadius` | 1.25 | 1.6 |
  | `npcs.security_guard.rankScaling gate.windowRatio` | 과장 0.18→0.16, 차장 0.16→0.15, 부장 0.15→0.14, 임원 0.14 | 0.20→0.19, 0.19→0.18, 0.18→0.17, 0.17 (기본 0.22 유지) |
  | `bosses.team_lead.sim.talk.catchRadius` | 1.8 | 2.5 |
  | `bosses.ceo.greetingQte.windowSec`(기본·과장) | 0.6 | 0.42 |
  | `bosses.ceo.rankScaling greetingQte.windowSec` | 차장 0.55→0.5, 부장·임원 0.5 | 차장 0.42→0.40, 부장·임원 0.40 |
  | `bosses.ceo.survival.maxSuspicionGain` | 0.15 | 0.10 |
  | `bosses.ceo.sim.coneActiveIn` | [walk, look] | [look] |
  | `rules.suspicion.star3PeakBelow` | 0.30 | 0.15 |
  | `rules.day.earlyLeaveBefore` | "18:00" | "18:05" |
  | strings `event.leave.early_bonus` | "18시 전 탈출 보너스!" | "칼같은 퇴근 보너스!" |
  | strings `react.security_guard.early` | "아직 18시 전인데… 외근이세요?" | "벌써요? 아직 해가 쨍쨍한데… 외근이세요?" |

- **검사기(§10 T-139)**: 다음 항목을 확인합니다.
  - `missionExpectedSec` 키 = 미션 이벤트 전부.
  - `dayInterruptReserveSec` id 존재, 0~10.
  - `perLeaveInterruptSec` 1~3.
  - `budgetCheck` 형식.
  - 인사 QTE 창 최솟값 ≥ 0.4(보간 값 포함).
  - 생존 상승 0~0.2, 대표님 `coneActiveIn` 비어 있지 않음.
  - `leaveClockStart` < `earlyLeaveBefore` < `overtimeAt`.
  - `star3PeakBelow` 0.1~0.3.
  - INT-05 `cancelOnLeaveStart` true.
- **개발 영향**
  - 데이터만으로 동작이 바뀌는 것: 위 값 수정 전부. 특히 대표님 날 근무 44초, 18:05 기준(보너스와 INT-07 조건이 함께 바뀜), 대표님 퇴장 중 시선 없음.
  - 코드 구현이 필요한 것: `budgetCheck`, `missionTimersPausedWhileFrozen`, `cancelOnLeaveStart` 3건. 구현 전에는 무시돼도 크래시가 없는 추가 필드입니다.
- **QA 테스트 기대값 영향**: `t131-rules` '쇼핑 방치 → 시간초과(13초)'를 15초로 바꿔야 합니다. '18:00 전 탈출 보너스' 항목명은 18:05로 바꿔야 합니다.

### T-148 상세 (v2 유지)
- **bosses.json** 각 상사: `variants`(`[{id: "m"|"f", gender: "male"|"female", spriteKey}]`, spriteKey = `<기존 spriteKey>_m|_f`), `casting`(`{mode: "fixed", variant}` | `{mode: "fixed", byInstance: {"1": .., "2": ..}}` | `{mode: "rotate", rule: "relation_block2"}`). 최상위 `_t148Note`. 기존 `spriteKey`는 변형 그림이 없을 때 대체로 유지.
- **npcs.json** 각 NPC·배경 동료: `variants`·`casting`(위와 같음). 최상위 `buddy`(옆 팀 동기: `sprite` `bg_buddy`, variants·casting, `seatSpot` `buddy_seat`, `fromDay` 19 — 배경 동료 인원 셈 D-049에는 넣지 않음), `_t148Note`.
- **rules.json** `characters`: `playerVariants`(남/여 2종, `labelKey`), `playerSelection`(`defaultVariant` null, `preselected` false, `requiredBeforeFirstDay` true, `screen` first_clock_in, `displayOrder`, `sameSizeSameEmphasis`, `changeableIn` settings, `appliesFrom` next_run, `storageSlot` player.variant, `fallbackSprite` player, 문구 키 5), `casting`(`rotation` relation_block2 = 플레이어 기준 2일 블록 균형, `gameplayMayDependOn` [relation], `balance` 비율 범위). 기존 `playerSpriteKey`·`playerProps` 그대로.
- **interrupts.json** INT-10 `effect.facilityStop`(C2·C3, `enabledWith` layout.genderFacilities.enabled, `tellSec` 1.0, `insideSec` 3.0, `insideCone`, `seenInsideEffect` 의심 +0.05 한 번·1.2초, `whileInside`, `skipIf`).
- **strings.ko.json** 새 키 26개(`charsel.*`, `settings.character*`, `zone.locker_room`·`zone.fitness`, `hint.restroom.*`, `tutorial.tut_gender_restroom`·`tut_director_restroom`, `int.talk.cancel_at_door`, `int.director_restroom.*`, `react.director.restroom_seen`, `mod.facility_cleaning*`, `facility.cleaning.sign`, `react.restroom.cleaning`, `mod.relocate.locker`, `event.restroom.locker_inside`, `react.locker.exposed`). 기존 문구 변경 없음(이미 성별 무관 문장).
- **v3 테이블**: `design/data-schema-v3-draft.md` §8 T-148 줄.
- **개발 영향**: 모든 새 필드는 무시해도 크래시가 없는 추가 필드입니다. `genderFacilities.enabled` false인 동안 생성 맵은 기존과 같습니다(새 모듈은 기존 그룹 목록에 없는 새 그룹). 구현 목록은 `design/gender-design.md` §8.
- **검사기(§10 T-148)**: 변형 2종·spriteKey 중복 없음(anims.json 미반영은 WARN), casting 형식, 플레이어 선택 기본값 없음, 직급별·전체 출연 여성 비율, 고정 인물 집합 양성 포함, 성별 시설 모듈 대칭, 절대 성별 값 금지, facilityStop 회전 인물·벌 상한, 성별 호칭·고정관념 단어.

### T-152 상세 (v2 유지)
- **값 수정**
  - npcs.json `buddy.casting`: `{mode: "fixed", variant: "f"}` → `{mode: "rotate", rule: "relation_block2"}`(D-090). `variant` 키는 회전이라 빠짐(casting 형식은 T-148에서 정의한 두 형식 중 하나 그대로).
  - rules.json `characters.casting.balance.requireBothGendersIn`: `["fixed_bosses", "fixed_npcs"]` → `["fixed_bosses"]`(D-095 A안, 아래 `coworkerSet`이 대체).
  - strings.ko.json 값 6건: `event.restroom.name` "화장실 피신", `event.restroom.locker_inside` "탈의실 구석 칸, 잠깐의 평화", `react.director.restroom_seen` "(세면대 앞에서 딱 마주쳤다) …손만 씻으러 왔습니다.", `int.director_restroom.meet[0]` "어, {name} 씨. 여기서 다 보네요~", `charsel.note`(실제 성별과 상관없이…), `charsel.confirm` "출근하기".
- **필드 추가**
  - rules.json `characters.casting.balance.coworkerSet`(`members`, `femaleShareRange` [0.30, 0.70]), `characters.playerSelection.analytics`(`sendVariant` false, `logVariant` false).
  - interrupts.json INT-10 `facilityStop.insideCone.renderCone` false·`judgeOnly` true, `facilityStop.insideCue`(`overHead` icon_door_alert, `minSec` 0.4).
  - layout.json `legendAdd.W`: `occupiedDisplay` closed_door_in_use, `inUseLabelKey` facility.in_use, `steamIcon` false, `drawOccupantInside` false, `occupiedArt` tile2/shower_stall_hiding(아트 T-149). `genderFacilities.access.talkCancelNpcBehavior` stop_in_place·`talkCancelNpcApproachDoor` false. `genderFacilities.artRules`.
  - missions.json `modifiers[avoid.* 5종, bonus.cover].facilityLabelKey` + `stringsKo` 6키(`*.facility`), 최상위 `_facilityLabelNote`.
  - events.json `events[restroom].shareCard`(`trigger` false, `eventVarAllowed` false). 다른 이벤트는 필드 없음 = 기본 true.
  - strings.ko.json 새 키 `facility.in_use` "사용 중", 최상위 `copyRules`(`facilityCombo`, `shareCard`).
- **개발 영향**: 전부 무시해도 크래시가 없습니다. 구현이 필요한 것은 ① 시설 안 콘 그리지 않기(판정만) + 머리 위 '!' ② 시설 미션 칩에서 `facilityLabelKey` 우선 ③ 말걸기 문 취소 시 NPC 제자리 정지 ④ 샤워 칸 '사용 중' 표시 ⑤ 공유 카드 생성 시 `shareCard`·`copyRules.shareCard` 준수 ⑥ player.variant 분석·로그 전송 안 함. 상세 `design/gender-design.md` §8.
- **검사기(§10 T-152)**: 동료 집합 여성 비율 범위, 동기 회전, `fixed_npcs` 사용 금지, variant 전송 금지, 시설 안 `renderCone` false·`insideCue` ≥ 0.4초, 샤워 칸 표시, `artRules`, 말걸기 취소 NPC 문 접근 금지, '몰래'류 + 시설 단어 금지 조합(문자열 전체 + 시설 미션 칩 = 미션 이름 × 붙을 수 있는 변형 라벨), 공유 카드 성별 변수·화장실 트리거 금지.
- **PM 결정 반영(D-098~D-100, 같은 T-152)**
  - 값 수정: `relocate.bank_stall.spot` restroom_stall → `storage_corner_use`, `rewardMul` 1.0 → 1.1, `params.stallIsSafeZone` false, `targetFacility` 키 삭제(시설 미션이 아님). `modifierTemplates[relocate].appliesTo.bank` 같은 값. `genderModifiers[facility.cleaning].missions` ["restroom", "bank"] → ["restroom"].
  - 문구 4건: `int.director_restroom.meet[0]` "어… 여기서 다 보네요~"(D-099), `int.director_restroom.away` "본부장님이 잠깐 자리를 비우셨어요. 복도가 비었어요!"(T-17), `mod.facility_cleaning.desc` "…다른 길로 갈지 골라요."(T-20), `day.2.title` "화장실은 소중하니까"(T-27).
  - 필드 추가: layout `mid_printer`·`bottom_storage`의 `spots.storage_corner_use`(타일 (1,3), use, target storage_corner). rules `casting.balance.fixedRoster`(`approved` 6자리, `newFixedMustBe` female). strings.ko `copyRules.facilityLines`(`keyPrefixes`, `forbidPlaceholders` ["{name}"]).
  - 검사기: 고정 명부(D-098), 시설 문구 `{name}` 금지(D-099), 시설 밖 미션 변형의 시설 목적지 금지(D-100).
  - 개발 영향: 코드 변경 없음(`spotOk`가 창고 모듈이 없는 날 이 변형을 거름). 단 변형 후보가 바뀌어 생성 날의 변형 추첨 결과가 달라질 수 있음 → QA 기대값 재생성 필요.
