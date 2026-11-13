/* TRIP-ADM-CORP-01 전체 법인 현황 */
(function () {
  const D = App.D, h = App.h;
  let q = '';

  const draft = () => App.views.draft; // 토글 확인 모달 등 공통 로직 (b_draft.js)
  const HEAD2 = { budget: '출장 예산', card: '법인카드<br>한도 증액', attendance: '출장 근태<br>신청' };

  function policyCell(code) {
    const s = h.policyState(code);
    const dates = [];
    if (s.active) dates.push(`적용 ${s.active.from}~`);
    if (s.scheduled) dates.push(`예정 ${s.scheduled.from}~`);
    return `<button type="button" class="overview-pol" data-go-policy="${code}" aria-label="${code} 여비규정으로 이동">
      <span class="overview-pol-b">${h.policyBadge(code)}</span>
      <span class="overview-pol-d num">${dates.length ? dates.join('<br>') : '등록된 규정 없음'}</span></button>`;
  }

  function rows() {
    const k = q.trim().toLowerCase();
    const list = D.corps.map((c, i) => ({ c, no: i + 1 })).filter(({ c }) => !k || c.code.toLowerCase().includes(k) || c.name.toLowerCase().includes(k));
    if (!list.length) return `<tr><td colspan="${7 + D.draftItems.length + 1}"><div class="empty"><b>검색 결과가 없습니다</b>법인 코드 또는 법인명을 다시 확인해주세요.</div></td></tr>`;
    return list.map(({ c, no }, idx) => {
      const unset = draft().isUnset(c), last = draft().lastChange(c);
      const [d, t] = last ? last.at.split(' ') : [];
      return `<tr>
        <td class="c dim num">${no}</td>
        <td><button type="button" class="overview-code" data-go-draft="${c.code}">${c.code}</button></td>
        <td><button type="button" class="overview-name" data-go-draft="${c.code}">${h.esc(c.name)}</button>${c.sample ? ' ' + h.badge('gray', '샘플 값') : ''}</td>
        <td class="overview-nw">${h.esc(c.country)}</td>
        <td>${c.cur}</td>
        <td class="r num">${c.headcount.toLocaleString()}</td>
        <td class="overview-polc">${policyCell(c.code)}</td>
        ${D.draftItems.map((i) => `<td class="c overview-tgc">${h.toggle(c.draft[i.key].on, `data-tg="${c.code}:${i.key}" aria-label="${c.code} ${h.esc(i.name)} 사용 여부"`, false)}</td>`).join('')}
        <td class="overview-upd">${unset ? h.badge('orange', '미설정') : `<span class="num">${d}</span>${t ? `<br><span class="num dim">${t}</span>` : ''}`}</td>
      </tr>`;
    }).join('');
  }

  App.views.overview = {
    render() {
      const corps = D.corps;
      const reg = corps.filter((c) => { const s = h.policyState(c.code); return s.active || s.scheduled; }).length;
      const unset = corps.filter((c) => draft().isUnset(c)).length;
      return `
      <div class="overview-wrap">
        <h3 class="sec-title">전체 법인 현황${h.mk(1)}</h3>
        <p class="sec-desc">법인별 여비규정 등록 상태와 출장 기안 항목 사용 여부를 한눈에 확인하고, 기안 항목은 이 표에서 바로 변경할 수 있습니다.</p>
        <div class="row between wrap overview-bar">
          <div class="chips">
            <span class="chip">법인 <b class="num hl-blue">${corps.length}</b></span>
            <span class="chip">여비규정 등록 <b class="num">${reg}</b> · 미등록 <b class="num ${corps.length - reg ? 'overview-warn' : ''}">${corps.length - reg}</b></span>
            <span class="chip">기안 항목 미설정 <b class="num ${unset ? 'overview-warn' : ''}">${unset}</b></span>
            ${D.draftItems.map((i) => `<span class="chip">${h.esc(i.name)} 사용 <b class="num">${corps.filter((c) => c.draft[i.key].on).length}</b></span>`).join('')}
          </div>
          <div class="row"><input type="search" class="inp overview-q" placeholder="법인 코드, 법인명 검색" aria-label="법인 코드, 법인명 검색" maxlength="30" value="${h.esc(q)}">${h.mk(2)}</div>
        </div>
        <div class="tbl-wrap">
          <table class="tbl overview-tbl">
            <thead>
              <tr>
                <th rowspan="2" class="c">번호</th><th rowspan="2">법인 코드${h.mk(3)}</th><th rowspan="2">법인명</th><th rowspan="2">국가</th><th rowspan="2">기준 통화</th><th rowspan="2" class="r">구성원 수</th>
                <th rowspan="2">여비규정${h.mk(4)}</th>
                <th colspan="${D.draftItems.length}" class="c overview-grp">기안 항목${h.mk(5)}</th>
                <th rowspan="2">최종 업데이트${h.mk(6)}</th>
              </tr>
              <tr>${D.draftItems.map((i) => `<th class="c overview-sub">${HEAD2[i.key] || h.esc(i.name)}</th>`).join('')}</tr>
            </thead>
            <tbody id="overview-rows">${rows()}</tbody>
          </table>
        </div>
        <p class="note overview-foot">기안 항목 변경은 저장 즉시 신규 기안부터 적용되며, 결재 진행 중 기안은 작성 당시 설정을 유지합니다. OFF로 바꾸면 해당 법인의 임시저장 기안은 삭제됩니다.</p>
      </div>`;
    },
    mount(root) {
      root.addEventListener('click', (e) => {
        const tg = e.target.closest('[data-tg]');
        if (tg) { const [code, key] = tg.dataset.tg.split(':'); draft().requestToggle(code, key); return; }
        const a = e.target.closest('[data-go-draft]'); if (a) { App.go(a.dataset.goDraft, 'draft'); return; }
        const p = e.target.closest('[data-go-policy]'); if (p) App.go(p.dataset.goPolicy, 'policy');
      });
      const inp = root.querySelector('.overview-q');
      inp.addEventListener('input', () => { q = inp.value; root.querySelector('#overview-rows').innerHTML = rows(); });
    },
    desc() {
      return {
        title: '전체 법인 현황',
        summary: '좌측에서 [전체 법인]을 선택했을 때의 화면. 전 법인의 여비규정 상태와 기안 항목 사용 여부를 한 표로 보여주고 기안 항목을 바로 변경한다.',
        items: [
          { no: 1, title: '요약 칩', body: `<ul>
            <li><b>법인</b> 인사정보 연동 법인 수.</li>
            <li><b>여비규정 등록 · 미등록</b> 적용 중 또는 적용 예정 버전이 1개 이상 있으면 등록, 없으면(임시저장만 있는 경우 포함) 미등록으로 센다.</li>
            <li><b>기안 항목 미설정</b> 3개 항목을 한 번도 저장하지 않은 법인 수.</li>
            <li><b>항목별 사용</b> 해당 항목이 ON 인 법인 수.</li>
            <li>미등록 · 미설정이 1 이상이면 숫자를 주황으로 강조한다. 칩은 검색어와 무관하게 전체 법인 기준이며, 토글 변경 시 즉시 갱신된다.</li></ul>` },
          { no: 2, title: '검색', body: '법인 코드 · 법인명 부분 일치(대소문자 무시, 최대 30자). 입력 즉시 표를 필터링한다. 결과가 없으면 표 본문에 "검색 결과가 없습니다" 빈 상태를 노출한다. 검색어는 법인 상세에 다녀와도 유지되고 새로고침 시 초기화된다.' },
          { no: 3, title: '법인 코드 · 법인명', body: '정렬은 인사정보 연동 순서(좌측 법인 목록과 동일), 번호는 그 순번이다. 법인 코드 또는 법인명 클릭 시 해당 법인의 <code>기안 항목 설정</code> 탭으로 이동한다. 국가 · 기준 통화 · 구성원 수는 인사정보 연동 값으로 읽기 전용. 페이징은 두지 않는다(법인 수가 적음).' },
          { no: 4, title: '여비규정', body: `<ul>
            <li>상태 배지: <code>적용 중 vN</code>(초록) / <code>적용 예정 vN</code>(파랑) / <code>임시저장</code>(회색) / <code>미등록</code>(주황). 적용 중과 적용 예정이 함께 있으면 둘 다 노출한다.</li>
            <li>배지 아래에 적용 시작일을 표기한다(<code>적용 YYYY.MM.DD~</code>, 예정 버전이 있으면 <code>예정 YYYY.MM.DD~</code>). 둘 다 없으면 "등록된 규정 없음".</li>
            <li>셀 클릭 시 해당 법인의 <code>여비규정</code> 탭으로 이동한다.</li></ul>` },
          { no: 5, title: '기안 항목 토글', body: `<ul>
            <li>열 = 출장 예산 / 법인카드 한도 증액 / 출장 근태 신청. 스위치 켜짐(검정) = ON.</li>
            <li>클릭 또는 Space/Enter 시 법인별 기안 항목 설정(TRIP-ADM-CORP-02)과 <b>동일한 변경 확인 모달</b>을 띄운다. 확인 시 값 · 최종 업데이트 · 좌측 법인 목록 배지 · 요약 칩이 함께 갱신되고 변경 이력이 남는다. 취소 시 변경 없음.</li>
            <li>미설정 법인도 토글할 수 있으며, 첫 변경은 "법인 최초 설정"으로 기록된다(나머지 항목은 OFF 로 확정).</li></ul>` },
          { no: 6, title: '최종 업데이트', body: '기안 항목 3종 중 가장 최근 변경 일시(YYYY.MM.DD HH:mm, 시각 정보가 없는 과거 데이터는 일자만). 여비규정 · 등급 · 지역 변경은 포함하지 않는다. 한 번도 설정하지 않은 법인은 <code>미설정</code> 배지를 노출한다.' },
        ],
        policies: [
          '법인 목록은 인사정보 연동 결과를 그대로 사용한다. 이 화면에서 법인을 추가 · 삭제 · 정렬 변경할 수 없다.',
          '본사(HYB) 출장 관리자만 접근하며 전 법인을 조회 · 변경한다.',
          '기안 항목 ON/OFF 는 저장 즉시 신규 기안부터 적용, 결재 진행 중 기안은 작성 당시 설정을 유지한다. OFF 전환 시 해당 법인의 임시저장 기안은 삭제한다. 연동 여부와 관계없이 ON 을 막지 않는다. 모든 변경은 해당 법인의 변경 이력에 남긴다.',
          '여비규정은 이 표에서 상태 조회만 한다. 등록 · 개정은 법인별 여비규정 탭에서 한다.',
        ],
        issues: [
          '<b>현황 표에서의 직접 변경 허용 범위</b> — 현황 표의 토글은 법인 상세와 같은 확인 모달을 거치지만, 오조작 방지를 위해 현황 표에서는 조회만 하고 변경은 법인 상세에서만 하도록 할지 확인 필요.',
          '<b>최종 업데이트 기준</b> — 현재는 기안 항목 변경만 반영한다. 여비규정 · 등급 · 지역 기준 변경까지 포함한 "법인 설정 전체의 최종 변경"으로 볼지 확인 필요.',
          '<b>여비규정 미등록 법인의 후속 조치</b> — 미등록 법인에 대해 관리자 알림 · 등록 요청 등 별도 처리가 필요한지(현재는 주황 배지 표시만).',
          '<b>엑셀 다운로드</b> — 전 법인 현황 내려받기 필요 여부.',
        ],
      };
    },
  };
})();
