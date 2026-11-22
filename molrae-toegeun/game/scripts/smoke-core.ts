/**
 * core 스모크 스크립트 (개발자용, QA 정식 테스트 아님). `npm run smoke`
 * 경로탐색·시선 판정·결정성·헤드리스 한 판을 확인한다. 실패 시 예외로 종료 코드 1.
 */
import {
  FloorSim, buildGridMap, canSee, conePolygon, findPath, hasLineOfSight,
  type LegendEntry,
} from '../src/core';
import { PROTO_FLOOR } from '../src/dev/protoFloor';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const legend: Record<string, LegendEntry> = {
  '#': { kind: 'wall', walkable: false, blocksSight: true },
  '.': { kind: 'floor', walkable: true, blocksSight: false },
  D: { kind: 'desk', walkable: false, blocksSight: false },
  P: { kind: 'partition', walkable: false, blocksSight: true },
};

// ── 1. 경로탐색
{
  const m = buildGridMap([
    '#######',
    '#.....#',
    '#.###.#',
    '#.#...#',
    '#.#.###',
    '#.....#',
    '#######',
  ], legend);
  const p = findPath(m, { x: 1, y: 1 }, { x: 3, y: 3 });
  check('A* 도달 경로 존재', !!p, p ? `길이 ${p.length}` : 'null');
  check('A* 최단 길이(8)', p?.length === 8);
  let adj = true;
  let prev = { x: 1, y: 1 };
  for (const t of p ?? []) {
    if (Math.abs(t.x - prev.x) + Math.abs(t.y - prev.y) !== 1) adj = false;
    if (m.walkable[t.y * m.width + t.x] !== 1) adj = false;
    prev = t;
  }
  check('A* 4방향 인접·통행 가능 타일만', adj);
  check('A* 벽 목적지 → null', findPath(m, { x: 1, y: 1 }, { x: 2, y: 2 }) === null);
  const m2 = buildGridMap(['#####', '#.#.#', '#####'], legend);
  check('A* 분리 구역 → null', findPath(m2, { x: 1, y: 1 }, { x: 3, y: 1 }) === null);
  const a = JSON.stringify(findPath(m, { x: 1, y: 1 }, { x: 5, y: 5 }));
  const b = JSON.stringify(findPath(m, { x: 1, y: 1 }, { x: 5, y: 5 }));
  check('A* 결정성(같은 입력 같은 경로)', a === b);
  const open = buildGridMap(['.....', '.....', '.....', '.....', '.....'], legend);
  const r1 = JSON.stringify(findPath(open, { x: 0, y: 0 }, { x: 4, y: 4 }));
  check('A* 열린 공간 동률 타이브레이크 고정', r1 === JSON.stringify(findPath(open, { x: 0, y: 0 }, { x: 4, y: 4 })), r1);
}

// ── 2. 시선 판정
{
  const m = buildGridMap([
    '.........',
    '.........',
    '....P....',
    '.........',
    '....D....',
    '.........',
  ], legend);
  const o = { x: 0.5, y: 2.5 };
  const cone = { range: 6, halfAngleDeg: 30 };
  check('정면·사거리 안 → 보임', canSee(m, o, 0, cone, { x: 3.5, y: 2.5 }));
  check('사거리 밖 → 안 보임', !canSee(m, o, 0, cone, { x: 7.5, y: 2.5 }));
  check('각도 밖(뒤) → 안 보임', !canSee(m, o, Math.PI, cone, { x: 3.5, y: 2.5 }));
  check('각도 밖(측면 60°) → 안 보임', !canSee(m, o, 0, cone, { x: 1.5, y: 4.5 }));
  check('파티션 뒤 → 가림', !canSee(m, o, 0, cone, { x: 5.5, y: 2.5 }));
  check('책상 너머 → 보임(시야 통과)', hasLineOfSight(m, { x: 4.5, y: 3.5 }, { x: 4.5, y: 5.5 }));
  check('파티션 너머 LOS 차단', !hasLineOfSight(m, { x: 4.5, y: 1.5 }, { x: 4.5, y: 3.5 }));
  const diag = buildGridMap(['.P.', 'P..', '...'], legend);
  check('대각 틈(양옆 막힘) 투시 금지', !hasLineOfSight(diag, { x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 }));
  check('대각 틈 정확 모서리 통과 차단(먼 목표)', !hasLineOfSight(diag, { x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }));
  check('열린 대각선은 보임', hasLineOfSight(diag, { x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 }));
  const poly = conePolygon(m, o, 0, cone, 9);
  const mid = poly[5]!; // 정면 광선
  check('콘 다각형 정면 광선이 파티션에서 잘림', mid.x < 4.01 && mid.x > 3.99, `x=${mid.x.toFixed(3)}`);
}

