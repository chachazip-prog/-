#!/usr/bin/env python3
"""T-166 미리보기(4배, 내부 검토 전용). 표준 라이브러리만.

  python3 art/tools/t166_preview.py
  → art/preview/t166-icons.png   순회 아이콘 8종: 12px 원본 | 8px 최근접 축소 | 8px 면적 평균 축소(브라우저 부드러운 축소 근사)
                                 위 2줄 = 혼동 쌍 비교(cup | water, report | memo), 아래 = 전체 8종 나란히
    art/preview/t166-wall.png    팀 모듈 견본: 왼쪽 벽 화이트보드 + 오른쪽 벽 정수기(+ 반전 짝), 팀장 남/여 옆모습 대기,
                                 책상 메모지 겹침(모니터 책상 | 서류 책상) 전/후
    art/preview/t166-teamlead.png 팀장 남 | 여: idle_right · wait_side_right_1 · idle_left · wait_side_left_1
    (-1x 접미어 = 2배, 실기기 화면 배율 근사)
"""
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ART, "tools"))
import pixelgen as pg  # noqa: E402
import t149_preview as base  # noqa: E402

TOUR = ["icon_tour_printer", "icon_tour_cup", "icon_tour_meeting", "icon_tour_talk", "icon_tour_report",
        "icon_tour_board", "icon_tour_water", "icon_tour_memo"]


def rf(by, k, legend, colors):
    return pg.render(by[k], legend, colors)


