#!/usr/bin/env python3
"""game/data/*.json v2 정합성 검사 (기획 소유, 표준 라이브러리만 사용).

실행: python3 -I molrae-toegeun/design/tools/validate_data.py
검사: schemaVersion, 문자열 키 존재, 테이블 간 ID 참조, 전조 ≥ 0.4초, 페이크 상한,
      맵 크기·legend·스폿/웨이포인트 통행 가능·경로 존재, 층 동시 인원 ≤ 12·화면 안 ≤ 8(D-049),
      사원증 줄 색(D-037·D-052), 하루 예상 길이 범위,
      T-132: 말걸기 warnSec·catchRadius·releaseSec(D-043·D-054), 결과 화면 입력 보호,
      유리벽(D-053), 배경 동료(D-049), 광고 첫 5판 면제 삭제(D-048), 이어하기 수용 기준(D-050·D-056),
      문자열 이모지(D-047)·내부 ID 노출, 수작업 날 공범 제안 고정,
      sfx 키 ⊂ 오디오 매니페스트(T-113), 무음 대응 시각 신호.
"""
import itertools
import json
import os
import re
import sys
from collections import deque

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "game", "data"))
errors, warns = [], []


def err(msg):
    errors.append(msg)


def load(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return json.load(f)


T = {n[:-5]: load(n) for n in sorted(os.listdir(ROOT)) if n.endswith(".json")}
for name, t in T.items():
    if t.get("schemaVersion") != 2:
        err(f"{name}: schemaVersion != 2")

S = T["strings.ko"]["strings"]
rules = T["rules"]
MIN_TELL = rules["tell"]["minSec"]
FAKE_CAP = rules["fake"]["absoluteCapProb"]


def walk_json(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield path + "." + k, k, v
            yield from walk_json(v, path + "." + k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk_json(v, f"{path}[{i}]")


# 1) 문자열 키
for name, t in T.items():
    if name == "strings.ko":
        continue
    for p, k, v in walk_json(t):
        if isinstance(v, str) and (k.endswith("Key") and k != "key") and v not in S:
            err(f"{name}{p}: 문자열 키 없음 '{v}'")
        if k in ("reactionKeys", "failReactionKeys") and isinstance(v, list):
            for s in v:
                if s not in S:
                    err(f"{name}{p}: 리액션 키 없음 '{s}'")

# 2) 전조·페이크
for name in ("bosses", "npcs", "interrupts"):
    for p, k, v in walk_json(T[name]):
        if k in ("tellSec", "secondTellSec", "stopLookTellSec") and isinstance(v, (int, float)) and v < MIN_TELL:
            err(f"{name}{p}: 전조 {v} < {MIN_TELL}")
        if k in ("tellSecRange",) and isinstance(v, list) and min(v) < MIN_TELL:
            err(f"{name}{p}: 전조 범위 {v} 최소 < {MIN_TELL}")
        if k == "sec" and ".tell" in p and isinstance(v, (int, float)) and v < MIN_TELL:
            err(f"{name}{p}: 전조 {v} < {MIN_TELL}")
        if k.endswith("fake.chance") or (k == "chance" and ".fake" in p):
            if isinstance(v, (int, float)) and v > FAKE_CAP:
                err(f"{name}{p}: 페이크 {v} > 전역 상한 {FAKE_CAP}")
        if k == "sim.tellSecRange" and min(v) < MIN_TELL:
            err(f"{name}{p}: 보간 전조 {v} < {MIN_TELL}")
for b in T["bosses"]["bosses"]:
    f = b["sim"]["fake"]
    if f["chance"] > f["capChance"] or f["capChance"] > FAKE_CAP:
        err(f"bosses.{b['id']}: fake chance/cap 위반")
    for r, se in b.get("rankScaling", {}).items():
        for side in ("start", "end"):
            c = se[side].get("sim.fake.chance")
            if c is not None and c > f["capChance"]:
                err(f"bosses.{b['id']}.{r}.{side}: fake {c} > cap {f['capChance']}")
            dl = se[side].get("sim.doubleLook.chance")
            if dl is not None and dl > b["sim"]["doubleLook"]["capChance"]:
                err(f"bosses.{b['id']}.{r}.{side}: doubleLook {dl} > cap")

# 3) 맵
m = T["maps"]["maps"][0]
rows, legend = m["rows"], m["legend"]
W, H = m["widthTiles"], m["heightTiles"]
if len(rows) != H or any(len(r) != W for r in rows):
    err("maps: rows 크기 불일치")
for y, r in enumerate(rows):
    for x, c in enumerate(r):
        if c not in legend:
            err(f"maps: legend에 없는 문자 {c} ({x},{y})")


def walkable(x, y):
    return 0 <= x < W and 0 <= y < H and legend[rows[y][x]]["walkable"] is True


def reach(a, b):
    q, seen = deque([a]), {a}
    while q:
        c = q.popleft()
        if c == b:
            return True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (c[0] + dx, c[1] + dy)
            if n not in seen and walkable(*n):
                seen.add(n)
                q.append(n)
    return False


ps = (m["playerStart"]["x"], m["playerStart"]["y"])
if not walkable(*ps):
    err("maps: playerStart 통행 불가")
for sid, s in m["spots"].items():
    t = tuple(s["tile"])
    if not walkable(*t):
        err(f"maps.spots.{sid}: 통행 불가 {t}")
    elif not reach(ps, t):
        err(f"maps.spots.{sid}: 내 자리에서 도달 불가")
for c in m["coverSpots"]:
    if not walkable(*c["tile"]):
        err(f"maps.coverSpots {c['tile']} 통행 불가")
if not any(legend[ch].get("zone") == m["exitZone"] for ch in set("".join(rows))):
    err("maps: exitZone 타일 없음")

# 4) 참조
boss_ids = {b["id"] for b in T["bosses"]["bosses"]}
npc_ids = {n["id"] for n in T["npcs"]["npcs"]}
actors = boss_ids | npc_ids
patrols = {p["id"]: p for p in T["patrols"]["patrols"]}
ints = {i["id"]: i for i in T["interrupts"]["interrupts"]}
events = {e["id"] for e in T["events"]["events"]}
for p in patrols.values():
    if p["actorId"] not in actors:
        err(f"patrols.{p['id']}: actor 없음")
    for w in p["waypoints"]:
        if not walkable(w["x"], w["y"]):
            err(f"patrols.{p['id']}: 웨이포인트 통행 불가 ({w['x']},{w['y']})")
    if p.get("thenPatrol") and p["thenPatrol"] not in patrols:
        err(f"patrols.{p['id']}: thenPatrol 없음")
for i in ints.values():
    for a in i["actors"]:
        if a not in actors:
            err(f"interrupts.{i['id']}: actor {a} 없음")
    eff = i.get("effect", {})
    for k in ("patrolId", "leaveVariant"):
        if k in eff and eff[k] not in patrols:
            err(f"interrupts.{i['id']}: {k} {eff[k]} 없음")
    for k in ("patrolIds", "patrolVariants"):
        for pid in eff.get(k, []):
            if pid not in patrols:
                err(f"interrupts.{i['id']}: {pid} 없음")
for r in T["ranks"]["ranks"]:
    for b in r["cast"]["bosses"]:
        if b not in boss_ids:
            err(f"ranks.{r['id']}: boss {b} 없음")
    for n in r["cast"]["npcs"]:
        if n not in npc_ids:
            err(f"ranks.{r['id']}: npc {n} 없음")
    for e in r["eventPool"]:
        if e["eventId"] not in events:
            err(f"ranks.{r['id']}: event 없음")
    for key in ("dayInterrupts", "leaveInterrupts"):
        for e in r[key]["pool"]:
            if e["id"] not in ints:
                err(f"ranks.{r['id']}.{key}: {e['id']} 없음")
            elif key == "leaveInterrupts" and "leave" not in ints[e["id"]]["phases"]:
                err(f"ranks.{r['id']}: {e['id']}은 퇴근 단계 불가")
CH = rules["characters"]
MAX_FLOOR, MAX_SCREEN, SCREEN_ROWS = CH["maxOnFloor"], CH["maxOnScreen"], CH["screenRowsTiles"]
BG = T["npcs"].get("background", [])


def patrol_yrange(pid):
    ys = [w["y"] for w in patrols[pid]["waypoints"]]
    return (min(ys), max(ys))


RANK_ORDER = [r["id"] for r in T["ranks"]["ranks"]]


def bg_active(b, rank_id, day=None):
    """배경 동료 등장 여부: fromDay ≤ day(생성 날은 day=None → 16일차 이후라 항상 참), 직급 ≤ untilRank."""
    if day is not None and b["fromDay"] > day:
        return False
    u = b.get("untilRank")
    return u is None or RANK_ORDER.index(rank_id) <= RANK_ORDER.index(u)


def bg_yrange(b):
    if b["behavior"] in ("sit", "stand"):
        p = b["seat"] if b["behavior"] == "sit" else b["spot"]
        return (p["y"], p["y"])
    ys = [w["y"] for w in b["waypoints"]]
    return (min(ys), max(ys))


def int_patrols(i):
    e = i.get("effect", {})
    return [e[k] for k in ("patrolId", "leaveVariant") if k in e] + e.get("patrolIds", []) + e.get("patrolVariants", [])


def presence(cast_pids, int_ids):
    """캐릭터별로 있을 수 있는 y 범위 목록. 범위를 모르면 빈 목록 = 어디에나 있을 수 있음(보수적)."""
    A = {}
    for pid in cast_pids:
        A.setdefault(patrols[pid]["actorId"] + str(patrols[pid].get("instance", 1)), []).append(patrol_yrange(pid))
    for iid in int_ids:
        i = ints[iid]
        for pid in int_patrols(i):
            A.setdefault(patrols[pid]["actorId"] + str(patrols[pid].get("instance", 1)), []).append(patrol_yrange(pid))
        if iid == "INT-09" and "p_ceo_visit" in patrols:
            A.setdefault("ceo1", []).append(patrol_yrange("p_ceo_visit"))
        for a2 in i["actors"]:
            A.setdefault(a2 + "1", [])
    return A


def worst_screen(A, bg_ranges):
    """세로 SCREEN_ROWS 타일 창을 위아래로 밀며 창 안에 있을 수 있는 최대 인원(플레이어 포함)."""
    best = (0, 0)
    for y0 in range(0, max(1, H - SCREEN_ROWS + 1)):
        y1 = y0 + SCREEN_ROWS - 1
        hit = lambda r: not (r[1] < y0 or r[0] > y1)
        n = 1 + sum(1 for rs in A.values() if not rs or any(hit(r) for r in rs)) + sum(1 for r in bg_ranges if hit(r))
        best = max(best, (n, y0))
    return best


lo, hi = rules["day"]["targetDurationSec"]
tlo, thi = rules["day"]["tutorialDayDurationSec"]
for d in T["days"]["authoredDays"]:
    for pid in d["castPatrols"]:
        if pid not in patrols:
            err(f"days.{d['day']}: patrol {pid} 없음")
    for mm in d["missions"]:
        if mm["eventId"] not in events:
            err(f"days.{d['day']}: event 없음")
    for key in ("dayInterrupts", "leaveInterrupts"):
        for e in d[key]:
            i = ints.get(e["id"])
            if not i:
                err(f"days.{d['day']}: {e['id']} 없음")
                continue
            phase = "day" if key == "dayInterrupts" else "leave"
            if phase not in i["phases"]:
                err(f"days.{d['day']}: {e['id']} phase {phase} 불가")
            if i["unlockDay"] > d["day"] or i.get("lastDay", 999) < d["day"]:
                err(f"days.{d['day']}: {e['id']} unlockDay 위반")
            if phase == "leave" and i.get("trigger", {}).get("leaveUnlockDay", 0) > d["day"]:
                err(f"days.{d['day']}: {e['id']} leaveUnlockDay 위반")
    if d["missionsRequired"] > len(d["missions"]):
        err(f"days.{d['day']}: 필수 미션 수 > 미션 수")
    a, b = (tlo, thi) if d["rankId"] == "intern" else (lo, hi)
    if not (a <= d["expectedDurationSec"] <= b):
        err(f"days.{d['day']}: 예상 길이 {d['expectedDurationSec']} 범위 밖 [{a},{b}]")
    for t in d.get("tutorialIds", []):
        if "tutorial." + t not in S:
            err(f"days.{d['day']}: 튜토리얼 문구 없음 {t}")
    # 인원: 플레이어 + 상주 + 방해 등장 인원(겹칠 수 있는 최대) + 배경 동료(D-049)
    A = presence(d["castPatrols"], [e["id"] for e in d["dayInterrupts"] + d["leaveInterrupts"]])
    bgs = [bg_yrange(b) for b in BG if bg_active(b, d["rankId"], d["day"])]
    if not (2 <= len(bgs) <= 3):
        err(f"days.{d['day']}: 배경 동료 {len(bgs)}명 (D-049: 2~3명)")
    if 1 + len(A) + len(bgs) > MAX_FLOOR:
        err(f"days.{d['day']}: 층 인원 {1 + len(A) + len(bgs)} > {MAX_FLOOR}")
    n_scr, y0 = worst_screen(A, bgs)
    if n_scr > MAX_SCREEN:
        err(f"days.{d['day']}: 화면 안 최대 {n_scr}명 > {MAX_SCREEN} (y {y0}~{y0 + SCREEN_ROWS - 1})")
    # 수작업 날 공범 제안 고정(T-132): scripted accomplice_offer의 미션이 그날 미션에 있어야 함
    for sc in d.get("scripted", []):
        if sc.get("type") == "accomplice_offer" and sc["eventId"] not in [mm["eventId"] for mm in d["missions"]]:
            err(f"days.{d['day']}: 공범 제안 미션 {sc['eventId']}이 그날 미션에 없음")
RANK_SCREEN = {}
gen_cast = re.findall(r"p_\w+", T["days"]["generator"]["castPatrols"])
for r in T["ranks"]["ranks"]:
    n = 1 + sum(r["cast"]["bosses"].values()) + len(r["cast"]["npcs"])
    if "ceo" in r["cast"]["bosses"]:
        n -= 1  # H7: 대표님 순시 중 본부장·인사팀 없음 → 대표님 대신 둘 중 최대 인원으로 계산
    rbg = [b for b in BG if bg_active(b, r["id"])]
    n += len(rbg)  # 생성 날(16일차~): untilRank 안의 배경 동료 전원
    if not (2 <= len(rbg) <= 3):
        err(f"ranks.{r['id']}: 배경 동료 {len(rbg)}명 (D-049: 2~3명)")
    if n > MAX_FLOOR:
        err(f"ranks.{r['id']}: 층 인원 {n} > {MAX_FLOOR}")
    # 화면 안: 생성기 상주 순찰 + (근무 방해 countRange 최대 개수 조합) ∪ (퇴근 방해 countRange 최대 개수 조합)의
    # 모든 경우 중 최악. 한 날 안의 방해는 시각이 달라도 동시에 있다고 가정(보수적). 대표님 순시 날은 H7로
    # 본부장·인사팀 방해가 없고 INT-09가 추가됨. 근접형(INT-01~03)은 이동 경로를 만들지 않아 상주 인원으로 이미 셈
    cast = [p for p in gen_cast if p != "p_tl2_seat" or r["cast"]["bosses"].get("team_lead", 0) >= 2]
    bgr = [bg_yrange(b) for b in rbg]
    worst = (0, 0, ())
    for ceo_day in ([False, True] if "ceo" in r["cast"]["bosses"] else [False]):
        def ok(i):
            return not (ceo_day and set(ints[i]["actors"]) & {"director", "hr_inspector"})
        dp = [e["id"] for e in r["dayInterrupts"]["pool"] if ok(e["id"])]
        lp = [e["id"] for e in r["leaveInterrupts"]["pool"] if ok(e["id"])]
        kd = min(len(dp), r["dayInterrupts"]["countRange"][1])
        kl = min(len(lp), r["leaveInterrupts"]["countRange"][1] if not ceo_day else min(2, r["leaveInterrupts"]["countRange"][1]))
        for cd in itertools.combinations(dp, kd):
            for cl in itertools.combinations(lp, kl):
                v = set(cd) | set(cl) | ({"INT-09"} if ceo_day else set())
                n_scr, y0 = worst_screen(presence(cast, sorted(v)), bgr)
                if n_scr > worst[0]:
                    worst = (n_scr, y0, tuple(sorted(v)))
    if worst[0] > MAX_SCREEN:
        err(f"ranks.{r['id']}: 화면 안 최대 {worst[0]}명 > {MAX_SCREEN} (y {worst[1]}~{worst[1] + SCREEN_ROWS - 1}, 방해 {worst[2]})")
    RANK_SCREEN[r["id"]] = worst

# 5) D-037 사원증 줄 색
for b in T["bosses"]["bosses"]:
    if "lanyard_red" not in b["props"]:
        err(f"bosses.{b['id']}: lanyard_red 없음(D-037)")
want = {"security_guard": "lanyard_black", "snitch": "lanyard_blue", "accomplice": "lanyard_green", "hr_inspector": "lanyard_purple"}
for n in T["npcs"]["npcs"]:
    if want[n["id"]] not in n["props"]:
        err(f"npcs.{n['id']}: {want[n['id']]} 없음(D-037)")
    if any(re.search(r"red|orange", p) for p in n["props"]):
        err(f"npcs.{n['id']}: 빨강·주황 소품 금지(D-037)")

if "lanyard_sky" not in CH.get("playerProps", []):
    err("rules.characters.playerProps: lanyard_sky 없음(D-052)")
role_lanyards = set(want.values()) | {"lanyard_red"}
if role_lanyards & set(CH.get("playerProps", [])):
    err("rules.characters.playerProps: 다른 역할과 같은 줄 색(D-052)")

# 6) T-132 말걸기 (D-043, D-054)
TALK_MIN = rules["talk"]["tellSecMin"]
HOLD = rules["movement"]["postTalkHoldSec"]
for name, key in (("bosses", "bosses"), ("npcs", "npcs")):
    for a in T[name][key]:
        t = a["sim"].get("talk")
        if not t:
            continue
        tells = [a["sim"]["tellSec"]] + list(a["sim"].get("tellSecRange", []))
        for se in a.get("rankScaling", {}).values():
            for side in ("start", "end"):
                tells += list(se.get(side, {}).get("sim.tellSecRange", []))
        for fld in ("warnSec", "catchRadius", "releaseSec", "warnLineKey", "dodgedLineKey"):
            if fld not in t:
                err(f"{name}.{a['id']}.sim.talk: {fld} 없음(T-132)")
        if "warnSec" in t and t["warnSec"] < TALK_MIN:
            err(f"{name}.{a['id']}.sim.talk.warnSec {t['warnSec']} < {TALK_MIN}")
        if "catchRadius" in t and not (t["radius"] < t["catchRadius"] <= 2 * t["radius"]):
            err(f"{name}.{a['id']}.sim.talk.catchRadius {t['catchRadius']}: radius < c ≤ 2×radius 위반")
        if "releaseSec" in t and "warnSec" in t:
            need = max([t["warnSec"]] + tells) + HOLD
            if t["releaseSec"] + 1e-9 < need:
                err(f"{name}.{a['id']}.sim.talk.releaseSec {t['releaseSec']} < 최대 전조 + 대기 {need:.2f}")
if rules["suspicion"].get("talkedPerSec", 0) != 0:
    err("rules.suspicion.talkedPerSec != 0 (D-043 폐지, 0 고정)")
g = rules["input"].get("resultInputGuardSec")
if g is None or g < 0.4:
    err("rules.input.resultInputGuardSec 없음 또는 < 0.4 (BUG-006)")

# 7) D-053 유리벽
for ch, lg in legend.items():
    if lg["kind"] == "glass" and (lg["walkable"] is not False or lg["blocksSight"] is not False):
        err(f"maps.legend.{ch}: 유리벽은 walkable=false, blocksSight=false (D-053)")

# 8) D-049 배경 동료
seen_bg = set()
for b in BG:
    bid = b["id"]
    if bid in actors or bid in seen_bg:
        err(f"npcs.background.{bid}: ID 중복")
    seen_bg.add(bid)
    if any(v is not False for v in b["mechanics"].values()):
        err(f"npcs.background.{bid}: 메카닉은 모두 false여야 함(D-049)")
    if "lanyard_gray" not in b["props"] or any(re.search(r"red|orange", p) for p in b["props"]):
        err(f"npcs.background.{bid}: 회색 줄 필수·빨강·주황 소품 금지")
    if role_lanyards & set(b["props"]) or "lanyard_sky" in b["props"]:
        err(f"npcs.background.{bid}: 역할 줄 색 사용 금지")
    if b["behavior"] == "sit":
        st = b["seat"]
        if rows[st["y"]][st["x"]] != "h":
            err(f"npcs.background.{bid}: 자리 ({st['x']},{st['y']})가 다른 사람 의자(h)가 아님")
        for p in patrols.values():
            if any((w["x"], w["y"]) == (st["x"], st["y"]) for w in p["waypoints"]):
                err(f"npcs.background.{bid}: 자리가 순찰 {p['id']}와 겹침")
    elif b["behavior"] == "stand":
        st = b["spot"]
        if not walkable(st["x"], st["y"]) or not reach(ps, (st["x"], st["y"])):
            err(f"npcs.background.{bid}: 서 있는 자리 통행 불가·도달 불가")
        if any(tuple(sp["tile"]) == (st["x"], st["y"]) for sp in m["spots"].values()):
            err(f"npcs.background.{bid}: 미션·NPC 스폿과 겹침")
    elif b["behavior"] == "walk":
        wps = b["waypoints"]
        for k, w in enumerate(wps):
            if not walkable(w["x"], w["y"]):
                err(f"npcs.background.{bid}: 경유점 통행 불가 ({w['x']},{w['y']})")
            nxt = wps[(k + 1) % len(wps)]
            if not reach((w["x"], w["y"]), (nxt["x"], nxt["y"])):
                err(f"npcs.background.{bid}: 경유점 {k} → 다음 경로 없음")
        if b["speedTilesPerSec"] >= T["rules"]["playerSpeedTilesPerSec"]:
            err(f"npcs.background.{bid}: 플레이어보다 빠름")
    else:
        err(f"npcs.background.{bid}: behavior는 sit|stand|walk")
    u = b.get("untilRank")
    if u is not None and u not in RANK_ORDER:
        err(f"npcs.background.{bid}: untilRank {u} 없음")

# 9) 광고·이어하기 (D-048, D-050, D-056)
inter = T["ads"]["interstitial"]
if "exemptFirstGamesLifetime" in inter:
    err("ads.interstitial.exemptFirstGamesLifetime 남아 있음(D-048 삭제)")
cont = next(p for p in T["ads"]["rewarded"]["placements"] if p["id"] == "continue")
if cont.get("autoCountdown") is not False or cont.get("declineButtonSameSize") is not True:
    err("ads.continue: 자동 카운트다운 금지·거절 버튼 같은 크기(D-050 ②③)")
if cont.get("submitScoreToLeaderboard") is not False or rules["continueAd"].get("submitScoreToLeaderboard") is not False:
    err("이어하기 판 리더보드 제출 금지(D-056)")
if not T["npcs"]["npcs"][[n["id"] for n in T["npcs"]["npcs"]].index("accomplice")]["offer"].get("authoredDaysScriptedOnly"):
    err("npcs.accomplice.offer.authoredDaysScriptedOnly 필요(수작업 날 제안 고정)")

# 10) 문자열: 이모지(D-047)·내부 ID 노출
EMOJI = re.compile("[\U0001F000-\U0001FFFF\u2600-\u2604\u2606-\u27BF\u2B00-\u2BFF\uFE0F\u200D]")  # ★(U+2605)만 허용
INTERNAL = re.compile(r"\b(" + "|".join(sorted(actors | seen_bg | events)) + r")\b")
for p, k, v in walk_json(T["strings.ko"]["strings"]):
    for txt in (v if isinstance(v, list) else [v]):
        if not isinstance(txt, str):
            continue
        if EMOJI.search(txt):
            err(f"strings{p}: 이모지 포함(D-047)")
        if INTERNAL.search(txt):
            err(f"strings{p}: 내부 ID 노출 '{INTERNAL.search(txt).group(0)}'")
        if re.search(r"\{n\}원", txt):
            err(f"strings{p}: 실제 화폐 단위 '원' 사용(컴플라이언스 T-132)")

# 11) 사운드 키(T-113 매니페스트, 읽기 전용)·무음 대응 시각 신호
AUDIO = os.path.join(ROOT, "..", "assets", "audio", "audio-manifest.json")
if os.path.exists(AUDIO):
    with open(AUDIO, encoding="utf-8") as fa:
        am = json.load(fa)
    akeys = {x["key"] for x in am["sfx"]} | set(am["bgm"])
    for name, t in T.items():
        for p, k, v in walk_json(t):
            if isinstance(v, str) and (k == "sfx" or k.endswith("Sfx") or (".walkTellSfx." in p + "." and k != "onScreenOnly")):
                if v.startswith("sfx_") and v not in akeys:
                    err(f"{name}{p}: 오디오 키 없음 '{v}'")
else:
    warns.append("audio-manifest.json 없음: sfx 키 검사 생략")
for name, key, ids in (("bosses", "bosses", ("director", "team_lead")), ("npcs", "npcs", ("security_guard", "hr_inspector"))):
    for a in T[name][key]:
        if a["id"] in ids and "walkTellSfx" not in a["sim"]:
            err(f"{name}.{a['id']}.sim.walkTellSfx 없음(걷는 NPC 전조 소리, tell.mustHaveAudio)")
gate = next(n for n in T["npcs"]["npcs"] if n["id"] == "security_guard")["gate"]
for fld in ("failSfx", "okSfx", "failVisual", "okVisual"):
    if fld not in gate:
        err(f"npcs.security_guard.gate.{fld} 없음")
VC = rules.get("visualCues", {})
for fld in ("gateFail", "gateOk", "tapDestination", "missionChipDone", "suspicionHigh", "dangerBorder"):
    if fld not in VC:
        err(f"rules.visualCues.{fld} 없음(무음 대응)")
if VC:
    for p, k, v in walk_json(VC):
        if k == "pulseHz" and v > 3:
            err(f"rules.visualCues{p}: 깜빡임 {v}Hz > 3 (광과민)")
    if os.path.exists(AUDIO) and set(am["bgm"]["bgm_office"]["stages"]) - {"_doc"} - set(VC["dangerBorder"]["byStage"]):
        err("rules.visualCues.dangerBorder.byStage: BGM 단계 누락")

print(f"tables: {', '.join(T)}")
print("화면 안 최악 인원(직급별, 플레이어 포함): " + ", ".join(f"{k} {v[0]}" for k, v in RANK_SCREEN.items()))
for w in warns:
    print("WARN", w)
for e in errors:
    print("ERROR", e)
print("OK" if not errors else f"{len(errors)} error(s)")
sys.exit(1 if errors else 0)
