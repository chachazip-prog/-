QA(mt-qa-tester) 소유: 자동 플레이·밸런스 시뮬레이션 테스트를 두는 곳. src/core/는 Phaser 없이 import 가능.

## T-124 (탑다운 프로토타입) — game/ 에서 실행
- `bash tests/run-core.sh` — 코어 검증(결정성·입력·경로 퍼징·시선·의심·전조·threatOf)
- `bash tests/run-balance.sh [시드수=1000]` — 봇 3종 밸런스 시뮬레이터 → `qa/t124-balance.md`
- `node tests/browser/t124-browser.cjs [devUrl] [prodUrl]` — 개발 서버(`npx vite --port 5179`)와 빌드 미리보기(`npx vite preview --port 5180`)를 먼저 띄울 것. 스크린샷 → `qa/screenshots/`
- 타입 검사: `npx tsc --noEmit -p tests/tsconfig.json`
- `tests/.out/`은 번들·원자료 출력(생성물, 커밋 불필요)
