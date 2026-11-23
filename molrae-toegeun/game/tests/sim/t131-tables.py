"""T-131 집계(tests/.out/t131-balance.json) → 마크다운 표 조각 출력. 사용: python3 -I tests/sim/t131-tables.py > tests/.out/t131-tables.md"""
import json
import sys

d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'tests/.out/t131-balance.json'))
B = d['byBot']
NAMES = {'straight': '직진', 'disguise': '위장(캐주얼 기준)', 'novice': '초보(반응 느림)'}


def f(x, n=1):
    return '-' if x is None or x != x else f'{x:.{n}f}'


print(f"원자료: 판 {d['runs']} (오류 {d['errors']}), 저작일 시드 {d['nA']}·생성일 시드 {d['nG']}, 소요 {d['sec']:.0f}초, 데이터 해시 {d['dataHash']}\n")

print('### 구간별 요약\n')
print('| 봇 | 구간 | 판 | 1판 길이 평균(최소~최대) | 칼퇴 ★2+ | 적발 | 야근(★1) | 찝찝(★1) | ★0/★1/★2/★3 | 최고 의심 평균 |')
print('|---|---|---|---|---|---|---|---|---|---|')
for b in ['straight', 'disguise', 'novice']:
    for g, lab in [('d1_5', '1~5일(인턴)'), ('d1_10', '1~10일'), ('d6_15', '6~15일(사원)'), ('d16_30', '16~30일(생성)'), ('d31_60', '31~60일(생성)'), ('ceoDays', '순시 날')]:
        s = B[b][g]
        st = '/'.join(f(x, 0) for x in s['stars'])
        print(f"| {NAMES[b]} | {lab} | {s['n']} | {f(s['lenMean'])} ({f(s['lenMin'])}~{f(s['lenMax'])}) | {f(s['leavePct'])}% | {f(s['caughtPct'])}% | {f(s['overtimePct'])}% | {f(s['shortPct'])}% | {st} | {f(100*s['peakMean'])}% |")
print()

