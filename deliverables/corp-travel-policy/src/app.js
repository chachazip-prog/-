/* 법인별 출장여비규정 — 마스터 그리드 / 관리 모달(기안 항목·등급 규정·여비규정) / 컨펌 팝업 / 변경 이력 */
(function () {
  const D = window.DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const MKMAP = { draft: { 1: 1, 2: 2, 3: 3, 15: 4 }, grade: { 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 15: 7 }, policy: { 1: 1, 9: 2, 10: 3, 11: 4, 12: 5, 13: 6, 14: 7, 15: 8 } };
  let mkCtx = null; // 관리 모달 탭별 마커 번호 재배열
  const mk = (n) => { const v = mkCtx ? mkCtx[n] || n : n; return `<i class="mk" data-mk="${v}">${v}</i>`; };
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
  const S = { view: 'grid', q: '', f: 'all', hist: { corp: '', cat: '', q: '' }, m: null, cf: null, org: null };

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


  /* ---------- 조직도 (인사정보 연동 가정, 샘플) : [조직 경로, 사번, 이름, 직책] ---------- */
  const ORG_SRC = {
    HYB: [['서비스전략실/서비스전략팀', '10004684', '차영록', '구성원'], ['서비스전략실/서비스전략팀', '10004120', '박지훈', '팀장'], ['서비스전략실/서비스기획팀', '10005231', '정하윤', '구성원'], ['뮤직라이츠실', '10003321', '김민지', '구성원'], ['뮤직라이츠실', '10002087', '오세진', '실장'], ['재무실/재무회계팀', '10003876', '이서연', '팀장'], ['재무실/자금팀', '10005542', '최도현', '구성원']],
    HBA: [['Music Division/A&R', 'A100913', 'David Kim', 'Senior Director'], ['Music Division/A&R', 'A101022', 'Olivia Brown', 'Manager'], ['Music Division/Label Operations', 'A100744', 'Chris Park', 'Director'], ['Music Division/Label Operations', 'A101187', 'Noah Wilson', 'Staff'], ['Business Division/Artist Relations', 'A100231', 'Jordan Lee', 'Senior Director'], ['Business Division/Artist Relations', 'A101305', 'Mia Johnson', 'Associate'], ['Business Division/Global Touring', 'A100518', 'Maria Santos', 'Director'], ['Business Division/Global Touring', 'A100977', 'Ethan Clark', 'Manager'], ['Corporate/Finance', 'A100802', 'Emily Chen', 'Manager'], ['Corporate/Finance', 'A100066', 'Robert Hall', 'VP'], ['Corporate/People', 'A100458', 'Grace Lewis', 'Director']],
    HBL: [['Marketing', 'L300045', 'Sofía Ramírez', 'Manager'], ['Marketing', 'L300102', 'Lucas Fernández', 'Staff'], ['Artist Development', 'L300078', 'Diego Torres', 'Director'], ['Finance', 'L300031', 'Ana López', 'Manager']],
    HBJ: [['Artist Business/Artist Management', 'J200077', '佐藤 美咲', 'チーム員'], ['Artist Business/Artist Management', 'J200162', '鈴木 花', '職責者'], ['Artist Business/Concert Business', 'J200145', '田中 健', 'チーム員'], ['Artist Business/Concert Business', 'J200033', '伊藤 大輔', '事業リーダー'], ['Corporate/財務会計チーム', 'J200210', '山本 翔', 'チーム員'], ['Corporate/People Experience', 'J200098', '高橋 優', 'SP']],
    HBC: [['Business Development', 'C400012', '王 丽', 'Manager'], ['Business Development', 'C400003', '陈 伟', 'Director'], ['Operations', 'C400027', '李 强', 'Staff']],
    HBI: [['Operations', 'I500007', 'Priya Sharma', 'Manager'], ['Marketing', 'I500015', 'Arjun Mehta', 'Staff']],
  };
  function orgTree(c) {
    const root = { id: c.code, name: c.name, children: [], members: [] };
    (ORG_SRC[c.code] || []).forEach(([path, empNo, name, hrTitle]) => {
      let node = root; const segs = path.split('/');
      segs.forEach((seg, i) => { const id = c.code + '/' + segs.slice(0, i + 1).join('/'); let ch = node.children.find((n) => n.id === id); if (!ch) { ch = { id, name: seg, children: [], members: [] }; node.children.push(ch); } node = ch; });
      node.members.push({ empNo, name, hrTitle, dept: segs[segs.length - 1], path });
    });
    return root;
  }
  const allMembers = (n) => n.members.concat(...n.children.map(allMembers));
  const findNode = (n, id) => (n.id === id ? n : n.children.map((c) => findNode(c, id)).find(Boolean));
  function orgListHtml() {
    const o = S.org, w = S.m.w, q = o.q.trim().toLowerCase();
    const list = q ? allMembers(o.tree).filter((p) => (p.name + p.empNo).toLowerCase().includes(q)) : allMembers(findNode(o.tree, o.sel) || o.tree);
    if (!list.length) return `<div class="empty">${q ? '검색 결과가 없습니다.' : '이 조직에 소속된 구성원이 없습니다.'}</div>`;
    return list.map((p) => { const taken = w.exc.some((x) => x.empNo === p.empNo), g = mappedGrade(w.grades, p.hrTitle);
      return `<label class="org-mem ${taken ? 'dis' : ''}"><input type="checkbox" data-a="o-pick" value="${p.empNo}" ${o.picked.has(p.empNo) ? 'checked' : ''} ${taken ? 'disabled' : ''}>
        <span><b>${esc(p.name)}</b> <span class="sub num">${esc(p.empNo)}</span><div class="sub">${esc(p.path.replace(/\//g, ' › '))} · ${esc(p.hrTitle)}</div></span>
        <span>${taken ? badge('gray', '지정됨') : `<span class="sub">매핑 등급</span> <b>${esc(g ? g.name : '-')}</b>`}</span></label>`; }).join('');
  }
  const orgPickedHtml = () => { const o = S.org, all = allMembers(o.tree); return o.picked.size ? `선택 ${o.picked.size}명 ` + [...o.picked].map((e) => { const p = all.find((x) => x.empNo === e); return `<span class="tchip">${esc(p.name)}<button type="button" aria-label="${esc(p.name)} 선택 해제" data-a="o-unpick" data-e="${e}">×</button></span>`; }).join('') : '선택한 구성원이 없습니다.'; };
  function orgHtml() {
    const o = S.org, c = corpOf(S.m.code);
    const node = (n, depth) => { const open = o.open.has(n.id), has = n.children.length > 0;
      return `<button type="button" class="org-node ${o.sel === n.id && !o.q ? 'on' : ''}" style="padding-left:${6 + depth * 14}px" data-a="o-node" data-id="${esc(n.id)}" aria-expanded="${has ? open : ''}"><span class="car">${has ? (open ? '▾' : '▸') : ''}</span>${esc(n.name)}<span class="cnt num">${allMembers(n).length}</span></button>${has && open ? n.children.map((ch) => node(ch, depth + 1)).join('') : ''}`; };
    return `<div class="ov top" data-ov="o"><div class="cmodal" role="dialog" aria-modal="true" aria-label="조직도에서 구성원 선택" style="width:780px">
      <div class="xh"><div><div class="t">조직도에서 구성원 선택${mk(1)}</div><div class="s"><b>${c.code}</b> ${esc(c.name)} 조직도 · 개인 예외를 지정할 구성원을 선택합니다.</div></div><button type="button" class="x" aria-label="닫기" data-a="o-close">×</button></div>
      <div class="xb"><div class="row"><input class="inp grow" id="org-q" value="${esc(o.q)}" placeholder="이름 또는 사번으로 검색" maxlength="30" aria-label="구성원 검색">${mk(2)}</div>
        <div class="org"><div class="org-box"><h5>조직${mk(3)}</h5>${node(o.tree, 0)}</div>
          <div class="org-box"><h5>구성원${mk(4)}</h5><div id="org-list">${orgListHtml()}</div></div></div>
        <div class="org-picked" id="org-picked">${orgPickedHtml()}</div></div>
      <div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="o-close">취소</button><button type="button" class="btn pri" data-a="o-ok" ${o.picked.size ? '' : 'disabled'}>선택 완료</button>${mk(5)}</div></div></div>`;
  }

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
        <colgroup><col style="width:3%"><col style="width:11%"><col style="width:5%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:10%"><col style="width:5%"><col style="width:9%"><col style="width:7%"><col style="width:9%"><col style="width:7%"><col style="width:10%"></colgroup>
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
            <td class="num">${last ? `${esc(last.at.slice(0, 10))}<div class="sm">${esc(last.by)}</div>` : '<span class="dim">-</span>'}
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
      <div class="tbl-wrap"><table class="tbl hist-tbl">
        <colgroup><col style="width:5%"><col style="width:11%"><col style="width:6%"><col style="width:8%"><col style="width:19%"><col style="width:26%"><col style="width:12%"><col style="width:6%"><col style="width:7%"></colgroup>
        <thead><tr><th class="c">번호</th><th>변경 일시</th><th>법인</th><th>구분</th><th>변경 내용${mk(3)}</th><th>변경 전 → 변경 후</th><th>변경 사유</th><th>수정자</th><th>저장 번호${mk(4)}</th></tr></thead>
        <tbody>${rows.length ? rows.map((x, i) => `<tr>
          <td class="c dim num">${rows.length - i}</td><td class="num">${esc(x.at)}</td><td><b>${x.corp}</b></td><td>${badge(catColor[x.cat] || 'gray', x.cat)}</td>
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

      <div class="row between" style="margin-top:26px"><div><h4 class="sec-title">개인 예외 지정 <span class="hl-blue">${w.exc.length}</span>${mk(7)}</h4><p class="sec-desc">직책 매핑과 다른 등급을 특정 구성원에게 개별 지정합니다. 적용 기간 동안 직책 매핑보다 우선합니다.</p></div><button type="button" class="btn sm" data-a="x-add" ${w.grades.length > 1 ? '' : 'disabled'}>+ 조직도에서 구성원 선택</button></div>
      ${w.exc.length ? `<table class="etbl"><thead><tr><th style="width:190px">구성원</th><th style="width:120px">매핑 등급</th><th style="width:150px">적용 등급</th><th>사유</th><th style="width:218px">적용 기간 (종료일 비우면 무기한)${mk(8)}</th><th style="width:52px"></th></tr></thead><tbody>
        ${w.exc.map((x) => { const cur = x.empNo ? mappedGrade(w.grades, x.hrTitle) : null; const end = x.end && x.end < D.TODAY;
          return `<tr><td><b>${esc(x.name)}</b> <span class="help num">${esc(x.empNo)}</span>${x.isNew ? ' ' + badge('blue', '신규') : ''}
            <div class="help">${esc([x.dept, x.hrTitle].filter(Boolean).join(' · '))}</div></td>
          <td style="vertical-align:middle">${cur ? esc(cur.name) : '<span class="help">-</span>'}</td>
          <td><select class="sel" data-x="${x.id}" data-f="to" aria-label="적용 등급"><option value="">선택</option>${w.grades.map((g) => `<option value="${g.id}" ${g.id === x.to ? 'selected' : ''} ${cur && cur.id === g.id ? 'disabled' : ''}>${esc(g.name)}</option>`).join('')}</select></td>
          <td><input class="inp" value="${esc(x.reason || '')}" maxlength="100" placeholder="사유 (필수)" data-x="${x.id}" data-f="reason" aria-label="사유"></td>
          <td><div class="row" style="gap:4px"><input class="inp num" value="${esc(x.start || '')}" placeholder="YYYY.MM.DD" maxlength="10" data-x="${x.id}" data-f="start" aria-label="시작일"><span>~</span><input class="inp num" value="${esc(x.end || '')}" placeholder="무기한" maxlength="10" data-x="${x.id}" data-f="end" aria-label="종료일"></div>${end ? badge('gray', '만료') : ''}</td>
          <td class="act"><button type="button" class="btn sm danger" data-a="x-del" data-id="${x.id}">삭제</button></td></tr>`; }).join('')}
        </tbody></table>` : `<div class="empty">${w.grades.length > 1 ? '개인 예외 지정이 없습니다. [조직도에서 구성원 선택]으로 추가할 수 있습니다.' : '등급이 2개 이상일 때 개인 예외를 지정할 수 있습니다.'}</div>`}`;
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
      ${it.on ? `<div class="pb"><div><table class="mx"><thead><tr><th class="l" style="width:112px">${it.byGrade ? '구성원 등급' : '대상'}</th>
          ${t.cols.map((col, ci) => `<th class="colh"><input class="inp" value="${esc(col)}" title="${esc(col)}" maxlength="24" placeholder="열 이름" data-col="${it.id}" data-ci="${ci}" aria-label="열 이름">${t.cols.length > 1 ? `<button type="button" class="cx" aria-label="${esc(col)} 열 삭제" data-a="c-del" data-id="${it.id}" data-ci="${ci}">×</button>` : ''}</th>`).join('')}
          <th style="width:50px"><button type="button" class="btn sm ghost" style="padding:0 4px" data-a="c-add" data-id="${it.id}">+ 열</button></th></tr></thead>
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
  function modalHtml() { mkCtx = MKMAP[S.m.tab]; const h = modalHtml0(); mkCtx = null; return h; }
  function modalHtml0() {
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

  /* ================= Description (설계 정보 / 정책 정보 / 화면 설명 및 디스크립션) ================= */
  /* 항목 = [마커 번호, 제목, [줄…]] — 줄이 ':' 로 시작하면 하위 줄, '*' 로 시작하면 그대로, 그 외는 '• ' 를 붙인다 */
  const PATH = '업무관리자 > 출장 관리 > 법인별 출장여비규정';
  const NUM = '❶❷❸❹❺❻❼❽❾❿⓫⓬⓭⓮⓯';
  const F_FOOT = (n) => [n, '하단 버튼', ['구성 : [이 법인 변경 이력], 변경 상태 문구, [취소][저장]', '기능', ': [이 법인 변경 이력] 선택 → 해당 법인으로 필터된 TRIP-06-P02 로 이동', ': [저장] 선택 → 입력 검증 후 TRIP-06-M05 호출', ': [취소]/✕/Esc 선택 → 변경이 있으면 TRIP-06-M06 호출, 없으면 모달 닫기', '기타 : 변경이 없으면 [저장] 비활성. 검증 실패 시 해당 탭으로 이동하고 토스트로 사유 안내']];
  const F_HEAD = [1, '모달 헤더 · 탭', ['구성 : 법인 코드, 법인명·국가·기준 통화·구성원 수, 탭(기안 항목 관리/등급 규정/여비규정 설정)', '기능 : 탭 선택 → 해당 탭 내용으로 전환(입력 유지)', '기타 : 변경이 있는 탭에는 빨간 점 표시. 법인 정보는 인사정보 연동 값(읽기 전용)']];
  function descData() {
    if (S.org) return { sid: 'TRIP-06-M04', title: '조직도 구성원 선택', def: '개인 예외 지정 대상 구성원을 조직도 트리에서 찾아 선택하는 창', path: PATH + ' > [관리] > 등급 규정 (모달)',
      pol: ['개인 예외 지정 대상은 조직도 트리에서만 선택(직접 입력 불가)', '관리 중인 법인의 조직도만 노출(다른 법인 구성원 선택 불가)', '구성원의 소속·직책은 인사정보 값을 그대로 사용', '선택 완료 시점에는 저장되지 않음. 관리 모달 [저장] → 컨펌 팝업을 거쳐야 반영'],
      iss: ['HYBENET 공통 조직도 컴포넌트 재사용 여부와 조직 단계(depth) 표시 범위', '겸직·파견 구성원의 소속 법인 기준', '퇴직·휴직자 노출 여부와 기존 예외 지정 처리'],
      items: [[1, '헤더', ['구성 : 제목, 법인 코드·법인명 안내 문구, ✕', '기능 : ✕/[취소]/Esc 선택 → 선택을 버리고 닫기']],
        [2, '검색', ['플레이스홀더 : 이름 또는 사번으로 검색', '키워드 : 이름, 사번(부분 일치, 대소문자 무시, 30자)', '기타 : 입력 즉시 반영. 검색어가 있으면 조직 선택과 무관하게 법인 전체에서 조회', ': 결과가 없으면 "검색 결과가 없습니다." 문구 노출']],
        [3, '조직도 트리', ['구성 : 법인 › 상위 조직 › 하위 조직 트리, 조직별 구성원 수(하위 포함)', '기능 : 조직 선택 → 우측에 해당 조직(하위 포함) 구성원 표기', ': 선택된 조직 재선택 → 하위 접기/펼치기', '디폴트 : 법인(최상위) 선택, 1단계 조직 펼침']],
        [4, '구성원 목록', ['구성 : 체크박스, 이름·사번, 조직 경로·직책, 매핑 등급', '기능 : 체크 → 하단 선택 칩에 추가(복수 선택), 칩의 ✕ → 선택 해제', '기타 : 이미 예외가 지정된 구성원은 "지정됨" 칩과 함께 비활성', ': 조직·검색을 바꿔도 선택 유지']],
        [5, '하단 버튼', ['구성 : [취소][선택 완료]', '기능', ': [취소] 선택 → 모달 닫기', ': [선택 완료] 선택 → 개인 예외 지정 표에 선택 순서대로 "신규" 행 추가 후 닫기', '기타 : 선택된 구성원이 없으면 [선택 완료] 비활성']]] };
    if (S.copy) return { sid: 'TRIP-06-M08', title: '다른 법인 규정 복사', def: '다른 법인의 여비규정 항목·값을 복사해 오는 창', path: PATH + ' > [관리] > 여비규정 설정 > [다른 법인 규정 복사] (모달)',
      pol: ['복사는 1회성이며 법인 간 연결 없음(원본 개정 시 자동 반영되지 않음)', '복사 결과는 작업본에만 반영. 관리 모달 [저장] → 컨펌 팝업을 거쳐야 저장', '등급별 값은 이 법인의 등급 순서대로 이동. 등급 수가 다르면 남는 값은 버리고 모자란 칸은 미정의'], iss: [],
      items: [[1, '법인 선택 · 버튼', ['구성 : 가져올 법인 Select(법인 코드·법인명·항목 수), 안내 문구, [취소][복사해 오기]', '기능', ': [취소] 선택 → 창 닫기', ': [복사해 오기] 선택 → 선택 법인의 항목·값·원문 문서명으로 작업본 대체 후 창 닫기, 완료 토스트', '기타 : 여비규정이 등록된 다른 법인만 목록에 노출. 현재 입력된 항목이 있으면 "모두 대체" 경고 노출']]] };
    if (S.cf && S.cf.kind === 'save') return { sid: 'TRIP-06-M05', title: '변경 내용 확인', def: '관리 모달의 변경 내역을 확인하고 최종 저장하는 컨펌 팝업', path: PATH + ' > [관리] > [저장] (모달)',
      pol: ['모든 수정은 이 팝업의 [최종 저장]으로만 반영', '기안 항목 · 등급 규정 · 개인 예외는 항상 즉시 적용', '여비규정 값만 적용일 지정 가능(오늘 이후). 지정 시 "적용 예정"으로 보관하고 현재 값 유지', '기안 항목 OFF 전환 시 해당 법인의 임시저장 출장 기안 삭제(복구 불가)', '저장 1회에 저장 번호(S-0000)를 발급하고 변경 1건당 이력 1행 기록'],
      iss: ['변경 사유를 모든 저장에 필수로 둘지(프로토타입: 필수)', '적용일 지정을 기안 항목·등급 규정에도 제공할지, 적용 예정본을 법인당 1건으로 제한할지', '임시저장 기안 삭제 범위(법인 전체 / OFF 섹션에 값을 입력한 건만)와 작성자 알림 여부'],
      items: [[1, '헤더', ['구성 : 제목, 법인 코드·법인명, 변경 건수, ✕', '기타 : 관리 모달에서 변경 1건 이상 + 입력 검증 통과 시에만 호출. 바깥 영역 클릭으로 닫히지 않음']],
        [2, '변경 내역', ['구성 : 구분(기안 항목/등급 규정/개인 예외/여비규정), 변경 내용, 변경 전 → 변경 후', '기타 : 3개 탭의 변경을 한 번에 표기', ': 값 변경은 항목 단위로 묶어 "값 N칸 변경"으로 표기(앞 3건의 전·후 값 노출)', ': 표의 1행이 변경 이력 1건']],
        [3, '경고 영역', ['구성 : 임시저장 기안 삭제(빨강), 등급 삭제 시 여비규정 행·값 삭제(노랑), 미정의 칸 수(노랑)', '기타 : 해당 사항이 없으면 비노출']],
        [4, '여비규정 적용 시점', ['구성 : 즉시 적용 / 적용일 지정 라디오, 적용 시작일 입력', '디폴트 : 즉시 적용', '기능 : 적용일 지정 선택 → 날짜 입력 활성(YYYY.MM.DD, 오늘 이후만)', '기타 : 여비규정 변경이 포함될 때만 노출']],
        [5, '변경 사유', ['플레이스홀더 : 변경 이력에 함께 기록됩니다 (필수, 200자 이내)', '기타 : 비우고 저장 시 입력란 아래 오류 문구 노출, 저장하지 않음']],
        [6, '하단 버튼', ['구성 : [돌아가기][최종 저장]', '기능', ': [돌아가기] 선택 → 관리 모달로 복귀(입력 유지)', ': [최종 저장] 선택 → 저장, 두 창 닫기, 그리드 갱신, 완료 토스트']]] };
    if (S.cf && S.cf.kind === 'discard') return { sid: 'TRIP-06-M06', title: '닫기 확인', def: '저장하지 않은 변경이 있을 때 관리 모달을 닫기 전에 확인하는 팝업', path: PATH + ' > [관리] > [취소] (모달)',
      pol: ['저장하지 않은 변경이 1건 이상일 때만 호출', '변경이 없으면 확인 없이 닫음'], iss: [],
      items: [[1, '안내 · 버튼', ['구성 : 안내 문구(사라지는 변경 건수), [계속 수정][저장하지 않고 닫기]', '기능', ': [계속 수정] 선택 → 관리 모달로 복귀(입력 유지)', ': [저장하지 않고 닫기] 선택 → 변경을 버리고 관리 모달 닫기', '기타 : 호출 경로 - 관리 모달의 [취소], ✕, Esc, [이 법인 변경 이력]']]] };
    if (S.cf && S.cf.kind === 'cancelPending') return { sid: 'TRIP-06-M07', title: '적용 예정 취소 확인', def: '적용일을 지정해 둔 여비규정 변경을 취소하기 전에 확인하는 팝업', path: PATH + ' > [관리] > 여비규정 설정 > [예정 취소] (모달)',
      pol: ['취소하면 적용 예정본을 폐기하고 현재 적용 값은 유지', '취소 내역은 변경 이력에 기록'], iss: [],
      items: [[1, '안내 · 버튼', ['구성 : 안내 문구(법인, 적용 예정일), [돌아가기][예정 취소]', '기능', ': [돌아가기] 선택 → 관리 모달로 복귀', ': [예정 취소] 선택 → 적용 예정본 폐기, 이력 기록, 관리 모달 새로 고침', '기타 : 관리 모달에 저장하지 않은 다른 변경이 있으면 함께 사라짐을 안내']]] };
    if (S.m) {
      const t = S.m.tab;
      if (t === 'draft') return { sid: 'TRIP-06-M01', title: '출장여비규정 관리 — 기안 항목 관리', def: '구성원 출장 기안 화면의 섹션 3종 사용 여부를 법인별로 설정하는 탭', path: PATH + ' > [관리] (모달)',
        pol: ['항목은 출장 예산 / 법인카드 실시간 한도증액 / 출장 근태 신청 3종 고정', 'OFF인 섹션은 구성원 기안 화면에서 영역 자체를 노출하지 않음', '저장 즉시 신규 기안부터 적용. 결재 진행 중 기안은 작성 당시 설정 유지', 'OFF 전환 시 해당 법인의 임시저장 출장 기안 삭제', '연동 여부와 관계없이 모든 법인에서 ON 가능'],
        iss: ['연동이 안 된 법인에서 ON 했을 때 구성원 화면의 불러오기·신청 버튼 동작', '신규 연동 법인의 기본값(프로토타입: 전부 OFF)'],
        items: [F_HEAD,
          [2, '기안 항목 목록', ['구성 : 항목명, 설명, 연동 시스템/OFF 시 영향 문구, 사용 토글(ON/OFF)', '기능 : 토글 선택 → 작업본에 반영, 항목에 "변경" 표시', '기타 : 토글만으로는 저장되지 않음. 항목 추가·삭제·순서 변경 없음']],
          [3, '적용 안내', ['구성 : 적용 시점, 결재 진행 중 기안 처리, 임시저장 기안 삭제 건수', '기타 : 삭제 건수는 TRIP-06-M05 에서 다시 경고']],
          F_FOOT(4)] };
      if (t === 'grade') return { sid: 'TRIP-06-M02', title: '출장여비규정 관리 — 등급 규정', def: '법인별 구성원 등급과 직책 매핑, 개인 예외 지정을 관리하는 탭', path: PATH + ' > [관리] > 등급 규정 (모달)',
        pol: ['등급은 법인별로 정의하고 인사정보 직책에 매핑해 자동 판정', '한 직책은 한 등급에만 매핑. 미매핑 직책은 기본 등급 적용', '개인 예외 지정은 적용 기간 동안 직책 매핑보다 우선', '등급 추가·삭제·이름 변경은 여비규정 표에 즉시 반영(추가=미정의 행, 삭제=행과 값 삭제, 이름 변경=값 유지)', '입력 검증은 [저장] 시점에 일괄 수행'],
        iss: ['인사정보 매핑 키가 직책인지 직급인지, 법인별 코드 체계', '예외 지정에 별도 승인·증빙이 필요한지', '발령으로 직책이 바뀐 구성원의 예외 지정 유지 여부'],
        items: [F_HEAD,
          [2, '구성원 등급', ['구성 : 기본 등급 라디오, 등급명, 설명, 매핑 직책, 순서 ▲▼, [삭제], [+ 등급 추가]', '기능', ': [+ 등급 추가] 선택 → 표 맨 아래 빈 행 추가(첫 등급은 자동으로 기본 등급)', ': ▲▼ 선택 → 순서 변경(여비규정 표의 행 순서)', ': [삭제] 선택 → 행 삭제', '기타', ': 등급명 - 필수, 20자, 법인 내 중복 불가 / 설명 - 선택, 60자', ': 개인 예외의 적용 등급으로 사용 중인 등급, 기본 등급은 삭제 불가(토스트 안내)', ': 등급이 없으면 "등록된 등급이 없습니다" 빈 상태 노출']],
          [3, '매핑 직책', ['구성 : 직책 칩, [+ 직책] Select', '기능', ': [+ 직책] 선택 → 해당 등급에 직책 매핑', ': 칩의 ✕ 선택 → 매핑 해제', '기타 : Select 에는 미매핑 직책만 노출. 미매핑 직책은 표 아래에 개수·목록 안내']],
          [4, '기본 등급', ['구성 : 라디오(법인당 1개 필수)', '기타 : 어느 등급에도 매핑되지 않은 직책의 구성원에게 적용']],
          [5, '개인 예외 지정', ['구성 : 구성원(이름·사번·소속·직책), 매핑 등급, 적용 등급, 사유, 적용 기간, [삭제]', '기능', ': [+ 조직도에서 구성원 선택] 선택 → TRIP-06-M04 호출, 선택한 구성원 수만큼 "신규" 행 추가', ': [삭제] 선택 → 행 삭제', '기타', ': 등급이 2개 이상일 때 추가 버튼 활성', ': 적용 등급 - 매핑 등급과 같은 등급 선택 불가 / 사유 - 필수, 100자', ': 기존 건은 구성원 변경 불가']],
          [6, '적용 기간', ['구성 : 시작일, 종료일(YYYY.MM.DD)', '디폴트 : 시작일 = 오늘, 종료일 = 비움(무기한)', '기타 : 종료일은 시작일 이후. 종료일이 지나면 "만료" 칩 표기 후 매핑 등급으로 복귀']],
          F_FOOT(7)] };
      return { sid: 'TRIP-06-M03', title: '출장여비규정 관리 — 여비규정 설정', def: '교통 / 숙박 / 일비·식비 / 기타 분류별로 여비 항목과 값을 입력하는 탭', path: PATH + ' > [관리] > 여비규정 설정 (모달)',
        pol: ['여비규정은 기준 정보 관리 + 구성원 안내용. 출장 계획서 자동 검증·차단, 규정 예외 신청 연동 없음', '개정 버전 목록 없이 현재 값 1벌만 편집. 과거 값은 변경 이력에서 확인', '지역 구분은 별도 마스터 없이 항목별 열 이름으로 관리', '규정을 공유하는 법인(HBA·HBL)도 각각 등록. 복사는 1회성(연결 없음)', 'HYB 값은 화면 예시용 샘플, HBA·HBL·HBJ 는 유첨 규정 문서 기준'],
        iss: ['지역 열과 출장지 관리 마스터의 매핑 필요 여부', '열마다 통화가 다른 항목(HBJ 식비 ¥/₩/US$)의 칸 단위 통화 지정', '구성원 안내 노출 위치(출장 계획서/기안 화면)', '항목명·안내 문구의 다국어(영/일) 등록'],
        items: [F_HEAD,
          [2, '여비규정 설정 · 원문 문서', ['구성 : 안내 문구, 원문 문서 파일명 입력', '기타 : 원문 문서 - 선택, 80자(실제 구현은 파일 첨부)']],
          [3, '분류 선택', ['구성 : 교통 / 숙박 / 일비·식비 / 기타(분류별 항목 수), 미정의 칸 수', '기능 : 분류 선택 → 해당 분류의 항목만 노출', '디폴트 : 교통']],
          [4, '항목', ['구성 : 사용 토글, 항목명, 지급 방식, 통화, 단위, 등급별 차등, 값 표, 적용 조건, 구성원 안내, [항목 삭제]', '기능', ': 사용 토글 OFF → 값 영역 접기(값 보존), 구성원 미안내', ': 등급별 차등 체크 → 행을 등급 목록으로 전환 / 해제 → "전체 구성원" 1행', ': [+ 열] 선택 → 열 추가 / 열의 ✕ 선택 → 열 삭제(최소 1열)', '기타', ': 항목명 - 필수, 20자 / 단위 - 30자 / 열 이름 - 24자, 중복 불가', ': 지급 방식 - 등급 기준, 한도 내 실비, 정액 지급, 실비 (통화는 한도·정액일 때만)', ': 칸 - 숫자만 입력 시 금액, 문자 포함 시 문구. 빈 칸은 "미정의"(노랑 테두리)', ': 적용 조건 80자, 구성원 안내 300자(선택)']],
          [5, '항목 추가', ['기능 : [+ (분류) 항목 추가] 선택 → 현재 분류 맨 아래 빈 항목 추가', '기타 : 항목이 없는 법인은 [표준 항목으로 시작] 제공(항공·철도·숙박·식비·출장 수당·통신비)']],
          [6, '다른 법인 규정 복사', ['기능 : [다른 법인 규정 복사] 선택 → TRIP-06-M08 호출', '기타 : 다른 법인에 등록된 여비규정이 있을 때만 버튼 노출']],
          [7, '적용 예정 배너', ['구성 : 적용 예정일 안내, [적용 예정본][현재 적용 값] 전환, [예정 취소]', '기능', ': [현재 적용 값] 선택 → 현재 값 읽기 전용 조회', ': [예정 취소] 선택 → TRIP-06-M07 호출', '기타 : 적용일을 지정해 저장한 변경이 있을 때만 노출']],
          F_FOOT(8)] };
    }
    if (S.view === 'history') return { sid: 'TRIP-06-P02', title: '변경 이력', def: '법인별 출장여비규정의 모든 수정 내역을 조회하는 화면', path: PATH + ' > [변경 이력]',
      pol: ['모든 수정 건은 일시·수정자·사유·변경 전후 값과 함께 이력으로 기록', '조회 전용(되돌리기·삭제 없음)', '본사(HYB) 출장 관리자만 조회'],
      iss: ['기간 필터 · 엑셀 다운로드 · 페이지네이션 필요 여부', '값 변경의 칸 단위 상세 조회 필요 여부', '이력 보존 기간'],
      items: [[1, '이력 목록', ['구성 : 번호, 변경 일시, 법인, 구분, 변경 내용, 변경 전 → 변경 후, 변경 사유, 수정자, 저장 번호', '기능 : [← 목록] 선택 → TRIP-06-P01 로 이동', '기타 : 최신순. 변경 1건 = 1행. 건수는 필터 결과 기준']],
        [2, '필터 · 검색', ['구성 : 법인 Select, 구분 Select(기안 항목/등급 규정/개인 예외/여비규정), 통합검색', '키워드 : 변경 내용, 전후 값, 사유, 수정자(부분 일치, 30자)', '기타 : 입력 즉시 반영. 관리 모달에서 진입하면 해당 법인 선택 상태', ': 결과가 없으면 "조건에 맞는 변경 이력이 없습니다" 문구 노출']],
        [3, '변경 내용 · 전후 값', ['기타 : 추가는 변경 전 "-", 삭제는 변경 후 "-"', ': 적용일을 지정한 여비규정 변경은 내용 끝에 "(YYYY.MM.DD 적용 예정)" 표기']],
        [4, '저장 번호', ['기타 : [최종 저장] 1회에 발급되는 번호(S-0000). 같은 번호의 행은 사유·일시·수정자가 동일']]] };
    return { sid: 'TRIP-06-P01', title: '법인별 출장여비규정 — 마스터 그리드', def: '전 법인의 출장여비규정 설정 값을 한 표로 조회하는 메인 화면', path: PATH,
      pol: ['출장 관리에 추가되는 메뉴는 "법인별 출장여비규정" 탭 1개', '기본 화면은 전 법인의 값을 보여주는 마스터 그리드 1개', '수정은 [관리] 모달에서만 수행', '모든 수정은 컨펌 팝업을 거쳐 저장하고 변경 이력에 기록', '법인 목록은 인사정보 연동 결과를 그대로 사용(추가·삭제 불가)', '본사(HYB) 출장 관리자만 접근하며 전 법인을 관리'],
      iss: ['그리드에 대표 값(예: 숙박 상한)까지 노출할지', '전 법인 현황 엑셀 다운로드 필요 여부', 'HBC·HBI 법인명은 예시(인사정보 값으로 대체)'],
      items: [[1, '요약 정보', ['구성 : 법인 수, 여비규정 등록/미등록 법인 수, 인사정보 연동 시각', '기타 : 검색·필터와 무관하게 전체 기준. 항목이 1개 이상이면 "등록"']],
        [2, '검색/조회 조건', ['구성 : 여비규정 등록 여부 Select(전체/등록/미등록), 통합검색', '키워드 : 법인 코드, 법인명(부분 일치, 대소문자 무시, 30자)', '플레이스홀더 : 법인 코드, 법인명 검색', '기타 : 입력 즉시 반영. 결과가 없으면 "검색 결과가 없습니다" 문구 노출']],
        [3, '법인', ['구성 : 법인 코드, 법인명, 국가, 기준 통화, 구성원 수', '기타 : 인사정보 연동 값(읽기 전용). 정렬은 인사정보 연동 순서']],
        [4, '기안 항목', ['구성 : 출장 예산, 법인카드 실시간 한도증액, 출장 근태 신청의 ON/OFF 칩', '기타 : 조회 전용. 변경은 [관리]에서 수행']],
        [5, '등급 규정', ['구성 : 등급명 칩(등록 순서), 개인 예외 건수', '기타 : 등급이 없으면 "미등록", 예외가 없으면 "-"']],
        [6, '여비규정', ['구성 : 교통 / 숙박 / 일비·식비 / 기타 분류별 등록 항목명', '기타 : 사용 안 함 항목은 흐리게 "(미사용)" 표기', ': 항목이 없는 법인은 4개 열을 합쳐 "미등록" 표기']],
        [7, '변경 이력 버튼', ['기능 : 선택 → TRIP-06-P02 로 이동']],
        [8, '최종 수정 · 관리', ['구성 : 최종 저장 일자·수정자, 시행일, 적용 예정 칩, 미정의 칸 수 칩, [관리]', '기능 : [관리] 선택 → TRIP-06-M01 호출']]] };
  }
  function renderDesc() {
    const d = descData(); $('#sid').textContent = d.sid;
    const line = (l) => (l[0] === ':' ? `<div class="ind">${l}</div>` : l[0] === '*' ? `<div>${l}</div>` : `<div>• ${l}</div>`);
    $('#desc').innerHTML = `<div class="desc-in">
      <div class="g-sec g1"><div class="g-h">설계 정보</div><b>${d.sid} ${d.title}</b><div class="gap"></div><div>Page ID: ${d.sid}</div><div>Definition: ${d.def}</div><div>Path: ${d.path}</div></div>
      <div class="g-sec g2"><div class="g-h">정책 정보</div><div>■ 주요 정책</div>${d.pol.map(line).join('')}${d.iss.length ? `<div class="gap"></div><div class="red">■ 확인 필요 사항</div>${d.iss.map(line).join('')}` : ''}</div>
      <div class="g-sec g3"><div class="g-h">화면 설명 및 디스크립션</div>${d.items.map((i, n) => `${n ? '<div class="gap"></div>' : ''}<div class="g-item" data-d="${i[0]}"><div class="gt">${NUM[i[0] - 1]} ${i[1]}</div>${i[2].map(line).join('')}</div>`).join('')}</div></div>`;
  }

  /* ================= 렌더 · 이벤트 ================= */
  function toast(msg) { document.querySelectorAll('.toast').forEach((e) => e.remove()); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
  function render(keep) {
    const xb = $('[data-ov="m"]'), st = xb ? xb.scrollTop : 0, ae = document.activeElement, sel = ae && ae.dataset && ae.dataset.a === 'q' ? '[data-a="q"]' : ae && ae.dataset && ae.dataset.h === 'q' ? '[data-h="q"]' : null;
    if (!keep) $('#view').innerHTML = S.view === 'history' ? historyView() : gridView();
    $('#layer').innerHTML = (S.m ? modalHtml() : '') + (S.m && S.org ? orgHtml() : '') + (S.cf ? confirmHtml() : '');
    if ($('[data-ov="m"]')) $('[data-ov="m"]').scrollTop = st;
    if (S.m && S.m.tab === 'policy' && S.m.ro) $('#xb').querySelectorAll('.pitem input,.pitem select,.pitem button,[data-a="i-add"],[data-a="p-copy"],[data-a="p-template"],[data-meta]').forEach((e) => { e.disabled = true; });
    const fm = $('.pitem'); if (fm && !$('.pitem .mk')) { const ph = $('.pitem .ph .inp.nm'); if (ph) { mkCtx = MKMAP.policy; ph.insertAdjacentHTML('afterend', mk(11)); mkCtx = null; } }
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
    'm-tab': (d) => { S.m.tab = d.v; mrender(); $('[data-ov="m"]').scrollTop = 0; },
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
    'x-add': () => { const tree = orgTree(corpOf(S.m.code)); S.org = { tree, open: new Set([tree.id].concat(tree.children.map((n) => n.id))), sel: tree.id, q: '', picked: new Set() }; mrender(); $('#org-q').focus(); },
    'o-node': (d) => { const o = S.org, n = findNode(o.tree, d.id); if (o.sel === d.id && n.children.length) { if (o.open.has(d.id)) o.open.delete(d.id); else o.open.add(d.id); } else { o.sel = d.id; o.open.add(d.id); } o.q = ''; mrender(); const b = document.querySelector('.org-node.on'); if (b) b.focus(); },
    'o-unpick': (d) => { S.org.picked.delete(d.e); mrender(); },
    'o-close': () => { S.org = null; mrender(); },
    'o-ok': () => { const o = S.org, all = allMembers(o.tree), w = S.m.w; let first = null;
      [...o.picked].forEach((e) => { const p = all.find((x) => x.empNo === e), id = uid('x'); first = first || id; w.exc.push({ id, isNew: true, empNo: p.empNo, name: p.name, dept: p.dept, hrTitle: p.hrTitle, to: '', reason: '', start: D.TODAY, end: '' }); });
      const n = o.picked.size; S.org = null; mrender(); const el = $(`[data-x="${first}"][data-f="to"]`); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } toast(`구성원 ${n}명을 추가했습니다. 적용 등급과 사유를 입력해 주세요.`); },
    'x-del': (d) => { const l = S.m.w.exc; l.splice(l.findIndex((x) => x.id === d.id), 1); mrender(); },
    // 여비규정
    'p-cat': (d) => { S.m.cat = d.v; mrender(); },
    'p-ro': (d) => { S.m.ro = d.v === '1'; mrender(); },
    'p-cancel': () => { S.cf = { kind: 'cancelPending' }; mrender(); },
    'p-template': () => { const w = S.m.w; TEMPLATE.forEach(([cat, name, type]) => { const it = newItem(cat, w.grades); it.name = name; it.type = type; it.cur = type === 'class' ? null : corpOf(S.m.code).cur; it.byGrade = type === 'class' && w.grades.length > 0; w.items.push(it); }); syncRows(w.items, w.grades); mrender(); },
    'p-copy': () => { const code = S.m.code, others = D.corps.filter((o) => o.code !== code && o.items.length); S.cf = null;
      const el = document.createElement('div'); el.className = 'ov top'; el.innerHTML = `<div class="cmodal" role="dialog" aria-modal="true" style="width:440px"><div class="xh"><div class="t">다른 법인 규정 복사${mk(1)}</div></div><div class="xb" style="padding-top:10px"><div class="frow"><label class="lb req" for="cp-src">가져올 법인</label><select class="sel" id="cp-src">${others.map((o) => `<option value="${o.code}">${o.code} · ${esc(o.name)} (항목 ${o.items.length}개)</option>`).join('')}</select></div><div class="cf-warn o">${S.m.w.items.length ? `현재 입력된 ${code}의 여비규정 항목 ${S.m.w.items.length}개를 <b>모두 대체</b>합니다. ` : ''}복사 후에도 원본 법인과 연결되지 않으며, 등급별 값은 ${code}의 등급 순서대로 옮겨집니다. [저장] 전까지는 반영되지 않습니다.</div></div><div class="xf"><span class="sp"></span><button type="button" class="btn" id="cp-no">취소</button><button type="button" class="btn pri" id="cp-ok">복사해 오기</button></div></div>`;
      $('#layer').appendChild(el); S.copy = true; renderDesc(); $('#cp-no').onclick = () => { S.copy = false; el.remove(); renderDesc(); };
      $('#cp-ok').onclick = () => { const src = corpOf($('#cp-src').value), w = S.m.w; w.items = clone(src.items).map((it) => { it.id = uid('i'); if (it.byGrade) { it.table.rows = w.grades.length ? w.grades.map((g, i) => ({ gid: g.id, label: g.name, cells: it.table.rows[i] ? it.table.rows[i].cells : it.table.cols.map(() => null) })) : [{ label: '전체 구성원', cells: it.table.rows[0].cells }]; it.byGrade = w.grades.length > 0; } return it; }); w.meta.doc = src.meta.doc; S.copy = false; el.remove(); mrender(); toast(`${src.code} 규정을 복사했습니다. 값을 확인한 뒤 저장해 주세요.`); }; },
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
    const m = e.target.closest('.mk[data-mk]'); if (m) { const t = $(`.g-item[data-d="${m.dataset.mk}"]`); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const b = e.target.closest('button[data-a]'); if (b && !b.disabled && ACT[b.dataset.a]) ACT[b.dataset.a](b.dataset);
  });
  document.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset;
    if (d.a === 'f') { S.f = t.value; render(); }
    else if (d.h && d.h !== 'q') { S.hist[d.h] = t.value; render(); }
    else if (d.a === 'g-def') ACT['g-def'](d);
    else if (d.a === 'o-pick') { if (t.checked) S.org.picked.add(t.value); else S.org.picked.delete(t.value); $('#org-picked').innerHTML = orgPickedHtml(); $('[data-a="o-ok"]').disabled = !S.org.picked.size; }
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
    else if (t.id === 'org-q') { S.org.q = t.value; $('#org-list').innerHTML = orgListHtml(); document.querySelectorAll('.org-node.on').forEach((n) => n.classList.toggle('on', !t.value.trim())); return; }
    else if (!S.m) return;
    else if (d.g) { const g = S.m.w.grades.find((v) => v.id === d.g); g[d.f] = t.value; if (d.f === 'name') syncRows(S.m.w.items, S.m.w.grades); }
    else if (d.x) S.m.w.exc.find((v) => v.id === d.x)[d.f] = t.value;
    else if (d.i) wItem(d.i)[d.f] = t.value;
    else if (d.col) wItem(d.col).table.cols[+d.ci] = t.value;
    else if (d.cell) { wItem(d.cell).table.rows[+d.ri].cells[+d.ci] = parseCell(t.value); t.classList.toggle('undef', t.value.trim() === ''); }
    else if (d.meta) S.m.w.meta[d.meta] = t.value;
    if (S.m && !S.cf) { const sv = $('[data-a="m-save"]'); if (sv) { sv.disabled = !dirty(); sv.previousElementSibling.previousElementSibling.textContent = dirty() ? '저장하지 않은 변경이 있습니다' : '변경 없음'; } $('.xtabs').innerHTML = tabsHtml(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const extra = document.querySelector('#layer > .ov.top:last-child'); if (S.org) { S.org = null; mrender(); } else if (S.cf) { S.cf = null; mrender(); } else if (extra && !extra.dataset.ov) { S.copy = false; extra.remove(); renderDesc(); } else if (S.m) closeModal(); });
  document.addEventListener('mouseover', (e) => { const m = e.target.closest('.mk[data-mk], .g-item[data-d]'); document.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot')); if (!m) return; const no = m.dataset.mk || m.dataset.d; document.querySelectorAll(`.mk[data-mk="${no}"], .g-item[data-d="${no}"]`).forEach((x) => x.classList.add('hot')); });
  $('#desc-toggle').onchange = (e) => document.body.classList.toggle('desc-on', e.target.checked);
  $('#mk-toggle').onchange = (e) => document.body.classList.toggle('mk-off', !e.target.checked);
  window.__S = S; window.__H = H;
  render();
})();
