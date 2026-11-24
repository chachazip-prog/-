/**
 * 미션 행동(X9) — 렌더링 무관. events.json mechanic별 params를 해석한다.
 * 각 행동은 tick(dt, ctx)과 tap(ctx)만 가진다. 결과는 'running' | 'success' | 'fail'.
 * 행동 중 플레이어 상태: 'activity'(수상한 행동, activityPerSec) / 'paused'(일시정지·위장, activityPausedPerSec) / 'safe'(안전 구역).
 * activityScale: 노출 배율(낮잠 고개 반쯤 숙임 = headDownVisibleStateMultiplier).
 */
import type { Mechanic } from './types';

export type ActivityStatus = 'running' | 'success' | 'fail';
export type ActivityPosture = 'activity' | 'paused' | 'safe';

export interface ActivityCtx {
  /** 지금 누가 보고 있는가(의심 판정에 들어간 시선) */
  readonly seen: boolean;
  /** 행동 시작 후 경과(초) */
  readonly elapsed: number;
  /** 이번 탭을 누르고 있던 시간(초). 모르면 없음(= 짧은 탭) — 간식 길게 누름 판정 */
  readonly pressSec?: number;
}

/** 행동이 상위(DaySim)에 요청하는 부수효과 */
export interface ActivityEffects {
  suspicion: number;
  points: number;
  /** 간식 바스락: 반경 안 앉은 상사 대기 단축(타일 반경, 단축 후 대기 초) */
  noise: { radius: number; idleTo: number } | null;
  /** 표시용 짧은 문구 키 */
  toastKey: string | null;
  /** 이벤트 이름(사운드·튜토리얼 트리거) */
  event: string | null;
}

export function emptyEffects(): ActivityEffects { return { suspicion: 0, points: 0, noise: null, toastKey: null, event: null }; }

export interface Activity {
  readonly mechanic: Mechanic;
  posture: ActivityPosture;
  /** 노출 배율(1 = 그대로) */
  activityScale: number;
  tick(dt: number, ctx: ActivityCtx, fx: ActivityEffects): ActivityStatus;
  tap(ctx: ActivityCtx, fx: ActivityEffects): ActivityStatus;
  /** HUD 표시용 상태(게이지 등) */
  view(): ActivityView;
}

export type ActivityView =
  | { kind: 'pour'; level: number; band: readonly [number, number]; overflow: number; paused: boolean; cups: number; cupsRequired: number }
  | { kind: 'restroom'; restLeft: number; bonusSec: number; bonusMax: number }
  | { kind: 'nap'; fatigue: number; head: number; headUp: boolean; threshold: number }
  | { kind: 'shop'; cart: number; items: number; itemsRequired: number; checkout: number; checkoutSec: number; shopping: boolean }
  | { kind: 'snack'; bites: number; required: number; sinceLast: number; window: readonly [number, number] }
  // ── T-145 ──
  | { kind: 'fetch'; progress: number; total: number; paused: boolean }
  | { kind: 'remote_start'; progress: number; total: number }
  | { kind: 'grab'; pages: number; pagesRequired: number; done: boolean; paused: boolean }
  | { kind: 'queue'; stage: 'order' | 'tell' | 'window' | 'retry'; progress: number; total: number; paused: boolean; missed: number; maxMissed: number };

/** 원격 출력 작업(remote_start_fetch). 자리에서 시작 → 걸어가는 동안에도 출력 → 프린터에서 집기. DaySim이 매 스텝 진행시킨다 */
export class PrintJob {
  printedSec = 0;
  paused = false;
  doneAt: number | null = null;
  grabbed = false;
  constructor(readonly pagesRequired: number, readonly secPerPage: number) {}
  get pages(): number { return Math.min(this.pagesRequired, Math.floor(this.printedSec / this.secPerPage + 1e-9)); }
  get done(): boolean { return this.pages >= this.pagesRequired; }
  get printing(): boolean { return !this.paused && !this.done && !this.grabbed; }
  step(dt: number, now: number): void {
    if (this.grabbed || this.paused || this.done) return;
    this.printedSec += dt;
    if (this.done && this.doneAt === null) this.doneAt = now;
  }
}

