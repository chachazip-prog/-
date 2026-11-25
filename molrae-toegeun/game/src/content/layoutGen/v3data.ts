/**
 * layout.json(schemaVersion 3, T-142) → 생성기 입력 (T-145). 순수 TS.
 * 스키마: design/data-schema-v3-draft.md §1. 모듈 spots의 tile 배열 → {x, y}, legendAdd를 원본 legend에 합침, '_' 키 무시.
 *
 * 시드 버전(D-085): versionTag = `g{generatorVersion}m{모듈·규칙 해시 8자}`. RNG 시드 문자열에 넣어
 * 생성기·모듈이 바뀌면(출시 뒤 업데이트) 맵이 바뀐다는 사실이 시드로 드러나고, 같은 버전이면 언제나 같은 맵이 나온다.
 */
import type { LegendEntry, Tile } from '../../core/grid';
import type { Dir } from '../../core/vision';
import { V3_PROSE_KEYS } from './proseKeys';

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const nums = (v: unknown): number[] => arr(v).filter((x): x is number => typeof x === 'number');
const pair = (v: unknown, d: readonly [number, number]): [number, number] => {
  const a = nums(v);
  return a.length >= 2 ? [a[0]!, a[1]!] : [d[0], d[1]];
};

export interface SpotV3 {
  readonly tile: Tile;
  readonly facing?: Dir;
  readonly type?: string;
  readonly target?: string;
  readonly lookDirs?: readonly Dir[];
  readonly glanceDir?: Dir;
  readonly stopId?: string;
  readonly floorMark?: boolean;
  readonly pose?: string;
}

export interface PortsV3 {
  readonly top?: readonly number[];
  readonly bottom?: readonly number[];
  readonly requiredTop: readonly number[];
  readonly requiredBottom: readonly number[];
  readonly doorCols: readonly number[];
  readonly doorOpenChance: readonly [number, number];
}

export interface ZoneV3 { readonly id: string; readonly nameKey: string; readonly rect: readonly [number, number, number, number]; readonly outsideOffice?: boolean; readonly facility?: string; readonly side?: string }
export interface ChokeV3 { readonly id: string; readonly tiles: readonly Tile[]; readonly bypass: string }

export interface ModuleV3 {
  readonly id: string;
  readonly group: string;
  readonly tags: readonly string[];
  readonly rows: readonly string[];
  readonly ports: PortsV3 | null;
  readonly mirrorable: boolean;
  readonly weightByComplexity: readonly [number, number];
  readonly minComplexity: number;
  readonly repeatable: boolean;
  readonly requiresGroup?: string;
  readonly provides: readonly string[];
  readonly spots: Readonly<Record<string, SpotV3>>;
  readonly routeNodes: Readonly<Record<string, Tile>>;
  readonly zones: readonly ZoneV3[];
  readonly chokepoints: readonly ChokeV3[];
  /** 좌우 반전된 사본인가 */
  readonly mirrored: boolean;
  /** T-151 성별 시설(genderFacility·spotAliases·zoneAliases, '{mine}' 치환 전) */
  readonly genderFacility?: { readonly type: string; readonly sides: Readonly<Record<string, Readonly<Record<string, string>>>> };
  readonly spotAliases?: Readonly<Record<string, string>>;
  readonly zoneAliases?: Readonly<Record<string, string>>;
}

export interface WildOpt { readonly ch: string; readonly weight: readonly [number, number] }

export interface SeamV3 {
  readonly wallChar: string;
  readonly openChars: readonly WildOpt[];
  readonly closedDoorPortChar: string;
  readonly openings: readonly [number, number];
  readonly openingsAtMax: readonly [number, number];
  readonly minGap: number;
  readonly spineCols: readonly number[];
  readonly spineBonus: readonly [number, number];
  readonly wideChance: readonly [number, number];
  readonly wideWidth: readonly [number, number];
  readonly top: { readonly openings: readonly [number, number]; readonly openingsAtMax: readonly [number, number]; readonly wideChance: readonly [number, number]; readonly wideWidth: readonly [number, number] };
}

