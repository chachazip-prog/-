/**
 * 미션 변형(modifier) (REQ-015, T-144 확장 지점 → T-145 missions.json 연동). 순수 TS.
 *  - applyMissionModifiers: 정적 변형(제한 시간·장소·params·무조건 보상 배수)을 MissionDef에 반영. 조건 있는 변형은 def.modifiers로 남긴다
 *  - evaluateMissionConditions: 완료 시점 조건 판정(DaySim이 호출)
 * 조건 레지스트리 = missions.json conditions[] 10종(T-144 3종 + T-145 7종).
 */
import type { Tile } from '../grid';
import type { MissionDef, MissionModifier } from './types';

/** 조건 판정에 쓰는 미션 진행 기록(missions.json conditions[].statsNeeded) */
export interface MissionRunStats {
  /** 미션 시작(자리 떠남/행동 시작) 후 경과(초, 얼음 정지 시간 제외) */
  readonly elapsedSec: number;
  /** 시작 시점 대비 의심 증가량(0~1) */
  readonly suspicionGain: number;
  /** 진행 중 시선에 걸린 누적 시간(초) */
  readonly seenSec: number;
  // ── T-145 ──
  /** 변형 적용 뒤 제한 시간(within_frac) */
  readonly timeLimitSec?: number;
  /** 액터별 '화면 안에서 콘에 걸린' 누적 시간(초). 위장 중이라도 콘 안이면 셈 */
  readonly seenSecBy?: Readonly<Record<string, number>>;
  /** 소음 이벤트 수(간식 바스락, 커피·창가 넘침, 수다 빵 터짐, 카페 놓침 딸깍) */
  readonly noiseCount?: number;
  /** 밟은 서로 다른 엄폐 칸 수 */
  readonly coverTilesVisited?: number;
  /** '아슬아슬!' 횟수 */
  readonly closeCalls?: number;
  /** 시작 순간 상태 */
  readonly startState?: { readonly tlAway: boolean };
  /** 완료 순간 게임 시계(분) */
  readonly completedAtClock?: number;
}

export type MissionCondition = (stats: MissionRunStats, args: Readonly<Record<string, unknown>>) => boolean;

const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clockMin = (v: unknown): number => {
  const m = typeof v === 'string' ? /^(\d+):(\d+)$/.exec(v) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : Infinity;
};

/** 조건 레지스트리. 새 조건은 여기에 이름으로 추가(데이터는 이름과 args만 참조) */
export const MISSION_CONDITIONS: Record<string, MissionCondition> = {
  /** 시선에 걸린 시간 ≤ args.maxSeenSec(기본 0) */
  unseen: (s, a) => s.seenSec <= n(a['maxSeenSec'], 0) + 1e-9,
  /** 의심 증가 ≤ args.max */
  max_suspicion_gain: (s, a) => s.suspicionGain <= n(a['max'], 0) + 1e-9,
  /** 시작 후 args.sec 안에 완료 */
  within_sec: (s, a) => s.elapsedSec <= n(a['sec'], Infinity),
  /** (변형 적용 뒤 제한 시간 × frac) 안에 완료 */
  within_frac: (s, a) => s.elapsedSec <= n(s.timeLimitSec, Infinity) * n(a['frac'], 1) + 1e-9,
  /** 지정 인물 콘(화면 안)에 걸린 시간 ≤ maxSeenSec */
  unseen_by: (s, a) => {
    const ids = Array.isArray(a['actorIds']) ? (a['actorIds'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const by = s.seenSecBy ?? {};
    return ids.every((id) => (by[id] ?? 0) <= n(a['maxSeenSec'], 0) + 1e-9);
  },
  no_noise: (s) => (s.noiseCount ?? 0) === 0,
  touched_cover: (s, a) => (s.coverTilesVisited ?? 0) >= n(a['min'], 1),
  close_call_count: (s, a) => (s.closeCalls ?? 0) >= n(a['min'], 1),
  started_while: (s, a) => (a['state'] === 'tl_away' ? s.startState?.tlAway === true : false),
  before_clock: (s, a) => (s.completedAtClock ?? Infinity) < clockMin(a['time']),
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
  let startsAt = def.startsAt, completeAt = def.completeAt, awayFromDesk = def.awayFromDesk;
  let availability = def.availability;
  let zoneOnly = def.zoneOnlyRevealTiles;
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
      const name = m.spot.split('|').find((s) => spots[s]);
      const s = name ? spots[name] : undefined;
      if (s) spot = s.tile; else warn.push(`미션 ${def.id} 변형 ${m.id}: 스팟 ${m.spot} 없음(장소 유지)`);
    }
    if (m.params) {
      const { startsAt: sa, completeAt: ca, awayFromDesk: af, ...rest } = m.params as Record<string, unknown>;
      // relocate.snack_pantry·bank_stall: 자리 미션 → 자리 밖 미션(스키마 §5 🔧)
      if (sa === 'arrive_spot' || sa === 'chip_tap_at_seat') startsAt = sa;
      if (ca === 'return_to_seat' || ca === 'on_success') completeAt = ca;
      if (typeof af === 'boolean') awayFromDesk = af;
      params = { ...params, ...rest };
      if (typeof rest['revealRadiusTiles'] === 'number' && rest['hint'] === 'zone_only') zoneOnly = rest['revealRadiusTiles'] as number;
    }
    if (m.availability) availability = m.availability;
    if (m.condition) {
      if (!MISSION_CONDITIONS[m.condition.id]) warn.push(`미션 ${def.id} 변형 ${m.id}: 조건 ${m.condition.id} 미구현(무시)`);
      else conditional.push(m);
    } else if (m.rewardMul !== undefined) slack = Math.round(slack * m.rewardMul);
  }
  return {
    ...def, timeLimitSec, spot, params, startsAt, completeAt, awayFromDesk, reward: { ...def.reward, slackPoints: slack },
    modifierIds: [...(def.modifierIds ?? []), ...mods.map((m) => m.id)],
    modifierTypes: [...(def.modifierTypes ?? []), ...mods.map((m) => m.type ?? m.id.split('.')[0]!)],
    ...(availability ? { availability } : {}),
    ...(zoneOnly !== undefined ? { zoneOnlyRevealTiles: zoneOnly } : {}),
    ...(conditional.length > 0 ? { modifiers: conditional } : {}),
  };
}

/** 완료 시점 조건 판정: 보상 배수(충족한 변형의 rewardMul 곱)와 '실패 처리' 여부 */
export function evaluateMissionConditions(def: MissionDef, stats: MissionRunStats): { rewardMul: number; fail: boolean; met: string[]; missed: string[] } {
  let rewardMul = 1;
  let fail = false;
  const met: string[] = [], missed: string[] = [];
  const st: MissionRunStats = stats.timeLimitSec === undefined ? { ...stats, timeLimitSec: def.timeLimitSec } : stats;
  for (const m of def.modifiers ?? []) {
    const c = m.condition;
    if (!c) continue;
    const fn = MISSION_CONDITIONS[c.id];
    if (!fn) continue;
    if (fn(st, c.args ?? {})) { met.push(m.id); rewardMul *= m.rewardMul ?? 1; }
    else { missed.push(m.id); if (c.onFail === 'fail') fail = true; }
  }
  return { rewardMul, fail, met, missed };
}
