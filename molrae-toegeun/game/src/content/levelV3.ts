/**
 * v3 생성 층 → MapBundle (T-145). 순수 TS — QA 헤드리스 재사용.
 *  - 생성(v3gen) → 검증(v3validate: V01·V03~V06·V08~V10·V12) → 그날 계획 검사(V11 화면 안 인원·V13 어제와 다름·V14 순찰 재매핑)
 *  - 실패하면 다음 시드 `layout-day-{n}#r{i}`(최대 validators.maxAttempts = 24), 모두 실패하면 수작업 맵 폴백
 *  - 순찰: 재매핑(스팟 → 노드 → 구역 상대) → 실패하면 patrolTemplates(노드 이름 목록) → 앉은 순찰은 스팟의 facing·lookDirs로 덮어씀,
 *    대표님 입장은 entranceSpeedFit(최대 4.4타일/초, D-083)
 * V13 어제 결과: '어제의 기본 생성 결과(V13 없이 생성한 것)'와 비교한다(연쇄 재계산을 1단계로 끊어 첫 판 진입 시간을 지킴).
 * 어제가 V13 때문에 재시도된 날이면 실제 어제 맵과 다를 수 있다 [근사 — QA 확인 요청].
 */
import { buildGridMap, isWalkable, nearestWalkable, type GridMap, type LegendEntry, type Tile } from '../core/grid';
import { findPath } from '../core/pathfinding';
import type { Dir } from '../core/vision';
import { attemptSeed } from './layoutGen';
import type { GenFailure, V3Metrics } from './layoutGen/types';
import { parseLayoutV3, v3RankT, type LayoutV3, type SpotV3 } from './layoutGen/v3data';
import { generateV3, type V3Layout } from './layoutGen/v3gen';
import { validateV3 } from './layoutGen/v3validate';

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const tile2 = (v: unknown): Tile => (Array.isArray(v) ? { x: num(v[0], 0), y: num(v[1], 0) } : { x: num(obj(v)['x'], 0), y: num(obj(v)['y'], 0) });

export type Tables = Readonly<Record<string, unknown>>;

export interface V3Request {
  readonly tables: Tables;
  readonly day: number;
  readonly plan: O;
  readonly rankId: string;
  readonly requiredPatrols: readonly string[];
  /** 어제 계획(V13). 없으면 V13 생략 */
  readonly planFor?: (day: number) => O;
  readonly seedOverride?: string;
  /** 팀장 순회가 켜지는 날인가(V09 순회 목적지 검사) */
  readonly toursActive: boolean;
}

export interface V3Signature { readonly order: string; readonly variant: string; readonly openings: string }

export interface V3Result {
  readonly v3: LayoutV3;
  readonly layout: V3Layout | null;
  readonly legend: Record<string, LegendEntry>;
  readonly seed: string;
  readonly attempts: number;
  readonly failures: string[];
  readonly metrics?: V3Metrics;
  readonly trimSec: number;
  readonly tourOk: readonly string[];
  readonly signature?: V3Signature;
}

// ── 데이터 도우미 ─────────────────────────────────────

export function legendV3(tables: Tables, v3: LayoutV3): Record<string, LegendEntry> {
  const src = arr(obj(tables['maps'])['maps']).map(obj).find((m) => m['id'] === v3.sourceMapId) ?? {};
  const out: Record<string, LegendEntry> = {};
  for (const [ch, e] of Object.entries(obj(src['legend']))) out[ch] = obj(e) as unknown as LegendEntry;
  for (const [ch, e] of Object.entries(v3.legendAdd)) out[ch] = { ...(out[ch] ?? {}), ...e } as LegendEntry;
  return out;
}

function rankRow(tables: Tables, rankId: string): O {
  return arr(obj(tables['ranks'])['ranks']).map(obj).find((r) => r['id'] === rankId) ?? {};
}

