# 생성 맵 참조 프로토타입 (기획 T-142). 개발 구현이 아니라 '규칙이 성립하는지' 확인용.
# 사용: python3 -I molrae-toegeun/design/tools/layout_proto.py molrae-toegeun/game/data/layout.json molrae-toegeun/game/data/maps.json 200 [--show]
# - 조립(assembly)·수리(repair)·검증 V01·V03·V04·V05·V08·V09·V10②·V12·V13(모듈 순서만)을 구현. V06 우회·V10①③·V11·V14는 미구현(개발 검증기 몫)
# - 미션 목록은 실제 생성기가 아니라 해금된 미션 중 무작위 2개(파이썬 random, 일차 고정 시드)로 근사. 대표님 날 = 28일차~ 수요일
# - RNG는 core/rng.ts(cyrb128 + sfc32) 이식이지만 시드 문자열은 기획 스크래치 형식(day-{n}-layout-{k})이라 개발 결과와 맵이 같지 않음
# 생성기 + 검증 참조 프로토타입 (기획 스크래치). 사용: python3 -I proto.py layout.json maps.json [days]
import json, sys, math, heapq, hashlib
from collections import deque, Counter, defaultdict

LAY = json.load(open(sys.argv[1]))
MAPS = json.load(open(sys.argv[2]))
BASE_LEG = MAPS["maps"][0]["legend"]
LEG = dict(BASE_LEG); LEG.update(LAY["legendAdd"])
W = LAY["grid"]["width"]

# --- RNG: sfc32 + cyrb128 (rng.ts 이식) ---
M32 = 0xFFFFFFFF
def imul(a, b): return (a * b) & M32
def cyrb128(s):
    h1, h2, h3, h4 = 1779033703, 3144134277, 1013904242, 2773480762
    for ch in s:
        k = ord(ch)
        h1 = h2 ^ imul(h1 ^ k, 597399067)
        h2 = h3 ^ imul(h2 ^ k, 2869860233)
        h3 = h4 ^ imul(h3 ^ k, 951274213)
        h4 = h1 ^ imul(h4 ^ k, 2716044179)
    h1 = imul(h3 ^ (h1 >> 18), 597399067); h2 = imul(h4 ^ (h2 >> 22), 2869860233)
    h3 = imul(h1 ^ (h3 >> 17), 951274213); h4 = imul(h2 ^ (h4 >> 19), 2716044179)
    h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1
    return [h1 & M32, h2 & M32, h3 & M32, h4 & M32]
class Rng:
    def __init__(self, seed):
        self.a, self.b, self.c, self.d = cyrb128(seed)
    def next(self):
        a, b, c, d = self.a, self.b, self.c, self.d
        t = (((a + b) & M32) + d) & M32
        d = (d + 1) & M32
        a = b ^ (b >> 9)
        b = (c + ((c << 3) & M32)) & M32
        c = ((c << 21) | (c >> 11)) & M32
        c = (c + t) & M32
        self.a, self.b, self.c, self.d = a, b, c, d
        return t / 4294967296
    def int(self, lo, hi): return lo + int(self.next() * (hi - lo + 1))
    def chance(self, p): return self.next() < p
    def weighted(self, items, wf):
        tot = sum(max(0, wf(i)) for i in items)
        if tot <= 0: return None
        r = self.next() * tot
        for i in items:
            r -= max(0, wf(i))
            if r < 0: return i
        return items[-1]
    def shuffle(self, items):
        a = list(items)
        for i in range(len(a) - 1, 0, -1):
            j = int(self.next() * (i + 1)); a[i], a[j] = a[j], a[i]
        return a

def lerp(a, b, t): return a + (b - a) * t
MODS = {m["id"]: m for m in LAY["modules"]}
BYGROUP = defaultdict(list)
for m in LAY["modules"]: BYGROUP[m["group"]].append(m)

RANKS = [("intern", 1, 5), ("staff", 6, 15), ("assistant_manager", 16, 27), ("manager", 28, 40),
         ("deputy_general_manager", 41, 52), ("general_manager", 53, 64), ("executive", 65, None)]
