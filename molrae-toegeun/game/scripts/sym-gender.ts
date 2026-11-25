/// <reference types="node" />
/**
 * T-151 성별 대칭 검사(개발자용 자동 검사, QA 정식 테스트는 tests/). `npm run sym-gender [시작일] [끝일]`
 * genderFacilities·생성 층·missions v3를 켜고, 같은 일차·같은 시드를 남/여 플레이어로 각각 조립·플레이해
 *  ① DayContent가 그림(skins)을 빼면 완전히 같음  ② 판정 이벤트 로그(DayEvent + FloorEvent)가 완전히 같음
 *  ③ 그림은 실제로 다름(변형이 렌더 쪽에만 들어감)  ④ 로그·판정 재료에 절대 성별 값이 없음
 *  ⑤ 공유 카드 가드(restroom 트리거 제외, 성별 변수·라벨 거부)
 * 를 확인한다. 하나라도 어긋나면 종료 코드 1.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DaySim } from '../src/core';
import { buildGridMap } from '../src/core/grid';
import { PatrolNpc } from '../src/core/patrol';
import { createRng } from '../src/core/rng';
import { buildDayContent, type Tables } from '../src/content/buildDay';
import { createLevelProvider } from '../src/content/levelProvider';
import { fnv1a32, sanitizeShareText, shareExcludedEventIds, type PlayerVariant } from '../src/content/gender';
import type { DayContent } from '../src/core/day/types';

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

const VIEW = { viewHeightTiles: 20, insetTopTiles: 1.25, insetBottomTiles: 1.75 };
const from = Number(process.argv[2] ?? 1), to = Number(process.argv[3] ?? 60);
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) { failures++; console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`); } };

const provider = createLevelProvider({ generate: true });
const build = (day: number, pv: PlayerVariant): DayContent => buildDayContent(tables as Tables, day, [], { levelProvider: provider, missionsV3: true, genderFacilities: true, playerVariant: pv });
const noSkins = (c: DayContent): string => JSON.stringify(c, (k, v) => (k === 'skins' ? undefined : v));

/** 결정적 봇(smoke-day와 같은 규칙 + 화장실 피신을 먼저 고름) */
function play(c: DayContent): string[] {
  const sim = new DaySim(c, { view: VIEW });
  const f = sim.floor;
  const log: string[] = [];
  let stoppedAt = -1;
  for (let i = 0; i < 60 * 260 && sim.phase !== 'ended'; i++) {
    sim.step();
    for (const e of sim.drainEvents()) log.push(JSON.stringify(e));
    for (const e of sim.drainFloorEvents()) log.push(JSON.stringify(e));
    if (i % 30 === 0) log.push(`fp ${f.fingerprint()}`);
    const p = f.player;
    if (sim.qteActive) { if (sim.qte!.phase === 'window') sim.tapQte(0.1); continue; }
    if (sim.frozen) continue;
    if (sim.offer) sim.acceptOffer();
    if (sim.leaveStage === 'gate' && Math.abs(sim.gateMarker - 0.5) < sim.gateWindow / 4) { sim.tapWorld(p.tile.x, p.tile.y); continue; }
    if (sim.phase === 'intro' || i % 6 !== 0) continue;
    const threatened = f.npcs.some((n) => { const th = f.threatOfNpc(n); return (th === 'seeing' || th === 'turning') && n.gazeMultiplier > 0; });
    if (p.mode === 'moving' && threatened && !sim.gateOpen) { sim.tapWorld(p.tile.x, p.tile.y); stoppedAt = sim.time; continue; }
    if (p.mode === 'disguised' && !threatened && sim.time - stoppedAt > 0.3 && f.resumeDestination) { sim.tapWorld(p.tile.x, p.tile.y); continue; }
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
      const open = sim.missions.filter((m) => m.state === 'open' && !m.blocked).sort((a, b) => Number(!!b.def.facilityMission) - Number(!!a.def.facilityMission))[0];
      if (carry && !sim.playerAtSeat) sim.tapMission(carry.def.id);
      else if (!carry && open && sim.work >= c.work.quota * 0.3) sim.tapMission(open.def.id);
      else if (!sim.playerAtSeat && !carry && !sim.pendingMission) f.moveTo(c.playerSeat);
    }
    if (sim.phase === 'leave' && p.mode !== 'moving' && p.mode !== 'talked' && !threatened) {
      if (sim.leaveStage === 'walk') f.moveTo(c.leave.gate.spot);
      else if (sim.leaveStage === 'pack' && !sim.playerAtSeat) f.moveTo(c.playerSeat);
      else if (sim.leaveStage === 'lobby') f.moveTo(c.leave.exitSpot);
    }
  }
  log.push(`result ${JSON.stringify(sim.result)}`);
  return log;
}

