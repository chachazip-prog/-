/**
 * T-124 헤드리스 밸런스 시뮬레이터 틀 (탑다운 프로토타입, 경로·시선 기반).
 * 실행: bash tests/run-balance.sh [시드수=1000]   (game/ 에서)
 * 출력: qa/t124-balance.md (표), tests/.out/t124-balance.json (원자료)
 *
 * 봇 3종
 *  - straight: 출구만 탭. 위장 안 함. 멈춰지면(말걸기 후 등) 다시 출구 탭.
 *  - disguise: 위협(seeing/turning: 화면의 '!'·빨강 화살표·콘에 해당)을 보면 반응시간 N(0.30,0.08)초 뒤 탭해서 위장,
 *              위협이 사라지고 N(0.30,0.10)초 뒤 출구로 재출발.
 *  - novice:   반응 느린 초보. 반응 N(0.60,0.15)초, 위협 에피소드의 25%는 못 알아챔, 재출발은 N(0.15,0.05)초로 성급.
 * 봇은 sim 내부 상태 중 화면에 표시되는 정보(threatOf)만 본다.
 */
import { FloorSim, createRng, type Rng, type FloorContent } from '../../src/core';
import { PROTO_FLOOR } from '../../src/dev/protoFloor';
import { Observer, UNFAIR_CAUSES, type OnsetCause } from '../lib/observe';

export interface BotParams {
  readonly name: string;
  readonly label: string;
  readonly disguise: boolean;
  readonly reactMean: number; readonly reactSd: number;
  readonly missProb: number;
  readonly resumeMean: number; readonly resumeSd: number;
}

export const BOTS: readonly BotParams[] = [
  { name: 'straight', label: '직진(위장 안 함)', disguise: false, reactMean: 0, reactSd: 0, missProb: 1, resumeMean: 0, resumeSd: 0 },
  { name: 'disguise', label: '위장 사용(반응 0.30초)', disguise: true, reactMean: 0.3, reactSd: 0.08, missProb: 0, resumeMean: 0.3, resumeSd: 0.1 },
  { name: 'novice', label: '느린 초보(반응 0.60초, 25% 놓침)', disguise: true, reactMean: 0.6, reactSd: 0.15, missProb: 0.25, resumeMean: 0.15, resumeSd: 0.05 },
];

const EXIT = { x: 5, y: 1 };
const MAX_SEC = 180;

