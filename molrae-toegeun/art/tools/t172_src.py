#!/usr/bin/env python3
"""T-172 원본 갱신(결정적, 다시 돌려도 같은 파일). D-132(글자 금지) / D-087(성별 시설 표현) / D-025(빨강 금지).

  python3 art/tools/t172_src.py

해당 프레임의 rows 만 바꾼다(키 이름·크기·원점·다른 프레임 그대로).
1. art/src/sprites/icon-12.json  icon_restroom (12x12, flat)
   'WC' 글자 판 → 변기 그림(앞에서 본 3/4 시점: 뒤 물탱크 + 흰 변기 테두리 + 하늘색 물 + 받침).
   미션 칩은 성별과 무관하게 모든 플레이어에게 같은 그림이어야 하므로 성별 픽토그램을 쓰지 않는다
   (성별 픽토그램은 D-087 시설 문 표지 tile2/wall_door_restroom_* 에만 둠).
2. art/src/sprites/tile-office.json  wall_rest_sign (16x16, 견본 장면용 벽 표지)
   'WC' 글자 → 같은 변기 그림을 흰 판에 진한 하늘색으로(글자·성별 기호 없음).
3. art/src/sprites/t169-headicon.json  fx/head_icon/greet, fx/head_icon/switch (8x8) 판독성 보강
   greet: 머리를 6칸 넓이로 키우고 정수리 가르마(D) + 위아래 2칸 움직임 줄 → '숙인 머리 + 모은 손'이 덩어리로 안 뭉개짐
   switch: 겹친 두 창(뭉개짐) → 하늘색 휴대폰 화면 + 흰 ⇄ 두 화살표(화살촉 3칸)
   art/tools/t169_src.py 의 HEAD_FIX 도 같은 값으로 바꿔 두었다(그 스크립트를 다시 돌려도 결과 같음).
표준 라이브러리만.
"""
import json
import os

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ART, "src", "sprites")

# 비교 미리보기용 이전 그림(T-130 / T-169 원본 그대로)
OLD = {
    "icon_restroom": [
        "............",
        ".OOOOOOOOOO.",
        "OCCCCCCCCCCO",
        "OWCCCWCCWWCO",
        "OWCCCWCWCCCO",
        "OWCWCWCWCCCO",
        "OWCWCWCWCCCO",
        "OCWCWCCCWWCO",
        "OCCCCCCCCCCO",
        "OccccccccccO",
        ".OOOOOOOOOO.",
        "............",
    ],
    "wall_rest_sign": [
        "WWWWWWWWWWWWWWWW",
        "QQQQQQQQQQQQQQQQ",
        "QQOOOOOOOOOOOOQQ",
        "QQOWWWWWWWWWWOqQ",
        "QQOcWWWcWWccWOqQ",
        "QQOcWWWcWcWWWOqQ",
        "QQOcWcWcWcWWWOqQ",
        "QQOcWcWcWcWWWOqQ",
        "QQOWcWcWWWccWOqQ",
        "QQOWWWWWWWWWWOqQ",
        "QQOOOOOOOOOOOOqQ",
        "qqqqqqqqqqqqqqqq",
        "qqqqqqqqqqqqqqqq",
        "OOOOOOOOOOOOOOOO",
        "MMMMMMMMMMMMMMMM",
        "OOOOOOOOOOOOOOOO",
    ],
    "greet": ["........", "..OOOO..", ".OHHHHO.", "MOHHHHOM", ".OSSSSO.", "OPOOOOPO", "OPPSSPPO", ".OOOOOO."],
    "switch": ["OOOOO...", "OLLLO...", "OLOOOOO.", "OLOCWCO.", "OOOCCCO.", "..OCWCO.", "..OOOOO.", "........"],
}

NEW = {
    # 변기(앞 3/4): 물탱크(연회색 뚜껑) → 흰 테두리 → 하늘색 물(진한 하늘색 그늘) → 좁아지는 받침
    "icon_restroom": [
        "..OOOOOOOO..",
        "..OWWWWWWO..",
        "..OLLLLLLO..",
        ".OOOOOOOOOO.",
        "OWWWWWWWWWWO",
        "OWOOOOOOOOWO",
        "OWOCCCCCcOWO",
        "OWWOccccOWWO",
        ".OLWOOOOWLO.",
        "..OLWWWWLO..",
        "...OLLLLO...",
        "...OOOOOO...",
    ],
    "wall_rest_sign": [
        "WWWWWWWWWWWWWWWW",
        "QQQQQQQQQQQQQQQQ",
        "QQOOOOOOOOOOOOQQ",
        "QQOWWccccccWWOqQ",
        "QQOWWcLLLLcWWOqQ",
        "QQOWccccccccWOqQ",
        "QQOWcCCCCCCcWOqQ",
        "QQOWWcCCCCcWWOqQ",
        "QQOWWWccccWWWOqQ",
        "QQOWWWWWWWWWWOqQ",
        "QQOOOOOOOOOOOOqQ",
        "qqqqqqqqqqqqqqqq",
        "qqqqqqqqqqqqqqqq",
        "OOOOOOOOOOOOOOOO",
        "MMMMMMMMMMMMMMMM",
        "OOOOOOOOOOOOOOOO",
    ],
    "greet": ["M.OOOO.M", ".OHHHHO.", "OHHDDHHO", "MOHHHHOM", ".OSSSSO.", "OPOOOOPO", "OPPSSPPO", ".OOOOOO."],
    "switch": [".OOOOOO.", "OCCCCWCO", "OWWWWWWO", "OCCCCWCO", "OCWCCCCO", "OWWWWWWO", "OCWCCCCO", ".OOOOOO."],
}

TARGETS = [
    ("icon-12.json", ["icon_restroom"]),
    ("tile-office.json", ["wall_rest_sign"]),
    ("t169-headicon.json", ["greet", "switch"]),
]

NOTE_ICON = " T-172(D-132): icon_restroom = 변기 그림(글자·성별 기호 없음, 모든 플레이어 같은 그림)"


def write(fn, d):
    p = os.path.join(SPR, fn)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("write", fn)


def main():
    for fn, names in TARGETS:
        p = os.path.join(SPR, fn)
        d = json.load(open(p, encoding="utf-8"))
        hit = set()
        for f in d["frames"]:
            if f["name"] in names:
                old = f["rows"]
                new = NEW[f["name"]]
                assert len(old) == len(new) and all(len(a) == len(b) for a, b in zip(old, new)), f["name"]
                f["rows"] = list(new)
                hit.add(f["name"])
        assert hit == set(names), (fn, hit)
        if fn == "icon-12.json":
            d["note"] = d["note"].split(" T-172")[0] + NOTE_ICON
        write(fn, d)


if __name__ == "__main__":
    main()
