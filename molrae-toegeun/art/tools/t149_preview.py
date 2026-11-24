#!/usr/bin/env python3
"""T-149 미리보기 보드(4배): 역할별 남녀 나란히 + 특수 프레임 + 시설·표식·선택 화면.

  python3 art/tools/t149_preview.py
  → art/preview/t149-variants.png   역할 13종 × (남 | 여) 4방향 정지·걷기
    art/preview/t149-special.png    특수 프레임(위장·들킴·들고 걷기·포즈·팀장 순회·배경 앉기) 남 | 여
    art/preview/t149-facility.png   화장실 문 표지 4종, 샤워 칸, 사물함, 성별 화장실 모듈 견본, 표식, kit-carry-b 시연
    art/preview/t149-charsel.png    캐릭터 선택 화면 견본(카드 2장 같은 크기·같은 강조, 선택 전/한쪽 선택)
표준 라이브러리만. pixelgen 과 같은 원본을 읽는다(kit-carry-b 시연용 임시 스프라이트는 메모리에서만 만듦).
"""
import copy
import json
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ART, "tools"))
import pixelgen as pg  # noqa: E402

SRC = os.path.join(ART, "src")
OUT = os.path.join(ART, "preview")
ROLES = ["player", "senior", "teamlead", "exec", "ceo", "guard", "snitch", "accomplice", "hr",
         "bg_a", "bg_b", "bg_c", "bg_buddy"]
DIRS = ["down", "up", "left", "right"]


def load():
    legend = pg.load_json(os.path.join(SRC, "legend.json"))["keys"]
    pal = pg.load_json(os.path.join(ART, "palette.json"))
    colors = {k: pg.hex_rgba(v) for k, v in pal["colors"].items()}
    frames, _, errs = pg.load_sprites(SRC, legend)
    if errs:
        sys.exit("\n".join(errs))
    return legend, pal, colors, {f["key"]: f for f in frames}


def label(c, s, x, y, col):
    pg.draw_text(c, s.upper().replace("_", "-"), x, y, col)


def put(c, by, legend, colors, pal, key, x, y, shadow=True):
    f = by[key]
    if shadow and f["h"] == 20:
        pg.draw_shadow(c, x + f["w"] / 2.0, y + f["h"] + 1, 11, 4, pg.overlay_rgba(pal, colors, "shadow"))
    c.blit(pg.render(f, legend, colors), x, y)


def board_variants(legend, pal, colors, by):
    seq = []
    for d in DIRS:
        seq += ["idle_" + d, "walk_%s_0" % d, "walk_%s_1" % d]
    cw, gap = 18, 2
    half = len(seq) * cw
    W = 4 + 2 * half + 12 + 4
    rowh = 34
    H = 12 + len(ROLES) * rowh
    c = pg.Canvas(W, H, colors["floor"])
    label(c, "M", 4, 2, colors["dark"])
    label(c, "F", 4 + half + 12, 2, colors["dark"])
    for i, r in enumerate(ROLES):
        y = 12 + i * rowh
        label(c, r, 4, y, colors["outline"])
        for gi, g in enumerate("mf"):
            x0 = 4 + gi * (half + 12)
            for j, fr in enumerate(seq):
                put(c, by, legend, colors, pal, "%s_%s/%s" % (r, g, fr), x0 + j * cw, y + 8)
        c.rect(4 + half + 5, y + 6, 1, 24, colors["wall_sh"])
    return c


SPECIAL = [
    ("player", ["disguise", "caught", "carry_box_down", "carry_paper_right", "carry_cup_up", "pose_hold_cup_down_1",
                "pose_drink_water_down_0", "pose_check_phone_right_0", "pose_water_plant_down_0", "pose_copying_right_0",
                "pose_read_document_right", "pose_nap_on_sofa_down_0", "pose_breath_right_1", "pose_nod_up_1"]),
    ("teamlead", ["sit_up", "rise_up_0", "rise_up_1", "sit_down", "rise_down_0", "rise_down_1", "wait_up_0", "wait_up_1"]),
    ("bg_a", ["sit_type_0", "sit_type_1", "sit_stretch_0", "sit_stretch_1"]),
    ("bg_b", ["sit_type_0", "stand_phone_right_0", "stand_phone_right_1", "stand_phone_left_1"]),
    ("bg_c", ["sit_type_0", "sit_type_1"]),
    ("bg_buddy", ["sit_type_0", "sit_turn_0", "sit_turn_1"]),
]


def board_special(legend, pal, colors, by):
    cw = 18
    ncol = max(len(f) for _, f in SPECIAL)
    W = 30 + ncol * cw + 4
    rowh = 26
    H = 4 + sum(2 * rowh + 10 for _ in SPECIAL)
    c = pg.Canvas(W, H, colors["floor"])
    y = 4
    for r, fs in SPECIAL:
        label(c, r, 2, y, colors["outline"])
        y += 7
        for g in "mf":
            label(c, g, 2, y + 8, colors["dark"])
            for j, fr in enumerate(fs):
                put(c, by, legend, colors, pal, "%s_%s/%s" % (r, g, fr), 30 + j * cw, y)
            y += rowh
        y += 3
    return c


