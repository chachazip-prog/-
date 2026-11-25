/**
 * T-155 스크린샷(개발자용, T-159 K-02·Q-01 재촬영). 사전 설치 Playwright + Chromium(재설치 금지), deviceScaleFactor 1, 가짜 rAF로 프레임 단위 진행.
 * 사용(game/ 에서, 개발 서버 실행 후): node scripts/t155-shots.cjs [http://localhost:5181/]
 * 출력: docs/screenshots/t155-*.png (같은 성별 마주침 2배 확대, 시설 문 표지 남/여 2배 확대, 설정 캐릭터 화면)
 */
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
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


/** 논리 좌표(px) 사각형을 캔버스 배율 그대로 자른 뒤 2배 확대 캡처(최근접 보간 = 도트 유지) */
async function shotZoom(s, name, lx, ly, lw, lh) {
  const c = await s.page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, k: r.width / 180 }; });
  const x0 = Math.max(0, Math.min(180 - lw, lx)), y0 = Math.max(0, Math.min(320 - lh, ly));
  const buf = await s.page.screenshot({ clip: { x: c.x + x0 * c.k, y: c.y + y0 * c.k, width: lw * c.k, height: lh * c.k } });
  const b64 = buf.toString('base64');
  const out = await s.page.evaluate(async ([data, z]) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width * z; cv.height = img.height * z;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png').split(',')[1];
  }, [b64, 2]);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(out, 'base64'));
}
/** 타일 → 화면 논리 좌표 */
const scr = (s, t) => s.page.evaluate((q) => { const sc = window.__mtScene ?? window.__mtGame.scene.getScene('Game'); const cam = sc.cameras.main; return { x: sc.offsetX + q.x * 16 + 8 - cam.scrollX, y: q.y * 16 + 8 - cam.scrollY }; }, t);

(async () => {
  const browser = await chromium.launch();
  const summary = [];
  // 1) 같은 성별 본부장 마주침(K-02): 표식이 말풍선보다 위, 시설 장면 말풍선 ≤ 2
  for (const day of [20, 23, 30, 45, 49, 60, 66, 75, 80]) {
    const s = await open(browser, '&v3=1&gender=1');
    await startGame(s, day, 'f');
    const info = await s.page.evaluate(() => { const f = window.__mtDay.content.facility; return { kind: f?.kind, stop: f?.stop?.relation, mine: f?.mineSide }; });
    if (info.stop !== 'same') { await s.context.close(); continue; }
    const f = await until(s.page, () => !!window.__mtDay.facilityStopView(), 60 * 70);
    if (f < 0) { summary.push({ day, info, note: '본부장이 길목을 지나지 않음' }); await s.context.close(); continue; }
    // 들름 시작(전조) 순간: 본부장 머리 위 같은/다른 성별 표식(mark/gender_*) 2배 확대
    await s.page.evaluate(() => { const d = window.__mtDay, v = d.facilityStopView(); d.floor.camera?.snap(v.npc.y); });
    await step(s.page, 2);
    { const v0 = await s.page.evaluate(() => { const v = window.__mtDay.facilityStopView(); const sc = window.__mtScene; const vw = sc.views.get(v.npc); return { x: Math.floor(v.npc.x), y: Math.floor(v.npc.y), mark: vw?.mark.visible ? vw.mark.frame.name : null }; });
      const p0 = await scr(s, v0); await shotZoom(s, 't155-03-same-tell-x2', Math.round(p0.x - 45), Math.round(p0.y - 60), 90, 80); summary.push({ tellMark: v0.mark }); }
    await s.page.evaluate(() => { const d = window.__mtDay, m = d.content.facility.restroom.mine; const t = m.tiles.find((q) => !(q.x === m.stall.x && q.y === m.stall.y) && !(q.x === m.door.x && q.y === m.door.y) && !(m.sink && q.x === m.sink.x && q.y === m.sink.y)) ?? m.sink; d.floor.player.teleport(t); d.floor.camera?.snap(d.floor.player.y); });
    await step(s.page, 8);
    const seen = await until(s.page, () => window.__mtDay.facilityStopView()?.cue === true, 600);
    await step(s.page, 6);
    await shot(s, 't155-04-same-meet');
    const npcTile = await s.page.evaluate(() => { const v = window.__mtDay.facilityStopView(); return v ? { x: Math.floor(v.npc.x), y: Math.floor(v.npc.y) } : null; });
    if (npcTile) { const p = await scr(s, npcTile); await shotZoom(s, 't155-04-same-meet-x2', Math.round(p.x - 45), Math.round(p.y - 60), 90, 80); }
    const ui = await s.page.evaluate(() => {
      const sc = window.__mtScene ?? window.__mtGame.scene.getScene('Game');
      const vis = sc.children.list.filter((o) => o.visible && o.type === 'Rectangle' && o.depth >= 5001 && o.depth <= 5003 && o.fillAlpha > 0.85 && o.width > 8).length;
      const v = window.__mtDay.facilityStopView(); const view = v ? sc.views.get(v.npc) : null;
      return { bubblePanels: vis, markFrame: view?.mark.visible ? view.mark.frame.name : null, markDepth: view?.mark.depth, maxBubbleDepth: Math.max(...sc.children.list.filter((o) => o.visible && o.depth >= 5000 && o.depth < 6000 && o !== view?.mark).map((o) => o.depth)) };
    });
    summary.push({ day, info, tellFrame: f, seenFrame: seen, ui, errors: s.errors });
    await s.context.close();
    break;
  }
  // 2) 시설 문 표지(Q-01): 같은 날 남/여 플레이어. 문 두 개를 2배 확대
  for (const pv of ['m', 'f']) {
    const s = await open(browser, '&v3=1&gender=1');
    await startGame(s, 7, pv);
    const fac = await s.page.evaluate(() => window.__mtDay.content.facility);
    const d = fac.restroom.mine.door, o = fac.restroom.other.door;
    await lookAt(s, { x: d.x + (d.x < 5 ? 1 : -1), y: Math.round((d.y + o.y) / 2) });
    await shot(s, `t155-05-doors-${pv}`);
    const a = await scr(s, d), b = await scr(s, o);
    const top = Math.min(a.y, b.y) - 30, h = Math.abs(a.y - b.y) + 50;
    await shotZoom(s, `t155-05-doors-${pv}-x2`, 0, Math.round(top), 180, Math.min(160, Math.round(h)));
    summary.push({ shot: `doors-${pv}`, mine: fac.mineSide, mineDoor: d, otherDoor: o, sign: await s.page.evaluate(() => window.__mtDay.content.skins.doorSign), errors: s.errors });
    await s.context.close();
  }
  // 3) 설정 '내 캐릭터' 화면(직급 없는 라벨)
  {
    const s = await open(browser, '');
    await s.page.evaluate(() => { const g = window.__mtGame; g.scene.getScenes(true).forEach((x) => { if (x.sys.settings.key !== 'Audio') g.scene.stop(x.sys.settings.key); }); g.scene.start('CharSelect', { mode: 'change', current: 'f' }); });
    await step(s.page, 10);
    await shot(s, 't155-06-settings-character');
    summary.push({ shot: 'settings', errors: s.errors });
    await s.context.close();
  }
  console.log(JSON.stringify(summary, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
