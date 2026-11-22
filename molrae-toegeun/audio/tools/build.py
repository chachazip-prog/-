#!/usr/bin/env python3
"""몰래퇴근 사운드 빌드 (T-113).

사용:  python3 -I molrae-toegeun/audio/tools/build.py [--no-encode]
입력:  audio/src/sfx.json, audio/src/bgm.json, audio/src/sound-list.template.md
출력:  audio/build/wav/*.wav (중간물, 커밋 불필요)
       game/assets/audio/sfx/*.ogg|mp3, game/assets/audio/bgm/*.ogg|mp3
       game/assets/audio/audio-manifest.json (엔진용 키·루프·재생 조건·BGM 단계)
       audio/sound-list.md (산출물 표, 자동 생성)
의존성: Python 3 표준 라이브러리 + ffmpeg(libvorbis, libmp3lame). ffmpeg가 없으면 WAV만 만들고 경고.
결정성: 모든 난수는 시드 고정, ffmpeg는 -bitexact + 메타데이터 제거.
"""
import copy
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import synth  # noqa: E402
from synth import (SR, biquad, chip_note, fade_edges, hat, kick, mix_into, normalize, note_freq,  # noqa: E402
                   ns, rng_for, snare, trim_tail, write_wav, read_wav)
from recipes import render  # noqa: E402

AUDIO = os.path.dirname(HERE)                       # molrae-toegeun/audio
ROOT = os.path.dirname(AUDIO)                       # molrae-toegeun
SRC = os.path.join(AUDIO, "src")
WAV_DIR = os.path.join(AUDIO, "build", "wav")
OUT = os.path.join(ROOT, "game", "assets", "audio")

ENCODE = {
    "sfx": {"ogg": ["-c:a", "libvorbis", "-q:a", "2"], "mp3": ["-c:a", "libmp3lame", "-b:a", "48k"]},
    "bgm": {"ogg": ["-c:a", "libvorbis", "-q:a", "0"], "mp3": ["-c:a", "libmp3lame", "-b:a", "32k"]},
}
LIMITS = {"sfx": 20 * 1024, "bgm": 300 * 1024}


def resolve_refs(obj, shared):
    if isinstance(obj, str) and obj.startswith("@"):
        return copy.deepcopy(shared[obj[1:]])
    if isinstance(obj, dict):
        return {k: resolve_refs(v, shared) for k, v in obj.items()}
    if isinstance(obj, list):
        return [resolve_refs(v, shared) for v in obj]
    return obj


# ---------------- SFX ----------------

def build_sfx(spec):
    defaults = spec["defaults"]
    shared = spec["shared"]
    results = []
    for s in spec["sounds"]:
        cfg = dict(defaults)
        cfg.update(s)
        params = resolve_refs(cfg["params"], shared)
        rng = rng_for(cfg["seed"])
        x = render(cfg["recipe"], params, rng)
        if cfg["hp"]:
            x = biquad(biquad(x, "hp", cfg["hp"], 0.707), "hp", cfg["hp"], 0.707)
        if not cfg["loop"]:
            x = trim_tail(x, -62.0, 0.02)
            x = fade_edges(x, 0.001, 0.01)
        x = normalize(x, cfg["peakDb"])
        path = os.path.join(WAV_DIR, cfg["key"] + ".wav")
        write_wav(path, x)
        results.append({"cfg": cfg, "wav": path, "dur": len(x) / SR, "samples": x})
        print("  sfx %-26s %.3fs" % (cfg["key"], len(x) / SR))
    return results


# ---------------- BGM ----------------

def parse_track(bars, steps_per_bar):
    """토큰 -> [(step, len_steps, note)]"""
    tokens = []
    for b in bars:
        tk = b.split()
        assert len(tk) == steps_per_bar, b
        tokens.extend(tk)
    notes = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t not in (".", "-"):
            j = i + 1
            while j < len(tokens) and tokens[j] == "-":
                j += 1
            notes.append((i, j - i, t))
            i = j
        else:
            i += 1
    return notes


