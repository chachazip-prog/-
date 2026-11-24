"""효과음 레시피. 파라미터는 audio/src/sfx.json에서 받는다(이 파일에는 수치를 하드코딩하지 않는 것을 원칙으로 함)."""
import math

from synth import (SR, biquad, chip_note, env_adsr, env_exp, fit_length, gain, mix_into, noise,
                   note_freq, ns, osc, rng_for, silence, voice, vowel)


# ---------- 전조 ----------

def creak(p, rng):
    """삐-걱: 스틱-슬립 임펄스 열 -> 나무 공명 밴드패스. segments마다 피치 곡선."""
    out = []
    for seg in p["segments"]:
        dur = seg["dur"]
        n = ns(dur)
        f = [seg["f0"] + (seg["f1"] - seg["f0"]) * (i / max(1, n - 1)) for i in range(n)]
        exc = [0.0] * n
        ph = 0.0
        for i in range(n):
            ph += f[i] * (1.0 + rng.uniform(-p["jitter"], p["jitter"])) / SR
            if ph >= 1.0:
                ph -= 1.0
                exc[i] = rng.uniform(0.6, 1.0)
        body = [0.0] * n
        for (fc, q, g) in p["resonators"]:
            r = biquad(exc, "bp", fc, q)
            for i in range(n):
                body[i] += r[i] * g
        e = env_adsr(n, seg["attack"], 0.0, 1.0, seg["release"])
        seg_out = [v * ev * seg["gain"] for v, ev in zip(body, e)]
        mix_into(out, seg_out, len(out) / SR + seg.get("gap", 0.0))
    return out


def _footstep(p, rng, g, lp):
    heel = biquad(noise(p["heelSec"], rng), "bp", p["heelHz"], p["heelQ"])
    heel = [v * e for v, e in zip(heel, env_exp(len(heel), 0.0005, p["heelSec"] / 4))]
    knock_d = p["knockSec"]
    knock = osc("sine", [(0, p["knockHz"][0]), (knock_d, p["knockHz"][1])], knock_d)
    knock = [v * e for v, e in zip(knock, env_exp(len(knock), 0.0005, knock_d / 4))]
    toe = biquad(noise(p["heelSec"], rng), "bp", p["heelHz"] * 0.8, p["heelQ"])
    toe = [v * e for v, e in zip(toe, env_exp(len(toe), 0.0005, p["heelSec"] / 5))]
    step = []
    mix_into(step, heel, 0, 1.0)
    mix_into(step, knock, 0, p["knockGain"])
    mix_into(step, toe, p["toeDelay"], p["toeGain"])
    if lp:
        step = biquad(step, "lp", lp, 0.7)
    return gain(step, g)


def footsteps(p, rng):
    out = silence(p.get("lengthSec", 0.0))
    for k in range(p["count"]):
        g = p["gains"][min(k, len(p["gains"]) - 1)]
        lp = p["lowpass"][min(k, len(p["lowpass"]) - 1)]
        mix_into(out, _footstep(p["step"], rng, g, lp), p["startSec"] + k * p["interval"])
    return out


def footstep_stop(p, rng):
    out = []
    t = 0.0
    for k, (g, lp) in enumerate(zip(p["gains"], p["lowpass"])):
        mix_into(out, _footstep(p["step"], rng, g, lp), t)
        t += p["interval"]
    t -= p["interval"]
    # 마지막 발에 신발 '끽' (멈춤 신호)
    sq = p["squeak"]
    d = sq["dur"]
    n = ns(d)
    f = [sq["f0"] + (sq["f1"] - sq["f0"]) * (i / n) + sq["vibDepth"] * math.sin(2 * math.pi * sq["vibHz"] * i / SR) for i in range(n)]
    x = osc("saw", f, d)
    x = biquad(x, "bp", sq["bodyHz"], 2.0)
    e = env_adsr(n, 0.005, 0.0, 1.0, d * 0.6)
    mix_into(out, [v * ev for v, ev in zip(x, e)], t + sq["delay"], sq["gain"])
    return out


