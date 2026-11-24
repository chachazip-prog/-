/**
 * 팀장 순회(D-075) — layout.json leadRoaming → BossTourDef (T-145, 스키마 §4 '변환하는 법'). 순수 TS. devTour.ts(임시 상수)를 대체.
 * 시드 스트림 `day-{n}-tour`(같은 날 = 모든 사용자 같은 일정).
 * 확장 8개: endTell(복귀 전조) · locksMissions(회의 중 낮잠) · bubbleIcon(출발 말풍선) · 회의실 문 '사용 중' ·
 *           대표님 순시는 팀장 자리에 있을 때만 · 복귀 직후 첫 돌아보기 정상 전조 · 자리 비움 6~22초 보정 · 퇴근 4초 전 복귀
 * 충돌 규칙: 대표님 예정 ±20초 출발 금지 · 본부장 순찰 ±10초 exec_report 제외 · 근무 INT-08 = meeting 순회 1회로 흡수(횟수 포함)
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
  const [awayMin, awayMax] = pair(R['awaySecRange'], [6, 22]);
  const dp = inp.dayPhaseSec;
  // 경로 길이(팀장은 내 자리 칸을 피함, walk.avoidTiles)
  const blocked = pseat ? (x: number, y: number) => x === pseat.x && y === pseat.y : undefined;
  const plen = new Map<string, number>();
  const pathLen = (a: Tile, b: Tile): number => {
    const k = `${a.x},${a.y}>${b.x},${b.y}`;
    let v = plen.get(k);
    if (v === undefined) { v = Math.max(0, (findPath(inp.grid, a, b, blocked)?.length ?? 99) - 1); plen.set(k, v); }
    return v;
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
  const awayOf = (route: readonly BossTourStop[]): number => {
    let tiles = 0, cur = seat;
    for (const s of route) { tiles += pathLen(cur, s.tile); cur = s.tile; }
    tiles += pathLen(cur, seat);
    return round1(standTellSec + tiles / speed + route.reduce((t, s) => t + s.waitSec + (s.endTell?.sec ?? 0), 0));
  };
  const rng = createRng(`day-${inp.day}-tour`);
  const [c0, c1] = pair(B['countRange'], [2, 2]);
  const n = rng.int(c0, c1);
  const a = dp * num(sched['firstAtFrac'], 0.15), b = dp * num(sched['lastAtFrac'], 0.8);
  const seg = (b - a) / Math.max(1, n);
  const atSec: number[] = [];
  const routes: BossTourStop[][] = [];
  const fromInt: (string | null)[] = [];
  let prevFirst: string | null = null;
  for (let i = 0; i < n; i++) {
    const at = round1(a + seg * i + rng.range(0.1, 0.6) * seg);
    const [s0, s1] = pair(B['stopsPerTour'], [1, 1]);
    const k = rng.int(s0, s1);
    const nearDirector = inp.directorAtSec.some((t) => Math.abs(t - at) <= 10);
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
      // 22초 초과: 가장 먼 목적지를 빼고 다시 고름
      const far = picks.slice().sort((x, y) => pathLen(seat, y.tile) - pathLen(seat, x.tile))[0]!;
      pool = pool.filter((d) => d !== far);
    }
    if (route.length === 0) continue;
    // 6초 미만: 마지막 목적지 대기를 늘림
    const aw = awayOf(route);
    if (aw < awayMin) { const last = route[route.length - 1]!; route[route.length - 1] = { ...last, waitSec: round1(last.waitSec + (awayMin - aw)) }; }
    // 6일차 첫 순회 = printer 고정(튜토리얼)
    if (inp.day === num(R['appliesFromDay'], 6) && atSec.length === 0) {
      const pr = dests.find((d) => d.id === 'printer');
      if (pr) route = [stopOf(pr, rng)];
    }
    prevFirst = route[0]!.id;
    atSec.push(at); routes.push(route); fromInt.push(null);
  }
  // 근무 INT-08 = meeting 순회(가장 가까운 회차를 대체)
  const meetingDest = dests.find((d) => d.id === 'meeting');
  for (const m of inp.meetings) {
    if (!meetingDest) break;
    const stop = stopOf(meetingDest, rng, m.waitSec);
    let best = -1;
    for (let i = 0; i < atSec.length; i++) if (fromInt[i] === null && (best < 0 || Math.abs(atSec[i]! - m.atSec) < Math.abs(atSec[best]! - m.atSec))) best = i;
    if (best >= 0) { atSec[best] = round1(m.atSec); routes[best] = [stop]; fromInt[best] = 'INT-08'; }
    else { atSec.push(round1(m.atSec)); routes.push([stop]); fromInt.push('INT-08'); }
  }
  // 정렬 → 대표님 ±20초 회피 → 최소 간격
  const order = atSec.map((_, i) => i).sort((x, y) => atSec[x]! - atSec[y]!);
  const out: { at: number; route: BossTourStop[]; from: string | null; away: number }[] = order.map((i) => ({ at: atSec[i]!, route: routes[i]!, from: fromInt[i]!, away: awayOf(routes[i]!) }));
  const latestFrac = dp * num(sched['latestStartFrac'], 0.85);
  const minGap = num(sched['minGapSec'], 8);
  const seatedBefore = num(sched['mustBeSeatedBeforeLeaveSec'], 4);
  const final: typeof out = [];
  for (const t of out) {
    let at = t.at;
    if (inp.ceoAtSec !== undefined && Math.abs(at - inp.ceoAtSec) < 20) at = round1(inp.ceoAtSec + 20);
    const prev = final[final.length - 1];
    if (prev && at < prev.at + prev.away + minGap) at = round1(prev.at + prev.away + minGap);
    final.push({ ...t, at });
  }
  return {
    actorId: str(R['actorId'], 'team_lead'), seatPatrolId: str(R['seatPatrolId'], 'p_tl_seat'),
    atSec: final.map((t) => t.at), routes: final.map((t) => t.route), standTellSec,
    latestStartSec: latestFrac,
    latestStartByTour: final.map((t) => round1(Math.min(latestFrac, dp - seatedBefore - t.away))),
    awaySec: final.map((t) => t.away), fromInterrupt: final.map((t) => t.from),
    speedTilesPerSec: speed,
    coneActiveIn: arr(R['coneActiveIn']).map((x) => str(x)) as BossTourDef['coneActiveIn'] & string[],
    standSfx: [str(stand['sfxNew']), str(stand['sfxFallback'])].filter((s) => s),
    firstLookPlain: true, ceoWaitsForSeat: true,
    awayBadgeKey: str(obj(R['seatEmptyCue'])['hudBadgeKey'], 'hud.tl_away'),
    ...(inp.day === num(R['appliesFromDay'], 6) ? { firstTutorialId: 'tut_tour' } : {}),
  };
}

/** during_tour 조건용: 근무 구간 안에서 '충분히 긴'(≥ minSec) 순회 수 */
export function longTourCount(t: BossTourDef | null, minSec = 8): number {
  if (!t) return 0;
  return (t.awaySec ?? []).filter((a) => a >= minSec).length;
}
