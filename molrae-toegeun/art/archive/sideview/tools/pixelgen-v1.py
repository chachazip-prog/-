#!/usr/bin/env python3
"""몰래퇴근 픽셀 생성기 (pixelgen).

원본(art/src/*.json, 문자 격자 + 팔레트 역할 키)과 팔레트(art/palette-*.json)를 읽어
개별 PNG, 스프라이트 시트 + 아틀라스 JSON(Phaser JSON Hash 호환), 장면 PNG,
4배 확대 미리보기를 만든다.

- 의존성: Python 3.8+ 표준 라이브러리만 사용(zlib, struct, json, hashlib).
  Pillow 가 없어도 동작한다. PNG 인코더를 직접 구현해 Pillow 버전에 따라
  바이트가 달라지는 일을 막는다 → 같은 입력이면 항상 같은 바이트가 나온다.
- 사용법:
    python3 art/tools/pixelgen.py                 # 시안 3종 + 비교 이미지 생성
    python3 art/tools/pixelgen.py --tone a --out game/assets/sprites
                                                  # 확정 톤을 게임 에셋으로 출력
    python3 art/tools/pixelgen.py --check         # 원본 검사만
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import zlib

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ART, "src")
TONES = ["a", "b", "c"]
PREVIEW_SCALE = 4

# ---------------------------------------------------------------- PNG I/O


def write_png(path, w, h, px):
    """px: 길이 w*h 인 (r,g,b,a) 튜플 리스트. RGBA 8bit, 필터 0, zlib 9."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        row = px[y * w:(y + 1) * w]
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n"
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    data += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return hashlib.sha256(data).hexdigest()


class Canvas:
    def __init__(self, w, h, fill=(0, 0, 0, 0)):
        self.w, self.h = w, h
        self.px = [fill] * (w * h)

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h and c[3]:
            self.px[y * self.w + x] = c

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
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_legend():
    return load_json(os.path.join(SRC, "legend.json"))["keys"]


def load_palette(tone):
    pal = load_json(os.path.join(ART, "palette-%s.json" % tone))
    return pal, {k: hex_rgba(v) for k, v in pal["colors"].items()}


def load_sprites(legend):
    """art/src/sprites/*.json → [(sheet_key, w, h, rows)] (정렬된 순서)."""
    errors, frames = [], []
    sdir = os.path.join(SRC, "sprites")
    for fn in sorted(os.listdir(sdir)):
        if not fn.endswith(".json"):
            continue
        d = load_json(os.path.join(sdir, fn))
        w, h = d["size"]
        for fr in d["frames"]:
            key = "%s/%s" % (d["name"], fr["name"])
            rows = fr["rows"]
            if len(rows) != h:
                errors.append("%s: 행 수 %d != %d" % (key, len(rows), h))
            for i, r in enumerate(rows):
                if len(r) != w:
                    errors.append("%s: %d행 길이 %d != %d" % (key, i, len(r), w))
                for ch in r:
                    if ch not in legend:
                        errors.append("%s: %d행 미정의 문자 '%s'" % (key, i, ch))
            frames.append({"key": key, "w": w, "h": h, "rows": rows,
                           "sprite": d["name"], "frame": fr["name"],
                           "group": d.get("group", "misc")})
    return frames, errors


def render(frame, legend, colors, swap=None):
    swap = swap or {}
    img = Canvas(frame["w"], frame["h"])
    for y, row in enumerate(frame["rows"]):
        for x, ch in enumerate(row):
            role = legend[ch]
            if role is None:
                continue
            role = swap.get(role, role)
            img.px[y * img.w + x] = colors[role]
    return img


# ---------------------------------------------------------------- 시트 패킹


def pack(frames, max_w=128, pad=1):
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


def build_sheet(frames, legend, colors, out_dir, image_name="sheet.png"):
    placed, sw, sh = pack(frames)
    sheet = Canvas(sw, sh)
    atlas = {"frames": {}, "meta": {"image": image_name, "size": {"w": sw, "h": sh},
                                    "format": "RGBA8888", "scale": "1",
                                    "app": "molrae-toegeun art/tools/pixelgen.py"}}
    for f, x, y in placed:
        img = render(f, legend, colors)
        sheet.blit(img, x, y)
        img.save(os.path.join(out_dir, "png", f["key"].replace("/", "__") + ".png"))
        atlas["frames"][f["key"]] = {
            "frame": {"x": x, "y": y, "w": f["w"], "h": f["h"]},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": f["w"], "h": f["h"]},
            "sourceSize": {"w": f["w"], "h": f["h"]}}
    sheet.save(os.path.join(out_dir, image_name))
    with open(os.path.join(out_dir, image_name.replace(".png", ".json")), "w",
              encoding="utf-8", newline="\n") as fp:
        json.dump(atlas, fp, ensure_ascii=False, indent=1, sort_keys=True)
        fp.write("\n")
    return sheet


