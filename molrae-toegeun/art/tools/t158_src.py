#!/usr/bin/env python3
"""T-158 원본 갱신(결정적, 다시 돌려도 같은 파일).

  python3 art/tools/t158_src.py

1. tile2/wall_door_restroom_<m|f>_<mine|other> (art/src/sprites/t149-tile.json 의 해당 4프레임만 교체)
   표지판을 8x8 → 8x10 으로 키우고 남녀 픽토그램 실루엣 차이를 키움(D-093: 신체선·리본 없음).
   남 = 넓은 어깨부터 곧게 내려오는 사각 몸 + 굵은 다리 3행, 여 = 좁은 어깨에서 아래로 넓어지는 사다리꼴 + 가는 다리 2행.
   테두리: mine = 하늘색(cool), other = 회색(mid) 그대로.
2. icon_door_alert (art/src/sprites/t158-alert.json, flat 키, warning-ui 그룹 = 빨강 허용)
   시설 문 위 '!' 들킴 직전 경고. ui/alert 와 같은 빨강 규칙·같은 크기(12x12, 원점 (0.5, 1)),
   색을 뒤집어(흰 바탕 + 빨강 테두리 2px + 빨강 '!') 꽉 찬 빨강 발각 말풍선(ui/alert)과 구분, 꼬리는 가운데 아래(문·머리를 가리킴).
3. player/disguise (art/src/sprites/char-player.json 의 disguise 프레임만 교체)
   서류를 1행 내려 들어 눈 아래 9행까지 머리·얼굴이 보이게 함(키·프레임 이름 그대로).
   여성 변형의 위장 머리는 art/tools/t154_src.py(HEADS player_f extra)가 출처 → 그 스크립트를 다시 돌림.
표준 라이브러리만.
"""
import json
import os

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ART, "src", "sprites")

FIG = {
    "m": [
        "...DD...",
        "...DD...",
        "........",
        ".DDDDDD.",
        ".DDDDDD.",
        ".DDDDDD.",
        ".DDDDDD.",
        ".DD..DD.",
        ".DD..DD.",
        ".DD..DD.",
    ],
    "f": [
        "...DD...",
        "...DD...",
        "........",
        "..DDDD..",
        "..DDDD..",
        ".DDDDDD.",
        ".DDDDDD.",
        "DDDDDDDD",
        "..D..D..",
        "..D..D..",
    ],
}
BORDER = {"mine": "C", "other": "M"}


def door(g, side):
    b = BORDER[side]
    rows = ["OLqQQQQQQQQQQqLO", "OLOOOOOOOOOOOOLO", "OLO" + b * 10 + "OLO"]
    for r in FIG[g]:
        rows.append("OLO" + b + r.replace(".", "W") + b + "OLO")
    rows += ["OLO" + b * 10 + "OLO", "OLOOOOOOOOOOOOLO", "OLqqqqqqqqqqqqLO"]
    assert len(rows) == 16 and all(len(r) == 16 for r in rows)
    return rows


ALERT = {
    "name": "t158-alert",
    "group": "warning-ui",
    "flat": True,
    "lean": True,
    "size": [12, 12],
    "origin": [0.5, 1],
    "note": "T-158 icon_door_alert: 시설 문 위·본부장 머리 위 '!'(들킴 직전 경고, interrupts.json doorIcon·insideCue.overHead). 빨강은 ui/alert 와 같은 경고 UI 규칙(warning-ui). 흰 바탕 + 빨강 테두리·'!'(색 반전)와 가운데 꼬리로 꽉 찬 빨강 발각 말풍선 ui/alert(꼬리 오른쪽)와 구분. 0.25초 깜빡임은 개발 코드",
    "frames": [
        {"name": "icon_door_alert", "rows": [
            "..OOOOOOOO..",
            ".ORRRRRRRRO.",
            "ORWWWWWWWWRO",
            "ORWWWRRWWWRO",
            "ORWWWRRWWWRO",
            "ORWWWRRWWWRO",
            "ORWWWWWWWWRO",
            "ORWWWRRWWWRO",
            "ORWWWWWWWWRO",
            ".ORRRRRRRRO.",
            "..OOORROOO..",
            ".....OO.....",
        ]},
    ],
}

DISGUISE = [
    "......O..OOO....",
    ".....OOOOHHO....",
    "...OOHHHHHHOO...",
    "..OHHHDDHHHHHO..",
    "OHHHHDHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSHSSSSHHO.",
    ".OHSSOSSSSOSSHO.",
    ".OSSSOSSSSOSSSO.",
    ".OOOOOOOOOOOOOO.",
    "OSOWWWWWWWWWWOSO",
    "OSOWGGGGWWWWWOSO",
    ".OOWWWWWWWWWWOO.",
    "..OWMMMMWMMMWO..",
    "..OWMMMWWMMWWO..",
    "..OOOOOOOOOOOO..",
    "....ODDDDDDO....",
    "....ODDOODDO....",
    "....ODDOODDO....",
    "....OOOOOOOO....",
]


def write(fn, d):
    p = os.path.join(SPR, fn)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("write", fn)


def main():
    p = os.path.join(SPR, "t149-tile.json")
    d = json.load(open(p, encoding="utf-8"))
    for f in d["frames"]:
        n = f["name"]
        if n.startswith("wall_door_restroom_"):
            g, side = n[len("wall_door_restroom_"):].split("_")
            f["rows"] = door(g, side)
    d["note"] = d["note"].split(" | T-158")[0] + " | T-158: 표지판 8x10, 남 = 사각 몸 + 굵은 다리, 여 = 아래로 넓어지는 사다리꼴 + 가는 다리(실루엣 차이 확대, 신체선·리본 없음)"
    write("t149-tile.json", d)

    write("t158-alert.json", ALERT)

    p = os.path.join(SPR, "char-player.json")
    d = json.load(open(p, encoding="utf-8"))
    for f in d["frames"]:
        if f["name"] == "disguise":
            f["rows"] = DISGUISE
    write("char-player.json", d)


if __name__ == "__main__":
    main()