print('### 일차별(위장 봇 = 캐주얼 기준)\n')
print('| 일차 | 판 | 길이 평균 | 최대 | 칼퇴 | 적발 | 야근 | 찝찝 | ★3 | 직진 최고의심 | 초보 칼퇴 |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
for day in sorted(B['disguise']['perDay'], key=int):
    s = B['disguise']['perDay'][day]
    st = B['straight']['perDay'][day]
    nv = B['novice']['perDay'][day]
    print(f"| {day} | {s['n']} | {f(s['lenMean'])} | {f(s['lenMax'])} | {f(s['leavePct'])}% | {f(s['caughtPct'])}% | {f(s['overtimePct'])}% | {f(s['shortPct'])}% | {f(s['stars'][3])}% | {f(100*st['peakMean'])}% | {f(nv['leavePct'])}% |")
print()

print('### 적발 원인(판 수)\n')
for b in ['straight', 'disguise', 'novice']:
    c = sorted(B[b]['causes'].items(), key=lambda x: -x[1])
    tot = sum(v for _, v in c)
    print(f"- {NAMES[b]}({tot}판): " + ', '.join(f'{k} {v}({100*v/max(1,tot):.0f}%)' for k, v in c[:10]))
print()

print('### 의심 상승 출처(합계 비중)\n')
for b in ['straight', 'disguise', 'novice']:
    g = B[b]['gain']
    tot = sum(g.values())
    print(f"- {NAMES[b]}: " + ', '.join(f'{k} {100*v/tot:.1f}%' for k, v in sorted(g.items(), key=lambda x: -x[1])))
print()

print('### 미션별 성공률(시도한 판 기준)\n')
print('| 봇 | 구간 | 미션 | 시도 | 성공 | 실패 | 시간초과 | 적발로 중단 | 퇴근 시작으로 중단 | 시도 안 함 |')
print('|---|---|---|---|---|---|---|---|---|---|')
for b in ['straight', 'disguise', 'novice']:
    for rank in ['intern', 'staff', 'gen']:
        for mid, g in sorted(B[b]['mis'].get(rank, {}).items()):
            n = g['n']
            pc = lambda k: f"{100*g.get(k,0)/n:.1f}%" if n else '-'
            print(f"| {NAMES[b]} | {rank} | {mid} | {n} | {pc('done')} | {pc('fail')} | {pc('timeout')} | {pc('caught')} | {pc('other')} | {g.get('notStarted', '-')} |")
print()

print('### 공정성 전수 검사(모든 판, 모든 틱)\n')
F = d['fair']
for k in ['gazeTicks', 'offscreenGazeTicks', 'hudRowGazeTicks', 'cameraMismatchTicks', 'unexplainedRiseTicks', 'onsets', 'onsetNoLead', 'looks', 'lookShortTell', 'lookWithoutTell']:
    print(f'- {k}: {F[k]}')
print(f"- 시선 시작 원인: {F['causes']}")
print(f"- 선행 미달 예: {F['noLeadSamples']}")
print('- 페이크: ' + ', '.join(f"{a} {v['fakes']}/{v['tells']}({100*v['fakes']/max(1,v['tells']):.1f}%, 연속 {v['consecutive']})" for a, v in F['fakes'].items()))
print()
print('### 인원·배경 동료\n')
C = d['crowd']
print(f"- 화면 안(HUD 제외) 최대 {C['maxOnScreen']}명, 화면 20행 전체 최대 {C['maxOnScreenFull']}명, 층 전체 최대 {C['maxOnFloor']}명, 8명 초과 판 {C['over8Runs']}")
print(f"- 일차별 화면 안 최대: {C['byDayMaxOnScreen']}")
print(f"- 배경 동료: 시선 틱 {C['bgGaze']}, 화살표 틱 {C['bgArrow']}, 길막 {C['bgBlocked']}")
print()
print('### 말걸기(하루 플레이 중)\n')
print('| 봇 | 액터 | 전조 | radius 진입 | 성립 | 위장 취소 | 그냥 지나감 | 피함 | release 중 시선 | 종료 후 0.5초 상승 틱 |')
print('|---|---|---|---|---|---|---|---|---|---|')
for b, m in d['talk'].items():
    for a, g in m.items():
        if a == 'postTalk':
            continue
        print(f"| {NAMES[b]} | {a} | {g['warn']} | {g['armed']} | {g['talk']} ({100*g['talk']/max(1,g['warn']):.0f}%) | {g.get('disguised',0)} | {g.get('missed',0)} | {g.get('escaped',0)} | {g['releaseGainTicks']} | - |")
    print(f"| {NAMES[b]} | (말걸기 종료 후 0.5초 안 상승 틱) | | | | | | | | {m.get('postTalk',{}).get('postHoldViol',0)} |")
print()
L = d['leaveDelay']
print('### 퇴근 방해 지연(위장 봇, 같은 시드 방해 제거판과 비교)\n')
print(f"- 짝 {L['pairs']}개, 방해 {L['interrupts']}건 → 1건당 {f(L['perInterruptSec'],2)}초 (말걸기·길막 대기 직접 합 {f(L['directPerInterruptSec'],2)}초)")
print('- 방해 1개만 있던 판: ' + ', '.join(f"{k} {v['n']}판 {v['mean']:.2f}초" for k, v in sorted(L['singleInterrupt'].items())))
print()
print('### 기타(§19-3 QA 열)\n')
for b in ['straight', 'disguise', 'novice']:
    s = B[b]
    print(f"- {NAMES[b]}: 쇼핑 완료 소요 n={s['shopSec']['n']} 평균 {f(s['shopSec']['mean'],2)}초 최소 {f(s['shopSec']['min'],2)} p90 {f(s['shopSec']['p90'],2)} / 게이트 단계 평균 {f(s['gate']['stageSecMean'],2)}초, 단계 중 상승 합 {f(s['gate']['riseSum'],3)}, 정체 규칙 초과 {f(s['gate']['nonStaleRise'],3)}, 3초 이내 통과 판의 상승 {f(s['gate']['quickPassRise'],3)} / INT-08 퇴근 전조 틱 {s['int08']['ticks']} 상승 {f(s['int08']['rise'],3)} / 아슬아슬 평균 {f(s['closeCallsMean'],2)}회")

print()
print('### 대표님 순시·엘리베이터 대표님·공범\n')
print('| 봇 | 순시 날 판 | 순시 시작 | 취소(안 앉음) | 눈도장 | 순시 중 적발 | 순시 시작 판 전체 적발 | 적발 중 순시 원인 | 순시 중 상승 평균 | QTE 결과 | 얼음 중 대표님 외 시선 틱 | 시계 정지 위반 | 미션 시계 위반 | 복귀 후 3초 시선 시작 / 전조 없음 |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for b in ['straight', 'disguise', 'novice']:
    c = B[b]['ceo']
    print(f"| {NAMES[b]} | {c['days']} | {c['started']} | {c['cancelled']} | {f(c['eyeContactPct'])}% | {f(c['caughtDuringPct'])}% | {f(c['caughtAllPct'])}% | {f(c['caughtDuringShareOfCaught'])}% | {f(c['gainMean'],3)} | {c['qte']} | {c['freezeOtherGazeTicks']} | {c['clockViol']} | {c['missionClockViol']} | {c['resumeOnsets']} / {c['resumeNoTell']} |")
for b in ['straight', 'disguise', 'novice']:
    e = B[b]['elevCeo']; a = B[b]['acc']
    print(f"- {NAMES[b]}: 엘리베이터 대표님 {e['started']}회 QTE {e['qte']} 그 판 적발 {e['caughtAfter']} / 공범 합류 {a['joined']}회, 같이 끝낸 미션 {a['done']}개 점수 {a['points']} (기본 {a['base']}, 배율 {a['points']/max(1,a['base']):.2f})")
