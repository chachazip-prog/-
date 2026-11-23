/**
 * 인사 QTE(bosses.ceo.greetingQte) — 대표님 순시(INT-09)와 엘리베이터 대표님(INT-11) 공용. 렌더링 무관.
 *
 *   precue('?', preCueSecRange 추첨) ──▶ window('!', windowSec × 배율) ──▶ done
 *   - precue 중 누름 = early(너무 빠름)
 *   - window 중 누르고 maxPressSec 이하로 뗌 = success, 더 길게 누름 = long(길게 누름)
 *   - window가 끝날 때까지 안 누름 = miss
 * 결과에 따른 의심 가산은 호출 측(DaySim)이 penaltyOf()로 적용한다. 무작위는 주입한 시드 RNG만 쓴다.
 */
import type { Rng } from '../rng';
import type { QteDef } from './types';

export type QteResult = 'success' | 'early' | 'miss' | 'long';
export type QtePhase = 'precue' | 'window' | 'done';

export class GreetQte {
  phase: QtePhase = 'precue';
  /** 시작 후 경과(초) */
  t = 0;
  readonly preCueSec: number;
  readonly windowSec: number;
  result: QteResult | null = null;
  private pressedAt: number | null = null;

  constructor(private readonly def: QteDef, rng: Rng, windowScale = 1) {
    const [a, b] = def.preCueSecRange;
    this.preCueSec = a === b ? a : rng.range(a, b);
    this.windowSec = def.windowSec * windowScale;
  }

  /** 진행. 이번 스텝에 결과가 나면 그 결과를 돌려준다 */
  step(dt: number): QteResult | null {
    if (this.phase === 'done') return null;
    this.t += dt;
    if (this.phase === 'precue' && this.t >= this.preCueSec) this.phase = 'window';
    if (this.pressedAt !== null && this.t - this.pressedAt > this.def.maxPressSec) return this.finish('long');
    if (this.phase === 'window' && this.pressedAt === null && this.t >= this.preCueSec + this.windowSec) return this.finish('miss');
    return null;
  }

  /** 누름 시작 */
  press(): QteResult | null {
    if (this.phase === 'done' || this.pressedAt !== null) return null;
    if (this.phase === 'precue') return this.finish('early');
    this.pressedAt = this.t;
    return null;
  }

  /** 뗌. pressSec = 실제 누른 시간(씬이 측정). 헤드리스 봇은 짧은 값을 넘기면 된다 */
  release(pressSec: number): QteResult | null {
    if (this.phase === 'done' || this.pressedAt === null) return null;
    return this.finish(pressSec > this.def.maxPressSec ? 'long' : 'success');
  }

  get pressing(): boolean { return this.pressedAt !== null && this.phase !== 'done'; }

  penaltyOf(r: QteResult): number {
    switch (r) {
      case 'early': return this.def.earlyPenalty;
      case 'miss': return this.def.missPenalty;
      case 'long': return this.def.longPressPenalty;
      default: return 0;
    }
  }

  private finish(r: QteResult): QteResult {
    this.result = r;
    this.phase = 'done';
    return r;
  }
}
