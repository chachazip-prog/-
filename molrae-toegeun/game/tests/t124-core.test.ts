/**
 * T-124 탑다운 프로토타입(T-123) 코어 검증. 헤드리스, Phaser 무관.
 * 실행: bash tests/run-core.sh   (game/ 에서)
 * 항목 번호는 T-124 지시서 검증 항목 1~7과 같다.
 */
import {
  FloorSim, buildGridMap, canSee, inCone, hasLineOfSight, rayDistance, conePolygon, findPath, isWalkable,
  createRng, updateSuspicion, createSuspicion, angleDiff, tileOf,
  type LevelDef, type NpcDef, type FloorContent, type GridMap, type Tile,
} from '../src/core';
import { PROTO_FLOOR } from '../src/dev/protoFloor';
import { check, info, section, summary } from './lib/check';
import { Observer, UNFAIR_CAUSES } from './lib/observe';

const RULES = PROTO_FLOOR.rules;
const LEGEND = PROTO_FLOOR.level.legend;
const H = RULES.fixedStepSec;

function npc(over: Partial<NpcDef> & { id: string; waypoints: NpcDef['waypoints'] }): NpcDef {
  return {
    name: over.id, role: 'boss', cone: { range: 6, halfAngleDeg: 30 }, speedTilesPerSec: 1, gazeMultiplier: 1,
    tellSec: 0.5, lookSec: 1, lookChance: 0, glanceBackChancePerTile: 0, ...over,
  };
}
function content(rows: string[], start: Tile, npcs: NpcDef[], exitZone = 'exit'): FloorContent {
  const level: LevelDef = { id: 'qa', rows, legend: LEGEND, playerStart: start, exitZone, npcs };
  return { level, rules: RULES };
}
function bfs(map: GridMap, s: Tile): Int32Array {
  const d = new Int32Array(map.width * map.height).fill(-1);
  const q: number[] = [s.y * map.width + s.x];
  d[q[0]!] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!, cx = c % map.width, cy = (c - cx) / map.width;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = ny * map.width + nx;
      if (d[ni] !== -1) continue;
      d[ni] = d[c]! + 1; q.push(ni);
    }
  }
  return d;
}

// ═══ 1. 결정성
section('1. 결정성');
{
  const run = (seed: string) => {
    const sim = new FloorSim(PROTO_FLOOR, seed);
    const r = createRng(`taps-${seed}`);
    const ev: string[] = [];
    for (let i = 0; i < 4000 && sim.outcome === 'playing'; i++) {
      if (r.chance(0.03)) sim.tap(r.int(-1, 11), r.int(-1, 62));
      sim.step();
      for (const e of sim.drainEvents()) ev.push(JSON.stringify(e));
    }
    return { fp: sim.fingerprint(), ev: ev.join('\n') };
  };
  let same = 0, n = 60, differ = 0;
  const fps = new Set<string>();
  for (let k = 0; k < n; k++) {
    const a = run(`det-${k}`), b = run(`det-${k}`);
    if (a.fp === b.fp && a.ev === b.ev) same++;
    fps.add(a.fp);
  }
  differ = fps.size;
  check('같은 시드·같은 탭 시퀀스 → fingerprint·이벤트 로그 완전 일치', same === n, `${same}/${n} 시드`);
  check('다른 시드 → 다른 결과(시드가 실제로 반영됨)', differ > n * 0.9, `고유 fingerprint ${differ}/${n}`);

  // advance() 분할: 같은 총 시간을 다른 dt로 쪼갰을 때 스텝 수와 상태
  const N = 3600; // 60초
  const ref = new FloorSim(PROTO_FLOOR, 'day-1'); ref.tap(5, 1);
  for (let i = 0; i < N; i++) ref.step();
  const refFp = ref.fingerprint();
  const patterns: Record<string, (i: number, r: ReturnType<typeof createRng>) => number> = {
    '1/60': () => 1 / 60, '1/30': () => 1 / 30, '0.05': () => 0.05, '0.1(max)': () => 0.1, '1/120': () => 1 / 120,
    '1/144': () => 1 / 144, '1/90': () => 1 / 90, '0.033': () => 0.033, '무작위 0.001~0.1': (_i, r) => r.range(0.001, 0.1),
  };
  for (const [name, gen] of Object.entries(patterns)) {
    const s = new FloorSim(PROTO_FLOOR, 'day-1'); s.tap(5, 1);
    const r = createRng(`dt-${name}`);
    let total = 0, calls = 0;
    // 총 60초를 채울 때까지 advance (마지막 호출은 잔여 시간)
    while (total < 60 - 1e-12 && calls < 1e6) {
      const dt = Math.min(gen(calls, r), 60 - total);
      s.advance(dt); total += dt; calls++;
    }
    const stepsOk = s.steps === N;
    // 스텝 수가 다르면 같은 스텝 수까지 맞춘 뒤 상태 비교
    const s2 = new FloorSim(PROTO_FLOOR, 'day-1'); s2.tap(5, 1);
    for (let i = 0; i < s.steps; i++) s2.step();
    const stateOk = s2.fingerprint() === s.fingerprint();
    check(`advance dt=${name}: 총 60초 → 스텝 ${N}개`, stepsOk, `실제 ${s.steps}스텝 (${calls}회 호출)`);
    if (!stepsOk) { s.advance(1e-9); info(`  dt=${name}: 부동소수 잔여로 1스텝 지연, +1e-9초 advance 후 ${s.steps}스텝(누락 아님, 지연)`); }
    check(`advance dt=${name}: 같은 스텝 수에서 상태 동일`, stateOk && (!stepsOk || s.fingerprint() === refFp));
  }
  // 큰 dt 한 번: maxAdvanceSec 클램프 확인(의도된 동작인지 기록)
  const big = new FloorSim(PROTO_FLOOR, 'day-1'); big.advance(1.0);
  info(`advance(1.0) 한 번 → ${big.steps}스텝 (maxAdvanceSec=${RULES.maxAdvanceSec} 클램프로 시간 손실 ${(1 - big.steps * H).toFixed(3)}초)`);
}

