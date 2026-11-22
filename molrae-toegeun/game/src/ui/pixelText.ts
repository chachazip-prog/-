import Phaser from 'phaser';
import { FALLBACK_PX, FONT, type FontRole } from './bitmapFonts';

/**
 * 도트 폰트 텍스트 헬퍼 (T-126).
 * - 기본은 BitmapText(mt-pixel-*). 글리프는 흰색이고 색은 틴트로 준다.
 * - 폴백: 비트맵 폰트가 캐시에 없거나, Canvas 렌더러인데 흰색이 아닌 색을 써야 할 때
 *   (Phaser 3.90 Canvas BitmapText 는 틴트 미지원) 시스템 폰트 Text 로 그린다.
 * - 위치는 항상 원점(0,0) + 정수 좌표로 직접 맞춘다(placeText). 홀수 폭 텍스트를 origin 0.5 로 두면
 *   반 픽셀 위치가 생겨 최근접 샘플링에서 글자 열이 깨질 수 있기 때문.
 */
export type UIText = Phaser.GameObjects.BitmapText | Phaser.GameObjects.Text;

export interface PixelTextOptions {
  role?: FontRole;
  /** 0xRRGGBB */
  color?: number;
  align?: 'left' | 'center' | 'right';
  /** 정수 배율만 (1, 2, 3 …) */
  scale?: number;
  /** 줄 간격 추가 px (여러 줄 텍스트) */
  lineSpacing?: number;
}

const WHITE = 0xffffff;

function hexColor(c: number): string { return `#${c.toString(16).padStart(6, '0')}`; }

function useBitmap(scene: Phaser.Scene, key: string, color: number): boolean {
  if (!scene.cache.bitmapFont.exists(key)) return false;
  if (scene.sys.game.renderer.type === Phaser.CANVAS && color !== WHITE) return false;
  return true;
}

/** 개발 빌드: 폰트에 없는 글자를 쓰면 경고 (BitmapText 는 없는 글자를 조용히 건너뜀) */
function checkGlyphs(t: UIText, text: string): void {
  if (!import.meta.env.DEV || !(t instanceof Phaser.GameObjects.BitmapText)) return;
  const chars = t.fontData.chars as Record<number, unknown>;
  const missing = [...new Set(Array.from(text).filter((c) => c !== '\n' && chars[c.codePointAt(0)!] === undefined))];
  if (missing.length > 0) {
    console.warn(`[fonts] ${t.font}에 없는 글자: ${missing.join(' ')} — "${text}" (scripts/build-fonts.ts 재실행 또는 다른 크기 사용)`);
  }
}

export function addPixelText(scene: Phaser.Scene, x: number, y: number, text: string, opts: PixelTextOptions = {}): UIText {
  const role = opts.role ?? 'body';
  const color = opts.color ?? WHITE;
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const align = opts.align ?? 'left';
  const key = FONT[role];
  let t: UIText;
  if (useBitmap(scene, key, color)) {
    const b = scene.add.bitmapText(0, 0, key, '', undefined, align === 'center' ? 1 : align === 'right' ? 2 : 0);
    b.setScale(scale).setTint(color);
    if (opts.lineSpacing) b.setLineSpacing(opts.lineSpacing);
    t = b;
  } else {
    t = scene.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: `${FALLBACK_PX[role] * scale}px`, color: hexColor(color), align,
      padding: { top: 2, bottom: 1 }, lineSpacing: opts.lineSpacing ?? 0,
    });
  }
  t.setOrigin(0, 0);
  setPixelText(t, text);
  t.setPosition(Math.round(x), Math.round(y));
  return t;
}

export function setPixelText(t: UIText, text: string): UIText {
  if (t.text !== text) {
    checkGlyphs(t, text);
    t.setText(text);
  }
  return t;
}

/** 글자 잉크 영역(월드 좌표, 배율 포함). BitmapText 는 실제 글리프 범위, Text 는 캔버스 크기 */
export function textBox(t: UIText): { x: number; y: number; w: number; h: number } {
  if (t instanceof Phaser.GameObjects.BitmapText) {
    // round=true 로 매번 재계산: Phaser 는 bounds 를 텍스트 변경 시에만 무효화해서 위치가 바뀌면 global 이 낡은 값이 됨.
    // 글리프·배율·좌표가 모두 정수라 올림(ceil)은 값에 영향 없음
    const g = t.getTextBounds(true).global;
    return { x: g.x, y: g.y, w: g.width, h: g.height };
  }
  return { x: t.x, y: t.y, w: t.displayWidth, h: t.displayHeight };
}

/** 잉크 영역을 앵커(ox, oy: 0~1) 기준으로 (x, y)에 정수 픽셀 배치. 텍스트 내용이 바뀌면 다시 호출 */
export function placeText(t: UIText, x: number, y: number, ox = 0, oy = 0): UIText {
  const b = textBox(t);
  const dx = b.x - t.x, dy = b.y - t.y;
  return t.setPosition(Math.round(x - b.w * ox) - Math.round(dx), Math.round(y - b.h * oy) - Math.round(dy));
}

/** 텍스트 뒤 배경 사각형을 잉크 영역 + 여백에 맞춘다 (BitmapText 는 배경색 옵션이 없음) */
export function fitPanel(panel: Phaser.GameObjects.Rectangle, t: UIText, padX: number, padY: number): void {
  const b = textBox(t);
  panel.setOrigin(0, 0)
    .setPosition(Math.round(b.x) - padX, Math.round(b.y) - padY)
    .setSize(Math.ceil(b.w) + padX * 2, Math.ceil(b.h) + padY * 2)
    .setVisible(t.visible);
}