export interface RankComplexityV3 {
  readonly rankId: string;
  readonly tier: number;
  readonly complexity: readonly [number, number];
  readonly optionalModules: readonly [number, number];
  readonly lowerModules: readonly [number, number];
  readonly aboveTeamMaxRows: number;
  readonly belowTeamMaxRows: number;
  readonly authoredOrder: boolean;
  readonly seatToGate: readonly [number, number];
  readonly maxUncoveredStraight: number;
}

export interface LayoutV3 {
  readonly enabled: boolean;
  readonly generatorVersion: number;
  /** D-085: 시드에 넣는 생성기·모듈 버전 */
  readonly versionTag: string;
  readonly authoredMapDays: number;
  readonly sourceMapId: string;
  readonly width: number;
  readonly maxHeight: number;
  readonly legendAdd: Readonly<Record<string, LegendEntry & O>>;
  readonly wildcards: Readonly<Record<string, readonly WildOpt[]>>;
  readonly seam: SeamV3;
  readonly modules: readonly ModuleV3[];
  readonly assembly: {
    readonly requiredGroups: readonly string[];
    readonly optionalPool: readonly string[];
    readonly belowTeamAllowedGroups: readonly string[];
    readonly restMeetBelowChance: readonly [number, number];
    readonly maxNonRequiredOptionalAboveTeam: number;
    readonly ceoOptional: number;
    readonly ceoLower: number;
    readonly missionRequiresProvides: Readonly<Record<string, string>>;
  };
  readonly repair: { readonly enabled: boolean; readonly maxOpenings: number; readonly protectFacilityTiles: boolean };
  readonly ranks: Readonly<Record<string, RankComplexityV3>>;
  readonly missionRefOneWayTiles: Readonly<Record<string, number>>;
  readonly maxAttempts: number;
  /** validators.list를 id로(수치 필드 그대로) */
  readonly validators: Readonly<Record<string, O>>;
  readonly patrolTemplates: O;
  readonly leadRoaming: O;
}

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const dirOf = (v: unknown): Dir | undefined => (DIRS.includes(v as Dir) ? v as Dir : undefined);
const tileOfArr = (v: unknown): Tile => { const a = nums(v); return { x: a[0] ?? 0, y: a[1] ?? 0 }; };

/** 사람용 메모 키·설명 문장 키 제거(런타임은 원래 읽지 않음. 빌드 제거와 같은 기준 → 해시 안정) */
function stripMemo(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripMemo);
  if (v && typeof v === 'object') {
    const o: O = {};
    for (const k of Object.keys(v as O).sort()) if (!k.startsWith('_') && !V3_PROSE_KEYS.includes(k)) o[k] = stripMemo((v as O)[k]);
    return o;
  }
  return v;
}

