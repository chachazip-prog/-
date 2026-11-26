/**
 * v3 모듈 조립 생성기 (T-145, layout.json schemaVersion 3). 순수 TS, 결정적.
 * 기준: design/gdd-v3-procedural.md §1-4 + 참조 프로토 design/tools/layout_proto.py(조립·와일드카드·이음 행·수리 순서와 RNG 소비 순서를 그대로 이식).
 * 프로토와 다른 점(데이터 규칙을 더 따름):
 *  - 스팟·노드 이름이 겹치면 먼저 나온 것 유지(스키마 §1-2). 프로토는 나중 것으로 덮음
 *  - 열리지 않은 회의실 문 포트를 closedDoorPortChar('Y')로 그림(스키마 §1-3)
 *  - V07 배치 보정(기둥·막힘이 문·개구부·스폿 8방향 이웃이면 '.', i·P 맞닿으면 i 제거), V02 고아 바닥 → 'L'
 *  - RNG 시드 = `layout:{versionTag}:{시도 시드}`(D-085)
 * 정수 연산: 거리·격자는 정수, 가중치 보간만 실수(IEEE 754 기본 연산은 기기 간 동일).
 */
import { createRng, type Rng } from '../../core/rng';
import type { LegendEntry, Tile } from '../../core/grid';
import type { Dir } from '../../core/vision';
import type { GenderDayCtx } from '../gender';
import { mirrorModule, type LayoutV3, type ModuleV3, type RankComplexityV3, type SpotV3, type WildOpt, type ZoneV3 } from './v3data';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp2 = (p: readonly [number, number], c: number): number => lerp(p[0], p[1], c);

/** 앉은 사람이 점유하는 의자(통행 판정에서 막음) */
export const OCCUPIED_SEAT_SPOTS = ['tl_seat', 'tl2_seat', 'snitch_seat', 'accomplice_seat', 'bg_next_team_seat', 'buddy_seat', 'exec_seat'] as const;

export interface V3GenContext {
  readonly v3: LayoutV3;
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly rankId: string;
  /** complexityFormula의 t */
  readonly t: number;
  readonly ceoDay: boolean;
  /** 그날 미션 id(요구 모듈 강제) */
  readonly missions: readonly string[];
  /** 자리 밖 미션의 장소 스팟 후보(앞에서부터 층에 있는 첫 스팟). 수리·V03·V04 대상 */
  readonly awayMissionSpots: Readonly<Record<string, readonly string[]>>;
  /** T-151 성별 시설(genderFacilities.enabled + 그날 fromDay 이상). 없으면 기존과 완전히 같은 생성 */
  readonly gender?: GenderDayCtx | null;
}

export interface V3Seam { readonly y: number; readonly open: readonly number[] }

export interface V3Layout {
  readonly seed: string;
  readonly rows: string[];
  readonly spots: Record<string, SpotV3>;
  readonly nodes: Record<string, Tile>;
  readonly zones: ZoneV3[];
  readonly chokepoints: { id: string; tiles: Tile[]; bypass: string }[];
  readonly placed: { id: string; y: number; height: number; mirrored: boolean; group: string }[];
  readonly seams: V3Seam[];
  readonly complexity: number;
  readonly tier: RankComplexityV3;
  readonly repairs: number;
  readonly fixes: { orphan: number; placement: number };
}

export type V3GenResult = { layout: V3Layout; fail: null } | { layout: null; fail: { code: string; detail: string } };

export function complexityFor(v3: LayoutV3, rankId: string, t: number): { c: number; tier: RankComplexityV3 } | null {
  const tier = v3.ranks[rankId];
  if (!tier) return null;
  return { c: lerp2(tier.complexity, t), tier };
}

function walk(legend: Readonly<Record<string, LegendEntry>>, ch: string | undefined): boolean {
  return !!ch && legend[ch]?.walkable === true;
}

