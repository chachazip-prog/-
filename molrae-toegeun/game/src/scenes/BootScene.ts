import Phaser from 'phaser';
import { listTables } from '../data/loader';
import { SceneKey } from './keys';

/** 에셋 프리로드 자리. 현재는 데이터 테이블 확인 후 바로 타이틀로 이동 */
export class BootScene extends Phaser.Scene {
  constructor() { super(SceneKey.Boot); }

  preload(): void {
    // TODO: game/assets/ 에셋 확정 후 로드 (아트·사운드 산출물 대기)
  }

  create(): void {
    console.info(`[boot] data tables: ${listTables().join(', ') || '(없음)'}`);
    this.scene.start(SceneKey.Title);
  }
}