def bell(p, rng):
    dur = p["dur"]
    n = ns(dur)
    out = [0.0] * n
    f0 = p["f0"]
    for (ratio, amp, tau) in p["partials"]:
        x = osc("sine", f0 * ratio, dur)
        e = env_exp(n, 0.001, tau)
        for i in range(n):
            out[i] += x[i] * e[i] * amp
    strike = biquad(noise(0.01, rng), "bp", p["strikeHz"], 1.5)
    mix_into(out, strike, 0, p["strikeGain"])
    return out


def beeps(p, rng):
    out = []
    t = 0.0
    for b in p["tones"]:
        d = b["dur"]
        n = ns(d)
        x = osc(p["wave"], b["hz"], d, duty=p.get("duty", 0.5))
        e = env_adsr(n, 0.002, 0.0, 1.0, 0.006)
        mix_into(out, [v * ev * b.get("gain", 1.0) for v, ev in zip(x, e)], t)
        t += d + b.get("gap", 0.0)
    if p.get("lowpass"):
        out = biquad(out, "lp", p["lowpass"], 0.7)
    return out


def syllables(p, rng):
    """음성 음절 리스트 렌더. 각 음절: start, dur, f0[], vowels[(t,name)], amp[], breath."""
    out = []
    for s in p["syllables"]:
        frames = [(t, vowel(v)) for (t, v) in s["vowels"]]
        x = voice(s["dur"], s["f0"], frames, s["amp"], breath=s.get("breath", 0.05), rng=rng)
        mix_into(out, x, s["start"], s.get("gain", 1.0))
    return out


def babble(p, rng):
    """두세 명이 번갈아 웅성웅성(무작위 음절이지만 시드 고정)."""
    out = silence(p["dur"])
    names = p["vowelPool"]
    for v in p["voices"]:
        t = v["offset"]
        while t < p["dur"] - 0.1:
            d = rng.uniform(*p["sylDur"])
            base = v["f0"] * rng.uniform(0.92, 1.12)
            contour = rng.choice(p["contours"])
            f0 = [(0, base), (d * 0.5, base * contour), (d, base * 0.95)]
            va, vb = rng.choice(names), rng.choice(names)
            frames = [(0, vowel(va)), (d, vowel(vb))]
            amp = [(0, 0), (0.015, 1.0), (d * 0.7, 0.8), (d, 0)]
            x = voice(d, f0, frames, amp, breath=0.04, rng=rng)
            env_global = 1.0
            if p.get("fadeOut"):
                env_global = max(0.0, 1.0 - max(0.0, t - p["fadeOut"][0]) / p["fadeOut"][1])
            mix_into(out, x, t, v["gain"] * env_global)
            t += d + rng.uniform(*p["sylGap"])
    return fit_length(out, p["dur"])


def noise_burst(p, rng):
    """기침·숨: 포먼트 필터 노이즈 + 선택적 유성음."""
    out = []
    for b in p["bursts"]:
        d = b["dur"]
        n = ns(d)
        nz = noise(d, rng)
        body = [0.0] * n
        for (fc, bw, amp) in vowel(b["vowel"]):
            r = biquad(nz, "bp", fc, fc / bw)
            for i in range(n):
                body[i] += r[i] * amp
        if b.get("shape") == "rise":
            e = [min(1.0, (i / n) ** 1.5 * 1.2) * (1.0 if i < n * 0.85 else (n - i) / (n * 0.15)) for i in range(n)]
        else:
            e = env_exp(n, b.get("attack", 0.004), b.get("tau", d / 3))
        x = [v * ev * b["gain"] for v, ev in zip(body, e)]
        if b.get("voicedHz"):
            vx = voice(d * 0.6, [(0, b["voicedHz"]), (d * 0.6, b["voicedHz"] * 0.85)],
                       [(0, vowel(b["vowel"]))], [(0, 0), (0.01, 1), (d * 0.6, 0)], breath=0, rng=rng)
            mix_into(x, vx, 0, b.get("voicedGain", 0.3))
        mix_into(out, x, b["start"])
    return out