CBR = {r["rankId"]: r for r in LAY["complexityByRank"]}
def rank_of(day):
    for rid, a, b in RANKS:
        if b is None or day <= b:
            if day >= a:
                if rid == "intern": t = (day - 3) / 2
                elif b is None: t = 0
                else: t = (day - a) / (b - a)
                return rid, max(0, min(1, t))
    raise Exception
def wpick(rng, opts, c):
    return rng.weighted(opts, lambda o: lerp(o["weight"][0], o["weight"][1], c))["ch"]

def mirror_mod(m):
    rows = [r[::-1] for r in m["rows"]]
    sw = {"left": "right", "right": "left"}
    def ms(s):
        s = dict(s); s["tile"] = [W - 1 - s["tile"][0], s["tile"][1]]
        for k in ("facing", "glanceDir"):
            if k in s: s[k] = sw.get(s[k], s[k])
        if "lookDirs" in s: s["lookDirs"] = [sw.get(d, d) for d in s["lookDirs"]]
        return s
    n = dict(m); n["rows"] = rows; n["_m"] = not m.get("_m")
    n["spots"] = {k: ms(v) for k, v in m["spots"].items()}
    n["routeNodes"] = {k: [W - 1 - v[0], v[1]] for k, v in m["routeNodes"].items()}
    if "ports" in m:
        n["ports"] = {k: ([W - 1 - x for x in v] if isinstance(v, list) else v) for k, v in m["ports"].items()}
    return n

def mod_connected(m, rows):
    occ = {tuple(m["spots"][k]["tile"]) for k in ("tl_seat","tl2_seat","snitch_seat","accomplice_seat","bg_next_team_seat","buddy_seat","exec_seat") if k in m["spots"]}
    cells = {(x, y) for y in range(len(rows)) for x in range(W) if LEG[rows[y][x]]["walkable"] and (x, y) not in occ}
    if not cells: return True
    start = next(iter(sorted(cells))); seen = {start}; q = [start]
    while q:
        x, y = q.pop()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            n = (x+dx, y+dy)
            if n in cells and n not in seen: seen.add(n); q.append(n)
    # 1칸 고립(벽 사이 장식 틈)은 허용하지 않음: 전부 연결돼야 함
    return seen == cells
def guard_module(m, rows):
    if mod_connected(m, rows): return rows
    orig = m["rows"]
    rows = [list(r) for r in rows]
    for wc in ("!", "?", "o"):
        for y in range(len(orig)):
            for x in range(W):
                if orig[y][x] == wc and rows[y][x] != ".":
                    rows[y][x] = "."
                    if mod_connected(m, ["".join(r) for r in rows]): return ["".join(r) for r in rows]
    return ["".join(r) for r in rows]

