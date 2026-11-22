/**
 * @apps-in-toss/web-framework 3.10.0 어댑터.
 * API 시그니처 출처: npm 패키지 dist/index.d.ts (상세: game/docs/platform-integration.md)
 * 이 모듈은 platform/index.ts에서 동적 import로만 불러와 mock 환경 번들 진입 경로에서 분리한다.
 */
import { Game, Share, Storage, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import type { AdKind, AdResult, AdUnitConfig, AdsAdapter, LeaderboardAdapter, LeaderboardSubmitResult, Platform, ShareAdapter, StorageAdapter } from './types';

class TossStorage implements StorageAdapter {
  getItem(key: string) { return Storage.getItem(key); }
  setItem(key: string, value: string) { return Storage.setItem(key, value); }
  removeItem(key: string) { return Storage.removeItem(key); }
}

/**
 * 전면·보상형 모두 loadFullScreenAd/showFullScreenAd(adGroupId)로 처리.
 * 보상 지급 판단은 show 이벤트 'userEarnedReward' 수신 여부로 한다.
 * (추측: 타입 정의상 같은 API에 보상 이벤트가 포함되어 있어 그렇게 해석. 공식 문서로 재확인 필요)
 */
class TossAds implements AdsAdapter {
  private loaded = new Set<AdKind>();
  constructor(private readonly units: AdUnitConfig) {}

  isSupported() {
    try { return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported(); } catch { return false; }
  }
  isLoaded(kind: AdKind) { return this.loaded.has(kind); }

  preload(kind: AdKind): Promise<boolean> {
    const adGroupId = this.units[kind];
    if (!adGroupId || !this.isSupported()) return Promise.resolve(false);
    return new Promise((resolve) => {
      let unsubscribe: (() => void) | undefined;
      unsubscribe = loadFullScreenAd({
        options: { adGroupId },
        onEvent: (e) => {
          if (e.type === 'loaded') { this.loaded.add(kind); unsubscribe?.(); resolve(true); }
        },
        onError: () => { unsubscribe?.(); resolve(false); },
      });
    });
  }

  show(kind: AdKind): Promise<AdResult> {
    const adGroupId = this.units[kind];
    if (!this.isSupported()) return Promise.resolve({ status: 'unsupported' });
    if (!adGroupId || !this.loaded.has(kind)) return Promise.resolve({ status: 'not_loaded' });
    this.loaded.delete(kind);
    return new Promise((resolve) => {
      let reward: { unitType: string; unitAmount: number } | undefined;
      let unsubscribe: (() => void) | undefined;
      const done = (r: AdResult) => { unsubscribe?.(); resolve(r); };
      unsubscribe = showFullScreenAd({
        options: { adGroupId },
        onEvent: (e) => {
          if (e.type === 'userEarnedReward') reward = e.data;
          else if (e.type === 'failedToShow') done({ status: 'failed', reason: 'failedToShow' });
          else if (e.type === 'dismissed') {
            if (kind === 'rewarded') done(reward ? { status: 'rewarded', ...reward } : { status: 'dismissed_without_reward' });
            else done({ status: 'shown' });
          }
        },
        onError: (err) => done({ status: 'failed', reason: err instanceof Error ? err.message : String(err) }),
      });
    });
  }
}

class TossLeaderboard implements LeaderboardAdapter {
  isSupported() {
    try { return Game.setLeaderboardScore.isSupported(); } catch { return false; }
  }
  async submitScore(score: number): Promise<LeaderboardSubmitResult> {
    if (!this.isSupported()) return 'unsupported';
    try {
      // SDK 요구: 실수형 숫자의 문자열
      const res = await Game.setLeaderboardScore({ score: String(score) });
      if (!res) return 'unsupported'; // 토스앱 최소 버전 미만
      switch (res.statusCode) {
        case 'SUCCESS': return 'success';
        case 'LEADERBOARD_NOT_FOUND': return 'leaderboard_not_found';
        case 'PROFILE_NOT_FOUND': return 'profile_not_found';
        case 'UNPARSABLE_SCORE': return 'unparsable_score';
      }
    } catch {
      return 'failed';
    }
  }
  async open() {
    if (Game.openLeaderboard.isSupported()) await Game.openLeaderboard();
  }
}

class TossShare implements ShareAdapter {
  isSupported() { return true; }
  async shareText(message: string) {
    try { await Share.sendMessage({ message }); return true; } catch { return false; }
  }
}

export function createTossPlatform(units: AdUnitConfig): Platform {
  return {
    name: 'toss',
    storage: new TossStorage(),
    ads: new TossAds(units),
    leaderboard: new TossLeaderboard(),
    share: new TossShare(),
  };
}
