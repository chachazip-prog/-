/**
 * v3 생성 층 검증 (T-145, layout.json validators). 순수 TS, 결정적, 정수 판정.
 * 여기서 판정: V01·V03·V04·V05·V06·V08·V09·V10·V12. (V02·V07은 생성기 보정, V11·V13·V14는 levelProvider extraCheck — 그날 계획·어제 결과 필요)
 * 기준: layout_proto.py validate() 이식 + 프로토 미구현분(V06 우회·V09 순회 목적지·V10 ①③) 추가.
 * 해석(추측, 기획 확인 요청):
 *  - V06 '폭 1 구간마다 우회 ≤ +16'은 길이 3칸 이상인 폭 1 구간에만 적용(이음 행 문 1칸은 통로가 아니라 문으로 봄)
 *  - V09 순회 목적지 편도 6~22 밖이거나 내 자리를 지나야만 가는 목적지는 '그날 순회 후보에서 제외'(soft). 남은 목적지가 2곳 미만이면 실패
 */
import type { LegendEntry, Tile } from '../../core/grid';
import type { Dir } from '../../core/vision';
import { bfsDist, firstSpot, missionCap, occupiedSet, type V3Layout } from './v3gen';
import type { LayoutV3 } from './v3data';
import type { GenFailure, V3Metrics } from './types';

export interface V3ValidateContext {
  readonly v3: LayoutV3;
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly ceoDay: boolean;
  readonly awayMissionSpots: Readonly<Record<string, readonly string[]>>;
  /** V12 입력 */
  readonly budget: {
    readonly introSec: number; readonly dayPhaseSec: number; readonly leaveBaseSec: number; readonly perLeaveInterruptSec: number;
    readonly detourSec: number; readonly ceoVisitPausedSec: number; readonly leaveInterruptCount: number;
  };
  /** 팀장 순회 목적지 스팟 후보(목적지별, 앞에서부터 첫 스팟). 순회가 없는 날은 빈 배열 */
  readonly tourDestinations: readonly { readonly id: string; readonly spots: readonly string[] }[];
}

export interface V3ValidationResult {
  readonly ok: boolean;
  readonly failures: GenFailure[];
  readonly metrics: V3Metrics;
  /** V12 근무 구간 감축(초, 0.1 단위) */
  readonly trimSec: number;
  /** V09를 통과한 순회 목적지 id */
  readonly tourOk: readonly string[];
}

const DV: Readonly<Record<Dir, readonly [number, number]>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

class Grid {
  readonly W: number; readonly H: number;
  constructor(readonly rows: readonly string[], readonly legend: Readonly<Record<string, LegendEntry>>) { this.W = rows[0]!.length; this.H = rows.length; }
  e(x: number, y: number): LegendEntry | undefined { return x < 0 || y < 0 || x >= this.W || y >= this.H ? undefined : this.legend[this.rows[y]![x]!]; }
  walk(x: number, y: number): boolean { return this.e(x, y)?.walkable === true; }
  sight(x: number, y: number): boolean { return this.e(x, y)?.blocksSight !== false; }
  ch(x: number, y: number): string { return this.rows[y]?.[x] ?? '#'; }
}

/** 칸 4방향 Dijkstra(벌점 포함). 동률은 (비용, 칸 번호) 사전식 — 결정적 */
function dpath(g: Grid, s: Tile, t: Tile, blocked: ReadonlySet<number>, pen?: ReadonlyMap<number, number>): Tile[] | null {
  const W = g.W, n = W * g.H;
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const si = s.y * W + s.x, gi = t.y * W + t.x;
  if (!g.walk(s.x, s.y) || !g.walk(t.x, t.y)) return null;
  dist[si] = 0;
  const heap: [number, number][] = [[0, si]];
  const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (v: [number, number]) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]!) continue;
    if (i === gi) break;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!g.walk(nx, ny)) continue;
      const ni = ny * W + nx;
      if (blocked.has(ni) && ni !== gi) continue;
      const nd = d + 1 + (pen?.get(ni) ?? 0);
      if (nd < dist[ni]!) { dist[ni] = nd; from[ni] = i; push([nd, ni]); }
    }
  }
  if (si !== gi && from[gi] === -1) return null;
  const out: Tile[] = [];
  for (let i = gi; i !== si; i = from[i]!) { const x = i % W; out.push({ x, y: (i - x) / W }); }
  out.push(s);
  return out.reverse();
}

