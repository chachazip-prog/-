#!/usr/bin/env python3
"""game/data/*.json v2 정합성 검사 (기획 소유, 표준 라이브러리만 사용).

실행: python3 -I molrae-toegeun/design/tools/validate_data.py
검사: schemaVersion, 문자열 키 존재, 테이블 간 ID 참조, 전조 ≥ 0.4초, 페이크 상한,
      맵 크기·legend·스폿/웨이포인트 통행 가능·경로 존재, 층 동시 인원 ≤ 12·화면 안 ≤ 8(D-049),
      사원증 줄 색(D-037·D-052), 하루 예상 길이 범위,
      T-132: 말걸기 warnSec·catchRadius·releaseSec(D-043·D-054), 결과 화면 입력 보호,
      유리벽(D-053), 배경 동료(D-049), 광고 첫 5판 면제 삭제(D-048), 이어하기 수용 기준(D-050·D-056),
      문자열 이모지(D-047)·내부 ID 노출, 수작업 날 공범 제안 고정,
      sfx 키 ⊂ 오디오 매니페스트(T-113), 무음 대응 시각 신호,
      T-134: spriteKey ⊂ 아트 anims.json(idle·walk 4방향).
      T-136: 이어하기 재개 의심·컷인 길이·alert 임계·H7 간격·대표님 재확인·얼음 안전장치·공범 제안 종료·간식 판정 시점·광고 문구 키.
      T-139: 생성기 시간 예산 검사(budgetCheck)·예산 모델 키, 인사 QTE 창 하한, 탈출 보너스 시각 범위, ★3 임계 범위, INT-05 퇴근 시 취소.
      T-148: 남녀 변형(variants 2종·spriteKey 중복 없음, 아트 미반영은 WARN)·casting(fixed|rotate), 플레이어 선택(기본값 없음),
             직급별·전체 출연 여성 비율, 고정 인물 집합 양성 포함, 성별 시설 모듈 대칭(크기·칸 수·포트 기준 거리 차 ≤ 3·가림막 문·두 시설 분리),
             절대 성별 값 금지(mine/other·same/other만), facilityStop 회전 인물·벌 상한, 성별 호칭·고정관념 단어.
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
V3_TABLES = {"layout", "missions"}  # T-142: 생성기·미션 풀 새 테이블(schemaVersion 3, design/data-schema-v3-draft.md)
for name, t in T.items():
    want = 3 if name in V3_TABLES else 2
    if t.get("schemaVersion") != want:
        err(f"{name}: schemaVersion != {want}")

S = T["strings.ko"]["strings"]
S3 = {}  # T-142: v3 테이블의 병합 대기 문자열(missions.json stringsKo). strings.ko.json 병합 전까지 키 출처로 인정
for _t in T.values():
    S3.update(_t.get("stringsKo", {}))
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


# 1) 문자열 키 (spriteKey류는 아트 키라 §T-134에서 따로 검사)
NON_STRING_KEYS = {"key", "spriteKey", "playerSpriteKey"}
for name, t in T.items():
    if name == "strings.ko":
        continue
    for p, k, v in walk_json(t):
        if isinstance(v, str) and (k.endswith("Key") and k not in NON_STRING_KEYS) and v not in S and v not in S3:
            err(f"{name}{p}: 문자열 키 없음 '{v}'")
        if k in ("reactionKeys", "failReactionKeys") and isinstance(v, list):
            for s in v:
                if s not in S and s not in S3:
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

# T-134) spriteKey ⊂ 아트 출력 anims.json (읽기 전용). 캐릭터마다 idle·walk 4방향이 있어야 함
ANIMS = os.path.join(ROOT, "..", "assets", "sprites", "anims.json")
if os.path.exists(ANIMS):
    with open(ANIMS, encoding="utf-8") as fa:
        anim_keys = {a["key"] for a in json.load(fa)["anims"]}
    need = [f"{st}_{d}" for st in ("idle", "walk") for d in ("down", "up", "left", "right")]
    sprite_refs = [("rules.characters.playerSpriteKey", rules["characters"].get("playerSpriteKey"))]
    for name, key in (("bosses", "bosses"), ("npcs", "npcs")):
        for a in T[name][key]:
            sprite_refs.append((f"{name}.{a['id']}.spriteKey", a.get("spriteKey")))
    for b in T["npcs"].get("background", []):
        sprite_refs.append((f"npcs.background.{b['id']}.sprite", b.get("sprite")))
    for where, sk in sprite_refs:
        if not sk:
            err(f"{where} 없음(T-134)")
            continue
        miss = [n for n in need if f"{sk}/{n}" not in anim_keys]
        if miss:
            err(f"{where} '{sk}': anims.json에 없는 애니 {', '.join(miss)}")
else:
    warns.append("assets/sprites/anims.json 없음: spriteKey 검사 생략")

# T-136) 개발 임시 상수 → 데이터(필드 추가만)
ca = rules["continueAd"]
rs = ca.get("resumeSuspicion")
if not isinstance(rs, (int, float)) or not (0 < rs < VC.get("suspicionHigh", {}).get("threshold", 1)):
    err("rules.continueAd.resumeSuspicion 없음 또는 danger 임계 이상(T-136)")
elif rules["suspicion"].get("continueResetTo", rs) != rs:
    err("rules.suspicion.continueResetTo != continueAd.resumeSuspicion (T-136, 구 필드와 값 일치)")
cs = rules.get("caughtCutin", {}).get("durationSec")
if not isinstance(cs, (int, float)) or not (1.5 <= cs <= 3.0):
    err("rules.caughtCutin.durationSec 없음 또는 1.5~3.0 밖(T-136)")
if "caught_cutin" not in T["ads"]["global"]["playStates"]:
    err("ads.global.playStates에 caught_cutin 없음(컷인 중 광고 금지)")
am_ = VC.get("dangerBorder", {}).get("alertSuspicionMin")
hi_ = VC.get("suspicionHigh", {}).get("threshold", 1)
if not isinstance(am_, (int, float)) or not (rules["suspicion"]["star3PeakBelow"] <= am_ < hi_):
    err("rules.visualCues.dangerBorder.alertSuspicionMin 없음 또는 star3PeakBelow ≤ x < suspicionHigh.threshold 위반(T-136)")
elif os.path.exists(AUDIO):
    mm = re.search(r"의심\s*>=\s*([0-9.]+)", am["bgm"]["bgm_office"]["stages"].get("alert", {}).get("when", ""))
    if mm and abs(float(mm.group(1)) - am_) > 1e-9:
        err(f"alertSuspicionMin {am_} != 오디오 매니페스트 alert.when {mm.group(1)}")
h7 = T["days"]["generator"]["dayInterrupts"].get("h7", {})
if not isinstance(h7.get("ceoDirectorMinGapSec"), (int, float)) or h7["ceoDirectorMinGapSec"] < 20:
    err("days.generator.dayInterrupts.h7.ceoDirectorMinGapSec 없음 또는 < 20(순시 전체 ≈20초, T-136)")
ceo_ = next(b for b in T["bosses"]["bosses"] if b["id"] == "ceo")
fk = ceo_["sim"].get("fake", {})
if fk.get("type") == "recheck":
    if fk.get("asRealLookAtRecheckWaypoint") is not True:
        err("bosses.ceo.sim.fake: recheck는 asRealLookAtRecheckWaypoint true 필요(T-136)")
    if fk.get("tellSec", 0) < MIN_TELL:
        err("bosses.ceo.sim.fake.tellSec < rules.tell.minSec")
    if not any(w.get("lookIsRecheck") for w in patrols[ceo_["visit"]["patrolId"]]["waypoints"]):
        err("bosses.ceo 재확인 웨이포인트(lookIsRecheck) 없음")
fz = ceo_["visit"]["freeze"]
if not (0 < fz.get("safetyExtraSec", -1) <= 5):
    err("bosses.ceo.visit.freeze.safetyExtraSec 없음 또는 0~5 밖(T-136)")
acc_ = next(n for n in T["npcs"]["npcs"] if n["id"] == "accomplice")["offer"]
if acc_.get("forcedHoldsUntil") != "mission_commit" or set(acc_.get("missionCommit", {})) != {"awayFromDesk", "atDesk"}:
    err("npcs.accomplice.offer.forcedHoldsUntil·missionCommit 필요(T-136)")
for e_ in T["events"]["events"]:
    if e_["mechanic"] == "rhythm_tap" and e_["params"].get("judgeOn") != "release":
        err(f"events.{e_['id']}.params.judgeOn != release (T-136)")
for k_ in ("ad.today_done", "ad.ceo_pass_not_completed"):
    if k_ not in S:
        err(f"strings: {k_} 없음(T-136)")

# T-139) 밸런스 조정(필드 추가·값 수정만)
bm_ = T["ranks"]["budgetModel"]
ev_ids_ = {e["id"] for e in T["events"]["events"] if e["mechanic"] != "leave_sequence"}
if set(bm_.get("missionExpectedSec", {})) != ev_ids_ or not all(isinstance(v, (int, float)) and v > 0 for v in bm_["missionExpectedSec"].values()):
    err("ranks.budgetModel.missionExpectedSec: 미션 이벤트 id 전부(퇴근 제외)에 양수 필요(T-139)")
int_ids_ = {i["id"] for i in T["interrupts"]["interrupts"]}
for k_, v_ in bm_.get("dayInterruptReserveSec", {}).items():
    if k_ not in int_ids_ or not (isinstance(v_, (int, float)) and 0 <= v_ <= 10):
        err(f"ranks.budgetModel.dayInterruptReserveSec.{k_}: 없는 방해 id 또는 0~10 밖(T-139)")
if not (1.0 <= bm_.get("perLeaveInterruptSec", 0) <= 3.0):
    err("ranks.budgetModel.perLeaveInterruptSec 1.0~3.0 밖(T-139, QA 실측 1.4~1.7)")
bc_ = T["days"]["generator"]["missions"].get("budgetCheck")
if not isinstance(bc_, dict) or bc_.get("enabled") is not True or bc_.get("onOver") != "drop_required" \
        or not (isinstance(bc_.get("minRequired"), int) and bc_["minRequired"] >= 1) or not (0 <= bc_.get("minSlackSec", -1) <= 10):
    err("days.generator.missions.budgetCheck: enabled true·onOver drop_required·minRequired ≥ 1·minSlackSec 0~10 필요(T-139)")
q_min_ = [ceo_["greetingQte"]["windowSec"]] + [v[x]["greetingQte.windowSec"] for v in ceo_["rankScaling"].values() for x in ("start", "end") if "greetingQte.windowSec" in v.get(x, {})]
if min(q_min_) < 0.4:
    err(f"bosses.ceo greetingQte.windowSec 최솟값 {min(q_min_)} < 0.4(반응 창 하한, T-139)")
if not (0 < ceo_["survival"]["maxSuspicionGain"] <= 0.2):
    err("bosses.ceo.survival.maxSuspicionGain 0~0.2 밖(T-139)")
if not ceo_["sim"].get("coneActiveIn"):
    err("bosses.ceo.sim.coneActiveIn 비어 있음(재확인 look 필요, T-139)")
dy_ = T["rules"]["day"]
_m = lambda t: int(t.split(":")[0]) * 60 + int(t.split(":")[1])
if not (_m(dy_["leaveClockStart"]) < _m(dy_["earlyLeaveBefore"]) < _m(dy_["overtimeAt"])):
    err("rules.day.earlyLeaveBefore가 leaveClockStart~overtimeAt 사이가 아님(T-139)")
if not (0.1 <= T["rules"]["suspicion"]["star3PeakBelow"] <= 0.3):
    err("rules.suspicion.star3PeakBelow 0.1~0.3 밖(T-139)")
i5_ = next(i for i in T["interrupts"]["interrupts"] if i["id"] == "INT-05")
if i5_["effect"].get("cancelOnLeaveStart") is not True:
    err("interrupts.INT-05.effect.cancelOnLeaveStart true 필요(D-070)")

# T-142: 생성 맵(layout.json)·미션 풀(missions.json) 기본 검사
if "layout" in T:
    LY = T["layout"]
    LEG3 = dict(T["maps"]["maps"][0]["legend"]); LEG3.update(LY["legendAdd"])
    W3 = LY["grid"]["width"]
    WILD3 = set(LY["wildcards"])
    for ch, opts in LY["wildcards"].items():
        for o in opts:
            if o["ch"] not in LEG3:
                err(f"layout.wildcards['{ch}']: 문자 '{o['ch']}' legend 없음")
            if len(o["weight"]) != 2 or min(o["weight"]) < 0:
                err(f"layout.wildcards['{ch}']: weight는 [c0, c1] 0 이상")
    for e in ("P",):
        if LEG3[e]["blocksSight"] is not True:
            err("layout: P(전높이 칸막이)는 blocksSight true(D-080)")
    if LY["legendAdd"].get("i", {}).get("blocksSight") is not False or LY["legendAdd"].get("i", {}).get("cover"):
        err("layout: i(반높이 칸막이)는 blocksSight false·cover 없음(D-080)")
    all_spots = set()
    for m in LY["modules"]:
        for y, r in enumerate(m["rows"]):
            if len(r) != W3:
                err(f"layout.modules.{m['id']}: {y}행 길이 {len(r)} ≠ {W3}")
            for x, ch in enumerate(r):
                if ch not in LEG3 and ch not in WILD3:
                    err(f"layout.modules.{m['id']}: ({x},{y}) 문자 '{ch}' legend·와일드카드 없음")
        for k, sp in m["spots"].items():
            all_spots.add(k)
            x, y = sp["tile"]
            ch = m["rows"][y][x] if 0 <= y < len(m["rows"]) and 0 <= x < W3 else "#"
            ok_ = ch in WILD3 or LEG3.get(ch, {}).get("walkable")
            if sp.get("type") == "door":
                ok_ = ok_ or ch == "="
            if not ok_:
                err(f"layout.modules.{m['id']}.spots.{k}: ({x},{y}) '{ch}' 통행 불가")
        for side in ("top", "bottom"):
            for x in m.get("ports", {}).get(side, []):
                if not (0 < x < W3 - 1):
                    err(f"layout.modules.{m['id']}.ports.{side}: 열 {x} 범위 밖")
    for need in ("player_seat", "gate_use", "tl_seat", "elevator_service_spawn", "ceo_greet_spot", "hr_inspect_spot"):
        if need not in all_spots:
            err(f"layout: 필수 스폿 {need}가 어떤 모듈에도 없음")
    LR = LY["leadRoaming"]
    if LR["standTell"]["sec"] < MIN_TELL or LR["standTell"]["minSec"] < MIN_TELL:
        err(f"layout.leadRoaming.standTell < {MIN_TELL}")
    for d in LR["destinations"]:
        if not any(sp in all_spots for sp in d["spots"]):
            err(f"layout.leadRoaming.destinations.{d['id']}: 스폿 {d['spots']} 없음")
        if "endTell" in d and d["endTell"]["sec"] < MIN_TELL:
            err(f"layout.leadRoaming.destinations.{d['id']}.endTell < {MIN_TELL}")
    for rk, v in LR["byRank"].items():
        if rk.startswith("_"):
            continue
        if not (2 <= v["countRange"][0] <= v["countRange"][1] <= 4):
            err(f"layout.leadRoaming.byRank.{rk}: 하루 2~4회(D-075) 밖")
        if v["speedTilesPerSec"] >= T["rules"]["playerSpeedTilesPerSec"]:
            err(f"layout.leadRoaming.byRank.{rk}: 팀장 순회 속도가 플레이어 이상")
    for tr in LY["complexityByRank"]:
        c0, c1 = tr["complexity"]
        if not (0 <= c0 <= c1 <= 1):
            err(f"layout.complexityByRank.{tr['rankId']}: complexity 범위")
    V12 = next(v for v in LY["validators"]["list"] if v["id"] == "V12_time_budget")
    if V12["ceoDayMaxPredictedSec"] > 81.0 or V12["normalDayMaxPredictedSec"] > 85.0:
        err("layout.validators.V12: 1판 예측 상한이 T-139 여유(95초 최댓값)를 넘음")
if "missions" in T:
    MS = T["missions"]
    ev_ids = {e["id"] for e in T["events"]["events"]}
    pool_ids = {e["id"] for e in MS["missionPool"]["existing"]} | {e["id"] for e in MS["missionPool"]["new"]}
    for e in MS["missionPool"]["existing"]:
        if e["id"] not in ev_ids:
            err(f"missions.existing.{e['id']}: events.json에 없음")
    for e in MS["missionPool"]["new"]:
        if e["id"] in ev_ids:
            err(f"missions.new.{e['id']}: events.json과 id 중복")
        if e["timeLimitSec"] < e["expectedDurationSec"] + 4:
            err(f"missions.new.{e['id']}: timeLimitSec < expectedDurationSec + 4")
    mod_ids = {m["id"] for m in MS["modifiers"]}
    cond_ids = {c["id"] for c in MS["conditions"]}
    for m in MS["modifiers"]:
        c = m.get("condition")
        if c and c["id"] not in cond_ids:
            err(f"missions.modifiers.{m['id']}: 조건 {c['id']} 정의 없음")
        if "chance" in json.dumps(m) or "Prob" in json.dumps(m):
            err(f"missions.modifiers.{m['id']}: 확률 필드 금지(보상은 결정적, D-004)")
        if m.get("rewardMul", 1) <= 0:
            err(f"missions.modifiers.{m['id']}: rewardMul ≤ 0")
        for mid in m.get("missions", []):
            if mid not in pool_ids:
                err(f"missions.modifiers.{m['id']}: 미션 {mid} 없음")
    for d, lst in MS["authoredOverlays"]["days"].items():
        for it in lst:
            for mid in it["modifiers"]:
                if mid not in mod_ids:
                    err(f"missions.authoredOverlays.{d}: 변형 {mid} 없음")
    for rk, w in MS["missionPool"]["poolByRank"].items():
        if rk.startswith("_"):
            continue
        for mid in w:
            if mid not in pool_ids:
                err(f"missions.poolByRank.{rk}: 미션 {mid} 없음")

# T-148) 성별 다양화(REQ-016, D-087·D-088): 변형 키·배치 규칙·등장 비율·시설 대칭·성별 고정 값 금지·문자열
CAST = rules["characters"].get("casting", {})
ROT_IDS = {CAST.get("rotation", {}).get("id")}
GENDERS = {"male", "female"}
cast_slots = []  # (where, actor dict, kind) — kind: boss | npc | bg | buddy
for a in T["bosses"]["bosses"]:
    cast_slots.append((f"bosses.{a['id']}", a, "boss"))
for a in T["npcs"]["npcs"]:
    cast_slots.append((f"npcs.{a['id']}", a, "npc"))
for a in BG:
    cast_slots.append((f"npcs.background.{a['id']}", a, "bg"))
if "buddy" in T["npcs"]:
    cast_slots.append(("npcs.buddy", T["npcs"]["buddy"], "buddy"))
else:
    err("npcs.buddy 없음(옆 팀 동기 남녀 변형, T-148)")
all_variant_sprites = []
for where, a, kind in cast_slots:
    vs = a.get("variants")
    if not isinstance(vs, list) or {v.get("gender") for v in vs} != GENDERS or len(vs) != 2:
        err(f"{where}.variants: 남녀 변형 2개(gender male·female) 필요(T-148)")
        continue
    vids = {v["id"] for v in vs}
    for v in vs:
        if not v.get("spriteKey"):
            err(f"{where}.variants.{v.get('id')}: spriteKey 없음")
        all_variant_sprites.append((where, v.get("spriteKey")))
    c = a.get("casting", {})
    if c.get("mode") == "fixed":
        picks = list(c.get("byInstance", {}).values()) if "byInstance" in c else [c.get("variant")]
        if not picks or any(pk not in vids for pk in picks):
            err(f"{where}.casting: 고정 변형이 variants에 없음")
        if kind == "boss" and "byInstance" in c:
            need_n = max(r_["cast"]["bosses"].get(a["id"], 0) for r_ in T["ranks"]["ranks"])
            if any(str(k_) not in c["byInstance"] for k_ in range(1, need_n + 1)):
                err(f"{where}.casting.byInstance: 인스턴스 1~{need_n} 전부 필요")
    elif c.get("mode") == "rotate":
        if c.get("rule") not in ROT_IDS:
            err(f"{where}.casting.rule '{c.get('rule')}' 이 rules.characters.casting.rotation에 없음")
    else:
        err(f"{where}.casting.mode는 fixed|rotate(T-148)")
sk_seen = {}
for where, sk in all_variant_sprites + [("rules.characters.playerVariants", v.get("spriteKey")) for v in rules["characters"].get("playerVariants", [])]:
    if sk in sk_seen:
        err(f"{where}: 변형 spriteKey '{sk}'가 {sk_seen[sk]}와 중복")
    sk_seen[sk] = where
if os.path.exists(ANIMS):
    miss_v = sorted(sk for sk in sk_seen if not any(f"{sk}/idle_down" == k for k in anim_keys))
    if miss_v:
        warns.append(f"T-148 변형 스프라이트 {len(miss_v)}종이 anims.json에 아직 없음(아트 T-149 대기, 그 전엔 기존 spriteKey로 대체): {', '.join(miss_v[:6])}{' …' if len(miss_v) > 6 else ''}")

# 플레이어 선택(D-088): 남/여 2종, 기본값 없음, 첫 출근 전 필수, 설정에서 변경
PV = rules["characters"].get("playerVariants", [])
PSel = rules["characters"].get("playerSelection", {})
if {v.get("gender") for v in PV} != GENDERS or len(PV) != 2:
    err("rules.characters.playerVariants: 남녀 2종 필요(D-088)")
if PSel.get("defaultVariant", "x") is not None or PSel.get("preselected") is not False or PSel.get("requiredBeforeFirstDay") is not True:
    err("rules.characters.playerSelection: 기본값 없음(null)·미리 선택 없음·첫 출근 전 필수(D-088)")
if PSel.get("changeableIn") != "settings" or PSel.get("appliesFrom") != "next_run" or PSel.get("sameSizeSameEmphasis") is not True:
    err("rules.characters.playerSelection: 설정에서 변경·다음 판부터 적용·같은 크기 버튼 필요")
if set(PSel.get("displayOrder", [])) != {v.get("id") for v in PV}:
    err("rules.characters.playerSelection.displayOrder ≠ playerVariants id")

# 등장 비율: 직급별 출연(상사 수·NPC·배경 동료·동기) 기준 여성 비율. 고정 = 0/1, 회전 = rotateCountsAs(0.5)
BAL = CAST.get("balance", {})
RCA = BAL.get("rotateCountsAs", 0.5)


def f_share(a, inst=1):
    c = a.get("casting", {})
    if c.get("mode") == "rotate":
        return RCA
    pick = c.get("byInstance", {}).get(str(inst)) if "byInstance" in c else c.get("variant")
    g = next((v["gender"] for v in a.get("variants", []) if v["id"] == pick), None)
    return 1.0 if g == "female" else 0.0


boss_by = {a["id"]: a for a in T["bosses"]["bosses"]}
npc_by = {a["id"]: a for a in T["npcs"]["npcs"]}
buddy_ = T["npcs"].get("buddy", {})
tot_w = tot_f = 0.0
share_report = []
for r_ in T["ranks"]["ranks"]:
    sl = []
    for bid, n_ in r_["cast"]["bosses"].items():
        sl += [f_share(boss_by[bid], k_) for k_ in range(1, n_ + 1)]
    sl += [f_share(npc_by[nid]) for nid in r_["cast"]["npcs"]]
    sl += [f_share(b) for b in BG if bg_active(b, r_["id"])]
    d0, d1 = r_["dayRange"]
    if buddy_ and (d1 is None or d1 >= buddy_.get("fromDay", 999)):
        sl.append(f_share(buddy_))
    sh = sum(sl) / len(sl)
    share_report.append(f"{r_['id']} {sh:.2f}")
    lo_, hi_ = BAL.get("femaleSharePerRank", [0.35, 0.65])
    if not (lo_ <= sh <= hi_):
        err(f"ranks.{r_['id']}: 출연 여성 비율 {sh:.2f} 범위 [{lo_}, {hi_}] 밖(T-148)")
    days_ = (d1 - d0 + 1) if d1 is not None else BAL.get("endlessRankDaysForWeight", 30)
    tot_w += days_ * len(sl)
    tot_f += days_ * sum(sl)
ov = tot_f / tot_w if tot_w else 0
lo_, hi_ = BAL.get("femaleShareOverall", [0.45, 0.55])
if not (lo_ <= ov <= hi_):
    err(f"전체 출연 여성 비율 {ov:.2f} 범위 [{lo_}, {hi_}] 밖(T-148)")
for grp, items in (("fixed_bosses", [(a, k_) for a in T["bosses"]["bosses"] if a.get("casting", {}).get("mode") == "fixed"
                                     for k_ in (range(1, 3) if "byInstance" in a["casting"] else [1])]),
                   ("fixed_npcs", [(a, 1) for a in T["npcs"]["npcs"] + [buddy_] if a and a.get("casting", {}).get("mode") == "fixed"])):
    if grp in BAL.get("requireBothGendersIn", []) and {f_share(a, k_) for a, k_ in items} != {0.0, 1.0}:
        err(f"{grp}: 고정 인물이 한 성별로만 채워짐(역할-성별 연결 금지, T-148)")

# 시설 대칭(layout.genderFacilities): 모듈 안 두 쪽의 크기·칸 수·문→가운데 복도 거리, 플레이어 기준 표현만
GF = T["layout"].get("genderFacilities")
if GF:
    LEG3 = dict(T["maps"]["maps"][0]["legend"]); LEG3.update(T["layout"]["legendAdd"])
    if GF.get("resolve") != "player_relative":
        err("layout.genderFacilities.resolve != player_relative")
    mods = {m_["id"]: m_ for m_ in T["layout"]["modules"]}
    gf_mods = [m_ for m_ in T["layout"]["modules"] if "genderFacility" in m_]
    types_ = {m_["genderFacility"]["type"] for m_ in gf_mods}
    if not {"restroom", "locker_room"} <= types_:
        err("layout: 성별 화장실·탈의실 모듈 둘 다 필요(T-148)")
    cap_mod = 3
    v15 = next((v for v in GF.get("validators", []) if v["id"] == "V15_facility_symmetry"), None)
    if not v15 or not (1 <= v15.get("maxOneWayDiffTiles", 0) <= 6):
        err("layout.genderFacilities.validators.V15 maxOneWayDiffTiles 1~6 필요")
    for m_ in gf_mods:
        rows_ = m_["rows"]; W_ = len(rows_[0]); H_ = len(rows_)
        sides = m_["genderFacility"]["sides"]
        if set(sides) != {"a", "b"}:
            err(f"layout.modules.{m_['id']}: genderFacility.sides는 a·b")
            continue

        def walk3(x, y):
            return 0 <= x < W_ and 0 <= y < H_ and LEG3.get(rows_[y][x], {}).get("walkable") is True

        def bfs3(src, block):
            dist = {src: 0}; q_ = deque([src])
            while q_:
                c_ = q_.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n_ = (c_[0] + dx, c_[1] + dy)
                    if n_ not in dist and walk3(*n_) and n_ not in block:
                        dist[n_] = dist[c_] + 1; q_.append(n_)
            return dist
        info = {}
        for sd, ref in sides.items():
            sp_ = m_["spots"]
            for f_ in ("stall", "sink", "door"):
                if ref.get(f_) not in sp_:
                    err(f"layout.modules.{m_['id']}.{sd}.{f_}: 스폿 {ref.get(f_)} 없음")
            z_ = next((z for z in m_["zones"] if z["id"] == ref["zone"]), None)
            if not z_:
                err(f"layout.modules.{m_['id']}.{sd}: 구역 {ref['zone']} 없음")
                continue
            x0, y0, zw, zh = z_["rect"]
            room = [(x, y) for y in range(y0, y0 + zh) for x in range(x0, x0 + zw) if walk3(x, y)]
            stalls = [p_ for p_ in room if LEG3[rows_[p_[1]][p_[0]]].get("safeZone")]
            door = tuple(m_["spots"][ref["door"]]["tile"])
            if LEG3.get(rows_[door[1]][door[0]], {}).get("kind") != "door_screened":
                err(f"layout.modules.{m_['id']}.{sd}: 문이 가림막 문(+)이 아님(밖에서 안이 보이면 안 됨)")
            info[sd] = (len(room), len(stalls), door)
        if len(info) == 2:
            if info["a"][0] != info["b"][0] or info["a"][1] != info["b"][1]:
                err(f"layout.modules.{m_['id']}: 두 쪽 크기·칸 수 다름 {info['a'][:2]} vs {info['b'][:2]}")
            # 모듈 위·아래 포트에서 각 쪽 칸까지 거리(다른 쪽 문은 벽) 차이
            for side_ in ("top", "bottom"):
                for px in m_["ports"].get(side_, []):
                    src = (px, 0 if side_ == "top" else H_ - 1)
                    if not walk3(*src):
                        continue
                    ds = []
                    for sd in ("a", "b"):
                        other = info["b" if sd == "a" else "a"][2]
                        dd = bfs3(src, {other})
                        st_ = tuple(m_["spots"][sides[sd]["stall"]]["tile"])
                        ds.append(dd.get(st_))
                    if None in ds:
                        err(f"layout.modules.{m_['id']}: 포트 {side_}{px}에서 한쪽 칸 도달 불가 {ds}")
                    elif abs(ds[0] - ds[1]) > cap_mod:
                        err(f"layout.modules.{m_['id']}: 포트 {side_}{px} 기준 두 쪽 거리 차 {abs(ds[0] - ds[1])} > {cap_mod}")
            # 한쪽 시설 안에서 다른 쪽 시설로 바로 통하면 안 됨(내 쪽 문만 지남)
            a_room = bfs3(tuple(m_["spots"][sides["a"]["stall"]]["tile"]), {info["a"][2], info["b"][2]})
            if tuple(m_["spots"][sides["b"]["stall"]]["tile"]) in a_room:
                err(f"layout.modules.{m_['id']}: 두 시설이 문을 거치지 않고 이어짐")
    rg = GF.get("groupReplace", {})
    for g_old, g_new in rg.items():
        if not any(m_["group"] == g_new for m_ in gf_mods):
            err(f"layout.genderFacilities.groupReplace: {g_new} 모듈 없음")
    # 성별 고정 값 금지: 케이스·시설 규칙·본부장 시설 들름은 mine/other·same/other로만
    i10 = ints.get("INT-10", {}).get("effect", {}).get("facilityStop")
    for where_, blk in (("layout.genderFacilities", GF), ("interrupts.INT-10.effect.facilityStop", i10 or {}),
                        ("missions.genderModifiers", T["missions"].get("genderModifiers", []))):
        for p_, k_, v_ in walk_json(blk):
            if isinstance(v_, str) and re.search(r"\b(male|female)\b|남자|여자|남성|여성", v_) and not k_.startswith("_"):
                err(f"{where_}{p_}: 절대 성별 값 '{v_}'(플레이어 기준 mine/other·same/other만, T-148)")
    if not i10:
        err("interrupts.INT-10.effect.facilityStop 없음(C2·C3)")
    else:
        if boss_by[i10["relationOf"]].get("casting", {}).get("mode") != "rotate":
            err("facilityStop.relationOf는 회전 인물이어야 함(고정 인물 성별이 메카닉에 쓰이면 비대칭)")
        if set(i10.get("target", {})) != {"same", "other"}:
            err("facilityStop.target은 same·other 둘 다 필요")
        if i10.get("seenInsideEffect", {}).get("suspicionOnce", 1) > T["missions"]["modifiers"][[m_["id"] for m_ in T["missions"]["modifiers"]].index("bonus.clean")]["condition"]["args"]["max"]:
            err("facilityStop.seenInsideEffect.suspicionOnce > bonus.clean 기준(벌이 너무 큼)")
    if len(GF.get("cases", [])) < 5:
        err("layout.genderFacilities.cases ≥ 5 필요(T-148)")
    acc_ = GF.get("access", {})
    if acc_.get("fixedActorsEnter") != "never" or acc_.get("playerEnters") != "mine_only" or acc_.get("inspectionsInside") != "never":
        err("layout.genderFacilities.access: 고정 인물 출입 never·플레이어 mine_only·시설 안 점검 never 필요")
    for e_ in T["missions"]["missionPool"]["existing"]:
        if e_["id"] == "restroom" and e_.get("targetFacility") != "restroom.mine":
            err("missions.existing.restroom.targetFacility != restroom.mine (T-148)")
    for gm in T["missions"].get("genderModifiers", []):
        if "chance" in json.dumps(gm) or "Prob" in json.dumps(gm):
            err(f"missions.genderModifiers.{gm['id']}: 확률 필드 금지(D-004)")
        tf = gm.get("closes") or gm.get("targetFacility")
        if tf and not tf.endswith(".mine"):
            err(f"missions.genderModifiers.{gm['id']}: 대상은 내 쪽(.mine)만")
        if gm.get("params", {}).get("otherSideAllowed", False):
            err(f"missions.genderModifiers.{gm['id']}: 다른 쪽 시설 이용 금지")

# 문자열: 성별 호칭·고정관념 단어(대사는 '○○ 씨'·직함, 성별 무관 문장)
GENDER_WORDS = re.compile(r"누나|오빠|언니|형님|아저씨|아줌마|아주머니|아가씨|총각|그녀|여직원|남직원|여사원|남사원|미녀|미남|여자가|남자가|여자는|남자는|여자라서|남자라서|여자답|남자답|김여사")
ALLOW_GENDER_KEYS = {"charsel.option.m", "charsel.option.f"}
for p_, k_, v_ in walk_json(T["strings.ko"]["strings"]):
    for txt in (v_ if isinstance(v_, list) else [v_]):
        if isinstance(txt, str) and GENDER_WORDS.search(txt) and p_.lstrip(".").split("[")[0] not in ALLOW_GENDER_KEYS:
            err(f"strings{p_}: 성별 호칭·고정관념 단어 '{GENDER_WORDS.search(txt).group(0)}'(T-148 §4)")
for _t in T.values():
    for k_, v_ in _t.get("stringsKo", {}).items():
        if isinstance(v_, str) and GENDER_WORDS.search(v_):
            err(f"stringsKo.{k_}: 성별 호칭·고정관념 단어 '{GENDER_WORDS.search(v_).group(0)}'")
print("출연 여성 비율(직급별, 회전 = 0.5): " + ", ".join(share_report) + f" / 전체 {ov:.2f}")

print(f"tables: {', '.join(T)}")
print("화면 안 최악 인원(직급별, 플레이어 포함): " + ", ".join(f"{k} {v[0]}" for k, v in RANK_SCREEN.items()))
for w in warns:
    print("WARN", w)
for e in errors:
    print("ERROR", e)
print("OK" if not errors else f"{len(errors)} error(s)")
sys.exit(1 if errors else 0)