const num = (p: Readonly<Record<string, unknown>>, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
const range = (p: Readonly<Record<string, unknown>>, k: string, d: readonly [number, number]): readonly [number, number] => {
  const v = p[k];
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : d;
};

/** 커피: 자동으로 따름 → 탭 = 멈춤. 띠 안이면 완성, 아래면 일시정지(다시 탭하면 이어 따름), 띠 위·넘침은 실패 */
class PourActivity implements Activity {
  readonly mechanic = 'pour_tap_stop' as const;
  posture: ActivityPosture = 'activity';
  activityScale = 1;
  private level = 0;
  private paused = false;
  private cups = 0;
  private readonly rate: number;
  private readonly band: readonly [number, number];
  private readonly overflow: number;
  private readonly cupsRequired: number;
  private readonly tapAboveBand: string;
  constructor(p: Readonly<Record<string, unknown>>) {
    this.rate = num(p, 'pourRatePerSec', 0.45);
    this.band = range(p, 'targetBand', [0.75, 0.92]);
    this.overflow = num(p, 'overflowAt', 1);
    this.cupsRequired = Math.max(1, Math.round(num(p, 'cupsRequired', 1)));
    this.tapAboveBand = typeof p['tapAboveBand'] === 'string' ? p['tapAboveBand'] as string : 'fail';
  }
  tick(dt: number, _c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.paused) return 'running';
    this.level += this.rate * dt;
    if (this.level >= this.overflow) { fx.event = 'coffeeOverflow'; return 'fail'; }
    return 'running';
  }
  tap(_c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.paused) { this.paused = false; this.posture = 'activity'; return 'running'; }
    if (this.level < this.band[0]) {
      this.paused = true; this.posture = 'paused';
      fx.toastKey = 'event.coffee.paused';
      return 'running';
    }
    if (this.level <= this.band[1]) {
      this.cups++;
      fx.toastKey = 'event.coffee.perfect';
      if (this.cups >= this.cupsRequired) return 'success';
      this.level = 0;
      return 'running';
    }
    // 띠 위(넘치기 직전)에서 멈춤 = 흘림(T-134 ①, events.coffee.params.tapAboveBand: "fail"). 'fail'이 아니면 성공으로 침
    if (this.tapAboveBand !== 'fail') { this.cups++; if (this.cups >= this.cupsRequired) return 'success'; this.level = 0; return 'running'; }
    fx.event = 'coffeeOverflow';
    return 'fail';
  }
  view(): ActivityView {
    return { kind: 'pour', level: this.level, band: this.band, overflow: this.overflow, paused: this.paused, cups: this.cups, cupsRequired: this.cupsRequired };
  }
}

/** 화장실: 칸 안 = 안전 구역. insideRestSec 휴식 후 insideBonusMaxSec까지 초당 점수. 휴식 후 탭 = 나가기 */
class RestroomActivity implements Activity {
  readonly mechanic = 'trip_safe_zone' as const;
  posture: ActivityPosture = 'safe';
  activityScale = 1;
  private t = 0;
  private bonusSec = 0;
  private readonly rest: number;
  private readonly bonusMax: number;
  private readonly pps: number;
  constructor(p: Readonly<Record<string, unknown>>) {
    this.rest = num(p, 'insideRestSec', 3);
    this.bonusMax = num(p, 'insideBonusMaxSec', 4);
    this.pps = num(p, 'insidePointsPerSec', 20);
  }
  tick(dt: number, _c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    const before = this.t;
    this.t += dt;
    if (before < this.rest && this.t >= this.rest) fx.event = 'restroomRestDone';
    if (this.t > this.rest && this.bonusSec < this.bonusMax) {
      const add = Math.min(dt, this.bonusMax - this.bonusSec, this.t - this.rest);
      this.bonusSec += add;
      fx.points += add * this.pps;
    }
    return 'running';
  }
  tap(_c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.t < this.rest) return 'running';
    fx.toastKey = null;
    return 'success';
  }
  get restStarted(): boolean { return true; }
  view(): ActivityView { return { kind: 'restroom', restLeft: Math.max(0, this.rest - this.t), bonusSec: this.bonusSec, bonusMax: this.bonusMax }; }
}

