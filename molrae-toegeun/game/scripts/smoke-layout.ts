/// <reference types="node" />
/**
 * 층 생성기·검증기·팀장 순회·미션 변형 스모크 (개발자용, QA 정식 테스트 아님, T-144). `npm run smoke`의 세 번째 단계.
 *  1) 생성기 결정성: 같은 시드 = 같은 층, 다른 시드 = 다른 층(대체로)
 *  2) 검증기 단위: 손으로 만든 작은 층으로 실패 사유별 판정
 *  3) 폴백: 통과 불가능한 규칙이면 수작업 맵으로
 *  4) 생성 층 하루 시뮬레이션(봇): 예외 없음·결과 도달·결정성, 순회 발생·복귀, 순회 중 앉은 순찰 없음, '전조 없는 시선 전환' 0회
 *  5) 미션 변형: 정적 반영·조건 판정
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DaySim, type DayEvent, applyMissionModifiers, evaluateMissionConditions, type MissionDef } from '../src/core';
import type { LegendEntry } from '../src/core/grid';
import { buildDayContent, type BuildOptions, type Tables } from '../src/content/buildDay';
import { authoredMapBundle, createLevelProvider } from '../src/content/levelProvider';
import {
  DEV_LAYOUT_MODULES, DEV_LAYOUT_POLICY, DEV_LAYOUT_RULES, DEV_VALIDATE_RULES, generateLayout, generateValidated, validateLayout,
  type ValidateRules,
} from '../src/content/layoutGen';

function findRoot(start: string): string {
  let d = start;
  for (let i = 0; i < 6; i++) {
    try { readdirSync(join(d, 'data')); readFileSync(join(d, 'package.json')); return d; } catch { d = resolve(d, '..'); }
  }
  throw new Error('game 루트를 찾지 못함');
}
const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const tables: Record<string, unknown> = {};
for (const f of readdirSync(join(ROOT, 'data'))) if (f.endsWith('.json')) tables[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const T = tables as Tables;
const VIEW = { viewHeightTiles: 20, insetTopTiles: 1.25, insetBottomTiles: 1.75 };

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const legend = authoredMapBundle(T, DEV_LAYOUT_POLICY.sourceMapId).legend;

// ── 1. 결정성 ──
{
  const same: boolean[] = [];
  const distinct = new Set<string>();
  for (const c of [0, 0.5, 1]) {
    for (let i = 0; i < 20; i++) {
      const a = generateLayout({ modules: DEV_LAYOUT_MODULES, rules: DEV_LAYOUT_RULES, legend, complexity: c, seed: `det-${i}` });
      const b = generateLayout({ modules: DEV_LAYOUT_MODULES, rules: DEV_LAYOUT_RULES, legend, complexity: c, seed: `det-${i}` });
      same.push(JSON.stringify(a) === JSON.stringify(b));
      if (a.layout) distinct.add(a.layout.rows.join('\n'));
    }
  }
  check('생성기 결정성: 같은 시드·복잡도 → 같은 층(60쌍)', same.every((x) => x), `${same.filter((x) => x).length}/60`);
  check('다른 시드 → 다양한 층', distinct.size >= 30, `서로 다른 층 ${distinct.size}/60`);
  const v1 = generateValidated({ modules: DEV_LAYOUT_MODULES, rules: DEV_LAYOUT_RULES, legend, complexity: 0.6, seed: 'det-v' }, DEV_VALIDATE_RULES, 8);
  const v2 = generateValidated({ modules: DEV_LAYOUT_MODULES, rules: DEV_LAYOUT_RULES, legend, complexity: 0.6, seed: 'det-v' }, DEV_VALIDATE_RULES, 8);
  check('검증 + 재시도 결정성', JSON.stringify(v1) === JSON.stringify(v2), `시도 ${v1.attempts}`);
  const opts: BuildOptions = { levelProvider: createLevelProvider({ generate: true }), tours: true };
  const d1 = buildDayContent(T, 20, [], opts), d2 = buildDayContent(T, 20, [], opts);
  check('20일차 생성 층·순회 일정 결정성', d1.floor.level.rows.join() === d2.floor.level.rows.join() && JSON.stringify(d1.bossTours) === JSON.stringify(d2.bossTours),
    `${d1.layout?.source} ${d1.layout?.modules?.join('→')}`);
  // 복잡도 오를수록 층이 커지는가(평균 세로)
  const avgH = (c: number) => {
    let s = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const r = generateValidated({ modules: DEV_LAYOUT_MODULES, rules: DEV_LAYOUT_RULES, legend, complexity: c, seed: `h-${i}` }, DEV_VALIDATE_RULES, 8);
      if (r.layout) { s += r.layout.height; n++; }
    }
    return n ? s / n : 0;
  };
  const h0 = avgH(0), h1 = avgH(1);
  check('복잡도 1의 평균 세로 > 복잡도 0', h1 > h0, `${h0.toFixed(1)} → ${h1.toFixed(1)}`);
  let pass = 0;
  for (let i = 0; i < 100; i++) if (generateValidated({ modules: DEV_LAYOUT_MODULES, rules: DEV_LAYOUT_RULES, legend, complexity: (i % 11) / 10, seed: `p-${i}` }, DEV_VALIDATE_RULES, 8).layout) pass++;
  check('dev 모듈 100시드 중 8회 안 통과 ≥ 95', pass >= 95, `${pass}/100`);
}

// ── 2. 검증기 단위 ──
{
  const L: Record<string, LegendEntry> = {
    '#': { kind: 'wall', walkable: false, blocksSight: true },
    '.': { kind: 'floor', walkable: true, blocksSight: false },
    T: { kind: 'plant', walkable: false, blocksSight: true, cover: true },
    e: { kind: 'floor', walkable: true, blocksSight: false, zone: 'exit' },
  };
  const VR: ValidateRules = {
    requiredSpots: ['seat', 'goal'], routeGoalSpot: 'goal', maxSharedRatio: 0.6, maxDetourRatio: 2, sharePenalty: 4,
    maxClearSightTiles: 6, maxHeight: 12, width: 7,
  };
  const mk = (rows: string[], spots: Record<string, [number, number]>) => ({
    rows, legend: L, exitZone: 'exit', playerStart: { x: spots['seat']![0], y: spots['seat']![1] },
    spots: Object.fromEntries(Object.entries(spots).map(([k, v]) => [k, { tile: { x: v[0], y: v[1] } }])),
  });
  const codes = (r: ReturnType<typeof validateLayout>) => r.failures.map((f) => f.code);
  const good = mk([
    '#######',
    '#eeeee#',
    '#.....#',
    '#.#T#.#',
    '#.#T#.#',
    '#.....#',
    '#######',
  ], { seat: [3, 5], goal: [3, 2] });
  const r0 = validateLayout(good, VR);
  check('검증기: 정상 층 통과', r0.ok, JSON.stringify(r0.metrics));
  const walled = mk([
    '#######',
    '#eeeee#',
    '#.....#',
    '#######',
    '#.....#',
    '#.....#',
    '#######',
  ], { seat: [3, 5], goal: [3, 2] });
  const r1 = validateLayout(walled, VR);
  check('검증기: 막힌 지점 → unreachable_spot·unreachable_exit', codes(r1).includes('unreachable_spot') && codes(r1).includes('unreachable_exit'), codes(r1).join(','));
  const r2 = validateLayout(mk(good.rows as string[], { seat: [3, 5], goal: [3, 2] }), { ...VR, requiredSpots: ['seat', 'goal', 'coffee'] });
  check('검증기: 없는 지점 → missing_spot', codes(r2).includes('missing_spot'), codes(r2).join(','));
  const single = mk([
    '#######',
    '#eeeee#',
    '#.....#',
    '###.###',
    '###.###',
    '#.....#',
    '#######',
  ], { seat: [1, 5], goal: [1, 2] });
  const r3 = validateLayout(single, VR);
  check('검증기: 외길 → no_alternative_route', codes(r3).includes('no_alternative_route'), codes(r3).join(',') + ' ' + JSON.stringify(r3.metrics));
  const longSight = mk([
    '#########',
    '#eeeeeee#',
    '#.......#',
    '#.#T#T#.#',
    '#.......#',
    '#########',
  ], { seat: [4, 4], goal: [4, 2] });
  const r4 = validateLayout(longSight, { ...VR, width: 9 });
  check('검증기: 긴 직선 시선 → clear_sight_too_long', codes(r4).includes('clear_sight_too_long'), r4.failures.map((f) => f.detail).join(' / '));
  const r5 = validateLayout(good, { ...VR, maxHeight: 5 });
  check('검증기: 세로 상한 → too_tall', codes(r5).includes('too_tall'), codes(r5).join(','));
  const r6 = validateLayout(mk(good.rows as string[], { seat: [3, 5], goal: [2, 3] }), VR);
  check('검증기: 지점이 통행 불가 칸 → spot_blocked', codes(r6).includes('spot_blocked'), codes(r6).join(','));
  const authored = authoredMapBundle(T, 'office_floor_1');
  const ra = validateLayout(authored, DEV_VALIDATE_RULES);
  console.log(`  · 수작업 맵 office_floor_1 지표: ${JSON.stringify(ra.metrics)} 실패: ${ra.failures.map((f) => `${f.code} ${f.detail}`).join(' / ') || '없음'}`);
  check('수작업 맵: 도달성·지름길/우회 통과(시선 길이는 참고)', ra.failures.every((f) => f.code === 'clear_sight_too_long'), `최단 ${ra.metrics.shortestRoute} / 우회 ${ra.metrics.altRoute}`);
}

// ── 3. 폴백 ──
{
  const impossible = createLevelProvider({ generate: true, validate: { ...DEV_VALIDATE_RULES, maxClearSightTiles: 1 }, maxAttempts: 3 });
  const warns: string[] = [];
  const c = buildDayContent(T, 10, warns, { levelProvider: impossible });
  check('검증 실패 3회 → 수작업 맵 폴백 + 사유 목록', c.layout?.source === 'fallback' && c.floor.level.id === 'office_floor_1' && (c.layout.failures?.length ?? 0) >= 3 && warns.some((w) => w.includes('폴백')),
    `${c.layout?.source} 시도 ${c.layout?.attempts} 사유 ${c.layout?.failures?.length}`);
  const early = buildDayContent(T, 2, [], { levelProvider: createLevelProvider({ generate: true }) });
  check('1~2일차는 생성 켜도 수작업 맵', early.layout?.source === 'authored' && early.floor.level.id === 'office_floor_1');
  const def = buildDayContent(T, 20);
  check('기본(데이터에 layout 없음) = 수작업 맵·순회 없음', def.layout?.source === 'authored' && !def.bossTours);
}

// ── 4. 생성 층 하루 시뮬레이션 ──
function play(day: number, opts: BuildOptions, seed?: string): { sim: DaySim; log: string[]; tourViolations: number; seatWhileTour: number; tourStands: number; tourSeated: number; maxAway: number } {
  const content = buildDayContent(T, day, [], opts);
  const sim = new DaySim(content, { view: VIEW }, seed);
  const log: string[] = [];
  const f = sim.floor;
  let tourViolations = 0, seatWhileTour = 0, tourStands = 0, tourSeated = 0, maxAway = 0;
  const prev = new Map<unknown, { facing: number; mode: string }>();
  let awayStart = -1;
  for (let i = 0; i < 60 * 260; i++) {
    if (sim.phase === 'ended') break;
    sim.step();
    for (const e of sim.drainEvents()) {
      log.push(fmt(e));
      if (e.type === 'tour' && e.stage === 'stand') { tourStands++; awayStart = sim.time; }
      if (e.type === 'tour' && e.stage === 'seated') { tourSeated++; maxAway = Math.max(maxAway, sim.time - awayStart); }
    }
    sim.drainFloorEvents();
    // 순회 검사: 순회 NPC가 '전조(tell) 없이' 방향을 바꾼 스텝에 플레이어를 보고 있으면 위반(D-038/D-044)
    const tours = sim.touringNpcs();
    for (const n of tours) {
      const idx = f.npcs.indexOf(n);
      const pv = prev.get(n);
      if (pv && Math.abs(Math.atan2(Math.sin(n.facing - pv.facing), Math.cos(n.facing - pv.facing))) > 1e-3 && pv.mode !== 'tell' && f.seeing[idx]) tourViolations++;
      prev.set(n, { facing: n.facing, mode: n.mode });
    }
    if (tours.length > 0 && f.npcs.some((n) => n.def.patrolId === 'p_tl_seat' && n.def.seated)) seatWhileTour++;
    const p = f.player;
    if (sim.qteActive) { if (sim.qte!.phase === 'window') sim.tapQte(0.1); continue; }
    if (sim.frozen) continue;
    if (sim.leaveStage === 'gate' && Math.abs(sim.gateMarker - 0.5) < sim.gateWindow / 4) { sim.tapWorld(p.tile.x, p.tile.y); continue; }
    if (sim.phase === 'intro' || i % 6 !== 0) continue;
    const threatened = f.npcs.some((n) => { const th = f.threatOfNpc(n); return (th === 'seeing' || th === 'turning') && n.gazeMultiplier > 0; });
    if (p.mode === 'moving' && threatened && !sim.gateOpen) { sim.tapWorld(p.tile.x, p.tile.y); continue; }
    if (p.mode === 'disguised' && !threatened && f.resumeDestination) { sim.tapWorld(p.tile.x, p.tile.y); continue; }
    const v = sim.activityView();
    if (v) {
      if (v.kind === 'pour' && !v.paused && v.level >= v.band[0] + 0.03) sim.tapWorld(0, 0);
      else if (v.kind === 'restroom' && v.restLeft <= 0 && v.bonusSec >= v.bonusMax - 0.01) sim.tapWorld(0, 0);
      else if (v.kind === 'nap' && ((!v.headUp && v.head > 0.75) || (v.headUp && v.head < 0.1))) sim.tapWorld(0, 0);
      else if (v.kind === 'snack' && v.sinceLast >= 0.7) sim.tapWorld(0, 0);
      continue;
    }
    if (sim.phase === 'day' && p.mode !== 'moving' && p.mode !== 'talked' && !threatened) {
      const carry = sim.missions.find((m) => m.state === 'carry');
      const open = sim.missions.find((m) => m.state === 'open' && !m.blocked);
      if (carry && !sim.playerAtSeat) sim.tapMission(carry.def.id);
      else if (!carry && open && sim.work >= content.work.quota * 0.5) sim.tapMission(open.def.id);
      else if (!sim.playerAtSeat && !carry && !sim.pendingMission) f.moveTo(content.playerSeat);
    }
    if (sim.phase === 'leave' && p.mode !== 'moving' && p.mode !== 'talked' && !threatened) {
      if (sim.leaveStage === 'walk') f.moveTo(content.leave.gate.spot);
      else if (sim.leaveStage === 'pack' && !sim.playerAtSeat) f.moveTo(content.playerSeat);
      else if (sim.leaveStage === 'lobby') f.moveTo(content.leave.exitSpot);
    }
  }
  return { sim, log, tourViolations, seatWhileTour, tourStands, tourSeated, maxAway };
}

function fmt(e: DayEvent): string {
  const { t, type, ...rest } = e as DayEvent & Record<string, unknown>;
  return `${t.toFixed(2)} ${type} ${JSON.stringify(rest)}`;
}

{
  const opts: BuildOptions = { levelProvider: createLevelProvider({ generate: true }), tours: true };
  let totalStands = 0, totalSeated = 0, viol = 0, seatDup = 0;
  for (const day of [6, 10, 16, 20, 28, 30, 36, 45, 60]) {
    let r: ReturnType<typeof play> | null = null;
    let err = '';
    try { r = play(day, opts); } catch (e) { err = String((e as Error).stack ?? e); }
    const c = buildDayContent(T, day, [], opts);
    check(`${day}일차 생성 층 한 판(${c.layout?.source}, ${c.layout?.modules?.length ?? 0}모듈, 순회 ${c.bossTours?.[0]?.atSec.length ?? 0}회 예정)`,
      !!r && r.sim.phase === 'ended', r ? `결과 ${r.sim.result?.outcome} · 순회 시작 ${r.tourStands}/복귀 ${r.tourSeated} · 최장 자리 비움 ${r.maxAway.toFixed(1)}초` : err.split('\n').slice(0, 3).join(' | '));
    if (r) { totalStands += r.tourStands; totalSeated += r.tourSeated; viol += r.tourViolations; seatDup += r.seatWhileTour; }
    if (r && (day === 20 || day === 36)) {
      const r2 = play(day, opts);
      check(`${day}일차 생성 층 결정성(같은 시드 같은 로그)`, r.log.join('\n') === r2.log.join('\n'), `이벤트 ${r.log.length}개`);
    }
  }
  check('순회 발생·자리 복귀', totalStands > 0 && totalSeated > 0, `시작 ${totalStands} · 복귀 ${totalSeated}`);
  check('순회 중 앉은 순찰(앉은 모드 시선) 없음', seatDup === 0, `${seatDup} 스텝`);
  check('순회 NPC: 전조 없이 방향을 바꾸며 플레이어를 본 스텝 0', viol === 0, `${viol}`);
  // 수작업 맵에서도 순회 강제 가능(?tour=1)
  const r = play(20, { tours: true });
  check('수작업 맵 + 순회 강제(20일차)', r.sim.phase === 'ended' && r.tourStands > 0, `순회 ${r.tourStands}/${r.tourSeated}`);
}

// ── 5. 미션 변형 ──
{
  const base: MissionDef = {
    id: 'm', nameKey: '', descKey: '', iconSprite: '', mechanic: 'pour_tap_stop', unlockAtSec: 0, spot: { x: 1, y: 1 },
    startsAt: 'arrive_spot', completeAt: 'return_to_seat', awayFromDesk: true, timeLimitSec: 30,
    reward: { slackPoints: 100 }, failPenalty: 0, timeoutPenalty: 0, params: { cupsRequired: 1 },
  };
  const warns: string[] = [];
  const m = applyMissionModifiers(base, [
    { id: 'rush', timeLimit: { mul: 0.5, add: 2 } },
    { id: 'move', spot: 'pantry' },
    { id: 'double', params: { cupsRequired: 2 }, rewardMul: 1.5 },
    { id: 'stealth', condition: { id: 'unseen' }, rewardMul: 2 },
    { id: 'nope', spot: 'nowhere' },
  ], { pantry: { tile: { x: 5, y: 9 } } }, { push: (w) => warns.push(w) });
  check('변형 정적 반영(제한 시간·장소·params·보상)', m.timeLimitSec === 17 && m.spot.x === 5 && m.params['cupsRequired'] === 2 && m.reward.slackPoints === 150 && warns.length === 1,
    `제한 ${m.timeLimitSec}초, 장소 (${m.spot.x},${m.spot.y}), 보상 ${m.reward.slackPoints}, 경고 ${warns.length}`);
  check('조건 변형은 def.modifiers로 남음', m.modifiers?.length === 1 && m.modifiers[0]!.id === 'stealth');
  const ok = evaluateMissionConditions(m, { elapsedSec: 5, suspicionGain: 0, seenSec: 0 });
  const ng = evaluateMissionConditions(m, { elapsedSec: 5, suspicionGain: 0.1, seenSec: 0.5 });
  check('조건 판정: 충족 ×2 / 미충족 ×1', ok.rewardMul === 2 && ng.rewardMul === 1 && !ng.fail);
}

console.log(failures === 0 ? 'smoke-layout OK' : `smoke-layout FAIL ${failures}`);
if (failures > 0) process.exit(1);
