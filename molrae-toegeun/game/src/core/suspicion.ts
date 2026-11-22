/**
 * 의심 게이지 갱신 규칙 (0 ~ max).
 * - 노출(어느 NPC든 플레이어를 봄) 시 플레이어 상태별 초당 상승률 × NPC 배율(동시 시선은 최댓값 하나만, rules.json gazeStacking=max와 동일 취지)
 * - 이동 중 노출: 급상승 / 위장 중 노출: 완만 / 정지(idle)·말걸기: 별도 값
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
  readonly talkedPerSec: number;
  readonly disguiseSettleSec: number;
  readonly graceSec: number;
  readonly decayPerSec: number;
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
    case 'idle': return rules.idlePerSec;
    case 'talked': return rules.talkedPerSec;
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
  if (gazeMultiplier > 0) {
    const prev = s.exposedSec;
    s.exposedSec += dt;
    const effective = Math.max(0, s.exposedSec - Math.max(prev, rules.graceSec));
    s.value += exposureRate(rules, mode, modeTime) * gazeMultiplier * effective;
  } else {
    s.exposedSec = 0;
    if (mode !== 'moving') s.value -= rules.decayPerSec * dt;
  }
  s.value = Math.min(rules.max, Math.max(0, s.value));
  if (s.value > s.peak) s.peak = s.value;
}