/** 낮잠: 자동으로 졺(졸음 회복, 고개 숙여짐). 탭 = 고개 들기 ↔ 다시 졸기. 고개 1.0 = 쿵(실패). 졸음 0 = 성공 */
class NapActivity implements Activity {
  readonly mechanic = 'nap_tap_toggle' as const;
  posture: ActivityPosture = 'activity';
  activityScale = 1;
  private fatigue: number;
  private head = 0;
  private headUp = false;
  private readonly recover: number;
  private readonly drop: number;
  private readonly raise: number;
  private readonly thud: number;
  private readonly threshold: number;
  private readonly visibleMul: number;
  constructor(p: Readonly<Record<string, unknown>>) {
    this.fatigue = num(p, 'fatigueStart', 1);
    this.recover = num(p, 'fatigueRecoverPerSec', 0.25);
    this.drop = num(p, 'headDropPerSec', 0.35);
    this.raise = num(p, 'headRaisePerSec', 0.7);
    this.thud = num(p, 'headThudAt', 1);
    this.threshold = num(p, 'headDownVisibleThreshold', 0.5);
    this.visibleMul = num(p, 'headDownVisibleStateMultiplier', 0.5);
  }
  tick(dt: number, _c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.headUp) {
      this.head = Math.max(0, this.head - this.raise * dt);
      // 고개를 들고 있어도 아직 많이 숙여져 있으면 절반 노출
      if (this.head >= this.threshold) { this.posture = 'activity'; this.activityScale = this.visibleMul; }
      else { this.posture = 'paused'; this.activityScale = 1; }
      return 'running';
    }
    this.posture = 'activity'; this.activityScale = 1;
    this.fatigue = Math.max(0, this.fatigue - this.recover * dt);
    this.head += this.drop * dt;
    if (this.head >= this.thud) { fx.event = 'napThud'; return 'fail'; }
    if (this.fatigue <= 0) return 'success';
    return 'running';
  }
  tap(_c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    this.headUp = !this.headUp;
    fx.toastKey = this.headUp ? 'event.nap.head_up' : null;
    return 'running';
  }
  view(): ActivityView { return { kind: 'nap', fatigue: this.fatigue, head: this.head, headUp: this.headUp, threshold: this.threshold }; }
}

/** 쇼핑: 탭 = 쇼핑 ↔ 스프레드시트. 쇼핑 화면에서 장바구니가 차고, 다 차면 결제(연속 checkoutHoldSec). 결제 중 탭 = 결제 진행 초기화 */
class ShopActivity implements Activity {
  readonly mechanic = 'screen_swap_tap' as const;
  posture: ActivityPosture = 'activity';
  activityScale = 1;
  private shopping = true;
  private cart = 0;
  private items = 0;
  private checkout = 0;
  private readonly fill: number;
  private readonly itemsRequired: number;
  private readonly checkoutSec: number;
  constructor(p: Readonly<Record<string, unknown>>) {
    this.fill = num(p, 'cartFillPerSec', 0.3);
    // itemsRequired = 결제 전에 채울 장바구니 상품 수(T-134 ② 확정, 결제는 별도 단계)
    this.itemsRequired = Math.max(1, Math.round(num(p, 'itemsRequired', 2)));
    this.checkoutSec = num(p, 'checkoutHoldSec', 0.8);
  }
  tick(dt: number, _c: ActivityCtx, _fx: ActivityEffects): ActivityStatus {
    if (!this.shopping) return 'running';
    if (this.items < this.itemsRequired) {
      this.cart += this.fill * dt;
      if (this.cart >= 1) { this.cart = 0; this.items++; }
      return 'running';
    }
    this.checkout += dt;
    return this.checkout >= this.checkoutSec ? 'success' : 'running';
  }
  tap(_c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    this.shopping = !this.shopping;
    this.checkout = 0; // 결제 중 탭 = 결제 진행만 초기화
    this.posture = this.shopping ? 'activity' : 'paused';
    fx.toastKey = null;
    return 'running';
  }
  view(): ActivityView {
    return { kind: 'shop', cart: this.cart, items: this.items, itemsRequired: this.itemsRequired, checkout: this.checkout, checkoutSec: this.checkoutSec, shopping: this.shopping };
  }
}

