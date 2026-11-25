# 몰래퇴근 데이터 스키마 v3 초안: 생성 층·팀장 순회·미션 변형 (schemaVersion: 3)

- 작성: mt-game-designer / T-142 / 2026-11-23
- 대상: `game/data/layout.json`, `game/data/missions.json`(새 파일). 기존 v2 테이블(`design/data-schema.md`)은 이번에 바꾸지 않았습니다.
- 규칙: `design/gdd-v3-procedural.md`. 이 문서는 **필드·타입·단위와 개발 타입 대응**만 다룹니다.
- 기준 코드: 개발 T-144 `content/layoutGen/types.ts`·`generate.ts`·`validate.ts`·`index.ts`, `content/levelProvider.ts`, `content/devTour.ts`, `core/day/modifiers.ts`, `core/day/types.ts`. **같은 이름 = 같은 의미**입니다. 🔧는 개발 확장이 필요한 필드이고 §6에 모았습니다.
- 검사: `python3 -I design/tools/validate_data.py`. v3 기본 검사를 추가했습니다(§7). 참조 프로토는 `design/tools/layout_proto.py`입니다.
- 상태: **초안 — 구현 착수 가능**. 개발 임시 상수(`DEV_LAYOUT_*`, `DEV_TOUR`)를 이 파일들로 대체할 수 있게 만들었습니다. 이름이 다른 곳은 §5 대응표를 보세요.

## 0. 공통

| 항목 | 규칙 |
|---|---|
| 버전 | 최상위 `schemaVersion: 3`. v2 테이블은 2 유지(검사기가 테이블별로 확인) |
| 활성화 | 최상위 `enabled: boolean`. false면 개발은 기존 동작(수작업 맵·기존 미션) |
| 좌표 | 모듈 **로컬** 타일 `[x, y]`, 원점 모듈 왼쪽 위. 전역 = 로컬 + 모듈 y0. 반전 시 x' = width − 1 − x |
| 복잡도 c | 0~1. `[c0, c1]` 두 값 배열은 `lerp(c0, c1, c)`(개발 `weightByComplexity`·`WildcardOption.weight`와 같음) |
| 범위 | `[min, max]` 정수 범위는 보간 후 `round` → 시드 `int(lo, hi)`(개발 `lerpRange`) |
| 시드 | 층 `layout:` + `layout-day-{day}` (+ `#r{i}`) — 개발 그대로. 순회 `day-{day}-tour`. 변형 `day-{day}-mission`(신규) |
| 정수 연산 | 생성·검증은 정수로(기기 간 동일 맵 보장). 콘 각도는 정수 내적·제곱 비교 |
| 메모 | `_`로 시작하는 키는 사람용. 런타임은 무시. 🔧 빌드 때 제거 권장(용량) |
| 문자열 | `*Key`는 strings 참조. 병합 전 새 문자열은 `missions.json` `stringsKo`(검사기가 출처로 인정) |
| 아트·사운드 | `art`(아트 키 문자열, `|` = 후보), `sfx`(매니페스트에 있는 키), `sfxNew`(요청 중인 새 키) + `sfxFallback`(지금 쓸 대체 키) |

```ts
type Sec = number; type Tiles = number; type Ratio01 = number; type C01 = number;
type Lerp2 = readonly [number, number];          // [c=0 값, c=1 값]
type IntRange = readonly [number, number];
type Dir = 'up' | 'down' | 'left' | 'right';
type RankId = 'intern'|'staff'|'assistant_manager'|'manager'|'deputy_general_manager'|'general_manager'|'executive';
```

---

## 1. layout.json — 최상위

```ts
interface LayoutTable {
  schemaVersion: 3;
  enabled: boolean;                      // = 개발 layoutEnabledInData(). 초안은 false(연동 뒤 PM이 true)
  authoredMapDays: number;               // 2 = DEV_LAYOUT_POLICY.authoredMapDays (1~2일차 수작업 맵)
  sourceMapId: string;                   // 'office_floor_1' = DEV_LAYOUT_POLICY.sourceMapId (legend·카메라·순찰 원본)
  generatorVersion: number;              // 바뀌면 같은 일차의 맵이 바뀜(리더보드). 🧪 QA 해시 스냅샷 키
  seed: { format: 'layout-day-{day}'; attemptFormat: '{seed}#r{i}'; rngPrefix: 'layout:'; integerOnly: true };
  grid: { width: 11; maxHeight: 64; tileSizePx: 16; legendBase: 'maps.office_floor_1.legend' };
  legendAdd: Record<string, LegendEntryV3>;          // §1-1. legendBase에 덮어 합침
  wildcards: Record<string, WildcardOption[]>;       // = LayoutRules.wildcards (개발 형식 그대로)
  seam: SeamRuleV3;                                  // §1-3
  modules: ModuleTemplateV3[];                       // §1-2
  assembly: AssemblyRules;                           // §1-4 🔧
  repair: RepairRules;                               // §1-5 🔧
  complexityByRank: RankComplexity[];                // §1-6
  complexityFormula: string;                         // 설명
  missionRefOneWayTiles: Record<string, Tiles>;      // 예산 보정 기준 편도(§1-7)
  validators: { maxAttempts: 24; onExhausted: 'authored_map'; list: ValidatorDef[]; metricsOnly: string[] };  // §2
  patrolTemplates: Record<string, PatrolTemplate>;   // §3 (재매핑 실패 때만)
  leadRoaming: LeadRoaming;                          // §4
}
```

