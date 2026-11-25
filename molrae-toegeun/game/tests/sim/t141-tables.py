"""T-141 집계: tests/.out/t141/bal-*.jsonl → 합격선 9개·부가 지표 요약(마크다운 조각). 사용: python3 -I tests/sim/t141-tables.py [원자료 폴더]"""
import collections
import glob
import json
import statistics
import sys

D = sys.argv[1] if len(sys.argv) > 1 else 'tests/.out/t141'
rows = [json.loads(l) for f in sorted(glob.glob(f'{D}/bal-*.jsonl')) for l in open(f) if l.strip()]
err = [r for r in rows if 'error' in r]
ok = [r for r in rows if 'error' not in r]
main = [r for r in ok if not r['strip'] and r['pv'] == 'm']
strip = [r for r in ok if r['strip']]
fem = [r for r in ok if r['pv'] == 'f']
fac = {x['day']: x for x in json.load(open(f'{D}/facility.json'))} if glob.glob(f'{D}/facility.json') else {}


def pct(a, b):
    return 100.0 * a / b if b else float('nan')


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else float('nan')


def f(x, n=1):
    return '-' if x is None or x != x else f'{x:.{n}f}'


def by(bot, lo, hi, extra=lambda r: True):
    return [r for r in main if r['botKey'] == bot and lo <= r['day'] <= hi and extra(r)]


def stats(rs):
    n = len(rs)
    st = [0, 0, 0, 0]
    for r in rs:
        if r['stars'] >= 0:
            st[r['stars']] += 1
    L = [r['timeSec'] for r in rs]
    return dict(n=n, len=mean(L), lmax=max(L) if L else float('nan'), lmin=min(L) if L else float('nan'),
                leave=pct(sum(r['stars'] >= 2 for r in rs), n), caught=pct(sum(r['outcome'] == 'caught' for r in rs), n),
                over=pct(sum(r['outcome'] == 'overtime' for r in rs), n), short=pct(sum(r['outcome'] == 'leave_short' for r in rs), n),
                timeout=sum(r['outcome'] == 'timeout' for r in rs), stars=[pct(x, n) for x in st], peak=mean(r['peak'] for r in rs))


print(f'원자료 {len(rows)}판(오류 {len(err)}), 본 측정 {len(main)}판, 방해 제거 짝 {len(strip)}판, 여성 플레이어 짝 {len(fem)}판\n')
if err:
    print('오류 예:', err[0]['error'][:400])