const ABS = /"(male|female)"|player_[mf]\b|_m\/|_f\//;
const stat = { days: 0, pair: 0, same: 0, other: 0, enter: 0, seen: 0, cleaning: 0, doorCancel: 0, locker: 0, events: 0, hashVectors: 0 };
for (let day = from; day <= to; day++) {
  const cm = build(day, 'm'), cf = build(day, 'f');
  stat.days++;
  check(`${day}일차 판정 재료 동일(그림 제외)`, noSkins(cm) === noSkins(cf));
  check(`${day}일차 그림은 다름(플레이어 스킨)`, cm.skins?.player !== cf.skins?.player, `${cm.skins?.player} / ${cf.skins?.player}`);
  check(`${day}일차 판정 재료에 절대 성별 값 없음`, !ABS.test(noSkins(cm)));
  const lm = play(cm), lf = play(cf);
  const diff = lm.findIndex((x, i) => x !== lf[i]);
  check(`${day}일차 이벤트 로그 동일`, diff < 0 && lm.length === lf.length, diff >= 0 ? `#${diff}: ${lm[diff]} ≠ ${lf[diff]}` : '');
  check(`${day}일차 로그에 절대 성별 값 없음`, !lm.some((x) => ABS.test(x)));
  stat.events += lm.length;
  if (cm.facility?.kind === 'pair') stat.pair++;
  if (cm.facility?.locker) stat.locker++;
  if (cm.facility?.stop) stat[cm.facility.stop.relation]++;
  for (const x of lm) {
    if (x.includes('"type":"facility"') && x.includes('"stage":"enter"')) stat.enter++;
    if (x.includes('"stage":"seen"')) stat.seen++;
    if (x.includes('"stage":"cleaning"')) stat.cleaning++;
    if (x.includes('"reason":"door"')) stat.doorCancel++;
  }
}
// 접근 규칙(봇이 거치지 않는 경우를 직접 확인)
{
  const day = [...Array(to - from + 1).keys()].map((k) => k + from).find((d) => build(d, 'm').facility?.kind === 'pair');
  if (day !== undefined) {
    for (const pv of ['m', 'f'] as const) {
      const c = build(day, pv), fac = c.facility!;
      const sim = new DaySim(c, { view: VIEW });
      const od = fac.restroom.other!.door, md = fac.restroom.mine.door;
      check(`${day}일차(${pv}) 다른 쪽 문은 플레이어 경로에서 벽`, sim.floor.pathTo(od) === null && sim.floor.pathTo(fac.restroom.other!.stall) === null);
      check(`${day}일차(${pv}) 내 쪽 문·칸은 갈 수 있음`, sim.floor.pathTo(md) !== null && sim.floor.pathTo(fac.restroom.mine.stall) !== null);
      for (let i = 0; i < 200; i++) sim.step();
      const r = sim.tapWorld(od.x, od.y);
      const ev = sim.drainEvents();
      check(`${day}일차(${pv}) 다른 쪽 문 탭 = 안내만`, r === 'facility' && ev.some((e) => e.type === 'toast' && e.key === fac.otherDoorHintKey), r);
    }
  }
  const cday = [...Array(to - from + 1).keys()].map((k) => k + from).find((d) => !!build(d, 'm').facility?.cleaning);
  if (cday !== undefined) {
    const c = build(cday, 'f'), cl = c.facility!.cleaning!;
    const sim = new DaySim(c, { view: VIEW });
    const unlock = c.missions.find((m) => m.id === cl.missionId)!.unlockAtSec;
    while (sim.phase !== 'ended' && (sim.phase !== 'day' || sim.dayTime < unlock + 0.1)) sim.step();
    check(`${cday}일차 청소 중 내 화장실 문 막힘(C4)`, sim.cleaningActive && sim.floor.pathTo(c.facility!.restroom.mine.stall) === null);
    while (sim.phase === 'day' && sim.cleaningActive) sim.step();
    check(`${cday}일차 청소 끝나면 다시 열림`, sim.phase !== 'day' || sim.floor.pathTo(c.facility!.restroom.mine.stall) !== null);
  }
}
// 말걸기 문 취소(S-05): 제자리 정지 → 원래 경로, 플레이어(문) 쪽으로 돌아보거나 다가가지 않음
{
  const rows = ['#########', '#.......#', '#########'];
  const legend = { '#': { kind: 'wall', walkable: false, blocksSight: true }, '.': { kind: 'floor', walkable: true, blocksSight: false } } as never;
  const map = buildGridMap(rows, legend);
  const rng = createRng('door-cancel');
  const npc = new PatrolNpc({
    id: 'n', name: '', role: 'npc', cone: { range: 3, halfAngleDeg: 30 }, speedTilesPerSec: 1.5, gazeMultiplier: 1, tellSec: 0.5, lookSec: 1, lookChance: 0,
    glanceBackChancePerTile: 0, waypoints: [{ x: 1, y: 1, waitSec: 0 }, { x: 7, y: 1, waitSec: 0 }], loop: false,
    talk: { radius: 1.5, durationSec: 1.5, cooldownSec: 10, tellSec: 0.8 },
  }, map, rng);
  for (let i = 0; i < 30; i++) npc.step(1 / 60, rng);
  const x0 = npc.x, f0 = npc.facing;
  npc.startTalk(Math.PI); // 플레이어(문)가 뒤쪽
  npc.step(1 / 60, rng);
  const ok = npc.cancelTalkInPlace();
  check('문 취소: 취소됨·사유 door', ok && npc.lastTalkCancel === 'door' && npc.pendingFacing === null);
  check('문 취소: 플레이어 쪽으로 돌아보지 않음', Math.abs(npc.facing - f0) < 1e-9);
  let minX = npc.x, holdSteps = 0;
  for (let i = 0; i < 200; i++) { npc.step(1 / 60, rng); minX = Math.min(minX, npc.x); if (npc.mode === 'wait') holdSteps++; }
  check('문 취소: 제자리 정지 후 원래 방향으로 계속(문 쪽 이동 0)', holdSteps > 0 && minX >= x0 - 1e-6 && npc.x > x0 + 0.5, `x ${x0.toFixed(2)} → ${npc.x.toFixed(2)}, 정지 ${holdSteps}스텝`);
}
// T-157 access.talkCancelNpcHold: 남은 전조가 거의 0이어도 최소 0.6초 제자리 정지
{
  const rows = ['#########', '#.......#', '#########'];
  const legend = { '#': { kind: 'wall', walkable: false, blocksSight: true }, '.': { kind: 'floor', walkable: true, blocksSight: false } } as never;
  const map = buildGridMap(rows, legend);
  const rng = createRng('door-cancel-min');
  const npc = new PatrolNpc({
    id: 'n', name: '', role: 'npc', cone: { range: 3, halfAngleDeg: 30 }, speedTilesPerSec: 1.5, gazeMultiplier: 1, tellSec: 0.5, lookSec: 1, lookChance: 0,
    glanceBackChancePerTile: 0, waypoints: [{ x: 1, y: 1, waitSec: 0 }, { x: 7, y: 1, waitSec: 0 }], loop: false,
    talk: { radius: 1.5, durationSec: 1.5, cooldownSec: 10, tellSec: 0.8 },
  }, map, rng);
  for (let i = 0; i < 30; i++) npc.step(1 / 60, rng);
  npc.startTalk(Math.PI);
  for (let i = 0; i < 46; i++) npc.step(1 / 60, rng); // 전조 0.8초 중 약 0.77초 경과
  const minHold = num0(((((tables['layout'] as Record<string, any>)['genderFacilities'] ?? {})['access'] ?? {})['talkCancelNpcHold'] ?? {})['minSec']);
  const ok = npc.cancelTalkInPlace(minHold);
  let hold = 0;
  for (let i = 0; i < 200 && npc.mode === 'wait'; i++) { npc.step(1 / 60, rng); hold += 1 / 60; }
  check('문 취소 최소 정지(talkCancelNpcHold.minSec)', ok && minHold > 0 && hold >= minHold - 1 / 60 - 1e-9 && hold <= minHold + 2 / 60, `minSec ${minHold}, 정지 ${hold.toFixed(2)}초`);
}
function num0(v: unknown): number { return typeof v === 'number' ? v : 0; }
// 회전 해시 기준값(rules.characters.casting.rotation.hash.testVectors, T-157)
{
  const hv = (((((tables['rules'] as Record<string, any>)['characters'] ?? {})['casting'] ?? {})['rotation'] ?? {})['hash'] ?? {}) as { testVectors?: { seed: string; hash: number; firstSame: boolean }[] };
  const tv = hv.testVectors ?? [];
  check('회전 해시 testVectors 있음', tv.length > 0);
  for (const v of tv) check(`회전 해시 ${v.seed}`, fnv1a32(v.seed) === v.hash && (fnv1a32(v.seed) % 2 === 0) === v.firstSame, `${fnv1a32(v.seed)} vs ${v.hash}`);
  stat['hashVectors'] = tv.length;
}
// 공유 카드 가드
const ex = shareExcludedEventIds(tables as Tables);
check('공유 카드: 화장실 피신 트리거 제외', ex.has('restroom'));
check('공유 카드: 성별 변수 거부', sanitizeShareText(tables as Tables, '오늘의 {gender} 칼퇴') === null);
check('공유 카드: 성별 라벨 거부', sanitizeShareText(tables as Tables, '남자 사원의 칼퇴') === null);
check('공유 카드: 시설 대사 인용 거부', sanitizeShareText(tables as Tables, '칼퇴 성공', ['react.restroom.exposed']) === null);
check('공유 카드: 일반 문구 통과', sanitizeShareText(tables as Tables, '오늘도 칼퇴 성공!') !== null);
console.log(`성별 대칭 ${from}~${to}일차: ${JSON.stringify(stat)}`);
console.log(failures === 0 ? 'sym-gender OK' : `sym-gender FAIL ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