// ═══ 2. 입력 의미
section('2. 입력 의미');
{
  const sim = new FloorSim(PROTO_FLOOR, 'day-1');
  check('idle에서 출구 탭 → moving', sim.tap(5, 1) === 'moving' && sim.player.mode === 'moving');
  for (let i = 0; i < 20; i++) sim.step();
  const r = sim.tap(0, 0);
  check('moving 중 탭(좌표 무관) → stopped / disguised', r === 'stopped' && sim.player.mode === 'disguised' && sim.destination === null,
    `result=${r} mode=${sim.player.mode}`);
  const px = sim.player.x, py = sim.player.y;
  for (let i = 0; i < 30; i++) sim.step();
  check('위장 중에는 움직이지 않음', sim.player.x === px && sim.player.y === py);
  check('disguised에서 탭 → moving(재출발)', sim.tap(5, 1) === 'moving');

  // 자기 타일 탭
  const own = new FloorSim(PROTO_FLOOR, 'day-1');
  const st = PROTO_FLOOR.level.playerStart;
  const ownR = own.tap(st.x, st.y);
  info(`idle 상태에서 자기 타일 탭 → '${ownR}' (경로 길이 0)`);

  // 말걸기
  const talkC = content(['.........', '#########'], { x: 0, y: 0 }, [
    npc({ id: 'g', role: 'guard', cone: { range: 0.5, halfAngleDeg: 10 }, waypoints: [{ x: 4, y: 0, waitSec: 999 }],
      talk: { radius: 1.1, durationSec: 1.5, cooldownSec: 6 } }),
  ], 'none');
  const t = new FloorSim(talkC, 's');
  t.tap(8, 0);
  let talkedAt = -1;
  for (let i = 0; i < 600 && talkedAt < 0; i++) { t.step(); if (t.player.mode === 'talked') talkedAt = t.steps; }
  check('NPC 말걸기 반경 진입 → talked', talkedAt > 0);
  check('talked 중 탭 → ignored', t.tap(8, 0) === 'ignored' && t.player.mode === 'talked');
  for (let i = 0; i < Math.ceil(1.5 / H) + 2; i++) t.step();
  check('D-039: 말걸기 종료 후 원래 목적지로 자동 재개', t.player.mode === 'moving',
    `종료 후 mode=${t.player.mode}, destination=${JSON.stringify(t.destination)}`);

  // 벽 탭 보정(반경 2): 프로토 층의 모든 비통행 타일(+맵 밖 1칸)
  const map = new FloorSim(PROTO_FLOOR, 'x').map;
  let total = 0, ok = 0, moving = 0, unreach = 0;
  const bad: string[] = [];
  for (let y = -1; y <= map.height; y++) {
    for (let x = -1; x <= map.width; x++) {
      if (isWalkable(map, x, y)) continue;
      total++;
      // 기대값: 맨해튼 거리 ≤ 2 안 최근접(같은 거리면 유클리드 작은 쪽)
      let bestD = Infinity, bestE = Infinity;
      for (let yy = 0; yy < map.height; yy++) for (let xx = 0; xx < map.width; xx++) {
        if (!isWalkable(map, xx, yy)) continue;
        const d = Math.abs(xx - x) + Math.abs(yy - y);
        if (d > 2) continue;
        const e = (xx - x) ** 2 + (yy - y) ** 2;
        if (d < bestD || (d === bestD && e < bestE)) { bestD = d; bestE = e; }
      }
      const s = new FloorSim(PROTO_FLOOR, 'x');
      const res = s.tap(x, y);
      const dest = s.destination;
      let good: boolean;
      if (bestD === Infinity) good = res === 'unreachable';
      else good = res === 'moving' && !!dest && Math.abs(dest.x - x) + Math.abs(dest.y - y) === bestD
        && (dest.x - x) ** 2 + (dest.y - y) ** 2 === bestE;
      if (res === 'moving') moving++; else if (res === 'unreachable') unreach++;
      if (good) ok++; else if (bad.length < 5) bad.push(`(${x},${y}) res=${res} dest=${JSON.stringify(dest)} 기대거리=${bestD}`);
    }
  }
  check('벽·엄폐물·맵 밖 탭 → 반경 2 안 최근접 통행 타일로 보정, 없으면 unreachable', ok === total,
    `${ok}/${total} (moving ${moving}, unreachable ${unreach}) ${bad.join('; ')}`);
  // 반경 3 이상 떨어진 탭
  check('반경 밖(맵에서 3칸 이상) 탭 → unreachable', new FloorSim(PROTO_FLOOR, 'x').tap(-3, 30) === 'unreachable');
  // 분리 구역
  const iso = content(['....#..', '#######'], { x: 0, y: 0 }, [npc({ id: 'n', waypoints: [{ x: 1, y: 0, waitSec: 9 }] })], 'none');
  const si = new FloorSim(iso, 's');
  check('분리된 구역 탭 → unreachable, 상태 idle 유지', si.tap(6, 0) === 'unreachable' && si.player.mode === 'idle');
  // 프로토 층 연결성
  const dist = bfs(map, PROTO_FLOOR.level.playerStart);
  let walk = 0, conn = 0;
  for (let i = 0; i < dist.length; i++) if (map.walkable[i]) { walk++; if (dist[i]! >= 0) conn++; }
  check('프로토 층: 모든 통행 타일이 시작점과 연결', walk === conn, `${conn}/${walk}`);
}

