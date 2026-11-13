/* TRIP-ADM-CORP-05 법인별 변경 이력 */
(function () {
  const D = App.D, h = App.h;
  const CATS = ['기안 항목', '여비규정', '구성원 등급', '지역 그룹'];
  const COLOR = { '기안 항목': 'blue', '여비규정': 'green', '구성원 등급': 'orange', '지역 그룹': 'gray' };
  let lastCode = null;
  let cat = 'ALL';

  const listOf = (code) => D.history.map((r, i) => ({ r, i })).filter((x) => x.r.corp === code)
    .sort((a, b) => (a.r.at < b.r.at ? 1 : a.r.at > b.r.at ? -1 : a.i - b.i)).map((x) => x.r);

  App.views.history = {
    render(ctx) {
      if (lastCode !== ctx.code) { lastCode = ctx.code; cat = 'ALL'; }
      const all = listOf(ctx.code);
      const list = cat === 'ALL' ? all : all.filter((r) => r.cat === cat);
      const fbtn = (key, label, n) => `<button type="button" class="history-f ${cat === key ? 'on' : ''}" aria-pressed="${cat === key}" data-cat="${key}">${label} <span class="num">${n}</span></button>`;
      let body;
      if (!all.length) {
        body = `<div class="empty"><b>변경 이력이 없습니다${h.mk(3)}</b>${ctx.code}의 기안 항목 · 여비규정 · 구성원 등급 · 지역 그룹을 설정하면 이곳에 기록됩니다.</div>`;
      } else if (!list.length) {
        body = `<div class="empty"><b>'${h.esc(cat)}' 변경 이력이 없습니다${h.mk(3)}</b><button type="button" class="link" data-cat="ALL">전체 이력 보기</button></div>`;
      } else {
        body = `<div class="tbl-wrap"><table class="tbl history-tbl">
          <thead><tr><th class="c history-no">번호</th><th class="history-at">변경 일시${h.mk(3)}</th><th class="history-cat">구분</th><th>변경 내용</th><th class="history-by">변경자</th></tr></thead>
          <tbody>${list.map((r, i) => `<tr>
            <td class="c dim num">${list.length - i}</td>
            <td class="num history-at">${h.esc(r.at)}</td>
            <td>${h.badge(COLOR[r.cat] || 'gray', r.cat)}</td>
            <td>${h.esc(r.text)}</td>
            <td>${h.esc(r.by)}</td></tr>`).join('')}</tbody></table></div>`;
      }
      return `
      <div class="history-wrap">
        <h3 class="sec-title">변경 이력 <em class="history-cnt num">${list.length}</em>${h.mk(1)}</h3>
        <p class="sec-desc">${ctx.code} 법인 설정의 모든 변경 내역입니다. 이력은 수정하거나 삭제할 수 없습니다.</p>
        <div class="history-filters" role="group" aria-label="구분 필터">
          ${fbtn('ALL', '전체', all.length)}${CATS.map((c) => fbtn(c, c, all.filter((r) => r.cat === c).length)).join('')}${h.mk(2)}
        </div>
        ${body}
      </div>`;
    },
    mount(root) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]'); if (!b) return;
        cat = b.dataset.cat; App.render();
        const f = document.querySelector(`.history-f[data-cat="${cat}"]`); if (f) f.focus();
      });
    },
    desc(ctx) {
      return {
        title: '법인별 변경 이력',
        summary: `${ctx.code}의 기안 항목 · 여비규정 · 구성원 등급 · 지역 그룹 변경 내역을 최신순으로 조회한다(읽기 전용).`,
        items: [
          { no: 1, title: '이력 건수', body: '현재 필터에 해당하는 이력 건수를 제목 옆에 파란 숫자로 표시한다. 다른 탭에서 설정을 변경하면 이 탭에 즉시 1건이 추가된다.' },
          { no: 2, title: '구분 필터', body: `<ul>
            <li><code>전체</code>(기본) / <code>기안 항목</code> / <code>여비규정</code> / <code>구성원 등급</code> / <code>지역 그룹</code> 단일 선택. 각 버튼에 해당 법인의 구분별 건수를 함께 표시한다(0건이어도 버튼은 노출).</li>
            <li>선택 즉시 표를 필터링한다. 법인을 바꾸면 <code>전체</code>로 초기화된다.</li></ul>` },
          { no: 3, title: '이력 표', body: `<ul>
            <li>열: 번호(최신 건이 가장 큰 번호인 역순 번호, 필터 결과 기준) · 변경 일시(YYYY.MM.DD HH:mm) · 구분(배지) · 변경 내용 · 변경자.</li>
            <li>정렬은 변경 일시 내림차순 고정. 같은 일시면 나중에 기록된 건이 위.</li>
            <li>구분 배지 색: 기안 항목 파랑 / 여비규정 초록 / 구성원 등급 주황 / 지역 그룹 회색.</li>
            <li>변경 내용 예: <code>출장 예산 OFF → ON</code>, <code>법인 최초 설정 — …</code>, <code>v3 개정안 등록 — 적용 시작일 2027.01.01</code>. 문구는 각 설정 화면이 변경 시점에 생성한 값을 그대로 보여준다.</li>
            <li>행 클릭 동작은 없다(읽기 전용).</li>
            <li><b>빈 상태</b> ① 법인에 이력이 전혀 없음(샘플: HBC, HBI) — "변경 이력이 없습니다" ② 선택한 구분만 0건 — "'구분' 변경 이력이 없습니다" + <code>전체 이력 보기</code> 링크.</li></ul>` },
        ],
        policies: [
          '법인 설정의 모든 변경(기안 항목 ON/OFF, 여비규정 등록 · 개정, 구성원 등급 · 개인 예외, 지역 그룹)은 변경 일시 · 변경자와 함께 자동 기록한다.',
          '이력은 조회 전용이며 관리자가 수정 · 삭제할 수 없다.',
          '기안 항목은 항목 단위로 1건씩 기록하고, 법인 최초 설정만 3개 항목을 묶어 1건으로 기록한다.',
          '이 탭은 선택한 법인의 이력만 보여준다. 본사(HYB) 출장 관리자만 조회한다.',
        ],
        issues: [
          '<b>페이징 · 기간 검색</b> — 이력이 많아질 때의 페이지 크기(예: 20건)와 기간 · 변경자 검색 필요 여부. 프로토타입은 전체를 한 번에 노출한다.',
          '<b>보관 기간</b> — 이력을 영구 보관할지, 보관 기한을 둘지.',
          '<b>변경 전/후 상세</b> — 여비규정 값 변경처럼 내용이 많은 건을 한 줄 요약으로만 남길지, 변경 전/후 비교 상세(모달)를 제공할지.',
          '<b>전 법인 통합 이력</b> — [전체 법인] 화면에서 모든 법인의 이력을 한 번에 보는 화면과 엑셀 다운로드가 필요한지.',
          '<b>시스템 변경 기록</b> — 예약한 여비규정 버전이 적용 시작일에 자동 전환되는 것처럼 사람이 하지 않은 변경도 이력에 남길지, 남긴다면 변경자 표기(예: 시스템).',
        ],
      };
    },
  };
})();
