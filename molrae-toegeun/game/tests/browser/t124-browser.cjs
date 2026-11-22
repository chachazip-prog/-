/**
 * T-124 브라우저 자동 플레이 테스트 (사전 설치 Playwright + Chromium, 재설치 금지).
 * 사용: 개발 서버(5179)와 빌드 미리보기(5180)를 먼저 띄운 뒤
 *   node tests/browser/t124-browser.cjs [devUrl] [prodUrl]
 * 트레이스는 기록하지 않는다(--trace off 상당: context.tracing 미사용). 스크린샷은 deviceScaleFactor 1.
 * 개발 서버에서는 requestAnimationFrame을 가짜 시계로 바꿔 프레임 단위로 진행·판독한다.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const DEV = process.argv[2] || 'http://localhost:5179/';
const PROD = process.argv[3] || 'http://localhost:5180/';
const SHOTS = path.resolve(__dirname, '../../../qa/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const info = (m) => console.log(`  · ${m}`);

const FAKE_RAF = `
  window.__qa = { raf: [], now: 0 };
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

async function openPage(browser, url, viewport, { fakeRaf }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], warnings = [], logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
    logs.push({ t: Date.now(), type: m.type(), text: m.text() });
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (fakeRaf) await page.addInitScript(FAKE_RAF);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  return { context, page, errors, warnings, logs, t0 };
}

/** 캔버스 논리 좌표(180×320) → 페이지 좌표 */
async function toPage(page, lx, ly) {
  const r = await page.evaluate(() => { const c = document.querySelector('#game canvas'); const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; });
  const z = r.w / 180;
  return { x: r.x + (lx + 0.5) * z, y: r.y + (ly + 0.5) * z };
}
async function tapLogical(page, lx, ly) {
  const p = await toPage(page, lx, ly);
  await page.mouse.click(p.x, p.y);
}
const step = (page, n) => page.evaluate((k) => window.__step(k), n);