def gen(day, attempt, missions, ceo_day, roam_dests):
    rid, t = rank_of(day)
    tier = CBR[rid]; c = lerp(tier["complexity"][0], tier["complexity"][1], t)
    rng = Rng(f"day-{day}-layout-{attempt}")
    need = set()
    for ms in missions:
        p = LAY["assembly"]["missionRequiresProvides"].get(ms)
        if p: need.add(p)
    nopt = rng.int(*tier["optionalModules"]); nlow = rng.int(*tier["lowerModules"])
    if ceo_day: nopt, nlow = LAY["assembly"]["ceoDay"]["optionalModules"], LAY["assembly"]["ceoDay"]["lowerModules"]
    def pick_var(group):
        cands = [m for m in BYGROUP[group] if m.get("minComplexity", 0) <= c + 1e-9]
        return rng.weighted(cands, lambda m: lerp(*(m.get("weightByComplexity", [1, 1])), c))
    top = pick_var("lobby_exit"); ex = pick_var("exec"); nt = pick_var("next_team"); rm = pick_var("rest_meet")
    team = pick_var("team"); bot = pick_var("service_end")
    provided = set()
    for m in (top, ex, nt, rm, team, bot): provided |= set(m["provides"])
    opt = []
    if bot.get("requiresGroup"): opt.append(pick_var(bot["requiresGroup"]))
    for p in sorted(need):
        alts = p.split("|")
        if any(a in provided for a in alts) or any(a in o["provides"] for o in opt for a in alts): continue
        p = alts[0]
        if True:
            g = next(g for g in LAY["assembly"]["optionalPool"] if any(p in m["provides"] for m in BYGROUP[g]))
            cand = [m for m in BYGROUP[g] if p in m["provides"]]
            opt.append(cand[0])
    pool = [g for g in LAY["assembly"]["optionalPool"]]
    while len(opt) < nopt:
        g = rng.weighted(pool, lambda g: max(lerp(*(m.get("weightByComplexity", [1, 1])), c) * (1 if m.get("minComplexity", 0) <= c else 0) for m in BYGROUP[g]))
        if g is None: break
        m = pick_var(g)
        if m is None: break
        if any(o["group"] == g for o in opt) and not m.get("repeatable"):
            pool = [x for x in pool if x != g]; continue
        opt.append(m)
    lower = []; below_rows = 0
    req_ids = set()
    for p_ in need:
        for o in opt:
            if any(a in o["provides"] for a in p_.split("|")): req_ids.add(id(o))
    if bot.get("requiresGroup"):
        for o in opt:
            if o["group"] == bot["requiresGroup"]: req_ids.add(id(o))
    mids = [nt]
    if nlow and rng.chance(lerp(*LAY["assembly"]["restMeetBelowChance"], c)) and len(rm["rows"]) + 1 <= tier["belowTeamMaxRows"]:
        lower.append(rm); below_rows += len(rm["rows"]) + 1
    else:
        mids.append(rm)
    rows_above = sum(len(m["rows"]) + 1 for m in mids) + len(ex["rows"]) + 1
    keep = []
    for o in opt:
        h = len(o["rows"]) + 1
        if rows_above + h <= tier["aboveTeamMaxRows"] and sum(1 for k_ in keep if id(k_) not in req_ids) < 1:
            keep.append(o); rows_above += h
        elif len(lower) < nlow and o["group"] in LAY["assembly"]["belowTeamAllowedGroups"] and below_rows + h <= tier["belowTeamMaxRows"]:
            lower.append(o); below_rows += h
        elif id(o) in req_ids:
            keep.append(o); rows_above += h
    opt = keep
    lower = rng.shuffle(lower)
    above = rng.shuffle(mids + opt)
    if tier.get("orderPolicy") == "authored_order": above = mids + opt
    seq = [top, ex] + above + [team] + lower + [bot]
    # 인접 포트 호환 검사: 맞는 열이 없으면 사이에 mid_junction_pillars 삽입
    def compat(a, b):
        pb = a.get("ports", {}).get("bottom"); pt = b.get("ports", {}).get("top")
        for x in range(1, W - 1):
            for ma in (False, True):
                pass
        return True
    fixed = [seq[0]]
    for m in seq[1:]:
        a = fixed[-1]
        pb = a.get("ports", {}).get("bottom"); pt = m.get("ports", {}).get("top")
        if pb is not None and pt is not None and not (set(pb) & set(pt)) and not (set(pb) & {W-1-x for x in pt}):
            fixed.append(MODS["mid_junction_pillars"])
        fixed.append(m)
    seq = fixed
    ti = next(i for i, m in enumerate(seq) if m["group"] == "team")
    if sum(len(m["rows"]) + 1 for m in seq[ti + 1:-1]) > tier["belowTeamMaxRows"]: return None, "row_budget"
    seq = [mirror_mod(m) if m.get("mirrorable") and rng.chance(0.5) else m for m in seq]
    out = [seq[0]]
    for m in seq[1:]:
        a = out[-1]
        wk = lambda ch: ch in "?!o" or LEG[ch]["walkable"]
        cols = [x for x in range(1, W-1) if wk(a["rows"][-1][x]) and wk(m["rows"][0][x])
                and x in a.get("ports", {}).get("bottom", range(W)) and x in m.get("ports", {}).get("top", range(W))]
        if not cols and m.get("mirrorable"):
            m2 = mirror_mod(m) if not m.get("_m") else MODS[m["id"]]
            m = m2
        out.append(m)
    seq = out
    # wildcard fill
    filled = []
    for m in seq:
        rows = []
        last = len(m["rows"]) - 1
        for yi, r in enumerate(m["rows"]):
            edge = yi in (0, last) and m["group"] not in ("lobby_exit", "service_end")
            rows.append("".join(("." if edge else wpick(rng, LAY["wildcards"][ch], c)) if ch in LAY["wildcards"] else ch for ch in r))
        rows = guard_module(m, rows)
        mm = dict(m); mm["rows"] = rows; filled.append(mm)
    # assemble with seams
    grid = []; spots = {}; nodes = {}; placed = []; seams = []
    sm = LAY["seam"]
    for i, m in enumerate(filled):
        if i > 0:
            prev = filled[i - 1]
            pb = prev.get("ports", {}).get("bottom"); nt_ = m.get("ports", {}).get("top")
            cols = [x for x in range(1, W - 1) if LEG[prev["rows"][-1][x]]["walkable"] and LEG[m["rows"][0][x]]["walkable"]
                    and (pb is None or x in pb) and (nt_ is None or x in nt_)]
            doorcols = set(prev.get("ports", {}).get("doorCols", [])) | set(m.get("ports", {}).get("doorCols", []))
            ov = sm["topSeamOverride"] if i == 1 else {}
            o0 = ov.get("openings", sm["openings"]); o1 = ov.get("openingsAtMax", sm["openingsAtMax"])
            lo = round(lerp(o0[0], o1[0], c)); hi = round(lerp(o0[1], o1[1], c))
            n = rng.int(lo, max(lo, hi))
            wide = ov.get("wideOpening", sm["wideOpening"])
            row = ["#"] * W
            req = set(prev.get("ports", {}).get("required", {}).get("bottom", [])) | set(m.get("ports", {}).get("required", {}).get("top", []))
            chosen = [x for x in cols if x in req]
            dchance = max([lerp(*mm.get("ports", {}).get("doorOpenChance", [0, 0]), c) for mm in (prev, m)])
            for x in sorted(doorcols):
                if x in cols and x not in chosen and rng.chance(dchance): chosen.append(x)
            prevop = set(seams[-1][1]) if seams else set()
            bonus = lerp(*sm["spineBonus"], c)
            cand = [x for x in cols if x not in chosen and x not in doorcols]
            while len(chosen) < n and cand:
                x = rng.weighted(cand, lambda x: 1 + bonus * (1 if (x in sm["spineCols"] or x in prevop) else 0))
                cand.remove(x)
                if all(abs(x - y) >= sm["minGapBetweenOpenings"] + 1 for y in chosen): chosen.append(x)
            if not chosen: return None, "seam_incompatible"  # 프로토: 조립 단계에서 미리 연결부를 끼우므로 거의 안 남
            for x in chosen:
                ch = "=" if x in doorcols else wpick(rng, sm["openChars"], c)
                row[x] = ch
            if not doorcols & set(chosen) and rng.chance(lerp(wide["chance"][0], wide["chance"][1], c)):
                x = chosen[0]; wdt = rng.int(*wide["width"])
                for dx in range(1, wdt):
                    for xx in (x + dx, x - dx):
                        if xx in cols and row[xx] == "#" and sum(1 for k in row if k != "#") < len(chosen) + wdt - 1:
                            row[xx] = "."
                for k in range(W):
                    if row[k] == "=" and k not in doorcols: row[k] = "."
            seams.append((len(grid), tuple(k for k in range(W) if row[k] != "#")))
            grid.append("".join(row))
        y0 = len(grid)
        placed.append((m["id"], y0, len(m["rows"])))
        for k, s in m["spots"].items():
            spots[k] = dict(s, tile=[s["tile"][0], s["tile"][1] + y0])
        for k, v in m["routeNodes"].items(): nodes[k] = [v[0], v[1] + y0]
        grid += m["rows"]
    if len(grid) > LAY["grid"]["maxHeight"]: return None, "too_tall"
    L0 = dict(rows=grid, spots=spots, nodes=nodes, seams=seams, c=c, rid=rid, tier=tier)
    repairs = repair(L0, missions, ceo_day)
    grid = L0["rows"]; seams = L0["seams"]
    return dict(repairs=repairs, rows=grid, spots=spots, nodes=nodes, placed=placed, seams=seams, c=c, rid=rid, tier=tier,
                seq=tuple((m["id"]) for m in filled)), None

