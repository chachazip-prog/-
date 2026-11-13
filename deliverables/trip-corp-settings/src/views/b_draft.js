/* TRIP-ADM-CORP-02 법인별 기안 항목 설정
   공통 로직(전체 법인 표에서도 사용): App.views.draft.requestToggle(code, key), .isUnset(corp), .lastChange(corp) */
(function () {
  const D = App.D, h = App.h, ui = App.ui;

  /* 결재 진행 중 기안 건수 / 임시저장 기안 건수 — 화면 예시용 샘플 숫자 */
  const TEMP_SAVED = { HYB: 12, HBA: 2, HBL: 0, HBJ: 3, HBC: 0, HBI: 0 };
  const IN_PROGRESS = { HYB: 37, HBA: 6, HBL: 1, HBJ: 9, HBC: 0, HBI: 0 };
  /* 미리보기의 예상 비용 샘플 값 (법인 기준 통화) */
  const SAMPLE_COST = { KRW: 410000, USD: 1200, JPY: 98000, CNY: 5200, INR: 64000 };

  let lastCode = null;
  let showHidden = true; // 미리보기: 미노출 항목 표시

  const items = () => D.draftItems;
  const isUnset = (corp) => items().every((i) => !corp.draft[i.key].at);
  const onCount = (corp) => items().filter((i) => corp.draft[i.key].on).length;
  const onOff = (on) => (on ? 'ON' : 'OFF');
  const stateBadge = (on) => h.badge(on ? 'blue' : 'gray', on ? 'ON · 사용' : 'OFF · 미사용');
  function lastChange(corp) {
    let best = null;
    items().forEach((i) => { const v = corp.draft[i.key]; if (v.at && (!best || v.at > best.at)) best = v; });
    return best;
  }
  const summaryText = (corp, over) => items().map((i) => `${i.name} ${onOff(over && i.key in over ? over[i.key] : corp.draft[i.key].on)}`).join(', ');

  function rerender(focusSel) {
    App.render();
    if (focusSel) { const el = document.querySelector(focusSel); if (el) el.focus(); }
  }

  /* ---------- 토글 변경 확인 모달 (공통) ---------- */
  function requestToggle(code, key) {
    const corp = h.corp(code); const item = items().find((i) => i.key === key);
    if (!corp || !item) return;
    const cur = corp.draft[key].on, next = !cur, first = isUnset(corp);
    const n = IN_PROGRESS[code] || 0, tmp = TEMP_SAVED[code] || 0;
    const willAllOff = !next && onCount(corp) === 1;
    const effect = next ? `기안 화면에 [${item.name}] 섹션 노출 · ${item.link}` : item.offEffect;
    const body = `
      <div class="draft-cf">
        <div class="frow"><span class="lb">법인</span><span><b>${corp.code}</b> ${h.esc(corp.name)}</span></div>
        <div class="frow"><span class="lb">항목</span><span><b>${h.esc(item.name)}</b></span></div>
        <div class="frow"><span class="lb">변경 내용${h.mk(7)}</span><span class="draft-cf-chg">${stateBadge(cur)}<span class="draft-arrow">→</span>${stateBadge(next)}</span></div>
        <div class="frow"><span class="lb">구성원 화면</span><span>${h.esc(effect)}</span></div>
        <div class="frow"><span class="lb">적용 시점</span><span>저장 즉시 <b>신규 기안부터</b> 적용<br><span class="help">결재 진행 중 기안 <b class="hl-blue num">${n}건</b>은 작성 당시 설정을 유지합니다.</span></span></div>
        ${!next ? `<div class="frow"><span class="lb">임시저장 기안</span><span><b class="num" style="color:var(--red)">${tmp}건 삭제</b><br><span class="help">${corp.code} 구성원이 임시저장해 둔 출장 기안은 OFF 전환과 동시에 삭제되며 복구할 수 없습니다.</span></span></div>` : ''}
      </div>
      ${first ? `<p class="note draft-cf-note">${corp.code}의 최초 설정으로 기록됩니다. 나머지 항목은 현재 값(OFF)으로 함께 확정됩니다.</p>` : ''}
      ${willAllOff ? '<p class="note draft-cf-note">3개 항목이 모두 OFF가 됩니다. 구성원은 기본 정보(제목 · 출장 계획서 · 출장 기간)만으로 결재를 상신합니다.</p>' : ''}`;
    ui.modal({
      title: '기안 항목 사용 여부 변경', body, width: 460,
      actions: [
        { label: '취소' },
        { label: next ? 'ON으로 변경' : 'OFF로 변경', primary: true, onClick() {
          const at = h.now();
          if (first) {
            items().forEach((i) => { corp.draft[i.key] = { on: i.key === key ? next : corp.draft[i.key].on, at, by: D.admin }; });
            App.log(code, '기안 항목', '법인 최초 설정 — ' + summaryText(corp));
          } else {
            corp.draft[key] = { on: next, at, by: D.admin };
            App.log(code, '기안 항목', `${item.name} ${onOff(cur)} → ${onOff(next)}` + (!next ? ` · 임시저장 기안 ${tmp}건 삭제` : ''));
          }
          if (!next) TEMP_SAVED[code] = 0;
          ui.closeModal();
          rerender(`[data-tg="${code}:${key}"]`);
          ui.toast(`${code} · ${item.name}을(를) ${onOff(next)}(으)로 변경했습니다. 신규 기안부터 적용됩니다.` + (!next && tmp ? ` 임시저장 기안 ${tmp}건을 삭제했습니다.` : ''));
        } },
      ],
    });
  }

  /* 미설정 법인: 현재 값(전부 OFF)을 그대로 최초 설정으로 확정 */
  function confirmInitial(corp) {
    ui.confirm('최초 설정 저장', `<p class="draft-cf-p"><b>${corp.code}</b> ${h.esc(corp.name)}의 기안 항목을 현재 값으로 확정합니다.</p>
      <div class="draft-cf">${items().map((i) => `<div class="frow"><span class="lb">${h.esc(i.name)}</span><span>${stateBadge(corp.draft[i.key].on)}</span></div>`).join('')}</div>
      <p class="help draft-cf-note">저장 후에도 항목별 토글로 언제든 변경할 수 있습니다.</p>`, '저장', () => {
      const at = h.now();
      items().forEach((i) => { corp.draft[i.key] = { on: corp.draft[i.key].on, at, by: D.admin }; });
      App.log(corp.code, '기안 항목', '법인 최초 설정 — ' + summaryText(corp));
      ui.closeModal(); rerender('[data-copy]');
      ui.toast(`${corp.code} 기안 항목 최초 설정을 저장했습니다.`);
    });
  }

  /* ---------- 다른 법인 설정 복사 ---------- */
  function openCopy(corp) {
    const sources = D.corps.filter((c) => c.code !== corp.code && !isUnset(c));
    if (!sources.length) { ui.toast('복사할 수 있는 법인이 없습니다.'); return; }
    const table = (src) => `<table class="tbl draft-copy-tbl"><thead><tr><th>항목</th><th class="c">현재 (${corp.code})</th><th class="c">복사 후 (${src.code})</th><th class="c">변경</th></tr></thead><tbody>
      ${items().map((i) => { const a = corp.draft[i.key].on, b = src.draft[i.key].on; return `<tr><td><b>${h.esc(i.name)}</b></td><td class="c">${onOff(a)}</td><td class="c"><b>${onOff(b)}</b></td><td class="c">${a === b ? '<span class="dim">변경 없음</span>' : h.badge('blue', '변경')}</td></tr>`; }).join('')}
      </tbody></table>`;
    const n = IN_PROGRESS[corp.code] || 0;
    const m = ui.modal({
      title: '다른 법인 설정 복사', width: 500,
      body: `<div class="frow"><label class="lb req" for="draft-copy-src">가져올 법인</label>
          <select class="sel" id="draft-copy-src">${sources.map((c) => `<option value="${c.code}">${c.code} · ${h.esc(c.name)} (사용 ${onCount(c)}/${items().length})</option>`).join('')}</select></div>
        <div id="draft-copy-diff" class="draft-copy-diff">${table(sources[0])}</div>
        <p class="help draft-cf-note">기안 항목 사용 여부(ON/OFF)만 복사합니다. 여비규정 · 등급 · 지역 기준은 복사하지 않습니다.<br>저장 즉시 신규 기안부터 적용되며, 결재 진행 중 기안 <b class="num">${n}건</b>은 작성 당시 설정을 유지합니다.<br>OFF로 바뀌는 항목이 있으면 임시저장 기안 <b class="num">${TEMP_SAVED[corp.code] || 0}건</b>이 삭제됩니다.</p>`,
      actions: [
        { label: '취소' },
        { label: '복사 적용', primary: true, onClick(el) {
          const src = h.corp(el.querySelector('#draft-copy-src').value);
          const first = isUnset(corp);
          const diff = items().filter((i) => corp.draft[i.key].on !== src.draft[i.key].on);
          if (!diff.length && !first) { ui.toast('현재 설정과 동일해 변경할 내용이 없습니다.'); return false; }
          const at = h.now();
          if (first) {
            items().forEach((i) => { corp.draft[i.key] = { on: src.draft[i.key].on, at, by: D.admin }; });
            App.log(corp.code, '기안 항목', `법인 최초 설정 (${src.code} 설정 복사) — ` + summaryText(corp));
          } else {
            diff.forEach((i) => {
              const cur = corp.draft[i.key].on;
              corp.draft[i.key] = { on: !cur, at, by: D.admin };
              App.log(corp.code, '기안 항목', `${i.name} ${onOff(cur)} → ${onOff(!cur)} (${src.code} 설정 복사)` + (cur ? ` · 임시저장 기안 ${TEMP_SAVED[corp.code] || 0}건 삭제` : ''));
              if (cur) TEMP_SAVED[corp.code] = 0;
            });
          }
          ui.closeModal(); rerender('[data-copy]');
          ui.toast(`${src.code} 설정을 ${corp.code}에 복사했습니다. 신규 기안부터 적용됩니다.`);
        } },
      ],
    });
    const sel = m.querySelector('#draft-copy-src');
    sel.onchange = () => { m.querySelector('#draft-copy-diff').innerHTML = table(h.corp(sel.value)); };
  }

  /* ---------- 좌: 설정 목록 ---------- */
  function changed(v) {
    if (!v.at) return h.badge('orange', '미설정');
    const [d, t] = v.at.split(' ');
    return `<span class="num">${d}</span>${t ? ` <span class="num dim">${t}</span>` : ''}<br><span class="dim">${h.esc(v.by || '')}</span>`;
  }
  function settingRows(corp) {
    return items().map((i, idx) => {
      const v = corp.draft[i.key];
      return `<tr class="${v.on ? '' : 'draft-off'}">
        <td>
          <div class="draft-nm">${h.esc(i.name)}</div>
          <div class="draft-ds">${h.esc(i.desc)}</div>
          <div class="draft-meta"><span class="badge line">${h.esc(i.link)}</span></div>
          <div class="draft-eff ${v.on ? '' : 'now'}"><b>OFF 시</b> ${h.esc(i.offEffect)}</div>
        </td>
        <td class="draft-tgc">${h.toggle(v.on, `data-tg="${corp.code}:${i.key}" aria-label="${h.esc(i.name)} 사용 여부"`)}${idx === 0 ? h.mk(3) : ''}</td>
        <td class="draft-chg">${changed(v)}${idx === 0 ? h.mk(4) : ''}</td>
      </tr>`;
    }).join('');
  }

  /* ---------- 우: 구성원 기안 화면 미리보기 ---------- */
  function pvSection(corp, key, inner) {
    const i = items().find((x) => x.key === key); const on = corp.draft[key].on;
    if (!on && !showHidden) return '';
    if (!on) return `<div class="draft-pv-sec off"><div class="draft-pv-st">${h.esc(i.name)} ${h.badge('gray', '미노출')}</div><p class="draft-pv-sd">OFF — 구성원 기안 화면에 표시되지 않습니다.</p></div>`;
    return `<div class="draft-pv-sec"><div class="draft-pv-st">${h.esc(i.name)}</div>${inner}</div>`;
  }
  function preview(corp) {
    const cost = h.money(SAMPLE_COST[corp.cur] || 1000, corp.cur);
    const on = onCount(corp);
    const fake = (t) => `<span class="draft-pv-btn">${t}</span>`;
    return `
      <div class="draft-pv" aria-label="구성원 기안 화면 미리보기">
        <div class="draft-pv-top"><span class="draft-pv-title">출장 기안</span><span class="draft-pv-acts">${fake('취소')}${fake('임시 저장')}<span class="draft-pv-btn pri">결재 상신</span></span></div>
        <div class="draft-pv-base">
          <div class="draft-pv-row"><span class="lb req">제목</span><span class="draft-pv-inp">출장 기안 제목</span></div>
          <div class="draft-pv-row"><span class="lb">출장 계획서</span><span class="draft-pv-lnk">연결된 출장 계획서</span></div>
          <div class="draft-pv-row"><span class="lb">출장 기간</span><span class="num">2026.11.23 ~ 2026.11.27</span></div>
        </div>
        ${pvSection(corp, 'budget', `<p class="draft-pv-sd">출장에 사용할 예산을 추가하려면 우측 예산 추가를 클릭해 입력해주세요.</p>
          <div class="draft-pv-line"><span class="chip">출장 계획서 기준 예상 비용 <b class="num">${cost}</b></span><span class="chip">신청한 출장 예산 총 합계 <b class="draft-pv-zero num">${h.money(0, corp.cur)}</b></span></div>
          <div class="draft-pv-line">${fake('예산 불러오기')}${fake('신규 WBS 예산 신청')}${fake('신규 판관/자산 예산 신청')}${fake('+ 예산 추가')}</div>`)}
        ${pvSection(corp, 'card', `<p class="draft-pv-sd">출장비용을 결제할 법인카드의 한도 증액이 필요한 경우, 카드 추가 버튼을 눌러 증액을 신청하세요.</p>
          <div class="draft-pv-line"><span class="chip">출장 계획서 기준 예상 비용 <b class="num">${cost}</b></span>${fake('+ 카드 추가')}</div>`)}
        ${pvSection(corp, 'attendance', `<p class="draft-pv-sd">출장 근태를 신청하면 별도의 출/퇴근 시간을 입력하지 않아도 됩니다.</p>
          <div class="draft-pv-row"><span class="lb">근태코드</span><span class="draft-pv-inp dis">출장</span></div>
          <div class="draft-pv-row"><span class="lb">구분</span><span class="draft-pv-inp dis">해외</span></div>
          <div class="draft-pv-row"><span class="lb">지역</span><span class="draft-pv-two"><span class="draft-pv-inp dis">국가</span><span class="draft-pv-inp dis">도시/지역</span></span></div>
          <div class="draft-pv-row"><span class="lb">근태 신청자</span><span>총 출장자 <b>1명</b></span></div>`)}
        ${on === 0 ? `<div class="draft-pv-none">추가 항목 없음 — 기본 정보만으로 결재 상신</div>` : ''}
        <div class="draft-pv-etc"><span class="draft-pv-chk"></span>[필수] 플라잉닥터스 앱 설치 및 회원가입을 완료하였습니다. <span class="dim">(이 설정과 무관 · 현행 유지)</span></div>
      </div>`;
  }

  /* ---------- view ---------- */
  App.views.draft = {
    requestToggle, isUnset, lastChange,
    render(ctx) {
      const corp = ctx.corp;
      if (lastCode !== ctx.code) { lastCode = ctx.code; showHidden = true; }
      const unset = isUnset(corp), on = onCount(corp), total = items().length, last = lastChange(corp);
      const n = IN_PROGRESS[corp.code] || 0;
      return `
      <div class="draft-wrap">
        <div class="row between wrap draft-head">
          <div class="grow">
            <h3 class="sec-title">기안 항목 설정${h.mk(1)}</h3>
            <p class="sec-desc">구성원 <b>출장 기안</b> 화면에 노출할 항목을 법인별로 설정합니다. 변경은 저장 즉시 신규 기안부터 적용됩니다.</p>
          </div>
          <button type="button" class="btn" data-copy>다른 법인 설정 복사</button>${h.mk(5)}
        </div>
        <div class="chips draft-chips">
          <span class="chip">사용 항목 <b class="num"><span class="hl-blue">${on}</span> / ${total}</b></span>
          <span class="chip">최종 변경 <b class="num">${last ? h.esc(last.at) + ' · ' + h.esc(last.by) : '-'}</b></span>
          <span class="chip">결재 진행 중 기안 <b class="num">${n}건</b></span>
          <span class="chip">임시저장 기안 <b class="num">${TEMP_SAVED[corp.code] || 0}건</b></span>
        </div>
        ${unset ? `<div class="draft-notice"><div class="grow"><b>아직 기안 항목을 설정하지 않은 법인입니다.</b><br>설정 전에는 3개 항목이 모두 <b>OFF(기본값)</b>로 동작해, 구성원 기안 화면에 기본 정보만 노출됩니다. 항목별 토글을 변경하거나, 현재 값 그대로 확정하려면 최초 설정을 저장하세요.</div><button type="button" class="btn sm" data-init>현재 값으로 최초 설정 저장</button>${h.mk(2)}</div>` : ''}
        ${!unset && on === 0 ? `<div class="draft-notice"><div class="grow"><b>3개 항목이 모두 OFF입니다.</b><br>${corp.code} 구성원은 기본 정보(제목 · 출장 계획서 · 출장 기간)만으로 결재를 상신합니다. 예산 · 법인카드 한도 · 근태는 법인 자체 절차로 처리됩니다.</div>${h.mk(2)}</div>` : ''}
        <div class="draft-cols">
          <div class="draft-left">
            <table class="tbl draft-tbl">
              <thead><tr><th>항목</th><th class="draft-tgc">사용 여부</th><th class="draft-chg">최종 변경</th></tr></thead>
              <tbody>${settingRows(corp)}</tbody>
            </table>
            <p class="note draft-foot">결재 진행 중 기안(${n}건)은 작성 당시 설정을 유지합니다. 항목을 OFF로 바꾸면 임시저장 기안(${TEMP_SAVED[corp.code] || 0}건)은 삭제됩니다. 모든 변경은 <button type="button" class="link" data-history>변경 이력</button>에 기록됩니다.</p>
          </div>
          <div class="draft-right">
            <div class="row between draft-pv-head">
              <h4 class="draft-pv-h">구성원 기안 화면 미리보기${h.mk(6)}</h4>
              <label class="draft-pv-opt"><input type="checkbox" data-show ${showHidden ? 'checked' : ''}> 미노출 항목 표시</label>
            </div>
            ${preview(corp)}
            <p class="help draft-foot">${corp.code} 구성원이 신규 기안 작성 시 보게 될 구성의 축소 예시입니다. 문구 · 금액은 샘플입니다.</p>
          </div>
        </div>
      </div>`;
    },
    mount(root, ctx) {
      root.addEventListener('click', (e) => {
        const tg = e.target.closest('[data-tg]');
        if (tg) { const [code, key] = tg.dataset.tg.split(':'); requestToggle(code, key); return; }
        if (e.target.closest('[data-copy]')) { openCopy(ctx.corp); return; }
        if (e.target.closest('[data-init]')) { confirmInitial(ctx.corp); return; }
        if (e.target.closest('[data-history]')) { App.go(null, 'history'); }
      });
      root.addEventListener('change', (e) => {
        if (e.target.matches('[data-show]')) { showHidden = e.target.checked; rerender('[data-show]'); }
      });
    },
    desc(ctx) {
      const c = ctx.corp;
      return {
        title: '법인별 기안 항목 설정',
        summary: `${c.code} 구성원의 '출장 기안' 화면에 노출할 섹션 3종의 사용 여부를 설정한다.`,
        items: [
          { no: 1, title: '요약 영역', body: `<ul>
            <li><b>사용 항목</b> ON 개수 / 전체(3). <b>최종 변경</b> 3개 항목 중 가장 최근 변경 일시 · 변경자, 설정 이력이 없으면 <code>-</code>.</li>
            <li><b>결재 진행 중 기안</b> 해당 법인 구성원이 상신해 결재가 끝나지 않은 건수. 설정을 바꿔도 영향받지 않는다(작성 당시 설정 유지).</li>
            <li><b>임시저장 기안</b> 해당 법인 구성원이 임시저장만 해 둔 출장 기안 건수. 항목을 OFF로 전환하면 삭제되는 대상이다. 두 숫자 모두 프로토타입은 샘플 값이다.</li></ul>` },
          { no: 2, title: '상태 안내 박스', body: `<ul>
            <li><b>미설정 법인</b>(3개 항목 모두 변경 일시 없음. 샘플: HBC, HBI) — 기본값 전부 OFF로 동작함을 안내하고 <code>현재 값으로 최초 설정 저장</code> 버튼을 노출한다. 클릭 시 확인 모달 → 3개 항목에 변경 일시 · 변경자를 기록하고 이력에 <code>법인 최초 설정 — …</code> 1건을 남긴다.</li>
            <li><b>전부 OFF</b>(설정 이력은 있으나 ON 0개. 샘플: HBA, HBL) — 구성원이 기본 정보만으로 결재 상신함을 안내한다. 버튼 없음.</li>
            <li>그 외 상태에서는 노출하지 않는다.</li></ul>` },
          { no: 3, title: '사용 여부 토글', body: `<ul>
            <li>항목 정의(이름 · 설명 · 연동 시스템 · OFF 시 영향)는 고정 3종이며 이 화면에서 추가 · 삭제 · 순서 변경할 수 없다. 표 순서 = 구성원 기안 화면의 섹션 순서.</li>
            <li>기본값 OFF. 클릭 또는 포커스 후 Space/Enter 로 <b>변경 확인 모달(7)</b>을 띄운다. 확인 전에는 스위치 상태를 바꾸지 않는다.</li>
            <li>OFF 인 행은 항목명을 흐리게, <code>OFF 시</code> 영향 문구를 주황으로 강조해 현재 구성원에게 적용 중인 상태임을 알린다.</li>
            <li>항목 간 의존 관계는 없다(각각 독립적으로 ON/OFF).</li></ul>` },
          { no: 4, title: '최종 변경', body: '항목별 마지막 변경 일시(YYYY.MM.DD HH:mm)와 변경자 이름. 한 번도 설정하지 않은 항목은 <code>미설정</code> 배지. 최초 설정 시에는 3개 항목이 같은 일시로 기록된다.' },
          { no: 5, title: '다른 법인 설정 복사', body: `<ul>
            <li>모달에서 <b>가져올 법인</b>(현재 법인 · 미설정 법인 제외)을 선택하면 항목별 현재 값 → 복사 후 값 비교 표를 보여준다. 법인을 바꾸면 표가 즉시 갱신된다.</li>
            <li><code>복사 적용</code> 시 값이 달라지는 항목만 변경하고 항목별로 이력을 남긴다(<code>출장 예산 OFF → ON (HBJ 설정 복사)</code>). 미설정 법인은 최초 설정 1건으로 기록한다.</li>
            <li>현재 값과 완전히 같으면 "변경할 내용이 없습니다" 토스트를 띄우고 모달을 유지한다. 복사 대상은 ON/OFF 값뿐이며 여비규정 · 등급 · 지역 기준은 포함하지 않는다.</li></ul>` },
          { no: 6, title: '구성원 기안 화면 미리보기', body: `<ul>
            <li>구성원 '출장 기안' 화면을 축소한 읽기 전용 와이어. 기본 정보(제목 · 출장 계획서 · 출장 기간)는 항상 노출, 그 아래 3개 섹션은 좌측 토글 값에 따라 달라진다. 내부 버튼 · 입력은 동작하지 않는다.</li>
            <li>ON 섹션은 실제 구성을 요약해 표시한다. OFF 섹션은 실제 구성원 화면에서는 <b>영역 자체가 없지만</b>, 미리보기에서는 점선 · 흐림 + <code>미노출</code> 배지로 자리를 표시한다.</li>
            <li><code>미노출 항목 표시</code> 체크(기본 ON)를 끄면 OFF 섹션을 숨겨 구성원이 실제로 보는 구성 그대로 확인할 수 있다. 법인을 바꾸면 체크는 기본값으로 돌아간다.</li>
            <li>3개 모두 OFF 면 "추가 항목 없음 — 기본 정보만으로 결재 상신" 문구를 표시한다. 금액은 법인 기준 통화의 샘플 값이다.</li>
            <li>저장된 값 기준으로 그리므로 확인 모달에서 확정한 직후 갱신된다.</li></ul>` },
          { no: 7, title: '변경 확인 모달', body: `<ul>
            <li>표시: 법인, 항목, 변경 내용(현재 → 변경 후 배지), 구성원 화면 영향(ON: 섹션 노출 + 연동 시스템 / OFF: 항목별 OFF 영향 문구), 적용 시점("저장 즉시 신규 기안부터 적용, 결재 진행 중 기안 N건은 작성 당시 설정 유지").</li>
            <li><b>OFF 전환일 때만</b> "임시저장 기안 N건 삭제" 행을 빨간색으로 추가 노출한다(0건이어도 노출). 확인 시 해당 법인의 임시저장 출장 기안을 모두 삭제하고, 변경 이력에 삭제 건수를 함께 기록한다. ON 전환에는 이 행이 없다.</li>
            <li>추가 안내: 미설정 법인의 첫 변경이면 "최초 설정으로 기록, 나머지 항목은 OFF로 확정", 마지막 ON 항목을 끄는 경우 "3개 모두 OFF — 기본 정보만으로 결재 상신".</li>
            <li><code>ON으로 변경</code>/<code>OFF로 변경</code>: 값 변경 + 변경 일시 · 변경자(로그인 관리자) 갱신 + 변경 이력 기록(<code>출장 예산 OFF → ON</code>) + 토스트. 모달이 닫히면 포커스를 해당 토글로 되돌린다.</li>
            <li><code>취소</code>, ×, Esc, 바깥 영역 클릭: 변경 없이 닫는다.</li>
            <li>전체 법인 현황 표(TRIP-ADM-CORP-01)의 토글도 같은 모달을 사용한다.</li></ul>` },
        ],
        policies: [
          '기안 항목 ON/OFF 는 저장(확인) 즉시 <b>신규 기안부터</b> 적용한다. 결재 진행 중(상신 완료) 기안은 작성 당시 설정을 유지한다. 예약 적용은 없다.',
          '항목을 <b>OFF 로 전환하면 해당 법인의 임시저장 출장 기안은 삭제</b>한다(복구 불가). 확인 모달에서 삭제 건수를 미리 알리고 변경 이력에 남긴다.',
          '연동 여부와 관계없이 <b>모든 법인에서 ON 을 막지 않는다</b>. 예산 · 법인카드 한도 · 근태 시스템 연동이 준비되지 않은 법인도 토글은 항상 활성이다.',
          '모든 변경은 변경 이력에 일시 · 변경자와 함께 남긴다. 항목 단위로 1건씩 기록하고, 법인 최초 설정만 3개 항목을 묶어 1건으로 기록한다.',
          '본사(HYB) 출장 관리자만 전 법인의 설정을 변경할 수 있다. 법인별 담당자 권한은 없다.',
          '설정 대상은 [출장 예산] [법인카드 한도 증액] [출장 근태 신청] 3개 섹션이다. 기본 정보(제목 · 출장 계획서 · 출장 기간)는 모든 법인에 항상 노출한다.',
          'OFF 인 섹션은 구성원 기안 화면에서 비활성 표시가 아니라 <b>영역 자체를 노출하지 않는다</b>.',
        ],
        issues: [
          '<b>임시저장 기안 삭제의 세부</b> — OFF 전환 시 임시저장 기안을 삭제하기로 확정했다. 남은 확인 사항: 삭제 대상 범위(해당 법인의 임시저장 기안 전체인지, OFF 되는 섹션에 값을 입력한 건만인지 — 프로토타입은 전체), 작성자에게 삭제 알림을 보낼지, ON 전환 시에는 임시저장 기안을 그대로 두는지(프로토타입은 유지).',
          '<b>연동 미비 법인에서 ON 했을 때의 구성원 화면</b> — ON 은 막지 않기로 확정했다. 연동이 안 된 법인에서 해당 섹션이 열렸을 때 불러오기 · 신청 버튼이 어떻게 동작해야 하는지(오류 안내 문구 등) 확인 필요.',
          '<b>반려 · 회수 후 재기안</b> — 기존 기안을 수정해 재상신할 때 작성 당시 설정을 유지하는지, 재상신 시점 설정을 따르는지.',
          '<b>미설정 법인 · 신규 연동 법인의 기본값</b> — 프로토타입은 전부 OFF 로 가정했다. 인사정보에 법인이 새로 연동될 때의 기본값(전부 OFF / HYB 와 동일)과, "미설정" 상태를 별도로 둘지(최초 설정 저장 버튼 필요 여부) 확정 필요.',
          '<b>HYB(본사) 설정 변경 허용 여부</b> — 현행 기준 법인인 HYB 도 OFF 로 바꿀 수 있게 둘지, 고정(ON)할지.',
          '<b>다른 항목의 법인별 토글 대상 여부</b> — 기안 화면 하단의 \'[필수] 플라잉닥터스 앱 설치 및 회원가입 동의\' 등 3개 섹션 외 항목도 법인별로 끄고 켤 대상인지. 프로토타입 미리보기에는 "이 설정과 무관"으로만 표시했다.',
          '<b>OFF 시 대체 안내</b> — 예: 근태 OFF 법인 구성원에게 "근태는 법인 자체 절차로 신청" 같은 안내 문구를 기안 화면에 노출할지, 문구를 법인별로 관리할지.',
          '<b>다른 법인 설정 복사</b> — 편의 기능으로 제안한 것이며 1차 범위 포함 여부 확인 필요.',
        ],
      };
    },
  };
})();
