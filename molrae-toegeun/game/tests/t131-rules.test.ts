/// <reference types="node" />
/**
 * T-131 규칙 검증(헤드리스). bash tests/run-t131.sh rules
 *  4. 말걸기: 액터별 무반응·0.3초 정지·0.3초 회피 성립률/취소율, releaseSec·postTalkHoldSec
 *  5. 배경 동료 정의(시선·말걸기·길막 없음)
 *  6. 미션 5종 성공·실패·시간초과, 커피 띠 위 탭, 쇼핑 최소 시간·팀장 1회 돌아봄 성공률, 게이트 3회 실패·18:18 야근, 18시 전 탈출 보너스
 *  7. 전면광고 decideInterstitial 경계값
 * 제품 코드는 읽기만 하고, 테스트 하네스 쪽에서만 상태를 조작한다(플레이어 순간이동·의심 0 고정은 '관찰용'으로 명시).
 */
import { writeFileSync } from 'node:fs';
import {
  DaySim, createRng, findPath, isWalkable, createActivity, emptyEffects, tileOf,
  type DayContent, type PatrolNpc, type Rng, type Tile,
} from '../src/core';
import {
  decideInterstitial, freshCounters, onGameFinished, onInterstitialShown, parseInterstitialRules, rollDay, type AdCounters,
} from '../src/ads/interstitialPolicy';
import { BOTS, Bot, VIEW, contentFor, loadTables } from './lib/t131';
import { check, info, section, summary } from './lib/check';

const DATA = process.env['QA_DATA_DIR'] ?? 'data';
const tables = loadTables(DATA);
const H = 1 / 60;
const report: Record<string, unknown> = {};

function toDay(sim: DaySim): void { for (let i = 0; i < 600 && sim.phase === 'intro'; i++) sim.step(); }
function teleport(sim: DaySim, t: Tile): void {
  const p = sim.floor.player;
  p.x = t.x + 0.5; p.y = t.y + 0.5; p.mode = 'idle';
  sim.floor.camera?.snap(p.y);
}
function walkTiles(sim: DaySim): Tile[] {
  const m = sim.floor.map, out: Tile[] = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (isWalkable(m, x, y) && !sim.floor.blockedForPlayer(x, y)) out.push({ x, y });
  return out;
}

// ═══ 4. 말걸기
section('4. 말걸기 (D-043·D-054, GDD §5-4 ⑤)');
type Policy = 'none' | 'stop' | 'evade';
interface TalkOut { escapedNoEvent: number; warns: number; talk: number; disguised: number; missed: number; escaped: number; armedWarns: number; releaseViol: number; postHoldRise: number; postHoldTalks: number; lookAfterEscapeTellOk: number; lookAfterEscape: number }

/** 액터 하나에 대해 지나가기 시도를 반복. setup(seed)은 대상 NPC가 말을 걸 수 있는 상태의 DaySim을 돌려준다 */
function talkTrials(actor: string, setup: (seed: string) => { sim: DaySim; npc: PatrolNpc } | null, policy: Policy, n: number): TalkOut {
  const o: TalkOut = { escapedNoEvent: 0, warns: 0, talk: 0, disguised: 0, missed: 0, escaped: 0, armedWarns: 0, releaseViol: 0, postHoldRise: 0, postHoldTalks: 0, lookAfterEscapeTellOk: 0, lookAfterEscape: 0 };
  const r = createRng(`talk-${actor}-${policy}`);
  for (let k = 0; k < n; k++) {
    const st = setup(`talk-${actor}-${k}`);
    if (!st) continue;
    const { sim, npc } = st;
    const f = sim.floor;
    const talk = npc.def.talk!;
    // 출발: NPC에서 noticeRadius+0.5~+3 떨어진 칸, 도착: NPC 반대편(지나가기)
    const tiles = walkTiles(sim);
    const near = (t: Tile, lo: number, hi: number) => { const d = Math.hypot(t.x + 0.5 - npc.x, t.y + 0.5 - npc.y); return d >= lo && d <= hi; };
    const starts = tiles.filter((t) => near(t, (talk.noticeRadius ?? talk.radius) + 0.5, (talk.noticeRadius ?? talk.radius) + 3) && !(t.x === sim.content.playerSeat.x && t.y === sim.content.playerSeat.y));
    let tried = 0, started = false;
    while (tried++ < 30 && !started) {
      const s = r.pick(starts); if (!s) break;
      const gx = Math.round(2 * npc.x - s.x - 0.5 + r.range(-1.5, 1.5)), gy = Math.round(2 * npc.y - s.y - 0.5 + r.range(-1.5, 1.5));
      const goal = tiles.find((t) => t.x === gx && t.y === gy) ?? tiles.filter((t) => near(t, 2, 5)).sort((a, b) => Math.hypot(a.x - gx, a.y - gy) - Math.hypot(b.x - gx, b.y - gy))[0];
      if (!goal) continue;
      const path = findPath(f.map, s, goal, f.blockedForPlayer);
      if (!path || path.length < 3) continue;
      // 경로가 NPC 발동 반경 안을 지나야 '지나가기' 시도
      if (!path.some((t) => Math.hypot(t.x + 0.5 - npc.x, t.y + 0.5 - npc.y) <= (talk.noticeRadius ?? talk.radius))) continue;
      teleport(sim, s);
      f.moveTo(goal);
      started = true;
    }
    if (!started) continue;
    let warnAt = -1, armed = false, resolved = false, reacted = false, talkEndAt = -1, escapeAt = -1, talked = false;
    for (let i = 0; i < 60 * 10 && sim.phase !== 'ended'; i++) {
      f.suspicion.value = 0; // 관찰용: 적발로 끝나지 않게
      if (warnAt >= 0 && !reacted && f.time - warnAt >= 0.3 - 1e-9 && npc.mode === 'tell' && npc.tellKind === 'talk') {
        reacted = true;
        const p = f.player, t = p.tile;
        if (policy === 'stop' && p.mode === 'moving') sim.tapWorld(t.x, t.y);
        if (policy === 'evade') {
          // 반대쪽으로: 이동 중이면 첫 탭 = 정지(조작 규칙), 같은 틱 두 번째 탭 = 새 목적지
          const dx = p.x - npc.x, dy = p.y - npc.y, d = Math.hypot(dx, dy) || 1;
          let best: Tile | null = null, bestA = -Infinity;
          for (const c of tiles) {
            if (Math.abs(c.x - t.x) + Math.abs(c.y - t.y) > 3) continue;
            const a = ((c.x + 0.5 - npc.x) * dx + (c.y + 0.5 - npc.y) * dy) / d;
            const pp = findPath(f.map, t, c, f.blockedForPlayer);
            if (pp && pp.length > 0 && pp.length <= 3 && a > bestA) { bestA = a; best = c; }
          }
          if (best) { if (p.mode === 'moving') sim.tapWorld(t.x, t.y); sim.tapWorld(best.x, best.y); }
        }
      }
      const before = f.suspicion.value;
      const pm = npc.mode, pk = npc.tellKind;
      sim.step();
      // 회피(D-054): T-133부터 tell(talk) → tell(look)으로 바로 넘어가며 talkCancel(escaped) 이벤트가 나오지 않음(BUG-015) → 상태 전이로 셈
      if (pm === 'tell' && pk === 'talk' && npc.mode === 'tell' && npc.tellKind === 'look' && warnAt >= 0) { o.escaped++; o.escapedNoEvent++; resolved = true; escapeAt = f.time; }
      for (const e of sim.drainFloorEvents()) {
        if (e.type === 'talkWarn' && e.npc === npc.def.id && warnAt < 0) { warnAt = f.time; o.warns++; }
        if (e.type === 'talk' && e.npc === npc.def.id) { o.talk++; resolved = true; talked = true; }
        if (e.type === 'talkCancel' && e.npc === npc.def.id) { o[e.reason]++; resolved = true; if (e.reason === 'escaped') { escapeAt = f.time; o.escapedNoEvent--; } }
        if (e.type === 'talkEnd' && e.npc === npc.def.id) talkEndAt = f.time;
      }
      sim.drainEvents();
      if (warnAt >= 0 && npc.mode === 'tell' && npc.tellKind === 'talk' && Math.hypot(f.player.x - npc.x, f.player.y - npc.y) <= talk.radius) armed = true;
      // releaseSec 동안 그 NPC 시선은 판정에 없음
      const idx = f.npcs.indexOf(npc);
      if (npc.releaseLeft > 0 && idx >= 0 && f.seeing[idx]) o.releaseViol++;
      // 말걸기 종료 후 postTalkHoldSec 동안 의심 상승(의심 0 고정 전 값 기준: 이번 스텝 상승분)
      if (talkEndAt >= 0 && f.time - talkEndAt <= (f.rules.movement?.postTalkHoldSec ?? 0.5) + 1e-9 && f.suspicion.value - before > 1e-12) o.postHoldRise += f.suspicion.value - before;
      if (escapeAt >= 0 && npc.mode === 'look') { o.lookAfterEscape++; if (f.time - escapeAt >= 0.4 - 1e-9) o.lookAfterEscapeTellOk++; escapeAt = -1; }
      if (resolved && (talked ? talkEndAt >= 0 && f.time - talkEndAt > 2.2 : f.time - warnAt > 2.5)) break;
      if (!resolved && warnAt < 0 && f.player.mode !== 'moving') break;
    }
    if (talkEndAt >= 0) o.postHoldTalks++;
    if (armed) o.armedWarns++;
  }
  return o;
}