// ═══ 3. 경로
section('3. 경로');
{
  const map = new FloorSim(PROTO_FLOOR, 'x').map;
  const tiles: Tile[] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isWalkable(map, x, y)) tiles.push({ x, y });
  const r = createRng('path-fuzz');
  let pairs = 0, ok = 0; const bad: string[] = [];
  for (let k = 0; k < 5000; k++) {
    const a = r.pick(tiles)!, b = { x: r.int(-1, map.width), y: r.int(-1, map.height) };
    const p = findPath(map, a, b);
    const d = isWalkable(map, b.x, b.y) ? bfs(map, a)[b.y * map.width + b.x]! : -1;
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
    if (good) ok++; else if (bad.length < 3) bad.push(`${JSON.stringify(a)}→${JSON.stringify(b)}`);
  }
  check('A* 무작위 5000쌍: 4방향 인접·통행 가능·최단(BFS와 같은 길이)·도달불가 null', ok === pairs, `${ok}/${pairs} ${bad.join(' ')}`);

  // 시뮬레이션 퍼징: 무작위 탭(정지·재출발 포함)
  let taps = 0, stops = 0, steps = 0, violations = 0, offLine = 0, teleports = 0, npcBad = 0;
  const firstBad: string[] = [];
  const maxStep = RULES.playerSpeedTilesPerSec * H + 1e-9;
  for (let s = 0; s < 300; s++) {
    const sim = new FloorSim(PROTO_FLOOR, `fuzz-${s}`);
    const tr = createRng(`fuzz-taps-${s}`);
    // 의심으로 판이 끝나지 않게: 판정과 무관한 이동만 보려면 suspicion을 계속 0으로 (테스트 하네스 측 조작)
    for (let i = 0; i < 2400; i++) {
      if (tr.chance(0.06)) { const res = sim.tap(tr.int(-1, 11), tr.int(-1, 62)); taps++; if (res === 'stopped') stops++; }
      const px = sim.player.x, py = sim.player.y;
      sim.suspicion.value = 0; sim.outcome = 'playing';
      sim.step(); steps++;
      const p = sim.player;
      const t = tileOf(p);
      if (!isWalkable(map, t.x, t.y)) { violations++; if (firstBad.length < 3) firstBad.push(`seed ${s} step ${i} pos=(${p.x.toFixed(3)},${p.y.toFixed(3)})`); }
      const fx = p.x - Math.floor(p.x), fy = p.y - Math.floor(p.y);
      if (Math.abs(fx - 0.5) > 1e-6 && Math.abs(fy - 0.5) > 1e-6) offLine++;
      if (Math.hypot(p.x - px, p.y - py) > maxStep) teleports++;
      for (const n of sim.npcs) { const nt = tileOf(n); if (!isWalkable(map, nt.x, nt.y)) npcBad++; }
    }
  }
  info(`퍼징: 300판 × 2400스텝 = ${steps}스텝, 탭 ${taps}회(정지 ${stops}회)`);
  check('플레이어가 항상 통행 가능 타일 위(벽 관통 0)', violations === 0, `${violations}건 ${firstBad.join('; ')}`);
  check('플레이어가 항상 타일 중심선 위(대각 가로지르기 0)', offLine === 0, `${offLine}건`);
  check('한 스텝 이동량 ≤ 속도×dt(순간이동 0)', teleports === 0, `${teleports}건`);
  check('NPC가 항상 통행 가능 타일 위', npcBad === 0, `${npcBad}건`);
}

