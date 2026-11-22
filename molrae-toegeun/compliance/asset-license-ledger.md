# 에셋·라이선스 대장

- 관리: mt-compliance (기록은 각 에이전트가 추가하고, 컴플라이언스가 감사)
- 근거: CLAUDE.md §5 (오리지널 또는 상업적 이용이 허용된 라이선스만, CC-NC 금지), launch-checklist L-01~L-04
- 규칙
  1. 외부에서 가져온 에셋·폰트·라이브러리·코드 조각은 **빌드에 넣기 전에** 이 대장에 한 줄을 추가합니다. 대장에 없으면 빌드에 넣지 않습니다.
  2. 직접 만든 오리지널 에셋(코드 생성 도트, 절차적 사운드)도 **출처 = 오리지널**로 기록합니다(AI 생성이면 도구명 기재).
  3. 라이선스 원문 URL과 **확인 날짜**를 남기고, 가능하면 라이선스 파일 사본 경로를 적습니다.
  4. 허용: CC0, CC-BY(크레딧 필수), OFL(폰트), MIT·BSD·Apache-2.0(고지 필수) 등. **금지: CC-NC, CC-ND(수정 시), 출처·라이선스 불명, "개인 사용만"**.
  5. 상태가 `승인`인 항목만 출시 빌드에 포함합니다.

## 컬럼 정의

| 컬럼 | 설명 | 예시 값 |
|---|---|---|
| ID | 고유 번호. 분류 접두어 + 3자리 | ART-001, SFX-001, BGM-001, FNT-001, LIB-001, CODE-001 |
| 분류 | 스프라이트 / 타일셋 / UI / 효과음 / BGM / 폰트 / 라이브러리 / 코드 / 기타 | 폰트 |
| 이름 | 에셋 이름(원작 표기 그대로) | (원작 표기) |
| 사용 위치 | 저장소 내 경로 또는 사용 화면 | game/assets/audio/sfx/... |
| 출처 | 오리지널 / 외부(사이트명·제작자) | 오리지널(코드 생성) |
| 원본 URL | 다운로드한 페이지 URL. 오리지널이면 `-` | https://... |
| 제작자 | 저작자명(크레딧 표기용) | - |
| 라이선스 | SPDX 식별자 또는 정식 명칭 + 버전 | CC0-1.0 / CC-BY-4.0 / OFL-1.1 / MIT |
| 라이선스 원문 URL | 라이선스 전문 또는 에셋 페이지의 라이선스 표기 위치 | https://... |
| 상업적 이용 | 가능 / 불가 / 확인 필요 | 가능 |
| 수정 허용 | 가능 / 불가 / 조건부 | 가능 |
| 크레딧 의무 | 없음 / 있음(표기 문구) | 있음: "Sound by ○○ (CC-BY 4.0)" |
| 크레딧 반영 위치 | 크레딧 화면, 정보 화면, 콘솔 설명 등 | 크레딧 화면 |
| 수정 여부 | 원본 그대로 / 수정함(내용) | 수정함(팔레트 변경) |
| 라이선스 사본 | 저장소 내 라이선스 파일 경로 | art/licenses/... |
| 확인일 | 라이선스를 확인한 날짜(YYYY-MM-DD) | 2026-11-22 |
| 기록자 | 추가한 에이전트/사람 | mt-sound-designer |
| 상태 | 후보 / 검토 중 / 승인 / 반려 / 교체 예정 (`후보` = 조사만 끝났고 파일 미수령, 빌드 반입 금지) | 검토 중 |
| 비고 | 특이사항(AI 생성 도구, 재배포 조건 등) | - |

## 대장

