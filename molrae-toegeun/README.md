# 몰래퇴근 (가칭)

앱인토스 출시용 2D 도트 사무실 눈치 게임 프로젝트입니다. 오너(사용자)와 Claude PM, 전문 에이전트 팀이 함께 제작합니다.

- 운영 규칙: [CLAUDE.md](CLAUDE.md)
- 요구사항: [pm/requirements.md](pm/requirements.md)
- 의사결정 로그: [pm/decisions.md](pm/decisions.md)
- 작업 보드: [pm/board.md](pm/board.md)
- 검토 보고서: [../deliverables/office-stealth-game-review.md](../deliverables/office-stealth-game-review.md)

## 폴더 구조 (작업이 진행되면서 생성됨)

| 폴더 | 담당 에이전트 |
|---|---|
| `design/` | 기획 (`mt-game-designer`) |
| `game/` | 개발 (`mt-client-dev`). `game/data/`는 기획, `game/assets/`는 아트·사운드, `game/tests/`는 QA 담당 |
| `art/` | 도트 아트 (`mt-pixel-artist`) |
| `audio/` | 사운드 (`mt-sound-designer`) |
| `qa/` | QA (`mt-qa-tester`) |
| `marketing/` | 마케팅 (`mt-marketer`) |
| `compliance/` | 정책·행정 (`mt-compliance`) |
| `liveops/` | 출시 후 분석 (`mt-liveops-analyst`) |
| `pm/` | PM (메인 세션) |
