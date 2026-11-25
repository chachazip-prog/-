/**
 * 팀장 순회(D-075) — layout.json leadRoaming → BossTourDef (T-145, 스키마 §4 '변환하는 법'). 순수 TS. devTour.ts(임시 상수)를 대체.
 * 시드 스트림 `day-{n}-tour`(같은 날 = 모든 사용자 같은 일정).
 * 확장 8개: endTell(복귀 전조) · locksMissions(회의 중 낮잠) · bubbleIcon(출발 말풍선) · 회의실 문 '사용 중' ·
 *           대표님 순시는 팀장 자리에 있을 때만 · 복귀 직후 첫 돌아보기 정상 전조 · 자리 비움 6~22초 보정 · 퇴근 4초 전 복귀
 * 충돌 규칙: 대표님 예정 시각(schedule.ceoClearance, 없으면 ±20초) · 본부장 순찰 ±10초 exec_report 제외 · 근무 INT-08 = meeting 순회 1회로 흡수(횟수 포함)
 * T-155(T-156 추가 규칙 1~5): byRank.awayMaxSec·minGapSec·ceoDayCountRange, schedule.ceoClearance(앞 회차 밀기 다음에 적용), schedule.fitToWindow(계획 = 실제 출발).
 * 자리 비움 추정 = 전조 + 걷기 + 대기 + 복귀 전조 + 앉기(sitSec) + 기대 둘러보기(목적지 lookChance) + 기대 뒤돌아보기(glanceBack) + 모퉁이 전조 × cornerTellShare
 */
import { createRng, type Rng } from '../core/rng';
import { findPath } from '../core/pathfinding';
import type { GridMap, Tile } from '../core/grid';
import type { Dir } from '../core/vision';
import type { BossTourDef, BossTourStop } from '../core/day/types';

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const pair = (v: unknown, d: [number, number]): [number, number] => { const a = arr(v); return [num(a[0], d[0]), num(a[1], d[1])]; };
const round1 = (x: number) => Math.round(x * 10) / 10;

export interface LeadTourInput {
  readonly leadRoaming: O;
  readonly day: number;
  readonly rankId: string;
  readonly dayPhaseSec: number;
  readonly tellMinSec: number;
  readonly spots: Readonly<Record<string, { readonly tile: Tile; readonly facing?: Dir }>>;
  readonly grid: GridMap;
  /** v3 V09 통과 목적지(없으면 전부 후보) */
  readonly tourOk?: readonly string[];
  readonly ceoAtSec?: number;
  readonly directorAtSec: readonly number[];
  /** 근무 INT-08(회의) 시각과 회의 길이 */
  readonly meetings: readonly { readonly atSec: number; readonly waitSec: number }[];
  /** 순회하는 사람의 시선 시간 재료(앉은 순찰 액터 sim, 직급 보간). 없으면 둘러보기·뒤돌아보기·모퉁이 전조를 추정에 넣지 않음 */
  readonly walker?: TourWalkerTiming;
}

/** 자리 비움 추정용 시선 시간(T-155). 값은 액터 sim·rules.sight에서 온다 */
export interface TourWalkerTiming {
  /** 정지 둘러보기·뒤돌아보기 전조 평균(stopLookTellSec, 없으면 tellSecRange 평균) */
  readonly lookTellSec: number;
  /** 돌아보기 유지 평균(lookSecRange 평균) */
  readonly lookSec: number;
  /** 페이크 확률(min(chance, capChance, 전역 상한))과 페이크 뒤 멈춤 */
  readonly fakeProb: number;
  readonly afterFakeSec: number;
  readonly glanceBackChancePerTile: number;
  /** 모퉁이 전조(rules.sight.cornerTurnTellSec) */
  readonly turnTellSec: number;
  /** 모퉁이 중 실제로 전조가 나는 비율(조건부 D-044: 새 방향 콘에 플레이어가 있을 때만). [임시] 데이터 없음 */
  readonly cornerTellShare: number;
  /** 자리 도착 후 앉기(콘 없음) */
  readonly sitSec: number;
}

