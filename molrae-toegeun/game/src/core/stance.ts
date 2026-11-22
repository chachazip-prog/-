/**
 * 플레이어 자세(땡땡이/일하는 척) 상태 — 렌더링 무관 순수 로직.
 * D-001: 원터치 홀드/떼기. 가정: 홀드 = 땡땡이, 떼기 = 일하는 척 (기획서 확정 전 임시, PM 확인 필요).
 * 게이지·시선 판정은 기획 데이터(game/data/) 확정 후 이 계층에 추가한다.
 */
export type Stance = 'working' | 'slacking';

export interface StanceState {
  readonly stance: Stance;
  /** 현재 자세를 유지한 시간(ms) */
  readonly elapsedMs: number;
  /** 누적 땡땡이 시간(ms) */
  readonly totalSlackMs: number;
}

export const initialStanceState: StanceState = { stance: 'working', elapsedMs: 0, totalSlackMs: 0 };

export type StanceInput = { type: 'press' } | { type: 'release' } | { type: 'tick'; dtMs: number };

export function reduceStance(state: StanceState, input: StanceInput): StanceState {
  switch (input.type) {
    case 'press':
      return state.stance === 'slacking' ? state : { ...state, stance: 'slacking', elapsedMs: 0 };
    case 'release':
      return state.stance === 'working' ? state : { ...state, stance: 'working', elapsedMs: 0 };
    case 'tick': {
      const dt = Math.max(0, input.dtMs);
      return {
        stance: state.stance,
        elapsedMs: state.elapsedMs + dt,
        totalSlackMs: state.totalSlackMs + (state.stance === 'slacking' ? dt : 0),
      };
    }
  }
}
