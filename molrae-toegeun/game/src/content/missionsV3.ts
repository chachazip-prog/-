/**
 * missions.json(schemaVersion 3, T-142) 연동 (T-145). 순수 TS.
 *  - 미션 풀(poolByRank, ranks.eventPool 대체)·데뷔 고정·저작일 얹기(authoredOverlays)
 *  - 변형 추첨(combination, 시드 스트림 `day-{n}-mission`, 기존 plan·boss·npc·event·leave 스트림 소비 순서 불변)
 *  - 시간 예산(days.generator.missions.budgetCheck, T-139) + 생성 맵 거리 보정 + 변형 budgetSecDelta
 * D-084: missions.json을 우선해서 읽고 ranks.json은 바꾸지 않는다. D-086: missions.enabled는 false 그대로 — 개발 파라미터(?missions=1)로 켠다.
 * 🔶 변형 추첨은 날짜 시드에 따른 난도 연출(모든 사용자 같은 결과)이고 보상 확률이 아니다(P13).
 */
import { createRng } from '../core/rng';
import { hhmm } from './time';

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
export type Tables = Readonly<Record<string, unknown>>;

const RANK_ORDER = ['intern', 'staff', 'assistant_manager', 'manager', 'deputy_general_manager', 'general_manager', 'executive'];
const rankIdx = (tables: Tables, id: string): number => {
  const r = arr(obj(tables['ranks'])['ranks']).map(obj).find((x) => x['id'] === id);
  return r ? num(r['order'], RANK_ORDER.indexOf(id) + 1) : RANK_ORDER.indexOf(id) + 1;
};

export function missionsTable(tables: Tables): O { return obj(tables['missions']); }
export function missionsV3Available(tables: Tables): boolean { return missionsTable(tables)['schemaVersion'] === 3; }
export function missionsEnabledInData(tables: Tables): boolean { return missionsV3Available(tables) && missionsTable(tables)['enabled'] === true; }

/** 미션 태그(missionPool.existing/new) */
export function missionTags(tables: Tables, id: string): string[] {
  const mp = obj(missionsTable(tables)['missionPool']);
  const m = [...arr(mp['existing']), ...arr(mp['new'])].map(obj).find((x) => x['id'] === id);
  return arr(m?.['tags']).map((x) => str(x));
}
function unlockDayOf(tables: Tables, id: string): number {
  const mp = obj(missionsTable(tables)['missionPool']);
  const m = [...arr(mp['existing']), ...arr(mp['new'])].map(obj).find((x) => x['id'] === id);
  return num(m?.['unlockDay'], 1);
}

/** poolByRank → eventPool 모양. unlockDay 미만 제외 */
export function poolForRank(tables: Tables, rankId: string, day: number): O[] {
  const pbr = obj(obj(missionsTable(tables)['missionPool'])['poolByRank'])[rankId];
  return Object.entries(obj(pbr)).filter(([k]) => !k.startsWith('_')).filter(([id]) => unlockDayOf(tables, id) <= day)
    .map(([id, w]) => ({ eventId: id, weight: num(w, 1) }));
}

/** 데뷔(missionPool.debuts): 그날 반드시 포함할 미션·튜토리얼·변형 금지 / 그날 꼭 나올 변형 type */
export function debutsFor(tables: Tables, day: number): { missions: { id: string; tutorialId?: string; noModifier: boolean }[]; modifierTypes: string[] } {
  const ds = arr(obj(missionsTable(tables)['missionPool'])['debuts']).map(obj).filter((d) => d['day'] === day);
  return {
    missions: ds.filter((d) => typeof d['missionId'] === 'string').map((d) => ({
      id: str(d['missionId']), ...(typeof d['tutorialId'] === 'string' ? { tutorialId: d['tutorialId'] as string } : {}), noModifier: d['noModifier'] === true,
    })),
    modifierTypes: ds.filter((d) => typeof d['modifierType'] === 'string').map((d) => str(d['modifierType'])),
  };
}

/** 저작일 얹기(6~15일차): days 계획 missions의 같은 eventId에 modifiers 추가 */
export function overlayPlan(tables: Tables, day: number, plan: O): O {
  const ov = arr(obj(obj(missionsTable(tables)['authoredOverlays'])['days'])[String(day)]).map(obj);
  if (ov.length === 0) return plan;
  const missions = arr(plan['missions']).map(obj).map((m) => {
    const o = ov.find((x) => x['eventId'] === m['eventId']);
    if (!o) return m;
    return { ...m, modifiers: [...arr(m['modifiers']), ...arr(o['modifiers'])], ...(o['ifSpotExists'] === true ? { modifiersIfSpotExists: true } : {}) };
  });
  return { ...plan, missions };
}