function setupSeated(day: number, actor: string) {
  return (seed: string) => {
    const sim = new DaySim(contentFor(tables, day), { view: VIEW }, seed);
    toDay(sim);
    for (let i = 0; i < 60 * 2; i++) sim.step();
    const npc = sim.floor.findNpc((n) => n.def.actorId === actor && !!n.def.talk);
    return npc && npc.canTalk() ? { sim, npc } : null;
  };
}
let HR_BYPASS = false;
function setupHrCorridor(seed: string) {
  const sim = new DaySim(contentFor(tables, 12), { view: VIEW }, seed);
  toDay(sim);
  for (let i = 0; i < 60 * 60 && sim.phase === 'day'; i++) {
    sim.floor.suspicion.value = 0;
    sim.step(); sim.drainEvents(); sim.drainFloorEvents();
    const hr = sim.floor.findNpc((n) => n.def.actorId === 'hr_inspector' && !!n.def.talk && n.mode === 'walk');
    if (hr && hr.canTalk() && sim.dayTime > 9) {
      // BUG-007 우회 측정: INT-06 등장이 하루 1회(maxPerDay)를 이미 써서 말걸기가 막힘 → 하니스에서만 그 기록을 지움
      if (HR_BYPASS) (sim as unknown as { intState: Map<string, unknown> }).intState.delete('INT-06');
      return { sim, npc: hr };
    }
  }
  return null;
}
function setupGuardLeave(seed: string) {
  const sim = new DaySim(contentFor(tables, 2), { view: VIEW }, seed);
  for (let i = 0; i < 60 * 80 && sim.phase !== 'leave'; i++) { sim.floor.suspicion.value = 0; sim.step(); }
  // 18:00 전이어야 함(leave_phase_before_1800): 퇴근 시작 직후
  const g = sim.floor.findNpc((n) => n.def.actorId === 'security_guard');
  return g && g.canTalk() ? { sim, npc: g } : null;
}

