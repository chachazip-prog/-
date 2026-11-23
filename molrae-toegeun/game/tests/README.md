QA(mt-qa-tester) 소유: 자동 플레이·밸런스 시뮬레이션 테스트를 두는 곳. src/core/는 Phaser 없이 import 가능.

## T-124 (탑다운 프로토타입) — game/ 에서 실행
- `bash tests/run-core.sh` — 코어 검증(결정성·입력·경로 퍼징·시선·의심·전조·threatOf)
- `bash tests/run-balance.sh [시드수=1000]` — 봇 3종 밸런스 시뮬레이터 → `qa/t124-balance.md`
- `node tests/browser/t124-browser.cjs [devUrl] [prodUrl]` — 개발 서버(`npx vite --port 5179`)와 빌드 미리보기(`npx vite preview --port 5180`)를 먼저 띄울 것. 스크린샷 → `qa/screenshots/`
- 타입 검사: `npx tsc --noEmit -p tests/tsconfig.json`
- `tests/.out/`은 번들·원자료 출력(생성물, 커밋 불필요)

## T-131 (1차 플레이어블: 하루 한 판) — game/ 에서 실행
- 기본은 고정 스냅샷 `tests/.out/t131-snap/`(측정 시점 git HEAD의 src·data 복사본)에서 번들한다. 작업 트리 그대로 돌리려면 `QA_LIVE=1`.
  - 스냅샷 만들기(1회): `git archive HEAD game/src game/data ...`로 풀고 `node_modules` 심볼릭 링크(`qa/t131-report.md` §0 참고)
- `bash tests/run-t131.sh core` — T-124 코어 검증(T-127 변경 반영: advance 분할은 끝나지 않는 층, (2,58) 탭 = 'here', 전조 기준 = 범위 최소값)
- `bash tests/run-t131.sh rules` — 말걸기·배경 동료·미션 5종·퇴근·전면광고 경계값 → `tests/.out/t131-rules.json`
- `bash tests/run-t131.sh balance [저작일 시드=300] [생성일 시드=100] [워커=4]` — 하루 전체 봇 3종 + 공정성 전수 검사 → `tests/.out/t131-balance.json`
- `bash tests/run-t131.sh trace <일차> <straight|disguise|novice> <시드> [시작초] [끝초]` — 한 판 틱별 재현(버그 재현 절차용)
- `node tests/browser/t131-browser.cjs [devUrl] [prodUrl]` — 스냅샷 폴더에서 `npx vite --port 5179`, `npx vite preview --outDir <빌드> --port 5180`을 먼저 띄울 것. 스크린샷 → `qa/screenshots/t131-*.png`
- 참고: `run-balance.sh`·`t124-browser.cjs`는 T-123 프로토(FloorSim 단판·`window.__mtSim`) 기준이라 지금 앱에는 맞지 않음(보존만 함)