/** 간식: 탭 = 한 입. 간격이 perfectWindow면 '바삭' 점수, minInterval보다 빠르면 '바스락' 의심 + 상사 대기 단축 */
class SnackActivity implements Activity {
  readonly mechanic = 'rhythm_tap' as const;
  posture: ActivityPosture = 'paused';
  activityScale = 1;
  private bites = 0;
  private sinceLast = Infinity;
  private activeLeft = 0;
  private readonly required: number;
  private readonly minInterval: number;
  private readonly perfect: readonly [number, number];
  private readonly noiseSusp: number;
  private readonly noiseRadius: number;
  private readonly noiseIdleTo: number;
  private readonly gazeSusp: number;
  private readonly activeSec: number;
  private readonly perfectPts: number;
  private readonly maxPress: number;
  constructor(p: Readonly<Record<string, unknown>>, biteMul: number) {
    this.maxPress = num(p, 'maxPressSec', Infinity);
    this.required = Math.max(1, Math.round(num(p, 'bitesRequired', 6) * biteMul));
    this.minInterval = num(p, 'minIntervalSec', 0.55);
    this.perfect = range(p, 'perfectWindowSec', [0.55, 1.1]);
    this.noiseSusp = num(p, 'noiseSuspicion', 0.08);
    this.noiseRadius = num(p, 'noiseAlertsRadiusTiles', 5);
    this.noiseIdleTo = num(p, 'noiseShortensBossIdleTo', 0);
    this.gazeSusp = num(p, 'biteUnderGazeSuspicion', 0.12);
    this.activeSec = num(p, 'activityStateAfterBiteSec', 0.4);
    this.perfectPts = num(p, 'perfectBonusPoints', 10);
  }
  tick(dt: number): ActivityStatus {
    this.sinceLast += dt;
    if (this.activeLeft > 0) { this.activeLeft -= dt; this.posture = this.activeLeft > 0 ? 'activity' : 'paused'; }
    return 'running';
  }
  tap(ctx: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    const gap = this.sinceLast;
    this.sinceLast = 0;
    this.bites++;
    this.activeLeft = this.activeSec;
    this.posture = 'activity';
    // '바스락!!' = 너무 빠른 입 또는 너무 길게 누름(maxPressSec, GDD §11 간식)
    const longPress = ctx.pressSec !== undefined && ctx.pressSec > this.maxPress;
    if (gap < this.minInterval || longPress) {
      fx.suspicion += this.noiseSusp;
      fx.noise = { radius: this.noiseRadius, idleTo: this.noiseIdleTo };
      fx.toastKey = 'event.snack.noise';
      fx.event = 'snackNoise';
    } else if (gap >= this.perfect[0] && gap <= this.perfect[1]) {
      fx.points += this.perfectPts;
      fx.toastKey = 'event.snack.perfect';
    }
    // 첫 입(gap = ∞)은 바삭·바스락 판정 없음
    if (ctx.seen) fx.suspicion += this.gazeSusp;
    return this.bites >= this.required ? 'success' : 'running';
  }
  view(): ActivityView {
    return { kind: 'snack', bites: this.bites, required: this.required, sinceLast: this.sinceLast, window: this.perfect };
  }
}

const bool = (p: Readonly<Record<string, unknown>>, k: string, d: boolean): boolean => (typeof p[k] === 'boolean' ? p[k] as boolean : d);

/** 택배(fetch_carry): 보관함에서 꺼내기 pickupSec(탭 = 일시정지·휴대폰 보는 척). 끝나면 상자 들고 자리로(carry) */
class FetchActivity implements Activity {
  readonly mechanic = 'fetch_carry' as const;
  posture: ActivityPosture = 'activity';
  activityScale = 1;
  private t = 0;
  private paused = false;
  private readonly total: number;
  private readonly tapPauses: boolean;
  constructor(p: Readonly<Record<string, unknown>>) {
    this.total = num(p, 'pickupSec', 1.5);
    this.tapPauses = bool(p, 'tapPauses', true);
  }
  tick(dt: number, _c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.paused) return 'running';
    this.t += dt;
    if (this.t >= this.total) { fx.event = 'parcelPicked'; return 'success'; }
    return 'running';
  }
  tap(): ActivityStatus {
    if (!this.tapPauses) return 'running';
    this.paused = !this.paused;
    this.posture = this.paused ? 'paused' : 'activity';
    return 'running';
  }
  view(): ActivityView { return { kind: 'fetch', progress: this.t, total: this.total, paused: this.paused }; }
}

/** 출력 시작(자리, startAtSeatSec). 끝나면 DaySim이 PrintJob을 만들고 프린터로 보낸다 */
class RemoteStartActivity implements Activity {
  readonly mechanic = 'remote_start_fetch' as const;
  posture: ActivityPosture = 'activity';
  activityScale = 1;
  private t = 0;
  private readonly total: number;
  constructor(p: Readonly<Record<string, unknown>>) { this.total = num(p, 'startAtSeatSec', 0.5); }
  tick(dt: number, _c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    this.t += dt;
    if (this.t >= this.total) { fx.event = 'printStart'; return 'success'; }
    return 'running';
  }
  tap(): ActivityStatus { return 'running'; }
  view(): ActivityView { return { kind: 'remote_start', progress: this.t, total: this.total }; }
}

/** 프린터에서 집기: 다 나오면 탭 = 집기(grab_when_done). 덜 나왔을 때 탭 = 출력 일시정지/재개(tapEarly 'pause') */
class GrabActivity implements Activity {
  readonly mechanic = 'remote_start_fetch' as const;
  posture: ActivityPosture = 'paused';
  activityScale = 1;
  constructor(private readonly job: PrintJob, private readonly tapEarly: string) {}
  tick(): ActivityStatus { return 'running'; }
  tap(_c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.job.done) { this.job.grabbed = true; fx.event = 'printGrab'; return 'success'; }
    if (this.tapEarly === 'pause') { this.job.paused = !this.job.paused; fx.event = this.job.paused ? 'printPause' : 'printResume'; }
    return 'running';
  }
  view(): ActivityView { return { kind: 'grab', pages: this.job.pages, pagesRequired: this.job.pagesRequired, done: this.job.done, paused: this.job.paused }; }
}

