/* 프로토타입(corp-travel-policy.html)을 화면 상태별로 열어 DOM을 떠서, 스크립트 없는 정적 HTML로 내보낸다.
   레이아웃은 위임전결 어드민 기획안(v7)과 동일: [라벨] + [UI 프레임 1512px | 디스크립션 408px], 모달은 딤 배경 위 단독 프레임.
   사용: python3 build.py && node build_figma.js   (Playwright 필요) */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname, OUT = path.join(ROOT, 'figma');

function stripMedia(css) {
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
const EXTRA = (tags) => `
/* ===== 정적 캔버스 (Figma 임포트용) ===== */
html,body{height:auto}
body{margin:0;background:#E5E5E5}
.canvas{display:flex;flex-direction:column;gap:300px;padding:100px;width:max-content;background:#E5E5E5}
.canvas-row{display:flex;gap:240px;align-items:flex-start}
.cell{display:flex;flex-direction:column;gap:16px}
${tags.map((t) => 'label-' + t).join(',')}{display:block;font-size:64px;line-height:80px;font-weight:500;color:#8A8A8A;white-space:nowrap}
${tags.map((t) => 'screen-' + t).join(',')}{display:flex;align-items:stretch;width:1920px;min-height:1080px;background:#fff}
${tags.map((t) => 'ui-' + t).join(',')}{display:block;position:relative;width:1512px;min-height:1080px;flex:none;background:#fff;overflow:hidden}
${tags.map((t) => 'guide-' + t).join(',')}{display:flex;flex-direction:column;gap:8px;width:408px;min-height:1080px;flex:none;box-sizing:border-box;padding:12px;background:#F8FAFC;border-left:1px solid #E2E8F0}
.uiroot .frame{display:grid;grid-template-columns:247px minmax(0,1fr);min-height:1080px}
.uiroot.dim{background:#9CA0A8;display:flex;align-items:center;justify-content:center;padding:60px 0}
.uiroot.dim .xmodal,.uiroot.dim .cmodal{margin:0;max-width:none;min-height:0;flex:none}
.uiroot .xf{position:static}
`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.join(ROOT, 'corp-travel-policy.html'));
  const frames = [];
  const guide = () => p.evaluate(() => document.querySelector('#desc .desc-in').innerHTML);
  const sidNow = () => p.evaluate(() => document.querySelector('#sid').textContent);
  async function snapPage(row, note) {
    const html = await p.evaluate(() => { const f = document.querySelector('.frame').cloneNode(true); f.querySelector('aside.desc').remove(); return f.outerHTML; });
    frames.push({ row, sid: await sidNow(), note, kind: 'page', html, guide: await guide() });
  }
  async function snapModal(row, sel, note) {
    const r = await p.evaluate((sel) => { const all = document.querySelectorAll(sel), e = all[all.length - 1]; const c = e.cloneNode(true); c.style.width = Math.round(e.getBoundingClientRect().width) + 'px'; return c.outerHTML; }, sel);
    frames.push({ row, sid: await sidNow(), note, kind: 'modal', html: r, guide: await guide() });
  }
  const tab = (v) => p.click(`[data-a=m-tab][data-v=${v}]`);
  const cat = (v) => p.click(`[data-a=p-cat][data-v="${v}"]`);

  // 1행: 마스터 그리드 + 관리 모달 계열
  await snapPage(0);
  await p.click('[data-a=manage][data-code=HBA]');
  await snapModal(0, '.xmodal');
  await tab('grade'); await snapModal(0, '.xmodal');
  await p.click('[data-a=x-add]'); await p.click('.org-node >> text=Music Division'); await p.locator('.org-mem input:not([disabled])').first().check();
  await p.click('.org-node >> text=Label Operations');
  await snapModal(0, '.cmodal');
  await p.click('[data-a=o-close]');
  await tab('policy');
  for (const c of ['교통', '숙박', '일비·식비', '기타']) { await cat(c); await snapModal(0, '.xmodal', c); }
  await p.click('[data-a=p-copy]'); await snapModal(0, '.cmodal'); await p.click('#cp-no');
  // 변경을 만들어 컨펌 팝업
  await tab('draft'); await p.click('[data-a=tg][data-k=attendance]');
  await tab('grade'); await p.click('[data-a=g-add]'); await p.locator('[data-f=name][data-g]').last().fill('Tier 4');
  await tab('policy'); await cat('숙박'); await p.locator('[data-cell][data-ri="0"][data-ci="0"]').fill('650'); await cat('교통'); await cat('숙박');
  await p.click('[data-a=m-save]'); await snapModal(0, '.cmodal');
  await p.click('[data-a=c-back]'); await p.click('[data-a=m-close]'); await snapModal(0, '.cmodal');
  await p.click('[data-a=c-discard]');
  // 2행: 상태 변형 (미등록 법인, 적용 예정)
  await p.click('[data-a=manage][data-code=HBC]'); await tab('grade'); await snapModal(1, '.xmodal', '미등록 법인');
  await tab('policy'); await snapModal(1, '.xmodal', '미등록 법인');
  await p.keyboard.press('Escape');
  await p.click('[data-a=manage][data-code=HBJ]'); await tab('policy'); await cat('일비·식비');
  await p.locator('[data-cell][data-ri="0"][data-ci="4"]').first().fill('US$60'); await p.click('[data-a=m-save]');
  await p.locator('input[value=date]').check(); await p.fill('#cf-date', '2027.01.01'); await p.fill('#cf-reason', '그 외 지역 식비 한도 추가');
  await p.click('[data-a=c-save]');
  await p.click('[data-a=manage][data-code=HBJ]'); await tab('policy'); await cat('일비·식비');
  await snapModal(1, '.xmodal', '적용 예정 변경 있음');
  await p.click('[data-a=p-cancel]'); await snapModal(1, '.cmodal'); await p.click('[data-a=c-back]'); await p.keyboard.press('Escape');
  // 3행: 변경 이력
  await p.click('[data-a=history]'); await snapPage(2);
  await b.close();
  if (errs.length) throw new Error(errs.join('\n'));

  const NOTE = { '교통': 'a', '숙박': 'b', '일비·식비': 'c', '기타': 'd', '미등록 법인': 'empty', '적용 예정 변경 있음': 'scheduled' };
  frames.forEach((f) => { f.tag = f.sid.toLowerCase() + (f.note ? '-' + NOTE[f.note] : ''); f.label = f.sid + (f.note ? ` (${f.note})` : ''); });
  const tags = frames.map((f) => f.tag);
  if (new Set(tags).size !== tags.length) throw new Error('duplicate frame tag: ' + tags.join(' '));
  const css = stripMedia(fs.readFileSync(path.join(ROOT, 'src/base.css'), 'utf8')) + EXTRA(tags);
  const cell = (f) => `<div class="cell"><label-${f.tag}>${f.label}</label-${f.tag}>
<screen-${f.tag}><ui-${f.tag} class="uiroot${f.kind === 'modal' ? ' dim' : ''}">${f.html}</ui-${f.tag}><guide-${f.tag}>${f.guide}</guide-${f.tag}></screen-${f.tag}></div>`;
  const doc = (title, body) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=1920"><title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${css}
</style></head>
<body><main class="canvas">
${body}
</main></body></html>
`;
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const rows = [0, 1, 2].map((r) => `<div class="canvas-row">\n${frames.filter((f) => f.row === r).map(cell).join('\n')}\n</div>`).join('\n');
  fs.writeFileSync(path.join(OUT, 'corp-travel-policy-figma.html'), doc('법인별 출장여비규정 통합 UI·UX·디스크립션', rows));
  frames.forEach((f, i) => fs.writeFileSync(path.join(OUT, 'frames', String(i + 1).padStart(2, '0') + '-' + f.tag + '.html'), doc(f.label, `<div class="canvas-row">${cell(f)}</div>`)));
  console.log(frames.map((f) => `row${f.row}  ${f.label}  ${f.kind}`).join('\n'));
})();
