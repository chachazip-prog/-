/// <reference types="node" />
/**
 * T-141 팀장 순회 측정(앉은 봇 = GDD v3 §3-7 '봇 B'). 개발 측정 스크립트(tourmeasure.ts)를 QA 정식 테스트로 옮기고 항목을 넓힘.
 *   bash tests/run-t141.sh tour [시작일=6] [끝일=200] [시드 수=5]
 * 측정: ① 계획 대비 출발(직급 × 일반/대표님 날) ② 대표님 순시 미종료(근무 시계 정지) ③ 실측−추정 자리 비움
 *       ④ 본부장(INT-10) 인사 hold로 인한 출발 지연·skipped ⑤ 직전 목적지 반복(D-118) ⑥ INT-08 흡수 날 점검(D-117)
 * 원자료: tests/.out/t141/tour.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DaySim, type PatrolNpc } from '../../src/core';
import { CAMERA_VIEW } from '../../src/config/display';
import { contentV3, isCeoDay, loadTables } from '../lib/t141content';

const DATA = process.env['QA_DATA_DIR'] ?? 'data';
const T = loadTables(DATA);
const from = Number(process.argv[2] ?? 6), to = Number(process.argv[3] ?? 200), nSeed = Number(process.argv[4] ?? 5);
const H = 1 / 60;

interface TourRow {
  i: number; dest: string; at: number; est: number; fromInt: string | null;
  stand: number | null; seated: number | null; skipped: boolean;
  delay: number | null; greetHoldSec: number; greetAtSkip: boolean;
  doorBusySeen: boolean; stops?: string[]; napLockedTicks: number; napUnlockedAtMeetingTicks: number;
}
interface DayRow {
  day: number; seed: string; rank: string; ceo: boolean; plan: number; dep: number; skip: number; tours: TourRow[];
  endPhase: string; endDayTime: number; ceoStates: string[]; ceoMaxPausedSec: number; ceoStuck: boolean;
  meetingNpcSeen: boolean; dayInt08: boolean; dropped: string[]; repeats: number; cap: number;
}

const rows: DayRow[] = [];
const roam = (T['layout'] as { leadRoaming: { byRank: Record<string, { awayMaxSec?: number }> } }).leadRoaming;
for (let d = from; d <= to; d++) {
  const c = contentV3(T, d);
  const def = c.bossTours?.[0];
  if (!def) continue;
  const napIds = c.missions.filter((m) => m.mechanic === 'nap_tap_toggle').map((m) => m.id);
  for (let s = 0; s < nSeed; s++) {
    const seed = s === 0 ? undefined : `qa141-${s}`;
    const sim = new DaySim(c, { view: CAMERA_VIEW }, seed);
    const tours: TourRow[] = def.atSec.map((at, i) => ({
      i, dest: def.routes[i]!.map((x) => x.id).join('+'), at, est: def.awaySec?.[i] ?? NaN, fromInt: def.fromInterrupt?.[i] ?? null,
      stand: null, seated: null, skipped: false, delay: null, greetHoldSec: 0, greetAtSkip: false, doorBusySeen: false, napLockedTicks: 0, napUnlockedAtMeetingTicks: 0,
    }));
    const ceoStates: string[] = [];
    let paused = 0, maxPaused = 0, meetingNpcSeen = false;
    let next = 0; // 다음 출발 예정 회차
    let cur = -1; // 순회 중 회차
    const any = sim as unknown as { greetState: string; ceoState: string };
    for (let i = 0; i < Math.round(240 / H); i++) {
      if (sim.phase === 'ended') break;
      if (sim.phase === 'leave' && cur < 0) break; // 퇴근 시작 뒤에는 순회 중 회차가 자리에 돌아올 때까지만
      // 출발 대기 중 인사 hold 계측(예정 시각이 지났고 아직 출발·취소 전)
      if (sim.phase === 'day' && next < tours.length && sim.dayTime >= tours[next]!.at && any.greetState !== 'idle') tours[next]!.greetHoldSec += H;
      sim.step();
      for (const e of sim.drainEvents() as { type: string; stage?: string; index?: number }[]) {
        if (e.type === 'ceo' && e.stage) ceoStates.push(e.stage);
        if (e.type === 'tour') {
          const tr = tours[e.index!];
          if (!tr) continue;
          if (e.stage === 'stand') { tr.stand = sim.time; tr.delay = sim.dayTime - tr.at; cur = e.index!; next = e.index! + 1; }
          if (e.stage === 'seated') { tr.seated = sim.time; cur = -1; }
          if (e.stage === 'skipped') { tr.skipped = true; tr.greetAtSkip = any.greetState !== 'idle' || tr.greetHoldSec > 0; next = e.index! + 1; }
        }
      }
      sim.drainFloorEvents();
      if (sim.phase === 'day' && sim.floor.npcs.some((n: PatrolNpc) => n.def.patrolId === 'p_tl_meeting')) meetingNpcSeen = true;
      if (cur >= 0) { const tl = sim.floor.npcs.find((n: PatrolNpc) => n.def.actorId === 'team_lead'); if (tl && tl.mode !== 'walk' && tl.stopId) { const tr = tours[cur]!; (tr as TourRow & { stops?: string[] }).stops ??= []; const st = (tr as TourRow & { stops: string[] }).stops; if (st[st.length - 1] !== tl.stopId) st.push(tl.stopId); } }
      if (cur >= 0) {
        const tr = tours[cur]!;
        if (sim.meetingDoorBusy()) tr.doorBusySeen = true;
        if (tr.fromInt === 'INT-08' && sim.meetingDoorBusy()) {
          for (const id of napIds) {
            const m = sim.missions.find((x) => x.def.id === id);
            if (!m || m.state === 'locked' || m.state === 'done' || m.state === 'failed' || m.state === 'active') continue;
            if (m.blocked) tr.napLockedTicks++; else tr.napUnlockedAtMeetingTicks++;
          }
        }
      }
      if (sim.clockPaused && sim.phase === 'day') { paused += H; maxPaused = Math.max(maxPaused, paused); } else paused = 0;
      if (sim.qteActive) { if (sim.qte!.phase === 'window') sim.tapQte(0.1); continue; }
      if (sim.offer) (sim as unknown as { declineOffer?: () => void }).declineOffer?.();
    }
    const ceo = isCeoDay(c);
    const reps = def.routes.reduce((k, r, i) => k + (i > 0 && r[0]?.id === def.routes[i - 1]![0]?.id ? 1 : 0), 0);
    rows.push({
      day: d, seed: seed ?? 'default', rank: c.rankId, ceo, plan: def.atSec.length, dep: tours.filter((t) => t.stand !== null).length, skip: tours.filter((t) => t.skipped).length, tours,
      endPhase: sim.phase, endDayTime: sim.dayTime, ceoStates, ceoMaxPausedSec: maxPaused,
      ceoStuck: ceo && (sim.phase === 'day' || (ceoStates.includes('tell') && !ceoStates.includes('done') && !ceoStates.includes('cancelled'))),
      meetingNpcSeen, dayInt08: c.interrupts.some((x) => x.id === 'INT-08' && x.phase === 'day'), dropped: [...(def.droppedInterrupts ?? [])],
      repeats: reps, cap: roam.byRank[c.rankId]?.awayMaxSec ?? 22,
    });
  }
}
mkdirSync('tests/.out/t141', { recursive: true });
writeFileSync('tests/.out/t141/tour.json', JSON.stringify(rows));

// ── 요약 ──
const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const groups = new Map<string, DayRow[]>();
for (const r of rows) { const k = `${r.rank}${r.ceo ? '/대표님' : ''}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
console.log(`앉은 봇 ${from}~${to}일 × 시드 ${nSeed}, 일-시드 ${rows.length}`);
for (const [k, rs] of groups) {
  const plan = rs.reduce((a, r) => a + r.plan, 0), dep = rs.reduce((a, r) => a + r.dep, 0), skip = rs.reduce((a, r) => a + r.skip, 0);
  const diffs = rs.flatMap((r) => r.tours.filter((t) => t.stand !== null && t.seated !== null && !t.fromInt).map((t) => t.seated! - t.stand! - t.est));
  console.log(`${k.padEnd(30)} 일 ${rs.length / nSeed} 계획 ${(plan / rs.length).toFixed(2)} 출발 ${(dep / rs.length).toFixed(2)} 비율 ${(100 * dep / plan).toFixed(1)}% skipped ${skip} 실측-추정 ${avg(diffs).toFixed(2)}초 (>+2초 ${diffs.filter((x) => x > 2).length}/${diffs.length})`);
}
const stuck = rows.filter((r) => r.ceoStuck || r.endPhase === 'day');
console.log(`대표님 순시 미종료/근무 시계 정지: ${stuck.length}건 ${stuck.slice(0, 5).map((r) => `${r.day}/${r.seed}:${r.ceoStates.join('>')}`).join(' ')}`);
console.log(`최장 연속 시계 정지(대표님 날): ${Math.max(...rows.filter((r) => r.ceo).map((r) => r.ceoMaxPausedSec)).toFixed(1)}초`);
for (const d of [14, 44, 56, 101, 155]) {
  const rs = rows.filter((r) => r.day === d);
  if (!rs.length) continue;
  console.log(`${d}일차 ${rs[0]!.rank}${rs[0]!.ceo ? '/대표님' : ''} 계획 ${rs[0]!.plan} 출발 ${rs.map((r) => r.dep).join(',')} skipped ${rs.map((r) => r.skip).join(',')} 목적지 ${rs[0]!.tours.map((t) => `${t.dest}@${t.at}${t.fromInt ? '[INT-08]' : ''}`).join(' ')} dropped=${rs[0]!.dropped.join(',')}`);
}
const tAll = rows.flatMap((r) => r.tours.map((t) => ({ ...t, r })));
const gh = tAll.filter((t) => t.greetHoldSec > 0);
console.log(`인사 hold 겹친 회차 ${gh.length}/${tAll.length} · 평균 hold ${avg(gh.map((t) => t.greetHoldSec)).toFixed(2)}초 · 최대 ${Math.max(0, ...gh.map((t) => t.greetHoldSec)).toFixed(2)}초 · 그중 skipped ${gh.filter((t) => t.skipped).length}`);
const rep = new Map<string, [number, number]>();
for (const r of rows.filter((x) => x.seed === 'default')) { const v = rep.get(r.rank) ?? [0, 0]; v[0]++; if (r.repeats > 0) v[1]++; rep.set(r.rank, v); }
console.log(`직전 목적지 반복 일수: ${[...rep].map(([k, v]) => `${k} ${v[1]}/${v[0]}`).join(' · ')}`);
const i08 = tAll.filter((t) => t.fromInt === 'INT-08' && t.r.seed === 'default');
console.log(`INT-08 흡수 회차 중 회의실 도착(stop_tour_meeting) ${i08.filter((t) => (t.stops ?? []).includes('stop_tour_meeting')).length}`);
console.log(`INT-08 흡수 회차 ${i08.length} (출발 ${i08.filter((t) => t.stand !== null).length}) · 문 '사용 중' ${i08.filter((t) => t.doorBusySeen).length} · 낮잠 열린 채 회의 틱 ${i08.reduce((a, t) => a + t.napUnlockedAtMeetingTicks, 0)} · 잠김 틱 ${i08.reduce((a, t) => a + t.napLockedTicks, 0)} · p_tl_meeting 등장 날 ${rows.filter((r) => r.meetingNpcSeen).length} · 근무 INT-08 남은 날(흡수 날 중) ${rows.filter((r) => r.dayInt08 && r.tours.some((t) => t.fromInt)).length}`);
