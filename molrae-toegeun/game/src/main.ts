import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, integerZoomFor } from './config/display';
import { initPlatform } from './platform';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { TitleScene } from './scenes/TitleScene';

const PARENT_ID = 'game';

async function start(): Promise<void> {
  // 광고 단위 ID는 콘솔 발급 후 주입 (현재 비어 있음 → 토스 환경에서도 광고는 not_loaded)
  const platform = await initPlatform({});
  console.info(`[platform] ${platform.name}`);

  const parent = document.getElementById(PARENT_ID) ?? document.body;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    backgroundColor: '#1b1b22',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    disableContextMenu: true,
    input: { activePointers: 1 },
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      zoom: integerZoomFor(parent.clientWidth || window.innerWidth, parent.clientHeight || window.innerHeight),
    },
    scene: [BootScene, TitleScene, GameScene],
  });

  // 정수 배율 유지: 리사이즈(회전·주소창 변화) 시 배율 재계산
  const applyZoom = () => {
    const zoom = integerZoomFor(parent.clientWidth || window.innerWidth, parent.clientHeight || window.innerHeight);
    if (game.scale.zoom !== zoom) game.scale.setZoom(zoom);
  };
  window.addEventListener('resize', applyZoom);
}

void start();
