"""몰래퇴근 절차적 사운드 합성 라이브러리 (표준 라이브러리만 사용).

- 모든 신호는 float 리스트(-1..1), 모노, 샘플레이트 SR.
- 난수는 반드시 random.Random(seed)로 만든 인스턴스만 사용 -> 재생성 결정적.
"""
import math
import random
import struct
import wave

SR = 22050
TAU = 2.0 * math.pi


def ns(sec, sr=SR):
    return max(0, int(round(sec * sr)))


def silence(sec):
    return [0.0] * ns(sec)


def note_freq(name):
    """'A4', 'C#5', 'Bb3' -> Hz (A4 = 440)."""
    names = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}
    letter = name[0]
    rest = name[1:]
    semi = names[letter]
    while rest and rest[0] in "#b":
        semi += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    octave = int(rest)
    semi += (octave - 4) * 12
    return 440.0 * (2.0 ** (semi / 12.0))


def curve(points, n, sr=SR):
    """[(t, v), ...] 선형 보간 곡선을 n 샘플로."""
    out = [0.0] * n
    pts = sorted(points)
    j = 0
    for i in range(n):
        t = i / sr
        while j < len(pts) - 2 and t > pts[j + 1][0]:
            j += 1
        if t <= pts[0][0]:
            out[i] = pts[0][1]
        elif t >= pts[-1][0]:
            out[i] = pts[-1][1]
        else:
            t0, v0 = pts[j]
            t1, v1 = pts[j + 1]
            a = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            out[i] = v0 + (v1 - v0) * a
    return out


def as_curve(f, n):
    if isinstance(f, (int, float)):
        return [float(f)] * n
    if isinstance(f, list) and f and isinstance(f[0], (list, tuple)):
        return curve([tuple(p) for p in f], n)
    return list(f)


def _blep(t, dt):
    if t < dt:
        t /= dt
        return t + t - t * t - 1.0
    if t > 1.0 - dt:
        t = (t - 1.0) / dt
        return t * t + t + t + 1.0
    return 0.0


def osc(kind, freq, dur, duty=0.5, phase=0.0, sr=SR):
    """kind: sine | square | pulse | saw | triangle. freq: 숫자, [(t,Hz)...] 또는 리스트. PolyBLEP 대역 제한."""
    n = ns(dur, sr)
    fc = as_curve(freq, n)
    out = [0.0] * n
    ph = phase
    tri = 0.0
    for i in range(n):
        dt = fc[i] / sr
        if kind == "sine":
            v = math.sin(TAU * ph)
        elif kind in ("square", "pulse"):
            d = duty if kind == "pulse" else 0.5
            v = 1.0 if ph < d else -1.0
            v += _blep(ph, dt)
            v -= _blep((ph - d) % 1.0, dt)
        elif kind == "saw":
            v = 2.0 * ph - 1.0 - _blep(ph, dt)
        elif kind == "triangle":
            # 칩튠식 4비트 계단 삼각파(NES 느낌)
            x = 4.0 * ph - 1.0 if ph < 0.5 else 3.0 - 4.0 * ph
            v = round(x * 7.5) / 7.5
        else:
            raise ValueError(kind)
        out[i] = v
        ph += dt
        ph -= math.floor(ph)
    return out


def noise(dur, rng, sr=SR):
    return [rng.uniform(-1.0, 1.0) for _ in range(ns(dur, sr))]


def chip_noise(dur, rate_hz, rng, sr=SR):
    """샘플앤홀드 노이즈(칩튠 드럼). rate_hz가 높을수록 밝음."""
    n = ns(dur, sr)
    out = [0.0] * n
    hold = max(1, int(sr / rate_hz))
    v = 0.0
    for i in range(n):
        if i % hold == 0:
            v = rng.choice((-1.0, 1.0))
        out[i] = v
    return out


def env_ar(n, attack, release, sr=SR):
    a = max(1, ns(attack, sr))
    r = max(1, ns(release, sr))
    out = [1.0] * n
    for i in range(min(a, n)):
        out[i] = i / a
    for k in range(min(r, n)):
        out[n - 1 - k] *= k / r
    return out


def env_exp(n, attack, decay_tau, sr=SR):
    a = max(1, ns(attack, sr))
    out = [0.0] * n
    for i in range(n):
        if i < a:
            out[i] = i / a
        else:
            out[i] = math.exp(-((i - a) / sr) / decay_tau)
    return out


