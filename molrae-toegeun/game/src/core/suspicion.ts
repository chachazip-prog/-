/**
 * 의심 게이지 갱신 규칙 (0 ~ max).
 * - 노출(어느 NPC든 플레이어를 봄) 시 플레이어 상태별 초당 상승률 × NPC 배율(동시 시선은 최댓값 하나만, rules.json gazeStacking=max와 동일 취지)
 * - 이동 중 노출: 급상승 / 위장 중 노출: 완만 / 정지(idle): 별도 값
 * - 말걸기(talked) 중에는 상승 0 (D-043: 조작 불가 상태에서 손해 금지, 시간 손실만). 코드로 고정한다
 * - 위장 직후 settleSec 동안은 아직 '움직이는 중'으로 본다(멈춤 타이밍 판정)
 * - 노출이 시작된 뒤 graceSec 안에는 상승하지 않는다(입력 유예, rules.json input.inputGraceSec 취지)
 * - 비노출 + 이동 중이 아닐 때 decayPerSec만큼 감소
 */
import type { PlayerMode } from './player';

export interface SuspicionRules {
  readonly max: number;
  readonly movingPerSec: number;
  readonly idlePerSec: number;
  readonly disguisedPerSec: number;
  /** @deprecated D-043으로 무시됨(말걸기 중 상승 0 고정). 기존 데이터·도구 호환용으로만 남김 */
  readonly talkedPerSec: number;
  readonly disguiseSettleSec: number;
  readonly graceSec: number;
  readonly decayPerSec: number;
  // ── v2 확장(rules.json suspicion). 없으면 T-123 동작 ──
  /** 자리에서 일하는 중(X9) */
  readonly seatedWorkingPerSec?: number;
  /** 미션 행동 중(X9) */
  readonly activityPerSec?: number;
  /** 미션 일시정지·위장(X9) */
  readonly activityPausedPerSec?: number;
  /** 위장한 채 콘 안에 이 시간을 넘게 있으면 disguiseStalePerSec 적용(X5) */
  readonly disguiseStaleAfterSec?: number;
  readonly disguiseStalePerSec?: number;
  /** 엄폐물 옆이면 위장 정체 가산 면제 */
  readonly disguiseStaleExemptNearCover?: boolean;
  /** 멈춘 상태(idle)를 모두 위장으로 간주(X5) */
  readonly anyStopIsDisguised?: boolean;
}

export interface SuspicionState {
  value: number;
  peak: number;
  /** 연속 노출 시간(초). 0이면 비노출 */
  exposedSec: number;
}

export function createSuspicion(): SuspicionState {
  return { value: 0, peak: 0, exposedSec: 0 };
}

export function exposureRate(rules: SuspicionRules, mode: PlayerMode, modeTime: number): number {
  switch (mode) {
    case 'moving': return rules.movingPerSec;
    case 'disguised': return modeTime < rules.disguiseSettleSec ? rules.movingPerSec : rules.disguisedPerSec;
    case 'idle':
      // X5: 멈춤 = 위장. 도착 직후 settle 동안은 아직 움직이는 중으로 본다
      if (rules.anyStopIsDisguised) return modeTime < rules.disguiseSettleSec ? rules.movingPerSec : rules.disguisedPerSec;
      return rules.idlePerSec;
    case 'talked': return 0; // D-043 (rules.talkedPerSec 무시)
  }
}

/**
 * @param gazeMultiplier 지금 플레이어를 보는 NPC들의 배율 중 최댓값. 아무도 안 보면 0
 */
export function updateSuspicion(
  s: SuspicionState,
  rules: SuspicionRules,
  gazeMultiplier: number,
  mode: PlayerMode,
  modeTime: number,
  dt: number,
): void {
  updateSuspicionRate(s, rules, gazeMultiplier, exposureRate(rules, mode, modeTime), dt, { decay: mode !== 'moving', stale: false });
}

export interface RateOptions {
  /** 비노출일 때 자연 감소를 적용하는가(이동 중이 아님) */
  readonly decay: boolean;
  /** 위장 정체 가산 대상인가(위장·멈춤 상태이고 엄폐물 옆이 아님, X5) */
  readonly stale: boolean;
}

/**
 * 상태별 초당 상승률(rate)을 직접 받는 버전 (DaySim: 자리 업무·미션 상태, X9).
 * 위장 정체(X5): stale이고 연속 노출이 disguiseStaleAfterSec를 넘으면 rate를 최소 disguiseStalePerSec로 올린다.
 */
export function updateSuspicionRate(
  s: SuspicionState, rules: SuspicionRules, gazeMultiplier: number, rate: number, dt: number, opts: RateOptions,
): void {
  if (gazeMultiplier > 0) {
    const prev = s.exposedSec;
    s.exposedSec += dt;
    const effective = Math.max(0, s.exposedSec - Math.max(prev, rules.graceSec));
    let r = rate;
    if (opts.stale && rules.disguiseStaleAfterSec !== undefined && rules.disguiseStalePerSec !== undefined
      && s.exposedSec > rules.disguiseStaleAfterSec) r = Math.max(r, rules.disguiseStalePerSec);
    s.value += r * gazeMultiplier * effective;
  } else {
    s.exposedSec = 0;
    if (opts.decay) s.value -= rules.decayPerSec * dt;
  }
  clampSuspicion(s, rules);
}

/** 즉시 가산(미션 실패·방해 도착 등). 음수면 감소 */
export function addSuspicion(s: SuspicionState, rules: SuspicionRules, amount: number): void {
  s.value += amount;
  clampSuspicion(s, rules);
}

function clampSuspicion(s: SuspicionState, rules: SuspicionRules): void {
  s.value = Math.min(rules.max, Math.max(0, s.value));
  if (s.value > s.peak) s.peak = s.value;
}
