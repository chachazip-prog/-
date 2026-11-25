/** T-141 BUG 재현: 설정(내 캐릭터)에서 바꾸고 타이틀로 돌아오면 'N일차 출근'·'내 캐릭터' 버튼이 사라지는지(실제 rAF). node tests/browser/t141-title-return.cjs [prodUrl] */
const { chromium } = require('playwright');
const path = require('node:path');
const PROD = process.argv[2] || 'http://localhost:5180/';
const SHOTS = path.resolve(__dirname, '../../../qa/screenshots');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { if (!sessionStorage.getItem('i')) { localStorage.clear(); localStorage.setItem('mt-mock:mt.player.variant', 'f'); localStorage.setItem('mt-mock:mt.progress.v1', JSON.stringify({ unlockedDay: 3 })); sessionStorage.setItem('i', '1'); } });
  await page.goto(PROD + '?platform=mock&sound=off', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const c = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, z: r.width / 180 }; });
  const tap = (lx, ly) => page.mouse.click(c.x + lx * c.z, c.y + ly * c.z);
  await page.screenshot({ path: path.join(SHOTS, 't141-20-title-before.png') });
  await tap(90, 287); await page.waitForTimeout(800);
  await tap(47, 110); await page.waitForTimeout(300);
  await tap(90, 273); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 't141-21-title-after-change-0.8s.png') });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, 't141-22-title-after-change-3.8s.png') });
  await tap(90, 287); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 't141-23-after-tap-settings-area.png') });
  await tap(90, 200); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 't141-24-after-tap-start.png') });
  // 같은 외형(남)을 다시 고르면 토스트 없음
  await tap(47, 110); await page.waitForTimeout(300); await tap(90, 273); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 't141-25-title-same-choice.png') });
  console.log(JSON.stringify({ errors }));
  await b.close();
})();
