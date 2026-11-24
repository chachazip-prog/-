#!/usr/bin/env python3
"""T-146 원본 부트스트랩(1회용). v3 미션·순회·변형 아트 원본 JSON 을 art/src/ 에 쓴다.

- 이미 파일이 있으면 --force 없이 덮어쓰지 않는다. **원본은 JSON** 이며 오너 보정 후에는 다시 돌리지 않는다.
- 표준 라이브러리만 사용. 같은 입력이면 같은 JSON(정렬 키, 들여쓰기 1).
- 큰 화면 UI(ui/bank_app, ui/coupon_card)와 원형 효과(fx/zone_hint)는 여기서 도형 함수로 격자를 만든다.

  python3 art/tools/t146_src.py [--force]
"""
import json
import math
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SP = os.path.join(ART, "src", "sprites")
SC = os.path.join(ART, "src", "scenes")


def put(path, obj, force):
    if os.path.exists(path) and not force:
        print("skip (exists):", os.path.relpath(path, ART))
        return
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    print("wrote", os.path.relpath(path, ART))


def fr(name, rows):
    return {"name": name, "rows": rows}


class Grid:
    def __init__(self, w, h, fill="."):
        self.w, self.h = w, h
        self.g = [[fill] * w for _ in range(h)]

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, c)

    def box(self, x, y, w, h, line, fill=None):
        if fill:
            self.rect(x, y, w, h, fill)
        for xx in range(x, x + w):
            self.px(xx, y, line)
            self.px(xx, y + h - 1, line)
        for yy in range(y, y + h):
            self.px(x, yy, line)
            self.px(x + w - 1, yy, line)

    def rbox(self, x, y, w, h, line, fill=None):
        """모서리 1px 깎은 상자."""
        self.box(x, y, w, h, line, fill)
        for cx, cy in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
            self.px(cx, cy, ".")
        for cx, cy in ((x + 1, y + 1), (x + w - 2, y + 1), (x + 1, y + h - 2), (x + w - 2, y + h - 2)):
            self.px(cx, cy, line)

    def hline(self, x, y, w, c, dash=0):
        for i in range(w):
            if not dash or (i // dash) % 2 == 0:
                self.px(x + i, y, c)

    def blit(self, x, y, rows):
        for dy, r in enumerate(rows):
            for dx, ch in enumerate(r):
                if ch != ".":
                    self.px(x + dx, y + dy, ch)

    def rows(self):
        return ["".join(r) for r in self.g]


# ======================================================================= 아이콘 12x12 (flat)

ICONS = {
    # 새 미션 칩 아이콘 (missions.json missionPool.new[].iconSprite)
    "icon_parcel": [
        "............",
        "............",
        ".OOOOOOOOOO.",
        ".OTTTttTTTO.",
        ".OTTTttTTTO.",
        ".OtWWTTtttO.",
        ".OtLLTTtttO.",
        ".OttttttttO.",
        ".OttttttttO.",
        ".OOOOOOOOOO.",
        "............",
        "............"],
    "icon_print": [
        "...OOOOOO...",
        "...OWWWWO...",
        "...OWMMWO...",
        ".OOOWWWWOOO.",
        ".OLLLLLLLLO.",
        ".OMMMMMMCMO.",
        ".OMMMMMMMMO.",
        ".OOWWWWWWOO.",
        ".OMOOOOOOMO.",
        ".OMMMMMMMMO.",
        ".OOOOOOOOOO.",
        "............"],
    "icon_chat": [
        "............",
        ".OOOOOO.....",
        "OWWWWWWO....",
        "OWDWDWDO....",
        "OWWWWWWO....",
        ".OWOOOOOOOO.",
        "..OOCCCCCCCO",
        "...OCWCWCWCO",
        "...OCCCCCCcO",
        "....OOOOOCO.",
        "........OCO.",
        ".........O.."],
    "icon_bank": [
        "............",
        "..OOOOOOOO..",
        "..OCCCCCCO..",
        "..OWWWWWWO..",
        "..OWMMMMWO..",
        "..OWWWWWWO..",
        "..OWMMMWWO..",
        "..OWWWWWWO..",
        "..OMWMWMWO..",
        "..OWWWGGWO..",
        "..OOOOOOOO..",
        "............"],
    "icon_cafe": [
        "............",
        "..OOOOOOOO..",
        ".OLLLLLLLLO.",
        ".OOOOOOOOOO.",
        "..OWWWWWWO..",
        "..OWWWWWWO..",
        "..OTTTTTTO..",
        "..OTTTTTtO..",
        "...OWWWWO...",
        "...OWWWLO...",
        "...OOOOOO...",
        "............"],
    "icon_window": [
        "............",
        ".OOOOOOOOOO.",
        ".OCWCCOCCCO.",
        ".OCCWCOCWCO.",
        ".OCCCCOCCCO.",
        ".OOOOOOOOOO.",
        ".OCWWWOWCCO.",
        ".OcCCCOcWWO.",
        ".OOOOOOOOOO.",
        ".OLLLLLLLLO.",
        ".OOOOOOOOOO.",
        "............"],
    # 팀장 출발 말풍선 속 목적지 아이콘 (layout.json leadRoaming.destinations[].bubbleIcon)
    "icon_tour_printer": [
        "............",
        "............",
        "..OOOOOOOO..",
        ".OLLLLLLLLO.",
        ".OMMMMMMCMO.",
        ".OMMMMMMMMO.",
        ".OOOOOOOOOO.",
        ".OMOWWWWOMO.",
        ".OMOOOOOOMO.",
        ".OMMMMMMMMO.",
        ".OOOOOOOOOO.",
        "............"],
    "icon_tour_cup": [
        "...M..M.....",
        "....M..M....",
        "...M..M.....",
        "............",
        "..OOOOOOOO..",
        "..OWWWWWWOO.",
        "..OCCCCCCOWO",
        "..OCCCCCCOWO",
        "..OWWWWWWOO.",
        "..OLWWWWLO..",
        "...OOOOOO...",
        "............"],
    "icon_tour_meeting": [
        "............",
        "..ODO..ODO..",
        "..OOO..OOO..",
        ".OOOOOOOOOO.",
        ".OTTTTTTTTO.",
        ".OTWWTTTTTO.",
        ".OTTTTTWWTO.",
        ".OttttttttO.",
        ".OOOOOOOOOO.",
        "..ODO..ODO..",
        "..OOO..OOO..",
        "............"],
    "icon_tour_talk": [
        "...OOOOO....",
        "..OWDWDWO...",
        "...OOWOO....",
        ".....O......",
        ".OOO....OOO.",
        "OHHHO..OHHHO",
        "OHSOO..OOSHO",
        "OHSSO..OSSHO",
        ".OOO....OOO.",
        "OBBBO..OMMMO",
        "OBBBO..OMMMO",
        "............"],
    "icon_tour_report": [
        "....OOOO....",
        "..OOOLLOOO..",
        "..OTOOOOTO..",
        "..OTWWWWTO..",
        "..OTWMMWTO..",
        "..OTWWWWTO..",
        "..OTWMMWTO..",
        "..OTWWWWTO..",
        "..OTWYYWTO..",
        "..OTTTTTTO..",
        "..OOOOOOOO..",
        "............"],
}

# ======================================================================= 변형 배지 8x8 (mod/<type>)
# 바탕: hard = dark(D), soft(avoid) = cool_sh(c), bonus = green_sh(g). 글리프는 흰색 위주.


def badge(bg, inner):
    rows = [".OOOOOO."]
    for r in inner:
        rows.append("O" + r.replace("X", bg) + "O")
    rows.append(".OOOOOO.")
    return rows


MOD_INNER = {
    "rush": ("D", ["XWWWWX", "WWDWWW", "WWDDWW", "WWWWWW", "XWWWWX", "XXXXXX"]),          # 시계
    "relocate": ("D", ["XXXWXX", "XXXWWX", "WWWWWW", "XXXWWX", "XXXWXX", "XXXXXX"]),      # 화살표
    "double": ("D", ["XWWWXX", "XXXXWX", "XXWWXX", "XWXXXX", "XWWWWX", "XXXXXX"]),        # 굵은 2(HUD 문구 '두 배로')
    "carry": ("D", ["XTTTTX", "XTTTTX", "XttttX", "SSSSSX", "XSSSSX", "XXXXXX"]),         # 손 위 상자
    "avoid": ("c", ["XXXXXO", "XWWWOX", "WWOOWW", "XWOWWX", "XOXXXX", "OXXXXX"]),         # 사선 그은 눈 = 몰래
    "silent": ("D", ["XWXXXX", "WWXWXW", "WWXXWX", "WWXWXW", "XWXXXX", "XXXXXX"]),        # 음소거
    "bonus": ("g", ["XXYYXX", "YYYYYY", "XYYYYX", "XYYYYX", "YYXXYY", "XXXXXX"]),         # 별
    "during_tour": ("D", ["XWWWWX", "XWWWWX", "XXWWXX", "XWWWWX", "WWWWWW", "WWWWWW"]),   # 팀장 실루엣(평평한 머리)
    "deadline": ("D", ["XWXXWX", "CCCCCC", "WWWWWW", "WDWDWW", "WWWWWW", "XXXXXX"]),      # 달력
    "zone_only": ("D", ["XWWWXX", "WXXXWX", "XXXWXX", "XXWXXX", "XXXXXX", "XXWXXX"]),     # 물음표
}
# avoid 대상 점(오른쪽 아래 2x2). 정의로운 동료·인사팀·경비 = 사원증 줄 색.
# 상사(팀장·본부장)는 줄 색이 빨강이지만 T-146 요청은 빨강 금지 → 대표 소품 색(결재판 황갈 / 금 배지 노랑)으로 대신함.
AVOID_DOT = {"snitch": "P", "hr_inspector": "B", "security_guard": "O", "team_lead": "t", "director": "Y"}


def mod_frames():
    out = []
    for k, (bg, inner) in MOD_INNER.items():
        out.append(fr(k, badge(bg, inner)))
    base = badge(*MOD_INNER["avoid"])
    for actor, col in AVOID_DOT.items():
        rows = [list(r) for r in base]
        for x, y in ((5, 5), (6, 5), (5, 6), (6, 6)):
            rows[y][x] = col
        if col == "O":  # 검정 점은 외곽선과 붙어 묻히므로 위·왼쪽에 흰 테 1px
            for x, y in ((4, 5), (4, 6), (5, 4), (6, 4)):
                rows[y][x] = "W"
        out.append(fr("avoid_" + actor, ["".join(r) for r in rows]))
    return out


# ======================================================================= HUD·가구·소품

HUD_TL_AWAY = [
    ".OOOOOOOOOO.",
    "OWWWWWWWWWWO",
    "OWWOOOOOOWWO",
    "OWOBBOOBBOWO",
    "OWOBBWWBBOWO",
    "OWObBBBBbOWO",
    "OWOOOOOOOOWO",
    "OWWWWOOWWWWO",
    "OWWWOOOOWWWO",
    "OWWWOWWOWWWO",
    "OWWWWWWWWWWO",
    ".OOOOOOOOOO."]

CHAIR_HIGH_JACKET = [
    "...OOOOOOOOOO...",
    "..OBBBOWWOBBBO..",
    "..OBBBBOOBBBBO..",
    ".OBbBBBBBBBBbBO.",
    ".OBODDDDDDDDOBO.",
    ".OBODMDDDDDDOBO.",
    ".ObODMDDDDDDObO.",
    ".OOODDDDDDDDOOO.",
    "..ODDDDDDDDDDO..",
    "..OOOOOOOOOOOO..",
    ".......OO.......",
    ".......OO.......",
    "...OOOOOOOOOO...",
    "...OMO.OO.OMO...",
    "...OOO.OO.OOO...",
    "................"]


def tray(n):
    g = Grid(16, 8)
    g.blit(1, 5, [
        "OOOOOOOOOOOOOO",
        "OMMMMMMMMMMMMO",
        "OOOOOOOOOOOOOO"])
    if n:
        top = 4 - n
        g.hline(2, top, 12, "O")
        for i in range(n):
            y = top + 1 + i
            g.blit(2, y, ["O" + ("W" if i % 2 == 0 else "L") * 10 + "O"])
        # 맨 윗장 인쇄 줄(점 2개) — 출력물임을 표시
        g.px(4, top + 1, "M")
        g.px(6, top + 1, "M")
        g.px(8, top + 1, "M")
    return g.rows()


PROPS = {
    "parcel_box": ICONS["icon_parcel"],
    "paper_stack": [
        "............",
        "............",
        "............",
        ".OOOOOOOOOO.",
        ".OWWWWWWWWO.",
        ".OWMMMWMMWO.",
        ".OWWWWWWWWO.",
        ".OWMMWMMMWO.",
        ".OLLLLLLLLO.",
        ".OWWWWWWWWO.",
        ".OOOOOOOOOO.",
        "............"],
    "cafe_cup": [
        "............",
        "............",
        "............",
        "...OOOOOO...",
        "..OLLLLLLO..",
        "..OOOOOOOO..",
        "...OWWWWO...",
        "...OTTTTO...",
        "...OTTTtO...",
        "...OWWWLO...",
        "....OOOO....",
        "............"],
}

CUP_READY_0 = [
    ".OOOOOOOOOO.",
    "OWWWWWWWWWWO",
    "OWWWOOOOWWWO",
    "OWWWOLLOWWWO",
    "OWWWOWWOWWWO",
    "OWWWOTTOWWWO",
    "OWWWOOOOWWWO",
    "OWWWWWWWWWWO",
    ".OOOOWWOOOO.",
    "....OWO.....",
    "....OO......",
    "............"]
CUP_READY_1 = [
    "G.OOOOOOOO.G",
    ".GWWWWWWWWG.",
    "OWWWOOOOWWWO",
    "OWGWOLLOWGWO",
    "OWWWOWWOWWWO",
    "OWWWOTTOWWWO",
    "OWGWOOOOWGWO",
    ".GWWWWWWWWG.",
    "G.OOOWWOOO.G",
    "....OWO.....",
    "....OO......",
    "............"]


def zone_hint(r, sparkle):
    g = Grid(16, 16)
    cx = cy = 7.5
    pts = []
    for i in range(64):
        a = 2 * math.pi * i / 64
        x, y = int(math.floor(cx + r * math.cos(a) + 0.5)), int(math.floor(cy + r * math.sin(a) + 0.5))
        if (x, y) not in pts:
            pts.append((x, y))
    for k, (x, y) in enumerate(sorted(pts, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))):
        if k % 3 != 2:  # 점선 링(2칸 그리고 1칸 비움)
            g.px(x, y, "C" if y < 8 else "c")
    if sparkle:
        for x, y in ((3, 3), (12, 3), (3, 12), (12, 12)):
            g.px(x, y, "W")
        g.blit(6, 6, [".CC.", "CWWC", "CWWC", ".CC."])
    else:
        g.blit(7, 7, ["CC", "CC"])
    return g.rows()


