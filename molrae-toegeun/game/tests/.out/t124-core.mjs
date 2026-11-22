// src/core/rng.ts
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ h1 >>> 18, 597399067);
  h2 = Math.imul(h4 ^ h2 >>> 22, 2869860233);
  h3 = Math.imul(h1 ^ h3 >>> 17, 951274213);
  h4 = Math.imul(h2 ^ h4 >>> 19, 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function createRng(seed) {
  let [a, b, c, d] = typeof seed === "object" ? seed : cyrb128(String(seed));
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = a + b | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = c << 21 | c >>> 11;
    d = d + 1 | 0;
    const r = t + d | 0;
    c = c + r | 0;
    return (r >>> 0) / 4294967296;
  };
  if (typeof seed !== "object") for (let i = 0; i < 15; i++) next();
  const rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    range: (min, max) => next() * (max - min) + min,
    chance: (p) => next() < p,
    pick: (items) => items.length === 0 ? void 0 : items[Math.floor(next() * items.length)],
    weighted: (items, weightOf) => {
      let total = 0;
      for (const it of items) total += Math.max(0, weightOf(it));
      if (total <= 0) return void 0;
      let roll = next() * total;
      for (const it of items) {
        roll -= Math.max(0, weightOf(it));
        if (roll < 0) return it;
      }
      return items[items.length - 1];
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    getState: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0]
  };
  return rng;
}

