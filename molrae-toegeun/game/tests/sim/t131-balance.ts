/// <reference types="node" />
/**
 * T-131 하루 전체 밸런스·공정성 측정. bash tests/run-t131.sh balance [저작일 시드수=300] [생성일 시드수=100] [워커=4]
 * 1~15일차(저작) + 16~30일차(생성) × 봇 3종 × 시드. 위장 봇은 '퇴근 방해 제거' 변형을 같은 시드로 한 번 더 돌려 지연을 잰다.
 * 원자료: tests/.out/t131-bal-*.jsonl, 집계: tests/.out/t131-balance.json (qa/t131-balance.md는 이 집계로 작성)
 */
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { BOTS, contentFor, loadTables, runDay, type RunResult } from '../lib/t131';

const DATA = process.env['QA_DATA_DIR'] ?? 'data';
const OUT = resolve('tests/.out');
const args = process.argv.slice(2);
const wi = args.indexOf('--worker');

const AUTHORED = Array.from({ length: 15 }, (_, i) => i + 1);
const GENERATED = Array.from({ length: 15 }, (_, i) => i + 16);

interface Job { day: number; bot: string; seed: string; strip: boolean }

function jobs(nA: number, nG: number): Job[] {
  const out: Job[] = [];
  for (const day of [...AUTHORED, ...GENERATED]) {
    const n = day <= 15 ? nA : nG;
    for (let s = 0; s < n; s++) for (const bot of Object.keys(BOTS)) {
      const seed = `qa-${day}-${s}`;
      out.push({ day, bot, seed, strip: false });
      if (bot === 'disguise') out.push({ day, bot, seed, strip: true });
    }
  }
  return out;
}