| ID | 분류 | 이름 | 사용 위치 | 출처 | 원본 URL | 제작자 | 라이선스 | 라이선스 원문 URL | 상업적 이용 | 수정 허용 | 크레딧 의무 | 크레딧 반영 위치 | 수정 여부 | 라이선스 사본 | 확인일 | 기록자 | 상태 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FNT-001 | 폰트 | Galmuri (Galmuri11 / Galmuri9 / Galmuri7) 2.40.3 → 변환물 mt-pixel-12 / mt-pixel-10 / mt-pixel-8 | 원본(빌드 미포함): `game/vendor/fonts/galmuri/` (Galmuri11/9/7.bdf). 변환물(빌드 포함): `game/public/fonts/mt-pixel-{12,10,8}.{png,json}` + `manifest.json`. 용도: 12px 대사·UI, 10px 라벨, 8px 숫자·영문 전용(D-042) | 외부(npm 레지스트리 공식 패키지 `galmuri@2.40.3`, 게시자 npm 계정 quiple, package.json `repository: quiple/galmuri`, `author: Lee Minseo`) | https://registry.npmjs.org/galmuri/-/galmuri-2.40.3.tgz (tarball sha1 `8eaa5ee9761d19030807254c5cf357a08958c05e`, sha512는 `SOURCE.txt`에 기록, 레지스트리 dist.integrity와 일치 확인은 개발 기록 기준) / 프로젝트: https://github.com/quiple/galmuri | 이민서 (Lee Minseo, quiple@quiple.dev) | OFL-1.1 | 패키지 내 `ofl.md`·`dist/LICENSE.txt`(원문 사본) / https://openfontlicense.org | 가능 [확인] | 가능 [확인]. 조건: 수정본도 OFL-1.1, 폰트 단독 판매 금지. **RFN 선언 없음 [확인]**(아래 비고). 그래도 변환물 이름은 mt-pixel-* 유지(D-046, 보수적) | 화면 크레딧 의무 없음 [확인]. 저작권 고지 + OFL 전문을 각 사본에 동봉 필수(OFL 조건 2) [확인] | `game/public/licenses/OFL-galmuri.txt` → 빌드 `dist/licenses/OFL-galmuri.txt` 동봉 [확인]. 게임 내 '오픈소스 라이선스' 화면은 권장(OFL 의무 아님) | 수정함(사용 글자 서브셋: 12px 2,534자 / 10px 2,534자 / 8px 100자 + BDF→BMFont 아틀라스 변환 + 폰트명 변경). 변환 스크립트 `game/scripts/build-fonts.ts` | `game/vendor/fonts/galmuri/ofl.md`, `ofl-ko.md`, `LICENSE.txt`(원본 그대로), `game/public/licenses/OFL-galmuri.txt`(파생 고지 + 저작권 줄 + OFL 전문) | 2026-11-22 | mt-compliance | **승인** (2026-11-22, T-128) | 승인 근거: ① 원본 `ofl.md`·`LICENSE.txt`를 직접 읽음. 저작권 줄 "Copyright © 2019–2025 Lee Minseo (quiple@quiple.dev)" 뒤에 "with Reserved Font Name …" 문구가 **없음** → RFN 미지정 [확인]. `ofl-ko.md`·README에도 RFN 지정 없음. BDF 3종의 `COPYRIGHT` 속성도 같은 줄 [확인]. ② 변환물 `info.face` = mt-pixel-12/10/8, 'Galmuri' 이름 미사용 [확인]. ③ 고지 파일에 저작권 줄 + OFL 1.1 전문 + 파생 설명이 있고 dist에 복사됨 [확인]. ④ 누락 글자 검사: 빌드 스크립트가 사용 글자 누락 시 실패, 허용 누락은 U+1F4E2(이모지) 1자뿐 → D-047(이모지 금지)에 따라 원문 문자열에서 제거 권장. 남은 일: GitHub 릴리스 태그와의 대조는 환경 제약(403)으로 못 함 [확인 필요, 출시 차단 아님]. 원본 교체·글자 추가 시 manifest 해시가 바뀌므로 대장 비고만 갱신 |
| FNT-002 | 폰트 | Fusion Pixel Font KR (8px / 10px / 12px) | 미정(FNT-001 대체안) | 외부(TakWolf, Fontsource 등재) | https://fontsource.org/fonts/fusion-pixel-12px-proportional-kr/about | TakWolf (+ 합쳐진 원 폰트 저작자들) | OFL-1.1 (일부 KR 빌드 [확인], 나머지 [추정]) | https://fontsource.org/fonts/fusion-pixel-10px-proportional-kr/about | 가능 [추정] | 조건부(원 폰트별 RFN 확인 필요) | 화면 크레딧 의무 없음 [추정]. 고지 + OFL 전문 동봉 | 미정 | 미정 | 미수령 | 2026-11-22 | mt-compliance | 후보 (2순위) | 여러 오픈소스 픽셀 폰트를 합친 폰트라 한글 글리프 출처와 RFN을 원 저장소에서 확인해야 함. 한글이 Galmuri에서 왔다면 대체안 의미 없음 |
| LIB-001 | 라이브러리 | Phaser 3.90.0 | 게임 엔진(빌드 번들 포함), `game/package.json` dependencies | 외부(npm `phaser`) | https://www.npmjs.com/package/phaser | Richard Davey, Phaser Studio Inc. | MIT | `game/node_modules/phaser/LICENSE.md` | 가능 [확인] | 가능 [확인] | 화면 크레딧 의무 없음. **저작권 고지 + MIT 허락 문구를 사본에 포함**해야 함 [확인] | 미반영 → `game/public/licenses/`에 `MIT-phaser.txt` 추가 필요(개발) | 원본 그대로 | (패키지 내) `node_modules/phaser/LICENSE.md` | 2026-11-22 | mt-compliance | 검토 중 | 번들(minify)에서 라이선스 주석이 제거될 수 있으므로 고지 텍스트 파일을 따로 동봉해야 승인. T-115 감사에서 대장 누락 발견 |
| LIB-002 | 라이브러리 | @apps-in-toss/web-framework 3.10.0 | 앱인토스 SDK(빌드 번들 포함) | 외부(npm, 토스) | https://www.npmjs.com/package/@apps-in-toss/web-framework | Viva Republica(토스) [추정, LICENSE 저작권 줄 미확인] | Apache-2.0 (package.json `license`) | `game/node_modules/@apps-in-toss/web-framework/LICENSE` | 가능 [확인] | 가능 [확인] | Apache-2.0 §4: 라이선스 사본 제공, NOTICE 파일이 있으면 그 내용 고지 [확인]. 패키지에 NOTICE 파일 없음 [확인] | 미반영 → `game/public/licenses/`에 `Apache-2.0-apps-in-toss.txt` 추가 필요(개발) | 원본 그대로 | (패키지 내) LICENSE | 2026-11-22 | mt-compliance | 검토 중 | 하위 의존성(전이 의존성) 중 번들에 들어가는 패키지의 라이선스는 미감사 [확인 필요] → 개발이 `vite build` 산출물 기준 라이선스 목록(예: rollup-plugin-license 류 또는 수동 목록)을 뽑아 주면 감사 |