def env_adsr(n, a, d, s, r, sr=SR):
    A, D, R = ns(a, sr), ns(d, sr), ns(r, sr)
    out = [0.0] * n
    rel_start = max(0, n - R)
    for i in range(n):
        if i < A:
            v = i / max(1, A)
        elif i < A + D:
            v = 1.0 - (1.0 - s) * (i - A) / max(1, D)
        else:
            v = s
        if i >= rel_start:
            v *= (n - i) / max(1, R)
        out[i] = v
    return out


def mul(x, y):
    return [a * b for a, b in zip(x, y)]


def gain(x, g):
    return [a * g for a in x]


def mix_into(dst, src, at_sec=0.0, g=1.0, sr=SR):
    o = ns(at_sec, sr)
    need = o + len(src)
    if need > len(dst):
        dst.extend([0.0] * (need - len(dst)))
    for i, v in enumerate(src):
        dst[o + i] += v * g
    return dst


def onepole_lp(x, fc, sr=SR):
    a = math.exp(-TAU * fc / sr)
    y, out = 0.0, [0.0] * len(x)
    for i, v in enumerate(x):
        y = (1 - a) * v + a * y
        out[i] = y
    return out


def biquad(x, kind, f, q=0.707, sr=SR):
    """RBJ 쿡북 biquad. kind: lp | hp | bp(0dB 피크)."""
    w0 = TAU * f / sr
    cw, sw = math.cos(w0), math.sin(w0)
    al = sw / (2 * q)
    if kind == "lp":
        b0, b1, b2 = (1 - cw) / 2, 1 - cw, (1 - cw) / 2
    elif kind == "hp":
        b0, b1, b2 = (1 + cw) / 2, -(1 + cw), (1 + cw) / 2
    elif kind == "bp":
        b0, b1, b2 = al, 0.0, -al
    else:
        raise ValueError(kind)
    a0, a1, a2 = 1 + al, -2 * cw, 1 - al
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    x1 = x2 = y1 = y2 = 0.0
    out = [0.0] * len(x)
    for i, v in enumerate(x):
        y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, y
        out[i] = y
    return out


def peak(x):
    return max((abs(v) for v in x), default=0.0)


def normalize(x, target_db):
    p = peak(x)
    if p == 0:
        return x
    g = (10 ** (target_db / 20.0)) / p
    return [v * g for v in x]


def fade_edges(x, fin=0.002, fout=0.005):
    n = len(x)
    a, b = ns(fin), ns(fout)
    for i in range(min(a, n)):
        x[i] *= i / a
    for k in range(min(b, n)):
        x[n - 1 - k] *= k / b
    return x


def trim_tail(x, thresh_db=-60.0, keep=0.01):
    th = 10 ** (thresh_db / 20.0)
    last = 0
    for i in range(len(x) - 1, -1, -1):
        if abs(x[i]) > th:
            last = i
            break
    return x[: min(len(x), last + ns(keep))]


def fit_length(x, sec):
    n = ns(sec)
    if len(x) >= n:
        return x[:n]
    return x + [0.0] * (n - len(x))


def soft_clip(x, drive=1.0):
    return [math.tanh(v * drive) / math.tanh(drive) for v in x]


def write_wav(path, x, sr=SR):
    frames = bytearray()
    for v in x:
        s = int(round(max(-1.0, min(1.0, v)) * 32767))
        frames += struct.pack("<h", s)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(bytes(frames))