def clicks(p, rng):
    """문 손잡이 '딸깍', 클립보드 '탁' 등 짧은 타격음 묶음."""
    out = []
    for c in p["hits"]:
        d = c["dur"]
        nz = biquad(noise(d, rng), "bp", c["hz"], c["q"])
        e = env_exp(len(nz), 0.0005, c["tau"])
        x = [v * ev for v, ev in zip(nz, e)]
        if c.get("toneHz"):
            tn = osc("sine", c["toneHz"], d)
            te = env_exp(len(tn), 0.0005, c["tau"] * 1.5)
            mix_into(x, [v * ev for v, ev in zip(tn, te)], 0, c.get("toneGain", 0.5))
        mix_into(out, x, c["start"], c["gain"])
    return out


def chip_seq(p, rng):
    """칩튠 노트 시퀀스(피드백 징글). notes: [start, dur, note|Hz|[(t,Hz)], wave, gain, duty?]"""
    out = []
    for nt in p["notes"]:
        start, dur, pitch, wave_kind, g = nt[:5]
        duty = nt[5] if len(nt) > 5 else 0.5
        if isinstance(pitch, str):
            f = note_freq(pitch)
        else:
            f = pitch
        if isinstance(f, list):
            x = osc(wave_kind, [tuple(q) for q in f], dur, duty=duty)
            e = env_adsr(len(x), 0.003, 0.03, 0.7, min(0.08, dur * 0.5))
            x = [v * ev * g for v, ev in zip(x, e)]
        else:
            x = chip_note(wave_kind, f, dur, g=g, duty=duty, a=0.003, d=p.get("decay", 0.06),
                          s=p.get("sustain", 0.6), r=min(p.get("release", 0.05), dur * 0.5),
                          vibrato=p.get("vibrato") if dur >= p.get("vibratoMinDur", 9) else None)
        mix_into(out, x, start)
    for nh in p.get("noiseHits", []):
        start, dur, hz, g = nh
        nz = biquad(noise(dur, rng), "bp", hz, 0.8)
        e = env_exp(len(nz), 0.001, dur / 3)
        mix_into(out, [v * ev for v, ev in zip(nz, e)], start, g)
    return out


def heartbeat(p, rng):
    out = silence(p["loopSec"])
    for (t, g) in p["beats"]:
        d = p["beatSec"]
        n = ns(d)
        body = osc("sine", [(0, p["bodyHz"][0]), (d, p["bodyHz"][1])], d)
        over = osc("triangle", [(0, p["overHz"][0]), (d, p["overHz"][1])], d)
        e = env_exp(n, 0.003, d / 3.5)
        x = [(a + b * p["overGain"]) * ev for a, b, ev in zip(body, over, e)]
        tick = biquad(noise(0.012, rng), "bp", p["tickHz"], 1.2)
        mix_into(x, tick, 0, p["tickGain"])
        mix_into(out, x, t, g)
    return fit_length(out, p["loopSec"])


def composite(p, rng, render):
    out = silence(p.get("dur", 0.0))
    for part in p["parts"]:
        x = render(part["recipe"], part["params"], rng)
        mix_into(out, x, part.get("at", 0.0), part.get("gain", 1.0))
    if p.get("dur"):
        out = fit_length(out, p["dur"])
    return out