def fold_loop(buf, n_loop):
    out = buf[:n_loop]
    for i in range(n_loop, len(buf)):
        out[i - n_loop] += buf[i]
    return out


def build_bgm(spec):
    rng = rng_for(spec["seed"])
    step = 60.0 / spec["bpm"] / 2.0          # 8분음표
    s16 = step / 2.0
    total_steps = spec["bars"] * spec["stepsPerBar"]
    loop_sec = total_steps * step
    n_loop = ns(loop_sec)
    tones = spec["chordTones"]
    chords = spec["chords"]
    stems = spec["stems"]

    # ---- main ----
    m = stems["main"]
    main = [0.0] * (n_loop + ns(1.0))
    L = m["lead"]
    for (st, ln, nm) in parse_track(spec["lead"], spec["stepsPerBar"]):
        dur = ln * step * (m["lead"]["staccato"] if ln == 1 else 0.92)
        x = chip_note(L["wave"], note_freq(nm), dur, g=L["gain"], duty=L["duty"], d=L["decay"], s=L["sustain"], r=0.03,
                      vibrato=(5.5, 0.18, 0.18) if ln > 1 else None)
        mix_into(main, x, st * step)
    pat = spec["bassPattern"].split()
    B = m["bass"]
    for bar, ch in enumerate(chords):
        root = tones[ch][0]
        rf = note_freq("%s%d" % (root, spec["bassOctave"]))
        for k, tok in enumerate(pat):
            if tok == ".":
                continue
            f = {"R": rf, "5": rf * 1.5, "O": rf * 2.0}[tok]
            x = chip_note(B["wave"], f, step * B["staccato"], g=B["gain"], s=0.8, r=0.02)
            mix_into(main, x, (bar * spec["stepsPerBar"] + k) * step)
        S = m["stab"]
        for k in S["steps"]:
            t = (bar * spec["stepsPerBar"] + k) * step
            for nm in tones[ch]:
                x = chip_note(S["wave"], note_freq("%s%d" % (nm, S["octave"])), S["len"], g=S["gain"], duty=S["duty"], d=0.03, s=0.4, r=0.02)
                mix_into(main, x, t)
        for k in m["hat"]["steps"]:
            mix_into(main, hat(rng, m["hat"]["gain"]), (bar * spec["stepsPerBar"] + k) * step)
        for k in m["kick"]["steps"]:
            mix_into(main, kick(rng, m["kick"]["gain"]), (bar * spec["stepsPerBar"] + k) * step)
    main = normalize(fold_loop(main, n_loop), m["peakDb"])

    # ---- tension ----
    T = stems["tension"]
    ten = [0.0] * (n_loop + ns(1.0))
    arp_order = [0, 1, 2, 1]
    for bar, ch in enumerate(chords):
        base = bar * 16
        for k in range(16):
            t = (base + k) * s16
            g = T["hat16"]["gain"] * (T["hat16"]["accentGain"] if k % T["hat16"]["accentEvery"] == 0 else 1.0)
            mix_into(ten, hat(rng, g, 0.03), t)
            A = T["arp16"]
            nm = tones[ch][arp_order[k % 4]]
            x = chip_note(A["wave"], note_freq("%s%d" % (nm, A["octave"])), A["len"], g=A["gain"], duty=A["duty"], d=0.02, s=0.5, r=0.015)
            mix_into(ten, x, t)
        for k in T["snare"]["steps16"]:
            mix_into(ten, snare(rng, T["snare"]["gain"]), (base + k) * s16)
        for k in T["kick"]["steps16"]:
            mix_into(ten, kick(rng, T["kick"]["gain"]), (base + k) * s16)
    ten = normalize(fold_loop(ten, n_loop), T["peakDb"])

    out = []
    for name, x in (("main", main), ("tension", ten)):
        key = "%s_%s" % (spec["key"], name)
        path = os.path.join(WAV_DIR, key + ".wav")
        write_wav(path, x)
        out.append({"key": key, "stem": name, "wav": path, "dur": len(x) / SR, "samples": x})
        print("  bgm %-26s %.3fs" % (key, len(x) / SR))
    return out, loop_sec


