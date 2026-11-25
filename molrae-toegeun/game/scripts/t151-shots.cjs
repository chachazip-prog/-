/**
 * T-151 스크린샷(개발자용). 사전 설치 Playwright + Chromium(재설치 금지), deviceScaleFactor 1, 가짜 rAF로 프레임 단위 진행.
 * 사용(game/ 에서, 개발 서버 실행 후): node scripts/t151-shots.cjs [http://localhost:5181/]
 * 출력: docs/screenshots/t151-*.png (캐릭터 선택 전·후, 같은 성별 본부장 전조·마주침, 시설 문 표지 남/여)
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
const step = (page, n) => page.evaluate((k) => window.__step(k), n);
async function until(page, fn, maxFrames = 6000, arg) {
  for (let f = 0; f < maxFrames; f += 10) { if (await page.evaluate(fn, arg)) return f; await step(page, 10); }
  return -1;
}
async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(FAKE_RAF);
  await page.goto(`${BASE}?sound=off${query}`, { waitUntil: 'load' });
  await until(page, () => !!window.__mtGame && window.__mtGame.scene.getScene('Title')?.sys.isActive(), 2000);
  return { context, page, errors };
}
async function startGame(s, day, pv) {
  await s.page.evaluate(([d, v]) => { const g = window.__mtGame; g.scene.getScenes(true).forEach((x) => { if (x.sys.settings.key !== 'Audio') g.scene.stop(x.sys.settings.key); }); window.__mtDay = undefined; g.scene.start('Game', { day: d, playerVariant: v }); }, [day, pv]);
  await until(s.page, () => !!window.__mtDay, 400);
  await until(s.page, () => window.__mtDay.phase === 'day', 600);
}
/** 카메라를 타일 y에 맞춤(플레이어를 그 근처 통행 칸으로 순간 이동) */
async function lookAt(s, tile) {
  await s.page.evaluate((t) => { const d = window.__mtDay; d.floor.player.teleport(t); d.floor.camera?.snap(d.floor.player.y); }, tile);
  await step(s.page, 4);
}
/** 캔버스(180×320 × 정수 배율) 영역만 */
async function shot(s, name) {
  const box = await s.page.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); return { x: c.x, y: c.y, width: c.width, height: c.height }; });
  await s.page.screenshot({ path: path.join(OUT, `${name}.png`), clip: box });
}

(async () => {
  const browser = await chromium.launch();
  const summary = [];
  // 1) 캐릭터 선택(첫 출근 전): 고르기 전(기본값 없음, 확인 비활성) → 고른 뒤
  {
    const s = await open(browser, '');
    const tap = async (x, y) => { const c = await s.page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, k: r.width / 180 }; }); await s.page.mouse.click(c.x + x * c.k, c.y + y * c.k); await step(s.page, 6); };
    await step(s.page, 30);
    await tap(90, 200);
    await until(s.page, () => window.__mtGame.scene.getScene('CharSelect')?.sys.isActive(), 300);
    await step(s.page, 4);
    await shot(s, 't151-01-charsel-empty');
    await tap(130, 110);
    await shot(s, 't151-02-charsel-selected');
    summary.push({ shot: 'charsel', active: await s.page.evaluate(() => window.__mtGame.scene.getScenes(true).map((x) => x.sys.settings.key)), errors: s.errors });
    await s.context.close();
  }
  // 2) 같은 성별 본부장 화장실 들름(C3): 전조(문 '!' + 같은 성별 표식) → 세면대 앞 마주침(머리 위 '!')
  for (const day of [20, 23, 30, 45, 49, 60]) {
    const s = await open(browser, '&v3=1&gender=1');
    await startGame(s, day, 'f');
    const info = await s.page.evaluate(() => { const f = window.__mtDay.content.facility; return { kind: f?.kind, stop: f?.stop?.relation, mine: f?.mineSide }; });
    if (info.stop !== 'same') { await s.context.close(); continue; }
    const f = await until(s.page, () => !!window.__mtDay.facilityStopView(), 60 * 70);
    if (f < 0) { summary.push({ day, info, note: '본부장이 길목을 지나지 않음' }); await s.context.close(); continue; }
    // 플레이어를 내 화장실 세면대 옆 바닥에 둠(칸 밖 = 위험 범위)
    await s.page.evaluate(() => { const d = window.__mtDay, m = d.content.facility.restroom.mine; const t = m.tiles.find((q) => !(q.x === m.stall.x && q.y === m.stall.y) && !(q.x === m.door.x && q.y === m.door.y) && !(m.sink && q.x === m.sink.x && q.y === m.sink.y)) ?? m.sink; d.floor.player.teleport(t); d.floor.camera?.snap(d.floor.player.y); });
    await step(s.page, 8);
    await shot(s, 't151-03-same-tell');
    const seen = await until(s.page, () => window.__mtDay.facilityStopView()?.cue === true, 600);
    await step(s.page, 6);
    await shot(s, 't151-04-same-meet');
    summary.push({ day, info, tellFrame: f, seenFrame: seen, sus: await s.page.evaluate(() => window.__mtDay.suspicion.toFixed(3)), errors: s.errors });
    await s.context.close();
    break;
  }
  // 3) 시설 문 표지: 같은 날 남/여 플레이어(내 쪽 = 하늘색 테두리, 다른 쪽 = 회색). 판정은 같고 그림만 다름
  for (const pv of ['m', 'f']) {
    const s = await open(browser, '&v3=1&gender=1');
    await startGame(s, 7, pv);
    const fac = await s.page.evaluate(() => window.__mtDay.content.facility);
    const d = fac.restroom.mine.door;
    await lookAt(s, { x: d.x + (d.x < 5 ? 1 : -1), y: Math.round((fac.restroom.mine.door.y + fac.restroom.other.door.y) / 2) });
    await shot(s, `t151-05-doors-${pv}`);
    summary.push({ shot: `doors-${pv}`, mine: fac.mineSide, mineDoor: d, otherDoor: fac.restroom.other.door, sign: await s.page.evaluate(() => window.__mtDay.content.skins.doorSign), errors: s.errors });
    await s.context.close();
  }
  console.log(JSON.stringify(summary, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