/** 모듈 안 통행 칸(앉은 사람 의자 제외)이 한 덩어리인가 */
function moduleConnected(m: ModuleV3, rows: readonly string[], legend: Readonly<Record<string, LegendEntry>>, W: number): boolean {
  const occ = new Set<number>();
  for (const k of OCCUPIED_SEAT_SPOTS) { const s = m.spots[k]; if (s) occ.add(s.tile.y * W + s.tile.x); }
  const cells: number[] = [];
  const isCell = (x: number, y: number) => y >= 0 && y < rows.length && x >= 0 && x < W && walk(legend, rows[y]![x]) && !occ.has(y * W + x);
  // 프로토: sorted((x, y)) 첫 칸 = x 최소 → y 최소
  let start = -1;
  for (let x = 0; x < W && start < 0; x++) for (let y = 0; y < rows.length; y++) if (isCell(x, y)) { start = y * W + x; break; }
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < W; x++) if (isCell(x, y)) cells.push(y * W + x);
  if (cells.length === 0) return true;
  const seen = new Set<number>([start]);
  const st = [start];
  while (st.length) {
    const i = st.pop()!;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (isCell(nx, ny) && !seen.has(ny * W + nx)) { seen.add(ny * W + nx); st.push(ny * W + nx); }
    }
  }
  return seen.size === cells.length;
}

function guardModule(m: ModuleV3, rows: string[], legend: Readonly<Record<string, LegendEntry>>, W: number): string[] {
  if (moduleConnected(m, rows, legend, W)) return rows;
  const g = rows.map((r) => [...r]);
  for (const wc of ['!', '?', 'o']) {
    for (let y = 0; y < m.rows.length; y++) {
      for (let x = 0; x < W; x++) {
        if (m.rows[y]![x] === wc && g[y]![x] !== '.') {
          g[y]![x] = '.';
          const cand = g.map((r) => r.join(''));
          if (moduleConnected(m, cand, legend, W)) return cand;
        }
      }
    }
  }
  return g.map((r) => r.join(''));
}

function wpick(rng: Rng, opts: readonly WildOpt[], c: number): string {
  return rng.weighted(opts, (o) => lerp2(o.weight, c))?.ch ?? '.';
}

/** BFS 거리장(4방향). blocked 칸은 못 지나감(목표가 blocked여도 도달은 셈하지 않음) */
export function bfsDist(rows: readonly string[], legend: Readonly<Record<string, LegendEntry>>, start: Tile, blocked: ReadonlySet<number>): Int32Array {
  const H = rows.length, W = rows[0]!.length;
  const d = new Int32Array(W * H).fill(-1);
  if (!walk(legend, rows[start.y]?.[start.x])) return d;
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  const s = start.y * W + start.x;
  d[s] = 0; q[t++] = s;
  while (h < t) {
    const i = q[h++]!;
    const x = i % W, y = (i - x) / W;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (d[ni]! >= 0 || blocked.has(ni) || !walk(legend, rows[ny]![nx])) continue;
      d[ni] = d[i]! + 1; q[t++] = ni;
    }
  }
  return d;
}

export function occupiedSet(spots: Readonly<Record<string, { readonly tile: Tile }>>, W: number): Set<number> {
  const s = new Set<number>();
  for (const k of OCCUPIED_SEAT_SPOTS) { const p = spots[k]; if (p) s.add(p.tile.y * W + p.tile.x); }
  return s;
}

export function firstSpot(spots: Readonly<Record<string, unknown>>, names: readonly string[]): string | undefined {
  return names.find((n) => spots[n] !== undefined);
}

/** 미션 거리 상한(V03): 인턴 = 기준 편도 + internSlack, 그 외 missionOneWayCap. 택배는 제외(∞) */
export function missionCap(v3: LayoutV3, tier: RankComplexityV3, id: string): number {
  const V = v3.validators['V03_distance'] ?? {};
  const cap = typeof V['missionOneWayCap'] === 'number' ? V['missionOneWayCap'] as number : 28;
  const slack = typeof V['internSlackTiles'] === 'number' ? V['internSlackTiles'] as number : 4;
  if (id === 'parcel') return 9999;
  return tier.tier === 0 ? (v3.missionRefOneWayTiles[id] ?? cap) + slack : cap;
}