// src/core/grid.ts
function buildGridMap(rows, legend) {
  const height = rows.length;
  if (height === 0) throw new Error("grid: \uBE48 \uB9F5");
  const width = rows[0].length;
  const n = width * height;
  const kinds = new Array(n);
  const zones = new Array(n);
  const walkable = new Uint8Array(n);
  const sight = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width) throw new Error(`grid: ${y}\uD589 \uAE38\uC774 ${row.length} \u2260 ${width}`);
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const e = legend[ch];
      if (!e) throw new Error(`grid: legend\uC5D0 \uC5C6\uB294 \uBB38\uC790 '${ch}' (${x},${y})`);
      const i = y * width + x;
      kinds[i] = e.kind;
      zones[i] = e.zone ?? null;
      walkable[i] = e.walkable ? 1 : 0;
      sight[i] = e.blocksSight ? 1 : 0;
    }
  }
  return { width, height, kinds, walkable, sight, zones };
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}
function isWalkable(map, x, y) {
  return inBounds(map, x, y) && map.walkable[y * map.width + x] === 1;
}
function blocksSight(map, x, y) {
  return !inBounds(map, x, y) || map.sight[y * map.width + x] === 1;
}
function zoneAt(map, x, y) {
  return inBounds(map, x, y) ? map.zones[y * map.width + x] ?? null : null;
}
function tileOf(p) {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}
function tileCenter(t) {
  return { x: t.x + 0.5, y: t.y + 0.5 };
}
function nearestWalkable(map, x, y, maxRadius) {
  if (isWalkable(map, x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    let best = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const rem = r - Math.abs(dy);
      const cands = rem === 0 ? [0] : [-rem, rem];
      for (const dx of cands) {
        const tx = x + dx, ty = y + dy;
        if (!isWalkable(map, tx, ty)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x: tx, y: ty };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// src/core/pathfinding.ts
var DX = [0, 1, 0, -1];
var DY = [-1, 0, 1, 0];
var MinHeap = class {
  f = [];
  h = [];
  seq = [];
  idx = [];
  get size() {
    return this.idx.length;
  }
  less(a, b) {
    const fa = this.f[a], fb = this.f[b];
    if (fa !== fb) return fa < fb;
    const ha = this.h[a], hb = this.h[b];
    if (ha !== hb) return ha < hb;
    return this.seq[a] < this.seq[b];
  }
  swap(a, b) {
    for (const arr of [this.f, this.h, this.seq, this.idx]) {
      const t = arr[a];
      arr[a] = arr[b];
      arr[b] = t;
    }
  }
  push(f, h, seq, idx) {
    this.f.push(f);
    this.h.push(h);
    this.seq.push(seq);
    this.idx.push(idx);
    let i = this.idx.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop() {
    const top = this.idx[0];
    const last = this.idx.length - 1;
    this.swap(0, last);
    this.f.pop();
    this.h.pop();
    this.seq.pop();
    this.idx.pop();
    let i = 0;
    const n = this.idx.length;
    for (; ; ) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
};
function findPath(map, start, goal) {
  if (!isWalkable(map, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];
  const w = map.width;
  const n = w * map.height;
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const startIdx = start.y * w + start.x;
  const goalIdx = goal.y * w + goal.x;
  const hOf = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  let seq = 0;
  g[startIdx] = 0;
  heap.push(hOf(start.x, start.y), hOf(start.x, start.y), seq++, startIdx);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) break;
    const cx = cur % w, cy = (cur - cx) / w;
    const gc = g[cur];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (!isWalkable(map, nx, ny)) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = gc + 1;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur;
        const h = hOf(nx, ny);
        heap.push(ng + h, h, seq++, ni);
      }
    }
  }
  if (from[goalIdx] === -1) return null;
  const out = [];
  for (let i = goalIdx; i !== startIdx; i = from[i]) {
    const x = i % w;
    out.push({ x, y: (i - x) / w });
  }
  out.reverse();
  return out;
}

// src/core/vision.ts
var DIR_ANGLE = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2
};
function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
}
function normAngle(a) {
  let d = a % (Math.PI * 2);
  if (d <= -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
}
function rayDistance(map, ox, oy, dx, dy, maxDist) {
  let tx = Math.floor(ox), ty = Math.floor(oy);
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = sx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = sy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX = sx > 0 ? (tx + 1 - ox) * tDeltaX : sx < 0 ? (ox - tx) * tDeltaX : Infinity;
  let tMaxY = sy > 0 ? (ty + 1 - oy) * tDeltaY : sy < 0 ? (oy - ty) * tDeltaY : Infinity;
  const EPS = 1e-9;
  for (let guard = 0; guard < 4096; guard++) {
    if (Math.abs(tMaxX - tMaxY) < EPS) {
      const t = tMaxX;
      if (t > maxDist) return maxDist;
      if (blocksSight(map, tx + sx, ty) && blocksSight(map, tx, ty + sy)) return t;
      tx += sx;
      ty += sy;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      if (blocksSight(map, tx, ty)) return t;
    } else if (tMaxX < tMaxY) {
      const t = tMaxX;
      if (t > maxDist) return maxDist;
      tx += sx;
      tMaxX += tDeltaX;
      if (blocksSight(map, tx, ty)) return t;
    } else {
      const t = tMaxY;
      if (t > maxDist) return maxDist;
      ty += sy;
      tMaxY += tDeltaY;
      if (blocksSight(map, tx, ty)) return t;
    }
  }
  return maxDist;
}
function hasLineOfSight(map, from, to) {
  const ddx = to.x - from.x, ddy = to.y - from.y;
  const dist = Math.hypot(ddx, ddy);
  if (dist < 1e-9) return true;
  return rayDistance(map, from.x, from.y, ddx / dist, ddy / dist, dist) >= dist - 1e-9;
}
function inCone(origin, facing, cone, target) {
  const ddx = target.x - origin.x, ddy = target.y - origin.y;
  const dist = Math.hypot(ddx, ddy);
  if (dist > cone.range) return false;
  if (dist < 1e-9) return true;
  return angleDiff(Math.atan2(ddy, ddx), facing) <= cone.halfAngleDeg * Math.PI / 180 + 1e-9;
}
function canSee(map, origin, facing, cone, target) {
  return inCone(origin, facing, cone, target) && hasLineOfSight(map, origin, target);
}
function conePolygon(map, origin, facing, cone, rays) {
  const half = cone.halfAngleDeg * Math.PI / 180;
  const n = Math.max(2, rays);
  const pts = [{ x: origin.x, y: origin.y }];
  for (let i = 0; i < n; i++) {
    const a = facing - half + 2 * half * i / (n - 1);
    const dx = Math.cos(a), dy = Math.sin(a);
    const d = rayDistance(map, origin.x, origin.y, dx, dy, cone.range);
    pts.push({ x: origin.x + dx * d, y: origin.y + dy * d });
  }
  return pts;
}

// src/core/player.ts
var PlayerMover = class {
  x;
  y;
  mode = "idle";
  /** 현재 모드에 머문 시간(초) */
  modeTime = 0;
  /** 마지막 이동 방향(라디안). 렌더링용 */
  facing = -Math.PI / 2;
  path = [];
  pathIndex = 0;
  talkLeft = 0;
  constructor(start) {
    const c = tileCenter(start);
    this.x = c.x;
    this.y = c.y;
  }
  get pos() {
    return { x: this.x, y: this.y };
  }
  get tile() {
    return tileOf(this);
  }
  /** 남은 경로 노드(타일 중심). 렌더링용 */
  remainingPath() {
    return this.path.slice(this.pathIndex);
  }
  setMode(m) {
    if (this.mode !== m) {
      this.mode = m;
      this.modeTime = 0;
    }
  }
  /** 경로(시작 타일 제외, 목적지 포함)를 따라 이동 시작. 성공 여부 반환 */
  move(path) {
    if (this.mode === "talked") return false;
    const nodes = path.map(tileCenter);
    const here = tileCenter(this.tile);
    if (Math.abs(here.x - this.x) > 1e-6 || Math.abs(here.y - this.y) > 1e-6) nodes.unshift(here);
    if (nodes.length === 0) return false;
    this.path = nodes;
    this.pathIndex = 0;
    this.setMode("moving");
    return true;
  }
  /** 이동 중 정지 → 위장. 이동 중이 아니면 false */
  stop() {
    if (this.mode !== "moving") return false;
    this.path = [];
    this.pathIndex = 0;
    this.setMode("disguised");
    return true;
  }
  /** 말걸기 등 강제 정지 */
  forceTalk(durationSec) {
    if (this.mode === "talked") return false;
    this.path = [];
    this.pathIndex = 0;
    this.talkLeft = durationSec;
    this.setMode("talked");
    return true;
  }
  step(dt, speedTilesPerSec) {
    this.modeTime += dt;
    if (this.mode === "talked") {
      this.talkLeft -= dt;
      if (this.talkLeft <= 0) this.setMode("idle");
      return;
    }
    if (this.mode !== "moving") return;
    let budget = speedTilesPerSec * dt;
    while (budget > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      const dx = target.x - this.x, dy = target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) this.facing = Math.atan2(dy, dx);
      if (d <= budget) {
        this.x = target.x;
        this.y = target.y;
        budget -= d;
        this.pathIndex++;
      } else {
        this.x += dx / d * budget;
        this.y += dy / d * budget;
        budget = 0;
      }
    }
    if (this.pathIndex >= this.path.length) {
      this.path = [];
      this.pathIndex = 0;
      this.setMode("idle");
    }
  }
};

// src/core/suspicion.ts
function createSuspicion() {
  return { value: 0, peak: 0, exposedSec: 0 };
}
function exposureRate(rules, mode, modeTime) {
  switch (mode) {
    case "moving":
      return rules.movingPerSec;
    case "disguised":
      return modeTime < rules.disguiseSettleSec ? rules.movingPerSec : rules.disguisedPerSec;
    case "idle":
      return rules.idlePerSec;
    case "talked":
      return rules.talkedPerSec;
  }
}
function updateSuspicion(s, rules, gazeMultiplier, mode, modeTime, dt) {
  if (gazeMultiplier > 0) {
    const prev = s.exposedSec;
    s.exposedSec += dt;
    const effective = Math.max(0, s.exposedSec - Math.max(prev, rules.graceSec));
    s.value += exposureRate(rules, mode, modeTime) * gazeMultiplier * effective;
  } else {
    s.exposedSec = 0;
    if (mode !== "moving") s.value -= rules.decayPerSec * dt;
  }
  s.value = Math.min(rules.max, Math.max(0, s.value));
  if (s.value > s.peak) s.peak = s.value;
}

// src/core/patrol.ts
var ALL_DIRS = ["up", "right", "down", "left"];
var PatrolNpc = class {
  def;
  x;
  y;
  facing = 0;
  mode = "wait";
  modeTime = 0;
  /** tell 중일 때 돌아볼 방향 */
  pendingFacing = null;
  talkCooldown = 0;
  segments;
  wpIndex = 0;
  nodeIndex = 0;
  timer = 0;
  waitLeft = 0;
  resume = "wait";
  talkResume = "wait";
  talkPrevFacing = 0;
  constructor(def, map, rng) {
    if (def.waypoints.length === 0) throw new Error(`npc ${def.id}: \uC6E8\uC774\uD3EC\uC778\uD2B8 \uC5C6\uC74C`);
    this.def = def;
    const wps = def.waypoints;
    this.segments = wps.map((wp, i) => {
      const next = wps[(i + 1) % wps.length];
      const p = findPath(map, { x: wp.x, y: wp.y }, { x: next.x, y: next.y });
      if (!p) throw new Error(`npc ${def.id}: \uC6E8\uC774\uD3EC\uC778\uD2B8 ${i}\u2192${(i + 1) % wps.length} \uACBD\uB85C \uC5C6\uC74C`);
      return p.map(tileCenter);
    });
    const c = tileCenter(wps[0]);
    this.x = c.x;
    this.y = c.y;
    const first = this.segments[0][0];
    this.facing = first ? Math.atan2(first.y - c.y, first.x - c.x) : 0;
    this.arrive(0, rng);
  }
  get pos() {
    return { x: this.x, y: this.y };
  }
  get waypointIndex() {
    return this.wpIndex;
  }
  setMode(m) {
    this.mode = m;
    this.modeTime = 0;
  }
  startTell(facing, resume) {
    this.pendingFacing = normAngle(facing);
    this.resume = resume;
    this.timer = this.def.tellSec;
    this.setMode("tell");
  }
  arrive(i, rng) {
    this.wpIndex = i;
    this.nodeIndex = 0;
    const wp = this.def.waypoints[i];
    this.waitLeft = wp.waitSec;
    const chance = wp.lookChance ?? this.def.lookChance;
    if (wp.waitSec > 0 && rng.chance(chance)) {
      const cands = wp.lookDirs && wp.lookDirs.length > 0 ? wp.lookDirs : ALL_DIRS.filter((d) => angleDiff(DIR_ANGLE[d], this.facing) > 0.1);
      const dir = rng.pick(cands) ?? "down";
      this.startTell(DIR_ANGLE[dir], "wait");
    } else if (wp.waitSec > 0) {
      this.setMode("wait");
    } else {
      this.setMode("walk");
    }
  }
  /** 말걸기 가능 여부 */
  canTalk() {
    return !!this.def.talk && this.talkCooldown <= 0 && (this.mode === "walk" || this.mode === "wait");
  }
  startTalk(towardAngle) {
    const t = this.def.talk;
    if (!t) return;
    this.talkResume = this.mode === "walk" ? "walk" : "wait";
    this.talkPrevFacing = this.facing;
    this.facing = normAngle(towardAngle);
    this.timer = t.durationSec;
    this.talkCooldown = t.cooldownSec + t.durationSec;
    this.setMode("talk");
  }
  step(dt, rng) {
    this.modeTime += dt;
    if (this.talkCooldown > 0) this.talkCooldown -= dt;
    switch (this.mode) {
      case "tell":
        this.timer -= dt;
        if (this.timer <= 0) {
          this.facing = this.pendingFacing ?? this.facing;
          this.pendingFacing = null;
          this.timer = this.def.lookSec;
          this.setMode("look");
        }
        return;
      case "look":
        this.timer -= dt;
        if (this.timer <= 0) this.setMode(this.resume === "wait" && this.waitLeft > 0 ? "wait" : "walk");
        return;
      case "talk":
        this.timer -= dt;
        if (this.timer <= 0) {
          this.facing = this.talkPrevFacing;
          this.setMode(this.talkResume);
        }
        return;
      case "wait":
        this.waitLeft -= dt;
        if (this.waitLeft <= 0) this.setMode("walk");
        return;
      case "walk":
        this.walk(dt, rng);
        return;
    }
  }
  walk(dt, rng) {
    let budget = this.def.speedTilesPerSec * dt;
    while (budget > 0) {
      const seg = this.segments[this.wpIndex];
      const target = seg[this.nodeIndex];
      if (!target) {
        this.arrive((this.wpIndex + 1) % this.segments.length, rng);
        return;
      }
      const dx = target.x - this.x, dy = target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) this.facing = Math.atan2(dy, dx);
      if (d > budget) {
        this.x += dx / d * budget;
        this.y += dy / d * budget;
        return;
      }
      this.x = target.x;
      this.y = target.y;
      budget -= d;
      this.nodeIndex++;
      if (this.nodeIndex >= seg.length) {
        this.arrive((this.wpIndex + 1) % this.segments.length, rng);
        if (this.mode !== "walk") return;
      } else if (rng.chance(this.def.glanceBackChancePerTile)) {
        this.startTell(this.facing + Math.PI, "walk");
        return;
      }
    }
  }
};

