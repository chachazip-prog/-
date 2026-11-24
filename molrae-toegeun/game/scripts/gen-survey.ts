/// <reference types="node" />
/**
 * v3 생성 층 전수 조사(개발자용, T-145). `npm run gen-survey [마지막 일차=200] [--show] [--json 경로]`
 *  - 3~N일차 각 날: 실제 하루 조립(buildDayContent, 생성 층 강제 + 미션 v3 + 순회)과 같은 입력으로 층을 만든다
 *  - 폴백 수, 시도 수 분포(직급별 평균·최대), 실패 사유 상위, 직급별 복잡도 지표, 같은 일차 재생성 동일성(해시)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayContent, type Tables } from '../src/content/buildDay';
import { createLevelProvider } from '../src/content/levelProvider';

function findRoot(start: string): string {
  let d = start;
  for (let i = 0; i < 6; i++) {
    try { readdirSync(join(d, 'data')); readFileSync(join(d, 'package.json')); return d; } catch { d = resolve(d, '..'); }
  }
  throw new Error('game 루트를 찾지 못함');
}
const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const load = (): Tables => {
  const t: Record<string, unknown> = {};
  for (const f of readdirSync(join(ROOT, 'data'))) if (f.endsWith('.json')) t[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
  return t;
};
const args = process.argv.slice(2);
const last = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const show = args.includes('--show');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;
const opts = { levelProvider: createLevelProvider({ generate: true }), tours: 'auto' as const, missionsV3: true };

const hash = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const T = load();
const t0 = Date.now();
type Row = { day: number; rank: string; source: string; attempts: number; hash: string; height: number; m?: Record<string, unknown>; fails: string[]; ms: number; tours: number; toursFeasible: number; awayMax: number; mods: number };
const rows: Row[] = [];
for (let day = 3; day <= last; day++) {
  const a = Date.now();
  const warn: string[] = [];
  const c = buildDayContent(T, day, warn, opts);
  const L = c.layout!;
  rows.push({
    day, rank: c.rankId, source: L.source, attempts: L.attempts ?? 0, hash: hash(c.floor.level.rows.join('\n')), height: c.floor.level.rows.length,
    ...(L.metrics ? { m: L.metrics as unknown as Record<string, unknown> } : {}), fails: (L.failures ?? []).map((f) => f.replace(/^[^:]*: /, '').split(' ').slice(0, 2).join(' ')),
    ms: Date.now() - a, tours: c.bossTours?.[0]?.atSec.length ?? 0, toursFeasible: (c.bossTours?.[0]?.atSec ?? []).filter((a, i) => a <= Math.min(c.bossTours![0]!.latestStartSec, c.bossTours![0]!.latestStartByTour?.[i] ?? Infinity)).length, awayMax: Math.max(0, ...(c.bossTours?.[0]?.awaySec ?? [0])), mods: c.missions.reduce((s, m) => s + (m.modifierIds?.length ?? 0), 0),
  });
  if (show && (day === 3 || day === 6 || day === 16 || day === 28 || day === 41 || day === 53 || day === 65)) {
    console.log(`\n## ${day}일차 ${c.rankId} ${L.source} [${(L.modules ?? []).join(', ')}]`);
    c.floor.level.rows.forEach((r, i) => console.log(`${String(i).padStart(2, '0')} ${r}`));
  }
}
// 결정성: 새 테이블 객체(캐시 없음)로 다시 생성해 해시 비교
const T2 = load();
let same = 0;
const sample = rows.filter((_, i) => i % 7 === 0);
for (const r of sample) {
  const c = buildDayContent(T2, r.day, [], { levelProvider: createLevelProvider({ generate: true }), tours: 'auto', missionsV3: true });
  if (hash(c.floor.level.rows.join('\n')) === r.hash) same++;
}
const byRank = new Map<string, Row[]>();
for (const r of rows) { const a = byRank.get(r.rank) ?? []; a.push(r); byRank.set(r.rank, a); }
console.log(`\n=== v3 생성 전수 3~${last}일차 (${rows.length}일, ${((Date.now() - t0) / 1000).toFixed(1)}초) ===`);
console.log(`폴백 ${rows.filter((r) => r.source !== 'generated').length}일: ${rows.filter((r) => r.source !== 'generated').map((r) => r.day).join(', ') || '없음'}`);
console.log(`같은 일차 재생성 동일: ${same}/${sample.length}`);
const hist = new Map<number, number>();
for (const r of rows) hist.set(r.attempts, (hist.get(r.attempts) ?? 0) + 1);
console.log(`시도 수 분포: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}회×${v}`).join(' ')}`);
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(`하루 조립 시간(ms): 중앙 ${ms[Math.floor(ms.length / 2)]} / 최대 ${ms[ms.length - 1]}`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
for (const [rank, rs] of byRank) {
  const fc = new Map<string, number>();
  for (const r of rs) for (const f of r.fails) fc.set(f, (fc.get(f) ?? 0) + 1);
  const top = [...fc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`).join(', ');
  const mv = (k: string) => rs.map((r) => Number((r.m?.['v3'] as Record<string, unknown> | undefined)?.[k] ?? NaN)).filter((x) => Number.isFinite(x));
  const fmt = (k: string) => { const v = mv(k); return v.length ? `${k} ${Math.min(...v)}~${Math.max(...v)}(평균 ${avg(v).toFixed(1)})` : `${k} -`; };
  console.log(`\n[${rank}] ${rs.length}일 · 시도 평균 ${avg(rs.map((r) => r.attempts)).toFixed(1)} / 최대 ${Math.max(...rs.map((r) => r.attempts))} · 순회 예정 평균 ${avg(rs.map((r) => r.tours)).toFixed(1)}회(출발 가능 ${avg(rs.map((r) => r.toursFeasible)).toFixed(1)}회, 최장 자리 비움 추정 ${Math.max(...rs.map((r) => r.awayMax)).toFixed(1)}초) · 변형 평균 ${avg(rs.map((r) => r.mods)).toFixed(1)}개`);
  console.log(`  높이 ${Math.min(...rs.map((r) => r.height))}~${Math.max(...rs.map((r) => r.height))} · ${fmt('seatToGate')} · ${fmt('branchPointsOnLeave')} · ${fmt('deadEnds')} · ${fmt('pillars')}`);
  console.log(`  ${fmt('uncoveredStraight')} · ${fmt('coverTiles')} · ${fmt('halfPartitions')} · ${fmt('repairsUsed')} · ${fmt('trimSec')} · ${fmt('predictedRunSec')}`);
  console.log(`  실패 사유 상위: ${top || '없음'}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows));