/** FNV-1a 32비트(버전 태그용, 결정적) */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function parseModule(m: O): ModuleV3 {
  const p = m['ports'];
  let ports: PortsV3 | null = null;
  if (p && typeof p === 'object') {
    const po = obj(p), req = obj(po['required']);
    ports = {
      ...(Array.isArray(po['top']) ? { top: nums(po['top']) } : {}),
      ...(Array.isArray(po['bottom']) ? { bottom: nums(po['bottom']) } : {}),
      requiredTop: nums(req['top']), requiredBottom: nums(req['bottom']),
      doorCols: nums(po['doorCols']), doorOpenChance: pair(po['doorOpenChance'], [0, 0]),
    };
  }
  const spots: Record<string, SpotV3> = {};
  for (const [k, v] of Object.entries(obj(m['spots']))) {
    const s = obj(v);
    const f = dirOf(s['facing']), g = dirOf(s['glanceDir']);
    const ld = arr(s['lookDirs']).map(dirOf).filter((d): d is Dir => !!d);
    spots[k] = {
      tile: tileOfArr(s['tile']),
      ...(f ? { facing: f } : {}), ...(g ? { glanceDir: g } : {}), ...(ld.length ? { lookDirs: ld } : {}),
      ...(typeof s['type'] === 'string' ? { type: s['type'] as string } : {}),
      ...(typeof s['target'] === 'string' ? { target: s['target'] as string } : {}),
      ...(typeof s['stopId'] === 'string' ? { stopId: s['stopId'] as string } : {}),
      ...(s['floorMark'] === true ? { floorMark: true } : {}),
      ...(typeof s['pose'] === 'string' ? { pose: s['pose'] as string } : {}),
    };
  }
  const nodes: Record<string, Tile> = {};
  for (const [k, v] of Object.entries(obj(m['routeNodes']))) nodes[k] = tileOfArr(v);
  return {
    id: str(m['id']), group: str(m['group']), tags: arr(m['tags']).map((x) => str(x)), rows: arr(m['rows']).map((r) => str(r)),
    ports, mirrorable: m['mirrorable'] === true,
    weightByComplexity: pair(m['weightByComplexity'], [1, 1]), minComplexity: num(m['minComplexity'], 0),
    repeatable: m['repeatable'] === true,
    ...(typeof m['requiresGroup'] === 'string' ? { requiresGroup: m['requiresGroup'] as string } : {}),
    provides: arr(m['provides']).map((x) => str(x)), spots, routeNodes: nodes,
    zones: arr(m['zones']).map(obj).map((z) => ({
      id: str(z['id']), nameKey: str(z['nameKey'], `zone.${str(z['id'])}`),
      rect: pair4(z['rect']), ...(z['outsideOffice'] === true ? { outsideOffice: true } : {}),
      ...(typeof z['facility'] === 'string' ? { facility: z['facility'] as string } : {}), ...(typeof z['side'] === 'string' ? { side: z['side'] as string } : {}),
    })),
    chokepoints: arr(m['chokepoints']).map(obj).map((c) => ({ id: str(c['id']), tiles: arr(c['tiles']).map(tileOfArr), bypass: str(c['bypass']) })),
    mirrored: false,
    ...(m['genderFacility'] ? { genderFacility: {
      type: str(obj(m['genderFacility'])['type']),
      sides: Object.fromEntries(Object.entries(obj(obj(m['genderFacility'])['sides'])).map(([k, v]) => [k, Object.fromEntries(Object.entries(obj(v)).filter(([kk]) => !kk.startsWith('_')).map(([kk, vv]) => [kk, str(vv)]))])),
    } } : {}),
    ...(m['spotAliases'] ? { spotAliases: strMap(m['spotAliases']) } : {}),
    ...(m['zoneAliases'] ? { zoneAliases: strMap(m['zoneAliases']) } : {}),
  };
}
function strMap(v: unknown): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, x] of Object.entries(obj(v))) if (!k.startsWith('_') && typeof x === 'string') o[k] = x;
  return o;
}
function pair4(v: unknown): [number, number, number, number] {
  const a = nums(v);
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0];
}

const wildOpts = (v: unknown): WildOpt[] => arr(v).map(obj).map((o) => ({ ch: str(o['ch'], '.'), weight: pair(o['weight'], [1, 1]) }));

const cache = new WeakMap<object, LayoutV3 | null>();