async function startGame(page) {
  await step(page, 10);
  await tapLogical(page, 90, 200); // 타이틀: pointerup → GameScene
  await step(page, 10);
  return page.evaluate(() => !!window.__mtSim);
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ── A. 빌드 미리보기: 첫 화면 진입 시간·콘솔 에러·실제 탭 플레이
    {
      const vp = { width: 360, height: 640 };
      const s = await openPage(browser, PROD, vp, { fakeRaf: false });
      const loadMs = Date.now() - s.t0;
      // 타이틀 렌더까지: [boot] 로그 대기
      const tBoot = await (async () => {
        for (let i = 0; i < 200; i++) {
          const l = s.logs.find((x) => x.text.startsWith('[boot]'));
          if (l) return l.t - s.t0;
          await new Promise((r) => setTimeout(r, 25));
        }
        return -1;
      })();
      const nav = await s.page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
      await s.page.waitForTimeout(300);
      await s.page.screenshot({ path: path.join(SHOTS, 't124-prod-01-title-360x640.png') });
      check('빌드본 첫 화면(타이틀) 진입 < 3초 (로컬 미리보기 기준)', tBoot > 0 && tBoot < 3000, `load ${loadMs}ms, DCL ${nav.dcl.toFixed(0)}ms, [boot] 로그까지 ${tBoot}ms`);
      check('빌드본에 개발 훅(window.__mtSim) 없음', !(await s.page.evaluate(() => 'mtSim' in window || '__mtSim' in window)));
      await tapLogical(s.page, 90, 200);
      await s.page.waitForTimeout(400);
      // 실제 탭으로 위쪽 이동 → 이동 중 탭 → 재출발
      await tapLogical(s.page, 90, 40);
      await s.page.waitForTimeout(700);
      await s.page.screenshot({ path: path.join(SHOTS, 't124-prod-02-moving.png') });
      await tapLogical(s.page, 30, 200);
      await s.page.waitForTimeout(300);
      await s.page.screenshot({ path: path.join(SHOTS, 't124-prod-03-stopped-disguise.png') });
      // 4초 간격으로 위쪽 탭 반복 (상태를 읽을 수 없으므로 시간 기반)
      for (let k = 0; k < 6; k++) { await tapLogical(s.page, 90, 40); await s.page.waitForTimeout(3500); }
      await s.page.screenshot({ path: path.join(SHOTS, 't124-prod-04-after-taps.png') });
      check('빌드본 플레이 중 콘솔 에러 0', s.errors.length === 0, s.errors.slice(0, 3).join(' | '));
      info(`빌드본 경고 ${s.warnings.length}건 ${s.warnings.slice(0, 2).join(' | ')}`);
      await s.context.close();
    }

    // ── B. 개발 서버(가짜 RAF): 입력·결과 재시작·시드·경고 화살표
    const vp = { width: 360, height: 640 };
    {
      const s = await openPage(browser, DEV, vp, { fakeRaf: true });
      const page = s.page;
      check('개발 서버: GameScene 진입·__mtSim 노출', await startGame(page));
      const z = await page.evaluate(() => document.querySelector('#game canvas').getBoundingClientRect().width / 180);
      info(`360×640 배율 ${z}`);
      // 타일 탭 → 그 타일로 이동 (시작 시 카메라 scrollY = 672 고정: 플레이어 y57, 맵 하단 클램프)
      const st0 = await page.evaluate(() => ({ mode: __mtSim.player.mode, steps: __mtSim.steps }));
      await tapLogical(page, 2 + 8 * 16 + 8, 59 * 16 + 8 - 672);
      let st = await page.evaluate(() => ({ mode: __mtSim.player.mode, dest: __mtSim.destination }));
      check('화면 탭(타일 8,59) → moving, 목적지 (8,59)', st0.mode === 'idle' && st.mode === 'moving' && st.dest && st.dest.x === 8 && st.dest.y === 59, JSON.stringify(st));
      await step(page, 12);
      await page.screenshot({ path: path.join(SHOTS, 't124-dev-01-path.png') });
      await tapLogical(page, 20, 100);
      st = await page.evaluate(() => ({ mode: __mtSim.player.mode, dest: __mtSim.destination }));
      check('이동 중 화면 탭 → 정지·위장(disguised)', st.mode === 'disguised', JSON.stringify(st));
      await step(page, 2);
      await page.screenshot({ path: path.join(SHOTS, 't124-dev-02-disguise.png') });
      await tapLogical(page, 90, 8); // HUD
      st = await page.evaluate(() => ({ mode: __mtSim.player.mode }));
      check('위장 중 HUD 영역 탭 → 이동 명령 아님', st.mode === 'disguised', JSON.stringify(st));
      // 벽 탭(왼쪽 벽 x=0, y=58) → 보정 이동
      await tapLogical(page, 2 + 0 * 16 + 8, 58 * 16 + 8 - 672);
      st = await page.evaluate(() => ({ mode: __mtSim.player.mode, dest: __mtSim.destination }));
      check('벽 타일 탭 → 반경 안 통행 타일로 보정 이동', st.mode === 'moving' && st.dest && st.dest.x === 1 && st.dest.y === 58, JSON.stringify(st));
      await step(page, 120);

      // 출구까지 실제 탭으로 진행 (idle/disguised일 때만 화면 위쪽 탭, 위장 없음)
      const xs = [90, 74, 106, 58, 122, 42, 138];
      let k = 0, frames = 0;
      while (frames < 60 * 120) {
        const o = await page.evaluate(() => ({ out: __mtSim.outcome, mode: __mtSim.player.mode }));
        if (o.out !== 'playing') break;
        if (o.mode === 'idle' || o.mode === 'disguised') { await tapLogical(page, xs[k % xs.length], 26); k++; }
        await step(page, 20); frames += 20;
      }
      const end = await page.evaluate(() => ({ out: __mtSim.outcome, t: __mtSim.time, peak: __mtSim.suspicion.peak }));
      info(`실제 탭 플레이 결과 ${end.out}, ${end.t.toFixed(1)}초, 최고 의심 ${(end.peak * 100).toFixed(0)}%, 탭 ${k}회`);
      await step(page, 2);
      await page.screenshot({ path: path.join(SHOTS, `t124-dev-03-result-${end.out}.png`) });
      check('실제 탭만으로 판 종료(결과 화면) 도달', end.out !== 'playing');
      const simBefore = await page.evaluate(() => { window.__oldSim = __mtSim; return __mtSim.steps; });
      await tapLogical(page, 90, 160);
      await step(page, 3);
      const after = await page.evaluate(() => ({ fresh: window.__oldSim !== __mtSim, out: __mtSim.outcome, steps: __mtSim.steps, mode: __mtSim.player.mode, y: __mtSim.player.y }));
      check('결과 화면 탭 → 재시작(새 sim, playing, 시작 위치)', after.fresh && after.out === 'playing' && after.steps < 10 && Math.abs(after.y - 57.5) < 1e-9, `${JSON.stringify(after)} (이전 steps ${simBefore})`);
      await page.screenshot({ path: path.join(SHOTS, 't124-dev-04-restarted.png') });

      // 들킴 결과 화면 (하네스 조작: 이동 중 의심을 1로 설정 → 다음 스텝 caught)
      await page.evaluate(() => { __mtSim.tap(5, 1); });
      await step(page, 5);
      await page.evaluate(() => { __mtSim.suspicion.value = 1; });
      await step(page, 2);
      const c = await page.evaluate(() => __mtSim.outcome);
      await page.screenshot({ path: path.join(SHOTS, 't124-dev-05-result-caught.png') });
      check('들킴(caught) 결과 화면 표시', c === 'caught');
      // 들킨 직후 '연타' 탭: 결과 화면이 바로 넘어가는지(UX 확인)
      await page.evaluate(() => { window.__oldSim = __mtSim; });
      await tapLogical(page, 90, 160);
      await step(page, 1);
      const skipped = await page.evaluate(() => window.__oldSim !== __mtSim);
      info(`결과 표시 2프레임 뒤 탭 → ${skipped ? '즉시 재시작(입력 보호 시간 없음)' : '무시됨'}`);

      // 화면 밖 경고 화살표 픽셀 검증
      const arrowFn = async ([seed, acc]) => {
        const out = acc;
        const T = 16, OFF = 2, HUD = 18, LW = 180, LH = 320;
        const canvas = document.querySelector('#game canvas');
        const o = document.createElement('canvas'); o.width = LW; o.height = LH;
        const ctx = o.getContext('2d', { willReadFrequently: true });
        const COLORS = { approaching: [0xe0, 0xb0, 0x20], seeing: [0xd0, 0x2a, 0x2a], turning: [0xd0, 0x2a, 0x2a] };
        const px = (d, x, y) => { const i = (y * LW + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        const near = (a, b, tol = 14) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
        const isWhite = (a) => a[0] >= 240 && a[1] >= 240 && a[2] >= 240;
        const sig = (d, ex, ey, color, s) => {
          if (!near(px(d, ex, ey), color)) return false;
          let w = 0;
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const x = Math.round(ex + Math.cos(a) * (s + 1.4)), y = Math.round(ey + Math.sin(a) * (s + 1.4));
            if (x < 0 || y < 0 || x >= LW || y >= LH) continue;
            if (isWhite(px(d, x, y))) w++;
          }
          return w >= 5;
        };
        const anyArrow = (d, ex, ey) => sig(d, ex, ey, COLORS.approaching, 5) || sig(d, ex, ey, COLORS.seeing, 6) || sig(d, ex, ey, COLORS.seeing, 5);
        // 카메라 복제: create 시 camY = target, 이후 매 프레임 지수 추적(dt=1/60)
        const target = (sim) => Math.min(sim.map.height * T - LH, Math.max(-HUD, sim.player.y * T - LH * 0.6));
        {
          const sim = window.__mtSim;
          let camY = target(sim);
          const tr = { s: seed * 7919 + 1 };
          const rnd = () => { tr.s = (tr.s * 16807) % 2147483647; return tr.s / 2147483647; };
          for (let f = 0; f < 2400 && sim.outcome === 'playing'; f++) {
            // 단순 봇: 가끔 출구/무작위 지점 탭
            if ((sim.player.mode === 'idle' || sim.player.mode === 'disguised') && rnd() < 0.05) sim.tap(rnd() < 0.6 ? 5 : Math.floor(rnd() * 11), rnd() < 0.6 ? 1 : Math.floor(rnd() * 62));
            else if (sim.player.mode === 'moving' && rnd() < 0.01) sim.tap(0, 0);
            sim.suspicion.value = Math.min(sim.suspicion.value, 0.5);
            window.__step(1);
            ctx.drawImage(canvas, 0, 0, LW, LH);
            const tg = target(sim);
            camY += (tg - camY) * (1 - Math.exp(-8 / 60));
            if (Math.abs(tg - camY) < 0.25) camY = tg;
            const scrollY = Math.round(camY);
            const d = ctx.getImageData(0, 0, LW, LH).data;
            out.frames++;
            const npcs = sim.npcs.map((n, i) => {
              const wx = OFF + n.x * T, wy = n.y * T;
              const sy = wy - scrollY;
              const th = sim.threatOf(i);
              const offTop = sy < HUD - 4 - 6, offBot = sy > LH + 4 + 6;
              const onScr = sy > HUD + 2 && sy < LH - 2;
              const ex = Math.round(Math.min(LW - 7, Math.max(7, wx)));
              return { i, th, offTop, offBot, onScr, ex };
            });
            for (const n of npcs) {
              const others = npcs.filter((m) => m !== n && Math.abs(m.ex - n.ex) < 18);
              for (const ey of [25, 313]) {
                const expectedHere = (ey === 25 ? n.offTop : n.offBot);
                const found = anyArrow(d, n.ex, ey);
                if (expectedHere && (n.th === 'seeing' || n.th === 'approaching')) {
                  out.expectArrow++;
                  if (found) out.foundArrow++; else { out.missing++; if (out.samples.length < 6) out.samples.push({ f, kind: 'missing', ...n, ey, scrollY }); }
                } else if (expectedHere && n.th === 'none' && others.length === 0) {
                  out.noneChecks++;
                  if (found) { out.falseArrow++; if (out.samples.length < 6) out.samples.push({ f, kind: 'false', ...n, ey, scrollY }); }
                } else if (n.onScr && others.length === 0) {
                  out.onChecks++;
                  if (found) { out.onscreenArrow++; if (out.samples.length < 6) out.samples.push({ f, kind: 'onscreen', ...n, ey, scrollY }); }
                }
              }
            }
            if (f === 300 && seed === 0) window.__shotNow = true;
          }
        }
        return out;
      };
      let arrow = { frames: 0, expectArrow: 0, foundArrow: 0, missing: 0, falseArrow: 0, onscreenArrow: 0, noneChecks: 0, onChecks: 0, samples: [] };
      for (const seed of [0, 1, 2, 3]) {
        const o2 = await page.evaluate(() => __mtSim.outcome);
        if (o2 !== 'playing') { await tapLogical(page, 90, 160); await step(page, 2); }
        arrow = await page.evaluate(arrowFn, [seed, arrow]);
        await page.evaluate(() => { const s = __mtSim; s.tap(5, 1); s.suspicion.value = 1; });
        await step(page, 2);
        if ((await page.evaluate(() => __mtSim.outcome)) === 'playing') { await page.evaluate(() => { __mtSim.tap(5, 1); __mtSim.suspicion.value = 1; }); await step(page, 2); }
      }

      info(`화살표 픽셀 판독: ${arrow.frames}프레임, 기대 ${arrow.expectArrow}, 발견 ${arrow.foundArrow}, 누락 ${arrow.missing}, threat=none 검사 ${arrow.noneChecks}, 화면 안 검사 ${arrow.onChecks}`);
      if (arrow.samples.length) info(`샘플: ${JSON.stringify(arrow.samples.slice(0, 4))}`);
      check('화면 밖 + threat(seeing/approaching) → 화살표 표시', arrow.expectArrow > 50 && arrow.missing <= Math.ceil(arrow.expectArrow * 0.01), `${arrow.foundArrow}/${arrow.expectArrow}`);
      check('화면 밖 + threat none → 화살표 없음', arrow.noneChecks > 50 && arrow.falseArrow === 0, `${arrow.falseArrow}/${arrow.noneChecks}`);
      check('화면 안 NPC → 화살표 없음', arrow.onChecks > 50 && arrow.onscreenArrow === 0, `${arrow.onscreenArrow}/${arrow.onChecks}`);

      // 화살표 스크린샷: 팀장이 화면 밖에서 approaching일 때 찍기
      {
        await page.evaluate(() => { const s = __mtSim; if (s.outcome === 'playing') { s.suspicion.value = 1; s.tap(5, 1); } });
        await step(page, 3);
        await tapLogical(page, 90, 160); await step(page, 2);
        let shot = false;
        for (let f = 0; f < 40000 && !shot; f += 5) {
          const st2 = await page.evaluate(() => {
            const s = __mtSim; if (s.player.mode === 'idle') s.tap(5, 1);
            s.suspicion.value = 0;
            const th = s.npcs.map((n, i) => ({ th: s.threatOf(i), dy: n.y - s.player.y }));
            return th;
          });
          if (st2.some((t) => (t.th === 'approaching' || t.th === 'seeing') && Math.abs(t.dy) > 12)) {
            await page.screenshot({ path: path.join(SHOTS, 't124-dev-06-offscreen-arrow.png') }); shot = true;
          } else await step(page, 5);
        }
        info(`화면 밖 화살표 스크린샷 ${shot ? '저장' : '조건 미발생'}`);
      }
      check('개발 서버 플레이 중 콘솔 에러 0', s.errors.length === 0, s.errors.slice(0, 3).join(' | '));
      await s.context.close();
    }

    // ── C. 시드: ?seed=day-2 / 기본(day-1) → 브라우저 sim == 헤드리스 sim
    {
      const fps = {};
      for (const q of ['', '?seed=day-2', '?seed=qa-xyz']) {
        const s = await openPage(browser, DEV + q, vp, { fakeRaf: true });
        await startGame(s.page);
        await step(s.page, 240);
        const r = await s.page.evaluate(async (q2) => {
          const core = await import('/src/core/index.ts');
          const proto = await import('/src/dev/protoFloor.ts');
          const seed = new URLSearchParams(q2).get('seed') || core.daySeed(1);
          const live = window.__mtSim;
          const ref = new core.FloorSim(proto.PROTO_FLOOR, seed);
          for (let i = 0; i < live.steps; i++) ref.step();
          return { seed, steps: live.steps, live: live.fingerprint(), ref: ref.fingerprint() };
        }, q);
        fps[q || 'default'] = r;
        check(`시드 ${q || '(없음→day-1)'}: 브라우저 sim = 헤드리스 FloorSim(${r.seed}) (${r.steps}스텝)`, r.live === r.ref && r.steps > 0, r.live === r.ref ? '' : `${r.live.slice(0, 80)} ≠ ${r.ref.slice(0, 80)}`);
        if (q === '?seed=day-2') await s.page.screenshot({ path: path.join(SHOTS, 't124-dev-07-seed-day-2.png') });
        check(`시드 ${q || '(기본)'} 콘솔 에러 0`, s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
        await s.context.close();
      }
      const a = fps.default.live.split('|').slice(6).join('|'), b = fps['?seed=day-2'].live.split('|').slice(6).join('|');
      check('day-1과 day-2의 NPC 상태가 다름(시드 반영)', a !== b);
    }

    // ── D. 리사이즈 → 정수 배율 유지
    {
      const s = await openPage(browser, DEV, { width: 360, height: 640 }, { fakeRaf: true });
      await startGame(s.page);
      const sizes = [[360, 640], [390, 844], [412, 915], [320, 568], [768, 1024], [1080, 1920], [640, 360], [359, 639], [540, 960], [375, 667]];
      let ok = 0; const rows = [];
      for (const [w, h] of sizes) {
        await s.page.setViewportSize({ width: w, height: h });
        await s.page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await step(s.page, 3);
        const r = await s.page.evaluate(() => { const c = document.querySelector('#game canvas'); const b = c.getBoundingClientRect(); return { cw: b.width, ch: b.height, iw: c.width, ih: c.height, l: b.left, t: b.top }; });
        const expect = Math.max(1, Math.floor(Math.min(w / 180, h / 320)));
        const zx = r.cw / 180, zy = r.ch / 320;
        const good = Number.isInteger(zx) && zx === zy && zx === expect && r.iw === 180 && r.ih === 320 && r.cw <= w && r.ch <= h;
        if (good) ok++;
        rows.push(`${w}×${h}→×${zx}${good ? '' : `(기대 ×${expect}, ${r.cw}×${r.ch}, 내부 ${r.iw}×${r.ih})`}`);
        if ((w === 390 && h === 844) || (w === 768 && h === 1024) || (w === 640 && h === 360)) await s.page.screenshot({ path: path.join(SHOTS, `t124-dev-08-resize-${w}x${h}.png`) });
      }
      check('리사이즈 10종: 정수 배율 = floor(min(w/180,h/320)), 내부 해상도 180×320 유지', ok === sizes.length, rows.join(', '));
      // 처음부터 다른 크기로 열기
      const s2 = await openPage(browser, DEV, { width: 412, height: 915 }, { fakeRaf: true });
      await startGame(s2.page);
      const z2 = await s2.page.evaluate(() => document.querySelector('#game canvas').getBoundingClientRect().width / 180);
      check('412×915로 첫 로드 → 배율 ×2', z2 === 2, `×${z2}`);
      check('리사이즈 중 콘솔 에러 0', s.errors.length === 0 && s2.errors.length === 0, [...s.errors, ...s2.errors].slice(0, 2).join(' | '));
      await s.context.close(); await s2.context.close();
    }
  } catch (e) {
    check('브라우저 테스트 예외 없이 완료', false, String(e && e.stack || e));
  } finally {
    await browser.close();
  }
  const fail = results.filter((r) => !r.ok);
  console.log(`\n브라우저 합계: ${results.length - fail.length}/${results.length} 통과`);
  for (const f of fail) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  fs.mkdirSync(path.resolve(__dirname, '../.out'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../.out/t124-browser.json'), JSON.stringify(results, null, 1));
  process.exitCode = fail.length ? 1 : 0;
})();