export function generateV3(ctx: V3GenContext, attemptSeed: string): V3GenResult {
  const v3 = ctx.v3, legend = ctx.legend, W = v3.width;
  const cx = complexityFor(v3, ctx.rankId, ctx.t);
  if (!cx) return { layout: null, fail: { code: 'no_module', detail: `직급 ${ctx.rankId} 복잡도 없음` } };
  const { c, tier } = cx;
  const A0 = v3.assembly;
  const gd = ctx.gender ?? null;
  // D-085: 성별 시설이 켜진 날은 규칙 해시를 버전 태그에 붙임(꺼진 날의 시드·맵은 그대로)
  const rng = createRng(`layout:${v3.versionTag}${gd ? gd.tag : ''}:${attemptSeed}`);
  const G = (g: string): string => (gd ? gd.groupReplace[g] ?? g : g);
  const optionalPool = gd?.fitnessGroup ? [...A0.optionalPool, gd.fitnessGroup] : A0.optionalPool;
  const belowAllowed = [...A0.belowTeamAllowedGroups.map(G), ...(gd?.fitnessGroup && gd.fitnessBelow ? [gd.fitnessGroup] : [])];
  const byGroup = new Map<string, ModuleV3[]>();
  for (const m of v3.modules) { const g = byGroup.get(m.group) ?? []; g.push(m); byGroup.set(m.group, g); }
  const A = { ...A0, optionalPool, belowTeamAllowedGroups: belowAllowed };
  const need = new Set<string>();
  for (const id of ctx.missions) { const p = A.missionRequiresProvides[id]; if (p) need.add(p); }

  let nopt = rng.int(tier.optionalModules[0], tier.optionalModules[1]);
  let nlow = rng.int(tier.lowerModules[0], tier.lowerModules[1]);
  if (ctx.ceoDay) { nopt = A.ceoOptional; nlow = A.ceoLower; }
  const pickVar = (group: string): ModuleV3 | undefined => {
    const cands = (byGroup.get(group) ?? []).filter((m) => m.minComplexity <= c + 1e-9);
    return rng.weighted(cands, (m) => lerp2(m.weightByComplexity, c));
  };
  const top = pickVar('lobby_exit'), ex = pickVar('exec'), nt = pickVar('next_team'), rm = pickVar(G('rest_meet'));
  const team = pickVar('team'), bot = pickVar('service_end');
  if (!top || !ex || !nt || !rm || !team || !bot) return { layout: null, fail: { code: 'no_module', detail: '필수 그룹 모듈 없음' } };
  const provided = new Set<string>();
  for (const m of [top, ex, nt, rm, team, bot]) for (const p of m.provides) provided.add(p);
  let opt: ModuleV3[] = [];
  if (bot.requiresGroup) { const r = pickVar(bot.requiresGroup); if (r) opt.push(r); }
  for (const p0 of [...need].sort()) {
    const alts = p0.split('|');
    if (alts.some((a) => provided.has(a)) || alts.some((a) => opt.some((o) => o.provides.includes(a)))) continue;
    const p = alts[0]!;
    const g = A.optionalPool.find((gg) => (byGroup.get(gg) ?? []).some((m) => m.provides.includes(p)));
    if (!g) continue;
    const cand = (byGroup.get(g) ?? []).filter((m) => m.provides.includes(p));
    opt.push(cand[0]!);
  }
  let pool = [...A.optionalPool];
  while (opt.length < nopt) {
    const g = rng.weighted(pool, (gg) => Math.max(0, ...(byGroup.get(gg) ?? []).map((m) => lerp2(m.weightByComplexity, c) * (m.minComplexity <= c ? 1 : 0))));
    if (g === undefined) break;
    const m = pickVar(g);
    if (!m) break;
    if (opt.some((o) => o.group === g) && !m.repeatable) { pool = pool.filter((x) => x !== g); continue; }
    opt.push(m);
  }
  let lower: ModuleV3[] = [];
  let belowRows = 0;
  const reqIds = new Set<ModuleV3>();
  for (const p of need) for (const o of opt) if (p.split('|').some((a) => o.provides.includes(a))) reqIds.add(o);
  if (bot.requiresGroup) for (const o of opt) if (o.group === bot.requiresGroup) reqIds.add(o);
  const mids: ModuleV3[] = [nt];
  if (nlow > 0 && rng.chance(lerp2(A.restMeetBelowChance, c)) && rm.rows.length + 1 <= tier.belowTeamMaxRows) {
    lower.push(rm); belowRows += rm.rows.length + 1;
  } else mids.push(rm);
  let rowsAbove = mids.reduce((s, m) => s + m.rows.length + 1, 0) + ex.rows.length + 1;
  const keep: ModuleV3[] = [];
  for (const o of opt) {
    const h = o.rows.length + 1;
    if (rowsAbove + h <= tier.aboveTeamMaxRows && keep.filter((k) => !reqIds.has(k)).length < A.maxNonRequiredOptionalAboveTeam) { keep.push(o); rowsAbove += h; }
    else if (lower.length < nlow && A.belowTeamAllowedGroups.includes(o.group) && belowRows + h <= tier.belowTeamMaxRows) { lower.push(o); belowRows += h; }
    else if (reqIds.has(o)) { keep.push(o); rowsAbove += h; }
  }
  opt = keep;
  lower = rng.shuffle(lower);
  let above = rng.shuffle([...mids, ...opt]);
  if (tier.authoredOrder) above = [...mids, ...opt];
  let seq: ModuleV3[] = [top, ex, ...above, team, ...lower, bot];
  // 인접 포트 호환: 하나도 안 겹치면 연결부 삽입
  const junction = v3.modules.find((m) => m.id === 'mid_junction_pillars');
  const fixed: ModuleV3[] = [seq[0]!];
  for (const m of seq.slice(1)) {
    const a = fixed[fixed.length - 1]!;
    const pb = a.ports?.bottom, pt = m.ports?.top;
    if (pb && pt && junction && !pb.some((x) => pt.includes(x)) && !pb.some((x) => pt.includes(W - 1 - x))) fixed.push(junction);
    fixed.push(m);
  }
  seq = fixed;
  const ti = seq.findIndex((m) => m.group === 'team');
  if (seq.slice(ti + 1, -1).reduce((s, m) => s + m.rows.length + 1, 0) > tier.belowTeamMaxRows) return { layout: null, fail: { code: 'row_budget', detail: '팀 아래 행 예산 초과' } };
  seq = seq.map((m) => (m.mirrorable && rng.chance(0.5) ? mirrorModule(m, W) : m));
  const wk = (ch: string | undefined) => !!ch && (ch === '?' || ch === '!' || ch === 'o' || walk(legend, ch));
  const out: ModuleV3[] = [seq[0]!];
  for (let m of seq.slice(1)) {
    const a = out[out.length - 1]!;
    let ok = false;
    for (let x = 1; x < W - 1 && !ok; x++) {
      const inB = !a.ports?.bottom || a.ports.bottom.includes(x);
      const inT = !m.ports?.top || m.ports.top.includes(x);
      if (wk(a.rows[a.rows.length - 1]![x]) && wk(m.rows[0]![x]) && inB && inT) ok = true;
    }
    if (!ok && m.mirrorable) m = mirrorModule(m, W);
    out.push(m);
  }
  seq = out;
  // 와일드카드
  const filled = seq.map((m) => {
    const last = m.rows.length - 1;
    const protect = m.group !== 'lobby_exit' && m.group !== 'service_end';
    const rows = m.rows.map((r, yi) => {
      let s = '';
      for (const ch of r) {
        const opts = ctx.v3.wildcards[ch];
        s += opts ? ((yi === 0 || yi === last) && protect ? '.' : wpick(rng, opts, c)) : ch;
      }
      return s;
    });
    return { m, rows: guardModule(m, rows, legend, W) };
  });
  // 이음 행 + 전역 좌표
  const grid: string[] = [];
  const spots: Record<string, SpotV3> = {};
  const nodes: Record<string, Tile> = {};
  const zones: ZoneV3[] = [];
  const chokes: { id: string; tiles: Tile[]; bypass: string }[] = [];
  const placed: V3Layout['placed'] = [];
  const seams: V3Seam[] = [];
  const sm = v3.seam;
  for (let i = 0; i < filled.length; i++) {
    const { m, rows } = filled[i]!;
    if (i > 0) {
      const prev = filled[i - 1]!;
      const pb = prev.m.ports?.bottom, ntp = m.ports?.top;
      const pl = prev.rows[prev.rows.length - 1]!, mf = rows[0]!;
      const cols: number[] = [];
      for (let x = 1; x < W - 1; x++) if (walk(legend, pl[x]) && walk(legend, mf[x]) && (!pb || pb.includes(x)) && (!ntp || ntp.includes(x))) cols.push(x);
      const doorcols = new Set<number>([...(prev.m.ports?.doorCols ?? []), ...(m.ports?.doorCols ?? [])]);
      const ov = i === 1 ? sm.top : null;
      const o0 = ov ? ov.openings : sm.openings, o1 = ov ? ov.openingsAtMax : sm.openingsAtMax;
      const lo = Math.round(lerp(o0[0], o1[0], c)), hi = Math.round(lerp(o0[1], o1[1], c));
      const n = rng.int(lo, Math.max(lo, hi));
      const wideChance = ov ? ov.wideChance : sm.wideChance, wideWidth = ov ? ov.wideWidth : sm.wideWidth;
      const row: string[] = Array.from({ length: W }, () => sm.wallChar);
      const req = new Set<number>([...(prev.m.ports?.requiredBottom ?? []), ...(m.ports?.requiredTop ?? [])]);
      const chosen = cols.filter((x) => req.has(x));
      const dchance = Math.max(...[prev.m, m].map((mm) => lerp2(mm.ports?.doorOpenChance ?? [0, 0], c)));
      for (const x of [...doorcols].sort((a, b) => a - b)) if (cols.includes(x) && !chosen.includes(x) && rng.chance(dchance)) chosen.push(x);
      const prevop = new Set<number>(seams.length ? seams[seams.length - 1]!.open : []);
      const bonus = lerp2(sm.spineBonus, c);
      const cand = cols.filter((x) => !chosen.includes(x) && !doorcols.has(x));
      while (chosen.length < n && cand.length) {
        const x = rng.weighted(cand, (xx) => 1 + bonus * (sm.spineCols.includes(xx) || prevop.has(xx) ? 1 : 0))!;
        cand.splice(cand.indexOf(x), 1);
        if (chosen.every((y) => Math.abs(x - y) >= sm.minGap + 1)) chosen.push(x);
      }
      // [해석] 통로 열이 하나도 안 남고 문 포트만 맞으면 그 문을 연다(실패보다 '회의실 문으로만 통하는 날'). RNG 소비 없음
      if (chosen.length === 0) { const d = [...doorcols].sort((x, y) => x - y).find((x) => cols.includes(x)); if (d !== undefined) chosen.push(d); }
      if (chosen.length === 0) return { layout: null, fail: { code: 'seam_incompatible', detail: `${prev.m.id} ↔ ${m.id}` } };
      for (const x of chosen) row[x] = doorcols.has(x) ? '=' : wpick(rng, sm.openChars, c);
      if (![...doorcols].some((x) => chosen.includes(x)) && rng.chance(lerp2(wideChance, c))) {
        const x = chosen[0]!;
        const wdt = rng.int(wideWidth[0], wideWidth[1]);
        for (let dx = 1; dx < wdt; dx++) {
          for (const xx of [x + dx, x - dx]) {
            if (cols.includes(xx) && row[xx] === sm.wallChar && row.filter((k) => k !== sm.wallChar).length < chosen.length + wdt - 1) row[xx] = '.';
          }
        }
        for (let k = 0; k < W; k++) if (row[k] === '=' && !doorcols.has(k)) row[k] = '.';
      }
      // 열리지 않은 회의실 문 포트 = '사용 중' 문(스키마 §1-3)
      for (const x of doorcols) if (cols.includes(x) && row[x] === sm.wallChar && legend[sm.closedDoorPortChar]) row[x] = sm.closedDoorPortChar;
      const open: number[] = [];
      for (let k = 0; k < W; k++) if (walk(legend, row[k])) open.push(k);
      seams.push({ y: grid.length, open });
      grid.push(row.join(''));
    }
    const y0 = grid.length;
    placed.push({ id: m.id, y: y0, height: rows.length, mirrored: m.mirrored, group: m.group });
    for (const [k, s] of Object.entries(m.spots)) if (!spots[k]) spots[k] = { ...s, tile: { x: s.tile.x, y: s.tile.y + y0 }, ...(s.memoDesk ? { memoDesk: { x: s.memoDesk.x, y: s.memoDesk.y + y0 } } : {}) };
    for (const [k, t] of Object.entries(m.routeNodes)) if (!nodes[k]) nodes[k] = { x: t.x, y: t.y + y0 };
    // T-151: '{mine}' 별칭(events.restroom의 restroom_stall·zone restroom이 그대로 동작). 시설 모듈만 해당
    if (gd && m.genderFacility) {
      const mine = m.genderFacility.type === 'locker_room' ? gd.lockerMine : gd.mine;
      for (const [alias, tgt] of Object.entries(m.spotAliases ?? {})) {
        const s0 = m.spots[tgt.replace('{mine}', mine)];
        if (s0 && !spots[alias]) spots[alias] = { ...s0, tile: { x: s0.tile.x, y: s0.tile.y + y0 } };
      }
      for (const [alias, tgt] of Object.entries(m.zoneAliases ?? {})) {
        const z0 = m.zones.find((z) => z.id === tgt.replace('{mine}', mine));
        if (z0) zones.push({ ...z0, id: alias, rect: [z0.rect[0], z0.rect[1] + y0, z0.rect[2], z0.rect[3]] });
      }
    }
    for (const z of m.zones) zones.push({ ...z, rect: [z.rect[0], z.rect[1] + y0, z.rect[2], z.rect[3]] });
    for (const ch of m.chokepoints) chokes.push({ id: ch.id, bypass: ch.bypass, tiles: ch.tiles.map((t) => ({ x: t.x, y: t.y + y0 })) });
    grid.push(...rows);
  }
  if (grid.length > v3.maxHeight) return { layout: null, fail: { code: 'too_tall', detail: `${grid.length} > ${v3.maxHeight}` } };
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < W; x++) {
    if (!legend[grid[y]![x]!]) return { layout: null, fail: { code: 'legend_unknown', detail: `(${x},${y}) '${grid[y]![x]}'` } };
  }
  const L: V3Layout = {
    seed: attemptSeed, rows: grid, spots, nodes, zones, chokepoints: chokes, placed, seams, complexity: c, tier, repairs: 0,
    fixes: { orphan: 0, placement: 0 },
  };
  const pf = placementFix(L, legend);
  const of = orphanFix(L, legend);
  if (of < 0) return { layout: null, fail: { code: 'unreachable_spot', detail: '고아 바닥 안 스폿(V02)' } };
  const repairs = repair(L, ctx);
  return { layout: { ...L, repairs, fixes: { orphan: of, placement: pf } }, fail: null };
}