// src/core/floorSim.ts
var FloorSim = class {
  map;
  level;
  rules;
  player;
  npcs;
  suspicion = createSuspicion();
  outcome = "playing";
  /** 경과 시간(초, 고정 스텝 누적) */
  time = 0;
  steps = 0;
  /** npc 인덱스별 이번 스텝 시선 여부 */
  seeing;
  /** 마지막 이동 목적지 (경로 표시용) */
  destination = null;
  rng;
  acc = 0;
  events = [];
  constructor(content2, seed) {
    this.level = content2.level;
    this.rules = content2.rules;
    this.map = buildGridMap(content2.level.rows, content2.level.legend);
    const s = content2.level.playerStart;
    if (!isWalkable(this.map, s.x, s.y)) throw new Error("sim: \uC2DC\uC791 \uD0C0\uC77C \uD1B5\uD589 \uBD88\uAC00");
    this.rng = createRng(seed);
    this.player = new PlayerMover(s);
    this.npcs = content2.level.npcs.map((d) => new PatrolNpc(d, this.map, this.rng));
    this.seeing = this.npcs.map(() => false);
  }
  /** 쌓인 이벤트를 꺼낸다 (QA 로그·사운드 트리거용) */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
  /**
   * 화면 탭(타일 좌표). D-033: 이동 중이면 정지·위장, 아니면 그 타일로 경로 이동.
   */
  tap(tx, ty) {
    let result;
    if (this.outcome !== "playing" || this.player.mode === "talked") result = "ignored";
    else if (this.player.mode === "moving") {
      this.player.stop();
      this.destination = null;
      result = "stopped";
    } else {
      const goal = nearestWalkable(this.map, tx, ty, this.rules.tapSnapRadius);
      const path = goal ? findPath(this.map, this.player.tile, goal) : null;
      if (goal && path && this.player.move(path)) {
        this.destination = goal;
        result = "moving";
      } else result = "unreachable";
    }
    this.events.push({ t: this.time, type: "tap", x: tx, y: ty, result });
    return result;
  }
  /** 실시간 경과를 고정 스텝으로 나눠 진행 */
  advance(dtSec) {
    this.acc += Math.min(Math.max(0, dtSec), this.rules.maxAdvanceSec);
    const h = this.rules.fixedStepSec;
    while (this.acc >= h) {
      this.acc -= h;
      this.step();
    }
  }
  step() {
    if (this.outcome !== "playing") return;
    const dt = this.rules.fixedStepSec;
    this.steps++;
    this.time = this.steps * dt;
    const p = this.player;
    p.step(dt, this.rules.playerSpeedTilesPerSec);
    if (p.mode !== "moving") this.destination = null;
    for (const npc2 of this.npcs) {
      const before = npc2.mode;
      npc2.step(dt, this.rng);
      if (npc2.mode === "tell" && before !== "tell") this.events.push({ t: this.time, type: "tell", npc: npc2.def.id });
    }
    for (const npc2 of this.npcs) {
      const talk = npc2.def.talk;
      if (!talk || !npc2.canTalk() || p.mode === "talked") continue;
      const dx = p.x - npc2.x, dy = p.y - npc2.y;
      if (Math.hypot(dx, dy) <= talk.radius) {
        p.forceTalk(talk.durationSec);
        npc2.startTalk(Math.atan2(dy, dx));
        this.destination = null;
        this.events.push({ t: this.time, type: "talk", npc: npc2.def.id });
      }
    }
    let mult = 0;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc2 = this.npcs[i];
      const sees = canSee(this.map, npc2.pos, npc2.facing, npc2.def.cone, p.pos);
      if (sees && !this.seeing[i]) this.events.push({ t: this.time, type: "spotted", npc: npc2.def.id });
      this.seeing[i] = sees;
      if (sees) mult = Math.max(mult, npc2.def.gazeMultiplier);
    }
    updateSuspicion(this.suspicion, this.rules.suspicion, mult, p.mode, p.modeTime, dt);
    if (this.suspicion.value >= this.rules.suspicion.max) {
      this.outcome = "caught";
      this.events.push({ t: this.time, type: "caught" });
    } else {
      const t = p.tile;
      if (zoneAt(this.map, t.x, t.y) === this.level.exitZone) {
        this.outcome = "escaped";
        this.events.push({ t: this.time, type: "escaped" });
      }
    }
  }
  /** NPC가 플레이어에게 주는 위협 수준 (화면 밖 경고 표시용) */
  threatOf(index) {
    const npc2 = this.npcs[index];
    if (!npc2) return "none";
    if (this.seeing[index]) return "seeing";
    const pp = this.player.pos;
    const t = this.rules.threat;
    const wide = {
      range: npc2.def.cone.range + t.approachExtraRange,
      halfAngleDeg: npc2.def.cone.halfAngleDeg + t.approachExtraAngleDeg
    };
    if (npc2.mode === "tell" && npc2.pendingFacing !== null && inCone(npc2.pos, npc2.pendingFacing, wide, pp)) return "turning";
    if (npc2.mode !== "talk" && inCone(npc2.pos, npc2.facing, wide, pp)) return "approaching";
    return "none";
  }
  /** 결정성 검증용 상태 요약 문자열 */
  fingerprint() {
    const r = (v) => v.toFixed(4);
    const parts = [
      this.steps,
      this.outcome,
      r(this.suspicion.value),
      r(this.player.x),
      r(this.player.y),
      this.player.mode,
      ...this.npcs.map((n) => `${n.def.id}:${r(n.x)},${r(n.y)},${r(n.facing)},${n.mode}`)
    ];
    return parts.join("|");
  }
};

// src/dev/protoFloor.ts
var ROWS = [
  "###########",
  // 0
  "#EEEEEEEEE#",
  "#EEEEEEEEE#",
  "####...####",
  "#.........#",
  "#.F.....F.#",
  // 5
  "#.........#",
  "#..X...X..#",
  "#.........#",
  "#.........#",
  "##..###..##",
  // 10
  "#.........#",
  "#.DD.P.DD.#",
  "#.DD.P.DD.#",
  "#.........#",
  "#F.......F#",
  // 15
  "#.........#",
  "#.DD.P.DD.#",
  "#.DD.P.DD.#",
  "#.........#",
  "###.###.###",
  // 20
  "#KKKK#....#",
  "#KKKK#.DD.#",
  "#KKXK#.DD.#",
  "#KKKK.....#",
  "#KKKK#.DD.#",
  // 25
  "#KFKK#.DD.#",
  "#KKKK#....#",
  "###.###.###",
  "#.........#",
  "#.PPP.PPP.#",
  // 30
  "#.DD...DD.#",
  "#.DD.F.DD.#",
  "#.........#",
  "#.DD.F.DD.#",
  "#.DD...DD.#",
  // 35
  "#.PPP.PPP.#",
  "#.........#",
  "#.........#",
  "#.DD.P.DD.#",
  "#.DD.P.DD.#",
  // 40
  "#.........#",
  "#X.......F#",
  "#.........#",
  "#.DD.P.DD.#",
  "#.DD.P.DD.#",
  // 45
  "#.........#",
  "###.###.###",
  "#.........#",
  "#.DD...DD.#",
  "#.DDP.PDD.#",
  // 50
  "#.........#",
  "#.F.....F.#",
  "#.........#",
  "#.DD...DD.#",
  "#.DDP.PDD.#",
  // 55
  "#.........#",
  "#.SS......#",
  "#.DD......#",
  "#.........#",
  "#F.......F#",
  // 60
  "###########"
];
var LEVEL = {
  id: "proto-floor-1",
  rows: ROWS,
  legend: {
    "#": { kind: "wall", walkable: false, blocksSight: true },
    ".": { kind: "floor", walkable: true, blocksSight: false },
    D: { kind: "desk", walkable: false, blocksSight: false },
    P: { kind: "partition", walkable: false, blocksSight: true },
    F: { kind: "plant", walkable: false, blocksSight: true },
    X: { kind: "copier", walkable: false, blocksSight: true },
    S: { kind: "floor", walkable: true, blocksSight: false, zone: "seat" },
    K: { kind: "floor", walkable: true, blocksSight: false, zone: "pantry" },
    E: { kind: "floor", walkable: true, blocksSight: false, zone: "exit" }
  },
  playerStart: { x: 2, y: 57 },
  exitZone: "exit",
  npcs: [
    {
      id: "teamlead",
      name: "\uD300\uC7A5",
      role: "boss",
      cone: { range: 5, halfAngleDeg: 30 },
      speedTilesPerSec: 1.6,
      gazeMultiplier: 1,
      tellSec: 0.6,
      lookSec: 1.4,
      lookChance: 0.6,
      glanceBackChancePerTile: 0.06,
      waypoints: [
        { x: 1, y: 29, waitSec: 1.5 },
        { x: 9, y: 29, waitSec: 1 },
        { x: 9, y: 46, waitSec: 2, lookDirs: ["left", "up"] },
        { x: 4, y: 41, waitSec: 1.5 },
        { x: 1, y: 46, waitSec: 1 }
      ]
    },
    {
      id: "guard",
      name: "\uACBD\uBE44",
      role: "guard",
      cone: { range: 4, halfAngleDeg: 35 },
      speedTilesPerSec: 1.2,
      gazeMultiplier: 0.8,
      tellSec: 0.5,
      lookSec: 1.2,
      lookChance: 0.5,
      glanceBackChancePerTile: 0.04,
      waypoints: [
        { x: 2, y: 4, waitSec: 1.2 },
        { x: 8, y: 4, waitSec: 1.2 },
        { x: 8, y: 9, waitSec: 1, lookDirs: ["up", "left"] },
        { x: 2, y: 9, waitSec: 1, lookDirs: ["up", "right"] }
      ],
      talk: { radius: 1.1, durationSec: 1.5, cooldownSec: 6 }
    }
  ]
};
var RULES = {
  fixedStepSec: 1 / 60,
  maxAdvanceSec: 0.1,
  playerSpeedTilesPerSec: 3.5,
  tapSnapRadius: 2,
  suspicion: {
    max: 1,
    movingPerSec: 0.6,
    idlePerSec: 0.25,
    disguisedPerSec: 0.08,
    talkedPerSec: 0.08,
    disguiseSettleSec: 0.2,
    graceSec: 0.12,
    // rules.json input.inputGraceSec과 같은 값
    decayPerSec: 0.02
    // rules.json suspicion.decayPerSec과 같은 값
  },
  threat: { approachExtraRange: 9, approachExtraAngleDeg: 25 }
};
var PROTO_FLOOR = { level: LEVEL, rules: RULES };

