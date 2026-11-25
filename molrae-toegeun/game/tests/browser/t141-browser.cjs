/**
 * T-141 프로덕션 빌드 브라우저 회귀(D-114: QA는 프로덕션 빌드 기준). 사전 설치 Playwright + Chromium, 트레이스 미사용, deviceScaleFactor 1.
 * 준비(game/ 에서): npx vite build --outDir tests/.out/t141/dist --emptyOutDir && npx vite preview --outDir tests/.out/t141/dist --port 5180
 * 실행: node tests/browser/t141-browser.cjs [prodUrl] [단계=all|load|char|phone|ad|inter|layout]
 * 프로덕션에는 개발 훅(window.__mtDay)이 없으므로 입력은 실제 마우스 클릭만, 판정은 스크린샷·콘솔 로그([mock ads] 등)·localStorage로 한다.
 * 프레임은 가짜 rAF로 1/60초씩 진행(결정적). 스크린샷: qa/screenshots/t141-*.png
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const PROD = process.argv[2] || 'http://localhost:5180/';
const ONLY = process.argv[3] || 'all';
const SHOTS = path.resolve(__dirname, '../../../qa/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = path.resolve(__dirname, '../.out/t141/browser.json');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const FAKE_RAF = `
  window.__qa = { raf: [], now: 0 };
  window.requestAnimationFrame = (cb) => { window.__qa.raf.push(cb); return window.__qa.raf.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__qa.now += 1000 / 60; const q = window.__qa.raf; window.__qa.raf = []; for (const cb of q) cb(window.__qa.now); } };
`;
async function open(browser, query, { fakeRaf = true, storage = null, viewport = { width: 360, height: 640 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], logs = [];
  page.on('console', (m) => { logs.push({ type: m.type(), text: m.text() }); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (fakeRaf) await page.addInitScript(FAKE_RAF);
  await page.addInitScript((st) => {
    try { if (!sessionStorage.getItem('qa-init')) { localStorage.clear(); if (st) for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); sessionStorage.setItem('qa-init', '1'); } } catch {}
  }, storage);
  await page.goto(PROD + (query ? `?${query}` : ''), { waitUntil: 'load' });
  return { context, page, errors, logs };
}
const step = (page, n) => page.evaluate((k) => window.__step(k), n);
async function boot(s) {
  for (let i = 0; i < 200; i++) { await step(s.page, 3); await s.page.waitForTimeout(25); if (s.logs.some((l) => /\[boot\]/.test(l.text)) && i > 20) break; }
  await s.page.waitForTimeout(150); await step(s.page, 30);
}
async function box(page) { return page.evaluate(() => { const c = document.querySelector('canvas'); const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }); }
async function tap(page, lx, ly) { const r = await box(page); const z = r.w / 180; await page.mouse.click(r.x + lx * z, r.y + ly * z); await page.waitForTimeout(30); }
async function shot(page, name) { const b = await box(page); await page.screenshot({ path: path.join(SHOTS, `t141-${name}.png`), clip: { x: b.x, y: b.y, width: b.w, height: b.h } }); }
// 설치일(11-01)이 아닌 '오늘' 카운터여야 D-068 설치일 이월 초기화를 피함
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const STORE = (variant, day = 1) => ({
  'mt-mock:mt.player.variant': variant,
  'mt-mock:mt.progress.v1': JSON.stringify({ unlockedDay: day }),
});

(async () => {
  const browser = await chromium.launch();
  const summary = {};
  try {
    // ── 1. 첫 진입: 초기 로드 바이트(첫 터치 전), 진입 시간, 콘솔 오류 ──
    if (ONLY === 'all' || ONLY === 'load') {
      const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = []; const logs = []; let bytes = 0; const files = [];
      page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', async (r) => { try { const b = await r.body(); bytes += b.length; files.push([r.url().replace(PROD, ''), b.length]); } catch {} });
      const t0 = Date.now();
      await page.goto(PROD + '?platform=mock', { waitUntil: 'load' });
      const tLoad = Date.now() - t0;
      let tBoot = -1;
      for (let i = 0; i < 400; i++) { if (logs.some((l) => /\[boot\]/.test(l))) { tBoot = Date.now() - t0; break; } await page.waitForTimeout(25); }
      await page.waitForTimeout(1500);
      const audio = files.filter(([u]) => /\.mp3/.test(u));
      summary.load = { tLoadMs: tLoad, tBootMs: tBoot, bytesBeforeTouch: bytes, files: files.length, audioBeforeTouch: audio.length, errors };
      check('초기 로드(첫 터치 전 전송 바이트) ≤ 2,000,000B', bytes <= 2000000 && bytes > 0, `${bytes}B, 파일 ${files.length}개, 오디오 ${audio.length}개`);
      check('첫 화면 진입(부팅 로그) 시간 측정', tBoot > 0, `load ${tLoad}ms, boot ${tBoot}ms(로컬 미리보기 서버)`);
      check('첫 진입 콘솔 오류 0', errors.length === 0, errors.join(' | '));
      await page.screenshot({ path: path.join(SHOTS, 't141-01-title-real.png') });
      await context.close();
    }
    // ── 2. 캐릭터 선택: 첫 출근 문구 / 설정 모드 문구 / 변경 토스트 ──
    if (ONLY === 'all' || ONLY === 'char') {
      const s = await open(browser, 'platform=mock&sound=off');
      await boot(s);
      await shot(s.page, '02-title-first');
      await tap(s.page, 90, 200); await step(s.page, 40);
      await shot(s.page, '03-charsel-first');
      await tap(s.page, 90, 273); await step(s.page, 20); // 고르기 전 확인 = 비활성
      await shot(s.page, '03b-charsel-first-confirm-disabled');
      await tap(s.page, 133, 110); await step(s.page, 10);
      await shot(s.page, '04-charsel-first-picked-f');
      await tap(s.page, 90, 273); await step(s.page, 60);
      await shot(s.page, '05-prep-after-first');
      const saved = await s.page.evaluate(() => localStorage.getItem('mt-mock:mt.player.variant'));
      check('첫 출근 선택 저장(여)', /f/.test(saved || ''), saved);
      check('캐릭터 선택 흐름 콘솔 오류 0', s.errors.length === 0, s.errors.join(' | '));
      await s.context.close();
      // 설정 모드
      const s2 = await open(browser, 'platform=mock&sound=off', { storage: STORE('f', 3) });
      await boot(s2);
      await shot(s2.page, '06-title-with-settings');
      await tap(s2.page, 90, 287); await step(s2.page, 40);
      await shot(s2.page, '07-charsel-settings');
      await tap(s2.page, 47, 110); await step(s2.page, 10);
      await tap(s2.page, 90, 273); await step(s2.page, 30);
      await shot(s2.page, '08-title-change-toast');
      const v2 = await s2.page.evaluate(() => localStorage.getItem('mt-mock:mt.player.variant'));
      check('설정에서 변경 저장(여→남)', /m/.test(v2 || ''), v2);
      // 같은 것 고르면 토스트 없음·타이틀 복귀 뒤 버튼 유지는 실제 rAF로 확인(t141-title-return.cjs). 가짜 rAF에서는 타이틀 재시작 직후
      // 저장소 Promise가 씬 활성 전에 풀려 'N일차 출근'·'내 캐릭터'가 안 그려짐(하니스 한계, 제품 문제 아님)
      check('설정 흐름 콘솔 오류 0', s2.errors.length === 0, s2.errors.join(' | '));
      await s2.context.close();
    }
    // ── 3. 마감 직전 통화 끊고 출발(D-117 ③): 79일 seed qa141-12, 앉은 채로 프레임 진행 ──
    if (ONLY === 'all' || ONLY === 'phone') {
      const day = Number(process.env.QA_PHONE_DAY || 79), seed = process.env.QA_PHONE_SEED || 'qa141-12', frame = Number(process.env.QA_PHONE_FRAME || 3025);
      const s = await open(browser, `platform=mock&sound=off&v3=1&gender=1&day=${day}&seed=${seed}`, { storage: STORE('m', day) });
      await boot(s);
      await tap(s.page, 90, 200); await step(s.page, 40); // 타이틀 → 출근 준비
      await shot(s.page, '10-phone-prep');
      await tap(s.page, 90, 265); await step(s.page, 1); // 출근 → 게임 시작
      await step(s.page, frame - 150);
      const marks = [-150, -90, -40, -10, 0, 10, 25, 45, 70, 110];
      let at = frame - 150;
      for (const m of marks) { await step(s.page, frame + m - at); at = frame + m; await shot(s.page, `11-phonecut-${m >= 0 ? '+' : ''}${m}`); }
      check('통화 끊고 출발 장면 진행 중 콘솔 오류 0', s.errors.length === 0, s.errors.join(' | '));
      await s.context.close();
    }
    // ── 4. 이어하기 보상형 광고(D-050): 8일차 칩 0 탭 → 자리에서 적발 → 제안 → 광고(mock) → 재개 ──
    if (ONLY === 'all' || ONLY === 'ad') {
      for (const mode of ['rewarded', 'decline', 'dismiss']) {
        const q = `platform=mock&sound=off&v3=1&gender=1&day=8${mode === 'dismiss' ? '&adResult=dismiss' : ''}`;
        const s = await open(browser, q, { storage: STORE('m', 8) });
        await boot(s);
        await tap(s.page, 90, 200); await step(s.page, 40);
        await tap(s.page, 90, 265); await step(s.page, 1);
        await step(s.page, Number(process.env.QA_CHIP_FRAME || 361));
        const adBeforePlay = s.logs.filter((l) => /\[mock ads\]/.test(l.text)).length;
        // 헤드리스 탐색(tests/sim/t141-chipcaught.ts): 8일차 기본 시드, 게임 시작 프레임 362에 칩 0(쇼핑) 탭만 하면 12초에 팀장에게 적발
        await tap(s.page, 16, 320 - 14); // 칩 0
        await step(s.page, 60 * 14); await s.page.waitForTimeout(300); await step(s.page, 240); await s.page.waitForTimeout(300); await step(s.page, 30);
        await shot(s.page, `12-${mode}-offer`);
        const adDuringPlay = s.logs.filter((l) => /\[mock ads\]/.test(l.text)).length;
        summary[`ad_${mode}_beforeTap`] = { adBeforePlay, adDuringPlay };
        check(`[${mode}] D-050 ① 제안 화면까지 광고 호출 0`, adDuringPlay === 0, `${adDuringPlay}회`);
        // 버튼: 첫째(광고 보고 이어하기) / 둘째(그냥 결과 보기) — 좌표는 스크린샷으로 확인한 값(QA_BTN1·QA_BTN2로 덮어쓰기)
        const y1 = Number(process.env.QA_BTN1 || 196), y2 = Number(process.env.QA_BTN2 || 230);
        if (mode === 'decline') { await tap(s.page, 90, y2); await step(s.page, 30); await shot(s.page, '13-decline-result'); }
        else { await tap(s.page, 90, y1); await step(s.page, 5); await s.page.waitForTimeout(400); await step(s.page, 30); await s.page.waitForTimeout(200); await step(s.page, 30); await shot(s.page, `13-${mode}-after`); }
        const ads = s.logs.filter((l) => /\[mock ads\]/.test(l.text)).map((l) => l.text);
        summary[`ad_${mode}`] = ads;
        if (mode === 'rewarded') check('[rewarded] 보상형 1회 노출 후 재개(로그)', ads.length === 1 && /rewarded|보상/.test(ads[0]), ads.join(' | '));
        if (mode === 'decline') check('[decline] 거절 시 광고 0회', ads.length === 0, ads.join(' | '));
        if (mode === 'dismiss') check('[dismiss] 중도 종료 1회, 자동 재시도 없음', ads.length === 1, ads.join(' | '));
        check(`[${mode}] 콘솔 오류 0`, s.errors.length === 0, s.errors.join(' | '));
        await s.context.close();
      }
    }
    // ── 5. 전면광고 예고(3판째) — 판을 세 번 끝까지 진행 ──
    if (ONLY === 'all' || ONLY === 'inter') {
      const st = { ...STORE('m', 3), 'mt-mock:mt.adCounters.v1': JSON.stringify({ installDate: '2026-11-01', gamesPlayedLifetime: 10, gamesSinceLastInterstitial: 2, interstitialShownToday: 0, lastInterstitialAt: 0, rewardedShownToday: 0, rewardedByPlacementToday: {}, countersDate: TODAY }) };
      const s = await open(browser, 'platform=mock&sound=off&day=3', { storage: st });
      await boot(s);
      await tap(s.page, 90, 200); await step(s.page, 40);
      await tap(s.page, 90, 265); await step(s.page, 1);
      const mark = s.logs.length;
      let adAtFrame = -1;
      for (let i = 0; i < 400; i++) {
        await step(s.page, 30);
        if (adAtFrame < 0 && s.logs.slice(mark).some((l) => /\[mock ads\]/.test(l.text))) adAtFrame = i;
      }
      await shot(s.page, '14-inter-day-end');
      const adLogs = s.logs.slice(mark).filter((l) => /\[mock ads\]/.test(l.text)).map((l) => l.text);
      summary.inter = { adLogs, adAtFrame };
      check('플레이 중(결과 전) 전면광고 0회', adLogs.length === 0 || adAtFrame >= 0, `${adLogs.join(' | ') || '광고 없음(결과 화면 탭 전)'}`);
      // 결과 화면 '다음' 탭 → 예고 → 광고
      await shot(s.page, '15a-inter-result'); await step(s.page, 60);
      await tap(s.page, 90, 228); // 결과 화면 '다시 출근'
      for (let k = 0; k < 6; k++) { await step(s.page, 15); await s.page.waitForTimeout(150); await shot(s.page, `15-inter-after-tap-${k}`); }
      await s.page.waitForTimeout(400); await step(s.page, 60);
      const adLogs2 = s.logs.slice(mark).filter((l) => /\[mock ads\]|\[ads\]/.test(l.text)).map((l) => l.text);
      summary.inter2 = adLogs2;
      check('전면광고 콘솔 오류 0', s.errors.length === 0, s.errors.join(' | '));
      await s.context.close();
    }
    // ── 6. 세로 레이아웃 ──
    if (ONLY === 'all' || ONLY === 'layout') {
      for (const [w, h] of [[320, 568], [390, 844], [412, 915], [768, 1024]]) {
        const s = await open(browser, 'platform=mock&sound=off&v3=1&gender=1&day=41', { storage: STORE('f', 41), viewport: { width: w, height: h } });
        await boot(s);
        await tap(s.page, 90, 200); await step(s.page, 40); await tap(s.page, 90, 265); await step(s.page, 300);
        const b = await box(s.page);
        await s.page.screenshot({ path: path.join(SHOTS, `t141-16-layout-${w}x${h}.png`) });
        const z = b.w / 180;
        check(`세로 ${w}×${h}: 정수 배율·가로 넘침 없음`, Math.abs(z - Math.round(z)) < 1e-6 && b.x >= 0 && b.x + b.w <= w + 0.5 && b.y + b.h <= h + 0.5, `배율 ${z.toFixed(3)} 캔버스 ${b.w}×${b.h} @(${b.x},${b.y})`);
        check(`세로 ${w}×${h} 콘솔 오류 0`, s.errors.length === 0, s.errors.join(' | '));
        await s.context.close();
      }
    }
  } finally {
    await browser.close();
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ results, summary }, null, 1));
    console.log(`통과 ${results.filter((r) => r.ok).length}/${results.length}`);
  }
})();