# ---------- validators ----------
def walkable(G, x, y): return 0 <= x < W and 0 <= y < len(G) and LEG[G[y][x]]["walkable"] and not LEG[G[y][x]].get("gateOnly")
def bsight(G, x, y): return LEG[G[y][x]]["blocksSight"]
def occupied_seats(L):
    occ = set()
    for k in ("tl_seat", "tl2_seat", "snitch_seat", "accomplice_seat", "bg_next_team_seat", "buddy_seat", "exec_seat"):
        if k in L["spots"]: occ.add(tuple(L["spots"][k]["tile"]))
    return occ
def bfs(G, start, blocked, gate_ok=True):
    H = len(G); dist = {start: 0}; q = deque([start])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if (nx, ny) in dist or not (0 <= ny < H and 0 <= nx < W): continue
            e = LEG[G[ny][nx]]
            if not e["walkable"]: continue
            if (nx, ny) in blocked: continue
            dist[(nx, ny)] = dist[(x, y)] + 1; q.append((nx, ny))
    return dist
def astar(G, s, g, blocked, penal=None):
    H = len(G); pq = [(0, 0, s)]; best = {s: 0}; prev = {}
    while pq:
        f, cost, cur = heapq.heappop(pq)
        if cur == g: break
        if cost > best.get(cur, 1e9): continue
        x, y = cur
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if not (0 <= n[1] < H and 0 <= n[0] < W): continue
            if not LEG[G[n[1]][n[0]]]["walkable"] or (n in blocked and n != g): continue
            nc = cost + 1 + (penal.get(n, 0) if penal else 0)
            if nc < best.get(n, 1e9):
                best[n] = nc; prev[n] = cur
                heapq.heappush(pq, (nc + abs(n[0] - g[0]) + abs(n[1] - g[1]), nc, n))
    if g not in prev and g != s: return None
    p = [g]
    while p[-1] != s: p.append(prev[p[-1]])
    return p[::-1]