def read_wav(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    n = len(raw) // 2
    vals = struct.unpack("<%dh" % n, raw)
    return [v / 32768.0 for v in vals], sr


# ---------- 음성(포먼트) 합성: 가산 합성 + 포먼트 포락선 ----------

def _formant_gain(f, formants):
    g = 0.0
    for (fc, bw, amp) in formants:
        g += amp / (1.0 + ((f - fc) / (bw * 0.5)) ** 2)
    return g


def voice(dur, f0_points, formant_frames, amp_points, breath=0.05, rng=None, max_hz=5000.0, sr=SR):
    """f0_points: [(t,Hz)], formant_frames: [(t, [(Fc,BW,amp),...])] (선형 보간),
    amp_points: [(t,amp)]. 성대 펄스 = 고조파 합(1/k 기울기)."""
    n = ns(dur, sr)
    f0 = curve([tuple(p) for p in f0_points], n, sr)
    amp = curve([tuple(p) for p in amp_points], n, sr)
    frames = sorted(formant_frames, key=lambda fr: fr[0])
    nform = len(frames[0][1])
    # 포먼트 파라미터를 제어율(1ms)로 보간
    ctrl = max(1, sr // 1000)
    out = [0.0] * n
    kmax = int(max_hz / max(60.0, min(f0)))
    phases = [0.0] * (kmax + 1)
    gains = [0.0] * (kmax + 1)
    for i in range(n):
        if i % ctrl == 0:
            t = i / sr
            # 현재 포먼트
            if t <= frames[0][0]:
                cur = frames[0][1]
            elif t >= frames[-1][0]:
                cur = frames[-1][1]
            else:
                j = 0
                while frames[j + 1][0] < t:
                    j += 1
                ta, fa = frames[j]
                tb, fb = frames[j + 1]
                a = (t - ta) / (tb - ta)
                cur = [tuple(fa[m][q] + (fb[m][q] - fa[m][q]) * a for q in range(3)) for m in range(nform)]
            for k in range(1, kmax + 1):
                fk = k * f0[i]
                gains[k] = 0.0 if fk > max_hz else _formant_gain(fk, cur) / k ** 0.6
        s = 0.0
        for k in range(1, kmax + 1):
            if gains[k]:
                phases[k] += k * f0[i] / sr
                s += gains[k] * math.sin(TAU * phases[k])
        out[i] = s * amp[i]
    if breath and rng is not None:
        nz = biquad(noise(dur, rng, sr), "bp", 2500, 0.8, sr)
        for i in range(n):
            out[i] += nz[i] * amp[i] * breath
    return out


VOWELS = {
    # (Fc, BW, amp) x3  — 한국어 모음 근사
    "a": [(800, 120, 1.0), (1250, 140, 0.7), (2600, 200, 0.35)],
    "e": [(520, 100, 1.0), (1850, 150, 0.75), (2600, 200, 0.4)],
    "i": [(300, 90, 1.0), (2250, 160, 0.7), (3000, 220, 0.45)],
    "o": [(480, 100, 1.0), (850, 120, 0.7), (2500, 200, 0.25)],
    "u": [(350, 90, 1.0), (800, 120, 0.5), (2300, 200, 0.2)],
    "eo": [(600, 110, 1.0), (1000, 130, 0.7), (2500, 200, 0.3)],
    "eu": [(380, 90, 1.0), (1500, 150, 0.55), (2500, 200, 0.3)],
    "m": [(280, 80, 1.0), (1200, 200, 0.25), (2400, 250, 0.2)],
}


def vowel(name):
    return [list(f) for f in VOWELS[name]]


# ---------- 칩튠 노트 렌더 ----------

def chip_note(wave_kind, freq, dur, g=1.0, duty=0.5, a=0.003, d=0.05, s=0.6, r=0.03, vibrato=None):
    n = ns(dur)
    if vibrato:
        rate, depth, delay = vibrato
        fc = []
        for i in range(n):
            t = i / SR
            m = 0.0 if t < delay else depth * math.sin(TAU * rate * (t - delay))
            fc.append(freq * (2 ** (m / 12.0)))
        x = osc(wave_kind, fc, dur, duty=duty)
    else:
        x = osc(wave_kind, freq, dur, duty=duty)
    e = env_adsr(n, a, d, s, r)
    return [v * ev * g for v, ev in zip(x, e)]


def kick(rng, g=1.0, dur=0.12, f_hi=160.0, f_lo=50.0):
    n = ns(dur)
    fc = [f_lo + (f_hi - f_lo) * math.exp(-(i / SR) / 0.025) for i in range(n)]
    x = osc("sine", fc, dur)
    e = env_exp(n, 0.001, dur / 3)
    click = biquad(noise(0.006, rng), "bp", 1800, 1.0)
    out = [v * ev * g for v, ev in zip(x, e)]
    return mix_into(out, click, 0, 0.35 * g)


def snare(rng, g=1.0, dur=0.12):
    n = ns(dur)
    nz = biquad(chip_noise(dur, 9000, rng), "bp", 2200, 0.7)
    tone = osc("triangle", [(0, 330), (dur, 180)], dur)
    e = env_exp(n, 0.001, dur / 4)
    return [(a * 0.9 + b * 0.35) * ev * g for a, b, ev in zip(nz, tone, e)]


def hat(rng, g=1.0, dur=0.04):
    n = ns(dur)
    nz = biquad(chip_noise(dur, 11000, rng), "hp", 6000, 0.7)
    e = env_exp(n, 0.0005, dur / 4)
    return [v * ev * g for v, ev in zip(nz, e)]


def rng_for(seed):
    return random.Random(seed)