interface Dest { id: string; tile: Tile; facing?: Dir; d: O }

export function buildLeadTour(inp: LeadTourInput): BossTourDef | null {
  const R = inp.leadRoaming;
  if (R['enabled'] !== true || inp.day < num(R['appliesFromDay'], 6)) return null;
  const B = obj(obj(R['byRank'])[inp.rankId]);
  if (!B['countRange']) return null;
  const seat = inp.spots['tl_seat']?.tile;
  const pseat = inp.spots['player_seat']?.tile;
  if (!seat) return null;
  const dests: Dest[] = [];
  for (const d of arr(R['destinations']).map(obj)) {
    if (num(d['minDay'], 0) > inp.day) continue;
    if (inp.tourOk && !inp.tourOk.includes(str(d['id']))) continue;
    const name = arr(d['spots']).map((s) => str(s)).find((s) => inp.spots[s]);
    const sp = name ? inp.spots[name] : undefined;
    if (sp) dests.push({ id: str(d['id']), tile: sp.tile, ...(sp.facing ? { facing: sp.facing } : {}), d });
  }
  if (dests.length === 0) return null;
  const sched = obj(R['schedule']);
  const speed = num(B['speedTilesPerSec'], 2);
  const waitMul = num(B['waitMul'], 1);
  const stand = obj(R['standTell']);
  const standTellSec = Math.max(inp.tellMinSec, num(stand['minSec'], 0), num(stand['sec'], 1));
  const [awayMin, awayMax0] = pair(R['awaySecRange'], [6, 22]);
  // T-156 규칙 1·2: 직급 값 우선
  const awayMax = num(B['awayMaxSec'], awayMax0);
  const minGap = num(B['minGapSec'], num(sched['minGapSec'], 8));
  const dp = inp.dayPhaseSec;
  const W = inp.walker;
  const sitSec = W?.sitSec ?? 0;
  // 경로(팀장은 내 자리 칸을 피함, walk.avoidTiles)
  const blocked = pseat ? (x: number, y: number) => x === pseat.x && y === pseat.y : undefined;
  const pcache = new Map<string, readonly Tile[] | null>();
  const pathOf = (a: Tile, b: Tile): readonly Tile[] | null => {
    const k = `${a.x},${a.y}>${b.x},${b.y}`;
    if (!pcache.has(k)) pcache.set(k, findPath(inp.grid, a, b, blocked));
    return pcache.get(k)!;
  };
  const pathLen = (a: Tile, b: Tile): number => Math.max(0, (pathOf(a, b)?.length ?? 100) - 1);
  /** 경로의 방향 전환 수(모퉁이) */
  const cornersOf = (path: readonly Tile[] | null): number => {
    if (!path) return 0;
    let n = 0, pdx = 0, pdy = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i]!.x - path[i - 1]!.x, dy = path[i]!.y - path[i - 1]!.y;
      if (i > 1 && (dx !== pdx || dy !== pdy)) n++;
      pdx = dx; pdy = dy;
    }
    return n;
  };
  const stopOf = (d: Dest, rng: Rng, waitOverride?: number): BossTourStop => {
    const et = obj(d.d['endTell']);
    const sfx = [str(et['sfxNew']), str(et['sfx']), str(et['sfxFallback'])].filter((s) => s);
    return {
      id: d.id, tile: d.tile, ...(d.facing ? { facing: d.facing } : {}),
      waitSec: waitOverride ?? round1(rng.range(...pair(d.d['waitSecRange'], [3, 4])) * waitMul),
      lookChance: num(d.d['lookChance'], 0),
      ...(typeof d.d['bubbleIcon'] === 'string' ? { bubbleIcon: d.d['bubbleIcon'] as string } : {}),
      ...(typeof d.d['lineKey'] === 'string' ? { lineKey: d.d['lineKey'] as string } : {}),
      ...(typeof d.d['pose'] === 'string' ? { pose: d.d['pose'] as string } : {}),
      ...(typeof d.d['floorMark'] === 'string' ? { floorMark: d.d['floorMark'] as string } : {}),
      ...(d.d['endTell'] ? { endTell: { sec: Math.max(inp.tellMinSec, num(et['sec'], 1)), ...(sfx.length ? { sfx } : {}), ...(typeof et['lineKey'] === 'string' ? { lineKey: et['lineKey'] as string } : {}) } } : {}),
      ...(Array.isArray(d.d['locksMissions']) ? { locksMissions: arr(d.d['locksMissions']).map((x) => str(x)) } : {}),
      ...(d.d['meetingRoomDoor'] === 'busy_while_inside' ? { meetingDoorBusy: true } : {}),
    };
  };
  // 돌아보기 1회 기대 길이(전조 + 유지, 페이크면 유지 대신 afterFakeSec)
  const lookCost = W ? W.lookTellSec + (1 - W.fakeProb) * W.lookSec + W.fakeProb * W.afterFakeSec : 0;
  /** 자리 비움 추정(T-155): 앉기·기대 둘러보기·기대 뒤돌아보기·모퉁이 전조 포함 */
  const awayOf = (route: readonly BossTourStop[]): number => {
    let tiles = 0, mid = 0, corners = 0, cur = seat;
    const legs = [...route.map((s) => s.tile), seat];
    for (const nx of legs) {
      const p = pathOf(cur, nx);
      const len = Math.max(0, (p?.length ?? 100) - 1);
      tiles += len; mid += Math.max(0, len - 1); corners += cornersOf(p);
      cur = nx;
    }
    let sec = standTellSec + tiles / speed + sitSec + route.reduce((t, s) => t + s.waitSec + (s.endTell?.sec ?? 0), 0);
    if (W) {
      sec += route.reduce((t, s) => t + (s.waitSec > 0 ? (s.lookChance ?? 0) * lookCost : 0), 0);
      sec += mid * W.glanceBackChancePerTile * lookCost;
      sec += corners * W.turnTellSec * W.cornerTellShare;
    }
    return round1(sec);
  };
  const rng = createRng(`day-${inp.day}-tour`);
  const [c0, c1] = pair(B['countRange'], [2, 2]);
  let n = rng.int(c0, c1);
  // T-156 규칙 3: 대표님 날 n = min(평소 추첨, ceoDayCountRange 추첨). 시드 소비는 대표님 날에만 1회 추가
  const cdr = arr(B['ceoDayCountRange']);
  if (inp.ceoAtSec !== undefined && cdr.length === 2) n = Math.min(n, rng.int(num(cdr[0], n), num(cdr[1], n)));
  const a = dp * num(sched['firstAtFrac'], 0.15), b = dp * num(sched['lastAtFrac'], 0.8);
  const seg = (b - a) / Math.max(1, n);
  interface Entry { at: number; route: BossTourStop[]; from: string | null; fixed: boolean; shrunk: boolean }
  const entries: Entry[] = [];
  const firstDay = num(R['appliesFromDay'], 6);
  let prevFirst: string | null = null;
  const nearDir = (at: number) => inp.directorAtSec.some((t) => Math.abs(t - at) <= 10);
  for (let i = 0; i < n; i++) {
    const at = round1(a + seg * i + rng.range(0.1, 0.6) * seg);
    const [s0, s1] = pair(B['stopsPerTour'], [1, 1]);
    const k = rng.int(s0, s1);
    const nearDirector = nearDir(at);
    let pool = dests.filter((d) => d.id !== prevFirst && !(d.id === 'exec_report' && nearDirector));
    let route: BossTourStop[] = [];
    for (let tries = 0; tries < 3 && pool.length > 0; tries++) {
      const left = pool.slice();
      const picks: Dest[] = [];
      for (let j = 0; j < k && left.length > 0; j++) {
        const d = rng.weighted(left, (x) => num(x.d['weight'], 1));
        if (!d) break;
        left.splice(left.indexOf(d), 1);
        picks.push(d);
      }
      route = picks.map((d) => stopOf(d, rng));
      if (awayOf(route) <= awayMax || route.length === 0) break;
      // 상한(awayMax) 초과: 가장 먼 목적지를 빼고 다시 고름
      const far = picks.slice().sort((x, y) => pathLen(seat, y.tile) - pathLen(seat, x.tile))[0]!;
      pool = pool.filter((d) => d !== far);
    }
    if (route.length === 0) continue;
    // 그래도 상한 초과: 가장 가까운 목적지 하나만, 그래도 넘으면 대기를 최소(waitSecRange[0] × waitMul)로
    if (awayOf(route) > awayMax && route.length > 1) route = [route.slice().sort((x, y) => pathLen(seat, x.tile) - pathLen(seat, y.tile))[0]!];
    if (awayOf(route) > awayMax) {
      route = route.map((st0) => {
        const d = dests.find((q) => q.id === st0.id)!;
        return { ...st0, waitSec: round1(pair(d.d['waitSecRange'], [3, 4])[0] * waitMul) };
      });
    }
    // 6초 미만: 마지막 목적지 대기를 늘림
    const aw = awayOf(route);
    if (aw < awayMin) { const last = route[route.length - 1]!; route[route.length - 1] = { ...last, waitSec: round1(last.waitSec + (awayMin - aw)) }; }
    // 6일차 첫 순회 = printer 고정(튜토리얼)
    let fixed = false;
    if (inp.day === firstDay && entries.length === 0) {
      const pr = dests.find((d) => d.id === 'printer');
      if (pr) { route = [stopOf(pr, rng)]; fixed = true; }
    }
    prevFirst = route[0]!.id;
    entries.push({ at, route, from: null, fixed, shrunk: false });
  }
  // 근무 INT-08 = meeting 순회(가장 가까운 회차를 대체)
  const meetingDest = dests.find((d) => d.id === 'meeting');
  for (const m of inp.meetings) {
    if (!meetingDest) break;
    // 대기 = leadRoaming meeting.waitSecRange(INT-08 근무판 흡수). m.waitSec(INT-08 meetingSec)는 범위 밖일 때만 상한으로
    const wr = pair(meetingDest.d['waitSecRange'], [m.waitSec, m.waitSec]);
    const stop = stopOf(meetingDest, rng, round1(Math.min(m.waitSec, rng.range(wr[0], wr[1])) * waitMul));
    let best: Entry | null = null;
    for (const e of entries) if (e.from === null && (!best || Math.abs(e.at - m.atSec) < Math.abs(best.at - m.atSec))) best = e;
    if (best) { best.at = round1(m.atSec); best.route = [stop]; best.from = 'INT-08'; best.fixed = false; }
    else entries.push({ at: round1(m.atSec), route: [stop], from: 'INT-08', fixed: false, shrunk: false });
  }
  const latestFrac = dp * num(sched['latestStartFrac'], 0.85);
  const cc = sched['ceoClearance'] !== undefined ? obj(sched['ceoClearance']) : null;
  const ceoBefore = num(cc?.['returnBeforeSec'], 20), ceoAfter = num(cc?.['departAfterSec'], 20);
  /** 실제 밀기 규칙으로 출발 시각 계산: 정렬 → 앞 회차 복귀 + minGap → (T-156 규칙 4) 대표님 충돌. ceoClearance가 없으면 기존 ±20초(밀기 전) */
  const resolve = (): { e: Entry; at: number; away: number }[] => {
    const sorted = entries.slice().sort((x, y) => x.at - y.at);
    const out: { e: Entry; at: number; away: number }[] = [];
    for (const e of sorted) {
      let at = e.at;
      const away = awayOf(e.route);
      const ceo = inp.ceoAtSec;
      if (ceo !== undefined && !cc && Math.abs(at - ceo) < 20) at = round1(ceo + 20);
      const prev = out[out.length - 1];
      if (prev && at < prev.at + prev.away + minGap) at = round1(prev.at + prev.away + minGap);
      if (ceo !== undefined && cc && at + away > ceo - ceoBefore && at < ceo + ceoAfter) at = round1(ceo + ceoAfter);
      out.push({ e, at, away });
    }
    return out;
  };
  // T-156 규칙 5 fitToWindow: 마감(latestStartFrac)을 넘는 회차가 있으면 가장 긴 회차를 가까운 1곳 + 최소 대기로 줄이고, 줄일 게 없으면 마지막 비INT-08 회차 삭제
  if (obj(sched['fitToWindow'])['enabled'] === true) {
    const nearest = dests.filter((d) => d.id !== 'meeting' && d.id !== 'exec_report').sort((x, y) => pathLen(seat, x.tile) - pathLen(seat, y.tile));
    for (let guard = 0; guard < 40; guard++) {
      const res = resolve();
      if (!res.some((r) => r.at > latestFrac)) break;
      let li = -1;
      for (let i = 0; i < res.length; i++) {
        const r = res[i]!;
        if (r.e.shrunk || r.e.fixed || r.e.from !== null) continue;
        if (li < 0 || r.away > res[li]!.away) li = i;
      }
      if (li >= 0 && nearest.length > 0) {
        const r = res[li]!;
        const prevId = li > 0 ? res[li - 1]!.e.route[0]?.id : undefined;
        const alt = nearest.find((d) => d.id !== prevId) ?? nearest[0]!;
        const st = stopOf(alt, rng, round1(pair(alt.d['waitSecRange'], [3, 4])[0] * waitMul));
        if (awayOf([st]) < r.away) r.e.route = [st];
        r.e.shrunk = true;
        continue;
      }
      let di = -1;
      for (let i = res.length - 1; i >= 0; i--) if (res[i]!.e.from === null) { di = i; break; }
      if (di < 0) break;
      entries.splice(entries.indexOf(res[di]!.e), 1);
    }
  }
  const final = resolve();
  const seatedBefore = num(sched['mustBeSeatedBeforeLeaveSec'], 4);
  return {
    actorId: str(R['actorId'], 'team_lead'), seatPatrolId: str(R['seatPatrolId'], 'p_tl_seat'),
    atSec: final.map((t) => t.at), routes: final.map((t) => t.e.route), standTellSec,
    latestStartSec: latestFrac,
    // 출발 마감은 latestStartFrac 하나. '퇴근 4초 전 자리'는 출발을 막지 않고 런타임에 체류를 줄여 바로 복귀(schedule.rule)
    latestStartByTour: final.map(() => round1(latestFrac)), mustBeSeatedBeforeLeaveSec: seatedBefore,
    awaySec: final.map((t) => t.away), fromInterrupt: final.map((t) => t.e.from),
    speedTilesPerSec: speed,
    ...(sitSec > 0 ? { sitSec } : {}),
    coneActiveIn: arr(R['coneActiveIn']).map((x) => str(x)) as BossTourDef['coneActiveIn'] & string[],
    standSfx: [str(stand['sfxNew']), str(stand['sfxFallback'])].filter((s) => s),
    firstLookPlain: true, ceoWaitsForSeat: true,
    awayBadgeKey: str(obj(R['seatEmptyCue'])['hudBadgeKey'], 'hud.tl_away'),
    ...(inp.day === firstDay ? { firstTutorialId: 'tut_tour' } : {}),
  };
}

/** during_tour 조건용: 근무 구간 안에서 '충분히 긴'(≥ minSec) 순회 수 */
export function longTourCount(t: BossTourDef | null, minSec = 8): number {
  if (!t) return 0;
  return (t.awaySec ?? []).filter((a) => a >= minSec).length;
}