/** 미션 정의(events.json → missions.json missionPool.new 순, D-084: missions.json 우선) */
export function missionRaw(tables: Tables, id: string, preferV3 = true): O | undefined {
  const nu = arr(obj(obj(tables['missions'])['missionPool'])['new']).map(obj).find((m) => m['id'] === id);
  const ev = arr(obj(tables['events'])['events']).map(obj).find((e) => e['id'] === id);
  return preferV3 ? nu ?? ev : ev ?? nu;
}

/** 자리 밖 미션의 장소 스팟 후보(location.spot → params.fallbackSpot) */
export function awaySpotsOf(tables: Tables, ids: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    const e = missionRaw(tables, id);
    if (!e || e['awayFromDesk'] !== true) continue;
    const sp = str(obj(e['location'])['spot']);
    const fb = str(obj(e['params'])['fallbackSpot']);
    out[id] = [sp, fb].filter((s) => s !== '');
  }
  return out;
}

export function planMissionIds(plan: O): string[] {
  return arr(plan['missions']).map(obj).map((m) => str(m['eventId'])).filter((s) => s !== '');
}

export function tourDestinations(v3: LayoutV3, day: number): { id: string; spots: string[] }[] {
  return arr(v3.leadRoaming['destinations']).map(obj)
    .filter((d) => num(d['minDay'], 0) <= day)
    .map((d) => ({ id: str(d['id']), spots: arr(d['spots']).map((s) => str(s)) }));
}

function budgetCtx(tables: Tables, plan: O, rankId: string) {
  const bm = obj(obj(tables['ranks'])['budgetModel']);
  const rank = rankRow(tables, rankId);
  return {
    introSec: num(bm['introSec'], num(obj(obj(tables['rules'])['day'])['introSec'], 2)),
    dayPhaseSec: num(plan['dayPhaseSec'], num(rank['dayPhaseSec'], 50)),
    leaveBaseSec: num(bm['leaveBaseSec'], 16.3), perLeaveInterruptSec: num(bm['perLeaveInterruptSec'], 1.7),
    detourSec: num(bm['detourSec'], 1), ceoVisitPausedSec: num(bm['ceoVisitPausedSec'], 12.5),
    // 근접형 INT-01은 하루 종일 상시라 셈에서 뺌(프로토 V12와 같음)
    leaveInterruptCount: arr(plan['leaveInterrupts']).map(obj).filter((x) => x['id'] !== 'INT-01').length,
  };
}

function signatureOf(L: V3Layout): V3Signature {
  return {
    order: L.placed.map((p) => p.group).join('>'),
    variant: L.placed.map((p) => `${p.id}${p.mirrored ? '~' : ''}`).join(','),
    openings: L.seams.map((s) => s.open.join('.')).join('|'),
  };
}

// ── 순찰 옮기기 ───────────────────────────────────────

export type WaypointRemap = (x: number, y: number) => Tile | null;

/** 수작업 맵 좌표 → 생성 층 좌표 (같은 칸 스팟 이름 → 길목 노드 → 같은 구역 상대 위치) */
export function makeRemapV3(src: O, gen: { spots: Readonly<Record<string, { tile: Tile }>>; zones: readonly { id: string; rect: readonly [number, number, number, number] }[]; nodes: Readonly<Record<string, Tile>> }, grid: GridMap): WaypointRemap {
  const srcSpots: [string, Tile][] = Object.entries(obj(src['spots'])).map(([k, v]) => [k, tile2(obj(v)['tile'])]);
  const srcNodes: [string, Tile][] = Object.entries(obj(src['routeNodes'])).map(([k, v]) => [k, tile2(v)]);
  const srcZones = arr(src['zones']).map(obj).map((z) => ({ id: str(z['id']), rect: arr(z['rect']).map((v) => num(v, 0)) }))
    .sort((a, b) => a.rect[2]! * a.rect[3]! - b.rect[2]! * b.rect[3]!);
  const fix = (t: Tile): Tile | null => nearestWalkable(grid, t.x, t.y, 3);
  return (x, y) => {
    for (const [name, t] of srcSpots) if (t.x === x && t.y === y && gen.spots[name]) return fix(gen.spots[name]!.tile);
    for (const [name, t] of srcNodes) if (t.x === x && t.y === y && gen.nodes[name]) return fix(gen.nodes[name]!);
    for (const z of srcZones) {
      const [zx, zy, zw, zh] = z.rect as [number, number, number, number];
      if (x < zx || y < zy || x >= zx + zw || y >= zy + zh) continue;
      const g = gen.zones.find((q) => q.id === z.id);
      if (!g) continue;
      const [gx, gy, gw, gh] = g.rect;
      return fix({ x: gx + Math.min(gw - 1, x - zx), y: gy + Math.min(gh - 1, y - zy) });
    }
    return null;
  };
}