// tests/lib/check.ts
var results = [];
var group = "";
function section(name) {
  group = name;
  console.log(`
\u2500\u2500 ${name}`);
}
function check(name, ok, detail = "") {
  results.push({ name, ok, detail, group });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  \u2014 ${detail}` : ""}`);
  return ok;
}
function info(msg) {
  console.log(`  \xB7 ${msg}`);
}
function summary() {
  const fail = results.filter((r) => !r.ok);
  console.log(`
\uD569\uACC4: ${results.length - fail.length}/${results.length} \uD1B5\uACFC`);
  for (const f of fail) console.log(`  FAIL [${f.group}] ${f.name}${f.detail ? ` \u2014 ${f.detail}` : ""}`);
  return fail.length;
}

// tests/lib/observe.ts
var UNFAIR_CAUSES = ["turnCorner", "turnResume", "turnTalkEnd", "talkStart"];
var Observer = class {
  constructor(sim) {
    this.sim = sim;
    this.snaps = sim.npcs.map((n) => ({ x: n.x, y: n.y, facing: n.facing, mode: n.mode, walkFrom: "init", walkSteps: 0, tellStart: n.mode === "tell" ? 0 : -1 }));
    this.episodeCause = sim.npcs.map(() => null);
    this.px = sim.player.x;
    this.py = sim.player.y;
  }
  sim;
  onsets = [];
  turns = [];
  looks = [];
  /** npc 인덱스별 현재 노출 에피소드의 시작 원인 */
  episodeCause;
  snaps;
  px;
  py;
  /** sim.step() 한 번 + 관찰 */
  step() {
    const sim = this.sim;
    if (sim.outcome !== "playing") return;
    const wasSeeing = sim.seeing.slice();
    sim.step();
    const p = sim.player.pos;
    sim.npcs.forEach((n, i) => {
      const s = this.snaps[i];
      const turned = angleDiff(n.facing, s.facing) > 1e-6;
      if (n.mode === "tell" && s.mode !== "tell") s.tellStart = sim.time;
      if (n.mode === "look" && s.mode === "tell") {
        this.looks.push({ t: sim.time, npc: n.def.id, tellSec: sim.time - s.tellStart, required: n.def.tellSec });
      }
      if (n.mode === "walk" && s.mode !== "walk") {
        s.walkFrom = s.mode;
        s.walkSteps = 0;
      }
      if (n.mode === "walk") s.walkSteps++;
      let turnKind = null;
      if (turned) {
        if (n.mode === "look" && s.mode === "tell") turnKind = null;
        else if (n.mode === "talk" && s.mode !== "talk") turnKind = "talkStart";
        else if (s.mode === "talk" && n.mode !== "talk") turnKind = "talkEnd";
        else if (n.mode === "walk" && s.walkSteps <= 2 && s.walkFrom !== "walk") turnKind = "resume";
        else if (n.mode === "walk") turnKind = "corner";
        else turnKind = "corner";
        if (turnKind) {
          this.turns.push({
            t: sim.time,
            npc: n.def.id,
            kind: turnKind,
            seesPlayer: sim.seeing[i] === true,
            deltaDeg: angleDiff(n.facing, s.facing) * 180 / Math.PI
          });
        }
      }
      if (sim.seeing[i] && !wasSeeing[i]) {
        let cause;
        const cone = n.def.cone;
        const prevPosPrevFacing = canSee(sim.map, { x: s.x, y: s.y }, s.facing, cone, p);
        const curPosPrevFacing = canSee(sim.map, n.pos, s.facing, cone, p);
        if (n.mode === "look" && s.mode === "tell") cause = "tellLook";
        else if (turnKind === "talkStart") cause = "talkStart";
        else if (turned && !curPosPrevFacing) {
          cause = turnKind === "resume" ? "turnResume" : turnKind === "talkEnd" ? "turnTalkEnd" : "turnCorner";
        } else if (prevPosPrevFacing) cause = "playerEnter";
        else if (curPosPrevFacing) cause = "npcAdvance";
        else cause = "other";
        this.onsets.push({ t: sim.time, npc: n.def.id, cause });
        this.episodeCause[i] = cause;
      }
      if (!sim.seeing[i]) this.episodeCause[i] = null;
      s.x = n.x;
      s.y = n.y;
      s.facing = n.facing;
      s.mode = n.mode;
    });
    this.px = p.x;
    this.py = p.y;
  }
  /** caught 순간 원인: 지금 보고 있는 NPC 중 배율이 가장 큰 NPC의 에피소드 원인 */
  caughtCause() {
    const sim = this.sim;
    let best = -1, bestMult = -1;
    sim.npcs.forEach((n, i) => {
      if (sim.seeing[i] && n.def.gazeMultiplier > bestMult) {
        best = i;
        bestMult = n.def.gazeMultiplier;
      }
    });
    if (best < 0) return null;
    return { npc: sim.npcs[best].def.id, cause: this.episodeCause[best] ?? "other" };
  }
};

