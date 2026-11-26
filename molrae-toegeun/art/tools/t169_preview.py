#!/usr/bin/env python3
"""T-169 미리보기(4배, 내부 검토 전용). 표준 라이브러리만.

  python3 art/tools/t169_preview.py
  → art/preview/t169-mock-right.png  목업: 게임 화면(t135 견본 장면 위 14칸) + 조작대(오른손 배치). 180x320
    art/preview/t169-mock-left.png   목업: 왼손 배치(좌우 거울) — 패드 얼음 + 튜토리얼 손(거울) + 인사 버튼
    art/preview/t169-states.png      상태 보드: 패드 3상태 x 화살표 기본/눌림, 버튼 4상태, 칩 4상태, 아이콘 17 + 머리 위 8px,
                                     발자국·핀·사용 표시·범프, 튜토리얼 손(오른손 | 왼손 거울)
    art/preview/t169-stepback.png    흠칫 반걸음: 플레이어 기본·남·여 x 4방향(걷기 → _0 → _1 → 위장)
    (-1x 접미어 = 2배, 실기기 화면 배율 근사)
목업의 상단 HUD·라벨·상태줄은 회색 막대 자리 표시(글자 없음). 배치 좌표는 design/control-dpad.md §2-2.
"""
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ART, "tools"))
import pixelgen as pg  # noqa: E402
import t149_preview as base  # noqa: E402

ICONS = ["greet", "nod", "stop", "exit", "head", "switch", "bite", "tag", "pack", "accept", "use", "start",
         "pickup", "grab", "order", "breath", "idle"]

# 패드 프레임(64) 기준 화살표 16x16 중심 오프셋(판 면 중심 = 프레임 (32, 30.5))
ARROW_OFF = {"up": (0, -21), "down": (0, 19), "left": (-20, -1), "right": (20, -1)}


class Ctx:
    def __init__(self):
        self.legend, self.pal, self.colors, self.by = base.load()

    def img(self, key, flip=False):
        im = pg.render(self.by[key], self.legend, self.colors)
        return im

    def put(self, c, key, x, y, flip=False):
        c.blit(self.img(key), int(x), int(y), flip)

    def put_c(self, c, key, cx, cy, flip=False):
        f = self.by[key]
        self.put(c, key, cx - f["w"] / 2.0, cy - f["h"] / 2.0, flip)


def draw_pad(ctx, c, cx, cy, state="", pressed=None):
    ctx.put_c(c, "ui/dpad_base" + state, cx, cy)
    for d, (dx, dy) in ARROW_OFF.items():
        k = "ui/dpad_arrow_%s%s" % (d, "_pressed" if d == pressed else "")
        ctx.put_c(c, k, cx + dx, cy + dy)


def draw_btn(ctx, c, cx, cy, icon, state=""):
    ctx.put_c(c, "ui/action_btn" + state, cx, cy)
    ctx.put_c(c, "ui/action_icon/" + icon, cx, cy + (0 if state == "_pressed" else -1))


def draw_chip(ctx, c, x, y, icon, state=""):
    ctx.put(c, "ui/chip_small" + state, x, y)
    ctx.put_c(c, icon, x + 10, y + 9.5)


def bar(c, x, y, w, h, col):
    c.rect(x, y, w, h, col)


