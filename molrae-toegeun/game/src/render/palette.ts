/**
 * 팔레트·오버레이 (art/palette.json 기준, D-025). 색은 여기서만 읽는다.
 * overlay: 코드로 그리는 반투명 오버레이(시선 콘·그림자·테두리 등). base = 팔레트 역할 이름.
 */
import paletteJson from '../../../art/palette.json';

export interface Overlay {
  readonly color: number;
  readonly alpha: number;
  readonly edgeAlpha: number;
  readonly pulse?: readonly [number, number];
  readonly periodSec?: number;
  readonly widthPx?: number;
  readonly dash?: readonly [number, number];
}

type RawOverlay = { base?: string; alpha?: number; edge_alpha?: number; pulse?: number[]; period_sec?: number; width_px?: number; dash?: number[] };
const raw = paletteJson as unknown as { colors: Record<string, string>; overlay: Record<string, RawOverlay | string> };

const hex = (s: string | undefined, d = 0xff00ff): number => (s ? parseInt(s.replace('#', ''), 16) : d);

export const PAL: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(raw.colors).map(([k, v]) => [k, hex(v)]));

export function color(role: string): number { return PAL[role] ?? 0xff00ff; }

export function overlay(key: string): Overlay {
  const o = raw.overlay[key];
  if (!o || typeof o === 'string') return { color: 0xff00ff, alpha: 0.2, edgeAlpha: 0.5 };
  const p = o.pulse && o.pulse.length === 2 ? [o.pulse[0]!, o.pulse[1]!] as const : undefined;
  const d = o.dash && o.dash.length === 2 ? [o.dash[0]!, o.dash[1]!] as const : undefined;
  return {
    color: color(o.base ?? 'point'), alpha: o.alpha ?? 0.2, edgeAlpha: o.edge_alpha ?? 0.5,
    ...(p ? { pulse: p } : {}), ...(o.period_sec !== undefined ? { periodSec: o.period_sec } : {}),
    ...(o.width_px !== undefined ? { widthPx: o.width_px } : {}), ...(d ? { dash: d } : {}),
  };
}

/** 맥동 불투명도: pulse 범위를 period로 왕복 */
export function pulseAlpha(o: Overlay, t: number): number {
  if (!o.pulse || !o.periodSec) return o.alpha;
  const ph = (t % o.periodSec) / o.periodSec;
  const k = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
  return o.pulse[0] + (o.pulse[1] - o.pulse[0]) * k;
}