# ---------------- 인코딩 ----------------

def have_ffmpeg():
    return shutil.which("ffmpeg") is not None


def encode(wav, dst, args):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-fflags", "+bitexact", "-i", wav,
           "-map_metadata", "-1", "-ac", "1", "-ar", str(SR)] + args + ["-fflags", "+bitexact", "-flags", "+bitexact"]
    if dst.endswith(".mp3"):
        cmd += ["-id3v2_version", "0", "-write_id3v1", "0"]
    cmd.append(dst)
    subprocess.run(cmd, check=True)
    return os.path.getsize(dst)


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


# ---------------- 폰 스피커 분석 ----------------

BANDS = [(500, "0.5k"), (1000, "1k"), (2000, "2k"), (4000, "4k")]


def phone_sim(x):
    """소형 폰 스피커 근사: 500Hz 이하 급감(2차 HP x2), 7kHz 이하 LP."""
    y = biquad(biquad(x, "hp", 500, 0.707), "hp", 500, 0.707)
    return biquad(y, "lp", 7000, 0.707)


def energy(x):
    return sum(v * v for v in x) / max(1, len(x))


def onsets(x, frame=0.01, rise_db=9.0):
    f = ns(frame)
    env = []
    for i in range(0, len(x), f):
        seg = x[i:i + f]
        env.append(math.sqrt(energy(seg)) + 1e-6)
    cnt, prev_min = 0, env[0] if env else 0
    armed = True
    pk = max(env) if env else 1
    for v in env:
        if v < prev_min:
            prev_min = v
        if armed and v > pk * 0.15 and 20 * math.log10(v / prev_min) > rise_db:
            cnt += 1
            armed = False
        if not armed and v < pk * 0.08:
            armed = True
            prev_min = v
    return cnt


def zcr_pitchiness(x):
    """주기성 지표(0=잡음, 1=순음): 정규화 자기상관 최대값(5~20ms 지연, 피크 근처 50ms 창)."""
    n = len(x)
    if n < ns(0.06):
        return 0.0
    # 가장 에너지가 큰 50ms 구간
    w = ns(0.05)
    best, bi = -1, 0
    for i in range(0, n - w, ns(0.01)):
        e = energy(x[i:i + w])
        if e > best:
            best, bi = e, i
    seg = x[bi:bi + w]
    e0 = sum(v * v for v in seg) + 1e-12
    mx = 0.0
    for lag in range(ns(0.0004), ns(0.012), 1):
        r = sum(seg[i] * seg[i + lag] for i in range(0, w - lag, 2)) * 2 / e0
        mx = max(mx, r)
    return min(1.0, mx)


def analyze(sample):
    x = sample["samples"]
    y = phone_sim(x)
    e_full, e_ph = energy(x), energy(y)
    keep_db = 10 * math.log10(e_ph / e_full) if e_full > 0 else -99
    bands = []
    for fc, _ in BANDS:
        bands.append(energy(biquad(y, "bp", fc, 1.4)))
    tot = sum(bands) or 1
    bands = [b / tot for b in bands]
    centroid = math.exp(sum(math.log(fc) * b for (fc, _), b in zip(BANDS, bands)))
    return {
        "phoneKeepDb": round(keep_db, 1),
        "bands": [round(b, 2) for b in bands],
        "centroidHz": int(round(centroid, -1)),
        "onsets": onsets(y),
        "tonality": round(zcr_pitchiness(y), 2),
    }


def feature_vec(a, dur):
    return a["bands"] + [math.log(max(dur, 0.05)) / 2.0, min(a["onsets"], 6) / 4.0, a["tonality"]]


def distance(u, v):
    return math.sqrt(sum((p - q) ** 2 for p, q in zip(u, v)))


# ---------------- 메인 ----------------

