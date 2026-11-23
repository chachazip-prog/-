/**
 * 모듈 조립 엔진 (D-076, T-144). 순수 TS, 결정적: 같은 입력(모듈·규칙·복잡도·시드) → 같은 층.
 *
 * 순서
 *  1) rules.slots를 위에서 아래로 돌며 슬롯마다 개수를 정하고(복잡도 보간 + 시드 추첨) 태그가 맞는 모듈을 가중치로 고른다.
 *  2) 고른 모듈은 와일드카드를 해석하고(rules.wildcards, 복잡도 보간 가중치) mirrorable이면 시드로 좌우 반전한다.
 *  3) 바로 위 모듈의 마지막 행과 이 모듈의 첫 행이 모두 통행 가능한 열이 하나도 없으면 이 후보를 버리고 다른 후보를 시도한다.
 *  4) 모듈 사이에 이음 행(seam)을 넣고, 양쪽 모두 통행 가능한 열 중 rules.seam.openings개를 서로 떨어뜨려 뚫는다.
 *  5) 스팟·구역·길목 노드를 전역 좌표로 옮긴다(같은 이름 스팟은 먼저 나온 것 유지).
 * 이 단계는 '모양'만 만든다. 도달성·지름길/우회·시선 길이 같은 공정성은 validate.ts가 따로 판정한다.
 */