/** V07: 기둥·막힘이 문·개구부·스폿 8방향 이웃이면 '.', i가 P와 4방향으로 맞닿으면 '.' */
function placementFix(L: V3Layout, legend: Readonly<Record<string, LegendEntry>>): number {
  const H = L.rows.length, W = L.rows[0]!.length;
  const g = L.rows.map((r) => [...r]);
  const special = new Set<number>();
  for (const s of Object.values(L.spots)) special.add(s.tile.y * W + s.tile.x);
  for (const sm of L.seams) for (const x of sm.open) special.add(sm.y * W + x);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (legend[g[y]![x]!]?.kind === 'door') special.add(y * W + x);
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = g[y]![x]!;
    if (ch === 'O' || ch === 'L' || ch === 'Z') {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && special.has((y + dy) * W + (x + dx)) && x + dx >= 0 && x + dx < W) { near = true; break; }
      }
      if (near) { g[y]![x] = '.'; n++; }
    } else if (ch === 'i') {
      const adjP = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy!]?.[x + dx!] === 'P');
      if (adjP) { g[y]![x] = '.'; n++; }
    }
  }
  if (n > 0) for (let y = 0; y < H; y++) L.rows[y] = g[y]!.join('');
  return n;
}

/** V02: 플레이어 자리에서 닿지 않는 통행 칸 → 'L'. 그 안에 스폿이 있으면 -1(실패) */
function orphanFix(L: V3Layout, legend: Readonly<Record<string, LegendEntry>>): number {
  const seat = L.spots['player_seat'];
  if (!seat) return -1;
  const H = L.rows.length, W = L.rows[0]!.length;
  const d = bfsDist(L.rows, legend, seat.tile, new Set());
  const spotAt = new Set(Object.values(L.spots).map((s) => s.tile.y * W + s.tile.x));
  let n = 0;
  const g = L.rows.map((r) => [...r]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!walk(legend, g[y]![x]) || d[i]! >= 0) continue;
    if (spotAt.has(i)) return -1;
    g[y]![x] = 'L'; n++;
  }
  if (n > 0) for (let y = 0; y < H; y++) L.rows[y] = g[y]!.join('');
  return n;
}