SIDE_WINDOW_L = [
    "DDDDDDDDDDDDMLO.",
    "DDOOOOOOOOODMLO.",
    "DDOWWWWWWWODMLO.",
    "DDOLLLLLLLODMLO.",
    "DDOWWWWWWDODMLO.",
    "DDOLLLLLLDODMLO.",
    "DDOWWWWWWMODMLO.",
    "DDOMMMMMMMODMLO.",
    "DDOCWCCCCCODMLO.",
    "DDOCCWCCCCODMLO.",
    "DDOCCCWCCCODMLO.",
    "DDOCCCCCWCODMLO.",
    "DDOcCCCCCWODMLO.",
    "DDOccccccCODMLO.",
    "DDOOOOOOOOODMLO.",
    "DDDDDDDDDDDDMLO."]


# ======================================================================= 화면 UI


def bank_app_rows():
    g = Grid(64, 96)
    g.rbox(0, 0, 64, 96, "O", "D")
    g.rect(3, 6, 58, 84, "W")
    g.box(2, 5, 60, 86, "O")
    g.rect(26, 2, 12, 2, "M")
    g.rect(24, 92, 16, 1, "M")
    g.rect(3, 6, 58, 12, "C")
    g.rect(3, 17, 58, 1, "c")
    g.box(7, 8, 8, 9, "O", "W")
    g.hline(9, 11, 4, "C")
    g.hline(9, 13, 4, "L")
    g.hline(9, 15, 3, "L")
    g.rect(18, 10, 26, 2, "W")
    g.rect(18, 14, 16, 1, "c")
    g.box(7, 22, 50, 34, "L", "W")
    g.rect(8, 23, 48, 4, "C")
    g.hline(11, 30, 30, "M")
    g.hline(11, 34, 40, "L")
    g.hline(11, 38, 36, "L")
    g.hline(11, 42, 26, "L")
    g.hline(8, 47, 48, "M", dash=2)
    g.rect(11, 50, 20, 3, "L")
    g.box(45, 49, 8, 6, "M", "W")
    for x in (7, 24, 41):
        g.box(x, 62, 16, 6, "M", "L")
    g.rect(23, 64, 1, 2, "M")
    g.rect(40, 64, 1, 2, "M")
    g.rbox(7, 74, 50, 12, "O", "C")
    g.rect(9, 84, 46, 1, "c")
    return g.rows()