// ── 시간 예산(T-139 budgetCheck) ──────────────────────────

export interface BudgetInput {
  readonly tables: Tables;
  readonly rank: O;
  readonly plan: O;
  readonly dayPhaseSec: number;
  readonly startRequired: number;
  /** 미션별 예상 시간(초) */
  readonly expectedOf: (id: string) => number;
}

/** days.generator.missions.budgetCheck: need > dayPhaseSec − minSlackSec이고 required > minRequired이면 −1 반복 */
export function budgetCheckRequired(b: BudgetInput): { required: number; needSec: number } {
  const bc = obj(obj(obj(obj(b.tables['days'])['generator'])['missions'])['budgetCheck']);
  const missions = arr(b.plan['missions']).map(obj).map((m) => str(m['eventId']));
  const exp = missions.map(b.expectedOf).sort((x, y) => y - x);
  const fill = num(obj(obj(b.tables['rules'])['work'])['fillPerSec'], 0.04);
  const quotaSec = num(b.plan['workQuotaOverride'], num(b.rank['workQuota'], 0.4)) / Math.max(1e-6, fill);
  const reserveTbl = obj(obj(obj(b.tables['ranks'])['budgetModel'])['dayInterruptReserveSec']);
  const reserve = arr(b.plan['dayInterrupts']).map(obj).reduce((s, d) => s + num(reserveTbl[str(d['id'])], 0), 0);
  const need = (r: number) => exp.slice(0, r).reduce((s, x) => s + x, 0) + quotaSec + reserve;
  let r = Math.min(b.startRequired, missions.length);
  if (bc['enabled'] !== true) return { required: r, needSec: need(r) };
  const minReq = num(bc['minRequired'], 2), slack = num(bc['minSlackSec'], 0);
  while (r > minReq && need(r) > b.dayPhaseSec - slack) r--;
  return { required: r, needSec: Math.round(need(r) * 10) / 10 };
}

/** 미션 예상 시간: budgetModel.missionExpectedSec → missionPool.new.expectedDurationSec */
export function baseExpectedSec(tables: Tables, id: string): number {
  const m = obj(obj(obj(tables['ranks'])['budgetModel'])['missionExpectedSec']);
  if (typeof m[id] === 'number') return m[id] as number;
  const nu = arr(obj(missionsTable(tables)['missionPool'])['new']).map(obj).find((x) => x['id'] === id);
  return num(nu?.['expectedDurationSec'], 12);
}

// ── 변형 추첨(combination) ─────────────────────────────────

export interface ModDrawContext {
  readonly tables: Tables;
  readonly day: number;
  readonly rankId: string;
  readonly ceoDay: boolean;
  readonly plan: O;
  /** 그날 층에 있는 스팟 이름(없으면 스팟 검사 생략 — 기록용 근사 추첨) */
  readonly hasSpot?: (name: string) => boolean;
  /** '해금 뒤 + 충분히 긴' 팀장 순회 수(during_tour 조건). 모르면 생략 */
  readonly longTourCount?: number;
  /** 미션 예상 시간·제한·해금 시각 */
  readonly missionInfo: (id: string) => { expectedSec: number; timeLimitSec: number; unlockAtSec: number };
  /** 근무 구간 초 → 게임 시계(분) */
  readonly clockAt: (daySec: number) => number;
  /** 최근 생성일 기록(오래된 것부터): 미션별 붙은 type */
  readonly history?: readonly Readonly<Record<string, readonly string[]>>[];
  /** T-151: 그날 풀에 합류하는 추가 변형(genderModifiers, '{mine}' 치환 완료). 없으면 기존과 같은 추첨 */
  readonly extraModifiers?: readonly O[];
  /** zone_only를 붙일 수 있는 미션인가(목표 스폿이 내 자리와 다른 구역에 있음, gdd-v3 §10). 모르면 생략 */
  readonly zoneOnlyOk?: (missionId: string) => boolean;
}

export interface DrawnModifiers {
  /** 미션 id → 변형(id 문자열 또는 채운 객체) */
  readonly byMission: Record<string, (string | O)[]>;
  /** 미션 id → 붙은 type(기록용) */
  readonly types: Record<string, string[]>;
}

const fmtClock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

