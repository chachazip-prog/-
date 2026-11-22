#!/usr/bin/env python3
"""몰래퇴근 픽셀 생성기 (pixelgen) v2.

원본(문자 격자 JSON)과 팔레트(art/palette.json)를 읽어 다음을 만든다.
  - 스프라이트 시트 sheet.png + 아틀라스 sheet.json (Phaser JSON Hash 호환)
  - 애니메이션 anims.json (Phaser `this.anims.fromJSON()` 호환)
  - 장면 PNG(여러 장면 파일), 4배 확대 미리보기

의존성: Python 3.8+ 표준 라이브러리만(zlib, struct, json, hashlib, math).
PNG 인코더를 직접 구현했으므로 같은 입력이면 항상 같은 바이트가 나온다.

사용법
  python3 art/tools/pixelgen.py                     # 시안 빌드(art/build/topdown) + 미리보기
  python3 art/tools/pixelgen.py --check             # 원본·팔레트·위험색 규칙 검사만
  python3 art/tools/pixelgen.py --out game/assets/sprites
        # 게임 출력: sheet.png, sheet.json, anims.json 3개만 쓴다(개별 PNG·장면 없음)
  # 보관된 측면 시점 시안 재생성
  python3 art/tools/pixelgen.py --src art/archive/sideview/src \\
        --palette art/archive/sideview/palette-b.json \\
        --build art/archive/sideview/build/v2 --preview-dir art/archive/sideview/preview/v2

원본 형식 요약(자세한 규칙은 art/style-guide.md)
  sprites/*.json
    name, group, size[w,h], origin[ox,oy](선택), frames[{name, rows | flip}]
    template: true      → 베이스 바디. 출력하지 않고 base 로만 쓴다
    base: "<template>"  → 템플릿 프레임을 복사. swap(역할 치환), stamps(소품 덧그림),
                          frames(추가 프레임), anims 를 덧붙인다
    anims[{key, frames[...], frameRate, repeat}] → "<name>/<key>" 애니메이션
  scenes/*.json
    size, tile, offset, bg, tiles, map, cones, objects(depth_sort), ui
"""
import argparse
import hashlib
import json
import math
import os
import struct
import sys
import zlib

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEW_SCALE = 4
POINT_ROLE = "point"
# point(빨강) 을 쓸 수 있는 스프라이트 그룹. D-025, D-037
POINT_GROUPS = ("boss", "warning-ui")
# point 와 색상(hue) 차이가 이 값보다 작은 '선명한' 색은 팔레트에 두지 않는다
POINT_HUE_MIN_DIST = 25.0

# ---------------------------------------------------------------- PNG I/O


