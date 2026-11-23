# 앱인토스 WebView SDK 3.x 연동 메모 (T-102)

작성일 2026-11-22. **설치·빌드 확인됨**: `@apps-in-toss/web-framework@3.10.0` (npm 2026-11-06 배포, latest).

## 출처와 확인 수준
| 표시 | 의미 |
|---|---|
| [확인-타입] | npm 패키지 `@apps-in-toss/web-framework@3.10.0`의 `dist/index.d.ts`, `dist/config.d.ts` 원문에서 확인 |
| [확인-CLI] | `@apps-in-toss/cli@3.10.0` `dist/index.js` 원문(명령 정의·도움말 문자열)에서 확인 |
| [검색] | WebSearch 결과 요약으로만 확인 (원문 미열람) |
| [추측] | 근거 부족, 실기기·공식 문서로 재확인 필요 |

- 공식 문서 `developers-apps-in-toss.toss.im`은 이 세션의 네트워크 허용 목록 밖이라 **직접 열람 실패**. 원문 확인이 필요하면 해당 호스트 허용이 필요함.
- 검색으로 확인된 문서 위치 [검색]: https://developers-apps-in-toss.toss.im/development/sdk-3.x , https://developers-apps-in-toss.toss.im/ai-vibe-coding/tutorials/webview.md

## 패키지
- `@apps-in-toss/web-framework` 3.10.0 (런타임 API + `ait` CLI bin 포함). 의존: `@apps-in-toss/cli@3.10.0`, `@webview-bridge/web@1.7.10` [확인-타입: package.json]
- 개발 도구 `@apps-in-toss/devtools`: `ait init`이 devDependencies에 추가하고 번들러 플러그인(`@apps-in-toss/devtools/unplugin`)을 주입함 [확인-CLI]. **이번 작업에서는 미설치** (init 대화형 흐름을 거치지 않았기 때문. 필요 시 추가).

## 설정 파일 `apps-in-toss.config.ts`
- SDK 3.x에서 `granite.config.ts` → `apps-in-toss.config.ts`로 이름 변경 [검색][확인-CLI: `ait migrate v3`, 도움말 문자열]
- `ait build`는 `apps-in-toss.config.(ts|js|mjs)`를 프로젝트 루트에서 읽고, `webBundleDir`(기본 `dist`)를 그대로 `<appName>.ait`로 패킹 → 먼저 `vite build` 필요 [확인-CLI]
- 스키마 [확인-타입]: `appName`(필수), `permissions`(필수 배열), `navigationBar?`, `webView?`(`bounces`, `pullToRefreshEnabled`, `overScrollMode`, …), `webBundleDir?`, `brand?`(3.10.0에서 deprecated)
- 현재 값: `appName: 'molrae-toegeun'` **[추측: 콘솔 등록명과 일치해야 함 → 콘솔 등록 후 교체]**, `permissions: []`, 스크롤 바운스·당겨서 새로고침 끔.
- `ait dev` 명령은 3.x CLI에 없음(명령: init, build, deploy, migrate, token) [확인-CLI] → 로컬 개발은 `vite` 그대로. 실기기 테스트 시 `npm run dev:host`(`--host`) [검색].

## API 매핑 (`src/platform/toss.ts`)
| 어댑터 | SDK API [확인-타입] | 비고 |
|---|---|---|
| storage | `Storage.getItem/setItem/removeItem` (문자열, Promise) | `getItems/setItems`는 토스앱 5.270.0+ |
| ads 전면 | `loadFullScreenAd({options:{adGroupId}, onEvent, onError})` → `loaded` 이벤트, `showFullScreenAd(...)` → `show/impression/clicked/dismissed/failedToShow` | 둘 다 `.isSupported()` 보유, 반환값은 구독 해제 함수 |
| ads 보상형 | 같은 API, show 이벤트 `userEarnedReward {unitType, unitAmount}` | **[추측]** 전면/보상형 구분은 광고 그룹(adGroupId) 설정으로 결정된다고 해석 |
| leaderboard | `Game.setLeaderboardScore({score: string})` → `statusCode: SUCCESS / LEADERBOARD_NOT_FOUND / PROFILE_NOT_FOUND / UNPARSABLE_SCORE`, 앱 버전 미달 시 `undefined`; `Game.openLeaderboard()` | 토스앱 5.221.0+. 구 함수 `submitGameCenterLeaderBoardScore`, `openGameCenterLeaderboard`는 deprecated |
| share | `Share.sendMessage({message})` (네이티브 공유 시트) | 링크는 `Share.createLink({path:'intoss://...', ogImageUrl?})`, 공유 리워드는 `Viral.share({campaignId,...})`/`contactsViral` — 미연동 |

