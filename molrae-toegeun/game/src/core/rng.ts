/**
 * 시드 기반 난수 (렌더링 무관 순수 TS). 같은 시드 → 같은 수열 → 같은 하루.
 * 알고리즘: 문자열 시드 → cyrb128 해시 → sfc32 생성기. Math.random 사용 금지.
 */
export interface Rng {
  /** [0, 1) 실수 */
  next(): number;
  /** [min, max] 정수 (양끝 포함) */
  int(min: number, max: number): number;
  /** [min, max) 실수 */
  range(min: number, max: number): number;
  /** 확률 p(0~1)로 true */
  chance(p: number): boolean;
  /** 배열에서 하나 선택. 빈 배열이면 undefined */
  pick<T>(items: readonly T[]): T | undefined;
  /** 가중치 선택. 가중치 합이 0 이하면 undefined */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T | undefined;
  /** 새 배열로 섞기 (Fisher–Yates) */
  shuffle<T>(items: readonly T[]): T[];
  /** 현재 내부 상태 (세이브/리플레이용) */
  getState(): RngState;
}

export type RngState = readonly [number, number, number, number];

function cyrb128(str: string): RngState {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** 시드(문자열/숫자) 또는 저장된 상태로 RNG 생성 */
export function createRng(seed: string | number | RngState): Rng {
  let [a, b, c, d] = typeof seed === 'object' ? seed : cyrb128(String(seed));

  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };

  // 상태 시드가 아닐 때 초기 편향 제거용 워밍업
  if (typeof seed !== 'object') for (let i = 0; i < 15; i++) next();

  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    range: (min, max) => next() * (max - min) + min,
    chance: (p) => next() < p,
    pick: (items) => (items.length === 0 ? undefined : items[Math.floor(next() * items.length)]),
    weighted: (items, weightOf) => {
      let total = 0;
      for (const it of items) total += Math.max(0, weightOf(it));
      if (total <= 0) return undefined;
      let roll = next() * total;
      for (const it of items) {
        roll -= Math.max(0, weightOf(it));
        if (roll < 0) return it;
      }
      return items[items.length - 1];
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = tmp;
      }
      return out;
    },
    getState: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };
  return rng;
}

/** 일자 시드 규칙(임시): "day-<번호>". 기획 확정 시 교체 */
export function daySeed(dayIndex: number, salt = ''): string {
  return `day-${dayIndex}${salt ? `-${salt}` : ''}`;
}
