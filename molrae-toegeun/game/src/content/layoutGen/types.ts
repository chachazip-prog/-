/**
 * 모듈 조립형 사무실 생성기 타입 (D-074·D-076, T-144). 순수 TS — Phaser·Vite·DOM 무관.
 *
 * 모듈 템플릿 = 가로 폭이 같은 '문자 격자 조각'. 생성기는 모듈을 위에서 아래로 쌓고, 모듈 사이에
 * '이음 행(seam)'을 넣어 양쪽 가장자리가 모두 통행 가능한 열에만 통로를 뚫는다.
 *
 * [임시] 이 파일의 필드 이름은 T-142(game/data/layout.json) 스키마 확정 전 개발 가정이다.
 * 스키마가 나오면 parseLayoutTables()(layoutGen/data.ts)에서 이 모양으로 변환한다.
 */
import type { LegendEntry, Tile } from '../../core/grid';
import type { Dir } from '../../core/vision';

/** 모듈 안 지정 지점(로컬 좌표) */
export interface ModuleSpot {
  readonly x: number;
  readonly y: number;
  readonly facing?: Dir;
}

/** 모듈 안 구역(로컬 rect = [x, y, w, h]) */
export interface ModuleZone {
  readonly id: string;
  readonly nameKey?: string;
  readonly rect: readonly [number, number, number, number];
  readonly outsideOffice?: boolean;
}

export interface ModuleTemplate {
  readonly id: string;
  /** 배치 슬롯 매칭용 태그(top / bottom / team / middle …) */
  readonly tags: readonly string[];
  /** 문자 격자. 모든 행 길이 = LayoutRules.width. 와일드카드 문자는 rules.wildcards가 해석 */
  readonly rows: readonly string[];
  readonly spots?: Readonly<Record<string, ModuleSpot>>;
  readonly zones?: readonly ModuleZone[];
  /** 순찰 재매핑용 길목 노드(로컬). maps.routeNodes와 같은 이름을 쓰면 수작업 맵 순찰이 그 자리로 옮겨진다 */
  readonly routeNodes?: Readonly<Record<string, readonly [number, number]>>;
  /** 좌우 반전 허용 */
  readonly mirrorable?: boolean;
  /** 선택 가중치(기본 1). 복잡도에 따라 보간하려면 weightByComplexity [c=0, c=1] */
  readonly weight?: number;
  readonly weightByComplexity?: readonly [number, number];
  /** 이 복잡도 이상에서만 후보 */
  readonly minComplexity?: number;
  /** 한 층에 여러 번 나와도 되는가(기본 false) */
  readonly repeatable?: boolean;
}

/** 와일드카드 한 글자의 후보 문자(가중치는 복잡도 c에 따라 [c=0, c=1] 선형 보간) */
export interface WildcardOption {
  readonly ch: string;
  readonly weight: readonly [number, number];
}

/** 배치 슬롯: 위에서 아래 순서. count는 복잡도에 따라 [c=0 범위, c=1 범위]를 보간한 뒤 시드로 추첨 */
export interface SlotRule {
  readonly tag: string;
  /** [최소, 최대] (c=0). 없으면 [1, 1] */
  readonly count?: readonly [number, number];
  /** [최소, 최대] (c=1). 없으면 count */
  readonly countAtMax?: readonly [number, number];
}

export interface SeamRule {
  /** 이음 행 기본 문자(벽) */
  readonly wallChar: string;
  /** 뚫는 칸 문자 후보(가중치 보간) */
  readonly openChars: readonly WildcardOption[];
  /** 뚫는 열 개수 [c=0, c=1]의 [최소, 최대] */
  readonly openings: readonly [number, number];
  readonly openingsAtMax?: readonly [number, number];
  /** 연속으로 뚫을 때 폭(통로 폭). 기본 1 */
  readonly corridorWidth?: number;
}

export interface LayoutRules {
  readonly width: number;
  /** 층 세로 상한(타일) */
  readonly maxHeight: number;
  readonly slots: readonly SlotRule[];
  readonly seam: SeamRule;
  readonly wildcards?: Readonly<Record<string, readonly WildcardOption[]>>;
  /** 플레이어 시작·자리 스팟 이름 */
  readonly playerSeatSpot: string;
  readonly exitZone: string;
}