export function remapWaypointsV3(waypoints: readonly unknown[], remap: WaypointRemap): O[] | null {
  const wps: O[] = [];
  for (const w of waypoints.map(obj)) {
    const t2 = remap(num(w['x'], 0), num(w['y'], 0));
    if (t2) { wps.push({ ...w, x: t2.x, y: t2.y }); continue; }
    if (w['stopId'] !== undefined || w['holdForQte'] || w['holdForReport'] || wps.length === 0) return null;
  }
  return wps.length > 0 ? wps : null;
}

function connected(grid: GridMap, wps: readonly O[], loop: boolean): boolean {
  for (let i = 0; i < wps.length; i++) {
    if (i + 1 >= wps.length && !(loop && wps.length > 1)) break;
    if (!findPath(grid, tile2(wps[i]), tile2(wps[(i + 1) % wps.length]))) return false;
  }
  return true;
}

/** patrolTemplates로 웨이포인트를 만든다(노드 사이는 PatrolNpc 경로탐색이 잇는다). stopId 노드는 원래 웨이포인트 값을 복사 */
function templateWaypoints(v3: LayoutV3, id: string, orig: O, L: { spots: Readonly<Record<string, SpotV3>>; nodes: Readonly<Record<string, Tile>> }, grid: GridMap, depth = 0): O[] | null {
  const tpl = obj(v3.patrolTemplates[id]);
  if (typeof tpl['reverseOf'] === 'string' && depth < 2) {
    const base = templateWaypoints(v3, tpl['reverseOf'] as string, orig, L, grid, depth + 1);
    return base ? base.slice().reverse() : null;
  }
  const nodes = arr(tpl['nodes']);
  if (nodes.length === 0) return null;
  const origWps = arr(orig['waypoints']).map(obj);
  const out: O[] = [];
  for (const n of nodes) {
    const ref = typeof n === 'string' ? { node: n } : obj(n);
    const name = str(ref['node']);
    const t = L.nodes[name] ?? L.spots[name]?.tile;
    if (!t) { if (ref['optional'] === true) continue; return null; }
    const at = nearestWalkable(grid, t.x, t.y, 2);
    if (!at) return null;
    const stopId = typeof ref['stopId'] === 'string' ? ref['stopId'] as string : undefined;
    const src = stopId ? origWps.find((w) => w['stopId'] === stopId) : undefined;
    out.push({ ...(src ?? { waitSec: num(ref['waitSec'], 0) }), ...(typeof ref['lookChance'] === 'number' ? { lookChance: ref['lookChance'] } : {}), x: at.x, y: at.y });
  }
  return out.length > 0 ? out : null;
}

export interface PatrolMover {
  /** 이 층에 맞게 옮긴 순찰(원본 + waypoints·speedOverride 교체). 못 옮기면 null */
  (patrol: O): O | null;
}