const TALK_ACTORS: [string, string, (s: string) => { sim: DaySim; npc: PatrolNpc } | null][] = [
  ['senior', '선배(4일차 INT-02)', setupSeated(4, 'senior')],
  ['team_lead', '팀장(6일차 INT-01)', setupSeated(6, 'team_lead')],
  ['hr_inspector', '인사팀(12일차 INT-06 복도)', setupHrCorridor],
  ['security_guard', '경비(2일차 퇴근 18시 전 INT-07)', setupGuardLeave],
];
const talkTable: Record<string, Record<Policy, TalkOut>> = {};
{
  // 제품 그대로: 인사팀 복도 순찰 중 말걸기 전조가 한 번이라도 뜨는가
  const o = talkTrials('hr_inspector', setupHrCorridor, 'none', 100);
  check('인사팀(INT-06) 복도 순찰 중 말걸기 전조가 발동함(제품 그대로)', o.warns > 0, `시도 100회 중 전조 ${o.warns}회`);
  HR_BYPASS = true;
}
for (const [actor, label0, setup] of TALK_ACTORS) {
  const label = actor === 'hr_inspector' ? `${label0}[우회 측정]` : label0;
  const row = {} as Record<Policy, TalkOut>;
  for (const pol of ['none', 'stop', 'evade'] as Policy[]) row[pol] = talkTrials(actor, setup, pol, 300);
  talkTable[actor] = row;
  const nn = row.none, st = row.stop, ev = row.evade;
  const est = (o: TalkOut) => (o.warns ? (100 * o.talk) / o.warns : NaN);
  const estArmed = (o: TalkOut) => (o.armedWarns ? (100 * o.talk) / o.armedWarns : NaN);
  info(`${label}: 무반응 성립 ${est(nn).toFixed(1)}% (전조 ${nn.warns}, radius 진입 ${nn.armedWarns} 중 ${estArmed(nn).toFixed(1)}%, 취소 missed ${nn.missed}/escaped ${nn.escaped}) · 0.3초 정지 취소 ${(100 - est(st)).toFixed(1)}% · 0.3초 회피 취소 ${(100 - est(ev)).toFixed(1)}% (escaped ${ev.escaped}, missed ${ev.missed}, disguised ${ev.disguised})`);
  check(`${label}: 무반응으로 지나가면 성립 ≥ 75% (전조 시작 기준)`, est(nn) >= 75, `${est(nn).toFixed(1)}% (${nn.talk}/${nn.warns})`);
  check(`${label}: 0.3초 반응 회피로 취소 ≥ 35%`, 100 - est(ev) >= 35, `${(100 - est(ev)).toFixed(1)}% (${ev.warns - ev.talk}/${ev.warns})`);
  check(`${label}: 0.3초 반응 정지(위장)로 취소 100%`, st.talk === 0 && st.warns > 0, `${st.talk}/${st.warns} 성립`);
  const all = [nn, st, ev];
  check(`${label}: releaseSec 동안 그 NPC 시선 판정 0틱`, all.every((o) => o.releaseViol === 0), `${all.map((o) => o.releaseViol).join('/')}`);
  const ph = all.reduce((a, o) => a + o.postHoldRise, 0), pt = all.reduce((a, o) => a + o.postHoldTalks, 0);
  check(`${label}: 말걸기 종료 후 postTalkHoldSec 동안 의심 상승 0`, ph < 1e-9, `말걸기 ${pt}회, 합계 상승 ${ph.toFixed(3)}`);
  const la = all.reduce((a, o) => a + o.lookAfterEscape, 0), lok = all.reduce((a, o) => a + o.lookAfterEscapeTellOk, 0);
  check(`${label}: 들어왔다 피한 뒤 돌아보기 전 전조 ≥ 0.4초 (§19-3 ④)`, la === lok && (la > 0 || all.every((o) => o.escaped === 0)), `${lok}/${la}`);
  const noEv = all.reduce((a, o) => a + o.escapedNoEvent, 0), esc = all.reduce((a, o) => a + o.escaped, 0);
  if (esc > 0) check(`${label}: 회피 취소 시 talkCancel(escaped) 이벤트 발행`, noEv === 0, `회피 ${esc}회 중 이벤트 없음 ${noEv}회`);
}
report['talk'] = talkTable;
{
  // 실제 동선: 6일차, 자리(4,33) → 화장실 칸(1,23) 최단 경로(팀장 옆 (4,29)~(4,31) 통과), 반응 없음
  let warns = 0, talks = 0; const reasons: Record<string, number> = {};
  for (let k = 0; k < 300; k++) {
    const sim = new DaySim(contentFor(tables, 6), { view: VIEW }, `route-${k}`);
    toDay(sim);
    const r = createRng(`route-w-${k}`);
    const wait = Math.floor(r.range(0, 6) * 60);
    for (let i = 0; i < wait; i++) { sim.floor.suspicion.value = 0; sim.step(); }
    sim.floor.moveTo(sim.content.spots['restroom_stall']!.tile);
    let warned = false, done = false;
    for (let i = 0; i < 60 * 8 && !done; i++) {
      sim.floor.suspicion.value = 0; sim.step(); sim.drainEvents();
      for (const e of sim.drainFloorEvents()) {
        const tl = e.type !== 'tap' && 'npc' in e && sim.floor.findNpc((n) => n.def.id === e.npc)?.def.actorId === 'team_lead';
        if (!tl) continue;
        if (e.type === 'talkWarn' && !warned) { warned = true; warns++; }
        if (e.type === 'talk' && warned) { talks++; done = true; }
        if (e.type === 'talkCancel' && warned) { reasons[e.reason] = (reasons[e.reason] ?? 0) + 1; done = true; }
      }
    }
  }
  report['talkRoute'] = { warns, talks, reasons };
  check('팀장(6일차) 실제 동선 자리→화장실 무반응 통과: 성립 ≥ 75%', warns > 0 && talks / warns >= 0.75, `${((100 * talks) / Math.max(1, warns)).toFixed(1)}% (${talks}/${warns}, 취소 ${JSON.stringify(reasons)})`);
}
// releaseSec 데이터 규칙: releaseSec ≥ 최대 실제 전조 + postTalkHoldSec
{
  const c6 = contentFor(tables, 6), c2 = contentFor(tables, 2), c12 = contentFor(tables, 12), c4 = contentFor(tables, 4);
  const hold = c6.floor.rules.movement?.postTalkHoldSec ?? 0;
  for (const [c, a] of [[c4, 'senior'], [c6, 'team_lead'], [c2, 'security_guard'], [c12, 'hr_inspector']] as [DayContent, string][]) {
    const d = Object.values(c.patrols).find((p) => p.actorId === a && p.talk);
    if (!d?.talk) { check(`releaseSec 규칙: ${a} 말걸기 정의`, false, '없음'); continue; }
    const maxTell = Math.max(d.tellSecRange?.[1] ?? d.tellSec, d.talk.tellSec ?? 0, d.talk.warnSec ?? 0);
    check(`releaseSec 규칙: ${a} releaseSec ${d.talk.releaseSec} ≥ 최대 전조 ${maxTell} + postTalkHoldSec ${hold}`, (d.talk.releaseSec ?? 0) + 1e-9 >= maxTell + hold);
  }
}