def carry_b_demo(legend):
    """kit-carry-b 시연: bg_buddy 원본에 kit-carry-b 를 붙인 임시 스프라이트(출력 안 함)."""
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp()
    try:
        shutil.copytree(SRC, os.path.join(tmp, "src"))
        d = pg.load_json(os.path.join(tmp, "src", "sprites", "char-buddy.json"))
        d["kits"] = d.get("kits", []) + ["kit-carry-b"]
        with open(os.path.join(tmp, "src", "sprites", "char-buddy.json"), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        frames, _, errs = pg.load_sprites(os.path.join(tmp, "src"), legend)
        if errs:
            sys.exit("\n".join(errs))
        return {f["key"]: f for f in frames}
    finally:
        shutil.rmtree(tmp)


def board_facility(legend, pal, colors, by):
    W, H = 220, 176
    c = pg.Canvas(W, H, colors["wall"])
    label(c, "DOOR M-MINE M-OTH", 4, 0, colors["outline"])
    label(c, "F-MINE F-OTH", 48, 6, colors["outline"])
    for i, s in enumerate(["m_mine", "m_other", "f_mine", "f_other"]):
        c.blit(pg.render(by["tile2/wall_door_restroom_" + s], legend, colors), 4 + i * 22, 11)
    label(c, "SHOWER", 104, 0, colors["outline"])
    label(c, "LOCKER", 140, 3, colors["outline"])
    c.blit(pg.render(by["tile2/shower_stall"], legend, colors), 100, 6)
    c.blit(pg.render(by["tile2/shower_stall_hiding"], legend, colors), 118, 6)
    c.blit(pg.render(by["tile2/wall_locker"], legend, colors), 140, 11)
    c.blit(pg.render(by["tile2/floor_locker"], legend, colors), 158, 11)
    # 성별 화장실 쌍 모듈 견본(mid_rest_meet_g 4행, 오늘 내 쪽 = a 위, 여자 플레이어 기준 예시)
    label(c, "REST-MEET-G  MINE = A (F PLAYER)", 4, 34, colors["outline"])
    mod = ["#Srr+.g...#", "#####.g.MM#", "#####.=.MM#", "#Srr+.gh..#"]
    ox, oy = 4, 44
    T = 16
    for ty, line in enumerate(mod):
        for tx, ch in enumerate(line):
            k = {"#": "tile/wall_cap_v", "r": "tile/floor_rest", "S": "tile/floor_rest", ".": "tile/floor",
                 "g": "tile/floor", "h": "tile/floor", "=": "tile/floor", "M": "tile/floor_meet",
                 "+": "tile2/wall_door_restroom_f_mine" if ty == 0 else "tile2/wall_door_restroom_m_other"}[ch]
            c.blit(pg.render(by[k], legend, colors), ox + tx * T, oy + ty * T)
            if ch == "S":
                f = by["tall/stall"]
                c.blit(pg.render(f, legend, colors), ox + tx * T, oy + (ty + 1) * T - f["h"] + 1)
            if ch == "r" and tx == 2:
                f = by["furn/sink"]
                c.blit(pg.render(f, legend, colors), ox + tx * T, oy + (ty + 1) * T - f["h"])
    # 인물 + 표식 (같은 성별 본부장 / 다른 성별 본부장)
    for i, (who, mk) in enumerate([("exec_f", "mark/gender_same"), ("exec_m", "mark/gender_other")]):
        x, y = ox + (6 + i * 3) * T, oy + 1 * T + 12
        put(c, by, legend, colors, pal, who + "/idle_down", x, y - 20)
        m = by[mk]
        c.blit(pg.render(m, legend, colors), x + 2, y - 20 - 13)
    put(c, by, legend, colors, pal, "player_f/idle_right", ox + 5 * T, oy + 3 * T - 4)
    label(c, "MARK 12 / 8", 4, 112, colors["outline"])
    for i, k in enumerate(["mark/gender_same", "mark/gender_other"]):
        c.blit(pg.render(by[k], legend, colors), 4 + i * 16, 120)
    for i, k in enumerate(["mark/gender_same_s", "mark/gender_other_s"]):
        c.blit(pg.render(by[k], legend, colors), 40 + i * 12, 124)
    label(c, "KIT-CARRY-B DEMO", 4, 140, colors["outline"])
    demo = carry_b_demo(legend)
    ks = ["carry_box_down", "carry_box_up", "carry_box_right", "carry_paper_down", "carry_paper_up",
          "carry_cup_down", "carry_cup_up", "carry_cup_right", "pose_hold_box_down_1", "pose_hold_cup_down_1"]
    for i, k in enumerate(ks):
        f = demo["bg_buddy/" + k]
        pg.draw_shadow(c, 4 + i * 20 + 8, 150 + 21, 11, 4, pg.overlay_rgba(pal, colors, "shadow"))
        c.blit(pg.render(f, legend, colors), 4 + i * 20, 150)
    return c


def board_charsel(legend, pal, colors, by):
    W, H = 180, 150
    c = pg.Canvas(W, H, colors["white"])
    for row, sel in enumerate([None, "f"]):
        y = 8 + row * 70
        label(c, "NONE" if sel is None else "F SELECTED", 4, y - 6, colors["mid"])
        for i, g in enumerate("mf"):
            x = 40 + i * 56
            c.blit(pg.render(by["ui/charsel_card_on" if sel == g else "ui/charsel_card"], legend, colors), x, y)
            c.blit(pg.render(by["ui/charsel_portrait_" + g], legend, colors), x + 4, y + 2)
            label(c, g, x + 18, y + 44, colors["dark"])
    return c


def main():
    legend, pal, colors, by = load()
    for name, fn in [("variants", board_variants), ("special", board_special),
                     ("facility", board_facility), ("charsel", board_charsel)]:
        img = fn(legend, pal, colors, by)
        p = os.path.join(OUT, "t149-%s.png" % name)
        img.scaled(4).save(p)
        print("%s %dx%d" % (p, img.w * 4, img.h * 4))


if __name__ == "__main__":
    main()