def bank_step_on():
    g = Grid(16, 6)
    g.box(0, 0, 16, 6, "g", "G")
    g.rect(1, 1, 14, 1, "W")
    return g.rows()


def bank_check_on():
    g = Grid(8, 6)
    g.box(0, 0, 8, 6, "g", "W")
    g.blit(1, 1, ["....G.", "...GG.", "G.GG..", ".GG..."])
    return g.rows()


def coupon_card():
    """카페 쿠폰 도장 카드(10칸). 상표·로고 없음."""
    g = Grid(72, 40)
    g.rbox(0, 0, 72, 40, "O", "F")
    g.rect(2, 2, 68, 8, "T")
    g.rect(2, 9, 68, 1, "t")
    g.blit(4, 2, [".OOOO.", "OLLLLO", ".OWWO.", ".OTTO.", ".OWWO.", "..OO.."])  # 컵 글리프
    g.rect(12, 4, 30, 2, "W")                  # 제목 자리(코드가 글자)
    for row, y in enumerate((12, 26)):
        for i in range(5):
            x = 5 + 13 * i
            slot(g, x, y, last=(row == 1 and i == 4))
    return g.rows()


def ring(g, x0, y0, d, c, dotted):
    r = (d - 1) / 2.0
    cx, cy = x0 + r, y0 + r
    for y in range(y0, y0 + d):
        for x in range(x0, x0 + d):
            dd = math.hypot(x - cx, y - cy)
            if abs(dd - r) < 0.55 and (not dotted or (x + y) % 2 == 0):
                g.px(x, y, c)


