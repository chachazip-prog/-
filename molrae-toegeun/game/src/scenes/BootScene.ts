import Phaser from 'phaser';
import sheetPngUrl from '../../assets/sprites/sheet.png?url';
import sheetJsonUrl from '../../assets/sprites/sheet.json?url';
import animsJsonUrl from '../../assets/sprites/anims.json?url';
import { listTables } from '../data/loader';
import { ATLAS_KEY } from '../render/sprites';
import { preloadBitmapFonts, registerBitmapFonts } from '../ui/bitmapFonts';
import { SceneKey } from './keys';

const ANIMS_KEY = 'sprite-anims';

/** 에셋 프리로드: 도트 폰트(T-126) + 스프라이트 아틀라스·애니메이션(아트 T-125/T-130 출력) */
export class BootScene extends Phaser.Scene {
  constructor() { super(SceneKey.Boot); }

  preload(): void {
    // 로드 실패는 치명적이지 않음: 폰트는 시스템 폰트로 폴백, 스프라이트가 없으면 씬이 사각형으로 대체
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[boot] 로드 실패: ${file.key} (${String(file.url)})`);
    });
    preloadBitmapFonts(this);
    this.load.atlas(ATLAS_KEY, sheetPngUrl, sheetJsonUrl);
    this.load.json(ANIMS_KEY, animsJsonUrl);
  }

  create(): void {
    registerBitmapFonts(this);
    const anims = this.cache.json.get(ANIMS_KEY) as Phaser.Types.Animations.JSONAnimations | undefined;
    if (anims && this.textures.exists(ATLAS_KEY)) this.anims.fromJSON(anims);
    console.info(`[boot] data tables: ${listTables().join(', ') || '(없음)'}`);
    this.scene.launch(SceneKey.Audio); // 상주(첫 터치 뒤 오디오 지연 로드)
    this.scene.start(SceneKey.Title);
  }
}
