/// <reference types="node" />
/** T-141: 캐주얼(위장) 봇 플레이 중 '마감 마지막 기회 통화 끊고 출발'(D-117 ③) 발생 탐색. 인자: 시드 수(기본 6) */
import { DaySim, type PatrolNpc } from '../../src/core';
import { CAMERA_VIEW } from '../../src/config/display';
import { BOTS, Bot } from '../lib/t141';
import { contentV3, loadTables } from '../lib/t141content';
const T = loadTables(process.env['QA_DATA_DIR'] ?? 'data');
const nS = Number(process.argv[2] ?? 6);
let n = 0, near = 0, stands = 0;
for (let d = 6; d <= 200; d++) {
  const c = contentV3(T, d);
  const def = c.bossTours?.[0];
  if (!def) continue;
  for (let s = 0; s < nS; s++) {
    const seed = `qa141-${d}-${s}`;
    const sim = new DaySim(c, { view: CAMERA_VIEW }, seed);
    const bot = new Bot(BOTS['disguise']!, sim, seed);
    for (let i = 0; i < 60 * 200 && sim.phase === 'day' || (i < 60 * 200 && sim.phase === 'intro'); i++) {
      bot.act();
      const tl = sim.floor.npcs.find((x: PatrolNpc) => x.def.actorId === 'team_lead' && x.def.seated);
      const wasPhone = tl?.mode === 'phone';
      sim.step();
      for (const e of sim.drainEvents() as { type: string; stage?: string; index?: number }[]) {
        if (e.type !== 'tour' || e.stage !== 'stand') continue;
        stands++;
        const latest = Math.min(def.latestStartSec, def.latestStartByTour?.[e.index!] ?? Infinity);
        if (sim.dayTime > latest - 0.05) near++;
        if (wasPhone) { n++; if (n <= 12) console.log(`${d}일 seed=${seed} ${c.rankId} 회차 ${e.index} 근무 ${sim.dayTime.toFixed(2)} 시각 ${sim.time.toFixed(2)} 프레임 ${i + 1} 예정 ${def.atSec[e.index!]} 마감 ${latest.toFixed(2)}`); }
      }
      sim.drainFloorEvents();
    }
  }
}
console.log(`출발 ${stands}회 중 마감 직전 ${near}회, 통화 끊고 출발 ${n}회`);
