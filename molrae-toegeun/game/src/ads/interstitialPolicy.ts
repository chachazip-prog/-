/**
 * 전면광고 빈도 판정 (D-031 + D-048, ads.json interstitial). 순수 함수 — 실제 광고 UI·노출은 다음 작업.
 *
 * 판정 순서(data-schema §8, D-048로 '평생 판수 면제' 제외):
 *   비활성 → IAP 광고 제거 → 플레이 중 → 설치 당일(installDayMaxShows) → 오늘 횟수 ≥ maxPerDay
 *   → 마지막 광고 후 < minIntervalSec → 이번 판 보상형 봄 → 마지막 광고 후 판수 < everyNGames
 * 하나라도 걸리면 건너뜀. 카운터는 ads.json counters.persist 이름 그대로(앱인토스 Storage에 저장).
 */
export interface InterstitialRules {
  readonly enabled: boolean;
  readonly installDayMaxShows: number;
  readonly everyNGames: number;
  readonly maxPerDay: number;
  readonly minIntervalSec: number;
  readonly skipIfRewardedWatchedThisGame: boolean;
  readonly noticeSec: number;
  readonly noticeKey: string;
}

export interface AdCounters {
  installDate: string;
  gamesPlayedLifetime: number;
  gamesSinceLastInterstitial: number;
  interstitialShownToday: number;
  /** epoch ms, 0 = 없음 */
  lastInterstitialAt: number;
  rewardedShownToday: number;
  rewardedByPlacementToday: Record<string, number>;
  /** 오늘 카운터 기준일(로컬 자정 경계) */
  countersDate: string;
}

export type SkipReason = 'disabled' | 'iap' | 'during_play' | 'install_day' | 'daily_cap' | 'interval' | 'rewarded_this_game' | 'not_nth_game';
export type InterstitialDecision = { show: true } | { show: false; reason: SkipReason };

export function parseInterstitialRules(ads: Readonly<Record<string, unknown>>): InterstitialRules {
  const i = (ads['interstitial'] ?? {}) as Record<string, unknown>;
  const n = (k: string, d: number) => (typeof i[k] === 'number' ? i[k] as number : d);
  return {
    enabled: i['enabled'] === true,
    installDayMaxShows: n('installDayMaxShows', 0),
    everyNGames: Math.max(1, n('everyNGames', 3)),
    maxPerDay: n('maxPerDay', 5),
    minIntervalSec: n('minIntervalSec', 180),
    skipIfRewardedWatchedThisGame: i['skipIfRewardedWatchedThisGame'] !== false,
    noticeSec: n('noticeSec', 1),
    noticeKey: typeof i['noticeKey'] === 'string' ? i['noticeKey'] as string : 'ad.interstitial_notice',
  };
}

/** 로컬 날짜 'YYYY-MM-DD' (dayBoundary: local_midnight) */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function freshCounters(nowMs: number): AdCounters {
  const today = localDate(nowMs);
  return {
    installDate: today, gamesPlayedLifetime: 0, gamesSinceLastInterstitial: 0, interstitialShownToday: 0,
    lastInterstitialAt: 0, rewardedShownToday: 0, rewardedByPlacementToday: {}, countersDate: today,
  };
}

/** 날짜가 바뀌었으면 '오늘' 카운터 초기화 */
export function rollDay(c: AdCounters, nowMs: number): AdCounters {
  const today = localDate(nowMs);
  if (c.countersDate === today) return c;
  return { ...c, interstitialShownToday: 0, rewardedShownToday: 0, rewardedByPlacementToday: {}, countersDate: today };
}

/** 한 판이 끝났을 때(결과 화면 진입) 카운터 갱신 */
export function onGameFinished(c: AdCounters, nowMs: number): AdCounters {
  const r = rollDay(c, nowMs);
  return { ...r, gamesPlayedLifetime: r.gamesPlayedLifetime + 1, gamesSinceLastInterstitial: r.gamesSinceLastInterstitial + 1 };
}

export function decideInterstitial(
  rules: InterstitialRules, c0: AdCounters, nowMs: number,
  ctx: { iapRemoveAds: boolean; duringPlay: boolean; rewardedWatchedThisGame: boolean },
): InterstitialDecision {
  const c = rollDay(c0, nowMs);
  if (!rules.enabled) return { show: false, reason: 'disabled' };
  if (ctx.iapRemoveAds) return { show: false, reason: 'iap' };
  if (ctx.duringPlay) return { show: false, reason: 'during_play' };
  if (localDate(nowMs) === c.installDate && c.interstitialShownToday >= rules.installDayMaxShows) return { show: false, reason: 'install_day' };
  if (c.interstitialShownToday >= rules.maxPerDay) return { show: false, reason: 'daily_cap' };
  if (c.lastInterstitialAt > 0 && nowMs - c.lastInterstitialAt < rules.minIntervalSec * 1000) return { show: false, reason: 'interval' };
  if (rules.skipIfRewardedWatchedThisGame && ctx.rewardedWatchedThisGame) return { show: false, reason: 'rewarded_this_game' };
  if (c.gamesSinceLastInterstitial < rules.everyNGames) return { show: false, reason: 'not_nth_game' };
  return { show: true };
}

