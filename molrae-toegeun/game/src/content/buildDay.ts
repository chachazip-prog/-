/**
 * game/data/*.json v2 → DayContent 조립 (design/data-schema.md §0-1). 순수 함수 — Vite·Phaser 무관.
 * 씬은 data/loader.ts의 테이블을, QA는 fs로 읽은 테이블을 넘기면 같은 결과를 얻는다.
 *
 * 데이터에 값이 없을 때 쓰는 기본값은 DEFAULTS에 모았다(D-054: 기획이 데이터에 추가 예정인 임시값).
 */
import { createRng } from '../core/rng';
import type { FloorRules, LevelDef } from '../core/floorSim';
import { buildGridMap, nearestWalkable, type Tile } from '../core/grid';
import { findPath } from '../core/pathfinding';
import type { ConeState, NpcDef, TalkDef, WaypointDef } from '../core/patrol';
import type { Dir } from '../core/vision';
import type {
  AccompliceDef, ActorInfo, BackgroundDef, BossTourDef, CeoElevatorDef, CeoVisitDef, DayContent, DayInterruptDef, GreetingDef, LeaveDef, Mechanic,
  MissionDef, MissionModifier, QteDef, RouteDef, ScriptedBeat,
} from '../core/day/types';
import { applyMissionModifiers } from '../core/day/modifiers';
import { applyInterpScaling, applyOverrideScaling, rankProgress } from './scaling';
import { createLevelProvider, layoutEnabledInData, remapWaypoints, type LevelProvider } from './levelProvider';
import { buildDevTour } from './devTour';
import { buildLeadTour, longTourCount } from './leadRoaming';
import { parseLayoutV3 } from './layoutGen/v3data';
import { bfsDist, occupiedSet } from './layoutGen/v3gen';
import { missionRaw } from './levelV3';
import {
  baseExpectedSec, budgetCheckRequired, debutsFor, drawModifiers, missionTags, missionsEnabledInData, missionsTable, modifierHistory,
  overlayPlan, poolForRank, type ModDrawContext,
} from './missionsV3';
import { mergedStrings } from './strings';
import { castRelation, dayCasting, genderDayCtx, genderFacilityConfig, renderSkins, type GenderDayCtx, type PlayerVariant } from './gender';
import { facilityTiles } from './levelV3';
import { genderModifierLib, isFacilityMission } from './missionsV3';
import type { FacilityDef, FacilitySideDef, FacilityStopDef } from '../core/day/types';

/** 데이터 미정 기본값 (D-054). 데이터에 같은 이름의 값이 생기면 그쪽이 우선 */
export const DEFAULTS = {
  /** 결과 화면 표시 직후 탭을 무시하는 시간(BUG-006). rules.ui.resultInputGuardSec 예정 */
  resultInputGuardSec: 0.6,
  /** 말걸기 문구 대체 키 */
  talkWarnKey: 'talk.warn_default',
  talkDodgedKey: 'talk.dodged_default',
  /** 말걸기 전조 최소(rules.talk.tellSecMin이 있으면 그 값) */
  talkWarnSec: 0.5,
  /** 대표님 순시 예정 시각 비율(생성기가 ceoAtSec를 주지 않은 경우) */
  ceoAtFrac: 0.55,
  /** [임시 추정] 낮잠·회의 시각 조정에서 팀장이 회의실까지 걷는 시간(초). 기획이 데이터로 주면 교체 */
  meetingWalkEstSec: 4,
} as const;

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const range2 = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : undefined;
const tile2 = (v: unknown): Tile => (Array.isArray(v) ? { x: num(v[0], 0), y: num(v[1], 0) } : { x: num(obj(v)['x'], 0), y: num(obj(v)['y'], 0) });

const commitRule = (v: unknown): 'activity_start' | 'first_input' => (v === 'first_input' ? 'first_input' : 'activity_start');
function accompliceEffectOf(e: O): NonNullable<MissionDef['accompliceEffect']> {
  return {
    ...(typeof e['cupsRequired'] === 'number' ? { cupsRequired: e['cupsRequired'] as number } : {}),
    ...(typeof e['bitesRequiredMultiplier'] === 'number' ? { bitesRequiredMultiplier: e['bitesRequiredMultiplier'] as number } : {}),
  };
}

import { hhmm } from './time';
export { hhmm };

/** rules.day의 'HH:MM' 시각(분). 없거나 형식이 틀리면 예외(시각 기본값을 코드에 두지 않음, BUG-011) */
function clockOf(day: O, key: string): number {
  const v = day[key];
  if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) throw new Error(`content: rules.day.${key} 시각('HH:MM') 없음/형식 오류: ${String(v)}`);
  return hhmm(v);
}

function requiredNum(o: O, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`content: rules.day.${key} 양수 필요: ${String(v)}`);
  return v;
}

export type Tables = Readonly<Record<string, unknown>>;

export interface BuildWarnings { push(msg: string): void }

/** T-144: 층 공급자·순회 선택 */
export interface BuildOptions {
  /** 일차별 층 공급자. 없으면 데이터 기준 기본값(layout.json enabled면 3일차부터 생성, 아니면 모든 날 수작업 맵) */
  readonly levelProvider?: LevelProvider;
  /** 팀장 순회(D-075): true 강제 / false 끔 / 'auto'(기본) = 생성 층인 날만 */
  readonly tours?: boolean | 'auto';
  /** missions.json(v3) 사용: 미션 풀·새 미션 6종·변형 추첨·저작일 얹기. 없으면 missions.enabled(D-086: false) */
  readonly missionsV3?: boolean;
  /** T-151: 성별 시설 강제(true/false). 없으면 layout.genderFacilities.enabled(D-092: false) */
  readonly genderFacilities?: boolean;
  /** T-151: 플레이어 외형(그림 전용 content.skins에만 반영, 판정 무관). 없으면 기본 그림 */
  readonly playerVariant?: PlayerVariant | null;
}

export interface PlanOptions { readonly missionsV3?: boolean }

/**
 * 미션 변형 파싱([추측] T-142 스키마 전): 계획 항목의 modifiers = 변형 객체 또는 id 문자열 배열.
 * id는 tables.missions.modifiers[] (id 일치)에서 찾는다
 */
function parseModifiers(tables: Tables, raw: unknown, warn: BuildWarnings, rankId = '', extraLib: readonly O[] = []): MissionModifier[] {
  const lib = [...arr(obj(tables['missions'])['modifiers']).map(obj), ...extraLib];
  const out: MissionModifier[] = [];
  for (const r of arr(raw)) {
    const m = typeof r === 'string' ? lib.find((x) => x['id'] === r) : obj(r);
    if (!m || typeof m['id'] !== 'string') { warn.push(`미션 변형 ${JSON.stringify(r)} 정의 없음`); continue; }
    const tl = obj(m['timeLimit']);
    const cond = obj(m['condition']);
    // avoid: 직급별 onFail(onFailByRank), 없으면 condition.onFail
    const onFail = str(obj(m['onFailByRank'])[rankId], str(cond['onFail']));
    const av = obj(m['availability']);
    out.push({
      id: m['id'] as string,
      ...(typeof m['type'] === 'string' ? { type: m['type'] as string } : {}),
      ...(m['kind'] === 'hard' || m['kind'] === 'soft' || m['kind'] === 'bonus' ? { kind: m['kind'] as 'hard' | 'soft' | 'bonus' } : {}),
      ...(av['type'] === 'while_actor_away' ? { availability: { type: 'while_actor_away' as const, actorId: str(av['actorId'], 'team_lead') } } : {}),
      ...(typeof m['labelKey'] === 'string' ? { labelKey: m['labelKey'] as string } : {}),
      ...(typeof m['facilityLabelKey'] === 'string' ? { facilityLabelKey: m['facilityLabelKey'] as string } : {}),
      ...(m['timeLimit'] ? { timeLimit: {
        ...(typeof tl['set'] === 'number' ? { set: tl['set'] as number } : {}),
        ...(typeof tl['mul'] === 'number' ? { mul: tl['mul'] as number } : {}),
        ...(typeof tl['add'] === 'number' ? { add: tl['add'] as number } : {}),
      } } : {}),
      ...(typeof m['spot'] === 'string' ? { spot: m['spot'] as string } : {}),
      ...(typeof m['budgetSecDelta'] === 'number' || m['budgetSecDelta'] === 'travel_diff' ? { budgetSecDelta: m['budgetSecDelta'] as number | 'travel_diff' } : {}),
      ...(m['params'] ? { params: obj(m['params']) } : {}),
      ...(typeof m['rewardMul'] === 'number' ? { rewardMul: m['rewardMul'] as number } : {}),
      ...(typeof cond['id'] === 'string' ? { condition: {
        id: cond['id'] as string, args: obj(cond['args']),
        ...(onFail === 'fail' ? { onFail: 'fail' as const } : {}),
      } } : {}),
    });
  }
  return out;
}

/** 사원증 줄 색 역할(D-037) — 렌더링 역할 이름 */
function lanyardOf(actor: O): string {
  if (actor['role'] === 'boss') return 'boss';
  const r = str(actor['renderRole'], 'background');
  return r;
}

/** 저작 일자 수(이후는 생성기) */
export function authoredDayCount(tables: Tables): number {
  return arr(obj(tables['days'])['authoredDays']).length;
}

/** AuthoredDay 모양을 돌려줌(저작 또는 생성) */
export function dayPlan(tables: Tables, day: number, opts: PlanOptions = {}): O {
  const authored = arr(obj(tables['days'])['authoredDays']).map(obj).find((d) => d['day'] === day);
  if (authored) return opts.missionsV3 && day >= num(missionsTable(tables)['appliesFromDay'], 6) ? overlayPlan(tables, day, authored) : authored;
  return generateDay(tables, day, opts);
}

function rankFor(tables: Tables, day: number): O {
  const ranks = arr(obj(tables['ranks'])['ranks']).map(obj);
  return ranks.find((r) => {
    const dr = arr(r['dayRange']);
    const a = num(dr[0], 1), b = dr[1] === null ? Infinity : num(dr[1], Infinity);
    return day >= a && day <= b;
  }) ?? ranks[ranks.length - 1] ?? {};
}

