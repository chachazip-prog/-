/// <reference types="node" />
/**
 * T-131 재현 도구: 한 판을 같은 봇·시드로 다시 돌리며 틱별 상태를 출력한다(버그 재현 절차용).
 * bash tests/run-t131.sh trace <일차> <봇 straight|disguise|novice> <시드> [시작초] [끝초]
 */
import { DaySim, type PatrolNpc } from '../../src/core';
import { BOTS, Bot, VIEW, contentFor, loadTables, lanyardOf } from '../lib/t131';

const [dayS, botK, seed, fromS, toS] = process.argv.slice(2);
const tables = loadTables(process.env['QA_DATA_DIR'] ?? 'data');
const c = contentFor(tables, Number(dayS));
const sim = new DaySim(c, { view: VIEW }, seed!);
const bot = new Bot(BOTS[botK!]!, sim, seed!);
const from = Number(fromS ?? 0), to = Number(toS ?? 999);
const f = sim.floor;
const fmtN = (n: PatrolNpc, k: number) => `${n.def.id}[${n.mode}${n.tellKind ? '/' + n.tellKind : ''} (${n.x.toFixed(2)},${n.y.toFixed(2)}) f=${(n.facing * 180 / Math.PI).toFixed(0)} on=${f.isOnScreen(n) ? 1 : 0} th=${f.threatOfNpc(n)} see=${f.seeing[k] ? 1 : 0} g=${n.gazeMultiplier.toFixed(2)} ${lanyardOf(sim, n)}]`;
console.log(`day ${c.day} rank ${c.rankId} missions ${c.missions.map((m) => `${m.id}@${m.unlockAtSec}`).join(',')} ints ${c.interrupts.map((i) => `${i.id}/${i.phase}@${i.atSec}`).join(',')}`);
for (let i = 0; i < 60 * 200 && sim.phase !== 'ended'; i++) {
  bot.act();
  const b = f.suspicion.value;
  sim.step();
  const ev = [...sim.drainEvents(), ...sim.drainFloorEvents()].filter((e) => e.type !== 'tap' || true);
  const t = f.time;
  if (t >= from && t <= to) {
    const d = f.suspicion.value - b;
    const p = f.player;
    const evs = ev.map((e) => { const { t: _t, ...r } = e as Record<string, unknown>; return JSON.stringify(r); }).join(' ');
    if (d > 1e-9 || evs || i % 6 === 0) {
      console.log(`${t.toFixed(3)} ${sim.phase}/${sim.leaveStage} P(${p.x.toFixed(2)},${p.y.toFixed(2)}) ${p.mode}${p.paused ? '(p)' : ''} posture=${sim.posture} s=${f.suspicion.value.toFixed(3)} d=${d.toFixed(4)} cam=${f.camera?.visibleTop.toFixed(2)}~${f.camera?.visibleBottom.toFixed(2)} ${evs}`);
      f.npcs.forEach((n, k) => { if (lanyardOf(sim, n) !== 'background') console.log('     ', fmtN(n, k)); });
    }
  }
}
console.log('result', JSON.stringify(sim.result));
