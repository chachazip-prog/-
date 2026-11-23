/**
 * 진행·광고 카운터 저장(앱인토스 Storage 어댑터, 로컬은 mock). 실패해도 게임은 계속(메모리 값 사용).
 */
import { freshCounters, type AdCounters } from '../ads/interstitialPolicy';
import type { StorageAdapter } from '../platform';

export interface Progress {
  /** 플레이 가능한 마지막 날(전날 ★1 이상이면 다음 날 해금) */
  unlockedDay: number;
  /** 날짜별 최고 별 */
  bestStars: Record<string, number>;
  /** 누적 월급(게임 속 재화 '닢', D-061). 결정적 계산 결과만 더함 */
  wallet: number;
  /** 이미 본 튜토리얼 문구 키(재방문 생략, GDD §13) */
  seenHints: string[];
  /** 소리 켜짐(설정). 꺼도 시각 신호는 그대로(rules.visualCues.alwaysOn) */
  soundOn: boolean;
}

const PROGRESS_KEY = 'mt.progress.v1';
const ADS_KEY = 'mt.adCounters.v1';

export async function loadProgress(s: StorageAdapter): Promise<Progress> {
  try {
    const raw = await s.getItem(PROGRESS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Progress>;
      return {
        unlockedDay: Math.max(1, p.unlockedDay ?? 1), bestStars: p.bestStars ?? {}, wallet: p.wallet ?? 0,
        seenHints: Array.isArray(p.seenHints) ? p.seenHints : [], soundOn: p.soundOn !== false,
      };
    }
  } catch (e) { console.warn('[progress] 읽기 실패', e); }
  return { unlockedDay: 1, bestStars: {}, wallet: 0, seenHints: [], soundOn: true };
}

export async function saveProgress(s: StorageAdapter, p: Progress): Promise<void> {
  try { await s.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) { console.warn('[progress] 저장 실패', e); }
}

/** 하루 결과 반영(다음 날 해금 = ★1 이상) */
export function applyDayResult(p: Progress, day: number, stars: number): Progress {
  const best = Math.max(p.bestStars[String(day)] ?? 0, stars);
  return {
    ...p,
    unlockedDay: stars >= 1 ? Math.max(p.unlockedDay, day + 1) : p.unlockedDay,
    bestStars: { ...p.bestStars, [String(day)]: best },
  };
}

export async function loadAdCounters(s: StorageAdapter, nowMs: number): Promise<AdCounters> {
  try {
    const raw = await s.getItem(ADS_KEY);
    if (raw) return { ...freshCounters(nowMs), ...(JSON.parse(raw) as Partial<AdCounters>) };
  } catch (e) { console.warn('[ads] 카운터 읽기 실패', e); }
  const c = freshCounters(nowMs);
  await saveAdCounters(s, c);
  return c;
}

export async function saveAdCounters(s: StorageAdapter, c: AdCounters): Promise<void> {
  try { await s.setItem(ADS_KEY, JSON.stringify(c)); } catch (e) { console.warn('[ads] 카운터 저장 실패', e); }
}