export function makePatrolMover(tables: Tables, v3: LayoutV3, L: V3Layout, legend: Readonly<Record<string, LegendEntry>>): PatrolMover {
  const src = arr(obj(tables['maps'])['maps']).map(obj).find((m) => m['id'] === v3.sourceMapId) ?? {};
  const grid = buildGridMap(L.rows, legend);
  const remap = makeRemapV3(src, { spots: L.spots, zones: L.zones, nodes: L.nodes }, grid);
  const seatedFrom = obj(v3.patrolTemplates['seatedFromSpot']);
  const ceoFit = obj(obj(v3.patrolTemplates['p_ceo_visit'])['entranceSpeedFit']);
  return (p) => {
    const id = str(p['id']);
    const loop = p['loop'] !== false && p['kind'] !== 'seated';
    let wps = remapWaypointsV3(arr(p['waypoints']), remap);
    if (!wps || !connected(grid, wps, loop)) {
      wps = templateWaypoints(v3, id, p, L, grid);
      if (!wps || !connected(grid, wps, loop)) return null;
    }
    // 앉은 순찰: 스팟 좌표·facing·lookDirs로 덮어씀(team_back = 남쪽을 보고 앉아 위쪽을 돌아봄)
    const spotName = typeof seatedFrom[id] === 'string' ? seatedFrom[id] as string : undefined;
    const sp = spotName ? L.spots[spotName] : undefined;
    if (sp && wps.length > 0) {
      wps = [{ ...wps[0]!, x: sp.tile.x, y: sp.tile.y, ...(sp.facing ? { facing: sp.facing } : {}), ...(sp.lookDirs ? { lookDirs: [...sp.lookDirs] } : {}) }, ...wps.slice(1)];
    }
    const out: O = { ...p, waypoints: wps };
    // 대표님 입장 속도 맞춤(D-083): 첫 구간(입장 → 인사 지점) 경로 ÷ targetSec, [minSpeed, maxSpeed]
    if (id === 'p_ceo_visit' && typeof ceoFit['targetSec'] === 'number') {
      const gi = wps.findIndex((w) => w['stopId'] === 'stop_ceo_greet');
      let len = 0;
      for (let i = 0; i < Math.max(0, gi); i++) len += (findPath(grid, tile2(wps[i]), tile2(wps[i + 1]))?.length ?? 1) - 1;
      if (len > 0) out['speedOverride'] = Math.round(Math.min(num(ceoFit['maxSpeed'], 4.4), Math.max(num(ceoFit['minSpeed'], 2.4), len / (ceoFit['targetSec'] as number))) * 100) / 100;
    }
    return out;
  };
}

// ── V11 화면 안 인원 ───────────────────────────────────

