/// <reference types="node" />
/** T-141: 앉은 봇에서 '출발 마감 마지막 기회에 통화를 끊고 출발'(D-117 ③)이 일어나는 일차·시각 찾기(브라우저 스크린샷 대상 선정). */
import { DaySim, type PatrolNpc } from '../../src/core';
import { CAMERA_VIEW } from '../../src/config/display';
import { contentV3, loadTables } from '../lib/t141content';
const T = loadTables(process.env['QA_DATA_DIR'] ?? 'data');
let n = 0;
for (let d = 6; d <= 200; d++) {
  const c = contentV3(T, d);
  if (!c.bossTours?.[0]) continue;
  for (const sd of [c.seed, ...Array.from({ length: Number(process.argv[2] ?? 7) }, (_, k) => `qa141-${k + 1}`)]) {
  const sim = new DaySim(c, { view: CAMERA_VIEW }, sd);
  for (let i = 0; i < 60 * 200 && (sim.phase === 'day' || sim.phase === 'intro'); i++) {
    const tl = sim.floor.npcs.find((x: PatrolNpc) => x.def.actorId === 'team_lead' && x.def.seated);
    const wasPhone = tl?.mode === 'phone';
    const step = i;
    sim.step();
    for (const e of sim.drainEvents() as { type: string; stage?: string; index?: number }[]) {
      const def = c.bossTours[0]; const latest = Math.min(def.latestStartSec, def.latestStartByTour?.[e.index!] ?? Infinity);
      if (e.type === 'tour' && e.stage === 'stand' && (wasPhone || sim.dayTime > latest - 0.05)) { n++; console.log(`${d}일 seed=${sd} ${c.rankId} 회차 ${e.index} 근무 ${sim.dayTime.toFixed(2)}초 프레임 ${step + 1} 시각 ${sim.time.toFixed(2)} 예정 ${c.bossTours[0].atSec[e.index!]} 마감 ${latest.toFixed(2)} 직전 통화 ${wasPhone}`); }
    }
    sim.drainFloorEvents();
    if (sim.qteActive && sim.qte!.phase === 'window') sim.tapQte(0.1);
  }
  }
}
console.log(`통화 끊고 출발: ${n}회`);
