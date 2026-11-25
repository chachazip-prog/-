#!/usr/bin/env python3
"""데이터(game/data/*.json)가 참조하는 스프라이트·애니메이션 키가 아틀라스에 있는지 검사(T-146, T-149 보강).

  python3 art/tools/check_data_keys.py [--sheet game/assets/sprites]

필드별 해석 규칙(개발 연동 관례)
  iconSprite, bubbleIcon        → flat 프레임 키 그대로
  doorIcon, overHead (T-158)    → flat 프레임 키 그대로(시설 문 위·머리 위 경고 아이콘)
  art, floorMark                → 프레임 키('|' 로 여러 개, '<mask>' 는 16종 중 'o' 로 대표 검사,
                                  '<sign>' 은 m_mine·m_other·f_mine·f_other 4종 모두 검사)
                                  T-149: 값이 설명 문장이면('+', 괄호, 한글 등) 문장 전체를 키로 보지 않고
                                  문장 안의 '<접두어>/<이름>' 키 토큰만 뽑아 검사(오탐 제거, 진짜 키는 계속 검사)
  pose (팀장 순회 'a/b')         → 애니메이션 키
  pose (스폿, 'nap_on_sofa' 등)  → player/pose_<id> 애니메이션
  pauseShowsPose, carryDisguisePose → player/pose_<id>_down 애니메이션
  carryProp                     → prop/<id> 프레임 + player/carry_<item>_down 애니메이션
  hudBadgeKey ('hud.x')         → hud/x 프레임
  spriteKey, sprite             → <key>/idle_down 프레임
  variants[].spriteKey (T-149)  → 같은 객체의 대체 spriteKey(원본)가 가진 프레임·애니메이션을 변형도 모두 가졌는지
표준 라이브러리만 사용. 누락이 있으면 종료 코드 1.
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CARRY_ITEM = {"parcel_box": "box", "paper_stack": "paper", "cafe_cup": "cup"}
SIGNS = ("m_mine", "m_other", "f_mine", "f_other")
KEY_RE = re.compile(r"[a-z0-9_]+/[a-z0-9_<>]+")
PLAIN_RE = re.compile(r"^[a-z0-9_/<>|]+$")


def art_keys(v):
    """art 값 → 검사할 프레임 키 목록. 순수 키 목록이 아니면 문장 속 키 토큰만."""
    toks = v.split("|") if PLAIN_RE.match(v) else KEY_RE.findall(v)
    out = []
    for t in toks:
        t = t.replace("<mask>", "o")
        out += [t.replace("<sign>", g) for g in SIGNS] if "<sign>" in t else [t]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default=os.path.join(ROOT, "game", "assets", "sprites"))
    a = ap.parse_args()
    frames = set(json.load(open(os.path.join(a.sheet, "sheet.json"), encoding="utf-8"))["frames"])
    anims = set(x["key"] for x in json.load(open(os.path.join(a.sheet, "anims.json"), encoding="utf-8"))["anims"])
    checks = []  # (파일, 필드, 값, [(종류, 키)])

    def need(fn, k, v, reqs):
        checks.append((fn, k, v, reqs))

    def walk(fn, o, parent=None):
        if isinstance(o, dict):
            for k, v in o.items():
                if k.startswith("_"):
                    continue
                if isinstance(v, str):
                    field(fn, k, v)
                elif isinstance(v, list) and k in ("carryProp",):
                    for x in v:
                        field(fn, k, x)
                walk(fn, v, k)
        elif isinstance(o, list):
            for v in o:
                walk(fn, v, parent)

    def field(fn, k, v):
        if k in ("iconSprite", "bubbleIcon", "doorIcon", "overHead"):
            need(fn, k, v, [("frame", v)])
        elif k in ("art", "floorMark") and "/" in v:
            need(fn, k, v, [("frame", x) for x in art_keys(v)])
        elif k == "pose":
            need(fn, k, v, [("anim", v if "/" in v else "player/pose_" + v)])
        elif k in ("pauseShowsPose", "carryDisguisePose"):
            need(fn, k, v, [("anim", "player/pose_%s_down" % v)])
        elif k == "carryProp":
            r = [("frame", "prop/" + v)]
            if v in CARRY_ITEM:
                r.append(("anim", "player/carry_%s_down" % CARRY_ITEM[v]))
            need(fn, k, v, r)
        elif k == "hudBadgeKey":
            need(fn, k, v, [("frame", v.replace(".", "/", 1))])
        elif k in ("spriteKey", "sprite") and "/" not in v and " " not in v:
            need(fn, k, v, [("frame", v + "/idle_down")])

    pairs = []  # (파일, 원본 spriteKey, 변형 spriteKey)

    def variants(fn, o):
        if isinstance(o, dict):
            base = o.get("spriteKey") or o.get("sprite") or o.get("playerSpriteKey") or o.get("fallbackSprite")
            for v in o.get("variants", []) or o.get("playerVariants", []):
                if isinstance(v, dict) and v.get("spriteKey") and base:
                    pairs.append((fn, base, v["spriteKey"]))
            for v in o.values():
                variants(fn, v)
        elif isinstance(o, list):
            for v in o:
                variants(fn, v)

    for p in sorted(glob.glob(os.path.join(ROOT, "game", "data", "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        walk(os.path.basename(p), d)
        variants(os.path.basename(p), d)
    seen, miss = set(), 0
    for fn, k, v, reqs in checks:
        for kind, key in reqs:
            if (kind, key) in seen:
                continue
            seen.add((kind, key))
            ok = key in (frames if kind == "frame" else anims)
            miss += not ok
            print("%-4s %-15s %-18s %-6s %s" % ("OK" if ok else "MISS", fn, k, kind, key))
    for fn, base, var in sorted(set(pairs)):
        bf = sorted(k[len(base) + 1:] for k in frames if k.startswith(base + "/"))
        ba = sorted(k[len(base) + 1:] for k in anims if k.startswith(base + "/"))
        lf = [x for x in bf if var + "/" + x not in frames]
        la = [x for x in ba if var + "/" + x not in anims]
        ok = not lf and not la
        miss += not ok
        print("%-4s %-15s %-18s %-6s %s ⊇ %s (프레임 %d, 애니 %d%s)" % (
            "OK" if ok else "MISS", fn, "variants", "set", var, base, len(bf), len(ba),
            "" if ok else ", 빠짐 " + ", ".join((lf + la)[:6])))
    print("검사 %d건 + 변형 세트 %d건, 누락 %d건" % (len(seen), len(set(pairs)), miss))
    sys.exit(1 if miss else 0)


if __name__ == "__main__":
    main()