def swish(p, rng):
    """옷깃·고개 돌림 '휙': 중심 주파수가 움직이는 밴드패스 노이즈(64샘플 블록 단위로 계수 갱신)."""
    d = p["dur"]
    n = ns(d)
    nz = noise(d, rng)
    out = [0.0] * n
    blk = 64
    state = None
    for b0 in range(0, n, blk):
        t = b0 / n
        fc = p["f0"] * (p["f1"] / p["f0"]) ** t
        seg = nz[b0:b0 + blk]
        w0 = 2 * math.pi * fc / SR
        al = math.sin(w0) / (2 * p["q"])
        a0 = 1 + al
        c = (al / a0, 0.0, -al / a0, -2 * math.cos(w0) / a0, (1 - al) / a0)
        x1, x2, y1, y2 = state or (0.0, 0.0, 0.0, 0.0)
        for i, v in enumerate(seg):
            y = c[0] * v + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2
            x2, x1, y2, y1 = x1, v, y1, y
            out[b0 + i] = y
        state = (x1, x2, y1, y2)
    pk = p["peakAt"]
    e = [((i / n) / pk) ** 2 if i / n < pk else math.exp(-((i / n) - pk) * p["decay"]) for i in range(n)]
    out = [v * ev for v, ev in zip(out, e)]
    if p.get("voice"):
        v = p["voice"]
        from synth import voice as _voice
        vx = _voice(v["dur"], v["f0"], [(0, vowel(v["vowel"]))], v["amp"], breath=0.05, rng=rng)
        mix_into(out, vx, v["at"], v["gain"])
    return out


def rattle(p, rng):
    """의자 바퀴 '드르륵'(T-147): 밴드패스 노이즈를 불규칙 펄스열(바닥 이음새 덜컹)로 진폭 변조.
    rateHz [시작, 끝]으로 굴러가다 느려지는 느낌. floor = 펄스 사이 남는 바닥 마찰 비율."""
    d = p["dur"]
    n = ns(d)
    nz = noise(d, rng)
    body = [0.0] * n
    for (fc, q, g) in p["bands"]:
        r = biquad(nz, "bp", fc, q)
        for i in range(n):
            body[i] += r[i] * g
    am = [p["floor"]] * n
    bump_n = ns(p["bumpSec"])
    t = 0.0
    while t < d:
        i0 = ns(t)
        a = rng.uniform(0.6, 1.0)
        for k in range(bump_n):
            if i0 + k < n:
                am[i0 + k] += a * math.exp(-k / (bump_n / 3.0))
        r0, r1 = p["rateHz"]
        rate = r0 + (r1 - r0) * (t / d)
        t += (1.0 / rate) * (1.0 + rng.uniform(-p["jitter"], p["jitter"]))
    e = env_adsr(n, p["attack"], 0.0, 1.0, p["release"])
    return [v * m * ev for v, m, ev in zip(body, am, e)]


def hum(p, rng):
    """모터 웅- (프린터, T-147). 루프용: warm 구간을 렌더한 뒤 버려 필터 정상 상태에서 시작.
    hz × dur, hz × warmSec가 정수가 되게 고르면 이음새에서 위상이 이어짐. wobbleHz도 같은 조건."""
    d = p["dur"]
    warm = p.get("warmSec", d)
    tot = d + warm
    x = osc(p["wave"], p["hz"], tot)
    y = [0.0] * len(x)
    for (fc, q, g) in p["bands"]:
        r = biquad(x, "bp", fc, q)
        for i in range(len(x)):
            y[i] += r[i] * g
    if p.get("noiseGain"):
        nz = biquad(noise(tot, rng), "bp", p["noiseHz"], p.get("noiseQ", 1.0))
        for i in range(len(x)):
            y[i] += nz[i] * p["noiseGain"]
    w = p.get("wobbleHz", 0.0)
    if w:
        dep = p.get("wobbleDepth", 0.2)
        y = [v * (1.0 - dep + dep * math.cos(2 * math.pi * w * i / SR)) for i, v in enumerate(y)]
    return y[ns(warm):ns(warm) + ns(d)]


RECIPES = {
    "rattle": rattle,
    "hum": hum,
    "swish": swish,
    "creak": creak,
    "footsteps": footsteps,
    "footstep_stop": footstep_stop,
    "bell": bell,
    "beeps": beeps,
    "syllables": syllables,
    "babble": babble,
    "noise_burst": noise_burst,
    "clicks": clicks,
    "chip_seq": chip_seq,
    "heartbeat": heartbeat,
}


def render(recipe, params, rng):
    if recipe == "composite":
        return composite(params, rng, render)
    return RECIPES[recipe](params, rng)
