import { createMockPlatform } from './mock';
import type { AdUnitConfig, Platform } from './types';

export type * from './types';

let current: Platform | null = null;

/**
 * 플랫폼 선택:
 * - VITE_PLATFORM=mock → 항상 mock (dev 서버 기본값, .env 없을 때 dev에서 mock)
 * - VITE_PLATFORM=toss 또는 production 빌드 → 토스 SDK 어댑터를 동적 로드, 실패 시 mock으로 폴백
 * - URL ?platform=mock / ?ads=off 로 로컬에서 강제·광고 미지원 시뮬레이션
 */
export async function initPlatform(units: AdUnitConfig = {}): Promise<Platform> {
  if (current) return current;
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const env = import.meta.env.VITE_PLATFORM as string | undefined;
  const forced = params.get('platform') === 'mock' ? 'mock' : env;
  const wantToss = forced === 'toss' || (forced !== 'mock' && import.meta.env.PROD && hasNativeBridge());

  if (wantToss) {
    try {
      const { createTossPlatform } = await import('./toss');
      current = createTossPlatform(units);
      return current;
    } catch (e) {
      console.warn('[platform] 토스 SDK 로드 실패 → mock 사용', e);
    }
  }
  current = createMockPlatform({ adsSupported: params.get('ads') !== 'off' });
  return current;
}

/**
 * 토스 앱 WebView 여부 추정.
 * (추측: 앱인토스 WebView는 React Native WebView 기반이라 window.ReactNativeWebView가 주입된다고 가정. 실기기 확인 필요.
 *  틀리면 VITE_PLATFORM=toss 로 빌드해 강제할 수 있음)
 */
function hasNativeBridge(): boolean {
  return typeof window !== 'undefined' && 'ReactNativeWebView' in window;
}

export function getPlatform(): Platform {
  if (!current) throw new Error('initPlatform()을 먼저 호출하세요');
  return current;
}
