#!/usr/bin/env python3
"""T-169 원본 생성(결정적, 다시 돌려도 같은 파일). D-131 / design/control-dpad.md §9-1(방향 패드 조작 아트 13종).

  python3 art/tools/t169_src.py

원은 거리식으로 찍고(같은 입력 = 같은 격자), 아이콘은 문자 격자를 그대로 적습니다.
쓰는 파일(art/src/sprites/):
  t169-deck.json      ui/deck_bg                         180x72  조작대 판(좌우 대칭: 왼손 배치에서 그대로 씀)
  t169-dpad.json      ui/dpad_base[_locked|_frozen]       64x64   원형 판 + 십자 홈 + 중심 점(데드존 반경 6 표시)
  t169-arrow.json     ui/dpad_arrow_<dir>[_pressed]       16x16   위 화살표 마스크를 90° 단위로 돌린 뒤 그림자·눌림을 화면 아래쪽으로 통일
  t169-btn.json       ui/action_btn[_pressed|_dim|_pulse_0|_pulse_1] 40x40, anim ui/action_btn_pulse
  t169-aicon.json     ui/action_icon/<name>               16x16   17종(16종 + idle 흐린 손)
  t169-headicon.json  fx/head_icon/<name>                 8x8     위 17종 축소판(2x2 칸 우선순위 축소 후 손질)
  t169-chip.json      ui/chip_small[_locked|_done|_guide] 20x20
  t169-fx8.json       fx/guide_step_0·1, fx/use_hint_0·1, fx/bump_0·1   8x8, anim fx/guide_step·use_hint·bump
  t169-pin.json       fx/guide_pin                        8x12, 원점 (0.5, 1)
  t169-tutorial.json  tutorial/hand_release_0·1           16x16, anim tutorial/hand_release
  char-player.json    + disguise_step_back_<dir>_<0|1> 8장 + anim 4개(남녀 변형은 variantOf 로 자동)
  kit-head-player-f.json  + 머리 아래 덧그림 대상에 새 프레임 추가(여 변형 어깨 머리 유지)
빨강(point) 없음. 글자·로고 없음. 표준 라이브러리만.
"""
import json
import math
import os

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ART, "src", "sprites")
NOTE = "T-169 방향 패드 조작 UI(D-131, design/control-dpad.md §9-1). 원본 생성: art/tools/t169_src.py. 빨강·글자·로고 없음. "


# ------------------------------------------------------------------ 격자 도구

def blank(w, h):
    return [["."] * w for _ in range(h)]


def rows_of(g):
    return ["".join(r) for r in g]


def grid_of(rows):
    return [list(r) for r in rows]


