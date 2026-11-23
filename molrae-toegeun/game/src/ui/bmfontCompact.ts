/**
 * 비트맵 폰트 정보 압축 형식 'bmfont-compact-2' (순수 TS — 빌드 스크립트와 런타임이 같이 씀).
 *
 * compact-1은 글자마다 [id, x, y, w, h, xoffset, yoffset, xadvance]를 저장해 2,400자에 약 70KB였다.
 * 아틀라스 배치는 결정적인 선반(shelf) 패킹이므로 좌표는 저장하지 않고 로더가 같은 순서로 다시 배치한다.
 * 글리프는 (w, h, xoffset, yoffset, xadvance)가 같은 것끼리 묶고, 묶음 안의 코드포인트는 차분으로 저장한다.
 *
 * 패킹 규칙(scripts/build-fonts.ts pack()과 반드시 같아야 함 — 빌드 때 왕복 검증):
 *   정렬 = 높이 내림차순 → 너비 내림차순 → 코드포인트 오름차순. 빈 글리프(w 또는 h = 0)는 (0, 0).
 *   x = pad, y = pad에서 시작, x + w + pad > atlasW면 다음 줄(y += 줄 높이 + pad).
 */
export interface CompactGlyph {
  readonly cp: number;
  readonly w: number;
  readonly h: number;
  readonly xo: number;
  readonly yo: number;
  readonly xa: number;
}

export interface PlacedGlyph extends CompactGlyph {
  readonly x: number;
  readonly y: number;
}

export interface CompactBmFont2 {
  readonly format: 'bmfont-compact-2';
  readonly notice?: string;
  readonly info: { readonly face: string; readonly size: number };
  readonly common: { readonly lineHeight: number; readonly base: number; readonly scaleW: number; readonly scaleH: number };
  readonly page?: string;
  readonly pad: number;
  /** [w, h, xoffset, yoffset, xadvance, 코드포인트 차분...] (첫 차분은 0 기준) */
  readonly classes: readonly (readonly number[])[];
}

export function packOrder(glyphs: readonly CompactGlyph[]): CompactGlyph[] {
  return [...glyphs].sort((a, b) => b.h - a.h || b.w - a.w || a.cp - b.cp);
}

/** 선반 패킹(atlasW 고정). 넘치면 null */
export function shelfPack(glyphs: readonly CompactGlyph[], atlasW: number, atlasH: number, pad: number): PlacedGlyph[] | null {
  const out: PlacedGlyph[] = [];
  let x = pad, y = pad, rowH = 0;
  for (const g of packOrder(glyphs)) {
    if (g.w === 0 || g.h === 0) { out.push({ ...g, x: 0, y: 0 }); continue; }
    if (x + g.w + pad > atlasW) { x = pad; y += rowH + pad; rowH = 0; }
    if (y + g.h + pad > atlasH) return null;
    out.push({ ...g, x, y });
    x += g.w + pad;
    rowH = Math.max(rowH, g.h);
  }
  return out;
}

export function encodeClasses(glyphs: readonly CompactGlyph[]): number[][] {
  const byKey = new Map<string, { head: number[]; cps: number[] }>();
  for (const g of glyphs) {
    const head = [g.w, g.h, g.xo, g.yo, g.xa];
    const k = head.join(',');
    let c = byKey.get(k);
    if (!c) { c = { head, cps: [] }; byKey.set(k, c); }
    c.cps.push(g.cp);
  }
  const out: number[][] = [];
  for (const { head, cps } of byKey.values()) {
    cps.sort((a, b) => a - b);
    let prev = 0;
    const deltas = cps.map((cp) => { const d = cp - prev; prev = cp; return d; });
    out.push([...head, ...deltas]);
  }
  return out;
}

export function decodeClasses(classes: readonly (readonly number[])[]): CompactGlyph[] {
  const out: CompactGlyph[] = [];
  for (const c of classes) {
    const [w = 0, h = 0, xo = 0, yo = 0, xa = 0] = c;
    let cp = 0;
    for (let i = 5; i < c.length; i++) {
      cp += c[i]!;
      out.push({ cp, w, h, xo, yo, xa });
    }
  }
  return out;
}

/** compact-2 → 배치된 글리프(코드포인트 오름차순). 아틀라스에 안 맞으면 예외 */
export function decodeCompactFont(f: CompactBmFont2): PlacedGlyph[] {
  const placed = shelfPack(decodeClasses(f.classes), f.common.scaleW, f.common.scaleH, f.pad);
  if (!placed) throw new Error(`${f.info.face}: 글리프 배치가 아틀라스 ${f.common.scaleW}×${f.common.scaleH}를 넘음`);
  return placed.sort((a, b) => a.cp - b.cp);
}