function gauss(r: Rng, m: number, sd: number): number {
  const u = Math.max(1e-12, r.next()), v = r.next();
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface RunResult {
  outcome: 'escaped' | 'caught' | 'timeout';
  time: number; peak: number; stars: number;
  caughtBy: string | null; caughtCause: OnsetCause | null;
  onsets: Partial<Record<OnsetCause, number>>;
  gainByCause: Partial<Record<OnsetCause, number>>;
  untoldOnsets: number; talks: number; disguises: number;
}

export function runOne(content: FloorContent, seed: string, bot: BotParams): RunResult {
  const sim = new FloorSim(content, seed);
  const ob = new Observer(sim);
  const br = createRng(`bot-${bot.name}-${seed}`);
  const h = sim.rules.fixedStepSec;
  let threatSince = -1, reactAt = Infinity, ignoring = false, clearSince = -1, resumeAt = 0;
  let talks = 0, disguises = 0;
  const gainByCause: Partial<Record<OnsetCause, number>> = {};
  sim.tap(EXIT.x, EXIT.y);
  const maxSteps = Math.round(MAX_SEC / h);
  for (let i = 0; i < maxSteps && sim.outcome === 'playing'; i++) {
    const t = sim.time;
    const threatened = sim.npcs.some((_, k) => { const th = sim.threatOf(k); return th === 'seeing' || th === 'turning'; });
    const mode = sim.player.mode;
    if (bot.disguise) {
      if (threatened) {
        clearSince = -1;
        if (threatSince < 0) {
          threatSince = t;
          ignoring = br.chance(bot.missProb);
          reactAt = t + Math.max(0.1, gauss(br, bot.reactMean, bot.reactSd));
        }
        if (!ignoring && t >= reactAt && mode === 'moving') { sim.tap(EXIT.x, EXIT.y); disguises++; }
      } else {
        threatSince = -1;
        if (clearSince < 0) { clearSince = t; resumeAt = t + Math.max(0.05, gauss(br, bot.resumeMean, bot.resumeSd)); }
      }
      if ((mode === 'idle' || mode === 'disguised') && (!threatened || ignoring) && t >= resumeAt) sim.tap(EXIT.x, EXIT.y);
    } else if (mode === 'idle' || mode === 'disguised') sim.tap(EXIT.x, EXIT.y);

    const before = sim.suspicion.value;
    ob.step();
    const gain = sim.suspicion.value - before;
    if (gain > 0) {
      const c = ob.caughtCause();
      const key = c?.cause ?? 'other';
      gainByCause[key] = (gainByCause[key] ?? 0) + gain;
    }
    for (const e of sim.drainEvents()) if (e.type === 'talk') talks++;
  }
  const onsets: Partial<Record<OnsetCause, number>> = {};
  for (const o of ob.onsets) onsets[o.cause] = (onsets[o.cause] ?? 0) + 1;
  const cc = sim.outcome === 'caught' ? ob.caughtCause() : null;
  const outcome = sim.outcome === 'playing' ? 'timeout' : sim.outcome;
  const peak = sim.suspicion.peak;
  return {
    outcome, time: sim.time, peak,
    stars: outcome === 'escaped' ? (peak < 0.3 ? 3 : 2) : 0,
    caughtBy: cc?.npc ?? null, caughtCause: cc?.cause ?? null,
    onsets, gainByCause,
    untoldOnsets: ob.onsets.filter((o) => UNFAIR_CAUSES.includes(o.cause)).length,
    talks, disguises,
  };
}

export function runBatch(content: FloorContent, bot: BotParams, seeds: number, prefix = 'bal'): RunResult[] {
  const out: RunResult[] = [];
  for (let s = 0; s < seeds; s++) out.push(runOne(content, `${prefix}-${s}`, bot));
  return out;
}

// ── 집계·출력 ──────────────────────────────────────────
const pct = (a: number, b: number) => (b === 0 ? '-' : `${((100 * a) / b).toFixed(1)}%`);
function quant(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');

const CAUSE_LABEL: Record<OnsetCause, string> = {
  tellLook: '전조 후 돌아봄', playerEnter: '플레이어가 콘에 진입', npcAdvance: 'NPC 전진(콘이 다가옴)',
  turnCorner: '모퉁이 전환(전조 없음)', turnResume: '재출발 전환(전조 없음)', turnTalkEnd: '말걸기 종료 복귀(전조 없음)',
  talkStart: '말걸기 시작(전조 없음)', other: '기타',
};

export function report(all: Record<string, RunResult[]>, seeds: number, title = '# T-124 밸런스 시뮬레이션 결과 (탑다운 프로토타입 T-123)'): string {
  const L: string[] = [];
  L.push(title, '');
  L.push(`- 생성: \`bash game/tests/run-balance.sh ${seeds}\` (시뮬레이터: \`game/tests/sim/balance.ts\`)`);
  L.push(`- 레벨: \`src/dev/protoFloor.ts\` proto-floor-1 (개발자 임시 수치, 기획 미확정). 시드 \`bal-0\`~\`bal-${seeds - 1}\` (봇당 ${seeds}판), 판 상한 ${MAX_SEC}초`);
  L.push('- 별점(임시 정의, rules.json stars 준용): 들킴 ★0, 탈출 ★2, 탈출+최고 의심 < 30% ★3. 프로토에는 시계·야근이 없어 ★1 없음');
  L.push('- 기획 목표(GDD §1, D-001 기준 수치를 그대로 대입): 1판 60~90초(튜토리얼 50~75초), 초반 성공률 70~80%, 적발 ≤ 10%, 모든 시선 전 전조 ≥ 0.4초', '');
  L.push('## 1. 결과 요약', '');
  L.push('| 봇 | 성공(탈출) | 들킴 | 시간초과 | ★3 | ★2 | 판 길이 평균 | p10 | p50 | p90 | 최고 의심 평균 | 위장 횟수/판 | 말걸기/판 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of BOTS) {
    const rs = all[b.name]!;
    const n = rs.length, esc = rs.filter((r) => r.outcome === 'escaped');
    const times = rs.map((r) => r.time);
    L.push(`| ${b.label} | ${pct(esc.length, n)} | ${pct(rs.filter((r) => r.outcome === 'caught').length, n)} | ${pct(rs.filter((r) => r.outcome === 'timeout').length, n)} `
      + `| ${pct(rs.filter((r) => r.stars === 3).length, n)} | ${pct(rs.filter((r) => r.stars === 2).length, n)} `
      + `| ${f1(mean(times))}초 | ${f1(quant(times, 0.1))} | ${f1(quant(times, 0.5))} | ${f1(quant(times, 0.9))} `
      + `| ${(100 * mean(rs.map((r) => r.peak))).toFixed(1)}% | ${mean(rs.map((r) => r.disguises)).toFixed(2)} | ${mean(rs.map((r) => r.talks)).toFixed(2)} |`);
  }
  L.push('', '## 2. 최고 의심 분포 (판 비율)', '');
  const buckets: [string, (p: number) => boolean][] = [
    ['0%', (p) => p === 0], ['0~10%', (p) => p > 0 && p < 0.1], ['10~30%', (p) => p >= 0.1 && p < 0.3],
    ['30~60%', (p) => p >= 0.3 && p < 0.6], ['60~99%', (p) => p >= 0.6 && p < 1], ['100%(들킴)', (p) => p >= 1],
  ];
  L.push(`| 봇 | ${buckets.map((x) => x[0]).join(' | ')} |`);
  L.push(`|---|${buckets.map(() => '---').join('|')}|`);
  for (const b of BOTS) {
    const rs = all[b.name]!;
    L.push(`| ${b.label} | ${buckets.map(([, f]) => pct(rs.filter((r) => f(r.peak)).length, rs.length)).join(' | ')} |`);
  }
  L.push('', '## 3. 들킴 원인 (들킨 판 기준, caught 순간 보고 있던 NPC와 그 시선이 시작된 원인)', '');
  const causes = Object.keys(CAUSE_LABEL) as OnsetCause[];
  L.push(`| 봇 | 들킨 판 | ${causes.map((c) => CAUSE_LABEL[c]).join(' | ')} | 억울한 들킴(전조 없음) | NPC별 |`);
  L.push(`|---|---|${causes.map(() => '---').join('|')}|---|---|`);
  for (const b of BOTS) {
    const cs = all[b.name]!.filter((r) => r.outcome === 'caught');
    const byNpc: Record<string, number> = {};
    for (const r of cs) byNpc[r.caughtBy ?? '?'] = (byNpc[r.caughtBy ?? '?'] ?? 0) + 1;
    const unfair = cs.filter((r) => r.caughtCause && UNFAIR_CAUSES.includes(r.caughtCause)).length;
    L.push(`| ${b.label} | ${cs.length} | ${causes.map((c) => String(cs.filter((r) => r.caughtCause === c).length)).join(' | ')} | ${unfair} (${pct(unfair, cs.length)}) `
      + `| ${Object.entries(byNpc).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`);
  }
  L.push('', '## 4. 시선 시작 원인 전체 (모든 판의 시선 시작 이벤트)', '');
  L.push(`| 봇 | 시선 시작 합계 | ${causes.map((c) => CAUSE_LABEL[c]).join(' | ')} |`);
  L.push(`|---|---|${causes.map(() => '---').join('|')}|`);
  for (const b of BOTS) {
    const rs = all[b.name]!;
    const tot = (c: OnsetCause) => rs.reduce((a, r) => a + (r.onsets[c] ?? 0), 0);
    const sum = causes.reduce((a, c) => a + tot(c), 0);
    L.push(`| ${b.label} | ${sum} | ${causes.map((c) => `${tot(c)} (${pct(tot(c), sum)})`).join(' | ')} |`);
  }
  L.push('', '## 5. D-038 근거: 전조 없이 시선에 들어오는 빈도 (모퉁이·재출발 전환 vs 말걸기)', '');
  L.push('| 봇 | 구분 | 시선 시작/판 | 1회 이상 겪은 판 | 분당 빈도 | 전체 의심 상승 중 비중 | 이 원인으로 들킨 판 |');
  L.push('|---|---|---|---|---|---|---|');
  const groups: [string, OnsetCause[]][] = [
    ['모퉁이·재출발 전환(D-038 대상)', ['turnCorner', 'turnResume', 'turnTalkEnd']],
    ['말걸기 시작(즉시 돌아봄)', ['talkStart']],
  ];
  for (const b of BOTS) {
    const rs = all[b.name]!;
    const totalMin = rs.reduce((a, r) => a + r.time, 0) / 60;
    const gainAll = rs.reduce((a, r) => a + Object.values(r.gainByCause).reduce((x, y) => x + (y ?? 0), 0), 0);
    for (const [gname, cs] of groups) {
      const per = (r: RunResult) => cs.reduce((a, c) => a + (r.onsets[c] ?? 0), 0);
      const tot = rs.reduce((a, r) => a + per(r), 0);
      const gain = rs.reduce((a, r) => a + cs.reduce((x, c) => x + (r.gainByCause[c] ?? 0), 0), 0);
      const caught = rs.filter((r) => r.outcome === 'caught' && r.caughtCause && cs.includes(r.caughtCause)).length;
      L.push(`| ${b.label} | ${gname} | ${(tot / rs.length).toFixed(3)} | ${pct(rs.filter((r) => per(r) > 0).length, rs.length)} `
        + `| ${(tot / totalMin).toFixed(2)} | ${pct(gain, gainAll)} | ${caught} |`);
    }
  }
  L.push('', '## 6. 목표 대비', '');
  L.push('| 항목 | 목표 | 직진 | 위장 사용 | 느린 초보 | 판정 |');
  L.push('|---|---|---|---|---|---|');
  const m = (name: string) => all[name]!;
  const sr = (name: string) => m(name).filter((r) => r.outcome === 'escaped').length / m(name).length;
  const cr = (name: string) => m(name).filter((r) => r.outcome === 'caught').length / m(name).length;
  const len = (name: string) => mean(m(name).map((r) => r.time));
  const unf = (name: string) => m(name).reduce((a, r) => a + r.untoldOnsets, 0);
  const inR = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  L.push(`| 1판 길이 평균 | 60~90초 | ${f1(len('straight'))} | ${f1(len('disguise'))} | ${f1(len('novice'))} | ${['straight', 'disguise', 'novice'].every((n) => inR(len(n), 60, 90)) ? '충족' : '미달(너무 짧음)'} |`);
  L.push(`| 성공률(기준 봇=느린 초보를 캐주얼 대용) | 70~80% | ${pct(sr('straight') * 1000, 1000)} | ${pct(sr('disguise') * 1000, 1000)} | ${pct(sr('novice') * 1000, 1000)} | ${inR(sr('novice'), 0.7, 0.8) ? '충족' : '이탈'} |`);
  L.push(`| 적발률 | ≤ 10% | ${pct(cr('straight') * 1000, 1000)} | ${pct(cr('disguise') * 1000, 1000)} | ${pct(cr('novice') * 1000, 1000)} | ${cr('novice') <= 0.1 ? '충족' : '이탈'} |`);
  L.push(`| 위장 없이 이기기 어려움(D-040 취지) | 직진 성공률 ≪ 위장 성공률 | ${pct(sr('straight') * 1000, 1000)} | ${pct(sr('disguise') * 1000, 1000)} | - | ${sr('straight') < sr('disguise') - 0.2 ? '충족' : '미달(위장 필요성 약함)'} |`);
  L.push(`| 전조 없는 시선 | 0건 | ${unf('straight')} | ${unf('disguise')} | ${unf('novice')} | ${['straight', 'disguise', 'novice'].every((n) => unf(n) === 0) ? '충족' : '위반'} |`);
  L.push('');
  return L.join('\n');
}

// CLI
const seeds = Number(process.argv[2] ?? 1000);
const t0 = Date.now();
const all: Record<string, RunResult[]> = {};
for (const b of BOTS) { all[b.name] = runBatch(PROTO_FLOOR, b, seeds); console.log(`${b.name}: ${seeds}판 완료 (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
// 스트레스 변형(QA 가정): 같은 층, 의심 상승률 ×3. 레벨이 어려워졌을 때 전조 없는 시선이 들킴으로 이어지는 비율을 보기 위함
const S = PROTO_FLOOR.rules.suspicion;
const STRESS: FloorContent = {
  level: PROTO_FLOOR.level,
  rules: { ...PROTO_FLOOR.rules, suspicion: { ...S, movingPerSec: S.movingPerSec * 3, idlePerSec: S.idlePerSec * 3, disguisedPerSec: S.disguisedPerSec * 3, talkedPerSec: S.talkedPerSec * 3 } },
};
const stress: Record<string, RunResult[]> = {};
for (const b of BOTS) stress[b.name] = runBatch(STRESS, b, seeds, 'stress');
const md = report(all, seeds)
  + '\n\n---\n\n'
  + report(stress, seeds, '# 부록: 스트레스 변형 (QA 가정 — 의심 상승률 ×3, 레벨·NPC 동일, 시드 stress-*)')
    .replace(/- 레벨:[^\n]*\n/, '- 목적: 실제 밸런스 목표에 가까운 난이도에서 전조 없는 시선(모퉁이 전환·말걸기)이 들킴에 기여하는 정도 추정. 제품 수치 제안이 아님\n');
const fs = await import('node:fs');
const path = await import('node:path');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
fs.writeFileSync(path.join(root, 'qa', 't124-balance.md'), md + '\n');
fs.writeFileSync(path.join(root, 'game', 'tests', '.out', 't124-balance.json'), JSON.stringify({ base: all, stress }));
console.log(md);
