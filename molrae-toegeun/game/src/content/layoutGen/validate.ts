/**
 * 생성 층 자동 검증 (D-076, T-144). 순수 TS, 결정적. 실패 사유를 모두 모아서 돌려준다(첫 실패에서 멈추지 않음).
 *
 * 검사 항목
 *  - 크기: 가로 = rules.width, 세로 ≤ rules.maxHeight
 *  - 지정 지점: requiredSpots가 모두 있고, 통행 칸이며, 플레이어 자리에서 도달 가능
 *  - 출구: exitZone 칸 중 하나 이상 도달 가능
 *  - 지름길/우회 공존: 자리 → routeGoalSpot 최단 경로 P1과, P1 칸에 벌점을 준 두 번째 경로 P2가
 *    (공유 칸 / P1 길이) ≤ maxSharedRatio 이고 (P2 길이 / P1 길이) ≤ maxDetourRatio
 *  - 엄폐 없는 직선 시선: 가로·세로로 연속된 '시선이 통과하는 칸' 최대 길이 ≤ maxClearSightTiles
 *
 * 플레이어 게이트(gateOnly)는 태그로 통과하므로 도달성에서는 통행 칸으로 본다(legend.walkable 그대로).
 * 사람이 앉는 의자 점유 같은 동적 차단은 여기서 보지 않는다(런타임 재경로 규칙이 처리).
 */
import { buildGridMap, blocksSight, isWalkable, type GridMap, type LegendEntry, type Tile } from '../../core/grid';
import { distanceField, findPath } from '../../core/pathfinding';
import type { GenFailure, LayoutMetrics, ValidateRules, ValidationResult } from './types';

/** 검증 대상(생성 층 또는 수작업 맵) */
export interface LayoutLike {
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly spots: Readonly<Record<string, { readonly tile: Tile }>>;
  readonly playerStart: Tile;
  readonly exitZone: string;
  readonly modules?: readonly unknown[];
}

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/**
 * 칸 비용이 있는 최단 경로(Dijkstra, 4방향). extraCost(i)를 칸에 들어갈 때 더한다.
 * 결정성: (비용, 칸 인덱스) 사전식 최소. 지도가 작아(수백~천 칸) O(n²) 선택으로 충분하다.
 */
export function weightedPath(map: GridMap, start: Tile, goal: Tile, extraCost: (i: number) => number): Tile[] | null {
  const w = map.width, n = w * map.height;
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const s = start.y * w + start.x, g = goal.y * w + goal.x;
  if (!isWalkable(map, goal.x, goal.y) || !isWalkable(map, start.x, start.y)) return null;
  dist[s] = 0;
  for (;;) {
    let cur = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < best) { best = dist[i]!; cur = i; }
    if (cur < 0 || cur === g) break;
    done[cur] = 1;
    const cx = cur % w, cy = (cur - cx) / w;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = ny * w + nx;
      const nd = best + 1 + extraCost(ni);
      if (nd < dist[ni]!) { dist[ni] = nd; from[ni] = cur; }
    }
  }
  if (s !== g && from[g] === -1) return null;
  const out: Tile[] = [];
  for (let i = g; i !== s; i = from[i]!) { const x = i % w; out.push({ x, y: (i - x) / w }); }
  return out.reverse();
}

/** 가로·세로 연속 투명 칸 최대 길이. walkableOnly면 통행 칸이 하나도 없는 줄(책상 줄 등)은 제외 */
export function longestClearSight(map: GridMap, walkableOnly = true): { len: number; at: string } {
  let best = 0, at = '';
  const scan = (len: number, hasWalk: boolean, label: string) => {
    if (len > best && (!walkableOnly || hasWalk)) { best = len; at = label; }
  };
  for (let y = 0; y < map.height; y++) {
    let len = 0, walk = false, sx = 0;
    for (let x = 0; x <= map.width; x++) {
      if (x < map.width && !blocksSight(map, x, y)) { if (len === 0) { sx = x; walk = false; } len++; if (isWalkable(map, x, y)) walk = true; continue; }
      scan(len, walk, `row y=${y} x=${sx}..${x - 1}`); len = 0;
    }
  }
  for (let x = 0; x < map.width; x++) {
    let len = 0, walk = false, sy = 0;
    for (let y = 0; y <= map.height; y++) {
      if (y < map.height && !blocksSight(map, x, y)) { if (len === 0) { sy = y; walk = false; } len++; if (isWalkable(map, x, y)) walk = true; continue; }
      scan(len, walk, `col x=${x} y=${sy}..${y - 1}`); len = 0;
    }
  }
  return { len: best, at };
}

