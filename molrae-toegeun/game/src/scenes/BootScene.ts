import Phaser from 'phaser';
import { listTables } from '../data/loader';
import { preloadBitmapFonts, registerBitmapFonts } from '../ui/bitmapFonts';
import { SceneKey } from './keys';

/** 에셋 프리로드. 현재는 도트 폰트(T-126)만 로드하고 데이터 테이블 확인 후 타이틀로 이동 */
export class BootScene extends Phaser.Scene {
  constructor() { super(SceneKey.Boot); }

  preload(): void {
    // 로드 실패는 치명적이지 않음: registerBitmapFonts 가 실패 키를 돌려주고 텍스트는 시스템 폰트로 폴백
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[boot] 로드 실패: ${file.key} (${String(file.url)})`);
    });
    preloadBitmapFonts(this);
    // TODO: game/assets/ 에셋 확정 후 로드 (아트·사운드 산출물 대기)
  }

  create(): void {
    registerBitmapFonts(this);
    console.info(`[boot] data tables: ${listTables().join(', ') || '(없음)'}`);
    this.scene.start(SceneKey.Title);
  }
}
