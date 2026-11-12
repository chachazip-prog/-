/* 셸 · 라우팅 · 공용 UI. 각 화면은 App.views[key] = { render(ctx), mount?(root, ctx), desc(ctx) } 로 등록한다. */
window.App = (function () {
  const D = window.DATA;
  const state = { corp: 'ALL', tab: 'draft' };
  const SUBTABS = [
    { key: 'draft', label: '기안 항목 설정', sid: 'TRIP-ADM-CORP-02' },
    { key: 'policy', label: '여비규정', sid: 'TRIP-ADM-CORP-03' },
    { key: 'criteria', label: '등급 · 지역 기준', sid: 'TRIP-ADM-CORP-04' },
    { key: 'history', label: '변경 이력', sid: 'TRIP-ADM-CORP-05' },
  ];
  const views = {};

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = {
    esc,
    mk: (n) => `<i class="mk" data-mk="${n}" title="Description ${n}">${n}</i>`,
    badge: (color, text) => `<span class="badge ${color}">${esc(text)}</span>`,
    /* 토글 스위치. attrs 는 data-* 등 추가 속성 문자열 */
    toggle: (on, attrs = '', label = true) => `<button type="button" class="tg" role="switch" aria-checked="${on ? 'true' : 'false'}" ${attrs}></button>${label ? `<span class="tg-label">${on ? 'ON' : 'OFF'}</span>` : ''}`,
    money: (v, cur) => (v == null || v === '' ? '' : typeof v === 'number' ? (D.curSymbol[cur] || '') + v.toLocaleString('en-US') : String(v)),
    corp: (code) => D.corps.find((c) => c.code === code),
    /* 여비규정 상태: 현재 적용 버전 / 예정 버전 */
    policyState(code) {
      const list = D.policies[code] || [];
      return { active: list.find((p) => p.status === 'active') || null, scheduled: list.find((p) => p.status === 'scheduled') || null, draft: list.find((p) => p.status === 'draft') || null, count: list.length };
    },
    policyBadge(code) {
      const s = h.policyState(code);
      if (s.active) return h.badge('green', '적용 중 ' + s.active.ver) + (s.scheduled ? ' ' + h.badge('blue', '적용 예정 ' + s.scheduled.ver) : '');
      if (s.scheduled) return h.badge('blue', '적용 예정 ' + s.scheduled.ver);
      if (s.draft) return h.badge('gray', '임시저장');
      return h.badge('orange', '미등록');
    },
    now() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${D.TODAY} ${p(d.getHours())}:${p(d.getMinutes())}`; },
  };

  /* ---------- 공용 UI ---------- */
  const ui = {
    toast(msg) {
      document.querySelectorAll('.toast').forEach((e) => e.remove());
      const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    },
    /* modal({ title, body(html), width, actions:[{ label, primary, danger, keep, onClick(modalEl) }] }) — onClick 이 false 를 반환하면 닫지 않음 */
    modal({ title, body, width, actions }) {
      ui.closeModal();
      const bg = document.createElement('div'); bg.className = 'dim-bg';
      bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${width ? 'width:' + width + 'px' : ''}"><div class="mh"><span>${esc(title)}</span><button type="button" aria-label="닫기" data-x>×</button></div><div class="mb">${body}</div><div class="mf"></div></div>`;
      const mf = bg.querySelector('.mf');
      (actions || [{ label: '확인', primary: true }]).forEach((a) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (a.primary ? ' pri' : '') + (a.danger ? ' danger' : ''); b.textContent = a.label;
        b.onclick = () => { const r = a.onClick ? a.onClick(bg.querySelector('.modal')) : undefined; if (r !== false) ui.closeModal(); };
        mf.appendChild(b);
      });
      bg.querySelector('[data-x]').onclick = ui.closeModal;
      bg.addEventListener('mousedown', (e) => { if (e.target === bg) ui.closeModal(); });
      document.body.appendChild(bg);
      const f = bg.querySelector('.mb input,.mb select,.mb textarea,.mf .btn.pri'); if (f) f.focus();
      return bg.querySelector('.modal');
    },
    closeModal() { document.querySelectorAll('.dim-bg').forEach((e) => e.remove()); },
    confirm(title, body, okLabel, onOk) { return ui.modal({ title, body, actions: [{ label: '취소' }, { label: okLabel || '확인', primary: true, onClick: onOk }] }); },
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ui.closeModal(); });

  /* 변경 이력 기록 */
  function log(corp, cat, text) { D.history.unshift({ at: h.now(), corp, cat, text, by: D.admin }); }

  /* ---------- 렌더 ---------- */
  function ctx() { return { corp: state.corp === 'ALL' ? null : h.corp(state.corp), code: state.corp, tab: state.tab, D, h, ui }; }
  function currentView() { return state.corp === 'ALL' ? views.overview : views[state.tab]; }

  function corpPanel() {
    const item = (code, inner) => `<button type="button" class="corp-item ${state.corp === code ? 'on' : ''}" data-corp="${code}">${inner}</button>`;
    return `<h3 class="h3">법인 <em>${D.corps.length}</em>${h.mk('A')}</h3>
      <div class="corp-panel">
        <div class="tools"><span>인사정보 연동</span><span class="num">${D.hrSyncAt}</span></div>
        ${item('ALL', '<span class="cd">전체 법인</span>')}
        ${D.corps.map((c) => {
          const on = D.draftItems.filter((i) => c.draft[i.key].on).length;
          return item(c.code, `<span class="cd">${c.code}</span><span class="nm">${esc(c.name)}</span><div class="st">${h.policyBadge(c.code)} <span class="badge line">기안 항목 ${on}/${D.draftItems.length}</span></div>`);
        }).join('')}
        <p class="sync">법인 목록은 인사정보의 법인 코드를 그대로 사용하며, 이 화면에서 추가·삭제할 수 없습니다.</p>
      </div>`;
  }

  function corpHead(c) {
    return `<div class="corp-head"><span class="cd">${c.code}</span><span class="nm">${esc(c.name)}</span>${c.sample ? h.badge('gray', '샘플 값') : ''}</div>
      <div class="chips"><span class="chip">국가 <b>${esc(c.country)}</b></span><span class="chip">기준 통화 <b>${c.cur}</b></span><span class="chip">구성원 <b class="num">${c.headcount.toLocaleString()}명</b></span></div>
      <div class="subtabs" role="tablist">${SUBTABS.map((s) => `<button type="button" role="tab" aria-selected="${state.tab === s.key}" class="s ${state.tab === s.key ? 'on' : ''}" data-tab="${s.key}">${s.label}</button>`).join('')}${h.mk('B')}</div>`;
  }

  function renderDesc(v, c) {
    const d = (v && v.desc ? v.desc(c) : null) || {};
    const common = [
      { no: 'A', title: '법인 목록 (좌측 패널)', body: '인사정보의 법인 코드를 연동해 노출한다(매일 06:00 동기화, 추가·삭제 불가). 법인별로 <b>여비규정 상태</b>(적용 중/적용 예정/임시저장/미등록)와 <b>기안 항목 사용 수</b>를 배지로 보여준다. [전체 법인] 선택 시 전 법인 현황 표를 노출한다.' },
    ];
    if (c.corp) common.push({ no: 'B', title: '법인 상세 탭', body: '선택한 법인의 설정을 <code>기안 항목 설정</code> · <code>여비규정</code> · <code>등급 · 지역 기준</code> · <code>변경 이력</code> 4개 탭으로 나눠 관리한다. 탭을 바꿔도 좌측 법인 선택은 유지된다.' });
    const item = (i) => `<div class="desc-item" data-d="${i.no}"><i class="mk">${i.no}</i><div><div class="dt">${i.title}</div><div class="db">${i.body}</div></div></div>`;
    const sid = state.corp === 'ALL' ? 'TRIP-ADM-CORP-01' : SUBTABS.find((s) => s.key === state.tab).sid;
    document.getElementById('sid').textContent = sid;
    document.getElementById('desc').innerHTML = `<div class="desc-in"><h2>${d.title || ''}</h2><div class="dsub">${sid} · ${d.summary || ''}</div>
      <h4>공통 영역</h4>${common.map(item).join('')}
      <h4>화면 상세</h4>${(d.items || []).map(item).join('')}
      ${(d.policies || []).length ? '<h4>정책</h4><div class="desc-item" style="grid-template-columns:1fr"><div class="db"><ul>' + d.policies.map((p) => `<li>${p}</li>`).join('') + '</ul></div></div>' : ''}
      ${(d.issues || []).length ? '<h4>확인 필요 사항</h4>' + d.issues.map((p) => `<div class="issue">${p}</div>`).join('') : ''}</div>`;
  }

  function render() {
    const c = ctx(); const v = currentView();
    const body = v ? v.render(c) : '<div class="empty"><b>화면 준비 중</b></div>';
    document.getElementById('corp-side').innerHTML = corpPanel();
    const root = document.getElementById('view');
    root.innerHTML = (c.corp ? corpHead(c.corp) : '') + `<div id="view-body">${body}</div>`;
    if (v && v.mount) v.mount(document.getElementById('view-body'), c);
    renderDesc(v, c);
  }
  function go(corp, tab) { if (corp) state.corp = corp; if (tab) state.tab = tab; ui.closeModal(); render(); window.scrollTo(0, 0); }

  function init() {
    document.getElementById('corp-side').addEventListener('click', (e) => { const b = e.target.closest('[data-corp]'); if (b) go(b.dataset.corp); });
    document.getElementById('view').addEventListener('click', (e) => { const b = e.target.closest('.subtabs [data-tab]'); if (b) go(null, b.dataset.tab); });
    const dOn = document.getElementById('desc-toggle'), mOn = document.getElementById('mk-toggle');
    dOn.onchange = () => document.body.classList.toggle('desc-on', dOn.checked);
    mOn.onchange = () => document.body.classList.toggle('mk-off', !mOn.checked);
    /* 마커 ↔ Description 하이라이트 */
    document.addEventListener('mouseover', (e) => {
      const m = e.target.closest('.mk[data-mk], .desc-item[data-d]'); document.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot')); if (!m) return;
      const no = m.dataset.mk || m.dataset.d;
      document.querySelectorAll(`.mk[data-mk="${no}"], .desc-item[data-d="${no}"]`).forEach((x) => x.classList.add('hot'));
    });
    document.addEventListener('click', (e) => { const m = e.target.closest('.mk[data-mk]'); if (!m) return; const t = document.querySelector(`.desc-item[data-d="${m.dataset.mk}"]`); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
    render();
  }

  return { state, views, h, ui, log, go, render, init, D, SUBTABS };
})();
