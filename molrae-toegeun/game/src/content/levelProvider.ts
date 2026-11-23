/**
 * 일차별 층(LevelDef 재료) 공급자 (D-074·D-076, T-144). 순수 TS — Phaser·Vite 무관(QA 헤드리스 재사용).
 *
 *  - 1~authoredMapDays일차: 그 날 계획의 수작업 맵(maps.json, 기본 office_floor_1)
 *  - 이후: 생성기(layoutGen) 결과. 생성이 꺼져 있거나 maxAttempts 안에 검증을 통과하지 못하면 수작업 맵으로 폴백
 *
 * 생성 층은 legend·카메라를 원본 수작업 맵(sourceMapId)에서 빌리고, 그 맵의 순찰(patrols.json)을 재매핑해서 쓴다.
 * 재매핑 순서: 같은 칸의 스팟 이름 → 같은 칸의 길목 노드(routeNodes) → 같은 구역 안 상대 위치 → (없으면) 웨이포인트 제거.
 * 정지 이름(stopId)·hold가 걸린 웨이포인트를 옮길 수 없으면 그 순찰 전체를 뺀다(경고).
 *
 * [임시] 생성 활성화 키·정책은 T-142 스키마 확정 전 개발 가정(layoutEnabledInData, DEV_LAYOUT_POLICY).
 */
import { buildGridMap, isWalkable, nearestWalkable, type GridMap, type LegendEntry, type Tile } from '../core/grid';
import { findPath } from '../core/pathfinding';
import type { Dir } from '../core/vision';
import {
  DEV_LAYOUT_MODULES, DEV_LAYOUT_POLICY, DEV_LAYOUT_RULES, DEV_VALIDATE_RULES, generateValidated,
  type GenFailure, type GeneratedLayout, type LayoutMetrics, type LayoutRules, type ModuleTemplate, type ValidateRules,
} from './layoutGen';

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const tile2 = (v: unknown): Tile => (Array.isArray(v) ? { x: num(v[0], 0), y: num(v[1], 0) } : { x: num(obj(v)['x'], 0), y: num(obj(v)['y'], 0) });

export type Tables = Readonly<Record<string, unknown>>;

export interface ZoneDef {
  readonly id: string;
  readonly nameKey: string;
  readonly rect: readonly [number, number, number, number];
  readonly outsideOffice?: boolean;
}

/** 순찰 웨이포인트 좌표 변환 결과: 새 칸 / 이 웨이포인트만 제거(null) */
export type WaypointRemap = (x: number, y: number) => Tile | null;

/** 하루 한 층을 만드는 데 필요한 맵 재료(maps.json 한 항목과 같은 의미) */
export interface MapBundle {
  readonly id: string;
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly playerStart: Tile;
  readonly exitZone: string;
  readonly spots: Readonly<Record<string, { readonly tile: Tile; readonly facing?: Dir }>>;
  readonly zones: readonly ZoneDef[];
  readonly coverSpots: readonly Tile[];
  /** maps.playerRoutes 원본(생성 층은 빈 배열) */
  readonly playerRoutes: readonly O[];
  /** maps.camera 원본 */
  readonly camera: O;
  /** patrols.json에서 이 mapId의 순찰을 쓴다 */
  readonly patrolMapId: string;
  /** 있으면 순찰 웨이포인트를 이 함수로 옮긴다(생성 층) */
  readonly remap?: WaypointRemap;
  readonly source: 'authored' | 'generated' | 'fallback';
  /** 생성 정보(디버그·QA) */
  readonly gen?: {
    readonly seed: string;
    readonly complexity: number;
    readonly attempts: number;
    readonly modules: readonly string[];
    /** 시도별 실패 사유(마지막까지) */
    readonly failures: readonly string[];
    readonly metrics?: LayoutMetrics;
  };
}

export interface LevelRequest {
  readonly tables: Tables;
  readonly day: number;
  /** dayPlan() 결과(mapId·seed 등) */
  readonly plan: O;
  readonly rankId: string;
  /** 직급 내 진행도 0~1 */
  readonly t: number;
  /** 이 날 반드시 있어야 하는 스팟(미션 장소·퇴근 지점) — 검증기 requiredSpots에 더해진다 */
  readonly extraRequiredSpots: readonly string[];
  /** 이 날 반드시 옮겨져야 하는 순찰 id(출연·방해 이벤트). 생성 층에서 재매핑이 안 되면 그 시도는 실패 */
  readonly requiredPatrols?: readonly string[];
}

/**
 * 순찰 웨이포인트를 remap으로 옮긴다. 정지 지점(stopId·hold)이나 첫 웨이포인트를 옮길 수 없으면 null(순찰 제외).
 * 중간 경유점은 빠져도 경로탐색이 이어 준다.
 */