/** 정수 시야선: 칸 중심 사이를 4배 분할 샘플(프로토 los와 같은 판정, 정수만) */
export function losInt(g: Grid, a: Tile, b: Tile): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const n = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
  for (let i = 1; i < n; i++) {
    const tx = Math.floor(((2 * a.x + 1) * n + 2 * dx * i) / (2 * n));
    const ty = Math.floor(((2 * a.y + 1) * n + 2 * dy * i) / (2 * n));
    if ((tx === a.x && ty === a.y) || (tx === b.x && ty === b.y)) continue;
    if (g.sight(tx, ty)) return false;
  }
  return true;
}

/** 콘 5타일·30°(정수: d² ≤ 25, 4·dot² ≥ 3·d²) */
function inCone(g: Grid, o: Tile, dir: Dir, t: Tile, range = 5): boolean {
  const dx = t.x - o.x, dy = t.y - o.y;
  const d2 = dx * dx + dy * dy;
  if (d2 === 0 || d2 > range * range) return false;
  const [fx, fy] = DV[dir];
  const dot = dx * fx + dy * fy;
  if (dot <= 0 || 4 * dot * dot < 3 * d2) return false;
  return losInt(g, o, t);
}

function coverTiles(g: Grid): Set<number> {
  const s = new Set<number>();
  for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
    if (!g.walk(x, y)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.e(x + dx!, y + dy!)?.cover === true)) s.add(y * g.W + x);
  }
  return s;
}

function uncoveredStraight(g: Grid, cov: ReadonlySet<number>): number {
  let best = 0;
  for (let x = 0; x < g.W; x++) {
    let run = 0;
    for (let y = 0; y < g.H; y++) {
      if (g.sight(x, y) || cov.has(y * g.W + x)) run = 0;
      else if (g.walk(x, y)) { run++; best = Math.max(best, run); }
    }
  }
  for (let y = 0; y < g.H; y++) {
    let run = 0;
    for (let x = 0; x < g.W; x++) {
      if (g.sight(x, y) || cov.has(y * g.W + x)) run = 0;
      else if (g.walk(x, y)) { run++; best = Math.max(best, run); }
    }
  }
  return best;
}

function rawClearSight(g: Grid): number {
  let best = 0;
  for (let y = 0; y < g.H; y++) { let r = 0; for (let x = 0; x < g.W; x++) { r = g.sight(x, y) ? 0 : r + 1; best = Math.max(best, r); } }
  for (let x = 0; x < g.W; x++) { let r = 0; for (let y = 0; y < g.H; y++) { r = g.sight(x, y) ? 0 : r + 1; best = Math.max(best, r); } }
  return best;
}

function deadEnds(g: Grid, occ: ReadonlySet<number>, spotTiles: ReadonlySet<number>): number[] {
  const W = g.W;
  const nb = (x: number, y: number): [number, number][] => ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
    .map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([nx, ny]) => g.walk(nx, ny) && !occ.has(ny * W + nx));
  const out: number[] = [];
  for (let y = 0; y < g.H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!g.walk(x, y) || occ.has(i) || spotTiles.has(i)) continue;
    if (nb(x, y).length !== 1) continue;
    let len = 1;
    let prev: [number, number] | null = null;
    let cur: [number, number] = [x, y];
    for (;;) {
      const all = nb(cur[0], cur[1]);
      const ns = all.filter(([a, b]) => !prev || a !== prev[0] || b !== prev[1]);
      if (all.length >= 3 || ns.length !== 1) break;
      prev = cur; cur = ns[0]!;
      if (nb(cur[0], cur[1]).length >= 3) break;
      len++;
    }
    if (len >= 2) out.push(len);
  }
  return out;
}

const isW1 = (g: Grid, x: number, y: number) => g.walk(x, y) && !g.walk(x - 1, y) && !g.walk(x + 1, y) && g.e(x, y)?.kind !== 'gate';

