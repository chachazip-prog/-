# NPC·하루 규칙 (구현 기준, T-127 → T-129 데이터 v2)

코드 위치: `src/core/patrol.ts`(NPC), `src/core/floorSim.ts`(이동·시선·의심), `src/core/player.ts`, `src/core/suspicion.ts`, `src/core/camera.ts`, `src/core/day/`(하루 규칙), `src/content/buildDay.ts`(데이터 조립).

## 0. 데이터 흐름 (T-129)

- `game/data/*.json` v2 → `buildDayContent(tables, day)`(순수 함수) → `DayContent` → `new DaySim(content, { view })`.
- 씬은 `src/content/index.ts`의 `loadDayContent(day)`를 쓰고, QA는 fs로 읽은 테이블을 같은 함수에 넘기면 됩니다(`scripts/smoke-day.ts`가 예시).
- 16일차 이후는 `generateDay()`(days.generator 요약 구현).
- `src/dev/protoFloor.ts`는 QA 코어 테스트(T-124) 호환용으로만 남겨 둡니다. 앱은 쓰지 않습니다.
- 데이터에 값이 없을 때만 쓰는 기본값: `TALK_DEFAULTS`(patrol.ts), `DEFAULTS`(buildDay.ts). 현재 데이터(T-132)에는 모두 값이 있습니다.

## 1. 방향 전환 전조 (BUG-001, D-038 → D-044 조건부)

- 대상: 경로 모퉁이, 대기·돌아보기 후 재출발, 말걸기 종료 후 원래 방향 복귀.
- 판정(`FloorSim.turnNeedsTell`): 새 방향의 경고 콘(거리 + `threat.approachExtraRange`, 반각 + `approachExtraAngleDeg`, 가림 무시) 안에 플레이어가 있으면 전조.
- v2: 전환 후 상태에서 콘이 꺼져 있으면(`coneActiveIn`에 그 상태가 없음) 전조 없이 회전합니다. 전조 길이는 `rules.sight.cornerTurnTellSec`.

## 2. 앉은 모드·범위 추첨·페이크 (X1, X2)

- `patrols.kind = seated` → 대기(`waitSec` 또는 `useActorIdle` → `sim.idleSecRange`) → (통화 기회 `opportunities.phone_call.probPerCycle`) → 전조(`tellSecRange`) → 돌아보기(`lookSecRange`) → 복귀(`rules.sight.returnSec`, 웨이포인트 `facing`) → 대기 ….
- 콘은 `sim.coneActiveIn`에 있는 상태에서만 켜집니다(선배·팀장 = `look`만).
- 페이크: 전조 후 시선 없이 `afterFakeSec` 멈춤. 확률 = min(`chance`, `capChance`, `rules.fake.absoluteCapProb`), `noConsecutiveFakes`면 직전이 페이크일 때 반드시 진짜.
- 연속 두 번 보기: 첫 look 뒤 `gapSec` 쉬고 `secondTellSec` 전조 → 두 번째 look.
- 걷는 사람의 정지 둘러보기·뒤돌아보기 전조는 `stopLookTellSec`(있으면).
- 대기 0초·돌아보기 없음·웨이포인트 1개인 자리(공범 동료 등)는 계속 앉아 있습니다.

## 3. 말걸기 (D-043, D-054, X3)

1. 플레이어가 `talk.noticeRadius` 안에 들어오면 전조(말풍선 `warnLineKey`, 길이 `talk.tellSec`, 최소 0.5초)가 시작됩니다. 단 다음이면 시작하지 않습니다.
   - 플레이어가 멈춤·위장 중(`skipIfPlayerDisguised` + `anyStopIsDisguised`)
   - 그 말걸기의 방해(`enabledBy`)가 그날 그 단계(근무/퇴근)에 없음
   - `onlyWhilePlayerAway`인데 플레이어가 자리에 있음
   - `onlyWhen`/조건(`leave_phase_before_1800` 등) 불충족, `maxPerDay`·`cooldownSec` 초과
   - 미션 행동 중이거나 게이트를 통과한 뒤
2. 전조가 끝날 때 다음을 모두 만족하면 말걸기가 성립합니다(플레이어 강제 정지).
   - 전조 중 한 번이라도 `talk.radius` 안에 들어왔음
   - 지금 `catchRadius` 안에 있음
   - 위장 중이 아님