// tests/t124-core.test.ts
var RULES2 = PROTO_FLOOR.rules;
var LEGEND = PROTO_FLOOR.level.legend;
var H = RULES2.fixedStepSec;
function npc(over) {
  return {
    name: over.id,
    role: "boss",
    cone: { range: 6, halfAngleDeg: 30 },
    speedTilesPerSec: 1,
    gazeMultiplier: 1,
    tellSec: 0.5,
    lookSec: 1,
    lookChance: 0,
    glanceBackChancePerTile: 0,
    ...over
  };
}
function content(rows, start, npcs, exitZone = "exit") {
  const level = { id: "qa", rows, legend: LEGEND, playerStart: start, exitZone, npcs };
  return { level, rules: RULES2 };
}
function bfs(map, s) {
  const d = new Int32Array(map.width * map.height).fill(-1);
  const q = [s.y * map.width + s.x];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % map.width, cy = (c - cx) / map.width;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = ny * map.width + nx;
      if (d[ni] !== -1) continue;
      d[ni] = d[c] + 1;
      q.push(ni);
    }
  }
  return d;
}
section("1. \uACB0\uC815\uC131");
{
  const run = (seed) => {
    const sim = new FloorSim(PROTO_FLOOR, seed);
    const r = createRng(`taps-${seed}`);
    const ev = [];
    for (let i = 0; i < 4e3 && sim.outcome === "playing"; i++) {
      if (r.chance(0.03)) sim.tap(r.int(-1, 11), r.int(-1, 62));
      sim.step();
      for (const e of sim.drainEvents()) ev.push(JSON.stringify(e));
    }
    return { fp: sim.fingerprint(), ev: ev.join("\n") };
  };
  let same = 0, n = 60, differ = 0;
  const fps = /* @__PURE__ */ new Set();
  for (let k = 0; k < n; k++) {
    const a = run(`det-${k}`), b = run(`det-${k}`);
    if (a.fp === b.fp && a.ev === b.ev) same++;
    fps.add(a.fp);
  }
  differ = fps.size;
  check("\uAC19\uC740 \uC2DC\uB4DC\xB7\uAC19\uC740 \uD0ED \uC2DC\uD000\uC2A4 \u2192 fingerprint\xB7\uC774\uBCA4\uD2B8 \uB85C\uADF8 \uC644\uC804 \uC77C\uCE58", same === n, `${same}/${n} \uC2DC\uB4DC`);
  check("\uB2E4\uB978 \uC2DC\uB4DC \u2192 \uB2E4\uB978 \uACB0\uACFC(\uC2DC\uB4DC\uAC00 \uC2E4\uC81C\uB85C \uBC18\uC601\uB428)", differ > n * 0.9, `\uACE0\uC720 fingerprint ${differ}/${n}`);
  const N = 3600;
  const ref = new FloorSim(PROTO_FLOOR, "day-1");
  ref.tap(5, 1);
  for (let i = 0; i < N; i++) ref.step();
  const refFp = ref.fingerprint();
  const patterns = {
    "1/60": () => 1 / 60,
    "1/30": () => 1 / 30,
    "0.05": () => 0.05,
    "0.1(max)": () => 0.1,
    "1/120": () => 1 / 120,
    "1/144": () => 1 / 144,
    "1/90": () => 1 / 90,
    "0.033": () => 0.033,
    "\uBB34\uC791\uC704 0.001~0.1": (_i, r) => r.range(1e-3, 0.1)
  };
  for (const [name, gen] of Object.entries(patterns)) {
    const s = new FloorSim(PROTO_FLOOR, "day-1");
    s.tap(5, 1);
    const r = createRng(`dt-${name}`);
    let total = 0, calls = 0;
    while (total < 60 - 1e-12 && calls < 1e6) {
      const dt = Math.min(gen(calls, r), 60 - total);
      s.advance(dt);
      total += dt;
      calls++;
    }
    const stepsOk = s.steps === N;
    const s2 = new FloorSim(PROTO_FLOOR, "day-1");
    s2.tap(5, 1);
    for (let i = 0; i < s.steps; i++) s2.step();
    const stateOk = s2.fingerprint() === s.fingerprint();
    check(`advance dt=${name}: \uCD1D 60\uCD08 \u2192 \uC2A4\uD15D ${N}\uAC1C`, stepsOk, `\uC2E4\uC81C ${s.steps}\uC2A4\uD15D (${calls}\uD68C \uD638\uCD9C)`);
    const caught = new FloorSim(PROTO_FLOOR, "day-1");
    void caught;
    if (!stepsOk) {
      s.advance(1e-9);
      info(`  dt=${name}: \uBD80\uB3D9\uC18C\uC218 \uC794\uC5EC\uB85C 1\uC2A4\uD15D \uC9C0\uC5F0, +1e-9\uCD08 advance \uD6C4 ${s.steps}\uC2A4\uD15D(\uB204\uB77D \uC544\uB2D8, \uC9C0\uC5F0)`);
    }
    check(`advance dt=${name}: \uAC19\uC740 \uC2A4\uD15D \uC218\uC5D0\uC11C \uC0C1\uD0DC \uB3D9\uC77C`, stateOk && (!stepsOk || s.fingerprint() === refFp));
  }
  const big = new FloorSim(PROTO_FLOOR, "day-1");
  big.advance(1);
  info(`advance(1.0) \uD55C \uBC88 \u2192 ${big.steps}\uC2A4\uD15D (maxAdvanceSec=${RULES2.maxAdvanceSec} \uD074\uB7A8\uD504\uB85C \uC2DC\uAC04 \uC190\uC2E4 ${(1 - big.steps * H).toFixed(3)}\uCD08)`);
}
section("2. \uC785\uB825 \uC758\uBBF8");
{
  const sim = new FloorSim(PROTO_FLOOR, "day-1");
  check("idle\uC5D0\uC11C \uCD9C\uAD6C \uD0ED \u2192 moving", sim.tap(5, 1) === "moving" && sim.player.mode === "moving");
  for (let i = 0; i < 20; i++) sim.step();
  const r = sim.tap(0, 0);
  check(
    "moving \uC911 \uD0ED(\uC88C\uD45C \uBB34\uAD00) \u2192 stopped / disguised",
    r === "stopped" && sim.player.mode === "disguised" && sim.destination === null,
    `result=${r} mode=${sim.player.mode}`
  );
  const px = sim.player.x, py = sim.player.y;
  for (let i = 0; i < 30; i++) sim.step();
  check("\uC704\uC7A5 \uC911\uC5D0\uB294 \uC6C0\uC9C1\uC774\uC9C0 \uC54A\uC74C", sim.player.x === px && sim.player.y === py);
  check("disguised\uC5D0\uC11C \uD0ED \u2192 moving(\uC7AC\uCD9C\uBC1C)", sim.tap(5, 1) === "moving");
  const own = new FloorSim(PROTO_FLOOR, "day-1");
  const st = PROTO_FLOOR.level.playerStart;
  const ownR = own.tap(st.x, st.y);
  info(`idle \uC0C1\uD0DC\uC5D0\uC11C \uC790\uAE30 \uD0C0\uC77C \uD0ED \u2192 '${ownR}' (\uACBD\uB85C \uAE38\uC774 0)`);
  const talkC = content([".........", "#########"], { x: 0, y: 0 }, [
    npc({
      id: "g",
      role: "guard",
      cone: { range: 0.5, halfAngleDeg: 10 },
      waypoints: [{ x: 4, y: 0, waitSec: 999 }],
      talk: { radius: 1.1, durationSec: 1.5, cooldownSec: 6 }
    })
  ], "none");
  const t = new FloorSim(talkC, "s");
  t.tap(8, 0);
  let talkedAt = -1;
  for (let i = 0; i < 600 && talkedAt < 0; i++) {
    t.step();
    if (t.player.mode === "talked") talkedAt = t.steps;
  }
  check("NPC \uB9D0\uAC78\uAE30 \uBC18\uACBD \uC9C4\uC785 \u2192 talked", talkedAt > 0);
  check("talked \uC911 \uD0ED \u2192 ignored", t.tap(8, 0) === "ignored" && t.player.mode === "talked");
  for (let i = 0; i < Math.ceil(1.5 / H) + 2; i++) t.step();
  check(
    "D-039: \uB9D0\uAC78\uAE30 \uC885\uB8CC \uD6C4 \uC6D0\uB798 \uBAA9\uC801\uC9C0\uB85C \uC790\uB3D9 \uC7AC\uAC1C",
    t.player.mode === "moving",
    `\uC885\uB8CC \uD6C4 mode=${t.player.mode}, destination=${JSON.stringify(t.destination)}`
  );
  const map = new FloorSim(PROTO_FLOOR, "x").map;
  let total = 0, ok = 0, moving = 0, unreach = 0;
  const bad = [];
  for (let y = -1; y <= map.height; y++) {
    for (let x = -1; x <= map.width; x++) {
      if (isWalkable(map, x, y)) continue;
      total++;
      let bestD = Infinity, bestE = Infinity;
      for (let yy = 0; yy < map.height; yy++) for (let xx = 0; xx < map.width; xx++) {
        if (!isWalkable(map, xx, yy)) continue;
        const d = Math.abs(xx - x) + Math.abs(yy - y);
        if (d > 2) continue;
        const e = (xx - x) ** 2 + (yy - y) ** 2;
        if (d < bestD || d === bestD && e < bestE) {
          bestD = d;
          bestE = e;
        }
      }
      const s = new FloorSim(PROTO_FLOOR, "x");
      const res = s.tap(x, y);
      const dest = s.destination;
      let good;
      if (bestD === Infinity) good = res === "unreachable";
      else good = res === "moving" && !!dest && Math.abs(dest.x - x) + Math.abs(dest.y - y) === bestD && (dest.x - x) ** 2 + (dest.y - y) ** 2 === bestE;
      if (res === "moving") moving++;
      else if (res === "unreachable") unreach++;
      if (good) ok++;
      else if (bad.length < 5) bad.push(`(${x},${y}) res=${res} dest=${JSON.stringify(dest)} \uAE30\uB300\uAC70\uB9AC=${bestD}`);
    }
  }
  check(
    "\uBCBD\xB7\uC5C4\uD3D0\uBB3C\xB7\uB9F5 \uBC16 \uD0ED \u2192 \uBC18\uACBD 2 \uC548 \uCD5C\uADFC\uC811 \uD1B5\uD589 \uD0C0\uC77C\uB85C \uBCF4\uC815, \uC5C6\uC73C\uBA74 unreachable",
    ok === total,
    `${ok}/${total} (moving ${moving}, unreachable ${unreach}) ${bad.join("; ")}`
  );
  check("\uBC18\uACBD \uBC16(\uB9F5\uC5D0\uC11C 3\uCE78 \uC774\uC0C1) \uD0ED \u2192 unreachable", new FloorSim(PROTO_FLOOR, "x").tap(-3, 30) === "unreachable");
  const iso = content(["....#..", "#######"], { x: 0, y: 0 }, [npc({ id: "n", waypoints: [{ x: 1, y: 0, waitSec: 9 }] })], "none");
  const si = new FloorSim(iso, "s");
  check("\uBD84\uB9AC\uB41C \uAD6C\uC5ED \uD0ED \u2192 unreachable, \uC0C1\uD0DC idle \uC720\uC9C0", si.tap(6, 0) === "unreachable" && si.player.mode === "idle");
  const dist = bfs(map, PROTO_FLOOR.level.playerStart);
  let walk = 0, conn = 0;
  for (let i = 0; i < dist.length; i++) if (map.walkable[i]) {
    walk++;
    if (dist[i] >= 0) conn++;
  }
  check("\uD504\uB85C\uD1A0 \uCE35: \uBAA8\uB4E0 \uD1B5\uD589 \uD0C0\uC77C\uC774 \uC2DC\uC791\uC810\uACFC \uC5F0\uACB0", walk === conn, `${conn}/${walk}`);
}
section("3. \uACBD\uB85C");
{
  const map = new FloorSim(PROTO_FLOOR, "x").map;
  const tiles = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isWalkable(map, x, y)) tiles.push({ x, y });
  const r = createRng("path-fuzz");
  let pairs = 0, ok = 0;
  const bad = [];
  for (let k = 0; k < 5e3; k++) {
    const a = r.pick(tiles), b = { x: r.int(-1, map.width), y: r.int(-1, map.height) };
    const p = findPath(map, a, b);
    const d = isWalkable(map, b.x, b.y) ? bfs(map, a)[b.y * map.width + b.x] : -1;
    pairs++;
    let good = true;
    if (d < 0) good = p === null;
    else if (!p || p.length !== d) good = false;
    else {
      let prev = a;
      for (const t of p) {
        if (Math.abs(t.x - prev.x) + Math.abs(t.y - prev.y) !== 1 || !isWalkable(map, t.x, t.y)) good = false;
        prev = t;
      }
      if (p.length > 0 && (prev.x !== b.x || prev.y !== b.y)) good = false;
    }
    if (good) ok++;
    else if (bad.length < 3) bad.push(`${JSON.stringify(a)}\u2192${JSON.stringify(b)}`);
  }
  check("A* \uBB34\uC791\uC704 5000\uC30D: 4\uBC29\uD5A5 \uC778\uC811\xB7\uD1B5\uD589 \uAC00\uB2A5\xB7\uCD5C\uB2E8(BFS\uC640 \uAC19\uC740 \uAE38\uC774)\xB7\uB3C4\uB2EC\uBD88\uAC00 null", ok === pairs, `${ok}/${pairs} ${bad.join(" ")}`);
  let taps = 0, stops = 0, steps = 0, violations = 0, offLine = 0, teleports = 0, npcBad = 0;
  const firstBad = [];
  const maxStep = RULES2.playerSpeedTilesPerSec * H + 1e-9;
  for (let s = 0; s < 300; s++) {
    const sim = new FloorSim(PROTO_FLOOR, `fuzz-${s}`);
    const tr = createRng(`fuzz-taps-${s}`);
    for (let i = 0; i < 2400; i++) {
      if (tr.chance(0.06)) {
        const res = sim.tap(tr.int(-1, 11), tr.int(-1, 62));
        taps++;
        if (res === "stopped") stops++;
      }
      const px = sim.player.x, py = sim.player.y;
      sim.suspicion.value = 0;
      sim.outcome = "playing";
      sim.step();
      steps++;
      const p = sim.player;
      const t = tileOf(p);
      if (!isWalkable(map, t.x, t.y)) {
        violations++;
        if (firstBad.length < 3) firstBad.push(`seed ${s} step ${i} pos=(${p.x.toFixed(3)},${p.y.toFixed(3)})`);
      }
      const fx = p.x - Math.floor(p.x), fy = p.y - Math.floor(p.y);
      if (Math.abs(fx - 0.5) > 1e-6 && Math.abs(fy - 0.5) > 1e-6) offLine++;
      if (Math.hypot(p.x - px, p.y - py) > maxStep) teleports++;
      for (const n of sim.npcs) {
        const nt = tileOf(n);
        if (!isWalkable(map, nt.x, nt.y)) npcBad++;
      }
    }
  }
  info(`\uD37C\uC9D5: 300\uD310 \xD7 2400\uC2A4\uD15D = ${steps}\uC2A4\uD15D, \uD0ED ${taps}\uD68C(\uC815\uC9C0 ${stops}\uD68C)`);
  check("\uD50C\uB808\uC774\uC5B4\uAC00 \uD56D\uC0C1 \uD1B5\uD589 \uAC00\uB2A5 \uD0C0\uC77C \uC704(\uBCBD \uAD00\uD1B5 0)", violations === 0, `${violations}\uAC74 ${firstBad.join("; ")}`);
  check("\uD50C\uB808\uC774\uC5B4\uAC00 \uD56D\uC0C1 \uD0C0\uC77C \uC911\uC2EC\uC120 \uC704(\uB300\uAC01 \uAC00\uB85C\uC9C0\uB974\uAE30 0)", offLine === 0, `${offLine}\uAC74`);
  check("\uD55C \uC2A4\uD15D \uC774\uB3D9\uB7C9 \u2264 \uC18D\uB3C4\xD7dt(\uC21C\uAC04\uC774\uB3D9 0)", teleports === 0, `${teleports}\uAC74`);
  check("NPC\uAC00 \uD56D\uC0C1 \uD1B5\uD589 \uAC00\uB2A5 \uD0C0\uC77C \uC704", npcBad === 0, `${npcBad}\uAC74`);
}
section("4. \uC2DC\uC120");
{
  const cone = { range: 8, halfAngleDeg: 30 };
  for (const [ch, nm] of [["P", "\uD30C\uD2F0\uC158"], ["F", "\uD654\uBD84"], ["X", "\uBCF5\uC0AC\uAE30"], ["#", "\uBCBD"]]) {
    const m = buildGridMap([".........", `...${ch}.....`, "........."], LEGEND);
    check(`${nm} \uB4A4 \uC548 \uBCF4\uC784`, !canSee(m, { x: 0.5, y: 1.5 }, 0, cone, { x: 5.5, y: 1.5 }));
    check(`${nm} \uC55E\uC740 \uBCF4\uC784`, canSee(m, { x: 0.5, y: 1.5 }, 0, cone, { x: 2.5, y: 1.5 }));
  }
  const md = buildGridMap([".........", "...D.....", "........."], LEGEND);
  check("\uCC45\uC0C1 \uB108\uBA38 \uBCF4\uC784", canSee(md, { x: 0.5, y: 1.5 }, 0, cone, { x: 5.5, y: 1.5 }));
  for (const ch of ["P", "F", "X", "#"]) {
    const g = buildGridMap([`.${ch}..`, `${ch}...`, "....", "...."], LEGEND);
    const a = !hasLineOfSight(g, { x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 });
    const b = !hasLineOfSight(g, { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 });
    const c = !hasLineOfSight(g, { x: 3.5, y: 3.5 }, { x: 0.5, y: 0.5 });
    check(`\uB300\uAC01 \uD2C8(${ch}) \uD22C\uC2DC \uC5C6\uC74C(\uC591\uBC29\uD5A5)`, a && b && c);
  }
  const o = { x: 0.5, y: 0.5 }, h = 30 * Math.PI / 180;
  const at = (a, d) => ({ x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d });
  check("\uC815\uD655\uD788 \uBC18\uAC01 \uACBD\uACC4(\xB130\xB0)\uB294 \uD3EC\uD568", inCone(o, 0, cone, at(h, 3)) && inCone(o, 0, cone, at(-h, 3)));
  check("\uBC18\uAC01 +0.1\xB0 \uBC16\uC740 \uC81C\uC678", !inCone(o, 0, cone, at(h + 0.1 * Math.PI / 180, 3)) && !inCone(o, 0, cone, at(-h - 0.1 * Math.PI / 180, 3)));
  check("\uC815\uD655\uD788 \uC0AC\uAC70\uB9AC\uB294 \uD3EC\uD568, \uC0AC\uAC70\uB9AC+0.001\uC740 \uC81C\uC678", inCone(o, 0, cone, at(0, 8)) && !inCone(o, 0, cone, at(0, 8.001)));
  check(
    "facing \uAC01\uB3C4 \uD45C\uD604 \uBB34\uAD00(\u2212\u03C0/2 \u2261 3\u03C0/2, \u03C0 \u2261 \u2212\u03C0)",
    inCone(o, -Math.PI / 2, cone, at(-Math.PI / 2, 3)) === inCone(o, 1.5 * Math.PI, cone, at(-Math.PI / 2, 3)) && inCone(o, Math.PI, cone, at(Math.PI - 0.1, 3)) && inCone(o, -Math.PI, cone, at(Math.PI - 0.1, 3))
  );
  const map = new FloorSim(PROTO_FLOOR, "x").map;
  const r = createRng("vision-fuzz");
  const walk = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isWalkable(map, x, y)) walk.push({ x, y });
  let n = 0, polyMismatch = 0, asym = 0, edgeIncons = 0;
  for (let k = 0; k < 3e4; k++) {
    const a = r.pick(walk), b = r.pick(walk);
    const oa = { x: a.x + r.range(0.05, 0.95), y: a.y + 0.5 };
    const tb = { x: b.x + 0.5, y: b.y + r.range(0.05, 0.95) };
    if (Math.abs(oa.y - tb.y) > 10) continue;
    n++;
    const facing = r.range(-Math.PI, Math.PI);
    const c2 = { range: 6, halfAngleDeg: 35 };
    const sees = canSee(map, oa, facing, c2, tb);
    const dx = tb.x - oa.x, dy = tb.y - oa.y, d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const inAngle = angleDiff(ang, facing) <= 35 * Math.PI / 180 + 1e-9;
    const rd = rayDistance(map, oa.x, oa.y, dx / d, dy / d, 6);
    const polySays = inAngle && d <= 6 && rd >= d - 1e-9;
    if (polySays !== sees) polyMismatch++;
    if (hasLineOfSight(map, oa, tb) !== hasLineOfSight(map, tb, oa)) asym++;
    void edgeIncons;
  }
  check("\uB80C\uB354 \uCF58(rayDistance) \u2194 canSee \uD310\uC815 \uC77C\uCE58", polyMismatch === 0, `${polyMismatch}/${n}`);
  check("LOS \uB300\uCE6D\uC131(A\u2192B == B\u2192A)", asym === 0, `${asym}/${n} \uBD88\uC77C\uCE58`);
  const poly = conePolygon(map, { x: 5.5, y: 8.5 }, -Math.PI / 2, { range: 5, halfAngleDeg: 30 }, 14);
  const a0 = Math.atan2(poly[1].y - 8.5, poly[1].x - 5.5), a1 = Math.atan2(poly[14].y - 8.5, poly[14].x - 5.5);
  check("conePolygon \uC591\uB05D \uAD11\uC120 = facing \xB1 \uBC18\uAC01", Math.abs(angleDiff(a0, -Math.PI / 2) - h) < 1e-6 && Math.abs(angleDiff(a1, -Math.PI / 2) - h) < 1e-6);
}
section("5. \uC758\uC2EC");
{
  const S = RULES2.suspicion;
  const s = createSuspicion();
  let firstRiseT = -1, roseEarly = false;
  for (let i = 1; i <= 30; i++) {
    updateSuspicion(s, S, 1, "moving", 1, H);
    if (s.value > 0 && firstRiseT < 0) firstRiseT = i * H;
    if (i * H <= S.graceSec + 1e-9 && s.value > 0) roseEarly = true;
  }
  check(`\uB178\uCD9C ${S.graceSec}\uCD08 \uC774\uB0B4 \uC0C1\uC2B9 \uC5C6\uC74C`, !roseEarly, `\uCCAB \uC0C1\uC2B9 ${firstRiseT.toFixed(4)}\uCD08`);
  const s2 = createSuspicion();
  for (let i = 0; i < 30; i++) updateSuspicion(s2, S, 1, "moving", 1, H);
  const v0 = s2.value;
  updateSuspicion(s2, S, 0, "moving", 1, H);
  updateSuspicion(s2, S, 1, "moving", 1, H);
  info(`\uB178\uCD9C\uC774 1\uC2A4\uD15D \uB04A\uAE34 \uB4A4 \uC7AC\uB178\uCD9C \u2192 \uC720\uC608 \uC7AC\uC801\uC6A9(\uC0C1\uC2B9 ${(s2.value - v0).toFixed(4)}). \uCF58 \uACBD\uACC4\uC5D0\uC11C \uAE5C\uBE61\uC774\uB294 \uB178\uCD9C\uC740 \uC720\uC608\uAC00 \uBC18\uBCF5 \uC801\uC6A9\uB428`);
  const c = content(["...............", "###############"], { x: 2, y: 0 }, [
    npc({ id: "b", cone: { range: 20, halfAngleDeg: 60 }, waypoints: [{ x: 0, y: 0, waitSec: 9999 }] })
  ], "none");
  const sim = new FloorSim(c, "s");
  sim.npcs[0].facing = 0;
  sim.tap(14, 0);
  for (let i = 0; i < 20; i++) sim.step();
  sim.tap(0, 0);
  const rates = [];
  for (let i = 0; i < 30; i++) {
    const b = sim.suspicion.value;
    sim.step();
    rates.push((sim.suspicion.value - b) / H);
  }
  const movingSteps = rates.filter((r) => Math.abs(r - S.movingPerSec) < 1e-6).length;
  const settleTarget = Math.round(S.disguiseSettleSec / H);
  check(
    `\uC704\uC7A5 \uC9C1\uD6C4 ${S.disguiseSettleSec}\uCD08(${settleTarget}\uC2A4\uD15D) \uB3D9\uC548 \uC774\uB3D9 \uC0C1\uC2B9\uB960 ${S.movingPerSec}/s`,
    Math.abs(movingSteps - settleTarget) <= 1 && rates[0] > 0,
    `\uC774\uB3D9\uB960 \uC2A4\uD15D ${movingSteps}\uAC1C, \uC774\uD6C4 ${rates[movingSteps]?.toFixed(3)}/s (\uC704\uC7A5\uB960 ${S.disguisedPerSec})`
  );
  check("settle \uC774\uD6C4 \uC704\uC7A5 \uC0C1\uC2B9\uB960", Math.abs((rates[movingSteps + 1] ?? 0) - S.disguisedPerSec) < 1e-6);
  const two = (mults) => {
    const cc = content(
      ["...............", "###############"],
      { x: 7, y: 0 },
      mults.map((m, k) => npc({
        id: `n${k}`,
        gazeMultiplier: m,
        cone: { range: 20, halfAngleDeg: 60 },
        waypoints: [{ x: k === 0 ? 0 : 14, y: 0, waitSec: 9999 }]
      })),
      "none"
    );
    const sm = new FloorSim(cc, "s");
    sm.npcs[0].facing = 0;
    if (sm.npcs[1]) sm.npcs[1].facing = Math.PI;
    for (let i = 0; i < 60; i++) sm.step();
    return { v: sm.suspicion.value, seeing: sm.seeing.filter(Boolean).length };
  };
  const one = two([1]), both = two([1, 0.8]), rev = two([0.8, 1]);
  check(
    "\uB450 NPC \uB3D9\uC2DC \uC2DC\uC120 \u2192 \uBC30\uC728 \uCD5C\uB313\uAC12 \uD558\uB098\uB9CC \uC801\uC6A9(\uD569\uC0B0 \uC544\uB2D8)",
    both.seeing === 2 && Math.abs(both.v - one.v) < 1e-12 && Math.abs(rev.v - one.v) < 1e-12,
    `\uB2E8\uB3C5=${one.v.toFixed(4)} \uB3D9\uC2DC=${both.v.toFixed(4)} \uC21C\uC11C\uBC18\uB300=${rev.v.toFixed(4)}`
  );
  const cs = new FloorSim(c, "s");
  cs.npcs[0].facing = 0;
  cs.tap(14, 0);
  let caughtStep = -1, valueAtCaught = 0;
  for (let i = 0; i < 2e3 && cs.outcome === "playing"; i++) {
    cs.step();
    if (cs.outcome === "caught") {
      caughtStep = cs.steps;
      valueAtCaught = cs.suspicion.value;
    }
    if (cs.player.mode === "idle") cs.tap(cs.player.tile.x === 14 ? 1 : 14, 0);
  }
  const ev = cs.drainEvents();
  check(
    "\uC758\uC2EC 100% \uB3C4\uB2EC \u2192 caught, \uC774\uBCA4\uD2B8 1\uD68C",
    caughtStep > 0 && valueAtCaught >= S.max && ev.filter((e) => e.type === "caught").length === 1,
    `step ${caughtStep}, value ${valueAtCaught}`
  );
  const fp = cs.fingerprint();
  cs.advance(1);
  cs.step();
  check("caught \uC774\uD6C4 tap \u2192 ignored, \uC9C4\uD589 \uC815\uC9C0", cs.tap(3, 0) === "ignored" && cs.fingerprint() === fp);
  const d = createSuspicion();
  d.value = 0.5;
  for (let i = 0; i < 60; i++) updateSuspicion(d, S, 0, "disguised", 1, H);
  const dm = createSuspicion();
  dm.value = 0.5;
  for (let i = 0; i < 60; i++) updateSuspicion(dm, S, 0, "moving", 1, H);
  check("\uBE44\uB178\uCD9C+\uBE44\uC774\uB3D9 1\uCD08 \uAC10\uC1E0 = decayPerSec, \uC774\uB3D9 \uC911\uC740 \uAC10\uC1E0 \uC5C6\uC74C", Math.abs(0.5 - d.value - S.decayPerSec) < 1e-9 && dm.value === 0.5);
}
section("6. \uC804\uC870");
{
  const defs = PROTO_FLOOR.level.npcs;
  check("\uBAA8\uB4E0 NPC tellSec \u2265 0.4 (rules.json tell.minSec)", defs.every((n) => n.tellSec >= 0.4), defs.map((n) => `${n.id}=${n.tellSec}`).join(" "));
  let looks = 0, short = 0;
  const causeCount = {};
  let onsets = 0, turnTotal = 0, turnSee = 0, simSec = 0;
  const kindSee = {}, kindAll = {};
  for (let s = 0; s < 300; s++) {
    const sim = new FloorSim(PROTO_FLOOR, `tell-${s}`);
    const ob = new Observer(sim);
    const tr = createRng(`tell-taps-${s}`);
    for (let i = 0; i < 3600; i++) {
      if (tr.chance(0.02)) sim.tap(tr.int(0, 10), tr.int(0, 61));
      sim.suspicion.value = 0;
      ob.step();
    }
    simSec += sim.time;
    for (const l of ob.looks) {
      looks++;
      if (l.tellSec < l.required - 1e-9 || l.tellSec < 0.4 - 1e-9) short++;
    }
    for (const o of ob.onsets) {
      onsets++;
      causeCount[o.cause] = (causeCount[o.cause] ?? 0) + 1;
    }
    for (const t of ob.turns) {
      turnTotal++;
      kindAll[t.kind] = (kindAll[t.kind] ?? 0) + 1;
      if (t.seesPlayer) {
        turnSee++;
        kindSee[t.kind] = (kindSee[t.kind] ?? 0) + 1;
      }
    }
  }
  check("\uBAA8\uB4E0 look \uC9C1\uC804 tell \u2265 tellSec(\u22650.4\uCD08)", short === 0, `look ${looks}\uD68C \uC911 \uBD80\uC871 ${short}`);
  const unfair = UNFAIR_CAUSES.reduce((a, c) => a + (causeCount[c] ?? 0), 0);
  info(`\uBB34\uC791\uC704 \uD0ED 300\uD310(${(simSec / 60).toFixed(0)}\uBD84): \uC2DC\uC120 \uC2DC\uC791 ${onsets}\uD68C, \uC6D0\uC778 ${JSON.stringify(causeCount)}`);
  info(`\uC804\uC870 \uC5C6\uB294 NPC \uBC29\uD5A5 \uC804\uD658 ${turnTotal}\uD68C(\uBD84\uB2F9 ${(turnTotal / (simSec / 60)).toFixed(1)}), \uADF8 \uC21C\uAC04 \uD50C\uB808\uC774\uC5B4\uAC00 \uC0C8 \uC2DC\uC120\uC5D0 \uBCF4\uC784 ${turnSee}\uD68C`);
  info(`\uC804\uD658 \uC885\uB958\uBCC4 \uC804\uCCB4 ${JSON.stringify(kindAll)} / \uADF8\uC911 \uD50C\uB808\uC774\uC5B4 \uBCF4\uC784 ${JSON.stringify(kindSee)}`);
  check(
    "\uC804\uC870 \uC5C6\uC774 \uC2DC\uC791\uB41C \uC2DC\uC120(\uBAA8\uD241\uC774\xB7\uC7AC\uCD9C\uBC1C\xB7\uB9D0\uAC78\uAE30) 0\uAC74 (D-038, GDD \xA711)",
    unfair === 0,
    `${unfair}/${onsets} (${(100 * unfair / Math.max(1, onsets)).toFixed(1)}%)`
  );
}
section("7. threatOf");
{
  let n = 0, seeingMismatch = 0, turningBad = 0, offNonNone = 0, offSamples = 0, wideBlocked = 0, approachCount = 0;
  const map = new FloorSim(PROTO_FLOOR, "x").map;
  for (let s = 0; s < 100; s++) {
    const sim = new FloorSim(PROTO_FLOOR, `thr-${s}`);
    const tr = createRng(`thr-taps-${s}`);
    for (let i = 0; i < 3600; i++) {
      if (tr.chance(0.02)) sim.tap(tr.int(0, 10), tr.int(0, 61));
      sim.suspicion.value = 0;
      sim.step();
      sim.npcs.forEach((npcI, k) => {
        n++;
        const t = sim.threatOf(k);
        if (t === "seeing" !== sim.seeing[k]) seeingMismatch++;
        if (t === "turning" && npcI.mode !== "tell") turningBad++;
        if (Math.abs(npcI.y - sim.player.y) > 12) {
          offSamples++;
          if (t !== "none") offNonNone++;
        }
        if (t === "approaching") {
          approachCount++;
          if (!hasLineOfSight(map, npcI.pos, sim.player.pos)) wideBlocked++;
        }
      });
    }
  }
  check("threatOf==='seeing' \u21D4 seeing[i]", seeingMismatch === 0, `${seeingMismatch}/${n}`);
  check("'turning'\uC740 tell \uC911\uC5D0\uB9CC", turningBad === 0);
  info(`approaching \uD310\uC815 \uC911 \uC2E4\uC81C\uB85C\uB294 \uBCBD\xB7\uC5C4\uD3D0\uBB3C\uC5D0 \uAC00\uB824\uC9C4 \uBE44\uC728 ${(100 * wideBlocked / Math.max(1, approachCount)).toFixed(0)}% (\uB113\uC740 \uCF58\uC740 \uAC00\uB9BC \uBB34\uC2DC \u2014 \uC124\uACC4 \uC758\uB3C4)`);
  info(`\uC138\uB85C 12\uD0C0\uC77C \uC774\uC0C1 \uB5A8\uC5B4\uC9C4(\uD654\uBA74 \uBC16) NPC\uAC00 \uACBD\uACE0(none \uC544\uB2D8)\uB97C \uB0B8 \uBE44\uC728 ${(100 * offNonNone / Math.max(1, offSamples)).toFixed(1)}%`);
}
var failed = summary();
process.exitCode = failed > 0 ? 1 : 0;