### 1-1. LegendEntryV3

```ts
interface LegendEntryV3 {                // = core/grid LegendEntry + v2 확장 + 아래
  kind: string; walkable: boolean; blocksSight: boolean; zone?: string;
  cover?: boolean; disguiseSpot?: boolean;
  art?: string;                          // 아트 키(T-143). '|' 후보는 시드로 하나(장식 변화, 판정 무관)
  footprint?: [w: number, h: number];    // 여러 칸 가구(2×1). 모듈 격자에 같은 문자가 그 칸 수만큼 있음. 렌더러가 왼쪽 칸 기준 dx: 8
}
```
- 추가 문자: `P`(값 동일, 그림 pfull) `i` `O` `H` `L` `Z` `R` `Q` `V` `k` `F` `w` `U` `u` `Y` `J` `=`(art 추가만).
- 칸막이 `P`·`i`는 `<mask>`(n·e·s·w 이웃) 자동 타일링을 씁니다. **`P`와 `i`는 서로 이웃으로 치지 않습니다**(아트 §13-1).
- `U`·`u`(큐비클 위 2칸)의 아래 2칸은 좌석 `h`입니다. 렌더러는 `UU`+`hh` 2×2를 `cube52/cubicle_high` 한 장으로 그립니다.

### 1-2. ModuleTemplateV3 (= 개발 ModuleTemplate + 확장)

```ts
interface ModuleTemplateV3 {
  id: string;
  group: string;                         // 🔧 'lobby_exit'|'exec'|'next_team'|'rest_meet'|'team'|'lounge'|'printer'|'pantry'|'junction'|'service_end'
  tags: string[];                        // = ModuleTemplate.tags ('top'|'exec'|'middle'|'team'|'lower'|'bottom')
  rows: string[];                        // = rows. 폭 = grid.width. 와일드카드 '?','!','o' 포함 가능
  ports?: {                              // 🔧 없으면 '가장자리 행에서 통행 가능한 모든 열'(개발 seamCandidates와 같음)
    top?: number[]; bottom?: number[];   // 이음 행을 뚫을 수 있는 열(로컬 x). 반전 시 변환
    required?: { top?: number[]; bottom?: number[] };   // 항상 여는 열(회의실 모듈 가운데 복도 x5)
    doorCols?: number[];                 // 여기 열리면 '=' 고정, 안 열리면 seam.closedDoorPortChar('Y')
    doorOpenChance?: Lerp2;              // doorCols를 열 확률
  };
  mirrorable: boolean;                   // = mirrorable
  weightByComplexity?: Lerp2;            // = weightByComplexity (없으면 1)
  minComplexity?: C01;                   // = minComplexity
  repeatable?: boolean;                  // = repeatable (junction만)
  requiresGroup?: string;                // 🔧 bottom_storage → 'pantry' 필수
  provides: string[];                    // 🔧 미션·순회 요구 매칭('coffee_machine','printer','copier','cafe_counter','window','buddy',…)
  spots: Record<string, ModuleSpotV3>;   // = spots (형식만 다름 §5)
  routeNodes: Record<string, [number, number]>;   // = routeNodes. 이름은 수작업 맵과 같게(재매핑용)
  zones?: { id: string; nameKey: string; rect: [x, y, w, h]; outsideOffice?: boolean; parent?: string }[];
  chokepoints?: { id: string; tiles: [number, number][]; includeSeamAbove?: boolean; includeSeamBelow?: boolean; bypass: string }[];
}
interface ModuleSpotV3 {
  tile: [number, number]; facing?: Dir;
  type?: 'seat'|'stand'|'use'|'door'|'spawn'; target?: string;
  lookDirs?: Dir[];                      // 앉은 상사: 돌아보는 방향(team_back = ['up'])
  glanceDir?: Dir;                       // 정의로운 동료 힐끔 방향
  stopId?: string;                       // 순찰·순회 정지 이름
  floorMark?: boolean;                   // 바닥 대기 표시(tile2/floor_print_mark)
  pose?: string;                         // 미션 포즈(nap_on_sofa)
}
```