/**
 * 16일차 이후 생성기(days.generator, 요약 구현). 시드 스트림 day-{n}-plan / day-{n}-leave.
 * [부분 구현] 대표님 순시(INT-09)·데뷔 고정·최근 2일 강제 포함 규칙은 아직 반영하지 않음.
 */
export function generateDay(tables: Tables, day: number, opts: PlanOptions = {}): O {
  const rank = rankFor(tables, day);
  const dr = arr(rank['dayRange']);
  const t = rankProgress(day, [num(dr[0], 1), dr[1] === null ? null : num(dr[1], 1)]);
  const plan = createRng(`day-${day}-plan`);
  const leaveRng = createRng(`day-${day}-leave`);
  const ceoPlan = ceoForDay(tables, day, rank, t);
  const ceoDay = ceoPlan.kind !== 'none';
  const dayPhaseSec = num(rank['dayPhaseSec'], 50) - (ceoDay ? num(rank['ceoDayPhaseReductionSec'], 0) : 0);
  const half = t < 0.5 ? 0 : 1;
  // 대표님 날: 미션 −1, 필수 −1 (최소 2) — days.generator.missions
  const count = Math.max(ceoDay ? 2 : 0, num(arr(rank['missionsPerDay'])[half], 3) - (ceoDay ? 1 : 0));
  const required = Math.max(ceoDay ? 2 : 0, num(arr(rank['missionsRequired'])[half], 2) - (ceoDay ? 1 : 0));
  const ceoAtSec = ceoDay ? Math.round(dayPhaseSec * ceoPlan.atFrac * 10) / 10 : -1;
  // D-084: missions.json(v3)이 켜지면 poolByRank가 ranks.eventPool을 대체(ranks.json은 그대로)
  const mv3 = opts.missionsV3 === true;
  const pool = mv3 ? poolForRank(tables, str(rank['id']), day) : arr(rank['eventPool']).map(obj);
  const picked: string[] = [];
  const left = pool.slice();
  for (let i = 0; i < count && left.length > 0; i++) {
    const e = plan.weighted(left, (x) => num(x['weight'], 1));
    if (!e) break;
    picked.push(str(e['eventId']));
    left.splice(left.indexOf(e), 1);
  }
  // 새 미션 데뷔(missionPool.debuts): 그날 반드시 포함(RNG 추가 소비 없음 — 마지막 추첨을 바꿈)
  const debut = mv3 ? debutsFor(tables, day) : { missions: [], modifierTypes: [] };
  for (const d of debut.missions) {
    if (picked.includes(d.id)) continue;
    if (picked.length >= count && picked.length > 0) picked[picked.length - 1] = d.id; else picked.push(d.id);
  }
  const step = Math.floor((dayPhaseSec - 22) / Math.max(1, picked.length));
  const missions = picked.map((id, i) => ({ eventId: id, unlockAtSec: 3 + i * step }));
  const castPatrols = ['p_tl_seat', 'p_guard_gatehall', 'p_snitch_seat', 'p_accomplice_seat'];
  if (num(obj(obj(rank['cast'])['bosses'])['team_lead'], 1) >= 2) castPatrols.push('p_tl2_seat');
  const ints = arr(obj(tables['interrupts'])['interrupts']).map(obj);
  const unlocked = (id: string) => num(ints.find((x) => x['id'] === id)?.['unlockDay'], 999) <= day;
  const proximity = ['INT-01', 'INT-02', 'INT-03'];
  const dayInterrupts: O[] = [];
  const di = obj(rank['dayInterrupts']);
  const dcount = plan.int(num(arr(di['countRange'])[0], 0), num(arr(di['countRange'])[1], 0));
  const dpool = arr(di['pool']).map(obj).filter((p) => unlocked(str(p['id'])));
  let lastAt = 8 - 10;
  for (let i = 0; i < dcount && dpool.length > 0; i++) {
    const p = plan.weighted(dpool, (x) => num(x['weight'], 1));
    if (!p) break;
    dpool.splice(dpool.indexOf(p), 1);
    const id = str(p['id']);
    if (proximity.includes(id)) { dayInterrupts.push({ id, atSec: 0 }); continue; }
    const lo = Math.max(8, lastAt + 10), hi = dayPhaseSec - 10;
    if (lo > hi) continue;
    lastAt = plan.range(lo, hi);
    dayInterrupts.push({ id, atSec: Math.round(lastAt * 10) / 10 });
  }
  for (const id of proximity) if (unlocked(id) && !dayInterrupts.some((d) => d['id'] === id) && id !== 'INT-02') dayInterrupts.push({ id, atSec: 0 });
  // H7(days.generator.dayInterrupts.h7, T-136 ④): 대표님 순시 ±ceoDirectorMinGapSec 안의 본부장 순찰(INT-10) 제외(onPlanConflict 'drop_director_patrol', 재배치 없음),
  // hrInterruptsOnCeoDay 'none'이면 순시 날 인사팀(INT-05·06) 없음
  const h7 = obj(obj(obj(obj(tables['days'])['generator'])['dayInterrupts'])['h7']);
  const h7Gap = num(h7['ceoDirectorMinGapSec'], 0);
  const dropHr = h7['hrInterruptsOnCeoDay'] === 'none';
  const dayInts = ceoDay
    ? dayInterrupts.filter((d) => !(dropHr && ['INT-05', 'INT-06'].includes(str(d['id']))) && !(d['id'] === 'INT-10' && Math.abs(num(d['atSec'], 0) - ceoAtSec) < h7Gap))
    : dayInterrupts;
  const li = obj(rank['leaveInterrupts']);
  const lcount0 = leaveRng.int(num(arr(li['countRange'])[0], 0), num(arr(li['countRange'])[1], 0));
  const lcount = ceoDay ? Math.min(2, lcount0) : lcount0; // 대표님 날 퇴근 방해 최대 2
  const lpool = arr(li['pool']).map(obj).filter((p) => unlocked(str(p['id'])));
  const leaveInterrupts: O[] = [{ id: 'INT-01' }];
  for (let i = 0; i < lcount && lpool.length > 0; i++) {
    const p = leaveRng.weighted(lpool, (x) => num(x['weight'], 1));
    if (!p) break;
    lpool.splice(lpool.indexOf(p), 1);
    if (!leaveInterrupts.some((x) => x['id'] === p['id'])) leaveInterrupts.push({ id: p['id'] });
  }
  // 회의 중 낮잠 잠김(days.generator.dayInterrupts.constraints): 낮잠 해금이 회의와 겹치면 해금을 회의 끝 뒤로, 그게 안 되면 회의를 낮잠 뒤로
  adjustNapForMeeting(tables, dayInts, missions, dayPhaseSec);
  // T-139 budgetCheck(RNG 소비 없음, 모든 추첨 뒤). 생성 맵이면 buildDayContent가 거리·변형 보정으로 다시 계산
  const bud = budgetCheckRequired({
    tables, rank, plan: { missions, dayInterrupts: dayInts }, dayPhaseSec, startRequired: required, expectedOf: (id) => baseExpectedSec(tables, id),
  });
  return {
    day, rankId: rank['id'], weekday: (day - 1) % 5, seed: `day-${day}`, mapId: 'office_floor_1',
    titleKey: 'day.generated.title',
    tutorialIds: [
      ...arr(obj(obj(tables['days'])['generator'])['debuts']).map(obj).filter((d) => d['day'] === day && typeof d['tutorialId'] === 'string').map((d) => d['tutorialId']),
      ...debut.missions.filter((d) => d.tutorialId).map((d) => d.tutorialId),
    ],
    dayPhaseSec, missions, missionsRequired: bud.required, missionsRequiredPreBudget: required,
    castPatrols, dayInterrupts: dayInts, leaveInterrupts, scripted: [], ceo: ceoPlan.kind, generated: true,
    ...(ceoDay ? { ceoAtSec } : {}),
  };
}

/** 회의(INT-08) 근무판과 낮잠 해금 시각 조정(T-145, D-079). 결정적(RNG 없음) */
function adjustNapForMeeting(tables: Tables, dayInts: O[], missions: O[], dayPhaseSec: number): void {
  const i08 = arr(obj(tables['interrupts'])['interrupts']).map(obj).find((x) => x['id'] === 'INT-08');
  if (!i08) return;
  const eff = obj(i08['effect']);
  const locked = arr(eff['blocksMissions']).map((x) => str(x));
  for (const d of dayInts) {
    if (d['id'] !== 'INT-08') continue;
    const at = num(d['atSec'], 0);
    // 회의 끝 = 전조 + 걸어가기(추정) + 회의 + 끝 전조
    const end = at + num(obj(i08['tell'])['sec'], 0.6) + DEFAULTS.meetingWalkEstSec + num(eff['meetingSec'], 10) + num(eff['letoutTellSec'], 1);
    for (const m of missions) {
      const id = str(m['eventId']);
      if (!locked.includes(id)) continue;
      const u = num(m['unlockAtSec'], 0);
      const exp = baseExpectedSec(tables, id);
      if (u + exp <= at || u >= end) continue;
      const pushed = Math.ceil(end);
      if (pushed <= dayPhaseSec - 22) { m['unlockAtSec'] = pushed; continue; }
      const moved = Math.round((u + exp) * 10) / 10;
      if (moved <= dayPhaseSec - 10) d['atSec'] = Math.max(8, moved);
    }
  }
}

/**
 * 대표님 순시 여부(days.generator.ceo): 직급 cast에 ceo가 있고 firstDay 이후. 수요일(occurrence.scheduledWeekday) 정기,
 * 그 외 날은 시드 스트림 day-{n}-boss로 randomChancePerDay 판정(같은 날 = 모든 플레이어 같은 결과, 출근 준비 화면에 예보 D-027).
 * 예정 시각 비율은 같은 스트림에서 [0.4, 0.7] 균등 추첨.
 */