export function remapWaypoints(waypoints: readonly unknown[], remap: WaypointRemap): O[] | null {
  const wps: O[] = [];
  for (const w of waypoints.map(obj)) {
    const t2 = remap(num(w['x'], 0), num(w['y'], 0));
    if (t2) { wps.push({ ...w, x: t2.x, y: t2.y }); continue; }
    if (w['stopId'] !== undefined || w['holdForQte'] || w['holdForReport'] || wps.length === 0) return null;
  }
  return wps.length > 0 ? wps : null;
}

export interface LevelProvider {
  levelFor(req: LevelRequest): MapBundle;
}

// ── 수작업 맵 ─────────────────────────────────────────

function mapRaw(tables: Tables, mapId: string): O {
  const map = arr(obj(tables['maps'])['maps']).map(obj).find((m) => m['id'] === mapId);
  if (!map) throw new Error(`content: 맵 ${mapId} 없음`);
  return map;
}

function spotsOf(map: O): Record<string, { tile: Tile; facing?: Dir }> {
  const spots: Record<string, { tile: Tile; facing?: Dir }> = {};
  for (const [k, v] of Object.entries(obj(map['spots']))) {
    const s = obj(v);
    spots[k] = { tile: tile2(s['tile']), ...(typeof s['facing'] === 'string' ? { facing: s['facing'] as Dir } : {}) };
  }
  return spots;
}

function zonesOf(map: O): ZoneDef[] {
  return arr(map['zones']).map(obj).map((z) => ({
    id: str(z['id']), nameKey: str(z['nameKey']), rect: (arr(z['rect']).map((v) => num(v, 0)) as unknown) as [number, number, number, number],
    ...(z['outsideOffice'] === true ? { outsideOffice: true } : {}),
  }));
}

function legendOf(map: O): Record<string, LegendEntry> {
  const legend: Record<string, LegendEntry> = {};
  for (const [ch, e] of Object.entries(obj(map['legend']))) legend[ch] = obj(e) as unknown as LegendEntry;
  return legend;
}

/** maps.json 한 항목 그대로 */
export function authoredMapBundle(tables: Tables, mapId: string, source: 'authored' | 'fallback' = 'authored'): MapBundle {
  const map = mapRaw(tables, mapId);
  return {
    id: str(map['id']), rows: arr(map['rows']).map((r) => str(r)), legend: legendOf(map),
    playerStart: tile2(map['playerStart']), exitZone: str(map['exitZone'], 'exit'),
    spots: spotsOf(map), zones: zonesOf(map),
    coverSpots: arr(map['coverSpots']).map(obj).map((c) => tile2(c['tile'])),
    playerRoutes: arr(map['playerRoutes']).map(obj), camera: obj(map['camera']),
    patrolMapId: str(map['id']), source,
  };
}

// ── 생성 층 ───────────────────────────────────────────

/**
 * 복잡도(0~1): (직급 순서 index + 직급 내 진행도) / 직급 수. [임시] T-142가 직급별 복잡도 표를 주면 그 값을 쓴다
 */
export function rankComplexity(tables: Tables, rankId: string, t: number): number {
  const ranks = arr(obj(tables['ranks'])['ranks']).map(obj);
  const idx = Math.max(0, ranks.findIndex((r) => r['id'] === rankId));
  const n = Math.max(1, ranks.length);
  const c = (idx + Math.min(1, Math.max(0, t))) / n;
  return Math.min(1, Math.max(0, c));
}

/** [추측] T-142 layout.json에 enabled:true가 있으면 기본으로 생성 사용. 스키마 확정 후 교체 */
export function layoutEnabledInData(tables: Tables): boolean {
  return obj(tables['layout'])['enabled'] === true;
}

/** 엄폐물 칸마다 옆 통행 칸 하나(좌·우·아래·위 순)를 '숨는 칸'으로 */
function coverSpotsOf(map: GridMap): Tile[] {
  const out: Tile[] = [];
  const seen = new Set<number>();
  const order = [[-1, 0], [1, 0], [0, 1], [0, -1]] as const;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!map.cover[y * map.width + x]) continue;
      for (const [dx, dy] of order) {
        const nx = x + dx, ny = y + dy;
        if (!isWalkable(map, nx, ny) || map.kinds[ny * map.width + nx] === 'seat') continue;
        const i = ny * map.width + nx;
        if (!seen.has(i)) { seen.add(i); out.push({ x: nx, y: ny }); }
        break;
      }
    }
  }
  return out;
}