3. 성립하지 않으면 취소됩니다.
   - 위장했거나 발동 반경에 들어오지 않았으면 조용히 원래 상태로 돌아가고 `dodgedLineKey`를 말합니다.
   - 반경 안에 들어왔다가 피해 나갔으면 그쪽을 돌아봅니다(전조 → look, D-054).
4. 말걸기 중 의심 상승은 0입니다(코드 고정, `talkedPerSec` 폐지). 탭하면 맞장구로 `nodShortenSec`만큼 줄어듭니다(최소 `minDurationSec`).
5. 끝나면 경로를 재개합니다(D-039). 재개 시점에 누군가의 콘 안이면 `movement.postTalkHoldSec` 동안 위장 상태로 기다렸다 출발합니다. 말을 건 NPC의 시선은 `releaseSec` 동안 의심에 반영하지 않습니다.

## 4. 멈춤 = 위장, 위장 정체 (X5)

- `suspicion.anyStopIsDisguised`: idle도 위장으로 계산합니다(도착 직후 `disguiseSettleSec` 동안은 이동 상승률).
- 연속 노출이 `disguiseStaleAfterSec`를 넘으면 `disguiseStalePerSec` × 배율. 엄폐물(legend `cover`) 옆이면 면제.
- 멈춘 상태에서 내 캐릭터를 탭하면 원래 목적지로 이어 갑니다(`input.tapOnSelfWhileStopped`).

## 5. 경고 단계·화면 밖 판정 (X6, X10)

- 카메라는 코어(`CameraModel`, maps.camera)가 소유하고, 씬은 그 값을 스크롤로 씁니다. 화면 안 = HUD가 가리지 않는 지도 행(`config/display.ts` `CAMERA_VIEW`).
- `offscreenSourceNoGain`: 콘 주인이 화면 밖이면 의심 판정에서 빠집니다(`seeing=false`).
- `threatOfNpc`:
  - `turning` = 전조 중이고 돌아볼 방향의 실제 콘이 가림을 반영해 플레이어를 덮음
  - `approaching` = (넓은 콘 안 + 가림 없음) 또는 (통행 경로 ≤ `approachPathTilesWithin`이고 줄어드는 중)

## 6. 순찰 종료·등장·길막 (X7, X8)

- `loop:false`면 마지막 웨이포인트에서 끝납니다. 이후 `despawnAtEnd`면 제거하고, `thenPatrol`이 있으면 같은 자리에서 그 순찰로 교체합니다.
- `spawnTellSec` 동안은 'spawn'(정지, 시선 없음)입니다.
- `holdForReport`/`holdForQte` 웨이포인트에서는 'hold' 상태로 `release()`를 기다립니다.
- 플레이어 통행:
  - 사람이 서 있거나 앉은 칸(배경 동료 `blocksPlayer:false` 제외)과 게이트(`gateOnly`, 태그 성공 전)는 막힙니다.
  - 다음 칸이 막히면 `blockedWaitSec` 기다립니다. 그다음 `rerouteMaxExtraTiles` 안의 우회로가 있으면 우회하고, 없으면 `rerouteRecheckSec`마다 다시 봅니다. 기다리는 동안은 위장으로 계산합니다.

## 7. 하루 (X9, `DaySim`)

- 단계: 인트로(`day.introSec`) → 근무(`dayPhaseSec`, 시계 09:00→17:48) → 퇴근(1초 = 1분, 18:18 = 야근) → 결과.
- 업무 게이지: 자리에 앉아 멈춰 있고 미션이 없을 때 `work.fillPerSec`.
- 미션은 `unlockAtSec`에 열립니다. 칩을 탭하면 이동하고, 도착하면 행동을 시작합니다(장소를 직접 탭해 도착해도 시작).
  - 제한 시간은 자리를 뜬 순간부터 셉니다.
  - `return_to_seat` 미션은 자리로 돌아와야 완료됩니다.
