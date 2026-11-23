/**
 * 광고 흐름(플랫폼 어댑터 경유). 규칙: 플레이 중 호출 금지(D-023) — 호출 측은 출근 준비·이어하기 제안·결과 화면에서만 부른다.
 * - 보상형: 버튼을 누른 뒤에만 로드·노출(D-050 ①). isSupported false면 제안 자체를 생략(⑥). 보상 수령 때만 카운터 증가(⑤).
 * - 전면: 결과 → 다음 날 전환 때 빈도 판정(D-031/D-048) → 예고(noticeKey, noticeSec) → 노출.
 */
import { getAdsTable } from '../content';
import type { Platform } from '../platform';
import { loadAdCounters, saveAdCounters } from '../state/progress';
import {
  canOfferRewarded, decideInterstitial, onGameFinished, onInterstitialShown, onRewardedShown, parseInterstitialRules, parseRewardedRules, rollDay,
  type RewardedPlacement,
} from './interstitialPolicy';

export type RewardedOutcome = 'rewarded' | 'not_completed' | 'unavailable';

/** '오늘 광고 끝' 안내를 이미 띄운 날(광고 카운터 날짜). 앱 실행 동안 하루 1회(D-066) — 저장하지 않음 */
let capNoticeDate: string | null = null;

export class AdFlow {
  private readonly rewarded = parseRewardedRules(getAdsTable());
  private readonly interstitial = parseInterstitialRules(getAdsTable());
  constructor(private readonly platform: Platform) {}

  placement(id: string): RewardedPlacement | undefined { return this.rewarded.placements[id]; }

  /** 이 배치의 보상형 버튼을 보여 줄 수 있는가(지원 환경 + 하루 상한) */
  async canOffer(placementId: string): Promise<boolean> {
    if (!this.platform.ads.isSupported()) return false;
    const now = Date.now();
    return canOfferRewarded(this.rewarded, await loadAdCounters(this.platform.storage, now), placementId, now).ok;
  }

  /** 오늘 보상형을 더 볼 수 없는가(하루 총량, '오늘 광고 끝' 안내용) */
  async rewardedDailyCapReached(): Promise<boolean> {
    if (!this.platform.ads.isSupported()) return false;
    const now = Date.now();
    const c = rollDay(await loadAdCounters(this.platform.storage, now), now);
    return c.rewardedShownToday >= this.rewarded.maxPerDay;
  }

  /**
   * D-066: 하루 보상형 상한에 닿았으면 안내 문구 키(ads.rewarded.dailyCapReachedKey)를 돌려준다. 같은 날 두 번째부터는 null(토스트 1회).
   * 보상형 버튼 자체는 canOffer가 false라 숨겨진다.
   */
  async dailyCapNoticeKey(): Promise<string | null> {
    const key = this.rewarded.dailyCapReachedKey;
    if (!key || !this.platform.ads.isSupported()) return null;
    const now = Date.now();
    const c = rollDay(await loadAdCounters(this.platform.storage, now), now);
    if (c.rewardedShownToday < this.rewarded.maxPerDay || capNoticeDate === c.countersDate) return null;
    capNoticeDate = c.countersDate;
    return key;
  }

  /** 보상형 노출(사용자가 버튼을 누른 뒤). 보상 수령 시에만 'rewarded' */
  async showRewarded(placementId: string): Promise<RewardedOutcome> {
    if (!(await this.canOffer(placementId))) return 'unavailable';
    const ads = this.platform.ads;
    if (!ads.isLoaded('rewarded') && !(await ads.preload('rewarded'))) return 'unavailable';
    const r = await ads.show('rewarded');
    if (r.status === 'rewarded') {
      const now = Date.now();
      await saveAdCounters(this.platform.storage, onRewardedShown(await loadAdCounters(this.platform.storage, now), placementId, now));
      return 'rewarded';
    }
    return r.status === 'dismissed_without_reward' ? 'not_completed' : 'unavailable';
  }

  /**
   * 한 판 종료 처리 + 결과 → 다음 날 전환의 전면광고. notice는 예고 표시(초) 후 resolve되는 콜백.
   * 광고 미지원 환경에서는 판정하지 않음.
   */
  async afterGame(rewardedWatchedThisGame: boolean, notice: (key: string, sec: number) => Promise<void>): Promise<void> {
    const now = Date.now();
    let c = onGameFinished(await loadAdCounters(this.platform.storage, now), now);
    if (this.platform.ads.isSupported()) {
      const d = decideInterstitial(this.interstitial, c, now, { iapRemoveAds: false, duringPlay: false, rewardedWatchedThisGame });
      if (d.show) {
        const loaded = this.platform.ads.isLoaded('interstitial') || (await this.platform.ads.preload('interstitial'));
        if (loaded) {
          await notice(this.interstitial.noticeKey, this.interstitial.noticeSec);
          const r = await this.platform.ads.show('interstitial');
          if (r.status === 'shown') c = onInterstitialShown(c, Date.now());
        }
      } else console.info(`[ads] 전면광고 건너뜀(${d.reason})`);
    }
    await saveAdCounters(this.platform.storage, c);
  }
}