- **스팟 이름 규약**
  - 수작업 맵 스팟·노드 이름은 그대로 씁니다(재매핑).
  - 미션 장소 `*_use`
  - 팀장 순회 `tour_*`(개발 `DEV_TOUR.destinations` 스팟과 같은 접두사)
  - 배경 동료 `bg_*_seat`·`*_spot`
- 같은 스팟 이름이 두 모듈에 있으면(예: `coffee_use`가 mid_pantry·bottom_pantry) 먼저 나온 것을 씁니다(개발 규칙 동일). `assembly`가 탕비실을 둘 다 넣지 않으므로 실제로는 생기지 않습니다.

### 1-3. SeamRuleV3 (= 개발 SeamRule + 확장)

```ts
interface SeamRuleV3 {
  wallChar: '#';
  openChars: WildcardOption[];           // = openChars ('.' / '=')
  closedDoorPortChar: 'Y';               // 🔧 doorCols인데 안 연 칸
  openings: IntRange; openingsAtMax: IntRange;   // = openings / openingsAtMax (개수, 보간 후 추첨)
  minGapBetweenOpenings: 2;              // 개구부 사이 최소 간격(개발은 2 고정과 같음)
  spineCols: number[]; spineBonus: Lerp2;        // 🔧 열 가중치 = 1 + bonus × (spine 열 또는 바로 위 이음 행 개구부 열이면 1)
  wideOpening: { chance: Lerp2; width: IntRange };   // 🔧 개구부 하나를 폭 2~3으로(개발 corridorWidth의 확률판)
  topSeamOverride: { openings; openingsAtMax; wideOpening };   // 🔧 게이트 홀 바로 아래 이음 행(로비 병목)
}
```

### 1-4. AssemblyRules 🔧

개발 `slots`(태그 순서 + 개수)로는 ① 미션이 요구한 모듈 강제 ② 팀 위·아래 행 예산 ③ 회의실 위/아래 선택 ④ 대표님 날 단순화를 표현할 수 없어서 따로 두었습니다. 개발은 `generateLayout` 앞단에 '모듈 목록 정하기' 단계를 추가하고, 정해진 목록을 기존 조립 엔진에 넘기면 됩니다.

```ts
interface AssemblyRules {
  order: ['top','exec','above_team','team','below_team','bottom'];
  requiredGroups: string[];              // 날마다 반드시 1개씩
  aboveTeamRequired: string[];           // ['next_team'] 항상 팀 위
  optionalPool: string[];                // 선택 모듈 그룹
  belowTeamAllowedGroups: string[];
  restMeetBelowChance: Lerp2;            // rest_meet을 팀 아래로 보낼 확률(lowerModules ≥ 1일 때)
  maxNonRequiredOptionalAboveTeam: 1;
  ceoDay: { optionalModules: 0; lowerModules: 0 };
  missionRequiresProvides: Record<MissionId, string>;   // 'printer|copier' = 둘 중 하나 있으면 충족
  rules: string[];                       // 절차(순서대로 구현) — gdd-v3 §1-4와 같음
}
```

### 1-5. RepairRules 🔧

```ts
interface RepairRules { enabled: boolean; maxOpenings: 3; targets: string[]; rule: string }
```
- 검증 전에 실행하고 시드를 소비하지 않습니다.
- 초과량 = Σ max(0, 거리 − 상한)입니다. 대상은 자리→게이트, 자리 밖 미션 편도, 대표님 날 입장 거리입니다.
- 이음 행의 '막힌 열 중 양옆이 통행 가능하고 기존 개구부와 2칸 이상 떨어진 칸'을 하나씩 열어 초과량을 가장 많이 줄이는 칸을 고릅니다. 동률이면 |x − 5| 작은 쪽, 그다음 위쪽입니다.

### 1-6. RankComplexity

```ts
interface RankComplexity {
  rankId: RankId; tier: 0|1|2|3|4|5|6; days: string;
  complexity: [C01, C01];                // [t=0, t=1] → c (개발 rankComplexity() 대체)
  optionalModules: IntRange; lowerModules: IntRange;
  aboveTeamMaxRows: number; belowTeamMaxRows: number;   // 🔧 행 예산(이음 행 포함)
  orderPolicy?: 'authored_order';        // 인턴: 팀 위쪽 순서 고정
  hard: { seatToGateTiles: IntRange; maxUncoveredStraightTiles: number };   // 검증기가 씀
  target: Record<string, IntRange>;      // QA 분포 목표(검증 아님)
}
```

### 1-7. missionRefOneWayTiles

budgetCheck의 미션 예상 시간 보정 기준입니다: `expected + 2 × (생성 맵 편도 − ref) ÷ playerSpeed`.

---

## 2. ValidatorDef

