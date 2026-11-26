/**
 * 팀장 순회(D-075) — layout.json leadRoaming → BossTourDef (T-145, 스키마 §4 '변환하는 법'). 순수 TS. devTour.ts(임시 상수)를 대체.
 * 시드 스트림 `day-{n}-tour`(같은 날 = 모든 사용자 같은 일정).
 * 확장 8개: endTell(복귀 전조) · locksMissions(회의 중 낮잠) · bubbleIcon(출발 말풍선) · 회의실 문 '사용 중' ·
 *           대표님 순시는 팀장 자리에 있을 때만 · 복귀 직후 첫 돌아보기 정상 전조 · 자리 비움 6~22초 보정 · 퇴근 4초 전 복귀
 * 충돌 규칙: 대표님 예정 시각(schedule.ceoClearance, 없으면 ±20초) · 본부장 순찰 ±10초 exec_report 제외 · 근무 INT-08 = meeting 순회 1회로 흡수(횟수 포함)
 * T-162: ① INT-08 흡수는 V09 후보 제외(tourOk)·minDay와 무관(회의는 어차피 열림 → 기존 방식으로 돌면 팀장이 하루 종일 못 나감, 14일차)
 *        ② 대표님 순시의 '근무 시계가 흐르는 구간'(퇴장 걷기 + 복귀 지연, ceoClockSec)을 밀기·fitToWindow에 반영
 *        ③ 다시 고르기는 후보가 다 빠질 때까지, 끝내 넘으면 허용 후보 중 가장 가까운 곳 + 최소 대기, 그래도 넘으면 직전 목적지 반복 허용(D-115)
 *        ④ sitSec·cornerTellShare는 leadRoaming 데이터 값(코드 기본값 없음)
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
  /** 대표님 순시가 근무 시계로 차지하는 시간(예정 시각부터: 퇴장 걷기 + 복귀 지연, T-162). 순시 중 얼음·대화 구간은 시계가 멈춰 0초 */
  readonly ceoClockSec?: number;
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
  /** 모퉁이 중 실제로 전조가 나는 비율(조건부 D-044: 새 방향 콘에 플레이어가 있을 때만). leadRoaming.cornerTellShare(T-161) */
  readonly cornerTellShare: number;
  /** 자리 도착 후 앉기(콘 없음). leadRoaming.sitSec(T-161) */
  readonly sitSec: number;
  /** D-124: 출발 예정 시각에 돌아보기·통화 중이라 기다리는 기대 시간(초). 일정 밀기·출발 마감 계산에만 씀(자리 비움 추정 awaySec에는 넣지 않음) */
  readonly departWaitSec?: number;
  /** 진짜 돌아보기 1회당 기대 추가 시간: 연속 두 번 보기(doubleLook 확률 × (간격 + 두 번째 전조 + 유지)). T-164 추정 보강 */
  readonly doubleLookExtraSec?: number;
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
  /** INT-08 흡수용 회의실(후보 제외와 무관, T-162 ①) */
  let meetingDest: Dest | undefined;
  for (const d of arr(R['destinations']).map(obj)) {
    const name = arr(d['spots']).map((s) => str(s)).find((s) => inp.spots[s]);
    const sp = name ? inp.spots[name] : undefined;
    if (!sp) continue;
    const dest: Dest = { id: str(d['id']), tile: sp.tile, ...(sp.facing ? { facing: sp.facing } : {}), d };
    if (dest.id === 'meeting') meetingDest = dest;
    if (num(d['minDay'], 0) > inp.day) continue;
    if (inp.tourOk && !inp.tourOk.includes(dest.id)) continue;
    dests.push(dest);
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
  const departWait = Math.max(0, W?.departWaitSec ?? 0);
  // BUG-018: 복귀 전조(endTell 없는 목적지 = 대기 끝 겹침, 조기 복귀 출발). leadRoaming.returnTell.sec, 없으면 standTell.sec(GDD v3 §3-1 '복귀 전조 1.0초')
  const rtRaw = obj(R['returnTell']);
  const returnTellSec = round1(Math.max(inp.tellMinSec, num(rtRaw['sec'], num(stand['sec'], 1))));
  const returnTellLineKey = typeof rtRaw['lineKey'] === 'string' ? rtRaw['lineKey'] as string : undefined;
  const minWaitOf = (d: Dest): number => round1(pair(d.d['waitSecRange'], [3, 4])[0] * waitMul);
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
      // T-171: poseByFacing[스팟 facing]이 있으면 pose보다 우선(프린터실 = 옆모습), 없는 방향은 pose
      ...((() => { const pf = d.facing ? obj(d.d['poseByFacing'])[d.facing] : undefined; const pose = typeof pf === 'string' ? pf : d.d['pose']; return typeof pose === 'string' ? { pose } : {}; })()),
      ...(typeof d.d['floorMark'] === 'string' ? { floorMark: d.d['floorMark'] as string } : {}),
      ...(d.d['endTell'] ? { endTell: { sec: Math.max(inp.tellMinSec, num(et['sec'], 1)), ...(sfx.length ? { sfx } : {}), ...(typeof et['lineKey'] === 'string' ? { lineKey: et['lineKey'] as string } : {}) } } : {}),
      ...(Array.isArray(d.d['locksMissions']) ? { locksMissions: arr(d.d['locksMissions']).map((x) => str(x)) } : {}),
      ...(d.d['meetingRoomDoor'] === 'busy_while_inside' ? { meetingDoorBusy: true } : {}),
    };
  };
  // 돌아보기 1회 기대 길이(전조 + 유지, 페이크면 유지 대신 afterFakeSec)
  const lookCost = W ? W.lookTellSec + (1 - W.fakeProb) * (W.lookSec + (W.doubleLookExtraSec ?? 0)) + W.fakeProb * W.afterFakeSec : 0;
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
    // endTell 없는 목적지는 대기 끝 returnTellSec가 복귀 전조(겹침, 대기가 더 짧으면 늘어남)
    let sec = standTellSec + tiles / speed + sitSec + route.reduce((t, s) => t + (s.endTell ? s.waitSec + s.endTell.sec : Math.max(s.waitSec, returnTellSec)), 0);
    if (W) {
      sec += route.reduce((t, s) => t + (s.waitSec > 0 ? (s.lookChance ?? 0) * lookCost : 0), 0);
      sec += mid * W.glanceBackChancePerTile * lookCost;
      sec += corners * W.turnTellSec * W.cornerTellShare;
    }
    return round1(sec);
  };
  /** 마감용 여유(BUG-017): 모퉁이 전조가 추정(cornerTellShare)보다 더 나는 경우의 상한 = 모퉁이 수 × 전조 × (1 − share). 플레이어가 자리(팀 구역)에 있으면 모퉁이마다 전조가 나는 실측(T-141 §4) */
  const slackOf = (route: readonly BossTourStop[]): number => {
    if (!W) return 0;
    let corners = 0, cur = seat;
    for (const nx of [...route.map((s) => s.tile), seat]) { corners += cornersOf(pathOf(cur, nx)); cur = nx; }
    return corners * W.turnTellSec * Math.max(0, 1 - W.cornerTellShare);
  };
  const rng = createRng(`day-${inp.day}-tour`);
  const [c0, c1] = pair(B['countRange'], [2, 2]);
  let n = rng.int(c0, c1);
  // T-156 규칙 3: 대표님 날 n = min(평소 추첨, ceoDayCountRange 추첨). 시드 소비는 대표님 날에만 1회 추가
  const cdr = arr(B['ceoDayCountRange']);
  if (inp.ceoAtSec !== undefined && cdr.length === 2) n = Math.min(n, rng.int(num(cdr[0], n), num(cdr[1], n)));
  /** 그날 최소 회차(BUG-025 비교용): countRange[0], 대표님 날은 ceoDayCountRange[0]과 작은 쪽 */
  const minCount = Math.min(c0, inp.ceoAtSec !== undefined && cdr.length === 2 ? num(cdr[0], c0) : c0);
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
    const allowed = dests.filter((d) => d.id !== prevFirst && !(d.id === 'exec_report' && nearDirector));
    let pool = allowed.slice();
    let route: BossTourStop[] = [];
    let fits = false;
    // T-162 ③: 상한(awayMax) 초과면 가장 먼 목적지를 빼고 다시 고름 — 후보가 다 빠질 때까지
    while (pool.length > 0) {
      const left = pool.slice();
      const picks: Dest[] = [];
      for (let j = 0; j < k && left.length > 0; j++) {
        const d = rng.weighted(left, (x) => num(x.d['weight'], 1));
        if (!d) break;
        left.splice(left.indexOf(d), 1);
        picks.push(d);
      }
      if (picks.length === 0) break;
      route = picks.map((d) => stopOf(d, rng));
      if (awayOf(route) <= awayMax) { fits = true; break; }
      const far = picks.slice().sort((x, y) => pathLen(seat, y.tile) - pathLen(seat, x.tile))[0]!;
      pool = pool.filter((d) => d !== far);
    }
    if (!fits) {
      // 끝내 넘음: 허용 후보 중 가장 가까운 곳(최소 대기 기준 자리 비움 추정이 가장 짧은 곳) + 최소 대기(waitSecRange[0] × waitMul)
      let nearRoute: BossTourStop[] = [];
      for (const d of allowed) {
        const r = [stopOf(d, rng, minWaitOf(d))];
        if (nearRoute.length === 0 || awayOf(r) < awayOf(nearRoute)) nearRoute = r;
      }
      route = nearRoute;
      // D-115: 그래도 넘으면 직전 회차와 같은 목적지 반복 허용(상한 우선). 반복도 넘으면 둘 중 짧은 쪽
      if (nearRoute.length === 0 || awayOf(nearRoute) > awayMax) {
        const prev = dests.find((d) => d.id === prevFirst && !(d.id === 'exec_report' && nearDirector));
        if (prev) {
          let rep = [stopOf(prev, rng)];
          if (awayOf(rep) > awayMax) rep = [{ ...rep[0]!, waitSec: minWaitOf(prev) }];
          if (nearRoute.length === 0 || awayOf(rep) < awayOf(nearRoute)) route = rep;
        }
      }
    }
    if (route.length === 0) continue;
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
  const seatedBefore = num(sched['mustBeSeatedBeforeLeaveSec'], 4);
  const latestFrac = dp * num(sched['latestStartFrac'], 0.85);
  /**
   * BUG-017(D-123): 회차별 출발 마감 = min(latestStartFrac, 근무 − mustBeSeatedBeforeLeaveSec − 그 회차 자리 비움 추정).
   * 이 시각까지 출발하면 목적지 도착·대기·복귀 전조·복귀·앉기가 퇴근 4초 전에 끝난다(추정 기준). 런타임은 실제 출발 시각에 이 값을 비교
   */
  const deadlineOf = (away: number, route: readonly BossTourStop[]): number => round1(Math.min(latestFrac, dp - seatedBefore - away - slackOf(route)));
  // 근무 INT-08 = meeting 순회(가장 가까운 회차를 대체). 회의실이 그날 후보(V09)에서 빠졌어도 흡수(T-162 ①)
  const meetingStops: { atSec: number; stop: BossTourStop; minWait: number }[] = [];
  for (const m of inp.meetings) {
    if (!meetingDest) break;
    // 대기 = leadRoaming meeting.waitSecRange(INT-08 근무판 흡수). m.waitSec(INT-08 meetingSec)는 범위 밖일 때만 상한으로
    const wr = pair(meetingDest.d['waitSecRange'], [m.waitSec, m.waitSec]);
    const stop = stopOf(meetingDest, rng, round1(Math.min(m.waitSec, rng.range(wr[0], wr[1])) * waitMul));
    meetingStops.push({ atSec: round1(m.atSec), stop, minWait: round1(Math.min(m.waitSec, wr[0]) * waitMul) });
  }
  const cc = sched['ceoClearance'] !== undefined ? obj(sched['ceoClearance']) : null;
  const ceoBefore = num(cc?.['returnBeforeSec'], 20), ceoAfter = num(cc?.['departAfterSec'], 20);
  // T-162 ②: 순시 뒤 근무 시계는 예정 시각 + ceoClockSec(퇴장 걷기 + 복귀 지연)에야 다시 순회를 허용 → 'departAfterSec'는 그 뒤부터 잰다
  const ceoClock = Math.max(0, inp.ceoClockSec ?? 0);
  type PlanEntry = Entry & { moved?: boolean; pulled?: number };
  type Resolved = { e: PlanEntry; at: number; away: number };
  /**
   * 실제 밀기 규칙으로 출발 시각 계산: 정렬 → 앞 회차 복귀 + minGap → (T-156 규칙 4) 대표님 충돌. ceoClearance가 없으면 기존 ±20초(밀기 전).
   * D-124: 각 회차는 '출발 대기(돌아보기·통화 중 기다림) 기대값'만큼 늦게 출발한다고 보고 민다
   */
  const resolve = (plan: readonly PlanEntry[]): Resolved[] => {
    const sorted = plan.slice().sort((x, y) => x.at - y.at);
    const out: Resolved[] = [];
    for (const e of sorted) {
      let at = e.at;
      const away = awayOf(e.route);
      const ceo = inp.ceoAtSec;
      if (ceo !== undefined && !cc && Math.abs(at - ceo) < 20) at = round1(ceo + 20);
      const prev = out[out.length - 1];
      if (prev && at < prev.at + departWait + prev.away + minGap) at = round1(prev.at + departWait + prev.away + minGap);
      if (ceo !== undefined && cc && at + departWait + away > ceo - ceoBefore && at < ceo + ceoClock + ceoAfter) at = round1(ceo + ceoClock + ceoAfter);
      out.push({ e, at, away });
    }
    return out;
  };
  const overOf = (r: Resolved): boolean => r.at + departWait > deadlineOf(r.away, r.e.route) + 1e-9;
  const nearest = dests.filter((d) => d.id !== 'meeting' && d.id !== 'exec_report').sort((x, y) => pathLen(seat, x.tile) - pathLen(seat, y.tile));
  /**
   * T-156 규칙 5 fitToWindow(T-164 개정): 회차별 마감(deadlineOf)을 넘는 회차가 있으면
   *  · 넘는 회차가 INT-08 회의: ① 회의 대기를 최소로 ② 마감 안으로 앞당김(첫 칸 시작 이후) ③ 아래 일반 회차 규칙 ④ 그래도 넘으면 회의 제외
   *  · 일반: 가장 긴 회차를 가까운 1곳 + 최소 대기로 줄이고, 줄일 게 없으면 마지막 비INT-08 회차 삭제
   */
  const fit = (plan: PlanEntry[], dropped: string[]): void => {
    if (obj(sched['fitToWindow'])['enabled'] !== true) return;
    for (let guard = 0; guard < 60; guard++) {
      const res = resolve(plan);
      const over = res.find(overOf);
      if (!over) break;
      if (over.e.from !== null) {
        const ms = meetingStops.find((m) => m.stop.id === over.e.route[0]?.id);
        if (!over.e.shrunk && ms && over.e.route[0]!.waitSec > ms.minWait) {
          over.e.route = [{ ...over.e.route[0]!, waitSec: ms.minWait }];
          over.e.shrunk = true;
          continue;
        }
        over.e.shrunk = true;
        if (!over.e.moved) {
          over.e.moved = true;
          const target = round1(Math.max(a, deadlineOf(awayOf(over.e.route), over.e.route) - departWait));
          if (target < over.e.at) { over.e.at = target; continue; }
        }
      }
      // BUG-017·025: 앞 회차를 먼저 당겨(첫 칸 시작·그 앞 회차 복귀 직후까지) 뒤 회차 여유를 만든다. 앞 회차가 1초 넘게 늦어지면 뒤 회차는 마감을 놓치기 쉬움
      {
        const oi = res.indexOf(over);
        let moved = false;
        for (let j = 0; j < oi && !moved; j++) {
          const r = res[j]!;
          if (r.e.fixed) continue;
          const p = j > 0 ? res[j - 1]! : null;
          const earliest = round1(Math.max(a, p ? p.at + departWait + p.away + minGap : a));
          if (earliest < r.at - 1e-9 && r.e.at > earliest + 1e-9) { r.e.at = earliest; moved = true; }
        }
        if (moved) continue;
      }
      // 대표님 날(BUG-025): 앞 회차 복귀 직후로 당기면 순시 전에 끝나는 회차는 당김(밀기 규칙상 순시 뒤로 밀려 마감을 넘던 경우). 길이가 바뀌면 다시 시도
      {
        const oi = res.indexOf(over);
        const prev = oi > 0 ? res[oi - 1]! : null;
        const earliest = round1(Math.max(a, prev ? prev.at + departWait + prev.away + minGap : a));
        if (over.e.pulled !== over.away && earliest < over.e.at - 1e-9) { over.e.pulled = over.away; over.e.at = earliest; continue; }
        over.e.pulled = over.away;
      }
      let li = -1;
      for (let i = 0; i < res.length; i++) {
        const r = res[i]!;
        if (r.e.shrunk || r.e.fixed || r.e.from !== null) continue;
        if (li < 0 || r.away > res[li]!.away) li = i;
      }
      if (li >= 0 && nearest.length > 0) {
        const r = res[li]!;
        const prevId = li > 0 ? res[li - 1]!.e.route[0]?.id : undefined;
        // 가까운 1곳 + 최소 대기. 직전과 다른 곳이 상한을 넘으면 같은 곳 반복 허용(D-115, 상한 우선)
        const opts = nearest.map((d) => stopOf(d, rng, minWaitOf(d))).sort((x, y) => awayOf([x]) - awayOf([y]));
        const st = opts.find((o) => o.id !== prevId && awayOf([o]) <= awayMax) ?? opts.find((o) => awayOf([o]) <= awayMax)
          ?? opts.find((o) => o.id !== prevId) ?? opts[0]!;
        if (awayOf([st]) < r.away) r.e.route = [st];
        r.e.shrunk = true;
        continue;
      }
      let di = -1;
      for (let i = res.length - 1; i >= 0; i--) if (res[i]!.e.from === null) { di = i; break; }
      // 일반 회차를 다 빼도 넘는 INT-08 회의 회차는 계획에서 빼고 '흡수됨'으로 기록(D-117 ②: 그날 회의 자체를 제외)
      if (di < 0) {
        const o = res.filter((r) => overOf(r) && r.e.from !== null).pop();
        if (!o) break;
        dropped.push(o.e.from!);
        plan.splice(plan.indexOf(o.e), 1);
        continue;
      }
      plan.splice(plan.indexOf(res[di]!.e), 1);
    }
  };
  const clonePlan = (p: readonly Entry[]): PlanEntry[] => p.map((e) => ({ ...e, route: e.route.slice() }));
  // 안 A: INT-08 흡수(회의 회차 포함). 안 B: 회의 제외(BUG-025: 긴 회의가 일반 회차를 밀어내 하루 0~1회가 되는 날)
  const planA = clonePlan(entries);
  for (const m of meetingStops) {
    let best: PlanEntry | null = null;
    for (const e of planA) if (e.from === null && (!best || Math.abs(e.at - m.atSec) < Math.abs(best.at - m.atSec))) best = e;
    if (best) { best.at = m.atSec; best.route = [m.stop]; best.from = 'INT-08'; best.fixed = false; }
    else planA.push({ at: m.atSec, route: [m.stop], from: 'INT-08', fixed: false, shrunk: false });
  }
  const droppedA: string[] = [];
  fit(planA, droppedA);
  let chosen = planA, dropped = droppedA;
  if (meetingStops.length > 0 && (droppedA.length > 0 || planA.length < minCount)) {
    // 회의를 지킨 안이 그날 최소 회차에 못 미치거나 회의를 뺐는데, 회의 없이 짠 안이 회차가 더 많으면 그 안(회의 제외, D-117 ②)
    const planB = clonePlan(entries);
    const droppedB: string[] = meetingStops.map(() => 'INT-08');
    fit(planB, droppedB);
    if (planB.length > planA.length) { chosen = planB; dropped = droppedB; }
  }
  const final = resolve(chosen);
  return {
    actorId: str(R['actorId'], 'team_lead'), seatPatrolId: str(R['seatPatrolId'], 'p_tl_seat'),
    atSec: final.map((t) => t.at), routes: final.map((t) => t.e.route), standTellSec,
    latestStartSec: round1(latestFrac),
    // BUG-017: 회차별 마감(자리 비움 추정 반영). 추정보다 늦어지면 런타임이 체류를 줄여 퇴근 4초 전 복귀(schedule.rule, tourReturnEarly)
    latestStartByTour: final.map((t) => deadlineOf(t.away, t.e.route)), mustBeSeatedBeforeLeaveSec: seatedBefore,
    ...(returnTellSec > 0 ? { returnTellSec } : {}), ...(returnTellLineKey ? { returnTellLineKey } : {}),
    awaySec: final.map((t) => t.away), fromInterrupt: final.map((t) => t.e.from),
    ...(dropped.length ? { droppedInterrupts: dropped } : {}),
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