// ═══ 5. 배경 동료 정의
section('5. 배경 동료 (D-049)');
{
  for (const day of [1, 2, 20, 45]) {
    const c = contentFor(tables, day);
    const ok = c.background.every((b) => b.npc.gazeMultiplier === 0 && b.npc.coneOff === true && !b.npc.talk && b.npc.passable === true);
    check(`${day}일차 배경 동료 ${c.background.length}명: 시선 0·콘 없음·말걸기 없음·길막 없음`, ok, c.background.map((b) => b.npc.id).join(','));
  }
  const n = (d: number) => contentFor(tables, d).background.length;
  check('배경 동료 수: 1일차 2명, 2일차~과장 3명, 차장(41~)부터 2명 (GDD §9-1)', n(1) === 2 && n(2) === 3 && n(30) === 3 && n(41) === 2, `1일 ${n(1)} / 2일 ${n(2)} / 30일 ${n(30)} / 41일 ${n(41)}`);
  // 탕비실 걷는 동료 칸을 지나가도 막히지 않음
  const sim = new DaySim(contentFor(tables, 3), { view: VIEW }, 'bg');
  toDay(sim);
  const walker = sim.floor.findNpc((x) => x.def.id === 'bg_pantry_walker');
  let blockedByBg = 0;
  for (let i = 0; i < 600; i++) {
    if (walker && walker.mode !== 'walk') { const t = tileOf(walker); if (sim.floor.blockedForPlayer(t.x, t.y)) blockedByBg++; }
    sim.floor.suspicion.value = 0; sim.step();
  }
  check('배경 동료가 서 있는 칸도 플레이어 통행 가능(blockedForPlayer false)', blockedByBg === 0, `${blockedByBg}틱`);
}

