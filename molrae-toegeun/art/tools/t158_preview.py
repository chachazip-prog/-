#!/usr/bin/env python3
"""T-158 미리보기(4배). 이전 그림은 git 원본(HEAD)에서 읽지 않고 이 파일에 적어 둔 T-149 격자로 비교.

  python3 art/tools/t158_preview.py
  → art/preview/t158-doors.png     화장실 문 표지 4종: 이전 | 새 그림, 아래 줄은 벽에 끼운 견본 + 1배 크기
    art/preview/t158-alert.png     icon_door_alert | ui/alert | ui/suspect 비교 + 문 위에 띄운 견본
    art/preview/t158-disguise.png  위장(disguise) 남 | 여: 이전 | 새 그림, 1배 크기 함께
표준 라이브러리만.
"""
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ART, "tools"))
import pixelgen as pg  # noqa: E402
import t149_preview as base  # noqa: E402

OLD_SIGN = {  # T-149 표지 안쪽 8x8 (비교용)
    "m": ["...DD...", "...DD...", "........", "..DDDD..", ".DDDDDD.", "..DDDD..", "..D..D..", "..D..D.."],
    "f": ["...DD...", "...DD...", "........", "...DD...", "..DDDD..", ".DDDDDD.", "..D..D..", "..D..D.."],
}
COMMON_TOP = ["......O..OOO....", ".....OOOOHHO....", "...OOHHHHHHOO...", "..OHHHDDHHHHHO..",
              "OHHHHDHHHHHHHHO.", ".OHHHHHHHHHHHHO.", ".OHHSSSHSSSSHHO."]
OLD_PAPER = ["OSOWWWWWWWWWWOSO", "OSOWGGGGWWWWWOSO", ".OOWWWWWWWWWWOO.", "..OWMMMMWMMMWO..",
             "..OWWWWWWWWWWO..", "..OWMMMWWMMWWO..", "..OOOOOOOOOOOO..",
             "....ODDDDDDO....", "....ODDOODDO....", "....ODDOODDO....", "....OOOOOOOO...."]
OLD_DIS = {  # T-154 위장(비교용, 서류가 8행부터)
    "m": COMMON_TOP + [".OHSSSOSSSSOSHO.", ".OOOOOOOOOOOOOO."] + OLD_PAPER,
    "f": COMMON_TOP + [".OHHSSOSSSSOHHO.", "OOOOOOOOOOOOOOOO"] + OLD_PAPER,
}


def old_door(g, side):
    b = "C" if side == "mine" else "M"
    rows = ["OLqQQQQQQQQQQqLO", "OLqQQQQQQQQQQqLO", "OLOOOOOOOOOOOOLO", "OLO" + b * 10 + "OLO"]
    rows += ["OLO" + b + r.replace(".", "W") + b + "OLO" for r in OLD_SIGN[g]]
    rows += ["OLO" + b * 10 + "OLO", "OLOOOOOOOOOOOOLO", "OLqQQQQQQQQQQqLO", "OLqqqqqqqqqqqqLO"]
    return {"w": 16, "h": 16, "rows": rows, "swap": {}}


def old_disguise(by, g):
    f = dict(by["player_%s/disguise" % g])
    f["rows"] = OLD_DIS[g]
    return f


def rf(f, legend, colors):
    return pg.render(f, legend, colors)