def slot(g, x, y, last):
    ring(g, x, y, 10, "t", dotted=True)
    if last:  # 10번째 칸 = 보상(노랑 별)
        g.blit(x + 2, y + 2, ["..YY..", "YYYYYY", ".YYYY.", ".YYYY.", "YY..YY"])


def coupon_stamp():
    g = Grid(10, 10)
    r = 4.5
    for y in range(10):
        for x in range(10):
            if math.hypot(x - r, y - r) <= 4.6:
                g.px(x, y, "t")
    ring(g, 0, 0, 10, "O", dotted=False)
    g.blit(2, 3, ["WWWWW.", "WWWWWW", "WWWWW.", ".WWW.."])  # 흰 컵 실루엣(손잡이 1px)
    g.blit(2, 7, ["WWWWWW"])
    return g.rows()


# ======================================================================= 들고 걷기 키트 (kit-carry)
# 프레임 이름 규칙: carry_<item>_<dir>[_0|_1] (정지 + 걷기 2), pose_hold_<item>_<dir>_<0|1> (멈춤 위장)
# 스탬프는 match(fnmatch) 로 대상 지정 → 새 소품은 '소품 스탬프'만 추가하면 됨(팔 스탬프 공용).
# 바디 A 기준 좌표. 바디 B 캐릭터는 kit-carry-b(추후) 로 x 를 1px 넓혀 쓴다.

ITEMS = ("box", "paper", "cup")


def carry_frames():
    frames, anims = [], []
    for it in ITEMS:
        for d in ("down", "up", "right"):
            src = {"down": "idle_down", "up": "idle_up", "right": "idle_right"}[d]
            frames.append({"name": "carry_%s_%s" % (it, d), "from": src})
            for i in (0, 1):
                f = {"name": "carry_%s_%s_%d" % (it, d, i), "from": "walk_%s_%d" % (d, i)}
                if d != "right":
                    f["bob"] = [1, 16]
                frames.append(f)
        frames.append({"name": "carry_%s_left" % it, "flip": "carry_%s_right" % it})
        for i in (0, 1):
            frames.append({"name": "carry_%s_left_%d" % (it, i), "flip": "carry_%s_right_%d" % (it, i)})
        for d in ("down", "right"):
            for i in (0, 1):
                frames.append({"name": "pose_hold_%s_%s_%d" % (it, d, i), "from": "idle_" + d})
        for i in (0, 1):
            frames.append({"name": "pose_hold_%s_left_%d" % (it, i), "flip": "pose_hold_%s_right_%d" % (it, i)})
        for d in ("down", "up", "left", "right"):
            anims.append({"key": "carry_%s_%s" % (it, d),
                          "frames": ["carry_%s_%s_0" % (it, d), "carry_%s_%s" % (it, d),
                                     "carry_%s_%s_1" % (it, d), "carry_%s_%s" % (it, d)],
                          "frameRate": 8, "repeat": -1})
            anims.append({"key": "carry_%s_idle_%s" % (it, d), "frames": ["carry_%s_%s" % (it, d)],
                          "frameRate": 1, "repeat": -1})
        for d in ("down", "left", "right"):
            anims.append({"key": "pose_hold_%s_%s" % (it, d),
                          "frames": ["pose_hold_%s_%s_0" % (it, d), "pose_hold_%s_%s_1" % (it, d)],
                          "frameRate": 2, "repeat": -1})
    return frames, anims