- 상태별 상승률: 자리 업무 `seatedWorkingPerSec`, 행동 `activityPerSec`(낮잠 고개 반쯤이면 ×`headDownVisibleStateMultiplier`), 일시정지 `activityPausedPerSec`, 화장실 칸 0, 게이트 통과 후 0.
- 퇴근 순서:
  1. 가방: 자리에서 `pack.sec`, 탭하면 멈춤.
  2. 게이트 사용 칸에 서면 막대가 나타납니다. 창 안에서 탭하면 통과합니다.
     - 실패하면 `beepSuspicion`이 오르고 경비가 전조 후 돌아봅니다.
     - `maxAttempts`번 실패하면 야근입니다.
  3. 엘리베이터 앞에서 `waitSecRange` 동안 기다립니다.
- 별:
  - 적발: ★0
  - 야근: ★1
  - 업무 미달: ★1(야근 제목)
  - 필수 미션 미달: ★1(찝찝한 칼퇴)
  - 칼퇴: ★2
  - 최고 의심이 `star3PeakBelow` 미만인 칼퇴: ★3

## 8. 탭 결과 (BUG-004)

| 결과 | 의미 |
|---|---|
| `here` | 탭한 타일이 지금 서 있는 타일 중심. 상태 변화 없음 |
| `unreachable` | 보정 반경 안에 통행 타일이 없거나 경로가 없음 → '거긴 못 가요'(`hud.unreachable`) |
| `nod` | 말걸기 중 맞장구 |

## 9. 고정 스텝 (BUG-005) · 결과 입력 보호 (BUG-006)

- `advance()`는 잔여가 `h - 1e-9`초 이상이면 스텝을 진행합니다.
- 결과 화면이 뜬 뒤 `rules.input.resultInputGuardSec` 동안 탭을 무시합니다.

## 10. T-133 추가 규칙 (구현 기준)

### 10-1. 대표님 순시(INT-09, `DaySim.ceoState`)
- 날짜 결정: `generateDay` → `ceoForDay()`. 직급 cast에 ceo가 있고 `generator.ceo.debutDay`(28) 이후. 수요일(`occurrence.scheduledWeekday`) 정기, 그 외는 시드 `day-{n}-boss`로 `randomChancePerDay`. 예정 시각 = 근무 구간 × [0.4, 0.7](같은 스트림).
- 순시 날: 미션 −1·필수 −1(최소 2), 근무 구간 −`ceoDayPhaseReductionSec`, 퇴근 방해 최대 2, 인사팀(INT-05·06) 제외, ±25초 안의 INT-10 제외(H7, 재배치 없음). 비순시 날의 plan 스트림 추첨은 바뀌지 않음.
- 단계: `pending`(예정 시각 이후 자리에 멈춰 있는 첫 순간, 본부장이 층에 있으면 대기) → `tell`(화물 엘리베이터 등장 전조 1.0초) → `freeze`(걸어옴, 전역 규칙) → `qte`(인사) → `talk`(대화 지점) → `exit` → `resume`(`exitResumeDelaySec`) → `done`. 끝까지 안 앉으면 퇴근 시작 때 `cancelled`. CEO 패스는 `skipped`.
- 시계 정지: tell~talk 동안 근무 구간 시계·방해 타이머·미션 제한 시간 정지.
- 얼음 전역 규칙: 움직이기 시작하는 순간 `moveStartInstantSuspicion`, 이동·행동 중 `movingPerSec × 대표님 gazeMultiplier`/초. 이때 대표님 콘은 판정·표시 모두 하지 않음(비네트가 대신).
- 얼음(H3·H4): 대표님 외 모든 NPC(배경 동료 포함)는 갱신·시선·말걸기·경고가 멈춤(`FloorHooks.npcFrozen`). 해제할 때 전조·돌아보기 중이던 사람은 `interruptLook()`으로 끊어서 다음 시선이 반드시 전조부터 시작.
- QTE(`core/day/qte.ts`): '?' 예고(`preCueSecRange`) 중 누르면 early, '!' 창(`windowSec × qteWindowScale`) 안에서 누르고 `maxPressSec` 이하로 떼면 success, 길게 누르면 long, 놓치면 miss. 씬은 누름·뗌(`pressQte`/`releaseQte`), 봇은 `tapQte()`.
- 대화 구간: 대표님이 대화 지점에 서 있는 동안 점수 × `slackMultiplier`(`addPoints`).
- 눈도장: 전조~퇴장 동안 의심 증가 합 < `survival.maxSuspicionGain` 그리고 QTE 성공 → `rewardSlackPoints`.
- 재확인: `p_ceo_visit` 대화 지점 `lookChance`(진짜 시선). `bosses.ceo.sim.fake`(type 'recheck')는 페이크로 쓰지 않음.

