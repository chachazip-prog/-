#!/usr/bin/env python3
"""T-146 검수용 미리보기 보드(4배). pixelgen 의 로더·렌더러를 그대로 쓴다(표준 라이브러리만).

  python3 art/tools/t146_preview.py
  → art/preview/t146-icons.png, t146-carry.png, t146-buddy.png, t146-ui.png
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pixelgen as pg  # noqa: E402

ART = pg.ART


def load():
    legend = pg.load_json(os.path.join(ART, "src", "legend.json"))["keys"]
    pal = pg.load_json(os.path.join(ART, "palette.json"))
    colors = {k: pg.hex_rgba(v) for k, v in pal["colors"].items()}
    frames, _, errs = pg.load_sprites(os.path.join(ART, "src"), legend)
    if errs:
        sys.exit("\n".join(errs))
    return {f["key"]: f for f in frames}, legend, colors, pal


def board(rows, by, legend, colors, pal, bg="floor", scale_small=1, shadow_keys=()):
    """rows = [(제목, [키…])]. 키마다 칸 하나, 칸 크기 = 행에서 가장 큰 프레임 + 여백."""
    gap, lab = 6, 8
    lay = []
    W = 0
    y = gap
    for title, keys in rows:
        fs = [by[k] for k in keys]
        cw = max(f["w"] for f in fs) * scale_small
        ch = max(f["h"] for f in fs) * scale_small
        lay.append((title, fs, cw, ch, y))
        W = max(W, gap + len(fs) * (cw + gap))
        y += lab + ch + gap * 2
    H = y
    c = pg.Canvas(max(W, 120), H, colors[bg])
    sh = pg.overlay_rgba(pal, colors, "shadow")
    for title, fs, cw, ch, y0 in lay:
        pg.draw_text(c, title.upper(), gap, y0, colors["dark"])
        x = gap
        for f in fs:
            img = pg.render(f, legend, colors)
            if scale_small > 1:
                img = img.scaled(scale_small)
            ox = x + (cw - img.w) // 2
            oy = y0 + lab + (ch - img.h)
            if f["sprite"] in shadow_keys:
                pg.draw_shadow(c, ox + img.w / 2.0, oy + img.h + 1, 11, 4, sh)
            c.blit(img, ox, oy)
            x += cw + gap
    return c


def chip(by, legend, colors, icon, mod):
    """미션 칩 모형: 흰 둥근 판 20x20 + 아이콘 + 오른쪽 위 배지(겹침 확인용)."""
    c = pg.Canvas(24, 24)
    c.rect(1, 3, 20, 20, colors["outline"])
    c.rect(2, 4, 18, 18, colors["white"])
    c.blit(pg.render(by[icon], legend, colors), 5, 7)
    if mod:
        c.blit(pg.render(by[mod], legend, colors), 15, 0)
    return c


def main():
    by, legend, colors, pal = load()
    out = os.path.join(ART, "preview")
    mission = ["icon_parcel", "icon_print", "icon_chat", "icon_bank", "icon_cafe", "icon_window"]
    tour = ["icon_tour_printer", "icon_tour_cup", "icon_tour_meeting", "icon_tour_talk", "icon_tour_report"]
    mods = ["mod/" + k for k in ("rush", "relocate", "double", "carry", "avoid", "silent", "bonus",
                                 "during_tour", "deadline", "zone_only")]
    avoid = ["mod/avoid_" + k for k in ("snitch", "team_lead", "director", "hr_inspector", "security_guard")]
    c = board([("mission icons", mission), ("tour bubble icons", tour), ("modifier badges", mods),
               ("avoid target dot", avoid), ("hud tl away + chair + chair with coat", ["hud/tl_away", "furn/chair_high", "furn/chair_high_jacket"]),
               ("fx cup ready + where hint + cover", ["fx/cup_ready", "fx/cup_ready_1", "fx/zone_hint", "fx/zone_hint_1", "fx/cover_glint_0"]),
               ("props", ["prop/parcel_box", "prop/paper_stack", "prop/cafe_cup"]),
               ("printer tray 0-4", ["prop/printer_tray_%d" % i for i in range(5)]),
               ("side window l r", ["tile/wall_cap_l", "tile2/wall_blind_side_l", "tile2/wall_blind_side_r", "tile/wall_cap_r"])],
              by, legend, colors, pal)
    # 칩 모형 줄(실제 칩 위 배지 겹침)
    chips = [chip(by, legend, colors, mission[i % 6], m) for i, m in enumerate(mods + avoid)]
    W = max(c.w, 6 + len(chips) * 28)
    c2 = pg.Canvas(W, c.h + 40, colors["floor"])
    c2.blit(c, 0, 0)
    pg.draw_text(c2, "CHIP MOCK", 6, c.h + 2, colors["dark"])
    for i, ch in enumerate(chips):
        c2.blit(ch, 6 + i * 28, c.h + 12)
    c2.scaled(4).save(os.path.join(out, "t146-icons.png"))

    rows = []
    for it in ("box", "paper", "cup"):
        ks = []
        for d in ("down", "up", "left", "right"):
            ks += ["player/carry_%s_%s" % (it, d), "player/carry_%s_%s_0" % (it, d), "player/carry_%s_%s_1" % (it, d)]
        rows.append(("carry " + it, ks))
        rows.append(("hold " + it, ["player/pose_hold_%s_%s_%d" % (it, d, i) for d in ("down", "left", "right") for i in (0, 1)]))
    rows.append(("nap sofa  breath  nod", ["player/pose_nap_on_sofa_down_0", "player/pose_nap_on_sofa_down_1",
                                           "player/pose_breath_right_0", "player/pose_breath_right_1",
                                           "player/pose_breath_left_0", "player/pose_breath_left_1",
                                           "player/pose_nod_up_0", "player/pose_nod_up_1", "player/idle_down"]))
    board(rows, by, legend, colors, pal, shadow_keys=("player",)).scaled(4).save(os.path.join(out, "t146-carry.png"))

    bud = ["bg_buddy/idle_down", "bg_buddy/walk_down_0", "bg_buddy/walk_down_1", "bg_buddy/idle_up", "bg_buddy/walk_up_0",
           "bg_buddy/idle_left", "bg_buddy/walk_left_0", "bg_buddy/idle_right", "bg_buddy/walk_right_0", "bg_buddy/sit_type_0",
           "bg_buddy/sit_type_1", "bg_buddy/sit_turn_0", "bg_buddy/sit_turn_1"]
    cmp_ = ["player/idle_down", "bg_a/idle_down", "bg_b/idle_down", "bg_c/idle_down", "snitch/idle_down",
            "accomplice/idle_down", "hr/idle_down", "guard/idle_down", "teamlead/idle_down", "bg_buddy/idle_down"]
    board([("bg buddy", bud), ("lineup lanyard check", cmp_)], by, legend, colors, pal,
          shadow_keys=tuple(set(by[k]["sprite"] for k in bud + cmp_))).scaled(4).save(os.path.join(out, "t146-buddy.png"))

    board([("bank app  step  check", ["ui/bank_app", "ui/bank_step_on", "ui/bank_check_on"]),
           ("coupon card  stamp", ["ui/coupon_card", "ui/coupon_stamp"])], by, legend, colors, pal,
          bg="light").scaled(4).save(os.path.join(out, "t146-ui.png"))
    print("t146 previews written")


if __name__ == "__main__":
    main()