/** combination.rules 1~8 구현 */
export function drawModifiers(ctx: ModDrawContext): DrawnModifiers {
  const T = missionsTable(ctx.tables);
  const comb = obj(T['combination']);
  const mods = [...arr(T['modifiers']).map(obj), ...(ctx.extraModifiers ?? [])];
  const rank = ctx.rankId;
  const out: DrawnModifiers = { byMission: {}, types: {} };
  const range = arr(obj(comb['modifiedMissionsPerDay'])[rank]).map((v) => num(v, 0));
  const budget0 = num(obj(comb['costBudgetPerDay'])[rank], 0) + (ctx.ceoDay ? num(obj(comb['ceoDay'])['costBudgetDelta'], 0) : 0);
  const perMission = num(obj(comb['maxModifiersPerMission'])[rank], 0);
  const bonusRange = arr(comb['bonusPerDay']).map((v) => num(v, 0));
  const excl = arr(comb['excludePairs']).map((p) => arr(p).map((x) => str(x)));
  const never = arr(comb['neverModify']).map((x) => str(x));
  const rng = createRng(`day-${ctx.day}-mission`);
  let k = rng.int(range[0] ?? 0, range[1] ?? 0);
  if (ctx.ceoDay) k = Math.min(k, num(obj(comb['ceoDay'])['maxModifiedMissions'], 1));
  const nBonus = rng.int(bonusRange[0] ?? 0, bonusRange[1] ?? 0);
  const debut = debutsFor(ctx.tables, ctx.day);
  const plan = arr(ctx.plan['missions']).map(obj);
  const required = num(ctx.plan['missionsRequired'], plan.length);
  const ids = plan.map((m) => str(m['eventId'])).filter((id) => id && !never.includes(id) && !debut.missions.some((d) => d.id === id && d.noModifier));
  const hist = ctx.history ?? [];
  const yesterday = hist[hist.length - 1] ?? {};
  const lastSeen = (type: string): number => {
    for (let i = hist.length - 1; i >= 0; i--) if (Object.values(hist[i]!).some((ts) => ts.includes(type))) return hist.length - i;
    return hist.length + 1;
  };
  const ri = rankIdx(ctx.tables, rank);
  const interrupts = new Set([...arr(ctx.plan['dayInterrupts']), ...arr(ctx.plan['leaveInterrupts'])].map(obj).map((x) => str(x['id'])));
  const costOf = (m: O): number => num(obj(m['costByRank'])[rank], num(m['cost'], 0));
  const spotOk = (m: O): boolean => {
    if (typeof m['spot'] !== 'string' || !ctx.hasSpot) return true;
    return (m['spot'] as string).split('|').some((s) => ctx.hasSpot!(s));
  };
  const candidates = (id: string, kinds: readonly string[]): O[] => mods.filter((m) => {
    if (!kinds.includes(str(m['kind']))) return false;
    if (typeof m['minRank'] === 'string' && rankIdx(ctx.tables, m['minRank'] as string) > ri) return false;
    if (num(m['minDay'], 0) > ctx.day) return false;
    if (Array.isArray(m['missions']) && !arr(m['missions']).includes(id)) return false;
    if (Array.isArray(m['appliesToTags']) && !arr(m['appliesToTags']).some((tg) => missionTags(ctx.tables, id).includes(str(tg)))) return false;
    if (Array.isArray(m['requiresInterrupt']) && !arr(m['requiresInterrupt']).some((x) => interrupts.has(str(x)))) return false;
    if (!spotOk(m)) return false;
    const info = ctx.missionInfo(id);
    const type = str(m['type']);
    if (type === 'rush' && info.timeLimitSec < info.expectedSec + 4) return false;
    if (type === 'during_tour' && (ctx.longTourCount === undefined || ctx.longTourCount < 2)) return false;
    if (type === 'zone_only' && ctx.zoneOnlyOk && !ctx.zoneOnlyOk(id)) return false;
    if ((yesterday[id] ?? []).includes(type)) return false; // 같은 type 이틀 연속 같은 미션 금지
    return true;
  });
  const clash = (a: string, b: string) => excl.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  // 대상 미션: 필수 수만큼 앞 미션을 '필수 후보'로 보고 먼저, 어제 변형된 미션 ×0.5
  const left = ids.slice();
  let budget = budget0;
  let needNewModule = 0;
  const newModuleMissions = ['print', 'cafe', 'window'];
  const forcedTypes = debut.modifierTypes.slice();
  for (let i = 0; i < k && left.length > 0; i++) {
    const id = rng.weighted(left, (x) => (ids.indexOf(x) < required ? 2 : 1) * (yesterday[x] ? 0.5 : 1));
    if (!id) break;
    left.splice(left.indexOf(id), 1);
    // 데뷔 날 그 미션에는 하드 변형 금지(gdd-v3 §4-1), noModifier면 변형 없음(ids에서 이미 제외)
    let cands = candidates(id, debut.missions.some((d) => d.id === id) ? ['soft'] : ['hard', 'soft']);
    if (forcedTypes.length > 0 && cands.some((m) => forcedTypes.includes(str(m['type'])))) cands = cands.filter((m) => forcedTypes.includes(str(m['type'])));
    const chosen: O[] = [];
    while (chosen.length < Math.min(1, perMission) && cands.length > 0) {
      const m = rng.weighted(cands, (x) => 1 + lastSeen(str(x['type'])) / 3);
      if (!m) break;
      cands.splice(cands.indexOf(m), 1);
      if (costOf(m) > budget) continue;
      if (chosen.some((c) => clash(str(c['type']), str(m['type'])))) continue;
      if (ctx.ceoDay && str(m['type']) === 'relocate' && newModuleMissions.includes(id)) {
        if (needNewModule >= num(obj(comb['ceoDay'])['maxMissionsNeedingNewModule'], 1)) continue;
        needNewModule++;
      }
      chosen.push(m);
      budget -= costOf(m);
      const fi = forcedTypes.indexOf(str(m['type'])); if (fi >= 0) forcedTypes.splice(fi, 1);
    }
    for (const m of chosen) addMod(out, id, m, ctx);
  }
  // 보너스(cost 0): 하드 변형이 없는 미션 우선, 미션당 상한 안에서
  for (let b = 0; b < nBonus; b++) {
    const pool = ids.filter((id) => (out.types[id]?.length ?? 0) < perMission && !(out.types[id] ?? []).includes('bonus'));
    if (pool.length === 0) break;
    const id = rng.weighted(pool, (x) => ((out.types[x]?.length ?? 0) === 0 ? 2 : 1));
    if (!id) break;
    const cands = candidates(id, ['bonus']);
    const m = rng.weighted(cands, (x) => 1 + lastSeen(str(x['type'])) / 3);
    if (m) addMod(out, id, m, ctx);
  }
  return out;
}