def main():
    encode_on = "--no-encode" not in sys.argv
    os.makedirs(WAV_DIR, exist_ok=True)
    with open(os.path.join(SRC, "sfx.json"), encoding="utf-8") as f:
        sfx_spec = json.load(f)
    with open(os.path.join(SRC, "bgm.json"), encoding="utf-8") as f:
        bgm_spec = json.load(f)
    assert sfx_spec["sampleRate"] == SR

    print("[1/4] 효과음 렌더")
    sfx = build_sfx(sfx_spec)
    print("[2/4] BGM 렌더")
    bgm, loop_sec = build_bgm(bgm_spec)

    ff = encode_on and have_ffmpeg()
    if encode_on and not ff:
        print("경고: ffmpeg 없음 -> WAV만 생성. 변환 계획은 sound-list.md 참고")
    print("[3/4] 인코딩" if ff else "[3/4] 인코딩 생략")
    manifest = {"_doc": "자동 생성(audio/tools/build.py). 수정은 audio/src/*.json에서. 경로는 game/assets/audio 기준. Phaser: this.load.audio(key, [ogg, mp3]) 순서로 넣으면 지원 포맷을 자동 선택.",
                "sampleRate": SR, "sfx": [], "bgm": {}}
    rows = []
    over = []
    for item in sfx:
        c = item["cfg"]
        files, sizes = {}, {}
        for fmt in ("ogg", "mp3"):
            rel = "sfx/%s.%s" % (c["key"], fmt)
            if ff:
                os.makedirs(os.path.join(OUT, "sfx"), exist_ok=True)
                sizes[fmt] = encode(item["wav"], os.path.join(OUT, rel), ENCODE["sfx"][fmt])
                files[fmt] = rel
                if sizes[fmt] > LIMITS["sfx"]:
                    over.append((c["key"], fmt, sizes[fmt]))
        a = analyze(item)
        item["analysis"] = a
        manifest["sfx"].append({
            "key": c["key"], "category": c["category"], "files": files, "durationSec": round(item["dur"], 3),
            "loop": bool(c["loop"]), "play": c["play"], "dataRefs": c["dataRefs"], "visual": c["visual"],
        })
        rows.append((c, item, sizes))

    bgm_rows = []
    manifest["bgm"][bgm_spec["key"]] = {
        "loopSec": loop_sec, "bpm": bgm_spec["bpm"], "stems": {}, "stages": bgm_spec["stages"],
        "stagePriority": bgm_spec["stagePriority"], "hysteresis": bgm_spec["hysteresis"],
        "_doc": "stems를 동시에 loop 재생, 같은 rate 적용. 단계 전환은 stages[*].rampSec 동안 rate·볼륨 선형 보간.",
    }
    for item in bgm:
        files, sizes = {}, {}
        for fmt in ("ogg", "mp3"):
            rel = "bgm/%s.%s" % (item["key"], fmt)
            if ff:
                os.makedirs(os.path.join(OUT, "bgm"), exist_ok=True)
                sizes[fmt] = encode(item["wav"], os.path.join(OUT, rel), ENCODE["bgm"][fmt])
                files[fmt] = rel
        manifest["bgm"][bgm_spec["key"]]["stems"][item["stem"]] = {"key": item["key"], "files": files, "durationSec": round(item["dur"], 3), "loop": True}
        bgm_rows.append((item, sizes))
    for fmt in ("ogg", "mp3"):
        tot = sum(s.get(fmt, 0) for _, s in bgm_rows)
        if tot > LIMITS["bgm"]:
            over.append(("bgm_office(합계)", fmt, tot))

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "audio-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("[4/4] 분석·문서")
    write_doc(rows, bgm_rows, bgm_spec, loop_sec)
    if over:
        print("용량 초과:", over)
        sys.exit(1)
    print("완료")


def kb(n):
    return "%.1f" % (n / 1024.0) if n else "-"


