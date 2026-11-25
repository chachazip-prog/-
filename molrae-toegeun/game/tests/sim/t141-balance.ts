/// <reference types="node" />
/**
 * T-141 하루 전체 밸런스·공정성 측정(미리보기 빌드 조립: 생성 맵·미션 v3·성별 시설·순회).
 *   bash tests/run-t141.sh balance [1~15일 시드=200] [16~60일 시드=60] [대표님 날 시드=120] [61~200일 시드=12] [워커=8] [성별 짝 시드=20]
 * 봇 3종(직진·위장(캐주얼 기준)·초보) × 일차 × 시드. 위장 봇은 '퇴근 방해 제거' 변형을 같은 시드로 한 번 더(합격선 9).
 * 성별 짝: 3~60일 위장 봇을 같은 시드로 플레이어 남/여 각각 돌려 결과 차이를 잰다(기대값 0, D-087·D-092).
 * 원자료: tests/.out/t141/bal-*.jsonl (집계는 tests/sim/t141-tables.py)
 */
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { BOTS, loadTables, runDay, type RunResult } from '../lib/t141';
import { contentV3, isCeoDay, type Pv } from '../lib/t141content';
import type { DayContent } from '../../src/core/day/types';

const DATA = process.env['QA_DATA_DIR'] ?? 'data';
const OUT = resolve('tests/.out/t141');
const args = process.argv.slice(2);
const wi = args.indexOf('--worker');
interface Job { day: number; bot: string; seed: string; strip: boolean; pv: Pv }

function jobs(t: ReturnType<typeof loadTables>, nA: number, nG: number, nC: number, nL: number, nP: number): Job[] {
  const out: Job[] = [];
  for (let day = 1; day <= 200; day++) {
    const ceo = isCeoDay(contentV3(t, day));
    const n = day <= 15 ? nA : day <= 60 ? (ceo ? nC : nG) : (ceo ? Math.max(nL, Math.round(nL * 1.5)) : nL);
    for (let s = 0; s < n; s++) for (const bot of Object.keys(BOTS)) {
      const seed = `qa141-${day}-${s}`;
      out.push({ day, bot, seed, strip: false, pv: 'm' });
      if (bot === 'disguise') out.push({ day, bot, seed, strip: true, pv: 'm' });
      if (bot === 'disguise' && day >= 3 && day <= 60 && s < nP) out.push({ day, bot, seed, strip: false, pv: 'f' });
    }
  }
  return out;
}

if (wi >= 0) {
  const [k, of, nA, nG, nC, nL, nP] = args.slice(wi + 1).map(Number) as [number, number, number, number, number, number, number];
  const tables = loadTables(DATA);
  const all = jobs(tables, nA, nG, nC, nL, nP);
  const cache = new Map<string, DayContent>();
  const file = join(OUT, `bal-${k}.jsonl`);
  let buf: string[] = [];
  for (let j = k; j < all.length; j += of) {
    const jb = all[j]!;
    const ck = `${jb.day}|${jb.pv}`;
    let c = cache.get(ck);
    if (!c) { c = contentV3(tables, jb.day, jb.pv); cache.set(ck, c); }
    let r: RunResult | { error: string; day: number; bot: string; seed: string };
    try { r = runDay(c, BOTS[jb.bot]!, jb.seed, { stripLeaveInterrupts: jb.strip, maxSec: 260 }); }
    catch (e) { r = { error: String((e as Error).stack ?? e), day: jb.day, bot: jb.bot, seed: jb.seed }; }
    const slim = 'fair' in r ? { ...r, fair: { ...r.fair, onsetNoLeadSamples: r.fair.onsetNoLeadSamples.slice(0, 2), lookSamples: r.fair.lookSamples.slice(0, 2) } } : r;
    buf.push(JSON.stringify({ ...slim, botKey: jb.bot, strip: jb.strip, pv: jb.pv }));
    if (buf.length >= 50) { appendFileSync(file, buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) appendFileSync(file, buf.join('\n') + '\n');
  process.exit(0);
} else {
  const nA = Number(args[0] ?? 200), nG = Number(args[1] ?? 60), nC = Number(args[2] ?? 120), nL = Number(args[3] ?? 12), W = Number(args[4] ?? 8), nP = Number(args[5] ?? 20);
  mkdirSync(OUT, { recursive: true });
  for (let k = 0; k < 64; k++) { const f = join(OUT, `bal-${k}.jsonl`); if (existsSync(f)) rmSync(f); }
  const t0 = Date.now();
  const self = fileURLToPath(import.meta.url);
  let left = W;
  for (let k = 0; k < W; k++) {
    const cp = fork(self, ['--worker', String(k), String(W), String(nA), String(nG), String(nC), String(nL), String(nP)], { env: process.env });
    cp.on('exit', () => { if (--left === 0) console.log(`완료 ${((Date.now() - t0) / 1000).toFixed(0)}초`); });
  }
}