def down_nearest(img, n, bg):
    out = pg.Canvas(n, n, bg)
    for y in range(n):
        for x in range(n):
            c = img.px[(y * img.h // n) * img.w + x * img.w // n]
            if c[3]:
                out.px[y * n + x] = c
    return out


def down_area(img, n, bg):
    """면적 평균 축소(배경 위에 합성 후). 12 → 8 은 1.5px 상자."""
    s = img.w / float(n)
    out = pg.Canvas(n, n, bg)
    for y in range(n):
        for x in range(n):
            acc = [0.0, 0.0, 0.0]
            tot = 0.0
            y0, y1, x0, x1 = y * s, (y + 1) * s, x * s, (x + 1) * s
            for sy in range(int(y0), min(img.h, int(y1 + 0.999))):
                wy = min(y1, sy + 1) - max(y0, sy)
                for sx in range(int(x0), min(img.w, int(x1 + 0.999))):
                    wx = min(x1, sx + 1) - max(x0, sx)
                    w = wx * wy
                    if w <= 0:
                        continue
                    c = img.px[sy * img.w + sx]
                    c = c if c[3] else bg
                    for i in range(3):
                        acc[i] += c[i] * w
                    tot += w
            out.px[y * n + x] = tuple(int(round(a / tot)) for a in acc) + (255,)
    return out


def cell(c, img, bg, x, y):
    c.blit(img, x, y)
    c.blit(down_nearest(img, 8, bg), x + 15, y + 2)
    c.blit(down_area(img, 8, bg), x + 26, y + 2)


def board_icons(legend, pal, colors, by):
    bg = colors["floor"]
    W, H = 4 + 2 * 40 + 8 + 4, 12 + 2 * 18 + 10 + 2 * 18 + 4
    c = pg.Canvas(W, H, bg)
    base.label(c, "12 NN8 AV8", 4, 2, colors["dark"])
    pairs = [("icon_tour_cup", "icon_tour_water"), ("icon_tour_report", "icon_tour_memo")]
    for r, pr in enumerate(pairs):
        for j, k in enumerate(pr):
            cell(c, rf(by, k, legend, colors), bg, 4 + j * 46, 10 + r * 18)
    y = 10 + 2 * 18 + 4
    base.label(c, "ALL 8", 4, y, colors["dark"])
    for i, k in enumerate(TOUR):
        img = rf(by, k, legend, colors)
        x = 4 + (i % 4) * 22
        yy = y + 8 + (i // 4) * 18
        c.blit(img, x, yy)
        c.blit(down_area(img, 8, bg), x + 13, yy + 2)
    return c


def board_wall(legend, pal, colors, by):
    cols, rows = 11, 6
    c = pg.Canvas(cols * 16 + 8, rows * 16 + 30, colors["floor"])
    ox, oy = 4, 4
    for ty in range(rows):
        for tx in range(cols):
            if tx == 0:
                k = "tile2/wall_whiteboard_side_l" if ty == 2 else "tile/wall_cap_l"
            elif tx == cols - 1:
                k = "tile2/wall_water_side_r" if ty == 2 else "tile/wall_cap_r"
            else:
                k = "tile/floor" if (tx + ty) % 2 else "tile/floor_b"
            c.blit(rf(by, k, legend, colors), ox + tx * 16, oy + ty * 16)
    # 반전 짝: 아래 줄에 왼쪽 정수기 / 오른쪽 화이트보드
    c.blit(rf(by, "tile2/wall_water_side_l", legend, colors), ox, oy + 4 * 16)
    c.blit(rf(by, "tile2/wall_whiteboard_side_r", legend, colors), ox + (cols - 1) * 16, oy + 4 * 16)
    # 팀장: 화이트보드 앞(왼쪽 보기, 남) · 정수기 앞(오른쪽 보기, 여) · 반전 줄
    base.put(c, by, legend, colors, pal, "teamlead_m/wait_side_left_1", ox + 16, oy + 2 * 16 - 4)
    base.put(c, by, legend, colors, pal, "teamlead_f/idle_right", ox + (cols - 2) * 16, oy + 2 * 16 - 4)
    base.put(c, by, legend, colors, pal, "teamlead_f/wait_side_left_1", ox + 16, oy + 4 * 16 - 4)
    base.put(c, by, legend, colors, pal, "teamlead_m/wait_side_right_1", ox + (cols - 2) * 16, oy + 4 * 16 - 4)
    # 책상 메모: 전 | 후
    for i, (desk, memo) in enumerate([("furn/desk_monitor", "furn2/desk_memo"),
                                      ("furn/desk_papers", "furn2/desk_memo_papers")]):
        for j in range(2):
            x = ox + 3 * 16 + i * 48 + j * 18
            c.blit(rf(by, desk, legend, colors), x, oy + 16)
            if j:
                c.blit(rf(by, memo, legend, colors), x, oy + 16)
    y = oy + rows * 16 + 4
    base.label(c, "L BOARD  R WATER  ROW5 MIRROR", 4, y, colors["dark"])
    for i, k in enumerate(["tile2/wall_whiteboard_side_l", "tile2/wall_whiteboard_side_r",
                           "tile2/wall_water_side_l", "tile2/wall_water_side_r", "tile2/wall_blind_side_l"]):
        c.blit(rf(by, k, legend, colors), 4 + i * 20, y + 8)
    return c


def board_teamlead(legend, pal, colors, by):
    seq = ["idle_right", "wait_side_right_1", "idle_left", "wait_side_left_1", "wait_up_0", "wait_up_1"]
    c = pg.Canvas(4 + len(seq) * 18 + 4, 4 + 2 * 30, colors["floor"])
    for r, g in enumerate("mf"):
        for i, f in enumerate(seq):
            base.put(c, by, legend, colors, pal, "teamlead_%s/%s" % (g, f), 4 + i * 18, 6 + r * 30)
    return c


def main():
    legend, pal, colors, by = base.load()
    for name, fn in [("icons", board_icons), ("wall", board_wall), ("teamlead", board_teamlead)]:
        img = fn(legend, pal, colors, by)
        for k, suf in ((4, ""), (2, "-1x")):
            p = os.path.join(base.OUT, "t166-%s%s.png" % (name, suf))
            img.scaled(k).save(p)
            print("%s %dx%d" % (p, img.w * k, img.h * k))


if __name__ == "__main__":
    main()
