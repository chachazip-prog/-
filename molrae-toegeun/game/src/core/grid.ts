/**
 * 그리드 맵 모델 (순수 TS, Phaser 무관).
 * 좌표 규약: 타일 (x, y)는 정수 인덱스. 연속 좌표에서 타일 (x, y)의 중심은 (x + 0.5, y + 0.5).
 * 타일 속성(통행·시야 차단·구역)은 레벨 데이터의 legend가 정한다. 코드에 타일 종류를 하드코딩하지 않는다.
 */
export interface Tile {
  readonly x: number;
  readonly y: number;
}

export interface Vec {
  x: number;
  y: number;
}

/** legend 한 글자의 의미 */
export interface LegendEntry {
  /** 렌더링·디버그용 종류 이름 (예: floor, wall, desk, partition) */
  readonly kind: string;
  readonly walkable: boolean;
  /** 시선을 가리는가 (엄폐물·벽) */
  readonly blocksSight: boolean;
  /** 구역 id (예: seat, pantry, exit) */
  readonly zone?: string;
  /** 엄폐물(칸막이·화분·복사기). 옆 칸에서 오래 서 있어도 위장 정체 가산 면제(rules.suspicion.disguiseStaleExemptNearCover) */
  readonly cover?: boolean;
  /** 플레이어는 게이트 태그 성공 시에만 통과 (X8). NPC는 자유 통과 */
  readonly gateOnly?: boolean;
  /** 안전 구역(화장실 칸). 시선 판정은 blocksSight로 처리되고, 표시·상태 판정용 */
  readonly safeZone?: boolean;
}

export interface GridMap {
  readonly width: number;
  readonly height: number;
  readonly kinds: readonly string[];
  readonly walkable: Uint8Array;
  readonly sight: Uint8Array;
  readonly zones: readonly (string | null)[];
  /** legend.cover */
  readonly cover: Uint8Array;
  /** legend.gateOnly */
  readonly gateOnly: Uint8Array;
  /** legend.safeZone */
  readonly safe: Uint8Array;
}

export function buildGridMap(rows: readonly string[], legend: Readonly<Record<string, LegendEntry>>): GridMap {
  const height = rows.length;
  if (height === 0) throw new Error('grid: 빈 맵');
  const width = rows[0]!.length;
  const n = width * height;
  const kinds: string[] = new Array<string>(n);
  const zones: (string | null)[] = new Array<string | null>(n);
  const walkable = new Uint8Array(n);
  const sight = new Uint8Array(n);
  const cover = new Uint8Array(n);
  const gateOnly = new Uint8Array(n);
  const safe = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    if (row.length !== width) throw new Error(`grid: ${y}행 길이 ${row.length} ≠ ${width}`);
    for (let x = 0; x < width; x++) {
      const ch = row[x]!;
      const e = legend[ch];
      if (!e) throw new Error(`grid: legend에 없는 문자 '${ch}' (${x},${y})`);
      const i = y * width + x;
      kinds[i] = e.kind;
      zones[i] = e.zone ?? null;
      walkable[i] = e.walkable ? 1 : 0;
      sight[i] = e.blocksSight ? 1 : 0;
      cover[i] = e.cover ? 1 : 0;
      gateOnly[i] = e.gateOnly ? 1 : 0;
      safe[i] = e.safeZone ? 1 : 0;
    }
  }
  return { width, height, kinds, walkable, sight, zones, cover, gateOnly, safe };
}

export function inBounds(map: GridMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function isWalkable(map: GridMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && map.walkable[y * map.width + x] === 1;
}

/** 맵 밖은 시야 차단으로 취급 */
export function blocksSight(map: GridMap, x: number, y: number): boolean {
  return !inBounds(map, x, y) || map.sight[y * map.width + x] === 1;
}

/** 상하좌우 이웃에 엄폐물(legend.cover)이 있는가 */
export function nearCover(map: GridMap, x: number, y: number): boolean {
  const at = (tx: number, ty: number) => inBounds(map, tx, ty) && map.cover[ty * map.width + tx] === 1;
  return at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1);
}

export function isSafeTile(map: GridMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && map.safe[y * map.width + x] === 1;
}

export function isGateOnly(map: GridMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && map.gateOnly[y * map.width + x] === 1;
}

export function zoneAt(map: GridMap, x: number, y: number): string | null {
  return inBounds(map, x, y) ? (map.zones[y * map.width + x] ?? null) : null;
}

export function kindAt(map: GridMap, x: number, y: number): string | null {
  return inBounds(map, x, y) ? (map.kinds[y * map.width + x] ?? null) : null;
}

/** 연속 좌표 → 그 점이 속한 타일 */
export function tileOf(p: Vec): Tile {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

export function tileCenter(t: Tile): Vec {
  return { x: t.x + 0.5, y: t.y + 0.5 };
}

/**
 * 통행 불가 타일을 탭했을 때 가장 가까운 통행 가능 타일 (맨해튼 링 순회, 결정적 순서).
 * maxRadius 안에 없으면 null.
 */
export function nearestWalkable(
  map: GridMap, x: number, y: number, maxRadius: number, blocked?: (x: number, y: number) => boolean,
): Tile | null {
  const ok = (tx: number, ty: number) => isWalkable(map, tx, ty) && !(blocked && blocked(tx, ty));
  if (ok(x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    let best: Tile | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const rem = r - Math.abs(dy);
      const cands = rem === 0 ? [0] : [-rem, rem];
      for (const dx of cands) {
        const tx = x + dx, ty = y + dy;
        if (!ok(tx, ty)) continue;
        const d = dx * dx + dy * dy; // 같은 링 안에서는 유클리드로 더 가까운 쪽
        if (d < bestD) { bestD = d; best = { x: tx, y: ty }; }
      }
    }
    if (best) return best;
  }
  return null;
}

export function tilesInZone(map: GridMap, zone: string): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) if (map.zones[y * map.width + x] === zone) out.push({ x, y });
  return out;
}