export function ceoForDay(tables: Tables, day: number, rank: O, t: number): { kind: 'none' | 'scheduled' | 'random'; atFrac: number } {
  const none = { kind: 'none' as const, atFrac: 0 };
  if (num(obj(obj(rank['cast'])['bosses'])['ceo'], 0) < 1) return none;
  const ceoRaw = arr(obj(tables['bosses'])['bosses']).map(obj).find((b) => b['id'] === 'ceo');
  if (!ceoRaw) return none;
  const ceo = applyInterpScaling(ceoRaw, str(rank['id']), t);
  const gen = obj(obj(tables['days'])['generator']);
  const debut = num(obj(gen['ceo'])['debutDay'], num(ceo['firstDay'], 28));
  if (day < debut) return none;
  const occ = obj(ceo['occurrence']);
  const rng = createRng(`day-${day}-boss`);
  const forced = arr(gen['debuts']).map(obj).some((d) => d['day'] === day && d['bossId'] === 'ceo');
  const weekday = (day - 1) % 5;
  const roll = rng.next();
  const atFrac = 0.4 + rng.next() * 0.3;
  if (forced || weekday === num(occ['scheduledWeekday'], 2)) return { kind: 'scheduled', atFrac };
  return roll < num(occ['randomChancePerDay'], 0) ? { kind: 'random', atFrac } : none;
}