## 감사 기록

| 날짜 | 감사자 | 범위 | 결과 | 조치 |
|---|---|---|---|---|
| 2026-11-22 | mt-compliance | 한글 도트 폰트 후보 조사(T-119): Galmuri, Fusion Pixel KR, Neo둥근모, 물마루, 도스고딕, 던파 비트비트체, GNU Unifont | FNT-001·002 후보 등록. 던파 비트비트체는 수정 후 재배포 금지라 부적합. 물마루는 원 배포처 미확인으로 보류 | PM 채택 결정 후 원본·ofl.md 수령 → RFN·수록 범위 재확인 → 승인 |
| 2026-11-22 | mt-compliance | T-128: FNT-001 원본(`game/vendor/fonts/galmuri/`)·변환물(`game/public/fonts/`)·고지(`game/public/licenses/`, `game/dist/licenses/`) 직접 점검 | ofl.md·LICENSE.txt에 RFN 선언 없음 [확인]. 변환물 이름 mt-pixel-*, 고지 동봉 확인. FNT-001 **승인**. `font-selection.md`의 RFN [확인] 표기 오류 정정 | 이모지 U+1F4E2 원문 제거(기획/개발). GitHub 릴리스 대조는 접근 가능할 때 |
| 2026-11-22 | mt-compliance | T-115 중 빌드 의존성 대조(`game/package.json`) | Phaser(MIT)·앱인토스 SDK(Apache-2.0)가 대장에 없었음(규칙 1 위반) → LIB-001·002 '검토 중' 등록 | 개발: 두 라이선스 고지 파일을 `public/licenses/`에 추가 → 컴플라이언스 재확인 후 승인 |