NAMES = {'straight': '직진', 'disguise': '위장(캐주얼 기준)', 'novice': '초보'}
SEG = [('1~5', 1, 5), ('1~10', 1, 10), ('6~15(사원)', 6, 15), ('16~30', 16, 30), ('31~60', 31, 60), ('61~200', 61, 200), ('1~60', 1, 60), ('1~200', 1, 200)]
print('### 구간별 요약\n')
print('| 봇 | 구간 | 판 | 길이 평균(최소~최대) | 칼퇴 ★2+ | 적발 | 야근 | 찝찝 | 시간초과(미종료) | ★0/1/2/3 | 최고의심 평균 |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
S = {}
for b in NAMES:
    for lab, lo, hi in SEG:
        s = stats(by(b, lo, hi))
        S[(b, lab)] = s
        print(f"| {NAMES[b]} | {lab} | {s['n']} | {f(s['len'])} ({f(s['lmin'])}~{f(s['lmax'])}) | {f(s['leave'])}% | {f(s['caught'])}% | {f(s['over'])}% | {f(s['short'])}% | {s['timeout']} | {'/'.join(f(x, 0) for x in s['stars'])} | {f(100 * s['peak'])}% |")
print()

# 순시
def ceo_stats(b, lo=1, hi=200):
    v = [r for r in by(b, lo, hi) if r['ceo']['visit'] != 'none']
    st = [r for r in v if r['ceo']['started']]
    caught = [r for r in st if r['outcome'] == 'caught']
    return dict(days=len(v), started=len(st), eye=pct(sum(r['ceo']['eyeContact'] for r in st), len(st)),
                caughtDuring=pct(sum(r['ceo']['caughtDuring'] for r in st), len(st)), caughtAll=pct(len(caught), len(st)),
                share=pct(sum(r['ceo']['caughtDuring'] for r in caught), len(caught)),
                clockViol=sum(r['ceo']['clockViol'] for r in v), missionClock=sum(r['ceo']['missionClockViol'] for r in v),
                qte=collections.Counter(r['ceo']['qte'] for r in st), cancelled=sum(r['ceo']['visit'] == 'cancelled' for r in v),
                timeouts=sum(r['outcome'] == 'timeout' for r in v), resumeNoTell=sum(r['ceo']['resumeNoTell'] for r in v))


print('### 대표님 순시\n')
print('| 봇 | 구간 | 순시 날 판 | 시작 | 취소 | 눈도장 | 순시 중 적발 | 시작 판 전체 적발 | 적발 중 순시 원인 | QTE | 근무 시계 위반 틱 | 미션 시계 위반 | 미종료(시간초과) | 복귀 후 전조 없는 시선 |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
C = {}
for b in NAMES:
    for lab, lo, hi in [('1~60', 1, 60), ('61~200', 61, 200), ('전체', 1, 200)]:
        c = ceo_stats(b, lo, hi)
        C[(b, lab)] = c
        print(f"| {NAMES[b]} | {lab} | {c['days']} | {c['started']} | {c['cancelled']} | {f(c['eye'])}% | {f(c['caughtDuring'])}% | {f(c['caughtAll'])}% | {f(c['share'])}% | {dict(c['qte'])} | {c['clockViol']} | {c['missionClock']} | {c['timeouts']} | {c['resumeNoTell']} |")
print()

# 공정성
F = collections.Counter()
causes = collections.Counter()
fakes = {}
samples = []
for r in ok:
    for k in ['gazeTicks', 'offscreenGazeTicks', 'hudRowGazeTicks', 'cameraMismatchTicks', 'unexplainedRiseTicks', 'onsets', 'onsetNoLead', 'looks', 'lookShortTell', 'lookWithoutTell']:
        F[k] += r['fair'][k]
    causes.update(r['fair']['onsetCauses'])
    for a, v in r['fair']['fakes'].items():
        g = fakes.setdefault(a, [0, 0, 0])
        g[0] += v['tells']; g[1] += v['fakes']; g[2] += v['consecutive']
    if r['fair']['onsetNoLeadSamples'] and len(samples) < 10:
        samples += r['fair']['onsetNoLeadSamples'][:1]
lsamples = [s for r in ok for s in r['fair']['lookSamples']][:10]
print('### 공정성 전수(모든 판·틱)\n')
print('- ' + ', '.join(f'{k} {v}' for k, v in F.items()))
print(f'- 시선 시작 원인: {dict(causes)}')
print(f'- 화살표/화면 선행 0.4초 미달 예: {samples}')
print(f'- 전조 부족·무전조 돌아보기 예: {lsamples}')
print('- 페이크: ' + ', '.join(f'{a} {v[1]}/{v[0]} 연속 {v[2]}' for a, v in fakes.items()))
# 억울한 실패: 적발된 판 중 전조 없는 시선 시작이 있던 판
unfair = [r for r in ok if r['outcome'] == 'caught' and (r['fair']['onsetNoLead'] > 0 or r['fair']['lookWithoutTell'] > 0 or r['fair']['lookShortTell'] > 0 or r['fair']['unexplainedRiseTicks'] > 0)]
print(f"- 억울한 실패 후보(적발 판 중 전조 미달·무전조·원인 불명 상승이 있던 판): {len(unfair)}/{sum(r['outcome'] == 'caught' for r in ok)}")
print()
# 인원
print('### 인원\n')
mx = max(r['maxOnScreen'] for r in ok)
over8 = [r for r in ok if r['maxOnScreen'] > 8]
print(f"- 화면 안 최대 {mx}명, 화면 20행 전체 최대 {max(r['maxOnScreenFull'] for r in ok)}명, 층 전체 최대 {max(r['maxOnFloor'] for r in ok)}명, 8명 초과 판 {len(over8)} {sorted(collections.Counter(r['day'] for r in over8).items())[:20]}")
print()
# 미션별
print('### 미션별 성공률(시도 기준, 위장 봇)\n')
print('| 구간 | 미션 | 시도 | 성공 | 실패 | 시간초과 | 적발 중단 | 기타 중단 | 시도 안 함 |')
print('|---|---|---|---|---|---|---|---|---|')
MIS = {}
for lab, lo, hi in [('인턴 1~5', 1, 5), ('사원 6~15', 6, 15), ('16~60', 16, 60), ('61~200', 61, 200)]:
    g = collections.defaultdict(collections.Counter)
    for r in by('disguise', lo, hi):
        for m in r['missions']:
            c = g[m['id']]
            if not m['started']:
                c['ns'] += 1; continue
            c['n'] += 1
            if m['state'] == 'done': c['done'] += 1
            elif m.get('reason') == 'fail': c['fail'] += 1
            elif m.get('reason') == 'timeout': c['timeout'] += 1
            elif r['outcome'] == 'caught': c['caught'] += 1
            else: c['other'] += 1
        # 퇴근
        if r['leaveStart'] >= 0:
            c = g['(퇴근)']
            c['n'] += 1
            if r['outcome'] in ('leave', 'leave_short'): c['done'] += 1
            elif r['gateFails'] >= 3: c['fail'] += 1
            elif r['outcome'] == 'caught': c['caught'] += 1
            else: c['other'] += 1
    for mid, c in sorted(g.items()):
        n = c['n']
        MIS[(lab, mid)] = pct(c['done'], n)
        print(f"| {lab} | {mid} | {n} | {f(pct(c['done'], n))}% | {f(pct(c['fail'], n))}% | {f(pct(c['timeout'], n))}% | {f(pct(c['caught'], n))}% | {f(pct(c['other'], n))}% | {c['ns']} |")
print()
# 새 미션 데뷔 직급 성공률
DEBUT = {'bank': (17, 28), 'chat': (19, 28), 'parcel': (21, 28), 'print': (23, 28), 'cafe': (29, 40), 'window': (31, 40)}
print('### 새 미션(데뷔 직급 구간, 위장 봇)\n')
for mid, (lo, hi) in DEBUT.items():
    xs = [m for r in by('disguise', lo, hi) for m in r['missions'] if m['id'] == mid and m['started']]
    print(f"- {mid}({lo}~{hi}일): 시도 {len(xs)}, 성공 {f(pct(sum(m['state'] == 'done' for m in xs), len(xs)))}%, 시간초과 {f(pct(sum(m.get('reason') == 'timeout' for m in xs), len(xs)))}%, 실패 {f(pct(sum(m.get('reason') == 'fail' for m in xs), len(xs)))}%")
print()
# 퇴근 방해 지연
key = lambda r: (r['day'], r['seed'])
sm = {key(r): r for r in strip}
d_sum = c_sum = pairs = 0
per = collections.defaultdict(list)
for r in by('disguise', 1, 200):
    s = sm.get(key(r))
    if not s or r['leaveSec'] is None or s['leaveSec'] is None:
        continue
    c = len(r['leaveIntsStarted'])
    if c == 0:
        continue
    pairs += 1; d_sum += r['leaveSec'] - s['leaveSec']; c_sum += c
    if c == 1:
        per[r['leaveIntsStarted'][0]].append(r['leaveSec'] - s['leaveSec'])
print('### 퇴근 방해 지연(위장 봇 짝 비교)\n')
print(f"- 짝 {pairs}, 방해 {c_sum}건 → 1건당 {f(d_sum / c_sum if c_sum else float('nan'), 2)}초")
print('- 단일 방해: ' + ', '.join(f'{k} {len(v)}판 {mean(v):.2f}초' for k, v in sorted(per.items())))
print()
# 적발 원인
print('### 적발 원인(위장 봇)\n')
cc = collections.Counter((r['caughtCause'] or '?').split(':')[0] + ':' + ((r['caughtCause'] or '?').split(':') + ['', ''])[1] for r in by('disguise', 1, 200) if r['outcome'] == 'caught')
print('- ' + ', '.join(f'{k} {v}' for k, v in cc.most_common(10)))
ov = collections.Counter('게이트 3회 실패' if r['gateFails'] >= 3 else ('업무 미달' if r['work'] < r['quota'] else '퇴근 시간 초과') for r in by('disguise', 1, 200) if r['outcome'] == 'overtime')
print(f'- 야근 원인(위장 봇): {dict(ov)}')
print()
# 순회 의심 비중
tg = [(r['tourGain'], sum(r['suspGain'].values())) for r in by('disguise', 6, 200) if r['toursPlanned'] > 0]
print(f"### 순회 중 팀장 콘이 만든 의심 비중(위장 봇, 6~200일): {f(pct(sum(a for a, _ in tg), sum(b for _, b in tg)))}% (목표 15~35%)\n")
# 성별 짝(G1)
mm = {(r['day'], r['seed']): r for r in main if r['botKey'] == 'disguise'}
diff = 0; n = 0; fields = collections.Counter()
for r in fem:
    m = mm.get((r['day'], r['seed']))
    if not m:
        continue
    n += 1
    dd = [k for k in ['outcome', 'stars', 'timeSec', 'peak', 'slack', 'missionsDone', 'gateFails'] if m[k] != r[k]]
    if dd:
        diff += 1; fields.update(dd)
fl = [r for r in fem]
ml = [mm[(r['day'], r['seed'])] for r in fem if (r['day'], r['seed']) in mm]
print(f"### 성별 대칭(G1, 3~60일 위장 봇 같은 시드 남/여)\n\n- 짝 {n}, 결과가 다른 짝 {diff} {dict(fields)}")
print(f"- 남: 칼퇴 {f(pct(sum(r['stars'] >= 2 for r in ml), len(ml)))}% 적발 {f(pct(sum(r['outcome'] == 'caught' for r in ml), len(ml)))}% ★3 {f(pct(sum(r['stars'] == 3 for r in ml), len(ml)))}% 길이 {f(mean(r['timeSec'] for r in ml), 2)} / 여: 칼퇴 {f(pct(sum(r['stars'] >= 2 for r in fl), len(fl)))}% 적발 {f(pct(sum(r['outcome'] == 'caught' for r in fl), len(fl)))}% ★3 {f(pct(sum(r['stars'] == 3 for r in fl), len(fl)))}% 길이 {f(mean(r['timeSec'] for r in fl), 2)}")
rr = lambda rs: [m for r in rs for m in r['missions'] if m['id'] == 'restroom' and m['started']]
print(f"- 화장실 성공률 남 {f(pct(sum(m['state'] == 'done' for m in rr(ml)), len(rr(ml))))}% / 여 {f(pct(sum(m['state'] == 'done' for m in rr(fl)), len(rr(fl))))}%")
print()
# G2~G5: 시설 메타와 결합
if fac:
    def rest(rs):
        xs = rr(rs)
        return pct(sum(m['state'] == 'done' for m in xs), len(xs)), len(xs)
    dz = by('disguise', 3, 200)
    same = [r for r in dz if fac.get(r['day'], {}).get('relation') == 'same']
    other = [r for r in dz if fac.get(r['day'], {}).get('relation') == 'other']
    a = [r for r in dz if fac.get(r['day'], {}).get('mineSide') == 'a']
    b_ = [r for r in dz if fac.get(r['day'], {}).get('mineSide') == 'b']
    cl = [r for r in dz if fac.get(r['day'], {}).get('cleaning')]
    nc = [r for r in dz if not fac.get(r['day'], {}).get('cleaning')]
    cpc = lambda rs: pct(sum(r['outcome'] == 'caught' for r in rs), len(rs))
    print('### 성별 시설 G2~G5(위장 봇)\n')
    print(f"- G2 화장실 성공률 same {f(rest(same)[0])}%(n={rest(same)[1]}) vs other {f(rest(other)[0])}%(n={rest(other)[1]})")
    print(f"- G3 적발률 same {f(cpc(same))}%(판 {len(same)}) vs other {f(cpc(other))}%(판 {len(other)})")
    print(f"- G4 화장실 성공률 mineSide a {f(rest(a)[0])}%(n={rest(a)[1]}) vs b {f(rest(b_)[0])}%(n={rest(b_)[1]})")
    clm = [m for r in cl for m in r['missions'] if m['started'] and m['id'] in ('restroom', 'bank')]
    print(f"- G5 청소 날 화장실·공과금 성공 {f(pct(sum(m['state'] == 'done' for m in clm), len(clm)))}%, 시간 초과 {f(pct(sum(m.get('reason') == 'timeout' for m in clm), len(clm)))}% (n={len(clm)}, 청소 날 판 {len(cl)})")
    print()
# 일차별(위장)
print('### 일차별 칼퇴(위장) 하위 15일\n')
perday = []
for d in range(1, 201):
    rs = by('disguise', d, d)
    if rs:
        s = stats(rs)
        perday.append((s['leave'], d, s))
for lv, d, s in sorted(perday)[:15]:
    print(f"- {d}일: 칼퇴 {f(lv)}% 적발 {f(s['caught'])}% 야근 {f(s['over'])}% 최대 길이 {f(s['lmax'])}초 (n={s['n']})")
print()
lm = sorted(((r['timeSec'], r['day'], r['seed'], r['outcome']) for r in by('disguise', 1, 200)), reverse=True)[:8]
print(f'### 1판 길이 상위(위장 봇): {lm}')