def board_doors(legend, pal, colors, by):
    keys = [(g, s) for g in "mf" for s in ("mine", "other")]
    W, H = 4 + 4 * 40 + 4, 150
    c = pg.Canvas(W, H, colors["floor"])
    base.label(c, "OLD", 4, 2, colors["dark"])
    base.label(c, "NEW", 4, 26, colors["dark"])
    for i, (g, s) in enumerate(keys):
        x = 4 + i * 40
        base.label(c, "%s %s" % (g, s), x + 16, 2, colors["outline"])
        c.blit(rf(old_door(g, s), legend, colors), x + 16, 8)
        c.blit(rf(by["tile2/wall_door_restroom_%s_%s" % (g, s)], legend, colors), x + 16, 32)
    # 벽에 끼운 견본(복도 벽 1줄 + 바닥 1줄): 남 내 쪽 | 여 다른 쪽 / 남 다른 쪽 | 여 내 쪽
    y = 56
    base.label(c, "IN WALL", 4, y, colors["dark"])
    wall = by.get("tile2/wall_rest") or by.get("tile/wall_front") or None
    for row, pair in enumerate([("m_mine", "f_other"), ("m_other", "f_mine")]):
        yy = y + 8 + row * 34
        for j in range(8):
            c.rect(4 + j * 16, yy, 16, 16, colors["wall"])
            c.rect(4 + j * 16, yy + 12, 16, 4, colors["wall_sh"])
            c.rect(4 + j * 16, yy + 16, 16, 16, colors["floor"])
        c.blit(rf(by["tile2/wall_door_restroom_" + pair[0]], legend, colors), 4 + 2 * 16, yy)
        c.blit(rf(by["tile2/wall_door_restroom_" + pair[1]], legend, colors), 4 + 5 * 16, yy)
        base.put(c, by, legend, colors, pal, "player_f/idle_up", 4 + 2 * 16, yy + 10)
    return c


def board_alert(legend, pal, colors, by):
    W, H = 4 + 3 * 24 + 60, 52
    c = pg.Canvas(W, H, colors["floor"])
    for i, k in enumerate(["icon_door_alert", "ui/alert", "ui/suspect"]):
        base.label(c, ["door", "alert", "suspect"][i], 4 + i * 24, 2, colors["outline"])
        c.blit(rf(by[k], legend, colors), 4 + i * 24, 10)
    # 문 위 견본: 벽 + 문 + 문 위 '!'(원점 하단 중앙 = 문 칸 가운데, 문 윗변 - 2px)
    x0, y0 = 4 + 3 * 24 + 6, 4
    for j in range(3):
        c.rect(x0 + j * 16, y0 + 14, 16, 16, colors["wall"])
        c.rect(x0 + j * 16, y0 + 30, 16, 16, colors["floor"])
    c.blit(rf(by["tile2/wall_door_restroom_m_mine"], legend, colors), x0 + 16, y0 + 14)
    a = by["icon_door_alert"]
    c.blit(rf(a, legend, colors), x0 + 16 + 8 - 6, y0 + 14 - 2 - 12)
    base.put(c, by, legend, colors, pal, "exec_f/idle_down", x0 + 32, y0 + 22)
    c.blit(rf(a, legend, colors), x0 + 32 + 8 - 6, y0 + 22 - 12)
    return c


def board_disguise(legend, pal, colors, by):
    W, H = 4 + 4 * 22 + 8 + 4 * 18, 40
    c = pg.Canvas(W, H, colors["floor"])
    seq = [("m", False), ("f", False), ("m", True), ("f", True)]
    for i, (g, new) in enumerate(seq):
        x = 4 + i * 22
        base.label(c, ("NEW " if new else "OLD ") + g, x, 2, colors["outline"])
        f = by["player_%s/disguise" % g] if new else old_disguise(by, g)
        pg.draw_shadow(c, x + 8, 10 + 21, 11, 4, pg.overlay_rgba(pal, colors, "shadow"))
        c.blit(rf(f, legend, colors), x, 10)
    return c


def main():
    legend, pal, colors, by = base.load()
    for name, fn in [("doors", board_doors), ("alert", board_alert), ("disguise", board_disguise)]:
        img = fn(legend, pal, colors, by)
        p = os.path.join(base.OUT, "t158-%s.png" % name)
        img.scaled(4).save(p)
        print("%s %dx%d" % (p, img.w * 4, img.h * 4))
        p1 = os.path.join(base.OUT, "t158-%s-1x.png" % name)
        img.scaled(2).save(p1)  # 실기기 화면 배율(약 2배)에 가까운 크기 확인용
        print("%s %dx%d" % (p1, img.w * 2, img.h * 2))


if __name__ == "__main__":
    main()
