/// <reference types="node" />
/** T-141: 'HUD 미션 칩만 한 번 탭하고 아무것도 안 하는' 입력으로 일찍 적발되는 일차 찾기(브라우저 이어하기 광고 흐름 재현용). */
import { DaySim } from '../../src/core';
import { CAMERA_VIEW } from '../../src/config/display';
import { contentV3, loadTables } from '../lib/t141content';
const T = loadTables(process.env['QA_DATA_DIR'] ?? 'data');
for (let d = 6; d <= 40; d++) {
  const c = contentV3(T, d);
  for (let k = 0; k < c.missions.length; k++) {
    const sim = new DaySim(c, { view: CAMERA_VIEW }, c.seed);
    let tappedAt = -1;
    for (let i = 0; i < 60 * 120 && sim.phase !== 'ended'; i++) {
      if (tappedAt < 0 && sim.phase === 'day' && sim.missions[k]!.state === 'open') { sim.tapMission(sim.missions[k]!.def.id); tappedAt = i; }
      sim.step(); sim.drainEvents(); sim.drainFloorEvents();
      if (sim.qteActive && sim.qte!.phase === 'window') sim.tapQte(0.1);
    }
    if (sim.result?.outcome === 'caught' && sim.result.timeSec < 40) console.log(`${d}일 칩 ${k}(${sim.missions[k]!.def.id}) 탭 프레임 ${tappedAt} → 적발 ${sim.result.timeSec.toFixed(1)}초 by ${sim.result.caughtBy}`);
  }
}
