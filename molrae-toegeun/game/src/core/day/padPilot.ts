/**
 * T-170 헤드리스 '경로 → 패드 입력' 어댑터(QA 봇·스모크용). 렌더링 무관.
 * 옛 봇이 쓰던 목적지 이동(FloorSim.moveTo·tapMission)을 사람과 같은 입력(DaySim.setPad)으로 바꿔 준다.
 * 매 스텝 sim.step() 직전에 drive()를 부르면, 지금 칸에서 목표까지 최단 경로(동적 차단 반영)의 다음 칸 방향을 누른다.
 * 목표 칸에 들어서면 손을 떼어(정지 = 위장) 칸 중심에 붙는다. pause()는 목표를 기억한 채 손을 뗀다(위협이 보일 때 멈추기).
 * 사람다운 노이즈(꺾기 지연·넘어가기·범프)는 QA PadDriver(control-dpad §7-5) 몫이고, 여기서는 넣지 않는다(결정적).
 */
import type { Tile } from '../grid';
import type { Dir } from '../vision';
import type { DaySim } from './daySim';

export function dirBetween(a: Tile, b: Tile): Dir | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  return dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
}

export class PadPilot {
  goal: Tile | null = null;
  paused = false;
  /** 이번 목표로 누른 스텝 수(진단용) */
  steps = 0;

  constructor(private readonly sim: DaySim) {}

  /** 목표 지정(같은 목표면 그대로). 일시정지도 풂 */
  goTo(goal: Tile): void {
    if (!this.goal || this.goal.x !== goal.x || this.goal.y !== goal.y) { this.goal = goal; this.steps = 0; }
    this.paused = false;
  }

  /** 목표를 버리고 손 뗌 */
  stop(): void { this.goal = null; this.paused = false; this.sim.setPad(null); }

  /** 목표를 기억한 채 손 뗌(정지 = 위장) */
  pause(): void { this.paused = true; this.sim.setPad(null); }

  resume(): void { this.paused = false; }

  /** 목표 칸 중심에 멈춰 섰는가 */
  get arrived(): boolean {
    const p = this.sim.floor.player, g = this.goal;
    return !!g && p.tile.x === g.x && p.tile.y === g.y && p.stoppedAtCenter;
  }

  /** 걷는 중(목표가 있고 멈춰 있지 않음) */
  get busy(): boolean { return !!this.goal && !this.paused && !this.arrived; }

  /** 매 스텝 sim.step() 직전에 호출 */
  drive(): void {
    const g = this.goal;
    if (!g || this.paused) return;
    const f = this.sim.floor, p = f.player;
    if (p.onPath) return; // 자동 연출(사용 칸 1칸 보정·게이트 → 엘리베이터)
    const here = p.tile;
    if (here.x === g.x && here.y === g.y) { this.sim.setPad(null); return; }
    if (p.mode === 'talked') return; // 누른 채로 두면 말걸기 뒤 heldResumeAfterTalkSec에 출발
    const path = f.pathTo(g);
    const next = path && path.length > 0 ? path[0]! : null;
    const d = next ? dirBetween(here, next) : null;
    this.sim.setPad(d);
    this.steps++;
  }
}
