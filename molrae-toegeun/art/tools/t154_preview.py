#!/usr/bin/env python3
"""T-154 미리보기 보드(4배). 배치는 T-149 와 같음(역할별 남 | 여 나란히).

  python3 art/tools/t154_preview.py
  → art/preview/t154-variants.png   역할 13종 × (남 | 여) 4방향 정지·걷기
    art/preview/t154-special.png    특수 프레임(위장·들킴·들고 걷기·포즈·팀장 순회·배경 앉기) 남 | 여
    art/preview/t154-charsel.png    캐릭터 선택 화면 견본
    art/preview/t154-glance.png     1배 크기(실제 화면 크기) 남녀 한 줄 비교 + 같은 줄 4배
표준 라이브러리만. pixelgen 과 같은 원본을 읽는다.
"""
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ART, "tools"))
import pixelgen as pg  # noqa: E402
import t149_preview as base  # noqa: E402


def board_glance(legend, pal, colors, by):
    """실제 크기(1배)로 남녀를 나란히: 정면·옆·뒤. 4배 보드에서도 1배 영역은 '작게 본 느낌'을 확인하는 용도."""
    dirs = ["idle_down", "idle_right", "idle_up"]
    cw = 17
    W = 4 + len(base.ROLES) * (2 * cw + 6) + 4
    H = 4 + len(dirs) * 24 + 10
    c = pg.Canvas(W, H, colors["floor"])
    for i, r in enumerate(base.ROLES):
        x = 4 + i * (2 * cw + 6)
        for j, fr in enumerate(dirs):
            for gi, g in enumerate("mf"):
                base.put(c, by, legend, colors, pal, "%s_%s/%s" % (r, g, fr), x + gi * cw, 4 + j * 24)
    return c


def main():
    legend, pal, colors, by = base.load()
    for name, fn in [("variants", base.board_variants), ("special", base.board_special),
                     ("charsel", base.board_charsel), ("glance", board_glance)]:
        img = fn(legend, pal, colors, by)
        p = os.path.join(base.OUT, "t154-%s.png" % name)
        img.scaled(4).save(p)
        print("%s %dx%d" % (p, img.w * 4, img.h * 4))
    g = board_glance(legend, pal, colors, by)  # 1배 원본도 함께(실제 화면 크기 확인용)
    p = os.path.join(base.OUT, "t154-glance-1x.png")
    g.save(p)
    print("%s %dx%d" % (p, g.w, g.h))


if __name__ == "__main__":
    main()