# ---------------------------------------------------------------- 장면


def build_scene(scene, frames_by_key, legend, colors):
    tw, th = scene["tile"]
    cols, rows = scene["grid"]
    c = Canvas(cols * tw, rows * th, colors[scene.get("bg", "wall")])
    tiles = scene["tiles"]
    for ty, line in enumerate(scene["map"]):
        for tx, ch in enumerate(line):
            key = tiles[ch]
            if key:
                c.blit(render(frames_by_key[key], legend, colors), tx * tw, ty * th)
    for ob in scene["objects"]:
        img = render(frames_by_key[ob["sprite"]], legend, colors, ob.get("swap"))
        c.blit(img, ob["x"], ob["y"], ob.get("flip", False))
    return c


# ---------------------------------------------------------------- 라벨 폰트 (3x5)

FONT = {
    "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
    "C": ["011", "100", "100", "100", "011"], "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"], "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"], "L": ["100", "100", "100", "100", "111"],
    "M": ["101", "111", "111", "101", "101"], "N": ["110", "101", "101", "101", "101"],
    "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
    "R": ["110", "101", "110", "101", "101"], "S": ["011", "100", "010", "001", "110"],
    "T": ["111", "010", "010", "010", "010"], "V": ["101", "101", "101", "101", "010"],
    "W": ["101", "101", "111", "111", "101"], "+": ["000", "010", "111", "010", "000"],
    " ": ["000", "000", "000", "000", "000"], "-": ["000", "000", "111", "000", "000"],
}


def draw_text(c, text, x, y, k, col):
    for ch in text:
        g = FONT[ch]
        for gy, line in enumerate(g):
            for gx, bit in enumerate(line):
                if bit == "1":
                    c.rect(x + gx * k, y + gy * k, k, k, col)
        x += 4 * k


# ---------------------------------------------------------------- 메인


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tone", choices=TONES, help="한 톤만 생성")
    ap.add_argument("--out", help="시트 출력 폴더(기본: art/build/tone-X)")
    ap.add_argument("--check", action="store_true", help="원본 검사만")
    args = ap.parse_args()

    legend = load_legend()
    frames, errors = load_sprites(legend)
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    if args.check:
        print("OK: %d frames" % len(frames))
        return
    by_key = {f["key"]: f for f in frames}
    scene = load_json(os.path.join(SRC, "scenes", "office-zone.json"))

    tones = [args.tone] if args.tone else TONES
    previews = []
    for t in tones:
        pal, colors = load_palette(t)
        missing = sorted(set(v for v in legend.values() if v) - set(colors))
        if missing:
            print("palette-%s 누락 역할: %s" % (t, missing))
            sys.exit(1)
        out = args.out or os.path.join(ART, "build", "tone-%s" % t)
        sheet = build_sheet(frames, legend, colors, out)
        sheet.scaled(PREVIEW_SCALE).save(os.path.join(ART, "preview", "tone-%s-sheet.png" % t))
        sc = build_scene(scene, by_key, legend, colors)
        sc.save(os.path.join(out, "scene-office-zone.png"))
        big = sc.scaled(PREVIEW_SCALE)
        big.save(os.path.join(ART, "preview", "tone-%s.png" % t))
        previews.append((t, pal, big))
        uniq = len(set(pal["colors"].values()))
        print("tone-%s: %d colors (%d unique), sheet %dx%d, scene %dx%d"
              % (t, len(pal["colors"]), uniq, sheet.w, sheet.h, sc.w, sc.h))

    if len(previews) == 3:
        gap, top = 16, 48
        W = sum(p[2].w for p in previews) + gap * 4
        H = previews[0][2].h + top + gap
        comp = Canvas(W, H, (40, 40, 46, 255))
        x = gap
        for t, pal, big in previews:
            draw_text(comp, pal["label"], x, 14, 4, (240, 240, 236, 255))
            # 팔레트 스와치 띠
            sw = 12
            sx = x + big.w - sw * len(pal["colors"])
            for i, hexv in enumerate(pal["colors"].values()):
                comp.rect(sx + i * sw, 18, sw, 14, hex_rgba(hexv))
            comp.blit(big, x, top)
            x += big.w + gap
        comp.save(os.path.join(ART, "preview", "tone-compare.png"))
        print("tone-compare: %dx%d" % (W, H))


if __name__ == "__main__":
    main()