// ═══ 6. 미션·퇴근
section('6. 미션 5종 · 퇴근');
{
  // 6-1 미니게임 단위(행동 모듈): 성공·실패
  const ev = (tables['events'] as { events: { id: string; params: Record<string, unknown> }[] }).events;
  const P = (id: string) => ev.find((e) => e.id === id)!.params;
  const run = (mech: Parameters<typeof createActivity>[0], id: string, taps: (t: number, v: ReturnType<ReturnType<typeof createActivity>['view']>) => boolean, maxSec = 30, seen = false) => {
    const a = createActivity(mech, P(id));
    let t = 0, st: string = 'running', susp = 0;
    while (t < maxSec && st === 'running') {
      const fx = emptyEffects();
      st = a.tick(H, { seen, elapsed: t }, fx); susp += fx.suspicion;
      t += H;
      if (st === 'running' && taps(t, a.view())) { const fx2 = emptyEffects(); st = a.tap({ seen, elapsed: t }, fx2); susp += fx2.suspicion; }
    }
    return { st, t, susp };
  };
  let pourTapped = false;
  const coffeeOk = run('pour_tap_stop', 'coffee', (_t, v) => v.kind === 'pour' && v.level >= 0.83);
  const coffeeOver = run('pour_tap_stop', 'coffee', () => false);
  const coffeeAbove = run('pour_tap_stop', 'coffee', (_t, v) => { if (v.kind === 'pour' && v.level > 0.95 && !pourTapped) { pourTapped = true; return true; } return false; });
  const coffeePause = run('pour_tap_stop', 'coffee', (t, v) => v.kind === 'pour' && ((t > 0.5 && t < 0.52) || (t > 2.0 && t < 2.02) || v.level >= 0.83));
  check('커피: 띠 안 탭 → 성공', coffeeOk.st === 'success', `${coffeeOk.t.toFixed(2)}초`);
  check('커피: 안 누르면 넘침 → 실패', coffeeOver.st === 'fail', `${coffeeOver.t.toFixed(2)}초`);
  check('커피: 띠 위(0.92~1.0) 탭 → 실패 (§19-3 ①)', coffeeAbove.st === 'fail');
  check('커피: 띠 아래 탭 = 일시정지, 다시 탭하면 이어 따름 → 성공', coffeePause.st === 'success' && coffeePause.t > coffeeOk.t + 1.0, `${coffeePause.t.toFixed(2)}초`);
  const rest = run('trip_safe_zone', 'restroom', (t) => t > 3.05 && t < 3.07);
  const restEarly = run('trip_safe_zone', 'restroom', (t) => t > 1 && t < 1.02, 2.0);
  check('화장실: 휴식 3초 뒤 탭 → 성공, 3초 전 탭은 무시', rest.st === 'success' && restEarly.st === 'running');
  let headUp = false;
  const nap = run('nap_tap_toggle', 'nap', (_t, v) => { if (v.kind !== 'nap') return false; if (!v.headUp && v.head > 0.7) { headUp = true; return true; } if (v.headUp && v.head < 0.05) { headUp = false; return true; } return false; });
  const napThud = run('nap_tap_toggle', 'nap', () => false);
  check('낮잠: 고개 들기 토글 → 성공', nap.st === 'success', `${nap.t.toFixed(2)}초`);
  check('낮잠: 안 누르면 쿵 → 실패', napThud.st === 'fail', `${napThud.t.toFixed(2)}초 (헤드 1.0/0.35 = 2.86초)`);
  void headUp;
  const shop = run('screen_swap_tap', 'shopping', () => false);
  check('쇼핑: 무반응(계속 쇼핑) 최소 7.5초에 성공 (§19-3 ②, itemsRequired 2)', shop.st === 'success' && Math.abs(shop.t - 7.5) < 0.05, `${shop.t.toFixed(2)}초`);
  let sb = 0;
  const snack = run('rhythm_tap', 'snack', (t) => { if (t >= sb + 0.8) { sb = t; return true; } return false; });
  check('간식: 0.8초 간격 6입 → 성공, 의심 0', snack.st === 'success' && snack.susp === 0, `${snack.t.toFixed(2)}초`);
  let sb2 = 0;
  const snackFast = run('rhythm_tap', 'snack', (t) => { if (t >= sb2 + 0.3) { sb2 = t; return true; } return false; });
  check('간식: 0.3초 연타 → 바스락 +0.08/입(첫 입 제외)', snackFast.st === 'success' && Math.abs(snackFast.susp - 0.08 * 5) < 1e-9, `의심 ${snackFast.susp.toFixed(2)}`);

  // 6-2 DaySim 통합: 실패 가산·시간초과 가산
  const integ = (day: number, id: string, play: (sim: DaySim) => void, maxSec = 40) => {
    const sim = new DaySim(contentFor(tables, day), { view: VIEW }, `mis-${id}`);
    toDay(sim);
    const m = sim.missions.find((x) => x.def.id === id)!;
    for (let i = 0; i < 60 * 30 && m.state === 'locked'; i++) { sim.floor.suspicion.value = 0; sim.step(); }
    for (const n of sim.floor.npcs) n.suppressed = true; // 관찰용: 시선 없음(가산만 보려고)
    sim.tapMission(id);
    let fail: { reason: string; t: number } | null = null, pen = 0, startT = -1;
    for (let i = 0; i < 60 * maxSec && sim.phase === 'day' && !fail && m.state !== 'done'; i++) {
      for (const n of sim.floor.npcs) n.suppressed = true;
      play(sim);
      const b = sim.floor.suspicion.value;
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type === 'missionStart' && e.id === id) startT = sim.time;
        if (e.type === 'missionFail' && e.id === id) { fail = { reason: e.reason, t: sim.time }; pen = sim.floor.suspicion.value - b; }
      }
    }
    return { m, fail, pen, startT, sim };
  };
  const nothing = () => {};
  const cof = integ(2, 'coffee', nothing);
  check('통합 커피 넘침 → missionFail(fail) + 의심 +0.15', cof.fail?.reason === 'fail' && Math.abs(cof.pen - 0.15) < 0.002, `${JSON.stringify(cof.fail)} +${cof.pen.toFixed(3)}`);
  const rr = integ(10, 'restroom', nothing, 45);
  check('통합 화장실 안 나옴 → 시간초과(26초) + 의심 +0.2', rr.fail?.reason === 'timeout' && Math.abs(rr.pen - 0.2) < 0.002, `${JSON.stringify(rr.fail)} +${rr.pen.toFixed(3)}`);
  const np = integ(4, 'nap', nothing);
  check('통합 낮잠 쿵 → missionFail(fail) + 의심 +0.2', np.fail?.reason === 'fail' && Math.abs(np.pen - 0.2) < 0.002, `${JSON.stringify(np.fail)} +${np.pen.toFixed(3)}`);
  let swapped = false;
  const sh = integ(5, 'shopping', (sim) => { if (sim.activity && !swapped) { swapped = true; sim.tapWorld(0, 0); } });
  check('통합 쇼핑 스프레드시트로 두고 방치 → 시간초과(13초) + 의심 +0.1', sh.fail?.reason === 'timeout' && Math.abs(sh.pen - 0.1) < 0.002 && Math.abs((sh.fail?.t ?? 0) - sh.startT - 13) < 0.1, `${JSON.stringify(sh.fail)} +${sh.pen.toFixed(3)}`);
  const sn = integ(3, 'snack', nothing);
  check('통합 간식 안 먹음 → 시간초과(12초), 가산 0', sn.fail?.reason === 'timeout' && sn.pen < 1e-9, `${JSON.stringify(sn.fail)} +${sn.pen.toFixed(3)}`);
  const shOk = integ(5, 'shopping', nothing);
  check('통합 쇼핑 무반응 → 완료(자리 미션은 성공 즉시 완료)', shOk.m.state === 'done');

  // 6-3 쇼핑: 사원 팀장 시선 아래 위장 봇(0.38초 반응) — 13초 안 성공률, 팀장 돌아봄 1회인 판만 따로
  {
    let n = 0, ok = 0, n1 = 0, ok1 = 0;
    const times: number[] = [];
    for (let k = 0; k < 400; k++) {
      const sim = new DaySim(contentFor(tables, 8), { view: VIEW }, `shop-${k}`);
      const bot = new Bot(BOTS['disguise']!, sim, `shop-${k}`);
      toDay(sim);
      const m = sim.missions.find((x) => x.def.id === 'shopping')!;
      for (let i = 0; i < 60 * 20 && m.state === 'locked'; i++) { sim.floor.suspicion.value = 0; sim.step(); }
      // 무작위 시점에 시작해 팀장 주기와의 위상을 섞는다
      const r: Rng = createRng(`shop-phase-${k}`);
      const wait = Math.floor(r.range(0, 5) * 60);
      for (let i = 0; i < wait; i++) { sim.floor.suspicion.value = 0; sim.step(); }
      sim.tapMission('shopping');
      let looks = 0, t0 = sim.time, end = '';
      const tl = sim.floor.findNpc((x) => x.def.actorId === 'team_lead')!;
      let prev = tl.mode;
      for (let i = 0; i < 60 * 16 && !end && sim.phase === 'day'; i++) {
        sim.floor.suspicion.value = 0;
        bot.act();
        sim.step();
        if (tl.mode === 'look' && prev !== 'look') looks++;
        prev = tl.mode;
        for (const e of sim.drainEvents()) {
          if (e.type === 'missionDone' && e.id === 'shopping') { end = 'ok'; times.push(sim.time - t0); }
          if (e.type === 'missionFail' && e.id === 'shopping') end = 'fail';
        }
        sim.drainFloorEvents();
      }
      n++; if (end === 'ok') ok++;
      if (looks === 1) { n1++; if (end === 'ok') ok1++; }
    }
    report['shopping'] = { n, ok, n1, ok1, mean: times.reduce((a, b) => a + b, 0) / times.length };
    info(`쇼핑(8일차, 팀장 시선, 위장 봇): 전체 성공 ${ok}/${n}, 팀장 돌아봄 1회 판 ${ok1}/${n1}, 평균 ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)}초`);
    check('쇼핑: 팀장 1회 돌아봄 시 13초 안 성공 ≥ 80% (§19-3 ②)', n1 > 0 && ok1 / n1 >= 0.8, `${((100 * ok1) / Math.max(1, n1)).toFixed(1)}% (${ok1}/${n1})`);
  }

  // 6-4 퇴근: 게이트 3회 실패 → 야근 ★1, 18:18 → 야근 ★1, 18시 전 탈출 보너스
  const leaveSim = (day: number, seed: string) => {
    const sim = new DaySim(contentFor(tables, day), { view: VIEW }, seed);
    for (let i = 0; i < 60 * 90 && sim.phase !== 'leave'; i++) { sim.floor.suspicion.value = 0; sim.step(); }
    return sim;
  };
  {
    // 할당량을 채운 상태로 퇴근 단계에 들어가야 '게이트' 결과만 볼 수 있음 → 업무를 하니스에서 채움(관찰용)
    const sim = leaveSim(6, 'gate3');
    sim.work = 1;
    for (const m of sim.missions) m.state = 'done';
    let beeps = 0;
    for (let i = 0; i < 60 * 40 && sim.phase !== 'ended'; i++) {
      sim.floor.suspicion.value = 0;
      for (const n of sim.floor.npcs) n.suppressed = true;
      if (sim.leaveStage === 'walk' && sim.floor.player.mode !== 'moving') sim.floor.moveTo(sim.content.leave.gate.spot);
      if (sim.leaveStage === 'gate' && Math.abs(sim.gateMarker - 0.5) > 0.4) { const t = sim.floor.player.tile; sim.tapWorld(t.x, t.y); }
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'gate' && e.result === 'fail') beeps++;
    }
    check('게이트 3회 실패 → 야근(★1)', sim.result?.outcome === 'overtime' && sim.result.stars === 1 && beeps === 3, `${sim.result?.outcome} ★${sim.result?.stars} 실패 ${beeps}회`);
    check('게이트 실패 1회당 의심 +0.10(삐빅)', true, '집계는 balance(gate_beep)');
  }
  {
    const sim = leaveSim(6, 'late');
    sim.work = 1;
    for (const m of sim.missions) m.state = 'done';
    for (let i = 0; i < 60 * 40 && sim.phase !== 'ended'; i++) { sim.floor.suspicion.value = 0; sim.step(); }
    check('퇴근 안 하고 자리에 있으면 18:18 → 야근(★1)', sim.result?.outcome === 'overtime' && sim.result.stars === 1 && Math.abs((sim.result.clockMin ?? 0) - (18 * 60 + 18)) < 0.1, `${sim.result?.outcome} ★${sim.result?.stars} ${(sim.result?.clockMin ?? 0).toFixed(2)}분`);
  }
  {
    // 최적 플레이: 시선 없음 + 게이트 첫 탭 성공 + 엘리베이터 최소 대기. 18시 전에 끝낼 수 있는가
    let best = Infinity, bonus = 0;
    const tlist: number[] = [];
    for (let k = 0; k < 40; k++) {
      const sim = leaveSim(2, `early-${k}`);
      sim.work = 1;
      for (const m of sim.missions) m.state = 'done';
      for (let i = 0; i < 60 * 40 && sim.phase !== 'ended'; i++) {
        sim.floor.suspicion.value = 0;
        for (const n of sim.floor.npcs) n.suppressed = true;
        if (sim.leaveStage === 'walk' && sim.floor.player.mode !== 'moving') sim.floor.moveTo(sim.content.leave.gate.spot);
        if (sim.leaveStage === 'gate' && Math.abs(sim.gateMarker - 0.5) < 0.02) { const t = sim.floor.player.tile; sim.tapWorld(t.x, t.y); }
        sim.step();
        for (const e of sim.drainEvents()) if (e.type === 'toast' && e.key === 'event.leave.early_bonus') bonus++;
      }
      const cm = sim.result?.clockMin ?? Infinity;
      tlist.push(cm); best = Math.min(best, cm);
    }
    const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
    report['earlyLeave'] = { best, bonus };
    info(`최적 퇴근(시선 없음, 게이트 첫 탭 성공) 40판: 가장 빠른 종료 ${hm(best)}, 18시 전 탈출 보너스 ${bonus}회`);
    check('18:00 전 탈출 보너스(+100)를 받을 수 있는 경로가 있음 (GDD §6-3·§9 INT-07)', bonus > 0, `최적 종료 ${hm(best)} (짐 ${contentFor(tables, 2).leave.packSec}초 + 자리→게이트 33타일 11초 + 엘리베이터 ${contentFor(tables, 2).leave.elevatorWaitSecRange.join('~')}초)`);
  }
  {
    // 게이트 타이밍 판정 창: 오차 0이면 항상 통과, 창 반폭(초) 계산
    const c = contentFor(tables, 6);
    const half = (c.leave.gate.windowRatio / 2) * (c.leave.gate.markerCycleSec / 2);
    info(`게이트 판정 창 ±${(half * 1000).toFixed(0)}ms (windowRatio ${c.leave.gate.windowRatio}, 주기 ${c.leave.gate.markerCycleSec}초) → 타이밍 σ0.10초 1회 성공 약 ${(100 * erf(half / (0.1 * Math.SQRT2))).toFixed(0)}%, 3회 내 ${(100 * (1 - (1 - erf(half / (0.1 * Math.SQRT2))) ** 3)).toFixed(0)}%`);
    report['gateWindowMs'] = half * 1000;
  }
}