export function onInterstitialShown(c: AdCounters, nowMs: number): AdCounters {
  const r = rollDay(c, nowMs);
  return { ...r, interstitialShownToday: r.interstitialShownToday + 1, lastInterstitialAt: nowMs, gamesSinceLastInterstitial: 0 };
}

// ── 보상형(ads.json rewarded, D-031 하루 최대 12회 + 배치별 maxPerDay) ─────────────

export interface RewardedPlacement {
  readonly id: string;
  readonly screen: string;
  readonly labelKey: string;
  readonly descKey?: string;
  readonly maxPerDay: number;
  readonly declineLabelKey?: string;
  readonly notCompletedKey?: string;
  readonly unavailableKey?: string;
  readonly declineButtonSameSize?: boolean;
  readonly autoCountdown?: boolean;
  readonly buttonOnlyNoPopup?: boolean;
  /** 보상 미수령 시 처리(continue = go_to_result_no_retry, ceo_pass = keep_visit_button_reenabled, T-136) */
  readonly onNotEarned?: string;
}

export interface RewardedRules {
  readonly enabled: boolean;
  readonly maxPerDay: number;
  readonly placements: Readonly<Record<string, RewardedPlacement>>;
  /** 하루 상한 도달 안내 문구 키(ads.rewarded.dailyCapReachedKey, T-136·D-066) */
  readonly dailyCapReachedKey?: string;
}

export function parseRewardedRules(ads: Readonly<Record<string, unknown>>): RewardedRules {
  const r = (ads['rewarded'] ?? {}) as Record<string, unknown>;
  const placements: Record<string, RewardedPlacement> = {};
  for (const p of (Array.isArray(r['placements']) ? r['placements'] : []) as Record<string, unknown>[]) {
    const id = typeof p['id'] === 'string' ? p['id'] : '';
    if (!id) continue;
    const s = (k: string) => (typeof p[k] === 'string' ? { [k]: p[k] as string } : {});
    const b = (k: string) => (typeof p[k] === 'boolean' ? { [k]: p[k] as boolean } : {});
    placements[id] = {
      id, screen: typeof p['screen'] === 'string' ? p['screen'] : '', labelKey: typeof p['labelKey'] === 'string' ? p['labelKey'] : id,
      maxPerDay: typeof p['maxPerDay'] === 'number' ? p['maxPerDay'] : 1,
      ...s('descKey'), ...s('declineLabelKey'), ...s('notCompletedKey'), ...s('unavailableKey'), ...s('onNotEarned'),
      ...b('declineButtonSameSize'), ...b('autoCountdown'), ...b('buttonOnlyNoPopup'),
    } as RewardedPlacement;
  }
  return {
    enabled: r['enabled'] === true, maxPerDay: typeof r['maxPerDay'] === 'number' ? r['maxPerDay'] : 12, placements,
    ...(typeof r['dailyCapReachedKey'] === 'string' ? { dailyCapReachedKey: r['dailyCapReachedKey'] } : {}),
  };
}

export type RewardedSkip = 'disabled' | 'unknown_placement' | 'daily_cap' | 'placement_cap';

/** 보상형 제안 가능 여부(하루 총량·배치별 상한). 광고 SDK 지원 여부는 호출 측이 isSupported()로 따로 본다(D-050 ⑥) */
export function canOfferRewarded(rules: RewardedRules, c0: AdCounters, placementId: string, nowMs: number): { ok: true } | { ok: false; reason: RewardedSkip } {
  const c = rollDay(c0, nowMs);
  if (!rules.enabled) return { ok: false, reason: 'disabled' };
  const p = rules.placements[placementId];
  if (!p) return { ok: false, reason: 'unknown_placement' };
  if (c.rewardedShownToday >= rules.maxPerDay) return { ok: false, reason: 'daily_cap' };
  if ((c.rewardedByPlacementToday[placementId] ?? 0) >= p.maxPerDay) return { ok: false, reason: 'placement_cap' };
  return { ok: true };
}

/** 보상 수령(userEarnedReward)했을 때만 호출 */
export function onRewardedShown(c: AdCounters, placementId: string, nowMs: number): AdCounters {
  const r = rollDay(c, nowMs);
  return {
    ...r, rewardedShownToday: r.rewardedShownToday + 1,
    rewardedByPlacementToday: { ...r.rewardedByPlacementToday, [placementId]: (r.rewardedByPlacementToday[placementId] ?? 0) + 1 },
  };
}
