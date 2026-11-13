/* 등급 · 지역 기준 (TRIP-ADM-CORP-04) — 법인별 구성원 등급 / 개인 예외 지정 / 지역 그룹 */
(function () {
  const App = window.App, D = App.D, h = App.h, ui = App.ui, esc = h.esc;

  const LIM = { gname: 20, gdesc: 60, rname: 30, reason: 100 };
  const SOON_DAYS = 30;
  const CAT_G = '구성원 등급', CAT_R = '지역 그룹';

  /* 인사정보 직급/직책 샘플: 현재 등급에 매핑된 값 + 아래 미매핑 값 */
  const EXTRA_HR = {
    HBA: ['Associate', 'Intern'], HBL: ['Coordinator'], HBJ: ['契約社員', 'アルバイト'], HYB: ['인턴'],
    HBC: ['General Manager', 'Director', 'Manager', 'Staff'], HBI: ['Country Head', 'Director', 'Manager', 'Staff'],
  };
  /* 출장지 관리 마스터 샘플 (국가 > 도시/지역) */
  const PLACES = [
    ['대한민국', ['서울', '경기도', '인천', '부산', '제주도']], ['일본', ['도쿄', '오사카', '후쿠오카', '나고야', '삿포로']],
    ['미국', ['뉴욕', 'LA', '보스턴', '시카고', '샌프란시스코', '마이애미', '워싱턴 DC', '라스베이거스']],
    ['멕시코', ['멕시코시티']], ['콜롬비아', ['보고타']], ['캐나다', ['토론토', '밴쿠버']], ['브라질', ['상파울루']],
    ['영국', ['런던']], ['프랑스', ['파리']], ['독일', ['베를린']], ['스페인', ['마드리드']], ['이탈리아', ['밀라노']],
    ['중국', ['베이징', '상하이']], ['인도', ['뭄바이', '델리']], ['대만', ['타이베이']], ['홍콩', []], ['마카오', []],
    ['태국', ['방콕']], ['싱가포르', []], ['인도네시아', ['자카르타']], ['말레이시아', ['쿠알라룸푸르']], ['베트남', ['호치민', '하노이']], ['필리핀', ['마닐라']],
  ];

  /* ---------- 뷰 상태 (법인이 바뀌면 초기화) ---------- */
  let st = { code: null, exFilter: 'all', focus: null };
  const hrCache = {};

  /* ---------- 데이터 헬퍼 ---------- */
  const gradesOf = (code) => D.grades[code] || (D.grades[code] = []);
  const regionsOf = (code) => D.regions[code] || (D.regions[code] = []);
  const excOf = (code) => D.gradeExceptions[code] || (D.gradeExceptions[code] = []);
  const gradeById = (code, id) => gradesOf(code).find((g) => g.id === id) || null;
  const defaultGrade = (code) => gradesOf(code).find((g) => g.isDefault) || null;
  const mappedGrade = (code, title) => gradesOf(code).find((g) => g.hr.includes(title)) || defaultGrade(code);
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const newId = (list, p) => { let n = list.length + 1; while (list.some((x) => x.id === p + n)) n++; return p + n; };
  const toInput = (s) => (s ? s.replace(/\./g, '-') : '');
  const fromInput = (s) => (s ? s.replace(/-/g, '.') : '');
  const dayDiff = (a, b) => Math.round((new Date(toInput(b)) - new Date(toInput(a))) / 86400000);

  function hrTitles(code) {
    if (!hrCache[code]) {
      const set = [];
      const add = (t) => { if (t && !set.includes(t)) set.push(t); };
      gradesOf(code).forEach((g) => g.hr.forEach(add));
      (EXTRA_HR[code] || []).forEach(add);
      hrCache[code] = set;
    }
    return hrCache[code];
  }
  const unmappedTitles = (code) => hrTitles(code).filter((t) => !gradesOf(code).some((g) => g.hr.includes(t)));

  function excStatus(x) {
    if (x.start > D.TODAY) return { key: 'scheduled', badge: h.badge('blue', '예정') };
    if (x.end && x.end < D.TODAY) return { key: 'ended', badge: h.badge('gray', '만료') };
    const left = x.end ? dayDiff(D.TODAY, x.end) : null;
    return { key: 'active', badge: h.badge('green', '적용 중') + (left != null && left <= SOON_DAYS ? ' ' + h.badge('orange', '종료 임박 D-' + left) : '') };
  }

  /* 여비규정 영향: 적용 중·예정 버전, 그리고 해당 이름을 행/열로 쓰는 버전 */
  function livePolicies(code) { return (D.policies[code] || []).filter((p) => p.status === 'active' || p.status === 'scheduled'); }
  const polLabel = (p) => `여비규정 ${p.ver}(${p.status === 'active' ? '적용 중' : '적용 예정'})`;
  function usedIn(code, kind, name) {
    if (!name) return [];
    return livePolicies(code).filter((p) => (p.items || []).some((it) => it.table && (kind === 'grade' ? it.table.rows.some((r) => r.label === name) : it.table.cols.includes(name))));
  }
  function impactText(code, kind, name) {
    const used = usedIn(code, kind, name), live = livePolicies(code);
    if (used.length) return `${used.map(polLabel).join(', ')}에서 사용 중인 기준입니다. 변경 내용은 다음 개정 버전부터 반영됩니다.`;
    if (live.length) return `${live.map(polLabel).join(', ')}이(가) 있는 법인입니다. 추가·변경한 기준은 다음 개정 버전의 값 표부터 반영됩니다.`;
    return '';
  }
  const impactBox = (code, kind, name) => { const t = impactText(code, kind, name); return t ? `<p class="criteria-impact">${esc(t)}</p>` : ''; };

  /* 출장지 문자열 → 키. '국가 전체'·'국가'·'국가 (그 외 도시)' = 국가 전체, '국가 - 도시' = 도시 */
  function parsePlace(s) {
    const names = PLACES.map((p) => p[0]);
    let m = /^(.+?)\s+-\s+(.+)$/.exec(s);
    if (m && names.includes(m[1])) return { key: m[1] + '|' + m[2], country: m[1], city: m[2] };
    m = /^(.+?)\s*(전체|\(그 외 도시\))/.exec(s);
    if (m && names.includes(m[1])) return { key: m[1] + '|*', country: m[1], city: null };
    if (names.includes(s)) return { key: s + '|*', country: s, city: null };
    return { key: 'x|' + s, country: null, city: null };
  }
  const placeLabel = (country, city) => (city ? `${country} - ${city}` : `${country} 전체`);

  /* ---------- 모달 공용 ---------- */
  function setErr(m, field, msg) {
    const e = m.querySelector(`[data-err="${field}"]`); if (e) e.textContent = msg || '';
    const f = m.querySelector(`[data-f="${field}"]`);
    if (f) { f.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (msg) f.focus(); }
    return !msg;
  }
  const clearErr = (m) => m.querySelectorAll('[data-err]').forEach((e) => { e.textContent = ''; });
  const errSlot = (field) => `<span class="criteria-err" role="alert" data-err="${field}"></span>`;
  function done(code, cat, text, toast) { App.log(code, cat, text); App.render(); ui.toast(toast); }

  /* ================= 1) 구성원 등급 ================= */
  function openGrade(code, id) {
    const list = gradesOf(code), g = id ? gradeById(code, id) : null, first = list.length === 0;
    const titles = hrTitles(code);
    const owner = (t) => list.find((x) => x.hr.includes(t) && (!g || x.id !== g.id));
    const hrBox = titles.map((t) => {
      const o = owner(t), on = !!g && g.hr.includes(t);
      return `<label class="criteria-check ${o ? 'dis' : ''}"><input type="checkbox" data-hr value="${esc(t)}" ${on ? 'checked' : ''} ${o ? 'disabled' : ''}><span>${esc(t)}${o ? `<span class="own">${esc(o.name)}에 매핑됨</span>` : ''}</span></label>`;
    }).join('');
    const isDef = first || !!(g && g.isDefault);
    const m = ui.modal({
      title: g ? '구성원 등급 수정' : '구성원 등급 추가', width: 560,
      body: `${impactBox(code, 'grade', g ? g.name : '')}
        <div class="frow"><label class="lb req" for="criteria-g-name">등급명 ${h.mk(3)}</label><div><input id="criteria-g-name" class="inp criteria-w" data-f="name" maxlength="${LIM.gname}" value="${g ? esc(g.name) : ''}" placeholder="예) Tier 1">${errSlot('name')}<span class="help">최대 ${LIM.gname}자 · 법인 내 중복 불가</span></div></div>
        <div class="frow"><label class="lb" for="criteria-g-desc">설명</label><div><input id="criteria-g-desc" class="inp criteria-w" data-f="desc" maxlength="${LIM.gdesc}" value="${g ? esc(g.desc || '') : ''}" placeholder="예) VP, SVP and EVPs"><span class="help">최대 ${LIM.gdesc}자 · 여비규정 화면에서 등급명과 함께 안내</span></div></div>
        <div class="frow criteria-frow-top"><div class="lb" id="criteria-g-hr">매핑 직급/직책</div><div>
          <div class="criteria-hrbox" role="group" aria-labelledby="criteria-g-hr">${hrBox}</div>
          <p class="help" style="margin:6px 0 0">${esc(code)} 인사정보 직급/직책 ${titles.length}개. 한 직급은 한 등급에만 매핑할 수 있어, 다른 등급에 매핑된 직급은 선택할 수 없습니다. 어느 등급에도 매핑하지 않은 직급에는 기본 등급이 적용됩니다.</p></div></div>
        <div class="frow criteria-frow-top"><div class="lb">기본 등급</div><div>
          <label class="criteria-check" style="padding-left:0"><input type="checkbox" data-f="def" ${isDef ? 'checked disabled' : ''}><span>이 등급을 기본 등급으로 지정</span></label>
          <span class="help">${first ? '법인의 첫 등급은 기본 등급으로 등록됩니다.' : g && g.isDefault ? '기본 등급은 법인당 1개가 반드시 있어야 합니다. 바꾸려면 다른 등급을 기본 등급으로 지정하세요.' : `지정하면 현재 기본 등급(${esc((defaultGrade(code) || {}).name || '-')})은 기본 등급에서 해제됩니다.`}</span></div></div>`,
      actions: [{ label: '취소' }, { label: g ? '저장' : '추가', primary: true, onClick: (mo) => saveGrade(code, g, mo) }],
    });
    return m;
  }

  function saveGrade(code, g, m) {
    clearErr(m);
    const list = gradesOf(code);
    const name = m.querySelector('[data-f="name"]').value.trim();
    const desc = m.querySelector('[data-f="desc"]').value.trim();
    const hr = [...m.querySelectorAll('[data-hr]:checked')].map((c) => c.value);
    const def = m.querySelector('[data-f="def"]').checked;
    if (!name) return setErr(m, 'name', '등급명을 입력해 주세요.');
    if (list.some((x) => x !== g && same(x.name, name))) return setErr(m, 'name', '같은 이름의 등급이 이미 있습니다.');
    const makeDefault = def && !(g && g.isDefault);
    if (makeDefault) list.forEach((x) => { delete x.isDefault; });
    if (g) {
      const ch = [];
      if (g.name !== name) ch.push(`등급명 ${g.name} → ${name}`);
      if ((g.desc || '') !== desc) ch.push('설명 변경');
      const plus = hr.filter((t) => !g.hr.includes(t)), minus = g.hr.filter((t) => !hr.includes(t));
      if (plus.length) ch.push('매핑 추가 ' + plus.join(', '));
      if (minus.length) ch.push('매핑 해제 ' + minus.join(', '));
      if (makeDefault) ch.push('기본 등급으로 지정');
      if (!ch.length) { ui.toast('변경된 내용이 없습니다.'); return true; }
      const label = g.name;
      Object.assign(g, { name, desc, hr }); if (makeDefault) g.isDefault = true;
      done(code, CAT_G, `등급 수정 — ${label}: ${ch.join(' / ')}`, '구성원 등급을 수정했습니다.');
    } else {
      const ng = { id: newId(list, 'g'), name, desc, hr, count: null }; if (def) ng.isDefault = true;
      list.push(ng);
      done(code, CAT_G, `등급 추가 — ${name}${hr.length ? ' (매핑: ' + hr.join(', ') + ')' : ' (매핑 직급 없음)'}${def ? ' · 기본 등급' : ''}`, '구성원 등급을 추가했습니다.');
    }
    return true;
  }

  function deleteGrade(code, id) {
    const list = gradesOf(code), g = gradeById(code, id); if (!g) return;
    const exc = excOf(code).filter((x) => x.to === id);
    if (g.isDefault && list.length > 1) return ui.modal({ title: '삭제할 수 없는 등급', body: `<p><b>${esc(g.name)}</b>은(는) 기본 등급입니다. 다른 등급을 기본 등급으로 지정한 뒤 삭제해 주세요.</p>` });
    if (exc.length) return ui.modal({ title: '삭제할 수 없는 등급', body: `<p><b>${esc(g.name)}</b>을(를) 적용 등급으로 쓰는 개인 예외 지정이 ${exc.length}건 있습니다. 예외 지정을 해제하거나 적용 등급을 바꾼 뒤 삭제해 주세요.</p><ul class="criteria-list">${exc.map((x) => `<li>${esc(x.name)} (${esc(x.empNo)})</li>`).join('')}</ul>` });
    const def = defaultGrade(code), used = usedIn(code, 'grade', g.name);
    ui.modal({
      title: '구성원 등급 삭제',
      body: `${impactBox(code, 'grade', g.name)}<p><b>${esc(g.name)}</b> 등급을 삭제합니다.</p>
        <ul class="criteria-list">${g.hr.length && def && def !== g ? `<li>매핑된 직급 ${g.hr.length}개(${esc(g.hr.join(', '))})는 미매핑 상태가 되어 기본 등급 <b>${esc(def.name)}</b>이(가) 적용됩니다.</li>` : ''}
        ${used.length ? `<li>${esc(used.map(polLabel).join(', '))}의 값 표에는 이 등급 행이 그대로 남습니다.</li>` : ''}<li>삭제한 등급은 되돌릴 수 없으며 변경 이력에 기록됩니다.</li></ul>`,
      actions: [{ label: '취소' }, { label: '삭제', primary: true, danger: true, onClick: () => { list.splice(list.indexOf(g), 1); done(code, CAT_G, `등급 삭제 — ${g.name}${g.hr.length ? ' (매핑 해제: ' + g.hr.join(', ') + ')' : ''}`, '구성원 등급을 삭제했습니다.'); } }],
    });
  }

  function move(code, kind, id, dir) {
    const list = kind === 'g' ? gradesOf(code) : regionsOf(code);
    const i = list.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length || (kind === 'r' && (list[i].isDefault || list[j].isDefault))) return;
    const it = list[i]; list.splice(i, 1); list.splice(j, 0, it);
    st.focus = `[data-act="${kind}-${dir < 0 ? 'up' : 'down'}"][data-id="${id}"]`;
    done(code, kind === 'g' ? CAT_G : CAT_R, `${kind === 'g' ? '등급' : '지역 그룹'} 순서 변경 — ${it.name}: ${i + 1}번째 → ${j + 1}번째`, '순서를 변경했습니다.');
  }

  /* ================= 2) 개인 예외 지정 ================= */
  function openException(code, empNo) {
    const list = excOf(code), grades = gradesOf(code), x = empNo ? list.find((e) => e.empNo === empNo) : null;
    let person = x ? { empNo: x.empNo, name: x.name, dept: x.dept, hrTitle: x.hrTitle } : null;
    const pool = D.people[code] || [];
    const m = ui.modal({
      title: x ? '개인 예외 지정 수정' : '개인 예외 지정 추가', width: 560,
      body: `<div class="frow criteria-frow-top"><label class="lb req" for="criteria-x-q">구성원 ${h.mk(7)}</label><div data-person></div></div>
        <div class="frow"><label class="lb req" for="criteria-x-to">적용 등급</label><div><select id="criteria-x-to" class="sel criteria-w" data-f="to"></select>${errSlot('to')}</div></div>
        <div class="frow criteria-frow-top"><label class="lb req" for="criteria-x-reason">사유</label><div><textarea id="criteria-x-reason" class="ta" rows="2" data-f="reason" maxlength="${LIM.reason}" placeholder="예) 아티스트 동행 상시 업무 (CFO 승인)">${x ? esc(x.reason) : ''}</textarea>${errSlot('reason')}<span class="help">최대 ${LIM.reason}자 · 예외 지정 표와 변경 이력에 그대로 노출</span></div></div>
        <div class="frow criteria-frow-top"><div class="lb req" id="criteria-x-period">적용 기간</div><div>
          <div class="criteria-period" role="group" aria-labelledby="criteria-x-period"><input type="date" class="inp" data-f="start" aria-label="시작일" value="${toInput(x ? x.start : D.TODAY)}"><span>~</span><input type="date" class="inp" data-f="end" aria-label="종료일" value="${toInput(x ? x.end : '')}"><button type="button" class="btn sm ghost" data-clear-end>종료일 지우기</button></div>
          ${errSlot('start')}${errSlot('end')}<span class="help">시작일 필수. 종료일을 비우면 무기한으로 적용되며, 종료일 다음 날부터는 직급 매핑 등급으로 돌아갑니다.</span></div></div>`,
      actions: [{ label: '취소' }, { label: x ? '저장' : '지정', primary: true, onClick: (mo) => saveException(code, x, person, mo) }],
    });
    const pBox = m.querySelector('[data-person]'), toSel = m.querySelector('[data-f="to"]');

    function drawTo() {
      const cur = person ? mappedGrade(code, person.hrTitle) : null, keep = toSel.value || (x ? x.to : '');
      toSel.disabled = !person;
      toSel.innerHTML = `<option value="">${person ? '등급 선택' : '구성원을 먼저 선택하세요'}</option>` + grades.map((g) => `<option value="${g.id}" ${cur && cur.id === g.id ? 'disabled' : ''} ${keep === g.id && !(cur && cur.id === g.id) ? 'selected' : ''}>${esc(g.name)}${cur && cur.id === g.id ? ' (현재 매핑 등급)' : ''}</option>`).join('');
    }
    function drawPerson(q) {
      if (person) {
        const cur = mappedGrade(code, person.hrTitle), direct = grades.some((g) => g.hr.includes(person.hrTitle));
        pBox.innerHTML = `<div class="criteria-info"><div class="row between"><b>${esc(person.name)} <span class="num" style="font-weight:400;color:var(--sub)">${esc(person.empNo)}</span></b>${x ? '' : '<button type="button" class="btn sm" data-repick>다시 선택</button>'}</div>
          <dl><dt>소속</dt><dd>${esc(person.dept)}</dd><dt>인사정보 직급</dt><dd>${esc(person.hrTitle)}</dd><dt>현재 매핑 등급</dt><dd>${cur ? esc(cur.name) + (direct ? '' : ' <span class="help">(미매핑 직급 → 기본 등급)</span>') : '-'}</dd></dl></div>${errSlot('person')}`;
      } else {
        const kw = (q || '').trim().toLowerCase();
        const hits = pool.filter((p) => !kw || p.name.toLowerCase().includes(kw) || p.empNo.toLowerCase().includes(kw));
        if (!pBox.querySelector('#criteria-x-q')) pBox.innerHTML = `<input id="criteria-x-q" class="inp criteria-w" data-f="person" placeholder="이름 또는 사번으로 검색" autocomplete="off"><div class="criteria-hits" data-hits></div>${errSlot('person')}<span class="help">${esc(code)} 소속 재직 구성원만 검색됩니다. (샘플 ${pool.length}명)</span>`;
        pBox.querySelector('[data-hits]').innerHTML = hits.length ? hits.map((p) => {
          const dup = list.some((e) => e.empNo === p.empNo), cur = mappedGrade(code, p.hrTitle);
          return `<button type="button" class="criteria-hit" data-pick="${esc(p.empNo)}" ${dup ? 'disabled' : ''}><span class="grow"><b>${esc(p.name)}</b> <span class="dim num">${esc(p.empNo)}</span> <span class="dim">· ${esc(p.dept)} · ${esc(p.hrTitle)}</span></span>${dup ? h.badge('gray', '이미 지정됨') : h.badge('line', cur ? cur.name : '-')}</button>`;
        }).join('') : `<div class="none">'${esc(q)}'에 해당하는 구성원이 없습니다.</div>`;
      }
      drawTo();
    }
    pBox.addEventListener('input', (e) => { if (e.target.id === 'criteria-x-q') drawPerson(e.target.value); });
    pBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) { person = pool.find((p) => p.empNo === b.dataset.pick); drawPerson(); toSel.focus(); return; }
      if (e.target.closest('[data-repick]')) { person = null; toSel.value = ''; pBox.innerHTML = ''; drawPerson(''); pBox.querySelector('#criteria-x-q').focus(); }
    });
    m.querySelector('[data-clear-end]').onclick = () => { m.querySelector('[data-f="end"]').value = ''; };
    /* saveException 이 최신 person 을 읽도록 */
    m._person = () => person;
    drawPerson('');
    const f = m.querySelector(x ? '[data-f="to"]' : '#criteria-x-q'); if (f) f.focus();
  }

  function saveException(code, x, _p, m) {
    clearErr(m);
    const list = excOf(code), person = m._person();
    const to = m.querySelector('[data-f="to"]').value, reason = m.querySelector('[data-f="reason"]').value.trim();
    const start = fromInput(m.querySelector('[data-f="start"]').value), end = fromInput(m.querySelector('[data-f="end"]').value);
    if (!person) return setErr(m, 'person', '구성원을 검색해 선택해 주세요.');
    if (!x && list.some((e) => e.empNo === person.empNo)) return setErr(m, 'person', '이미 예외 지정된 구성원입니다.');
    const cur = mappedGrade(code, person.hrTitle);
    if (!to) return setErr(m, 'to', '적용 등급을 선택해 주세요.');
    if (cur && cur.id === to) return setErr(m, 'to', '현재 매핑 등급과 같은 등급은 지정할 수 없습니다.');
    if (!reason) return setErr(m, 'reason', '사유를 입력해 주세요.');
    if (!start) return setErr(m, 'start', '시작일을 입력해 주세요.');
    if (end && end < start) return setErr(m, 'end', '종료일은 시작일과 같거나 이후여야 합니다.');
    if (end && end < D.TODAY) return setErr(m, 'end', '종료일은 오늘(' + D.TODAY + ') 이후여야 합니다.');
    const toG = gradeById(code, to), period = `${start} ~ ${end || '무기한'}`;
    if (x) {
      const ch = [];
      if (x.to !== to) ch.push(`적용 등급 ${(gradeById(code, x.to) || {}).name || '-'} → ${toG.name}`);
      if (x.start !== start || x.end !== end) ch.push(`적용 기간 ${x.start} ~ ${x.end || '무기한'} → ${period}`);
      if (x.reason !== reason) ch.push('사유 변경');
      if (!ch.length) { ui.toast('변경된 내용이 없습니다.'); return true; }
      Object.assign(x, { to, reason, start, end, from: cur ? cur.id : x.from });
      done(code, CAT_G, `개인 예외 지정 수정 — ${x.name}: ${ch.join(' / ')}`, '개인 예외 지정을 수정했습니다.');
    } else {
      list.unshift({ empNo: person.empNo, name: person.name, dept: person.dept, hrTitle: person.hrTitle, from: cur ? cur.id : '', to, reason, start, end, by: D.admin, at: D.TODAY });
      done(code, CAT_G, `개인 예외 지정 추가 — ${person.name} (${cur ? cur.name : '-'} → ${toG.name}, ${period})`, '개인 예외 지정을 추가했습니다.');
    }
    return true;
  }

  function releaseException(code, empNo) {
    const list = excOf(code), x = list.find((e) => e.empNo === empNo); if (!x) return;
    const cur = mappedGrade(code, x.hrTitle), toG = gradeById(code, x.to);
    ui.modal({
      title: '개인 예외 지정 해제',
      body: `<p><b>${esc(x.name)}</b> (${esc(x.empNo)})의 예외 지정을 해제합니다.</p><ul class="criteria-list"><li>해제 즉시 직급 매핑 등급 <b>${esc(cur ? cur.name : '-')}</b>이(가) 적용됩니다. (현재 적용 등급: ${esc(toG ? toG.name : '-')})</li><li>해제한 예외 지정은 표에서 사라지며 변경 이력에서만 확인할 수 있습니다.</li></ul>`,
      actions: [{ label: '취소' }, { label: '해제', primary: true, danger: true, onClick: () => { list.splice(list.indexOf(x), 1); done(code, CAT_G, `개인 예외 지정 해제 — ${x.name} (${toG ? toG.name : '-'} → ${cur ? cur.name : '-'})`, '개인 예외 지정을 해제했습니다.'); } }],
    });
  }

  /* ================= 3) 지역 그룹 ================= */
  function openRegion(code, id) {
    const list = regionsOf(code), r = id ? list.find((x) => x.id === id) : null, isDef = !!(r && r.isDefault), first = list.length === 0;
    /* 마스터 + 기존 데이터에만 있는 도시 보강 */
    const master = PLACES.map(([name, cities]) => ({ name, cities: cities.slice() }));
    const owner = new Map(), sel = new Map();
    list.forEach((g) => g.places.forEach((s) => {
      const p = parsePlace(s);
      if (p.country && p.city) { const c = master.find((x) => x.name === p.country); if (!c.cities.includes(p.city)) c.cities.push(p.city); }
      if (r && g.id === r.id) sel.set(p.key, s); else owner.set(p.key, g.name);
    }));
    let active = master[0].name, kw = '';
    const first1 = [...sel.keys()].find((k) => !k.startsWith('x|')); if (first1) active = first1.split('|')[0];

    const picker = isDef
      ? `<div class="criteria-info">기본 그룹에는 출장지를 지정할 수 없습니다. 다른 어느 그룹에도 속하지 않은 출장지 전체에 이 그룹의 기준이 적용됩니다.</div>`
      : `<div class="criteria-picked criteria-chips" data-picked aria-live="polite"></div>
         <div class="criteria-pick"><div class="cl"><input class="inp criteria-w" data-kw placeholder="국가·도시 검색" aria-label="국가·도시 검색" style="margin-bottom:6px"><div data-cl></div></div><div class="cr" data-cr></div></div>
         ${errSlot('places')}<p class="help" style="margin:6px 0 0">출장지 관리에 등록된(사용 ON) 국가·도시에서 선택합니다. 한 출장지는 한 그룹에만 넣을 수 있습니다.<br>국가 전체와 그 국가의 도시가 서로 다른 그룹에 있으면 <b>도시가 속한 그룹이 우선</b> 적용됩니다. 예) '미국 전체' = Other US, '미국 - 뉴욕' = New York이면 뉴욕 출장에는 New York 기준이 적용됩니다.</p>`;
    const m = ui.modal({
      title: r ? '지역 그룹 수정' : '지역 그룹 추가', width: 640,
      body: `${impactBox(code, 'region', r ? r.name : '')}
        <div class="frow"><label class="lb req" for="criteria-r-name">그룹명 ${h.mk(10)}</label><div><input id="criteria-r-name" class="inp criteria-w" data-f="name" maxlength="${LIM.rname}" value="${r ? esc(r.name) : ''}" placeholder="예) Major US Cities">${errSlot('name')}<span class="help">최대 ${LIM.rname}자 · 법인 내 중복 불가 · 여비규정 값 표의 열 이름으로 사용</span></div></div>
        <div class="frow criteria-frow-top"><div class="lb ${isDef ? '' : 'req'}" id="criteria-r-pl">포함 출장지</div><div role="group" aria-labelledby="criteria-r-pl">${picker}</div></div>
        ${first ? `<p class="help" style="margin:10px 0 0">첫 지역 그룹을 추가하면 기본 그룹 <b>'그 외 지역'</b>이 함께 만들어집니다. (이름은 추가 후 수정할 수 있습니다.)</p>` : ''}`,
      actions: [{ label: '취소' }, { label: r ? '저장' : '추가', primary: true, onClick: (mo) => saveRegion(code, r, sel, mo) }],
    });
    if (isDef) return;
    const elCl = m.querySelector('[data-cl]'), elCr = m.querySelector('[data-cr]'), elPicked = m.querySelector('[data-picked]');

    function draw() {
      const k = kw.trim().toLowerCase();
      const shown = master.filter((c) => !k || c.name.toLowerCase().includes(k) || c.cities.some((ct) => ct.toLowerCase().includes(k)));
      if (shown.length && !shown.some((c) => c.name === active)) active = shown[0].name;
      elCl.innerHTML = shown.length ? shown.map((c) => {
        const n = [...sel.keys()].filter((key) => key.startsWith(c.name + '|')).length;
        return `<button type="button" class="criteria-cty ${c.name === active ? 'on' : ''}" data-cty="${esc(c.name)}" aria-pressed="${c.name === active}"><span>${esc(c.name)}</span>${n ? `<em>${n}</em>` : ''}</button>`;
      }).join('') : '<p class="help" style="padding:6px">검색 결과가 없습니다.</p>';
      const c = shown.find((x) => x.name === active);
      if (!c) elCr.innerHTML = ''; else {
        const wk = c.name + '|*', wOwn = owner.get(wk), wOn = sel.has(wk);
        const row = (key, label, own, on, inc) => `<label class="criteria-check ${own || inc ? 'dis' : ''}"><input type="checkbox" data-pk="${esc(key)}" data-lb="${esc(label)}" ${on || inc ? 'checked' : ''} ${own || inc ? 'disabled' : ''}><span>${esc(label)}${own ? `<span class="own">${esc(own)} 그룹에 포함됨</span>` : inc ? '<span class="own">국가 전체에 포함</span>' : ''}</span></label>`;
        elCr.innerHTML = row(wk, placeLabel(c.name, null), wOwn, wOn, false)
          + (wOwn && c.cities.length ? `<p class="help" style="margin:2px 8px 4px">국가 전체는 ${esc(wOwn)} 그룹입니다. 아래에서 고른 도시는 이 그룹이 우선 적용됩니다.</p>` : '')
          + c.cities.map((ct) => { const key = c.name + '|' + ct, own = owner.get(key); return row(key, placeLabel(c.name, ct), own, sel.has(key), wOn && !own); }).join('')
          + (c.cities.length ? '' : '<p class="help" style="margin:2px 8px">등록된 도시가 없는 국가입니다.</p>');
      }
      elPicked.innerHTML = sel.size ? [...sel].map(([key, label]) => `<span class="chip">${esc(label)}<button type="button" data-rm="${esc(key)}" aria-label="${esc(label)} 제외">×</button></span>`).join('') : '<span class="help">선택한 출장지가 없습니다.</span>';
    }
    m.querySelector('[data-kw]').addEventListener('input', (e) => { kw = e.target.value; draw(); });
    elCl.addEventListener('click', (e) => { const b = e.target.closest('[data-cty]'); if (!b) return; active = b.dataset.cty; draw(); const nb = elCl.querySelector('.criteria-cty.on'); if (nb) nb.focus(); });
    elCr.addEventListener('change', (e) => {
      const c = e.target.closest('[data-pk]'); if (!c) return;
      const key = c.dataset.pk;
      if (c.checked) {
        sel.set(key, c.dataset.lb);
        if (key.endsWith('|*')) [...sel.keys()].forEach((k2) => { if (k2 !== key && k2.startsWith(key.slice(0, -1))) sel.delete(k2); });
      } else sel.delete(key);
      draw(); setErr(m, 'places', '');
      const again = elCr.querySelector(`[data-pk="${CSS.escape(key)}"]`); if (again) again.focus();
    });
    elPicked.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; sel.delete(b.dataset.rm); draw(); m.querySelector('[data-kw]').focus(); });
    draw();
  }

  function saveRegion(code, r, sel, m) {
    clearErr(m);
    const list = regionsOf(code), name = m.querySelector('[data-f="name"]').value.trim();
    const isDef = !!(r && r.isDefault), places = isDef ? [] : [...sel.values()];
    if (!name) return setErr(m, 'name', '그룹명을 입력해 주세요.');
    if (list.some((x) => x !== r && same(x.name, name))) return setErr(m, 'name', '같은 이름의 지역 그룹이 이미 있습니다.');
    if (!isDef && !places.length) { setErr(m, 'places', '포함할 출장지를 1개 이상 선택해 주세요.'); const k = m.querySelector('[data-kw]'); if (k) k.focus(); return false; }
    if (r) {
      const ch = [];
      if (r.name !== name) ch.push(`그룹명 ${r.name} → ${name}`);
      const plus = places.filter((p) => !r.places.includes(p)), minus = r.places.filter((p) => !places.includes(p));
      if (plus.length) ch.push('출장지 추가 ' + plus.join(', '));
      if (minus.length) ch.push('출장지 제외 ' + minus.join(', '));
      if (!ch.length) { ui.toast('변경된 내용이 없습니다.'); return true; }
      const label = r.name; r.name = name; r.places = places;
      done(code, CAT_R, `지역 그룹 수정 — ${label}: ${ch.join(' / ')}`, '지역 그룹을 수정했습니다.');
    } else {
      const nr = { id: newId(list, 'r'), name, places };
      const di = list.findIndex((x) => x.isDefault);
      if (di >= 0) list.splice(di, 0, nr); else {
        list.push(nr);
        const dn = same(name, '그 외 지역') ? '기타 지역' : '그 외 지역';
        list.push({ id: newId(list, 'r'), name: dn, places: [], isDefault: true });
        App.log(code, CAT_R, `기본 그룹 자동 생성 — ${dn}`);
      }
      done(code, CAT_R, `지역 그룹 추가 — ${name} (${places.join(', ')})`, '지역 그룹을 추가했습니다.');
    }
    return true;
  }

  function deleteRegion(code, id) {
    const list = regionsOf(code), r = list.find((x) => x.id === id); if (!r) return;
    if (r.isDefault && list.length > 1) return ui.modal({ title: '삭제할 수 없는 그룹', body: `<p><b>${esc(r.name)}</b>은(는) 기본 그룹입니다. 어느 그룹에도 속하지 않은 출장지에 적용되므로, 다른 그룹이 남아 있는 동안에는 삭제할 수 없습니다.</p>` });
    const def = list.find((x) => x.isDefault), used = usedIn(code, 'region', r.name);
    ui.modal({
      title: '지역 그룹 삭제',
      body: `${impactBox(code, 'region', r.name)}<p><b>${esc(r.name)}</b> 그룹을 삭제합니다.</p>
        <ul class="criteria-list">${r.places.length && def && def !== r ? `<li>포함된 출장지 ${r.places.length}개는 다른 그룹에 넣기 전까지 기본 그룹 <b>${esc(def.name)}</b> 기준이 적용됩니다. (같은 국가의 '전체'가 다른 그룹에 있으면 그 그룹 기준)</li>` : ''}
        ${used.length ? `<li>${esc(used.map(polLabel).join(', '))}의 값 표에는 이 그룹 열이 그대로 남습니다.</li>` : ''}<li>삭제한 그룹은 되돌릴 수 없으며 변경 이력에 기록됩니다.</li></ul>`,
      actions: [{ label: '취소' }, { label: '삭제', primary: true, danger: true, onClick: () => { list.splice(list.indexOf(r), 1); done(code, CAT_R, `지역 그룹 삭제 — ${r.name}`, '지역 그룹을 삭제했습니다.'); } }],
    });
  }

  /* ================= 다른 법인 기준 복사 ================= */
  function openCopy(code) {
    const srcs = D.corps.filter((c) => c.code !== code && (gradesOf(c.code).length || regionsOf(c.code).length));
    const hasG = gradesOf(code).length > 0, hasR = regionsOf(code).length > 0;
    const m = ui.modal({
      title: '다른 법인 기준 복사해 오기', width: 560,
      body: `<div class="frow"><label class="lb req" for="criteria-c-src">가져올 법인 ${h.mk(11)}</label><div><select id="criteria-c-src" class="sel criteria-w" data-f="src">${srcs.map((c) => `<option value="${c.code}">${c.code} · ${esc(c.name)} (등급 ${gradesOf(c.code).length} · 지역 그룹 ${regionsOf(c.code).length})</option>`).join('')}</select></div></div>
        <div class="frow criteria-frow-top"><div class="lb req" id="criteria-c-what">복사 대상</div><div role="group" aria-labelledby="criteria-c-what">
          <label class="criteria-check ${hasG ? 'dis' : ''}"><input type="checkbox" data-f="cg" ${hasG ? 'disabled' : 'checked'}><span>구성원 등급<span class="own" data-pg></span></span></label>
          <label class="criteria-check ${hasR ? 'dis' : ''}"><input type="checkbox" data-f="cr" ${hasR ? 'disabled' : 'checked'}><span>지역 그룹<span class="own" data-pr></span></span></label>${errSlot('what')}</div></div>
        <ul class="criteria-list help" style="margin-top:12px"><li>등급은 <b>등급명·설명·순서·기본 등급 여부</b>만 복사합니다. 인사정보 직급 코드가 법인마다 달라 <b>직급 매핑은 복사하지 않고 비워 둡니다.</b> 복사 후 등급별로 직급을 매핑해 주세요.</li><li>지역 그룹은 그룹명·포함 출장지·순서·기본 그룹을 그대로 복사합니다.</li><li>개인 예외 지정과 여비규정 값은 복사하지 않습니다. 이미 기준이 등록된 항목에는 복사할 수 없습니다.</li></ul>`,
      actions: [{ label: '취소' }, { label: '복사', primary: true, onClick: (mo) => {
        clearErr(mo);
        const src = mo.querySelector('[data-f="src"]').value, cg = mo.querySelector('[data-f="cg"]'), cr = mo.querySelector('[data-f="cr"]');
        const doG = cg.checked && !cg.disabled, doR = cr.checked && !cr.disabled;
        if (!doG && !doR) return setErr(mo, 'what', '복사할 대상을 1개 이상 선택해 주세요.');
        if (doG) { D.grades[code] = gradesOf(src).map((g, i) => Object.assign({ id: 'g' + (i + 1), name: g.name, desc: g.desc, hr: [], count: null }, g.isDefault ? { isDefault: true } : {})); App.log(code, CAT_G, `${src} 기준 복사 — 등급 ${D.grades[code].length}개 (${D.grades[code].map((g) => g.name).join(', ')}) · 직급 매핑 제외`); }
        if (doR) { D.regions[code] = JSON.parse(JSON.stringify(regionsOf(src))); App.log(code, CAT_R, `${src} 기준 복사 — 지역 그룹 ${D.regions[code].length}개 (${D.regions[code].map((r) => r.name).join(', ')})`); }
        App.render(); ui.toast(`${src}의 ${[doG ? '구성원 등급' : '', doR ? '지역 그룹' : ''].filter(Boolean).join('·')}을 복사했습니다.${doG ? ' 직급 매핑을 진행해 주세요.' : ''}`);
        return true;
      } }],
    });
    const sel = m.querySelector('[data-f="src"]');
    const preview = () => {
      const s = sel.value, g = gradesOf(s), r = regionsOf(s);
      m.querySelector('[data-pg]').textContent = hasG ? '이미 등록된 등급이 있어 복사할 수 없습니다.' : g.length ? `${g.length}개 — ${g.map((x) => x.name).join(', ')}` : '가져올 등급이 없습니다.';
      m.querySelector('[data-pr]').textContent = hasR ? '이미 등록된 지역 그룹이 있어 복사할 수 없습니다.' : r.length ? `${r.length}개 — ${r.map((x) => x.name).join(', ')}` : '가져올 지역 그룹이 없습니다.';
    };
    sel.addEventListener('change', preview); preview();
  }

  /* ================= 렌더 ================= */
  const chips = (arr) => `<div class="criteria-chips">${arr.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>`;
  const ord = (kind, id, i, n, lock, name) => `<span class="criteria-ord"><button type="button" class="btn sm" data-act="${kind}-up" data-id="${id}" aria-label="${esc(name)} 위로 이동" title="위로" ${lock || i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="btn sm" data-act="${kind}-down" data-id="${id}" aria-label="${esc(name)} 아래로 이동" title="아래로" ${lock || i >= n - 1 ? 'disabled' : ''}>▼</button></span>`;
  const emptyBox = (title, text, addAct, addLabel, addDisabled, copy, mk) => `<div class="empty criteria-empty"><b>${title}</b><p>${text}</p><div class="btns">${copy ? `<button type="button" class="btn" data-act="copy">다른 법인 기준 복사해 오기</button>${mk || ''}` : ''}<button type="button" class="btn pri" data-act="${addAct}" ${addDisabled ? 'disabled' : ''}>${addLabel}</button></div></div>`;

  function secGrades(code) {
    const list = gradesOf(code), un = unmappedTitles(code), def = defaultGrade(code);
    const total = list.reduce((s, g) => s + (g.count || 0), 0);
    const body = list.length ? `<div class="tbl-wrap"><table class="tbl criteria-tbl"><thead><tr><th class="c" style="width:44px">순서</th><th style="width:17%">등급명</th><th style="width:23%">설명</th><th>매핑된 인사정보 직급/직책</th><th class="r" style="width:76px">구성원 수</th><th class="c" style="width:64px">기본 등급</th><th class="r" style="width:172px">관리 ${h.mk(4)}</th></tr></thead><tbody>
      ${list.map((g, i) => `<tr><td class="c num">${i + 1}</td><td><span class="nm">${esc(g.name)}</span></td><td>${g.desc ? esc(g.desc) : '<span class="dim">-</span>'}</td>
        <td>${g.hr.length ? chips(g.hr) : `<span class="dim">${g.isDefault ? '매핑 직급 없음 (미매핑 직급 전체)' : '매핑 직급 없음'}</span>`}</td>
        <td class="r num">${g.count == null ? '<span class="dim" title="다음 인사정보 동기화 후 집계">집계 전</span>' : `<span class="hl-blue">${g.count.toLocaleString()}</span>명`}</td>
        <td class="c">${g.isDefault ? h.badge('blue', '기본') : '<span class="dim">-</span>'}</td>
        <td class="act">${ord('g', g.id, i, list.length, false, g.name)}<button type="button" class="btn sm" data-act="g-edit" data-id="${g.id}" aria-label="${esc(g.name)} 수정">수정</button><button type="button" class="btn sm danger" data-act="g-del" data-id="${g.id}" aria-label="${esc(g.name)} 삭제">삭제</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="criteria-foot">${h.mk(5)}${un.length ? `<span class="note">미매핑 직급 <b>${un.length}개</b> → 기본 등급 <b>${esc(def ? def.name : '-')}</b> 적용</span><span>${esc(un.join(', '))}</span>` : '<span>모든 인사정보 직급이 등급에 매핑되어 있습니다.</span>'}<span class="grow"></span><span class="num">구성원 수 합계 ${total.toLocaleString()}명 · 인사정보 연동 ${esc(D.hrSyncAt)} 기준</span></div>`
      : emptyBox('등록된 구성원 등급이 없습니다', '등급을 추가하거나, 여비규정 체계가 비슷한 다른 법인의 기준을 복사해 시작할 수 있습니다.', 'g-add', '등급 추가', false, true, h.mk(11));
    return `<section class="sec" aria-labelledby="criteria-h-g"><div class="criteria-hd"><div><h2 class="sec-title" id="criteria-h-g">구성원 등급<em>${list.length}</em>${h.mk(2)}</h2><p class="sec-desc">인사정보의 직급/직책을 등급에 매핑합니다. 여비규정 값 표에서 등급별로 값이 다른 항목의 행으로 쓰입니다.</p></div>
      <div class="row">${list.length ? `<button type="button" class="btn" data-act="g-add">등급 추가</button>${h.mk(3)}` : ''}</div></div>${body}</section>`;
  }

  function secExceptions(code) {
    const all = excOf(code), grades = gradesOf(code), canAdd = grades.length >= 2;
    const rows = all.map((x) => ({ x, s: excStatus(x) })).filter((r) => st.exFilter === 'all' || r.s.key === st.exFilter);
    const gname = (id) => { const g = gradeById(code, id); return g ? esc(g.name) : '<span class="dim">삭제된 등급</span>'; };
    const filter = `<label class="row" style="gap:6px;font-size:11px;color:var(--sub)">상태<select class="sel" data-act="ex-filter" aria-label="상태 필터">${[['all', '전체'], ['active', '적용 중'], ['scheduled', '예정'], ['ended', '만료']].map(([k, l]) => `<option value="${k}" ${st.exFilter === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    let body;
    if (!all.length) body = `<div class="empty criteria-empty"><b>개인 예외 지정이 없습니다</b><p>${canAdd ? '모든 구성원에게 직급 매핑 등급이 적용되고 있습니다.' : '예외 지정은 구성원 등급이 2개 이상 등록된 뒤에 추가할 수 있습니다.'}</p></div>`;
    else if (!rows.length) body = `<div class="empty"><b>해당 상태의 예외 지정이 없습니다</b>상태 필터를 [전체]로 바꿔 확인해 주세요.</div>`;
    else body = `<div class="tbl-wrap"><table class="tbl criteria-tbl"><thead><tr><th style="width:15%">구성원</th><th style="width:16%">소속 · 인사정보 직급</th><th style="width:19%">매핑 등급 → 적용 등급</th><th>사유</th><th style="width:118px">적용 기간 · 상태</th><th style="width:78px">등록</th><th class="r" style="width:96px">관리 ${h.mk(8)}</th></tr></thead><tbody>
      ${rows.map(({ x, s }) => {
        const cur = mappedGrade(code, x.hrTitle), redundant = cur && cur.id === x.to;
        return `<tr class="${s.key === 'ended' ? 'off' : ''}"><td><span class="nm">${esc(x.name)}</span><span class="sub num">${esc(x.empNo)}</span></td><td>${esc(x.dept)}<span class="sub">${esc(x.hrTitle)}</span></td>
        <td>${cur ? esc(cur.name) : '-'}<span class="criteria-arrow">→</span><b>${gname(x.to)}</b>${redundant ? `<span class="sub"><span class="note">매핑 등급과 같아짐 · 해제 검토</span></span>` : ''}</td>
        <td>${esc(x.reason)}</td><td class="num">${esc(x.start)} ~<br>${x.end ? esc(x.end) : '무기한'}<span class="sub">${s.badge}</span></td>
        <td>${esc(x.by)}<span class="sub num">${esc(x.at)}</span></td>
        <td class="act"><button type="button" class="btn sm" data-act="x-edit" data-id="${esc(x.empNo)}" aria-label="${esc(x.name)} 예외 지정 수정">수정</button><button type="button" class="btn sm danger" data-act="x-del" data-id="${esc(x.empNo)}" aria-label="${esc(x.name)} 예외 지정 해제">해제</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
    return `<section class="sec" aria-labelledby="criteria-h-x"><div class="criteria-hd"><div><h2 class="sec-title" id="criteria-h-x">개인 예외 지정<em>${all.length}</em>${h.mk(6)}</h2><p class="sec-desc">직급 매핑과 다른 등급을 특정 구성원에게 개별로 지정합니다. 적용 기간 동안 직급 매핑보다 우선합니다.</p></div>
      <div class="row">${all.length ? filter : ''}<button type="button" class="btn" data-act="x-add" ${canAdd ? '' : 'disabled title="구성원 등급이 2개 이상일 때 추가할 수 있습니다"'}>예외 지정 추가</button>${h.mk(7)}</div></div>${body}</section>`;
  }

  function secRegions(code) {
    const list = regionsOf(code);
    const body = list.length ? `<div class="tbl-wrap"><table class="tbl criteria-tbl"><thead><tr><th class="c" style="width:44px">순서</th><th style="width:21%">그룹명</th><th>포함 출장지</th><th class="c" style="width:64px">기본 그룹</th><th class="r" style="width:172px">관리</th></tr></thead><tbody>
      ${list.map((r, i) => `<tr><td class="c num">${i + 1}</td><td><span class="nm">${esc(r.name)}</span></td>
        <td>${r.isDefault ? '<span class="dim">위 그룹에 속하지 않은 모든 출장지</span>' : r.places.length ? chips(r.places) : '<span class="dim">포함 출장지 없음</span>'}</td>
        <td class="c">${r.isDefault ? h.badge('blue', '기본') : '<span class="dim">-</span>'}</td>
        <td class="act">${ord('r', r.id, i, list.filter((x) => !x.isDefault).length, r.isDefault, r.name)}<button type="button" class="btn sm" data-act="r-edit" data-id="${r.id}" aria-label="${esc(r.name)} 수정">수정</button><button type="button" class="btn sm danger" data-act="r-del" data-id="${r.id}" aria-label="${esc(r.name)} 삭제">삭제</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="criteria-foot"><span>같은 국가의 '전체'와 '도시'가 서로 다른 그룹에 있으면 도시가 속한 그룹이 우선 적용됩니다.</span></div>`
      : emptyBox('등록된 지역 그룹이 없습니다', '출장지 관리의 국가·도시를 묶어 지역 그룹을 만들거나, 다른 법인의 기준을 복사해 시작할 수 있습니다.', 'r-add', '지역 그룹 추가', false, true, '');
    return `<section class="sec" aria-labelledby="criteria-h-r"><div class="criteria-hd"><div><h2 class="sec-title" id="criteria-h-r">지역 그룹<em>${list.length}</em>${h.mk(9)}</h2><p class="sec-desc">출장지 관리에 등록된 국가·도시를 묶습니다. 여비규정 값 표에서 지역별로 값이 다른 항목(숙박·식비 등)의 열로 쓰입니다.</p></div>
      <div class="row">${list.length ? `<button type="button" class="btn" data-act="r-add">지역 그룹 추가</button>${h.mk(10)}` : ''}</div></div>${body}</section>`;
  }

  function render(ctx) {
    const code = ctx.code;
    if (st.code !== code) st = { code, exFilter: 'all', focus: null };
    const live = livePolicies(code), ps = h.policyState(code);
    const intro = live.length
      ? `<b>${esc(live.map(polLabel).join(', '))}</b>이(가) 이 기준을 사용하고 있습니다. 등급·지역 그룹을 추가·삭제하거나 이름을 바꾸면 다음 개정 버전의 값 표부터 반영됩니다.`
      : `이 법인에는 적용 중·예정인 여비규정이 없습니다. ${ps.draft ? '임시저장 중인 규정이 있습니다. ' : ''}여기서 정한 등급·지역 그룹이 여비규정 값 표의 행·열이 됩니다.`;
    return `<div class="criteria-intro">${h.mk(1)}<span class="grow">${intro}</span>${h.policyBadge(code)}<button type="button" class="link" data-act="go-policy">여비규정 보기</button></div>
      ${secGrades(code)}${secExceptions(code)}${secRegions(code)}`;
  }

  function mount(root, ctx) {
    const code = ctx.code;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
      const id = b.dataset.id;
      switch (b.dataset.act) {
        case 'go-policy': App.go(null, 'policy'); break;
        case 'copy': openCopy(code); break;
        case 'g-add': openGrade(code); break;
        case 'g-edit': openGrade(code, id); break;
        case 'g-del': deleteGrade(code, id); break;
        case 'g-up': move(code, 'g', id, -1); break;
        case 'g-down': move(code, 'g', id, 1); break;
        case 'x-add': openException(code); break;
        case 'x-edit': openException(code, id); break;
        case 'x-del': releaseException(code, id); break;
        case 'r-add': openRegion(code); break;
        case 'r-edit': openRegion(code, id); break;
        case 'r-del': deleteRegion(code, id); break;
        case 'r-up': move(code, 'r', id, -1); break;
        case 'r-down': move(code, 'r', id, 1); break;
      }
    });
    root.addEventListener('change', (e) => { if (e.target.dataset.act === 'ex-filter') { st.exFilter = e.target.value; st.focus = '[data-act="ex-filter"]'; App.render(); } });
    if (st.focus) {
      let f = root.querySelector(st.focus);
      if (f && f.disabled) f = f.parentElement.querySelector('button:not(:disabled)');
      st.focus = null; if (f) f.focus();
    }
  }

  /* ================= Description ================= */
  function desc(ctx) {
    const c = ctx.code;
    return {
      title: '등급 · 지역 기준',
      summary: `${c} 법인의 여비규정에서 쓰는 구성원 등급(값 표의 행)과 지역 그룹(값 표의 열), 그리고 구성원 개인 예외 지정을 관리한다.`,
      items: [
        { no: 1, title: '여비규정 연결 안내', body: `<ul>
          <li>적용 중·적용 예정인 여비규정 버전이 있으면 버전명과 함께 "이 기준을 사용하고 있음 / 변경은 다음 개정 버전부터 반영"을 안내한다. 없으면 "적용 중·예정인 여비규정이 없음"을 안내한다(임시저장 버전이 있으면 그 사실을 덧붙인다).</li>
          <li>우측에 좌측 법인 목록과 같은 여비규정 상태 배지를 보여준다.</li>
          <li><code>여비규정 보기</code> 클릭 시 같은 법인의 여비규정 탭(TRIP-ADM-CORP-03)으로 이동한다.</li></ul>` },
        { no: 2, title: '구성원 등급 표', body: `<ul>
          <li>컬럼: 순서 / 등급명 / 설명 / 매핑된 인사정보 직급·직책(칩, 매핑 순) / 구성원 수 / 기본 등급 / 관리. 정렬은 관리자가 정한 순서이며, 이 순서가 여비규정 값 표의 행 순서가 된다.</li>
          <li>제목 옆 숫자는 등록된 등급 수.</li>
          <li><b>구성원 수</b>: 인사정보 연동 시점 기준 집계값(표 아래에 합계와 기준 시각 표기). 새로 추가했거나 복사해 온 등급은 다음 집계 전까지 <code>집계 전</code>으로 표시한다. 이 화면에서 매핑을 바꿔도 숫자는 즉시 바뀌지 않는다.</li>
          <li><b>기본 등급</b>: 어느 등급에도 매핑되지 않은 직급의 구성원이 속하는 등급. 법인당 정확히 1개이며 <code>기본</code> 배지로 표시한다. 매핑 직급이 하나도 없는 기본 등급은 "매핑 직급 없음 (미매핑 직급 전체)"로 표기한다.</li>
          <li>설명이 없으면 <code>-</code>.</li>
          <li>빈 상태: 11번 참고.</li></ul>` },
        { no: 3, title: '등급 추가 · 수정 모달', body: `<ul>
          <li><b>등급명</b>(필수): 최대 ${LIM.gname}자, 앞뒤 공백 제거. 같은 법인 안에서 대소문자 구분 없이 중복 불가. 미입력 "등급명을 입력해 주세요.", 중복 "같은 이름의 등급이 이미 있습니다."를 입력란 아래에 표시하고 해당 입력란으로 포커스를 옮긴다.</li>
          <li><b>설명</b>(선택): 최대 ${LIM.gdesc}자.</li>
          <li><b>매핑 직급/직책</b>(선택, 다중 선택): 해당 법인의 인사정보 직급/직책 전체를 체크박스로 나열한다. 다른 등급에 이미 매핑된 직급은 비활성 + "{등급명}에 매핑됨"으로 표시한다(옮기려면 원래 등급에서 먼저 해제). 0개 선택도 저장할 수 있다.</li>
          <li><b>기본 등급 지정</b>: 기본값 미선택. 선택 후 저장하면 기존 기본 등급은 자동 해제된다. 법인의 첫 등급, 그리고 현재 기본 등급을 수정할 때는 선택 + 비활성(해제 불가)이다.</li>
          <li>수정 시 변경된 내용이 없으면 저장하지 않고 "변경된 내용이 없습니다." 토스트만 띄운다.</li>
          <li>적용 중·예정 여비규정이 있는 법인은 모달 상단에 영향 안내를 보여준다. 수정 대상 등급명이 여비규정 값 표의 행으로 쓰이고 있으면 "여비규정 vN(적용 중)에서 사용 중인 기준입니다. 변경 내용은 다음 개정 버전부터 반영됩니다."</li>
          <li>저장 시 변경 이력(구성원 등급)에 등급명 변경 전→후, 매핑 추가/해제 직급, 기본 등급 지정을 기록한다.</li></ul>` },
        { no: 4, title: '순서 변경 · 삭제', body: `<ul>
          <li><b>순서 변경</b>: ▲/▼ 버튼으로 한 칸씩 이동, 누르는 즉시 저장한다. 첫 행의 ▲, 마지막 행의 ▼는 비활성. 이동 후에도 포커스는 같은 버튼에 남아 키보드로 연속 이동할 수 있다.</li>
          <li><b>삭제</b>: 확인 모달을 거친다. 매핑돼 있던 직급은 미매핑 상태가 되어 기본 등급이 적용됨을 안내하고, 여비규정에서 사용 중인 등급이면 경고 문구(1번과 동일 문구 + "값 표에는 이 등급 행이 그대로 남습니다")를 함께 보여준다.</li>
          <li>삭제 불가 ①: 기본 등급(다른 등급이 남아 있는 동안). 다른 등급을 기본으로 지정한 뒤 삭제하도록 안내한다. 등급이 1개만 남았을 때는 그 등급도 삭제할 수 있다(빈 상태로 돌아감).</li>
          <li>삭제 불가 ②: 개인 예외 지정의 적용 등급으로 쓰이고 있는 등급. 해당 구성원 목록을 보여주고 예외 지정을 먼저 해제하도록 안내한다.</li></ul>` },
        { no: 5, title: '미매핑 직급 안내', body: `<ul>
          <li>인사정보 직급/직책 중 어느 등급에도 매핑되지 않은 값이 있으면 "미매핑 직급 N개 → 기본 등급 {등급명} 적용"과 해당 직급명을 주황 유의 문구로 나열한다.</li>
          <li>미매핑 직급이 없으면 "모든 인사정보 직급이 등급에 매핑되어 있습니다."로 바뀐다.</li>
          <li>등급이 하나도 없으면 노출하지 않는다.</li></ul>` },
        { no: 6, title: '개인 예외 지정 표', body: `<ul>
          <li>컬럼: 구성원(이름·사번) / 소속·인사정보 직급 / 매핑 등급 → 적용 등급 / 사유 / 적용 기간·상태 / 등록(등록자·등록일) / 관리. 기본 정렬은 등록일 최신순.</li>
          <li><b>매핑 등급</b>은 저장값이 아니라 조회 시점의 직급 매핑으로 계산해 보여준다. 매핑이 바뀌어 적용 등급과 같아지면 "매핑 등급과 같아짐 · 해제 검토" 유의 문구를 표시한다(자동 해제하지 않음).</li>
          <li><b>상태</b>(오늘 기준): 시작일이 미래면 <code>예정</code>, 종료일이 지났으면 <code>만료</code>, 그 외 <code>적용 중</code>. 적용 중이면서 종료일까지 ${SOON_DAYS}일 이하로 남으면 <code>종료 임박 D-n</code>을 함께 표시한다. 종료일이 없으면 기간에 "무기한"으로 표기한다.</li>
          <li>만료 건은 자동 삭제하지 않고 흐리게 표시한다. 상태 필터(전체/적용 중/예정/만료, 기본 전체)는 예외 지정이 1건 이상일 때만 노출하며 법인을 바꾸면 전체로 초기화된다.</li>
          <li>빈 상태: "개인 예외 지정이 없습니다". 필터 결과가 0건이면 별도 문구로 구분한다.</li></ul>` },
        { no: 7, title: '예외 지정 추가 · 수정 모달', body: `<ul>
          <li>[예외 지정 추가]는 구성원 등급이 2개 이상일 때만 활성화된다.</li>
          <li><b>구성원</b>(필수): 해당 법인 구성원을 이름 또는 사번 부분 일치로 검색한다(대소문자 무시). 결과 행에 소속·직급·현재 매핑 등급을 보여주고, 이미 예외 지정된 구성원은 비활성 + <code>이미 지정됨</code>으로 표시한다(중복 지정 불가). 선택하면 소속·인사정보 직급·현재 매핑 등급을 자동 표시하며 [다시 선택]으로 바꿀 수 있다. 수정 모드에서는 구성원을 바꿀 수 없다.</li>
          <li><b>적용 등급</b>(필수): 구성원 선택 전에는 비활성. 현재 매핑 등급은 선택지에서 비활성 처리한다.</li>
          <li><b>사유</b>(필수): 최대 ${LIM.reason}자.</li>
          <li><b>적용 기간</b>: 시작일 필수(기본값 오늘), 종료일 선택(비우면 무기한). 종료일은 시작일 이상이면서 오늘 이상이어야 한다.</li>
          <li>검증 실패 시 해당 항목 아래에 오류 문구를 표시하고 모달을 닫지 않는다.</li>
          <li>등록자·등록일은 로그인한 관리자·오늘 날짜로 자동 기록한다.</li></ul>` },
        { no: 8, title: '예외 지정 수정 · 해제', body: `<ul>
          <li><b>수정</b>: 적용 등급·사유·적용 기간을 바꿀 수 있다(기간 연장 포함). 변경 항목별로 이력을 남긴다.</li>
          <li><b>해제</b>: 확인 모달에서 "해제 즉시 직급 매핑 등급 {등급명} 적용"을 안내한 뒤 표에서 제거한다. 해제 내역은 변경 이력에서만 확인할 수 있다.</li></ul>` },
        { no: 9, title: '지역 그룹 표', body: `<ul>
          <li>컬럼: 순서 / 그룹명 / 포함 출장지(칩) / 기본 그룹 / 관리. 이 순서가 여비규정 값 표의 열 순서가 된다.</li>
          <li><b>기본 그룹</b>: 어느 그룹에도 속하지 않은 출장지에 적용되는 '그 외' 그룹. 법인당 1개, 항상 마지막 행에 고정(순서 변경 불가)되고 출장지를 지정할 수 없다. 포함 출장지 칸에는 "위 그룹에 속하지 않은 모든 출장지"로 표기한다.</li>
          <li>순서 변경·삭제 동작은 4번과 같다. 기본 그룹은 다른 그룹이 남아 있는 동안 삭제할 수 없고, 그룹을 삭제하면 포함돼 있던 출장지는 기본 그룹(또는 같은 국가 '전체'가 속한 그룹) 기준을 따른다고 안내한다.</li>
          <li>표 아래에 "국가 전체 vs 도시 → 도시 우선" 규칙을 상시 안내한다.</li></ul>` },
        { no: 10, title: '지역 그룹 추가 · 수정 모달', body: `<ul>
          <li><b>그룹명</b>(필수): 최대 ${LIM.rname}자, 같은 법인 안에서 대소문자 구분 없이 중복 불가.</li>
          <li><b>포함 출장지</b>(필수, 1개 이상): 좌측 국가 목록(검색 가능, 선택 수 표시) → 우측에 "국가 전체"와 그 국가의 도시 체크박스. 선택한 출장지는 위쪽 칩으로 모아 보여주고 ×로 제외할 수 있다.</li>
          <li>한 출장지는 한 그룹에만 속한다. 다른 그룹에 들어 있는 출장지는 비활성 + "{그룹명} 그룹에 포함됨".</li>
          <li>이 그룹에서 "국가 전체"를 선택하면 같은 국가의 도시 선택은 해제되고 "국가 전체에 포함"으로 비활성 처리한다(다른 그룹에 속한 도시는 그대로 둠).</li>
          <li>"국가 전체"가 다른 그룹에 있어도 도시는 따로 선택할 수 있으며, 이 경우 도시가 속한 그룹이 우선 적용된다는 안내를 보여준다.</li>
          <li>기본 그룹 수정 시에는 그룹명만 바꿀 수 있고 출장지 선택 영역 대신 안내 문구를 보여준다.</li>
          <li>지역 그룹이 하나도 없는 법인에서 첫 그룹을 추가하면 기본 그룹 '그 외 지역'을 함께 생성한다.</li>
          <li>상단 영향 안내와 변경 이력 기록(지역 그룹: 그룹명 변경 전→후, 추가/제외 출장지)은 3번과 같다.</li></ul>` },
        { no: 11, title: '빈 상태 · 다른 법인 기준 복사', body: `<ul>
          <li>등급 또는 지역 그룹이 0건이면 해당 섹션에 빈 상태 문구와 [추가] · [다른 법인 기준 복사해 오기] 버튼을 보여준다(섹션 우상단 추가 버튼은 숨김). 개인 예외 지정 섹션은 등급이 2개 미만이면 추가 버튼을 비활성화한다.</li>
          <li><b>복사 모달</b>: 가져올 법인(등급 또는 지역 그룹이 1건 이상인 다른 법인만, 건수 표기) 선택 → 복사 대상(구성원 등급 / 지역 그룹, 기본값 둘 다 선택) 확인. 법인을 바꾸면 복사될 항목 이름 미리보기가 갱신된다.</li>
          <li>이미 기준이 등록된 대상은 비활성(덮어쓰기 없음). 대상이 하나도 선택되지 않으면 복사할 수 없다.</li>
          <li>등급은 등급명·설명·순서·기본 등급 여부만 복사하고 <b>직급 매핑은 비워 둔다</b>(법인마다 직급 코드가 다름). 구성원 수는 "집계 전". 지역 그룹은 그룹명·포함 출장지·순서·기본 그룹을 그대로 복사한다. 개인 예외 지정·여비규정 값은 복사하지 않는다.</li>
          <li>복사 후 "직급 매핑을 진행해 주세요" 토스트를 띄우고 이력에 원본 법인을 기록한다.</li></ul>` },
      ],
      policies: [
        '구성원 등급은 법인별로 정의하고 <b>인사정보 직급/직책에 매핑</b>해 자동 판정한다. 한 직급은 한 등급에만 매핑되며, 매핑되지 않은 직급은 기본 등급으로 본다.',
        '특정 구성원은 <b>개인 예외 지정</b>으로 직급 매핑과 다른 등급을 받을 수 있다. 적용 기간 동안 예외 지정이 직급 매핑보다 우선한다.',
        '등급·지역 기준은 여비규정 값 표의 행·열을 정하는 <b>기준 정보</b>다. 여비규정은 기준 정보 관리·구성원 안내용이므로, 이 화면의 등급·지역 그룹으로 출장 계획서를 자동 검증하거나 차단하지 않는다.',
        '본사(HYB) 출장 관리자만 전 법인의 기준을 조회·변경한다. 법인별 담당자 권한은 없다.',
        '등급·예외 지정·지역 그룹의 추가·수정·삭제·순서 변경·복사는 모두 저장 즉시 반영되고 변경 이력(구분: 구성원 등급 / 지역 그룹)에 남는다.',
      ],
      issues: [
        '<b>매핑 키</b> — 인사정보에서 가져와 등급에 매핑하는 값이 직급인지 직책인지(또는 둘 다인지), 법인별 코드 체계와 연동 필드를 인사정보 담당과 확인해야 한다. 화면은 임시로 한 목록에 섞어 보여준다.',
        '<b>직급 변경 시 예외 지정</b> — 발령·겸직으로 구성원의 직급이 바뀌었을 때 기존 예외 지정을 유지할지, 자동 해제할지, 관리자에게 알릴지 미정. 프로토타입은 유지하되 매핑 등급과 같아지면 유의 문구만 표시한다. 겸직자의 직급을 무엇으로 볼지도 미정.',
        '<b>예외 지정 승인 절차</b> — 관리자가 바로 등록하면 되는지, 결재(예: 법인 재무 책임자 승인)나 증빙 첨부가 필요한지 미정. 시작일을 과거로 넣는 소급 지정을 허용할지도 함께 정해야 한다(프로토타입은 허용).',
        '<b>기준 변경이 적용 중 여비규정에 미치는 영향</b> — 등급·지역 그룹을 추가·삭제·이름 변경했을 때 적용 중·예정 버전의 값 표를 그대로 둘지(프로토타입: "다음 개정 버전부터 반영"), 즉시 행·열을 맞출지, 사용 중인 기준은 삭제를 막을지 결정 필요.',
        '<b>지역 그룹 ↔ 출장지 관리 동기화</b> — 출장지 관리에서 국가·도시가 추가·사용 OFF·삭제·이름 변경될 때 지역 그룹의 포함 출장지를 어떻게 처리할지 미정. 현재 샘플 데이터는 출장지를 코드가 아닌 문자열로 갖고 있어 연동 키(출장지 코드)도 정해야 한다.',
        '<b>구성원 수 집계 시점</b> — 인사정보 동기화(매일 06:00) 때만 집계할지, 매핑 변경 즉시 재집계할지, 개인 예외 지정을 반영한 수로 볼지 미정.',
        '<b>만료된 예외 지정 보관</b> — 만료 건을 표에 계속 둘지, 일정 기간 뒤 숨길지, 종료 임박(현재 ' + SOON_DAYS + '일 전) 알림을 관리자에게 보낼지 미정.',
        '<b>도시 우선 규칙의 세부</b> — "국가 전체"와 도시가 다른 그룹일 때 도시 우선은 반영했으나, 출장지 관리에 도시로 등록되지 않은 지역(예: HBJ 규정의 도쿄 근교 조건부 국내출장)처럼 조건이 붙는 경우를 어떻게 표현할지 미정.',
      ],
    };
  }

  App.views.criteria = { render, mount, desc };
})();
