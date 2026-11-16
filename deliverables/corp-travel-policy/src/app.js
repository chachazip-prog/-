/* 글로벌 법인별 관리 — 마스터 그리드 / 관리 모달(기안 항목·등급 규정) / 조직도 선택 / 컨펌 팝업 / 구성원 최종 등급 / 변경 이력
   여비규정은 AMEX GBT(Egencia)에서 세팅하고, 하이브넷은 법인-구성원-최종 등급(연동 코드)만 전송한다. */
(function () {
  const D = window.DATA;
  D.TODAY = '2026.11.16';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const mk = (n) => `<i class="mk" data-mk="${n}">${n}</i>`;
  const badge = (c, t) => `<span class="badge ${c}">${esc(t)}</span>`;
  const onoff = (b) => (b ? 'ON' : 'OFF');
  let seq = 1; const uid = (p) => p + (seq++);
  const now = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${D.TODAY} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const dateOk = (s) => /^\d{4}\.\d{2}\.\d{2}$/.test(s);
  const SYS_GBT = 'Concur (AMEX GBT)', SYS_NONE = '미사용';

  /* ---------- 데이터: 해외 법인만 (HYB·국내 법인은 Redcap BTMS 사용, 이 메뉴에서 제외) ---------- */
  const CODES = { HBA: ['HBA_TIER1', 'HBA_TIER2', 'HBA_TIER3'], HBL: ['HBL_TIER1', 'HBL_TIER2', 'HBL_TIER3'], HBJ: ['HBJ_LEADER', 'HBJ_STAFF'] };
  const EXTRA_TITLES = { HBA: ['Associate', 'Intern'], HBL: ['Associate'], HBJ: ['契約社員'] };
  /* 조직도(인사정보 연동 가정, 샘플): [조직 경로, 이메일 ID, 이름, 직책] */
  const ORG_SRC = {
    HBA: [['Music Division/A&R', 'davidkim', 'David Kim', 'Senior Director'], ['Music Division/A&R', 'oliviabrown', 'Olivia Brown', 'Manager'], ['Music Division/Label Operations', 'chrispark', 'Chris Park', 'Director'], ['Music Division/Label Operations', 'noahwilson', 'Noah Wilson', 'Staff'], ['Business Division/Artist Relations', 'jordanlee', 'Jordan Lee', 'Senior Director'], ['Business Division/Artist Relations', 'miajohnson', 'Mia Johnson', 'Associate'], ['Business Division/Global Touring', 'mariasantos', 'Maria Santos', 'Director'], ['Business Division/Global Touring', 'ethanclark', 'Ethan Clark', 'Manager'], ['Corporate/Finance', 'emilychen', 'Emily Chen', 'Manager'], ['Corporate/Finance', 'roberthall', 'Robert Hall', 'VP'], ['Corporate/People', 'gracelewis', 'Grace Lewis', 'Director']],
    HBL: [['Marketing', 'sofiaramirez', 'Sofía Ramírez', 'Manager'], ['Marketing', 'lucasfernandez', 'Lucas Fernández', 'Staff'], ['Artist Development', 'diegotorres', 'Diego Torres', 'Director'], ['Finance', 'analopez', 'Ana López', 'Manager']],
    HBJ: [['Artist Business/Artist Management', 'misaki.sato', '佐藤 美咲', 'チーム員'], ['Artist Business/Artist Management', 'hana.suzuki', '鈴木 花', '職責者'], ['Artist Business/Concert Business', 'ken.tanaka', '田中 健', 'チーム員'], ['Artist Business/Concert Business', 'daisuke.ito', '伊藤 大輔', '事業リーダー'], ['Corporate/財務会計チーム', 'sho.yamamoto', '山本 翔', '契約社員'], ['Corporate/People Experience', 'yu.takahashi', '高橋 優', 'SP']],
  };
  const EXC = {
    HBA: [{ email: 'jordanlee', to: 'g2', reason: '아티스트 동행 상시 업무 (CFO 승인)', start: '2026.01.01', end: '2026.12.31' }, { email: 'mariasantos', to: 'g2', reason: '2026 월드투어 총괄 기간 한시 적용', start: '2026.03.01', end: '2026.11.30' }, { email: 'chrispark', to: 'g2', reason: '2027 신규 레이블 총괄 예정', start: '2027.01.01', end: '' }, { email: 'ethanclark', to: 'g2', reason: '상반기 투어 지원', start: '2026.04.01', end: '2026.06.30' }],
    HBJ: [{ email: 'misaki.sato', to: 'g1', reason: '아티스트 운영 담당 — 동급 좌석 동승', start: '2026.04.01', end: '' }],
  };
  const mail = (id) => id + '@hybecorp.com';
  const corps = D.corps.filter((c) => c.code !== 'HYB').map((c) => {
    const gbt = !!CODES[c.code];
    const grades = gbt ? clone(D.grades[c.code]).map((g, i) => ({ id: g.id, name: g.name, code: CODES[c.code][i], desc: g.desc, hr: g.hr })) : [];
    const members = (ORG_SRC[c.code] || []).map(([path, id, name, hrTitle]) => ({ path, email: mail(id), name, hrTitle, dept: path.split('/').pop(), sync: { ok: true, at: '2026.11.16 00:00' } }));
    const exc = (EXC[c.code] || []).map((x) => { const p = members.find((m) => m.email === mail(x.email)); return Object.assign({ id: uid('x'), name: p.name, dept: p.dept, hrTitle: p.hrTitle }, x, { email: p.email }); });
    return { code: c.code, name: c.name, country: c.country, headcount: c.headcount, system: gbt ? SYS_GBT : SYS_NONE, gbt, draft: Object.fromEntries(D.draftItems.map((d) => [d.key, c.draft[d.key].on])), grades, exc, members, titles: [...new Set(grades.flatMap((g) => g.hr).concat(EXTRA_TITLES[c.code] || []))] };
  });
  corps[0].members.find((m) => m.email === mail('noahwilson')).sync = { ok: false, at: '2026.11.16 00:00' };
  const corpOf = (code) => corps.find((c) => c.code === code);
  /* 변경 이력 (최신순) */
  const H = [
    { at: '2026.11.10 00:00', corp: 'HBA', cat: '개인 예외', text: '개인 예외 자동 해제 — Liam Carter', before: 'Tier 2 (2026.02.01 ~ 무기한)', after: '-', reason: '퇴사(인사정보 연동)', by: '시스템', sid: 'S-0014' },
    { at: '2026.11.03 14:20', corp: 'HBJ', cat: '등급 규정', text: '연동 코드 변경 — 일반 구성원', before: 'HBJ_GENERAL', after: 'HBJ_STAFF', reason: 'Egencia traveler group 명칭 정리', by: '윤채희', sid: 'S-0013' },
    { at: '2026.10.27 10:05', corp: 'HBJ', cat: '기안 항목', text: '출장 예산', before: 'OFF', after: 'ON', reason: 'HBJ 예산 시스템 연동 완료', by: '윤채희', sid: 'S-0012' },
    { at: '2026.10.27 10:05', corp: 'HBJ', cat: '기안 항목', text: '출장 근태 신청', before: 'OFF', after: 'ON', reason: 'HBJ 예산 시스템 연동 완료', by: '윤채희', sid: 'S-0012' },
    { at: '2026.10.20 16:40', corp: 'HBA', cat: '기안 항목', text: '최초 설정', before: '-', after: '출장 예산 OFF · 법인카드 실시간 한도증액 OFF · 출장 근태 신청 OFF', reason: '글로벌 법인 오픈 준비', by: '윤채희', sid: 'S-0011' },
    { at: '2026.10.20 16:38', corp: 'HBL', cat: '기안 항목', text: '최초 설정', before: '-', after: '출장 예산 OFF · 법인카드 실시간 한도증액 OFF · 출장 근태 신청 OFF', reason: '글로벌 법인 오픈 준비', by: '윤채희', sid: 'S-0010' },
    { at: '2026.03.28 09:12', corp: 'HBJ', cat: '개인 예외', text: '개인 예외 추가 — 佐藤 美咲', before: '일반 구성원', after: '리더그룹·SP 이상 (2026.04.01 ~ 무기한)', reason: '아티스트 운영 담당 동급 좌석 동승', by: '서준석', sid: 'S-0009' },
    { at: '2026.02.24 11:30', corp: 'HBA', cat: '개인 예외', text: '개인 예외 추가 — Maria Santos', before: 'Tier 3', after: 'Tier 2 (2026.03.01 ~ 2026.11.30)', reason: '2026 월드투어 총괄 기간 한시 적용', by: '윤채희', sid: 'S-0008' },
    { at: '2025.12.22 15:02', corp: 'HBA', cat: '개인 예외', text: '개인 예외 추가 — Jordan Lee', before: 'Tier 3', after: 'Tier 2 (2026.01.01 ~ 2026.12.31)', reason: '아티스트 동행 상시 업무 (CFO 승인)', by: '윤채희', sid: 'S-0007' },
  ];
  let saveNo = 14;
  const lastOf = (code) => H.find((x) => x.corp === code && x.by !== '시스템') || null;

  /* ---------- 상태 ---------- */
  const S = { view: 'grid', q: '', f: '', hist: { corp: '', cat: '', q: '', from: '2026.10.16', to: D.TODAY }, mem: { corp: '', f: '', q: '' }, m: null, cf: null, org: null };

  /* ---------- 등급 판정 ---------- */
  const mapped = (grades, title) => grades.find((g) => g.hr.includes(title)) || null;
  const gname = (grades, id) => { const g = grades.find((g) => g.id === id); return g ? g.name : '-'; };
  const excState = (x) => (x.start > D.TODAY ? 'sched' : x.end && x.end < D.TODAY ? 'ended' : 'active');
  const excBadge = (x) => ({ sched: badge('blue', '예정'), active: badge('green', '적용 중'), ended: badge('gray', '만료') }[excState(x)]);
  const unassigned = (c, grades) => c.titles.filter((t) => !grades.some((g) => g.hr.includes(t)));
  /* 최종 등급 = 조회 시점(법인 현지 시간)에 적용 중인 개인 예외 > 직책 매핑. 미할당 직책은 등급 없음(OBT 사용 불가) */
  function finalOf(c, m) { const x = c.exc.find((e) => e.email === m.email && excState(e) === 'active'); const map = mapped(c.grades, m.hrTitle); return { grade: (x ? c.grades.find((g) => g.id === x.to) : map) || null, exc: x || null, map }; }

  /* ================= P01 마스터 그리드 ================= */
  function gridView() {
    const q = S.q.trim().toLowerCase();
    const rows = corps.filter((c) => (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) && (!S.f || c.system === S.f));
    return `
      <div class="toolbar"><span class="sp"></span>
        <select class="sel" data-a="f" aria-label="출장 시스템"><option value="">전체</option>${[SYS_GBT, SYS_NONE].map((s) => `<option ${S.f === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input class="inp" data-a="q" value="${esc(S.q)}" placeholder="법인 코드, 법인명 검색" maxlength="30" style="width:200px" aria-label="법인 검색">${mk(1)}
        <button type="button" class="btn" data-a="members">구성원 최종 등급</button>${mk(8)}
        <button type="button" class="btn" data-a="history">변경 이력</button>${mk(9)}
      </div>
      <div class="grid-wrap"><table class="grid">
        <colgroup>${[4, 14, 12, 6, 8, 8, 8, 13, 6, 7, 9, 5].map((w) => `<col style="width:${w}%">`).join('')}</colgroup>
        <thead>
          <tr><th rowspan="2" class="c">번호${mk(2)}</th><th rowspan="2">법인${mk(3)}</th><th rowspan="2">출장 시스템${mk(4)}</th><th rowspan="2" class="c">구성원</th>
            <th colspan="3" class="grp">기안 항목${mk(5)}</th><th colspan="3" class="grp">등급 규정${mk(6)}</th><th rowspan="2">최종 수정${mk(7)}</th><th rowspan="2" class="c">관리</th></tr>
          <tr><th class="c">출장 예산</th><th class="c">법인카드<br>실시간 한도증액</th><th class="c">출장 근태<br>신청</th><th>등급</th><th class="c">개인 예외</th><th class="c">미할당 직책</th></tr>
        </thead>
        <tbody>${rows.length ? rows.map((c, i) => {
          const last = lastOf(c.code), ua = unassigned(c, c.grades).length, ex = c.exc.filter((x) => excState(x) !== 'ended').length;
          return `<tr>
            <td class="c dim num">${i + 1}</td>
            <td><div class="corp-cd">${c.code}</div><div class="corp-nm">${esc(c.name)}</div><div class="sm">${esc(c.country)}</div></td>
            <td>${badge(c.gbt ? 'blue' : 'gray', c.system)}</td>
            <td class="c num">${c.headcount.toLocaleString()}</td>
            ${c.gbt ? `${D.draftItems.map((d) => `<td class="c">${badge(c.draft[d.key] ? 'blue' : 'gray', onoff(c.draft[d.key]))}</td>`).join('')}
              <td>${c.grades.length ? `<div class="gtags">${c.grades.map((g) => `<span class="badge line">${esc(g.name)}</span>`).join('')}</div>` : badge('orange', '미등록')}</td>
              <td class="c num">${ex ? ex + '건' : '<span class="dim">-</span>'}</td>
              <td class="c">${ua ? badge('red', ua + '개') : '<span class="dim">-</span>'}</td>
              <td class="num">${last ? `${esc(last.at.slice(0, 10))}<div class="sm">${esc(last.by)}</div>` : '<span class="dim">-</span>'}</td>`
            : `<td colspan="7"><span class="sm">출장 시스템 미사용 법인입니다. AMEX GBT 합류 시 설정을 오픈합니다.</span></td>`}
            <td class="c"><button type="button" class="btn sm" data-a="manage" data-code="${c.code}" ${c.gbt ? '' : 'disabled'}>관리</button></td></tr>`;
        }).join('') : '<tr><td colspan="12"><div class="empty"><b>검색 결과가 없습니다.</b></div></td></tr>'}</tbody>
      </table></div>`;
  }

  /* ================= P03 구성원 최종 등급 ================= */
  function membersView() {
    const f = S.mem, q = f.q.trim().toLowerCase();
    const all = corps.filter((c) => c.gbt).flatMap((c) => c.members.map((m) => Object.assign({ c, m }, finalOf(c, m))));
    const rows = all.filter((r) => (!f.corp || r.c.code === f.corp) && (!q || (r.m.name + r.m.email).toLowerCase().includes(q)) && (!f.f || (f.f === 'exc' ? !!r.exc : f.f === 'none' ? !r.grade : !r.m.sync.ok)));
    return `
      <button type="button" class="back" data-a="grid">← 이전</button>
      <div class="toolbar" style="margin-top:10px">
        <h3 class="h3" style="margin:0">구성원 최종 등급 <em>${rows.length}</em>${mk(1)}</h3><span class="chip">조회 기준 <b class="num">${D.TODAY}</b> (법인 현지 시간)</span><span class="sp"></span>
        <select class="sel" data-me="corp" aria-label="법인"><option value="">전체 법인</option>${corps.filter((c) => c.gbt).map((c) => `<option ${f.corp === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
        <select class="sel" data-me="f" aria-label="구분"><option value="">전체 구분</option><option value="exc" ${f.f === 'exc' ? 'selected' : ''}>개인 예외 적용</option><option value="none" ${f.f === 'none' ? 'selected' : ''}>등급 미할당</option><option value="fail" ${f.f === 'fail' ? 'selected' : ''}>전송 실패</option></select>
        <input class="inp" data-me="q" value="${esc(f.q)}" placeholder="이름, 이메일" maxlength="30" style="width:200px" aria-label="구성원 검색">${mk(2)}
      </div>
      <div class="tbl-wrap"><table class="tbl hist-tbl">
        <colgroup>${[5, 6, 20, 15, 11, 11, 13, 19].map((w) => `<col style="width:${w}%">`).join('')}</colgroup>
        <thead><tr><th class="c">번호</th><th>법인</th><th>구성원</th><th>소속 · 직책</th><th>매핑 등급</th><th>개인 예외${mk(3)}</th><th>최종 등급 (연동 코드)${mk(4)}</th><th>AMEX GBT 전송${mk(5)}</th></tr></thead>
        <tbody>${rows.length ? rows.map((r, i) => `<tr>
          <td class="c dim num">${i + 1}</td><td><b>${r.c.code}</b></td>
          <td><b>${esc(r.m.name)}</b><div class="help">${esc(r.m.email)}</div></td>
          <td>${esc(r.m.dept)}<div class="help">${esc(r.m.hrTitle)}</div></td>
          <td>${r.map ? esc(r.map.name) : badge('red', '미할당 직책')}</td>
          <td>${r.exc ? `${badge('green', '적용 중')}<div class="help num">${esc(r.exc.start)} ~ ${esc(r.exc.end || '무기한')}</div>` : '<span class="dim">-</span>'}</td>
          <td>${r.grade ? `<b>${esc(r.grade.name)}</b><div class="help num">${esc(r.grade.code)}</div>` : `${badge('red', '등급 없음')}<div class="help">OBT 사용 불가</div>`}</td>
          <td>${!r.grade ? '<span class="dim">전송 대상 아님</span>' : r.m.sync.ok ? `${badge('gray', '전송 완료')} <span class="help num">${esc(r.m.sync.at)}</span>` : `${badge('red', '전송 실패')} <span class="help num">${esc(r.m.sync.at)}</span> <button type="button" class="btn sm" data-a="resend" data-code="${r.c.code}" data-email="${esc(r.m.email)}">재전송</button>`}</td></tr>`).join('') : '<tr><td colspan="8"><div class="empty"><b>조건에 맞는 구성원이 없습니다.</b></div></td></tr>'}</tbody>
      </table></div>`;
  }

  /* ================= P02 변경 이력 ================= */
  const CAT_COLOR = { '기안 항목': 'blue', '등급 규정': 'green', '개인 예외': 'orange' };
  function historyView() {
    const f = S.hist, q = f.q.trim().toLowerCase();
    const rows = H.filter((x) => (!f.corp || x.corp === f.corp) && (!f.cat || x.cat === f.cat) && (!dateOk(f.from) || x.at.slice(0, 10) >= f.from) && (!dateOk(f.to) || x.at.slice(0, 10) <= f.to) && (!q || (x.text + x.before + x.after + x.reason + x.by).toLowerCase().includes(q)));
    return `
      <button type="button" class="back" data-a="grid">← 이전</button>
      <div class="toolbar" style="margin-top:10px">
        <h3 class="h3" style="margin:0">변경 이력 <em>${rows.length}</em>${mk(1)}</h3><span class="sp"></span>
        <span class="help" style="font-weight:700;color:#111">기간</span><input class="inp num" data-h="from" value="${esc(f.from)}" placeholder="YYYY.MM.DD" maxlength="10" style="width:110px" aria-label="시작일"><span>~</span><input class="inp num" data-h="to" value="${esc(f.to)}" placeholder="YYYY.MM.DD" maxlength="10" style="width:110px" aria-label="종료일">
        <select class="sel" data-h="corp" aria-label="법인"><option value="">전체 법인</option>${corps.map((c) => `<option ${f.corp === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
        <select class="sel" data-h="cat" aria-label="구분"><option value="">전체 구분</option>${Object.keys(CAT_COLOR).map((c) => `<option ${f.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <input class="inp" data-h="q" value="${esc(f.q)}" placeholder="변경 내용, 사유, 수정자 검색" maxlength="30" style="width:200px" aria-label="이력 검색">${mk(2)}
      </div>
      <div class="tbl-wrap"><table class="tbl hist-tbl">
        <colgroup>${[5, 11, 6, 8, 19, 26, 12, 6, 7].map((w) => `<col style="width:${w}%">`).join('')}</colgroup>
        <thead><tr><th class="c">번호</th><th>변경 일시</th><th>법인</th><th>구분</th><th>변경 내용</th><th>변경 전 → 변경 후</th><th>변경 사유</th><th>수정자</th><th>저장 번호${mk(3)}</th></tr></thead>
        <tbody>${rows.length ? rows.map((x, i) => `<tr>
          <td class="c dim num">${rows.length - i}</td><td class="num">${esc(x.at)}</td><td><b>${x.corp}</b></td><td>${badge(CAT_COLOR[x.cat] || 'gray', x.cat)}</td>
          <td>${esc(x.text)}</td><td><div class="hist-ba"><span class="b">${esc(x.before)}</span><span class="dim">→</span><span class="a">${esc(x.after)}</span></div></td>
          <td class="dim">${esc(x.reason)}</td><td>${esc(x.by)}</td><td class="num dim">${esc(x.sid)}</td></tr>`).join('') : '<tr><td colspan="9"><div class="empty"><b>조건에 맞는 변경 이력이 없습니다.</b></div></td></tr>'}</tbody>
      </table></div>`;
  }

  /* ================= M01 · M02 관리 모달 ================= */
  function openManage(code) { const c = corpOf(code); const w = { draft: clone(c.draft), grades: clone(c.grades), exc: clone(c.exc) }; S.m = { code, tab: 'draft', w, base: clone(w) }; S.cf = null; S.org = null; render(); }
  const dirty = () => S.m && JSON.stringify(S.m.w) !== JSON.stringify(S.m.base);

  function tabDraft(c, w) {
    return `<h4 class="sec-title" style="margin-bottom:10px">기안 항목 관리${mk(2)}</h4>
      ${D.draftItems.map((d) => `<div class="ditem ${w.draft[d.key] !== S.m.base.draft[d.key] ? 'changed' : ''}"><div><div class="nm">${esc(d.name)}</div></div>
        <div><button type="button" class="tg" role="switch" aria-checked="${w.draft[d.key]}" aria-label="${esc(d.name)} 사용" data-a="tg" data-k="${d.key}"></button><span class="tg-label">${onoff(w.draft[d.key])}</span></div></div>`).join('')}
      <p class="note" style="margin-top:12px">저장 즉시 신규 기안부터 적용됩니다. 결재 진행 중 기안은 작성 당시 설정을 유지하고, 항목 설정을 변경하면 임시저장 기안은 삭제됩니다.${mk(3)}</p>`;
  }

  function tabGrade(c, w) {
    const ua = unassigned(c, w.grades), cnt = (t) => c.members.filter((m) => m.hrTitle === t).length;
    return `<div class="row between"><div><h4 class="sec-title">구성원 등급${mk(2)}</h4><p class="sec-desc">인사정보 직책을 등급에 매핑합니다. 연동 코드는 AMEX GBT(Egencia)에 등록된 traveler group 값과 동일하게 입력합니다.</p></div><button type="button" class="btn sm" data-a="g-add">+ 등급 추가</button></div>
      ${w.grades.length ? `<table class="etbl"><thead><tr><th style="width:74px" class="c">순서</th><th style="width:160px">등급명</th><th style="width:160px">연동 코드${mk(3)}</th><th style="width:210px">설명</th><th>매핑 직책${mk(4)}</th><th style="width:60px"></th></tr></thead><tbody>
        ${w.grades.map((g, i) => `<tr><td class="c" style="white-space:nowrap"><button type="button" class="btn sm ghost" style="padding:0 5px" data-a="g-up" data-id="${g.id}" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button type="button" class="btn sm ghost" style="padding:0 5px" data-a="g-down" data-id="${g.id}" ${i < w.grades.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button></td>
          <td><input class="inp" value="${esc(g.name)}" maxlength="20" placeholder="등급명" data-g="${g.id}" data-f="name" aria-label="등급명"></td>
          <td><input class="inp num" value="${esc(g.code)}" maxlength="50" placeholder="traveler group 값" data-g="${g.id}" data-f="code" aria-label="연동 코드"></td>
          <td><input class="inp" value="${esc(g.desc || '')}" maxlength="60" placeholder="설명" data-g="${g.id}" data-f="desc" aria-label="설명"></td>
          <td><div class="tchips">${g.hr.map((t) => `<span class="tchip">${esc(t)}<button type="button" aria-label="${esc(t)} 매핑 해제" data-a="g-unmap" data-id="${g.id}" data-t="${esc(t)}">×</button></span>`).join('')}
            ${ua.length ? `<select class="sel" data-a="g-map" data-id="${g.id}" aria-label="직책 추가"><option value="">+ 직책</option>${ua.map((t) => `<option>${esc(t)}</option>`).join('')}</select>` : ''}</div></td>
          <td class="act"><button type="button" class="btn sm danger" data-a="g-del" data-id="${g.id}">삭제</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty"><b>등록된 등급이 없습니다.</b></div>'}
      <div class="banner ${ua.length ? 'red' : ''}" style="margin-top:10px">${mk(5)}${ua.length ? `<b>미할당 직책 ${ua.length}개</b><span class="grow">해당 직책의 구성원은 최종 등급이 없어 OBT를 사용할 수 없습니다. 등급에 직책을 할당해 주세요.</span><span class="tchips">${ua.map((t) => `<span class="badge red">${esc(t)} · ${cnt(t)}명</span>`).join('')}</span>` : '<b>미할당 직책 없음</b><span class="grow">모든 직책이 등급에 할당되어 있습니다.</span>'}</div>

      <div class="row between" style="margin-top:24px"><div><h4 class="sec-title">개인 예외 지정${mk(6)}</h4><p class="sec-desc">직책 매핑과 다른 등급을 특정 구성원에게 개별 지정합니다. 적용 기간 동안 직책 매핑보다 우선합니다.</p></div><button type="button" class="btn sm" data-a="x-add" ${w.grades.length ? '' : 'disabled'}>+ 예외 구성원 추가</button></div>
      ${w.exc.length ? `<table class="etbl"><thead><tr><th style="width:220px">구성원</th><th style="width:100px">매핑 등급</th><th style="width:140px">적용 등급</th><th>사유</th><th style="width:226px">적용 기간 (종료일 비우면 무기한)${mk(7)}</th><th style="width:74px">상태${mk(8)}</th><th style="width:60px"></th></tr></thead><tbody>
        ${w.exc.map((x) => { const cur = mapped(w.grades, x.hrTitle);
          return `<tr><td><b>${esc(x.name)}</b> <span class="help">${esc(x.dept)}</span>${x.isNew ? ' ' + badge('blue', '신규') : ''}<div class="help">${esc(x.email)}</div></td>
          <td style="vertical-align:middle">${cur ? esc(cur.name) : badge('red', '미할당')}</td>
          <td><select class="sel" data-x="${x.id}" data-f="to" aria-label="적용 등급"><option value="">선택</option>${w.grades.map((g) => `<option value="${g.id}" ${g.id === x.to ? 'selected' : ''} ${cur && cur.id === g.id ? 'disabled' : ''}>${esc(g.name)}</option>`).join('')}</select></td>
          <td><input class="inp" value="${esc(x.reason || '')}" maxlength="100" placeholder="사유 (필수)" data-x="${x.id}" data-f="reason" aria-label="사유"></td>
          <td><div class="row" style="gap:4px"><input class="inp num" value="${esc(x.start || '')}" placeholder="YYYY.MM.DD" maxlength="10" data-x="${x.id}" data-f="start" aria-label="시작일"><span>~</span><input class="inp num" value="${esc(x.end || '')}" placeholder="무기한" maxlength="10" data-x="${x.id}" data-f="end" aria-label="종료일"></div></td>
          <td style="vertical-align:middle">${dateOk(x.start || '') ? excBadge(x) : ''}</td>
          <td class="act"><button type="button" class="btn sm danger" data-a="x-del" data-id="${x.id}">삭제</button></td></tr>`; }).join('')}
        </tbody></table>` : '<div class="empty">개인 예외 지정이 없습니다.</div>'}`;
  }

  function modalHtml() {
    const m = S.m, c = corpOf(m.code), tabs = [['draft', '기안 항목 관리'], ['grade', '등급 규정']];
    return `<div class="ov" data-ov="m"><div class="xmodal" role="dialog" aria-modal="true" aria-label="${c.code} 법인 관리">
      <div class="xh"><div><div class="t">${c.code} 법인 관리${mk(1)}</div><div class="s">${esc(c.name)} · ${esc(c.country)} · 구성원 ${c.headcount.toLocaleString()}명 · ${c.system}</div></div><button type="button" class="x" aria-label="닫기" data-a="m-close">×</button></div>
      <div class="xtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${m.tab === k}" class="${m.tab === k ? 'on' : ''}" data-a="m-tab" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="xb" id="xb">${m.tab === 'draft' ? tabDraft(c, m.w) : tabGrade(c, m.w)}</div>
      <div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="m-close">취소</button><button type="button" class="btn pri" data-a="m-save" ${dirty() ? '' : 'disabled'}>저장</button>${mk(m.tab === 'draft' ? 4 : 9)}</div>
    </div></div>`;
  }

  /* ---------- 조직도 구성원 선택 (M02-1) ---------- */
  function orgTree(c) {
    const root = { id: c.code, name: c.name, children: [], members: [] };
    c.members.forEach((p) => { let node = root; const segs = p.path.split('/'); segs.forEach((seg, i) => { const id = c.code + '/' + segs.slice(0, i + 1).join('/'); let ch = node.children.find((n) => n.id === id); if (!ch) { ch = { id, name: seg, children: [], members: [] }; node.children.push(ch); } node = ch; }); node.members.push(p); });
    return root;
  }
  const allMembers = (n) => n.members.concat(...n.children.map(allMembers));
  const findNode = (n, id) => (n.id === id ? n : n.children.map((c) => findNode(c, id)).find(Boolean));
  function orgListHtml() {
    const o = S.org, w = S.m.w, q = o.q.trim().toLowerCase();
    const list = q ? allMembers(o.tree).filter((p) => (p.name + p.email).toLowerCase().includes(q)) : allMembers(findNode(o.tree, o.sel) || o.tree);
    if (!list.length) return '<div class="empty">검색 결과가 없습니다.</div>';
    return list.map((p) => { const taken = w.exc.some((x) => x.email === p.email), g = mapped(w.grades, p.hrTitle);
      return `<label class="org-mem ${taken ? 'dis' : ''}"><input type="checkbox" data-a="o-pick" value="${esc(p.email)}" ${o.picked.has(p.email) ? 'checked' : ''} ${taken ? 'disabled' : ''}>
        <span><b>${esc(p.name)}</b> <span class="sub">${esc(p.email)}</span><div class="sub">${esc(p.path.replace(/\//g, ' › '))}</div></span>
        <span>${taken ? badge('gray', '지정됨') : `<span class="sub">매핑 등급</span> <b>${esc(g ? g.name : '미할당')}</b>`}</span></label>`; }).join('');
  }
  const orgPickedHtml = () => { const o = S.org, all = allMembers(o.tree); return o.picked.size ? `선택 ${o.picked.size}명 ` + [...o.picked].map((e) => { const p = all.find((x) => x.email === e); return `<span class="tchip">${esc(p.name)}<button type="button" aria-label="${esc(p.name)} 선택 해제" data-a="o-unpick" data-e="${esc(e)}">×</button></span>`; }).join('') : '선택한 구성원이 없습니다.'; };
  function orgHtml() {
    const o = S.org;
    const node = (n, depth) => { const open = o.open.has(n.id), has = n.children.length > 0;
      return `<button type="button" class="org-node ${o.sel === n.id && !o.q ? 'on' : ''}" style="padding-left:${6 + depth * 14}px" data-a="o-node" data-id="${esc(n.id)}"><span class="car">${has ? (open ? '▾' : '▸') : ''}</span>${esc(n.name)}<span class="cnt num">${allMembers(n).length}</span></button>${has && open ? n.children.map((ch) => node(ch, depth + 1)).join('') : ''}`; };
    return `<div class="ov top" data-ov="o"><div class="cmodal" role="dialog" aria-modal="true" aria-label="구성원 선택" style="width:780px">
      <div class="xh"><div><div class="t">구성원 선택</div></div><button type="button" class="x" aria-label="닫기" data-a="o-close">×</button></div>
      <div class="xb"><div class="row"><input class="inp grow" id="org-q" value="${esc(o.q)}" placeholder="이름, 이메일" maxlength="30" aria-label="구성원 검색">${mk(1)}</div>
        <div class="org"><div class="org-box"><h5>조직${mk(2)}</h5>${node(o.tree, 0)}</div><div class="org-box"><h5>구성원${mk(3)}</h5><div id="org-list">${orgListHtml()}</div></div></div>
        <div class="org-picked" id="org-picked">${orgPickedHtml()}</div></div>
      <div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="o-close">취소</button><button type="button" class="btn pri" data-a="o-ok" ${o.picked.size ? '' : 'disabled'}>선택 완료</button>${mk(4)}</div></div></div>`;
  }

  /* ---------- 변경 내역 · 검증 · 저장 ---------- */
  function diffs() {
    const { w, base } = S.m, out = [];
    const add = (cat, text, before, after) => out.push({ cat, text, before: before == null || before === '' ? '-' : String(before), after: after == null || after === '' ? '-' : String(after) });
    D.draftItems.forEach((d) => { if (w.draft[d.key] !== base.draft[d.key]) add('기안 항목', d.name, onoff(base.draft[d.key]), onoff(w.draft[d.key])); });
    const gdesc = (g) => `${g.name} [${g.code}]${g.hr.length ? ' (' + g.hr.join(', ') + ')' : ''}`;
    base.grades.forEach((b) => { const g = w.grades.find((x) => x.id === b.id);
      if (!g) return add('등급 규정', `등급 삭제 — ${b.name}`, gdesc(b), '-');
      if (g.name !== b.name) add('등급 규정', `등급명 변경 — ${b.name}`, b.name, g.name);
      if (g.code !== b.code) add('등급 규정', `연동 코드 변경 — ${g.name}`, b.code, g.code);
      if ((g.desc || '') !== (b.desc || '')) add('등급 규정', `설명 변경 — ${g.name}`, b.desc, g.desc);
      if (g.hr.join('|') !== b.hr.join('|')) add('등급 규정', `직책 매핑 변경 — ${g.name}`, b.hr.join(', '), g.hr.join(', ')); });
    w.grades.filter((g) => !base.grades.some((b) => b.id === g.id)).forEach((g) => add('등급 규정', `등급 추가 — ${g.name}`, '-', gdesc(g)));
    const ord = (l, o) => l.filter((g) => o.some((b) => b.id === g.id)).map((g) => g.id).join();
    if (ord(base.grades, w.grades) !== ord(w.grades, base.grades)) add('등급 규정', '등급 순서 변경', base.grades.map((g) => g.name).join(' › '), w.grades.map((g) => g.name).join(' › '));
    const xdesc = (x, gs) => `${gname(gs, x.to)} (${x.start || '?'} ~ ${x.end || '무기한'})`;
    base.exc.forEach((b) => { const x = w.exc.find((e) => e.id === b.id);
      if (!x) return add('개인 예외', `개인 예외 제외 — ${b.name}`, xdesc(b, base.grades), '-');
      if (x.to !== b.to || x.start !== b.start || (x.end || '') !== (b.end || '')) add('개인 예외', `개인 예외 수정 — ${x.name}`, xdesc(b, base.grades), xdesc(x, w.grades));
      if (x.reason !== b.reason) add('개인 예외', `사유 수정 — ${x.name}`, b.reason, x.reason); });
    w.exc.filter((x) => !base.exc.some((b) => b.id === x.id)).forEach((x) => add('개인 예외', `개인 예외 추가 — ${x.name}`, (mapped(w.grades, x.hrTitle) || {}).name, xdesc(x, w.grades)));
    return out;
  }
  function validate() {
    const { w } = S.m;
    if (w.grades.some((g) => !g.name.trim())) return '등급명을 입력해 주세요.';
    if (new Set(w.grades.map((g) => g.name.trim().toLowerCase())).size !== w.grades.length) return '같은 이름의 등급이 있습니다.';
    if (w.grades.some((g) => !g.code.trim())) return '연동 코드를 입력해 주세요.';
    if (new Set(w.grades.map((g) => g.code.trim())).size !== w.grades.length) return '같은 연동 코드가 있습니다.';
    for (const x of w.exc) {
      if (!x.to || !w.grades.some((g) => g.id === x.to)) return `${x.name}의 적용 등급을 선택해 주세요.`;
      if ((mapped(w.grades, x.hrTitle) || {}).id === x.to) return `${x.name}의 적용 등급이 매핑 등급과 같습니다.`;
      if (!(x.reason || '').trim()) return `${x.name}의 사유를 입력해 주세요.`;
      if (!dateOk(x.start || '')) return `${x.name}의 시작일을 YYYY.MM.DD 형식으로 입력해 주세요.`;
      if (x.end && (!dateOk(x.end) || x.end < x.start)) return `${x.name}의 종료일을 확인해 주세요.`;
    }
    return null;
  }
  function confirmHtml() {
    const cf = S.cf, c = corpOf(S.m.code);
    if (cf.kind === 'discard') return `<div class="ov top" data-ov="c"><div class="cmodal" role="alertdialog" aria-modal="true" style="width:420px"><div class="xh"><div class="t">변경 내용을 저장하지 않고 닫을까요?${mk(1)}</div></div><div class="xb"><p style="margin:0">저장하지 않은 변경 ${cf.n}건이 사라집니다.</p></div><div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="c-back">계속 수정</button><button type="button" class="btn pri" data-a="c-discard">저장하지 않고 닫기</button></div></div></div>`;
    const ds = cf.diffs, gbt = ds.some((d) => /^(등급 삭제|등급 추가|연동 코드 변경)/.test(d.text));
    return `<div class="ov top" data-ov="c"><div class="cmodal" role="alertdialog" aria-modal="true" aria-label="변경 내용 확인">
      <div class="xh"><div><div class="t">변경 내용 확인${mk(1)}</div><div class="s"><b>${c.code}</b> ${esc(c.name)}</div></div><button type="button" class="x" aria-label="닫기" data-a="c-back">×</button></div>
      <div class="xb"><table class="tbl" style="border-top:1px solid #CBD5E1"><thead><tr><th>구분</th><th>변경 내용${mk(2)}</th><th style="width:44%">변경 전 → 변경 후</th></tr></thead><tbody>
        ${Object.keys(CAT_COLOR).flatMap((cat) => ds.filter((d) => d.cat === cat)).map((d) => `<tr><td style="white-space:nowrap">${esc(d.cat)}</td><td>${esc(d.text)}</td><td><div class="hist-ba"><span class="b">${esc(d.before)}</span><span class="dim">→</span><span class="a">${esc(d.after)}</span></div></td></tr>`).join('')}</tbody></table>
        ${gbt ? `<div class="banner" style="margin:10px 0 0">${mk(3)}<span class="grow">등급 또는 연동 코드가 바뀝니다. AMEX GBT(Egencia)의 traveler group도 같은 값으로 맞춰 주세요. 값이 다르면 해당 구성원의 등급 전송이 실패합니다.</span></div>` : ''}
        <div class="frow" style="align-items:start;margin-top:6px"><label class="lb req" for="cf-reason">변경 사유${mk(4)}</label><span><textarea class="ta" id="cf-reason" rows="2" maxlength="200" placeholder="변경 이력에 함께 기록됩니다 (필수, 200자 이내)">${esc(cf.reason)}</textarea><div class="err" id="cf-err" role="alert">${esc(cf.err || '')}</div></span></div></div>
      <div class="xf"><span class="sp"></span><button type="button" class="btn" data-a="c-back">취소</button><button type="button" class="btn pri" data-a="c-save">저장</button>${mk(5)}</div></div></div>`;
  }
  function commit() {
    const cf = S.cf, c = corpOf(S.m.code), w = S.m.w, reason = $('#cf-reason').value.trim(); cf.reason = reason;
    if (!reason) { cf.err = '변경 사유를 입력해 주세요.'; mrender(); $('#cf-reason').focus(); return; }
    const at = now(), sid = 'S-' + String(++saveNo).padStart(4, '0'), tierChanged = cf.diffs.some((d) => d.cat !== '기안 항목');
    w.exc.forEach((x) => delete x.isNew);
    c.draft = clone(w.draft); c.grades = clone(w.grades); c.exc = clone(w.exc);
    if (tierChanged) c.members.forEach((m) => { m.sync = { ok: true, at }; });
    cf.diffs.slice().reverse().forEach((d) => H.unshift({ at, corp: c.code, cat: d.cat, text: d.text, before: d.before, after: d.after, reason, by: D.admin, sid }));
    const n = cf.diffs.length; S.m = null; S.cf = null; render();
    toast(`${c.code} 변경 ${n}건을 저장했습니다.${tierChanged ? ' 최종 등급을 AMEX GBT로 전송했습니다.' : ''}`);
  }

  /* ================= Description ================= */
  const PATH = '업무관리자 > 출장 관리 > 글로벌 법인별 관리';
  const NUM = '❶❷❸❹❺❻❼❽❾❿⓫⓬⓭⓮⓯';
  const F_HEAD = [1, '모달 헤더 · 탭', ['구성 : 법인 코드, 법인명·국가·구성원 수·출장 시스템, 탭(기안 항목 관리/등급 규정)', '기능 : 탭 선택 → 해당 탭 내용으로 전환(입력 유지)', '기타 : 법인 정보는 인사정보 연동 값(읽기 전용)']];
  const F_FOOT = (n) => [n, '하단 버튼', ['구성 : [취소][저장]', '기능', ': [취소]/✕/Esc 선택 → 변경이 있으면 TRIP-06-M01-2 호출, 없으면 모달 닫기', ': [저장] 선택 → 입력 검증 후 TRIP-06-M01-1 호출', '기타 : 변경이 없으면 [저장] 비활성. 검증 실패 시 토스트로 사유 안내']];
  function descData() {
    if (S.org) return { sid: 'TRIP-06-M02-1', title: '조직도 구성원 선택', def: '개인 예외 지정 대상 구성원을 조직도 트리에서 찾아 선택하는 창', path: PATH + ' > [관리] > 등급 규정 (모달)',
      pol: ['개인 예외 지정 대상은 조직도 트리에서 선택 필요', '관리 중인 법인의 조직도만 노출(다른 법인 구성원 선택 불가)', '구성원의 소속·직책·이메일은 인사정보 값을 그대로 사용', '선택 완료 시점에는 저장되지 않음. 관리 모달 [저장] → 컨펌 팝업을 거쳐야 반영'], iss: [],
      items: [[1, '검색', ['플레이스홀더 : 이름, 이메일', '키워드 : 이름, 이메일(부분 일치, 대소문자 무시, 30자)', '기타', ': 입력 즉시 반영. 검색어가 있으면 조직 선택과 무관하게 법인 전체에서 조회', ': 결과가 없으면 "검색 결과가 없습니다." 문구 노출']],
        [2, '조직도 트리', ['구성 : 법인 › 상위 조직 › 하위 조직 트리, 조직별 구성원 수(하위 포함)', '기능', ': 조직 선택 → 우측에 해당 조직(하위 포함) 구성원 표기', ': 선택된 조직 재선택 → 하위 접기/펼치기', '디폴트 : 법인(최상위) 선택, 1단계 조직 펼침']],
        [3, '구성원 목록', ['구성 : 체크박스, 이름·이메일, 조직, 매핑 등급', '기능 : 체크 → 하단 선택 칩에 추가(복수 선택), 칩의 ✕ → 선택 해제', '기타', ': 이미 예외가 지정된 구성원은 비활성(선택 불가)', ': 조직·검색을 바꿔도 선택 유지']],
        [4, '하단 버튼', ['구성 : [취소][선택 완료]', '기능', ': [취소] 선택 → 모달 닫기', ': [선택 완료] 선택 → 개인 예외 지정 표에 순서대로 "신규" 행 추가 후 모달 닫기', '기타', ': 선택된 구성원이 없으면 [선택 완료] 버튼 비활성화 상태']]] };
    if (S.cf && S.cf.kind === 'save') return { sid: 'TRIP-06-M01-1', title: '변경 내용 확인', def: '관리 모달의 변경 내역을 확인하고 최종 저장하는 컨펌 팝업', path: PATH + ' > [관리] > [저장] (모달)',
      pol: ['모든 수정은 이 팝업의 [저장]으로만 반영', '모든 수정은 항상 즉시 적용', '등급 규정·개인 예외가 바뀌면 저장 직후 해당 법인 구성원의 최종 등급을 AMEX GBT로 전송', '저장 1회에 저장 번호(S-0000)를 발급하고 변경 1건당 이력 1행 기록', '변경 사유는 모든 저장에 필수'], iss: [],
      items: [[1, '헤더', ['구성 : 제목, 법인 코드·법인명']],
        [2, '변경 내역', ['구성 : 구분(기안 항목/등급 규정/개인 예외), 변경 내용, 변경 전 → 변경 후', '기타 : 2개 탭의 변경을 한 번에 표기', ': 표의 1행이 변경 이력 1건']],
        [3, 'AMEX GBT 안내', ['구성 : 안내 문구', '기타 : 등급 추가·삭제, 연동 코드 변경이 포함될 때만 노출']],
        [4, '변경 사유', ['플레이스홀더 : 변경 이력에 함께 기록됩니다 (필수, 200자 이내)', '기타 : 비우고 저장 시 입력란 아래 오류 문구 노출']],
        [5, '하단 버튼', ['구성 : [취소][저장]', '기능', ': [취소] 선택 → 관리 모달로 복귀(입력 유지)', ': [저장] 선택 → 변경 내용 저장 및 모달 닫기, 그리드 리로드']]] };
    if (S.cf && S.cf.kind === 'discard') return { sid: 'TRIP-06-M01-2', title: '닫기 확인', def: '저장하지 않은 변경이 있을 때 관리 모달을 닫기 전에 확인하는 팝업', path: PATH + ' > [관리] > [취소] (모달)',
      pol: ['저장하지 않은 변경이 1건 이상일 때만 호출', '변경이 없으면 확인 없이 닫음'], iss: [],
      items: [[1, '안내 · 버튼', ['구성 : 안내 문구(사라지는 변경 건수), [계속 수정][저장하지 않고 닫기]', '기능', ': [계속 수정] 선택 → 관리 모달로 복귀(입력 유지)', ': [저장하지 않고 닫기] 선택 → 변경을 버리고 관리 모달 닫기']]] };
    if (S.m && S.m.tab === 'draft') return { sid: 'TRIP-06-M01', title: '법인 관리 — 기안 항목 관리', def: '구성원 출장 기안 화면의 섹션 3종 사용 여부를 법인별로 설정하는 탭', path: PATH + ' > [관리] (모달)',
      pol: ['항목은 출장 예산 / 법인카드 실시간 한도증액 / 출장 근태 신청 3종 고정', 'OFF인 섹션은 구성원 기안 화면에서 영역 자체를 노출하지 않음', '저장 즉시 신규 기안부터 적용. 결재 진행 중 기안은 작성 당시 설정 유지', '항목 설정을 변경하면(ON·OFF 모두) 해당 법인의 임시저장 출장 기안 삭제. 컨펌 팝업에 별도 경고 없음', '신규 법인의 기본값은 전부 OFF', 'HBA·HBL·HBJ 구성원도 하이브넷에서 출장 기안을 작성(예약은 Concur). 항목은 순차적으로 확대'], iss: [],
      items: [F_HEAD,
        [2, '기안 항목 목록', ['구성 : 항목명, 항목별 사용 토글(ON/OFF)', '기능 : 토글 선택 → 작업본에 반영(미저장 상태)', '기타 : 토글만으로는 저장되지 않음']],
        [3, '적용 안내', ['구성 : 적용 시점, 결재 진행 중 기안 처리, 임시저장 기안 삭제 안내']],
        F_FOOT(4)] };
    if (S.m) return { sid: 'TRIP-06-M02', title: '법인 관리 — 등급 규정', def: '법인별 구성원 등급(연동 코드)과 직책 매핑, 개인 예외 지정을 관리하는 탭', path: PATH + ' > [관리] > 등급 규정 (모달)',
      pol: ['등급은 법인별로 정의하고 인사정보 직책에 매핑해 자동 판정', '한 직책은 한 등급에만 매핑. 겸직인 경우 본직 기준', '미할당 직책의 구성원은 최종 등급이 없어 OBT 사용 불가(모든 직책 할당 필요)', '연동 코드 = AMEX GBT(Egencia)에 등록된 traveler group 값. 필수, 법인 내 중복 불가, 대소문자 구분', '등급명은 표시용이며 변경해도 연동에 영향 없음. 연동은 연동 코드로만 식별', 'GBT에서 사용 중인 등급도 삭제·이름 변경·코드 변경 가능(저장 시 GBT 값 일치 안내)', '개인 예외 지정은 적용 기간 동안 직책 매핑보다 우선', '예외 구성원이 퇴사하거나 다른 법인으로 이동하면 예외를 자동 해제하고 변경 이력에 기록', '발령으로 직책만 바뀐 구성원의 예외 지정은 유지(관리자 관리)', '예외 종료 임박 알림 없음'],
      iss: ['인사정보 매핑 키가 직책인지 직급인지, 법인별 코드 체계'],
      items: [F_HEAD,
        [2, '구성원 등급 설정', ['구성 : 순서 ▲▼, 등급명, 연동 코드, 설명, 매핑 직책, [삭제], [+ 등급 추가]', '기능', ': [+ 등급 추가] 선택 → 표 맨 아래 빈 행 추가', ': ▲▼ 선택 → 등급 표시 순서 변경', ': [삭제] 선택 → 행 삭제', '기타', ': 등급명 - 필수, 20자, 법인 내 중복 불가 / 설명 - 선택, 60자', ': 개인 예외의 적용 등급으로 사용 중인 등급은 삭제 불가', ': 등급이 없으면 "등록된 등급이 없습니다." 빈 상태 노출']],
        [3, '연동 코드', ['구성 : 텍스트 입력', '플레이스홀더 : traveler group 값', '기타', ': 필수, 50자, 법인 내 중복 불가, 앞뒤 공백 제거, 대소문자 구분', ': AMEX GBT로 전송하는 값은 등급명이 아닌 이 코드']],
        [4, '매핑 직책', ['구성 : 직책 칩, [+ 직책] Select', '기능', ': [+ 직책] 선택 → 해당 등급에 직책 매핑', ': 칩의 ✕ 선택 → 매핑 해제', '기타 : Select 에는 HAM 데이터 기준 미할당 직책만 노출']],
        [5, '미할당 직책', ['구성 : 미할당 직책 수, 직책별 해당 구성원 수', '기타', ': 미할당 직책이 있으면 빨간 배너, 없으면 "미할당 직책 없음" 표기', ': 마스터 그리드의 "미할당 직책" 열과 같은 값']],
        [6, '개인 예외 지정', ['구성 : 구성원(이름·소속·이메일), 매핑 등급, 적용 등급, 사유, 적용 기간, 상태, [삭제], [+ 예외 구성원 추가]', '기능', ': [+ 예외 구성원 추가] 선택 → TRIP-06-M02-1 호출 및 선택한 구성원을 신규 행으로 추가', ': [삭제] 선택 → 행 삭제', '기타', ': 적용 등급 - 매핑 등급과 같은 등급 선택 불가', ': 사유 - 필수 항목, 100자 제한']],
        [7, '적용 기간 설정', ['구성 : 시작일, 종료일(YYYY.MM.DD)', '디폴트 : 시작일 = 오늘, 종료일 = 비움(무기한)', '기타 : 종료일은 시작일 이후만 설정 가능. 날짜 기준은 법인 현지 시간']],
        [8, '상태', ['구성 : 예정(시작일 전) / 적용 중 / 만료(종료일 경과) 칩', '기타', ': 만료 건은 표에 남기며 매핑 등급으로 복귀', ': 퇴사·법인 이동으로 자동 해제된 건은 표에서 제외하고 변경 이력에서 조회']],
        F_FOOT(9)] };
    if (S.view === 'members') return { sid: 'TRIP-06-P03', title: '구성원 최종 등급', def: 'AMEX GBT로 전송되는 구성원별 최종 등급과 전송 상태를 조회하는 화면', path: PATH + ' > [구성원 최종 등급]',
      pol: ['여비규정은 AMEX GBT(Egencia)에서 세팅하고, 하이브넷은 법인·구성원·최종 등급만 전달', '전달 항목 : 법인 코드, 이메일(SSO 계정과 동일), 최종 등급의 연동 코드', '최종 등급 = 조회 시점에 적용 중인 개인 예외 > 직책 매핑(법인 현지 시간 기준)', '연동 방향 : 하이브넷이 Egencia User Sync API(SCIM 2.0)를 호출해 전송. Egencia 는 하이브넷을 조회하지 않음', '전송 시점 : 등급 규정·개인 예외 저장 직후, 개인 예외 시작·종료일이 도래하는 법인 현지 자정, 인사정보 동기화로 직책·소속이 바뀐 때', '인증 : OAuth 2.0 client credentials(Egencia 발급 Client ID/Secret)', '미할당 직책 구성원은 최종 등급이 없어 전송 대상에서 제외(OBT 사용 불가)', '조회 대상은 출장 시스템이 Concur (AMEX GBT)인 법인'],
      iss: ['User Sync API 로 traveler group 을 지정할 수 있는지와 정확한 필드명(Egencia 담당자 확인 필요)', '전송 실패 시 자동 재시도 횟수·간격과 관리자 알림 여부', '엑셀 다운로드 · 페이지네이션 필요 여부'],
      items: [[1, '목록', ['구성 : 번호, 법인, 구성원(이름·이메일), 소속·직책, 매핑 등급, 개인 예외, 최종 등급(연동 코드), AMEX GBT 전송', '기능 : [← 이전] 선택 → TRIP-06-P01 로 이동', '기타 : 조회 기준일(법인 현지 시간) 표기. 건수는 필터 결과 기준']],
        [2, '필터 · 검색', ['구성 : 법인 Select, 구분 Select(개인 예외 적용/등급 미할당/전송 실패), 통합 검색', '키워드 : 이름, 이메일(부분 일치, 30자)', '기타 : 입력 즉시 반영. 결과가 없으면 "조건에 맞는 구성원이 없습니다." 문구 노출']],
        [3, '개인 예외', ['구성 : 적용 중 칩, 적용 기간', '기타 : 조회 시점에 적용 중인 예외만 표기(예정·만료는 "-")']],
        [4, '최종 등급', ['구성 : 등급명, 연동 코드', '기타 : 미할당 직책이면 "등급 없음 · OBT 사용 불가" 표기']],
        [5, 'AMEX GBT 전송', ['구성 : 전송 완료/전송 실패 칩, 마지막 전송 일시, [재전송]', '기능 : [재전송] 선택 → 해당 구성원의 최종 등급 즉시 재전송', '기타 : 등급 없음 구성원은 "전송 대상 아님" 표기']]] };
    if (S.view === 'history') return { sid: 'TRIP-06-P02', title: '변경 이력', def: '글로벌 법인별 관리의 모든 수정 내역을 조회하는 화면', path: PATH + ' > [변경 이력]',
      pol: ['모든 수정 건은 일시·수정자·사유·변경 전후 값과 함께 이력으로 기록', '퇴사·법인 이동에 따른 개인 예외 자동 해제는 수정자 "시스템"으로 기록', '조회 전용'], iss: [],
      items: [[1, '이력 목록', ['구성 : 번호, 변경 일시, 법인, 구분, 변경 내용, 변경 전 → 변경 후, 변경 사유, 수정자, 저장 번호', '기능 : [← 이전] 선택 → TRIP-06-P01 로 이동', '기타 : 최신순. 변경 1건 = 1행. 건수는 필터 결과 기준']],
        [2, '필터 · 검색', ['구성 : 기간, 법인 Select, 구분 Select(기안 항목/등급 규정/개인 예외), 통합 검색', '키워드 : 변경 내용, 전후 값, 사유, 수정자(부분 일치, 30자)', '기타', ': 입력 즉시 반영', ': 결과가 없으면 "조건에 맞는 변경 이력이 없습니다." 문구 노출', ': 기간 디폴트 - 조회일 기준 한 달']],
        [3, '저장 번호', ['기타 : [저장] 1회에 발급되는 번호(S-0000). 같은 번호의 행은 사유·일시·수정자가 동일']]] };
    return { sid: 'TRIP-06-P01', title: '글로벌 법인별 관리 — 마스터 그리드', def: '해외 법인의 출장 시스템, 기안 항목, 등급 규정을 한 표로 조회하는 메인 화면', path: PATH,
      pol: ['기존 출장 관리에 추가되는 메뉴는 "글로벌 법인별 관리" 탭 1개', '기본 화면은 해외 법인의 값을 보여주는 마스터 그리드', 'HYB 및 국내 법인은 Redcap BTMS 를 사용하며 이 메뉴에 노출하지 않음', 'HBA·HBL·HBJ 는 Concur (AMEX GBT) 사용 법인으로 AMEX GBT 와 하이브넷 모두 세팅 필요', 'HBC·HBI 등 출장 시스템 미사용 법인은 "미사용"으로 노출하고 [관리] 비활성. AMEX GBT 합류 시 오픈', '수정은 [관리] 모달에서만 수행. 모든 수정은 컨펌 팝업을 거쳐 저장하고 변경 이력에 기록', '법인 목록은 인사정보 연동 결과를 그대로 사용(추가·삭제 불가)', 'AMEX GBT 세팅 담당자(HYB TnM)가 이 화면의 관리자'],
      iss: ['출장 시스템 구분 값을 어디에서 관리할지(프로토타입: 시스템 설정 값, 화면에서 변경 불가)'],
      items: [[1, '검색/조회 조건', ['구성 : 출장 시스템 Select(전체, Concur (AMEX GBT), 미사용), 통합 검색', '키워드 : 법인 코드, 법인명', '플레이스홀더 : 법인 코드, 법인명 검색', '기타 : 입력 즉시 반영. 결과가 없으면 "검색 결과가 없습니다." 문구 노출']],
        [2, '그리드', ['구성 : 번호, 법인, 출장 시스템, 구성원 수, 기안 항목(출장 예산, 법인카드 실시간 한도증액, 출장 근태 신청), 등급 규정(등급, 개인 예외, 미할당 직책), 최종 수정, [관리]']],
        [3, '법인', ['구성 : 법인 코드, 법인명, 국가, 구성원 수', '기타 : HAM 데이터 연동(읽기 전용) 값', ': HAM 데이터 기준 순서 노출']],
        [4, '출장 시스템', ['구성 : Concur (AMEX GBT) / 미사용 칩', '기타 : 미사용 법인은 기안 항목·등급 규정 칸을 합쳐 안내 문구 표기']],
        [5, '기안 항목', ['구성 : 출장 예산, 법인카드 실시간 한도증액, 출장 근태 신청 ON/OFF 칩', '기타 : 조회 전용']],
        [6, '등급 규정', ['구성 : 등급명 칩(등록 순서), 개인 예외 건수, 미할당 직책 수', '기타', ': 개인 예외 건수는 적용 중 + 예정 기준(만료 제외)', ': 등급이 없으면 "미등록", 미할당 직책이 있으면 빨간 칩 표기']],
        [7, '최종 수정 · 관리', ['구성 : 최종 저장 일자, 수정자, [관리]', '기능 : [관리] 선택 → 각 법인별 TRIP-06-M01 호출', '기타 : 미사용 법인은 [관리] 비활성']],
        [8, '구성원 최종 등급 버튼', ['기능 : 선택 → TRIP-06-P03 로 전환']],
        [9, '변경 이력 버튼', ['기능 : 선택 → TRIP-06-P02 로 전환']]] };
  }
  function renderDesc() {
    const d = descData(); $('#sid').textContent = d.sid;
    const line = (l) => (l[0] === ':' ? `<div class="ind">${l}</div>` : `<div>• ${l}</div>`);
    $('#desc').innerHTML = `<div class="desc-in">
      <div class="g-sec g1"><div class="g-h">설계 정보</div><b>${d.sid} ${d.title}</b><div class="gap"></div><div>Page ID: ${d.sid}</div><div>Definition: ${d.def}</div><div>Path: ${d.path}</div></div>
      <div class="g-sec g2"><div class="g-h">정책 정보</div><div>■ 주요 정책</div>${d.pol.map(line).join('')}${d.iss.length ? `<div class="gap"></div><div class="red">■ 확인 필요 사항</div>${d.iss.map(line).join('')}` : ''}</div>
      <div class="g-sec g3"><div class="g-h">화면 설명 및 디스크립션</div>${d.items.map((i, n) => `${n ? '<div class="gap"></div>' : ''}<div class="g-item" data-d="${i[0]}"><div class="gt">${NUM[i[0] - 1]} ${i[1]}</div>${i[2].map(line).join('')}</div>`).join('')}</div></div>`;
  }

  /* ================= 렌더 · 이벤트 ================= */
  function toast(msg) { document.querySelectorAll('.toast').forEach((e) => e.remove()); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
  function render(keep) {
    const ov = $('[data-ov="m"]'), st = ov ? ov.scrollTop : 0, ae = document.activeElement;
    const fs = ae && ae.dataset && (ae.dataset.a === 'q' ? '[data-a="q"]' : ae.dataset.h ? `[data-h="${ae.dataset.h}"]` : ae.dataset.me ? `[data-me="${ae.dataset.me}"]` : null);
    if (!keep) $('#view').innerHTML = S.view === 'history' ? historyView() : S.view === 'members' ? membersView() : gridView();
    $('#layer').innerHTML = (S.m ? modalHtml() : '') + (S.m && S.org ? orgHtml() : '') + (S.cf ? confirmHtml() : '');
    if ($('[data-ov="m"]')) $('[data-ov="m"]').scrollTop = st;
    if (fs && !S.m) { const e = $(fs); if (e && e.tagName === 'INPUT') { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }
    renderDesc();
  }
  const mrender = () => render(true);
  function closeModal() { if (dirty()) { S.cf = { kind: 'discard', n: diffs().length }; mrender(); } else { S.m = null; S.cf = null; render(); } }
  function moveG(id, dir) { const l = S.m.w.grades, i = l.findIndex((g) => g.id === id); l.splice(i + dir, 0, l.splice(i, 1)[0]); mrender(); }
  const go = (v) => { S.view = v; render(); window.scrollTo(0, 0); };
  const ACT = {
    manage: (d) => openManage(d.code), history: () => go('history'), members: () => go('members'), grid: () => go('grid'),
    resend: (d) => { const m = corpOf(d.code).members.find((x) => x.email === d.email); m.sync = { ok: true, at: now() }; render(); toast(`${m.name}의 최종 등급을 재전송했습니다.`); },
    'm-tab': (d) => { S.m.tab = d.v; mrender(); $('[data-ov="m"]').scrollTop = 0; },
    'm-close': () => closeModal(),
    'm-save': () => { const v = validate(); if (v) { S.m.tab = 'grade'; mrender(); return toast(v); } S.cf = { kind: 'save', diffs: diffs(), reason: '', err: '' }; mrender(); $('#cf-reason').focus(); },
    tg: (d) => { S.m.w.draft[d.k] = !S.m.w.draft[d.k]; mrender(); const b = $(`[data-a="tg"][data-k="${d.k}"]`); if (b) b.focus(); },
    'g-add': () => { S.m.w.grades.push({ id: uid('ng'), name: '', code: '', desc: '', hr: [] }); mrender(); const ins = document.querySelectorAll('[data-f="name"][data-g]'); ins[ins.length - 1].focus(); },
    'g-del': (d) => { const w = S.m.w, g = w.grades.find((x) => x.id === d.id); if (w.exc.some((x) => x.to === g.id)) return toast('개인 예외의 적용 등급으로 사용 중이라 삭제할 수 없습니다.'); w.grades.splice(w.grades.indexOf(g), 1); mrender(); },
    'g-up': (d) => moveG(d.id, -1), 'g-down': (d) => moveG(d.id, 1),
    'g-unmap': (d) => { const g = S.m.w.grades.find((x) => x.id === d.id); g.hr = g.hr.filter((t) => t !== d.t); mrender(); },
    'x-add': () => { const tree = orgTree(corpOf(S.m.code)); S.org = { tree, open: new Set([tree.id].concat(tree.children.map((n) => n.id))), sel: tree.id, q: '', picked: new Set() }; mrender(); $('#org-q').focus(); },
    'x-del': (d) => { const l = S.m.w.exc; l.splice(l.findIndex((x) => x.id === d.id), 1); mrender(); },
    'o-node': (d) => { const o = S.org, n = findNode(o.tree, d.id); if (o.sel === d.id && n.children.length) { if (o.open.has(d.id)) o.open.delete(d.id); else o.open.add(d.id); } else { o.sel = d.id; o.open.add(d.id); } o.q = ''; mrender(); },
    'o-unpick': (d) => { S.org.picked.delete(d.e); mrender(); },
    'o-close': () => { S.org = null; mrender(); },
    'o-ok': () => { const o = S.org, all = allMembers(o.tree), w = S.m.w; let first = null;
      [...o.picked].forEach((e) => { const p = all.find((x) => x.email === e), id = uid('nx'); first = first || id; w.exc.push({ id, isNew: true, email: p.email, name: p.name, dept: p.dept, hrTitle: p.hrTitle, to: '', reason: '', start: D.TODAY, end: '' }); });
      const n = o.picked.size; S.org = null; mrender(); const el = $(`[data-x="${first}"][data-f="to"]`); if (el) el.focus(); toast(`구성원 ${n}명을 추가했습니다. 적용 등급과 사유를 입력해 주세요.`); },
    'c-back': () => { S.cf = null; mrender(); },
    'c-discard': () => { S.m = null; S.cf = null; render(); },
    'c-save': commit,
  };
  document.addEventListener('click', (e) => {
    const m = e.target.closest('.mk[data-mk]'); if (m) { const t = $(`.g-item[data-d="${m.dataset.mk}"]`); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const b = e.target.closest('button[data-a]'); if (b && !b.disabled && ACT[b.dataset.a]) ACT[b.dataset.a](b.dataset);
  });
  document.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset;
    if (d.a === 'f') { S.f = t.value; render(); }
    else if (d.h && t.tagName === 'SELECT') { S.hist[d.h] = t.value; render(); }
    else if (d.me && t.tagName === 'SELECT') { S.mem[d.me] = t.value; render(); }
    else if (d.a === 'g-map' && t.value) { S.m.w.grades.find((g) => g.id === d.id).hr.push(t.value); mrender(); }
    else if (d.a === 'o-pick') { if (t.checked) S.org.picked.add(t.value); else S.org.picked.delete(t.value); $('#org-picked').innerHTML = orgPickedHtml(); $('[data-a="o-ok"]').disabled = !S.org.picked.size; }
    else if (d.x && d.f === 'to') { S.m.w.exc.find((v) => v.id === d.x).to = t.value; mrender(); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target, d = t.dataset;
    if (d.a === 'q') { S.q = t.value; render(); }
    else if (d.h && t.tagName === 'INPUT') { S.hist[d.h] = t.value; if (d.h === 'q' || dateOk(t.value) || !t.value) render(); }
    else if (d.me === 'q') { S.mem.q = t.value; render(); }
    else if (t.id === 'org-q') { S.org.q = t.value; $('#org-list').innerHTML = orgListHtml(); document.querySelectorAll('.org-node.on').forEach((n) => n.classList.toggle('on', !t.value.trim())); return; }
    else if (!S.m) return;
    else if (d.g) S.m.w.grades.find((v) => v.id === d.g)[d.f] = d.f === 'code' ? t.value.trim() : t.value;
    else if (d.x) S.m.w.exc.find((v) => v.id === d.x)[d.f] = t.value;
    if (S.m && !S.cf) { const sv = $('[data-a="m-save"]'); if (sv) sv.disabled = !dirty(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (S.org) { S.org = null; mrender(); } else if (S.cf) { S.cf = null; mrender(); } else if (S.m) closeModal(); });
  document.addEventListener('mouseover', (e) => { const m = e.target.closest('.mk[data-mk], .g-item[data-d]'); document.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot')); if (!m) return; const no = m.dataset.mk || m.dataset.d; document.querySelectorAll(`.mk[data-mk="${no}"], .g-item[data-d="${no}"]`).forEach((x) => x.classList.add('hot')); });
  $('#desc-toggle').onchange = (e) => document.body.classList.toggle('desc-on', e.target.checked);
  $('#mk-toggle').onchange = (e) => document.body.classList.toggle('mk-off', !e.target.checked);
  render();
})();
