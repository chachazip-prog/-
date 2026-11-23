/**
 * game/data/*.json v2 → DayContent 조립 (design/data-schema.md §0-1). 순수 함수 — Vite·Phaser 무관.
 * 씬은 data/loader.ts의 테이블을, QA는 fs로 읽은 테이블을 넘기면 같은 결과를 얻는다.
 *
 * 데이터에 값이 없을 때 쓰는 기본값은 DEFAULTS에 모았다(D-054: 기획이 데이터에 추가 예정인 임시값).
 */
import { createRng } from '../core/rng';
import type { FloorRules, LevelDef } from '../core/floorSim';
import type { LegendEntry, Tile } from '../core/grid';
import type { ConeState, NpcDef, TalkDef, WaypointDef } from '../core/patrol';
import type { Dir } from '../core/vision';
import type {
  AccompliceDef, ActorInfo, BackgroundDef, CeoElevatorDef, CeoVisitDef, DayContent, DayInterruptDef, GreetingDef, LeaveDef, Mechanic,
  MissionDef, QteDef, RouteDef, ScriptedBeat,
} from '../core/day/types';
import { applyInterpScaling, applyOverrideScaling, rankProgress } from './scaling';

/** 데이터 미정 기본값 (D-054). 데이터에 같은 이름의 값이 생기면 그쪽이 우선 */
export const DEFAULTS = {
  /** 결과 화면 표시 직후 탭을 무시하는 시간(BUG-006). rules.ui.resultInputGuardSec 예정 */
  resultInputGuardSec: 0.6,
  /** 말걸기 문구 대체 키 */
  talkWarnKey: 'talk.warn_default',
  talkDodgedKey: 'talk.dodged_default',
  /** 말걸기 전조 최소(rules.talk.tellSecMin이 있으면 그 값) */
  talkWarnSec: 0.5,
  /** 이어하기 재개 의심(rules.continueAd에 숫자 필드가 없음: ads.json effect 'resume_suspicion_0_6_at_checkpoint'·GDD §6-1 값) [데이터 요청: rules.continueAd.resumeSuspicion] */
  continueResumeSuspicion: 0.6,
  /** 대표님 순시 예정 시각 비율(생성기가 ceoAtSec를 주지 않은 경우) */
  ceoAtFrac: 0.55,
} as const;

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const range2 = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : undefined;
const tile2 = (v: unknown): Tile => (Array.isArray(v) ? { x: num(v[0], 0), y: num(v[1], 0) } : { x: num(obj(v)['x'], 0), y: num(obj(v)['y'], 0) });

