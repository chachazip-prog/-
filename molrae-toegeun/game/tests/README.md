QA(mt-qa-tester) 소유: 자동 플레이·밸런스 시뮬레이션 테스트를 두는 곳. src/core/는 Phaser 없이 import 가능.

## T-124 (탑다운 프로토타입) — game/ 에서 실행
- `bash tests/run-core.sh` — 코어 검증(결정성·입력·경로 퍼징·시선·의심·전조·threatOf)
- `bash tests/run-balance.sh [시드수=1000]` — 봇 3종 밸런스 시뮬레이터 → `qa/t124-balance.md`
- `node tests/browser/t124-browser.cjs [devUrl] [prodUrl]` — 개발 서버(`npx vite --port 5179`)와 빌드 미리보기(`npx vite preview --port 5180`)를 먼저 띄울 것. 스크린샷 → `qa/screenshots/`
- 타입 검사: `npx tsc --noEmit -p tests/tsconfig.json`
- `tests/.out/`은 번들·원자료 출력(생성물, 커밋 불필요)

## T-131 (1차 플레이어블: 하루 한 판) — game/ 에서 실행
- 기본은 고정 스냅샷 `tests/.out/t131-snap/`(측정 시점 커밋(T-131 최종: `e51a7f6`)의 game/ 복사본)에서 번들한다. 작업 트리 그대로 돌리려면 `QA_LIVE=1`.
  - 스냅샷 만들기: `git archive e51a7f6 game | tar -x -C tests/.out/t131-snap --strip-components=1` 후 `node_modules` 심볼릭 링크(`qa/t131-report.md` §0 참고)
- `bash tests/run-t131.sh core` — T-124 코어 검증(T-127 변경 반영: advance 분할은 끝나지 않는 층, (2,58) 탭 = 'here', 전조 기준 = 범위 최소값)
- `bash tests/run-t131.sh rules` — 말걸기·배경 동료·미션 5종·퇴근·전면광고 경계값 → `tests/.out/t131-rules.json`
- `bash tests/run-t131.sh balance [저작일 시드=300] [생성일 시드=100] [워커=4]` — 하루 전체 봇 3종 + 공정성 전수 검사 → `tests/.out/t131-balance.json`
- `bash tests/run-t131.sh trace <일차> <straight|disguise|novice> <시드> [시작초] [끝초]` — 한 판 틱별 재현(버그 재현 절차용)
- `node tests/browser/t131-browser.cjs [devUrl] [prodUrl]` — 스냅샷 폴더에서 `npx vite --port 5179`, `npx vite preview --outDir <빌드> --port 5180`을 먼저 띄울 것. 스크린샷 → `qa/screenshots/t131-*.png`
- 참고: `run-balance.sh`·`t124-browser.cjs`는 T-123 프로토(FloorSim 단판·`window.__mtSim`) 기준이라 지금 앱에는 맞지 않음(보존만 함)

## T-141 (최신 커밋, 미리보기 빌드 설정: 생성 맵·미션 v3·성별 시설·순회) — game/ 에서 실행
- 항상 작업 트리 그대로 번들(스냅샷 없음). 조립 옵션은 `lib/t141content.ts`(`?v3=1&gender=1`과 같음). 하니스는 `lib/t141.ts`(T-131 사본 + 새 미션 봇·zone_only 탐색·예산 맞는 미션 선택)
- `bash tests/run-t141.sh balance [1~15일 시드=200] [16~60일=60] [대표님 날=120] [61~200일=12] [워커=8] [성별 짝=20]` → `tests/.out/t141/bal-*.jsonl`, 집계 `python3 -I tests/sim/t141-tables.py`
- `bash tests/run-t141.sh tour [시작=6] [끝=200] [시드=5]` — 앉은 봇 순회(계획 대비 출발·도착, 실측−추정, 인사 hold, 반복, INT-08) → `tests/.out/t141/tour.json`
- `bash tests/run-t141.sh maps [--write]` — 3~200일 맵 해시 스냅샷(`qa/t141-map-hashes.json`)·폴백(G17)·남/여 동일·G4·G10·G15 → `tests/.out/t141/facility.json`
- `bash tests/run-t141.sh gap` — minGapSec 6/10/14/18 배치 간격 추종
- `bash tests/run-t141.sh trace <일차> <straight|disguise|novice|sit> <시드> [시작초] [끝초]` — 한 판 재현
- `bash tests/run-t141.sh phonecut [시드 수]` / `phonecut2` / `chipcaught` — 브라우저 장면 선정용 탐색
- 브라우저(프로덕션, D-114): `npx vite build --outDir tests/.out/t141/dist --emptyOutDir && npx vite preview --outDir tests/.out/t141/dist --port 5180` 후 `node tests/browser/t141-browser.cjs http://localhost:5180/ [all|load|char|phone|ad|inter|layout]`, 타이틀 복귀는 `node tests/browser/t141-title-return.cjs`(실제 rAF)
