/**
 * 조작대 배치(T-170 control-dpad §2-2, art/style-guide §18). 순수 계산(Phaser 무관).
 * 논리 180×320, 오른손 기준 좌표를 쓰고 왼손은 좌우 거울(x → 180 − x). 판정 영역은 그림보다 크게(패드 72, 버튼 48, 칩 22).
 */
import { HUD_BOTTOM_PX, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';

export type Hand = 'right' | 'left';

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export interface DeckLayout {
  readonly hand: Hand;
  /** 조작대 윗변 y */
  readonly top: number;
  /** 조작대 배경 중심 */
  readonly bg: { readonly x: number; readonly y: number };
  readonly pad: { readonly cx: number; readonly cy: number; readonly hit: Rect };
  readonly action: { readonly cx: number; readonly cy: number; readonly hit: Rect; readonly labelY: number };
  /** 칩 중심(최대 4, 2×2) + 판정 22×22 */
  readonly chips: readonly { readonly cx: number; readonly cy: number; readonly hit: Rect }[];
  /** 상태줄(왼쪽 위 기준, 폭) */
  readonly status: { readonly x: number; readonly y: number; readonly w: number; readonly cx: number };
}

const PAD_HIT = 72, ACT_HIT = 48, CHIP_HIT = 22;

export function inRect(r: Rect, x: number, y: number): boolean { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

/** n = 칩 개수(4 초과면 2열 × 3줄로 줄임), lift = 세이프 에어리어로 올린 높이 */
export function deckLayout(hand: Hand, lift = 0, n = 4): DeckLayout {
  const m = (x: number) => (hand === 'right' ? x : LOGICAL_WIDTH - x);
  const mr = (x: number, w: number) => (hand === 'right' ? x : LOGICAL_WIDTH - x - w);
  const top = LOGICAL_HEIGHT - HUD_BOTTOM_PX - lift;
  const dy = top - (LOGICAL_HEIGHT - HUD_BOTTOM_PX); // 기준(248)에서 올린 만큼(음수)
  const padCx = m(141), padCy = 284 + dy;
  const actCx = m(74), actCy = 280 + dy;
  const rows = n > 4 ? 3 : 2;
  const pitch = rows === 3 ? 21 : 22;
  const chips: { cx: number; cy: number; hit: Rect }[] = [];
  for (let i = 0; i < Math.max(n, 1); i++) {
    const col = i % 2, row = Math.floor(i / 2);
    if (row >= rows) break;
    const x0 = 2 + col * 24, y0 = 252 + dy + row * pitch;
    chips.push({ cx: m(x0 + 11), cy: y0 + 11, hit: { x: mr(x0, CHIP_HIT), y: y0, w: CHIP_HIT, h: CHIP_HIT } });
  }
  const sy = rows === 3 ? 316 + dy : 300 + dy;
  return {
    hand, top,
    bg: { x: LOGICAL_WIDTH / 2, y: top + HUD_BOTTOM_PX / 2 },
    pad: { cx: padCx, cy: padCy, hit: { x: padCx - PAD_HIT / 2, y: padCy - PAD_HIT / 2, w: PAD_HIT, h: PAD_HIT } },
    action: { cx: actCx, cy: actCy, hit: { x: actCx - ACT_HIT / 2, y: actCy - ACT_HIT / 2, w: ACT_HIT, h: ACT_HIT }, labelY: 304 + dy },
    chips,
    status: { x: mr(2, 46), y: sy, w: 46, cx: m(25) },
  };
}
