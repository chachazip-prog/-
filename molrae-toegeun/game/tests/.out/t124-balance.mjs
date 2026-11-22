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
  move(path2) {
    if (this.mode === "talked") return false;
    const nodes = path2.map(tileCenter);
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
  constructor(content, seed) {
    this.level = content.level;
    this.rules = content.rules;
    this.map = buildGridMap(content.level.rows, content.level.legend);
    const s = content.level.playerStart;
    if (!isWalkable(this.map, s.x, s.y)) throw new Error("sim: \uC2DC\uC791 \uD0C0\uC77C \uD1B5\uD589 \uBD88\uAC00");
    this.rng = createRng(seed);
    this.player = new PlayerMover(s);
    this.npcs = content.level.npcs.map((d) => new PatrolNpc(d, this.map, this.rng));
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
      const path2 = goal ? findPath(this.map, this.player.tile, goal) : null;
      if (goal && path2 && this.player.move(path2)) {
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
    for (const npc of this.npcs) {
      const before = npc.mode;
      npc.step(dt, this.rng);
      if (npc.mode === "tell" && before !== "tell") this.events.push({ t: this.time, type: "tell", npc: npc.def.id });
    }
    for (const npc of this.npcs) {
      const talk = npc.def.talk;
      if (!talk || !npc.canTalk() || p.mode === "talked") continue;
      const dx = p.x - npc.x, dy = p.y - npc.y;
      if (Math.hypot(dx, dy) <= talk.radius) {
        p.forceTalk(talk.durationSec);
        npc.startTalk(Math.atan2(dy, dx));
        this.destination = null;
        this.events.push({ t: this.time, type: "talk", npc: npc.def.id });
      }
    }
    let mult = 0;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      const sees = canSee(this.map, npc.pos, npc.facing, npc.def.cone, p.pos);
      if (sees && !this.seeing[i]) this.events.push({ t: this.time, type: "spotted", npc: npc.def.id });
      this.seeing[i] = sees;
      if (sees) mult = Math.max(mult, npc.def.gazeMultiplier);
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
    const npc = this.npcs[index];
    if (!npc) return "none";
    if (this.seeing[index]) return "seeing";
    const pp = this.player.pos;
    const t = this.rules.threat;
    const wide = {
      range: npc.def.cone.range + t.approachExtraRange,
      halfAngleDeg: npc.def.cone.halfAngleDeg + t.approachExtraAngleDeg
    };
    if (npc.mode === "tell" && npc.pendingFacing !== null && inCone(npc.pos, npc.pendingFacing, wide, pp)) return "turning";
    if (npc.mode !== "talk" && inCone(npc.pos, npc.facing, wide, pp)) return "approaching";
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

// tests/sim/balance.ts
var BOTS = [
  { name: "straight", label: "\uC9C1\uC9C4(\uC704\uC7A5 \uC548 \uD568)", disguise: false, reactMean: 0, reactSd: 0, missProb: 1, resumeMean: 0, resumeSd: 0 },
  { name: "disguise", label: "\uC704\uC7A5 \uC0AC\uC6A9(\uBC18\uC751 0.30\uCD08)", disguise: true, reactMean: 0.3, reactSd: 0.08, missProb: 0, resumeMean: 0.3, resumeSd: 0.1 },
  { name: "novice", label: "\uB290\uB9B0 \uCD08\uBCF4(\uBC18\uC751 0.60\uCD08, 25% \uB193\uCE68)", disguise: true, reactMean: 0.6, reactSd: 0.15, missProb: 0.25, resumeMean: 0.15, resumeSd: 0.05 }
];
var EXIT = { x: 5, y: 1 };
var MAX_SEC = 180;
function gauss(r, m, sd) {
  const u = Math.max(1e-12, r.next()), v = r.next();
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function runOne(content, seed, bot) {
  const sim = new FloorSim(content, seed);
  const ob = new Observer(sim);
  const br = createRng(`bot-${bot.name}-${seed}`);
  const h = sim.rules.fixedStepSec;
  let threatSince = -1, reactAt = Infinity, ignoring = false, clearSince = -1, resumeAt = 0;
  let talks = 0, disguises = 0;
  const gainByCause = {};
  sim.tap(EXIT.x, EXIT.y);
  const maxSteps = Math.round(MAX_SEC / h);
  for (let i = 0; i < maxSteps && sim.outcome === "playing"; i++) {
    const t = sim.time;
    const threatened = sim.npcs.some((_, k) => {
      const th = sim.threatOf(k);
      return th === "seeing" || th === "turning";
    });
    const mode = sim.player.mode;
    if (bot.disguise) {
      if (threatened) {
        clearSince = -1;
        if (threatSince < 0) {
          threatSince = t;
          ignoring = br.chance(bot.missProb);
          reactAt = t + Math.max(0.1, gauss(br, bot.reactMean, bot.reactSd));
        }
        if (!ignoring && t >= reactAt && mode === "moving") {
          sim.tap(EXIT.x, EXIT.y);
          disguises++;
        }
      } else {
        threatSince = -1;
        if (clearSince < 0) {
          clearSince = t;
          resumeAt = t + Math.max(0.05, gauss(br, bot.resumeMean, bot.resumeSd));
        }
      }
      if ((mode === "idle" || mode === "disguised") && (!threatened || ignoring) && t >= resumeAt) sim.tap(EXIT.x, EXIT.y);
    } else if (mode === "idle" || mode === "disguised") sim.tap(EXIT.x, EXIT.y);
    const before = sim.suspicion.value;
    ob.step();
    const gain = sim.suspicion.value - before;
    if (gain > 0) {
      const c = ob.caughtCause();
      const key = c?.cause ?? "other";
      gainByCause[key] = (gainByCause[key] ?? 0) + gain;
    }
    for (const e of sim.drainEvents()) if (e.type === "talk") talks++;
  }
  const onsets = {};
  for (const o of ob.onsets) onsets[o.cause] = (onsets[o.cause] ?? 0) + 1;
  const cc = sim.outcome === "caught" ? ob.caughtCause() : null;
  const outcome = sim.outcome === "playing" ? "timeout" : sim.outcome;
  const peak = sim.suspicion.peak;
  return {
    outcome,
    time: sim.time,
    peak,
    stars: outcome === "escaped" ? peak < 0.3 ? 3 : 2 : 0,
    caughtBy: cc?.npc ?? null,
    caughtCause: cc?.cause ?? null,
    onsets,
    gainByCause,
    untoldOnsets: ob.onsets.filter((o) => UNFAIR_CAUSES.includes(o.cause)).length,
    talks,
    disguises
  };
}
function runBatch(content, bot, seeds2, prefix = "bal") {
  const out = [];
  for (let s = 0; s < seeds2; s++) out.push(runOne(content, `${prefix}-${s}`, bot));
  return out;
}
var pct = (a, b) => b === 0 ? "-" : `${(100 * a / b).toFixed(1)}%`;
function quant(xs, q) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}
var mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
var f1 = (v) => Number.isFinite(v) ? v.toFixed(1) : "-";
var CAUSE_LABEL = {
  tellLook: "\uC804\uC870 \uD6C4 \uB3CC\uC544\uBD04",
  playerEnter: "\uD50C\uB808\uC774\uC5B4\uAC00 \uCF58\uC5D0 \uC9C4\uC785",
  npcAdvance: "NPC \uC804\uC9C4(\uCF58\uC774 \uB2E4\uAC00\uC634)",
  turnCorner: "\uBAA8\uD241\uC774 \uC804\uD658(\uC804\uC870 \uC5C6\uC74C)",
  turnResume: "\uC7AC\uCD9C\uBC1C \uC804\uD658(\uC804\uC870 \uC5C6\uC74C)",
  turnTalkEnd: "\uB9D0\uAC78\uAE30 \uC885\uB8CC \uBCF5\uADC0(\uC804\uC870 \uC5C6\uC74C)",
  talkStart: "\uB9D0\uAC78\uAE30 \uC2DC\uC791(\uC804\uC870 \uC5C6\uC74C)",
  other: "\uAE30\uD0C0"
};
function report(all2, seeds2, title = "# T-124 \uBC38\uB7F0\uC2A4 \uC2DC\uBBAC\uB808\uC774\uC158 \uACB0\uACFC (\uD0D1\uB2E4\uC6B4 \uD504\uB85C\uD1A0\uD0C0\uC785 T-123)") {
  const L = [];
  L.push(title, "");
  L.push(`- \uC0DD\uC131: \`bash game/tests/run-balance.sh ${seeds2}\` (\uC2DC\uBBAC\uB808\uC774\uD130: \`game/tests/sim/balance.ts\`)`);
  L.push(`- \uB808\uBCA8: \`src/dev/protoFloor.ts\` proto-floor-1 (\uAC1C\uBC1C\uC790 \uC784\uC2DC \uC218\uCE58, \uAE30\uD68D \uBBF8\uD655\uC815). \uC2DC\uB4DC \`bal-0\`~\`bal-${seeds2 - 1}\` (\uBD07\uB2F9 ${seeds2}\uD310), \uD310 \uC0C1\uD55C ${MAX_SEC}\uCD08`);
  L.push("- \uBCC4\uC810(\uC784\uC2DC \uC815\uC758, rules.json stars \uC900\uC6A9): \uB4E4\uD0B4 \u26050, \uD0C8\uCD9C \u26052, \uD0C8\uCD9C+\uCD5C\uACE0 \uC758\uC2EC < 30% \u26053. \uD504\uB85C\uD1A0\uC5D0\uB294 \uC2DC\uACC4\xB7\uC57C\uADFC\uC774 \uC5C6\uC5B4 \u26051 \uC5C6\uC74C");
  L.push("- \uAE30\uD68D \uBAA9\uD45C(GDD \xA71, D-001 \uAE30\uC900 \uC218\uCE58\uB97C \uADF8\uB300\uB85C \uB300\uC785): 1\uD310 60~90\uCD08(\uD29C\uD1A0\uB9AC\uC5BC 50~75\uCD08), \uCD08\uBC18 \uC131\uACF5\uB960 70~80%, \uC801\uBC1C \u2264 10%, \uBAA8\uB4E0 \uC2DC\uC120 \uC804 \uC804\uC870 \u2265 0.4\uCD08", "");
  L.push("## 1. \uACB0\uACFC \uC694\uC57D", "");
  L.push("| \uBD07 | \uC131\uACF5(\uD0C8\uCD9C) | \uB4E4\uD0B4 | \uC2DC\uAC04\uCD08\uACFC | \u26053 | \u26052 | \uD310 \uAE38\uC774 \uD3C9\uADE0 | p10 | p50 | p90 | \uCD5C\uACE0 \uC758\uC2EC \uD3C9\uADE0 | \uC704\uC7A5 \uD69F\uC218/\uD310 | \uB9D0\uAC78\uAE30/\uD310 |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const b of BOTS) {
    const rs = all2[b.name];
    const n = rs.length, esc = rs.filter((r) => r.outcome === "escaped");
    const times = rs.map((r) => r.time);
    L.push(`| ${b.label} | ${pct(esc.length, n)} | ${pct(rs.filter((r) => r.outcome === "caught").length, n)} | ${pct(rs.filter((r) => r.outcome === "timeout").length, n)} | ${pct(rs.filter((r) => r.stars === 3).length, n)} | ${pct(rs.filter((r) => r.stars === 2).length, n)} | ${f1(mean(times))}\uCD08 | ${f1(quant(times, 0.1))} | ${f1(quant(times, 0.5))} | ${f1(quant(times, 0.9))} | ${(100 * mean(rs.map((r) => r.peak))).toFixed(1)}% | ${mean(rs.map((r) => r.disguises)).toFixed(2)} | ${mean(rs.map((r) => r.talks)).toFixed(2)} |`);
  }
  L.push("", "## 2. \uCD5C\uACE0 \uC758\uC2EC \uBD84\uD3EC (\uD310 \uBE44\uC728)", "");
  const buckets = [
    ["0%", (p) => p === 0],
    ["0~10%", (p) => p > 0 && p < 0.1],
    ["10~30%", (p) => p >= 0.1 && p < 0.3],
    ["30~60%", (p) => p >= 0.3 && p < 0.6],
    ["60~99%", (p) => p >= 0.6 && p < 1],
    ["100%(\uB4E4\uD0B4)", (p) => p >= 1]
  ];
  L.push(`| \uBD07 | ${buckets.map((x) => x[0]).join(" | ")} |`);
  L.push(`|---|${buckets.map(() => "---").join("|")}|`);
  for (const b of BOTS) {
    const rs = all2[b.name];
    L.push(`| ${b.label} | ${buckets.map(([, f]) => pct(rs.filter((r) => f(r.peak)).length, rs.length)).join(" | ")} |`);
  }
  L.push("", "## 3. \uB4E4\uD0B4 \uC6D0\uC778 (\uB4E4\uD0A8 \uD310 \uAE30\uC900, caught \uC21C\uAC04 \uBCF4\uACE0 \uC788\uB358 NPC\uC640 \uADF8 \uC2DC\uC120\uC774 \uC2DC\uC791\uB41C \uC6D0\uC778)", "");
  const causes = Object.keys(CAUSE_LABEL);
  L.push(`| \uBD07 | \uB4E4\uD0A8 \uD310 | ${causes.map((c) => CAUSE_LABEL[c]).join(" | ")} | \uC5B5\uC6B8\uD55C \uB4E4\uD0B4(\uC804\uC870 \uC5C6\uC74C) | NPC\uBCC4 |`);
  L.push(`|---|---|${causes.map(() => "---").join("|")}|---|---|`);
  for (const b of BOTS) {
    const cs = all2[b.name].filter((r) => r.outcome === "caught");
    const byNpc = {};
    for (const r of cs) byNpc[r.caughtBy ?? "?"] = (byNpc[r.caughtBy ?? "?"] ?? 0) + 1;
    const unfair = cs.filter((r) => r.caughtCause && UNFAIR_CAUSES.includes(r.caughtCause)).length;
    L.push(`| ${b.label} | ${cs.length} | ${causes.map((c) => String(cs.filter((r) => r.caughtCause === c).length)).join(" | ")} | ${unfair} (${pct(unfair, cs.length)}) | ${Object.entries(byNpc).map(([k, v]) => `${k} ${v}`).join(", ") || "-"} |`);
  }
  L.push("", "## 4. \uC2DC\uC120 \uC2DC\uC791 \uC6D0\uC778 \uC804\uCCB4 (\uBAA8\uB4E0 \uD310\uC758 \uC2DC\uC120 \uC2DC\uC791 \uC774\uBCA4\uD2B8)", "");
  L.push(`| \uBD07 | \uC2DC\uC120 \uC2DC\uC791 \uD569\uACC4 | ${causes.map((c) => CAUSE_LABEL[c]).join(" | ")} |`);
  L.push(`|---|---|${causes.map(() => "---").join("|")}|`);
  for (const b of BOTS) {
    const rs = all2[b.name];
    const tot = (c) => rs.reduce((a, r) => a + (r.onsets[c] ?? 0), 0);
    const sum = causes.reduce((a, c) => a + tot(c), 0);
    L.push(`| ${b.label} | ${sum} | ${causes.map((c) => `${tot(c)} (${pct(tot(c), sum)})`).join(" | ")} |`);
  }
  L.push("", "## 5. D-038 \uADFC\uAC70: \uC804\uC870 \uC5C6\uC774 \uC2DC\uC120\uC5D0 \uB4E4\uC5B4\uC624\uB294 \uBE48\uB3C4 (\uBAA8\uD241\uC774\xB7\uC7AC\uCD9C\uBC1C \uC804\uD658 vs \uB9D0\uAC78\uAE30)", "");
  L.push("| \uBD07 | \uAD6C\uBD84 | \uC2DC\uC120 \uC2DC\uC791/\uD310 | 1\uD68C \uC774\uC0C1 \uACAA\uC740 \uD310 | \uBD84\uB2F9 \uBE48\uB3C4 | \uC804\uCCB4 \uC758\uC2EC \uC0C1\uC2B9 \uC911 \uBE44\uC911 | \uC774 \uC6D0\uC778\uC73C\uB85C \uB4E4\uD0A8 \uD310 |");
  L.push("|---|---|---|---|---|---|---|");
  const groups = [
    ["\uBAA8\uD241\uC774\xB7\uC7AC\uCD9C\uBC1C \uC804\uD658(D-038 \uB300\uC0C1)", ["turnCorner", "turnResume", "turnTalkEnd"]],
    ["\uB9D0\uAC78\uAE30 \uC2DC\uC791(\uC989\uC2DC \uB3CC\uC544\uBD04)", ["talkStart"]]
  ];
  for (const b of BOTS) {
    const rs = all2[b.name];
    const totalMin = rs.reduce((a, r) => a + r.time, 0) / 60;
    const gainAll = rs.reduce((a, r) => a + Object.values(r.gainByCause).reduce((x, y) => x + (y ?? 0), 0), 0);
    for (const [gname, cs] of groups) {
      const per = (r) => cs.reduce((a, c) => a + (r.onsets[c] ?? 0), 0);
      const tot = rs.reduce((a, r) => a + per(r), 0);
      const gain = rs.reduce((a, r) => a + cs.reduce((x, c) => x + (r.gainByCause[c] ?? 0), 0), 0);
      const caught = rs.filter((r) => r.outcome === "caught" && r.caughtCause && cs.includes(r.caughtCause)).length;
      L.push(`| ${b.label} | ${gname} | ${(tot / rs.length).toFixed(3)} | ${pct(rs.filter((r) => per(r) > 0).length, rs.length)} | ${(tot / totalMin).toFixed(2)} | ${pct(gain, gainAll)} | ${caught} |`);
    }
  }
  L.push("", "## 6. \uBAA9\uD45C \uB300\uBE44", "");
  L.push("| \uD56D\uBAA9 | \uBAA9\uD45C | \uC9C1\uC9C4 | \uC704\uC7A5 \uC0AC\uC6A9 | \uB290\uB9B0 \uCD08\uBCF4 | \uD310\uC815 |");
  L.push("|---|---|---|---|---|---|");
  const m = (name) => all2[name];
  const sr = (name) => m(name).filter((r) => r.outcome === "escaped").length / m(name).length;
  const cr = (name) => m(name).filter((r) => r.outcome === "caught").length / m(name).length;
  const len = (name) => mean(m(name).map((r) => r.time));
  const unf = (name) => m(name).reduce((a, r) => a + r.untoldOnsets, 0);
  const inR = (v, lo, hi) => v >= lo && v <= hi;
  L.push(`| 1\uD310 \uAE38\uC774 \uD3C9\uADE0 | 60~90\uCD08 | ${f1(len("straight"))} | ${f1(len("disguise"))} | ${f1(len("novice"))} | ${["straight", "disguise", "novice"].every((n) => inR(len(n), 60, 90)) ? "\uCDA9\uC871" : "\uBBF8\uB2EC(\uB108\uBB34 \uC9E7\uC74C)"} |`);
  L.push(`| \uC131\uACF5\uB960(\uAE30\uC900 \uBD07=\uB290\uB9B0 \uCD08\uBCF4\uB97C \uCE90\uC8FC\uC5BC \uB300\uC6A9) | 70~80% | ${pct(sr("straight") * 1e3, 1e3)} | ${pct(sr("disguise") * 1e3, 1e3)} | ${pct(sr("novice") * 1e3, 1e3)} | ${inR(sr("novice"), 0.7, 0.8) ? "\uCDA9\uC871" : "\uC774\uD0C8"} |`);
  L.push(`| \uC801\uBC1C\uB960 | \u2264 10% | ${pct(cr("straight") * 1e3, 1e3)} | ${pct(cr("disguise") * 1e3, 1e3)} | ${pct(cr("novice") * 1e3, 1e3)} | ${cr("novice") <= 0.1 ? "\uCDA9\uC871" : "\uC774\uD0C8"} |`);
  L.push(`| \uC704\uC7A5 \uC5C6\uC774 \uC774\uAE30\uAE30 \uC5B4\uB824\uC6C0(D-040 \uCDE8\uC9C0) | \uC9C1\uC9C4 \uC131\uACF5\uB960 \u226A \uC704\uC7A5 \uC131\uACF5\uB960 | ${pct(sr("straight") * 1e3, 1e3)} | ${pct(sr("disguise") * 1e3, 1e3)} | - | ${sr("straight") < sr("disguise") - 0.2 ? "\uCDA9\uC871" : "\uBBF8\uB2EC(\uC704\uC7A5 \uD544\uC694\uC131 \uC57D\uD568)"} |`);
  L.push(`| \uC804\uC870 \uC5C6\uB294 \uC2DC\uC120 | 0\uAC74 | ${unf("straight")} | ${unf("disguise")} | ${unf("novice")} | ${["straight", "disguise", "novice"].every((n) => unf(n) === 0) ? "\uCDA9\uC871" : "\uC704\uBC18"} |`);
  L.push("");
  return L.join("\n");
}
var seeds = Number(process.argv[2] ?? 1e3);
var t0 = Date.now();
var all = {};
for (const b of BOTS) {
  all[b.name] = runBatch(PROTO_FLOOR, b, seeds);
  console.log(`${b.name}: ${seeds}\uD310 \uC644\uB8CC (${((Date.now() - t0) / 1e3).toFixed(1)}s)`);
}
var S = PROTO_FLOOR.rules.suspicion;
var STRESS = {
  level: PROTO_FLOOR.level,
  rules: { ...PROTO_FLOOR.rules, suspicion: { ...S, movingPerSec: S.movingPerSec * 3, idlePerSec: S.idlePerSec * 3, disguisedPerSec: S.disguisedPerSec * 3, talkedPerSec: S.talkedPerSec * 3 } }
};
var stress = {};
for (const b of BOTS) stress[b.name] = runBatch(STRESS, b, seeds, "stress");
var md = report(all, seeds) + "\n\n---\n\n" + report(stress, seeds, "# \uBD80\uB85D: \uC2A4\uD2B8\uB808\uC2A4 \uBCC0\uD615 (QA \uAC00\uC815 \u2014 \uC758\uC2EC \uC0C1\uC2B9\uB960 \xD73, \uB808\uBCA8\xB7NPC \uB3D9\uC77C, \uC2DC\uB4DC stress-*)").replace(/- 레벨:[^\n]*\n/, "- \uBAA9\uC801: \uC2E4\uC81C \uBC38\uB7F0\uC2A4 \uBAA9\uD45C\uC5D0 \uAC00\uAE4C\uC6B4 \uB09C\uC774\uB3C4\uC5D0\uC11C \uC804\uC870 \uC5C6\uB294 \uC2DC\uC120(\uBAA8\uD241\uC774 \uC804\uD658\xB7\uB9D0\uAC78\uAE30)\uC774 \uB4E4\uD0B4\uC5D0 \uAE30\uC5EC\uD558\uB294 \uC815\uB3C4 \uCD94\uC815. \uC81C\uD488 \uC218\uCE58 \uC81C\uC548\uC774 \uC544\uB2D8\n");
var fs = await import("node:fs");
var path = await import("node:path");
var root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
fs.mkdirSync(path.join(root, "qa"), { recursive: true });
fs.writeFileSync(path.join(root, "qa", "t124-balance.md"), md + "\n");
fs.writeFileSync(path.join(root, "game", "tests", ".out", "t124-balance.json"), JSON.stringify({ base: all, stress }));
console.log(md);
export {
  BOTS,
  report,
  runBatch,
  runOne
};
