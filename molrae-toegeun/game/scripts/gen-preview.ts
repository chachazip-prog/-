/// <reference types="node" />
/**
 * 생성 층 미리보기 (개발자용, T-144). `npm run gen-preview -- [옵션]`
 *   --day N           N일차(기본 3). --to M 을 주면 N~M일차
 *   --seed S          생성 시드 덮어쓰기(기본 layout-day-N)
 *   --complexity C    복잡도 강제(0~1). 주면 일차 대신 이 값으로 생성기만 돌림
 *   --log             시도별 실패 사유 모두 출력
 * 출력: 문자 격자(행 번호, 모듈 시작 표시), 모듈 목록, 검증 지표, 재매핑 경고, 팀장 순회 일정.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayContent, type Tables } from '../src/content/buildDay';
import { createLevelProvider } from '../src/content/levelProvider';
import {
  DEV_LAYOUT_MODULES, DEV_LAYOUT_POLICY, DEV_LAYOUT_RULES, DEV_VALIDATE_RULES, generateValidated, layoutToText,
} from '../src/content/layoutGen';
import type { LegendEntry } from '../src/core/grid';

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

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const showLog = argv.includes('--log');
const seed = arg('--seed');
const cx = arg('--complexity');

if (cx !== undefined) {
  const maps = (tables['maps'] as { maps: { id: string; legend: Record<string, LegendEntry> }[] }).maps;
  const legend = maps.find((m) => m.id === DEV_LAYOUT_POLICY.sourceMapId)!.legend;
  const r = generateValidated({ modules: DEV_LAYOUT_MODULES, rules: DEV_LAYOUT_RULES, legend, complexity: Number(cx), seed: seed ?? 'preview' }, DEV_VALIDATE_RULES, DEV_LAYOUT_POLICY.maxAttempts);
  console.log(`복잡도 ${cx} 시드 ${seed ?? 'preview'}: ${r.layout ? `통과(시도 ${r.attempts})` : `실패(시도 ${r.attempts}) → 폴백`}`);
  if (r.layout) console.log(layoutToText(r.layout));
  if (r.metrics) console.log('지표', JSON.stringify(r.metrics));
  if (showLog || !r.layout) for (const a of r.log) for (const f of a.failures) console.log(`  ${a.seed}: ${f.code} ${f.detail}`);
} else {
  const from = Number(arg('--day') ?? 3);
  const to = Number(arg('--to') ?? from);
  const provider = createLevelProvider({ generate: true, ...(seed ? { seedOverride: seed } : {}) });
  for (let day = from; day <= to; day++) {
    const warns: string[] = [];
    const c = buildDayContent(tables as Tables, day, warns, { levelProvider: provider, tours: true });
    const L = c.layout;
    console.log(`\n═══ ${day}일차 (${c.rankId}) 층 ${L?.source} ${L?.mapId} 복잡도 ${L?.complexity?.toFixed(2) ?? '-'} 시도 ${L?.attempts ?? '-'} ═══`);
    if (L?.modules) console.log(`모듈: ${L.modules.join(' → ')}`);
    const rows = c.floor.level.rows;
    const mods = L?.modules ?? [];
    console.log(rows.map((r, y) => `${String(y).padStart(3, ' ')} ${r}`).join('\n'));
    console.log(`크기 ${rows[0]?.length}×${rows.length}, 자리 (${c.playerSeat.x},${c.playerSeat.y}), 순찰 ${Object.keys(c.patrols).length}개, 출연 ${c.floor.level.npcs.length}명, 모듈 ${mods.length}개`);
    if (c.bossTours) for (const t of c.bossTours) console.log(`순회 ${t.actorId}: ${t.atSec.map((s, i) => `${s}초[${(t.routes[i] ?? []).map((r) => r.id).join('+')}]`).join(', ')}`);
    for (const w of warns) console.log(`  경고: ${w}`);
    if (showLog && L?.failures) for (const f of L.failures) console.log(`  실패: ${f}`);
  }
}