### 10-2. 엘리베이터 대표님(INT-11)
- 발생은 `buildDayContent`에서 확정: 과장 이상·`unlockDay` 이후·순시 없는 날에 시드 `day-{n}-event`로 `trigger.chance`, 30일차 데뷔는 확정.
- 엘리베이터 대기 진입 시 `p_ceo_elevator` 등장 → hold에서 QTE → 성공 +`successPoints`, 실패 +`failSuspicion`(적발 상한 바로 아래까지만). QTE가 끝날 때까지 엘리베이터 대기 시간 정지.

### 10-3. 공범(INT-12)
- 제안 대상: 1~15일차는 `days.scripted accomplice_offer`만, 16일차~는 시드 `day-{n}-npc`로 미션마다 `offerProb`(제안 여부만 확률, 보상은 결정적).
- 미션 칩을 누를 때 제안(`DaySim.offer`). `forced: true`는 시간 제한 없이 그 미션이 시작될 때까지 떠 있음 [해석]. 수락 = `acceptOffer()`(HUD 입력).
- 합류: 공범 자리 NPC를 빼고 `Follower`(트레일 추종, `followGapTiles`)로 따라옴. 공범을 보는 시선도 나로 계산(`FloorHooks.extraGaze`), 상승률 × `suspicionGainMultiplier`, 그 미션 보상 × `rewardMultiplier`.
- 망보기: 반경 `lookoutRadiusTiles` 안 앉은 상사의 다음 전조까지 `lookoutCoughLeadSec` 이하면 헛기침 이벤트(`PatrolNpc.upcomingTellSec`). 걷는 사람은 예측하지 않음.
- 미션 완료·실패·퇴근 시작·이어하기 때 자리로 걸어 돌아가 앉음(시선·길막 없음).

### 10-4. 위계 연쇄 H1·H2(본부장 → 팀장 인사)
- INT-10이 켜진 날 `effect.teamLeadGreeting`: 본부장이 `team` 구역 안이면 앉은 팀장을 인사 순찰(자리 → `tl_greet_spot` hold → 자리, 시선·말걸기 없음)로 교체. 몸이 통로를 막음(길막).
- 본부장이 구역을 떠나고 `team_lead.hierarchy.resumeDelaySec` 뒤 자리로 돌아가 앉고, 새 대기 주기부터(다음 시선은 전조부터).

### 10-5. 말걸기 회피 돌아보기(T-134 ④)
- 전조 중 반경에 들어왔다가 피하면 `rules.sight.cornerTurnTellSec` 전조(고개 먼저 + 점선 콘) 뒤 그 액터 `lookSec` 돌아보기. `releaseSec` 없음, 혼잣말 없음. 혼잣말은 위장·그냥 지나감(조용한 취소)에만.

### 10-6. 스크립트
- `boss_look`·`boss_look_when`: `slowMo`는 `DaySim.timeScale`(표시만 느리게, 판정은 같은 고정 스텝).
- `boss_look_when`(player_moving_in_cone_path): 걷는 중이고 선배가 돌아볼 방향의 실제 콘이 나를 덮을 수 있을 때.
- `route_hint`: 칩을 누를 때 via가 없는 경로 = 지름길(dot/caution), via가 있으면 우회(dot/hint), 4초.
- `offscreen_demo`: 구역에 들어가고 그 액터가 화면 밖이면 화살표 2.5초 시연.
- `cover_hint`: 전조가 시작될 때 엄폐 칸 `radiusTiles` 안이면 안내.
- `snitch_spot`: 첫 미션 행동 순간 체류 없이 보고 시작, 없으면 `fallbackAtSec`.

### 10-7. 이어하기(D-050)
- `DaySim.canContinue` → 광고 보상 수령 시에만 `continueFromCheckpoint()`. 의심 `continueResumeSuspicion`(데이터 숫자 필드 없음 → 0.6), 자리(퇴근 중 가방을 챙긴 뒤면 게이트 앞)로 이동, 진행 중 미션은 다시 열림, 순시는 눈도장 없이 종료. 결과 `continued: true` → 리더보드 미제출(D-056). 같은 판에서 한 번만.