```ts
interface ValidatorDef {
  id: string;                  // 'V01_reach' …
  code: GenFailCode | string;  // 개발 GenFailCode에 추가: distance_out_of_band, choke_too_long, dead_end_trap, lead_cannot_see_seat,
                               // gate_unfair, too_crowded, over_time_budget, same_as_yesterday, patrol_unmappable, orphan_floor(보정), pillar_misplaced(보정)
  hard: boolean;               // false = 자동 보정만(실패 아님)
  rule: string;                // 판정 정의(구현 기준)
  prototyped?: boolean | 'partial';
  [param: string]: unknown;    // 수치(아래)
}
```

| id | 수치 필드 | 개발 ValidateRules 대응 |
|---|---|---|
| V03_distance | `missionOneWayCap` 28, `internSlackTiles` 4, `ceoDaySeatToGateMax` 40, `ceoWalkMaxTiles` 20 | 신규 |
| V04_shortcut_detour | `gate{maxDetourRatio 1.6, maxDetourExtraTiles 16, maxSharedRatio 0.75}`, `mission{2.0, 16, 0.75}`, `sharePenalty` 6, `riskCategories`, `exemptMissions` | `maxDetourRatio`·`maxSharedRatio`·`sharePenalty`·`routeGoalSpot` 확장(목표가 여러 개 + 위험 비교) |
| V05_uncovered_straight | 직급별 `complexityByRank.hard.maxUncoveredStraightTiles` | `maxClearSightTiles`를 **정의 변경**: 엄폐 칸에서 끊어 셈. 기존 `longestClearSight`는 metrics만 |
| V12_time_budget | `normalDayMaxPredictedSec` 84.0, `ceoDayMaxPredictedSec` 80.5, `trimMaxSec` 3.0, `refSeatToGateTiles` 33, `playerSpeedTilesPerSec` 3.0 | 신규. 통과 시 `trimSec`를 결과에 담아 day 계획의 dayPhaseSec에서 뺌 |
| 기타 | 규칙 문장 | 신규 |

- 필요한 입력: V11·V12·V13·V14는 생성기만으로는 판정할 수 없습니다.
  - V11·V12는 그날 계획(방해·대표님·순회)이 필요합니다.
  - V13은 어제 결과가 필요합니다.
  - V14는 순찰 테이블이 필요합니다.
  - 개발 `levelProvider`의 `extraCheck(layout)`에 `LevelRequest`(plan 포함)를 넘겨 판정하는 구조를 권장합니다. 이미 V14와 같은 순찰 재매핑 검사가 거기 있습니다.
- `GenerateResult`·`ValidationResult.metrics`에 추가할 값: `seatToGate`, `missionOneWay{}`, `ceoWalk`, `uncoveredStraight`, `deadEnds`, `pillars`, `halfPartitions`, `branchPointsOnLeave`, `repairsUsed`, `trimSec`, `predictedRunSec`.

---

## 3. PatrolTemplate (보조)

```ts
type NodeRef = string | { node: string; stopId?: string; optional?: boolean; waitSec?: number; lookChance?: number };
interface PatrolTemplate {
  nodes?: NodeRef[]; loop?: boolean; reverseOf?: string;
  entranceSpeedFit?: { targetSec: 4.6; minSpeed: 2.4; maxSpeed: 4.4 };   // p_ceo_visit: 속도 = clamp(첫 구간 경로 ÷ targetSec)
}
```
- 기본은 개발 재매핑(스팟 이름 → 노드 이름 → 구역 상대 위치)입니다.
- `remapWaypoints`가 null인 순찰만 템플릿으로 만듭니다. 노드 사이는 `findPath`로 잇고, 방향이 바뀌는 칸만 웨이포인트(waitSec 0)로 남깁니다. `stopId`가 붙은 노드에는 원래 patrols.json의 같은 stopId 웨이포인트 값(waitSec·lookChance 등)을 복사합니다.
- `seatedFromSpot`: 앉은 순찰의 좌표·facing·lookDirs를 스팟 값으로 덮어씁니다. team_back의 팀장은 facing down, lookDirs up입니다. 🔧 재매핑이 facing·lookDirs를 바꾸지 않으므로 필요합니다.

---

## 4. LeadRoaming (= 개발 BossTourDef 재료)