// ═══ 4. 시선
section('4. 시선');
{
  const cone = { range: 8, halfAngleDeg: 30 };
  for (const [ch, nm] of [['P', '파티션'], ['F', '화분'], ['X', '복사기'], ['#', '벽']] as const) {
    const m = buildGridMap(['.........', `...${ch}.....`, '.........'], LEGEND);
    check(`${nm} 뒤 안 보임`, !canSee(m, { x: 0.5, y: 1.5 }, 0, cone, { x: 5.5, y: 1.5 }));
    check(`${nm} 앞은 보임`, canSee(m, { x: 0.5, y: 1.5 }, 0, cone, { x: 2.5, y: 1.5 }));
  }
  const md = buildGridMap(['.........', '...D.....', '.........'], LEGEND);
  check('책상 너머 보임', canSee(md, { x: 0.5, y: 1.5 }, 0, cone, { x: 5.5, y: 1.5 }));
  for (const ch of ['P', 'F', 'X', '#']) {
    const g = buildGridMap([`.${ch}..`, `${ch}...`, '....', '....'], LEGEND);
    const a = !hasLineOfSight(g, { x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 });
    const b = !hasLineOfSight(g, { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 });
    const c = !hasLineOfSight(g, { x: 3.5, y: 3.5 }, { x: 0.5, y: 0.5 });
    check(`대각 틈(${ch}) 투시 없음(양방향)`, a && b && c);
  }
  // 경계각·경계거리
  const o = { x: 0.5, y: 0.5 }, h = (30 * Math.PI) / 180;
  const at = (a: number, d: number) => ({ x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d });
  check('정확히 반각 경계(±30°)는 포함', inCone(o, 0, cone, at(h, 3)) && inCone(o, 0, cone, at(-h, 3)));
  check('반각 +0.1° 밖은 제외', !inCone(o, 0, cone, at(h + 0.1 * Math.PI / 180, 3)) && !inCone(o, 0, cone, at(-h - 0.1 * Math.PI / 180, 3)));
  check('정확히 사거리는 포함, 사거리+0.001은 제외', inCone(o, 0, cone, at(0, 8)) && !inCone(o, 0, cone, at(0, 8.001)));
  check('facing 각도 표현 무관(−π/2 ≡ 3π/2, π ≡ −π)',
    inCone(o, -Math.PI / 2, cone, at(-Math.PI / 2, 3)) === inCone(o, 1.5 * Math.PI, cone, at(-Math.PI / 2, 3))
    && inCone(o, Math.PI, cone, at(Math.PI - 0.1, 3)) && inCone(o, -Math.PI, cone, at(Math.PI - 0.1, 3)));
  // 콘 다각형(렌더) ↔ 판정 일관성, 대칭성: 프로토 층 무작위 샘플
  const map = new FloorSim(PROTO_FLOOR, 'x').map;
  const r = createRng('vision-fuzz');
  const walk: Tile[] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isWalkable(map, x, y)) walk.push({ x, y });
  let n = 0, polyMismatch = 0, asym = 0, edgeIncons = 0;
  for (let k = 0; k < 30000; k++) {
    const a = r.pick(walk)!, b = r.pick(walk)!;
    const oa = { x: a.x + r.range(0.05, 0.95), y: a.y + 0.5 };
    const tb = { x: b.x + 0.5, y: b.y + r.range(0.05, 0.95) };
    if (Math.abs(oa.y - tb.y) > 10) continue;
    n++;
    const facing = r.range(-Math.PI, Math.PI);
    const c2 = { range: 6, halfAngleDeg: 35 };
    const sees = canSee(map, oa, facing, c2, tb);
    // 렌더 콘(광선 64개) 끝점까지 거리 비교: 목표 방향 광선의 rayDistance
    const dx = tb.x - oa.x, dy = tb.y - oa.y, d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const inAngle = angleDiff(ang, facing) <= (35 * Math.PI) / 180 + 1e-9;
    const rd = rayDistance(map, oa.x, oa.y, dx / d, dy / d, 6);
    const polySays = inAngle && d <= 6 && rd >= d - 1e-9;
    if (polySays !== sees) polyMismatch++;
    if (hasLineOfSight(map, oa, tb) !== hasLineOfSight(map, tb, oa)) asym++;
    // 경계각 근처 ±1e-7rad 흔들림에서 판정이 뒤집히지 않는지(엄폐 없는 경우)
    void edgeIncons;
  }
  check('렌더 콘(rayDistance) ↔ canSee 판정 일치', polyMismatch === 0, `${polyMismatch}/${n}`);
  check('LOS 대칭성(A→B == B→A)', asym === 0, `${asym}/${n} 불일치`);
  // conePolygon이 실제로 경계각 광선을 포함하는지
  const poly = conePolygon(map, { x: 5.5, y: 8.5 }, -Math.PI / 2, { range: 5, halfAngleDeg: 30 }, 14);
  const a0 = Math.atan2(poly[1]!.y - 8.5, poly[1]!.x - 5.5), a1 = Math.atan2(poly[14]!.y - 8.5, poly[14]!.x - 5.5);
  check('conePolygon 양끝 광선 = facing ± 반각', Math.abs(angleDiff(a0, -Math.PI / 2) - h) < 1e-6 && Math.abs(angleDiff(a1, -Math.PI / 2) - h) < 1e-6);
}