/** 카페(queue_wait_tap): 주문 orderSec(탭 = 일시정지) → '컵 나왔어요' 전조 pickupTellSec → pickupWindowSec 안에 탭 = 성공(컵 들고 자리로).
 *  전조 중 탭·창 놓침 = 놓침(딸깍 소음 missNoiseSuspicion), missRetrySec 뒤 다시 전조. 놓침이 maxMissedPickups를 넘으면 실패 */
class QueueActivity implements Activity {
  readonly mechanic = 'queue_wait_tap' as const;
  posture: ActivityPosture = 'activity';
  activityScale = 1;
  private stage: 'order' | 'tell' | 'window' | 'retry' = 'order';
  private t = 0;
  private paused = false;
  private missed = 0;
  private readonly p: { order: number; tell: number; window: number; retry: number; maxMissed: number; noise: number; tapPauses: boolean };
  constructor(p: Readonly<Record<string, unknown>>) {
    this.p = {
      order: num(p, 'orderSec', 2.5), tell: num(p, 'pickupTellSec', 0.6), window: num(p, 'pickupWindowSec', 0.6),
      retry: num(p, 'missRetrySec', 1), maxMissed: num(p, 'maxMissedPickups', 2), noise: num(p, 'missNoiseSuspicion', 0.04),
      tapPauses: bool(p, 'tapPauses', true),
    };
  }
  private miss(fx: ActivityEffects): ActivityStatus {
    this.missed++;
    fx.suspicion += this.p.noise;
    fx.noise = { radius: 0, idleTo: Infinity };
    fx.event = 'cafeMiss';
    fx.toastKey = 'event.result.fail';
    if (this.missed > this.p.maxMissed) return 'fail';
    this.stage = 'retry'; this.t = 0;
    return 'running';
  }
  tick(dt: number, _c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.stage === 'order' && this.paused) return 'running';
    this.t += dt;
    switch (this.stage) {
      case 'order': if (this.t >= this.p.order) { this.stage = 'tell'; this.t = 0; fx.event = 'cupReady'; } break;
      case 'retry': if (this.t >= this.p.retry) { this.stage = 'tell'; this.t = 0; fx.event = 'cupReady'; } break;
      case 'tell': if (this.t >= this.p.tell) { this.stage = 'window'; this.t = 0; } break;
      case 'window': if (this.t > this.p.window) return this.miss(fx); break;
    }
    return 'running';
  }
  tap(_c: ActivityCtx, fx: ActivityEffects): ActivityStatus {
    if (this.stage === 'order') {
      if (this.p.tapPauses) { this.paused = !this.paused; this.posture = this.paused ? 'paused' : 'activity'; }
      return 'running';
    }
    if (this.stage === 'window') { fx.event = 'cupPicked'; return 'success'; }
    if (this.stage === 'tell') return this.miss(fx);
    return 'running';
  }
  view(): ActivityView {
    const total = this.stage === 'order' ? this.p.order : this.stage === 'tell' ? this.p.tell : this.stage === 'window' ? this.p.window : this.p.retry;
    return { kind: 'queue', stage: this.stage, progress: this.t, total, paused: this.paused, missed: this.missed, maxMissed: this.p.maxMissed };
  }
}

export function createGrabActivity(job: PrintJob, params: Readonly<Record<string, unknown>>): Activity {
  return new GrabActivity(job, typeof params['tapEarly'] === 'string' ? params['tapEarly'] as string : 'pause');
}

export function createActivity(mechanic: Mechanic, params: Readonly<Record<string, unknown>>, opts: { snackBiteMul?: number } = {}): Activity {
  switch (mechanic) {
    case 'fetch_carry': return new FetchActivity(params);
    case 'remote_start_fetch': return new RemoteStartActivity(params);
    case 'queue_wait_tap': return new QueueActivity(params);
    case 'pour_tap_stop': return new PourActivity(params);
    case 'trip_safe_zone': return new RestroomActivity(params);
    case 'nap_tap_toggle': return new NapActivity(params);
    case 'screen_swap_tap': return new ShopActivity(params);
    case 'rhythm_tap': return new SnackActivity(params, opts.snackBiteMul ?? 1);
  }
}