```ts
interface LeadRoaming {
  enabled: boolean; appliesFromDay: 6; actorId: 'team_lead'; seatPatrolId: 'p_tl_seat';
  seed: 'day-{day}-tour';
  schedule: { firstAtFrac: 0.10; lastAtFrac: 0.70; latestStartFrac: 0.85; minGapSec: 3; mustBeSeatedBeforeLeaveSec: 4; rule: string;
              ceoClearance?: { returnBeforeSec: 2.0; departAfterSec: 3.0 };   // 🔧 T-156: 코드 상수 ±20초 대체
              fitToWindow?: { enabled: true } };                               // 🔧 T-156: 계획 회차 = 실제 출발 회차
  standTell: { sec: 1.0; minSec: 0.8; visual: string; sfxNew: string; sfxFallback: string; bubble: 'destination_icon' };
  coneActiveIn: ('walk'|'look')[];       // = BossTourDef.coneActiveIn (wait·tell 제외)
  walk: { glanceBackChancePerTile: 0.03; talkEnabled: true; avoidTiles: ['player_seat']; pathTieBreak: string };
  destinations: {
    id: 'printer'|'pantry'|'meeting'|'next_team'|'exec_report';
    spots: string[];                     // 앞에서부터 이 층에 있는 첫 스팟 (= DEV_TOUR.destinations[].spots)
    waitSecRange: [Sec, Sec]; lookChance: number; weight: number; minDay: number;
    bubbleIcon: string; lineKey: string; pose?: string; floorMark?: string;
    locksMissions?: MissionId[]; endTell?: { sec: Sec; sfx?: string; sfxNew?: string; sfxFallback?: string; lineKey: string };
    meetingRoomDoor?: 'busy_while_inside';
  }[];
  byRank: Record<RankId, { countRange: IntRange; stopsPerTour: IntRange; speedTilesPerSec: number; waitMul: number;
                           awayMaxSec?: Sec;          // 🔧 T-156: 없으면 awaySecRange[1]
                           minGapSec?: Sec;           // 🔧 T-156: 없으면 schedule.minGapSec
                           ceoDayCountRange?: IntRange }>;  // 🔧 T-156: 대표님 날 n = min(평소 추첨, 이 범위 추첨)
  selection: string; awaySecRange: [6, 22]; awayRule: string;
  conflicts: string[]; budget: { dayInterruptReserveSec: 0; meetingUsesReserveOf: 'INT-08' };
  emptySeatCheck: { enabled: false; suspicion: 0.08; radiusTiles: 2 };   // PM 결정 대기
  seatEmptyCue: { visual: string; hudBadgeKey: string };
}
```

**BossTourDef로 바꾸는 법**(개발 `buildDevTour` 대체)
```ts
const R = layout.leadRoaming, B = R.byRank[rankId];
n = rng.int(...B.countRange);
atSec[i] = round1(a + seg*i + rng.range(0.1, 0.6)*seg);   // a = dayPhase × firstAtFrac, b = dayPhase × lastAtFrac, seg = (b − a)/n
routes[i] = pick(destinations: minDay ≤ day, 스팟 존재, 같은 회차 중복 금지, 직전 회차 첫 목적지 금지, 가중치) × rng.int(...B.stopsPerTour)
  .map(d => ({ id: d.id, tile: spot, facing, waitSec: round1(rng.range(...d.waitSecRange) × B.waitMul), lookChance: d.lookChance }));
standTellSec = max(rules.tell.minSec, R.standTell.sec); latestStartSec = dayPhase × latestStartFrac;
speedTilesPerSec = B.speedTilesPerSec; coneActiveIn = R.coneActiveIn;
```
- 🔧 BossTourDef 확장이 필요한 항목
  - 목적지별 `endTell`(복귀 전 1.0초 전조)
  - `locksMissions`
  - `bubbleIcon`(출발 전조 말풍선)
  - 회의실 문 '사용 중' 표시
  - 대표님 순시 시작 조건 '팀장 자리에 있음'
  - 앉은 직후 첫 look 정상 전조 강제
  - 자리 비움 6~22초 보정
  - 퇴근 4초 전 복귀
- 🔧 T-156 추가 규칙(개발 `leadRoaming.ts` 반영 필요, 기획 참조 구현으로 검증함)
  1. `awayMax = B.awayMaxSec ?? awaySecRange[1]`. '가장 먼 목적지 빼고 다시 고르기'와 '최소 대기' 보정이 이 값을 씀
  2. `minGap = B.minGapSec ?? schedule.minGapSec`
  3. 대표님 날: `n = min(rng.int(...countRange), rng.int(...ceoDayCountRange))`(필드 없으면 평소 n). 시드 소비는 대표님 날에만 1회 추가
  4. 대표님 충돌: `at + away > ceoAt − returnBeforeSec && at < ceoAt + departAfterSec`면 `at = ceoAt + departAfterSec`. 앞 회차 밀기 **다음에** 적용(밀린 뒤 겹칠 수 있으므로). 필드가 없으면 지금처럼 ±20초
  5. `fitToWindow`: 회차 확정 뒤 3·4를 포함한 실제 밀기로 출발 시각을 계산 → `latestStartFrac` 초과 회차가 있으면 가장 긴 회차(INT-08 흡수 회차 제외, 이미 줄인 회차 제외)를 '가장 가까운 목적지 1곳(meeting·exec_report 제외, 직전 회차 첫 목적지와 다르게) + `waitSecRange[0] × waitMul`'로 바꿈(더 짧아질 때만) → 다시 계산. 줄일 회차가 없으면 마지막 비INT-08 회차 삭제. 6일차 첫 회차 printer 고정은 유지

