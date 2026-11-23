import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, integerZoomFor } from './config/display';
import { decideInterstitial, onGameFinished, parseInterstitialRules } from './ads/interstitialPolicy';
import { getAdsTable } from './content';
import type { DayResult } from './core';
import { initPlatform, type Platform } from './platform';
import { applyDayResult, loadAdCounters, loadProgress, saveAdCounters, saveProgress } from './state/progress';
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

  game.events.on('mt-day-finished', (e: { day: number; result: DayResult | null }) => { void onDayFinished(platform, e); });

  // 정수 배율 유지: 리사이즈(회전·주소창 변화) 시 배율 재계산
  const applyZoom = () => {
    const zoom = integerZoomFor(parent.clientWidth || window.innerWidth, parent.clientHeight || window.innerHeight);
    if (game.scale.zoom !== zoom) game.scale.setZoom(zoom);
  };
  window.addEventListener('resize', applyZoom);
}

void start();

/**
 * 결과 화면 → 다음 날 전환 시점(ads.json interstitial.placement 'result_to_next_day').
 * 진행 저장 + 전면광고 빈도 판정(D-048). 실제 광고 예고 UI·노출은 다음 작업 → 지금은 판정 결과만 기록.
 * 광고 미지원 환경(isSupported false)에서는 판정하지 않음.
 */
async function onDayFinished(platform: Platform, e: { day: number; result: DayResult | null }): Promise<void> {
  const now = Date.now();
  const prog = await loadProgress(platform.storage);
  if (e.result) await saveProgress(platform.storage, applyDayResult(prog, e.day, e.result.stars));
  const counters = onGameFinished(await loadAdCounters(platform.storage, now), now);
  if (platform.ads.isSupported()) {
    const rules = parseInterstitialRules(getAdsTable());
    const d = decideInterstitial(rules, counters, now, { iapRemoveAds: false, duringPlay: false, rewardedWatchedThisGame: false });
    console.info(`[ads] 전면광고 판정: ${d.show ? '노출 대상' : `건너뜀(${d.reason})`}`);
    // TODO(다음 작업): d.show면 noticeKey 예고(noticeSec) 후 platform.ads.show('interstitial'), 성공 시 onInterstitialShown
  }
  await saveAdCounters(platform.storage, counters);
}
