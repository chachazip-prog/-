/// <reference types="node" />
/**
 * 하루 시뮬레이션 스모크 (개발자용, QA 정식 테스트 아님). `npm run smoke`의 두 번째 단계.
 * game/data/*.json v2 → buildDayContent → DaySim을 간단한 봇으로 1~N일차 끝까지 돌려
 * ① 예외 없음 ② 결과 도달 ③ 같은 시드 = 같은 결과(결정성)를 확인한다. 밸런스 판정은 QA 몫.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DaySim, type DayEvent } from '../src/core';
import { buildDayContent, type Tables } from '../src/content/buildDay';

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
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** 단순 봇: 미션을 순서대로 하고, 전조·시선이 보이면 멈추고, 끝나면 자리로, 퇴근은 게이트까지 */
function play(day: number, seed?: string, opts: { continueOnce?: boolean; skipCeo?: boolean } = {}): { sim: DaySim; log: string[] } {
  const warnings: string[] = [];
  const content = buildDayContent(tables as Tables, day, warnings);
  const sim = new DaySim(content, { view: VIEW, ...(opts.skipCeo ? { skipCeoVisit: true } : {}) }, seed);
  const log: string[] = [...warnings.map((w) => `warn ${w}`)];
  const f = sim.floor;
  let stoppedAt = -1;
  for (let i = 0; i < 60 * 260; i++) {
    if (sim.phase === 'ended') {
      if (opts.continueOnce && sim.canContinue) { sim.continueFromCheckpoint(); continue; }
      break;
    }
    sim.step();
    for (const e of sim.drainEvents()) log.push(fmt(e));
    sim.drainFloorEvents();
    const p = f.player;
    // T-133: 인사 QTE는 '!' 창에서 짧게 톡, 얼음 중에는 움직이지 않음, 공범 제안은 수락
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
  return { sim, log };
}

function fmt(e: DayEvent): string {
  const { t, type, ...rest } = e as DayEvent & Record<string, unknown>;
  return `${t.toFixed(2)} ${type} ${JSON.stringify(rest)}`;
}

/** T-133 기능 점검: 대표님 순시(28·31일차 등), 엘리베이터 대표님(30), 공범(7), 이어하기, CEO 패스 */
function featureChecks(): void {
  const ceoDays: number[] = [];
  for (let d = 28; d <= 60 && ceoDays.length < 4; d++) if (buildDayContent(tables as Tables, d).ceoVisit) ceoDays.push(d);
  check('대표님 순시 날 생성(28~60일차)', ceoDays.length > 0 && ceoDays[0] === 28, ceoDays.join(','));
  for (const d of ceoDays) {
    const r = play(d);
    const stages = r.log.filter((l) => l.includes(' ceo ')).map((l) => JSON.parse(l.slice(l.indexOf('{'))).stage as string);
    const qte = r.log.find((l) => l.includes(' qte ') && l.includes('result'));
    check(`${d}일차 순시 진행`, stages.includes('tell') && stages.includes('freeze') && (stages.includes('done') || r.sim.result?.outcome === 'caught'),
      `${stages.join('>')} ${qte ? qte.slice(qte.indexOf('{')) : 'QTE 없음'} 눈도장=${r.sim.eyeContact} 결과=${r.sim.result?.outcome}`);
    const again = play(d);
    check(`${d}일차 순시 결정성`, JSON.stringify(again.sim.result) === JSON.stringify(r.sim.result));
    const skip = play(d, undefined, { skipCeo: true });
    check(`${d}일차 CEO 패스`, !skip.log.some((l) => l.includes(' ceo ')) && skip.sim.result?.ceoVisit === 'skipped');
  }
  const c30 = buildDayContent(tables as Tables, 30);
  check('30일차 엘리베이터 대표님 확정(데뷔)', !!c30.ceoElevator && !c30.ceoVisit);
  const r30 = play(30);
  const elev = r30.log.filter((l) => l.includes('INT-11') || (l.includes(' qte ') && l.includes('elevator')));
  check('30일차 엘리베이터 QTE 발생', r30.sim.result?.outcome !== 'leave' || elev.some((l) => l.includes('result')), elev.map((l) => l.slice(l.indexOf('{'))).join(' '));
  const r7 = play(7);
  const join = r7.log.some((l) => l.includes('"action":"join"'));
  check('7일차 공범 제안·합류', r7.log.some((l) => l.includes(' offer ')) && join, `결과 ${r7.sim.result?.outcome} 점수 ${r7.sim.result?.slackPoints}`);
  // 이어하기: 적발로 끝나는 날을 찾아 이어 감
  for (let d = 1; d <= 40; d++) {
    const base = play(d);
    if (base.sim.result?.outcome !== 'caught') continue;
    const c = play(d, undefined, { continueOnce: true });
    check(`${d}일차 이어하기`, c.log.some((l) => l.includes(' continued ')) && c.sim.result?.continued === true, `재개 후 결과 ${c.sim.result?.outcome}`);
    break;
  }
  // 위계 연쇄 H1: 본부장이 우리 팀 구역에 오면 팀장 인사(say boss.team_lead.greeting)
  let greetSeen = false;
  for (let d = 16; d <= 27 && !greetSeen; d++) greetSeen = play(d).log.some((l) => l.includes('boss.team_lead.greeting'));
  check('위계 연쇄 H1 팀장 인사(16~27일차 중)', greetSeen);
}

const maxDay = Number(process.argv[2] ?? 20);
const verbose = process.argv.includes('-v');
for (let d = 1; d <= maxDay; d++) {
  let res: ReturnType<typeof play> | null = null;
  try { res = play(d); } catch (e) { check(`${d}일차 실행`, false, String((e as Error).stack ?? e)); continue; }
  const r = res.sim.result;
  check(`${d}일차 결과 도달`, !!r, r ? `${r.outcome} ★${r.stars} ${r.timeSec.toFixed(1)}초 최고의심 ${(r.peakSuspicion * 100).toFixed(0)}% 업무 ${(r.work * 100).toFixed(0)}% 미션 ${r.missionsDone}/${r.missionsTotal} 점수 ${r.slackPoints}` : `phase=${res.sim.phase}`);
  if (verbose) for (const l of res.log) console.log('   ', l);
  else for (const l of res.log.filter((x) => x.startsWith('warn'))) console.log('   ', l);
  const again = play(d);
  check(`${d}일차 결정성(같은 시드 같은 결과)`, again.sim.floor.fingerprint() === res.sim.floor.fingerprint() && JSON.stringify(again.sim.result) === JSON.stringify(r));
}
featureChecks();
if (failures > 0) { console.error(`실패 ${failures}건`); process.exit(1); }
console.log('smoke-day OK');