def mock(ctx, left):
    col = ctx.colors
    W, H = 180, 320
    c = pg.Canvas(W, H, col["outline"])
    # 게임 화면: 견본 장면(플레이어 빼고) 위 14칸
    sc = pg.load_json(os.path.join(base.SRC, "scenes", "t135-sample.json"))
    sc = dict(sc)
    sc["objects"] = [o for o in sc["objects"] if not o["sprite"].startswith("player/")]
    scene = pg.build_scene(sc, ctx.by, ctx.legend, col, ctx.pal)
    game = pg.Canvas(W, 224, col["outline"])
    game.blit(scene, 2, -16)
    T = lambda tx, ty: (2 + tx * 16, -16 + ty * 16)  # noqa: E731  칸 왼쪽 위(게임 화면 좌표)
    # 길 안내: 플레이어(4,11) → 위로 5칸 발자국, 목적지 핀 = 게이트 앞(5,5)
    px, py = T(5, 11)
    for (tx, ty) in [(5, 10), (5, 9), (5, 8), (5, 7), (5, 6)]:
        x, y = T(tx, ty)
        ctx.put(game, "fx/guide_step_%d" % ((tx + ty) % 2 if not left else 0), x + 4, y + 4)
    x, y = T(5, 5)
    ctx.put(game, "fx/guide_pin", x + 4, y + 16 - 12 - 4)
    # 사용 표시: 경비 부스 위(왼쪽) / 범프: 오른쪽 유리벽 앞
    x, y = T(1, 4)
    ctx.put(game, "fx/use_hint_0", x + 8, y + 2)
    if left:
        base.put(game, ctx.by, ctx.legend, col, ctx.pal, "player_f/disguise", px, py - 4)
        ctx.put(game, "fx/head_icon/greet", px + 4, py - 14)
    else:
        base.put(game, ctx.by, ctx.legend, col, ctx.pal, "player_m/walk_up_0", px, py - 4)
        ctx.put(game, "fx/head_icon/use", px + 4, py - 14)
        x, y = T(7, 9)
        base.put(game, ctx.by, ctx.legend, col, ctx.pal, "player_f/disguise_step_back_right_0", x, y - 4)
        ctx.put(game, "fx/bump_0", x + 14, y + 4)
    c.blit(game, 0, 24)
    # 상단 HUD 24px(자리 표시)
    bar(c, 0, 0, W, 24, col["white"])
    bar(c, 0, 23, W, 1, col["outline"])
    bar(c, 4, 7, 26, 10, col["light"])
    bar(c, 36, 9, 50, 6, col["light"])
    bar(c, 36, 9, 18, 6, col["point2"])
    bar(c, 94, 9, 50, 6, col["light"])
    bar(c, 94, 9, 30, 6, col["green"])
    ctx.put(c, "icon_snack", 158, 6)
    # 조작대
    dk = pg.Canvas(W, 72)
    ctx.put(dk, "ui/deck_bg", 0, 0)
    chips = [("icon_coffee", "_guide"), ("icon_snack", ""), ("icon_nap", "_locked"), ("icon_shopping", "_done")]
    for i, (ic, st) in enumerate(chips):
        draw_chip(ctx, dk, 3 + (i % 2) * 22, 5 + (i // 2) * 22, ic, st)
    # 상태줄(y 300~316): 발자국 + 회색 막대
    ctx.put(dk, "fx/guide_step_0", 3, 54)
    bar(dk, 13, 56, 30, 5, col["mid"])
    if left:
        draw_btn(ctx, dk, 74, 32, "greet", "_pulse_1")
        draw_pad(ctx, dk, 141, 36, "_frozen")
    else:
        draw_btn(ctx, dk, 74, 32, "use")
        draw_pad(ctx, dk, 141, 36, "", pressed="up")
    bar(dk, 67, 57, 14, 5, col["mid"])  # 버튼 라벨 자리(y 304)
    if left:
        dk = pg.Canvas(W, 72, (0, 0, 0, 0))
        tmp = pg.Canvas(W, 72)
        ctx.put(tmp, "ui/deck_bg", 0, 0)
        for i, (ic, st) in enumerate(chips):
            draw_chip(ctx, tmp, 3 + (i % 2) * 22, 5 + (i // 2) * 22, ic, st)
        # 거울: 칩·상태줄·버튼·패드 위치만 x → 180 - x (그림은 뒤집지 않음, 손 그림만 거울)
        dk = pg.Canvas(W, 72)
        ctx.put(dk, "ui/deck_bg", 0, 0)
        for i, (ic, st) in enumerate(chips):
            x = 180 - (3 + (i % 2) * 22) - 20
            draw_chip(ctx, dk, x, 5 + (i // 2) * 22, ic, st)
        ctx.put(dk, "fx/guide_step_0", 180 - 45, 54)
        bar(dk, 180 - 35, 56, 30, 5, col["mid"])
        draw_btn(ctx, dk, 180 - 74, 32, "greet", "_pulse_1")
        bar(dk, 180 - 81, 57, 14, 5, col["mid"])
        draw_pad(ctx, dk, 180 - 141, 36, "_frozen")
        f = ctx.by["tutorial/hand_release_0"]
        # 원점(손끝) = 패드 중심. 거울이면 원점 x = 1 - 0.4375
        ox = (1 - f["origin"][0]) * f["w"]
        c2 = ctx.img("tutorial/hand_release_0")
        dk.blit(c2, int(180 - 141 - ox), int(35 - f["origin"][1] * f["h"]), True)
    c.blit(dk, 0, 248)
    return c


def board_states(ctx):
    col = ctx.colors
    W, H = 300, 236
    c = pg.Canvas(W, H, col["wall"])
    lb = lambda s, x, y: base.label(c, s, x, y, col["dark"])  # noqa: E731
    lb("PAD BASE / LOCKED / FROZEN  ARROW UP-DOWN-L-R PRESSED", 4, 2)
    for i, st in enumerate(["", "_locked", "_frozen"]):
        draw_pad(ctx, c, 4 + 32 + i * 70, 10 + 33, st, pressed=["up", "down", "right"][i])
    for i, d in enumerate(["up", "down", "left", "right"]):
        ctx.put(c, "ui/dpad_arrow_" + d, 216 + i * 20, 14)
        ctx.put(c, "ui/dpad_arrow_%s_pressed" % d, 216 + i * 20, 34)
    lb("BUTTON N/PRESS/DIM/PULSE", 4, 80)
    for i, st in enumerate(["", "_pressed", "_dim", "_pulse_1"]):
        draw_btn(ctx, c, 4 + 20 + i * 44, 88 + 21, ["use", "use", "idle", "start"][i], st)
    lb("CHIP N/LOCK/DONE/GUIDE", 184, 80)
    for i, st in enumerate(["", "_locked", "_done", "_guide"]):
        draw_chip(ctx, c, 184 + i * 26, 90, "icon_coffee", st)
    for i, st in enumerate(["", "_locked", "_done", "_guide"]):
        ctx.put(c, "ui/chip_small" + st, 184 + i * 26, 114)
    lb("ICON 16 + HEAD 8", 4, 136)
    for i, n in enumerate(ICONS):
        x = 4 + (i % 9) * 32
        y = 144 + (i // 9) * 22
        ctx.put(c, "ui/action_icon/" + n, x, y)
        ctx.put(c, "fx/head_icon/" + n, x + 18, y + 4)
    lb("STEP PIN USE BUMP  HAND R / L", 4, 190)
    fl = pg.Canvas(140, 36, col["floor"])
    for i, k in enumerate(["fx/guide_step_0", "fx/guide_step_1", "fx/guide_pin", "fx/use_hint_0", "fx/use_hint_1",
                           "fx/bump_0", "fx/bump_1"]):
        f = ctx.by[k]
        ctx.put(fl, k, 4 + i * 18, 26 - f["h"])
    c.blit(fl, 4, 198)
    for i in range(2):
        ctx.put(c, "tutorial/hand_release_%d" % i, 160 + i * 20, 206)
        c.blit(ctx.img("tutorial/hand_release_%d" % i), 210 + i * 20, 206, True)
    return c


def board_stepback(ctx):
    col = ctx.colors
    seq = {
        "down": ["walk_down_0", "disguise_step_back_down_0", "disguise_step_back_down_1", "disguise"],
        "up": ["walk_up_0", "disguise_step_back_up_0", "disguise_step_back_up_1", "disguise"],
        "right": ["walk_right_0", "disguise_step_back_right_0", "disguise_step_back_right_1", "pose_read_document_right"],
        "left": ["walk_left_0", "disguise_step_back_left_0", "disguise_step_back_left_1", "pose_read_document_left"],
    }
    roles = ["player", "player_m", "player_f"]
    W = 4 + 4 * (4 * 18 + 8)
    H = 10 + len(roles) * 28
    c = pg.Canvas(W, H, col["floor"])
    base.label(c, "DOWN                UP                  RIGHT               LEFT", 4, 1, col["dark"])
    for r, role in enumerate(roles):
        for di, d in enumerate(["down", "up", "right", "left"]):
            for j, fr in enumerate(seq[d]):
                base.put(c, ctx.by, ctx.legend, col, ctx.pal, "%s/%s" % (role, fr), 4 + di * 80 + j * 18, 8 + r * 28)
    return c


def main():
    ctx = Ctx()
    for name, img in [("mock-right", mock(ctx, False)), ("mock-left", mock(ctx, True)),
                      ("states", board_states(ctx)), ("stepback", board_stepback(ctx))]:
        for k, suf in ((4, ""), (2, "-1x")):
            p = os.path.join(base.OUT, "t169-%s%s.png" % (name, suf))
            img.scaled(k).save(p)
            print("%s %dx%d" % (p, img.w * k, img.h * k))


if __name__ == "__main__":
    main()
