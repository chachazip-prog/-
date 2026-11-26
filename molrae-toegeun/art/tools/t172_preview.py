#!/usr/bin/env python3
"""T-172 비교 미리보기(4배, 내부 검토 전용). 표준 라이브러리만.

  python3 art/tools/t172_preview.py
  → art/preview/t172-compare.png   이전(OLD) | 새(NEW) 비교
       1줄: icon_restroom 12px 원본 · 작은 미션 칩(ui/chip_small) 위 · 8px 면적 평균 축소
       2줄: tile/wall_rest_sign 벽 표지(화장실 벽 줄 견본)
       3줄: fx/head_icon/greet · switch 8px(인물 머리 위, 바닥 배경) + 16px 버튼 아이콘(불변, 참고)
    (-1x 접미어 = 2배, 실기기 화면 배율 근사)
"""
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ART, "tools"))
import pixelgen as pg  # noqa: E402
import t149_preview as base  # noqa: E402
import t166_preview as t166  # noqa: E402
import t172_src as src  # noqa: E402


def old_frame(by, key, rows):
    f = dict(by[key])
    f["rows"] = rows
    return f


def board(legend, pal, colors, by):
    bg = colors["floor"]
    W, H = 4 + 2 * 92 + 8, 150
    c = pg.Canvas(W, H, bg)
    r = lambda f: pg.render(f, legend, colors)  # noqa: E731
    for col, tag in enumerate(["OLD", "NEW"]):
        x0 = 4 + col * 96
        base.label(c, tag, x0, 2, colors["dark"])
        # 1. 미션 칩 아이콘
        f = by["icon_restroom"] if tag == "NEW" else old_frame(by, "icon_restroom", src.OLD["icon_restroom"])
        img = r(f)
        c.blit(img, x0, 12)
        c.blit(r(by["ui/chip_small"]), x0 + 16, 8)
        c.blit(img, x0 + 20, 12)
        c.blit(t166.down_area(img, 8, bg), x0 + 42, 14)
        c.blit(t166.down_nearest(img, 8, bg), x0 + 54, 14)
        # 2. 벽 표지: 화장실 벽 줄(벽·표지·거울) + 바닥
        f = by["tile/wall_rest_sign"] if tag == "NEW" else old_frame(by, "tile/wall_rest_sign", src.OLD["wall_rest_sign"])
        y2 = 36
        for i, k in enumerate(["tile/wall_face", None, "tile/wall_mirror", "tile/wall_face"]):
            c.blit(r(f) if k is None else r(by[k]), x0 + i * 16, y2)
            c.blit(r(by["tile/floor_rest"]), x0 + i * 16, y2 + 16)
        c.blit(r(by["furn/sink"]), x0 + 32, y2 + 16)
        # 3. 머리 위 아이콘
        y3 = 78
        for i, n in enumerate(["greet", "switch"]):
            k = "fx/head_icon/" + n
            f = by[k] if tag == "NEW" else old_frame(by, k, src.OLD[n])
            x = x0 + i * 40
            fl = pg.Canvas(36, 36, bg)
            base.put(fl, by, legend, colors, pal, "player_m/idle_down" if i == 0 else "player_f/idle_down", 10, 12)
            fl.blit(r(f), 14, 2)
            c.blit(fl, x, y3)
            c.blit(r(f), x + 4, y3 + 40)
            c.blit(r(by["ui/action_icon/" + n]), x + 16, y3 + 38)
    return c


def main():
    legend, pal, colors, by = base.load()
    img = board(legend, pal, colors, by)
    for k, suf in ((4, ""), (2, "-1x")):
        p = os.path.join(base.OUT, "t172-compare%s.png" % suf)
        img.scaled(k).save(p)
        print("%s %dx%d" % (p, img.w * k, img.h * k))


if __name__ == "__main__":
    main()
