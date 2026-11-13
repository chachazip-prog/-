/* 여비규정 (TRIP-ADM-CORP-03) — 법인별 여비규정 개정 버전 관리 */
(function () {
  const D = window.DATA, h = App.h, ui = App.ui, esc = h.esc;

  const TYPES = {
    class: { label: '등급 기준', color: 'gray', col: '기준' },
    cap: { label: '한도 내 실비', color: 'blue', col: '한도' },
    flat: { label: '정액 지급', color: 'green', col: '지급액' },
    actual: { label: '실비', color: 'line', col: '지급 기준' },
  };
  const CATS = ['교통', '숙박', '일비·식비', '기타'];
  const CURS = Object.keys(D.curSymbol);
  const ALL = '전체 구성원';
  const REGION_HEAD = '지역 그룹';
  const ST = { active: ['green', '적용 중'], scheduled: ['blue', '적용 예정'], ended: ['line', '종료'], draft: ['gray', '임시저장'] };
  const MAX_COLS = 6;

  /* ---------- 뷰 상태 (법인이 바뀌면 초기화) ---------- */
  const fresh = (code) => ({ code, sel: null, edit: false, work: null, dirty: false, open: {}, focus: null, filled: false, pvGrade: null });
  let S = fresh(null);

  /* ---------- 유틸 ---------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const list = (code) => D.policies[code] || (D.policies[code] = []);
  const grades = (code) => D.grades[code] || [];
  const regions = (code) => D.regions[code] || [];
  const stBadge = (s) => h.badge(ST[s][0], ST[s][1]);
  const toDate = (s) => { const p = s.split('.').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  const fmtDate = (d) => `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
  const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); };
  const validDate = (s) => /^\d{4}\.\d{2}\.\d{2}$/.test(s) && fmtDate(toDate(s)) === s;
  const period = (v) => (v.from ? `${v.from} ~ ${v.to || ''}` : '미지정');
  const nextVer = (code) => 'v' + (list(code).reduce((m, v) => Math.max(m, parseInt(String(v.ver).replace(/\D/g, ''), 10) || 0), 0) + 1);
  const isNum = (v) => typeof v === 'number';
  const cellText = (v, it) => (isNum(v) ? h.money(v, it.cur) : String(v));
  const cellInput = (v) => (v == null ? '' : isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v));
  /* 셀 입력값 해석: 빈 값 = 미정의(null), 숫자만(쉼표·소수 2자리 허용) = 금액(number), 그 외 = 문구(string). 등급 기준(class) 항목은 항상 문구 */
  function parseCell(raw, type) {
    const s = String(raw).trim();
    if (!s) return null;
    if (type !== 'class' && /^\d{1,3}(,\d{3})+(\.\d{1,2})?$|^\d{1,9}(\.\d{1,2})?$/.test(s)) return Number(s.replace(/,/g, ''));
    return s;
  }
  const defaultCol = (it) => TYPES[it.type].col;

  function setGrade(it, code, on) {
    const t = it.table;
    if (on) { const src = t.rows[0].cells; t.rows = grades(code).map((g) => ({ label: g.name, cells: src.slice() })); }
    else {
      const def = grades(code).find((g) => g.isDefault);
      const src = (def && t.rows.find((r) => r.label === def.name)) || t.rows[t.rows.length - 1];
      t.rows = [{ label: ALL, cells: src.cells.slice() }];
    }
    it.byGrade = on;
  }
  function setRegion(it, code, on) {
    const t = it.table;
    if (on) { t.cols = regions(code).map((r) => r.name); t.rows.forEach((r) => { const v = r.cells[0] == null ? null : r.cells[0]; r.cells = t.cols.map(() => v); }); t.colHead = REGION_HEAD; }
    else {
      const def = regions(code).find((r) => r.isDefault);
      let idx = def ? t.cols.indexOf(def.name) : -1; if (idx < 0) idx = t.cols.length - 1;
      t.rows.forEach((r) => { r.cells = [r.cells[idx] == null ? null : r.cells[idx]]; });
      t.cols = [defaultCol(it)]; t.colHead = '';
    }
    it.byRegion = on;
  }
  const rowsDiffer = (it) => it.table.rows.some((r) => JSON.stringify(r.cells) !== JSON.stringify(it.table.rows[0].cells));
  const colsDiffer = (it) => it.table.rows.some((r) => r.cells.some((c) => c !== r.cells[0]));

  /* 항목의 행(등급)·열(지역)이 법인의 현재 등급·지역 기준과 일치하는지 */
  function mismatch(it, code) {
    const out = [];
    if (it.byGrade && it.table.rows.map((r) => r.label).join('\n') !== grades(code).map((g) => g.name).join('\n')) out.push('등급');
    if (it.byRegion && it.table.cols.join('\n') !== regions(code).map((r) => r.name).join('\n')) out.push('지역');
    return out;
  }
  /* 현재 기준에 맞춰 행·열 재구성 — 이름이 같은 행·열의 값은 유지, 새 행·열은 미정의 */
  function align(it, code) {
    const t = it.table;
    if (it.byRegion) {
      const names = regions(code).map((r) => r.name);
      if (!names.length) setRegion(it, code, false);
      else { const old = t.cols.slice(); t.rows.forEach((r) => { r.cells = names.map((n) => { const i = old.indexOf(n); return i < 0 || r.cells[i] == null ? null : r.cells[i]; }); }); t.cols = names; t.colHead = REGION_HEAD; }
    }
    if (it.byGrade) {
      const gs = grades(code);
      if (!gs.length) { t.rows = [{ label: ALL, cells: t.rows[t.rows.length - 1].cells.slice() }]; it.byGrade = false; }
      else t.rows = gs.map((g) => { const r = t.rows.find((x) => x.label === g.name); return { label: g.name, cells: r ? r.cells.slice() : t.cols.map(() => null) }; });
    }
  }

  /* 표준 항목 세트(빈 템플릿). 등급·지역 기준이 있으면 통상 차등을 두는 항목만 미리 켠다 */
  function template(code) {
    const cur = h.corp(code).cur;
    const mk = (key, cat, name, on, type, bg, br, unit) => {
      const it = { key, cat, name, on, type, byGrade: false, byRegion: false, cur: type === 'class' ? null : cur, unit, table: { colHead: '', cols: [TYPES[type].col], rows: [{ label: ALL, cells: [null] }] }, cond: '', guide: '' };
      if (bg && grades(code).length) setGrade(it, code, true);
      if (br && regions(code).length) setRegion(it, code, true);
      return it;
    };
    return [
      mk('air', '교통', '항공', true, 'class', true, false, '좌석 등급'),
      mk('rail', '교통', '철도', true, 'class', true, false, '좌석 등급'),
      mk('rental', '교통', '렌터카', false, 'class', false, false, '차량 등급'),
      mk('hotel', '숙박', '숙박', true, 'cap', true, true, '1박 상한'),
      mk('meal', '일비·식비', '식비', true, 'cap', false, true, '1인 1일 한도'),
      mk('allowance', '일비·식비', '출장 수당(일당)', false, 'flat', false, false, '1일 정액'),
      mk('laundry', '기타', '세탁비', false, 'cap', false, false, '1일 한도'),
      mk('telecom', '기타', '통신비', false, 'cap', false, false, '1일 한도'),
    ];
  }

  const undefCount = (items) => items.filter((i) => i.on).reduce((n, i) => n + i.table.rows.reduce((m, r) => m + r.cells.filter((c) => c == null).length, 0), 0);

  /* 기준 버전 대비 변경 요약(적용 등록 모달) */
  function diff(base, cur) {
    if (!base || !base.items) return null;
    const out = []; const bm = {}; base.items.forEach((i) => { bm[i.key] = i; });
    cur.items.forEach((i) => {
      const b = bm[i.key]; if (!b) { out.push(`항목 추가 — ${i.name}`); return; }
      delete bm[i.key];
      const ch = [];
      if (b.on !== i.on) ch.push(i.on ? '사용 안 함 → 사용' : '사용 → 사용 안 함');
      if (b.type !== i.type) ch.push(`지급 방식 ${TYPES[b.type].label} → ${TYPES[i.type].label}`);
      if (b.byGrade !== i.byGrade || b.byRegion !== i.byRegion) ch.push('차등 기준 변경');
      if (JSON.stringify(b.table) !== JSON.stringify(i.table)) {
        let n = 0; const same = b.table.rows.length === i.table.rows.length && b.table.cols.length === i.table.cols.length;
        if (same) i.table.rows.forEach((r, ri) => r.cells.forEach((c, ci) => { if (c !== b.table.rows[ri].cells[ci]) n++; }));
        ch.push(same && n ? `값 ${n}건 변경` : '표 구성 변경');
      }
      if ((b.cur || '') !== (i.cur || '') || b.unit !== i.unit || (b.cond || '') !== (i.cond || '') || b.name !== i.name || b.cat !== i.cat) ch.push('기본 정보 변경');
      if ((b.guide || '') !== (i.guide || '')) ch.push('안내 문구 변경');
      if (ch.length) out.push(`${i.name} — ${ch.join(', ')}`);
    });
    Object.keys(bm).forEach((k) => out.push(`항목 삭제 — ${bm[k].name}`));
    return out;
  }

  function rerender(el) { S.focus = el && el.dataset ? el.dataset.fk || null : null; App.render(); }
  function touch() { S.dirty = true; }

  /* ---------- 조회 모드 ---------- */
  function valueTable(it, o) {
    const t = it.table, n = t.cols.length, edit = !!o.edit, i = o.i;
    const freeCols = edit && !it.byRegion;
    const narrow = !edit && !it.byRegion && n <= 2;
    const corner = it.byGrade ? '구성원 등급' : '대상';
    const colTh = (c, ci) => (freeCols
      ? `<th><span class="policy-colin"><input class="inp cell l" maxlength="20" value="${esc(c)}" data-col="${i}:${ci}" aria-label="${esc(it.name)} 열 이름 ${ci + 1}">${n > 1 ? `<button type="button" class="policy-x" data-act="del-col" data-i="${i}" data-c="${ci}" data-fk="addcol:${i}" aria-label="${esc(c)} 열 삭제" title="열 삭제">×</button>` : ''}</span></th>`
      : `<th>${esc(c)}</th>`);
    let head;
    if (freeCols && n > 1) head = `<tr><th rowspan="2">${corner}</th><th colspan="${n}"><input class="inp cell l" maxlength="30" placeholder="열 구분명 (예: 비행 시간)" value="${esc(t.colHead || '')}" data-f="colHead" data-i="${i}" aria-label="${esc(it.name)} 열 구분명"></th></tr><tr>${t.cols.map(colTh).join('')}</tr>`;
    else if (t.colHead && n > 1) head = `<tr><th rowspan="2">${corner}</th><th colspan="${n}">${esc(t.colHead)}</th></tr><tr>${t.cols.map(colTh).join('')}</tr>`;
    else head = `<tr><th>${corner}</th>${t.cols.map(colTh).join('')}</tr>`;
    const cell = (v, ri, ci) => {
      if (edit) return `<td><input class="inp cell ${it.type === 'class' || typeof v === 'string' ? 'l' : ''}" maxlength="40" placeholder="미정의" value="${esc(cellInput(v))}" data-cell="${i}:${ri}:${ci}" aria-label="${esc(it.name)} ${esc(t.rows[ri].label)} / ${esc(t.cols[ci])}"></td>`;
      if (v == null) return `<td class="policy-undef">미정의${o.mkUndef && !o.mkUndef.done ? (o.mkUndef.done = true, h.mk(9)) : ''}</td>`;
      return isNum(v) ? `<td class="num">${esc(cellText(v, it))}</td>` : `<td class="l">${esc(v)}</td>`;
    };
    return `<div class="policy-mxw" tabindex="${it.byRegion && n > 5 ? 0 : -1}" ${it.byRegion && n > 5 ? `role="group" aria-label="${esc(it.name)} 값 표 (가로 스크롤)"` : ''}><table class="mx policy-mx ${edit ? 'edit' : ''} ${narrow ? 'narrow' : ''}"><thead>${head}</thead><tbody>${t.rows.map((r, ri) => `<tr><td class="rh">${esc(r.label)}</td>${r.cells.map((v, ci) => cell(v, ri, ci)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  const diffBadges = (it) => (it.byGrade ? h.badge('line', '등급별 차등') : '') + (it.byRegion ? ' ' + h.badge('line', '지역별 차등') : '') + (!it.byGrade && !it.byRegion ? h.badge('line', '차등 없음') : '');

  function itemView(it, v, code, mkOnce) {
    const open = it.on || S.open[it.key];
    const first = (n) => (mkOnce[n] ? '' : (mkOnce[n] = true, h.mk(n)));
    const mm = v.status === 'draft' || v.status === 'scheduled' ? mismatch(it, code) : [];
    const body = `<div class="policy-body">
        ${it.cond ? `<div class="policy-kv" style="margin:0 0 10px"><span class="k">적용 조건</span><span class="v">${esc(it.cond)}</span></div>` : ''}
        ${valueTable(it, { mkUndef: mkOnce.undef })}
        ${mm.length ? `<p class="note" style="margin:6px 0 0">표의 ${mm.join('·')} 구성이 이 법인의 현재 ${mm.join('·')} 기준과 다릅니다. 편집 화면에서 [현재 기준에 맞추기]로 정리해 주세요.</p>` : ''}
        <div class="policy-kv"><span class="k">구성원 안내</span><span class="v ${it.guide ? '' : 'none'}">${it.guide ? esc(it.guide) : '등록된 안내 문구 없음'}</span></div>
      </div>`;
    return `<div class="policy-item ${it.on ? '' : 'off'}">
      <div class="policy-ih"><span class="policy-nm">${esc(it.name)}</span>${it.on ? first(7) : ''}${h.badge(TYPES[it.type].color, TYPES[it.type].label)} ${diffBadges(it)}<span class="policy-unit">${esc(it.unit || '')}${it.cur ? ` · ${it.cur}` : ''}</span>
        <span class="policy-r">${it.on ? '' : h.badge('gray', '사용 안 함') + first(10) + `<button type="button" class="btn sm ghost" data-act="open" data-k="${esc(it.key)}" data-fk="open:${esc(it.key)}" aria-expanded="${open ? 'true' : 'false'}">${open ? '접기' : '펼치기'}</button>`}</span></div>
      ${open ? body : ''}
    </div>`;
  }

  function catGroups(items) { return CATS.map((c) => ({ cat: c, items: items.map((it, i) => ({ it, i })).filter((x) => x.it.cat === c) })).filter((g) => g.items.length); }

  function versionsBlock(code) {
    const L = list(code), st = h.policyState(code), a = st.active, sc = st.scheduled, dr = st.draft;
    let now;
    if (a) {
      now = `<div class="policy-now"><div class="policy-nowv"><span class="k">현재 적용${h.mk(1)}</span><b>${esc(a.ver)}</b>${stBadge('active')}</div>
        <div class="policy-nowt">${esc(a.title)}</div>
        <div class="policy-meta"><span>적용 기간 <b class="num">${esc(a.from)} ~ ${a.to ? esc(a.to) : '(종료일 미정)'}</b></span><span>원문 문서 ${a.doc ? `<button type="button" class="link" data-act="doc" data-doc="${esc(a.doc)}">${esc(a.doc)}</button>` : '<b>-</b>'}</span><span>등록 <b>${esc(a.by)}</b> <span class="num">${esc(a.at)}</span></span>${a.copiedFrom ? `<span>복사 원본 <b>${esc(a.copiedFrom)}</b></span>` : ''}</div></div>`;
    } else {
      now = `<div class="policy-now"><div class="policy-nowv"><span class="k">현재 적용${h.mk(1)}</span><b>-</b></div><div class="policy-nowt">현재 적용 중인 여비규정이 없습니다</div><div class="policy-meta"><span>${sc ? `${esc(sc.from)}부터 ${esc(sc.ver)}이 적용됩니다. 그 전까지 구성원에게는 여비규정이 안내되지 않습니다.` : '임시저장 버전을 [적용 등록]하면 적용 시작일부터 구성원에게 안내됩니다.'}</span></div></div>`;
    }
    const sched = sc ? `<div class="policy-sched"><b class="num">${esc(sc.from)}</b>부터 <b>${esc(sc.ver)}</b> 적용 예정${h.mk(2)} — ${esc(sc.title)}${a ? ` · 현재 적용 중인 ${esc(a.ver)}은 <span class="num">${esc(a.to || addDays(sc.from, -1))}</span>까지 적용됩니다.` : ''} 적용 시작일 전까지 수정·삭제할 수 있습니다.</div>` : '';
    let newBtn;
    if (dr) newBtn = `<button type="button" class="btn pri" data-act="edit-ver" data-ver="${esc(dr.ver)}">임시저장 ${esc(dr.ver)} 이어서 편집</button>`;
    else newBtn = `<button type="button" class="btn pri" data-act="new-rev" ${sc ? 'disabled title="적용 예정 버전이 있어 새 개정을 등록할 수 없습니다"' : ''}>새 개정 등록</button>`;
    const row = (v) => `<tr class="click ${S.sel === v.ver ? 'sel' : ''}" data-row="${esc(v.ver)}">
        <td><input type="radio" name="policy-ver" value="${esc(v.ver)}" ${S.sel === v.ver ? 'checked' : ''} data-fk="ver:${esc(v.ver)}" aria-label="${esc(v.ver)} 값 보기"></td>
        <td><span class="policy-vno">${esc(v.ver)}</span></td><td>${stBadge(v.status)}</td>
        <td class="policy-vt">${esc(v.title)}${v.copiedFrom ? `<span class="policy-from">${esc(v.copiedFrom)}에서 복사</span>` : ''}</td>
        <td class="num">${esc(period(v))}</td>
        <td>${v.doc ? `<button type="button" class="link" data-act="doc" data-doc="${esc(v.doc)}">원문</button>` : '<span class="dim">-</span>'}</td>
        <td>${esc(v.by)}</td><td class="num dim">${esc(v.at)}</td></tr>`;
    return `<div class="sec">
      <div class="policy-top"><div><h3 class="sec-title">여비규정</h3><p class="sec-desc">구성원에게 안내하는 출장 여비 기준입니다. 개정 버전 단위로 등록하고 적용 시작일에 맞춰 전환됩니다. 출장 계획서 검증·차단이나 규정 예외 신청과는 연동되지 않습니다.</p></div>
        <div class="policy-acts">${newBtn}${h.mk(4)}</div></div>
      ${now}${sched}
      ${!dr && sc ? `<p class="help" style="margin:6px 0 0">적용 예정 버전(${esc(sc.ver)})이 있는 동안에는 새 개정을 등록할 수 없습니다. 적용 예정 버전을 수정하거나 삭제한 뒤 등록해 주세요.</p>` : ''}
      <div class="tbl-wrap policy-vers"><table class="tbl"><thead><tr><th><span class="num"></span></th><th>버전${h.mk(3)}</th><th>상태</th><th>규정명</th><th>적용 기간</th><th>원문 문서</th><th>등록자</th><th>등록일</th></tr></thead><tbody>${L.map(row).join('')}</tbody></table></div>
    </div>`;
  }

  function selectedBlock(code, corp) {
    const v = list(code).find((x) => x.ver === S.sel); if (!v) return '';
    const st = h.policyState(code);
    let acts = '', lock = '';
    if (v.status === 'draft') acts = `<button type="button" class="btn danger" data-act="del-ver" data-ver="${esc(v.ver)}">삭제</button><button type="button" class="btn pri" data-act="edit-ver" data-ver="${esc(v.ver)}" data-fk="edit-ver">이어서 편집</button>`;
    else if (v.status === 'scheduled') acts = `<button type="button" class="btn danger" data-act="del-ver" data-ver="${esc(v.ver)}">삭제</button><button type="button" class="btn" data-act="edit-ver" data-ver="${esc(v.ver)}" data-fk="edit-ver">수정</button>`;
    else lock = `<div class="policy-lock">${v.status === 'active' ? '적용 중인 버전은 직접 수정할 수 없습니다.' : '종료된 버전은 조회만 할 수 있습니다.'}<br>값을 바꾸려면 [새 개정 등록]을 이용해 주세요.</div>`;
    const items = v.items;
    const onCnt = items ? items.filter((i) => i.on).length : 0;
    const curs = items ? Array.from(new Set(items.filter((i) => i.on && i.cur).map((i) => i.cur))) : [];
    const mkOnce = { undef: { done: false } };
    const bodyHtml = !items
      ? `<div class="empty" style="margin-top:14px"><b>이 버전의 상세 값은 샘플 데이터에서 생략했습니다</b>실제 화면에서는 ${v.status === 'scheduled' ? '적용 예정으로 등록한 값이' : '등록 당시의 값이'} 아래 항목 표와 같은 형태로 표시됩니다.${v.status === 'scheduled' ? ' [수정]을 누르면 프로토타입에서는 현재 적용 버전의 값을 채워 편집 화면을 보여줍니다.' : ''}</div>`
      : catGroups(items).map((g) => `<div class="policy-cat"><h4 class="h3">${g.cat} <em>${g.items.length}</em></h4>${g.items.map((x) => itemView(x.it, v, code, mkOnce)).join('')}</div>`).join('');
    return `<div class="sec">
      <div class="policy-vh"><div><h3 class="sec-title">${esc(v.ver)} 규정 항목${h.mk(6)} ${stBadge(v.status)}</h3>
        <div class="chips" style="margin-top:6px"><span class="chip">적용 기간 <b class="num">${esc(period(v))}</b></span>${items ? `<span class="chip">사용 항목 <b class="num">${onCnt} / ${items.length}</b></span>${curs.length ? `<span class="chip">금액 통화 <b>${curs.join(' · ')}</b></span>` : ''}` : ''}<span class="chip">구성원 등급 <b class="num">${grades(code).length}개</b></span><span class="chip">지역 그룹 <b class="num">${regions(code).length}개</b></span><button type="button" class="link" data-act="criteria" style="font-size:11px">등급 · 지역 기준 보기</button></div></div>
        <div class="policy-acts">${items ? `<button type="button" class="btn" data-act="preview" data-fk="preview">구성원 안내 미리보기</button>${h.mk(5)}` : ''}${acts}</div></div>
      ${lock && items ? `<p class="help" style="margin:8px 0 0">${v.status === 'active' ? '적용 중인 버전은 이력 보존을 위해 직접 수정할 수 없습니다. 값을 바꾸려면 [새 개정 등록]으로 개정 버전을 만들어 주세요.' : '종료된 버전은 조회만 할 수 있습니다.'}${st.active && v.status === 'ended' ? '' : ''}</p>` : ''}
      ${corp.sample ? '<p class="note" style="margin:8px 0 0">HYB의 값은 화면 예시용 샘플이며 확정된 규정이 아닙니다.</p>' : ''}
      ${bodyHtml}
    </div>`;
  }

  /* ---------- 미등록(빈 상태) ---------- */
  function emptyBlock(code, corp) {
    const g = grades(code).length, r = regions(code).length, ready = g > 0 && r > 0;
    return `<div class="sec">
      <div class="policy-top"><div><h3 class="sec-title">여비규정</h3><p class="sec-desc">구성원에게 안내하는 출장 여비 기준입니다. 개정 버전 단위로 등록하고 적용 시작일에 맞춰 전환됩니다.</p></div></div>
      <div class="empty policy-empty"><b>등록된 여비규정이 없습니다${h.mk(18)}</b>${esc(corp.code)} 구성원에게는 여비규정이 안내되지 않고 있습니다. 표준 항목으로 새로 등록하거나, 다른 법인의 규정을 복사해 시작할 수 있습니다.
        <div class="row"><button type="button" class="btn ${ready ? 'pri' : ''}" data-act="reg-blank" data-fk="reg-blank">여비규정 등록</button><button type="button" class="btn" data-act="reg-copy" data-fk="reg-copy">다른 법인 규정 복사해 오기</button></div></div>
      <div class="policy-pre"><div class="t">등록 순서</div>
        <ol><li><b>등급 · 지역 기준 등록</b>${g ? h.badge('green', `구성원 등급 ${g}개`) : h.badge('orange', '구성원 등급 미등록')} ${r ? h.badge('green', `지역 그룹 ${r}개`) : h.badge('orange', '지역 그룹 미등록')}</li><li><b>여비규정 등록</b>${h.badge('orange', '미등록')}</li></ol>
        ${ready ? '' : `<div class="row between" style="margin-top:10px"><p class="note" style="margin:0">등급별·지역별로 값이 다른 규정이라면 등급 · 지역 기준을 먼저 등록해 주세요. 기준 없이 등록하면 모든 항목이 '전체 구성원' 단일 값으로 시작합니다.</p><button type="button" class="btn pri" data-act="criteria">등급 · 지역 기준 등록</button></div>`}
      </div>
    </div>`;
  }

  /* ---------- 편집 모드 ---------- */
  function itemEdit(it, i, code, mkOnce) {
    const first = (n) => (mkOnce[n] ? '' : (mkOnce[n] = true, h.mk(n)));
    const g = grades(code).length, r = regions(code).length, mm = mismatch(it, code);
    const opt = (list_, cur, lab) => list_.map((x) => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(lab ? lab(x) : x)}</option>`).join('');
    const guide = it.guide || '';
    return `<div class="policy-item edit" data-item="${i}">
      <div class="policy-eh">${h.toggle(it.on, `data-act="tg-on" data-i="${i}" data-fk="on:${i}" aria-label="${esc(it.name)} 사용 여부"`, false)}
        <input class="inp nm" maxlength="20" value="${esc(it.name)}" data-f="name" data-i="${i}" aria-label="항목명" placeholder="항목명">${first(12)}
        <select class="sel" data-f="cat" data-i="${i}" data-fk="cat:${i}" aria-label="분류">${opt(CATS, it.cat)}</select>
        ${it.on ? '' : h.badge('gray', '사용 안 함')}
        <span class="policy-r"><button type="button" class="btn sm ghost danger" data-act="del-item" data-i="${i}">항목 삭제</button></span></div>
      ${it.on ? `<div class="policy-set">
        <label class="policy-f">지급 방식<select class="sel" data-f="type" data-i="${i}" data-fk="type:${i}">${opt(Object.keys(TYPES), it.type, (k) => TYPES[k].label)}</select></label>
        <label class="policy-f">금액 통화<select class="sel" data-f="cur" data-i="${i}" data-fk="cur:${i}" ${it.type === 'class' ? 'disabled' : ''}>${it.type === 'class' ? '<option>해당 없음</option>' : opt(CURS, it.cur, (c) => `${c} (${D.curSymbol[c]})`)}</select></label>
        <label class="policy-f">단위<input class="inp" maxlength="30" value="${esc(it.unit || '')}" data-f="unit" data-i="${i}" placeholder="예: 1박 상한"></label>
        <div class="policy-f sw"><span>등급별 차등${first(13)}</span><span class="row">${h.toggle(it.byGrade, `data-act="tg-grade" data-i="${i}" data-fk="grade:${i}" aria-label="${esc(it.name)} 등급별 차등" ${g || it.byGrade ? '' : 'disabled'}`)}</span></div>
        <div class="policy-f sw"><span>지역별 차등</span><span class="row">${h.toggle(it.byRegion, `data-act="tg-region" data-i="${i}" data-fk="region:${i}" aria-label="${esc(it.name)} 지역별 차등" ${r || it.byRegion ? '' : 'disabled'}`)}</span></div>
        <label class="policy-f wide">적용 조건 (선택)<input class="inp" maxlength="80" value="${esc(it.cond || '')}" data-f="cond" data-i="${i}" placeholder="예: 출장 기간 10일 초과 시"></label>
      </div>
      ${mm.length ? `<div class="policy-warn" style="margin:0 0 8px"><span>표의 ${mm.join('·')} 구성이 이 법인의 현재 ${mm.join('·')} 기준과 다릅니다.${first(20)} 이름이 같은 행·열의 값은 유지하고, 새로 생기는 칸은 미정의로 둡니다.</span><button type="button" class="btn sm" data-act="align" data-i="${i}" data-fk="grade:${i}">현재 기준에 맞추기</button></div>` : ''}
      ${valueTable(it, { edit: true, i })}
      <div class="policy-tfoot"><span class="help">${it.type === 'class' ? '등급·기준 문구를 입력합니다(40자 이내).' : `숫자만 입력하면 ${it.cur} 금액으로 표시됩니다${first(14)}. 문자를 섞으면 입력한 그대로 안내됩니다(예: 3~4성급 또는 ¥30,000 미만).`} 비워 두면 '미정의'로 표시됩니다.${!g || !r ? ` ${!g ? '구성원 등급' : ''}${!g && !r ? '·' : ''}${!r ? '지역 그룹' : ''} 기준이 없어 해당 차등을 켤 수 없습니다.` : ''}</span>
        ${it.byRegion ? '' : `<button type="button" class="btn sm" data-act="add-col" data-i="${i}" data-fk="addcol:${i}" ${it.table.cols.length >= MAX_COLS ? 'disabled' : ''}>열 추가</button>`}</div>
      <div class="policy-kv"><label class="k" for="policy-g${i}">구성원 안내${first(15)}</label><div><textarea class="ta" id="policy-g${i}" rows="2" maxlength="300" data-f="guide" data-i="${i}" placeholder="구성원에게 함께 안내할 유의 사항을 입력해 주세요.">${esc(guide)}</textarea><div class="policy-cnt num"><span data-cnt="${i}">${guide.length}</span> / 300</div></div></div>` : ''}
    </div>`;
  }

  function editBlock(code, corp) {
    const w = S.work, isDraft = w.status === 'draft', mkOnce = {};
    const src = w.copiedFrom ? `${w.copiedFrom}에서 복사` : w.basedOn ? `${w.basedOn} 복사` : '빈 템플릿';
    const g = grades(code).length, r = regions(code).length;
    return `<div class="policy-bar"><div><div class="t">${esc(w.ver)} ${isDraft ? '개정안 편집' : '적용 예정 버전 수정'} ${stBadge(w.status)}${h.mk(11)}</div>
        <div class="s">${isDraft ? `기준: ${esc(src)} · 적용 등록 전까지 구성원에게 안내되지 않습니다.` : `적용 시작일 <span class="num">${esc(w.from)}</span> · 시작일 전까지 수정할 수 있습니다.`}${S.dirty ? ' · <span class="hl-blue">저장하지 않은 변경 있음</span>' : ''}</div></div>
      <div class="policy-acts"><button type="button" class="btn ghost" data-act="preview" data-fk="preview">구성원 안내 미리보기</button><button type="button" class="btn" data-act="cancel">${S.dirty ? '취소' : '편집 종료'}</button>${isDraft ? '<button type="button" class="btn" data-act="save-draft" data-fk="save-draft">임시 저장</button><button type="button" class="btn pri" data-act="apply" data-fk="apply">적용 등록</button>' : '<button type="button" class="btn pri" data-act="apply" data-fk="apply">변경 저장</button>'}</div></div>
      ${S.filled ? '<p class="note" style="margin:12px 0 0">샘플 데이터에 이 버전의 상세 값이 없어, 프로토타입에서는 현재 적용 버전의 값을 채워 보여줍니다.</p>' : ''}
      ${w.copiedFrom && isDraft ? `<p class="note" style="margin:12px 0 0">${esc(w.copiedFrom)}에서 복사한 규정입니다. 법인마다 구성원 등급·지역 그룹·통화가 다르므로 항목별 표 구성과 금액 통화를 확인해 주세요.</p>` : ''}
      ${corp.sample ? '<p class="note" style="margin:12px 0 0">HYB의 값은 화면 예시용 샘플이며 확정된 규정이 아닙니다.</p>' : ''}
      <p class="help" style="margin:12px 0 0">행은 구성원 등급(${g}개), 열은 지역 그룹(${r}개) 기준을 따릅니다. 등급·지역 자체를 추가·수정하려면 <button type="button" class="link" data-act="criteria">등급 · 지역 기준</button> 탭에서 변경해 주세요.</p>
      ${catGroups(w.items).map((gp) => `<div class="policy-cat"><h4 class="h3">${gp.cat} <em>${gp.items.length}</em></h4>${gp.items.map((x) => itemEdit(x.it, x.i, code, mkOnce)).join('')}</div>`).join('')}
      ${w.items.length ? '' : '<div class="empty" style="margin-top:18px"><b>등록된 항목이 없습니다</b>[항목 추가]로 규정 항목을 추가해 주세요.</div>'}
      <div class="policy-add"><span class="help">표준 항목에 없는 비용(예: 비자 발급비, 주차비)은 항목을 추가해 관리합니다.${h.mk(16)}</span><button type="button" class="btn" data-act="add-item" data-fk="add-item">항목 추가</button></div>`;
  }

  /* ---------- 동작 ---------- */
  function startEdit(code, ver) {
    const v = list(code).find((x) => x.ver === ver); if (!v) return;
    S.work = clone(v); S.filled = false;
    if (!S.work.items) { const a = h.policyState(code).active; S.work.items = a && a.items ? clone(a.items) : template(code); S.filled = true; }
    S.edit = true; S.dirty = false; S.sel = ver; App.render(); window.scrollTo(0, 0);
  }
  function createDraft(code, items, extra, logText) {
    const v = Object.assign({ ver: nextVer(code), status: 'draft', title: '', from: '', to: '', doc: '', by: D.admin, at: D.TODAY, items }, extra);
    list(code).unshift(v); App.log(code, '여비규정', `${v.ver} 임시저장 생성 — ${logText}`);
    startEdit(code, v.ver); return v;
  }
  function newRevision(code) {
    const st = h.policyState(code), base = st.active; if (!base || st.scheduled || st.draft) return;
    createDraft(code, clone(base.items), { title: base.title, basedOn: base.ver }, `${base.ver} 복사`);
    ui.toast(`${base.ver}을 복사해 임시저장 버전을 만들었습니다.`);
  }
  function commitWork(code) {
    const L = list(code), idx = L.findIndex((x) => x.ver === S.work.ver), v = clone(S.work);
    if (idx < 0) L.unshift(v); else L[idx] = v;
    return v;
  }
  function saveDraft(code, silent) {
    const bad = S.work.items.find((i) => !String(i.name).trim());
    if (bad) { ui.toast('항목명이 비어 있는 항목이 있습니다.'); return false; }
    S.work.by = D.admin; S.work.at = D.TODAY; commitWork(code); S.dirty = false;
    App.log(code, '여비규정', `${S.work.ver} 임시 저장`);
    if (!silent) { S.focus = 'save-draft'; App.render(); ui.toast('임시 저장했습니다. 적용 등록 전까지 구성원에게 안내되지 않습니다.'); }
    return true;
  }
  function exitEdit() { S.edit = false; S.work = null; S.dirty = false; S.filled = false; }
  function cancelEdit() {
    if (!S.dirty) { exitEdit(); App.render(); return; }
    ui.modal({ title: '편집을 취소할까요?', body: '<p style="margin:0">저장하지 않은 변경 내용은 사라집니다. 마지막으로 저장한 상태는 유지됩니다.</p>', actions: [{ label: '계속 편집' }, { label: '변경 내용 버리기', primary: true, onClick: () => { exitEdit(); App.render(); } }] });
  }
  function deleteVersion(code, ver) {
    const L = list(code), v = L.find((x) => x.ver === ver); if (!v || (v.status !== 'draft' && v.status !== 'scheduled')) return;
    const a = h.policyState(code).active, sched = v.status === 'scheduled';
    ui.modal({
      title: sched ? '적용 예정 버전을 삭제할까요?' : '임시저장 버전을 삭제할까요?',
      body: `<p style="margin:0">${esc(v.ver)} ${esc(v.title || '(규정명 미입력)')}</p>${sched && a ? `<div class="policy-box">현재 적용 중인 <b>${esc(a.ver)}</b>의 종료일(<span class="num">${esc(a.to)}</span>) 지정이 해제되어 계속 적용됩니다.</div>` : ''}<p class="help" style="margin:10px 0 0">삭제한 버전은 복구할 수 없으며, 삭제 사실은 변경 이력에 남습니다.</p>`,
      actions: [{ label: '취소' }, { label: '삭제', primary: true, onClick: () => {
        L.splice(L.indexOf(v), 1); if (sched && a) a.to = '';
        App.log(code, '여비규정', `${v.ver} ${sched ? '적용 예정 버전' : '임시저장 버전'} 삭제${sched && a ? ` — ${a.ver} 종료일 지정 해제` : ''}`);
        S.sel = null; exitEdit(); App.render(); ui.toast(`${v.ver}을 삭제했습니다.`);
      } }],
    });
  }

  /* 적용 등록 / 적용 예정 버전 변경 저장 모달 */
  function openApply(code) {
    const w = S.work, isDraft = w.status === 'draft', a = h.policyState(code).active;
    if (!w.items.some((i) => i.on)) { ui.toast('사용 중인 항목이 하나 이상 있어야 적용 등록할 수 있습니다.'); return; }
    if (w.items.some((i) => !String(i.name).trim())) { ui.toast('항목명이 비어 있는 항목이 있습니다.'); return; }
    const minDate = addDays(D.TODAY, 1), undef = undefCount(w.items);
    const base = w.basedOn ? list(code).find((x) => x.ver === w.basedOn) : null, df = isDraft ? diff(base, w) : null;
    const mm = w.items.filter((i) => i.on && mismatch(i, code).length).map((i) => i.name);
    let doc = w.doc || '';
    const m = ui.modal({
      title: isDraft ? `${w.ver} 적용 등록` : `${w.ver} 적용 예정 버전 변경 저장`, width: 520,
      body: `<div class="frow"><label class="lb req" for="policy-a-title">규정명</label><input class="inp" id="policy-a-title" maxlength="60" value="${esc(w.title || '')}" placeholder="예: 출장 여비 규정 (2027 개정)"></div>
        <div class="frow"><label class="lb req" for="policy-a-from">적용 시작일${h.mk(17)}</label><div><input class="inp num" id="policy-a-from" style="width:130px" maxlength="10" inputmode="numeric" placeholder="YYYY.MM.DD" value="${esc(w.from || '')}" aria-describedby="policy-a-fromh"><span class="help" id="policy-a-fromh" style="margin-left:8px">${esc(minDate)} 이후 날짜만 지정할 수 있습니다.</span></div></div>
        <div class="frow"><span class="lb">원문 문서</span><div class="row"><button type="button" class="btn sm" data-file>파일 선택</button><span class="help" data-fname>${doc ? esc(doc) : '선택된 파일 없음 (PDF, 20MB 이하)'}</span></div></div>
        <div class="frow" style="align-items:start"><label class="lb req" for="policy-a-reason">변경 사유</label><div><textarea class="ta" id="policy-a-reason" rows="2" maxlength="200" placeholder="변경 이력에 함께 기록됩니다."></textarea></div></div>
        <div class="policy-box" data-info></div>
        ${df ? `<div class="policy-box"><b>${esc(w.basedOn)} 대비 변경 ${df.length}건</b>${df.length ? `<ul>${df.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}${df.length > 6 ? `<li>외 ${df.length - 6}건</li>` : ''}</ul>` : ' — 변경된 내용이 없습니다. 같은 값으로 새 버전이 등록됩니다.'}</div>` : ''}
        ${undef ? `<p class="note" style="margin:10px 0 0">사용 중인 항목에 '미정의' 값이 ${undef}건 있습니다. 구성원 안내에는 '규정에 정해진 값 없음'으로 표시됩니다.</p>` : ''}
        ${mm.length ? `<p class="note" style="margin:6px 0 0">표 구성이 현재 등급·지역 기준과 다른 항목이 있습니다: ${esc(mm.join(', '))}</p>` : ''}
        <div class="policy-err" role="alert" data-err></div>`,
      actions: [{ label: '취소' }, { label: isDraft ? '적용 등록' : '변경 저장', primary: true, onClick: (el) => {
        const title = el.querySelector('#policy-a-title').value.trim(), from = el.querySelector('#policy-a-from').value.trim(), reason = el.querySelector('#policy-a-reason').value.trim();
        const err = (t, sel) => { el.querySelector('[data-err]').textContent = t; el.querySelector(sel).focus(); return false; };
        if (!title) return err('규정명을 입력해 주세요.', '#policy-a-title');
        if (!validDate(from)) return err('적용 시작일을 YYYY.MM.DD 형식의 올바른 날짜로 입력해 주세요.', '#policy-a-from');
        if (from < minDate) return err(`적용 시작일은 ${minDate} 이후 날짜만 지정할 수 있습니다.`, '#policy-a-from');
        if (!reason) return err('변경 사유를 입력해 주세요.', '#policy-a-reason');
        const prevFrom = w.from;
        Object.assign(S.work, { title, from, to: '', doc, status: 'scheduled', by: D.admin, at: D.TODAY, reason });
        const v = commitWork(code); let endTxt = '';
        if (a) { a.to = addDays(from, -1); endTxt = `, ${a.ver} 종료일 ${a.to} 지정`; }
        App.log(code, '여비규정', isDraft ? `${v.ver} 적용 등록 — 적용 시작일 ${from} (적용 예정)${endTxt} · 사유: ${reason}` : `${v.ver} 적용 예정 버전 수정${prevFrom !== from ? ` — 적용 시작일 ${prevFrom} → ${from}${endTxt}` : ''} · 사유: ${reason}`);
        exitEdit(); S.sel = v.ver; App.render(); window.scrollTo(0, 0);
        ui.toast(`${v.ver}이 ${from}부터 적용 예정으로 ${isDraft ? '등록' : '저장'}되었습니다.`);
      } }],
    });
    const fromEl = m.querySelector('#policy-a-from'), info = m.querySelector('[data-info]');
    const paint = () => {
      const f = fromEl.value.trim(), ok = validDate(f) && f >= minDate;
      info.innerHTML = ok
        ? `<b>${esc(w.ver)}</b>이 <b class="num">${esc(f)}</b>부터 적용 예정으로 ${isDraft ? '등록' : '저장'}됩니다.${a ? ` 현재 적용 중인 <b>${esc(a.ver)}</b>의 종료일은 시작일 전날인 <b class="num">${addDays(f, -1)}</b>로 지정됩니다.` : ' 현재 적용 중인 버전이 없어, 시작일 전까지 구성원에게는 여비규정이 안내되지 않습니다.'} 시작일 전까지는 수정·삭제할 수 있습니다.`
        : `적용 시작일을 입력하면 ${a ? `현재 적용 중인 ${esc(a.ver)}의 종료일(시작일 전날)이` : '적용 일정이'} 여기에 표시됩니다.`;
    };
    fromEl.addEventListener('input', () => { const d = fromEl.value.replace(/\D/g, '').slice(0, 8); fromEl.value = d.length > 6 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}.${d.slice(4)}` : d; paint(); });
    m.querySelector('[data-file]').onclick = () => { doc = `${code}_여비규정_${(fromEl.value.trim() || 'YYYYMMDD').replace(/\./g, '')}.pdf`; m.querySelector('[data-fname]').textContent = doc + ' (프로토타입: 파일 선택을 가정)'; };
    paint();
  }

  /* 다른 법인 규정 복사 */
  function openCopy(code) {
    const cands = D.corps.filter((c) => c.code !== code).map((c) => ({ c, a: h.policyState(c.code).active }));
    const body = `<p class="sec-desc" style="margin-bottom:6px">선택한 법인의 <b>적용 중</b> 버전을 복사해 ${esc(code)}의 임시저장 버전을 만듭니다.${h.mk(19)} 복사 후에도 원본 법인의 규정과는 연결되지 않습니다.</p>
      <div role="radiogroup" aria-label="복사할 법인">${cands.map((x, i) => `<label class="policy-pick ${x.a ? '' : 'dis'}"><input type="radio" name="policy-copy" value="${x.c.code}" ${x.a ? '' : 'disabled'} ${x.a && !cands.slice(0, i).some((y) => y.a) ? 'checked' : ''}><span><span class="n">${x.c.code} <span style="font-weight:400;color:var(--sub)">${esc(x.c.name)}</span></span><br><span class="d">${x.a ? `${esc(x.a.ver)} · ${esc(x.a.title)} · 통화 ${x.c.cur} · 등급 ${grades(x.c.code).length}개 · 지역 그룹 ${regions(x.c.code).length}개` : '적용 중인 여비규정 없음'}</span></span></label>`).join('')}</div>
      <p class="note" style="margin:12px 0 0">법인마다 구성원 등급·지역 그룹·통화가 다릅니다. 복사한 표는 원본 법인의 등급·지역 이름을 그대로 가져오므로, 편집 화면에서 항목별로 [현재 기준에 맞추기]와 금액 통화를 확인해 주세요.</p>`;
    ui.modal({ title: '다른 법인 규정 복사해 오기', width: 520, body, actions: [{ label: '취소' }, { label: '복사해서 편집', primary: true, onClick: (el) => {
      const pick = el.querySelector('input[name=policy-copy]:checked'); if (!pick) return false;
      const a = h.policyState(pick.value).active, from = `${pick.value} ${a.ver}`;
      createDraft(code, clone(a.items), { title: a.title, copiedFrom: from }, `${from}에서 복사`);
      ui.toast(`${from}을 복사했습니다. 등급·지역 기준과 통화를 확인해 주세요.`);
    } }] });
  }

  function openAddItem() {
    const m = ui.modal({ title: '항목 추가', body: `<div class="frow"><label class="lb req" for="policy-n-name">항목명</label><input class="inp" id="policy-n-name" maxlength="20" placeholder="예: 비자 발급비"></div>
      <div class="frow"><label class="lb req" for="policy-n-cat">분류</label><select class="sel" id="policy-n-cat">${CATS.map((c) => `<option ${c === '기타' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="frow"><label class="lb req" for="policy-n-type">지급 방식</label><select class="sel" id="policy-n-type">${Object.keys(TYPES).map((k) => `<option value="${k}" ${k === 'cap' ? 'selected' : ''}>${TYPES[k].label}</option>`).join('')}</select></div>
      <p class="help" style="margin:10px 0 0">등급별·지역별 차등 없이 '전체 구성원' 단일 값으로 추가됩니다. 추가 후 항목에서 변경할 수 있습니다.</p><div class="policy-err" role="alert" data-err></div>`,
      actions: [{ label: '취소' }, { label: '추가', primary: true, onClick: (el) => {
        const name = el.querySelector('#policy-n-name').value.trim(), type = el.querySelector('#policy-n-type').value;
        if (!name) { el.querySelector('[data-err]').textContent = '항목명을 입력해 주세요.'; el.querySelector('#policy-n-name').focus(); return false; }
        if (S.work.items.some((i) => i.name === name)) { el.querySelector('[data-err]').textContent = '같은 이름의 항목이 이미 있습니다.'; el.querySelector('#policy-n-name').focus(); return false; }
        S.work.items.push({ key: 'c' + Date.now(), cat: el.querySelector('#policy-n-cat').value, name, on: true, type, byGrade: false, byRegion: false, cur: type === 'class' ? null : h.corp(S.code).cur, unit: '', table: { colHead: '', cols: [TYPES[type].col], rows: [{ label: ALL, cells: [null] }] }, cond: '', guide: '' });
        touch(); S.focus = 'add-item'; App.render(); ui.toast(`'${name}' 항목을 추가했습니다.`);
      } }] });
    return m;
  }

  /* 구성원 안내 미리보기 */
  function openPreview(code) {
    const v = S.edit ? S.work : list(code).find((x) => x.ver === S.sel); if (!v || !v.items) return;
    const gs = grades(code); if (!S.pvGrade || !gs.some((g) => g.name === S.pvGrade)) { const d = gs.find((g) => g.isDefault) || gs[0]; S.pvGrade = d ? d.name : null; }
    const content = () => {
      const items = v.items.filter((i) => i.on);
      const one = (it) => {
        const row = it.byGrade ? it.table.rows.find((r) => r.label === S.pvGrade) : it.table.rows[0];
        const vals = row ? it.table.cols.map((c, ci) => ({ c, v: row.cells[ci] })) : [];
        const val = (x) => (x.v == null ? '<b class="u">규정에 정해진 값 없음</b>' : `<b class="num">${esc(cellText(x.v, it))}</b>`);
        return `<div class="policy-pvi"><div class="hd"><b>${esc(it.name)}</b><span>${esc(TYPES[it.type].label)}${it.unit ? ` · ${esc(it.unit)}` : ''}${it.cond ? ` · ${esc(it.cond)}` : ''}</span></div>
          ${!row ? '<div class="policy-pvg">이 등급에 해당하는 값이 없습니다(표의 등급 구성이 현재 기준과 다름).</div>' : `<div class="policy-pvl ${vals.length === 1 ? 'one' : ''}">${vals.map((x) => `<div><span>${esc(vals.length === 1 && !it.table.colHead ? x.c : x.c)}</span>${val(x)}</div>`).join('')}</div>`}
          ${it.guide ? `<div class="policy-pvg">${esc(it.guide)}</div>` : ''}</div>`;
      };
      return `<div class="policy-pv">${CATS.map((c) => { const xs = items.filter((i) => i.cat === c); return xs.length ? `<h5>${c}</h5>${xs.map(one).join('')}` : ''; }).join('')}${items.length ? '' : '<div class="empty" style="margin-top:12px"><b>사용 중인 항목이 없습니다</b></div>'}</div>`;
    };
    const seg = () => (gs.length ? `<div class="policy-seg" role="group" aria-label="구성원 등급">${gs.map((g) => `<button type="button" data-g="${esc(g.name)}" aria-pressed="${g.name === S.pvGrade}">${esc(g.name)}</button>`).join('')}</div>` : '<span class="help">등록된 구성원 등급이 없어 전체 구성원 기준으로 표시합니다.</span>');
    const body = () => `<p class="sec-desc" style="margin-bottom:10px">${esc(code)} ${esc(v.ver)} ${stBadge(v.status)} 기준으로, 선택한 등급의 구성원에게 안내될 값만 모아 보여줍니다. 실제 구성원 화면의 노출 위치와 디자인은 확정 전입니다.</p>
      <div class="row wrap"><span style="font-size:11px;color:var(--sub)">구성원 등급</span>${seg()}</div><div data-pv>${content()}</div>`;
    const m = ui.modal({ title: '구성원 안내 미리보기', width: 600, body: body(), actions: [{ label: '닫기', primary: true }] });
    m.querySelector('.mb').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      S.pvGrade = b.dataset.g; m.querySelectorAll('[data-g]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); m.querySelector('[data-pv]').innerHTML = content();
    });
    const f = m.querySelector('[data-g][aria-pressed="true"]'); if (f) f.focus();
  }

  /* 편집 중 이탈(다른 법인·탭) 가드 — 셸의 클릭 처리보다 먼저 가로챈다 */
  function guardNav(corp, tab) {
    const isDraft = S.work.status === 'draft', go = () => { exitEdit(); App.go(corp, tab); };
    const acts = [{ label: '계속 편집' }, { label: '저장하지 않고 이동', onClick: go }];
    if (isDraft) acts.push({ label: '임시 저장 후 이동', primary: true, onClick: () => { if (saveDraft(S.code, true) === false) return false; go(); } });
    ui.modal({ title: '저장하지 않은 변경이 있습니다', body: `<p style="margin:0">${esc(S.work.ver)} 편집 내용이 아직 저장되지 않았습니다.${h.mk(21)} ${isDraft ? '임시 저장하고 이동하거나, 변경 내용을 버리고 이동할 수 있습니다.' : '적용 예정 버전의 변경은 [변경 저장]에서 사유를 입력해야 저장됩니다. 이동하면 변경 내용이 사라집니다.'}</p>`, actions: acts });
  }
  document.addEventListener('click', (e) => {
    if (!(S.edit && S.dirty) || App.state.corp !== S.code || App.state.tab !== 'policy') return;
    const b = e.target.closest('#corp-side [data-corp], #view .subtabs [data-tab]'); if (!b) return;
    if (b.dataset.corp ? b.dataset.corp === S.code : b.dataset.tab === 'policy') return;
    e.stopPropagation(); e.preventDefault();
    guardNav(b.dataset.corp || null, b.dataset.tab || null);
  }, true);
  function goCriteria() { if (S.edit && S.dirty) guardNav(null, 'criteria'); else App.go(null, 'criteria'); }

  /* ---------- 뷰 ---------- */
  App.views.policy = {
    render(ctx) {
      if (S.code !== ctx.code) S = fresh(ctx.code);
      const code = ctx.code, L = list(code);
      if (S.edit && S.work) return editBlock(code, ctx.corp);
      if (!L.length) return emptyBlock(code, ctx.corp);
      if (!L.some((v) => v.ver === S.sel)) { const st = h.policyState(code); S.sel = (st.active || st.scheduled || st.draft || L[0]).ver; }
      return versionsBlock(code) + selectedBlock(code, ctx.corp);
    },

    mount(root, ctx) {
      const code = ctx.code;
      if (S.focus) { const f = root.querySelector(`[data-fk="${S.focus}"]`); if (f) f.focus({ preventScroll: true }); S.focus = null; }
      const item = (el) => S.work.items[Number(el.dataset.i)];

      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) {
          const tr = e.target.closest('tr[data-row]');
          if (tr && !e.target.closest('input,button') && S.sel !== tr.dataset.row) { S.sel = tr.dataset.row; S.focus = 'ver:' + S.sel; App.render(); }
          return;
        }
        if (b.disabled) return;
        const act = b.dataset.act;
        if (act === 'doc') return ui.toast(`원문 문서를 새 창에서 엽니다 — ${b.dataset.doc}`);
        if (act === 'criteria') return goCriteria();
        if (act === 'open') { S.open[b.dataset.k] = !S.open[b.dataset.k]; return rerender(b); }
        if (act === 'preview') return openPreview(code);
        if (act === 'new-rev') return newRevision(code);
        if (act === 'edit-ver') return startEdit(code, b.dataset.ver);
        if (act === 'del-ver') return deleteVersion(code, b.dataset.ver);
        if (act === 'reg-blank') { createDraft(code, template(code), {}, '표준 항목 템플릿'); return ui.toast('표준 항목으로 임시저장 버전을 만들었습니다.'); }
        if (act === 'reg-copy') return openCopy(code);
        if (!S.edit) return;
        if (act === 'cancel') return cancelEdit();
        if (act === 'save-draft') return saveDraft(code);
        if (act === 'apply') return openApply(code);
        if (act === 'add-item') return openAddItem();
        const it = item(b); if (!it) return;
        if (act === 'tg-on') { it.on = !it.on; touch(); return rerender(b); }
        if (act === 'tg-grade' || act === 'tg-region') {
          const g = act === 'tg-grade', cur = g ? it.byGrade : it.byRegion, fn = g ? setGrade : setRegion;
          const run = () => { fn(it, code, !cur); touch(); rerender(b); };
          if (cur && (g ? rowsDiffer(it) : colsDiffer(it))) {
            const def = (g ? grades(code) : regions(code)).find((x) => x.isDefault);
            ui.modal({ title: `${g ? '등급별' : '지역별'} 차등을 끌까요?`, body: `<p style="margin:0">${esc(it.name)} 항목의 ${g ? '등급' : '지역'}별 값이 하나로 합쳐집니다. ${def ? `기본 ${g ? '등급' : '지역 그룹'}(<b>${esc(def.name)}</b>)의 값만 남고` : `마지막 ${g ? '행' : '열'}의 값만 남고`} 나머지 값은 삭제됩니다.</p>`, actions: [{ label: '취소' }, { label: '차등 끄기', primary: true, onClick: run }] });
          } else run();
          return;
        }
        if (act === 'align') { align(it, code); touch(); return rerender(b); }
        if (act === 'add-col') { if (it.table.cols.length >= MAX_COLS) return; it.table.cols.push(`구분 ${it.table.cols.length + 1}`); it.table.rows.forEach((r) => r.cells.push(null)); touch(); return rerender(b); }
        if (act === 'del-col') { const c = Number(b.dataset.c); if (it.table.cols.length < 2) return; it.table.cols.splice(c, 1); it.table.rows.forEach((r) => r.cells.splice(c, 1)); if (it.table.cols.length === 1) it.table.colHead = ''; touch(); return rerender(b); }
        if (act === 'del-item') {
          ui.modal({ title: '항목을 삭제할까요?', body: `<p style="margin:0"><b>${esc(it.name)}</b> 항목과 입력한 값·안내 문구가 이 개정 버전에서 삭제됩니다. 잠시 쓰지 않는 항목이라면 삭제 대신 사용 여부를 꺼 두는 것을 권장합니다.</p>`, actions: [{ label: '취소' }, { label: '삭제', primary: true, onClick: () => { S.work.items.splice(S.work.items.indexOf(it), 1); touch(); S.focus = 'add-item'; App.render(); } }] });
        }
      });

      root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'policy-ver') { S.sel = t.value; return rerender(t); }
        if (!S.edit) return;
        if (t.dataset.cell) { const p = t.dataset.cell.split(':').map(Number), it = S.work.items[p[0]]; const v = parseCell(t.value, it.type); t.value = cellInput(v); t.classList.toggle('l', it.type === 'class' || typeof v === 'string'); return; }
        const f = t.dataset.f; if (!f || t.tagName !== 'SELECT') return;
        const it = item(t);
        if (f === 'cat') it.cat = t.value;
        if (f === 'cur') it.cur = t.value;
        if (f === 'type') {
          const old = it.type; it.type = t.value;
          if (it.type === 'class') { it.cur = null; it.table.rows.forEach((r) => { r.cells = r.cells.map((c) => (isNum(c) ? String(c) : c)); }); }
          else { if (!it.cur) it.cur = h.corp(code).cur; it.table.rows.forEach((r) => { r.cells = r.cells.map((c) => (c == null ? null : parseCell(c, it.type))); }); }
          if (!it.byRegion && it.table.cols.length === 1 && it.table.cols[0] === TYPES[old].col) it.table.cols[0] = TYPES[it.type].col;
        }
        touch(); rerender(t);
      });

      root.addEventListener('input', (e) => {
        const t = e.target; if (!S.edit) return;
        const wasDirty = S.dirty;
        if (t.dataset.cell) { const p = t.dataset.cell.split(':').map(Number), it = S.work.items[p[0]]; it.table.rows[p[1]].cells[p[2]] = parseCell(t.value, it.type); touch(); }
        else if (t.dataset.col) { const p = t.dataset.col.split(':').map(Number); S.work.items[p[0]].table.cols[p[1]] = t.value; touch(); }
        else if (t.dataset.f && t.tagName !== 'SELECT') {
          const it = item(t), f = t.dataset.f;
          if (f === 'colHead') it.table.colHead = t.value; else it[f] = t.value;
          if (f === 'guide') { const c = root.querySelector(`[data-cnt="${t.dataset.i}"]`); if (c) c.textContent = t.value.length; }
          touch();
        }
        /* 입력 중에는 다시 그리지 않는다(포커스 유지). 최초 변경 시에만 편집 바의 '저장하지 않은 변경' 표시를 갱신 */
        if (!wasDirty && S.dirty) { const s = root.querySelector('.policy-bar .s'); if (s && !s.querySelector('.hl-blue')) s.insertAdjacentHTML('beforeend', ' · <span class="hl-blue">저장하지 않은 변경 있음</span>'); const c = root.querySelector('[data-act="cancel"]'); if (c) c.textContent = '취소'; }
      });
    },

    desc(ctx) {
      const code = ctx.code, tomorrow = addDays(D.TODAY, 1);
      return {
        title: '여비규정',
        summary: `${code} 법인의 여비규정을 개정 버전 단위로 등록·개정하고 적용 시작일을 예약한다. 구성원 안내용 기준 정보이며 검증·차단에는 쓰지 않는다.`,
        items: [
          { no: 1, title: '현재 적용 요약', body: '상태가 <code>적용 중</code>인 버전 1건의 버전 번호, 규정명, 적용 기간, 원문 문서, 등록자·등록일, 복사 원본(있을 때만)을 보여준다.<ul><li>종료일이 없으면 <code>(종료일 미정)</code>으로 표기한다. 적용 예정 버전이 등록되면 종료일이 자동 지정된다.</li><li>원문 문서 파일명을 누르면 첨부 파일을 새 창으로 연다(프로토타입은 토스트).</li><li>적용 중 버전이 없고 적용 예정·임시저장만 있으면 "현재 적용 중인 여비규정이 없습니다"와 다음 단계를 안내한다.</li></ul>' },
          { no: 2, title: '적용 예정 안내', body: '<code>적용 예정</code> 버전이 있을 때만 노출한다. "YYYY.MM.DD부터 vN 적용 예정", 규정명, 현재 적용 버전의 종료일(시작일 전날)을 한 줄로 안내한다. 적용 예정 버전이 없으면 영역 자체를 숨긴다.' },
          { no: 3, title: '개정 버전 목록', body: '법인의 모든 개정 버전을 최신순으로 나열한다. 컬럼: 선택, 버전, 상태, 규정명(복사 원본 병기), 적용 기간, 원문 문서, 등록자, 등록일.<ul><li>상태 배지: <code>적용 중</code>(초록) / <code>적용 예정</code>(파랑) / <code>임시저장</code>(회색) / <code>종료</code>(외곽선).</li><li>행 또는 라디오를 선택하면 아래 [규정 항목] 영역이 해당 버전 값으로 바뀐다. 기본 선택: 적용 중 → 적용 예정 → 임시저장 순으로 첫 번째.</li><li>임시저장 버전의 적용 기간은 <code>미지정</code>으로 표기한다.</li><li>키보드: 라디오 그룹으로 방향키 이동·선택.</li><li>페이지네이션 없음(버전 수가 적다는 전제).</li></ul>' },
          { no: 4, title: '[새 개정 등록]', body: '현재 적용 중 버전을 통째로 복사해 <code>임시저장</code> 버전(다음 버전 번호)을 만들고 곧바로 편집 화면으로 이동한다.<ul><li>임시저장 버전이 이미 있으면 버튼이 <code>임시저장 vN 이어서 편집</code>으로 바뀐다(법인당 임시저장 1개).</li><li>적용 예정 버전이 있으면 비활성화하고 사유를 버튼 아래에 안내한다(프로토타입 가정 — 확인 필요 사항 참고).</li><li>버전 번호는 법인별 순번(v1, v2 …)으로 자동 부여하며 수정할 수 없다. 삭제된 번호는 다시 쓰지 않는 것을 권장한다(프로토타입은 최대 번호 + 1).</li></ul>' },
          { no: 5, title: '[구성원 안내 미리보기]', body: '선택한 버전(편집 중이면 편집 중인 내용)을 구성원 등급별로 요약해 보여주는 모달.<ul><li>등급 선택 버튼: 법인의 구성원 등급 목록. 기본값은 기본 등급.</li><li>사용 중인 항목만 분류별로 노출. 등급별 차등 항목은 선택 등급의 행만, 그 외에는 전체 구성원 행을 보여준다.</li><li>미정의 값은 <code>규정에 정해진 값 없음</code>으로 표기한다.</li><li>상세 값이 없는 버전(샘플 생략)에서는 버튼을 숨긴다.</li></ul>' },
          { no: 6, title: '선택 버전 헤더 · 버전별 액션', body: '선택한 버전의 상태, 적용 기간, 사용 항목 수, 금액 통화, 등급·지역 기준 수를 보여준다. [등급 · 지역 기준 보기]는 같은 법인의 등급 · 지역 기준 탭으로 이동한다.<ul><li><b>적용 중 · 종료</b>: 조회 전용. 수정·삭제 버튼 없음.</li><li><b>적용 예정</b>: [수정] [삭제]. 적용 시작일 전날까지만 가능하다.</li><li><b>임시저장</b>: [이어서 편집] [삭제].</li><li>삭제는 확인 모달을 거친다. 적용 예정 버전을 삭제하면 현재 적용 버전의 종료일 지정이 해제된다.</li><li>상세 값이 없는 버전(샘플 데이터 한정)은 값 영역에 그 사실을 안내한다.</li></ul>' },
          { no: 7, title: '규정 항목 (조회)', body: '분류(교통 → 숙박 → 일비·식비 → 기타) 순으로 항목을 나열한다. 항목마다 항목명, 지급 방식 배지, 차등 기준 배지, 단위·통화, 적용 조건(있을 때만), 값 표, 구성원 안내 문구를 보여준다.<ul><li>지급 방식: <code>등급 기준</code>(좌석·차량 등급 등 문구) / <code>한도 내 실비</code>(상한 금액) / <code>정액 지급</code> / <code>실비</code>(한도 없음).</li><li>차등 기준: <code>등급별 차등</code>, <code>지역별 차등</code>, 둘 다 없으면 <code>차등 없음</code>.</li><li>안내 문구가 없으면 "등록된 안내 문구 없음"을 흐리게 표기한다.</li></ul>' },
          { no: 8, title: '값 표', body: '행 = 구성원 등급(등급별 차등이 아니면 <code>전체 구성원</code> 1행), 열 = 지역 그룹(지역별 차등) 또는 조건 열(예: 비행 시간 5시간 미만/이상).<ul><li>숫자 값은 항목 통화 기호 + 천 단위 구분(예: US$600, ¥5,000)으로 우측 정렬, 문구 값은 입력 그대로 좌측 정렬.</li><li>열이 많아 영역 폭을 넘으면 표 안에서만 가로 스크롤하고 행 머리(등급)는 좌측에 고정한다. 페이지 전체 가로 스크롤은 생기지 않아야 한다.</li><li>열이 2개 이하이고 지역별 차등이 아니면 표를 내용 폭으로 좁혀 보여준다.</li></ul>' },
          { no: 9, title: '미정의 값', body: '규정 문서에 값이 없는 칸(예: HBJ 식비의 그 외 지역)은 주황 배경의 <code>미정의</code>로 표시한다. 0과는 다른 상태이며, 구성원 안내에는 "규정에 정해진 값 없음"으로 나간다. 적용 등록 시 미정의 건수를 경고하되 등록을 막지는 않는다.' },
          { no: 10, title: '사용 안 함 항목', body: '사용 여부가 OFF인 항목은 한 줄로 접어 흐리게 보여주고 <code>사용 안 함</code> 배지를 붙인다. [펼치기]로 값을 확인할 수 있다(기본 접힘, 화면을 벗어나면 다시 접힘). 사용 안 함 항목은 구성원 안내에 노출하지 않는다.' },
          { no: 11, title: '편집 바 (편집 모드)', body: '임시저장·적용 예정 버전을 편집할 때 상단에 고정된다. 편집 중에는 버전 목록을 숨긴다.<ul><li><b>임시저장 편집</b>: [취소] [임시 저장] [적용 등록]. 임시 저장은 값만 저장하고 편집 화면에 머문다.</li><li><b>적용 예정 수정</b>: [취소] [변경 저장]. 변경 저장은 적용 등록과 같은 모달(사유 필수)을 거친다.</li><li>변경이 생기면 "저장하지 않은 변경 있음"을 표시하고, [취소] 시 확인 모달을 띄운다. 변경이 없으면 [편집 종료]로 바로 조회 화면으로 돌아간다.</li><li>검증: 항목명 공백 불가, 적용 등록은 사용 중 항목 1개 이상 필요.</li></ul>' },
          { no: 12, title: '항목 기본 설정 (편집 모드)', body: '<ul><li><b>사용 여부</b> 토글: OFF로 바꾸면 항목이 접히고 값은 보존된다.</li><li><b>항목명</b>: 필수, 20자 이내, 같은 버전 안에서 중복 불가.</li><li><b>분류</b>: 교통 / 숙박 / 일비·식비 / 기타. 변경 시 해당 분류 그룹으로 이동한다.</li><li><b>지급 방식</b>: 등급 기준 / 한도 내 실비 / 정액 지급 / 실비. 등급 기준으로 바꾸면 통화는 해당 없음이 되고 숫자 값은 문구로 바뀐다.</li><li><b>금액 통화</b>: KRW/USD/JPY/CNY/INR 중 1개. 기본값은 법인 기준 통화. 항목 단위로 지정한다.</li><li><b>단위</b>: 30자 이내 자유 입력(예: 1박 상한 (세금 포함)).</li><li><b>적용 조건</b>: 선택, 80자 이내.</li></ul>' },
          { no: 13, title: '등급별 · 지역별 차등 전환 (편집 모드)', body: '<ul><li><b>등급별 차등 ON</b>: 행이 법인의 구성원 등급으로 바뀌고, 기존 전체 구성원 값이 모든 등급에 복사된다.</li><li><b>지역별 차등 ON</b>: 열이 법인의 지역 그룹으로 바뀌고, 기존 첫 열 값이 모든 지역에 복사된다. 조건 열은 사라진다.</li><li><b>OFF</b>: 기본 등급(또는 기본 지역 그룹)의 값만 남긴다. 등급·지역별 값이 서로 다르면 확인 모달을 먼저 띄운다.</li><li>법인에 등급(또는 지역 그룹)이 0개면 해당 토글을 비활성화하고 사유를 표 아래에 안내한다.</li><li>지역별 차등이 아닐 때는 조건 열을 직접 구성한다: 열 이름 20자, 열 구분명 30자, 최대 6열, 최소 1열.</li><li>등급·지역 자체의 추가·수정은 이 화면에서 하지 않고 [등급 · 지역 기준] 탭으로 보낸다.</li></ul>' },
          { no: 14, title: '값 입력 (편집 모드)', body: '칸마다 40자 이내 입력.<ul><li><b>숫자만 입력</b>(쉼표 허용, 정수 9자리·소수 2자리까지): 금액으로 저장하고 포커스를 벗어나면 천 단위 구분으로 정리한다. 표시는 항목 통화 기호를 붙인다.</li><li><b>문자를 포함</b>: 문구로 저장하고 입력한 그대로 안내한다(예: 3~4성급 또는 ¥30,000 미만, ₩60,000).</li><li><b>비움</b>: 미정의.</li><li>지급 방식이 등급 기준이면 숫자를 넣어도 문구로 취급한다.</li><li>음수·수식은 숫자로 인정하지 않는다(문구로 저장됨).</li></ul>' },
          { no: 15, title: '구성원 안내 문구 (편집 모드)', body: '항목별 유의 사항. 선택 입력, 300자 이내, 줄바꿈 허용, 글자 수 카운터 표시. 서식(굵게·링크)은 지원하지 않는다.' },
          { no: 16, title: '항목 추가 · 삭제 (편집 모드)', body: '<ul><li><b>[항목 추가]</b>: 항목명(필수, 20자, 중복 불가)·분류·지급 방식을 받아 차등 없는 전체 구성원 1칸짜리 항목으로 추가한다. 기본값: 분류 기타, 지급 방식 한도 내 실비, 사용 ON, 통화 법인 기준 통화.</li><li><b>[항목 삭제]</b>: 확인 모달 후 이 개정 버전에서만 제거한다. 이전 버전의 같은 항목에는 영향이 없다.</li><li>항목 순서는 분류 순 → 등록 순이며 순서 변경 기능은 제공하지 않는다.</li></ul>' },
          { no: 17, title: '적용 등록 모달', body: `<ul><li><b>규정명</b>: 필수, 60자 이내. 기준 버전의 규정명을 기본값으로 채운다.</li><li><b>적용 시작일</b>: 필수, <code>YYYY.MM.DD</code>. 숫자만 입력하면 구분점을 자동으로 넣는다. 등록일 다음 날(${tomorrow}) 이후만 허용하고, 형식 오류·과거 날짜는 모달 하단에 오류 문구를 표시한다. 실제 구현은 공통 날짜 선택 컴포넌트를 쓴다.</li><li><b>원문 문서</b>: 선택, PDF 1개(프로토타입은 파일 선택을 가정해 파일명만 채운다).</li><li><b>변경 사유</b>: 필수, 200자 이내. 변경 이력에 함께 기록한다.</li><li>시작일을 넣으면 "현재 적용 중 vN의 종료일은 시작일 전날로 지정됩니다"를 즉시 계산해 보여준다.</li><li>기준 버전 대비 변경 요약(항목 추가·삭제, 값 변경 건수 등)과 미정의 건수, 기준 불일치 항목을 함께 보여준다.</li><li>등록하면 상태가 <code>적용 예정</code>이 되고 조회 화면으로 돌아간다.</li></ul>` },
          { no: 18, title: '미등록 법인 (빈 상태)', body: '버전이 0개인 법인에 노출한다.<ul><li><b>[여비규정 등록]</b>: 표준 항목 세트(항공·철도·렌터카·숙박·식비·출장 수당·세탁비·통신비)로 임시저장 v1을 만들고 편집 화면으로 이동한다. 값은 모두 미정의로 시작한다.</li><li><b>[다른 법인 규정 복사해 오기]</b>: 법인 선택 모달을 연다.</li><li><b>등록 순서</b>: 구성원 등급·지역 그룹 등록 여부를 배지로 보여준다. 둘 중 하나라도 없으면 [등급 · 지역 기준 등록]을 주 버튼으로 강조해 먼저 유도한다. 기준 없이도 등록은 가능하며, 이 경우 모든 항목이 전체 구성원 단일 값으로 시작한다.</li></ul>' },
          { no: 19, title: '다른 법인 규정 복사 모달', body: '자기 법인을 제외한 전 법인을 나열하고 1개를 선택한다. 적용 중 버전이 없는 법인은 선택할 수 없다.<ul><li>선택한 법인의 적용 중 버전(항목·값·안내 문구)을 복사해 임시저장 버전을 만들고 <code>복사 원본</code>(예: HBA v4)을 기록한다.</li><li>복사는 1회성이며 이후 원본이 개정돼도 반영되지 않는다.</li><li>표의 행·열은 원본 법인의 등급·지역 이름 그대로 복사되므로, 편집 화면에서 기준 불일치 경고가 뜬다.</li></ul>' },
          { no: 20, title: '기준 불일치 경고', body: '항목 표의 행(등급)·열(지역)이 법인의 현재 등급·지역 기준과 이름 또는 순서가 다를 때, 임시저장·적용 예정 버전에 한해 노출한다.<ul><li><b>[현재 기준에 맞추기]</b>(편집 모드): 이름이 같은 행·열의 값은 유지하고, 새로 생기는 칸은 미정의로 채우며, 기준에 없는 행·열은 제거한다.</li><li>법인에 기준이 0개면 해당 차등을 끄고 단일 값으로 바꾼다.</li><li>적용 중·적용 예정 버전은 기준 변경이 즉시 반영되므로 불일치가 생기지 않는다(적용 예정 버전의 경고는 편집 중 작업본에만 해당). 종료 버전은 등록 당시 표를 그대로 보여주고 경고하지 않는다.</li></ul>' },
          { no: 21, title: '편집 중 이탈 확인', body: '저장하지 않은 변경이 있는 상태에서 다른 법인·다른 탭으로 이동하려 하면 확인 모달을 띄운다.<ul><li>임시저장 편집: [계속 편집] [저장하지 않고 이동] [임시 저장 후 이동].</li><li>적용 예정 수정: [계속 편집] [저장하지 않고 이동] (사유 입력이 필요해 자동 저장하지 않는다).</li><li>변경이 없으면 확인 없이 이동한다. 같은 법인의 다른 탭에 다녀오면 편집 화면이 유지되고, 법인을 바꾸면 화면 상태(선택 버전·편집 모드)를 초기화한다.</li><li>브라우저 새로고침·창 닫기 시의 이탈 확인은 실제 구현에서 추가한다.</li></ul>' },
        ],
        policies: [
          '여비규정은 <b>기준 정보 관리 + 구성원 안내용</b>이다. 출장 계획서·기안의 자동 검증·차단, 규정 예외 신청과 연동하지 않는다.',
          '상태 전이: <code>임시저장</code> → (적용 등록) → <code>적용 예정</code> → (적용 시작일 도래) → <code>적용 중</code> → (다음 버전 적용 시작) → <code>종료</code>. 적용 예정 → 적용 중, 적용 중 → 종료 전환은 시작일에 시스템이 자동 처리한다.',
          '적용 중·종료 버전은 수정·삭제할 수 없다. 값 변경은 항상 [새 개정 등록]으로 새 버전을 만든다. 단, [등급 · 지역 기준] 탭에서 등급·지역 그룹을 바꾸면 적용 중·적용 예정 버전의 표 행·열에 <b>즉시 반영</b>된다(이름 변경은 값 유지, 추가는 <code>미정의</code> 칸 생성, 삭제는 행·열과 값 삭제).',
          '규정을 공유하는 법인(예: HBA·HBL)도 법인별로 각각 등록한다. [다른 법인 규정 복사해 오기]는 <b>1회성 복사</b>이며 법인 간 규정 연결(동시 개정)은 제공하지 않는다. 원본이 개정되면 각 법인에서 다시 개정 등록한다.',
          '적용 예정 버전은 적용 시작일 전까지 수정·삭제할 수 있다. 등록 시 기존 적용 중 버전의 종료일은 시작일 전날로 자동 지정되고, 삭제 시 해제된다.',
          '법인당 적용 중 버전은 항상 1개 이하다. 적용 기간은 버전 간에 겹치거나 비지 않는다.',
          '생성·임시 저장·적용 등록·수정·삭제는 모두 변경 이력(분류: 여비규정)에 일시·처리자와 함께 남긴다.',
          '본사(HYB) 출장 관리자만 전 법인의 여비규정을 관리한다.',
          '표의 행·열은 법인의 구성원 등급·지역 그룹 기준을 따른다. 등급·지역 자체의 관리는 [등급 · 지역 기준] 탭 소관이다.',
          'HYB의 값은 화면 예시용 샘플이며 확정 규정이 아니다. HBA·HBL·HBJ는 유첨 규정 문서 기준 샘플이다.',
        ],
        issues: [
          '<b>항목 안에 통화가 섞이는 경우</b> — HBJ 식비(¥ / ₩ / US$)처럼 지역마다 통화가 다른 규정이 있다. 현재는 항목당 통화 1개 + 예외 칸은 문구 입력으로 처리했다. 칸(또는 열) 단위 통화 지정을 지원할지 결정이 필요하다.',
          '<b>적용 예정 버전의 동시 개수</b> — 프로토타입은 법인당 적용 예정 1개·임시저장 1개로 제한했다. 여러 개의 예정 버전을 허용할지 확인이 필요하다.',
          '<b>적용 시작일 범위</b> — 프로토타입은 등록일 다음 날 이후만 허용했다. 당일 즉시 적용, 최초 등록 법인의 즉시 적용, 과거 날짜 소급 등록(이미 시행 중인 규정을 뒤늦게 등록)을 허용할지 확인이 필요하다. 전환 기준 시각(법인 현지 0시 / 한국 시간)도 미정이다.',
          '<b>구성원 안내 노출 위치·형태</b> — 출장 계획서, 기안 화면, 별도 안내 페이지 중 어디에 어떤 형태로 보여줄지 미정이다. 미리보기 모달은 내용 확인용 가안이다.',
          '<b>다국어 표기</b> — 항목명·안내 문구·등급·지역 이름을 영어·일본어로 함께 등록할지, 법인 언어 하나로만 등록할지 미정이다.',
          '<b>과거 버전 보존 범위</b> — 종료 버전의 값·원문 문서 보존 기간, 삭제된 임시저장·적용 예정 버전의 내용을 이력에 남길지(현재는 삭제 사실만 기록) 확인이 필요하다.',
          '<b>원문 문서 첨부</b> — 필수 여부, 허용 형식·용량, 복수 첨부(국문·영문본) 여부가 미정이다. 프로토타입은 선택·PDF 1개로 가정했다.',
          '<b>값 변경 이력의 상세 수준</b> — 변경 이력에 칸 단위 변경 전·후 값을 남길지, 버전 단위 이벤트만 남길지 확인이 필요하다.',
          '<b>진행 중인 출장의 기준 버전</b> — 버전 전환 시점에 걸친 출장(신청은 이전 버전, 출장일은 새 버전)에 어느 버전을 안내할지 미정이다.',
        ],
      };
    },
  };
})();
