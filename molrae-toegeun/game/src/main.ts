import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, integerZoomFor, setDeckLiftPx } from './config/display';
import { loadControlHand } from './state/controlHand';
import { audio } from './audio/audio';
import { initPlatform } from './platform';
import { loadProgress } from './state/progress';
import { AudioScene } from './scenes/AudioScene';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { PrepScene } from './scenes/PrepScene';
import { CharSelectScene } from './scenes/CharSelectScene';
import { TitleScene } from './scenes/TitleScene';

const PARENT_ID = 'game';

async function start(): Promise<void> {
  // 광고 단위 ID는 콘솔 발급 후 주입 (현재 비어 있음 → 토스 환경에서도 광고는 not_loaded)
  const platform = await initPlatform({});
  console.info(`[platform] ${platform.name}`);

  const parent = document.getElementById(PARENT_ID) ?? document.body;
  // T-170 조작대 손잡이 설정(저장값) + 세이프 에어리어: 캔버스 아래 레터박스가 홈 표시줄보다 좁으면 그 차이만큼 조작대를 올림(control-dpad §8-4)
  await loadControlHand(platform.storage).catch(() => null);
  {
    const pw = parent.clientWidth || window.innerWidth, ph = parent.clientHeight || window.innerHeight;
    const z = integerZoomFor(pw, ph);
    const letterbox = Math.max(0, (ph - LOGICAL_HEIGHT * z) / 2);
    const inset = platform.safeAreaInsets().bottom;
    const lift = Math.ceil(Math.max(0, inset - letterbox) / z);
    setDeckLiftPx(new URLSearchParams(location.search).has('deckLift') ? Number(new URLSearchParams(location.search).get('deckLift')) || 0 : lift);
  }
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
    // T-170 멀티터치: 패드 1 + 행동 버튼 1(+여유 1). 포인터 이벤트 기반(click 300ms 지연 없음)
    input: { activePointers: 3 },
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      zoom: integerZoomFor(parent.clientWidth || window.innerWidth, parent.clientHeight || window.innerHeight),
    },
    scene: [BootScene, AudioScene, TitleScene, CharSelectScene, PrepScene, GameScene],
  });
  // 소리 설정(꺼도 시각 신호는 그대로, rules.visualCues.alwaysOn)
  void loadProgress(platform.storage).then((p) => audio.setMuted(!p.soundOn || new URLSearchParams(location.search).get('sound') === 'off'));

  // 정수 배율 유지: 리사이즈(회전·주소창 변화) 시 배율 재계산
  const applyZoom = () => {
    const zoom = integerZoomFor(parent.clientWidth || window.innerWidth, parent.clientHeight || window.innerHeight);
    if (game.scale.zoom !== zoom) game.scale.setZoom(zoom);
  };
  // 개발 빌드 전용: 자동화(스크린샷) 훅. 프로덕션 번들에서는 제거됨
  if (import.meta.env.DEV) (window as unknown as { __mtGame?: Phaser.Game }).__mtGame = game;
  window.addEventListener('resize', applyZoom);
}

void start();

// 진행 저장·전면광고(결과 → 다음 날)는 GameScene.finishDay → ads/adFlow.ts(AdFlow.afterGame)에서 처리한다(T-133).