// ── 3. 결정성 + 헤드리스 한 판 (프로토 층)
function runBot(seed: string, maxSec: number): { fp: string; trace: string[]; sim: FloorSim } {
  const sim = new FloorSim(PROTO_FLOOR, seed);
  const trace: string[] = [];
  const exit = { x: 5, y: 1 };
  sim.tap(exit.x, exit.y);
  const steps = Math.round(maxSec / sim.rules.fixedStepSec);
  for (let i = 0; i < steps && sim.outcome === 'playing'; i++) {
    // 단순 봇: 누가 보고 있거나 돌아보기 직전이면 멈춰 위장, 아무 위협 없으면 출구로 재출발
    const threatened = sim.npcs.some((_, k) => {
      const t = sim.threatOf(k);
      return t === 'seeing' || t === 'turning';
    });
    if (threatened && sim.player.mode === 'moving') sim.tap(exit.x, exit.y);
    else if (!threatened && (sim.player.mode === 'idle' || sim.player.mode === 'disguised')) sim.tap(exit.x, exit.y);
    sim.step();
    if (i % 60 === 0) trace.push(sim.fingerprint());
  }
  return { fp: sim.fingerprint(), trace, sim };
}
{
  const a = runBot('day-1', 120);
  const b = runBot('day-1', 120);
  check('결정성: 같은 시드 → 같은 궤적', a.trace.join('\n') === b.trace.join('\n') && a.fp === b.fp);
  const c = runBot('day-2', 120);
  check('시드 변화 → 궤적 변화', c.trace.join('\n') !== a.trace.join('\n'));
  // advance(가변 dt)도 고정 스텝으로 쪼개지는지
  const s1 = new FloorSim(PROTO_FLOOR, 'day-1');
  const s2 = new FloorSim(PROTO_FLOOR, 'day-1');
  s1.tap(5, 1); s2.tap(5, 1);
  for (let i = 0; i < 300; i++) s1.advance(1 / 60 + 1e-7);
  for (let i = 0; i < 100; i++) s2.advance(3 / 60 + 1e-7);
  check('가변 프레임 dt → 같은 결과(고정 스텝)', s1.fingerprint() === s2.fingerprint(), s1.fingerprint().slice(0, 40));

  for (const seed of ['day-1', 'day-2', 'day-3', 'day-4', 'day-5']) {
    const r = runBot(seed, 180);
    const ev = r.sim.drainEvents();
    const count = (t: string) => ev.filter((e) => e.type === t).length;
    console.log(`  봇[${seed}] 결과=${r.sim.outcome} 시간=${r.sim.time.toFixed(1)}s 최고의심=${(r.sim.suspicion.peak * 100).toFixed(0)}% `
      + `전조=${count('tell')} 발각순간=${count('spotted')} 말걸기=${count('talk')}`);
  }
  // 직진 봇(위장 안 함) — 이동 중 노출 급상승 확인
  const naive = new FloorSim(PROTO_FLOOR, 'day-1');
  naive.tap(5, 1);
  for (let i = 0; i < 60 * 180 && naive.outcome === 'playing'; i++) {
    if (naive.player.mode !== 'moving' && naive.player.mode !== 'talked') naive.tap(5, 1);
    naive.step();
  }
  console.log(`  직진 봇[day-1] 결과=${naive.outcome} 시간=${naive.time.toFixed(1)}s 최고의심=${(naive.suspicion.peak * 100).toFixed(0)}%`);
}

// ── 4. 의심 규칙: 이동 중 노출 > 위장 중 노출
{
  const mk = () => new FloorSim({
    level: {
      id: 't', rows: ['.........'], legend, playerStart: { x: 3, y: 0 }, exitZone: 'none',
      npcs: [{
        id: 'n', name: 'n', role: 'boss', cone: { range: 8, halfAngleDeg: 40 }, speedTilesPerSec: 1, gazeMultiplier: 1,
        tellSec: 0.5, lookSec: 1, lookChance: 0, glanceBackChancePerTile: 0, waypoints: [{ x: 0, y: 0, waitSec: 999 }],
      }],
    },
    rules: PROTO_FLOOR.rules,
  }, 's');
  const moving = mk(); moving.tap(8, 0);
  const disg = mk(); disg.tap(8, 0); disg.step(); disg.tap(0, 0); // 곧바로 정지·위장
  for (let i = 0; i < 60; i++) { moving.step(); disg.step(); }
  check('이동 중 노출 상승 > 위장 중 노출 상승',
    moving.suspicion.value > disg.suspicion.value * 3,
    `moving=${moving.suspicion.value.toFixed(3)} disguised=${disg.suspicion.value.toFixed(3)} mode=${disg.player.mode}`);
}

console.log(failures === 0 ? '\n스모크 통과' : `\n스모크 실패 ${failures}건`);
if (failures > 0) throw new Error(`smoke failed: ${failures}`);