기타 확인된 관련 API(미연동): `Screen.setOrientation` / `setDeviceOrientation({type:'portrait'})`(5.215.0+), `setScreenAwakeMode`, `getSafeAreaInsets`, `getOperationalEnvironment(): 'toss' | 'sandbox'`, `generateHapticFeedback`, `TossAds.attachBanner`(배너).

## 플랫폼 선택 로직 (`src/platform/index.ts`)
- dev 서버: 항상 mock. `?ads=off`로 광고 미지원 기기 시뮬레이션, `?platform=mock` 강제.
- production 빌드: `window.ReactNativeWebView` 존재 시 토스 어댑터 동적 로드, 없으면 mock. **[추측: 토스 WebView가 RN WebView 기반이라는 가정 — 실기기 확인 필요]**. `VITE_PLATFORM=toss`로 강제 가능.
- 토스 어댑터는 별도 청크(`toss-*.js`, gzip 약 21KB)로 분리.

## 남은 작업 / 확인 필요
1. 콘솔 앱 등록 후 `appName`, 광고 그룹 ID(전면·보상형), 리더보드 생성 — 오너 행위(외부).
2. 실기기에서 브리지 감지·Storage 영속성·광고 이벤트 순서 확인.
3. 세로 고정을 위한 `Screen.setOrientation` 호출 필요 여부(콘솔 설정으로 되는지) 확인.
4. `ait deploy` 스크립트는 외부 제출 행위이므로 일부러 추가하지 않음(오너 승인 사항).

## 광고 흐름 (T-133, `src/ads/adFlow.ts`)
| 화면 | 배치 | 규칙 |
|---|---|---|
| 출근 준비(`PrepScene`) | `ceo_pass` | 그날 순시가 있고 `isSupported()` + 하루 상한이 남았을 때만 버튼. 보상 수령 시 `skipCeoVisit` |
| 적발 컷인 2초 뒤 | `continue` | 컷인(플레이 상태) 동안은 제안 없음. 지원·상한이 안 되면 제안 화면 생략(⑥). 두 버튼 같은 크기·같은 스타일(②), 카운트다운 없음(③). 버튼을 누른 뒤에만 로드·노출(①). 보상 수령 때만 재개, 중도 종료·실패 = 결과 + 안내(⑤) |
| 결과 | `salary_double` | 버튼만(팝업 없음, ⑧). 보상 수령 시 이번 판 월급 2배(게임 속 재화) |
| 결과 → 다음 날 | 전면 | `decideInterstitial` → 노출 대상이면 `ad.interstitial_notice`를 `noticeSec` 동안 예고 후 노출. 이 판에 보상형을 봤으면 건너뜀 |
- 카운터(`AdCounters.rewardedShownToday`, `rewardedByPlacementToday`)는 보상 수령 때만 올림.
- 로컬 검증: `?ads=off`(미지원), `?adResult=dismiss`(중도 종료), `?adResult=fail`(노출 실패).
- 리더보드: 결과 → 다음 날 때 `continued`가 아니면 `submitScore(땡땡이 점수)`.
- '오늘 광고 끝' 토스트는 문구 키 `ad.today_done`이 데이터에 생기면 표시(현재 키 없음).

## 사운드 (T-133, `src/audio/`)
- `AudioScene`(상주)이 첫 터치 뒤 `audio-manifest.json`의 MP3 파일(단일 포맷, D-063·D-065)을 지연 로드. 초기 번들·첫 판 진입 시간에 포함되지 않음.
- BGM 2스템 단계는 `DangerStageTracker`(올릴 때 즉시, 내릴 때 `hysteresis.downgradeDelaySec`)가 정하고, 화면 테두리도 같은 단계를 씀.
- `?sound=off`로 음소거(시각 신호는 그대로).
