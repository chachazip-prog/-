import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { getStrings } from '../content';
import { getPlatform } from '../platform';
import { color } from '../render/palette';
import { loadProgress } from '../state/progress';
import { addPixelText, placeText, setPixelText } from '../ui/pixelText';
import { SceneKey } from './keys';
import type { PrepSceneData } from './PrepScene';

export class TitleScene extends Phaser.Scene {
  private day = 1;

  constructor() { super(SceneKey.Title); }

  create(): void {
    const str = getStrings();
    const cx = LOGICAL_WIDTH / 2;
    this.cameras.main.setBackgroundColor(color('wall'));
    // 타이틀은 12px 폰트를 정수 2배로 (도트 유지)
    placeText(addPixelText(this, 0, 0, str.t('ui.title'), { role: 'body', color: color('outline'), scale: 2 }), cx, LOGICAL_HEIGHT * 0.35, 0.5, 0.5);
    const start = addPixelText(this, 0, 0, str.t('ui.tap_to_start'), { role: 'body', color: color('dark') });
    placeText(start, cx, LOGICAL_HEIGHT * 0.65, 0.5, 0.5);
    let forced = 0;
    try { forced = Number(new URLSearchParams(window.location.search).get('day')) || 0; } catch { /* noop */ }
    void loadProgress(getPlatform().storage).then((p) => {
      this.day = forced > 0 ? forced : p.unlockedDay;
      if (this.day > 1 && this.scene.isActive()) {
        setPixelText(start, str.t('ui.continue_day', { n: this.day }));
        placeText(start, cx, LOGICAL_HEIGHT * 0.65, 0.5, 0.5);
      }
    });
    this.input.once('pointerup', () => this.scene.start(SceneKey.Prep, { day: this.day } satisfies PrepSceneData));
  }
}