---

## 5. missions.json

```ts
interface MissionsTable {
  schemaVersion: 3; enabled: boolean; appliesFromDay: 6;
  missionPool: {
    existing: { id: EventId; eventRef: string; where: 'seat'|'away'; zone: string; tags: string[]; difficulty: number; unlockDay: number; relocateSpots: string[] }[];
    new: NewMissionDef[];                 // EventDef(v2 §6) 모양 + where·tags·difficulty·unlockDay
    poolByRank: Record<RankId, Record<MissionId, number>>;   // ranks.eventPool 대체(enabled일 때)
    debuts: ({ day: number; missionId: string; tutorialId: string; force: true; noModifier?: true } | { day: number; modifierType: string })[];
  };
  modifierTemplates: ModifierTemplate[];  // 기획 단위 10 type(설명·비용·대상 규칙)
  modifiers: MissionModifierV3[];         // 개발이 읽는 구체 변형 28개
  conditions: { id: string; status: string; args: Record<string, string>; rule: string; statsNeeded?: string }[];
  combination: CombinationRules;
  authoredOverlays: { days: Record<string, { eventId: EventId; modifiers: string[]; ifSpotExists?: boolean }[]> };
  stringsKo: Record<string, string>;      // strings.ko.json 병합 대기
}

type MissionId = EventId | 'parcel'|'print'|'chat'|'bank'|'cafe'|'window';

interface NewMissionDef /* = EventDef + */ {
  id; nameKey; descKey; iconSprite; mvp: false;
  mechanic: 'fetch_carry'|'remote_start_fetch'|'queue_wait_tap'      // 🔧 신규 3종
          | 'rhythm_tap'|'screen_swap_tap'|'pour_tap_stop';          // 재사용(params 다름)
  location: { spot: string; zone: string }; startsAt; completeAt; awayFromDesk; isFinale: false;
  where: 'seat'|'away'; tags: string[]; difficulty: number; unlockDay: number;
  timeLimitSec: Sec; expectedDurationSec: Sec; accompliceAllowed: false;
  reward: { slackPoints: number; couponStamp?: 1; suspicionRelief?: Ratio01 };   // 🔧 couponStamp(도감 카운터), suspicionRelief(성공 시 의심 감소)
  failPenalty: { suspicion: Ratio01 }; timeoutPenalty: { suspicion: Ratio01 };
  params: Record<string, unknown>; failReactionKeys: string[]; tutorialId: string;
}

interface MissionModifierV3 /* = 개발 MissionModifier + */ {
  id: string; labelKey?: string;
  timeLimit?: { set?: Sec; mul?: number; add?: Sec };
  spot?: string;                          // 'a|b' = 그날 층에 있는 첫 스팟 🔧(개발은 단일 이름)
  params?: Record<string, unknown>;
  rewardMul?: number;
  condition?: { id: string; args?: Record<string, unknown>; onFail?: 'fail' };
  // ── 확장 ──
  type: string; kind: 'hard'|'soft'|'bonus'; cost: number;
  missions?: MissionId[]; appliesToTags?: string[];
  minRank?: RankId; minDay?: number; requiresInterrupt?: string[];
  budgetSecDelta: Sec | 'travel_diff';
  onFailByRank?: Partial<Record<RankId, 'fail'|'bonus_lost'>>;   // 🔧 avoid: 직급별 onFail
  costByRank?: Partial<Record<RankId, number>>;
  availability?: { type: 'while_actor_away'; actorId: 'team_lead' };   // 🔧 during_tour: 칩 켜짐 조건
}
```

- 하루 계획에는 `missions[i].modifiers = ['avoid.snitch', …]`로 넣습니다. 개발 `parseModifiers`가 id를 `missions.modifiers[]`에서 찾으므로 그대로 작동합니다. `deadline`은 `{ ...정의, condition: { id: 'before_clock', args: { time: '14:00' }, onFail: 'fail' } }` 객체로 넣습니다.
- 적용 순서는 개발과 같습니다: timeLimit(set → mul → add) → spot → params → rewardMul(조건 없으면 즉시, 있으면 충족 시).
- `relocate.snack_pantry`·`relocate.bank_stall`은 params로 `startsAt`·`completeAt`·`awayFromDesk`를 바꿉니다. 자리 미션이 자리 밖 미션이 되는 경우입니다. 🔧 MissionDef의 이 필드들이 params로 덮이지 않으면 별도 처리해 주세요.

```ts
interface CombinationRules {
  stream: 'day-{day}-mission';
  order: string;
  modifiedMissionsPerDay: Record<RankId, IntRange>;
  costBudgetPerDay: Record<RankId, number>;
  maxModifiersPerMission: Record<RankId, number>;
  bonusPerDay: IntRange;
  ceoDay: { costBudgetDelta: -2; maxModifiedMissions: 1; maxMissionsNeedingNewModule: 1 };
  excludePairs: [string, string][];       // type 기준
  neverModify: ['leave'];
  rules: string[];                        // 절차(gdd-v3 §4-4)
}
```