def carry_stamps():
    S = []

    def st(match, x, y, rows, note=None):
        s = {"match": match, "x": x, "y": y, "rows": rows}
        if note:
            s["_note"] = note
        S.append(s)

    two = ["carry_box_down*", "carry_paper_down*", "pose_hold_box_down_*", "pose_hold_paper_down_*"]
    # --- 공용 팔(두 손 앞으로): 정면
    st(two, 2, 12, ["S..........S", "S..........S"], "두 손으로 앞에 듦(정면). 손 = 소품 양옆")
    # --- 공용 팔: 뒷모습(늘어진 손 지우기)
    st(["carry_box_up*", "carry_paper_up*", "carry_cup_up*"], 4, 13, ["p......p", "p......p"], "뒷모습: 손이 앞으로 가서 안 보임")
    # --- 공용 팔: 옆모습(팔 앞으로 뻗음 + 흔들리던 손 지우기)
    st(["carry_*_right*", "pose_hold_*_right_*"], 5, 12, ["PPpPPS", "PPPPPP", "PPPPPP"], "옆모습: 팔을 앞으로(손 x10)")

    # --- 택배 상자
    box_down = ["OOOOOOOOOO", "OTTTttTTTO", "OTTTttTTTO", "OtWWTTtttO", "OtLLTTtttO", "OOOOOOOOOO"]
    st(["carry_box_down*", "pose_hold_box_down_0"], 3, 10, box_down, "택배 상자(정면): 턱 밑까지 듦, 위 테이프 + 앞면 흰 송장")
    st(["pose_hold_box_down_1"], 3, 9, box_down, "송장 확인하는 척: 상자 1px 들어 올림")
    st(["pose_hold_box_down_1"], 3, 15, ["OOOOOOOOOO"])
    st(["carry_box_up*"], 1, 10, ["OO..........OO", "OT..........TO", "OT..........TO",
                                  "Ot..........tO", "Ot..........tO", "OO..........OO"], "뒷모습: 몸 양옆으로 상자 모서리")
    box_right = ["OOOOO", "OTTTO", "OTTTO", "OtWtO", "OtttO", "OOOOO"]
    st(["carry_box_right*", "pose_hold_box_right_0"], 11, 10, box_right, "옆모습: 몸 앞 상자")
    st(["pose_hold_box_right_1"], 11, 9, box_right)
    st(["pose_hold_box_right_1"], 11, 15, ["OOOOO"])

    # --- 출력물(종이 묶음)
    paper_down = ["OOOOOOOOOO", "OWWWWWWWWO", "OWMMMWMMWO", "OLLLLLLLLO", "OOOOOOOOOO"]
    st(["carry_paper_down*", "pose_hold_paper_down_0"], 3, 11, paper_down, "출력물(정면): 가슴 앞 종이 묶음, 윗장 인쇄 줄")
    st(["pose_hold_paper_down_1"], 3, 11, ["OOOOOOOOOO", "OWWWWWWWWO", "OWMMWMMMWO", "OLLLLLLLLO", "OOOOOOOOOO"],
       "검토하는 척: 윗장 줄이 바뀜(한 장 넘김)")
    st(["carry_paper_up*"], 1, 11, ["OO..........OO", "OW..........WO", "OL..........LO", "OO..........OO"])
    paper_right = ["OOOO", "OWWO", "OLLO", "OOOO"]
    st(["carry_paper_right*", "pose_hold_paper_right_0"], 11, 11, paper_right)
    st(["pose_hold_paper_right_1"], 11, 10, ["OOOO", "OWWO", "OWMO", "OLLO", "OOOO"])

    # --- 카페 컵(한 손)
    cup = ["OOOO", "OLLO", "OWWO", "OTTO", "OOOO"]
    st(["carry_cup_down*", "pose_hold_cup_down_0"], 11, 13, ["p", "p"], "정면: 오른손이 컵으로 감")
    st(["carry_cup_down*", "pose_hold_cup_down_0"], 6, 11, ["OOOO.", "OLLO.", "OWWOS", "OTTOS", "OOOO."], "카페 컵(정면): 가슴 앞 한 손")
    st(["pose_hold_cup_down_1"], 11, 13, ["p", "p"])
    st(["pose_hold_cup_down_1"], 6, 8, ["OOOO.", "OLLO.", "OWWO.", "OTTOS", "OOOOS"], "홀짝: 컵을 입가로")
    st(["carry_cup_up*"], 11, 11, [".OOOO", ".OLLO", "SOWWO", ".OTTO", ".OOOO"], "뒷모습: 오른손 옆에 컵")
    st(["carry_cup_right*", "pose_hold_cup_right_0"], 11, 10, cup)
    st(["pose_hold_cup_right_1"], 11, 7, cup, "옆모습 홀짝: 컵을 입가로")
    st(["pose_hold_cup_right_1"], 5, 12, ["PPpPPP"])
    st(["pose_hold_cup_right_1"], 10, 9, ["S", "S"])
    return S


# ======================================================================= v3 포즈 키트 (kit-pose-v3, 플레이어)


def pose_v3():
    frames = [
        {"name": "pose_nap_on_sofa_down_0", "from": "idle_down", "bob": [2, 16]},
        {"name": "pose_nap_on_sofa_down_1", "from": "idle_down", "bob": [2, 16]},
        {"name": "pose_breath_right_0", "from": "idle_right"},
        {"name": "pose_breath_right_1", "from": "idle_right", "bob": [1, 16]},
        {"name": "pose_breath_left_0", "flip": "pose_breath_right_0"},
        {"name": "pose_breath_left_1", "flip": "pose_breath_right_1"},
        {"name": "pose_nod_up_0", "from": "idle_up"},
        {"name": "pose_nod_up_1", "from": "idle_up", "bob": [1, 10]},
    ]
    stamps = [
        {"match": "pose_nap_on_sofa_*", "x": 5, "y": 7, "rows": ["S....S"], "_note": "감은 눈"},
        {"match": "pose_nap_on_sofa_*", "x": 4, "y": 8, "rows": ["OO....OO"]},
        {"match": "pose_nap_on_sofa_*", "x": 4, "y": 13, "rows": ["p......p", "S......S"], "_note": "손 무릎에"},
        {"match": "pose_nap_on_sofa_down_0", "x": 13, "y": 2, "rows": ["CCC", ".C.", "CCC"], "_note": "z (하늘색)"},
        {"match": "pose_nap_on_sofa_down_1", "x": 13, "y": 0, "rows": ["CCC", ".C.", "CCC"]},
        {"match": "pose_breath_right_*", "x": 11, "y": 7, "rows": ["S", "OO"], "_note": "눈 감고 숨 들이쉬기"},
        {"match": "pose_breath_right_1", "x": 14, "y": 8, "rows": [".L", "WL"], "_note": "후— 내쉬는 숨(연기 아님, 흰 바람)"},
        {"match": "pose_nod_up_*", "x": 4, "y": 13, "rows": ["p......p"], "_note": "뒷짐 없이 손 모음"},
    ]
    anims = [
        {"key": "pose_nap_on_sofa", "frames": ["pose_nap_on_sofa_down_0", "pose_nap_on_sofa_down_0",
                                               "pose_nap_on_sofa_down_1"], "frameRate": 2, "repeat": -1},
        {"key": "pose_breath_right", "frames": ["pose_breath_right_0", "pose_breath_right_1"], "frameRate": 2, "repeat": -1},
        {"key": "pose_breath_left", "frames": ["pose_breath_left_0", "pose_breath_left_1"], "frameRate": 2, "repeat": -1},
        {"key": "pose_nod_up", "frames": ["pose_nod_up_0", "pose_nod_up_1"], "frameRate": 4, "repeat": -1},
    ]
    return frames, stamps, anims


# ======================================================================= 머리 키트: 옆 팀 동기(바디 B)