export interface ValidateRules {
  /** 반드시 있어야 하고 플레이어 자리에서 도달 가능해야 하는 스팟 */
  readonly requiredSpots: readonly string[];
  /** 출구까지 경로를 재는 목표 스팟(지름길·우회 판정) */
  readonly routeGoalSpot: string;
  /** 지름길·우회 판정: 두 번째 경로가 첫 경로와 공유하는 칸 비율 상한 */
  readonly maxSharedRatio: number;
  /** 두 번째 경로 길이 / 최단 길이 상한 */
  readonly maxDetourRatio: number;
  /** 첫 경로 칸에 주는 벌점(대안 경로 탐색) */
  readonly sharePenalty: number;
  /** 엄폐 없는 직선 시선 최대 길이(타일). 가로·세로 연속 투명 칸 수 */
  readonly maxClearSightTiles: number;
  /** 직선 시선 계산에서 '사람이 서 있을 수 있는 칸'만 셀지(기본 true: 통행 칸이 하나라도 있는 줄만 셈) */
  readonly sightCountsWalkableOnly?: boolean;
  readonly maxHeight: number;
  readonly width: number;
}

export interface GenInput {
  readonly modules: readonly ModuleTemplate[];
  readonly rules: LayoutRules;
  readonly legend: Readonly<Record<string, LegendEntry>>;
  /** 0(입사) ~ 1(최고 직급) */
  readonly complexity: number;
  readonly seed: string;
}

export interface PlacedModule {
  readonly id: string;
  readonly y: number;
  readonly height: number;
  readonly mirrored: boolean;
}

/** 생성 결과(층 하나). 좌표는 전역 */
export interface GeneratedLayout {
  readonly id: string;
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly spots: Readonly<Record<string, { readonly tile: Tile; readonly facing?: Dir }>>;
  readonly zones: readonly { readonly id: string; readonly nameKey: string; readonly rect: readonly [number, number, number, number]; readonly outsideOffice?: boolean }[];
  readonly routeNodes: Readonly<Record<string, Tile>>;
  readonly playerStart: Tile;
  readonly exitZone: string;
  readonly modules: readonly PlacedModule[];
  readonly complexity: number;
}

export type GenFailCode =
  | 'no_module' | 'seam_incompatible' | 'legend_unknown' | 'row_width'
  | 'too_tall' | 'width' | 'missing_spot' | 'spot_blocked' | 'unreachable_spot' | 'unreachable_exit'
  | 'no_alternative_route' | 'clear_sight_too_long' | 'duplicate_spot'
  /** 호출 측 추가 검사(예: 이 날 필요한 순찰을 이 층으로 옮길 수 없음) */
  | 'patrol_unmappable'
  /** v3 검증(T-145, layout.json validators[].code) */
  | 'distance_out_of_band' | 'choke_too_long' | 'dead_end_trap' | 'lead_cannot_see_seat' | 'gate_unfair'
  | 'too_crowded' | 'over_time_budget' | 'same_as_yesterday' | 'row_budget' | 'orphan_floor';

export interface GenFailure {
  readonly code: GenFailCode;
  readonly detail: string;
}

export interface LayoutMetrics {
  readonly height: number;
  readonly moduleCount: number;
  readonly coverTiles: number;
  readonly shortestRoute: number;
  readonly altRoute: number | null;
  readonly sharedRatio: number | null;
  readonly maxClearSight: number;
  /** 가장 긴 직선 시선의 위치(디버그) */
  readonly maxClearSightAt: string;
  /** v3 지표(T-145, 스키마 §2 metrics). 기존 생성기는 없음 */
  readonly v3?: V3Metrics;
}

export interface V3Metrics {
  readonly seatToGate: number;
  readonly missionOneWay: Readonly<Record<string, number>>;
  readonly ceoWalk: number;
  readonly uncoveredStraight: number;
  readonly rawClearSight: number;
  readonly deadEnds: number;
  readonly pillars: number;
  readonly halfPartitions: number;
  readonly coverTiles: number;
  readonly branchPointsOnLeave: number;
  readonly repairsUsed: number;
  readonly trimSec: number;
  readonly predictedRunSec: number;
  readonly altExtra: number;
  readonly sharedRatio: number;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly failures: readonly GenFailure[];
  readonly metrics: LayoutMetrics;
}
