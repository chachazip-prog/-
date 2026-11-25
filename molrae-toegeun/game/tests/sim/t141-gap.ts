/// <reference types="node" />
/**
 * T-141 방해 배치 최소 간격(days.generator.dayInterrupts.minGapSec) 추종 검사. 데이터 사본만 바꿈(원본 불변).
 *   bash tests/run-t141.sh gap
 * 3~200일 생성 계획에서 시각을 정하는 근무 방해(atSec > 0)끼리 간격 최솟값·위반 수를 minGapSec 값별로 잰다.
 * INT-10(본부장)은 별도 배치(scheduleGuard.otherGapSec가 같은 값을 읽음), INT-08은 낮잠 조정·순회 흡수 대상이라 따로 표시.
 */
import { contentV3, loadTables } from '../lib/t141content';
import type { Tables } from '../../src/content/buildDay';

const base = loadTables(process.env['QA_DATA_DIR'] ?? 'data');
const withGap = (g: number): Tables => { const t = JSON.parse(JSON.stringify(base)) as Record<string, any>; t['days'].generator.dayInterrupts.minGapSec = g; return t; };
for (const g of [6, 10, 14, 18]) {
  const T = withGap(g);
  let pairs = 0, viol = 0, minGap = Infinity, counts = 0, viol10 = 0; const samples: string[] = []; const byPair: Record<string, number> = {};
  for (let d = 16; d <= 200; d++) {
    const c = contentV3(T, d);
    const ints = c.interrupts.filter((i) => i.phase === 'day' && i.atSec > 0).sort((a, b) => a.atSec - b.atSec);
    counts += ints.length;
    for (let i = 1; i < ints.length; i++) {
      const gap = ints[i]!.atSec - ints[i - 1]!.atSec; pairs++; minGap = Math.min(minGap, gap);
      if (gap < g - 0.05) { viol++; const k = `${ints[i - 1]!.id}>${ints[i]!.id}`; byPair[k] = (byPair[k] ?? 0) + 1; if (samples.length < 6) samples.push(`${d}일 ${ints[i - 1]!.id}@${ints[i - 1]!.atSec} ${ints[i]!.id}@${ints[i]!.atSec}`); }
      if (ints[i]!.id !== 'INT-10' && ints[i - 1]!.id !== 'INT-10' && gap < g - 0.05) viol10++;
    }
  }
  console.log(`minGapSec ${g}: 방해 ${counts}개, 이웃 쌍 ${pairs}, 최소 간격 ${minGap.toFixed(1)}초, 위반 ${viol}(INT-10 없는 쌍 ${viol10}) ${JSON.stringify(byPair)} ${samples.join(' | ')}`);
}