### 5-1. 개발 T-144 대응표

| 개발 (T-144) | v3 데이터 | 비고 |
|---|---|---|
| `layoutEnabledInData()` → `layout.enabled` | `layout.enabled` | 같음 |
| `DEV_LAYOUT_POLICY.authoredMapDays / maxAttempts / sourceMapId` | `authoredMapDays` / `validators.maxAttempts` / `sourceMapId` | maxAttempts 8 → **24** |
| `rankComplexity()` | `complexityByRank[].complexity` + `complexityFormula` | 대체 |
| `LayoutRules.width / maxHeight` | `grid.width` / `grid.maxHeight` | 72 → **64** |
| `LayoutRules.slots` | `assembly` + 모듈 `group`·`tags` | 🔧 모듈 목록 정하기 단계 추가 |
| `LayoutRules.seam` | `seam` | `openings`·`openingsAtMax`·`openChars`·`wallChar` 같음, 나머지 🔧 |
| `LayoutRules.wildcards` | `wildcards` | 같은 형식. 문자 `?`·`!` 같음 + `o` 추가. 후보에 `i`·`L`·`Z`·`O` |
| `ModuleTemplate.spots: {x, y, facing}` | `spots: {tile: [x, y], facing, …}` | 🔧 로더에서 변환(`tile2()`가 배열을 이미 받음) |
| `ValidateRules.maxClearSightTiles` 18 | V05 직급별 20~16(정의 변경) | 수작업 맵 30 문제 해소 |
| `ValidateRules.maxSharedRatio / maxDetourRatio / sharePenalty` | V04 `gate`·`mission`·`sharePenalty` | 0.75·1.6 채택, 벌점 4 → 6 |
| `ValidateRules.requiredSpots` | V01 + 그날 미션 장소(`extraRequiredSpots`) | 같은 구조 |
| `DEV_TOUR.*` | `leadRoaming.*` | §4. 첫 출발 10% → 15%, 취소 88% → 85%, 전조 0.8 → 1.0초(최소 0.8) |
| `MissionModifier` | `missions.modifiers[]` | 같은 필드 + 확장 |
| `MISSION_CONDITIONS` | `missions.conditions[]` | 7종 추가 🔧 |

---

## 6. 🔧 개발 확장 요청 목록

| # | 항목 | 내용 | 우선 |
|---|---|---|---|
| 1 | 로더 | layout·missions 읽기, `_` 키 무시. 모듈 spots `tile` 배열 → `{x, y}` 변환. `legendAdd`를 원본 legend에 합침 | A |
| 2 | 조립 | `assembly` 절차(그룹·필수·미션 요구 provides·행 예산·회의실 위/아래·대표님 날·연결부 삽입·인턴 순서 고정)로 모듈 목록을 정한 뒤 기존 조립 엔진에 넘김 | A |
| 3 | 포트 | `ports.top/bottom/required/doorCols/doorOpenChance`, `closedDoorPortChar`, `spineBonus`, `wideOpening`, `topSeamOverride` | A |
| 4 | 와일드카드 보호 | 맨 위·아래 행 와일드카드 = '.', 모듈 내부 연결성 되돌리기(`!` → `?` → `o`) | A |
| 5 | 수리 | `repair`(검증 전, 결정적) | A |
| 6 | 검증 | V03·V04(목표 여러 개 + 위험 범주)·V05(정의 변경)·V06·V08·V09·V10·V11·V12(트림 포함)·V13. V11·V12·V13은 `extraCheck`에서 plan 사용 | A |
| 7 | 순찰 | 앉은 순찰 facing·lookDirs를 스팟 값으로. 재매핑 실패 시 `patrolTemplates`. 대표님 `entranceSpeedFit` | A |
| 8 | 순회 | `leadRoaming` → BossTourDef(§4) + 확장 8개 | A |
| 9 | 미션 | 새 mechanic 3종(`fetch_carry`·`remote_start_fetch`·`queue_wait_tap`), 들고 다니기 상태(`carryMovingMul`, 위장 포즈), 출력 쟁반 노출 판정, `suspicionRelief`, `couponStamp` 카운터 | B |
| 10 | 변형 | 조건 7종 + `MissionRunStats` 필드(seenSecBy·noiseCount·coverTilesVisited·closeCalls·startState·completedAtClock), `availability`, `onFailByRank`, `spot` 후보(`a|b`), 변형 추첨(`combination`) | B |
| 11 | 예산 | budgetCheck에 이동 거리 보정·`budgetSecDelta`, V12 트림 → dayPhaseSec | A |
| 12 | 렌더 | `art` 후보 시드 선택, `footprint` 2×1, `P`·`i` 마스크 타일링(서로 이웃 아님), 전높이 뒤 플레이어 알파 | B |
| 13 | 용량 | 빌드 때 `_*` 키·`stringsKo` 제거 | B |