export function validateV3(L: V3Layout, ctx: V3ValidateContext): V3ValidationResult {
  const v3 = ctx.v3;
  const g = new Grid(L.rows, ctx.legend);
  const W = g.W;
  const S = L.spots;
  const fails: GenFailure[] = [];
  const fail = (code: GenFailure['code'], detail: string) => fails.push({ code, detail });
  const occ = occupiedSet(S, W);
  const idx = (t: Tile) => t.y * W + t.x;
  const seat = S['player_seat']?.tile, gate = S['gate_use']?.tile;
  const mo: Record<string, number> = {};
  const metrics0 = (): V3Metrics => ({
    seatToGate: -1, missionOneWay: mo, ceoWalk: -1, uncoveredStraight: 0, rawClearSight: 0, deadEnds: 0, pillars: 0, halfPartitions: 0,
    coverTiles: 0, branchPointsOnLeave: 0, repairsUsed: L.repairs, trimSec: 0, predictedRunSec: 0, altExtra: 0, sharedRatio: 0,
  });
  if (!seat || !gate) { fail('missing_spot', 'player_seat/gate_use'); return { ok: false, failures: fails, metrics: metrics0(), trimSec: 0, tourOk: [] }; }
  const dist = bfsDist(L.rows, ctx.legend, seat, occ);
  const dOf = (t: Tile) => dist[idx(t)]!;
  // ── V01 도달 ──
  const missionGoals: { id: string; t: Tile }[] = [];
  for (const [id, names] of Object.entries(ctx.awayMissionSpots)) {
    const n = firstSpot(S, names);
    if (!n) { fail('missing_spot', `V01 ${id}: ${names.join('|')}`); continue; }
    if (dOf(S[n]!.tile) < 0) { fail('unreachable_spot', `V01 ${id} ${n}`); continue; }
    missionGoals.push({ id, t: S[n]!.tile });
  }
  const sg = dOf(gate);
  if (sg < 0) fail('unreachable_spot', 'V01 gate_use');
  let exitOk = false;
  for (let y = 0; y < g.H && !exitOk; y++) for (let x = 0; x < W; x++) if (g.e(x, y)?.zone === 'exit' && dist[y * W + x]! >= 0) { exitOk = true; break; }
  if (!exitOk) fail('unreachable_exit', 'V01 exit');
  const em = S['elevator_main_use']?.tile, es = S['elevator_service_spawn']?.tile;
  const hi = S['hr_inspect_spot']?.tile, cg = S['ceo_greet_spot']?.tile;
  if (em && hi && bfsDist(L.rows, ctx.legend, em, occ)[idx(hi)]! < 0) fail('unreachable_spot', 'V01 elevator_main_use → hr_inspect_spot');
  const dsv = es ? bfsDist(L.rows, ctx.legend, es, occ) : null;
  if (dsv && cg && dsv[idx(cg)]! < 0) fail('unreachable_spot', 'V01 elevator_service_spawn → ceo_greet_spot');
  if (fails.length) return { ok: false, failures: fails, metrics: metrics0(), trimSec: 0, tourOk: [] };
  // ── V03 거리 ──
  const V03 = v3.validators['V03_distance'] ?? {};
  let [lo, hiG] = L.tier.seatToGate;
  if (ctx.ceoDay) hiG = Math.min(hiG, typeof V03['ceoDaySeatToGateMax'] === 'number' ? V03['ceoDaySeatToGateMax'] as number : 40);
  if (sg < lo || sg > hiG) fail('distance_out_of_band', `V03 seatToGate ${sg} 범위 밖 [${lo}, ${hiG}]`);
  for (const m of missionGoals) {
    const d = dOf(m.t); mo[m.id] = d;
    const cap = missionCap(v3, L.tier, m.id);
    if (d < 6 || d > cap) fail('distance_out_of_band', `V03 ${m.id} ${d} 범위 밖 [6, ${cap}]`);
  }
  const ceoWalk = dsv && cg ? dsv[idx(cg)]! : -1;
  const ceoMax = typeof V03['ceoWalkMaxTiles'] === 'number' ? V03['ceoWalkMaxTiles'] as number : 20;
  if (ctx.ceoDay && ceoWalk > ceoMax) fail('distance_out_of_band', `V03 ceoWalk ${ceoWalk} > ${ceoMax}`);
  // ── V12 시간 예산 ──
  const V12 = v3.validators['V12_time_budget'] ?? {};
  const B = ctx.budget;
  const refSg = typeof V12['refSeatToGateTiles'] === 'number' ? V12['refSeatToGateTiles'] as number : 33;
  const speed = typeof V12['playerSpeedTilesPerSec'] === 'number' ? V12['playerSpeedTilesPerSec'] as number : 3;
  const leaveSec = B.leaveBaseSec + (sg - refSg) / speed + B.leaveInterruptCount * B.perLeaveInterruptSec + B.detourSec;
  const pred = B.introSec + B.dayPhaseSec + (ctx.ceoDay ? B.ceoVisitPausedSec : 0) + leaveSec;
  const cap12 = ctx.ceoDay ? (typeof V12['ceoDayMaxPredictedSec'] === 'number' ? V12['ceoDayMaxPredictedSec'] as number : 80.5)
    : (typeof V12['normalDayMaxPredictedSec'] === 'number' ? V12['normalDayMaxPredictedSec'] as number : 84);
  const trimMax = typeof V12['trimMaxSec'] === 'number' ? V12['trimMaxSec'] as number : 3;
  const overSec = pred - cap12;
  // 0.1초 단위 올림(정수 연산으로 반올림 오차 제거)
  const trimSec = overSec > 1e-9 ? Math.ceil(Math.round(overSec * 1000) / 100) / 10 : 0;
  if (overSec > trimMax + 1e-9) fail('over_time_budget', `V12 예측 ${pred.toFixed(1)}초 > ${cap12} + ${trimMax}`);
  // ── V04 지름길·우회 ──
  const V04 = v3.validators['V04_shortcut_detour'] ?? {};
  const gateR = { ratio: 1.6, extra: 16, shared: 0.75, ...pick(V04['gate']) };
  const misR = { ratio: 2.0, extra: 16, shared: 0.75, ...pick(V04['mission']) };
  const sharePen = typeof V04['sharePenalty'] === 'number' ? V04['sharePenalty'] as number : 6;
  const tl = S['tl_seat'];
  const ld: Dir = tl?.lookDirs?.[0] ?? 'up';
  const cov = coverTiles(g);
  let altExtra = 0, sharedRatio = 0, branch = 0, w1 = 0;
  let riskOk = true;
  const P0 = dpath(g, seat, gate, occ);
  for (const goal of [{ id: 'gate', t: gate }, ...missionGoals]) {
    const P = goal.id === 'gate' ? P0 : dpath(g, seat, goal.t, occ);
    if (!P) { fail('no_alternative_route', `V04 ${goal.id} 경로 없음`); continue; }
    const core = P.slice(3, Math.max(3, P.length - 3));
    const pen = new Map<number, number>(core.map((t) => [idx(t), sharePen]));
    const Ap = dpath(g, seat, goal.t, occ, pen);
    if (!Ap) { fail('no_alternative_route', `V04 ${goal.id} 대안 없음`); continue; }
    const aset = new Set(Ap.map(idx));
    const shared = core.filter((t) => aset.has(idx(t))).length / Math.max(1, core.length);
    const lp = P.length - 1, la = Ap.length - 1;
    const R = goal.id === 'gate' ? gateR : misR;
    // [해석] 양끝 3칸을 뺀 '가운데'가 3칸 미만인 짧은 길(팀 복사기 등)은 공유 비율 판정을 하지 않음(대안 경로가 의미 없음)
    const ok = la <= lp * R.ratio && la - lp <= R.extra && (core.length < 3 || shared <= R.shared);
    if (goal.id === 'gate') {
      altExtra = la - lp; sharedRatio = Math.round(shared * 100) / 100;
      let run = 0;
      for (const t of P) { if (isW1(g, t.x, t.y)) { run++; w1 = Math.max(w1, run); } else run = 0; }
      if (tl) {
        const cats = (path: readonly Tile[]): Set<string> => {
          const cs = new Set<string>();
          for (const q of path.slice(1)) {
            if (inCone(g, tl.tile, ld, q)) cs.add('tl_cone');
            const dx = q.x - tl.tile.x, dy = q.y - tl.tile.y;
            if (dx * dx + dy * dy <= 6) cs.add('tl_talk');
            if (q.x > 0 && q.x < W - 1 && isW1(g, q.x, q.y)) cs.add('choke');
          }
          return cs;
        };
        const cS = cats(P), cA = cats(Ap);
        const covS = P.filter((q) => cov.has(idx(q))).length, covA = Ap.filter((q) => cov.has(idx(q))).length;
        riskOk = cS.size > 0 && ([...cS].some((k) => !cA.has(k)) || covA > covS);
      }
      const ys = new Set(P.map((p) => p.y));
      branch = L.seams.filter((s) => ys.has(s.y) && s.open.length >= 2 && !(s.open.length <= 3 && s.open[s.open.length - 1]! - s.open[0]! === s.open.length - 1)).length;
    }
    if (!ok) fail('no_alternative_route', `V04 ${goal.id} +${la - lp} 공유 ${shared.toFixed(2)}`);
  }
  if (!riskOk) fail('no_alternative_route', 'V04 지름길이 위험하지 않음(D-040)');
  // ── V05 무엄폐 직선 ──
  const us = uncoveredStraight(g, cov);
  if (us > L.tier.maxUncoveredStraight) fail('clear_sight_too_long', `V05 ${us} > ${L.tier.maxUncoveredStraight}`);
  // ── V06 통로 폭 ──
  let vrun = 0;
  for (let x = 1; x < W - 1; x++) { let r = 0; for (let y = 0; y < g.H; y++) { if (isW1(g, x, y)) { r++; vrun = Math.max(vrun, r); } else r = 0; } }
  if (vrun > 6 || w1 > 6) fail('choke_too_long', `V06 폭 1 세로 ${Math.max(vrun, w1)} > 6`);
  if (P0) {
    const lp = P0.length - 1;
    let seg: Tile[] = [];
    const checkSeg = () => {
      if (seg.length >= 3) {
        const bl = new Set(occ); for (const t of seg) bl.add(idx(t));
        const D = dpath(g, seat, gate, bl);
        if (!D || D.length - 1 > lp + 16) fail('choke_too_long', `V06 폭 1 구간 (${seg[0]!.x},${seg[0]!.y}) 우회 ${D ? D.length - 1 - lp : '없음'}`);
      }
      seg = [];
    };
    for (const t of P0) { if (isW1(g, t.x, t.y)) seg.push(t); else checkSeg(); }
    checkSeg();
  }
  // ── V08 막힌 길 ──
  const spotTiles = new Set(Object.values(S).map((s) => idx(s.tile)));
  const de = deadEnds(g, occ, spotTiles);
  if (de.some((l) => l >= 5)) fail('dead_end_trap', `V08 길이 ${Math.max(...de)}`);
  // ── V09 팀장 시야·순회 목적지 ──
  const tourOk: string[] = [];
  if (tl) {
    if (!inCone(g, tl.tile, ld, seat)) fail('lead_cannot_see_seat', 'V09 팀장 돌아보기 콘이 내 자리를 덮지 않음');
    const bl = new Set(occ); bl.delete(idx(tl.tile)); bl.add(idx(seat));
    for (const d of ctx.tourDestinations) {
      const n = firstSpot(S, d.spots);
      if (!n) continue;
      const p = dpath(g, tl.tile, S[n]!.tile, bl);
      if (p && p.length - 1 >= 6 && p.length - 1 <= 22) tourOk.push(d.id);
    }
    if (ctx.tourDestinations.length > 0 && tourOk.length < 2) fail('lead_cannot_see_seat', `V09 순회 목적지 ${tourOk.length}곳(< 2)`);
  }
  // ── V10 게이트 ──
  const ga = L.nodes['n_guard_a'], gb = L.nodes['n_guard_b'], gc = L.nodes['n_guard_c'];
  if (ga && gb) {
    const legs = [[ga, gb], [gb, gc ?? ga], ...(gc ? [[gc, ga]] : [])] as [Tile, Tile][];
    const passes = legs.some(([a, b]) => (dpath(g, a, b, new Set()) ?? []).some((t) => Math.abs(t.x - gate.x) <= 1));
    if (!passes) fail('gate_unfair', 'V10① 경비 순찰이 게이트 열 ±1을 지나지 않음');
  }
  let gcov = false;
  for (const i of cov) { const x = i % W, y = (i - x) / W; const m = Math.abs(x - gate.x) + Math.abs(y - gate.y); if (m >= 2 && m <= 5) { gcov = true; break; } }
  if (!gcov) fail('gate_unfair', 'V10② 게이트 2~5타일 안 엄폐 칸 없음');
  if ((L.seams[0]?.open.length ?? 0) < 1) fail('gate_unfair', 'V10③ 게이트 홀 아래 개구부 없음');

  let pillars = 0, halves = 0;
  for (const r of L.rows) for (const ch of r) { if (ch === 'O') pillars++; else if (ch === 'i') halves++; }
  const metrics: V3Metrics = {
    seatToGate: sg, missionOneWay: mo, ceoWalk, uncoveredStraight: us, rawClearSight: rawClearSight(g), deadEnds: de.length, pillars,
    halfPartitions: halves, coverTiles: cov.size, branchPointsOnLeave: branch, repairsUsed: L.repairs, trimSec,
    predictedRunSec: Math.round((pred - trimSec) * 10) / 10, altExtra, sharedRatio,
  };
  return { ok: fails.length === 0, failures: fails, metrics, trimSec: fails.length === 0 ? trimSec : 0, tourOk };
}

function pick(v: unknown): { ratio?: number; extra?: number; shared?: number } {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    ...(typeof o['maxDetourRatio'] === 'number' ? { ratio: o['maxDetourRatio'] } : {}),
    ...(typeof o['maxDetourExtraTiles'] === 'number' ? { extra: o['maxDetourExtraTiles'] } : {}),
    ...(typeof o['maxSharedRatio'] === 'number' ? { shared: o['maxSharedRatio'] } : {}),
  };
}

export { Grid as V3Grid, dpath as v3Path };
