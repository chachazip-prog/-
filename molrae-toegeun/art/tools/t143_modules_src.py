#!/usr/bin/env python3
"""T-143 모듈 에셋 원본 부트스트랩(1회용 보조 스크립트, 표준 라이브러리만).

art/src/sprites/t143-*.json 과 art/src/scenes/t143-modules.json 을 만든다.
만들어진 JSON 이 원본이다. 오너가 JSON 을 직접 고친 뒤에는 이 스크립트를 다시 돌리지 않는다
(덮어쓰기 방지: 이미 파일이 있으면 --force 없이는 멈춘다).

  python3 art/tools/t143_modules_src.py [--force]

칸막이 16종은 연결 마스크(N·E·S·W)로 자동 조립한다. 키 접미사 = 연결 방향 문자열(nesw 순서, 없으면 o).
"""
import argparse
import json
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ART, "src", "sprites")
SCN = os.path.join(ART, "src", "scenes")


class Grid:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.c = [["."] * w for _ in range(h)]

    def set(self, x, y, ch):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[y][x] = ch

    def put(self, x, y, rows, skip="."):
        if isinstance(rows, str):
            rows = [rows]
        for dy, line in enumerate(rows):
            for dx, ch in enumerate(line):
                if ch != skip:
                    self.set(x + dx, y + dy, ch)

    def rect(self, x, y, w, h, ch):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, ch)

    def box(self, x, y, w, h, fill, edge="O"):
        self.rect(x, y, w, h, edge)
        if w > 2 and h > 2:
            self.rect(x + 1, y + 1, w - 2, h - 2, fill)

    def rows(self):
        return ["".join(r) for r in self.c]


def chk(name, rows, w, h):
    assert len(rows) == h, "%s: %d rows != %d" % (name, len(rows), h)
    for i, r in enumerate(rows):
        assert len(r) == w, "%s: row %d len %d != %d (%r)" % (name, i, len(r), w, r)
    return rows


# ------------------------------------------------------------------ 칸막이

HALF = dict(h=16, cap=["O", "L", "M"], cap_y=5,
            front=["O", "C", "C", "C", "C", "c", "M", "O"],
            strip="OLMO", sx=6, end_pad=2)
# 전높이: 16x36. 앞면 28px 가 칸 아래 변보다 4px 위에서 서고, 칸 위 변 위로 16px 솟는다
FULL = dict(h=36, cap=["O", "L", "L", "M"], cap_y=0,
            front=(["O"] + ["q"] * 9 + ["L", "M"] + ["q"] * 13 + ["M", "D", "M", "O"]),
            strip="OLLMMO", sx=5, end_pad=1)
HALF_DOTS = {(3, 1), (11, 1), (7, 3)}           # (x % 16, 앞면 행) → 반대 톤 점
FULL_DOTS = {(3, 3), (11, 6), (6, 14), (13, 18), (2, 21)}


def fabric(spec, x, fi):
    ch = spec["front"][fi]
    dots = HALF_DOTS if spec is HALF else FULL_DOTS
    if ch == "C" and (x % 16, fi) in dots:
        return "c"
    if ch == "q" and (x % 16, fi) in dots:
        return "Q"
    return ch


def partition(spec, conn):
    N, E, S, W = ("n" in conn), ("e" in conn), ("s" in conn), ("w" in conn)
    g = Grid(16, spec["h"])
    cy = spec["cap_y"]
    ncap = len(spec["cap"])
    fy = cy + ncap                       # 앞면 첫 행
    fend = fy + len(spec["front"])       # 앞면 끝(배타)
    sx, sw = spec["sx"], len(spec["strip"])
    sx1 = sx + sw - 1
    vert = N or S
    horiz = E or W or not vert
    if horiz:
        x0 = 0 if W else (sx if vert else spec["end_pad"])
        x1 = 15 if E else (sx1 if vert else 15 - spec["end_pad"])
        for x in range(x0, x1 + 1):
            for i, ch in enumerate(spec["cap"]):
                g.set(x, cy + i, ch)
            for i in range(len(spec["front"])):
                g.set(x, fy + i, fabric(spec, x, i))
        for y in range(cy, fend):
            if not W:
                g.set(x0, y, "O")
            if not E:
                g.set(x1, y, "O")
    if vert:
        top = 0
        if horiz:
            # 위쪽 띠(N), 교차부, 아래쪽 띠(S)
            if N:
                for y in range(0, cy):
                    g.put(sx, y, spec["strip"])
            for y in range(cy, fy):
                if y == cy and not N:
                    continue
                for i in range(1, sw - 1):
                    g.set(sx + i, y, spec["strip"][i])
            if S:
                for y in range(fy, spec["h"]):
                    g.put(sx, y, spec["strip"])
        else:
            bottom = spec["h"] if S else fy
            for y in range(top, bottom):
                g.put(sx, y, spec["strip"])
            if not N:
                g.put(sx, 0, "O" * sw)
            if not S:  # 남쪽 끝 마구리(앞면)
                for i in range(len(spec["front"])):
                    for x in range(sx, sx1 + 1):
                        g.set(x, fy + i, fabric(spec, x, i))
                    if spec["front"][i] != "O":
                        g.set(sx, fy + i, "O")
                        g.set(sx1, fy + i, "O")
    return g.rows()


CONNS = ["o", "n", "e", "s", "w", "ne", "ns", "nw", "es", "ew", "sw",
         "nes", "new", "nsw", "esw", "nesw"]


# ------------------------------------------------------------------ 16x16 바닥·벽


def tile_floor(fn):
    g = Grid(16, 16)
    for y in range(16):
        for x in range(16):
            g.set(x, y, fn(x, y))
    return g.rows()


def floor_print(x, y):
    if y % 8 == 7 or x % 8 == 7:
        return "L"
    if (x, y) in {(2, 3), (11, 10), (4, 12)}:
        return "M"
    return "q"