---

## 7. 검사기 (T-142 추가)

`validate_data.py`
- layout·missions는 schemaVersion 3을 요구합니다.
- `*Key` 문자열 출처에 v3 테이블의 `stringsKo`를 인정합니다.
- 추가 검사는 gdd-v3 §7 목록과 같습니다.
- 생성 결과(실제 맵)는 검사하지 않습니다. 이는 개발 검증기와 QA 전수 실행 몫이고, 기획 참조는 `layout_proto.py`입니다.

## 8. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| 3-draft | 2026-11-23 | T-142 신규: layout.json(모듈 16종, 와일드카드 3, 이음 행, 조립·수리, 직급별 복잡도, 검증 14, 순찰 템플릿, 팀장 순회), missions.json(새 미션 6, 변형 템플릿 10·구체 28, 조건 10, 조합 규칙, 저작일 얹기, 문자열). 기존 v2 테이블 변경 없음. 아트 T-143 키·D-080(P 전높이 / i 반높이)·개발 T-144 이름 반영 |
| 3-draft (T-148) | 2026-11-24 | **필드 추가만(키 이름·계층·기존 값 변경 없음)**. layout: `legendAdd` 3종(`+` 가림막 문·`W` 샤워 칸·`l` 탈의실 바닥), 모듈 2종 추가(`mid_rest_meet_g` 그룹 `rest_meet_g`, `mid_fitness` 그룹 `fitness` — 둘 다 기존 requiredGroups·optionalPool에 없는 새 그룹이라 `genderFacilities.enabled` false면 생성기가 고르지 않음), 모듈 필드 `genderFacility`·`spotAliases`·`zoneAliases`, 최상위 `genderFacilities`(enabled false, groupReplace·fitnessModule·mineSide·access·missionTargets·cases 5·validators V15·V16·debuts). missions: `existing.restroom.targetFacility`, `modifiers[relocate.bank_stall].targetFacility`, 새 배열 `genderModifiers`(facility.cleaning — 새 type `facility_closed`, relocate.restroom_locker). 상세는 `design/gender-design.md` §3·§8 |
| 3-draft (T-152) | 2026-11-24 | **필드 추가만**. layout: `legendAdd.W` 표시 필드 4(`occupiedDisplay`·`inUseLabelKey`·`steamIcon` false·`drawOccupantInside` false), `genderFacilities.access.talkCancelNpcBehavior`·`talkCancelNpcApproachDoor`, `genderFacilities.artRules`. missions: avoid 5종·bonus.cover의 `facilityLabelKey`, `stringsKo` 6키, `_facilityLabelNote`. 상세 `design/data-schema.md` §11 T-152 |
| 3-draft (T-156) | 2026-11-25 | **값 수정·필드 추가만(키 이름·계층 변경 없음, 개발 T-151 동시 작업 보호)**. layout `leadRoaming`: `schedule.firstAtFrac` 0.15→0.10·`lastAtFrac` 0.8→0.7·`minGapSec` 8→3, 새 필드 `schedule.ceoClearance`·`schedule.fitToWindow`, `byRank` 값(과장~ 속도·waitMul, 임원 stopsPerTour [1,1]) + 새 필드 `awayMaxSec`·`minGapSec`(임원)·`ceoDayCountRange`, `destinations.meeting.waitSecRange` 8~10→6~8. npcs `security_guard.sim.talk.zone`(gate_approach) 신규. strings.ko `tutorial.tut_bank·tut_chat·tut_parcel·tut_print·tut_cafe·tut_window`. 상세 gdd-v3 §3-5·§3-6·§10 |
| 3-draft (T-152b) | 2026-11-24 | D-100. **값 수정·필드 추가만**. layout: `mid_printer`·`bottom_storage`에 `spots.storage_corner_use`. missions: `relocate.bank_stall` 목적지 창고 구석·보상 1.1·`targetFacility` 삭제, `appliesTo.bank` 같은 값, `facility.cleaning.missions` restroom만. 상세 `design/data-schema.md` §11 T-152 |
| 3-draft (T-157) | 2026-11-25 | **값 수정·필드 추가만**. layout: `repair.protectFacilityTiles` true, `validators.maxAttempts` 24 → 32, `mid_rest_meet_g` 세면대 facing right·`doorOpenChance` [1.0, 1.0], `genderFacilities.access.talkCancelNpcHold`. 생성 버전 태그 해시가 바뀌어 성별 시설 off 맵도 달라짐. 상세 `design/data-schema.md` §11 T-157 |
