/**
 * T-145 스크린샷(개발자용). 사전 설치 Playwright + Chromium(재설치 금지), deviceScaleFactor 1, 가짜 rAF로 프레임 단위 진행.
 * 사용(game/ 에서, 개발 서버 실행 후): node scripts/t145-shots.cjs [http://localhost:5181/]
 * 출력: docs/screenshots/t145-*.png (생성 층 3개 일차, 팀장 순회 출발, 새 미션 1개) + 콘솔 요약
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.argv[2] || 'http://localhost:5181/';
const OUT = path.resolve(__dirname, '../docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const FAKE_RAF = `
  window.__qa = { raf: [], now: 0 };
  window.requestAnimationFrame = (cb) => { window.__qa.raf.push(cb); return window.__qa.raf.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__qa.now += 1000 / 60; const q = window.__qa.raf; window.__qa.raf = []; for (const cb of q) cb(window.__qa.now); } };
`;

async function openDay(browser, day, extra = '') {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(FAKE_RAF);
  await page.goto(`${BASE}?v3=1&sound=off&day=${day}${extra}`, { waitUntil: 'load' });
  for (let i = 0; i < 200; i++) {
    const ok = await page.evaluate(() => !!window.__mtGame && window.__mtGame.scene.getScene('Title')?.sys.isActive());
    if (ok) break;
    await page.evaluate(() => window.__step(5)); await page.waitForTimeout(20);
  }
  await page.evaluate((d) => { const g = window.__mtGame; g.scene.getScenes(true).forEach((s) => { if (s.sys.settings.key !== 'Audio') g.scene.stop(s.sys.settings.key); }); g.scene.start('Game', { day: d }); }, day);
  for (let i = 0; i < 100; i++) { const ok = await page.evaluate(() => !!window.__mtDay); if (ok) break; await page.evaluate(() => window.__step(2)); await page.waitForTimeout(10); }
  return { context, page, errors };
}
const step = (page, n) => page.evaluate((k) => window.__step(k), n);
/** 조건까지 진행(최대 maxFrames) */
async function until(page, fn, maxFrames = 6000, arg) {
  for (let f = 0; f < maxFrames; f += 10) {
    if (await page.evaluate(fn, arg)) return f;
    await step(page, 10);
  }
  return -1;
}

(async () => {
  const browser = await chromium.launch();
  const summary = [];
  // 1) 생성 층 3개 일차(직급이 다른 날): 근무 시작 직후 팀 구역
  for (const [day, name] of [[6, 't145-01-gen-day6-staff'], [41, 't145-02-gen-day41-deputy'], [65, 't145-03-gen-day65-exec']]) {
    const s = await openDay(browser, day);
    await until(s.page, () => window.__mtDay.phase === 'day');
    await step(s.page, 30);
    const info = await s.page.evaluate(() => { const c = window.__mtDay.content; return { src: c.layout.source, mods: c.layout.modules, h: c.floor.level.rows.length, attempts: c.layout.attempts, tag: c.layout.versionTag }; });
    await s.page.screenshot({ path: path.join(OUT, `${name}.png`) });
    summary.push({ shot: name, day, ...info, errors: s.errors.length });
    await s.context.close();
  }
  // 2) 팀장 순회 출발 전조(6일차 첫 순회 = printer, 튜토리얼)
  {
    const s = await openDay(browser, 6);
    const f = await until(s.page, () => window.__mtDay.touringNpcs().some((n) => n.stopId === 'stop_tour_stand'), 4000);
    await step(s.page, 24);
    const info = await s.page.evaluate(() => { const n = window.__mtDay.touringNpcs()[0]; return { dayTime: window.__mtDay.dayTime.toFixed(1), stop: n?.stopId, mode: n?.mode, anim: window.__mtScene && [...window.__mtScene.views.values()].map((v) => v.sprite.anims.currentAnim?.key).filter((k) => k && k.startsWith('teamlead')) }; });
    await s.page.screenshot({ path: path.join(OUT, 't145-04-tour-stand.png') });
    summary.push({ shot: 't145-04-tour-stand', foundAtFrame: f, ...info, errors: s.errors.length });
    // 걷는 중 + 자리 비움 배지
    await until(s.page, () => window.__mtDay.touringNpcs().some((n) => n.mode === 'walk'), 600);
    await step(s.page, 40);
    await s.page.screenshot({ path: path.join(OUT, 't145-05-tour-walk.png') });
    await s.context.close();
  }
  // 3) 새 미션: 29일차 카페(queue_wait_tap) — 칩 탭 → 라운지 도착 → 주문 → '컵 나왔어요'
  {
    const s = await openDay(browser, 29);
    const has = await s.page.evaluate(() => window.__mtDay.missions.map((m) => m.def.id));
    await until(s.page, () => window.__mtDay.missions.find((m) => m.def.id === 'cafe')?.state === 'open', 3000);
    await s.page.evaluate(() => window.__mtDay.tapMission('cafe'));
    const f = await until(s.page, () => { const v = window.__mtDay.activityView(); return !!v && v.kind === 'queue' && v.stage !== 'order'; }, 3000);
    const info = await s.page.evaluate(() => ({ view: window.__mtDay.activityView(), sus: window.__mtDay.suspicion.toFixed(2), mods: window.__mtDay.content.missions.map((m) => `${m.id}:${(m.modifierIds || []).join('+')}`) }));
    await s.page.screenshot({ path: path.join(OUT, 't145-06-mission-cafe.png') });
    summary.push({ shot: 't145-06-mission-cafe', missions: has, frame: f, ...info, errors: s.errors.length });
    // 탭(창 안) → 성공 → 컵 들고 복귀
    await until(s.page, () => window.__mtDay.activityView()?.stage === 'window', 300);
    await s.page.evaluate(() => { const p = window.__mtDay.floor.player.tile; window.__mtDay.tapWorld(p.x, p.y); });
    await step(s.page, 30);
    summary.push({ shot: 'cafe-after-tap', state: await s.page.evaluate(() => window.__mtDay.missions.find((m) => m.def.id === 'cafe').state), errors: s.errors });
    await s.context.close();
  }
  console.log(JSON.stringify(summary, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
