/**
 * A* 경로탐색 (4방향, 이동 비용 1, 맨해튼 휴리스틱).
 * 결정성: 우선순위 (f, h, 삽입 순번) 사전식 비교 + 고정 이웃 순서(상·우·하·좌). 같은 입력이면 항상 같은 경로.
 */
import { isWalkable, type GridMap, type Tile } from './grid';

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

class MinHeap {
  private f: number[] = [];
  private h: number[] = [];
  private seq: number[] = [];
  private idx: number[] = [];
  get size(): number { return this.idx.length; }

  private less(a: number, b: number): boolean {
    const fa = this.f[a]!, fb = this.f[b]!;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a]!, hb = this.h[b]!;
    if (ha !== hb) return ha < hb;
    return this.seq[a]! < this.seq[b]!;
  }

  private swap(a: number, b: number): void {
    for (const arr of [this.f, this.h, this.seq, this.idx]) {
      const t = arr[a]!; arr[a] = arr[b]!; arr[b] = t;
    }
  }

  push(f: number, h: number, seq: number, idx: number): void {
    this.f.push(f); this.h.push(h); this.seq.push(seq); this.idx.push(idx);
    let i = this.idx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.idx[0]!;
    const last = this.idx.length - 1;
    this.swap(0, last);
    this.f.pop(); this.h.pop(); this.seq.pop(); this.idx.pop();
    let i = 0;
    const n = this.idx.length;
    for (;;) {
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
}

/**
 * start → goal 경로. 반환 배열은 start를 제외하고 goal을 포함한다.
 * start === goal이면 빈 배열, 도달 불가(또는 goal 통행 불가)면 null.
 */
export type BlockedFn = (x: number, y: number) => boolean;

/**
 * @param blocked 추가로 막힌 타일(동적: 점유된 의자·게이트·서 있는 사람). 출발 타일에는 적용하지 않는다
 */
export function findPath(map: GridMap, start: Tile, goal: Tile, blocked?: BlockedFn): Tile[] | null {
  if (!isWalkable(map, goal.x, goal.y)) return null;
  if (blocked && blocked(goal.x, goal.y) && !(start.x === goal.x && start.y === goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];
  const w = map.width;
  const n = w * map.height;
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const startIdx = start.y * w + start.x;
  const goalIdx = goal.y * w + goal.x;
  const hOf = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  let seq = 0;
  g[startIdx] = 0;
  heap.push(hOf(start.x, start.y), hOf(start.x, start.y), seq++, startIdx);

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) break;
    const cx = cur % w, cy = (cur - cx) / w;
    const gc = g[cur]!;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!;
      if (!isWalkable(map, nx, ny)) continue;
      if (blocked && blocked(nx, ny)) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = gc + 1;
      if (ng < g[ni]!) {
        g[ni] = ng;
        from[ni] = cur;
        const h = hOf(nx, ny);
        heap.push(ng + h, h, seq++, ni);
      }
    }
  }

  if (from[goalIdx] === -1) return null;
  const out: Tile[] = [];
  for (let i = goalIdx; i !== startIdx; i = from[i]!) {
    const x = i % w;
    out.push({ x, y: (i - x) / w });
  }
  out.reverse();
  return out;
}

/**
 * from 타일에서 모든 타일까지의 4방향 통행 거리(BFS). 도달 불가 = -1.
 * 화면 밖 경고의 '경로 거리' 조건(rules.threat.approachPathTilesWithin, X6)용.
 */
export function distanceField(map: GridMap, from: Tile, blocked?: BlockedFn): Int32Array {
  const w = map.width, n = w * map.height;
  const dist = new Int32Array(n).fill(-1);
  if (!isWalkable(map, from.x, from.y)) return dist;
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  const s = from.y * w + from.x;
  dist[s] = 0; q[tail++] = s;
  while (head < tail) {
    const cur = q[head++]!;
    const cx = cur % w, cy = (cur - cx) / w;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!;
      if (!isWalkable(map, nx, ny) || (blocked && blocked(nx, ny))) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[cur]! + 1;
      q[tail++] = ni;
    }
  }
  return dist;
}