/** layout.json을 읽는다. schemaVersion 3이 아니거나 모듈이 없으면 null(호출 측은 수작업 맵) */
export function parseLayoutV3(tables: Readonly<Record<string, unknown>>): LayoutV3 | null {
  const raw = tables['layout'];
  if (!raw || typeof raw !== 'object') return null;
  if (cache.has(raw)) return cache.get(raw) ?? null;
  const L = obj(raw);
  if (L['schemaVersion'] !== 3 || arr(L['modules']).length === 0) { cache.set(raw, null); return null; }
  const grid = obj(L['grid']);
  const seam = obj(L['seam']);
  const wide = obj(seam['wideOpening']);
  const top = obj(seam['topSeamOverride']);
  const topWide = obj(top['wideOpening']);
  const asm = obj(L['assembly']);
  const ceo = obj(asm['ceoDay']);
  const legendAdd: Record<string, LegendEntry & O> = {};
  for (const [ch, e] of Object.entries(obj(L['legendAdd']))) legendAdd[ch] = stripMemo(e) as LegendEntry & O;
  const wildcards: Record<string, WildOpt[]> = {};
  for (const [ch, v] of Object.entries(obj(L['wildcards']))) if (!ch.startsWith('_')) wildcards[ch] = wildOpts(v);
  const ranks: Record<string, RankComplexityV3> = {};
  for (const r of arr(L['complexityByRank']).map(obj)) {
    const hard = obj(r['hard']);
    ranks[str(r['rankId'])] = {
      rankId: str(r['rankId']), tier: num(r['tier'], 0), complexity: pair(r['complexity'], [0, 0]),
      optionalModules: pair(r['optionalModules'], [0, 0]), lowerModules: pair(r['lowerModules'], [0, 0]),
      aboveTeamMaxRows: num(r['aboveTeamMaxRows'], 22), belowTeamMaxRows: num(r['belowTeamMaxRows'], 0),
      authoredOrder: r['orderPolicy'] === 'authored_order',
      seatToGate: pair(hard['seatToGateTiles'], [0, 99]), maxUncoveredStraight: num(hard['maxUncoveredStraightTiles'], 99),
    };
  }
  const validators: Record<string, O> = {};
  for (const v of arr(obj(L['validators'])['list']).map(obj)) validators[str(v['id'])] = v;
  const mrp: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(asm['missionRequiresProvides']))) if (typeof v === 'string') mrp[k] = v;
  const ref: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(L['missionRefOneWayTiles']))) if (typeof v === 'number') ref[k] = v;
  const gv = num(L['generatorVersion'], 1);
  // 버전 태그: 생성에 영향을 주는 입력(모듈·legend·와일드카드·이음 행·조립·수리·복잡도·검증 수치) 해시
  const hashSrc = JSON.stringify(stripMemo({
    m: L['modules'], l: L['legendAdd'], w: L['wildcards'], s: L['seam'], a: L['assembly'], r: L['repair'],
    c: L['complexityByRank'], v: L['validators'], ref: L['missionRefOneWayTiles'], g: L['grid'],
  }));
  const out: LayoutV3 = {
    enabled: L['enabled'] === true, generatorVersion: gv, versionTag: `g${gv}m${fnv1a(hashSrc)}`,
    authoredMapDays: num(L['authoredMapDays'], 2), sourceMapId: str(L['sourceMapId'], 'office_floor_1'),
    width: num(grid['width'], 11), maxHeight: num(grid['maxHeight'], 64),
    legendAdd, wildcards,
    seam: {
      wallChar: str(seam['wallChar'], '#'), openChars: wildOpts(seam['openChars']), closedDoorPortChar: str(seam['closedDoorPortChar'], 'Y'),
      openings: pair(seam['openings'], [1, 2]), openingsAtMax: pair(seam['openingsAtMax'], pair(seam['openings'], [1, 2])),
      minGap: num(seam['minGapBetweenOpenings'], 2), spineCols: nums(seam['spineCols']), spineBonus: pair(seam['spineBonus'], [0, 0]),
      wideChance: pair(wide['chance'], [0, 0]), wideWidth: pair(wide['width'], [1, 1]),
      top: {
        openings: pair(top['openings'], pair(seam['openings'], [1, 2])),
        openingsAtMax: pair(top['openingsAtMax'], pair(seam['openingsAtMax'], [1, 2])),
        wideChance: pair(topWide['chance'], pair(wide['chance'], [0, 0])), wideWidth: pair(topWide['width'], pair(wide['width'], [1, 1])),
      },
    },
    modules: arr(L['modules']).map(obj).map(parseModule),
    assembly: {
      requiredGroups: arr(asm['requiredGroups']).map((x) => str(x)), optionalPool: arr(asm['optionalPool']).map((x) => str(x)),
      belowTeamAllowedGroups: arr(asm['belowTeamAllowedGroups']).map((x) => str(x)),
      restMeetBelowChance: pair(asm['restMeetBelowChance'], [0, 0]),
      maxNonRequiredOptionalAboveTeam: num(asm['maxNonRequiredOptionalAboveTeam'], 1),
      ceoOptional: num(ceo['optionalModules'], 0), ceoLower: num(ceo['lowerModules'], 0), missionRequiresProvides: mrp,
    },
    repair: { enabled: obj(L['repair'])['enabled'] !== false, maxOpenings: num(obj(L['repair'])['maxOpenings'], 3), protectFacilityTiles: obj(L['repair'])['protectFacilityTiles'] === true },
    ranks, missionRefOneWayTiles: ref, maxAttempts: num(obj(L['validators'])['maxAttempts'], 24), validators,
    patrolTemplates: obj(L['patrolTemplates']), leadRoaming: obj(L['leadRoaming']),
  };
  cache.set(raw, out);
  return out;
}

