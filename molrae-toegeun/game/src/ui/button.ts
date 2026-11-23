/**
 * 화면 고정 버튼(라이트 모드). 씬이 pointerdown에서 contains()로 직접 판정한다(지도 탭과 섞이지 않게).
 * D-050 ②: 이어하기·거절 버튼은 같은 크기·같은 스타일로 만든다(style 인자를 같은 값으로 쓰면 됨).
 */
import Phaser from 'phaser';
import { color } from '../render/palette';
import { addPixelText, placeText, setPixelText, setWrap, textBox, type UIText } from './pixelText';

export interface ButtonOpts {
  readonly depth: number;
  /** 'primary' = 진한 테두리 2px, 'normal' = 1px. 거절 버튼과 광고 버튼은 같은 값을 써야 함 */
  readonly style?: 'primary' | 'normal';
  readonly role?: 'body' | 'label';
}

export class UiButton {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: UIText;
  enabled = true;
  constructor(scene: Phaser.Scene, readonly x: number, readonly y: number, readonly w: number, public h: number, text: string, opts: ButtonOpts) {
    const strokeW = opts.style === 'primary' ? 2 : 1;
    this.bg = scene.add.rectangle(x, y, w, h, 0xffffff, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(opts.depth).setStrokeStyle(strokeW, color('outline'));
    this.label = addPixelText(scene, 0, 0, '', { role: opts.role ?? 'body', color: color('outline'), align: 'center', lineSpacing: 2 }).setScrollFactor(0).setDepth(opts.depth + 1);
    setWrap(this.label, w - 8);
    this.setText(text);
  }

  setText(text: string): this {
    setPixelText(this.label, text);
    const b = textBox(this.label);
    if (b.h + 8 > this.h) { this.h = Math.ceil(b.h + 8); this.bg.setSize(this.w, this.h); }
    placeText(this.label, this.x + this.w / 2, this.y + this.h / 2, 0.5, 0.5);
    return this;
  }

  contains(px: number, py: number): boolean {
    return this.enabled && this.bg.visible && px >= this.x && px < this.x + this.w && py >= this.y && py < this.y + this.h;
  }

  setEnabled(on: boolean): this { this.enabled = on; this.bg.setAlpha(on ? 1 : 0.5); this.label.setAlpha(on ? 1 : 0.5); return this; }
  setVisible(v: boolean): this { this.bg.setVisible(v); this.label.setVisible(v); return this; }
  destroy(): void { this.bg.destroy(); this.label.destroy(); }
}