HEAD_BUDDY = {
    "down": [
        "...OOO.OO.OOO...",
        "..OHHHOHHOHHHO..",
        ".OHHHHHHHHHHHHO.",
        ".OHHHHDHHHDHHHO.",
        ".OHHHHHHHHHHHHO.",
        ".OHHSHSSSSHSHHO.",
        ".OHSSSSSSSSSSHO.",
        ".OSSSOSSSSOSSSO.",
        ".OSsSOSSSSOSsSO.",
        ".OSSSSSssSSSSSO.",
        "..OOOOssssOOOO.."],
    "up": [
        "...OOO.OO.OOO...",
        "..OHHHOHHOHHHO..",
        ".OHHHHHHHHHHHHO.",
        ".OHHHDHHHHDHHHO.",
        ".OHHHHHHHHHHHHO.",
        ".OHHHHHHHHHHHHO.",
        ".OHHHHHHHHHHHHO.",
        ".OHHHHHHHHHHHHO.",
        ".OSHHHHHHHHHHSO.",
        ".OHOHHHHHHHHOHO.",
        "..OOOOssssOOOO.."],
    "right": [
        "..OOO.OO.OO.....",
        ".OHHHOHHOHHO....",
        ".OHHHHHHHHHHO...",
        ".OHHHHDHHHDHHO..",
        ".OHHHHHHHHHHHO..",
        ".OHHHHHHHHSHHO..",
        ".OHHHHHHHSSSSO..",
        ".OHHHHHSSSSOSO..",
        ".OHHHHHsSSSOSO..",
        ".OHHHHHSSSsSOO..",
        "..OOOOOsssOOO..."],
}


def head_kit(head, extra_match, laugh):
    stamps = []
    for d in ("down", "up", "right"):
        s = {"dir": d, "clear": True, "x": 0, "y": 0, "rows": head[d]}
        if extra_match.get(d):
            s["match"] = extra_match[d]
        stamps.append(s)
    if laugh:
        stamps.append({"match": laugh["match"], "x": 0, "y": 7, "rows": laugh["rows"], "_note": "웃음 표정(^ ^ + 벌린 입)"})
    return stamps


BUDDY_LAUGH = {"match": "sit_turn_1", "rows": [
    ".OSSSOSSSSOSSSO.",
    ".OSsOSOSSOSOsSO.",
    ".OSSSSSDDSSSSSO.",
    "..OOOOssssOOOO.."]}


# ======================================================================= 장면 견본


def scene():
    return {
        "_doc": "T-146 견본(176x160, 11x10칸). 라운지(옆 벽 창가 + 카페 카운터 + 소파) · 옆 팀(동기) · 팀장 빈자리 재킷 · 복합기 쟁반 0~4장. 레벨 원본이 아니라 아트 검수용",
        "name": "t146-sample",
        "preview": "t146-scene",
        "size": [176, 160],
        "tile": [16, 16],
        "offset": [0, 0],
        "bg": "floor",
        "depth_sort": True,
        "tiles": {
            "A": "tile/wall_cap", "B": "tile/wall_cap_l", "G": "tile/wall_cap_r",
            "w": "tile2/wall_blind_side_l", "x": "tile2/wall_blind_side_r",
            "I": "tile2/wall_lounge", "M": "tile2/wall_cafe_menu", "J": "tile2/wall_team2",
            "L": "tile2/floor_lounge", "K": "tile2/floor_cafe", "T": "tile2/floor_team2", "P": "tile2/floor_print",
            "N": "tile/wall_cap_v", " ": None},
        "layers": [[
            "AAAAAAAAAAA",
            "BIIMMINJJJG",
            "wLLKKKNTTTx",
            "wLLKKKNTTTx",
            "BLLLLLNTTTG",
            "wLLLLLNTTTx",
            "wLLLLLLTTTx",
            "BAAAAANAAAG",
            "BPPPPPPPPPG",
            "BPPPPPPPPPG"]],
        "objects": [
            {"sprite": "wide24/cafe_counter", "x": 40, "y": 24},
            {"sprite": "fx/cup_ready_1", "x": 66, "y": 14},
            {"sprite": "wide2/sofa_lounge", "x": 18, "y": 72},
            {"sprite": "player/pose_nap_on_sofa_down_0", "x": 26, "y": 66, "shadow": False, "depth_bias": 20},
            {"sprite": "player/pose_breath_left_1", "tx": 1, "ty": 5, "shadow": True},
            {"sprite": "player/carry_cup_down_0", "tx": 4, "ty": 4, "shadow": True},
            {"sprite": "furn/desk_monitor", "tx": 8, "ty": 2},
            {"sprite": "bg_buddy/sit_turn_1", "tx": 8, "ty": 3, "dy": -3, "shadow": False},
            {"sprite": "player/pose_nod_up_1", "tx": 8, "ty": 4, "shadow": True},
            {"sprite": "furn/desk_boss", "tx": 7, "ty": 5},
            {"sprite": "furn/chair_high_jacket", "tx": 7, "ty": 6},
            {"sprite": "player/carry_box_right_0", "tx": 9, "ty": 6, "shadow": True},
            {"sprite": "player/carry_paper_up_1", "tx": 5, "ty": 6, "shadow": True},
            {"sprite": "prop/printer_tray_0", "x": 22, "y": 140},
            {"sprite": "prop/printer_tray_1", "x": 54, "y": 140},
            {"sprite": "prop/printer_tray_2", "x": 86, "y": 140},
            {"sprite": "prop/printer_tray_3", "x": 118, "y": 140},
            {"sprite": "prop/printer_tray_4", "x": 150, "y": 140},
            {"sprite": "player/pose_hold_box_down_1", "tx": 2, "ty": 8, "shadow": True},
            {"sprite": "player/carry_box_down_0", "tx": 4, "ty": 8, "shadow": True},
            {"sprite": "player/carry_paper_down", "tx": 6, "ty": 8, "shadow": True},
            {"sprite": "bg_buddy/walk_down_0", "tx": 8, "ty": 8, "shadow": True},
            {"sprite": "fx/zone_hint_1", "tx": 9, "ty": 8},
        ],
        "ui": [
            {"sprite": "hud/tl_away", "x": 160, "y": 2},
            {"sprite": "icon_tour_printer", "x": 146, "y": 2},
        ],
    }