function crowdCheck(tables: Tables, req: V3Request, L: V3Layout, legend: Readonly<Record<string, LegendEntry>>, mover: PatrolMover, tourOk: readonly string[], v3: LayoutV3): GenFailure | null {
  const rules = obj(obj(tables['rules'])['characters']);
  const win = num(rules['screenRowsTiles'], 20), maxScreen = num(rules['maxOnScreen'], 8), maxFloor = num(rules['maxOnFloor'], 12);
  const grid = buildGridMap(L.rows, legend);
  const patrols = arr(obj(tables['patrols'])['patrols']).map(obj).filter((p) => p['mapId'] === v3.sourceMapId);
  const ranges = new Map<string, [number, number]>();
  const add = (who: string, ys: readonly number[]) => {
    if (ys.length === 0) return;
    const r = ranges.get(who);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    ranges.set(who, r ? [Math.min(r[0], lo), Math.max(r[1], hi)] : [lo, hi]);
  };
  const pathYs = (wps: readonly O[], loop: boolean): number[] => {
    const ys: number[] = [];
    for (let i = 0; i < wps.length; i++) {
      ys.push(tile2(wps[i]).y);
      if (i + 1 < wps.length || (loop && wps.length > 1)) for (const t of findPath(grid, tile2(wps[i]), tile2(wps[(i + 1) % wps.length])) ?? []) ys.push(t.y);
    }
    return ys;
  };
  for (const id of req.requiredPatrols) {
    const p = patrols.find((x) => x['id'] === id);
    if (!p) continue;
    const m = mover(p);
    if (!m) continue;
    add(str(p['actorId'], id), pathYs(arr(m['waypoints']).map(obj), p['loop'] !== false && p['kind'] !== 'seated'));
  }
  // 팀장 = 자리 ∪ 순회 경로(같은 사람)
  const tl = L.spots['tl_seat'];
  if (tl && req.toursActive) {
    for (const d of tourDestinations(v3, req.day)) {
      if (!tourOk.includes(d.id)) continue;
      const n = d.spots.find((s) => L.spots[s]);
      if (n) add('team_lead', (findPath(grid, tl.tile, L.spots[n]!.tile) ?? []).map((t) => t.y));
    }
  }
  // 배경 동료(npcs.background: fromDay·untilRank)
  const ranks = arr(obj(tables['ranks'])['ranks']).map(obj);
  const order = (id: unknown) => num(ranks.find((r) => r['id'] === id)?.['order'], 99);
  for (const b of arr(obj(tables['npcs'])['background']).map(obj)) {
    if (num(b['fromDay'], 1) > req.day) continue;
    if (b['untilRank'] !== null && b['untilRank'] !== undefined && order(req.rankId) > order(b['untilRank'])) continue;
    const beh = str(b['behavior'], 'sit');
    const at = obj(beh === 'sit' ? b['seat'] : b['spot']);
    const wps = beh === 'walk' ? arr(b['waypoints']).map(obj) : [{ x: num(at['x'], 0), y: num(at['y'], 0), waitSec: 0 }];
    const m = mover({ id: str(b['id']), kind: beh === 'walk' ? 'route' : 'seated', loop: b['loop'] !== false, waypoints: wps });
    if (m) add(`bg:${str(b['id'])}`, pathYs(arr(m['waypoints']).map(obj), beh === 'walk'));
  }
  const seat = L.spots['player_seat']?.tile;
  const count = (exclude: (who: string) => boolean): { screen: number; floor: number; at: number } => {
    let best = 0, at = 0, floor = 1;
    const list = [...ranges.entries()].filter(([w]) => !exclude(w));
    floor += list.length;
    for (let y0 = 0; y0 + win <= Math.max(win, L.rows.length); y0++) {
      let n = 1; // 플레이어
      for (const [, [a, b]] of list) if (b >= y0 && a < y0 + win) n++;
      if (n > best) { best = n; at = y0; }
    }
    return { screen: best, floor, at };
  };
  void seat;
  // H7: 대표님 ↔ 본부장·인사팀은 동시에 없음 → 둘 중 많은 쪽
  const hasCeo = ranges.has('ceo');
  const a = count((w) => w === 'ceo');
  const b = hasCeo ? count((w) => w === 'director' || w === 'hr_inspector') : a;
  const worst = a.screen >= b.screen ? a : b;
  const worstFloor = Math.max(a.floor, b.floor);
  if (worst.screen > maxScreen) return { code: 'too_crowded', detail: `V11 화면 안 ${worst.screen}명 > ${maxScreen} (y ${worst.at}~${worst.at + win - 1})` };
  if (worstFloor > maxFloor) return { code: 'too_crowded', detail: `V11 층 전체 ${worstFloor}명 > ${maxFloor}` };
  return null;
}

// ── 생성 ─────────────────────────────────────────────

const baseCache = new WeakMap<object, Map<string, V3Result>>();

function cacheFor(tables: Tables): Map<string, V3Result> {
  const k = tables as unknown as object;
  let m = baseCache.get(k);
  if (!m) { m = new Map(); baseCache.set(k, m); }
  return m;
}

/**
 * 그날 v3 생성. withVariety=false면 V13을 보지 않는다(어제 기준 계산용).
 * 결과는 (tables, day, seedOverride, 필요한 순찰, V13 여부) 기준으로 캐시(같은 일차 = 같은 맵).
 */