/** 수리(repair): 거리 초과량을 가장 많이 줄이는 이음 행 칸을 하나씩 연다(최대 maxOpenings, 시드 소비 없음) */
function repair(L: V3Layout, ctx: V3GenContext): number {
  const v3 = ctx.v3, legend = ctx.legend;
  if (!v3.repair.enabled) return 0;
  const W = L.rows[0]!.length;
  const S = L.spots;
  const seat = S['player_seat'], gate = S['gate_use'];
  if (!seat || !gate) return 0;
  const V = v3.validators['V03_distance'] ?? {};
  let hi = L.tier.seatToGate[1];
  if (ctx.ceoDay) hi = Math.min(hi, typeof V['ceoDaySeatToGateMax'] === 'number' ? V['ceoDaySeatToGateMax'] as number : 40);
  const ceoWalkMax = typeof V['ceoWalkMaxTiles'] === 'number' ? V['ceoWalkMaxTiles'] as number : 20;
  const occ = occupiedSet(S, W);
  const targets: { t: Tile; cap: number }[] = [{ t: gate.tile, cap: hi }];
  for (const [id, names] of Object.entries(ctx.awayMissionSpots)) {
    const n = firstSpot(S, names);
    if (n) targets.push({ t: S[n]!.tile, cap: missionCap(v3, L.tier, id) });
  }
  const sv = S['elevator_service_spawn'], cg = S['ceo_greet_spot'];
  const rows = L.rows.map((r) => [...r]);
  // T-157 repair.protectFacilityTiles: 위·아래 칸이 시설 칸이면 열지 않음('시설 안을 지나는 지름길' 방지). 성별 시설이 켜진 날만(끈 맵 불변)
  const FAC_KINDS = ['restroom_floor', 'restroom_stall', 'locker_floor', 'shower_stall', 'door_screened'];
  const protect = v3.repair.protectFacilityTiles && !!ctx.gender;
  const isFac = (ch: string | undefined): boolean => {
    const e = ch !== undefined ? legend[ch] as (LegendEntry & { facilityDoor?: boolean }) | undefined : undefined;
    return !!e && (FAC_KINDS.includes(e.kind) || e.facilityDoor === true);
  };
  const over = (): number => {
    const G = rows.map((r) => r.join(''));
    const d = bfsDist(G, legend, seat.tile, occ);
    let o = 0;
    for (const tg of targets) { const v = d[tg.t.y * W + tg.t.x]!; o += Math.max(0, (v < 0 ? 99 : v) - tg.cap); }
    if (ctx.ceoDay && sv && cg) { const dc = bfsDist(G, legend, sv.tile, occ)[cg.tile.y * W + cg.tile.x]!; o += Math.max(0, (dc < 0 ? 99 : dc) - ceoWalkMax); }
    return o;
  };
  let cur = over();
  let n = 0;
  while (cur > 0 && n < v3.repair.maxOpenings) {
    let best: { key: [number, number, number]; si: number; y: number; x: number } | null = null;
    for (let si = 0; si < L.seams.length; si++) {
      const sm = L.seams[si]!;
      for (let x = 1; x < W - 1; x++) {
        if (rows[sm.y]![x] !== '#' || sm.open.includes(x)) continue;
        if (!(walk(legend, rows[sm.y - 1]![x]) && walk(legend, rows[sm.y + 1]![x]))) continue;
        if (protect && (isFac(rows[sm.y - 1]![x]) || isFac(rows[sm.y + 1]![x]))) continue;
        if (sm.open.some((o) => Math.abs(x - o) < 2)) continue;
        rows[sm.y]![x] = '.';
        const v = over();
        rows[sm.y]![x] = '#';
        const key: [number, number, number] = [v, Math.abs(x - 5), sm.y];
        if (v < cur && (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2]))))) best = { key, si, y: sm.y, x };
      }
    }
    if (!best) break;
    rows[best.y]![best.x] = '.';
    const s = L.seams[best.si]!;
    L.seams[best.si] = { y: s.y, open: [...s.open, best.x].sort((a, b) => a - b) };
    n++;
    cur = over();
  }
  if (n > 0) for (let y = 0; y < rows.length; y++) L.rows[y] = rows[y]!.join('');
  return n;
}

export type { Dir };