def cover_tiles(G):
    s = set()
    for y in range(len(G)):
        for x in range(W):
            if LEG[G[y][x]]["walkable"] and any(0 <= x + dx < W and 0 <= y + dy < len(G) and LEG[G[y + dy][x + dx]].get("cover")
                                               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                s.add((x, y))
    return s
def uncovered_straight(G, cov):
    best = 0; H = len(G)
    for x in range(W):
        run = 0
        for y in range(H):
            if bsight(G, x, y) or (x, y) in cov: run = 0
            elif LEG[G[y][x]]["walkable"]: run += 1; best = max(best, run)
    for y in range(H):
        run = 0
        for x in range(W):
            if bsight(G, x, y) or (x, y) in cov: run = 0
            elif LEG[G[y][x]]["walkable"]: run += 1; best = max(best, run)
    return best
def los(G, a, b):
    (x0, y0), (x1, y1) = a, b
    n = max(abs(x1 - x0), abs(y1 - y0)) * 4
    for i in range(1, n):
        x = x0 + 0.5 + (x1 - x0) * i / n; y = y0 + 0.5 + (y1 - y0) * i / n
        tx, ty = int(x), int(y)
        if (tx, ty) in (a, b): continue
        if bsight(G, tx, ty): return False
    return True
DV = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
def in_cone(G, o, d, tgt, rng_=5, half=30):
    dx, dy = tgt[0] - o[0], tgt[1] - o[1]
    dist = math.hypot(dx, dy)
    if dist > rng_ or dist == 0: return False
    fx, fy = DV[d]
    if (dx * fx + dy * fy) / dist < math.cos(math.radians(half)): return False
    return los(G, o, tgt)
def dead_ends(G, occ, spots):
    H = len(G); sp = {tuple(s["tile"]) for s in spots.values()}
    def nb(p):
        return [(p[0] + dx, p[1] + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= p[1] + dy < H and LEG[G[p[1] + dy][p[0] + dx]]["walkable"] and (p[0] + dx, p[1] + dy) not in occ]
    out = []
    for y in range(H):
        for x in range(W):
            p = (x, y)
            if not LEG[G[y][x]]["walkable"] or p in occ or p in sp: continue
            if len(nb(p)) != 1: continue
            chain = [p]; prev = None; cur = p
            while True:
                ns = [n for n in nb(cur) if n != prev]
                if len(nb(cur)) >= 3 or not ns: break
                if len(ns) != 1: break
                prev, cur = cur, ns[0]
                if len(nb(cur)) >= 3: break
                chain.append(cur)
            if len(chain) >= 2: out.append(len(chain))
    return out
def width1_runs(G, path):
    best = 0; run = 0
    for (x, y) in path:
        l = LEG[G[y][x - 1]]["walkable"] if x > 0 else False
        r = LEG[G[y][x + 1]]["walkable"] if x < W - 1 else False
        if not l and not r and G[y][x] != "G": run += 1; best = max(best, run)
        else: run = 0
    return best

MREF = LAY["missionRefOneWayTiles"]
SPOT_OF = {"coffee": "coffee_use", "restroom": "restroom_stall", "nap": "nap_chair", "parcel": "parcel_use", "print": "printer_use",
           "chat": "chat_use", "cafe": "cafe_use", "window": "window_use"}
def repair(L, missions, ceo_day):
    SPOT_OF["print"] = "printer_use" if "printer_use" in L["spots"] else "copier_use"
    """거리 초과 수리: 이음 행에 개구부를 하나씩 추가(최대 3). 시드 소비 없음, 결정적(가장 큰 단축 → 같으면 위쪽·가운데 가까운 열)."""
    G = [list(r) for r in L["rows"]]; tier = L["tier"]
    hi = tier["hard"]["seatToGateTiles"][1]
    if ceo_day: hi = min(hi, 40)
    S = L["spots"]; occ = occupied_seats(L)
    seat = tuple(S["player_seat"]["tile"]); gate = tuple(S["gate_use"]["tile"])
    targets = [gate] + [tuple(S[SPOT_OF[m]]["tile"]) for m in missions if m in SPOT_OF and SPOT_OF[m] in S]
    caps = [hi] + [((MREF[m] + 4 if tier["tier"] == 0 else 28) if m != "parcel" else 99) for m in missions if m in SPOT_OF and SPOT_OF[m] in S]
    sv = tuple(S["elevator_service_spawn"]["tile"]); cg = tuple(S["ceo_greet_spot"]["tile"])
    n = 0
    def over(G):
        GG = ["".join(r) for r in G]
        d = bfs(GG, seat, occ)
        dc = bfs(GG, sv, occ).get(cg, 99)
        return sum(max(0, d.get(t, 99) - cp) for t, cp in zip(targets, caps)) + (max(0, dc - 20) if ceo_day else 0), d
    cur, _ = over(G)
    while cur > 0 and n < 3:
        best = None
        for si, (sy, op) in enumerate(L["seams"]):
            for x in range(1, W - 1):
                if G[sy][x] != "#" or x in op: continue
                if not (LEG[G[sy-1][x]]["walkable"] and LEG[G[sy+1][x]]["walkable"]): continue
                if any(abs(x - o) < 2 for o in op): continue
                G[sy][x] = "."; v, _ = over(G); G[sy][x] = "#"
                key = (v, abs(x - 5), sy)
                if v < cur and (best is None or key < best[0]): best = (key, si, sy, x)
        if not best: break
        _, si, sy, x = best
        G[sy][x] = "."; L["seams"][si] = (sy, tuple(sorted(L["seams"][si][1] + (x,)))); n += 1
        cur, _ = over(G)
    L["rows"] = ["".join(r) for r in G]
    return n

def validate(L, missions, ceo_day, day):
    G = L["rows"]; S = L["spots"]; tier = L["tier"]
    SPOT_OF["print"] = "printer_use" if "printer_use" in S else "copier_use"
    occ = occupied_seats(L)
    seat = tuple(S["player_seat"]["tile"]); gate = tuple(S["gate_use"]["tile"])
    dist = bfs(G, seat, occ)
    met = {}
    # V01
    for ms in missions:
        k = SPOT_OF.get(ms)
        if k and (k not in S or tuple(S[k]["tile"]) not in dist): return False, "V01:" + ms, met
    if gate not in dist: return False, "V01:gate", met
    # V03
    sg = dist[gate]; met["seatToGate"] = sg
    lo, hi = tier["hard"]["seatToGateTiles"]
    if ceo_day: hi = min(hi, 40)
    if not lo <= sg <= hi: return False, f"V03:seatToGate {sg}", met
    slack = {0: 3, 1: 4, 2: 6}.get(tier["tier"], 8)
    for ms in missions:
        k = SPOT_OF.get(ms)
        if not k: continue
        d = dist[tuple(S[k]["tile"])]; met["ow_" + ms] = d
        hi_ = (MREF[ms] + 4 if tier["tier"] == 0 else 28) if ms != "parcel" else 99
        if not 6 <= d <= hi_: return False, f"V03:{ms} {d}", met
    sv = tuple(S["elevator_service_spawn"]["tile"]); cg = tuple(S["ceo_greet_spot"]["tile"])
    dc = bfs(G, sv, occ).get(cg, 999); met["ceoWalk"] = dc
    if ceo_day and dc > 20: return False, f"V03:ceo {dc}", met
    COV = cover_tiles(G)
    # V12 time budget
    DP = {"intern": 40, "staff": 50, "assistant_manager": 54, "manager": 56, "deputy_general_manager": 56, "general_manager": 57, "executive": 57}
    LI = {"intern": 1, "staff": 2, "assistant_manager": 2, "manager": 3, "deputy_general_manager": 3, "general_manager": 3, "executive": 3}
    rid = L["rid"]
    if ceo_day: pred = 2 + 44 + 12.5 + 16.3 + 2 * 1.7 + 1.0 + (sg - 33) / 3
    else: pred = 2 + DP[rid] + 16.3 + LI[rid] * 1.7 + 1.0 + (sg - 33) / 3
    met["pred"] = round(pred, 1)
    over_ = pred - (80.5 if ceo_day else 84.0)
    met["trim"] = round(max(0, over_), 1)
    if over_ > 3.0: return False, f"V12:{pred:.1f}", met
    # V04
    tl = tuple(S["tl_seat"]["tile"]); ld = S["tl_seat"]["lookDirs"][0]
    threat = defaultdict(int)
    for y in range(len(G)):
        for x in range(W):
            if LEG[G[y][x]]["walkable"] and in_cone(G, tl, ld, (x, y)): threat[(x, y)] += 2
    for y in range(len(G)):
        for x in range(1, W - 1):
            if LEG[G[y][x]]["walkable"] and not LEG[G[y][x-1]]["walkable"] and not LEG[G[y][x+1]]["walkable"] and G[y][x] != "G":
                threat[(x, y)] += 1
    for goal_name, goal in [("gate", gate)] + [(ms, tuple(S[SPOT_OF[ms]]["tile"])) for ms in missions if ms in SPOT_OF]:
        P = astar(G, seat, goal, occ)
        pen = {p: 6 for p in P[3:-3]}
        A = astar(G, seat, goal, occ, pen)
        core = set(P[3:-3])
        shared = len(core & set(A)) / max(1, len(core))
        lp, la = len(P) - 1, len(A) - 1
        if goal_name == "gate": ok = la <= lp * 1.6 and la - lp <= 16 and shared <= 0.75
        else: ok = la <= lp * 2.0 and la - lp <= 16 and shared <= 0.75
        if goal_name == "gate":
            met["altExtra"] = la - lp; met["shared"] = round(shared, 2)
            met["w1"] = width1_runs(G, P)
            def cats(path):
                cs = set()
                for q in path:
                    if in_cone(G, tl, ld, q): cs.add("tl_cone")
                    if math.hypot(q[0] - tl[0], q[1] - tl[1]) <= 2.5: cs.add("tl_talk")
                    x, y = q
                    if 0 < x < W - 1 and not LEG[G[y][x-1]]["walkable"] and not LEG[G[y][x+1]]["walkable"] and G[y][x] not in "G": cs.add("choke")
                return cs
            cS, cA = cats(P[1:]), cats(A[1:])
            met["riskS"], met["riskA"] = len(cS), len(cA)
            covS = sum(1 for q in P if q in COV); covA = sum(1 for q in A if q in COV)
            met["riskOk"] = bool(cS) and (bool(cS - cA) or covA > covS)
            # 분기점: 최단 경로가 지나는 이음 행 중 개구부 2개 이상
            ys = {p[1] for p in P}
            met["branch"] = sum(1 for (sy, op) in L["seams"] if sy in ys and len(op) >= 2 and not (len(op) <= 3 and max(op) - min(op) == len(op) - 1))
        if not ok: return False, f"V04:{goal_name} +{la-lp} sh{shared:.2f}", met
    if not met["riskOk"]: return False, "V04:risk", met
    # V05
    cov = cover_tiles(G); us = uncovered_straight(G, cov); met["uncov"] = us
    met["cover10"] = round(len(cov) / len(G) * 10, 1)
    if us > tier["hard"]["maxUncoveredStraightTiles"]: return False, f"V05:{us}", met

    # V06
    if met["w1"] > 6: return False, "V06", met
    # V08
    de = dead_ends(G, occ, S); met["dead"] = len(de)
    if any(l >= 5 for l in de): return False, "V08:long", met

    # pillars
    pil = sum(r.count("O") for r in G); met["pillars"] = pil

    # V09
    if not in_cone(G, tl, ld, seat): return False, "V09:cone", met
    # V10 gate cover 2~5
    if not any(2 <= abs(x - gate[0]) + abs(y - gate[1]) <= 5 for (x, y) in cov): return False, "V10", met
    # V12
    H = len(G); met["height"] = H

    return True, None, met

if __name__ == "__main__":
    days = int(sys.argv[3]) if len(sys.argv) > 3 else 120
    import random
    POOL = ["coffee", "restroom", "nap", "parcel", "print", "chat", "cafe", "window"]
    stats = defaultdict(lambda: defaultdict(list)); fails = defaultdict(Counter); attempts = defaultdict(list)
    prev_sig = None; samples = {}
    for day in range(3, days + 1):
        rid, t = rank_of(day)
        rr = random.Random(day)
        unlocked = ["coffee", "restroom", "nap"] + (["parcel", "chat"] if day >= 6 else []) + (["print", "cafe", "window"] if day >= 16 else [])
        missions = rr.sample(unlocked, 2)
        ceo_day = day >= 28 and (day - 1) % 5 == 2
        ok = False
        for k in range(LAY["validators"]["maxAttempts"]):
            L, err = gen(day, k, missions, ceo_day, None)
            if L is None: fails[rid][err] += 1; continue
            good, why, met = validate(L, missions, ceo_day, day)
            sig = (L["seq"], tuple(o for _, o in L["seams"]))
            if good and prev_sig is not None and sig[0] == prev_sig[0]:
                good, why = False, "V13"
            if not good: fails[rid][why.split(":")[0] + ":" + (why.split(":")[1].split(" ")[0] if ":" in why else "")] += 1; continue
            ok = True; attempts[rid].append(k + 1); prev_sig = sig
            for kk, v in met.items(): stats[rid][kk].append(v)
            if rid not in samples: samples[rid] = (day, L)
            break
        if not ok: attempts[rid].append(99); print("FALLBACK day", day, missions)
    for rid, _, _ in RANKS:
        if rid not in stats: continue
        s = stats[rid]
        print(f"\n== {rid}: 시도 평균 {sum(attempts[rid])/len(attempts[rid]):.1f}, 최대 {max(attempts[rid])}, 실패사유 {dict(fails[rid].most_common(6))}")
        for kk in ("height", "seatToGate", "altExtra", "shared", "branch", "dead", "pillars", "cover10", "uncov", "w1", "ceoWalk", "pred", "trim"):
            v = s.get(kk)
            if v: print(f"  {kk:10s} min {min(v)} avg {sum(v)/len(v):.1f} max {max(v)}")
    if "--show" in sys.argv:
        for rid, (day, L) in samples.items():
            print(f"\n## sample {rid} day {day} {L['seq']}")
            for i, r in enumerate(L["rows"]): print(f"{i:02d} {r}")

def debug(days):  # 기획 디버그용
    POOL=None
    import random
    for day in days:
        rr = random.Random(day)
        missions = ["coffee","restroom"]
        c=Counter()
        for k in range(24):
            L, err = gen(day, k, missions, False, None)
            if L is None: c[err]+=1; continue
            good, why, met = validate(L, missions, False, day)
            c[why]+=1
        print(day, c.most_common(8))