if (wi >= 0) {
  const k = Number(args[wi + 1]), of = Number(args[wi + 2]), nA = Number(args[wi + 3]), nG = Number(args[wi + 4]);
  const tables = loadTables(DATA);
  const cache = new Map<number, ReturnType<typeof contentFor>>();
  const file = join(OUT, `t131-bal-${k}.jsonl`);
  const all = jobs(nA, nG);
  let buf: string[] = [];
  for (let j = k; j < all.length; j += of) {
    const jb = all[j]!;
    let c = cache.get(jb.day);
    if (!c) { c = contentFor(tables, jb.day); cache.set(jb.day, c); }
    let r: RunResult | { error: string; day: number; bot: string; seed: string };
    try { r = runDay(c, BOTS[jb.bot]!, jb.seed, { stripLeaveInterrupts: jb.strip }); }
    catch (e) { r = { error: String((e as Error).stack ?? e), day: jb.day, bot: jb.bot, seed: jb.seed }; }
    buf.push(JSON.stringify({ ...r, botKey: jb.bot, strip: jb.strip }));
    if (buf.length >= 50) { appendFileSync(file, buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) appendFileSync(file, buf.join('\n') + '\n');
  process.exit(0);
} else {
  const nA = Number(args[0] ?? 300), nG = Number(args[1] ?? 100), W = Number(args[2] ?? 4);
  mkdirSync(OUT, { recursive: true });
  for (let k = 0; k < W; k++) { const f = join(OUT, `t131-bal-${k}.jsonl`); if (existsSync(f)) rmSync(f); }
  const t0 = Date.now();
  const self = fileURLToPath(import.meta.url);
  let left = W;
  for (let k = 0; k < W; k++) {
    const cp = fork(self, ['--worker', String(k), String(W), String(nA), String(nG)], { env: process.env });
    cp.on('exit', () => { if (--left === 0) aggregate(W, nA, nG, (Date.now() - t0) / 1000); });
  }
}

// ── 집계 ───────────────────────────────────────────────
type R = RunResult & { botKey: string; strip: boolean; error?: string };

function dataHash(): string {
  const h = createHash('sha1');
  for (const f of readdirSync(DATA).filter((x) => x.endsWith('.json')).sort()) h.update(f).update(readFileSync(join(DATA, f)));
  return h.digest('hex').slice(0, 10);
}

const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const q = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };

function aggregate(W: number, nA: number, nG: number, sec: number): void {
  const rows: R[] = [];
  for (let k = 0; k < W; k++) {
    const f = join(OUT, `t131-bal-${k}.jsonl`);
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, 'utf8').split('\n')) if (l) rows.push(JSON.parse(l) as R);
  }
  const errors = rows.filter((r) => r.error);
  const main = rows.filter((r) => !r.error && !r.strip);
  const strip = rows.filter((r) => !r.error && r.strip);
  const out: Record<string, unknown> = { runs: rows.length, errors: errors.length, errorSamples: errors.slice(0, 3).map((e) => e.error), sec, nA, nG, dataHash: dataHash() };

  const groupStats = (rs: R[]) => {
    const n = rs.length;
    const st = [0, 0, 0, 0];
    for (const r of rs) if (r.stars >= 0) st[r.stars]!++;
    const len = rs.map((r) => r.timeSec);
    return {
      n, lenMean: mean(len), lenP50: q(len, 0.5), lenMax: Math.max(...len), lenMin: Math.min(...len),
      leavePct: pct(rs.filter((r) => r.stars >= 2).length, n), caughtPct: pct(rs.filter((r) => r.outcome === 'caught').length, n),
      overtimePct: pct(rs.filter((r) => r.outcome === 'overtime').length, n), shortPct: pct(rs.filter((r) => r.outcome === 'leave_short').length, n),
      stars: st.map((x) => pct(x, n)), peakMean: mean(rs.map((r) => r.peak)),
      quotaMissPct: pct(rs.filter((r) => r.outcome === 'overtime' && r.work < r.quota).length, n),
      timeoutPct: pct(rs.filter((r) => r.outcome === 'timeout').length, n),
      earlyBonusPct: pct(rs.filter((r) => r.earlyBonus).length, n),
    };
  };
  const by: Record<string, unknown> = {};
  for (const bot of Object.keys(BOTS)) {
    const rs = main.filter((r) => r.botKey === bot);
    const perDay: Record<number, unknown> = {};
    for (const d of [...AUTHORED, ...GENERATED]) perDay[d] = groupStats(rs.filter((r) => r.day === d));
    // 적발 원인
    const causes: Record<string, number> = {};
    for (const r of rs.filter((x) => x.outcome === 'caught')) { const c = simplifyCause(r.caughtCause); causes[c] = (causes[c] ?? 0) + 1; }
    // 의심 상승 출처
    const gain: Record<string, number> = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.suspGain)) gain[k] = (gain[k] ?? 0) + v;
    // 미션별
    const mis: Record<string, Record<string, Record<string, number>>> = {};
    for (const r of rs) {
      const rank = r.day <= 5 ? 'intern' : r.day <= 15 ? 'staff' : 'gen';
      for (const m of r.missions) {
        const g = ((mis[rank] ??= {})[m.id] ??= { n: 0, done: 0, fail: 0, timeout: 0, other: 0, notStarted: 0, caught: 0 });
        if (!m.started) { g['notStarted']!++; continue; }
        g['n']!++;
        if (m.state === 'done') g['done']!++; else if (m.reason === 'fail') g['fail']!++; else if (m.reason === 'timeout') g['timeout']!++;
        else if (r.outcome === 'caught') g['caught']!++; else g['other']!++;
      }
      const g = ((mis[rank] ??= {})['leave'] ??= { n: 0, done: 0, fail: 0, timeout: 0, other: 0 });
      if (r.outcome !== 'caught' || r.leaveStart >= 0) {
        if (r.leaveStart >= 0 && !(r.outcome === 'caught' && false)) {
          g['n']!++;
          if (r.outcome === 'leave' || r.outcome === 'leave_short' || (r.outcome === 'overtime' && r.work < r.quota && r.gateFails < 3 && r.leaveSec !== null)) g['done']!++;
          else if (r.gateFails >= 3) g['fail']!++; else if (r.outcome === 'overtime') g['timeout']!++; else g['other']!++;
        }
      }
    }
    // 쇼핑 소요
    const shopSec = rs.flatMap((r) => r.missions.filter((m) => m.id === 'shopping' && m.state === 'done' && m.sec !== undefined).map((m) => m.sec!));
    by[bot] = {
      all: groupStats(rs), d1_5: groupStats(rs.filter((r) => r.day <= 5)), d1_10: groupStats(rs.filter((r) => r.day <= 10)), d6_15: groupStats(rs.filter((r) => r.day >= 6 && r.day <= 15)),
      d16_30: groupStats(rs.filter((r) => r.day >= 16)), staff: groupStats(rs.filter((r) => r.day >= 6 && r.day <= 15)), perDay, causes, gain, mis,
      shopSec: { n: shopSec.length, mean: mean(shopSec), min: Math.min(...shopSec), p90: q(shopSec, 0.9) },
      gate: { stageSecMean: mean(rs.filter((r) => r.gateStageSec > 0).map((r) => r.gateStageSec)), riseSum: rs.reduce((a, r) => a + r.gateStageRise, 0), nonStaleRise: rs.reduce((a, r) => a + r.gateStageNonStaleRise, 0), quickPassRise: rs.filter((r) => r.gateStageSec > 0 && r.gateStageSec <= 3).reduce((a, r) => a + r.gateStageRise, 0) },
      int08: { ticks: rs.reduce((a, r) => a + r.int08TellTicks, 0), rise: rs.reduce((a, r) => a + r.int08TellRise, 0) },
      int04Wait: { n: rs.filter((r) => r.int04BlockWaitSec !== null).length, mean: mean(rs.filter((r) => r.int04BlockWaitSec !== null).map((r) => r.int04BlockWaitSec!)) },
      closeCallsMean: mean(rs.map((r) => r.closeCalls)),
    };
  }
  out['byBot'] = by;
  // 공정성 합계
  const F = { gazeTicks: 0, offscreenGazeTicks: 0, cameraMismatchTicks: 0, unexplainedRiseTicks: 0, onsets: 0, onsetNoLead: 0, looks: 0, lookShortTell: 0, lookWithoutTell: 0, hudRowGazeTicks: 0 } as Record<string, number>;
  const causes: Record<string, number> = {};
  const fakes: Record<string, { tells: number; fakes: number; consecutive: number }> = {};
  const samples: string[] = [], lookSamples: string[] = [];
  for (const r of [...main, ...strip]) {
    for (const k of Object.keys(F)) F[k]! += (r.fair as unknown as Record<string, number>)[k] ?? 0;
    for (const [k, v] of Object.entries(r.fair.onsetCauses)) causes[k] = (causes[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.fair.fakes)) { const g = (fakes[k] ??= { tells: 0, fakes: 0, consecutive: 0 }); g.tells += v.tells; g.fakes += v.fakes; g.consecutive += v.consecutive; }
    if (samples.length < 12) samples.push(...r.fair.onsetNoLeadSamples.slice(0, 12 - samples.length));
    if (lookSamples.length < 8) lookSamples.push(...r.fair.lookSamples.slice(0, 8 - lookSamples.length));
  }
  out['fair'] = { ...F, causes, fakes, noLeadSamples: samples, lookSamples };
  // 인원·배경
  const all = [...main, ...strip];
  out['crowd'] = {
    maxOnScreen: Math.max(...all.map((r) => r.maxOnScreen)), maxOnScreenFull: Math.max(...all.map((r) => r.maxOnScreenFull)), maxOnFloor: Math.max(...all.map((r) => r.maxOnFloor)),
    byDayMaxOnScreen: Object.fromEntries([...AUTHORED, ...GENERATED].map((d) => [d, Math.max(...all.filter((r) => r.day === d).map((r) => r.maxOnScreen))])),
    over8Runs: all.filter((r) => r.maxOnScreen > 8).length,
    bgGaze: all.reduce((a, r) => a + r.bgGaze, 0), bgArrow: all.reduce((a, r) => a + r.bgArrow, 0), bgBlocked: all.reduce((a, r) => a + r.bgBlocked, 0),
  };
  // 말걸기(실제 하루 플레이 중)
  const talk: Record<string, Record<string, Record<string, number>>> = {};
  for (const r of main) for (const [a, s] of Object.entries(r.talk)) {
    const g = ((talk[r.botKey] ??= {})[a] ??= { warn: 0, armed: 0, talk: 0, disguised: 0, missed: 0, escaped: 0, releaseGainTicks: 0, postHoldViol: 0, talkSec: 0 });
    g['warn']! += s.warn; g['armed']! += s.armed; g['talk']! += s.talk; g['releaseGainTicks']! += s.releaseGainTicks; g['postHoldViol']! += s.postHoldViol; g['talkSec']! += s.talkSec;
    for (const [k, v] of Object.entries(s.cancel)) g[k] = (g[k] ?? 0) + v;
  }
  out['talk'] = talk;
  // 퇴근 방해 지연(위장 봇, 같은 시드 짝 비교)
  const key = (r: R) => `${r.day}|${r.seed}`;
  const sm = new Map(strip.map((r) => [key(r), r]));
  let dsum = 0, csum = 0, pairs = 0; const perInt: Record<string, { n: number; d: number }> = {};
  let directSum = 0;
  for (const r of main.filter((x) => x.botKey === 'disguise')) {
    const s = sm.get(key(r));
    if (!s || r.leaveSec === null || s.leaveSec === null) continue;
    const c = r.leaveIntsStarted.length;
    if (c === 0) continue;
    pairs++; dsum += r.leaveSec - s.leaveSec; csum += c; directSum += r.leaveTalkSec + r.leaveBlockedSec - s.leaveTalkSec - s.leaveBlockedSec;
    if (c === 1) { const g = (perInt[r.leaveIntsStarted[0]!] ??= { n: 0, d: 0 }); g.n++; g.d += r.leaveSec - s.leaveSec; }
  }
  out['leaveDelay'] = { pairs, interrupts: csum, perInterruptSec: csum ? dsum / csum : NaN, directPerInterruptSec: csum ? directSum / csum : NaN, singleInterrupt: Object.fromEntries(Object.entries(perInt).map(([k, v]) => [k, { n: v.n, mean: v.d / v.n }])) };
  writeFileSync(join(OUT, 't131-balance.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ runs: out['runs'], errors: out['errors'], sec, dataHash: out['dataHash'] }));
  console.log(`집계: ${join(OUT, 't131-balance.json')}`);
  void dirname;
}

function simplifyCause(c: string | null): string {
  if (!c) return 'unknown';
  if (c.startsWith('gaze:')) { const [, a, p] = c.split(':'); return `시선:${a}:${p}`; }
  return c.split(':')[0]!;
}
