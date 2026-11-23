/**
 * T-131 브라우저 자동 플레이 (사전 설치 Playwright + Chromium, 재설치 금지, 트레이스 미사용, deviceScaleFactor 1).
 * 사용(game/ 에서): 개발 서버(5179)와 빌드 미리보기(5180)를 먼저 띄운 뒤
 *   node tests/browser/t131-browser.cjs [devUrl] [prodUrl]
 * A. 개발 서버: 가짜 rAF로 프레임 단위 진행. 1일차 타이틀 → 결과까지 실제 마우스 클릭으로 자동 플레이,
 *    결과 화면 입력 보호(0.6초), 진행 저장·복원, 전면광고 판정 로그, 플레이 중 광고 호출 0, 콘솔 에러 0.
 * B. 빌드 미리보기: 첫 화면 진입 시간, 콘솔 에러, 세로 화면 배율.
 * 스크린샷: qa/screenshots/t131-*.png
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const DEV = process.argv[2] || 'http://localhost:5179/';
const PROD = process.argv[3] || 'http://localhost:5180/';
const SHOTS = path.resolve(__dirname, '../../../qa/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = path.resolve(__dirname, '../.out/t131-browser.json');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const info = (m) => console.log(`  · ${m}`);

const FAKE_RAF = `
  window.__qa = { raf: [], now: 0 };
  const realNow = performance.now.bind(performance);
  window.requestAnimationFrame = (cb) => { window.__qa.raf.push(cb); return window.__qa.raf.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__qa.now += 1000 / 60;
      const q = window.__qa.raf; window.__qa.raf = [];
      for (const cb of q) cb(window.__qa.now);
    }
  };
`;

async function openPage(browser, url, viewport, { fakeRaf, clearStorage }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], logs = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); logs.push({ t: Date.now(), type: m.type(), text: m.text() }); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (fakeRaf) await page.addInitScript(FAKE_RAF);
  if (clearStorage) await page.addInitScript(() => { try { if (!sessionStorage.getItem('qa-cleared')) { localStorage.clear(); sessionStorage.setItem('qa-cleared', '1'); } } catch {} });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  return { context, page, errors, logs, t0 };
}

async function canvasBox(page) {
  return page.evaluate(() => { const c = document.querySelector('#game canvas'); const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
}
async function tapLogical(page, lx, ly) {
  const r = await canvasBox(page);
  const z = r.w / 180;
  await page.mouse.click(r.x + (lx + 0.5) * z, r.y + (ly + 0.5) * z);
}
const step = (page, n) => page.evaluate((k) => window.__step(k), n);
async function waitBoot(s) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !s.logs.some((l) => /\[boot\] data tables/.test(l.text))) { await s.page.evaluate(() => window.__step && window.__step(2)); await s.page.waitForTimeout(30); }
  await s.page.waitForTimeout(200);
  await s.page.evaluate(() => window.__step && window.__step(10));
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `t131-${name}.png`) });

/** 페이지 안 상태 읽기 + 다음 행동 결정(사람이 보는 정보만: 전조·콘·화살표·게이지) */
const DECIDE = () => {
  const d = window.__mtDay, sc = window.__mtScene;
  if (!d || !sc) return { kind: 'none', phase: 'boot' };
  const f = d.floor, p = f.player;
  const cam = sc.cameras.main;
  const toScreen = (tx, ty) => ({ lx: sc.offsetX + tx * 16 + 8 - cam.scrollX, ly: ty * 16 + 8 - cam.scrollY });
  const st = { phase: d.phase, stage: d.leaveStage, mode: p.mode, t: f.time, susp: f.suspicion.value, tile: p.tile, work: d.work, act: d.activityView(), result: d.result, day: d.content.day, gateMarker: d.gateMarker, gateWindow: d.gateWindow };
  if (d.phase === 'intro' || d.phase === 'ended') return { kind: 'none', ...st };
  if (p.mode === 'talked') return { kind: 'none', ...st };
  const danger = f.npcs.some((n) => { if (n.gazeMultiplier <= 0) return false; const th = f.threatOfNpc(n); return f.isOnScreen(n) && (th === 'seeing' || th === 'turning'); });
  st.danger = danger;
  const me = toScreen(p.tile.x, p.tile.y);
  if (d.phase === 'leave' && d.leaveStage === 'gate') {
    if (Math.abs(d.gateMarker - 0.5) < d.gateWindow / 4) return { kind: 'tap', ...me, why: 'gate', ...st };
    return { kind: 'none', ...st };
  }
  const v = d.activityView();
  if (v) {
    if (v.kind === 'pour') {
      if (!v.paused && danger && v.level < v.band[0] - 0.02) return { kind: 'tap', ...me, why: 'pour-pause', ...st };
      if (v.paused && !danger) return { kind: 'tap', ...me, why: 'pour-resume', ...st };
      if (!v.paused && v.level >= (v.band[0] + v.band[1]) / 2) return { kind: 'tap', ...me, why: 'pour-stop', ...st };
    }
    return { kind: 'none', ...st };
  }
  if (p.mode === 'moving' && danger && !d.gateOpen && !(d.phase === 'leave' && d.leaveStage === 'pack')) return { kind: 'tap', ...me, why: 'stop', ...st };
  if (p.mode === 'disguised' && f.resumeDestination && !p.paused) return danger ? { kind: 'none', ...st } : { kind: 'tap', ...me, why: 'resume', ...st };
  if (p.mode === 'moving' || p.paused) return { kind: 'none', ...st };
  if (d.phase === 'day') {
    const carry = d.missions.find((m) => m.state === 'carry');
    const seat = d.content.playerSeat;
    if (carry && !d.playerAtSeat) { const s = toScreen(seat.x, seat.y); return { kind: 'tap', ...s, why: 'to-seat', ...st }; }
    const open = d.missions.find((m) => m.state === 'open' && !m.blocked);
    if (open && d.playerAtSeat && !danger) {
      const i = d.missions.indexOf(open);
      return { kind: 'tap', lx: 4 + i * 28 + 12, ly: 320 - 14, why: `chip:${open.def.id}`, ...st };
    }
    if (!d.playerAtSeat && !d.pendingMission) { const s = toScreen(seat.x, seat.y); return { kind: 'tap', ...s, why: 'to-seat', ...st }; }
    return { kind: 'none', ...st };
  }
  if (d.phase === 'leave') {
    if (d.leaveStage === 'walk') {
      const g = d.content.leave.gate.spot;
      const gs = toScreen(g.x, g.y);
      if (gs.ly >= 24 + 8) return { kind: 'tap', ...gs, why: 'to-gate', ...st };
      // 게이트가 화면 위쪽 밖: 보이는 가장 위 복도 칸을 탭
      const topTy = Math.ceil((cam.scrollY + 24 + 8) / 16);
      return { kind: 'tap', ...toScreen(5, Math.max(g.y, topTy)), why: 'walk-up', ...st };
    }
  }
  return { kind: 'none', ...st };
};

