/* 법인별 출장여비규정 — 마스터 그리드 / 관리 모달(기안 항목·등급 규정·여비규정) / 컨펌 팝업 / 변경 이력 */
(function () {
  const D = window.DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const mk = (n) => `<i class="mk" data-mk="${n}">${n}</i>`;
  const badge = (c, t) => `<span class="badge ${c}">${esc(t)}</span>`;
  const onoff = (b) => (b ? 'ON' : 'OFF');
  const CATS = ['교통', '숙박', '일비·식비', '기타'];
  const TYPES = { class: '등급 기준', cap: '한도 내 실비', flat: '정액 지급', actual: '실비' };
  const CURS = ['KRW', 'USD', 'JPY', 'CNY', 'INR', 'EUR'];
  const TEMP = { HYB: 12, HBA: 2, HBL: 0, HBJ: 3, HBC: 0, HBI: 0 }; // 임시저장 기안 수(샘플)
  const EXTRA_TITLES = { HYB: ['인턴'], HBA: ['Associate', 'Intern'], HBL: ['Associate'], HBJ: ['契約社員'], HBC: ['General Manager', 'Director', 'Manager', 'Staff'], HBI: ['Country Head', 'Director', 'Manager', 'Staff'] };
  let seq = 1; const uid = (p) => p + Date.now().toString(36) + (seq++);
  const now = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${D.TODAY} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fmt = (v, cur) => (v == null || v === '' ? '미정의' : typeof v === 'number' ? (D.curSymbol[cur] || '') + v.toLocaleString('en-US') : String(v));

  /* ---------- 데이터 정규화: 법인 1건 = 기안 항목 + 등급 + 개인 예외 + 여비규정 항목 ---------- */
  D.corps.forEach((c) => {
    c.grades = D.grades[c.code] || [];
    c.exc = (D.gradeExceptions[c.code] || []).map((x) => Object.assign({ id: uid('x') }, x));
    const act = (D.policies[c.code] || []).find((p) => p.status === 'active' && p.items);
    c.items = act ? act.items : [];
    c.meta = { from: act ? act.from : '', doc: act ? act.doc : '' };
    c.pending = null; // { from, items, meta } 적용 예정 변경
    c.items.forEach((it) => { it.id = it.key; delete it.byRegion; if (it.byGrade) it.table.rows.forEach((r) => { const g = c.grades.find((g) => g.name === r.label); r.gid = g ? g.id : null; }); });
    c.titles = [...new Set(c.grades.flatMap((g) => g.hr).concat(EXTRA_TITLES[c.code] || []))];
  });
  const corpOf = (code) => D.corps.find((c) => c.code === code);
  /* 변경 이력 (샘플 + 실행 중 추가) */
  const H = [
    { at: '2026.10.27 10:05', corp: 'HBJ', cat: '기안 항목', text: '출장 예산', before: 'OFF', after: 'ON', reason: 'HBJ 예산 시스템 연동 완료', by: '윤채희', sid: 'S-0012' },
    { at: '2026.10.27 10:05', corp: 'HBJ', cat: '기안 항목', text: '출장 근태 신청', before: 'OFF', after: 'ON', reason: 'HBJ 예산 시스템 연동 완료', by: '윤채희', sid: 'S-0012' },
    { at: '2026.10.20 16:40', corp: 'HBA', cat: '기안 항목', text: '최초 설정', before: '-', after: '출장 예산 OFF · 법인카드 실시간 한도증액 OFF · 출장 근태 신청 OFF', reason: '글로벌 법인 오픈 준비', by: '윤채희', sid: 'S-0011' },
    { at: '2026.10.20 16:38', corp: 'HBL', cat: '기안 항목', text: '최초 설정', before: '-', after: '출장 예산 OFF · 법인카드 실시간 한도증액 OFF · 출장 근태 신청 OFF', reason: '글로벌 법인 오픈 준비', by: '윤채희', sid: 'S-0010' },
    { at: '2026.03.28 09:12', corp: 'HBJ', cat: '개인 예외', text: '예외 지정 추가 — 佐藤 美咲 (J200077)', before: '일반 구성원', after: '리더그룹·SP 이상 (2026.04.01 ~ 무기한)', reason: '아티스트 운영 담당 동급 좌석 동승', by: '서준석', sid: 'S-0009' },
    { at: '2026.02.24 11:30', corp: 'HBA', cat: '개인 예외', text: '예외 지정 추가 — Maria Santos (A100518)', before: 'Tier 3', after: 'Tier 2 (2026.03.01 ~ 2026.11.30)', reason: '2026 월드투어 총괄 기간 한시 적용', by: '윤채희', sid: 'S-0008' },
    { at: '2025.12.22 15:02', corp: 'HBA', cat: '개인 예외', text: '예외 지정 추가 — Jordan Lee (A100231)', before: 'Tier 3', after: 'Tier 2 (2026.01.01 ~ 2026.12.31)', reason: '아티스트 동행 상시 업무 (CFO 승인)', by: '윤채희', sid: 'S-0007' },
    { at: '2025.12.10 17:45', corp: 'HBL', cat: '여비규정', text: '규정 등록 (HBA 규정 복사) — 항목 9개', before: '-', after: '시행일 2025.12.15', reason: 'HBA & HBL T&E Policy Update 반영', by: '윤채희', sid: 'S-0006' },
    { at: '2025.12.10 17:20', corp: 'HBA', cat: '여비규정', text: '숙박 — 값 6칸 변경', before: 'Tier 1 · New York US$550 외 5건', after: 'Tier 1 · New York US$600 외 5건', reason: 'HBA & HBL T&E Policy Update 반영', by: '윤채희', sid: 'S-0005' },
    { at: '2025.12.10 17:20', corp: 'HBA', cat: '여비규정', text: '식비 — 열 추가', before: '-', after: 'Other US', reason: 'HBA & HBL T&E Policy Update 반영', by: '윤채희', sid: 'S-0005' },
    { at: '2026.03.09 09:00', corp: 'HYB', cat: '기안 항목', text: '최초 설정', before: '-', after: '출장 예산 ON · 법인카드 실시간 한도증액 ON · 출장 근태 신청 ON', reason: '출장 시스템 오픈', by: '서준석', sid: 'S-0001' },
  ];
  let saveNo = 12;
  const lastOf = (code) => H.find((x) => x.corp === code) || null;

  /* ---------- 상태 ---------- */
  const S = { view: 'grid', q: '', f: 'all', hist: { corp: '', cat: '', q: '' }, m: null, cf: null };

  /* ---------- 등급·여비규정 공용 로직 ---------- */
  const defGrade = (grades) => grades.find((g) => g.isDefault) || null;
  const mappedGrade = (grades, title) => grades.find((g) => g.hr.includes(title)) || defGrade(grades);
  const gname = (grades, id) => { const g = grades.find((g) => g.id === id); return g ? g.name : '-'; };
  /* 등급 기준 변경 → 등급별 차등 항목의 행을 즉시 맞춘다 (추가=미정의 행, 삭제=행 삭제, 이름 변경=값 유지) */
  function syncRows(items, grades) {
    items.forEach((it) => {
      const t = it.table;
      if (it.byGrade && grades.length) t.rows = grades.map((g) => { const r = t.rows.find((r) => r.gid === g.id); return r ? Object.assign(r, { label: g.name }) : { gid: g.id, label: g.name, cells: t.cols.map(() => null) }; });
      else if (!it.byGrade || !grades.length) { it.byGrade = false; t.rows = [{ label: '전체 구성원', cells: (t.rows[0] ? t.rows[0].cells : t.cols.map(() => null)) }]; }
    });
  }
  const undefCount = (items) => items.filter((i) => i.on).reduce((n, i) => n + i.table.rows.reduce((m, r) => m + r.cells.filter((v) => v == null || v === '').length, 0), 0);
  const parseCell = (s) => { const t = s.trim(); if (t === '') return null; const n = Number(t.replace(/,/g, '')); return /^[\d,]+(\.\d+)?$/.test(t) && !isNaN(n) ? n : t; };
  const newItem = (cat, grades) => { const it = { id: uid('i'), cat, name: '', on: true, type: 'cap', byGrade: false, cur: null, unit: '', cond: '', guide: '', table: { colHead: '', cols: ['기준'], rows: [{ label: '전체 구성원', cells: [null] }] } }; return it; };
  const TEMPLATE = [['교통', '항공', 'class'], ['교통', '철도', 'class'], ['숙박', '숙박', 'cap'], ['일비·식비', '식비', 'cap'], ['일비·식비', '출장 수당(일당)', 'flat'], ['기타', '통신비', 'cap']];

  /* ================= 마스터 그리드 ================= */
  function gridView() {
    const q = S.q.trim().toLowerCase();
    const rows = D.corps.filter((c) => (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) && (S.f === 'all' || (S.f === 'reg') === (c.items.length > 0)));
    const reg = D.corps.filter((c) => c.items.length).length;
    const catCell = (c, cat) => { const its = c.items.filter((i) => i.cat === cat); if (!its.length) return '<span class="dim">-</span>'; return `<div class="cat-list">${its.map((i) => `<div class="${i.on ? '' : 'off'}">${esc(i.name)}${i.on ? '' : ' (미사용)'}</div>`).join('')}</div>`; };
    return `
      <div class="toolbar">
        <div class="chips">${mk(1)}<span class="chip">법인 <b class="num">${D.corps.length}</b></span><span class="chip">여비규정 등록 <b class="num">${reg}</b> · 미등록 <b class="num" style="${D.corps.length - reg ? 'color:var(--orange)' : ''}">${D.corps.length - reg}</b></span><span class="chip">인사정보 연동 <b class="num">${D.hrSyncAt}</b></span></div>
        <span class="sp"></span>
        <select class="sel" data-a="f" aria-label="여비규정 등록 여부"><option value="all">전체</option><option value="reg" ${S.f === 'reg' ? 'selected' : ''}>여비규정 등록</option><option value="none" ${S.f === 'none' ? 'selected' : ''}>여비규정 미등록</option></select>
        <input class="inp" data-a="q" value="${esc(S.q)}" placeholder="법인 코드, 법인명 검색" maxlength="30" style="width:190px" aria-label="법인 검색">${mk(2)}
        <button type="button" class="btn" data-a="history">변경 이력</button>${mk(7)}
      </div>
      <div class="grid-wrap"><table class="grid">
        <thead>
          <tr><th rowspan="2" class="c">번호</th><th rowspan="2">법인${mk(3)}</th><th rowspan="2" class="c">구성원</th>
            <th colspan="3" class="grp">기안 항목${mk(4)}</th><th colspan="2" class="grp">등급 규정${mk(5)}</th><th colspan="4" class="grp">여비규정 (등록 항목)${mk(6)}</th>
            <th rowspan="2">최종 수정</th><th rowspan="2" class="c stick">관리${mk(8)}</th></tr>
          <tr><th class="c">출장 예산</th><th class="c">법인카드<br>실시간 한도증액</th><th class="c">출장 근태<br>신청</th><th>등급</th><th class="c">개인 예외</th>${CATS.map((c) => `<th>${c}</th>`).join('')}</tr>
        </thead>
        <tbody>${rows.length ? rows.map((c, i) => {
          const last = lastOf(c.code), ud = undefCount(c.items);
          return `<tr>
            <td class="c dim num">${i + 1}</td>
            <td><div class="corp-cd">${c.code}${c.sample ? ' ' + badge('gray', '샘플 값') : ''}</div><div class="corp-nm">${esc(c.name)}</div><div class="sm">${esc(c.country)} · ${c.cur}</div></td>
            <td class="c num">${c.headcount.toLocaleString()}</td>
            ${D.draftItems.map((d) => `<td class="c">${badge(c.draft[d.key].on ? 'blue' : 'gray', onoff(c.draft[d.key].on))}</td>`).join('')}
            <td>${c.grades.length ? `<div class="gtags">${c.grades.map((g) => `<span class="badge line">${esc(g.name)}</span>`).join('')}</div>` : badge('orange', '미등록')}</td>
            <td class="c num">${c.exc.length ? c.exc.length + '건' : '<span class="dim">-</span>'}</td>
            ${c.items.length ? CATS.map((cat) => `<td>${catCell(c, cat)}</td>`).join('') : `<td colspan="4">${badge('orange', '미등록')} <span class="sm">등록된 여비규정이 없습니다</span></td>`}
            <td class="num" style="white-space:nowrap">${last ? `${esc(last.at.slice(0, 10))}<div class="sm">${esc(last.by)}</div>` : '<span class="dim">-</span>'}
              ${c.meta.from ? `<div class="sm">시행 ${esc(c.meta.from)}</div>` : ''}${c.pending ? `<div>${badge('blue', '적용 예정 ' + c.pending.from)}</div>` : ''}${ud ? `<div>${badge('orange', '미정의 ' + ud + '칸')}</div>` : ''}</td>
            <td class="c stick"><button type="button" class="btn sm" data-a="manage" data-code="${c.code}">관리</button></td></tr>`;
        }).join('') : '<tr><td colspan="13"><div class="empty"><b>검색 결과가 없습니다</b>법인 코드 또는 법인명을 다시 확인해 주세요.</div></td></tr>'}</tbody>
      </table></div>
      <p class="note" style="margin-top:10px">법인 목록은 인사정보의 법인 코드를 그대로 사용합니다. 값 수정은 [관리]에서 하며, 모든 수정은 확인 팝업을 거쳐 저장되고 변경 이력에 남습니다.</p>`;
  }

  /* ================= 변경 이력 화면 ================= */
  function historyView() {
    const f = S.hist, q = f.q.trim().toLowerCase();
    const rows = H.filter((x) => (!f.corp || x.corp === f.corp) && (!f.cat || x.cat === f.cat) && (!q || (x.text + x.before + x.after + x.reason + x.by).toLowerCase().includes(q)));
    const catColor = { '기안 항목': 'blue', '등급 규정': 'green', '개인 예외': 'orange', '여비규정': 'gray' };
    return `
      <button type="button" class="back" data-a="grid">← 법인별 출장여비규정 목록</button>
      <div class="toolbar" style="margin-top:10px">
        <h3 class="h3" style="margin:0">변경 이력 <em>${rows.length}</em>${mk(1)}</h3><span class="sp"></span>
        <select class="sel" data-h="corp" aria-label="법인"><option value="">전체 법인</option>${D.corps.map((c) => `<option ${f.corp === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
        <select class="sel" data-h="cat" aria-label="구분"><option value="">전체 구분</option>${Object.keys(catColor).map((c) => `<option ${f.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <input class="inp" data-h="q" value="${esc(f.q)}" placeholder="변경 내용, 사유, 수정자 검색" maxlength="30" style="width:210px" aria-label="이력 검색">${mk(2)}
      </div>
      <div class="tbl-wrap"><table class="tbl" style="min-width:900px">
        <thead><tr><th class="c">번호</th><th>변경 일시</th><th>법인</th><th>구분</th><th>변경 내용${mk(3)}</th><th style="width:30%">변경 전 → 변경 후</th><th>변경 사유</th><th>수정자</th><th>저장 번호${mk(4)}</th></tr></thead>
        <tbody>${rows.length ? rows.map((x, i) => `<tr>
          <td class="c dim num">${rows.length - i}</td><td class="num" style="white-space:nowrap">${esc(x.at)}</td><td><b>${x.corp}</b></td><td>${badge(catColor[x.cat] || 'gray', x.cat)}</td>
          <td>${esc(x.text)}</td><td><div class="hist-ba"><span class="b">${esc(x.before)}</span><span class="dim">→</span><span class="a">${esc(x.after)}</span></div></td>
          <td class="dim">${esc(x.reason)}</td><td style="white-space:nowrap">${esc(x.by)}</td><td class="num dim">${esc(x.sid)}</td></tr>`).join('') : '<tr><td colspan="9"><div class="empty"><b>조건에 맞는 변경 이력이 없습니다</b>필터를 바꾸거나 검색어를 지워 보세요.</div></td></tr>'}</tbody>
      </table></div>`;
  }

  /* ================= 관리 모달 ================= */
  function openManage(code) {
    const c = corpOf(code);
    const items = clone(c.pending ? c.pending.items : c.items), grades = clone(c.grades);
    syncRows(items, grades);
    const w = { draft: Object.fromEntries(D.draftItems.map((d) => [d.key, c.draft[d.key].on])), grades, exc: clone(c.exc), items, meta: clone(c.pending ? c.pending.meta : c.meta) };
    S.m = { code, tab: 'draft', cat: CATS[0], w, base: clone(w), ro: false };
    S.cf = null; render();
  }
  const dirty = () => S.m && JSON.stringify(S.m.w) !== JSON.stringify(S.m.base);
  const tabDirty = (t) => { const { w, base } = S.m; const j = JSON.stringify; return t === 'draft' ? j(w.draft) !== j(base.draft) : t === 'grade' ? j(w.grades) !== j(base.grades) || j(w.exc) !== j(base.exc) : j(w.items) !== j(base.items) || j(w.meta) !== j(base.meta); };

  function tabDraft(c, w) {
    const base = S.m.base.draft;
    return `<h4 class="sec-title">기안 항목 관리${mk(2)}</h4><p class="sec-desc">${c.code} 구성원의 <b>출장 기안</b> 화면에 노출할 섹션을 설정합니다. OFF인 섹션은 구성원 화면에 표시되지 않습니다.</p>
      ${D.draftItems.map((d) => `<div class="ditem ${w.draft[d.key] !== base[d.key] ? 'changed' : ''}"><div><div class="nm">${esc(d.name)}</div><div class="ds">${esc(d.desc)}</div><div class="ef">${w.draft[d.key] ? esc(d.link) : 'OFF 시 ' + esc(d.offEffect)}</div></div>
        <div><button type="button" class="tg" role="switch" aria-checked="${w.draft[d.key]}" aria-label="${esc(d.name)} 사용" data-a="tg" data-k="${d.key}"></button><span class="tg-label">${onoff(w.draft[d.key])}</span></div></div>`).join('')}
      <p class="note" style="margin-top:12px">저장 즉시 신규 기안부터 적용됩니다. 결재 진행 중 기안은 작성 당시 설정을 유지하고, 항목을 OFF로 바꾸면 임시저장 기안(${TEMP[c.code] || 0}건)은 삭제됩니다.${mk(3)}</p>`;
  }

  function tabGrade(c, w) {
    const used = new Map(); w.grades.forEach((g) => g.hr.forEach((t) => used.set(t, g.id)));
    const free = c.titles.filter((t) => !used.has(t));
    const people = D.people[c.code] || [];
    return `<div class="row between"><div><h4 class="sec-title">구성원 등급 <span class="hl-blue">${w.grades.length}</span>${mk(4)}</h4><p class="sec-desc">인사정보 직책을 등급에 매핑합니다. 등급은 여비규정 표의 행으로 쓰이며, 추가·삭제·이름 변경은 여비규정 표에 즉시 반영됩니다.</p></div><button type="button" class="btn sm" data-a="g-add">+ 등급 추가</button></div>
      ${w.grades.length ? `<table class="etbl"><thead><tr><th style="width:44px" class="c">기본${mk(6)}</th><th style="width:170px">등급명</th><th style="width:230px">설명</th><th>매핑 직책${mk(5)}</th><th style="width:96px"></th></tr></thead><tbody>
        ${w.grades.map((g, i) => `<tr><td class="c"><input type="radio" name="gdef" ${g.isDefault ? 'checked' : ''} data-a="g-def" data-id="${g.id}" aria-label="${esc(g.name)} 기본 등급"></td>
          <td><input class="inp" value="${esc(g.name)}" maxlength="20" placeholder="등급명" data-g="${g.id}" data-f="name" aria-label="등급명"></td>
          <td><input class="inp" value="${esc(g.desc || '')}" maxlength="60" placeholder="설명" data-g="${g.id}" data-f="desc" aria-label="설명"></td>
          <td><div class="tchips">${g.hr.map((t) => `<span class="tchip">${esc(t)}<button type="button" aria-label="${esc(t)} 매핑 해제" data-a="g-unmap" data-id="${g.id}" data-t="${esc(t)}">×</button></span>`).join('')}
            ${free.length ? `<select class="sel" data-a="g-map" data-id="${g.id}" aria-label="직책 추가"><option value="">+ 직책</option>${free.map((t) => `<option>${esc(t)}</option>`).join('')}</select>` : ''}${g.isDefault && !g.hr.length ? '<span class="help">미매핑 직책 전체</span>' : ''}</div></td>
          <td class="act"><button type="button" class="btn sm ghost" data-a="g-up" data-id="${g.id}" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button type="button" class="btn sm ghost" data-a="g-down" data-id="${g.id}" ${i < w.grades.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button><button type="button" class="btn sm danger" data-a="g-del" data-id="${g.id}">삭제</button></td></tr>`).join('')}
        </tbody></table>${free.length ? `<p class="note" style="margin-top:8px">미매핑 직책 ${free.length}개(${esc(free.join(', '))})는 기본 등급 <b>${esc((defGrade(w.grades) || {}).name || '-')}</b>이(가) 적용됩니다.</p>` : ''}`
        : `<div class="empty"><b>등록된 등급이 없습니다</b>등급이 없으면 여비규정의 모든 항목이 '전체 구성원' 단일 기준으로 적용됩니다.</div>`}

      <div class="row between" style="margin-top:26px"><div><h4 class="sec-title">개인 예외 지정 <span class="hl-blue">${w.exc.length}</span>${mk(7)}</h4><p class="sec-desc">직책 매핑과 다른 등급을 특정 구성원에게 개별 지정합니다. 적용 기간 동안 직책 매핑보다 우선합니다.</p></div><button type="button" class="btn sm" data-a="x-add" ${w.grades.length > 1 ? '' : 'disabled'}>+ 예외 지정 추가</button></div>
      ${w.exc.length ? `<table class="etbl"><thead><tr><th style="width:190px">구성원</th><th style="width:120px">매핑 등급</th><th style="width:150px">적용 등급</th><th>사유</th><th style="width:218px">적용 기간 (종료일 비우면 무기한)${mk(8)}</th><th style="width:52px"></th></tr></thead><tbody>
        ${w.exc.map((x) => { const cur = x.empNo ? mappedGrade(w.grades, x.hrTitle) : null; const end = x.end && x.end < D.TODAY;
          return `<tr><td>${x.isNew ? `<select class="sel" data-x="${x.id}" data-f="empNo" aria-label="구성원 선택"><option value="">구성원 선택</option>${people.filter((p) => p.empNo === x.empNo || !w.exc.some((e) => e.empNo === p.empNo)).map((p) => `<option value="${p.empNo}" ${p.empNo === x.empNo ? 'selected' : ''}>${esc(p.name)} (${p.empNo})</option>`).join('')}</select>` : `<b>${esc(x.name)}</b> <span class="help num">${esc(x.empNo)}</span>`}
            <div class="help">${esc([x.dept, x.hrTitle].filter(Boolean).join(' · '))}</div></td>
          <td style="vertical-align:middle">${cur ? esc(cur.name) : '<span class="help">-</span>'}</td>
          <td><select class="sel" data-x="${x.id}" data-f="to" aria-label="적용 등급"><option value="">선택</option>${w.grades.map((g) => `<option value="${g.id}" ${g.id === x.to ? 'selected' : ''} ${cur && cur.id === g.id ? 'disabled' : ''}>${esc(g.name)}</option>`).join('')}</select></td>
          <td><input class="inp" value="${esc(x.reason || '')}" maxlength="100" placeholder="사유 (필수)" data-x="${x.id}" data-f="reason" aria-label="사유"></td>
          <td><div class="row" style="gap:4px"><input class="inp num" value="${esc(x.start || '')}" placeholder="YYYY.MM.DD" maxlength="10" data-x="${x.id}" data-f="start" aria-label="시작일"><span>~</span><input class="inp num" value="${esc(x.end || '')}" placeholder="무기한" maxlength="10" data-x="${x.id}" data-f="end" aria-label="종료일"></div>${end ? badge('gray', '만료') : ''}</td>
          <td class="act"><button type="button" class="btn sm danger" data-a="x-del" data-id="${x.id}">삭제</button></td></tr>`; }).join('')}
        </tbody></table>` : `<div class="empty">${w.grades.length > 1 ? '개인 예외 지정이 없습니다. 모든 구성원에게 직책 매핑 등급이 적용됩니다.' : '등급이 2개 이상일 때 개인 예외를 지정할 수 있습니다.'}</div>`}`;
  }

  function itemBlock(it, w) {
    const t = it.table, money = it.type === 'cap' || it.type === 'flat';
    return `<div class="pitem ${it.on ? '' : 'off'}" data-item="${it.id}">
      <div class="ph"><button type="button" class="tg" role="switch" aria-checked="${it.on}" aria-label="${esc(it.name || '항목')} 사용" data-a="i-on" data-id="${it.id}"></button>
        <input class="inp nm" value="${esc(it.name)}" maxlength="20" placeholder="항목명" data-i="${it.id}" data-f="name" aria-label="항목명">
        ${it.on ? `<select class="sel" data-a="i-type" data-id="${it.id}" aria-label="지급 방식">${Object.keys(TYPES).map((k) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${TYPES[k]}</option>`).join('')}</select>
        ${money ? `<select class="sel" data-a="i-cur" data-id="${it.id}" aria-label="통화">${CURS.map((k) => `<option ${it.cur === k ? 'selected' : ''}>${k}</option>`).join('')}</select>` : ''}
        <input class="inp" value="${esc(it.unit || '')}" maxlength="30" placeholder="단위 (예: 1박 상한)" style="width:170px" data-i="${it.id}" data-f="unit" aria-label="단위">
        <label><input type="checkbox" ${it.byGrade ? 'checked' : ''} ${w.grades.length ? '' : 'disabled'} data-a="i-bygrade" data-id="${it.id}"> 등급별 차등</label>` : '<span class="help">사용 안 함 — 구성원에게 안내되지 않습니다</span>'}
        <span class="grow"></span><button type="button" class="btn sm ghost danger" data-a="i-del" data-id="${it.id}">항목 삭제</button></div>
      ${it.on ? `<div class="pb"><div class="mx-wrap"><table class="mx"><thead><tr><th class="l" style="min-width:120px">${it.byGrade ? '구성원 등급' : '대상'}</th>
          ${t.cols.map((col, ci) => `<th class="colh"><input class="inp" value="${esc(col)}" maxlength="24" placeholder="열 이름" data-col="${it.id}" data-ci="${ci}" aria-label="열 이름">${t.cols.length > 1 ? `<button type="button" class="cx" aria-label="${esc(col)} 열 삭제" data-a="c-del" data-id="${it.id}" data-ci="${ci}">×</button>` : ''}</th>`).join('')}
          <th style="width:54px"><button type="button" class="btn sm ghost" data-a="c-add" data-id="${it.id}">+ 열</button></th></tr></thead>
        <tbody>${t.rows.map((r, ri) => `<tr><td class="rh">${esc(r.label)}</td>${r.cells.map((v, ci) => `<td><input class="inp ${money && typeof v === 'number' ? 'cell' : 'l'} ${v == null || v === '' ? 'undef' : ''}" value="${v == null ? '' : esc(v)}" maxlength="60" placeholder="미정의" data-cell="${it.id}" data-ri="${ri}" data-ci="${ci}" aria-label="${esc(r.label)} · ${esc(t.cols[ci])}"></td>`).join('')}<td></td></tr>`).join('')}</tbody></table></div>
        <div class="line"><span>적용 조건</span><input class="inp" value="${esc(it.cond || '')}" maxlength="80" placeholder="선택 — 예: 출장 기간 10일 초과 시" data-i="${it.id}" data-f="cond" aria-label="적용 조건"></div>
        <div class="line"><span>구성원 안내</span><input class="inp" value="${esc(it.guide || '')}" maxlength="300" placeholder="선택 — 구성원에게 함께 보여줄 안내 문구" data-i="${it.id}" data-f="guide" aria-label="구성원 안내"></div></div>` : ''}</div>`;
  }

  function tabPolicy(c, w) {
    const m = S.m, src = m.ro ? c.items : w.items, list = src.filter((i) => i.cat === m.cat), ud = undefCount(src);
    const others = D.corps.filter((o) => o.code !== c.code && o.items.length);
    return `${c.pending ? `<div class="banner warn"><b>${esc(c.pending.from)} 적용 예정 변경이 있습니다.</b><span class="grow">${m.ro ? '지금 보는 값은 현재 적용 중인 값(읽기 전용)입니다.' : '아래는 적용 예정 내용이며 수정할 수 있습니다.'}</span>
        <div class="seg"><button type="button" class="${m.ro ? '' : 'on'}" data-a="p-ro" data-v="0">적용 예정본</button><button type="button" class="${m.ro ? 'on' : ''}" data-a="p-ro" data-v="1">현재 적용 값</button></div><button type="button" class="btn sm danger" data-a="p-cancel">예정 취소</button>${mk(14)}</div>` : ''}
      <div class="row between wrap"><div><h4 class="sec-title">여비규정 설정${mk(9)}</h4><p class="sec-desc">구성원에게 안내하는 출장 여비 기준입니다(자동 검증·차단 없음). 분류를 선택해 항목과 값을 입력합니다.</p></div>
        <div class="row"><span class="help">원문 문서</span><input class="inp" style="width:230px" value="${esc(w.meta.doc || '')}" maxlength="80" placeholder="파일명 (선택)" data-meta="doc" aria-label="원문 문서">${others.length ? `<button type="button" class="btn sm" data-a="p-copy">다른 법인 규정 복사</button>${mk(13)}` : ''}</div></div>
      <div class="row between wrap" style="margin-top:4px"><div class="seg" role="tablist">${CATS.map((cat) => `<button type="button" role="tab" aria-selected="${m.cat === cat}" class="${m.cat === cat ? 'on' : ''}" data-a="p-cat" data-v="${cat}">${cat}<em>${src.filter((i) => i.cat === cat).length}</em></button>`).join('')}</div>${mk(10)}
        <span class="help">${ud ? `<span style="color:var(--orange);font-weight:700">미정의 ${ud}칸</span> · ` : ''}숫자만 입력하면 금액으로, 문자가 섞이면 문구로 표시됩니다</span></div>
      ${list.length ? list.map((it) => itemBlock(it, w)).join('') : `<div class="empty" style="margin-top:10px"><b>${m.cat} 분류에 등록된 항목이 없습니다</b>${src.length ? '[+ 항목 추가]로 항목을 만들어 주세요.' : '표준 항목으로 시작하거나 다른 법인 규정을 복사해 올 수 있습니다.'}${!src.length ? `<div style="margin-top:10px"><button type="button" class="btn sm" data-a="p-template">표준 항목으로 시작</button></div>` : ''}</div>`}
      <div style="margin-top:10px"><button type="button" class="btn sm" data-a="i-add">+ ${m.cat} 항목 추가</button>${mk(12)}</div>`;
  }

  const MTABS = [['draft', '기안 항목 관리'], ['grade', '등급 규정'], ['policy', '여비규정 설정']];
  const tabsHtml = () => MTABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${S.m.tab === k}" class="${S.m.tab === k ? 'on' : ''}" data-a="m-tab" data-v="${k}">${l}${tabDirty(k) ? '<span class="dot" title="변경 있음"></span>' : ''}</button>`).join('');
  function modalHtml() {
    const m = S.m, c = corpOf(m.code), w = m.w, tabs = [['draft', '기안 항목 관리'], ['grade', '등급 규정'], ['policy', '여비규정 설정']];
    return `<div class="ov" data-ov="m"><div class="xmodal" role="dialog" aria-modal="true" aria-label="${c.code} 출장여비규정 관리">
      <div class="xh"><div><div class="t">${c.code} 출장여비규정 관리${mk(1)}</div><div class="s">${esc(c.name)} · ${esc(c.country)} · 기준 통화 ${c.cur} · 구성원 ${c.headcount.toLocaleString()}명</div></div><button type="button" class="x" aria-label="닫기" data-a="m-close">×</button></div>
      <div class="xtabs" role="tablist">${tabsHtml()}</div>
      <div class="xb" id="xb">${m.tab === 'draft' ? tabDraft(c, w) : m.tab === 'grade' ? tabGrade(c, w) : tabPolicy(c, w)}</div>
      <div class="xf"><button type="button" class="link" data-a="m-history">이 법인 변경 이력</button><span class="sp"></span><span class="help">${dirty() ? '저장하지 않은 변경이 있습니다' : '변경 없음'}</span>
        <button type="button" class="btn" data-a="m-close">취소</button><button type="button" class="btn pri" data-a="m-save" ${dirty() ? '' : 'disabled'}>저장</button>${mk(15)}</div>
    </div></div>`;
  }

  /* ---------- 변경 내역 계산 (컨펌 팝업·이력 공용) ---------- */
  function diffs() {
    const { w, base, code } = S.m, c = corpOf(code), out = [];
    const add = (cat, text, before, after) => out.push({ cat, text, before: before == null || before === '' ? '-' : String(before), after: after == null || after === '' ? '-' : String(after) });
    const first = !lastOf(code);
    D.draftItems.forEach((d) => { if (w.draft[d.key] !== base.draft[d.key]) add('기안 항목', d.name, onoff(base.draft[d.key]), onoff(w.draft[d.key])); });
    if (first && !out.length && false) add('기안 항목', '최초 설정', '-', '-');
    // 등급
    const gdesc = (g) => `${g.name}${g.hr.length ? ' (매핑: ' + g.hr.join(', ') + ')' : ''}${g.isDefault ? ' · 기본' : ''}`;
    base.grades.forEach((b) => { const g = w.grades.find((x) => x.id === b.id);
      if (!g) return add('등급 규정', `등급 삭제 — ${b.name}`, gdesc(b), '-');
      if (g.name !== b.name) add('등급 규정', `등급명 변경 — ${b.name}`, b.name, g.name);
      if ((g.desc || '') !== (b.desc || '')) add('등급 규정', `설명 변경 — ${g.name}`, b.desc, g.desc);
      if (g.hr.join('|') !== b.hr.join('|')) add('등급 규정', `직책 매핑 변경 — ${g.name}`, b.hr.join(', '), g.hr.join(', '));
      if (!!g.isDefault !== !!b.isDefault && g.isDefault) add('등급 규정', '기본 등급 변경', (defGrade(base.grades) || {}).name, g.name); });
    w.grades.filter((g) => !base.grades.some((b) => b.id === g.id)).forEach((g) => add('등급 규정', `등급 추가 — ${g.name}`, '-', gdesc(g)));
    const ord = (l) => l.filter((g) => base.grades.some((b) => b.id === g.id) && w.grades.some((b) => b.id === g.id)).map((g) => g.id).join();
    if (ord(base.grades) !== ord(w.grades)) add('등급 규정', '등급 순서 변경', base.grades.map((g) => g.name).join(' › '), w.grades.map((g) => g.name).join(' › '));
    // 개인 예외
    const xdesc = (x, gs) => `${gname(gs, x.to)} (${x.start || '?'} ~ ${x.end || '무기한'})`;
    base.exc.forEach((b) => { const x = w.exc.find((e) => e.id === b.id);
      if (!x) return add('개인 예외', `예외 지정 삭제 — ${b.name} (${b.empNo})`, xdesc(b, base.grades), '-');
      if (x.to !== b.to || x.start !== b.start || (x.end || '') !== (b.end || '')) add('개인 예외', `예외 지정 수정 — ${x.name} (${x.empNo})`, xdesc(b, base.grades), xdesc(x, w.grades));
      if (x.reason !== b.reason) add('개인 예외', `사유 수정 — ${x.name} (${x.empNo})`, b.reason, x.reason); });
    w.exc.filter((x) => !base.exc.some((b) => b.id === x.id)).forEach((x) => add('개인 예외', `예외 지정 추가 — ${x.name || '?'} (${x.empNo || '?'})`, x.empNo ? (mappedGrade(w.grades, x.hrTitle) || {}).name : '-', xdesc(x, w.grades)));
    // 여비규정
    const P = '여비규정';
    base.items.forEach((b) => { const it = w.items.find((x) => x.id === b.id);
      if (!it) return add(P, `항목 삭제 — ${b.cat} › ${b.name}`, b.on ? '사용' : '미사용', '-');
      const nm = `${it.cat} › ${it.name}`;
      if (it.name !== b.name) add(P, `항목명 변경 — ${b.cat} › ${b.name}`, b.name, it.name);
      if (it.on !== b.on) add(P, `${nm} 사용 여부`, b.on ? '사용' : '미사용', it.on ? '사용' : '미사용');
      if (it.type !== b.type) add(P, `${nm} 지급 방식`, TYPES[b.type], TYPES[it.type]);
      if ((it.cur || '') !== (b.cur || '') && (it.type === 'cap' || it.type === 'flat')) add(P, `${nm} 통화`, b.cur, it.cur);
      if ((it.unit || '') !== (b.unit || '')) add(P, `${nm} 단위`, b.unit, it.unit);
      if (it.byGrade !== b.byGrade) add(P, `${nm} 등급별 차등`, b.byGrade ? '적용' : '미적용', it.byGrade ? '적용' : '미적용');
      if ((it.cond || '') !== (b.cond || '')) add(P, `${nm} 적용 조건`, b.cond, it.cond);
      if ((it.guide || '') !== (b.guide || '')) add(P, `${nm} 구성원 안내`, b.guide, it.guide);
      const bc = b.table.cols, ic = it.table.cols;
      if (bc.join('|') !== ic.join('|')) add(P, `${nm} 열 구성`, bc.join(', '), ic.join(', '));
      if (it.byGrade === b.byGrade) { const ch = [];
        it.table.rows.forEach((r) => { const br = b.table.rows.find((x) => (r.gid ? x.gid === r.gid : x.label === r.label)); if (!br) return;
          r.cells.forEach((v, ci) => { const bi = bc.indexOf(ic[ci]); if (bi < 0) return; const bv = br.cells[bi]; if ((bv == null ? '' : bv) !== (v == null ? '' : v)) ch.push([`${r.label} · ${ic[ci]}`, fmt(bv, b.cur), fmt(v, it.cur)]); }); });
        if (ch.length) add(P, `${nm} — 값 ${ch.length}칸 변경`, ch.slice(0, 3).map((x) => `${x[0]} ${x[1]}`).join(' / ') + (ch.length > 3 ? ` 외 ${ch.length - 3}건` : ''), ch.slice(0, 3).map((x) => `${x[0]} ${x[2]}`).join(' / ') + (ch.length > 3 ? ` 외 ${ch.length - 3}건` : '')); } });
    w.items.filter((it) => !base.items.some((b) => b.id === it.id)).forEach((it) => add(P, `항목 추가 — ${it.cat} › ${it.name}`, '-', `${TYPES[it.type]}${it.byGrade ? ' · 등급별' : ''} · ${it.table.cols.length}열`));
    if ((w.meta.doc || '') !== (base.meta.doc || '')) add(P, '원문 문서', base.meta.doc, w.meta.doc);
    return out;
  }

  function validate() {
    const { w } = S.m, dateOk = (s) => /^\d{4}\.\d{2}\.\d{2}$/.test(s);
    const names = w.grades.map((g) => g.name.trim());
    if (names.some((n) => !n)) return ['grade', '등급명을 입력해 주세요.'];
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return ['grade', '같은 이름의 등급이 있습니다.'];
    if (w.grades.length && !defGrade(w.grades)) return ['grade', '기본 등급을 1개 지정해 주세요.'];
    for (const x of w.exc) {
      if (!x.empNo) return ['grade', '개인 예외 지정의 구성원을 선택해 주세요.'];
      if (!x.to || !w.grades.some((g) => g.id === x.to)) return ['grade', `${x.name}의 적용 등급을 선택해 주세요.`];
      if ((mappedGrade(w.grades, x.hrTitle) || {}).id === x.to) return ['grade', `${x.name}의 적용 등급이 매핑 등급과 같습니다.`];
      if (!(x.reason || '').trim()) return ['grade', `${x.name}의 예외 지정 사유를 입력해 주세요.`];
      if (!dateOk(x.start || '')) return ['grade', `${x.name}의 시작일을 YYYY.MM.DD 형식으로 입력해 주세요.`];
      if (x.end && (!dateOk(x.end) || x.end < x.start)) return ['grade', `${x.name}의 종료일을 확인해 주세요.`];
    }
    for (const it of w.items) {
      if (!it.name.trim()) return ['policy', `${it.cat} 분류에 항목명이 비어 있는 항목이 있습니다.`, it.cat];
      if (it.table.cols.some((c) => !c.trim())) return ['policy', `${it.name}의 열 이름을 입력해 주세요.`, it.cat];
      if (new Set(it.table.cols.map((c) => c.trim())).size !== it.table.cols.length) return ['policy', `${it.name}에 같은 이름의 열이 있습니다.`, it.cat];
    }
    return null;
  }

  function confirmHtml() {
    const cf = S.cf, c = corpOf(S.m.code);
    if (cf.kind === 'discard') return `<div class="ov top" data-ov="c"><div class="cmodal" role="alertdialog" aria-modal="true" style="width:420px"><div class="xh"><div class="t">변경 내용을 저장하지 않고 닫을까요?</div></div><div class="xb" style="padding-top:10px"><p>저장하지 않은 변경 ${cf.n}건이 사라집니다.</p></div><div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="c-back">계속 수정</button><button type="button" class="btn pri" data-a="c-discard">저장하지 않고 닫기</button></div></div></div>`;
    if (cf.kind === 'cancelPending') return `<div class="ov top" data-ov="c"><div class="cmodal" role="alertdialog" aria-modal="true" style="width:460px"><div class="xh"><div class="t">적용 예정 변경을 취소할까요?</div></div><div class="xb" style="padding-top:10px"><p><b>${c.code}</b>의 ${esc(c.pending.from)} 적용 예정 여비규정 변경을 취소합니다. 현재 적용 중인 값은 그대로 유지되며, 취소 내역은 변경 이력에 남습니다.</p>${dirty() ? '<div class="cf-warn o">이 창에서 저장하지 않은 다른 변경도 함께 사라집니다.</div>' : ''}</div><div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="c-back">돌아가기</button><button type="button" class="btn pri" data-a="c-cancel-pending">예정 취소</button></div></div></div>`;
    const ds = cf.diffs, cats = ['기안 항목', '등급 규정', '개인 예외', '여비규정'];
    const offs = D.draftItems.filter((d) => S.m.base.draft[d.key] && !S.m.w.draft[d.key]);
    const gdel = ds.filter((d) => d.text.startsWith('등급 삭제')).length, ud = undefCount(S.m.w.items), hasP = ds.some((d) => d.cat === '여비규정');
    return `<div class="ov top" data-ov="c"><div class="cmodal" role="alertdialog" aria-modal="true" aria-label="변경 내용 확인">
      <div class="xh"><div><div class="t">변경 내용 확인${mk(1)}</div><div class="s"><b>${c.code}</b> ${esc(c.name)} · 변경 ${ds.length}건을 저장합니다.</div></div><button type="button" class="x" aria-label="닫기" data-a="c-back">×</button></div>
      <div class="xb"><table class="tbl"><thead><tr><th>구분</th><th>변경 내용${mk(2)}</th><th style="width:44%">변경 전 → 변경 후</th></tr></thead><tbody>
        ${cats.flatMap((cat) => ds.filter((d) => d.cat === cat)).map((d) => `<tr><td style="white-space:nowrap">${esc(d.cat)}</td><td>${esc(d.text)}</td><td><div class="hist-ba"><span class="b">${esc(d.before)}</span><span class="dim">→</span><span class="a">${esc(d.after)}</span></div></td></tr>`).join('')}</tbody></table>
        ${offs.length ? `<div class="cf-warn">${mk(3)}<b>${esc(offs.map((d) => d.name).join(', '))}</b>을(를) OFF로 전환하면 ${c.code} 구성원의 <b>임시저장 출장 기안 ${TEMP[c.code] || 0}건이 삭제</b>되며 복구할 수 없습니다. 결재 진행 중 기안은 작성 당시 설정을 유지합니다.</div>` : ''}
        ${gdel ? `<div class="cf-warn o">등급 ${gdel}개를 삭제하면 여비규정 표에서 해당 등급의 행과 값이 함께 삭제됩니다.</div>` : ''}
        ${hasP && ud ? `<div class="cf-warn o">여비규정에 값이 비어 있는 칸이 ${ud}개 있습니다. 구성원에게는 '미정의'로 안내됩니다.</div>` : ''}
        ${hasP ? `<div class="frow" style="margin-top:8px"><span class="lb">여비규정 적용${mk(4)}</span><span><label style="margin-right:14px"><input type="radio" name="cfw" value="now" ${cf.when === 'now' ? 'checked' : ''} data-a="c-when"> 즉시 적용</label><label><input type="radio" name="cfw" value="date" ${cf.when === 'date' ? 'checked' : ''} data-a="c-when"> 적용일 지정</label>
          <input class="inp num" id="cf-date" value="${esc(cf.date)}" placeholder="YYYY.MM.DD" maxlength="10" style="width:110px;margin-left:6px" ${cf.when === 'date' ? '' : 'disabled'} aria-label="적용 시작일"><div class="help" style="margin-top:3px">기안 항목 · 등급 규정 · 개인 예외는 항상 즉시 적용됩니다. 적용일 지정은 여비규정 값에만 해당합니다.</div></span></div>` : ''}
        <div class="frow" style="align-items:start"><label class="lb req" for="cf-reason">변경 사유${mk(5)}</label><span><textarea class="ta" id="cf-reason" rows="2" maxlength="200" placeholder="변경 이력에 함께 기록됩니다 (필수, 200자 이내)">${esc(cf.reason)}</textarea><div class="err" id="cf-err" role="alert">${esc(cf.err || '')}</div></span></div></div>
      <div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="c-back">돌아가기</button><button type="button" class="btn pri" data-a="c-save">최종 저장</button>${mk(6)}</div></div></div>`;
  }

  function commit() {
    const cf = S.cf, m = S.m, c = corpOf(m.code), w = m.w;
    const reason = $('#cf-reason').value.trim(); cf.reason = reason;
    const hasP = cf.diffs.some((d) => d.cat === '여비규정'); let sched = null;
    if (hasP && cf.when === 'date') { const d = $('#cf-date').value.trim(); cf.date = d; if (!/^\d{4}\.\d{2}\.\d{2}$/.test(d) || d <= D.TODAY) { cf.err = `적용 시작일은 ${D.TODAY} 이후 날짜를 YYYY.MM.DD 형식으로 입력해 주세요.`; return render(); } sched = d; }
    if (!reason) { cf.err = '변경 사유를 입력해 주세요.'; render(); $('#cf-reason').focus(); return; }
    const at = now(), sid = 'S-' + String(++saveNo).padStart(4, '0');
    D.draftItems.forEach((d) => { if (c.draft[d.key].on !== w.draft[d.key]) { if (!w.draft[d.key]) TEMP[c.code] = 0; c.draft[d.key] = { on: w.draft[d.key], at, by: D.admin }; } });
    w.exc.forEach((x) => delete x.isNew);
    c.grades = clone(w.grades); c.exc = clone(w.exc);
    if (sched) { syncRows(c.items, c.grades); c.pending = { from: sched, items: clone(w.items), meta: clone(w.meta) }; }
    else { c.items = clone(w.items); c.meta = Object.assign(clone(w.meta), hasP ? { from: D.TODAY } : { from: c.meta.from }); if (hasP || !c.pending) c.pending = null; else syncRows(c.pending.items, c.grades); }
    cf.diffs.slice().reverse().forEach((d) => H.unshift({ at, corp: c.code, cat: d.cat, text: d.text + (d.cat === '여비규정' && sched ? ` (${sched} 적용 예정)` : ''), before: d.before, after: d.after, reason, by: D.admin, sid }));
    const n = cf.diffs.length; S.m = null; S.cf = null; render();
    toast(`${c.code} 변경 ${n}건을 저장했습니다.${sched ? ' 여비규정은 ' + sched + '부터 적용됩니다.' : ''}`);
  }

  /* ================= Description ================= */
  const item = (i) => `<div class="desc-item" data-d="${i[0]}"><i class="mk">${i[0]}</i><div><div class="dt">${i[1]}</div><div class="db">${i[2]}</div></div></div>`;
  function descData() {
    if (S.cf && S.cf.kind === 'save') return { sid: 'TRIP-ADM-POL-03', title: '변경 내용 확인 팝업', sum: '관리 모달의 [저장]을 누르면 뜨는 최종 확인 단계. 모든 수정은 이 팝업을 거쳐야 저장된다.', items: [
      [1, '팝업 호출', '관리 모달에서 변경이 1건 이상이고 입력 검증을 통과했을 때만 뜬다. 검증 실패 시 팝업 없이 해당 탭으로 이동해 토스트로 사유를 알린다. 팝업은 관리 모달 위에 겹쳐 뜨고, 바깥 클릭으로는 닫히지 않는다.'],
      [2, '변경 내역 표', '3개 탭의 변경을 한 번에 모아 구분(기안 항목 / 등급 규정 / 개인 예외 / 여비규정) 순으로 보여준다. 값 변경은 항목 단위로 묶어 "값 N칸 변경"으로 표기하고 앞 3건의 전·후 값을 보여준다. 이 표의 행이 그대로 변경 이력 1건씩이 된다.'],
      [3, '경고 영역', '<ul><li>기안 항목을 OFF로 전환: 해당 법인의 임시저장 출장 기안 N건 삭제(복구 불가) — 빨간색.</li><li>등급 삭제: 여비규정 표에서 해당 등급 행과 값이 함께 삭제됨 — 주황색.</li><li>여비규정에 빈 칸: 구성원에게 "미정의"로 안내됨 — 주황색.</li><li>해당 사항이 없으면 노출하지 않는다.</li></ul>'],
      [4, '여비규정 적용 시점', '여비규정 변경이 포함될 때만 노출. 기본값 <code>즉시 적용</code>. <code>적용일 지정</code>을 고르면 날짜 입력이 활성화되며 오늘 이후(YYYY.MM.DD)만 허용한다. 지정 시 여비규정 값은 "적용 예정"으로 보관되고 현재 값은 유지된다. 기안 항목·등급 규정·개인 예외는 항상 즉시 적용.'],
      [5, '변경 사유', '필수, 200자 이내. 비우고 저장하면 입력란 아래에 오류 문구를 띄우고 저장하지 않는다. 같은 저장 건의 모든 이력 행에 동일하게 기록된다.'],
      [6, '버튼', '<code>돌아가기</code>: 관리 모달로 복귀(입력 유지). <code>최종 저장</code>: 저장 → 두 창 모두 닫기 → 그리드 갱신 → "변경 N건을 저장했습니다" 토스트. 저장 번호(S-0000)를 발급해 이력에 남긴다.'],
    ], pol: ['모든 수정은 컨펌 팝업의 [최종 저장]으로만 반영된다. 모달 안의 토글·입력·추가·삭제는 저장 전까지 작업본에만 반영된다.', '저장하지 않고 닫으려 하면 "저장하지 않고 닫을까요?" 확인을 띄운다. 적용 예정 취소도 별도 확인 팝업을 거친다.'], iss: ['<b>변경 사유 필수 여부</b> — 프로토타입은 모든 저장에 필수로 두었다. 기안 항목 토글처럼 단순한 변경에도 필수로 할지 확인 필요.', '<b>적용일 지정 범위</b> — 현재는 여비규정 값에만 적용일 지정이 가능하다. 기안 항목·등급 규정에도 예약 적용이 필요한지, 적용 예정본을 법인당 1건으로 제한해도 되는지 확인 필요.', '<b>임시저장 기안 삭제 범위</b> — 해당 법인의 임시저장 기안 전체인지, OFF되는 섹션에 값을 입력한 건만인지, 작성자 알림 여부.'] };
    if (S.m) {
      const t = S.m.tab;
      const common = [[1, '관리 모달', '그리드의 [관리]로 호출. 제목에 법인 코드, 부제에 법인명·국가·기준 통화·구성원 수(인사정보 연동, 읽기 전용). 탭 3개로 구성하며, 변경이 있는 탭에는 주황 점을 표시한다. 탭을 오가도 입력은 유지된다.'],
        [15, '하단 영역', '<ul><li><code>이 법인 변경 이력</code>: 해당 법인으로 필터된 변경 이력 화면으로 이동(변경이 있으면 닫기 확인).</li><li><code>저장</code>: 변경이 없으면 비활성. 누르면 입력 검증 후 변경 내용 확인 팝업(TRIP-ADM-POL-03)을 띄운다.</li><li><code>취소</code>/×/Esc: 변경이 있으면 닫기 확인을 띄운다.</li></ul>']];
      if (t === 'draft') return { sid: 'TRIP-ADM-POL-02a', title: '관리 모달 — 기안 항목 관리', sum: '구성원 출장 기안 화면의 섹션 3종 사용 여부를 법인별로 설정한다.', items: [common[0],
        [2, '항목 3종', '출장 예산 / 법인카드 실시간 한도증액 / 출장 근태 신청. 항목은 고정이며 추가·삭제·순서 변경은 없다. 토글을 바꾸면 항목명 옆에 "변경" 표시가 붙고, 보조 문구가 ON이면 연동 시스템, OFF이면 구성원 화면 영향으로 바뀐다. 토글은 즉시 저장되지 않는다.'],
        [3, '적용 안내', '저장 즉시 신규 기안부터 적용, 결재 진행 중 기안은 작성 당시 설정 유지, OFF 전환 시 임시저장 기안 삭제. 삭제 건수는 컨펌 팝업에서 다시 경고한다.'], common[1]],
        pol: ['OFF인 섹션은 구성원 기안 화면에서 영역 자체를 노출하지 않는다.', '연동 여부와 관계없이 모든 법인에서 ON을 막지 않는다.', '신규 법인의 기본값은 3개 모두 OFF(가정).'], iss: ['<b>연동 미비 법인에서 ON</b> — 섹션이 열렸을 때 불러오기·신청 버튼의 동작(오류 안내 등) 확인 필요.', '<b>신규 연동 법인 기본값</b> — 전부 OFF로 가정했다. 확정 필요.'] };
      if (t === 'grade') return { sid: 'TRIP-ADM-POL-02b', title: '관리 모달 — 등급 규정', sum: '법인별 구성원 등급과 직책 매핑, 개인 예외 지정을 표 안에서 바로 추가·수정·삭제한다.', items: [common[0],
        [4, '구성원 등급 표', '<ul><li><code>+ 등급 추가</code>: 표 맨 아래에 빈 행 추가(첫 등급은 자동으로 기본 등급).</li><li>등급명: 필수, 20자, 법인 내 중복 불가. 설명: 선택, 60자.</li><li>▲▼로 순서를 바꾸며, 이 순서가 여비규정 표의 행 순서가 된다.</li><li><code>삭제</code>: 개인 예외 지정의 적용 등급으로 쓰이고 있으면 삭제 불가(토스트). 기본 등급은 다른 등급을 기본으로 지정한 뒤 삭제.</li><li>등급 추가·삭제·이름 변경은 같은 모달의 여비규정 표(등급별 차등 항목)에 즉시 반영된다. 추가된 등급의 값은 미정의.</li></ul>'],
        [5, '매핑 직책', '인사정보 직책을 칩으로 표시. <code>+ 직책</code> 선택 상자에는 아직 어느 등급에도 매핑되지 않은 직책만 나온다(한 직책은 한 등급에만). 칩의 ×로 해제. 미매핑 직책은 표 아래에 개수·목록과 함께 "기본 등급 적용"으로 안내한다.'],
        [6, '기본 등급', '라디오로 법인당 1개 지정(필수). 어느 등급에도 매핑되지 않은 직책의 구성원에게 적용된다.'],
        [7, '개인 예외 지정', '<ul><li><code>+ 예외 지정 추가</code>: 등급이 2개 이상일 때 활성. 빈 행이 추가되고 구성원을 선택하면 소속·직책·매핑 등급이 자동 표시된다. 이미 지정된 구성원은 선택 목록에서 제외.</li><li>적용 등급: 매핑 등급과 같은 등급은 선택 불가. 사유: 필수, 100자.</li><li>기존 건은 구성원을 바꿀 수 없고 적용 등급·사유·기간만 수정한다. <code>삭제</code>는 행을 제거한다.</li></ul>'],
        [8, '적용 기간', '시작일 필수, 종료일 선택(비우면 무기한). YYYY.MM.DD, 종료일은 시작일 이후. 종료일이 지난 건은 "만료" 배지를 표시하고 직책 매핑 등급으로 돌아간다. 과거 시작일(소급)도 허용.'], common[1]],
        pol: ['등급은 법인별로 정의하고 인사정보 직책에 매핑해 자동 판정한다. 개인 예외 지정은 적용 기간 동안 직책 매핑보다 우선한다.', '등급 기준 변경은 여비규정 표에 즉시 반영한다(추가=미정의 행, 삭제=행과 값 삭제, 이름 변경=값 유지).', '입력 검증은 [저장] 시점에 한 번에 한다.'], iss: ['<b>매핑 키</b> — 인사정보에서 가져오는 값이 직책인지 직급인지, 법인별 코드 체계 확인 필요.', '<b>구성원 선택 방식</b> — 프로토타입은 샘플 목록 선택 상자다. 실제는 인사정보 구성원 검색(이름·사번) 컴포넌트가 필요하다.', '<b>예외 지정 승인</b> — 관리자 등록만으로 충분한지, 별도 승인·증빙이 필요한지.', '<b>직책 변경 시 예외 지정 유지 여부</b> — 발령으로 직책이 바뀐 구성원의 예외 지정 처리.'] };
      return { sid: 'TRIP-ADM-POL-02c', title: '관리 모달 — 여비규정 설정', sum: '교통 / 숙박 / 일비·식비 / 기타 4개 분류로 항목과 값을 입력한다. 기준 정보 관리·구성원 안내용이며 자동 검증·차단은 없다.', items: [common[0],
        [9, '여비규정 설정', '원문 문서(선택, 파일명 80자 — 실제는 파일 첨부)를 함께 관리한다. 개정 버전 목록은 두지 않고 현재 값 1벌만 편집한다. 과거 값은 변경 이력에서 확인한다.'],
        [10, '분류 선택', '교통 / 숙박 / 일비·식비 / 기타. 분류별 항목 수를 함께 표시하고, 선택한 분류의 항목만 아래에 나열한다. 값이 빈 칸이 있으면 우측에 "미정의 N칸"을 주황색으로 표시한다.'],
        [11, '항목 블록', '<ul><li>사용 토글: OFF면 값 영역을 접고 구성원에게 안내하지 않는다(값은 보존).</li><li>항목명(필수, 20자), 지급 방식(등급 기준 / 한도 내 실비 / 정액 지급 / 실비), 통화(한도·정액일 때만), 단위(30자).</li><li><b>등급별 차등</b> 체크: 켜면 행이 등급 목록으로, 끄면 "전체 구성원" 1행으로 바뀐다(끄면 첫 행 값만 남김). 등급이 없는 법인은 비활성.</li><li>열: 지역·조건 등 구분을 자유롭게 입력한다(열 이름 24자, 중복 불가). <code>+ 열</code>로 추가, ×로 삭제(최소 1열).</li><li>칸: 숫자만 입력하면 금액(통화 기호·천 단위 구분), 문자가 섞이면 문구로 저장. 빈 칸은 주황 테두리 + "미정의".</li><li>적용 조건(80자)·구성원 안내(300자)는 선택.</li></ul>'],
        [12, '항목 추가 · 삭제', '<code>+ (분류) 항목 추가</code>는 현재 분류 맨 아래에 빈 항목(한도 내 실비, 1행 1열)을 만든다. <code>항목 삭제</code>는 즉시 작업본에서 제거하며 저장 전에는 취소로 되돌릴 수 있다. 항목이 하나도 없는 법인에는 <code>표준 항목으로 시작</code>(항공·철도·숙박·식비·출장 수당·통신비)을 제공한다.'],
        [13, '다른 법인 규정 복사', '적용 중 규정이 있는 다른 법인을 골라 항목·값을 통째로 복사해 온다(현재 작업본을 대체, 확인 필요). 1회성 복사이며 법인 간 연결은 없다. 등급별 차등 항목의 행은 이 법인의 등급 순서대로 값을 옮기고, 등급 수가 다르면 남는 값은 버리고 모자란 칸은 미정의로 둔다.'],
        [14, '적용 예정 배너', '적용일을 지정해 저장한 변경이 있을 때만 노출. <code>적용 예정본</code>(편집 가능) / <code>현재 적용 값</code>(읽기 전용)을 전환해 볼 수 있고, <code>예정 취소</code>는 확인 팝업을 거쳐 예정 변경을 폐기한다. 적용일이 되면 시스템이 예정본을 현재 값으로 바꾼다(프로토타입은 자동 전환 미구현).'], common[1]],
        pol: ['여비규정은 기준 정보 관리 + 구성원 안내용이다. 출장 계획서 자동 검증·차단, 규정 예외 신청 연동은 하지 않는다.', '지역 구분은 별도 마스터 없이 항목별 열 이름으로 관리한다(간소화). 법인마다, 항목마다 지역 구분이 달라도 된다.', '규정을 공유하는 법인(HBA·HBL)도 각각 등록하며, 복사는 1회성이다.', 'HYB 값은 화면 예시용 샘플, HBA·HBL·HBJ는 유첨 규정 문서 기준 값이다.'], iss: ['<b>지역 열과 출장지 마스터 연결</b> — 간소화를 위해 지역을 자유 입력 열로 바꿨다. 구성원 안내 시 출장지(국가·도시)에 맞는 열을 자동으로 골라 보여주려면 출장지 관리와의 매핑이 다시 필요하다.', '<b>항목 안에 통화가 섞이는 경우</b> — HBJ 식비(¥/₩/US$)처럼 열마다 통화가 다른 경우는 문구로 입력하게 했다. 칸 단위 통화 지정이 필요한지 확인 필요.', '<b>구성원 안내 노출 위치</b> — 출장 계획서·기안 화면 중 어디에 어떤 형태로 보여줄지 미정.', '<b>다국어 표기</b> — 항목명·안내 문구를 영어·일본어로 함께 등록할지.'] };
    }
    if (S.view === 'history') return { sid: 'TRIP-ADM-POL-04', title: '변경 이력', sum: '법인별 출장여비규정의 모든 수정 내역을 조회하는 별도 화면. 그리드의 [변경 이력] 또는 관리 모달의 [이 법인 변경 이력]으로 진입한다.', items: [
      [1, '이력 목록', '최신순. 변경 1건 = 1행(컨펌 팝업의 변경 내역 표 1행과 동일). 건수는 필터 결과 기준. 상단 "← 목록"으로 마스터 그리드에 돌아간다. 조회 전용이며 되돌리기·삭제 기능은 없다.'],
      [2, '필터 · 검색', '법인(전체 + 인사정보 연동 법인), 구분(기안 항목 / 등급 규정 / 개인 예외 / 여비규정), 검색(변경 내용·전후 값·사유·수정자 부분 일치, 30자). 입력 즉시 반영. 관리 모달에서 진입하면 해당 법인이 선택된 상태로 열린다. 결과가 없으면 빈 상태 문구를 표시한다.'],
      [3, '변경 내용 · 전후 값', '무엇이 바뀌었는지(예: "숙박 — 값 6칸 변경")와 변경 전 → 변경 후 값을 나란히 보여준다. 추가는 변경 전 "-", 삭제는 변경 후 "-". 적용일을 지정한 여비규정 변경은 내용 끝에 "(YYYY.MM.DD 적용 예정)"을 붙인다.'],
      [4, '저장 번호', '한 번의 [최종 저장]에 발급되는 번호(S-0000). 같은 번호의 행은 한 번에 저장된 변경이며 변경 사유·일시·수정자가 같다.'],
    ], pol: ['모든 수정 건은 일시·수정자·사유·전후 값과 함께 이력으로 남는다.', '본사(HYB) 출장 관리자만 조회한다.'], iss: ['<b>기간 필터 · 엑셀 다운로드 · 페이지네이션</b> — 필요 여부와 기본 조회 기간 확인 필요(프로토타입은 전체 표시).', '<b>값 변경의 상세 수준</b> — 값이 여러 칸 바뀌면 앞 3건만 보여준다. 칸 단위 전체 내역을 펼쳐 보는 상세가 필요한지.', '<b>이력 보존 기간</b>'] };
    return { sid: 'TRIP-ADM-POL-01', title: '법인별 출장여비규정 (마스터 그리드)', sum: '출장 관리에 추가되는 단일 메뉴의 기본 화면. 전 법인의 설정 값을 한 표로 보여주고, 수정은 [관리] 모달에서 한다.', items: [
      [1, '요약 칩', '법인 수, 여비규정 등록/미등록 법인 수(항목이 1개 이상이면 등록), 인사정보 연동 시각. 검색·필터와 무관하게 전체 기준.'],
      [2, '필터 · 검색', '여비규정 등록 여부(전체/등록/미등록) + 법인 코드·법인명 부분 일치 검색(30자, 대소문자 무시, 입력 즉시 반영). 결과가 없으면 빈 상태 문구.'],
      [3, '법인', '인사정보의 법인 코드·법인명·국가·기준 통화·구성원 수를 그대로 노출(읽기 전용). 이 화면에서 법인을 추가·삭제할 수 없다. 정렬은 인사정보 연동 순서.'],
      [4, '기안 항목', '출장 예산 / 법인카드 실시간 한도증액 / 출장 근태 신청의 현재 ON(파랑)·OFF(회색) 상태. 그리드에서는 조회만 하고 변경은 [관리]에서 한다.'],
      [5, '등급 규정', '법인에 정의된 등급명을 순서대로 표시, 없으면 "미등록". 개인 예외는 지정 건수(만료 포함), 없으면 "-".'],
      [6, '여비규정', '교통 / 숙박 / 일비·식비 / 기타 분류별 등록 항목명. 사용 안 함 항목은 흐리게 "(미사용)". 항목이 하나도 없는 법인은 4개 열을 합쳐 "미등록"으로 표시한다.'],
      [7, '변경 이력', '전 법인의 변경 이력 화면(TRIP-ADM-POL-04)으로 이동한다.'],
      [8, '최종 수정 · 관리', '최종 수정: 가장 최근 저장 일자·수정자, 여비규정 시행일, 적용 예정 변경(파랑 배지), 미정의 칸 수(주황 배지). <code>관리</code>: 해당 법인의 관리 모달(TRIP-ADM-POL-02)을 연다.'],
    ], pol: ['출장 관리에 추가되는 메뉴는 <b>법인별 출장여비규정</b> 탭 하나이며, 기본 화면은 이 마스터 그리드 하나다.', '수정은 [관리] 모달에서만 하고, 모든 수정은 컨펌 팝업을 거쳐 저장하며 변경 이력에 남는다.', '본사(HYB) 출장 관리자만 접근하며 전 법인을 관리한다.', '법인 목록은 인사정보 연동 결과를 그대로 사용한다.'], iss: ['<b>그리드에 노출할 값의 깊이</b> — 현재는 항목명까지만 보여준다. 대표 값(예: 숙박 상한)까지 그리드에 보여줄지 확인 필요.', '<b>엑셀 다운로드</b> — 전 법인 현황 내려받기 필요 여부.', '<b>법인명</b> — HBC·HBI의 법인명은 예시이며 인사정보 값으로 대체된다.'] };
  }
  function renderDesc() {
    const d = descData(); $('#sid').textContent = d.sid;
    $('#desc').innerHTML = `<div class="desc-in"><h2>${d.title}</h2><div class="dsub">${d.sid} · ${d.sum}</div><h4>화면 상세</h4>${d.items.map(item).join('')}
      ${d.pol.length ? '<h4>정책</h4><div class="desc-item" style="grid-template-columns:1fr"><div class="db"><ul>' + d.pol.map((p) => `<li>${p}</li>`).join('') + '</ul></div></div>' : ''}
      ${d.iss.length ? '<h4>확인 필요 사항</h4>' + d.iss.map((p) => `<div class="issue">${p}</div>`).join('') : ''}
      <h4>화면 목록</h4><div class="desc-item" style="grid-template-columns:1fr"><div class="db"><ul><li><code>POL-01</code> 마스터 그리드</li><li><code>POL-02a~c</code> 관리 모달 (기안 항목 관리 / 등급 규정 / 여비규정 설정)</li><li><code>POL-03</code> 변경 내용 확인 팝업</li><li><code>POL-04</code> 변경 이력</li></ul></div></div></div>`;
  }

  /* ================= 렌더 · 이벤트 ================= */
  function toast(msg) { document.querySelectorAll('.toast').forEach((e) => e.remove()); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
  function render(keep) {
    const xb = $('#xb'), st = xb ? xb.scrollTop : 0, ae = document.activeElement, sel = ae && ae.dataset && ae.dataset.a === 'q' ? '[data-a="q"]' : ae && ae.dataset && ae.dataset.h === 'q' ? '[data-h="q"]' : null;
    if (!keep) $('#view').innerHTML = S.view === 'history' ? historyView() : gridView();
    $('#layer').innerHTML = (S.m ? modalHtml() : '') + (S.cf ? confirmHtml() : '');
    if ($('#xb')) $('#xb').scrollTop = st;
    if (S.m && S.m.tab === 'policy' && S.m.ro) $('#xb').querySelectorAll('.pitem input,.pitem select,.pitem button,[data-a="i-add"],[data-a="p-copy"],[data-a="p-template"],[data-meta]').forEach((e) => { e.disabled = true; });
    const fm = $('.pitem'); if (fm && !$('.pitem .mk')) { const ph = $('.pitem .ph .inp.nm'); if (ph) ph.insertAdjacentHTML('afterend', mk(11)); }
    if (sel && !S.m) { const e = $(sel); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }
    renderDesc();
  }
  const mrender = () => render(true);
  function closeModal(then) { if (dirty()) { S.cf = { kind: 'discard', n: diffs().length, then }; mrender(); } else { S.m = null; S.cf = null; if (then) then(); render(); } }

  const wItem = (id) => S.m.w.items.find((i) => i.id === id);
  const ACT = {
    manage: (d) => openManage(d.code),
    history: () => { S.view = 'history'; S.hist = { corp: '', cat: '', q: '' }; render(); window.scrollTo(0, 0); },
    grid: () => { S.view = 'grid'; render(); },
    'm-tab': (d) => { S.m.tab = d.v; mrender(); $('#xb').scrollTop = 0; },
    'm-close': () => closeModal(),
    'm-history': () => { const code = S.m.code; closeModal(() => { S.view = 'history'; S.hist = { corp: code, cat: '', q: '' }; }); },
    'm-save': () => { const v = validate(); if (v) { S.m.tab = v[0]; if (v[2]) S.m.cat = v[2]; mrender(); return toast(v[1]); } S.cf = { kind: 'save', diffs: diffs(), when: corpOf(S.m.code).pending ? 'date' : 'now', date: corpOf(S.m.code).pending ? corpOf(S.m.code).pending.from : '', reason: '', err: '' }; mrender(); $('#cf-reason').focus(); },
    tg: (d) => { S.m.w.draft[d.k] = !S.m.w.draft[d.k]; mrender(); const b = $(`[data-a="tg"][data-k="${d.k}"]`); if (b) b.focus(); },
    // 등급
    'g-add': () => { const w = S.m.w; w.grades.push({ id: uid('g'), name: '', desc: '', hr: [], count: null, isDefault: !w.grades.length || undefined }); syncRows(w.items, w.grades); mrender(); const ins = document.querySelectorAll('[data-f="name"][data-g]'); ins[ins.length - 1].focus(); },
    'g-del': (d) => { const w = S.m.w, g = w.grades.find((x) => x.id === d.id); if (w.exc.some((x) => x.to === g.id)) return toast('개인 예외 지정에서 적용 등급으로 사용 중이라 삭제할 수 없습니다.'); if (g.isDefault && w.grades.length > 1) return toast('기본 등급입니다. 다른 등급을 기본으로 지정한 뒤 삭제해 주세요.'); w.grades.splice(w.grades.indexOf(g), 1); syncRows(w.items, w.grades); mrender(); },
    'g-up': (d) => moveG(d.id, -1), 'g-down': (d) => moveG(d.id, 1),
    'g-def': (d) => { S.m.w.grades.forEach((g) => { if (g.id === d.id) g.isDefault = true; else delete g.isDefault; }); mrender(); },
    'g-unmap': (d) => { const g = S.m.w.grades.find((x) => x.id === d.id); g.hr = g.hr.filter((t) => t !== d.t); mrender(); },
    // 개인 예외
    'x-add': () => { S.m.w.exc.push({ id: uid('x'), isNew: true, empNo: '', name: '', dept: '', hrTitle: '', to: '', reason: '', start: D.TODAY, end: '' }); mrender(); },
    'x-del': (d) => { const l = S.m.w.exc; l.splice(l.findIndex((x) => x.id === d.id), 1); mrender(); },
    // 여비규정
    'p-cat': (d) => { S.m.cat = d.v; mrender(); },
    'p-ro': (d) => { S.m.ro = d.v === '1'; mrender(); },
    'p-cancel': () => { S.cf = { kind: 'cancelPending' }; mrender(); },
    'p-template': () => { const w = S.m.w; TEMPLATE.forEach(([cat, name, type]) => { const it = newItem(cat, w.grades); it.name = name; it.type = type; it.cur = type === 'class' ? null : corpOf(S.m.code).cur; it.byGrade = type === 'class' && w.grades.length > 0; w.items.push(it); }); syncRows(w.items, w.grades); mrender(); },
    'p-copy': () => { const code = S.m.code, others = D.corps.filter((o) => o.code !== code && o.items.length); S.cf = null;
      const el = document.createElement('div'); el.className = 'ov top'; el.innerHTML = `<div class="cmodal" role="dialog" aria-modal="true" style="width:440px"><div class="xh"><div class="t">다른 법인 규정 복사</div></div><div class="xb" style="padding-top:10px"><div class="frow"><label class="lb req" for="cp-src">가져올 법인</label><select class="sel" id="cp-src">${others.map((o) => `<option value="${o.code}">${o.code} · ${esc(o.name)} (항목 ${o.items.length}개)</option>`).join('')}</select></div><div class="cf-warn o">${S.m.w.items.length ? `현재 입력된 ${code}의 여비규정 항목 ${S.m.w.items.length}개를 <b>모두 대체</b>합니다. ` : ''}복사 후에도 원본 법인과 연결되지 않으며, 등급별 값은 ${code}의 등급 순서대로 옮겨집니다. [저장] 전까지는 반영되지 않습니다.</div></div><div class="xf"><span class="sp"></span><button type="button" class="btn" id="cp-no">취소</button><button type="button" class="btn pri" id="cp-ok">복사해 오기</button></div></div>`;
      $('#layer').appendChild(el); $('#cp-no').onclick = () => el.remove();
      $('#cp-ok').onclick = () => { const src = corpOf($('#cp-src').value), w = S.m.w; w.items = clone(src.items).map((it) => { it.id = uid('i'); if (it.byGrade) { it.table.rows = w.grades.length ? w.grades.map((g, i) => ({ gid: g.id, label: g.name, cells: it.table.rows[i] ? it.table.rows[i].cells : it.table.cols.map(() => null) })) : [{ label: '전체 구성원', cells: it.table.rows[0].cells }]; it.byGrade = w.grades.length > 0; } return it; }); w.meta.doc = src.meta.doc; el.remove(); mrender(); toast(`${src.code} 규정을 복사했습니다. 값을 확인한 뒤 저장해 주세요.`); }; },
    'i-add': () => { const it = newItem(S.m.cat, S.m.w.grades); it.cur = corpOf(S.m.code).cur; S.m.w.items.push(it); mrender(); const e = $(`[data-i="${it.id}"][data-f="name"]`); if (e) e.focus(); },
    'i-del': (d) => { const l = S.m.w.items; l.splice(l.findIndex((i) => i.id === d.id), 1); mrender(); },
    'i-on': (d) => { const it = wItem(d.id); it.on = !it.on; mrender(); },
    'i-bygrade': (d) => { const it = wItem(d.id), w = S.m.w; it.byGrade = !it.byGrade; if (it.byGrade) { const first = it.table.rows[0].cells; it.table.rows = w.grades.map((g, i) => ({ gid: g.id, label: g.name, cells: i ? it.table.cols.map(() => null) : first.slice() })); } else it.table.rows = [{ label: '전체 구성원', cells: it.table.rows[0].cells }]; mrender(); },
    'c-add': (d) => { const it = wItem(d.id); it.table.cols.push(''); it.table.rows.forEach((r) => r.cells.push(null)); mrender(); const e = $(`[data-col="${d.id}"][data-ci="${it.table.cols.length - 1}"]`); if (e) e.focus(); },
    'c-del': (d) => { const it = wItem(d.id), ci = +d.ci; it.table.cols.splice(ci, 1); it.table.rows.forEach((r) => r.cells.splice(ci, 1)); mrender(); },
    // 컨펌
    'c-back': () => { S.cf = null; mrender(); },
    'c-discard': () => { const then = S.cf.then; S.m = null; S.cf = null; if (then) then(); render(); },
    'c-cancel-pending': () => { const c = corpOf(S.m.code), from = c.pending.from; c.pending = null; H.unshift({ at: now(), corp: c.code, cat: '여비규정', text: '적용 예정 변경 취소', before: from + ' 적용 예정', after: '-', reason: '관리자 취소', by: D.admin, sid: 'S-' + String(++saveNo).padStart(4, '0') }); S.cf = null; S.m = null; render(); openManage(c.code); S.m.tab = 'policy'; mrender(); toast('적용 예정 변경을 취소했습니다.'); },
    'c-save': commit,
  };
  function moveG(id, dir) { const l = S.m.w.grades, i = l.findIndex((g) => g.id === id); l.splice(i + dir, 0, l.splice(i, 1)[0]); syncRows(S.m.w.items, l); mrender(); }

  document.addEventListener('click', (e) => {
    const m = e.target.closest('.mk[data-mk]'); if (m) { const t = $(`.desc-item[data-d="${m.dataset.mk}"]`); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const b = e.target.closest('button[data-a]'); if (b && !b.disabled && ACT[b.dataset.a]) ACT[b.dataset.a](b.dataset);
  });
  document.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset;
    if (d.a === 'f') { S.f = t.value; render(); }
    else if (d.h && d.h !== 'q') { S.hist[d.h] = t.value; render(); }
    else if (d.a === 'g-def') ACT['g-def'](d);
    else if (d.a === 'g-map' && t.value) { S.m.w.grades.find((g) => g.id === d.id).hr.push(t.value); mrender(); }
    else if (d.a === 'i-type') { const it = wItem(d.id); it.type = t.value; if ((it.type === 'cap' || it.type === 'flat') && !it.cur) it.cur = corpOf(S.m.code).cur; mrender(); }
    else if (d.a === 'i-cur') { wItem(d.id).cur = t.value; mrender(); }
    else if (d.a === 'i-bygrade') ACT['i-bygrade'](d);
    else if (d.a === 'c-when') { S.cf.reason = $('#cf-reason').value; S.cf.when = t.value; S.cf.err = ''; mrender(); if (t.value === 'date') $('#cf-date').focus(); }
    else if (d.x && (d.f === 'empNo' || d.f === 'to')) { const x = S.m.w.exc.find((v) => v.id === d.x); if (d.f === 'empNo') { const p = (D.people[S.m.code] || []).find((p) => p.empNo === t.value) || { empNo: '', name: '', dept: '', hrTitle: '' }; Object.assign(x, p, { to: '' }); } else x.to = t.value; mrender(); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target, d = t.dataset;
    if (d.a === 'q') { S.q = t.value; render(); }
    else if (d.h === 'q') { S.hist.q = t.value; render(); }
    else if (!S.m) return;
    else if (d.g) { const g = S.m.w.grades.find((v) => v.id === d.g); g[d.f] = t.value; if (d.f === 'name') syncRows(S.m.w.items, S.m.w.grades); }
    else if (d.x) S.m.w.exc.find((v) => v.id === d.x)[d.f] = t.value;
    else if (d.i) wItem(d.i)[d.f] = t.value;
    else if (d.col) wItem(d.col).table.cols[+d.ci] = t.value;
    else if (d.cell) { wItem(d.cell).table.rows[+d.ri].cells[+d.ci] = parseCell(t.value); t.classList.toggle('undef', t.value.trim() === ''); }
    else if (d.meta) S.m.w.meta[d.meta] = t.value;
    if (S.m && !S.cf) { const sv = $('[data-a="m-save"]'); if (sv) { sv.disabled = !dirty(); sv.previousElementSibling.previousElementSibling.textContent = dirty() ? '저장하지 않은 변경이 있습니다' : '변경 없음'; } $('.xtabs').innerHTML = tabsHtml(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const extra = document.querySelector('#layer > .ov.top:last-child'); if (S.cf) { S.cf = null; mrender(); } else if (extra && !extra.dataset.ov) extra.remove(); else if (S.m) closeModal(); });
  document.addEventListener('mouseover', (e) => { const m = e.target.closest('.mk[data-mk], .desc-item[data-d]'); document.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot')); if (!m) return; const no = m.dataset.mk || m.dataset.d; document.querySelectorAll(`.mk[data-mk="${no}"], .desc-item[data-d="${no}"]`).forEach((x) => x.classList.add('hot')); });
  $('#desc-toggle').onchange = (e) => document.body.classList.toggle('desc-on', e.target.checked);
  $('#mk-toggle').onchange = (e) => document.body.classList.toggle('mk-off', !e.target.checked);
  window.__S = S; window.__H = H;
  render();
})();
