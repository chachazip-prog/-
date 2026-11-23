import Phaser from 'phaser';
import { decodeCompactFont, type CompactBmFont2 } from './bmfontCompact';

/**
 * 한글 도트 비트맵 폰트 (T-126, D-042).
 * 원본: Galmuri11/9/7 2.40.3 (OFL 1.1). 변환물은 예약명 회피를 위해 mt-pixel-* 이름만 쓴다.
 * 파일: public/fonts/<key>.png(흰 글자, 틴트로 색 지정) + <key>.json(압축형 BMFont 정보 'bmfont-compact-2', scripts/build-fonts.ts 생성.
 *       좌표 없이 글리프 묶음만 저장하고 로더가 아틀라스 배치를 재현 — src/ui/bmfontCompact.ts)
 * 고지: public/licenses/OFL-galmuri.txt (빌드 산출물 dist/licenses/ 에 그대로 복사됨)
 */
export const FONT = {
  /** 12px: 대사·UI 본문 */
  body: 'mt-pixel-12',
  /** 10px: 라벨 */
  label: 'mt-pixel-10',
  /** 8px: 숫자·영문 전용 (한글 금지 — D-042) */
  num: 'mt-pixel-8',
} as const;
export type FontRole = keyof typeof FONT;

/** 폰트를 못 불렀을 때 시스템 폰트 폴백 크기(px) */
export const FALLBACK_PX: Readonly<Record<FontRole, number>> = { body: 12, label: 10, num: 8 };

const FONT_DIR = 'fonts/';
const dataKey = (key: string) => `${key}:bmfont`;

/** BootScene.preload 에서 호출. 상대 경로라 앱인토스 번들(base './')과 vite dev 모두 동작 */
export function preloadBitmapFonts(scene: Phaser.Scene): void {
  for (const key of Object.values(FONT)) {
    scene.load.image(key, `${FONT_DIR}${key}.png`);
    scene.load.json(dataKey(key), `${FONT_DIR}${key}.json`);
  }
}

/**
 * 로드된 PNG + JSON 을 bitmapFont 캐시에 등록. Phaser ParseXMLBitmapFont 와 같은 구조의 데이터를 만든다.
 * 실패한 키 목록을 돌려준다(그 키는 pixelText 가 시스템 폰트로 폴백).
 */
export function registerBitmapFonts(scene: Phaser.Scene): string[] {
  const failed: string[] = [];
  for (const key of Object.values(FONT)) {
    if (scene.cache.bitmapFont.exists(key)) continue;
    const json = scene.cache.json.get(dataKey(key)) as CompactBmFont2 | undefined;
    if (!json || json.format !== 'bmfont-compact-2' || !scene.textures.exists(key)) {
      failed.push(key);
      continue;
    }
    let glyphs;
    try { glyphs = decodeCompactFont(json); } catch (e) { console.warn(e); failed.push(key); continue; }
    const texture = scene.textures.get(key);
    const frame = texture.get();
    const tw = frame.source.width, th = frame.source.height;
    // xAdvance 는 Phaser 런타임이 쓰지만 3.90 타입 정의(BitmapFontCharacterData)에서 빠져 있어 교차 타입으로 보완
    const chars: Record<number, Phaser.Types.GameObjects.BitmapText.BitmapFontCharacterData & { xAdvance: number }> = {};
    for (const { cp: id, x, y, w, h, xo, yo, xa } of glyphs) {
      const u0 = x / tw, v0 = y / th, u1 = (x + w) / tw, v1 = (y + h) / th;
      chars[id] = {
        x, y, width: w, height: h,
        centerX: Math.floor(w / 2), centerY: Math.floor(h / 2),
        xOffset: xo, yOffset: yo, xAdvance: xa,
        data: {}, kerning: {}, u0, v0, u1, v1,
      };
      if (w > 0 && h > 0 && id <= 0xffff) {
        const f = texture.add(String.fromCharCode(id), frame.sourceIndex, x, y, w, h);
        if (f) f.setUVs(w, h, u0, v0, u1, v1);
      }
    }
    const data: Phaser.Types.GameObjects.BitmapText.BitmapFontData = {
      font: json.info.face, size: json.info.size, lineHeight: json.common.lineHeight, retroFont: false, chars,
    };
    scene.cache.bitmapFont.add(key, { data, texture: key, frame: null });
    scene.cache.json.remove(dataKey(key));
  }
  if (failed.length > 0) console.warn(`[fonts] 비트맵 폰트 로드 실패 → 시스템 폰트 폴백: ${failed.join(', ')}`);
  return failed;
}