# ======================================================================= main


def main():
    force = "--force" in sys.argv
    put(os.path.join(SP, "t146-icons.json"), {
        "name": "icons_v3", "group": "ui", "size": [12, 12], "flat": True,
        "note": "T-146 v3 아이콘(flat 키). 새 미션 칩 6종(missions.json iconSprite) + 팀장 순회 목적지 5종(layout.json leadRoaming.destinations[].bubbleIcon). 상표·로고·금액 없음, 빨강 없음",
        "frames": [fr(k, v) for k, v in ICONS.items()]}, force)
    put(os.path.join(SP, "t146-mod.json"), {
        "name": "mod", "group": "ui", "size": [8, 8], "origin": [0.5, 0.5],
        "note": "T-146 미션 변형 배지(mod/<modifierTemplates.type>). 바탕색 = 종류: hard 남색(D), soft 청록(c, avoid), bonus 초록(g). avoid_<대상> = 오른쪽 아래 2x2 대상 점(동료 파랑·인사팀 보라·경비 검정 = 줄 색, 팀장 황갈 결재판·본부장 금 배지 = 빨강 금지로 소품 색). 칩 오른쪽 위에 얹음",
        "frames": mod_frames()}, force)
    put(os.path.join(SP, "t146-hud.json"), {
        "name": "hud_v3", "prefix": "hud", "group": "ui", "size": [12, 12],
        "note": "T-146 hud/tl_away = '자리 비움' 배지(HUD 팀장 아이콘 옆). 흰 판 + 보라 재킷 걸린 빈 의자. 문구는 strings hud.tl_away",
        "frames": [fr("tl_away", HUD_TL_AWAY)]}, force)
    put(os.path.join(SP, "t146-furn.json"), {
        "name": "furn_v3", "prefix": "furn", "group": "furniture", "size": [16, 16],
        "note": "T-146 furn/chair_high_jacket = 팀장 순회 중 빈 의자(furn/chair_high 위에 보라 재킷: 어깨가 등받이보다 1px씩 넓고 소매가 좌석 양옆으로 늘어짐). chair_high 와 같은 자리·같은 원점에 바꿔 끼움",
        "frames": [fr("chair_high_jacket", CHAIR_HIGH_JACKET)]}, force)
    put(os.path.join(SP, "t146-tray.json"), {
        "name": "prop_tray", "prefix": "prop", "group": "furniture", "size": [16, 8], "origin": [0.5, 1],
        "note": "T-146 prop/printer_tray_0~4 = 복합기 출력 쟁반 종이 0~4장(1장 = 1px 높아짐, 흰·연회색 번갈아). wide24/mfp 앞 쟁반 자리(왼쪽 아래 x=2..15, y=17 근처)에 덮어 그림",
        "frames": [fr("printer_tray_%d" % n, tray(n)) for n in range(5)]}, force)
    put(os.path.join(SP, "t146-prop.json"), {
        "name": "prop", "group": "furniture", "size": [12, 12], "origin": [0.5, 1],
        "note": "T-146 들고 다니는 소품 단독 그림(missions.json params.carryProp 키와 같은 이름). 바닥·책상 위 놓기, 다른 캐릭터 손 위 덧그리기용. 상표 없음",
        "frames": [fr(k, v) for k, v in PROPS.items()]}, force)
    put(os.path.join(SP, "t146-fx12.json"), {
        "name": "fx12", "prefix": "fx", "group": "ui", "size": [12, 12], "origin": [0.5, 1],
        "note": "T-146 fx/cup_ready = 카페 '컵 나왔어요' 말풍선(0.6초 전조). cup_ready 정지, cup_ready_1 = 초록 반짝임 테. anim fx/cup_ready 8fps 반복",
        "frames": [fr("cup_ready", CUP_READY_0), fr("cup_ready_1", CUP_READY_1)],
        "anims": [{"key": "cup_ready", "frames": ["cup_ready", "cup_ready_1"], "frameRate": 8, "repeat": -1}]}, force)
    put(os.path.join(SP, "t146-fx16.json"), {
        "name": "fx16", "prefix": "fx", "group": "ui", "size": [16, 16], "origin": [0.5, 0.5],
        "note": "T-146 fx/zone_hint = '어디더라?' 변형 장소 반짝임(하늘색 점선 링, 엄폐 칸 초록과 구분). zone_hint 정지, zone_hint_1 = 링 축소 + 흰 반짝임. anim fx/zone_hint 3fps",
        "frames": [fr("zone_hint", zone_hint(6.5, False)), fr("zone_hint_1", zone_hint(5.4, True))],
        "anims": [{"key": "zone_hint", "frames": ["zone_hint", "zone_hint_1"], "frameRate": 3, "repeat": -1}]}, force)
    put(os.path.join(SP, "t146-tile.json"), {
        "name": "tile2_v3", "prefix": "tile2", "group": "tile", "size": [16, 16],
        "note": "T-146 옆 벽 창문(라운지 창가). wall_blind_side_l = 왼쪽 벽(tile/wall_cap_l 자리), _r = 좌우 반전. 위쪽 블라인드 반 + 아래 유리(하늘색 + 흰 반사). 세로로 이어 붙임",
        "frames": [fr("wall_blind_side_l", SIDE_WINDOW_L), {"name": "wall_blind_side_r", "flip": "wall_blind_side_l"}]}, force)
    put(os.path.join(SP, "t146-ui-bank.json"), {
        "name": "ui_bank", "prefix": "ui", "group": "ui", "size": [64, 96],
        "note": "T-146 ui/bank_app = 가상 고지서 앱(폰 화면, 금액·은행명·로고 없음). 글자(제목·단계 이름)는 코드가 얹음. 3단계 진행 칸 x=7/24/41, y=62, 16x6 → 켜진 칸에 ui/bank_step_on. 확인 체크 칸 x=45,y=49 → ui/bank_check_on. 확인 버튼 x=7,y=74, 50x12",
        "frames": [fr("bank_app", bank_app_rows())]}, force)
    put(os.path.join(SP, "t146-ui-bankstep.json"), {
        "name": "ui_bankstep", "prefix": "ui", "group": "ui", "size": [16, 6],
        "frames": [fr("bank_step_on", bank_step_on())]}, force)
    put(os.path.join(SP, "t146-ui-bankcheck.json"), {
        "name": "ui_bankcheck", "prefix": "ui", "group": "ui", "size": [8, 6],
        "frames": [fr("bank_check_on", bank_check_on())]}, force)
    put(os.path.join(SP, "t146-ui-coupon.json"), {
        "name": "ui_coupon", "prefix": "ui", "group": "ui", "size": [72, 40],
        "note": "T-146 ui/coupon_card = 카페 쿠폰 도장 카드(10칸, 상표 없음). 칸 왼쪽 위 = (5+13*i, 12) 1줄, (5+13*i, 26) 2줄, i=0..4, 10x10. 10번째 칸 노랑 별 = 보상. 찍힌 칸에 ui/coupon_stamp(10x10)를 같은 좌표로 덮음",
        "frames": [fr("coupon_card", coupon_card())]}, force)
    put(os.path.join(SP, "t146-ui-stamp.json"), {
        "name": "ui_stamp", "prefix": "ui", "group": "ui", "size": [10, 10],
        "frames": [fr("coupon_stamp", coupon_stamp())]}, force)

    cf, ca = carry_frames()
    put(os.path.join(SP, "kit-carry.json"), {
        "name": "kit-carry", "kit": True,
        "note": "T-146 공용 키트: 물건 들고 걷기(바디 A 좌표). 캐릭터 원본에 \"kits\": [\"kit-carry\"] 만 넣으면 carry_<box|paper|cup>_<dir>[_0|_1] + pose_hold_<item>_<dir>_<0|1> 와 애니메이션이 붙음. 팔 스탬프(공용)와 소품 스탬프(소품별)가 match 패턴으로 분리되어 있어 새 소품 = 소품 스탬프만 추가. 셔츠·줄 색은 캐릭터 swap 을 따름. 머리 스탬프(dir)는 캐릭터 쪽이 먼저 찍힘",
        "frames": cf, "stamps": carry_stamps(), "anims": ca}, force)
    pf, ps, pa = pose_v3()
    put(os.path.join(SP, "kit-pose-v3.json"), {
        "name": "kit-pose-v3", "kit": True,
        "note": "T-146 v3 미션 포즈(바디 A): 소파 낮잠 pose_nap_on_sofa(layout lounge_nap.pose), 창가 숨 돌리기 pose_breath_<right|left>, 맞장구 pose_nod_up(동기 뒤에 서서)",
        "frames": pf, "stamps": ps, "anims": pa}, force)
    put(os.path.join(SP, "kit-head-buddy.json"), {
        "name": "kit-head-buddy", "kit": True,
        "note": "T-146 머리 키트(바디 B): 짧은 뽀글 머리(윗선 물결) + 물결 앞머리 + 볼터치 + 웃는 입. dir 스탬프(clear) + 앉은 프레임 match. 성별·나이 표지 없음. 다른 머리로 바꾸려면 이 키트만 교체",
        "stamps": head_kit(HEAD_BUDDY, {"down": ["sit_turn_*"], "up": ["sit_type_*"]}, BUDDY_LAUGH)}, force)
    put(os.path.join(SP, "char-buddy.json"), {
        "name": "bg_buddy", "group": "npc", "base": "body-b",
        "note": "T-146 옆 팀 동기(수다 미션 chat 상대, layout buddy_seat/chat_use). 바디 B + 하늘색 맨투맨(cool) + 사원증 줄 황갈색(wood, 새 역할 색) + 머리 키트 kit-head-buddy + 친근한 소품 = 과자 봉지(정면 손). 앉아서 일하기 sit_type_0/1(뒷모습), 돌아앉아 수다 sit_turn_0(정면) / sit_turn_1(웃음). 걷기 4방향은 바디 B 그대로. 줄 색만 바꾸고 머리 키트를 갈아 끼우면 변형을 늘릴 수 있음",
        "swap": {"shirt": "cool", "shirt_sh": "cool_sh", "$lanyard": "wood"},
        "kits": ["kit-head-buddy"],
        "frames": [
            {"name": "sit_type_0", "from": "idle_up", "bob": [2, 16]},
            {"name": "sit_type_1", "from": "idle_up", "bob": [2, 16]},
            {"name": "sit_turn_0", "from": "idle_down", "bob": [2, 16]},
            {"name": "sit_turn_1", "from": "idle_down", "bob": [2, 16]}],
        "stamps": [
            {"frames": ["sit_type_0"], "x": 1, "y": 13, "rows": ["Op"]},
            {"frames": ["sit_type_1"], "x": 13, "y": 13, "rows": ["pO"]},
            {"frames": ["sit_type_0", "sit_type_1"], "x": 3, "y": 14, "rows": ["p........p"]},
            {"dir": "down", "match": ["sit_turn_*"], "x": 12, "y": 12, "rows": ["OOOO", "OWYO", "SWWO", "OOOO"],
             "_note": "과자 봉지(흰 봉지 + 노랑 띠, 상표 없음)"},
            {"match": ["sit_turn_1"], "x": 2, "y": 11, "rows": ["S", "p"], "_note": "웃으며 손 들기"}],
        "anims": [
            {"key": "sit_type", "frames": ["sit_type_0", "sit_type_1"], "frameRate": 4, "repeat": -1},
            {"key": "sit_idle", "frames": ["sit_type_0"], "frameRate": 1, "repeat": -1},
            {"key": "sit_chat", "frames": ["sit_turn_0", "sit_turn_0", "sit_turn_1", "sit_turn_0"], "frameRate": 4, "repeat": -1},
            {"key": "sit_laugh", "frames": ["sit_turn_1"], "frameRate": 1, "repeat": 0}]}, force)
    put(os.path.join(SC, "t146-sample.json"), scene(), force)


if __name__ == "__main__":
    main()