import { createRng, type Rng } from '../../core/rng';
import type { LegendEntry, Tile } from '../../core/grid';
import type { Dir } from '../../core/vision';
import type {
  GenFailure, GenInput, GeneratedLayout, ModuleTemplate, ModuleZone, PlacedModule, WildcardOption,
} from './types';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function lerpRange(a: readonly [number, number], b: readonly [number, number] | undefined, c: number): [number, number] {
  const bb = b ?? a;
  const lo = Math.round(lerp(a[0], bb[0], c));
  const hi = Math.round(lerp(a[1], bb[1], c));
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

function pickChar(opts: readonly WildcardOption[], c: number, rng: Rng): string | undefined {
  return rng.weighted(opts, (o) => Math.max(0, lerp(o.weight[0], o.weight[1], c)))?.ch;
}

const MIRROR_DIR: Readonly<Record<Dir, Dir>> = { left: 'right', right: 'left', up: 'up', down: 'down' };

interface Variant {
  readonly tpl: ModuleTemplate;
  readonly rows: string[];
  readonly mirrored: boolean;
  readonly spots: Record<string, { tile: Tile; facing?: Dir }>;
  readonly zones: ModuleZone[];
  readonly nodes: Record<string, Tile>;
}

/** 와일드카드 해석 + (선택) 좌우 반전 */
function makeVariant(tpl: ModuleTemplate, input: GenInput, c: number, rng: Rng, mirror: boolean): Variant {
  const W = input.rules.width;
  const wild = input.rules.wildcards ?? {};
  const rows = tpl.rows.map((r) => {
    let out = '';
    for (const ch of r) {
      const opts = wild[ch];
      out += opts ? (pickChar(opts, c, rng) ?? ch) : ch;
    }
    return mirror ? [...out].reverse().join('') : out;
  });
  const mx = (x: number): number => (mirror ? W - 1 - x : x);
  const spots: Record<string, { tile: Tile; facing?: Dir }> = {};
  for (const [k, s] of Object.entries(tpl.spots ?? {})) {
    const f = s.facing ? (mirror ? MIRROR_DIR[s.facing] : s.facing) : undefined;
    spots[k] = { tile: { x: mx(s.x), y: s.y }, ...(f ? { facing: f } : {}) };
  }
  const zones: ModuleZone[] = (tpl.zones ?? []).map((z) => ({
    ...z, rect: [mirror ? W - z.rect[0] - z.rect[2] : z.rect[0], z.rect[1], z.rect[2], z.rect[3]] as const,
  }));
  const nodes: Record<string, Tile> = {};
  for (const [k, v] of Object.entries(tpl.routeNodes ?? {})) nodes[k] = { x: mx(v[0]), y: v[1] };
  return { tpl, rows, mirrored: mirror, spots, zones, nodes };
}

const walkableCh = (legend: Readonly<Record<string, LegendEntry>>, ch: string | undefined): boolean => !!ch && legend[ch]?.walkable === true;

/** 위 모듈 마지막 행과 아래 모듈 첫 행이 모두 통행 가능한 열(바깥 벽 열 제외) */
export function seamCandidates(upperLast: string, lowerFirst: string, legend: Readonly<Record<string, LegendEntry>>): number[] {
  const out: number[] = [];
  const W = Math.min(upperLast.length, lowerFirst.length);
  for (let x = 1; x < W - 1; x++) if (walkableCh(legend, upperLast[x]) && walkableCh(legend, lowerFirst[x])) out.push(x);
  return out;
}

function moduleWeight(m: ModuleTemplate, c: number): number {
  if (m.weightByComplexity) return Math.max(0, lerp(m.weightByComplexity[0], m.weightByComplexity[1], c));
  return Math.max(0, m.weight ?? 1);
}

/** 이음 행: 후보 열에서 서로 2칸 이상 떨어진 열을 고르고 corridorWidth만큼 넓힌다 */
function buildSeam(cands: readonly number[], input: GenInput, c: number, rng: Rng): string {
  const s = input.rules.seam;
  const W = input.rules.width;
  const [lo, hi] = lerpRange(s.openings, s.openingsAtMax, c);
  const want = Math.max(1, rng.int(Math.max(1, lo), Math.max(1, hi)));
  const order = rng.shuffle(cands);
  const chosen: number[] = [];
  for (const x of order) {
    if (chosen.length >= want) break;
    if (chosen.some((y) => Math.abs(y - x) < 2)) continue;
    chosen.push(x);
  }
  const cw = Math.max(1, s.corridorWidth ?? 1);
  const open = new Set<number>();
  for (const x of chosen) for (let k = 0; k < cw; k++) if (cands.includes(x + k)) open.add(x + k);
  let row = '';
  for (let x = 0; x < W; x++) row += open.has(x) ? (pickChar(s.openChars, c, rng) ?? '.') : s.wallChar;
  return row;
}

export interface GenerateResult {
  readonly layout: GeneratedLayout | null;
  /** 치명 실패(이 시드로는 층을 만들 수 없음) 또는 경고(duplicate_spot) */
  readonly failures: readonly GenFailure[];
}

export function generateLayout(input: GenInput): GenerateResult {
  const rules = input.rules;
  const c = clamp01(input.complexity);
  const rng = createRng(`layout:${input.seed}`);
  const failures: GenFailure[] = [];
  const legend = input.legend;
  const W = rules.width;

  for (const m of input.modules) {
    for (const r of m.rows) if (r.length !== W) {
      failures.push({ code: 'row_width', detail: `모듈 ${m.id}: 행 길이 ${r.length} ≠ ${W}` });
      return { layout: null, failures };
    }
  }

  const used = new Set<string>();
  const chosen: Variant[] = [];
  for (const slot of rules.slots) {
    const [lo, hi] = lerpRange(slot.count ?? [1, 1], slot.countAtMax, c);
    const n = rng.int(lo, hi);
    for (let i = 0; i < n; i++) {
      const cands = input.modules.filter((m) => m.tags.includes(slot.tag) && (m.minComplexity ?? 0) <= c && (m.repeatable === true || !used.has(m.id)));
      const pool = cands.slice();
      let got: Variant | null = null;
      let seamFail = false;
      while (pool.length > 0 && !got) {
        const tpl = rng.weighted(pool, (m) => moduleWeight(m, c));
        if (!tpl) break;
        pool.splice(pool.indexOf(tpl), 1);
        const mirror = tpl.mirrorable === true && rng.chance(0.5);
        const v = makeVariant(tpl, input, c, rng, mirror);
        const prev = chosen[chosen.length - 1];
        if (prev && seamCandidates(prev.rows[prev.rows.length - 1]!, v.rows[0]!, legend).length === 0) { seamFail = true; continue; }
        got = v;
      }
      if (!got) {
        if (i < lo) {
          failures.push({ code: seamFail ? 'seam_incompatible' : 'no_module', detail: `슬롯 '${slot.tag}' ${i + 1}번째: ${seamFail ? '이음 가능한 모듈 없음' : '후보 모듈 없음'}` });
          return { layout: null, failures };
        }
        break; // 선택 개수는 채우지 못해도 됨
      }
      used.add(got.tpl.id);
      chosen.push(got);
    }
  }
  if (chosen.length === 0) {
    failures.push({ code: 'no_module', detail: '배치된 모듈 없음' });
    return { layout: null, failures };
  }

  // ── 조립 ──
  const rows: string[] = [];
  const placed: PlacedModule[] = [];
  const spots: Record<string, { tile: Tile; facing?: Dir }> = {};
  const zones: { id: string; nameKey: string; rect: readonly [number, number, number, number]; outsideOffice?: boolean }[] = [];
  const nodes: Record<string, Tile> = {};
  for (let k = 0; k < chosen.length; k++) {
    const v = chosen[k]!;
    if (k > 0) {
      const prev = chosen[k - 1]!;
      rows.push(buildSeam(seamCandidates(prev.rows[prev.rows.length - 1]!, v.rows[0]!, legend), input, c, rng));
    }
    const y0 = rows.length;
    rows.push(...v.rows);
    placed.push({ id: v.tpl.id, y: y0, height: v.rows.length, mirrored: v.mirrored });
    for (const [name, s] of Object.entries(v.spots)) {
      if (spots[name]) { failures.push({ code: 'duplicate_spot', detail: `스팟 ${name}: ${v.tpl.id}의 것은 무시(먼저 나온 것 유지)` }); continue; }
      spots[name] = { tile: { x: s.tile.x, y: s.tile.y + y0 }, ...(s.facing ? { facing: s.facing } : {}) };
    }
    for (const z of v.zones) {
      zones.push({
        id: z.id, nameKey: z.nameKey ?? `zone.${z.id}`, rect: [z.rect[0], z.rect[1] + y0, z.rect[2], z.rect[3]],
        ...(z.outsideOffice ? { outsideOffice: true } : {}),
      });
    }
    for (const [name, t] of Object.entries(v.nodes)) if (!nodes[name]) nodes[name] = { x: t.x, y: t.y + y0 };
  }
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y]![x]!;
      if (!legend[ch]) {
        failures.push({ code: 'legend_unknown', detail: `(${x},${y}) '${ch}'` });
        return { layout: null, failures };
      }
    }
  }
  const seat = spots[rules.playerSeatSpot];
  const playerStart = seat ? seat.tile : { x: Math.floor(W / 2), y: rows.length - 2 };
  return {
    layout: {
      id: `gen:${input.seed}`, seed: input.seed, width: W, height: rows.length, rows, legend, spots, zones,
      routeNodes: nodes, playerStart, exitZone: rules.exitZone, modules: placed, complexity: c,
    },
    failures,
  };
}