def write_png(path, w, h, px):
    """px: 길이 w*h 인 (r,g,b,a) 튜플 리스트. RGBA 8bit, 필터 0, zlib 9."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for r, g, b, a in px[y * w:(y + 1) * w]:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n"
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    data += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return hashlib.sha256(data).hexdigest()


def write_json(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(obj, fp, ensure_ascii=False, indent=1, sort_keys=True)
        fp.write("\n")


class Canvas:
    def __init__(self, w, h, fill=(0, 0, 0, 0)):
        self.w, self.h = w, h
        self.px = [fill] * (w * h)

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h and c[3]:
            self.px[y * self.w + x] = c

    def blend(self, x, y, c):
        """반투명 색 합성(장면 미리보기의 오버레이·그림자 전용)."""
        if not (0 <= x < self.w and 0 <= y < self.h):
            return
        i = y * self.w + x
        r, g, b, a = self.px[i]
        k = c[3] / 255.0
        self.px[i] = (int(round(r + (c[0] - r) * k)), int(round(g + (c[1] - g) * k)),
                      int(round(b + (c[2] - b) * k)), max(a, c[3]))

    def blit(self, img, ox, oy, flip=False):
        for y in range(img.h):
            for x in range(img.w):
                c = img.px[y * img.w + (img.w - 1 - x if flip else x)]
                if c[3]:
                    self.put(ox + x, oy + y, c)

    def rect(self, x0, y0, w, h, c):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                self.put(x, y, c)

    def scaled(self, k):
        out = Canvas(self.w * k, self.h * k)
        for y in range(out.h):
            sy = (y // k) * self.w
            row = out.w * y
            for x in range(out.w):
                out.px[row + x] = self.px[sy + x // k]
        return out

    def save(self, path):
        return write_png(path, self.w, self.h, self.px)


# ---------------------------------------------------------------- 로딩


def hex_rgba(s):
    s = s.lstrip("#")
    a = int(s[6:8], 16) if len(s) == 8 else 255
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def flip_rows(rows):
    return [r[::-1] for r in rows]


def apply_stamp(rows, st):
    """소품 덧그림. '.'은 건너뛰고 '_'는 투명으로 지운다."""
    out = [list(r) for r in rows]
    for dy, line in enumerate(st["rows"]):
        for dx, ch in enumerate(line):
            x, y = st.get("x", 0) + dx, st.get("y", 0) + dy
            if ch == "." or not (0 <= y < len(out) and 0 <= x < len(out[y])):
                continue
            out[y][x] = "." if ch == "_" else ch
    return ["".join(r) for r in out]


def stamp_targets(st, names):
    if "frames" in st:
        return [n for n in st["frames"] if n in names]
    d = st.get("dir")
    return [n for n in names if d and (n.endswith("_" + d) or ("_%s_" % d) in n)]


def load_sprites(src, legend):
    """sprites/*.json → (출력 프레임 리스트, 애니메이션 리스트, 오류 리스트)."""
    errors, files = [], {}
    sdir = os.path.join(src, "sprites")
    for fn in sorted(os.listdir(sdir)):
        if fn.endswith(".json"):
            d = load_json(os.path.join(sdir, fn))
            d["_file"] = fn
            files[d["name"]] = d

    def raw_frames(d):
        """(이름, rows | None, flip 원본) 순서 리스트."""
        out = []
        if d.get("base"):
            base = files.get(d["base"])
            if not base:
                errors.append("%s: base '%s' 없음" % (d["_file"], d["base"]))
                return out
            out += raw_frames(base)
        for fr in d.get("frames", []):
            out = [o for o in out if o[0] != fr["name"]]
            out.append((fr["name"], fr.get("rows"), fr.get("flip")))
        return out

    frames, anims = [], []
    for name in sorted(files):
        d = files[name]
        if d.get("template"):
            continue
        base = files.get(d.get("base")) if d.get("base") else None
        size = d.get("size") or (base or {}).get("size")
        w, h = size
        origin = d.get("origin") or (base or {}).get("origin")
        raws = raw_frames(d)
        names = [r[0] for r in raws]
        grid = {n: rows for n, rows, _ in raws if rows is not None}
        for st in d.get("stamps", []):
            tg = stamp_targets(st, [n for n in names if n in grid])
            if not tg:
                errors.append("%s: stamp 대상 프레임 없음 (%s)" % (d["_file"], st.get("dir") or st.get("frames")))
            for n in tg:
                grid[n] = apply_stamp(grid[n], st)
        for n, rows, fl in raws:
            if rows is None:
                if fl not in grid:
                    errors.append("%s/%s: flip 원본 '%s' 없음" % (name, n, fl))
                    continue
                grid[n] = flip_rows(grid[fl])
        swap = dict((base or {}).get("swap", {}))
        swap.update(d.get("swap", {}))
        for n in names:
            if n not in grid:
                continue
            key = "%s/%s" % (name, n)
            rows = grid[n]
            if len(rows) != h:
                errors.append("%s: 행 수 %d != %d" % (key, len(rows), h))
            for i, r in enumerate(rows):
                if len(r) != w:
                    errors.append("%s: %d행 길이 %d != %d" % (key, i, len(r), w))
                for ch in r:
                    if ch not in legend:
                        errors.append("%s: %d행 미정의 문자 '%s'" % (key, i, ch))
            frames.append({"key": key, "w": w, "h": h, "rows": rows, "sprite": name,
                           "frame": n, "group": d.get("group", "misc"), "swap": swap,
                           "origin": origin, "file": d["_file"]})
        adefs = list((base or {}).get("anims", [])) + list(d.get("anims", []))
        seen = {}
        for a in adefs:
            seen[a["key"]] = a
        for k in [a["key"] for a in adefs if seen.get(a["key"]) is a]:
            a = seen[k]
            anims.append({"key": "%s/%s" % (name, k), "sprite": name,
                          "frames": ["%s/%s" % (name, f) for f in a["frames"]],
                          "frameRate": a.get("frameRate", 8), "repeat": a.get("repeat", -1)})
    return frames, anims, errors


def resolve_role(ch, legend, swap):
    role = legend[ch]
    if role is None:
        return None
    return swap.get(role, role)


def render(frame, legend, colors, swap=None):
    sw = dict(frame.get("swap") or {})
    sw.update(swap or {})
    img = Canvas(frame["w"], frame["h"])
    for y, row in enumerate(frame["rows"]):
        for x, ch in enumerate(row):
            role = resolve_role(ch, legend, sw)
            if role is not None:
                img.px[y * img.w + x] = colors[role]
    return img


# ---------------------------------------------------------------- 검사


def rgb_hsv(c):
    r, g, b = [v / 255.0 for v in c[:3]]
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        h = 0.0
    elif mx == r:
        h = 60 * (((g - b) / d) % 6)
    elif mx == g:
        h = 60 * ((b - r) / d + 2)
    else:
        h = 60 * ((r - g) / d + 4)
    return h, (d / mx if mx else 0), mx


def check_palette(pal, colors):
    errs = []
    n = len(pal["colors"])
    if not 16 <= n <= 24:
        errs.append("팔레트 색 수 %d (16~24색 규칙 위반)" % n)
    vals = [v.lower() for v in pal["colors"].values()]
    if len(set(vals)) != len(vals):
        errs.append("팔레트에 중복 색이 있음")
    if "#000000" in vals:
        errs.append("순수 검정(#000000) 금지")
    if POINT_ROLE in colors:
        ph = rgb_hsv(colors[POINT_ROLE])[0]
        for role, c in sorted(colors.items()):
            if role == POINT_ROLE:
                continue
            h, s, v = rgb_hsv(c)
            dist = min(abs(h - ph), 360 - abs(h - ph))
            if s >= 0.45 and v >= 0.45 and dist < POINT_HUE_MIN_DIST:
                errs.append("'%s'(%s) 색상이 point 와 %.0f° 차이 — 빨강과 헷갈림(최소 %.0f°)"
                            % (role, pal["colors"][role], dist, POINT_HUE_MIN_DIST))
    for k, v in sorted(pal.get("overlay", {}).items()):
        if k.startswith("_"):
            continue
        if v.get("base") not in colors:
            errs.append("overlay '%s': base 역할 '%s' 없음" % (k, v.get("base")))
        if POINT_ROLE == v.get("base") and not v.get("warning"):
            errs.append("overlay '%s': point 기반 오버레이는 warning:true(상사·경고) 여야 함" % k)
    return errs


def check_frames(frames, anims, legend, colors):
    errs = []
    keys = set(f["key"] for f in frames)
    for f in frames:
        roles, pts = set(), 0
        for row in f["rows"]:
            for ch in row:
                if ch not in legend:
                    continue
                r = resolve_role(ch, legend, f["swap"])
                if r is None:
                    continue
                roles.add(r)
                pts += r == POINT_ROLE
        for r in sorted(roles):
            if r.startswith("$"):
                errs.append("%s: 슬롯 역할 '%s' 미지정(swap 필요)" % (f["key"], r))
            elif r not in colors:
                errs.append("%s: 팔레트에 없는 역할 '%s'" % (f["key"], r))
        if pts and f["group"] not in POINT_GROUPS:
            errs.append("%s: point 색은 상사·경고 UI 스프라이트에서만 사용 (group=%s, %dpx, %s)"
                        % (f["key"], f["group"], pts, f["file"]))
    for a in anims:
        for fk in a["frames"]:
            if fk not in keys:
                errs.append("anim %s: 프레임 '%s' 없음" % (a["key"], fk))
    return errs


def check_scene(name, sc, by_key, colors):
    errs = []
    for k in sc.get("tiles", {}).values():
        if k and k not in by_key:
            errs.append("scene %s: 타일 '%s' 없음" % (name, k))
    for ob in sc.get("objects", []) + sc.get("ui", []):
        f = by_key.get(ob["sprite"])
        if not f:
            errs.append("scene %s: 스프라이트 '%s' 없음" % (name, ob["sprite"]))
            continue
        if POINT_ROLE in ob.get("swap", {}).values() and f["group"] not in POINT_GROUPS:
            errs.append("scene %s: %s 에 point 치환 금지(group=%s)" % (name, ob["sprite"], f["group"]))
    return errs


# ---------------------------------------------------------------- 시트·애니메이션


def pack(frames, max_w=256, pad=1):
    """선반(shelf) 패킹. 입력 순서를 그대로 지켜 결정적이다."""
    x = y = shelf_h = 0
    placed = []
    for f in frames:
        if x + f["w"] > max_w:
            x, y, shelf_h = 0, y + shelf_h + pad, 0
        placed.append((f, x, y))
        x += f["w"] + pad
        shelf_h = max(shelf_h, f["h"])
    return placed, max_w, y + shelf_h


def build_sheet(frames, legend, colors, out_dir, png_dir=None):
    placed, sw, sh = pack(frames)
    sheet = Canvas(sw, sh)
    atlas = {"frames": {}, "meta": {"image": "sheet.png", "size": {"w": sw, "h": sh},
                                    "format": "RGBA8888", "scale": "1",
                                    "app": "molrae-toegeun art/tools/pixelgen.py v2"}}
    for f, x, y in placed:
        img = render(f, legend, colors)
        sheet.blit(img, x, y)
        if png_dir:
            img.save(os.path.join(png_dir, f["key"].replace("/", "__") + ".png"))
        ent = {"frame": {"x": x, "y": y, "w": f["w"], "h": f["h"]},
               "rotated": False, "trimmed": False,
               "spriteSourceSize": {"x": 0, "y": 0, "w": f["w"], "h": f["h"]},
               "sourceSize": {"w": f["w"], "h": f["h"]}}
        if f["origin"]:
            # Phaser JSON Hash 파서는 anchor 를 customPivot(원점)으로 읽는다
            ent["anchor"] = {"x": f["origin"][0], "y": f["origin"][1]}
        atlas["frames"][f["key"]] = ent
    sheet.save(os.path.join(out_dir, "sheet.png"))
    write_json(os.path.join(out_dir, "sheet.json"), atlas)
    return sheet


def build_anims(anims, texture_key, out_dir):
    data = {"anims": []}
    for a in anims:
        data["anims"].append({
            "key": a["key"], "type": "frame",
            "frames": [{"key": texture_key, "frame": fk, "duration": 0} for fk in a["frames"]],
            "frameRate": a["frameRate"], "repeat": a["repeat"], "delay": 0,
            "repeatDelay": 0, "yoyo": False, "showOnStart": False,
            "hideOnComplete": False, "skipMissedFrames": True})
    write_json(os.path.join(out_dir, "anims.json"), data)
    return data


# ---------------------------------------------------------------- 장면


def draw_cone(c, cone, rgba, edge_rgba, ox, oy):
    """시선 콘(부채꼴). 게임에서는 코드로 그리며, 여기서는 미리보기용으로 합성한다."""
    cx, cy = cone["x"] + ox, cone["y"] + oy
    ang, half, ln = math.radians(cone["dir"]), math.radians(cone["half"]), cone["len"]

    def inside(px, py):
        dx, dy = px + 0.5 - cx, py + 0.5 - cy
        d = math.hypot(dx, dy)
        if d > ln or d < 1:
            return False
        da = math.atan2(dy, dx) - ang
        da = (da + math.pi) % (2 * math.pi) - math.pi
        return abs(da) <= half

    x0, x1 = int(cx - ln) - 1, int(cx + ln) + 1
    y0, y1 = int(cy - ln) - 1, int(cy + ln) + 1
    for y in range(max(0, y0), min(c.h, y1 + 1)):
        for x in range(max(0, x0), min(c.w, x1 + 1)):
            if not inside(x, y):
                continue
            edge = not (inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1))
            c.blend(x, y, edge_rgba if edge else rgba)


def draw_shadow(c, cx, by, w, h, rgba):
    """발밑 그림자 타원(코드 드로잉 전제)."""
    rx, ry = w / 2.0, h / 2.0
    cy = by - ry
    for y in range(int(by - h), int(by) + 1):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 1):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                c.blend(x, y, rgba)


def overlay_rgba(pal, colors, name, alpha_key="alpha"):
    o = pal["overlay"][name]
    r, g, b, _ = colors[o["base"]]
    return (r, g, b, int(round(o[alpha_key] * 255)))


def build_scene(sc, by_key, legend, colors, pal):
    tw, th = sc["tile"]
    W, H = sc.get("size") or (len(sc["map"][0]) * tw, len(sc["map"]) * th)
    ox, oy = sc.get("offset", [0, 0])
    c = Canvas(W, H, colors[sc.get("bg", "wall")])
    for layer in sc.get("layers", [sc.get("map", [])]):
        for ty, line in enumerate(layer):
            for tx, ch in enumerate(line):
                key = sc["tiles"].get(ch)
                if key:
                    c.blit(render(by_key[key], legend, colors), tx * tw + ox, ty * th + oy)
    obs = []
    for i, ob in enumerate(sc.get("objects", [])):
        f = by_key[ob["sprite"]]
        if "tx" in ob:  # 격자 배치: 바닥(발밑)을 타일 아래 변에 맞춘다
            x = ob["tx"] * tw + (tw - f["w"]) // 2 + ob.get("dx", 0)
            y = (ob["ty"] + 1) * th - f["h"] + ob.get("dy", 0)
        else:
            x, y = ob["x"], ob["y"]
        foot = y + f["h"] + ob.get("depth_bias", 0)
        obs.append((foot if sc.get("depth_sort") else 0, i, x, y, f, ob))
    obs.sort(key=lambda t: (t[0], t[1]))
    # 그림자 → 시선 콘 → 오브젝트(깊이 정렬) → UI
    if "shadow" in pal.get("overlay", {}):
        sh = overlay_rgba(pal, colors, "shadow")
        for _, _, x, y, f, ob in obs:
            if ob.get("shadow"):
                draw_shadow(c, x + ox + f["w"] / 2.0, y + oy + f["h"] + 1, 11, 4, sh)
    for cone in sc.get("cones", []):
        draw_cone(c, cone, overlay_rgba(pal, colors, cone["color"]),
                  overlay_rgba(pal, colors, cone["color"], "edge_alpha"), ox, oy)
    for _, _, x, y, f, ob in obs:
        c.blit(render(f, legend, colors, ob.get("swap")), x + ox, y + oy, ob.get("flip", False))
    for ob in sc.get("ui", []):
        c.blit(render(by_key[ob["sprite"]], legend, colors), ob["x"], ob["y"])
    return c


# ---------------------------------------------------------------- 라벨 폰트 (3x5)

FONT = {
    "A": "010101111101101", "B": "110101110101110", "C": "011100100100011",
    "D": "110101101101110", "E": "111100110100111", "F": "111100110100100",
    "G": "011100101101011", "H": "101101111101101", "I": "111010010010111",
    "K": "101101110101101", "L": "100100100100111", "M": "101111111101101",
    "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101",
    "Y": "101101010010010", "X": "101101010101101", "+": "000010111010000",
    " ": "000000000000000", "-": "000000111000000", "/": "001001010100100",
    "0": "111101101101111", "1": "010110010010111", "2": "110001010100111",
}


def draw_text(c, text, x, y, col, k=1):
    for ch in text:
        g = FONT.get(ch, FONT[" "])
        for i, bit in enumerate(g):
            if bit == "1":
                c.rect(x + (i % 3) * k, y + (i // 3) * k, k, k, col)
        x += 4 * k


DIR_ORDER = ["down", "up", "left", "right"]


def build_char_preview(frames, legend, colors, pal):
    """캐릭터 시트 미리보기: 캐릭터별 1행, 방향별 정지+걷기 프레임 + 특수 프레임."""
    groups = ("character", "boss", "npc")
    chars = []
    for f in frames:
        if f["group"] in groups and f["sprite"] not in chars:
            chars.append(f["sprite"])
    rows = []
    for ch in chars:
        fs = [f for f in frames if f["sprite"] == ch]
        order = []
        for d in DIR_ORDER:
            order += [f for f in fs if f["frame"] == "idle_" + d]
            order += sorted([f for f in fs if f["frame"].startswith("walk_%s_" % d)],
                            key=lambda f: f["frame"])
        order += [f for f in fs if f not in order]
        rows.append((ch, order))
    cw, chh, gap, lab = 16, 20, 4, 8
    ncol = max(len(o) for _, o in rows)
    W = gap + ncol * (cw + gap) + gap * 2
    H = lab + gap + len(rows) * (chh + lab + gap * 2)
    c = Canvas(W, H, colors["floor"])
    txt = colors["outline"]
    sh = overlay_rgba(pal, colors, "shadow")
    # 방향 머리글
    x = gap
    heads = []
    for d in DIR_ORDER:
        heads.append((d.upper(), x))
        x += 3 * (cw + gap)
    heads.append(("ETC", x))
    for t, hx in heads:
        draw_text(c, t, hx, 2, colors["dark"])
    y = lab + gap
    for ch, order in rows:
        draw_text(c, ch.upper(), gap, y, txt)
        y += lab
        x = gap
        for i, f in enumerate(order):
            if i == 12:
                x += gap * 2
            draw_shadow(c, x + cw / 2.0, y + chh + 1, 11, 4, sh)
            c.blit(render(f, legend, colors), x, y)
            x += cw + gap
        y += chh + gap * 2
    return c


# ---------------------------------------------------------------- 메인


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ART, "src"), help="원본 폴더(legend.json, sprites/, scenes/)")
    ap.add_argument("--palette", default=os.path.join(ART, "palette.json"))
    ap.add_argument("--build", default=os.path.join(ART, "build", "topdown"), help="시안 빌드 폴더")
    ap.add_argument("--preview-dir", default=os.path.join(ART, "preview"))
    ap.add_argument("--out", help="게임 출력 폴더. sheet.png·sheet.json·anims.json 만 쓴다")
    ap.add_argument("--texture-key", default="sprites", help="anims.json 이 참조할 Phaser 텍스처 키")
    ap.add_argument("--check", action="store_true", help="검사만")
    args = ap.parse_args()

    legend = load_json(os.path.join(args.src, "legend.json"))["keys"]
    pal = load_json(args.palette)
    colors = {k: hex_rgba(v) for k, v in pal["colors"].items()}
    frames, anims, errors = load_sprites(args.src, legend)
    by_key = {f["key"]: f for f in frames}
    errors += check_palette(pal, colors)
    if not errors:
        errors += check_frames(frames, anims, legend, colors)
    scenes = []
    sdir = os.path.join(args.src, "scenes")
    if os.path.isdir(sdir):
        for fn in sorted(os.listdir(sdir)):
            if fn.endswith(".json"):
                sc = load_json(os.path.join(sdir, fn))
                name = sc.get("name") or fn[:-5]
                errors += check_scene(name, sc, by_key, colors)
                scenes.append((name, sc))
    if errors:
        print("\n".join("ERROR " + e for e in errors))
        sys.exit(1)
    npt = sum(1 for f in frames if f["group"] in POINT_GROUPS)
    print("OK: %d frames, %d anims, %d scenes, palette %d colors (point 허용 프레임 %d)"
          % (len(frames), len(anims), len(scenes), len(pal["colors"]), npt))
    if args.check:
        return

    if args.out:
        build_sheet(frames, legend, colors, args.out)
        build_anims(anims, args.texture_key, args.out)
        print("game out: %s (sheet.png, sheet.json, anims.json)" % args.out)
        return

    out = args.build
    sheet = build_sheet(frames, legend, colors, out, png_dir=os.path.join(out, "png"))
    build_anims(anims, args.texture_key, out)
    tag = os.path.basename(os.path.normpath(out))
    sheet.scaled(PREVIEW_SCALE).save(os.path.join(args.preview_dir, "%s-sheet.png" % tag))
    print("sheet %dx%d -> %s" % (sheet.w, sheet.h, out))
    if any(f["group"] in ("character", "boss", "npc") and f["frame"].startswith("idle_") for f in frames):
        cp = build_char_preview(frames, legend, colors, pal)
        cp.scaled(PREVIEW_SCALE).save(os.path.join(args.preview_dir, "%s-characters.png" % tag))
        print("characters preview %dx%d" % (cp.w, cp.h))
    for name, sc in scenes:
        img = build_scene(sc, by_key, legend, colors, pal)
        img.save(os.path.join(out, "scenes", name + ".png"))
        img.scaled(PREVIEW_SCALE).save(os.path.join(args.preview_dir, sc.get("preview", name) + ".png"))
        print("scene %s %dx%d" % (name, img.w, img.h))


if __name__ == "__main__":
    main()
