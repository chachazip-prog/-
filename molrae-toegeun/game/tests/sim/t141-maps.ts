/// <reference types="node" />
/**
 * T-141 생성 맵·성별 시설 회귀(D-109, gender-design §6 G-항목 일부).
 *   bash tests/run-t141.sh maps [--write]   (--write: qa/t141-map-hashes.json 스냅샷 재생성)
 *  - 3~200일 맵 해시(성별 시설 on: 플레이어 남/여, off) · 폴백(G17) · 같은 일차 재생성 동일성 · 남/여 판정 재료 동일(skins 제외)
 *  - 일차별 시설 메타(relation·mineSide·cleaning·facilityStop) → tests/.out/t141/facility.json (밸런스 G2~G5 결합용)
 *  - G10(7일 창 same/other 일수 차), G15(본부장 시설 들름 실제 발생, 앉은 봇), G4 편도 거리 차
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DaySim, findPath } from '../../src/core';
import { CAMERA_VIEW } from '../../src/config/display';
import { buildDayContent } from '../../src/content/buildDay';
import { createLevelProvider } from '../../src/content/levelProvider';
import { contentV3, fnv, loadTables } from '../lib/t141content';

const T = loadTables(process.env['QA_DATA_DIR'] ?? 'data');
const SNAP = '../qa/t141-map-hashes.json';
const write = process.argv.includes('--write');
const off = (d: number) => buildDayContent(T, d, [], { levelProvider: createLevelProvider({ generate: true }), missionsV3: true, genderFacilities: false, tours: 'auto' });
const hashes: Record<string, { on: string; off: string; rank: string; source: string; sourceOff: string }> = {};
const fac: Record<string, unknown>[] = [];
let mfDiff = 0, regenDiff = 0, fallbackOn = 0, fallbackOff = 0, skinsSame = 0;
const noSkins = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'skins' ? undefined : v));
const stopDays: number[] = []; const stopEntered: number[] = [];
for (let d = 3; d <= 200; d++) {
  const m = contentV3(T, d, 'm'), f = contentV3(T, d, 'f'), o = off(d);
  const hOn = fnv(m.floor.level.rows.join('\n')), hOff = fnv(o.floor.level.rows.join('\n'));
  if (noSkins(m) !== noSkins(f)) mfDiff++;
  if (JSON.stringify((m as unknown as { skins?: unknown }).skins) === JSON.stringify((f as unknown as { skins?: unknown }).skins)) skinsSame++;
  if (fnv(contentV3(T, d, 'm').floor.level.rows.join('\n')) !== hOn) regenDiff++;
  if (m.layout?.source !== 'generated') fallbackOn++;
  if (o.layout?.source !== 'generated') fallbackOff++;
  hashes[d] = { on: hOn, off: hOff, rank: m.rankId, source: m.layout?.source ?? '?', sourceOff: o.layout?.source ?? '?' };
  const F = m.facility;
  let distMine = NaN, distOther = NaN;
  if (F?.restroom.other) {
    const a = findPath(m.floor.level.rows.length ? (new DaySim(m, { view: CAMERA_VIEW }).floor.map) : (null as never), m.playerSeat, F.restroom.mine.door);
    const b = findPath(new DaySim(m, { view: CAMERA_VIEW }).floor.map, m.playerSeat, F.restroom.other.door);
    distMine = a ? a.length - 1 : NaN; distOther = b ? b.length - 1 : NaN;
  }
  // G15: 본부장 시설 들름 실제 발생(앉은 봇)
  let entered = false, enteredDay = false;
  if (F?.stop) {
    stopDays.push(d);
    const sim = new DaySim(m, { view: CAMERA_VIEW });
    for (let i = 0; i < 60 * 200 && sim.phase !== 'ended'; i++) {
      sim.step();
      for (const e of sim.drainEvents() as { type: string; stage?: string }[]) if (e.type === 'facility' && e.stage === 'enter') { entered = true; if (sim.phase === 'day') enteredDay = true; }
      sim.drainFloorEvents();
      if (sim.qteActive && sim.qte!.phase === 'window') sim.tapQte(0.1);
    }
    if (entered) stopEntered.push(d);
  }
  fac.push({ day: d, rank: m.rankId, kind: F?.kind ?? null, mineSide: F?.mineSide ?? null, relation: F?.stop?.relation ?? null, cleaning: !!F?.cleaning, cleaningMission: F?.cleaning?.missionId ?? null, stop: !!F?.stop, stopEntered: entered, stopEnteredDay: enteredDay, distMine, distOther,
    buddy: JSON.stringify((m as unknown as { skins?: Record<string, unknown> }).skins ?? {}).match(/buddy[^"]*_(m|f)/)?.[1] ?? null });
}
mkdirSync('tests/.out/t141', { recursive: true });
writeFileSync('tests/.out/t141/facility.json', JSON.stringify(fac));
let prev: typeof hashes | null = null;
if (existsSync(SNAP)) prev = JSON.parse(readFileSync(SNAP, 'utf8')).days;
const changed = prev ? Object.keys(hashes).filter((d) => prev![d]?.on !== hashes[d]!.on || prev![d]?.off !== hashes[d]!.off) : [];
if (write) writeFileSync(SNAP, JSON.stringify({ note: 'T-141 맵 해시 스냅샷(3~200일, FNV-1a of floor rows). on = 생성 맵+미션 v3+성별 시설(플레이어 남·여 동일), off = 성별 시설 끔. 재생성: bash tests/run-t141.sh maps --write', generatorVersion: (T['layout'] as { generatorVersion?: unknown }).generatorVersion, days: hashes }, null, 1));
// G10: 7일 창 same/other 일수 차
const rel = fac.filter((x) => x['relation']);
let g10 = 0;
for (let d = 3; d <= 194; d++) { const w = rel.filter((x) => (x['day'] as number) >= d && (x['day'] as number) < d + 7); const s = w.filter((x) => x['relation'] === 'same').length, o2 = w.filter((x) => x['relation'] === 'other').length; if (w.length) g10 = Math.max(g10, Math.abs(s - o2)); }
const dd = fac.filter((x) => Number.isFinite(x['distMine'] as number)).map((x) => Math.abs((x['distMine'] as number) - (x['distOther'] as number)));
console.log(JSON.stringify({
  days: 198, fallbackOn, fallbackOff, regenDiff, mfJudgeDiff: mfDiff, skinsIdenticalDays: skinsSame, snapshot: prev ? `기존 스냅샷 대비 변경 ${changed.length}일 ${changed.slice(0, 10).join(',')}` : '기존 스냅샷 없음', written: write,
  pairDays: fac.filter((x) => x['kind'] === 'pair').length, relationSame: rel.filter((x) => x['relation'] === 'same').length, relationOther: rel.filter((x) => x['relation'] === 'other').length,
  g10MaxWindowDiff: g10, g4MaxDistDiff: Math.max(...dd), g4MeanDistDiff: dd.reduce((a, b) => a + b, 0) / dd.length,
  g15: `${stopEntered.length}/${stopDays.length}`, g15DayPhaseOnly: fac.filter((x) => x['stopEnteredDay']).length, g15Missed: stopDays.filter((d) => !stopEntered.includes(d)).slice(0, 20), cleaningDays: fac.filter((x) => x['cleaning']).length,
}, null, 1));
