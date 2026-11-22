#!/usr/bin/env python3
"""game/data/*.json v2 정합성 검사 (기획 소유, 표준 라이브러리만 사용).

실행: python3 -I molrae-toegeun/design/tools/validate_data.py
검사: schemaVersion, 문자열 키 존재, 테이블 간 ID 참조, 전조 ≥ 0.4초, 페이크 상한,
      맵 크기·legend·스폿/웨이포인트 통행 가능·경로 존재, 층 동시 인원 ≤ 8,
      사원증 줄 색(D-037), 하루 예상 길이 범위.
"""
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
    # 인원: 플레이어 + 상주 + 방해 등장 인원(겹칠 수 있는 최대)
    actors_on = {patrols[p]["actorId"] + str(patrols[p].get("instance", 1)) for p in d["castPatrols"]}
    for e in d["dayInterrupts"] + d["leaveInterrupts"]:
        for a2 in ints[e["id"]]["actors"]:
            actors_on.add(a2 + "1")
    if 1 + len(actors_on) > rules["characters"]["maxOnFloor"]:
        err(f"days.{d['day']}: 층 인원 {1 + len(actors_on)} > 8")
for r in T["ranks"]["ranks"]:
    n = 1 + sum(r["cast"]["bosses"].values()) + len(r["cast"]["npcs"])
    if "ceo" in r["cast"]["bosses"]:
        n -= 1  # H7: 대표님 순시 중 본부장·인사팀 없음 → 대표님 대신 둘 중 최대 인원으로 계산
    if n > rules["characters"]["maxOnFloor"]:
        err(f"ranks.{r['id']}: 층 인원 {n} > 8")

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

print(f"tables: {', '.join(T)}")
for w in warns:
    print("WARN", w)
for e in errors:
    print("ERROR", e)
print("OK" if not errors else f"{len(errors)} error(s)")
sys.exit(1 if errors else 0)