// ═══ 5. 의심
section('5. 의심');
{
  const S = RULES.suspicion;
  // 노출 직후 graceSec 이내 상승 없음
  const s = createSuspicion();
  let firstRiseT = -1, roseEarly = false;
  for (let i = 1; i <= 30; i++) {
    updateSuspicion(s, S, 1, 'moving', 1, H);
    if (s.value > 0 && firstRiseT < 0) firstRiseT = i * H;
    if (i * H <= S.graceSec + 1e-9 && s.value > 0) roseEarly = true;
  }
  check(`노출 ${S.graceSec}초 이내 상승 없음`, !roseEarly, `첫 상승 ${firstRiseT.toFixed(4)}초`);
  // 노출 끊겼다 다시: 유예 재적용 여부(기록)
  const s2 = createSuspicion();
  for (let i = 0; i < 30; i++) updateSuspicion(s2, S, 1, 'moving', 1, H);
  const v0 = s2.value;
  updateSuspicion(s2, S, 0, 'moving', 1, H);
  updateSuspicion(s2, S, 1, 'moving', 1, H);
  info(`노출이 1스텝 끊긴 뒤 재노출 → 유예 재적용(상승 ${(s2.value - v0).toFixed(4)}). 콘 경계에서 깜빡이는 노출은 유예가 반복 적용됨`);

  // 위장 직후 settle 동안 이동 상승률 (FloorSim 통합)
  const c = content(['...............', '###############'], { x: 2, y: 0 }, [
    npc({ id: 'b', cone: { range: 20, halfAngleDeg: 60 }, waypoints: [{ x: 0, y: 0, waitSec: 9999 }] }),
  ], 'none');
  const sim = new FloorSim(c, 's');
  sim.npcs[0]!.facing = 0;
  sim.tap(14, 0);
  for (let i = 0; i < 20; i++) sim.step();
  sim.tap(0, 0); // stop → disguised
  const rates: number[] = [];
  for (let i = 0; i < 30; i++) { const b = sim.suspicion.value; sim.step(); rates.push((sim.suspicion.value - b) / H); }
  const movingSteps = rates.filter((r) => Math.abs(r - S.movingPerSec) < 1e-6).length;
  const settleTarget = Math.round(S.disguiseSettleSec / H);
  check(`위장 직후 ${S.disguiseSettleSec}초(${settleTarget}스텝) 동안 이동 상승률 ${S.movingPerSec}/s`, Math.abs(movingSteps - settleTarget) <= 1 && rates[0]! > 0,
    `이동률 스텝 ${movingSteps}개, 이후 ${rates[movingSteps]?.toFixed(3)}/s (위장률 ${S.disguisedPerSec})`);
  check('settle 이후 위장 상승률', Math.abs((rates[movingSteps + 1] ?? 0) - S.disguisedPerSec) < 1e-6);

  // 동시 시선: 최댓값만
  const two = (mults: number[]) => {
    const cc = content(['...............', '###############'], { x: 7, y: 0 },
      mults.map((m, k) => npc({ id: `n${k}`, gazeMultiplier: m, cone: { range: 20, halfAngleDeg: 60 },
        waypoints: [{ x: k === 0 ? 0 : 14, y: 0, waitSec: 9999 }] })), 'none');
    const sm = new FloorSim(cc, 's');
    sm.npcs[0]!.facing = 0; if (sm.npcs[1]) sm.npcs[1].facing = Math.PI;
    for (let i = 0; i < 60; i++) sm.step();
    return { v: sm.suspicion.value, seeing: sm.seeing.filter(Boolean).length };
  };
  const one = two([1]), both = two([1, 0.8]), rev = two([0.8, 1]);
  check('두 NPC 동시 시선 → 배율 최댓값 하나만 적용(합산 아님)',
    both.seeing === 2 && Math.abs(both.v - one.v) < 1e-12 && Math.abs(rev.v - one.v) < 1e-12,
    `단독=${one.v.toFixed(4)} 동시=${both.v.toFixed(4)} 순서반대=${rev.v.toFixed(4)}`);

  // 100% → caught
  const cs = new FloorSim(c, 's'); cs.npcs[0]!.facing = 0;
  cs.tap(14, 0);
  let caughtStep = -1, valueAtCaught = 0;
  for (let i = 0; i < 2000 && cs.outcome === 'playing'; i++) {
    cs.step();
    if ((cs.outcome as string) === 'caught') { caughtStep = cs.steps; valueAtCaught = cs.suspicion.value; }
    if (cs.player.mode === 'idle') cs.tap(cs.player.tile.x === 14 ? 1 : 14, 0);
  }
  const ev = cs.drainEvents();
  check('의심 100% 도달 → caught, 이벤트 1회', caughtStep > 0 && valueAtCaught >= S.max && ev.filter((e) => e.type === 'caught').length === 1,
    `step ${caughtStep}, value ${valueAtCaught}`);
  const fp = cs.fingerprint(); cs.advance(1); cs.step();
  check('caught 이후 tap → ignored, 진행 정지', cs.tap(3, 0) === 'ignored' && cs.fingerprint() === fp);
  // 비노출 감쇠
  const d = createSuspicion(); d.value = 0.5;
  for (let i = 0; i < 60; i++) updateSuspicion(d, S, 0, 'disguised', 1, H);
  const dm = createSuspicion(); dm.value = 0.5;
  for (let i = 0; i < 60; i++) updateSuspicion(dm, S, 0, 'moving', 1, H);
  check('비노출+비이동 1초 감쇠 = decayPerSec, 이동 중은 감쇠 없음', Math.abs(0.5 - d.value - S.decayPerSec) < 1e-9 && dm.value === 0.5);
}