/** 수작업 맵 좌표 → 생성 층 좌표 */
function makeRemap(src: O, gen: { spots: MapBundle['spots']; zones: readonly ZoneDef[]; routeNodes: Readonly<Record<string, Tile>> }, grid: GridMap): WaypointRemap {
  const srcSpots = spotsOf(src);
  const srcNodes: Record<string, Tile> = {};
  for (const [k, v] of Object.entries(obj(src['routeNodes']))) srcNodes[k] = tile2(v);
  const srcZones = zonesOf(src).slice().sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3]);
  const fix = (t: Tile): Tile | null => nearestWalkable(grid, t.x, t.y, 3);
  return (x, y) => {
    for (const [name, s] of Object.entries(srcSpots)) if (s.tile.x === x && s.tile.y === y && gen.spots[name]) return fix(gen.spots[name]!.tile);
    for (const [name, t] of Object.entries(srcNodes)) if (t.x === x && t.y === y && gen.routeNodes[name]) return fix(gen.routeNodes[name]!);
    for (const z of srcZones) {
      const [zx, zy, zw, zh] = z.rect;
      if (x < zx || y < zy || x >= zx + zw || y >= zy + zh) continue;
      const g = gen.zones.find((q) => q.id === z.id);
      if (!g) continue;
      const [gx, gy, gw, gh] = g.rect;
      return fix({ x: gx + Math.min(gw - 1, x - zx), y: gy + Math.min(gh - 1, y - zy) });
    }
    return null;
  };
}

export interface LevelProviderOptions {
  /** 3일차 이후 생성 사용(false면 모든 날 수작업 맵) */
  readonly generate: boolean;
  readonly modules?: readonly ModuleTemplate[];
  readonly rules?: LayoutRules;
  readonly validate?: ValidateRules;
  readonly authoredMapDays?: number;
  readonly maxAttempts?: number;
  readonly sourceMapId?: string;
  /** 시드 덮어쓰기(개발 ?genseed=) */
  readonly seedOverride?: string;
}

export function createLevelProvider(opts: LevelProviderOptions): LevelProvider {
  const authoredDays = opts.authoredMapDays ?? DEV_LAYOUT_POLICY.authoredMapDays;
  return {
    levelFor(req: LevelRequest): MapBundle {
      const planMap = str(req.plan['mapId'], DEV_LAYOUT_POLICY.sourceMapId);
      if (!opts.generate || req.day <= authoredDays) return authoredMapBundle(req.tables, planMap);
      const srcId = opts.sourceMapId ?? DEV_LAYOUT_POLICY.sourceMapId;
      const src = mapRaw(req.tables, srcId);
      const legend = legendOf(src);
      const complexity = rankComplexity(req.tables, req.rankId, req.t);
      const seed = opts.seedOverride ?? `layout-day-${req.day}`;
      const base = opts.validate ?? DEV_VALIDATE_RULES;
      const vrules: ValidateRules = { ...base, requiredSpots: [...new Set([...base.requiredSpots, ...req.extraRequiredSpots])] };
      const patrolTable = arr(obj(req.tables['patrols'])['patrols']).map(obj).filter((p) => p['mapId'] === srcId);
      const needed = (req.requiredPatrols ?? []).map((id) => patrolTable.find((p) => p['id'] === id)).filter((p): p is O => !!p);
      const extraCheck = (L: GeneratedLayout): GenFailure[] => {
        const grid = buildGridMap(L.rows, L.legend);
        const rm = makeRemap(src, L, grid);
        const out: GenFailure[] = [];
        for (const p of needed) {
          const wps = remapWaypoints(arr(p['waypoints']), rm);
          if (!wps) { out.push({ code: 'patrol_unmappable', detail: str(p['id']) }); continue; }
          // 웨이포인트 사이 경로(순환이면 마지막 → 처음 포함)
          const loop = p['loop'] !== false && wps.length > 1;
          for (let i = 0; i + 1 < wps.length || (loop && i < wps.length); i++) {
            const a = tile2(wps[i]), b = tile2(wps[(i + 1) % wps.length]);
            if (!findPath(grid, a, b)) { out.push({ code: 'patrol_unmappable', detail: `${str(p['id'])} ${i}→${(i + 1) % wps.length} 경로 없음` }); break; }
          }
        }
        return out;
      };
      const res = generateValidated(
        { modules: opts.modules ?? DEV_LAYOUT_MODULES, rules: opts.rules ?? DEV_LAYOUT_RULES, legend, complexity, seed },
        vrules, opts.maxAttempts ?? DEV_LAYOUT_POLICY.maxAttempts, extraCheck,
      );
      const failures = res.log.flatMap((a) => a.failures.map((f) => `${a.seed}: ${f.code} ${f.detail}`));
      if (!res.layout) {
        const fb = authoredMapBundle(req.tables, planMap, 'fallback');
        return { ...fb, gen: { seed, complexity, attempts: res.attempts, modules: [], failures } };
      }
      const L = res.layout;
      const grid = buildGridMap(L.rows, L.legend);
      return {
        id: L.id, rows: L.rows, legend: L.legend, playerStart: L.playerStart, exitZone: L.exitZone,
        spots: L.spots, zones: L.zones, coverSpots: coverSpotsOf(grid), playerRoutes: [], camera: obj(src['camera']),
        patrolMapId: srcId, remap: makeRemap(src, L, grid), source: 'generated',
        gen: {
          seed: res.log[res.log.length - 1]?.seed ?? seed, complexity, attempts: res.attempts,
          modules: L.modules.map((m) => `${m.id}${m.mirrored ? '~' : ''}`), failures,
          ...(res.metrics ? { metrics: res.metrics } : {}),
        },
      };
    },
  };
}