/** 하루 콘텐츠 조립 */
export function buildDayContent(tables: Tables, day: number, warn: BuildWarnings = { push: () => {} }, opts: BuildOptions = {}): DayContent {
  const rules = obj(tables['rules']);
  const mv3 = opts.missionsV3 ?? missionsEnabledInData(tables);
  const planOpts: PlanOptions = { missionsV3: mv3 };
  const plan = dayPlan(tables, day, planOpts);
  const ranks = arr(obj(tables['ranks'])['ranks']).map(obj);
  const rank = ranks.find((r) => r['id'] === plan['rankId']) ?? rankFor(tables, day);
  const rankId = str(rank['id'], 'intern');
  const dr = arr(rank['dayRange']);
  const t = rankProgress(day, [num(dr[0], 1), dr[1] === null ? null : num(dr[1], 1)]);
  // ── 층(T-144): 일차별 공급자. 1~2일차 수작업 맵, 이후 생성(꺼져 있거나 실패하면 수작업 맵 폴백) ──
  const eventsAll = arr(obj(tables['events'])['events']).map(obj);
  const extraRequiredSpots: string[] = [];
  for (const m of arr(plan['missions']).map(obj)) {
    const e = missionRaw(tables, str(m['eventId']), mv3) ?? eventsAll.find((x) => x['id'] === m['eventId']);
    const sp = str(obj(e?.['location'])['spot']);
    if (sp && !str(obj(e?.['params'])['fallbackSpot'])) extraRequiredSpots.push(sp);
  }
  // 이 날 쓰는 순찰: 출연 + 방해 이벤트 effect의 순찰 id + 대표님 순시/엘리베이터
  const requiredPatrols = new Set<string>(arr(plan['castPatrols']).map((x) => str(x)));
  const intAll = arr(obj(tables['interrupts'])['interrupts']).map(obj);
  for (const r of [...arr(plan['dayInterrupts']), ...arr(plan['leaveInterrupts'])].map(obj)) {
    const eff = obj(intAll.find((x) => x['id'] === r['id'])?.['effect']);
    for (const k of ['patrolId', 'leaveVariant']) if (typeof eff[k] === 'string') requiredPatrols.add(eff[k] as string);
    for (const k of ['patrolIds', 'patrolVariants']) for (const v of arr(eff[k])) if (typeof v === 'string') requiredPatrols.add(v);
  }
  if (str(plan['ceo'], 'none') !== 'none') requiredPatrols.add(str(obj(arr(obj(tables['bosses'])['bosses']).map(obj).find((b) => b['id'] === 'ceo')?.['visit'])['patrolId'], 'p_ceo_visit'));
  // thenPatrol 연쇄도 포함
  const patrolRaw = arr(obj(tables['patrols'])['patrols']).map(obj);
  for (let grew = true; grew;) {
    grew = false;
    for (const id of [...requiredPatrols]) {
      const nx = patrolRaw.find((p) => p['id'] === id)?.['thenPatrol'];
      if (typeof nx === 'string' && !requiredPatrols.has(nx)) { requiredPatrols.add(nx); grew = true; }
    }
  }
  const provider = opts.levelProvider ?? createLevelProvider({ generate: layoutEnabledInData(tables) });
  const v3 = parseLayoutV3(tables);
  // ── T-151 성별 시설: 그날 켜졌는가 + 내 쪽(플레이어 기준 회전). 플레이어 성별은 들어가지 않음 ──
  const gcfg = genderFacilityConfig(tables, opts.genderFacilities);
  const genderFor = (d: number, r: string): GenderDayCtx | null => genderDayCtx(tables, gcfg, d, r, v3?.ranks[r]?.authoredOrder === true);
  const gd = genderFor(day, rankId);
  const roam = obj(v3?.leadRoaming);
  const castHasTl = arr(plan['castPatrols']).includes(str(roam['seatPatrolId'], 'p_tl_seat'));
  const toursWanted = opts.tours === true || (opts.tours ?? 'auto') === 'auto';
  const toursActive = toursWanted && castHasTl && roam['enabled'] === true && day >= num(roam['appliesFromDay'], 6);
  const map = provider.levelFor({
    tables, day, plan, rankId, t, extraRequiredSpots, requiredPatrols: [...requiredPatrols],
    planFor: (d) => dayPlan(tables, d, planOpts), toursActive,
    ...(gd ? { gender: gd, genderFor } : {}),
  });
  if (map.source === 'fallback') warn.push(`days.${day}: 생성 층 검증 실패 ${map.gen?.attempts ?? 0}회 → 수작업 맵 폴백 (${(map.gen?.failures ?? []).slice(-3).join(' / ')})`);

  // ── 규칙 ──
  const sight = obj(rules['sight']);
  const fakeRules = obj(rules['fake']);
  const disguise = obj(rules['disguise']);
  const threat = obj(rules['threat']);
  const floorRules: FloorRules = {
    fixedStepSec: num(rules['fixedStepSec'], 1 / 60),
    maxAdvanceSec: num(rules['maxAdvanceSec'], 0.1),
    playerSpeedTilesPerSec: num(rules['playerSpeedTilesPerSec'], 3),
    tapSnapRadius: num(rules['tapSnapRadius'], 2),
    suspicion: obj(rules['suspicion']) as unknown as FloorRules['suspicion'],
    threat: threat as unknown as FloorRules['threat'],
    input: obj(rules['input']) as FloorRules['input'] & object,
    movement: obj(rules['movement']) as FloorRules['movement'] & object,
    disguise: {
      closeCallWindowSec: range2(disguise['closeCallWindowSec']) ?? [-0.3, 0.12],
      closeCallMaxPerDay: num(disguise['closeCallMaxPerDay'], 3),
    },
    offscreenSourceNoGain: obj(rules['offscreenWarning'])['offscreenSourceNoGain'] === true,
    // BUG-010: 전조 중 '돌아볼 콘' 예측 구간(전조 남은 시간 + 이 값). 데이터가 없으면 예측하지 않음(기존 동작)
    ...(typeof obj(rules['offscreenWarning'])['minLeadSecBeforeGaze'] === 'number'
      ? { turnWarnLeadSec: obj(rules['offscreenWarning'])['minLeadSecBeforeGaze'] as number } : {}),
  };

  // ── 근무 구간(V12 트림 반영) ──
  const trimSec = map.source === 'generated' ? (map.trimSec ?? 0) : 0;
  const dayPhaseSecFinal = Math.round((num(plan['dayPhaseSec'], num(rank['dayPhaseSec'], 50)) - trimSec) * 10) / 10;
  const tellMin0 = num(obj(rules['tell'])['minSec'], 0.4);
  // ── 팀장 순회(D-075): v3 leadRoaming(T-145). 옛 엔진(테스트)은 devTour ──
  const intTable = arr(obj(tables['interrupts'])['interrupts']).map(obj);
  const toursOn = opts.tours === true || ((opts.tours ?? 'auto') === 'auto' && map.source === 'generated');
  let tour: BossTourDef | null = null;
  if (toursOn && castHasTl) {
    if (v3 && map.patrolFor) {
      const i08 = intTable.find((x) => x['id'] === 'INT-08');
      tour = buildLeadTour({
        leadRoaming: v3.leadRoaming, day, rankId, dayPhaseSec: dayPhaseSecFinal, tellMinSec: tellMin0, spots: map.spots,
        grid: buildGridMap(map.rows, map.legend), ...(map.tourOk ? { tourOk: map.tourOk } : {}),
        ...(str(plan['ceo'], 'none') !== 'none' ? { ceoAtSec: num(plan['ceoAtSec'], dayPhaseSecFinal * DEFAULTS.ceoAtFrac) } : {}),
        directorAtSec: arr(plan['dayInterrupts']).map(obj).filter((d) => d['id'] === 'INT-10').map((d) => num(d['atSec'], 0)),
        meetings: arr(plan['dayInterrupts']).map(obj).filter((d) => d['id'] === 'INT-08').map((d) => ({ atSec: num(d['atSec'], 0), waitSec: num(obj(i08?.['effect'])['meetingSec'], 10) })),
      });
    } else tour = buildDevTour(day, dayPhaseSecFinal, tellMin0, map.spots);
  }
  const meetingAbsorbed = !!tour?.fromInterrupt?.includes('INT-08');

  // ── 방해 이벤트(이 날 켜진 것) ──
  const interrupts: DayInterruptDef[] = [];
  const addInt = (ref: O, phase: 'day' | 'leave') => {
    const id = str(ref['id']);
    const raw = intTable.find((x) => x['id'] === id);
    if (!raw) { warn.push(`days.${day}: 방해 ${id} 정의 없음`); return; }
    const d = applyInterpScaling(raw, rankId, t);
    const tell = obj(d['tell']);
    const def: DayInterruptDef = {
      id, category: str(d['category']), nameKey: str(d['nameKey']), phase,
      atSec: phase === 'day' ? num(ref['atSec'], 0) : -1,
      ...(typeof ref['trigger'] === 'string' ? { trigger: ref['trigger'] as string } : {}),
      triggerDef: obj(d['trigger']),
      tell: { sec: num(tell['sec'], 0.5), ...(typeof tell['textKey'] === 'string' ? { textKey: tell['textKey'] as string } : {}) },
      effect: obj(d['effect']), cooldownSec: num(d['cooldownSec'], 0), maxPerDay: num(d['maxPerDay'], 1),
    };
    interrupts.push(def);
  };
  // 근무 INT-08이 meeting 순회로 흡수된 날은 방해 목록에서 뺌(leadRoaming.conflicts)
  for (const r of arr(plan['dayInterrupts']).map(obj)) if (!(meetingAbsorbed && r['id'] === 'INT-08')) addInt(r, 'day');
  for (const r of arr(plan['leaveInterrupts']).map(obj)) addInt(r, 'leave');
  const enabledInts = new Set(interrupts.map((i) => i.id));

  // ── 액터(직급 보간) ──
  const bosses = arr(obj(tables['bosses'])['bosses']).map(obj);
  const npcs = arr(obj(tables['npcs'])['npcs']).map(obj);
  const actorRaw = new Map<string, O>();
  for (const a of [...bosses, ...npcs]) actorRaw.set(str(a['id']), applyInterpScaling(a, rankId, t));
  const strings = obj(mergedStrings(tables)['strings']);
  const ambient = arr(plan['ambientOnly']).map((x) => str(x));
  const tellMin = num(obj(rules['tell'])['minSec'], 0.4);
  const talkRules = obj(rules['talk']);
  const talkMin = num(obj(rules['talk'])['tellSecMin'], DEFAULTS.talkWarnSec);

  const actors: Record<string, ActorInfo> = {};
  for (const [id, a] of actorRaw) {
    const sim = obj(a['sim']);
    const talk = obj(sim['talk']);
    const spot = obj(sim['spot']);
    actors[id] = {
      id, nameKey: str(a['nameKey']), role: str(a['role'], 'npc'), lanyard: lanyardOf(a),
      reactionKeys: arr(a['reactionKeys']).map((x) => str(x)),
      ...(spot['dwellSec'] !== undefined ? { spot: { dwellSec: num(spot['dwellSec'], 0.4), triggerStates: arr(spot['triggerStates']).map((x) => str(x)), startsInterrupt: str(spot['startsInterrupt']) } } : {}),
      ...(typeof talk['enabledBy'] === 'string' ? { talkEnabledBy: talk['enabledBy'] as string } : {}),
      ...(talk['onlyWhilePlayerAway'] === true ? { talkOnlyWhilePlayerAway: true } : {}),
      ...(typeof talk['onlyWhen'] === 'string' ? { talkOnlyWhen: talk['onlyWhen'] as string } : {}),
      ...(typeof talk['warnLineKey'] === 'string' ? { warnLineKey: talk['warnLineKey'] as string } : {}),
      ...(typeof talk['dodgedLineKey'] === 'string' ? { dodgedLineKey: talk['dodgedLineKey'] as string } : {}),
      ...(a['hierarchy'] ? { hierarchy: obj(a['hierarchy']) } : {}),
      ...(typeof a['spriteKey'] === 'string' ? { spriteKey: a['spriteKey'] as string } : {}),
      ...(typeof a['spriteVariant'] === 'string' ? { spriteVariant: a['spriteVariant'] as string } : {}),
    };
  }

  // ── 순찰 → NpcDef ──
  const patrolTable = arr(obj(tables['patrols'])['patrols']).map(obj);
  const toWaypoint = (w: O): WaypointDef => {
    const o: Record<string, unknown> = { x: num(w['x'], 0), y: num(w['y'], 0), waitSec: num(w['waitSec'], 0) };
    for (const k of ['lookChance', 'facing', 'useActorIdle', 'stopId', 'coneOff', 'holdForQte', 'holdForReport', 'lookIsRecheck']) if (w[k] !== undefined) o[k] = w[k];
    if (Array.isArray(w['lookDirs'])) o['lookDirs'] = w['lookDirs'];
    return o as unknown as WaypointDef;
  };
  const toNpcDef = (p: O): NpcDef | null => {
    const actorId = str(p['actorId']);
    const a = actorRaw.get(actorId);
    if (!a) { warn.push(`patrol ${String(p['id'])}: 액터 ${actorId} 없음`); return null; }
    if (p['kind'] === 'follow') return null; // 공범 합류(INT-12) 미구현
    const sim = obj(a['sim']);
    const cone = obj(sim['cone']);
    const isAmbient = ambient.includes(actorId);
    const talkRaw = obj(sim['talk']);
    let talk: TalkDef | undefined;
    if (!isAmbient && talkRaw['radius'] !== undefined && enabledInts.has(str(talkRaw['enabledBy']))) {
      const tl: Record<string, unknown> = {
        radius: num(talkRaw['radius'], 1.5), durationSec: num(talkRaw['durationSec'], 1.5), cooldownSec: num(talkRaw['cooldownSec'], 10),
        tellSec: Math.max(num(talkRaw['tellSec'], talkMin), talkMin),
      };
      for (const k of ['noticeRadius', 'warnSec', 'catchRadius', 'releaseSec', 'skipIfPlayerDisguised', 'nodShortenSec', 'minDurationSec']) if (talkRaw[k] !== undefined) tl[k] = talkRaw[k];
      talk = tl as unknown as TalkDef;
    }
    const tellSec = num(sim['tellSec'], 0.5);
    if (tellSec < tellMin) warn.push(`${actorId}: tellSec ${tellSec} < 최소 ${tellMin}`);
    const fake = obj(sim['fake']);
    const dl = obj(sim['doubleLook']);
    const phoneOpp = arr(a['opportunities']).map(obj).find((o) => o['type'] === 'phone_call');
    const seated = p['kind'] === 'seated';
    const d: Record<string, unknown> = {
      id: str(p['instance']) ? `${str(p['id'])}` : str(p['id']),
      name: str(strings[str(a['nameKey'])], actorId),
      role: a['role'] === 'boss' ? 'boss' : str(a['renderRole'], 'npc'),
      actorId, patrolId: str(p['id']),
      cone: { range: num(cone['range'], 0), halfAngleDeg: num(cone['halfAngleDeg'], 0) },
      speedTilesPerSec: num(p['speedOverride'], num(sim['speedTilesPerSec'], 1.5)),
      gazeMultiplier: isAmbient ? 0 : num(sim['gazeMultiplier'], 1),
      tellSec, lookSec: num(sim['lookSec'], 1),
      lookChance: num(sim['lookChance'], 0), glanceBackChancePerTile: num(sim['glanceBackChancePerTile'], 0),
      waypoints: arr(p['waypoints']).map(obj).map(toWaypoint),
      coneActiveIn: arr(sim['coneActiveIn']).map((x) => str(x)) as ConeState[],
      turnTellSec: num(sight['cornerTurnTellSec'], tellSec),
      returnSec: num(sight['returnSec'], 0.3),
      seated, loop: p['loop'] !== false,
      fakeAbsoluteCap: num(fakeRules['absoluteCapProb'], 1),
      noConsecutiveFakes: fakeRules['noConsecutiveFakes'] === true,
    };
    if (!Array.isArray(sim['coneActiveIn'])) delete d['coneActiveIn'];
    for (const [k, src] of [['tellSecRange', 'tellSecRange'], ['lookSecRange', 'lookSecRange'], ['idleSecRange', 'idleSecRange']] as const) {
      const r = range2(sim[src]); if (r) d[k] = r;
    }
    if (typeof sim['stopLookTellSec'] === 'number') d['stopLookTellSec'] = sim['stopLookTellSec'];
    if (p['despawnAtEnd'] === true) d['despawnAtEnd'] = true;
    if (typeof p['spawnTellSec'] === 'number') d['spawnTellSec'] = p['spawnTellSec'];
    if (p['coneOff'] === true || isAmbient) d['coneOff'] = true;
    if (typeof p['thenPatrol'] === 'string') d['thenPatrol'] = p['thenPatrol'];
    if (num(fake['chance'], 0) > 0) d['fake'] = { chance: num(fake['chance'], 0), capChance: num(fake['capChance'], 1), ...(typeof fake['afterFakeSec'] === 'number' ? { afterFakeSec: fake['afterFakeSec'] } : {}) };
    if (num(dl['chance'], 0) > 0) {
      d['doubleLook'] = {
        chance: num(dl['chance'], 0), capChance: num(dl['capChance'], 1), gapSec: num(dl['gapSec'], 0.5),
        ...(typeof dl['secondTellSec'] === 'number' ? { secondTellSec: Math.max(tellMin, dl['secondTellSec'] as number) } : {}),
        ...(range2(dl['secondLookSecRange']) ? { secondLookSecRange: range2(dl['secondLookSecRange']) } : {}),
      };
    }
    if (seated && phoneOpp && !isAmbient && num(phoneOpp['probPerCycle'], 0) > 0) {
      d['phone'] = { probPerCycle: num(phoneOpp['probPerCycle'], 0), durationSecRange: range2(phoneOpp['durationSecRange']) ?? [3, 5] };
    }
    if (talk) {
      d['talk'] = talk;
      // T-134 ④: 들어왔다 피하면 cornerTurnTellSec 전조 후 그 액터 lookSec 돌아보기
      if (talkRules['dodgeAfterEnterLooksAtPlayer'] === true) d['escapeLookTellSec'] = num(sight['cornerTurnTellSec'], tellMin);
    }
    // 대표님 재확인(fake.type 'recheck', T-136 ③): '전조 후 헛기침' 페이크가 아니라 진짜 시선 → 페이크 런타임에서 뺀다.
    // asRealLookAtRecheckWaypoint면 lookIsRecheck 웨이포인트의 시선 확률 = 직급 보간된 fake.chance, 전조 = fake.tellSec(시선 길이는 sim.lookSec)
    if (fake['type'] === 'recheck') {
      delete d['fake'];
      if (fake['asRealLookAtRecheckWaypoint'] === true) {
        const rc = typeof fake['chance'] === 'number' ? fake['chance'] as number : undefined;
        const rt = typeof fake['tellSec'] === 'number' ? Math.max(tellMin, fake['tellSec'] as number) : undefined;
        d['waypoints'] = (d['waypoints'] as WaypointDef[]).map((w) => (w.lookIsRecheck
          ? { ...w, ...(rc !== undefined ? { lookChance: rc } : {}), ...(rt !== undefined ? { lookTellSec: rt } : {}) } : w));
      }
    }
    return d as unknown as NpcDef;
  };
  const patrols: Record<string, NpcDef> = {};
  const remap = map.remap;
  // 생성 층: 옮긴 웨이포인트 사이가 이어지는지(PatrolNpc 생성 시 예외 방지)
  const genGrid = remap ? buildGridMap(map.rows, map.legend) : null;
  const patrolConnected = (wps: readonly O[], loop: boolean): boolean => {
    if (!genGrid) return true;
    for (let i = 0; i < wps.length; i++) {
      if (i + 1 >= wps.length && !(loop && wps.length > 1)) break;
      const a = tile2(wps[i]), b = tile2(wps[(i + 1) % wps.length]);
      if (!findPath(genGrid, a, b)) return false;
    }
    return true;
  };
  for (const p0 of patrolTable) {
    if (p0['mapId'] !== map.patrolMapId) continue;
    let p = p0;
    if (map.patrolFor) {
      // v3 생성 층(T-145): 재매핑 → patrolTemplates → 앉은 순찰 스팟 덮어쓰기 → 대표님 입장 속도
      const moved = map.patrolFor(p0);
      if (!moved) {
        if (requiredPatrols.has(str(p0['id']))) warn.push(`생성 층 ${map.id}: 순찰 ${str(p0['id'])} 옮기기 불가 → 제외`);
        continue;
      }
      p = moved;
    } else if (remap) {
      // 생성 층: 수작업 맵 좌표 → 생성 층 좌표. 정지 지점을 옮길 수 없으면 순찰 제외
      const wps = remapWaypoints(arr(p0['waypoints']), remap);
      if (!wps || !patrolConnected(wps, p0['loop'] !== false && p0['kind'] !== 'seated')) {
        if (requiredPatrols.has(str(p0['id']))) warn.push(`생성 층 ${map.id}: 순찰 ${str(p0['id'])} 재매핑 불가 → 제외`);
        continue;
      }
      p = { ...p0, waypoints: wps };
    }
    const d = toNpcDef(p);
    if (d) patrols[str(p['id'])] = d;
  }
  const cast: NpcDef[] = [];
  for (const id of arr(plan['castPatrols']).map((x) => str(x))) {
    const d = patrols[id];
    if (d) cast.push(d); else warn.push(`days.${day}: castPatrols ${id} 없음`);
  }

  // ── 배경 동료(D-049, npcs.background): fromDay·untilRank로 등장, 메카닉 없음(시선·말걸기·의심·길막 없음) ──
  const rankOrder = (id: unknown) => num(ranks.find((r) => r['id'] === id)?.['order'], 99);
  const background: BackgroundDef[] = [];
  for (const b of arr(obj(tables['npcs'])['background']).map(obj)) {
    if (num(b['fromDay'], 1) > day) continue;
    if (b['untilRank'] !== null && b['untilRank'] !== undefined && rankOrder(rankId) > rankOrder(b['untilRank'])) continue;
    const sprite = str(b['sprite'], 'bg_a');
    const behavior = str(b['behavior'], 'sit');
    const at = obj(behavior === 'sit' ? b['seat'] : b['spot']);
    let wps: WaypointDef[] = behavior === 'walk'
      ? arr(b['waypoints']).map(obj).map(toWaypoint)
      : [{ x: num(at['x'], 0), y: num(at['y'], 0), waitSec: 0, ...(typeof at['facing'] === 'string' ? { facing: at['facing'] as Dir } : {}) }];
    if (map.patrolFor) {
      const moved = map.patrolFor({ id: str(b['id']), kind: behavior === 'walk' ? 'route' : 'seated', loop: b['loop'] !== false, waypoints: wps });
      const mw = moved ? arr(moved['waypoints']).map(obj).map(toWaypoint) : null;
      // bg_pantry_walker 등 걷는 배경: 못 옮기면 n_pantry ±2 사각 순환(patrolTemplates.background 메모)
      if (!mw && behavior === 'walk' && map.nodes?.['n_pantry']) {
        const c0 = map.nodes['n_pantry']!;
        const g = buildGridMap(map.rows, map.legend);
        const sq = [[-2, 0], [2, 0], [2, 1], [-2, 1]].map(([dx, dy]) => nearestWalkable(g, c0.x + dx!, c0.y + dy!, 2)).filter((x): x is Tile => !!x);
        if (sq.length < 2) continue;
        wps = sq.map((q, i) => ({ x: q.x, y: q.y, waitSec: i % 2 === 0 ? 1.5 : 0 }));
      } else if (!mw) continue;
      else wps = mw;
    } else if (remap) {
      // 생성 층(T-144): 배경 동료도 재매핑. 옮길 수 없거나 경로가 끊기면 이 날은 빠짐(메카닉 없음)
      const moved = remapWaypoints(wps, remap);
      if (!moved || !patrolConnected(moved, behavior === 'walk' && b['loop'] !== false)) continue;
      wps = moved as unknown as WaypointDef[];
    }
    const id = str(b['id'], `bg_${background.length}`);
    background.push({
      sprite, ...(typeof b['variant'] === 'string' ? { variant: b['variant'] as string } : {}),
      behavior: behavior === 'walk' ? 'walk' : behavior === 'stand' ? 'stand' : 'sit',
      idleAnims: arr(b['idleAnims']).map((x) => str(x)),
      idleAnimEverySecRange: range2(b['idleAnimEverySecRange']) ?? [4, 8],
      npc: {
        id, name: '', role: 'background', actorId: `background:${id}`, patrolId: id,
        cone: { range: 0, halfAngleDeg: 0 }, speedTilesPerSec: num(b['speedTilesPerSec'], 1.2), gazeMultiplier: 0,
        tellSec: 0.5, lookSec: 0, lookChance: 0, glanceBackChancePerTile: 0, waypoints: wps, coneOff: true,
        // 앉기·서기 = 대기 무한(seated 주기 없음), 걷기 = 순환
        ...(behavior === 'walk' ? { loop: b['loop'] !== false } : { seated: true, idleSecRange: [9999, 9999] as [number, number] }),
        passable: obj(b['mechanics'])['blocksPlayer'] !== true,
      },
    });
  }
  // 앉기·서기 웨이포인트는 useActorIdle로 무한 대기
  for (const bg of background) if (bg.behavior !== 'walk') (bg.npc.waypoints as WaypointDef[])[0] = { ...bg.npc.waypoints[0]!, useActorIdle: true };
  const maxOn = num(obj(rules['characters'])['maxOnFloor'], 8);
  if (cast.length + background.length + 1 > maxOn) warn.push(`days.${day}: 층 인원 ${cast.length + background.length + 1} > ${maxOn}`);

  // ── 맵 ──
  const spots: Record<string, { tile: Tile; facing?: Dir }> = { ...map.spots };
  const level: LevelDef = {
    id: map.id, rows: map.rows, legend: map.legend,
    playerStart: map.playerStart, exitZone: map.exitZone, npcs: cast,
  };
  const playerSeat = spots['player_seat']?.tile ?? level.playerStart;

  // ── 미션 ──
  const events = eventsAll;
  const missions: MissionDef[] = [];
  const W = map.rows[0]?.length ?? 11;
  const seatDist = bfsDist(map.rows, map.legend, playerSeat, occupiedSet(spots, W));
  const oneWay = (t: Tile): number => seatDist[t.y * W + t.x] ?? -1;
  const speed = floorRules.playerSpeedTilesPerSec;
  const refOW = v3?.missionRefOneWayTiles ?? {};
  const isGen = map.source === 'generated';
  const clk = obj(rules['day']);
  const clockAt = (dps: number) => (sec: number) => hhmm(str(clk['clockStart'], '09:00')) + sec * (hhmm(str(clk['dayPhaseClockEnd'], '17:48')) - hhmm(str(clk['clockStart'], '09:00'))) / Math.max(1, dps);
  const infoOf = (p: O) => (id: string) => {
    const e = missionRaw(tables, id, mv3);
    const pm = arr(p['missions']).map(obj).find((x) => x['eventId'] === id);
    return { expectedSec: baseExpectedSec(tables, id), timeLimitSec: num(e?.['timeLimitSec'], 30), unlockAtSec: num(pm?.['unlockAtSec'], 0) };
  };
  // 변형 추첨(missions.combination, 생성일 + missions.appliesFromDay 이후): ① 미션 ② 층 ③ 순회 ④ 변형 ⑤ budgetCheck
  let drawn: Record<string, (string | O)[]> = {};
  if (mv3 && plan['generated'] === true && day >= num(missionsTable(tables)['appliesFromDay'], 6)) {
    const mk = (d: number, p: O): ModDrawContext => {
      const g = genderFor(d, str(p['rankId'], rankId));
      return {
        tables, day: d, rankId: str(p['rankId'], rankId), ceoDay: str(p['ceo'], 'none') !== 'none', plan: p,
        missionInfo: infoOf(p), clockAt: clockAt(num(p['dayPhaseSec'], 50)),
        ...(g ? { extraModifiers: genderModifierLib(tables, g.mine, g.lockerMine) } : {}),
      };
    };
    const lastAuthored = authoredDayCount(tables);
    const history = modifierHistory((d) => (d <= lastAuthored ? null : mk(d, dayPlan(tables, d, planOpts))), day);
    drawn = drawModifiers({
      ...mk(day, plan), plan: { ...plan, dayPhaseSec: dayPhaseSecFinal }, clockAt: clockAt(dayPhaseSecFinal),
      hasSpot: (n) => !!spots[n], longTourCount: longTourCount(tour), history,
    }).byMission;
  }
  const genderLib = gd ? genderModifierLib(tables, gd.mine, gd.lockerMine) : [];
  const expected: Record<string, number> = {};
  for (const m of arr(plan['missions']).map(obj)) {
    const id = str(m['eventId']);
    const e = missionRaw(tables, id, mv3) ?? events.find((x) => x['id'] === id);
    if (!e) { warn.push(`days.${day}: 미션 ${id} 없음`); continue; }
    const loc = obj(e['location']);
    const rawParams = obj(e['params']);
    const spotName = [str(loc['spot']), str(rawParams['fallbackSpot'])].find((n) => n && spots[n]);
    const spot = (spotName ? spots[spotName]?.tile : undefined) ?? playerSeat;
    const params = applyOverrideScaling(rawParams, obj(e['rankScaling']) as Record<string, Record<string, unknown>>, rankId);
    const reward = obj(e['reward']);
    let rawMods: unknown[] = [...arr(m['modifiers']), ...(drawn[id] ?? [])];
    const lib = [...arr(missionsTable(tables)['modifiers']).map(obj), ...genderLib];
    const spotOfMod = (r: unknown): string | undefined => { const o = typeof r === 'string' ? lib.find((x) => x['id'] === r) : obj(r); return typeof o?.['spot'] === 'string' ? o['spot'] as string : undefined; };
    // 장소 바꾸기 'a|b' = 그날 층에 있는 첫 스팟. 하나도 없으면 그 변형은 건너뜀(ifSpotExists·relocate 공통)
    rawMods = rawMods.flatMap((r) => {
      const sp = spotOfMod(r);
      if (sp === undefined) return [r];
      const hit = sp.split('|').find((n) => spots[n]);
      if (!hit) { if (m['modifiersIfSpotExists'] !== true) warn.push(`days.${day}: 미션 ${id} 변형 ${typeof r === 'string' ? r : str(obj(r)['id'])}: 스팟 ${sp} 없음 → 생략`); return []; }
      const base = typeof r === 'string' ? lib.find((x) => x['id'] === r) ?? {} : obj(r);
      return [{ ...base, spot: hit }];
    });
    const mods = parseModifiers(tables, rawMods, warn, rankId, genderLib);
    // T-151(S-04): 시설 미션 = 화장실 피신(targetFacility) 또는 시설이 목적지가 된 relocate
    const facilityMission = isFacilityMission(tables, id) || rawMods.some((r) => typeof (typeof r === 'string' ? lib.find((x) => x['id'] === r) : obj(r))?.['targetFacility'] === 'string');
    const def: MissionDef = {
      id: str(e['id']), nameKey: str(e['nameKey']), descKey: str(e['descKey']), iconSprite: str(e['iconSprite']),
      mechanic: str(e['mechanic']) as Mechanic, unlockAtSec: num(m['unlockAtSec'], 0), spot,
      startsAt: e['startsAt'] === 'chip_tap_at_seat' ? 'chip_tap_at_seat' : 'arrive_spot',
      completeAt: e['completeAt'] === 'on_success' ? 'on_success' : 'return_to_seat',
      awayFromDesk: e['awayFromDesk'] === true, timeLimitSec: num(e['timeLimitSec'], 30),
      reward: {
        slackPoints: num(reward['slackPoints'], 0), ...(typeof reward['snackStock'] === 'number' ? { snackStock: reward['snackStock'] as number } : {}),
        ...(typeof reward['couponStamp'] === 'number' ? { couponStamp: reward['couponStamp'] as number } : {}),
        ...(typeof reward['suspicionRelief'] === 'number' ? { suspicionRelief: reward['suspicionRelief'] as number } : {}),
      },
      failPenalty: num(obj(e['failPenalty'])['suspicion'], 0), timeoutPenalty: num(obj(e['timeoutPenalty'])['suspicion'], 0),
      params, ...(typeof e['tutorialId'] === 'string' ? { tutorialId: e['tutorialId'] as string } : {}),
      ...(e['accompliceAllowed'] === true && e['accompliceEffect'] ? { accompliceEffect: accompliceEffectOf(obj(e['accompliceEffect'])) } : {}),
    };
    const md0 = applyMissionModifiers(def, mods, spots, warn);
    const md: MissionDef = {
      ...md0, ...(facilityMission ? { facilityMission: true } : {}),
      ...(mods.length > 0 ? { modifierLabels: mods.map((mm) => ({ ...(mm.labelKey ? { labelKey: mm.labelKey } : {}), ...(mm.facilityLabelKey ? { facilityLabelKey: mm.facilityLabelKey } : {}) })) } : {}),
    };
    missions.push(md);
    // 시간 예산 예상 시간(gdd-v3 §4-6): 기본 + 생성 맵 거리 보정 + Σ budgetSecDelta('travel_diff' = 바뀐 장소로 보정)
    const ref = refOW[id];
    const corr = (t: Tile) => { const ow = oneWay(t); return isGen && ow >= 0 ? 2 * (ow - (ref ?? 0)) / speed : 0; };
    let ex = baseExpectedSec(tables, id) + (def.awayFromDesk && ref !== undefined ? corr(def.spot) : 0);
    for (const mm of mods) {
      if (typeof mm.budgetSecDelta === 'number') ex += mm.budgetSecDelta;
      else if (mm.budgetSecDelta === 'travel_diff' && md.awayFromDesk) ex += corr(md.spot) - (def.awayFromDesk && ref !== undefined ? corr(def.spot) : 0);
    }
    expected[id] = Math.round(ex * 10) / 10;
    void missionTags;
  }
  // T-139 budgetCheck 재계산(생성일만): 근무 구간 트림·거리·변형 반영. 저작일은 데이터 필수 수 그대로
  let budget: { requiredBefore: number; required: number; needSec: number } | undefined;
  if (plan['generated'] === true) {
    const before = num(plan['missionsRequiredPreBudget'], num(plan['missionsRequired'], missions.length));
    const r = budgetCheckRequired({ tables, rank, plan, dayPhaseSec: dayPhaseSecFinal, startRequired: before, expectedOf: (id) => expected[id] ?? baseExpectedSec(tables, id) });
    budget = { requiredBefore: before, required: r.required, needSec: r.needSec };
  }

  // ── 퇴근 ──
  const leaveEv = events.find((x) => x['mechanic'] === 'leave_sequence') ?? {};
  const lp = applyOverrideScaling(obj(leaveEv['params']), obj(leaveEv['rankScaling']) as Record<string, Record<string, unknown>>, rankId);
  const phases = arr(lp['phases']).map(obj);
  const pack = phases.find((p) => p['id'] === 'pack') ?? {};
  const gatePh = phases.find((p) => p['id'] === 'gate') ?? {};
  const elevPh = phases.find((p) => p['id'] === 'elevator') ?? {};
  const walkPh = phases.find((p) => p['id'] === 'walk') ?? {};
  const guardId = str(gatePh['npc'], 'security_guard');
  const gate = obj(actorRaw.get(guardId)?.['gate']);
  const gateScript = arr(plan['scripted']).map(obj).find((s) => s['type'] === 'gate_window_scale');
  const lreward = obj(leaveEv['reward']);
  const leave: LeaveDef = {
    packSec: num(pack['sec'], 1.5), packTapPauses: pack['tapPauses'] !== false,
    gate: {
      spot: spots[str(gate['useSpot'], str(walkPh['to'], 'gate_use'))]?.tile ?? { x: 5, y: 5 },
      guardActorId: guardId,
      markerCycleSec: num(gate['markerCycleSec'], 1.2), windowRatio: num(gate['windowRatio'], 0.22),
      maxAttempts: num(gate['maxAttempts'], 3), beepSuspicion: num(gate['beepSuspicion'], 0.1),
      beepAttractsGuardLook: gate['beepAttractsGuardLook'] === true,
      firstTryWindowScale: gateScript ? num(gateScript['scale'], 1) : 1,
      firstTryAttempts: gateScript ? num(gateScript['attempts'], 1) : 0,
      windowCenter: num(gate['windowCenter'], 0.5),
      waitingCountsAsDisguised: gate['waitingCountsAsDisguised'] === true,
    },
    exitSpot: spots[str(obj(leaveEv['location'])['spot'], 'elevator_main_use')]?.tile ?? { x: 5, y: 2 },
    elevatorWaitSecRange: range2(elevPh['waitSecRange']) ?? [1.5, 3],
    safeAfterGate: elevPh['safeAfterGate'] !== false,
    reward: num(lreward['slackPoints'], 0), earlyLeaveBonusPoints: num(lreward['earlyLeaveBonusPoints'], 0),
  };

  // ── T-133: 대표님 순시·엘리베이터 대표님·공범·위계 연쇄 ──
  const debuts = arr(obj(obj(tables['days'])['generator'])['debuts']).map(obj).filter((d) => d['day'] === day);
  const ceoA = actorRaw.get('ceo');
  const qteOf = (q: O): QteDef => ({
    preCueSecRange: range2(q['preCueSecRange']) ?? [0.6, 1.2], windowSec: num(q['windowSec'], 0.6), maxPressSec: num(q['maxPressSec'], 0.4),
    earlyPenalty: num(q['earlyPenalty'], 0), missPenalty: num(q['missPenalty'], 0), longPressPenalty: num(q['longPressPenalty'], 0),
  });
  const ceoKind = str(plan['ceo'], 'none');
  let ceoVisit: CeoVisitDef | undefined;
  if ((ceoKind === 'scheduled' || ceoKind === 'random') && ceoA) {
    const visit = obj(ceoA['visit']), freeze = obj(visit['freeze']), tw = obj(visit['talkWindow']), surv = obj(ceoA['survival']);
    const i09 = intTable.find((x) => x['id'] === 'INT-09') ?? {};
    const tell09 = obj(i09['tell']);
    const force = obj(debuts.find((d) => d['bossId'] === 'ceo')?.['force']);
    const reacts = arr(ceoA['reactionKeys']).map((x) => str(x));
    const dps = num(plan['dayPhaseSec'], num(rank['dayPhaseSec'], 50));
    ceoVisit = {
      kind: ceoKind, atSec: num(plan['ceoAtSec'], dps * DEFAULTS.ceoAtFrac), patrolId: str(visit['patrolId'], 'p_ceo_visit'),
      tellSec: num(tell09['sec'], 1), ...(typeof tell09['textKey'] === 'string' ? { tellTextKey: tell09['textKey'] as string } : {}),
      greetStop: str(freeze['untilStop'], 'stop_ceo_greet'), talkStop: str(tw['atStop'], 'stop_ceo_talk'),
      freezeMaxSec: num(freeze['maxSec'], 5), moveStartInstantSuspicion: num(freeze['moveStartInstantSuspicion'], 0),
      freezeGazeMultiplier: num(obj(ceoA['sim'])['gazeMultiplier'], 1),
      talkWindowSec: num(tw['durationSec'], 4), talkSlackMultiplier: num(tw['slackMultiplier'], 1),
      exitResumeDelaySec: num(visit['exitResumeDelaySec'], num(obj(ceoA['hierarchy'])['resumeDelaySec'], 1)),
      qte: qteOf(obj(ceoA['greetingQte'])), qteWindowScale: num(force['qteWindowScale'], 1), slowMoTell: num(force['slowMoTell'], 1),
      survivalMaxGain: num(surv['maxSuspicionGain'], 0.15), survivalRequiresQte: surv['requireQteSuccess'] !== false,
      eyeContactPoints: num(surv['rewardSlackPoints'], 0),
      ...(reacts.find((k) => k.endsWith('early_bow')) ? { reactionEarly: reacts.find((k) => k.endsWith('early_bow'))! } : {}),
      ...(reacts.find((k) => k.endsWith('long_bow')) ? { reactionLong: reacts.find((k) => k.endsWith('long_bow'))! } : {}),
    };
  }
  let ceoElevator: CeoElevatorDef | undefined;
  const i11 = intTable.find((x) => x['id'] === 'INT-11');
  if (i11 && ceoA && !ceoVisit && num(obj(obj(rank['cast'])['bosses'])['ceo'], 0) >= 1 && day >= num(i11['unlockDay'], 999)) {
    const trig = obj(i11['trigger']), eff = obj(i11['effect']), tell = obj(i11['tell']);
    const forced = debuts.some((d) => d['interruptId'] === 'INT-11');
    // 난이도·연출 확률(🔶 P4): 시드 스트림 day-{n}-event로 미리 결정 → 같은 날 = 모든 플레이어 같은 결과
    const hit = forced || createRng(`day-${day}-event`).chance(num(trig['chance'], 0));
    if (hit) {
      ceoElevator = {
        patrolId: str(eff['patrolId'], 'p_ceo_elevator'), tellSec: num(tell['sec'], 0.8),
        ...(typeof tell['textKey'] === 'string' ? { tellTextKey: tell['textKey'] as string } : {}),
        qte: qteOf(obj(ceoA['greetingQte'])), successPoints: num(eff['successPoints'], 0), failSuspicion: num(eff['failSuspicion'], 0),
        ...(typeof eff['successLineKey'] === 'string' ? { successLineKey: eff['successLineKey'] as string } : {}),
        ...(typeof eff['failLineKey'] === 'string' ? { failLineKey: eff['failLineKey'] as string } : {}),
      };
    }
  }
  let accomplice: AccompliceDef | undefined;
  const accA = actorRaw.get('accomplice');
  const i12 = intTable.find((x) => x['id'] === 'INT-12');
  const castIds = arr(plan['castPatrols']).map((x) => str(x));
  if (accA && i12 && !ambient.includes('accomplice') && day >= Math.max(num(accA['firstDay'], 1), num(i12['unlockDay'], 1))
    && castIds.includes(str(accA['defaultPatrol'], 'p_accomplice_seat'))) {
    const offer = obj(accA['offer']), eff = obj(accA['effects']);
    const ids = arr(offer['eventIds']).map((x) => str(x));
    const offers: { eventId: string; forced: boolean }[] = [];
    if (plan['generated'] === true || offer['authoredDaysScriptedOnly'] !== true) {
      const rng = createRng(`day-${day}-${str(offer['offerRollStream'], 'npc')}`);
      for (const m of arr(plan['missions']).map(obj)) {
        const id = str(m['eventId']);
        if (ids.includes(id) && rng.chance(num(offer['offerProb'], 0))) offers.push({ eventId: id, forced: false });
      }
    } else {
      for (const b of arr(plan['scripted']).map(obj)) if (b['type'] === 'accomplice_offer') offers.push({ eventId: str(b['eventId']), forced: b['forced'] === true });
    }
    const follow = patrolTable.find((p) => p['kind'] === 'follow' && p['actorId'] === 'accomplice') ?? {};
    const tellKey = str(obj(i12['tell'])['textKey'], 'npc.accomplice.offer');
    // 미션별 제안 문구: '<tellKey>_<미션id>' 키가 있으면 그것(간식 = npc.accomplice.offer_snack), 없으면 tellKey
    const offerTextKeys: Record<string, string> = {};
    for (const id of ids) offerTextKeys[id] = strings[`${tellKey}_${id}`] !== undefined ? `${tellKey}_${id}` : tellKey;
    if (offers.length > 0) {
      accomplice = {
        offers, offerSec: num(offer['offerSec'], 2.5), offerTextKeys,
        rewardMultiplier: num(eff['rewardMultiplier'], 1), suspicionGainMultiplier: num(eff['suspicionGainMultiplier'], 1),
        hitboxIncludesAccomplice: eff['hitboxIncludesAccomplice'] === true,
        lookoutCoughLeadSec: num(eff['lookoutCoughLeadSec'], 0), lookoutRadiusTiles: num(eff['lookoutRadiusTiles'], 0),
        followGapTiles: num(follow['followGapTiles'], 1), seatPatrolId: str(accA['defaultPatrol'], 'p_accomplice_seat'),
        speedTilesPerSec: num(obj(accA['sim'])['speedTilesPerSec'], 3),
        ...(arr(accA['reactionKeys'])[0] ? { reactionKey: str(arr(accA['reactionKeys'])[0]) } : {}),
        ...(offer['missionCommit'] ? { missionCommit: {
          awayFromDesk: commitRule(obj(offer['missionCommit'])['awayFromDesk']), atDesk: commitRule(obj(offer['missionCommit'])['atDesk']),
        } } : {}),
        ...(offer['endsAtMissionCommit'] === true || offer['forcedHoldsUntil'] === 'mission_commit' ? { endsAtMissionCommit: true } : {}),
      };
    }
  }
  let greeting: GreetingDef | undefined;
  const i10 = interrupts.find((x) => x.id === 'INT-10');
  const tg = i10 ? obj(i10.effect['teamLeadGreeting']) : {};
  if (i10 && tg['whenDirectorInZone']) {
    const tl = actorRaw.get('team_lead');
    const sp = spots[str(tg['moveTo'], 'tl_greet_spot')]?.tile;
    if (sp) {
      greeting = {
        bossActorId: 'director', greeterActorId: 'team_lead', zoneId: str(tg['whenDirectorInZone'], 'team'), greetSpot: sp,
        ...(typeof tg['lineKey'] === 'string' ? { lineKey: tg['lineKey'] as string } : {}),
        resumeDelaySec: num(obj(tl?.['hierarchy'])['resumeDelaySec'], 1),
      };
    }
  }
  const routes: RouteDef[] = map.playerRoutes.map((r) => ({
    id: str(r['id']), from: str(r['from']), to: str(r['to']), via: arr(r['via']).map(tile2),
  }));
  const contAd = obj(rules['continueAd']);
  // 이어하기 재개 의심(T-136): rules.continueAd.resumeSuspicion. 구 필드 suspicion.continueResetTo(v3 삭제 예정)는 보조로만
  const resume = typeof contAd['resumeSuspicion'] === 'number' ? contAd['resumeSuspicion'] as number
    : typeof obj(rules['suspicion'])['continueResetTo'] === 'number' ? obj(rules['suspicion'])['continueResetTo'] as number : undefined;
  if (resume === undefined) warn.push('rules.continueAd.resumeSuspicion 없음 → 이어하기 비활성');
  const cutin = obj(rules['caughtCutin']);
  if (typeof cutin['durationSec'] !== 'number') warn.push('rules.caughtCutin.durationSec 없음');
  const h7 = obj(obj(obj(obj(tables['days'])['generator'])['dayInterrupts'])['h7']);

  // ── T-151 성별 시설·회전 관계·그림 ──
  const relations: Record<string, 'same' | 'other'> = {};
  for (const [k, e] of Object.entries(dayCasting(tables, day))) if (e.mode === 'rotate') relations[k] = e.relation;
  const facility = gcfg.enabled ? buildFacility(tables, gcfg, gd, map, spots, missions, interrupts, day, relations) : undefined;
  const tutorialIds = arr(plan['tutorialIds']).map((x) => str(x));
  if (facility?.kind === 'pair' && !tutorialIds.includes('tut_gender_restroom') && missions.some((m) => m.facilityMission)) tutorialIds.push('tut_gender_restroom');
  if (facility?.stop?.relation === 'same' && !tutorialIds.includes('tut_director_restroom')) tutorialIds.push('tut_director_restroom');

  const dayCfg = obj(rules['day']);
  const camera = map.camera;
  const salary = obj(rules['salary']);
  const snack = obj(rules['snackStock']);
  return {
    day, seed: str(plan['seed'], `day-${day}`), rankId, t, weekday: num(plan['weekday'], (day - 1) % 5),
    titleKey: str(plan['titleKey']),
    floor: { level, rules: floorRules },
    camera: {
      visibleAboveTiles: num(camera['visibleAboveTiles'], 11), visibleBelowTiles: num(camera['visibleBelowTiles'], 8),
      deadZoneTiles: num(camera['deadZoneTiles'], 2), lerpPerFrame: num(camera['lerpPerFrame'], 0.15), clampToMap: camera['clampToMap'] !== false,
    },
    spots,
    zones: map.zones,
    playerSeat,
    coverSpots: map.coverSpots,
    introSec: num(dayCfg['introSec'], 2),
    dayPhaseSec: dayPhaseSecFinal,
    // BUG-011: 시계 기준(18시 전 탈출·야근 등)은 데이터(rules.day)에서만 읽는다. 코드 기본 시각 없음 → 빠지면 로드 실패
    clock: {
      startMin: clockOf(dayCfg, 'clockStart'), dayEndMin: clockOf(dayCfg, 'dayPhaseClockEnd'),
      leaveStartMin: clockOf(dayCfg, 'leaveClockStart'), leaveMinPerSec: requiredNum(dayCfg, 'leaveGameMinutesPerSec'),
      earlyLeaveBeforeMin: clockOf(dayCfg, 'earlyLeaveBefore'), overtimeAtMin: clockOf(dayCfg, 'overtimeAt'),
    },
    work: {
      fillPerSec: num(obj(rules['work'])['fillPerSec'], 0.04), max: num(obj(rules['work'])['max'], 1),
      quota: num(plan['workQuotaOverride'], num(rank['workQuota'], 0.4)),
    },
    missions,
    missionsRequired: budget ? budget.required : num(plan['missionsRequired'], missions.length),
    ...(budget ? { budget } : {}),
    leave,
    interrupts,
    patrols,
    actors,
    ambientActors: ambient,
    background,
    scripted: arr(plan['scripted']).map(obj) as unknown as ScriptedBeat[],
    tutorialIds,
    scoring: {
      closeCallBonusPoints: num(disguise['closeCallBonusPoints'], 0),
      snackStockStart: num(snack['startPerDay'], 1), snackStockMax: num(snack['max'], 3),
      star3PeakBelow: num(obj(rules['suspicion'])['star3PeakBelow'], 0.3),
      starMultiplier: arr(salary['starMultiplier']).map((v) => num(v, 0)),
      slackPointsPerWon: num(salary['slackPointsPerWon'], 10),
      salaryBase: num(rank['salaryBase'], 100),
    },
    poseByZone: obj(disguise['poseByZone']) as Record<string, string>,
    resultInputGuardSec: num(obj(rules['input'])['resultInputGuardSec'], DEFAULTS.resultInputGuardSec),
    visualCues: obj(rules['visualCues']),
    ...(ceoVisit ? { ceoVisit } : {}),
    ...(ceoElevator ? { ceoElevator } : {}),
    ...(accomplice ? { accomplice } : {}),
    ...(greeting ? { greeting } : {}),
    routes,
    prep: { ceoPassAvailable: !!ceoVisit && obj(ceoA?.['occurrence'])['skippableByAd'] === true },
    ...(resume !== undefined ? { continueAd: { resumeSuspicion: resume, submitScoreToLeaderboard: contAd['submitScoreToLeaderboard'] === true } } : {}),
    ...(typeof cutin['durationSec'] === 'number' ? { caughtCutinSec: cutin['durationSec'] as number } : {}),
    h7: {
      ceoStartWaitsWhileDirectorOnFloor: h7['ceoStartWaitsWhileDirectorOnFloor'] !== false,
      directorStartWaitsWhileCeoOnFloor: h7['directorStartWaitsWhileCeoOnFloor'] === true,
    },
    playerSpriteKey: str(obj(rules['characters'])['playerSpriteKey'], 'player'),
    ...(facility ? { facility } : {}),
    relations,
    skins: renderSkins(tables, day, opts.playerVariant ?? null),
    ...(tour ? { bossTours: [tour] } : {}),
    layout: {
      source: map.source, mapId: map.id,
      ...(map.gen ? {
        seed: map.gen.seed, complexity: map.gen.complexity, attempts: map.gen.attempts, modules: map.gen.modules, failures: map.gen.failures,
        ...(map.gen.metrics ? { metrics: map.gen.metrics } : {}),
      } : {}),
      ...(trimSec > 0 ? { trimSec } : {}), ...(map.versionTag ? { versionTag: map.versionTag } : {}),
    },
  };
}