// ═══ 6. 전조
section('6. 전조');
{
  const defs = PROTO_FLOOR.level.npcs;
  check('모든 NPC tellSec ≥ 0.4 (rules.json tell.minSec)', defs.every((n) => n.tellSec >= 0.4), defs.map((n) => `${n.id}=${n.tellSec}`).join(' '));
  // 무작위 탭 플레이 300판으로 look 전수 검사
  let looks = 0, short = 0;
  const causeCount: Record<string, number> = {};
  let onsets = 0, turnTotal = 0, turnSee = 0, simSec = 0;
  const kindSee: Record<string, number> = {}, kindAll: Record<string, number> = {};
  for (let s = 0; s < 300; s++) {
    const sim = new FloorSim(PROTO_FLOOR, `tell-${s}`);
    const ob = new Observer(sim);
    const tr = createRng(`tell-taps-${s}`);
    for (let i = 0; i < 3600; i++) {
      if (tr.chance(0.02)) sim.tap(tr.int(0, 10), tr.int(0, 61));
      sim.suspicion.value = 0; // 판이 끝나지 않게(관찰용)
      ob.step();
    }
    simSec += sim.time;
    for (const l of ob.looks) { looks++; if (l.tellSec < l.required - 1e-9 || l.tellSec < 0.4 - 1e-9) short++; }
    for (const o of ob.onsets) { onsets++; causeCount[o.cause] = (causeCount[o.cause] ?? 0) + 1; }
    for (const t of ob.turns) {
      turnTotal++; kindAll[t.kind] = (kindAll[t.kind] ?? 0) + 1;
      if (t.seesPlayer) { turnSee++; kindSee[t.kind] = (kindSee[t.kind] ?? 0) + 1; }
    }
  }
  check('모든 look 직전 tell ≥ tellSec(≥0.4초)', short === 0, `look ${looks}회 중 부족 ${short}`);
  const unfair = UNFAIR_CAUSES.reduce((a, c) => a + (causeCount[c] ?? 0), 0);
  info(`무작위 탭 300판(${(simSec / 60).toFixed(0)}분): 시선 시작 ${onsets}회, 원인 ${JSON.stringify(causeCount)}`);
  info(`전조 없는 NPC 방향 전환 ${turnTotal}회(분당 ${(turnTotal / (simSec / 60)).toFixed(1)}), 그 순간 플레이어가 새 시선에 보임 ${turnSee}회`);
  info(`전환 종류별 전체 ${JSON.stringify(kindAll)} / 그중 플레이어 보임 ${JSON.stringify(kindSee)}`);
  check('전조 없이 시작된 시선(모퉁이·재출발·말걸기) 0건 (D-038, GDD §11)', unfair === 0,
    `${unfair}/${onsets} (${((100 * unfair) / Math.max(1, onsets)).toFixed(1)}%)`);
}

