import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { initialStanceState, reduceStance, type StanceInput, type StanceState } from '../core';
import { SceneKey } from './keys';
import { TEXT_STYLE } from './style';

const LABEL = { working: '일하는 척', slacking: '땡땡이 중' } as const;
const BG = { working: '#4a4a52', slacking: '#6a6a74' } as const;

/**
 * 회색 박스 게임 씬: 화면 홀드 = 땡땡이, 떼기 = 일하는 척.
 * 판정 상태는 core/stance.ts(순수 로직)가 소유하고, 씬은 입력 전달과 표시만 한다.
 */
export class GameScene extends Phaser.Scene {
  private state: StanceState = initialStanceState;
  private stanceText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private desk!: Phaser.GameObjects.Rectangle;

  constructor() { super(SceneKey.Game); }

  create(): void {
    this.state = initialStanceState;
    const cx = LOGICAL_WIDTH / 2;

    // 회색 박스: 책상 / 모니터
    this.desk = this.add.rectangle(cx, LOGICAL_HEIGHT * 0.7, 120, 16, 0x2c2c33);
    this.add.rectangle(cx, LOGICAL_HEIGHT * 0.58, 48, 32, 0x202028).setStrokeStyle(1, 0x8a8a96);

    this.stanceText = this.add.text(cx, LOGICAL_HEIGHT * 0.3, '', { ...TEXT_STYLE, fontSize: '16px' }).setOrigin(0.5);
    this.infoText = this.add.text(cx, LOGICAL_HEIGHT * 0.9, '', { ...TEXT_STYLE, fontSize: '10px', color: '#c8c8d0' }).setOrigin(0.5);

    this.input.on('pointerdown', () => this.dispatch({ type: 'press' }));
    this.input.on('pointerup', () => this.dispatch({ type: 'release' }));
    this.input.on('pointerupoutside', () => this.dispatch({ type: 'release' }));
    // 앱 전환·포커스 상실 시 안전하게 '일하는 척'으로 복귀
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur, this));

    this.render();
  }

  private onBlur(): void { this.dispatch({ type: 'release' }); }

  override update(_time: number, delta: number): void {
    this.state = reduceStance(this.state, { type: 'tick', dtMs: delta });
    this.infoText.setText(`누적 땡땡이 ${(this.state.totalSlackMs / 1000).toFixed(1)}초`);
  }

  private dispatch(input: StanceInput): void {
    const prev = this.state.stance;
    this.state = reduceStance(this.state, input);
    if (prev !== this.state.stance) this.render();
  }

  private render(): void {
    const s = this.state.stance;
    this.stanceText.setText(LABEL[s]);
    this.cameras.main.setBackgroundColor(BG[s]);
    this.desk.setFillStyle(s === 'slacking' ? 0x3a3a42 : 0x2c2c33);
  }
}
