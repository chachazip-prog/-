/// <reference types="node" />
/** T-141 한 판 재현(버그 재현 절차용): bash tests/run-t141.sh trace <일차> <straight|disguise|novice|sit> <시드> [시작초] [끝초] */
import { DaySim } from '../../src/core';
import { CAMERA_VIEW } from '../../src/config/display';
import { BOTS, Bot } from '../lib/t141';
import { contentV3, loadTables } from '../lib/t141content';
const [dayS, botK, seed, t0s, t1s] = process.argv.slice(2);
const T = loadTables(process.env['QA_DATA_DIR'] ?? 'data');
const c = contentV3(T, Number(dayS));
const sim = new DaySim(c, { view: CAMERA_VIEW }, seed);
const bot = botK === 'sit' ? null : new Bot(BOTS[botK!]!, sim, seed!);
const t0 = Number(t0s ?? 0), t1 = Number(t1s ?? 999);
console.log(`${c.day}일 ${c.rankId} 미션 ${c.missions.map((m) => `${m.id}@${m.unlockAtSec}(${m.spot.x},${m.spot.y} 제한 ${m.timeLimitSec})`).join(' ')} 좌석 (${c.playerSeat.x},${c.playerSeat.y}) 순회 ${JSON.stringify(c.bossTours?.[0]?.atSec ?? [])}`);
let lastLine = '';
for (let i = 0; i < 60 * 260 && sim.phase !== 'ended'; i++) {
  bot?.act();
  sim.step();
  const t = sim.time;
  for (const e of sim.drainEvents()) if (t >= t0 && t <= t1 && !['routeHint'].includes(e.type)) console.log(`${t.toFixed(2)} [${sim.dayTime.toFixed(1)}] ${JSON.stringify(e)}`);
  for (const e of sim.drainFloorEvents()) if (t >= t0 && t <= t1 && ['talkWarn', 'talk', 'talkCancel', 'caught', 'blocked'].includes(e.type)) console.log(`${t.toFixed(2)}   floor ${JSON.stringify(e)}`);
  if (t >= t0 && t <= t1 && i % 15 === 0) {
    const p = sim.floor.player;
    const line = `${p.mode} (${p.tile.x},${p.tile.y}) 의심 ${(sim.floor.suspicion.value * 100).toFixed(0)} 업무 ${(sim.work * 100).toFixed(0)} 활동 ${sim.activityView()?.kind ?? '-'} 대기 ${sim.pendingMission?.def.id ?? '-'} 미션 ${sim.missions.map((m) => `${m.def.id}:${m.state}${m.blocked ? '(잠김)' : ''}`).join(',')}`;
    if (line !== lastLine) { console.log(`${t.toFixed(2)}   ${line}`); lastLine = line; }
  }
}
console.log('결과', JSON.stringify(sim.result));
