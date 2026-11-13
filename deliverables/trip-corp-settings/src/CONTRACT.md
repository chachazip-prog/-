# 화면(View) 작성 규약

HYBENET 어드민 `업무관리자 > 출장 관리 > 법인별 세팅` 탭의 프로토타입 겸 화면설계서.
`python3 build.py` 가 `src/base.css + src/views/*.css` 와 `src/data.js + src/app.js + src/views/*.js` 를 `trip-corp-settings.html` 한 파일로 합친다.

## 화면 구조 (셸이 이미 그림 — 수정 금지: base.css, app.js, data.js, shell.html, build.py)
- 좌측: 법인 목록 패널(전체 법인 + HYB/HBA/HBL/HBJ/HBC/HBI). 우측 `#view`: 법인 헤더 + 서브탭 + `#view-body`(뷰가 그리는 영역).
- 법인 = ALL 이면 `App.views.overview`, 그 외에는 서브탭 키(`draft` / `policy` / `criteria` / `history`)의 뷰를 렌더한다.
- 맨 오른쪽: Description 패널(셸이 `desc()` 반환값으로 그림).

## 뷰 등록
```js
App.views.<key> = {
  render(ctx) { return '<html string>'; },          // #view-body 안에 들어감
  mount(root, ctx) { /* root = #view-body. 이벤트 위임은 여기서. render 될 때마다 다시 호출됨 */ },
  desc(ctx) { return { title, summary, items:[{ no:1, title, body(html) }], policies:[html], issues:[html] }; },
};
```
- `ctx = { corp(법인 객체|null), code('ALL'|'HBA'..), tab, D(window.DATA), h, ui }`
- 뷰 내부 UI 상태(편집 모드, 선택 버전 등)는 뷰 파일의 모듈 스코프 변수에 두고, 법인이 바뀌면 초기화한다(`ctx.code` 비교).
- 데이터는 `DATA` 를 직접 변경하고 `App.render()` 호출. 변경 시 반드시 `App.log(corpCode, cat, text)` 로 이력을 남긴다 (cat: '기안 항목' | '여비규정' | '구성원 등급' | '지역 그룹').
- 화면 이동: `App.go(corpCode | null, tabKey | null)`.
- 파일 전체를 IIFE 로 감싸 전역을 오염시키지 않는다. 문자열 `</script` 금지. 외부 리소스(CDN, 이미지, 폰트) 금지. 사용자 입력·데이터는 `h.esc()` 로 이스케이프.
- 뷰 전용 CSS 가 필요하면 `src/views/<key>.css` 에 쓰고, 클래스명은 `<key>-` 접두어를 붙인다. base.css 의 토큰(`var(--line)` 등)·컴포넌트를 우선 사용한다.

## 헬퍼
- `h.esc(s)`, `h.mk(n)` 마커(주황 번호 원), `h.badge(color, text)` color = blue|green|red|orange|gray|line
- `h.toggle(on, attrs, label=true)` 스위치 버튼(`role=switch`, `aria-checked`) + ON/OFF 라벨
- `h.money(v, cur)`, `h.corp(code)`, `h.policyState(code)` → `{active, scheduled, draft, count}`, `h.policyBadge(code)`, `h.now()`
- `ui.toast(msg)`, `ui.modal({ title, body, width, actions:[{ label, primary, danger, onClick(modalEl) }] })` (onClick 이 false 반환 시 닫지 않음), `ui.confirm(title, bodyHtml, okLabel, onOk)`, `ui.closeModal()`

## base.css 컴포넌트
`.btn(.pri/.sm/.ghost/.danger)`, `.inp`, `.sel`, `.ta`, `.inp.cell(.l)`, `.badge`, `.chip`/`.chips`, `.tg`, `.tbl`(목록형 표, `.c/.r/.dim`, `tr.click`), `.mx`(규정 값 매트릭스 표, `td.rh` 행 머리, `.l`), `.frow`(라벨-값 행, `.lb.req`), `.sec`/`.sec-title`/`.sec-desc`, `.card`, `.note`(주황 유의 문구), `.help`, `.empty`, `.row(.between/.wrap)`, `.grow`, `.link`, `.hl-blue`, `.h3`

## 마커 · Description
- 번호 마커는 `h.mk(1)` 처럼 UI 요소 옆에 넣고, 같은 번호의 항목을 `desc().items` 에 쓴다. 뷰 안에서 1부터 시작(A, B 는 셸이 사용).
- Description 은 개발자·디자이너·QA 가 읽는 화면설계서 문체(한국어, "~한다" 체). 항목별로 노출 조건, 기본값, 입력 제한, 동작, 예외/빈 상태를 구체적으로 쓴다.
- `policies` 에는 화면 전반 정책, `issues` 에는 아직 결정되지 않아 확인이 필요한 사항만 적는다.

## 확정된 정책 (PM 확인 완료)
1. 구성원 등급: 법인별로 등급을 정의하고 인사정보 직급/직책에 매핑 + 특정 구성원 개인 예외 지정 가능.
2. 여비규정은 **기준 정보 관리·구성원 안내용**. 출장 계획서 자동 검증·차단, 규정 예외 신청 연동은 하지 않는다.
3. 여비규정은 개정 버전 단위로 **적용 시작일**을 지정(예약 적용). 기안 항목 on/off 는 저장 즉시 **신규 기안부터** 적용, 진행 중 기안은 작성 당시 설정 유지. 모든 변경은 이력에 남긴다.
6. 기안 항목을 OFF로 전환하면 해당 법인의 임시저장 출장 기안은 삭제한다. 연동 여부와 관계없이 ON은 막지 않는다.
7. 규정을 공유하는 법인(HBA·HBL)은 연결이 아닌 1회성 복사로 각각 관리한다.
8. 등급·지역 기준 변경은 적용 중·적용 예정 여비규정 값 표에 즉시 반영한다(추가=미정의 칸, 삭제=행·열과 값 삭제, 이름 변경=값 유지).
4. 권한: 본사(HYB) 출장 관리자만 전 법인을 관리. 법인별 담당자 개념 없음.
5. 법인 목록은 인사정보 연동(추가·삭제 불가).

## 톤앤매너 (기존 HYBENET 출장 관리 화면)
흰 배경, 얇은 회색 선(#ebebeb), 작은 글자(11~13px), 굵은 검정 제목, 연회색 표 머리(#f7f7f7), 작은 파스텔 배지, 흰색 외곽선 버튼 + 검정 주요 버튼, 강조 숫자는 파랑(#1a8cff), 유의 문구는 주황. 그림자·그라데이션·둥근 카드·이모지·아이콘 장식을 쓰지 않는다. 여백은 넉넉하게, 정보 밀도는 높게.