export function hhmm(s: string): number {
  const m = /^(\d+):(\d+)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export type Tables = Readonly<Record<string, unknown>>;

export interface BuildWarnings { push(msg: string): void }

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
export function dayPlan(tables: Tables, day: number): O {
  const authored = arr(obj(tables['days'])['authoredDays']).map(obj).find((d) => d['day'] === day);
  return authored ?? generateDay(tables, day);
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
export function generateDay(tables: Tables, day: number): O {
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
  const pool = arr(rank['eventPool']).map(obj);
  const picked: string[] = [];
  const left = pool.slice();
  for (let i = 0; i < count && left.length > 0; i++) {
    const e = plan.weighted(left, (x) => num(x['weight'], 1));
    if (!e) break;
    picked.push(str(e['eventId']));
    left.splice(left.indexOf(e), 1);
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
  // H7: 대표님 순시 ±25초 안의 본부장 순찰 금지, 순시 날 인사팀(INT-05·06) 없음. 충돌하면 그 방해를 뺀다(재배치는 하지 않음)
  const H7_GAP_SEC = 25; // days.generator.dayInterrupts.constraints 문장의 값(데이터 필드 없음 → 스키마 v3 요청)
  const dayInts = ceoDay
    ? dayInterrupts.filter((d) => !['INT-05', 'INT-06'].includes(str(d['id'])) && !(d['id'] === 'INT-10' && Math.abs(num(d['atSec'], 0) - ceoAtSec) < H7_GAP_SEC))
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
  return {
    day, rankId: rank['id'], weekday: (day - 1) % 5, seed: `day-${day}`, mapId: 'office_floor_1',
    titleKey: 'day.generated.title',
    tutorialIds: arr(obj(obj(tables['days'])['generator'])['debuts']).map(obj).filter((d) => d['day'] === day && typeof d['tutorialId'] === 'string').map((d) => d['tutorialId']),
    dayPhaseSec, missions, missionsRequired: required,
    castPatrols, dayInterrupts: dayInts, leaveInterrupts, scripted: [], ceo: ceoPlan.kind, generated: true,
    ...(ceoDay ? { ceoAtSec } : {}),
  };
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
export function buildDayContent(tables: Tables, day: number, warn: BuildWarnings = { push: () => {} }): DayContent {
  const rules = obj(tables['rules']);
  const plan = dayPlan(tables, day);
  const ranks = arr(obj(tables['ranks'])['ranks']).map(obj);
  const rank = ranks.find((r) => r['id'] === plan['rankId']) ?? rankFor(tables, day);
  const rankId = str(rank['id'], 'intern');
  const dr = arr(rank['dayRange']);
  const t = rankProgress(day, [num(dr[0], 1), dr[1] === null ? null : num(dr[1], 1)]);
  const map = arr(obj(tables['maps'])['maps']).map(obj).find((m) => m['id'] === str(plan['mapId'], 'office_floor_1'));
  if (!map) throw new Error(`content: 맵 ${String(plan['mapId'])} 없음`);

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
  };

  // ── 방해 이벤트(이 날 켜진 것) ──
  const intTable = arr(obj(tables['interrupts'])['interrupts']).map(obj);
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
  for (const r of arr(plan['dayInterrupts']).map(obj)) addInt(r, 'day');
  for (const r of arr(plan['leaveInterrupts']).map(obj)) addInt(r, 'leave');
  const enabledInts = new Set(interrupts.map((i) => i.id));

  // ── 액터(직급 보간) ──
  const bosses = arr(obj(tables['bosses'])['bosses']).map(obj);
  const npcs = arr(obj(tables['npcs'])['npcs']).map(obj);
  const actorRaw = new Map<string, O>();
  for (const a of [...bosses, ...npcs]) actorRaw.set(str(a['id']), applyInterpScaling(a, rankId, t));
  const strings = obj(obj(tables['strings.ko'])['strings']);
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
    // 대표님 재확인(fake.type 'recheck')은 '전조 후 헛기침'이 아니라 웨이포인트 lookChance로 표현된 진짜 시선이다 → 페이크로 쓰지 않음
    if (obj(sim['fake'])['type'] === 'recheck') delete d['fake'];
    return d as unknown as NpcDef;
  };
  const patrols: Record<string, NpcDef> = {};
  for (const p of patrolTable) {
    if (p['mapId'] !== map['id']) continue;
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
    const wps: WaypointDef[] = behavior === 'walk'
      ? arr(b['waypoints']).map(obj).map(toWaypoint)
      : [{ x: num(at['x'], 0), y: num(at['y'], 0), waitSec: 0, ...(typeof at['facing'] === 'string' ? { facing: at['facing'] as Dir } : {}) }];
    const id = str(b['id'], `bg_${background.length}`);
    background.push({
      sprite,
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
  const spots: Record<string, { tile: Tile; facing?: Dir }> = {};
  for (const [k, v] of Object.entries(obj(map['spots']))) {
    const s = obj(v);
    spots[k] = { tile: tile2(s['tile']), ...(typeof s['facing'] === 'string' ? { facing: s['facing'] as Dir } : {}) };
  }
  const legend: Record<string, LegendEntry> = {};
  for (const [ch, e] of Object.entries(obj(map['legend']))) legend[ch] = obj(e) as unknown as LegendEntry;
  const level: LevelDef = {
    id: str(map['id']), rows: arr(map['rows']).map((r) => str(r)), legend,
    playerStart: tile2(map['playerStart']), exitZone: str(map['exitZone'], 'exit'), npcs: cast,
  };
  const playerSeat = spots['player_seat']?.tile ?? level.playerStart;

  // ── 미션 ──
  const events = arr(obj(tables['events'])['events']).map(obj);
  const missions: MissionDef[] = [];
  for (const m of arr(plan['missions']).map(obj)) {
    const e = events.find((x) => x['id'] === m['eventId']);
    if (!e) { warn.push(`days.${day}: 미션 ${String(m['eventId'])} 없음`); continue; }
    const loc = obj(e['location']);
    const spot = spots[str(loc['spot'])]?.tile ?? playerSeat;
    const params = applyOverrideScaling(obj(e['params']), obj(e['rankScaling']) as Record<string, Record<string, unknown>>, rankId);
    const reward = obj(e['reward']);
    missions.push({
      id: str(e['id']), nameKey: str(e['nameKey']), descKey: str(e['descKey']), iconSprite: str(e['iconSprite']),
      mechanic: str(e['mechanic']) as Mechanic, unlockAtSec: num(m['unlockAtSec'], 0), spot,
      startsAt: e['startsAt'] === 'chip_tap_at_seat' ? 'chip_tap_at_seat' : 'arrive_spot',
      completeAt: e['completeAt'] === 'on_success' ? 'on_success' : 'return_to_seat',
      awayFromDesk: e['awayFromDesk'] === true, timeLimitSec: num(e['timeLimitSec'], 30),
      reward: { slackPoints: num(reward['slackPoints'], 0), ...(typeof reward['snackStock'] === 'number' ? { snackStock: reward['snackStock'] as number } : {}) },
      failPenalty: num(obj(e['failPenalty'])['suspicion'], 0), timeoutPenalty: num(obj(e['timeoutPenalty'])['suspicion'], 0),
      params, ...(typeof e['tutorialId'] === 'string' ? { tutorialId: e['tutorialId'] as string } : {}),
    });
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
  const routes: RouteDef[] = arr(map['playerRoutes']).map(obj).map((r) => ({
    id: str(r['id']), from: str(r['from']), to: str(r['to']), via: arr(r['via']).map(tile2),
  }));
  const contAd = obj(rules['continueAd']);

  const dayCfg = obj(rules['day']);
  const camera = obj(map['camera']);
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
    zones: arr(map['zones']).map(obj).map((z) => ({
      id: str(z['id']), nameKey: str(z['nameKey']), rect: (arr(z['rect']).map((v) => num(v, 0)) as unknown) as [number, number, number, number],
      ...(z['outsideOffice'] === true ? { outsideOffice: true } : {}),
    })),
    playerSeat,
    coverSpots: arr(map['coverSpots']).map(obj).map((c) => tile2(c['tile'])),
    introSec: num(dayCfg['introSec'], 2),
    dayPhaseSec: num(plan['dayPhaseSec'], num(rank['dayPhaseSec'], 50)),
    clock: {
      startMin: hhmm(str(dayCfg['clockStart'], '09:00')), dayEndMin: hhmm(str(dayCfg['dayPhaseClockEnd'], '17:48')),
      leaveStartMin: hhmm(str(dayCfg['leaveClockStart'], '17:48')), leaveMinPerSec: num(dayCfg['leaveGameMinutesPerSec'], 1),
      earlyLeaveBeforeMin: hhmm(str(dayCfg['earlyLeaveBefore'], '18:00')), overtimeAtMin: hhmm(str(dayCfg['overtimeAt'], '18:18')),
    },
    work: {
      fillPerSec: num(obj(rules['work'])['fillPerSec'], 0.04), max: num(obj(rules['work'])['max'], 1),
      quota: num(plan['workQuotaOverride'], num(rank['workQuota'], 0.4)),
    },
    missions,
    missionsRequired: num(plan['missionsRequired'], missions.length),
    leave,
    interrupts,
    patrols,
    actors,
    ambientActors: ambient,
    background,
    scripted: arr(plan['scripted']).map(obj) as unknown as ScriptedBeat[],
    tutorialIds: arr(plan['tutorialIds']).map((x) => str(x)),
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
    continueAd: {
      resumeSuspicion: num(contAd['resumeSuspicion'], DEFAULTS.continueResumeSuspicion),
      submitScoreToLeaderboard: contAd['submitScoreToLeaderboard'] === true,
    },
    playerSpriteKey: str(obj(rules['characters'])['playerSpriteKey'], 'player'),
  };
}