function addMod(out: DrawnModifiers, id: string, m: O, ctx: ModDrawContext): void {
  const type = str(m['type']);
  (out.types[id] ??= []).push(type);
  let ref: string | O = str(m['id']);
  if (type === 'deadline') {
    // 시각 = 해금 + 예상 × 2를 10분 단위 올림(게임 시계)
    const info = ctx.missionInfo(id);
    const min = Math.ceil(ctx.clockAt(info.unlockAtSec + info.expectedSec * 2) / 10) * 10;
    const cond = obj(m['condition']);
    ref = { ...m, condition: { ...cond, args: { ...obj(cond['args']), time: fmtClock(min) } } };
  }
  (out.byMission[id] ??= []).push(ref);
}

/** 최근 생성일 변형 기록(근사: 각 날을 스팟 검사·기록 없이 추첨). 시드 고정이라 결정적 */
export function modifierHistory(make: (day: number) => ModDrawContext | null, day: number, back = 6): Record<string, string[]>[] {
  const out: Record<string, string[]>[] = [];
  for (let d = day - back; d < day; d++) {
    const c = d >= 1 ? make(d) : null;
    out.push(c ? drawModifiers({ ...c, history: [] }).types : {});
  }
  return out;
}

/**
 * T-151: missions.genderModifiers(genderFacilities.enabled일 때만 풀 합류). spot의 '{mine}'은 그날 내 쪽(탈의실은 locker_side)으로 치환.
 * 반환 객체는 modifiers[]와 같은 모양(parseModifiers·drawModifiers 공용)
 */
export function genderModifierLib(tables: Tables, mine: 'a' | 'b', lockerMine: 'a' | 'b'): O[] {
  return arr(missionsTable(tables)['genderModifiers']).map(obj).map((m) => {
    if (typeof m['spot'] !== 'string') return m;
    const sp = m['spot'] as string;
    return { ...m, spot: sp.replace('{mine}', sp.startsWith('locker_') ? lockerMine : mine) };
  });
}

/** 시설 미션인가(missionPool.existing[].targetFacility) */
export function isFacilityMission(tables: Tables, id: string): boolean {
  const m = arr(obj(missionsTable(tables)['missionPool'])['existing']).map(obj).find((x) => x['id'] === id);
  return typeof m?.['targetFacility'] === 'string';
}

export { hhmm, fmtClock };