(async () => {
  const browser = await chromium.launch();
  const meta = {};
  try {
    // ── A. 개발 서버: 1일차 자동 플레이
    {
      const vp = { width: 360, height: 640 };
      const s = await openPage(browser, DEV, vp, { fakeRaf: true, clearStorage: true });
      const { page } = s;
      await waitBoot(s);
      await shot(page, '01-title');
      await tapLogical(page, 90, 200);
      await step(page, 20);
      const started = await page.evaluate(() => !!window.__mtDay && window.__mtDay.content.day);
      check('타이틀 탭 → 1일차 GameScene 시작', started === 1, `day=${started}`);
      const box = await canvasBox(page);
      check('세로 360×640: 캔버스 정수 배율(180×320 × 2)', box.w === 360 && box.h === 640, `${box.w}×${box.h}`);
      const counts = {};
      const shotsTaken = new Set();
      let last = null, frames = 0, stops = 0, adCallsDuringPlay = 0;
      const adLogBefore = s.logs.length;
      while (frames < 60 * 150) {
        const a = await page.evaluate(DECIDE);
        last = a;
        if (a.phase === 'ended') break;
        if (a.kind === 'tap') {
          counts[a.why] = (counts[a.why] ?? 0) + 1;
          if (a.why === 'stop') stops++;
          await tapLogical(page, a.lx, a.ly);
          if (a.why === 'stop' && !shotsTaken.has('stop')) { await step(page, 2); await shot(page, '03-disguise-stop'); shotsTaken.add('stop'); }
          if (a.why.startsWith('chip:') && !shotsTaken.has('chip')) { await step(page, 20); await shot(page, '02-moving-to-coffee'); shotsTaken.add('chip'); }
        }
        if (a.act && !shotsTaken.has('coffee')) { await shot(page, '04-coffee-minigame'); shotsTaken.add('coffee'); }
        if (a.phase === 'leave' && a.stage === 'pack' && !shotsTaken.has('pack')) { await shot(page, '05-leave-pack'); shotsTaken.add('pack'); }
        if (a.phase === 'leave' && a.stage === 'gate' && !shotsTaken.has('gate')) { await step(page, 10); await shot(page, '06-gate'); shotsTaken.add('gate'); }
        await step(page, 3); frames += 3;
      }
      adCallsDuringPlay = s.logs.slice(adLogBefore).filter((l) => /\[mock ads\]/.test(l.text)).length;
      await step(page, 2);
      const r = await page.evaluate(() => window.__mtDay.result);
      info(`자동 플레이 입력: ${JSON.stringify(counts)}, 진행 ${(frames / 60).toFixed(1)}초(프레임 기준)`);
      check('1일차 처음부터 결과 화면까지 도달', !!r, r ? `${r.outcome} ★${r.stars} 의심 최고 ${(r.peakSuspicion * 100).toFixed(0)}% 미션 ${r.missionsDone}/${r.missionsTotal} ${r.timeSec.toFixed(1)}초(인트로 제외)` : JSON.stringify(last));
      meta.day1 = r;
      check('플레이 중 광고 호출 0회(mock ads 로그)', adCallsDuringPlay === 0, `${adCallsDuringPlay}회`);
      await shot(page, '07-result');
      // 결과 화면 입력 보호: 표시 직후 0.5초 동안 5회 연타 → 그대로, 그 뒤 탭 → 다음 날
      const dayObj1 = await page.evaluate(() => { window.__qaDayRef = window.__mtDay; return window.__mtDay.content.day; });
      for (let i = 0; i < 5; i++) { await tapLogical(page, 90, 160); await step(page, 6); }
      const still = await page.evaluate(() => window.__mtDay === window.__qaDayRef && window.__mtDay.phase === 'ended');
      check('결과 화면 표시 후 0.5초 안 연타 5회 → 무시(resultInputGuardSec 0.6)', still);
      await step(page, 30);
      await page.waitForTimeout(300); // 진행 저장(비동기 Storage) 여유
      await tapLogical(page, 90, 160);
      await step(page, 20);
      await page.waitForTimeout(300);
      const next = await page.evaluate(() => ({ same: window.__mtDay === window.__qaDayRef, day: window.__mtDay.content.day }));
      check('보호 시간 뒤 탭 → 다음 날(★1 이상이면 2일차)', !next.same && next.day === (r && r.stars >= 1 ? dayObj1 + 1 : dayObj1), JSON.stringify(next));
      await step(page, 10);
      await shot(page, '08-day2-intro');
      // 전면광고 판정 로그(설치 당일 → install_day)
      const adLog = s.logs.filter((l) => /\[ads\] 전면광고 판정/.test(l.text)).map((l) => l.text);
      info(`광고 판정 로그: ${JSON.stringify(adLog)}`);
      check('결과→다음 날 전환 시 전면광고 판정: 설치 당일 건너뜀(install_day)', adLog.length >= 1 && adLog.every((t) => /install_day/.test(t)), adLog.join(' | '));
      info('미실행: 전면광고 예고(noticeKey) → 노출 → 보상 흐름 UI — main.ts onDayFinished가 판정 로그만 남기고 노출은 TODO(T-133 진행 중)');
      meta.notRun = ['전면광고 예고→노출→보상 UI(미구현)'];
      // 저장·복원
      const saved = await page.evaluate(() => ({ prog: localStorage.getItem('mt-mock:mt.progress.v1'), ads: localStorage.getItem('mt-mock:mt.adCounters.v1') }));
      info(`저장값: progress=${saved.prog} ads=${saved.ads}`);
      let prog = null; try { prog = JSON.parse(saved.prog); } catch {}
      check('진행 저장: unlockedDay 2·1일차 최고 별', prog && prog.unlockedDay === 2 && prog.bestStars && prog.bestStars['1'] === (r ? r.stars : -1), saved.prog);
      s.logs.length = 0;
      await page.reload({ waitUntil: 'load' });
      await waitBoot(s);
      await page.waitForTimeout(300);
      await step(page, 10);
      await shot(page, '09-title-continue');
      await tapLogical(page, 90, 200);
      await step(page, 20);
      const resumed = await page.evaluate(() => window.__mtDay && window.__mtDay.content.day);
      check('새로고침 후 타이틀 탭 → 저장된 2일차로 시작(복원)', resumed === 2, `day=${resumed}`);
      check('개발 서버 콘솔 에러 0', s.errors.length === 0, s.errors.slice(0, 3).join(' | '));
      meta.devErrors = s.errors;
      await s.context.close();
    }

    // ── A2. 세로 화면 레이아웃(개발 서버, 3종)
    for (const vp of [{ width: 390, height: 844 }, { width: 412, height: 915 }, { width: 320, height: 568 }]) {
      const s = await openPage(browser, DEV + '?day=6', vp, { fakeRaf: true, clearStorage: true });
      await waitBoot(s); await tapLogical(s.page, 90, 200); await step(s.page, 200);
      const b = await canvasBox(s.page);
      const z = b.w / 180;
      const ok = Number.isInteger(z) && b.h === 320 * z && b.x >= 0 && b.y >= 0 && b.x + b.w <= vp.width + 0.5 && b.y + b.h <= vp.height + 0.5;
      check(`세로 ${vp.width}×${vp.height}: 정수 배율 ${z}, 화면 안에 들어옴`, ok, `${b.w}×${b.h} @(${b.x},${b.y})`);
      await shot(s.page, `10-layout-${vp.width}x${vp.height}`);
      check(`세로 ${vp.width}×${vp.height}: 콘솔 에러 0`, s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
      await s.context.close();
    }

    // ── B. 빌드 미리보기: 첫 화면 진입 시간·콘솔 에러
    {
      const times = [];
      let errs = [];
      for (let k = 0; k < 3; k++) {
        const s = await openPage(browser, PROD, { width: 360, height: 640 }, { fakeRaf: false, clearStorage: true });
        const t = Date.now();
        await s.page.waitForFunction(() => !!document.querySelector('#game canvas'), null, { timeout: 15000 });
        // 타이틀 씬 진입 = [boot] data tables 로그 이후
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !s.logs.some((l) => /\[boot\] data tables/.test(l.text))) await s.page.waitForTimeout(20);
        times.push(Date.now() - s.t0);
        await s.page.waitForTimeout(500);
        if (k === 0) await shot(s.page, '11-prod-title-360x640');
        // 실제 클릭으로 시작해 3초 진행
        await tapLogical(s.page, 90, 200);
        await s.page.waitForTimeout(3000);
        if (k === 0) await shot(s.page, '12-prod-day1-3s');
        errs = errs.concat(s.errors);
        void t;
        await s.context.close();
      }
      meta.prodFirstScreenMs = times;
      info(`빌드 미리보기 첫 화면(타이틀) 진입: ${times.join(', ')}ms (로컬 서버, 캐시 없음 새 컨텍스트)`);
      check('빌드 미리보기 첫 화면 진입 ≤ 3000ms(로컬)', Math.max(...times) <= 3000, `최대 ${Math.max(...times)}ms`);
      check('빌드 미리보기 콘솔 에러 0', errs.length === 0, errs.slice(0, 3).join(' | '));
    }
  } catch (e) {
    check('브라우저 테스트 예외 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    await browser.close();
  }
  fs.writeFileSync(OUT, JSON.stringify({ results, meta }, null, 1));
  const fail = results.filter((r) => !r.ok);
  console.log(`\n합계: ${results.length - fail.length}/${results.length} 통과`);
  for (const f of fail) console.log(`  FAIL ${f.name} — ${f.detail}`);
})();
