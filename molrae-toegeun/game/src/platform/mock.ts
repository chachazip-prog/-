import type { AdKind, AdResult, AdsAdapter, LeaderboardAdapter, Platform, ShareAdapter, StorageAdapter } from './types';

const PREFIX = 'mt-mock:';

class MockStorage implements StorageAdapter {
  private mem = new Map<string, string>();
  private ls(): Storage | null {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  }
  async getItem(key: string) { return this.ls()?.getItem(PREFIX + key) ?? this.mem.get(key) ?? null; }
  async setItem(key: string, value: string) {
    this.mem.set(key, value);
    try { this.ls()?.setItem(PREFIX + key, value); } catch { /* 저장 불가 환경은 메모리만 */ }
  }
  async removeItem(key: string) {
    this.mem.delete(key);
    try { this.ls()?.removeItem(PREFIX + key); } catch { /* noop */ }
  }
}

class MockAds implements AdsAdapter {
  private loaded = new Set<AdKind>();
  constructor(private readonly supported: boolean) {}
  isSupported() { return this.supported; }
  async preload(kind: AdKind) {
    if (!this.supported) return false;
    this.loaded.add(kind);
    return true;
  }
  isLoaded(kind: AdKind) { return this.loaded.has(kind); }
  async show(kind: AdKind): Promise<AdResult> {
    if (!this.supported) return { status: 'unsupported' };
    if (!this.loaded.delete(kind)) return { status: 'not_loaded' };
    console.info(`[mock ads] ${kind} 광고 노출(가상)`);
    return kind === 'rewarded' ? { status: 'rewarded', unitType: 'mock', unitAmount: 1 } : { status: 'shown' };
  }
}

class MockLeaderboard implements LeaderboardAdapter {
  isSupported() { return true; }
  async submitScore(score: number) {
    console.info(`[mock leaderboard] 점수 제출: ${score}`);
    return 'success' as const;
  }
  async open() { console.info('[mock leaderboard] 리더보드 열기(가상)'); }
}

class MockShare implements ShareAdapter {
  isSupported() { return true; }
  async shareText(message: string) {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try { await nav.share({ text: message }); return true; } catch { return false; }
    }
    console.info(`[mock share] ${message}`);
    return true;
  }
}

export interface MockOptions {
  /** 광고 미지원 기기 시뮬레이션: URL에 ?ads=off */
  adsSupported?: boolean;
}

export function createMockPlatform(opts: MockOptions = {}): Platform {
  return {
    name: 'mock',
    storage: new MockStorage(),
    ads: new MockAds(opts.adsSupported ?? true),
    leaderboard: new MockLeaderboard(),
    share: new MockShare(),
  };
}