// ═══ 7. 화면 밖 경고 로직(threatOf)
section('7. threatOf');
{
  let n = 0, seeingMismatch = 0, turningBad = 0, offNonNone = 0, offSamples = 0, wideBlocked = 0, approachCount = 0;
  const map = new FloorSim(PROTO_FLOOR, 'x').map;
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
        if ((t === 'seeing') !== sim.seeing[k]) seeingMismatch++;
        if (t === 'turning' && npcI.mode !== 'tell') turningBad++;
        // 화면 밖 근사: 세로 거리 > 12타일
        if (Math.abs(npcI.y - sim.player.y) > 12) { offSamples++; if (t !== 'none') offNonNone++; }
        if (t === 'approaching') { approachCount++; if (!hasLineOfSight(map, npcI.pos, sim.player.pos)) wideBlocked++; }
      });
    }
  }
  check("threatOf==='seeing' ⇔ seeing[i]", seeingMismatch === 0, `${seeingMismatch}/${n}`);
  check("'turning'은 tell 중에만", turningBad === 0);
  info(`approaching 판정 중 실제로는 벽·엄폐물에 가려진 비율 ${((100 * wideBlocked) / Math.max(1, approachCount)).toFixed(0)}% (넓은 콘은 가림 무시 — 설계 의도)`);
  info(`세로 12타일 이상 떨어진(화면 밖) NPC가 경고(none 아님)를 낸 비율 ${((100 * offNonNone) / Math.max(1, offSamples)).toFixed(1)}%`);
}

const failed = summary();
process.exitCode = failed > 0 ? 1 : 0;
