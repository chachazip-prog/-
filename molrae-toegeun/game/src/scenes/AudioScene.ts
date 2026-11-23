import Phaser from 'phaser';
import { audio } from '../audio/audio';
import { SceneKey } from './keys';

/**
 * 오디오 전용 상주 씬(화면 없음). 첫 터치 뒤에 오디오를 지연 로드하고, 매 프레임 BGM 보간을 돌린다.
 * 다른 씬이 바뀌어도 멈추지 않도록 Boot에서 launch만 하고 끄지 않는다.
 */
export class AudioScene extends Phaser.Scene {
  constructor() { super(SceneKey.Audio); }

  create(): void {
    audio.attach(this.game);
    const start = () => { window.removeEventListener('pointerdown', start, true); audio.load(this); };
    window.addEventListener('pointerdown', start, true);
  }

  override update(_t: number, delta: number): void { audio.update(Math.min(delta / 1000, 0.1)); }
}
