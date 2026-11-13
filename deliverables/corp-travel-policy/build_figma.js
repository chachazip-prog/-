/* 프로토타입(corp-travel-policy.html)을 화면 상태별로 열어 DOM을 떠서,
   스크립트 없는 정적 HTML(프레임 단위)로 내보낸다. html.to.design 임포트용.
   사용: python3 build.py && node build_figma.js   (Playwright 필요) */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname, OUT = path.join(ROOT, 'figma');

function stripMedia(css) { // @media 블록 제거: 임포트 뷰포트 폭에 따라 레이아웃이 바뀌지 않게
  let out = '', i = 0;
  while (i < css.length) {
    const m = css.indexOf('@media', i);
    if (m < 0) { out += css.slice(i); break; }
    out += css.slice(i, m);
    let j = css.indexOf('{', m), depth = 1; j++;
    while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    i = j;
  }
  return out;
}
const EXTRA = `
/* ===== Figma 임포트용 정적 레이아웃 ===== */
html,body{height:auto}
body{background:#e6e6e6;margin:0;padding:48px;width:max-content}
.board{display:flex;flex-direction:column;gap:96px;align-items:flex-start}
.fig-screen{display:flex;flex-direction:column;gap:14px;align-items:flex-start}
.fig-label{font-size:18px;font-weight:800;color:#111}
.fig-label small{font-size:12px;font-weight:500;color:#666;margin-left:10px;font-family:ui-monospace,Menlo,monospace}
.fig-row{display:flex;gap:40px;align-items:flex-start}
.fig-frame{background:#fff;position:relative;overflow:hidden}
.fig-frame.fig-page .frame{display:grid;grid-template-columns:188px minmax(0,1fr);min-height:900px}
.fig-frame .xmodal,.fig-frame .cmodal{width:100% !important;max-width:none;min-height:0;box-shadow:none;margin:0}
.fig-frame .xf{position:static}
.fig-frame.desc{width:360px;background:#fbfaf7;border:1px solid #d9d9d9;display:block;font-size:12px}
.fig-frame.desc .desc-in{position:static;max-height:none;overflow:visible}
`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.join(ROOT, 'corp-travel-policy.html'));
  const frames = [];
  const descHtml = () => p.evaluate(() => document.querySelector('#desc').innerHTML);
  const sidNow = () => p.evaluate(() => document.querySelector('#sid').textContent);
  async function snapPage(key, title) {
    const html = await p.evaluate(() => { const f = document.querySelector('.frame').cloneNode(true); f.querySelector('aside.desc').remove(); return f.outerHTML; });
    frames.push({ key, title, sid: await sidNow(), kind: 'page', width: 1440, html, desc: await descHtml() });
  }
  async function snapEl(key, title, sel, kind, sid) {
    const r = await p.evaluate((sel) => { const all = document.querySelectorAll(sel), e = all[all.length - 1]; return { html: e.outerHTML, width: Math.round(e.getBoundingClientRect().width) }; }, sel);
    frames.push({ key, title, sid: sid || await sidNow(), kind, width: r.width, html: r.html, desc: await descHtml() });
  }
  const tab = (v) => p.click(`[data-a=m-tab][data-v=${v}]`);
  const cat = (v) => p.click(`[data-a=p-cat][data-v="${v}"]`);

  await snapPage('01-master-grid', '마스터 그리드');
  await p.click('[data-a=history]'); await snapPage('09-history', '변경 이력'); await p.click('[data-a=grid]');

  await p.click('[data-a=manage][data-code=HBA]');
  await snapEl('02-manage-draft', '관리 모달 · 기안 항목 관리', '.xmodal', 'modal');
  await tab('grade'); await snapEl('03-manage-grade', '관리 모달 · 등급 규정', '.xmodal', 'modal');
  await p.click('[data-a=x-add]'); await p.click('.org-node >> text=Music Division'); await p.locator('.org-mem input:not([disabled])').first().check();
  await p.click('.org-node >> text=Label Operations'); // 재렌더로 체크 상태를 마크업에 반영
  await snapEl('04-org-picker', '조직도 구성원 선택 팝업', '.cmodal', 'popup');
  await p.click('[data-a=o-close]');
  await tab('policy');
  for (const [i, c] of ['교통', '숙박', '일비·식비', '기타'].entries()) { await cat(c); await snapEl(`05${'abcd'[i]}-manage-policy-${['transport', 'lodging', 'meal', 'etc'][i]}`, `관리 모달 · 여비규정 설정 (${c})`, '.xmodal', 'modal'); }

  // 변경을 만들어 컨펌 팝업 캡처
  await tab('draft'); await p.click('[data-a=tg][data-k=attendance]');
  await tab('grade'); await p.click('[data-a=g-add]'); await p.locator('[data-f=name][data-g]').last().fill('Tier 4');
  await tab('policy'); await cat('숙박'); await p.locator('[data-cell][data-ri="0"][data-ci="0"]').fill('650'); await cat('교통'); await cat('숙박');
  await p.click('[data-a=m-save]'); await snapEl('06-confirm-save', '변경 내용 확인 팝업', '.cmodal', 'popup');
  await p.click('[data-a=c-back]'); await p.click('[data-a=m-close]'); await snapEl('07-confirm-discard', '닫기 확인 팝업', '.cmodal', 'popup', 'TRIP-ADM-POL-02-x1');
  await p.click('[data-a=c-discard]');

  // 미등록 법인 빈 상태
  await p.click('[data-a=manage][data-code=HBC]'); await tab('policy'); await snapEl('05e-manage-policy-empty', '관리 모달 · 여비규정 설정 (미등록 법인)', '.xmodal', 'modal');
  await tab('grade'); await snapEl('03b-manage-grade-empty', '관리 모달 · 등급 규정 (미등록 법인)', '.xmodal', 'modal');
  await p.keyboard.press('Escape');

  // 적용 예정 배너 상태
  await p.click('[data-a=manage][data-code=HBJ]'); await tab('policy'); await cat('일비·식비');
  await p.locator('[data-cell][data-ri="0"][data-ci="4"]').first().fill('US$60'); await p.click('[data-a=m-save]');
  await p.locator('input[value=date]').check(); await p.fill('#cf-date', '2027.01.01'); await p.fill('#cf-reason', '그 외 지역 식비 한도 추가');
  await p.click('[data-a=c-save]');
  await p.click('[data-a=manage][data-code=HBJ]'); await tab('policy'); await cat('일비·식비');
  await snapEl('05f-manage-policy-scheduled', '관리 모달 · 여비규정 설정 (적용 예정 변경 있음)', '.xmodal', 'modal');
  await p.click('[data-a=p-cancel]'); await snapEl('08-confirm-cancel-scheduled', '적용 예정 취소 확인 팝업', '.cmodal', 'popup', 'TRIP-ADM-POL-02-x2');
  await b.close();
  if (errs.length) throw new Error(errs.join('\n'));

  frames.sort((a, b) => a.key.localeCompare(b.key));
  const css = stripMedia(fs.readFileSync(path.join(ROOT, 'src/base.css'), 'utf8')) + EXTRA;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const frameHtml = (f, withDesc) => `<section class="fig-screen" id="screen-${f.key}">
  <div class="fig-label">${esc(f.title)}<small>${f.sid}</small></div>
  <div class="fig-row">
    <div class="fig-frame fig-${f.kind}" id="frame-${f.key}" data-name="${f.sid} ${esc(f.title)}" aria-label="${f.sid} ${esc(f.title)}" style="width:${f.width}px">${f.html}</div>
    ${withDesc ? `<aside class="fig-frame desc" id="desc-${f.key}" data-name="${f.sid} Description" aria-label="${f.sid} Description">${f.desc}</aside>` : ''}
  </div>
</section>`;
  const doc = (title, body) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=1920"><title>${title}</title>
<style>
${css}
</style></head>
<body><div class="board">
${body}
</div></body></html>
`;
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'corp-travel-policy-figma.html'), doc('법인별 출장여비규정 — Figma 임포트용 (전체 프레임)', frames.map((f) => frameHtml(f, true)).join('\n')));
  frames.forEach((f) => fs.writeFileSync(path.join(OUT, 'frames', f.key + '.html'), doc(`${f.sid} ${f.title}`, frameHtml(f, true))));
  console.log(frames.map((f) => `${f.key}  ${f.sid}  ${f.kind} ${f.width}px  ${f.title}`).join('\n'));
})();