def disk(cx, cy, r):
    return lambda x, y: (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r


def paint(g, test, ch):
    for y in range(len(g)):
        for x in range(len(g[0])):
            if test(x, y):
                g[y][x] = ch


def outline_mask(mask, w, h):
    """4방향 팽창 - 원 마스크 = 외곽선 칸."""
    out = set()
    for (x, y) in mask:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p = (x + dx, y + dy)
            if p not in mask and 0 <= p[0] < w and 0 <= p[1] < h:
                out.add(p)
    return out


def recolor(rows, table):
    return ["".join(table.get(c, c) for c in r) for r in rows]


def shift(rows, dx, dy):
    h, w = len(rows), len(rows[0])
    g = blank(w, h)
    for y in range(h):
        for x in range(w):
            sx, sy = x - dx, y - dy
            if 0 <= sx < w and 0 <= sy < h:
                g[y][x] = rows[sy][sx]
    return rows_of(g)


def over(base, top, x0=0, y0=0):
    g = grid_of(base)
    for dy, r in enumerate(top):
        for dx, c in enumerate(r):
            if c != ".":
                g[y0 + dy][x0 + dx] = c
    return rows_of(g)


def flip(rows):
    return [r[::-1] for r in rows]


# ------------------------------------------------------------------ 1. 조작대 판 180x72

def deck():
    W, H = 180, 72
    g = blank(W, H)
    paint(g, lambda x, y: True, "Q")
    for x in range(W):
        g[0][x] = "O"      # 위쪽 1px 외곽선(게임 화면과 경계)
        g[1][x] = "W"      # 밝은 턱
        g[H - 1][x] = "q"  # 아래 끝 그림자
    for (x, y) in ((4, 5), (W - 5, 5), (4, H - 6), (W - 5, H - 6)):  # 모서리 나사(대칭)
        g[y][x] = "q"
    return rows_of(g)


# ------------------------------------------------------------------ 2. 원형 패드 64x64

def dpad(state):
    W = H = 64
    g = blank(W, H)
    c = 32.0
    paint(g, disk(c, c, 32.0), "O")
    paint(g, disk(c, c, 31.0), "q")                      # 아래 턱(입체)
    face = lambda x, y: disk(c, c - 1.5, 29.6)(x, y) and disk(c, c, 31.0)(x, y)
    paint(g, face, "L")                                   # 판 테두리
    paint(g, lambda x, y: face(x, y) and disk(c, c - 1.5, 28.4)(x, y), "W")
    groove = lambda x, y: (abs(x + 0.5 - c) <= 7 or abs(y + 0.5 - (c - 1.5)) <= 7) and disk(c, c - 1.5, 26.4)(x, y)
    paint(g, groove, "Q")                                 # 십자 홈(화살표 자리)
    paint(g, disk(c, c - 1.5, 6.6), "L")                  # 데드존(반경 6) 표시
    paint(g, disk(c, c - 1.5, 5.4), "W")
    paint(g, disk(c, c - 1.5, 2.6), "M")                  # 중심 점
    g[29][31] = "W"                                       # 중심 점 반사광
    rows = rows_of(g)
    if state == "locked":
        rows = recolor(rows, {"W": "L", "Q": "Q", "L": "M", "q": "M", "M": "M"})
    elif state == "frozen":
        rows = recolor(rows, {"q": "c", "L": "C", "Q": "W"})
        g = grid_of(rows)
        # 얼음 금(하늘색 꺾은선, 십자 홈 바깥 판 위주) + 반짝이(흰 십자) + 아래 턱 고드름
        cracks = [[(10, 18), (13, 20), (15, 19), (18, 22)], [(46, 14), (49, 17), (52, 17), (53, 20)],
                  [(9, 42), (12, 44), (13, 47), (16, 48)], [(47, 45), (50, 43), (53, 44)],
                  [(38, 10), (41, 9)], [(22, 52), (24, 54), (27, 54)]]
        for pts in cracks:
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                n = max(abs(x1 - x0), abs(y1 - y0))
                for i in range(n + 1):
                    x = x0 + round((x1 - x0) * i / n)
                    y = y0 + round((y1 - y0) * i / n)
                    if g[y][x] == "W":
                        g[y][x] = "C"
        for (x, y) in ((17, 12), (50, 30), (14, 32), (40, 52)):
            for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                if g[y + dy][x + dx] in "WQ":
                    g[y + dy][x + dx] = "c" if (dx, dy) == (0, 0) else "C"
        for x in (20, 27, 36, 43):  # 고드름: 아래 턱에서 1~2px 흰 방울
            for y in range(56, 64):
                if g[y][x] == "c":
                    g[y][x] = "W"
                    if g[y + 1][x] == "c":
                        g[y + 1][x] = "W"
                    break
        rows = rows_of(g)
    return rows


# ------------------------------------------------------------------ 3. 화살표 16x16

def arrow(direction, pressed):
    W = H = 16
    up = set()
    for i in range(6):  # 위 화살표 채움: 폭 2,4,..,12 (중심 x 7.5)
        for x in range(7 - i, 9 + i):
            up.add((x, 4 + i))
    rot = {
        "up": lambda x, y: (x, y),
        "right": lambda x, y: (15 - y, x),
        "down": lambda x, y: (x, 15 - y),
        "left": lambda x, y: (y, x),
    }[direction]
    m = set(rot(x, y) for (x, y) in up)
    # 화면상 무게중심을 칸 가운데로(돌린 뒤 1px 치우침 보정)
    if direction == "down":
        m = set((x, y + 1) for (x, y) in m)
    if direction == "right":
        m = set((x + 1, y) for (x, y) in m)
    if direction == "left":
        m = set((x - 1, y) for (x, y) in m)
    dy = 1 if pressed else 0
    m = set((x, y + dy - 1) for (x, y) in m)  # 기본은 1px 떠 있고, 눌림은 1px 내려감(총 1px 차이)
    ol = outline_mask(m, W, H)
    g = blank(W, H)
    if not pressed:  # 떠 있는 그림자(화면 아래쪽 1px)
        for (x, y) in m | ol:
            if y + 1 < H:
                g[y + 1][x] = "M"
    fill, hi = ("p", "P") if pressed else ("D", "M")
    for (x, y) in ol:
        g[y][x] = "O"
    for (x, y) in m:
        g[y][x] = fill
    for (x, y) in m:  # 위쪽 가장자리 반사광
        if (x, y - 1) in ol and (x - 1, y) in m | ol:
            g[y][x] = hi
    return rows_of(g)


# ------------------------------------------------------------------ 4. 행동 버튼 40x40

def action_btn(state):
    W = H = 40
    g = blank(W, H)
    c = 20.0
    fy = c + (0.0 if state == "pressed" else -1.0)
    lip, rim, face = "p", "P", "W"
    if state == "dim":
        lip, rim, face = "M", "L", "Q"
    if state == "pressed":
        lip, rim = "p", "p"
    if state == "pulse":
        rim = "Y"
    paint(g, disk(c, c, 20.0), "O")
    paint(g, disk(c, c, 19.0), lip)
    paint(g, lambda x, y: disk(c, fy, 18.6)(x, y) and disk(c, c, 19.0)(x, y), "O")
    paint(g, lambda x, y: disk(c, fy, 17.6)(x, y), rim)
    paint(g, lambda x, y: disk(c, fy, 15.2)(x, y), "O")
    paint(g, lambda x, y: disk(c, fy, 14.2)(x, y), face)
    if state in ("normal", "pulse"):  # 테두리 왼쪽 위 반사광
        for (x, y) in ((11, 6), (10, 7), (9, 8), (8, 9), (8, 10)):
            g[y][x] = "W"
    return rows_of(g)


# ------------------------------------------------------------------ 5. 행동 아이콘 16x16

COFFEE12 = ["...M..M.....", "....M..M....", "...M..M.....", "............", ".OOOOOOOO...", ".OtTTTTtOO..",
            ".OWWWWWWOWO.", ".OWWWWWWOWO.", ".OWWWWWWOO..", ".OLWWWWLO...", "..OOOOOO....", "............"]
PARCEL12 = [".OOOOOOOOOO.", ".OTTTttTTTO.", ".OTTTttTTTO.", ".OtWWTTtttO.", ".OtLLTTtttO.", ".OttttttttO.",
            ".OttttttttO.", ".OOOOOOOOOO."]

HAND = [
    "......OO........",
    ".....OSSO.......",
    ".....OSSO.......",
    ".....OSSO.......",
    ".....OSSOOO.....",
    ".....OSSOSSOOO..",
    "..OO.OSSOSSOSSO.",
    ".OSSOOSSSSSSSSO.",
    ".OSSSOSSSSSSSSO.",
    "..OSSSSSSSSSSSO.",
    "..OSSSSSSSSSSsO.",
    "...OSSSSSSSSsO..",
    "....OSSSSSSsO...",
    "....OsssssssO...",
    "....OOOOOOOOO...",
    "................",
]


def icon_greet():  # 꾸벅: 고개 숙인 정면(정수리 + 이마만 보임) + 모은 두 손 + 양옆 숙이는 움직임 줄
    return [
        "................",
        "................",
        "................",
        ".....OOOOOO.....",
        "...OOHHHHHHOO...",
        ".M.OHHHDDHHHO.M.",
        "M.OHHHHHHHHHHO.M",
        "..OHHHHHHHHHHO..",
        "M.OHSSSSSSSSHO.M",
        "..OOSSSSSSSSOO..",
        ".OPPOOOOOOOOPPO.",
        ".OPPPPPPPPPPPPO.",
        ".OpPPPPSSPPPPpO.",
        "..OpPPPSSPPPpO..",
        "...OOOOOOOOOO...",
        "................",
    ]


def face(eyes):
    base = [
        ".....OOOOOO.....",
        "...OOHHHHHHOO...",
        "..OHHHHHHHHHHO..",
        "..OHHSSSSSSHHO..",
        "..OHSSSSSSSSHO..",
        "..OSSSSSSSSSSO..",
        "..OSSSSSSSSSSO..",
        "..OSSSSSSSSSSO..",
        "...OSSSOOSSSO...",
        "....OOSSSSOO....",
        "......OOOO......",
    ]
    g = grid_of(base)
    if eyes == "happy":  # ^ ^
        for x in (5, 10):
            g[5][x] = "O"
            g[6][x - 1] = "O"
            g[6][x + 1] = "O"
    else:  # 졸린 눈 — —
        for x in (4, 5, 6, 9, 10, 11):
            g[6][x] = "O"
    return rows_of(g)


def icon_nod():  # 끄덕: 웃는 얼굴 + 양옆 위아래 움직임 줄
    rows = ["................"] * 2 + face("happy") + ["................"] * 3
    g = grid_of(rows)
    for y in (5, 6, 9, 10):
        g[y][0] = "M"
        g[y][15] = "M"
    return rows_of(g)


def icon_head():  # 고개 들기: 졸린 얼굴 + 위 화살촉
    top = [
        ".......OO.......",
        "......ODDO......",
        ".....ODDDDO.....",
        ".....OOOOOO.....",
        "................",
    ]
    return top + face("sleepy")


def icon_stop():  # 멈춤: 커피 컵(기존 icon_coffee) + 흰 원 일시정지 배지
    rows = over(["." * 16] * 16, ["...." + r for r in COFFEE12], 0, 4)
    rows = [r[:16] for r in rows]
    badge = [".OOOOO.", "OWDWDWO", "OWDWDWO", "OWDWDWO", ".OOOOO."]
    return over(rows, badge, 9, 1)


def icon_exit():  # 나가기: 나무 문 + 초록 화살표(출구 = 초록)
    g = blank(16, 16)
    door = ["OOOOOOOOO", "OTTTTTTTO", "OTtttttTO", "OTtTTTtTO", "OTtTTTtTO", "OTtTTTtTO", "OTTTTTYTO",
            "OTtTTTtTO", "OTtTTTtTO", "OTtTTTtTO", "OTtttttTO", "OTTTTTTTO", "OTTTTTTTO", "OOOOOOOOO"]
    rows = over(rows_of(g), door, 1, 1)
    arr = ["...O...", "...OO..", "OOOOGO.", "OGGGGGO", "OOOOGO.", "...OO..", "...O..."]
    return over(rows, arr, 9, 4)


def icon_switch():  # 전환: 휴대폰 화면 + 흰 ⇄ (가상 앱, 로고 없음)
    return [
        "...OOOOOOOOOO...",
        "...OMMMMMMMMO...",
        "...OCCCCCCCCO...",
        "...OCCCCCOCCO...",
        "...OCCCCCOWOO...",
        "...OCWWWWWWWWO..",
        "...OCCCCCOWOO...",
        "...OCCCCCOCCO...",
        "...OCCOCCCCCO...",
        "...OOWOCCCCCO...",
        "..OWWWWWWWWCO...",
        "...OOWOCCCCCO...",
        "...OCCOCCCCCO...",
        "...OccccccccO...",
        "...OMMMMWWMMO...",
        "...OOOOOOOOOO...",
    ]


def icon_bite():  # 한 입: 둥근 과자 + 오른쪽 위 베어 문 자국 + 부스러기
    W = H = 16
    cookie = disk(7.5, 8.5, 6.6)
    bite = disk(13.5, 3.5, 3.6)
    m = set((x, y) for y in range(H) for x in range(W) if cookie(x, y) and not bite(x, y))
    ol = outline_mask(m, W, H)
    g = blank(W, H)
    for (x, y) in ol:
        g[y][x] = "O"
    for (x, y) in m:
        g[y][x] = "t" if (x - 7.5) + (y - 8.5) > 5 else "T"
    for (x, y) in ((4, 6), (8, 7), (5, 10), (9, 11), (11, 8)):  # 초코 칩
        if (x, y) in m:
            g[y][x] = "D"
    g[4][5] = "W"
    for (x, y) in ((14, 8), (15, 10), (13, 1)):  # 부스러기
        g[y][x] = "T"
    return rows_of(g)


def icon_tag():  # 사원증: 하늘색 줄(플레이어 줄 색) + 흰 카드(사진·줄, 글자 없음) + 태그 물결
    return [
        "................",
        "..OO......OO....",
        "..OCO....OCO....",
        "...OCO..OCO.....",
        "....OCOOCO......",
        ".....OCCO.......",
        "..OOOOOOOOOO....",
        "..OWWWWWWWWO..C.",
        "..OHHHWMMMWO...C",
        "..OSSSWWWWWO...C",
        "..OPPPWMMMWO...C",
        "..OWWWWWWWWO..C.",
        "..OCCCCCCCCO....",
        "..OOOOOOOOOO....",
        "................",
        "................",
    ]


def icon_pack():  # 가방: 황갈 서류 가방 + 노랑 잠금쇠
    return [
        "................",
        "................",
        "................",
        ".....OOOOOO.....",
        ".....O....O.....",
        "..OOOOOOOOOOOO..",
        ".OTTTTTTTTTTTTO.",
        ".OTTTTTTTTTTTTO.",
        ".OtttttYYtttttO.",
        ".OTTTTTOOTTTTTO.",
        ".OTTTTTTTTTTTTO.",
        ".OTTTTTTTTTTTTO.",
        ".OttttttttttttO.",
        "..OOOOOOOOOOOO..",
        "................",
        "................",
    ]


def icon_accept():  # 같이: 파랑(나)·초록(공범 동료, D-037) 두 사람이 손잡기
    return [
        "................",
        "................",
        "..OOOO....OOOO..",
        ".OHHHHO..OHHHHO.",
        ".OHSSHO..OHSSHO.",
        ".OSSSSO..OSSSSO.",
        "..OOOO....OOOO..",
        ".OPPPPO..OGGGGO.",
        ".OPPPPOOOOGGGGO.",
        ".OPPPPSSSSGGGGO.",
        ".OppppOOOOggggO.",
        ".ODDDDO..ODDDDO.",
        ".ODOODO..ODOODO.",
        ".OOOOOO..OOOOOO.",
        "................",
        "................",
    ]


def icon_use():  # 사용: 누르는 손가락
    return list(HAND)


def icon_idle():  # 흐린 손(할 수 있는 행동 없음): 같은 손을 회색으로
    return recolor(HAND, {"S": "L", "s": "M", "O": "M"})


def icon_start():  # 시작: 노랑 별
    return [
        "................",
        ".......OO.......",
        "......OYYO......",
        "......OWYO......",
        ".....OYYYYO.....",
        ".OOOOOYYYYOOOOO.",
        ".OYYYYYYYYYYYYO.",
        "..OYYYYYYYYYYO..",
        "...OYYYYYYYYO...",
        "....OYYYYYYO....",
        "....OYYYYYYO....",
        "...OYYYOOYYYO...",
        "...OYYO..OYYO...",
        "..OYOO....OOYO..",
        "..OO........OO..",
        "................",
    ]


def icon_pickup():  # 받기: 아래 화살표 + 택배 상자(기존 icon_parcel)
    arr = [
        "......OGGO......",
        "......OGGO......",
        "....OOOGGOOO....",
        ".....OGGGGO.....",
        "......OGGO......",
        ".......OO.......",
    ]
    rows = over(["." * 16] * 16, arr, 0, 0)
    return over(rows, ["." * 2 + r + "." * 2 for r in PARCEL12], 0, 7)


def icon_grab():  # 집기: 흰 출력 종이(회색 줄, 글자 아님) + 위에서 집은 두 손끝
    W = H = 16
    g = blank(W, H)
    for y in range(3, 15):
        for x in range(3, 13):
            g[y][x] = "O" if y in (3, 14) or x in (3, 12) else "W"
    for y, (x0, x1) in ((6, (5, 10)), (8, (5, 8)), (10, (5, 10)), (12, (5, 9))):
        for x in range(x0, x1 + 1):
            g[y][x] = "M"
    g[13][11] = "L"
    rows = rows_of(g)
    fingers = [".OO..OO.", "OSSOOSSO", "OSSOOSSO", "OSSOOSSO", "OssOOssO", ".OO..OO."]
    return over(rows, fingers, 4, 0)


def icon_order():  # 주문: 말풍선 안 컵(카페)
    return [
        "................",
        ".OOOOOOOOOOOOOO.",
        "OWWWWWWWWWWWWWWO",
        "OWWWWWWWWWWWWWWO",
        "OWWWOOOOOOOWWWWO",
        "OWWWOTTTTTOOOWWO",
        "OWWWOWWWWWOWOWWO",
        "OWWWOWWWWWOOOWWO",
        "OWWWOLWWWLOWWWWO",
        "OWWWWOOOOOWWWWWO",
        "OWWWWWWWWWWWWWWO",
        ".OOOWWOOOOOOOOO.",
        "...OWO..........",
        "...OO...........",
        "................",
        "................",
    ]


def icon_breath():  # 숨(바람): 하늘색 바람 줄 3개, 끝이 말림
    return [
        "................",
        "..........OOO...",
        ".........OCCCO..",
        "..........O.OCO.",
        ".OOOOOOOOOOOOCO.",
        "OCCCCCCCCCCCCCO.",
        ".OOOOOOOOOOOOO..",
        "................",
        "...OOOOOOOOOOOO.",
        "..OCCCCCCCCCCCCO",
        "...OOOOOOOOOOOO.",
        "................",
        ".OOOOOOOOOOOO...",
        "OCCCCCCCCCCCCO..",
        ".OOOOOOOOOOOCO..",
        "...........OO...",
    ]


ICONS = [
    ("greet", icon_greet, "인사 QTE(action.greet) — 꾸벅 숙인 사람"),
    ("nod", icon_nod, "말걸기 맞장구(action.nod) · 수다 맞장구(action.chat) — 웃는 얼굴 끄덕"),
    ("stop", icon_stop, "커피·창가 멈춤(action.stop) — 컵 + 일시정지 배지"),
    ("exit", icon_exit, "화장실 나가기(action.exit) — 문 + 초록 화살표"),
    ("head", icon_head, "낮잠 고개 들기(action.head) — 졸린 얼굴 + 위 화살촉"),
    ("switch", icon_switch, "쇼핑·공과금 화면 전환(action.switch) — 휴대폰 + 양방향 화살표"),
    ("bite", icon_bite, "간식 한 입(action.bite) — 베어 문 과자"),
    ("tag", icon_tag, "게이트 태그(action.tag) — 사원증"),
    ("pack", icon_pack, "가방 멈춤·계속(action.pack_pause / pack_resume) — 서류 가방"),
    ("accept", icon_accept, "공범 제안 수락(action.accept) — 두 사람 손잡기"),
    ("use", icon_use, "사물 사용(action.use) — 누르는 손가락"),
    ("start", icon_start, "자리 미션 시작(action.start) — 별"),
    ("pickup", icon_pickup, "택배·카페 받기(action.pickup), 택배 꺼내기 멈춤(action.pause) — 상자 + 아래 화살표"),
    ("grab", icon_grab, "몰래 출력 집기(action.grab), 집기 멈춤(action.pause) — 집은 종이"),
    ("order", icon_order, "카페 주문(action.order) — 말풍선 속 컵"),
    ("breath", icon_breath, "창가 숨 고르기(창가에서 action.stop 대신 쓸 수 있음) — 바람 줄"),
    ("idle", icon_idle, "§4-2 9순위 '흐린 손'(할 수 있는 행동 없음) — 회색 손"),
]


# ------------------------------------------------------------------ 6. 머리 위 아이콘 8x8 (축소 + 손질)

PRIO_SKIP = set(".")


def down2(rows):
    """2x2 칸 축소: 외곽선 2칸 이상이면 외곽선, 아니면 가장 많은 색(동률이면 앞선 칸)."""
    out = []
    for y in range(0, 16, 2):
        r = ""
        for x in range(0, 16, 2):
            cs = [rows[y][x], rows[y][x + 1], rows[y + 1][x], rows[y + 1][x + 1]]
            solid = [c for c in cs if c != "."]
            if len(solid) < 2:
                r += "."
            elif cs.count("O") >= 2:
                r += "O"
            else:
                body = [c for c in solid if c != "O"] or solid
                r += max(body, key=lambda c: (body.count(c), -body.index(c)))
        out.append(r)
    return out


# 축소 결과가 뭉개지는 것은 직접 그린 8x8로 바꿉니다(머리 위 0.6초, 버튼과 같은 모양·색).
HEAD_FIX = {
    "greet": ["M.OOOO.M", ".OHHHHO.", "OHHDDHHO", "MOHHHHOM", ".OSSSSO.", "OPOOOOPO", "OPPSSPPO", ".OOOOOO."],  # T-172 보강
    "nod": [".OOOOOO.", "OHHHHHHO", "OSOSSOSO", "OSSSSSSO", ".OSOOSO.", "..OOOO..", "M......M", "........"],
    "stop": ["....OOOO", "....ODDO", "OOOOOOOO", "OTTTTOWO", "OWWWWOO.", "OWWWWO..", ".OOOO...", "........"],
    "exit": ["OOOOO...", "OTTTO.O.", "OTTTOOGO", "OTTYGGGO", "OTTTOOGO", "OTTTO.O.", "OOOOO...", "........"],
    "head": ["...OO...", "..ODDO..", ".OOOOOO.", "OHHHHHHO", "OSOOSOOO", "OSSSSSSO", ".OSSSSO.", "..OOOO.."],
    "switch": [".OOOOOO.", "OCCCCWCO", "OWWWWWWO", "OCCCCWCO", "OCWCCCCO", "OWWWWWWO", "OCWCCCCO", ".OOOOOO."],  # T-172 보강
    "bite": ["..OOO...", ".OTTTO.T", "OTDTTO..", "OTTTTTO.", "OTTDTtO.", ".OTttO..", "..OOO...", "........"],
    "tag": [".O....O.", "..O..O..", "OOOOOOO.", "OHWMMWO.", "OPWWWWOC", "OCCCCCO.", "OOOOOOO.", "........"],
    "pack": ["..OOOO..", "..O..O..", "OOOOOOOO", "OTTTTTTO", "OttYYttO", "OTTTTTTO", "OOOOOOOO", "........"],
    "accept": [".OO..OO.", "OSSOOSSO", ".OO..OO.", "OPPOOGGO", "OPPSSGGO", "ODDOODDO", "OOO..OOO", "........"],
    "use": ["..OO....", "..OSO...", "..OSOOO.", "OOOSSSSO", "OSSSSSSO", ".OSSSSO.", ".OsssO..", ".OOOOO.."],
    "start": ["...OO...", "..OYYO..", "OOOYYOOO", "OYYYYYYO", ".OYYYYO.", ".OYOOYO.", ".OO..OO.", "........"],
    "pickup": ["..OGGO..", ".OOGGOO.", "..OGGO..", "...OO...", "OOOOOOOO", "OTTtTTTO", "OttttttO", "OOOOOOOO"],
    "grab": ["..O..O..", ".OSOOSO.", "OOSOOSOO", "OWOWWOWO", "OWMMMMWO", "OWMMMWWO", "OWWWWWWO", "OOOOOOOO"],
    "order": ["OOOOOOOO", "OWOOOOWO", "OWOTTOOO", "OWOWWOWO", "OWWOOWWO", "OOWOOOOO", ".OO.....", "........"],
    "breath": [".....OO.", "OOOOOOCO", "CCCCCCO.", "OOOOOOO.", "..OOOOOO", ".OCCCCCC", "..OOOOOO", "........"],
}


# ------------------------------------------------------------------ 7. 작은 미션 칩 20x20

def chip(state):
    W = H = 20
    g = blank(W, H)
    border, face, lip = "O", "W", "L"
    if state == "locked":
        border, face, lip = "M", "L", "M"
    for y in range(H):
        for x in range(W):
            corner = (x in (0, W - 1)) and (y in (0, H - 1))
            if corner:
                continue
            edge = x in (0, W - 1) or y in (0, H - 1)
            g[y][x] = border if edge else face
    for x in range(1, W - 1):
        g[H - 2][x] = lip  # 아래 1px 턱
    if state == "done":  # 초록 아래 턱 2px + 오른쪽 위 작은 체크 점(완료 아이콘과 별개로 칩만 봐도 알게)
        for x in range(1, W - 1):
            g[H - 2][x] = "G"
            g[H - 3][x] = "G"
    if state == "guide":  # 안내 중: 하늘색 2px 테두리(안쪽) + 모서리 진한 하늘색
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if x in (1, 2, W - 2, W - 3) or y in (1, 2, H - 2, H - 3):
                    g[y][x] = "C"
        for (x, y) in ((1, 1), (W - 2, 1), (1, H - 2), (W - 2, H - 2)):
            g[y][x] = "c"
    return rows_of(g)


# ------------------------------------------------------------------ 8. 바닥·머리 위 효과 8x8, 핀 8x12

GUIDE_STEP_0 = [
    ".cc.....",
    "cCCc....",
    "cCCc.cc.",
    ".cc.cCCc",
    "cCCccCCc",
    ".cc..cc.",
    ".....cCc",
    "......c.",
]
GUIDE_STEP_1 = recolor(GUIDE_STEP_0, {"C": "W"})

USE_HINT_0 = [
    "..OOOO..",
    "..OWWO..",
    "..OWWO..",
    "OOOWWOOO",
    ".OWWWWO.",
    "..OWWO..",
    "...OO...",
    "........",
]
USE_HINT_1 = shift(USE_HINT_0, 0, 1)

BUMP_0 = [
    "M......M",
    ".M....M.",
    "........",
    "..OOO...",
    ".OWWWOO.",
    "OWWLWWWO",
    ".OOOOOO.",
    "........",
]
BUMP_1 = [
    "........",
    "M......M",
    "........",
    ".OO..OO.",
    "OWLO.OWO",
    ".OO.OWLO",
    ".....OO.",
    "........",
]

PIN = [
    "..OOOO..",
    ".OCCCCO.",
    "OCCWWCcO",
    "OCWWWWcO",
    "OCWWWWcO",
    "OCCWWccO",
    ".OCCccO.",
    "..OCcO..",
    "..OCcO..",
    "...OO...",
    "..qOOq..",
    "...qq...",
]


# ------------------------------------------------------------------ 9. 튜토리얼 손 16x16

def hand_frames():
    # 0 = 손끝이 패드에 닿음(하늘색 접촉 링), 1 = 손을 2px 아래로 떼고 손끝 위에 흰 '떼기' 줄
    h = shift(HAND, 0, 2)
    ring0 = ["..CCCC..", ".C....C.", "........"]
    f0 = over(["." * 16] * 16, h)
    f0 = over(f0, [".CC..CC."], 3, 0)
    f0 = over(f0, ["C......C"], 3, 1)
    h1 = shift(HAND, 1, 4)
    f1 = over(["." * 16] * 16, h1)
    f1 = over(f1, ["M....M"], 5, 0)
    f1 = over(f1, ["M....M"], 5, 1)
    del ring0
    return f0, f1


# ------------------------------------------------------------------ 10. 흠칫 반걸음(플레이어)

STEP_FRAMES = [
    {"name": "disguise_step_back_down_0", "from": "idle_down", "bob": [1, 16]},
    {"name": "disguise_step_back_down_1", "from": "idle_down"},
    {"name": "disguise_step_back_up_0", "from": "idle_up", "bob": [1, 16]},
    {"name": "disguise_step_back_up_1", "from": "idle_up"},
    {"name": "disguise_step_back_right_0", "from": "idle_right", "bob": [1, 16]},
    {"name": "disguise_step_back_right_1", "from": "idle_right"},
    {"name": "disguise_step_back_left_0", "flip": "disguise_step_back_right_0"},
    {"name": "disguise_step_back_left_1", "flip": "disguise_step_back_right_1"},
]
SWEAT = [".O.", "OCO", "OWO", ".O."]
STEP_STAMPS = [
    {"frames": ["disguise_step_back_down_0", "disguise_step_back_up_0", "disguise_step_back_right_0"],
     "x": 13, "y": 0, "rows": SWEAT, "_note": "T-169 흠칫: 머리 오른쪽 위 땀방울(하늘색 + 흰 반사)"},
    {"frames": ["disguise_step_back_down_1", "disguise_step_back_up_1", "disguise_step_back_right_1"],
     "x": 13, "y": 1, "rows": SWEAT, "_note": "T-169 땀방울이 1px 흘러내림"},
    {"frames": ["disguise_step_back_down_0"], "x": 1, "y": 12,
     "rows": ["OS..........SO", ".O..........O."],
     "_note": "T-169 흠칫(정면): 두 손이 어깨 옆으로 번쩍(1px 웅크림은 bob)"},
    {"frames": ["disguise_step_back_down_0"], "x": 3, "y": 14, "rows": ["Op", ], "_note": "왼손 자리 비움"},
    {"frames": ["disguise_step_back_down_0"], "x": 11, "y": 14, "rows": ["pO"], "_note": "오른손 자리 비움"},
    {"frames": ["disguise_step_back_down_1"], "x": 0, "y": 12,
     "rows": [".OOOOOOOOOOOOOO.", "OSOWWWWWWWWWWOSO", "OSOWGGGGWWWWWOSO", ".OOWWWWWWWWWWOO."],
     "_note": "T-169 정면 2장: 서류가 허리에서 올라오는 중(다음은 기존 disguise = 얼굴 아래까지)"},
    {"frames": ["disguise_step_back_up_0"], "x": 1, "y": 12,
     "rows": ["OS..........SO", ".O..........O."],
     "_note": "T-169 흠칫(뒷모습): 두 손 번쩍 + 1px 웅크림"},
    {"frames": ["disguise_step_back_up_0"], "x": 3, "y": 14, "rows": ["Op"]},
    {"frames": ["disguise_step_back_up_0"], "x": 11, "y": 14, "rows": ["pO"]},
    {"frames": ["disguise_step_back_up_1"], "x": 3, "y": 13,
     "rows": ["OSp", "Op."], "_note": "T-169 뒷모습 2장: 어깨 움츠림(손이 1px 위)"},
    {"frames": ["disguise_step_back_up_1"], "x": 10, "y": 13, "rows": ["pSO", ".pO"]},
    {"frames": ["disguise_step_back_right_0"], "x": 2, "y": 16,
     "rows": ["..ODDDDDDO", ".ODDOODDDO", "ODDO.ODDDO", "OOOO.OOOOOO"],
     "_note": "T-169 흠칫(옆): 뒷발이 뒤(왼쪽)로 반걸음 + 1px 웅크림"},
    {"frames": ["disguise_step_back_right_0"], "x": 10, "y": 12, "rows": ["OS", "O."],
     "_note": "앞손이 가슴 앞으로 번쩍"},
    {"frames": ["disguise_step_back_right_1"], "x": 11, "y": 7,
     "rows": [".OOOO", ".OWWO", ".OWMO", ".OWWO", "PSWWO", ".OOOO"],
     "_note": "T-169 옆 2장: 서류가 가슴 높이로 올라오는 중(다음은 기존 pose_read_document_<dir>)"},
    {"frames": ["disguise_step_back_right_1"], "x": 7, "y": 14, "rows": ["P"]},
]
STEP_ANIMS = [{"key": "disguise_step_back_%s" % d,
               "frames": ["disguise_step_back_%s_0" % d, "disguise_step_back_%s_1" % d],
               "frameRate": 14, "repeat": 0} for d in ("down", "up", "right", "left")]
STEP_NOTE = (" T-169: 흠칫 반걸음 disguise_step_back_<down|up|right|left>_<0|1>(M3 뒤로 붙기, 2장 14fps 한 번 = 0.14초 ≤ 붙기 0.15초)."
             " _0 = 1px 웅크림 + 땀방울 + 손 번쩍(옆은 뒷발 반걸음), _1 = 서류가 올라오는 중(정면·옆) / 어깨 움츠림(뒷모습)."
             " 이어서 기존 disguise(정면)·pose_read_document_<dir>(옆)로 바꿉니다. 왼쪽은 오른쪽 반전")


# ------------------------------------------------------------------ 쓰기

def write(fn, d):
    for f in d.get("frames", []):
        if "rows" in f and "size" in d:
            w, h = d["size"]
            assert len(f["rows"]) == h and all(len(r) == w for r in f["rows"]), (fn, f["name"],
                                                                                  [len(r) for r in f["rows"]])
    p = os.path.join(SPR, fn)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("write", fn)


def replace_named(lst, new, key):
    names = {x[key] for x in new}
    return [x for x in lst if x.get(key) not in names] + new


def main():
    write("t169-deck.json", {
        "name": "t169-deck", "prefix": "ui", "group": "ui", "lean": True, "size": [180, 72],
        "note": NOTE + "조작대 배경(논리 180x320의 아래 72px, y 248~320). 밝은 판 + 위쪽 1px 외곽선 + 밝은 턱. 좌우 대칭이라 왼손 배치에서도 그대로 씀",
        "frames": [{"name": "deck_bg", "rows": deck()}]})
    write("t169-dpad.json", {
        "name": "t169-dpad", "prefix": "ui", "group": "ui", "lean": True, "size": [64, 64],
        "note": NOTE + "원형 패드 판(좌우 대칭). 십자 홈 = 화살표 자리(중심에서 ±20px), 가운데 링 = 데드존 반경 6. _locked = 회색(개발이 알파 0.4를 함께 적용), _frozen = 대표님 얼음(하늘색 테두리·금·반짝이·고드름)",
        "frames": [{"name": "dpad_base", "rows": dpad("normal")},
                   {"name": "dpad_base_locked", "rows": dpad("locked")},
                   {"name": "dpad_base_frozen", "rows": dpad("frozen")}]})
    fr = []
    for d in ("up", "down", "left", "right"):
        fr.append({"name": "dpad_arrow_%s" % d, "rows": arrow(d, False)})
        fr.append({"name": "dpad_arrow_%s_pressed" % d, "rows": arrow(d, True)})
    write("t169-arrow.json", {
        "name": "t169-arrow", "prefix": "ui", "group": "ui", "lean": True, "size": [16, 16],
        "note": NOTE + "패드 화살표. 기본 = 진한 남색 + 아래 1px 그림자(떠 있음), _pressed = 1px 내려가고 진한 파랑(색만으로 구분하지 않음, §8-2). 위 화살표를 90° 단위로 돌려 만들고 그림자·눌림은 모두 화면 아래쪽",
        "frames": fr})
    write("t169-btn.json", {
        "name": "t169-btn", "prefix": "ui", "group": "ui", "lean": True, "size": [40, 40],
        "note": NOTE + "행동 버튼(지름 40, 판정 48은 코드). 흰 면 + 파랑 테두리(플레이어 색) + 아래 턱. 아이콘 16은 면 중심 = 기본·맥동 (20,19) / 눌림 (20,20)에 놓음. _dim = 회색(알파 0.4 함께), _pulse_1 = 테두리 노랑(튜토리얼 맥동)",
        "frames": [{"name": "action_btn", "rows": action_btn("normal")},
                   {"name": "action_btn_pressed", "rows": action_btn("pressed")},
                   {"name": "action_btn_dim", "rows": action_btn("dim")},
                   {"name": "action_btn_pulse_0", "rows": action_btn("normal")},
                   {"name": "action_btn_pulse_1", "rows": action_btn("pulse")}],
        "anims": [{"key": "action_btn_pulse", "frames": ["action_btn_pulse_0", "action_btn_pulse_1"],
                   "frameRate": 2, "repeat": -1}]})
    icons = [(n, fn(), doc) for n, fn, doc in ICONS]
    write("t169-aicon.json", {
        "name": "t169-aicon", "prefix": "ui/action_icon", "group": "ui", "lean": True, "size": [16, 16],
        "note": NOTE + "행동 버튼 아이콘 17종(§4-2·§4-4). " + " / ".join("%s: %s" % (n, doc) for n, _, doc in icons),
        "frames": [{"name": n, "rows": r} for n, r, _ in icons]})
    heads = []
    for n, r, _ in icons:
        heads.append({"name": n, "rows": HEAD_FIX.get(n) or down2(r)})
    heads.append({"name": "idle", "rows": recolor(HEAD_FIX["use"], {"S": "L", "s": "M", "O": "M"})})
    heads = [h for h in heads if h["name"] != "idle"] + [heads[-1]]
    write("t169-headicon.json", {
        "name": "t169-headicon", "prefix": "fx/head_icon", "group": "ui", "lean": True, "size": [8, 8],
        "note": NOTE + "머리 위 행동 아이콘(§8-2, 버튼 아이콘이 바뀌면 0.6초). ui/action_icon/<name> 과 같은 이름·색의 8x8 축소판(직접 손질)",
        "frames": heads})
    write("t169-chip.json", {
        "name": "t169-chip", "prefix": "ui", "group": "ui", "lean": True, "size": [20, 20],
        "note": NOTE + "작은 미션 칩(판정 22x22는 코드). 미션 아이콘(12 또는 16)은 가운데에 겹침. _locked = 회색, _done = 아래 초록 턱 2px, _guide = 길 안내 중 하늘색 2px 테두리",
        "frames": [{"name": "chip_small", "rows": chip("normal")},
                   {"name": "chip_small_locked", "rows": chip("locked")},
                   {"name": "chip_small_done", "rows": chip("done")},
                   {"name": "chip_small_guide", "rows": chip("guide")}]})
    write("t169-fx8.json", {
        "name": "t169-fx8", "prefix": "fx", "group": "ui", "lean": True, "size": [8, 8], "origin": [0.5, 0.5],
        "note": NOTE + "guide_step = 길 안내 발자국(하늘색 = 플레이어 색 D-052, 위쪽으로 걷는 모양 → 진행 방향에 맞춰 90° 단위 회전, _1 = 흰 깜빡임, 2fps = 1초에 1회). use_hint = 사용 가능 사물 위 흰 화살표(1px 통통). bump = 범프 '툭' 먼지(벽 쪽 칸 가장자리에, 한 번 재생)",
        "frames": [{"name": "guide_step_0", "rows": GUIDE_STEP_0}, {"name": "guide_step_1", "rows": GUIDE_STEP_1},
                   {"name": "use_hint_0", "rows": USE_HINT_0}, {"name": "use_hint_1", "rows": USE_HINT_1},
                   {"name": "bump_0", "rows": BUMP_0}, {"name": "bump_1", "rows": BUMP_1}],
        "anims": [{"key": "guide_step", "frames": ["guide_step_0", "guide_step_1"], "frameRate": 2, "repeat": -1},
                  {"key": "use_hint", "frames": ["use_hint_0", "use_hint_1"], "frameRate": 3, "repeat": -1},
                  {"key": "bump", "frames": ["bump_0", "bump_1"], "frameRate": 10, "repeat": 0}]})
    write("t169-pin.json", {
        "name": "t169-pin", "prefix": "fx", "group": "ui", "lean": True, "size": [8, 12], "origin": [0.5, 1],
        "note": NOTE + "길 안내 목적지 핀(하늘색 + 흰 점, 아래 바닥 그림자). 원점 = 아래 가운데 → 사용 칸 중심 아래쪽 4px에 두면 핀 끝이 칸 가운데",
        "frames": [{"name": "guide_pin", "rows": PIN}]})
    f0, f1 = hand_frames()
    write("t169-tutorial.json", {
        "name": "t169-tutorial", "prefix": "tutorial", "group": "ui", "lean": True, "size": [16, 16],
        "origin": [0.4375, 0.0625],
        "note": NOTE + "1일차 ④ '손 떼기' 손가락(오른손). _0 = 손끝이 패드에 닿음(하늘색 접촉 표시), _1 = 손이 아래로 떨어지고 손끝 위에 떼기 줄. 원점 = 손끝(x 7, y 1). 왼손 배치에서는 setFlipX(true)로 거울(원점 x는 1-0.4375)",
        "frames": [{"name": "hand_release_0", "rows": f0}, {"name": "hand_release_1", "rows": f1}],
        "anims": [{"key": "hand_release", "frames": ["hand_release_0", "hand_release_0", "hand_release_1", "hand_release_1"],
                   "frameRate": 4, "repeat": -1}]})

    p = os.path.join(SPR, "char-player.json")
    d = json.load(open(p, encoding="utf-8"))
    names = {f["name"] for f in STEP_FRAMES}
    d["stamps"] = [s for s in d["stamps"] if not (set(s.get("frames") or []) & names)] + STEP_STAMPS
    d["frames"] = replace_named(d["frames"], STEP_FRAMES, "name")
    d["anims"] = replace_named(d["anims"], STEP_ANIMS, "key")
    d["note"] = d["note"].split(" T-169:")[0] + STEP_NOTE
    write("char-player.json", d)

    p = os.path.join(SPR, "kit-head-player-f.json")
    d = json.load(open(p, encoding="utf-8"))
    for s in d["stamps"]:
        fr = s.get("frames")
        if not fr:
            continue
        for dname in ("down", "up", "right"):
            if "idle_" + dname in fr:
                for i in (0, 1):
                    n = "disguise_step_back_%s_%d" % (dname, i)
                    if n not in fr:
                        fr.append(n)
    write("kit-head-player-f.json", d)


if __name__ == "__main__":
    main()