export function validateLayout(layout: LayoutLike, rules: ValidateRules): ValidationResult {
  const failures: GenFailure[] = [];
  let map: GridMap;
  try {
    map = buildGridMap(layout.rows, layout.legend);
  } catch (e) {
    failures.push({ code: 'legend_unknown', detail: String((e as Error).message) });
    return {
      ok: false, failures,
      metrics: { height: layout.rows.length, moduleCount: layout.modules?.length ?? 0, coverTiles: 0, shortestRoute: -1, altRoute: null, sharedRatio: null, maxClearSight: 0, maxClearSightAt: '' },
    };
  }
  if (map.width !== rules.width) failures.push({ code: 'width', detail: `가로 ${map.width} ≠ ${rules.width}` });
  if (map.height > rules.maxHeight) failures.push({ code: 'too_tall', detail: `세로 ${map.height} > 상한 ${rules.maxHeight}` });

  const start = layout.playerStart;
  const dist = distanceField(map, start);
  const reach = (t: Tile) => dist[t.y * map.width + t.x]! >= 0;
  if (!isWalkable(map, start.x, start.y)) failures.push({ code: 'spot_blocked', detail: `플레이어 시작 (${start.x},${start.y}) 통행 불가` });

  for (const name of rules.requiredSpots) {
    const s = layout.spots[name];
    if (!s) { failures.push({ code: 'missing_spot', detail: name }); continue; }
    const t = s.tile;
    if (!isWalkable(map, t.x, t.y)) { failures.push({ code: 'spot_blocked', detail: `${name} (${t.x},${t.y})` }); continue; }
    if (!reach(t)) failures.push({ code: 'unreachable_spot', detail: `${name} (${t.x},${t.y})` });
  }

  let exitTiles = 0, exitReach = 0;
  for (let i = 0; i < map.zones.length; i++) {
    if (map.zones[i] !== layout.exitZone) continue;
    exitTiles++;
    if (dist[i]! >= 0) exitReach++;
  }
  if (exitReach === 0) failures.push({ code: 'unreachable_exit', detail: exitTiles === 0 ? `출구 구역 '${layout.exitZone}' 칸 없음` : '출구 칸에 도달 불가' });

  // ── 지름길/우회 ──
  let shortest = -1, alt: number | null = null, shared: number | null = null;
  const goal = layout.spots[rules.routeGoalSpot]?.tile;
  if (goal && isWalkable(map, goal.x, goal.y) && reach(goal)) {
    const p1 = findPath(map, start, goal);
    if (p1 && p1.length > 0) {
      shortest = p1.length;
      const onP1 = new Set(p1.map((t) => t.y * map.width + t.x));
      const p2 = weightedPath(map, start, goal, (i) => (onP1.has(i) ? rules.sharePenalty : 0));
      if (p2) {
        alt = p2.length;
        const common = p2.filter((t) => onP1.has(t.y * map.width + t.x)).length;
        shared = common / p1.length;
        if (shared > rules.maxSharedRatio || alt / shortest > rules.maxDetourRatio) {
          failures.push({ code: 'no_alternative_route', detail: `공유 ${(shared * 100).toFixed(0)}% (상한 ${(rules.maxSharedRatio * 100).toFixed(0)}%), 우회/최단 ${(alt / shortest).toFixed(2)} (상한 ${rules.maxDetourRatio})` });
        }
      } else failures.push({ code: 'no_alternative_route', detail: '두 번째 경로 없음' });
    }
  } else if (!goal) failures.push({ code: 'missing_spot', detail: `경로 목표 ${rules.routeGoalSpot}` });

  // ── 직선 시선 ──
  const sight = longestClearSight(map, rules.sightCountsWalkableOnly !== false);
  if (sight.len > rules.maxClearSightTiles) failures.push({ code: 'clear_sight_too_long', detail: `${sight.len}칸 > ${rules.maxClearSightTiles} (${sight.at})` });

  let cover = 0;
  for (let i = 0; i < map.cover.length; i++) if (map.cover[i]) cover++;
  const metrics: LayoutMetrics = {
    height: map.height, moduleCount: layout.modules?.length ?? 0, coverTiles: cover,
    shortestRoute: shortest, altRoute: alt, sharedRatio: shared, maxClearSight: sight.len, maxClearSightAt: sight.at,
  };
  return { ok: failures.length === 0, failures, metrics };
}