// ── T-151 성별 시설 판정 재료 ─────────────────────────────

function sideDef(map: { zones: readonly { id: string; rect: readonly [number, number, number, number] }[]; spots: Readonly<Record<string, { tile: Tile }>> }, type: string, side: 'a' | 'b'): FacilitySideDef | undefined {
  const door = map.spots[`${type}_${side}_door`]?.tile, stall = map.spots[`${type}_${side}_stall`]?.tile;
  if (!door || !stall) return undefined;
  const sink = map.spots[`${type}_${side}_sink`]?.tile ?? map.spots[`${type}_${side}_bench`]?.tile;
  return { side, door, stall, ...(sink ? { sink } : {}), tiles: facilityTiles(map, `${type}_${side}`, `${type}_${side}_door`) };
}

/**
 * layout.genderFacilities + INT-10 facilityStop + genderModifiers(facility_closed) → FacilityDef.
 * 생성 층(rest_meet_g) = pair, 수작업 맵(1~2일차·폴백) = authored(화장실 1곳 = 항상 내 쪽, authoredMap.restroomIsMine)
 */
function buildFacility(
  tables: Tables, cfg: ReturnType<typeof genderFacilityConfig>, gd: GenderDayCtx | null,
  map: { zones: readonly { id: string; rect: readonly [number, number, number, number] }[]; spots: Readonly<Record<string, { tile: Tile; facing?: Dir }>>; nodes?: Readonly<Record<string, Tile>> },
  spots: Readonly<Record<string, { tile: Tile; facing?: Dir }>>, missions: readonly MissionDef[], interrupts: readonly DayInterruptDef[], day: number,
  relations: Readonly<Record<string, 'same' | 'other'>>,
): FacilityDef | undefined {
  const base = { otherDoorHintKey: cfg.otherDoorHintKey, talkCancelAtMineDoor: cfg.talkCancelAtMineDoor, talkCancelLineKey: cfg.talkCancelLineKey };
  const ra = sideDef(map, 'restroom', 'a'), rb = sideDef(map, 'restroom', 'b');
  let fac: FacilityDef | undefined;
  if (gd && ra && rb) {
    const mine = gd.mine === 'a' ? ra : rb, other = gd.mine === 'a' ? rb : ra;
    const la = sideDef(map, 'locker', 'a'), lb = sideDef(map, 'locker', 'b');
    fac = {
      kind: 'pair', mineSide: gd.mine, restroom: { mine, other }, ...base, mineHintKey: cfg.hintKeys[gd.mine],
      ...(la && lb ? { locker: gd.lockerMine === 'a' ? { mine: la, other: lb } : { mine: lb, other: la } } : {}),
    };
  } else {
    const door = spots['restroom_door']?.tile, stall = spots['restroom_stall']?.tile;
    if (!door || !stall) return undefined;
    const tiles = facilityTiles(map, 'restroom', 'restroom_door');
    fac = { kind: 'authored', mineSide: null, restroom: { mine: { side: 'authored', door, stall, tiles } }, ...base };
  }
  // C2·C3: 본부장(INT-10) 화장실 들름 — 생성 층 화장실 쌍 + 그날 INT-10(근무) + fromDay 이상
  const i10 = interrupts.find((i) => i.id === 'INT-10' && i.phase === 'day');
  const fs = obj(i10?.effect['facilityStop']);
  if (fac.kind === 'pair' && i10 && fs['tellSec'] !== undefined && day >= num(fs['fromDay'], 18) && arr(fs['phases']).includes('day')) {
    const rel = relations[str(fs['relationOf'], 'director')] ?? castRelation(tables, day, 'director');
    const tgt = str(obj(fs['target'])[rel]);
    const target = tgt === 'restroom.mine' ? fac.restroom.mine : tgt === 'restroom.other' ? fac.restroom.other : undefined;
    const nodes = ['n_d_top', 'n_d_bot'].map((k) => map.nodes?.[k]).filter((t): t is Tile => !!t);
    if (target && nodes.length > 0) {
      const ic = obj(fs['insideCone']), se = obj(fs['seenInsideEffect']), wi = obj(fs['whileInside']), tl = obj(fs['tell']), cue = obj(fs['insideCue']);
      const sinkName = `restroom_${target.side}_sink`;
      const stop: FacilityStopDef = {
        relation: rel, nodes, target, maxPerDay: num(fs['maxPerDay'], 1), tellSec: num(fs['tellSec'], 1), insideSec: num(fs['insideSec'], 3),
        cone: { range: num(ic['range'], 3), halfAngleDeg: num(ic['halfAngleDeg'], 60) },
        suspicionOnce: num(se['suspicionOnce'], 0), stopSec: num(se['stopSec'], 0),
        ...(typeof se['lineKey'] === 'string' ? { meetLineKey: se['lineKey'] as string } : {}),
        ...(typeof se['reactionKey'] === 'string' ? { reactionKey: se['reactionKey'] as string } : {}),
        ...(typeof tl['textKey'] === 'string' ? { tellTextKey: tl['textKey'] as string } : {}),
        ...(typeof wi['otherSideToastKey'] === 'string' ? { awayToastKey: wi['otherSideToastKey'] as string } : {}),
        cueMinSec: Math.max(num(cue['minSec'], 0.4), num(obj(obj(tables['rules'])['tell'])['minSec'], 0.4)),
        ...(spots[sinkName]?.facing ? { sinkFacing: spots[sinkName]!.facing! } : {}),
        skipIfCeo: arr(fs['skipIf']).includes('ceo_on_floor'),
      };
      fac = { ...fac, stop };
    }
  }
  // C4: 화장실 피신 '청소 시간'(facility_closed)
  const rm = missions.find((m) => m.modifierTypes?.includes('facility_closed'));
  if (rm && typeof rm.params['windowSec'] === 'number') {
    const detour = rm.params['detourTo'] === 'locker.mine' ? fac.locker?.mine.stall : undefined;
    fac = {
      ...fac, cleaning: {
        missionId: rm.id, windowSec: rm.params['windowSec'] as number, signKey: str(rm.params['signKey'], 'facility.cleaning.sign'),
        ...(detour ? { detourStall: detour } : {}),
        ...(typeof rm.params['failReactionKey'] === 'string' ? { failReactionKey: rm.params['failReactionKey'] as string } : {}),
      },
    };
  }
  return fac;
}