export function generateV3Day(req: V3Request, withVariety = true): V3Result | null {
  const v3 = parseLayoutV3(req.tables);
  if (!v3) return null;
  const key = `${req.day}|${req.seedOverride ?? ''}|${withVariety ? 1 : 0}|${req.toursActive ? 1 : 0}|${req.requiredPatrols.join(',')}|${planMissionIds(req.plan).join(',')}|${str(req.plan['ceo'])}|${num(req.plan['dayPhaseSec'], 0)}`;
  const cache = cacheFor(req.tables);
  const hit = cache.get(key);
  if (hit) return hit;
  const legend = legendV3(req.tables, v3);
  const rank = rankRow(req.tables, req.rankId);
  const dr = arr(rank['dayRange']);
  const t = v3RankT(req.rankId, req.day, [num(dr[0], 1), dr[1] === null || dr[1] === undefined ? null : num(dr[1], 1)]);
  const ceoDay = str(req.plan['ceo'], 'none') !== 'none';
  const missions = planMissionIds(req.plan);
  const away = awaySpotsOf(req.tables, missions);
  const dests = req.toursActive ? tourDestinations(v3, req.day) : [];
  const genCtx = { v3, legend, rankId: req.rankId, t, ceoDay, missions, awayMissionSpots: away };
  const valCtx = { v3, legend, ceoDay, awayMissionSpots: away, budget: budgetCtx(req.tables, req.plan, req.rankId), tourDestinations: dests };
  let yesterday: V3Signature | undefined;
  if (withVariety && req.planFor && req.day - 1 > v3.authoredMapDays) {
    const yp = req.planFor(req.day - 1);
    const yr = generateV3Day({ ...req, day: req.day - 1, plan: yp, rankId: str(yp['rankId'], req.rankId) }, false);
    yesterday = yr?.signature;
  }
  const base = req.seedOverride ?? `layout-day-${req.day}`;
  const failures: string[] = [];
  let res: V3Result | null = null;
  for (let i = 0; i < v3.maxAttempts; i++) {
    const seed = attemptSeed(base, i);
    const g = generateV3(genCtx, seed);
    if (!g.layout) { failures.push(`${seed}: ${g.fail.code} ${g.fail.detail}`); continue; }
    const L = g.layout;
    const v = validateV3(L, valCtx);
    const extra: GenFailure[] = [];
    if (v.ok) {
      const mover = makePatrolMover(req.tables, v3, L, legend);
      const patrols = arr(obj(req.tables['patrols'])['patrols']).map(obj).filter((p) => p['mapId'] === v3.sourceMapId);
      for (const id of req.requiredPatrols) {
        const p = patrols.find((x) => x['id'] === id);
        if (p && !mover(p)) extra.push({ code: 'patrol_unmappable', detail: `V14 ${id}` });
      }
      if (extra.length === 0) { const c = crowdCheck(req.tables, req, L, legend, mover, v.tourOk, v3); if (c) extra.push(c); }
      const sig = signatureOf(L);
      if (extra.length === 0 && yesterday) {
        const diff = (sig.order !== yesterday.order ? 1 : 0) + (sig.variant !== yesterday.variant ? 1 : 0) + (sig.openings !== yesterday.openings ? 1 : 0);
        if (diff < 2) extra.push({ code: 'same_as_yesterday', detail: `V13 차이 ${diff}가지` });
      }
      if (extra.length === 0) {
        res = { v3, layout: L, legend, seed, attempts: i + 1, failures, metrics: v.metrics, trimSec: v.trimSec, tourOk: v.tourOk, signature: sig };
        break;
      }
    }
    for (const f of [...v.failures, ...extra]) failures.push(`${seed}: ${f.code} ${f.detail}`);
  }
  if (!res) res = { v3, layout: null, legend, seed: base, attempts: v3.maxAttempts, failures, trimSec: 0, tourOk: [] };
  cache.set(key, res);
  return res;
}

export { isWalkable };
export type { Dir };
