/**
 * 앱인토스 SDK 어댑터 인터페이스. 게임 코드는 이 인터페이스만 사용하고 SDK를 직접 import하지 않는다.
 * 구현: mock.ts(로컬), toss.ts(@apps-in-toss/web-framework 3.x)
 */

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type AdKind = 'interstitial' | 'rewarded';

export type AdResult =
  | { status: 'shown' }
  | { status: 'rewarded'; unitType: string; unitAmount: number }
  | { status: 'dismissed_without_reward' }
  | { status: 'unsupported' }
  | { status: 'not_loaded' }
  | { status: 'failed'; reason: string };

export interface AdsAdapter {
  /** 환경이 전면형 광고(전면/보상형 공통 API)를 지원하는지. false면 광고 UI 자체를 숨긴다. */
  isSupported(): boolean;
  /** 광고 미리 로드. 플레이 시작 전·결과 화면 진입 시 호출 권장 */
  preload(kind: AdKind): Promise<boolean>;
  isLoaded(kind: AdKind): boolean;
  /**
   * 광고 노출. 규칙: 플레이 도중 호출 금지, 전면광고는 호출 전 UI로 예고, 빈도는 데이터로 제어.
   * (이 규칙은 호출 측 책임 — 어댑터는 강제하지 않음)
   */
  show(kind: AdKind): Promise<AdResult>;
}

export type LeaderboardSubmitResult = 'success' | 'unsupported' | 'leaderboard_not_found' | 'profile_not_found' | 'unparsable_score' | 'failed';

export interface LeaderboardAdapter {
  isSupported(): boolean;
  submitScore(score: number): Promise<LeaderboardSubmitResult>;
  open(): Promise<void>;
}

export interface ShareAdapter {
  isSupported(): boolean;
  /** 네이티브 공유 시트로 텍스트 공유 */
  shareText(message: string): Promise<boolean>;
}

/** 세이프 에어리어 여백(CSS px) */
export interface SafeAreaInsets { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }

export interface Platform {
  readonly name: 'mock' | 'toss';
  /**
   * T-170(control-dpad §8-4): 세이프 에어리어 여백. 토스 = SDK SafeArea.get(), 로컬 = CSS env(safe-area-inset-*).
   * 알 수 없으면 0. 조작대를 홈 표시줄·제스처 영역 위로 올리는 데 쓴다
   */
  safeAreaInsets(): SafeAreaInsets;
  readonly storage: StorageAdapter;
  readonly ads: AdsAdapter;
  readonly leaderboard: LeaderboardAdapter;
  readonly share: ShareAdapter;
}

/** 광고 단위 ID 설정. 콘솔 발급 전이므로 비어 있음 — 실제 값은 데이터/환경변수로 주입 */
export interface AdUnitConfig {
  interstitial?: string;
  rewarded?: string;
}
