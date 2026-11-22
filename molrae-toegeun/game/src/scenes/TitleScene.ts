import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { SceneKey } from './keys';
import { TEXT_STYLE } from './style';

export class TitleScene extends Phaser.Scene {
  constructor() { super(SceneKey.Title); }

  create(): void {
    const cx = LOGICAL_WIDTH / 2;
    this.cameras.main.setBackgroundColor('#3a3a44');
    this.add.text(cx, LOGICAL_HEIGHT * 0.35, '몰래퇴근', { ...TEXT_STYLE, fontSize: '20px' }).setOrigin(0.5);
    this.add.text(cx, LOGICAL_HEIGHT * 0.65, '탭해서 출근', TEXT_STYLE).setOrigin(0.5);
    this.input.once('pointerup', () => this.scene.start(SceneKey.Game));
  }
}
