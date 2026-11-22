import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { addPixelText, placeText } from '../ui/pixelText';
import { SceneKey } from './keys';

const TEXT_COLOR = 0xf0f0f0;

export class TitleScene extends Phaser.Scene {
  constructor() { super(SceneKey.Title); }

  create(): void {
    const cx = LOGICAL_WIDTH / 2;
    this.cameras.main.setBackgroundColor('#3a3a44');
    // 타이틀은 12px 폰트를 정수 2배로 (도트 유지)
    placeText(addPixelText(this, 0, 0, '몰래퇴근', { role: 'body', color: TEXT_COLOR, scale: 2 }), cx, LOGICAL_HEIGHT * 0.35, 0.5, 0.5);
    placeText(addPixelText(this, 0, 0, '탭해서 출근', { role: 'body', color: TEXT_COLOR }), cx, LOGICAL_HEIGHT * 0.65, 0.5, 0.5);
    this.input.once('pointerup', () => this.scene.start(SceneKey.Game));
  }
}
