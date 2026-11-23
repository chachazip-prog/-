# 빌드 산출물에 번들된 서드파티 패키지 (T-129, 컴플라이언스 감사용)

- 작성: mt-client-dev / 2026-11-22
- 추출 방법: `npx vite build --sourcemap`(임시 출력) → 각 청크 `.map`의 `sources` 중 `node_modules/` 경로를 패키지별로 집계 → 각 패키지 `package.json`의 `version`·`license` 확인. 패키지가 자기 배포본 안에 다른 코드를 미리 묶어 둔 경우(인라인)는 배포본 원문을 직접 확인했습니다.
- 다시 뽑을 때: 같은 방법으로 다시 집계하고 이 표를 갱신합니다(의존성 추가·버전 변경 시).
- 고지 파일: `game/public/licenses/` → 빌드 시 `dist/licenses/`로 그대로 복사됩니다(Vite `public/`). **원문 그대로 복사**했고 수정하지 않았습니다.

| 패키지 | 버전 | 라이선스 | 들어간 청크 | 경로·근거 | 고지 파일 |
|---|---|---|---|---|---|
| phaser | 3.90.0 | MIT | `phaser-*.js` | 직접 의존성(`package.json` 고정) | `licenses/MIT-phaser.txt` (= `node_modules/phaser/LICENSE.md`) |
| eventemitter3 | 5.0.x (설치본 5.0.4) | MIT | `phaser-*.js` | **phaser 배포본(`dist/phaser.js`) 안에 인라인**(webpack 모듈 50792). 정확한 버전은 phaser 빌드 시점 값이라 확인 불가, phaser 의존 범위 `^5.0.1` | `licenses/MIT-eventemitter3.txt` (= `node_modules/eventemitter3/LICENSE`) |
| @apps-in-toss/web-framework | 3.10.0 | Apache-2.0 | `toss-*.js`(토스 환경에서만 동적 로드) | 직접 의존성 | `licenses/Apache-2.0-apps-in-toss-web-framework.txt` (= `LICENSE`). **NOTICE 파일 없음**(패키지에 미포함 확인) |
| @webview-bridge/web | 1.7.10 | MIT | `toss-*.js` | web-framework 의존성 | `licenses/MIT-webview-bridge-web.txt` |
| @webview-bridge/utils | 1.7.10 | MIT | `toss-*.js` | @webview-bridge/web 의존성 | `licenses/MIT-webview-bridge-utils.txt` |
| semver | 7.8.6 | ISC | `toss-*.js` | web-framework 의존성 | `licenses/ISC-semver.txt` |
| valibot | 1.5.0 | MIT | `toss-*.js` | web-framework 의존성 | `licenses/MIT-valibot.txt` |

## 번들되지 않는 것(참고)
- `@apps-in-toss/cli`(web-framework 의존성): 빌드 도구. 런타임 번들에 없음(소스맵 확인).
- `vite`, `typescript`, `esbuild`, `@types/node`: 개발 도구.
- 폰트: Galmuri 2.40.3(OFL 1.1) 서브셋 변환물 `dist/fonts/mt-pixel-*` — 고지 `licenses/OFL-galmuri.txt`(T-126).
- 게임 에셋(스프라이트)·데이터·`art/palette.json`: 프로젝트 오리지널.

## 남은 확인(컴플라이언스)
- 고지를 앱 안에서 보여 줄 화면(설정 > 오픈소스 라이선스)은 아직 없음. 지금은 빌드 산출물 `licenses/` 폴더에 파일로만 포함.
- Apache-2.0 §4(d): 원 패키지에 NOTICE가 없으므로 별도 NOTICE 고지 의무 없음으로 판단(컴플라이언스 확인 요청).