def floor_print_mark(x, y):
    base = floor_print(x, y)
    edge = (y in (1, 14) and 1 <= x <= 14) or (x in (1, 14) and 1 <= y <= 14)
    if edge and ((x + y) // 2) % 2 == 0:
        return "Y"
    return base


def floor_team2(x, y):
    qx, qy = x // 8, y // 8
    lx, ly = x % 8, y % 8
    if (qx + qy) % 2 == 0:
        if ly == 3 and x % 2 == 0:
            return "q"
    elif lx == 3 and y % 2 == 0:
        return "q"
    return "Q"


def floor_team2_b(x, y):
    return "q" if (x, y) in {(0, 0), (8, 8), (12, 13), (11, 14)} else "Q"


def floor_lounge(x, y):
    qx, qy = x // 8, y // 8
    lx, ly = x % 8, y % 8
    if (qx + qy) % 2 == 0:
        return "T" if ly in (3, 7) else "f"
    return "T" if lx in (3, 7) else "f"


def floor_cafe(x, y):
    if y == 15 or x == 15:
        return "L"
    chips = {(2, 3): "T", (3, 3): "T", (9, 1): "C", (12, 6): "M", (5, 9): "L",
             (6, 9): "L", (10, 12): "T", (2, 12): "C", (13, 13): "L", (8, 5): "L"}
    return chips.get((x, y), "W")


def floor_hall_a(x, y):
    if y == 15 or x == 15:
        return "f"
    if (x, y) in {(2, 2), (3, 2), (2, 3)}:
        return "W"
    return "F"


def floor_hall_b_v(x, y):
    col = "FFFfLMMMMMMLfFFF"[x]
    if col == "M" and (x, y) in {(7, 4), (8, 12)}:
        return "D"
    return col


def floor_hall_b_h(x, y):
    return floor_hall_b_v(y, x)


def stairs(x, y):
    step = y // 4
    tread = ["D", "M", "L", "W"][step]
    riser = ["O", "D", "M", "L"][step]
    if x == 0:
        return "O"
    if x == 1:
        return "W"
    if x == 2:
        return "M"
    if x == 3:
        return "O"
    return riser if y % 4 == 3 else tread


WALL_BASE = ["qqqqqqqqqqqqqqqq", "qqqqqqqqqqqqqqqq", "OOOOOOOOOOOOOOOO",
             "MMMMMMMMMMMMMMMM", "OOOOOOOOOOOOOOOO"]


def wall(rows_1_10):
    """벽 앞면: 0행 흰 모서리 + 1~10행 내용 + 11~15행 공통(그늘·걸레받이)."""
    return ["WWWWWWWWWWWWWWWW"] + rows_1_10 + WALL_BASE


TILE2 = {
    "floor_print": tile_floor(floor_print),
    "floor_print_mark": tile_floor(floor_print_mark),
    "floor_team2": tile_floor(floor_team2),
    "floor_team2_b": tile_floor(floor_team2_b),
    "floor_lounge": tile_floor(floor_lounge),
    "floor_cafe": tile_floor(floor_cafe),
    "floor_hall_a": tile_floor(floor_hall_a),
    "floor_hall_b_v": tile_floor(floor_hall_b_v),
    "floor_hall_b_h": tile_floor(floor_hall_b_h),
    "floor_stairs_l": tile_floor(stairs),
    "wall_blind": wall([
        "QOOOOOOOOOOOOOOQ",
        "QOWWWWWWWWWWWWOQ",
        "QOLLLLLLLLLLLLOQ",
        "QOWWWWWWWWWWWWOQ",
        "QOLLLLLLLLLDLLOQ",
        "QOWWWWWWWWWDWWOQ",
        "QOLLLLLLLLLDLLOQ",
        "QOWWWWWWWWWMWWOQ",
        "QOOOOOOOOOOOOOOQ",
        "QQqqqqqqqqqqqqQQ"]),
    "wall_blind_up": wall([
        "QOOOOOOOOOOOOOOQ",
        "QOWWWWWWWWWWWWOQ",
        "QOLLLLLLLLLLLLOQ",
        "QOMMMMMMMMMDMMOQ",
        "QOCCCWCCCCCDCCOQ",
        "QOCCWCCCCCCMCCOQ",
        "QOCCCCCCCWCCCCOQ",
        "QOccccccWccccCOQ",
        "QOOOOOOOOOOOOOOQ",
        "QQqqqqqqqqqqqqQQ"]),
    "wall_print_sign": wall([
        "QQQQQQQQQQQQQQQQ",
        "QQQOOOOOOOOOOQQQ",
        "QQQOWWOOOOWWOqQQ",
        "QQQOWWOWWOWWOqQQ",
        "QQQOWODDDDOWOqQQ",
        "QQQOWODMMDOWOqQQ",
        "QQQOWODDDDOWOqQQ",
        "QQQOWWOOOOWWOqQQ",
        "QQQOOOOOOOOOOqQQ",
        "QQQQqqqqqqqqqqQQ"]),
    "wall_cafe_menu": wall([
        "QOOOOOOOOOOOOOOQ",
        "QOTDDDDDDDDDDTOQ",
        "QOTDWWWDLLLLDTOQ",
        "QOTDWWWWDDDDDTOQ",
        "QOTDWWWDLLLDDTOQ",
        "QOTDDDDDDDDDDTOQ",
        "QOTDLLDLLLLDDTOQ",
        "QOTDDDDDDDDDDTOQ",
        "QOOOOOOOOOOOOOOQ",
        "QQqqqqqqqqqqqqQQ"]),
    "wall_lounge": ["WWWWWWWWWWWWWWWW",
                    "QQQQQQQQQQQQQQQQ",
                    "QQQQqQQQQQQQQQQQ",
                    "QQQQQQQQQQQQQQQQ",
                    "QQQQQQQQQQQqQQQQ",
                    "QQQQQQQQQQQQQQQQ",
                    "OOOOOOOOOOOOOOOO",
                    "TTTTTTTTTTTTTTTT",
                    "TTTtTTTtTTTtTTTt",
                    "TTTtTTTtTTTtTTTt",
                    "TTTtTTTtTTTtTTTt",
                    "TTTtTTTtTTTtTTTt",
                    "tttttttttttttttt",
                    "OOOOOOOOOOOOOOOO",
                    "MMMMMMMMMMMMMMMM",
                    "OOOOOOOOOOOOOOOO"],
    "wall_lounge_art": ["WWWWWWWWWWWWWWWW",
                        "QQQQOOOOOOOQQQQQ",
                        "QQQQOCCCYYOqQQQQ",
                        "QQQQOCGCCCOqQQQQ",
                        "QQQQOGGGGGOqQQQQ",
                        "QQQQOOOOOOOqQQQQ",
                        "OOOOOOOOOOOOOOOO",
                        "TTTTTTTTTTTTTTTT",
                        "TTTtTTTtTTTtTTTt",
                        "TTTtTTTtTTTtTTTt",
                        "TTTtTTTtTTTtTTTt",
                        "TTTtTTTtTTTtTTTt",
                        "tttttttttttttttt",
                        "OOOOOOOOOOOOOOOO",
                        "MMMMMMMMMMMMMMMM",
                        "OOOOOOOOOOOOOOOO"],
    "wall_team2": wall([
        "QOOOOOOOOOOOOOOQ",
        "QOTTTTTTTTTTTTOQ",
        "QOTWWTTYYTTCCTOQ",
        "QOTWWTTYYTTCCTOQ",
        "QOTTTTTTTTTTTTOQ",
        "QOTTGGTTWWTTTTOQ",
        "QOTTGGTTWWTTtTOQ",
        "QOttttttttttttOQ",
        "QOOOOOOOOOOOOOOQ",
        "QQqqqqqqqqqqqqQQ"]),
    "wall_books": ["WWWWWWWWWWWWWWWW",
                   "OOOOOOOOOOOOOOOO",
                   "CCOGGOYOWWOBBOLL",
                   "CCOGGOYOWWOBBOLL",
                   "CCOGGOYOWWOBBOLL",
                   "ccOggOTOLLObbOMM",
                   "TTTTTTTTTTTTTTTT",
                   "OOOOOOOOOOOOOOOO",
                   "WOBBOCCCOTTOGOYY",
                   "WOBBOCCCOTTOGOYY",
                   "LObbOcccOttOgOTT",
                   "TTTTTTTTTTTTTTTT",
                   "tttttttttttttttt",
                   "OOOOOOOOOOOOOOOO",
                   "MMMMMMMMMMMMMMMM",
                   "OOOOOOOOOOOOOOOO"],
    "wall_rack": ["WWWWWWWWWWWWWWWW",
                  "MMMMMMMMMMMMMMMM",
                  "MQOOOOOOQOOOOOQM",
                  "MQOTTTTOQOWWWOQM",
                  "MQOTLLTOQOWWWOQM",
                  "MQOttttOQOLLLOQM",
                  "MMMMMMMMMMMMMMMM",
                  "MQOOOOOOOQQOOOQM",
                  "MQOTTTTTOQQOTOQM",
                  "MQOTTLTTOQQOTOQM",
                  "MQOtttttOQQOtOQM",
                  "MMMMMMMMMMMMMMMM",
                  "qqqqqqqqqqqqqqqq",
                  "OOOOOOOOOOOOOOOO",
                  "MMMMMMMMMMMMMMMM",
                  "OOOOOOOOOOOOOOOO"],
    "wall_stairs": ["WWWWWWWWWWWWWWWW",
                    "QQQQQOOOOOOQQQQQ",
                    "QQQQQOGGGWOqQQQQ",
                    "QQQQQOGGWWOqQQQQ",
                    "QQQQQOGWWWOqQQQQ",
                    "QQOOOOOOOOOOOOQQ",
                    "QQOMLLLLLLLLMOQQ",
                    "QQOMLOOOOLLLMOQQ",
                    "QQOMLOCWOLLLMOQQ",
                    "QQOMLOCCOLLLMOQQ",
                    "QQOMLOOOOLDDMOQQ",
                    "qqOMLLLLLLLLMOqq",
                    "qqOMMMMMMMMMMOqq",
                    "OOOOOOOOOOOOOOOO",
                    "MMOMMMMMMMMMMOMM",
                    "OOOOOOOOOOOOOOOO"],
    "wall_exit_sign_l": wall([
        "QQQQQQQQQQQQQQQQ",
        "QQOOOOOOOOOOOOQQ",
        "QQOGGWGGGGGGGOqQ",
        "QQOGWWWWWWWWGOqQ",
        "QQOGGWGGGGGGGOqQ",
        "QQOggggggggggOqQ",
        "QQOOOOOOOOOOOOqQ",
        "QQQqqqqqqqqqqqQQ",
        "QQQQQQQQQQQQQQQQ",
        "QQQQQQQQQqQQQQQQ"]),
    "wall_door_busy": ["WWWWWWWWWWWWWWWW",
                       "QOOOOOOYYOOOOOOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "QOLLOOOOOOOOLLOQ",
                       "QOLLOYYYYYYOLLOQ",
                       "QOLLOYDYDDYOLLOQ",
                       "QOLLOYYYYYYOLLOQ",
                       "QOLLOOOOOOOOLLOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "QOLLLLLLLLLDDLOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "qOLLLLLLLLLLLLOq",
                       "qOMMMMMMMMMMMMOq",
                       "OOOOOOOOOOOOOOOO",
                       "MOLLLLLLLLLLLLOM",
                       "OOOOOOOOOOOOOOOO"],
    "wall_door_free": ["WWWWWWWWWWWWWWWW",
                       "QOOOOOOGGOOOOOOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "QOLLLOOOOOOLLLOQ",
                       "QOLLLOWWWWOLLLOQ",
                       "QOLLLOOOOOOLLLOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "QOLLLLLLLLLDDLOQ",
                       "QOLLLLLLLLLLLLOQ",
                       "qOLLLLLLLLLLLLOq",
                       "qOMMMMMMMMMMMMOq",
                       "OOOOOOOOOOOOOOOO",
                       "MOLLLLLLLLLLLLOM",
                       "OOOOOOOOOOOOOOOO"],
}

# ------------------------------------------------------------------ 16x16 소품(원점 하단 중앙)

A_FRAME = ["................",
           "................",
           "......OOOO......",
           ".....OYYYYO.....",
           ".....OYYYYO.....",
           "....OYYYYYYO....",
           "....OYYYYYYO....",
           "....OYYYYYYO....",
           "...OYYYYYYYTO...",
           "...OYYYYYYYTO...",
           "...OYYYYYYYTO...",
           "..OYYYYYYYYYTO..",
           "..OOOOOOOOOOOO..",
           "..OM........MO..",
           ".OOM........MOO.",
           ".OOO........OOO."]


def sign_wet():
    g = Grid(16, 16)
    g.put(0, 0, A_FRAME)
    g.put(0, 0, ["", "", "", "", "........D", ".......DDD", ".......DDD", "",
                 "....D..D..D", ".....DD.DD.D", "", "....TT.TT.TT"])
    return g.rows()


def sign_work():
    g = Grid(16, 16)
    g.put(0, 0, A_FRAME)
    for y in range(3, 12):
        for x in range(16):
            if g.c[y][x] == "Y" and (x + y) % 4 in (0, 1):
                g.set(x, y, "D")
    return g.rows()


FURN2 = {
    "sign_wet": sign_wet(),
    "sign_work": sign_work(),
    "cone": ["................",
             "................",
             "................",
             "................",
             ".......OO.......",
             "......OYYO......",
             "......OYTO......",
             ".....OWWWWO.....",
             ".....OWWWTO.....",
             ".....OYYYTO.....",
             "....OYYYYYTO....",
             "....OWWWWWWO....",
             "...OYYYYYYYTO...",
             "..OOOOOOOOOOOO..",
             "..ODDDDDDDDDDO..",
             "..OOOOOOOOOOOO.."],
    "barrier": ["................",
                "................",
                "................",
                "................",
                "................",
                "OOOOOOOOOOOOOOOO",
                "YYDDYYDDYYDDYYDD",
                "YDDYYDDYYDDYYDDY",
                "OOOOOOOOOOOOOOOO",
                ".OMO........OMO.",
                ".OMO........OMO.",
                ".OMO........OMO.",
                ".OMO........OMO.",
                "OOMOO......OOMOO",
                "OMMMO......OMMMO",
                "OOOOO......OOOOO"],
    "box_low": ["................",
                "................",
                "................",
                "................",
                "....OOOOOOO.....",
                "....OTTLTTO.....",
                "....OTTLTTO.....",
                "....OOOOOOO.....",
                "....OttLttO.....",
                ".OOOOOOOOOOOOOO.",
                ".OTTTLTTOTTLTTO.",
                ".OTTTLTTOTTLTTO.",
                ".OOOOOOOOOOOOOO.",
                ".OtttLttOttLttO.",
                ".OttttttOtttttO.",
                ".OOOOOOOOOOOOOO."],
    "cabinet_low": ["................",
                    "................",
                    "................",
                    "................",
                    ".OOOOOOOOOOOOOO.",
                    ".OWWWWWWWWWWWWO.",
                    ".OLLLLLLLLLLLLO.",
                    ".OOOOOOOOOOOOOO.",
                    ".OLLLLLLLLLLLMO.",
                    ".OLLLLOOOOLLLMO.",
                    ".OMMMMMMMMMMMMO.",
                    ".OLLLLLLLLLLLMO.",
                    ".OLLLLOOOOLLLMO.",
                    ".OMMMMMMMMMMMMO.",
                    ".OOOOOOOOOOOOOO.",
                    "..OO........OO.."],
    "plant_small": ["................",
                    "................",
                    "................",
                    "................",
                    "................",
                    "................",
                    "......OOOO......",
                    "....OOGGGGOO....",
                    "...OGGgGGGGGO...",
                    "...OGGGGGgGGO...",
                    "....OgGGGGgO....",
                    ".....OWWWWO.....",
                    ".....OLLLMO.....",
                    ".....OLLLMO.....",
                    "......OLMO......",
                    "......OOOO......"],
    "lounge_table": ["................",
                     "................",
                     "................",
                     "................",
                     "................",
                     "................",
                     "................",
                     "..OOOOOOOOOOOO..",
                     ".OTTTTTTTTTTTTO.",
                     ".OTOOOOTTTOOTTO.",
                     ".OTOCCOTTTOWOTO.",
                     ".OTOWWOTTTOOOTO.",
                     ".OTOOOOTTTTTTTO.",
                     ".OttttttttttttO.",
                     ".OOOOOOOOOOOOOO.",
                     "..OO........OO.."],
    "cafe_table": ["................",
                   "................",
                   "................",
                   "................",
                   "....OOOOOOOO....",
                   "..OOTTTTTTTTOO..",
                   ".OTTWWTTTTWWTTO.",
                   ".OTTOOTTTTOOTTO.",
                   ".OtTTTTTTTTTTtO.",
                   "..OOttttttttOO..",
                   "....OOOOOOOO....",
                   ".......OO.......",
                   ".......OM.......",
                   ".......OM.......",
                   ".....OMMMMO.....",
                   ".....OOOOOO....."],
    "paper_box": ["................",
                  "................",
                  "................",
                  "................",
                  "................",
                  "....OOOOOOOO....",
                  "....OWWWWWWO....",
                  "....OCCCCCCO....",
                  "....OWWWWWWO....",
                  "...OOOOOOOOOO...",
                  "...OWWWWWWWWO...",
                  "...OLLLLLLLLO...",
                  "..OOOOOOOOOOOO..",
                  "..OTTTTLTTTTTO..",
                  "..OttttLtttttO..",
                  "..OOOOOOOOOOOO.."],
    "exit_hang_l": ["....O......O....",
                    "....O......O....",
                    ".OOOOOOOOOOOOOO.",
                    ".OGGGWGGGGGGGGO.",
                    ".OGGWWWWWWWWGGO.",
                    ".OGGGWGGGGGGGGO.",
                    ".OggggggggggggO.",
                    ".OOOOOOOOOOOOOO.",
                    "................",
                    "................",
                    "................",
                    "................",
                    "................",
                    "................",
                    "................",
                    "................"],
}

DESK = ["..OOOOOOOOOOOO..",
        "..ODDDDDDDDDDO..",
        "..ODGGGGGGGGDO..",
        "..ODWMWWMWWWDO..",
        "..ODMMMMMMMMDO..",
        "..ODWMWGMWWWDO..",
        "OOODDDDDDDDDDOOO",
        "OWWOOOODDOOOOWWO",
        "OWLLLLODDOLLLLLO",
        "OLLLLOOOOOOLLLLO",
        "OLLLLLLLLLLLLLLO",
        "OLLLOOOOOOOOLLLO",
        "OLLLOWWWWWWOLLLO",
        "OOOOOOOOOOOOOOOO",
        "OMMMMMMMMMMMMMMO",
        "OOOOOOOOOOOOOOOO"]


def desk_row(left_edge, right_edge):
    rows = [list(r) for r in DESK]
    for y in range(7, 13):
        fill = "W" if y == 7 else "L"
        if not left_edge:
            rows[y][0] = fill
        if not right_edge:
            rows[y][15] = fill
    if not left_edge:
        rows[14][0] = "M"
    if not right_edge:
        rows[14][15] = "M"
    return ["".join(r) for r in rows]


FURN2["desk_row_l"] = desk_row(True, False)
FURN2["desk_row_m"] = desk_row(False, False)
FURN2["desk_row_r"] = desk_row(False, True)

# ------------------------------------------------------------------ 16x24


def cabinet(open_drawer=False):
    g = Grid(16, 24)
    g.box(1, 2, 14, 4, "W")
    g.rect(2, 4, 12, 1, "L")
    g.box(1, 5, 14, 17, "L")
    for i, y in enumerate((6, 10, 14, 18)):
        g.rect(2, y + 3, 12, 1, "M")
        g.put(6, y + 1, "OOOO")
        g.rect(13, y, 1, 3, "M")
        if i == 0:
            g.put(5, y, "WWWWWW")
    g.put(3, 22, "OO")
    g.put(11, 22, "OO")
    if open_drawer:
        # 둘째 서랍을 앞(남쪽)으로 뺀 모습: 서류철 윗면 + 서랍 앞판
        g.box(1, 10, 14, 6, "D")
        g.put(2, 11, "CCYYGGWWCCYY")
        g.put(2, 12, "cCTYgGLWcCTY")
        g.box(1, 14, 14, 5, "L")
        g.rect(2, 17, 12, 1, "M")
        g.put(6, 15, "OOOO")
    return g.rows()


TALL2 = {
    "pillar": ["OOOOOOOOOOOOOOOO",
               "ODDDDDDDDDDDDDDO",
               "ODDDDDDDDDDDDDDO",
               "ODDDDDDDDDDDDDDO",
               "ODDDDDDDDDDDDDDO",
               "OMMMMMMMMMMMMMMO",
               "OLLLLLLLLLLLLLLO",
               "OOOOOOOOOOOOOOOO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQqQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWQQQQQQQQQQqqqO",
               "OWqqqqqqqqqqqqqO",
               "OWqqqqqqqqqqqqqO",
               "OOOOOOOOOOOOOOOO",
               "OMMMMMMMMMMMMMMO",
               "OOOOOOOOOOOOOOOO"],
    "cabinet": cabinet(False),
    "cabinet_open": cabinet(True),
    "vending_drink": [".OOOOOOOOOOOOOO.",
                      ".OLLLLLLLLLLLLO.",
                      ".OOOOOOOOOOOOOO.",
                      ".OWWWWWWWWWWWWO.",
                      ".OWOOOOOOOOWMWO.",
                      ".OWOCcGgYTOWCWO.",
                      ".OWOCcGgYTOWWWO.",
                      ".OWOOOOOOOOWDWO.",
                      ".OWOWLCcWLOWWWO.",
                      ".OWOWLCcWLOWYWO.",
                      ".OWOOOOOOOOWGWO.",
                      ".OWOGgWLCcOWWWO.",
                      ".OWOGgWLCcOWWWO.",
                      ".OWOOOOOOOOWWWO.",
                      ".OWWWWWWWWWWWWO.",
                      ".OWWWWWWWWWWWWO.",
                      ".OWODDDDDDDOWWO.",
                      ".OWODDDDDDDOWWO.",
                      ".OWOOOOOOOOOWWO.",
                      ".OLLLLLLLLLLLLO.",
                      ".OMMMMMMMMMMMMO.",
                      ".OOOOOOOOOOOOOO.",
                      "..OO........OO..",
                      "................"],
    "vending_snack": [".OOOOOOOOOOOOOO.",
                      ".OMMMMMMMMMMMMO.",
                      ".OOOOOOOOOOOOOO.",
                      ".ODDDDDDDDDDDDO.",
                      ".ODOOOOOOOODMDO.",
                      ".ODOYYTTGGODCDO.",
                      ".ODOYTTtGgODDDO.",
                      ".ODOMLMLMLODWDO.",
                      ".ODOWWCCYYODDDO.",
                      ".ODOWLCcYTODYDO.",
                      ".ODOMLMLMLODGDO.",
                      ".ODOGGWWTTODDDO.",
                      ".ODOGgWLTtODDDO.",
                      ".ODOMLMLMLODDDO.",
                      ".ODOOOOOOOODDDO.",
                      ".ODDDDDDDDDDDDO.",
                      ".ODOMMMMMMMODDO.",
                      ".ODOMMMMMMMODDO.",
                      ".ODOOOOOOOOODDO.",
                      ".ODDDDDDDDDDDDO.",
                      ".OMMMMMMMMMMMMO.",
                      ".OOOOOOOOOOOOOO.",
                      "..OO........OO..",
                      "................"],
    "purifier": ["................",
                 "................",
                 "....OOOOOOOO....",
                 "....OWWWWWWO....",
                 "....OLLLLLLO....",
                 "....OOOOOOOO....",
                 "....OWCWWYWO....",
                 "....OWWWWWLO....",
                 "....OWOOOOLO....",
                 "....OWODMOLO....",
                 "....OWODDOLO....",
                 "....OWOMMOLO....",
                 "....OWOOOOLO....",
                 "....OWWWWWLO....",
                 "....OWWWWWLO....",
                 "....OWWWWWLO....",
                 "....OWWWWWLO....",
                 "....OWWWWWLO....",
                 "....OWWWWWLO....",
                 "....OWWWWWLO....",
                 "....OLLLLLLO....",
                 "....OMMMMMMO....",
                 "....OOOOOOOO....",
                 "................"],
    "box_stack": ["................",
                  "....OOOOOOOO....",
                  "....OTTTLTTO....",
                  "....OTTTLTTO....",
                  "....OOOOOOOO....",
                  "....OtttLttO....",
                  "....OtttLttO....",
                  "..OOOOOOOOOOOO..",
                  "..OTTTTTLTTTTO..",
                  "..OOOOOOOOOOOO..",
                  "..OtttttLttttO..",
                  "..OtttttLttttO..",
                  "..OttttttttttO..",
                  ".OOOOOOOOOOOOOO.",
                  ".OTTTTTTLTTTTTO.",
                  ".OTTTTTTLTTTTTO.",
                  ".OOOOOOOOOOOOOO.",
                  ".OttttttLtttttO.",
                  ".OttttttLtttttO.",
                  ".OttWWttLtttttO.",
                  ".OttttttLtttttO.",
                  ".OttttttttttttO.",
                  ".OOOOOOOOOOOOOO.",
                  "................"],
}


def glass_door_busy():
    tall = json.load(open(os.path.join(SPR, "furn-tall.json"), encoding="utf-8"))
    rows = [f for f in tall["frames"] if f["name"] == "glass_door"][0]["rows"]
    g = Grid(16, 24)
    g.put(0, 0, rows, skip="")
    g.put(3, 6, ["OOOOOOOOOO", "OYYDYDDYYO", "OOOOOOOOOO"])
    g.put(6, 5, "O..O")
    return g.rows()


TALL2["glass_door_busy"] = glass_door_busy()

# ------------------------------------------------------------------ 32x16


def sofa_lounge():
    g = Grid(32, 16)
    g.box(4, 2, 24, 9, "D")
    g.rect(5, 3, 22, 1, "M")
    g.box(7, 4, 7, 5, "C")
    g.rect(8, 7, 5, 1, "c")
    g.box(18, 4, 7, 5, "C")
    g.rect(19, 7, 5, 1, "c")
    g.box(4, 9, 24, 4, "M")
    g.rect(5, 10, 22, 1, "L")
    g.rect(15, 10, 1, 2, "D")
    g.box(4, 12, 24, 3, "D")
    for x0 in (1, 26):
        g.box(x0, 5, 5, 10, "M")
        g.rect(x0 + 1, 6, 3, 1, "L")
        g.rect(x0 + 1, 12, 3, 2, "D")
    g.put(3, 15, "OO")
    g.put(27, 15, "OO")
    return g.rows()


def lounge_table_w():
    g = Grid(32, 16)
    g.box(2, 6, 28, 7, "T")
    g.box(2, 12, 28, 3, "t")
    g.box(5, 7, 7, 4, "C")
    g.put(6, 8, "WWWW")
    g.put(9, 9, "LL")
    g.box(19, 7, 3, 3, "W")
    g.set(20, 8, "t")
    g.box(24, 8, 3, 3, "W")
    g.set(25, 9, "t")
    g.put(4, 15, "OO")
    g.put(26, 15, "OO")
    return g.rows()


WIDE2 = {"sofa_lounge": sofa_lounge(), "lounge_table": lounge_table_w()}

# ------------------------------------------------------------------ 32x24


def mfp():
    g = Grid(32, 24)
    g.box(1, 6, 30, 17, "L")            # 본체 앞면
    g.box(1, 6, 30, 5, "W")             # 본체 윗면(출력 트레이)
    g.rect(4, 8, 10, 1, "L")
    g.rect(28, 11, 2, 11, "M")          # 오른쪽 그늘
    for y in (14, 18):
        g.rect(2, y, 26, 1, "M")
    for y in (12, 16, 20):
        g.put(13, y, "OOOOOO")
    g.box(3, 1, 18, 7, "M")             # 스캐너 덮개
    g.rect(4, 2, 16, 1, "L")
    g.put(16, 5, "DD")
    g.box(20, 2, 10, 6, "D")            # 조작부
    g.box(21, 3, 5, 3, "C")
    g.set(22, 4, "W")
    g.set(27, 3, "G")
    g.set(27, 5, "Y")
    g.rect(2, 22, 28, 1, "O")
    g.put(3, 23, "OO")
    g.put(27, 23, "OO")
    # 나오는 종이
    g.put(5, 9, "OWWWWWO")
    return g.rows()


def locker():
    g = Grid(32, 24)
    g.box(0, 0, 32, 4, "M")
    g.rect(1, 1, 30, 1, "L")
    g.box(0, 3, 32, 20, "L")
    leds = "GYGGGGYGGGGG"
    k = 0
    for row, y in enumerate((4, 10, 16)):
        for col, x in enumerate((1, 8, 17, 24)):
            if row == 0 and col == 1:
                g.box(x, y, 7, 6, "D")
                g.box(x + 1, y + 1, 5, 3, "C")
                g.set(x + 2, y + 2, "W")
                continue
            g.box(x, y, 7, 6, "W")
            g.rect(x + 5, y + 2, 1, 2, "M")
            g.set(x + 1, y + 1, leds[k])
            k += 1
    g.rect(15, 4, 2, 18, "M")
    g.rect(1, 22, 30, 1, "O")
    g.put(2, 23, "OO")
    g.put(28, 23, "OO")
    return g.rows()


def plant_group():
    tall = json.load(open(os.path.join(SPR, "furn-tall.json"), encoding="utf-8"))
    rows = [f for f in tall["frames"] if f["name"] == "plant"][0]["rows"]
    leaf = rows[1:15]
    g = Grid(32, 24)
    g.put(14, 1, leaf)
    g.put(1, 4, leaf)
    g.box(1, 16, 30, 7, "T")
    g.rect(2, 17, 28, 1, "t")
    g.rect(2, 21, 28, 1, "t")
    g.put(9, 18, "OYYO")
    g.put(10, 19, "OO")
    return g.rows()


def cafe_counter():
    g = Grid(32, 24)
    g.box(0, 10, 32, 13, "T")           # 카운터 앞면
    for x in (8, 16, 24):
        g.rect(x, 14, 1, 8, "t")
    g.box(0, 9, 32, 5, "W")             # 흰 상판
    g.rect(1, 12, 30, 1, "L")
    g.box(2, 1, 12, 10, "M")            # 커피머신
    g.rect(3, 2, 10, 1, "L")
    g.box(4, 4, 8, 4, "D")
    g.put(5, 5, "OMO..OMO")
    g.put(5, 6, ".W....W.")
    g.set(11, 2, "C")
    g.set(10, 2, "G")
    g.box(21, 4, 4, 6, "W")              # 컵 쌓음
    g.rect(22, 5, 2, 1, "L")
    g.rect(22, 7, 2, 1, "L")
    g.box(26, 6, 4, 4, "W")              # 머그
    g.set(27, 7, "t")
    g.rect(1, 22, 30, 1, "O")
    g.put(2, 23, "OO")
    g.put(28, 23, "OO")
    return g.rows()


def box_pile():
    g = Grid(32, 24)
    g.box(18, 2, 12, 8, "T")
    g.rect(19, 3, 10, 1, "T")
    g.rect(23, 2, 2, 8, "L")
    g.rect(19, 6, 10, 3, "t")
    g.box(2, 6, 14, 9, "T")
    g.rect(8, 6, 2, 9, "L")
    g.rect(3, 10, 12, 4, "t")
    g.box(1, 13, 16, 10, "T")
    g.rect(8, 13, 2, 10, "L")
    g.rect(2, 17, 14, 5, "t")
    g.box(15, 9, 16, 14, "T")
    g.rect(22, 9, 2, 14, "L")
    g.rect(16, 13, 14, 9, "t")
    g.put(18, 16, "WWW")
    g.put(4, 19, "WW")
    return g.rows()


WIDE24 = {"mfp": mfp(), "locker": locker(), "plant_group": plant_group(),
          "cafe_counter": cafe_counter(), "box_pile": box_pile()}

# ------------------------------------------------------------------ 책상 섬·큐비클

MON_FRONT = ["OOOOOOOOOO",
             "ODDDDDDDDO",
             "ODGGGGGGDO",
             "ODWMWWMWDO",
             "ODMMMMMMDO",
             "ODWMWGMWDO",
             "OOOODDOOOO",
             "...OOOO..."]
MON_BACK = [".OOOOOOOO.",
            "OMMMMMMMMO",
            "OMDDDDDDDO",
            "OMDDDDDDDO",
            "OMDDDDDDDO",
            "OOOOOOOOOO",
            "....OMO...",
            "...OOOOO.."]


def island(n):
    w = 16 * n
    g = Grid(w, 32)
    g.box(0, 9, w, 19, "L")
    g.rect(1, 10, w - 2, 1, "W")
    for k in range(1, n):
        g.rect(16 * k, 10, 1, 17, "M")
    g.box(0, 27, w, 4, "M")
    for x in [1, w - 3] + [16 * k - 1 for k in range(1, n)]:
        g.put(x, 31, "OO")
    for k in range(n):
        g.put(16 * k + 3, 6, MON_BACK)
    g.rect(1, 16, w - 2, 1, "O")
    g.rect(1, 17, w - 2, 1, "L")
    g.rect(1, 18, w - 2, 1, "C")
    g.rect(1, 19, w - 2, 1, "O")
    g.put(0, 16, ["O", "O", "O", "O"])
    g.put(w - 1, 16, ["O", "O", "O", "O"])
    for k in range(n):
        x = 16 * k
        g.put(x + 3, 13, MON_FRONT)
        g.put(x + 5, 22, ["OOOOOO", "OWWWWO", "OOOOOO"])
        if k % 2 == 0:
            g.put(x + 12, 21, ["OOO", "OCO", "OOO"])
        else:
            g.put(x + 12, 21, ["OOOO", "OWWO", "OWMO", "OOOO"])
    return g.rows()


def cubicle(spec, w=32):
    full = spec is FULL
    h = 52 if full else 32
    g = Grid(w, h)
    cy = spec["cap_y"]
    ncap = len(spec["cap"])
    fy = cy + ncap
    nf = len(spec["front"])
    sw = 6 if full else 4
    # 뒤(북쪽) 칸막이
    for x in range(w):
        for i, ch in enumerate(spec["cap"]):
            g.set(x, cy + i, ch)
        for i in range(nf):
            g.set(x, fy + i, fabric(spec, x, i))
    base = fy + nf                       # 뒤 칸막이 바로 아래 행
    # 책상
    g.box(sw, base - 1, w - 2 * sw, 10, "L")
    g.rect(sw + 1, base, w - 2 * sw - 2, 1, "W")
    g.box(sw, base + 8, w - 2 * sw, 3, "M")
    mx = (w - 10) // 2
    g.put(mx, base - 6, MON_FRONT)
    g.put(mx + 2, base + 3, ["OOOOOO", "OWWWWO", "OOOOOO"])
    g.put(sw + 2, base + 2, ["OOO", "OCO", "OOO"])
    g.put(w - sw - 6, base + 2, ["OOOO", "OWWO", "OWMO", "OOOO"])
    # 양옆 칸막이(세로 띠 + 남쪽 끝 마구리)
    end_bottom = h - (4 if full else 0)          # 마구리 아래 변(배타)
    end_top = end_bottom - nf
    strip = spec["strip"]
    for sx in (0, w - sw):
        for y in range(cy, end_top):
            if y < fy:
                g.put(sx, y, strip if y > cy else "O" * sw)
            else:
                g.put(sx, y, strip)
        for i in range(nf):
            for x in range(sx, sx + sw):
                g.set(x, end_top + i, fabric(spec, x, i))
            if spec["front"][i] != "O":
                g.set(sx, end_top + i, "O")
                g.set(sx + sw - 1, end_top + i, "O")
    # 바깥 모서리 외곽선
    for y in range(cy, fy + nf):
        g.set(0, y, "O")
        g.set(w - 1, y, "O")
    return g.rows()


# ------------------------------------------------------------------ 팀장 프레임

TEAMLEAD_FRAMES = [
    {"name": "sit_up", "from": "idle_up", "bob": [2, 16]},
    {"name": "rise_up_0", "from": "idle_up", "bob": [1, 16]},
    {"name": "rise_up_1", "from": "idle_up"},
    {"name": "sit_down", "from": "idle_down", "bob": [2, 16]},
    {"name": "rise_down_0", "from": "idle_down", "bob": [2, 16]},
    {"name": "rise_down_1", "from": "idle_down", "bob": [1, 16]},
    {"name": "wait_up_0", "from": "idle_up"},
    {"name": "wait_up_1", "from": "idle_up"},
]
TEAMLEAD_STAMPS = [
    # 일어나기 전조(뒷모습): 결재판을 내려놓고 팔꿈치를 바깥으로 벌려 팔걸이를 짚음(실루엣이 양옆 1px 넓어짐)
    {"frames": ["rise_up_0", "rise_up_1"], "x": 0, "y": 12, "clear": True,
     "rows": ["..OPPPPPPPPPPO..",
              ".OpOPPPPPPPPOpO.",
              ".OpOpPPPPPPpOpO.",
              ".OSOppppppppOSO.",
              "...ODDDDDDDDO...",
              "...ODDDOODDDO..."]},
    # 반쯤 일어남: 의자 삐걱 먼지(흰 점)
    {"frames": ["rise_up_1", "rise_down_1"], "x": 0, "y": 18,
     "rows": ["W..............W", ".W............W."]},
    # 정면 일어나기 전조: 왼팔꿈치 바깥으로
    {"frames": ["rise_down_0", "rise_down_1"], "x": 0, "y": 12,
     "rows": [".OO.............", "OpO.............", "OSO.............", ".O.............."]},
    # 정면 앉기: 결재판 아래를 닫고, 무릎(허벅지 앞면) 2행
    {"frames": ["sit_down", "rise_down_0"], "x": 0, "y": 15,
     "rows": ["............OOOO", "................", "................",
              "..ODDDDDDDDDDO..", "..OOOOOOOOOOOO.."]},
    # 대기(프린터 앞, 뒷모습): 옆 결재판을 지우고 뒷짐으로 듦
    {"frames": ["wait_up_0", "wait_up_1"], "x": 0, "y": 12,
     "rows": ["__O", "__O", "__O", "___", "___", "___"]},
    {"frames": ["wait_up_0"], "x": 3, "y": 13,
     "rows": ["OOOOOOOOOO", "OSttttttSO", "OOOOOOOOOO"]},
    {"frames": ["wait_up_1"], "x": 3, "y": 14,
     "rows": ["OOOOOOOOOO", "OSttttttSO", "OOOOOOOOOO"]},
    # 발 까딱(오른발 들기)
    {"frames": ["wait_up_1"], "x": 3, "y": 18,
     "rows": ["ODDDOOOOOO", "OOOOO_____"]},
]
TEAMLEAD_ANIMS = [
    {"key": "sit_up", "frames": ["sit_up"], "frameRate": 1, "repeat": -1},
    {"key": "rise_up", "frames": ["rise_up_0", "rise_up_0", "rise_up_1"], "frameRate": 4, "repeat": 0},
    {"key": "sit_down", "frames": ["sit_down"], "frameRate": 1, "repeat": -1},
    {"key": "rise_down", "frames": ["rise_down_0", "rise_down_0", "rise_down_1"], "frameRate": 4, "repeat": 0},
    {"key": "wait_up", "frames": ["wait_up_0", "wait_up_0", "wait_up_1", "wait_up_0", "wait_up_1"],
     "frameRate": 3, "repeat": -1},
]


# ------------------------------------------------------------------ 출력


def sprite_file(name, group, size, frames, origin=(0.5, 1), note=""):
    out = {"name": name, "group": group, "size": list(size), "note": note, "frames": []}
    if origin:
        out["origin"] = list(origin)
    for fname, rows in frames:
        if isinstance(rows, dict):
            out["frames"].append(rows)
            continue
        chk("%s/%s" % (name, fname), rows, size[0], size[1])
        out["frames"].append({"name": fname, "rows": rows})
    return out


def write(path, obj, force):
    if os.path.exists(path) and not force:
        print("skip(이미 있음, --force 로 덮어씀): " + os.path.relpath(path, ART))
        return
    with open(path, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(obj, fp, ensure_ascii=False, indent=1)
        fp.write("\n")
    print("write " + os.path.relpath(path, ART))


def build_scene():
    T = {
        "#": "tile/wall_cap", "[": "tile/wall_cap_l", "]": "tile/wall_cap_r", "=": "tile/wall_face",
        "w": "tile/wall_window", "k": "tile2/wall_rack", "p": "tile2/wall_print_sign",
        "b": "tile2/wall_blind", "u": "tile2/wall_blind_up", "B": "tile2/wall_books",
        "m": "tile2/wall_cafe_menu", "l": "tile2/wall_lounge", "a": "tile2/wall_lounge_art",
        "n": "tile2/wall_team2", "s": "tile2/wall_stairs", "x": "tile2/wall_exit_sign_l",
        "X": "tile2/wall_exit_sign_r", "y": "tile2/wall_door_busy", "g": "tile2/wall_door_free",
        "P": "tile2/floor_print", "Y": "tile2/floor_print_mark", "F": "tile/floor", "f": "tile/floor_b",
        "T": "tile2/floor_team2", "t": "tile2/floor_team2_b", "L": "tile2/floor_lounge",
        "C": "tile2/floor_cafe", "H": "tile2/floor_hall_a", "V": "tile2/floor_hall_b_v",
        "h": "tile2/floor_hall_b_h", "1": "tile2/floor_stairs_l", "2": "tile2/floor_stairs_r",
        " ": None,
    }
    inner = [
        "#########",   # 0
        "kkkpbubkk",   # 1  프린터·창고
        "PPPPPPPPP",   # 2
        "PPPPYYPPP",   # 3
        "PPPPPPPPP",   # 4
        "#########",   # 5  칸막이 시선 견본
        "w===w===w",   # 6
        "FFfFFFFfF",   # 7
        "FFFFFFFFF",   # 8
        "FFFFFFFFF",   # 9
        "FFFFfFFFF",   # 10
        "FFFFFFFFF",   # 11 잇기 견본
        "FFFFFFFFF",   # 12
        "FFFFFFFFF",   # 13
        "FFFFFFFFF",   # 14
        "FFFFFFFFF",   # 15
        "FFfFFFFFF",   # 16
        "FFFFFFFFF",   # 17
        "#########",   # 18 책상 배치
        "BBBB=nnnn",   # 19
        "FFFFFTTTT",   # 20
        "FFFFFTtTT",   # 21
        "FFFFFTTTT",   # 22
        "FFFFFTTTT",   # 23
        "FFFFFFFFF",   # 24
        "FFFFFFFFF",   # 25
        "FFFfFFFFF",   # 26
        "FFFFFFFFF",   # 27
        "FFFFFFFFF",   # 28
        "#########",   # 29 라운지·카페
        "laabl=mm=",   # 30
        "LLLLLCCCC",   # 31
        "LLLLLCCCC",   # 32
        "LLLLLCCCC",   # 33
        "LLLLLCCCC",   # 34
        "LLLLLCCCC",   # 35
        "#########",   # 36 복도·막힌 길
        "sxy=g=BBB",   # 37
        "HHHHHHHHH",   # 38
        "HHHHHHHHH",   # 39
        "HHHHHHHHH",   # 40
        "hhhhhhhhh",   # 41
        "hhhhhhhhh",   # 42
        "12VFFFFFF",   # 43
        "12VFFFFFF",   # 44
        "FFVFFFFFF",   # 45
        "#########",   # 46
    ]
    layer = []
    for i, r in enumerate(inner):
        if i == 0 or i == len(inner) - 1:
            layer.append("#" + r + "#")
        else:
            layer.append("[" + r + "]")
    # 계단 오른쪽 칸은 왼쪽을 좌우 반전한 타일
    objs = []

    def o(sprite, tx, ty, **kw):
        d = {"sprite": sprite, "tx": tx, "ty": ty}
        d.update(kw)
        objs.append(d)

    R = 1  # 내부 행 → 실제 행 오프셋 없음(이미 포함)
    # 프린터·창고
    o("tall2/cabinet", 1, 2)
    o("tall2/cabinet", 2, 2)
    o("tall2/cabinet_open", 3, 2)
    o("wide24/mfp", 5, 2, dx=8)
    o("furn2/paper_box", 7, 2)
    o("furn2/cabinet_low", 8, 2)
    o("tall2/box_stack", 9, 2)
    o("teamlead/wait_up_0", 5, 3, dx=8, shadow=True)
    o("furn2/box_low", 9, 4)
    # 칸막이 시선 견본: 뒤에 선 사람
    o("bg_a/idle_down", 2, 8, shadow=True)
    o("bg_c/idle_down", 7, 8, shadow=True)
    for x, k in ((1, "e"), (2, "ew"), (3, "ew"), (4, "w")):
        o("phalf/" + k, x, 9)
    for x, k in ((6, "e"), (7, "ew"), (8, "ew"), (9, "w")):
        o("pfull/" + k, x, 9)
    o("player/idle_down", 5, 9, shadow=True)
    o("bg_b/idle_up", 3, 10, shadow=True)
    o("teamlead/idle_up", 8, 10, shadow=True)
    # 잇기 견본(4x4)
    shape = [["es", "ew", "esw", "sw"],
             ["ns", None, "ns", "ns"],
             ["nes", "ew", "nesw", "nsw"],
             ["ne", "ew", "new", "nw"]]
    for j, row in enumerate(shape):
        for i, k in enumerate(row):
            if k:
                o("phalf/" + k, 1 + i, 13 + j)
                o("pfull/" + k, 6 + i, 13 + j)
    o("bg_a/idle_down", 2, 14, shadow=True)
    o("bg_a/idle_down", 7, 14, shadow=True)
    o("phalf/o", 5, 12)
    o("pfull/s", 5, 14)
    o("pfull/n", 5, 15)
    # 책상 배치
    o("furn2/desk_row_l", 1, 20)
    o("furn2/desk_row_m", 2, 20)
    o("furn2/desk_row_m", 3, 20)
    o("furn2/desk_row_r", 4, 20)
    o("bg_a/sit_type_0", 2, 21, dy=-3)
    for x in (1, 2, 3, 4):
        o("furn/chair", x, 21)
    o("furn/chair_s", 7, 20, dy=4)
    o("furn/chair_s", 8, 20, dy=4)
    o("isle32/island4", 7, 22, dx=8)
    o("bg_c/sit_type_1", 7, 23, dy=-3)
    o("furn/chair", 7, 23)
    o("furn/chair", 8, 23)
    o("furn/chair_s", 1, 23, dy=4)
    o("furn/chair_s", 2, 23, dy=4)
    o("furn/chair_s", 3, 23, dy=4)
    o("isle48/island6", 2, 25)
    o("bg_b/sit_type_0", 1, 26, dy=-3)
    o("furn/chair", 1, 26)
    o("furn/chair", 2, 26)
    o("furn/chair", 3, 26)
    o("isle32/cubicle_low", 5, 27, dx=8)
    o("bg_a/sit_type_1", 5, 27, dx=8, dy=-3)
    o("furn/chair", 5, 27, dx=8)
    o("cube52/cubicle_high", 7, 27, dx=8)
    o("bg_c/sit_type_0", 7, 27, dx=8, dy=-3)
    o("furn/chair", 7, 27, dx=8)
    o("teamlead/sit_up", 9, 27, dy=-3)
    o("furn/chair_high", 9, 27)
    # 라운지·카페
    o("tall2/vending_drink", 1, 31)
    o("tall2/vending_snack", 2, 31)
    o("tall2/purifier", 3, 31)
    o("tall/plant", 5, 31)
    o("wide2/sofa_lounge", 1, 33, dx=8)
    o("wide2/lounge_table", 1, 34, dx=8, dy=6)
    o("furn2/lounge_table", 3, 34)
    o("furn2/plant_small", 4, 33)
    o("wide24/plant_group", 3, 35, dx=8)
    o("wide24/cafe_counter", 6, 31, dx=8)
    o("tall/fridge", 9, 31)
    o("furn2/cafe_table", 7, 33)
    o("furn/stool", 6, 33)
    o("furn/stool", 8, 33)
    o("furn2/cafe_table", 7, 35)
    o("bg_b/stand_phone_left_0", 9, 34, shadow=True)
    o("teamlead/rise_up_1", 6, 35, dy=-3)
    o("furn/chair_high", 6, 35)
    # 복도·막힌 길
    o("tall2/pillar", 4, 38)
    o("wide24/locker", 8, 38, dx=8)
    o("furn2/exit_hang_l", 2, 39, dy=-10)
    o("furn2/sign_wet", 2, 40)
    o("furn2/cone", 3, 40)
    o("furn2/sign_work", 6, 40)
    o("furn2/barrier", 5, 40)
    o("furn2/barrier", 7, 40)
    o("tall2/pillar", 4, 42)
    o("wide24/box_pile", 7, 42, dx=8)
    o("furn2/box_low", 9, 42)
    o("tall/glass_h", 4, 44)
    o("tall2/glass_door_busy", 5, 44)
    o("tall/glass_h", 6, 44)
    o("tall/glass_h", 7, 44)
    o("tall2/glass_door_busy", 8, 44)
    o("tall/glass_h", 9, 44)
    o("player/idle_up", 3, 41, shadow=True)
    o("furn/chair_exec", 6, 45, depth_bias=-10)
    o("teamlead/sit_down", 6, 45, dy=-2)
    o("teamlead/rise_down_1", 8, 45, dy=-1, shadow=True)
    del R
    labels = [
        {"x": 6, "y": 76, "text": "PRINT STORAGE"},
        {"x": 6, "y": 180, "text": "HALF SEE"},
        {"x": 98, "y": 180, "text": "FULL BLOCK"},
        {"x": 6, "y": 278, "text": "HALF"},
        {"x": 98, "y": 278, "text": "FULL"},
        {"x": 6, "y": 452, "text": "ROW ISLAND"},
        {"x": 82, "y": 452, "text": "CUBE LOW HIGH"},
        {"x": 6, "y": 580, "text": "LOUNGE"},
        {"x": 98, "y": 580, "text": "CAFE"},
        {"x": 50, "y": 732, "text": "HALL STAIRS BLOCKED"},
    ]
    tiles = {k: v for k, v in T.items()}
    tiles["2"] = "tile2/floor_stairs_r"
    return {
        "_doc": "T-143 모듈 견본(180xN, 11칸 + 좌우 2px). 구역 바닥·벽 변형, 칸막이 반높이(시선 통과)/전높이(시선 차단) 비교와 잇기 16종 중 12종, 책상 배치 4종, 라운지·카페, 복도·막힌 길, 팀장 대기·앉기·일어나기. art/tools/t143_modules_src.py 로 만든 뒤 원본으로 고정",
        "name": "t143-modules",
        "preview": "t143-modules",
        "size": [180, 16 * len(layer)],
        "tile": [16, 16],
        "offset": [2, 0],
        "bg": "outline",
        "depth_sort": True,
        "tiles": tiles,
        "layers": [layer],
        "objects": objs,
        "labels": labels,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    f = a.force
    tile_frames = list(TILE2.items())
    tile_frames.insert(tile_frames.index(("floor_stairs_l", TILE2["floor_stairs_l"])) + 1,
                       ("floor_stairs_r", {"name": "floor_stairs_r", "flip": "floor_stairs_l"}))
    tile_frames.append(("wall_exit_sign_r", {"name": "wall_exit_sign_r", "flip": "wall_exit_sign_l"}))
    write(os.path.join(SPR, "t143-tile2.json"), sprite_file(
        "tile2", "tile", (16, 16), tile_frames, origin=None,
        note="T-143 구역 바닥·벽 앞면 변형(프린터·창고, 옆 팀 카펫, 라운지, 카페, 복도 2종, 계단, 블라인드 창, 책장 벽, 비상구, 회의실 문 사용 중/빈 방)"), f)
    write(os.path.join(SPR, "t143-phalf.json"), sprite_file(
        "phalf", "furniture", (16, 16), [(c, partition(HALF, c)) for c in CONNS],
        note="T-143 반높이 칸막이(시선 통과). 키 접미사 = 이웃 칸막이 연결(n,e,s,w 순서, 없으면 o). 하늘색 천, 앞면 8px"), f)
    write(os.path.join(SPR, "t143-pfull.json"), sprite_file(
        "pfull", "furniture", (16, 36), [(c, partition(FULL, c)) for c in CONNS],
        note="T-143 전높이 칸막이(시선 차단). 16x36, 원점 하단 중앙. 앞면 28px(진청 천 + 가운데 레일)이 칸 아래 변 4px 위에서 서고 위 칸으로 16px 솟는다. 뒤에 선 사람은 머리끝만 보임"), f)
    write(os.path.join(SPR, "t143-furn2.json"), sprite_file(
        "furn2", "furniture", (16, 16), [(k, v) for k, v in FURN2.items()] +
        [("exit_hang_r", {"name": "exit_hang_r", "flip": "exit_hang_l"})],
        note="T-143 16x16 소품: 막힌 길 표지(노랑), 상자, 낮은 캐비닛, 라운지·카페 탁자, 벽 붙은 책상 잇기, 매달린 비상구 표지"), f)
    write(os.path.join(SPR, "t143-tall2.json"), sprite_file(
        "tall2", "furniture", (16, 24), list(TALL2.items()),
        note="T-143 16x24: 기둥, 서류 캐비닛(닫힘/열림), 자판기 2종, 정수기(슬림), 상자 더미, 사용 중 유리문"), f)
    write(os.path.join(SPR, "t143-wide2.json"), sprite_file(
        "wide2", "furniture", (32, 16), list(WIDE2.items()), note="T-143 32x16 라운지 소파·탁자"), f)
    write(os.path.join(SPR, "t143-wide24.json"), sprite_file(
        "wide24", "furniture", (32, 24), list(WIDE24.items()),
        note="T-143 32x24: 대형 복합기, 택배 보관함, 화분 군락, 카페 카운터, 박스 더미"), f)
    write(os.path.join(SPR, "t143-isle32.json"), sprite_file(
        "isle32", "furniture", (32, 32), [("island4", island(2)), ("cubicle_low", cubicle(HALF))],
        note="T-143 32x32: 4인 섬(북쪽 2석은 모니터 뒷면, 남쪽 2석은 화면, 가운데 낮은 가림판), 반높이 큐비클"), f)
    write(os.path.join(SPR, "t143-isle48.json"), sprite_file(
        "isle48", "furniture", (48, 32), [("island6", island(3))], note="T-143 48x32 6인 섬"), f)
    write(os.path.join(SPR, "t143-cube52.json"), sprite_file(
        "cube52", "furniture", (32, 52), [("cubicle_high", cubicle(FULL))],
        note="T-143 32x52 전높이 큐비클(시선 차단). 아래 2칸이 바닥 칸, 위 20px 는 뒤 칸으로 솟음"), f)
    write(os.path.join(SCN, "t143-modules.json"), build_scene(), f)


if __name__ == "__main__":
    main()