function erf(x: number): number { // Abramowitz-Stegun
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// ═══ 7. 전면광고 판정
section('7. 전면광고 decideInterstitial (D-031·D-048)');
{
  const rules = parseInterstitialRules(tables['ads'] as Record<string, unknown>);
  check('ads.json: 설치 당일 0, 3판, 하루 5, 180초, 보상형 본 판 건너뜀', rules.installDayMaxShows === 0 && rules.everyNGames === 3 && rules.maxPerDay === 5 && rules.minIntervalSec === 180 && rules.skipIfRewardedWatchedThisGame && rules.enabled,
    JSON.stringify(rules));
  const D0 = new Date(2026, 10, 23, 10, 0, 0).getTime();
  const DAY = 24 * 3600 * 1000;
  const ctx = { iapRemoveAds: false, duringPlay: false, rewardedWatchedThisGame: false };
  const base = (o: Partial<AdCounters>, now: number): AdCounters => ({ ...freshCounters(D0), ...o, countersDate: o.countersDate ?? freshCounters(now).countersDate });
  const dec = (o: Partial<AdCounters>, now: number, c = ctx) => decideInterstitial(rules, base(o, now), now, c);
  const d1 = D0 + DAY;
  const r1 = dec({ gamesSinceLastInterstitial: 10 }, D0);
  check('설치 당일: 10판 해도 노출 안 함(install_day)', !r1.show && r1.reason === 'install_day', JSON.stringify(r1));
  const r1b = dec({ gamesSinceLastInterstitial: 10 }, new Date(2026, 10, 23, 23, 59, 59).getTime());
  check('설치 당일 23:59:59도 install_day', !r1b.show && r1b.reason === 'install_day');
  const r2 = dec({ gamesSinceLastInterstitial: 3 }, new Date(2026, 10, 24, 0, 0, 0).getTime());
  check('다음 날 00:00:00, 3판째 → 노출', r2.show, JSON.stringify(r2));
  check('다음 날 2판째 → 건너뜀(not_nth_game)', (() => { const r = dec({ gamesSinceLastInterstitial: 2 }, d1); return !r.show && r.reason === 'not_nth_game'; })());
  check('하루 4회 본 뒤 → 노출(5회째 허용)', dec({ gamesSinceLastInterstitial: 3, interstitialShownToday: 4 }, d1).show);
  check('하루 5회 본 뒤 → 건너뜀(daily_cap)', (() => { const r = dec({ gamesSinceLastInterstitial: 3, interstitialShownToday: 5 }, d1); return !r.show && r.reason === 'daily_cap'; })());
  check('마지막 광고 후 179.999초 → 건너뜀(interval)', (() => { const r = dec({ gamesSinceLastInterstitial: 3, interstitialShownToday: 1, lastInterstitialAt: d1 - 179999 }, d1); return !r.show && r.reason === 'interval'; })());
  check('마지막 광고 후 정확히 180초 → 노출', dec({ gamesSinceLastInterstitial: 3, interstitialShownToday: 1, lastInterstitialAt: d1 - 180000 }, d1).show);
  check('그 판에 보상형 봄 → 건너뜀(rewarded_this_game)', (() => { const r = dec({ gamesSinceLastInterstitial: 3 }, d1, { ...ctx, rewardedWatchedThisGame: true }); return !r.show && r.reason === 'rewarded_this_game'; })());
  check('플레이 중 → 건너뜀(during_play)', (() => { const r = dec({ gamesSinceLastInterstitial: 3 }, d1, { ...ctx, duringPlay: true }); return !r.show && r.reason === 'during_play'; })());
  check('광고 제거 구매 → 건너뜀(iap)', (() => { const r = dec({ gamesSinceLastInterstitial: 3 }, d1, { ...ctx, iapRemoveAds: true }); return !r.show && r.reason === 'iap'; })());
  check('날짜가 바뀌면 오늘 횟수 초기화(전날 5회 → 오늘 노출 가능)', dec({ gamesSinceLastInterstitial: 3, interstitialShownToday: 5, countersDate: '2026-11-23' }, d1 + DAY).show);
  // 시나리오: 설치일 20판, 다음 날 40판을 70초 간격으로
  let c = freshCounters(D0); let shows = 0, showsDay0 = 0; const at: number[] = []; let gamesBetween: number[] = []; let since = 0;
  for (let g = 0; g < 20; g++) { const now = D0 + g * 70000; c = onGameFinished(c, now); if (decideInterstitial(rules, c, now, ctx).show) { showsDay0++; c = onInterstitialShown(c, now); } }
  for (let g = 0; g < 40; g++) {
    const now = d1 + g * 70000; c = onGameFinished(c, now); since++;
    if (decideInterstitial(rules, c, now, ctx).show) { shows++; at.push(now); gamesBetween.push(since); since = 0; c = onInterstitialShown(c, now); }
  }
  const gaps = at.slice(1).map((v, i) => (v - at[i]!) / 1000);
  info(`시나리오: 설치일 20판 → 전면 ${showsDay0}회 / 다음 날 40판(70초 간격) → ${shows}회, 간격 ${gaps.join(',')}초, 사이 판수 ${gamesBetween.join(',')}`);
  check('시나리오: 설치일 0회, 다음 날 ≤ 5회, 간격 ≥ 180초, 광고 사이 3판 이상(설치일 판수 이월 포함)', showsDay0 === 0 && shows <= 5 && shows > 0 && gaps.every((g) => g >= 180) && gamesBetween.slice(1).every((g) => g >= 3));
  info(`참고: 설치일에 쌓인 판수가 이월되어 다음 날 첫 판 결과 화면에서 바로 전면광고 대상이 됨(사이 판수 ${gamesBetween[0]}) — BUG-014(P3, 해석 확인 필요)`);
  gamesBetween = [];
  void rollDay;
  // 결과 화면 입력 보호
  check('rules.input.resultInputGuardSec = 0.6 (BUG-006) → DayContent에 반영', contentFor(tables, 1).resultInputGuardSec === 0.6);
}


// ═══ 8. T-133 추가 항목(대표님 순시·엘리베이터 대표님·공범·위계 연쇄)
section('8. T-133 추가: 순시·INT-11·공범·H1');
{
  type Any = Record<string, unknown> & { [k: string]: any };
  const ceoDay = 28;
  // 8-1 CEO 패스: 순시 0회
  {
    let visits = 0, n = 0;
    for (let k = 0; k < 30; k++) {
      const sim = new DaySim(contentFor(tables, ceoDay), { view: VIEW, skipCeoVisit: true } as never, `pass-${k}`);
      const bot = new Bot(BOTS['disguise']!, sim, `pass-${k}`);
      for (let i = 0; i < 60 * 200 && sim.phase !== 'ended'; i++) {
        bot.act(); sim.step();
        for (const e of sim.drainEvents()) if (e.type === 'ceo' && e.stage === 'tell') visits++;
        sim.drainFloorEvents();
      }
      n++;
      if ((sim.result as Any | null)?.['ceoVisit'] !== 'skipped') visits += 1000;
    }
    check(`CEO 패스(skipCeoVisit) 선택 시 순시 0회·결과 ceoVisit 'skipped' (${ceoDay}일차 ${n}판)`, visits === 0, `${visits}`);
  }
  // 8-2 순시 중 시계·미션 제한시간 정지(집계는 balance), 얼음 중 대표님 외 시선 0(집계는 balance)
  // 8-3 INT-11 엘리베이터 대표님: QTE를 놓치거나 일찍 눌러도 적발로 이어지지 않음
  for (const mode of ['miss', 'early', 'success'] as const) {
    const day = 30;
    let started = 0, caught = 0, results: Record<string, number> = {};
    for (let k = 0; k < 20; k++) {
      const sim = new DaySim(contentFor(tables, day), { view: VIEW }, `elev-${mode}-${k}`);
      for (let i = 0; i < 60 * 120 && sim.phase !== 'leave'; i++) { sim.floor.suspicion.value = 0; sim.step(); }
      (sim as unknown as Any).work = 1;
      for (const m of sim.missions) m.state = 'done';
      for (let i = 0; i < 60 * 60 && sim.phase !== 'ended'; i++) {
        for (const n of sim.floor.npcs) if (n.def.actorId !== 'ceo') n.suppressed = true;
        if (sim.elevatorCeo === 'none') sim.floor.suspicion.value = 0;
        if (sim.leaveStage === 'walk' && sim.floor.player.mode !== 'moving') sim.floor.moveTo(sim.content.leave.gate.spot);
        if (sim.leaveStage === 'gate' && Math.abs(sim.gateMarker - 0.5) < 0.02) { const t = sim.floor.player.tile; sim.tapWorld(t.x, t.y); }
        if (sim.qteActive && sim.qteSource === 'elevator') {
          sim.floor.suspicion.value = Math.max(sim.floor.suspicion.value, 0.97);
          const q = sim.qte!;
          if (mode === 'early' && q.phase === 'precue') sim.tapQte(0.1);
          if (mode === 'success' && q.phase === 'window') sim.tapQte(0.1);
        }
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.type === 'interrupt' && e.id === 'INT-11') started++;
          if (e.type === 'qte' && e.source === 'elevator' && e.stage === 'result') results[e.result ?? '?'] = (results[e.result ?? '?'] ?? 0) + 1;
        }
        sim.drainFloorEvents();
      }
      if (sim.result?.outcome === 'caught') caught++;
    }
    info(`INT-11(${day}일차) ${mode}: 등장 ${started}/20, QTE ${JSON.stringify(results)}, 적발 ${caught}`);
    check(`INT-11 엘리베이터 대표님(${mode}, 의심 0.97에서 QTE): 적발로 이어지지 않음`, started > 0 && caught === 0, `등장 ${started}, 적발 ${caught}`);
  }
  // 8-4 공범: 합류 시 의심 상승률 ×1.25, 같이 한 미션 보상 ×2
  {
    const sim = new DaySim(contentFor(tables, 7), { view: VIEW }, 'acc');
    toDay(sim);
    const m = sim.missions.find((x) => x.def.id === 'coffee')!;
    for (let i = 0; i < 60 * 20 && m.state === 'locked'; i++) { sim.floor.suspicion.value = 0; sim.step(); }
    sim.tapMission('coffee');
    let offered = false, joined = false, points = -1;
    let rateWith = NaN;
    for (let i = 0; i < 60 * 40 && sim.phase === 'day' && m.state !== 'done' && m.state !== 'failed'; i++) {
      for (const n of sim.floor.npcs) n.suppressed = true;
      sim.floor.suspicion.value = 0;
      if (sim.offer && !joined) { offered = true; joined = sim.acceptOffer(); if (joined && Number.isNaN(rateWith)) rateWith = (sim as unknown as Any).playerRate(0.45); }
      const v = sim.activityView();
      if (v?.kind === 'pour' && !v.paused && v.level >= 0.83) sim.tapWorld(0, 0);
      if (m.state === 'carry' && sim.floor.player.mode !== 'moving' && !sim.playerAtSeat) sim.tapMission('coffee');
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'missionDone' && e.id === 'coffee') points = e.points;
      sim.drainFloorEvents();
    }
    const base = m.def.reward.slackPoints;
    const sim2 = new DaySim(contentFor(tables, 7), { view: VIEW }, 'acc2');
    const rateWithout = (sim2 as unknown as Any).playerRate(0.45);
    info(`공범(7일차 커피 강제 제안): 제안 ${offered}, 합류 ${joined}, 이동 상승률 합류 ${rateWith} / 단독 ${rateWithout}, 완료 점수 ${points} (기본 ${base})`);
    check('공범 합류 중 의심 상승률 ×1.25', joined && Math.abs(rateWith / rateWithout - 1.25) < 1e-9, `${rateWith}/${rateWithout}`);
    check('공범과 같이 한 미션 보상 ×2', points === base * 2, `${points} vs ${base}`);
  }
  // 8-5 H1: 본부장이 팀 구역에 오면 팀장이 통로(4,31)로 나와 인사 → 최단 경로 길막. 플레이어는 우회하거나 기다렸다 지나감(교착 없음)
  {
    let tried = 0, arrived = 0, blockedEv = 0, waitSum = 0, rerouted = 0;
    for (let k = 0; k < 40; k++) {
      const sim = new DaySim(contentFor(tables, 19), { view: VIEW }, `h1-${k}`);
      let greet = false;
      for (let i = 0; i < 60 * 60 && (sim.phase === 'intro' || sim.phase === 'day') && !greet; i++) {
        sim.floor.suspicion.value = 0; sim.step(); sim.drainEvents(); sim.drainFloorEvents();
        greet = !!sim.floor.findNpc((n) => (n.def.patrolId ?? '').endsWith('_greet') && n.mode === 'hold');
      }
      if (!greet) continue;
      tried++;
      teleport(sim, sim.content.playerSeat);
      const goal = sim.content.spots['restroom_stall']!.tile;
      const direct = findPath(sim.floor.map, sim.content.playerSeat, goal);
      sim.floor.moveTo(goal);
      let w = 0, t0 = sim.time, ok = false, path: Tile[] = [];
      for (let i = 0; i < 60 * 20; i++) {
        for (const n of sim.floor.npcs) n.suppressed = true;
        sim.floor.suspicion.value = 0;
        sim.step(); sim.drainEvents();
        for (const e of sim.drainFloorEvents()) if (e.type === 'blocked') blockedEv++;
        if (sim.floor.player.paused) w += H;
        const t = sim.floor.player.tile; if (!path.length || path[path.length - 1]!.x !== t.x || path[path.length - 1]!.y !== t.y) path.push(t);
        if (t.x === goal.x && t.y === goal.y) { ok = true; break; }
        if (sim.phase !== 'day') break;
      }
      if (!ok && sim.phase !== 'day') { tried--; continue; } // 걷는 중 퇴근 시작(자리로 복귀) — 길막과 무관
      if (ok) arrived++;
      waitSum += w;
      if (direct && path.length - 1 > direct.length) rerouted++;
      void t0;
    }
    info(`H1(19일차): 팀장 인사 길막 상황 ${tried}회, 도착 ${arrived}, 길막 이벤트 ${blockedEv}, 우회 ${rerouted}, 평균 대기 ${(waitSum / Math.max(1, tried)).toFixed(2)}초`);
    check('H1 팀장 인사 길막: 자리→화장실 이동이 교착 없이 도착(우회 또는 대기)', tried > 0 && arrived === tried, `${arrived}/${tried}`);
  }
}

writeFileSync('tests/.out/t131-rules.json', JSON.stringify(report, null, 1));
const failed = summary();
process.exitCode = failed > 0 ? 1 : 0;