def write_doc(rows, bgm_rows, bgm_spec, loop_sec):
    lines = ["| 키 | 분류 | 내용 | 길이(초) | 루프 | OGG(KB) | MP3(KB) |", "|---|---|---|---|---|---|---|"]
    for c, item, sizes in rows:
        lines.append("| `%s` | %s | %s | %.2f | %s | %s | %s |" % (
            c["key"], {"tell": "전조", "feedback": "피드백"}[c["category"]], c["desc"], item["dur"],
            "O" if c["loop"] else "-", kb(sizes.get("ogg")), kb(sizes.get("mp3"))))
    sfx_table = "\n".join(lines)

    lines = ["| 키 | 스템 | 길이(초) | 루프 | OGG(KB) | MP3(KB) |", "|---|---|---|---|---|---|"]
    to, tm = 0, 0
    for item, sizes in bgm_rows:
        lines.append("| `%s` | %s | %.2f | O | %s | %s |" % (item["key"], item["stem"], item["dur"], kb(sizes.get("ogg")), kb(sizes.get("mp3"))))
        to += sizes.get("ogg", 0)
        tm += sizes.get("mp3", 0)
    lines.append("| 합계 | | | | %s | %s |" % (kb(to), kb(tm)))
    bgm_table = "\n".join(lines)

    lines = ["| 단계 | rate | main 볼륨 | tension 볼륨 | 전환(초) | 조건 |", "|---|---|---|---|---|---|"]
    for name in bgm_spec["stagePriority"][::-1]:
        st = bgm_spec["stages"][name]
        if st.get("stop"):
            lines.append("| `%s` | 정지 | - | - | 페이드아웃 %.2f | %s |" % (name, st["fadeOutSec"], st["when"]))
        else:
            lines.append("| `%s` | %.2f | %.2f | %.2f | %.1f | %s |" % (name, st["rate"], st["mainVol"], st["tensionVol"], st["rampSec"], st["when"]))
    stage_table = "\n".join(lines)

    tells = [(c, item) for c, item, _ in rows if c["category"] == "tell"]
    lines = ["| 키 | 폰 스피커 잔존(dB) | 대역 비율 0.5k/1k/2k/4k | 중심(Hz) | 어택 수 | 음정성(0~1) |", "|---|---|---|---|---|---|"]
    for c, item in tells:
        a = item["analysis"]
        lines.append("| `%s` | %.1f | %s | %d | %d | %.2f |" % (c["key"], a["phoneKeepDb"], " / ".join("%.2f" % b for b in a["bands"]), a["centroidHz"], a["onsets"], a["tonality"]))
    core = ["sfx_chair_creak", "sfx_footsteps_crescendo", "sfx_footstep_stop", "sfx_elevator_ding", "sfx_gate_beep", "sfx_hey", "sfx_chatter", "sfx_meeting_end"]
    by = {c["key"]: (c, item) for c, item in tells}
    pairs = []
    for i, k1 in enumerate(core):
        for k2 in core[i + 1:]:
            c1, i1 = by[k1]
            c2, i2 = by[k2]
            d = distance(feature_vec(i1["analysis"], i1["dur"]), feature_vec(i2["analysis"], i2["dur"]))
            pairs.append((d, k1, k2))
    pairs.sort()
    lines.append("")
    lines.append("핵심 전조 8종 특징 거리(작을수록 비슷함, 대역 비율·길이·어택 수·음정성 기준). 가장 가까운 5쌍:")
    lines.append("")
    for d, k1, k2 in pairs[:5]:
        lines.append("- `%s` - `%s`: %.2f" % (k1, k2, d))
    lines.append("- (전체 %d쌍 중 최댓값 %.2f)" % (len(pairs), pairs[-1][0]))
    analysis = "\n".join(lines)

    with open(os.path.join(SRC, "sound-list.template.md"), encoding="utf-8") as f:
        tpl = f.read()
    doc = (tpl.replace("{{SFX_TABLE}}", sfx_table).replace("{{BGM_TABLE}}", bgm_table)
           .replace("{{STAGE_TABLE}}", stage_table).replace("{{ANALYSIS}}", analysis)
           .replace("{{LOOP_SEC}}", "%.1f" % loop_sec).replace("{{BPM}}", str(bgm_spec["bpm"])))
    with open(os.path.join(AUDIO, "sound-list.md"), "w", encoding="utf-8") as f:
        f.write(doc)


if __name__ == "__main__":
    main()