/** complexityFormula: t = (day − 시작) / (끝 − 시작), 인턴은 (day − 3) / 2, 엔드리스 t = 0 */
export function v3RankT(rankId: string, day: number, dayRange: readonly [number, number | null]): number {
  if (rankId === 'intern') return Math.max(0, Math.min(1, (day - 3) / 2));
  const [a, b] = dayRange;
  if (b === null || b <= a) return 0;
  return Math.max(0, Math.min(1, (day - a) / (b - a)));
}

export function mirrorModule(m: ModuleV3, W: number): ModuleV3 {
  const mx = (x: number) => W - 1 - x;
  const sw = (d: Dir | undefined): Dir | undefined => (d === 'left' ? 'right' : d === 'right' ? 'left' : d);
  const spots: Record<string, SpotV3> = {};
  for (const [k, s] of Object.entries(m.spots)) {
    const f = sw(s.facing), g = sw(s.glanceDir);
    const { facing: _f, glanceDir: _g, lookDirs: _l, ...rest } = s;
    spots[k] = {
      ...rest, tile: { x: mx(s.tile.x), y: s.tile.y },
      ...(f ? { facing: f } : {}), ...(g ? { glanceDir: g } : {}),
      ...(s.lookDirs ? { lookDirs: s.lookDirs.map((d) => sw(d)!) } : {}),
    };
  }
  const nodes: Record<string, Tile> = {};
  for (const [k, t] of Object.entries(m.routeNodes)) nodes[k] = { x: mx(t.x), y: t.y };
  const mp = (a: readonly number[] | undefined) => a?.map(mx);
  return {
    ...m, rows: m.rows.map((r) => [...r].reverse().join('')), mirrored: !m.mirrored, spots, routeNodes: nodes,
    ports: m.ports ? {
      ...(m.ports.top ? { top: mp(m.ports.top)! } : {}), ...(m.ports.bottom ? { bottom: mp(m.ports.bottom)! } : {}),
      requiredTop: mp(m.ports.requiredTop)!, requiredBottom: mp(m.ports.requiredBottom)!, doorCols: mp(m.ports.doorCols)!,
      doorOpenChance: m.ports.doorOpenChance,
    } : null,
    zones: m.zones.map((z) => ({ ...z, rect: [W - z.rect[0] - z.rect[2], z.rect[1], z.rect[2], z.rect[3]] as const })),
    chokepoints: m.chokepoints.map((c) => ({ ...c, tiles: c.tiles.map((t) => ({ x: mx(t.x), y: t.y })) })),
  };
}
