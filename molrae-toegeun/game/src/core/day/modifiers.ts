/**
 * 미션 변형(modifier) 확장 지점 (REQ-015, T-144). 순수 TS.
 *  - applyMissionModifiers: 정적 변형(제한 시간·장소·params·무조건 보상 배수)을 MissionDef에 반영. 조건 있는 변형은 def.modifiers로 남긴다
 *  - evaluateMissionConditions: 완료 시점 조건 판정(DaySim이 호출)
 * 구체 변형·조건 목록은 T-142 기획 데이터가 정한다. MISSION_CONDITIONS의 항목은 동작 확인용 일반 조건이다([임시]).
 */
import type { Tile } from '../grid';
import type { MissionDef, MissionModifier } from './types';

/** 조건 판정에 쓰는 미션 진행 기록 */
export interface MissionRunStats {
  /** 미션 시작(자리 떠남/행동 시작) 후 경과(초) */
  readonly elapsedSec: number;
  /** 시작 시점 대비 의심 증가량(0~1) */
  readonly suspicionGain: number;
  /** 진행 중 시선에 걸린 누적 시간(초) */
  readonly seenSec: number;
}

export type MissionCondition = (stats: MissionRunStats, args: Readonly<Record<string, unknown>>) => boolean;

const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 조건 레지스트리. 새 조건은 여기에 이름으로 추가(데이터는 이름과 args만 참조) */
export const MISSION_CONDITIONS: Record<string, MissionCondition> = {
  /** 시선에 걸린 시간 ≤ args.maxSeenSec(기본 0) */
  unseen: (s, a) => s.seenSec <= n(a['maxSeenSec'], 0) + 1e-9,
  /** 의심 증가 ≤ args.max */
  max_suspicion_gain: (s, a) => s.suspicionGain <= n(a['max'], 0) + 1e-9,
  /** 시작 후 args.sec 안에 완료 */
  within_sec: (s, a) => s.elapsedSec <= n(a['sec'], Infinity),
};

export interface ModifierWarnings { push(msg: string): void }

/** 정적 변형 반영. spots = 이 층의 스팟(장소 바꾸기용) */
export function applyMissionModifiers(
  def: MissionDef, mods: readonly MissionModifier[], spots: Readonly<Record<string, { readonly tile: Tile }>>,
  warn: ModifierWarnings = { push: () => {} },
): MissionDef {
  if (mods.length === 0) return def;
  let timeLimitSec = def.timeLimitSec;
  let spot = def.spot;
  let params: Record<string, unknown> = { ...def.params };
  let slack = def.reward.slackPoints;
  const conditional: MissionModifier[] = [];
  for (const m of mods) {
    const tl = m.timeLimit;
    if (tl) {
      if (tl.set !== undefined) timeLimitSec = tl.set;
      if (tl.mul !== undefined) timeLimitSec *= tl.mul;
      if (tl.add !== undefined) timeLimitSec += tl.add;
      timeLimitSec = Math.max(1, timeLimitSec);
    }
    if (m.spot !== undefined) {
      const s = spots[m.spot];
      if (s) spot = s.tile; else warn.push(`미션 ${def.id} 변형 ${m.id}: 스팟 ${m.spot} 없음(장소 유지)`);
    }
    if (m.params) params = { ...params, ...m.params };
    if (m.condition) {
      if (!MISSION_CONDITIONS[m.condition.id]) warn.push(`미션 ${def.id} 변형 ${m.id}: 조건 ${m.condition.id} 미구현(무시)`);
      else conditional.push(m);
    } else if (m.rewardMul !== undefined) slack = Math.round(slack * m.rewardMul);
  }
  return {
    ...def, timeLimitSec, spot, params, reward: { ...def.reward, slackPoints: slack },
    ...(conditional.length > 0 ? { modifiers: conditional } : {}),
  };
}

/** 완료 시점 조건 판정: 보상 배수(충족한 변형의 rewardMul 곱)와 '실패 처리' 여부 */
export function evaluateMissionConditions(def: MissionDef, stats: MissionRunStats): { rewardMul: number; fail: boolean; met: string[]; missed: string[] } {
  let rewardMul = 1;
  let fail = false;
  const met: string[] = [], missed: string[] = [];
  for (const m of def.modifiers ?? []) {
    const c = m.condition;
    if (!c) continue;
    const fn = MISSION_CONDITIONS[c.id];
    if (!fn) continue;
    if (fn(stats, c.args ?? {})) { met.push(m.id); rewardMul *= m.rewardMul ?? 1; }
    else { missed.push(m.id); if (c.onFail === 'fail') fail = true; }
  }
  return { rewardMul, fail, met, missed };
}
