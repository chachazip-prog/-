/**
 * QA 관찰기 (T-124). FloorSim을 한 스텝씩 감싸서
 *  - 시선 시작(onset)마다 원인을 분류하고
 *  - NPC의 '전조 없는 방향 전환'을 기록하고
 *  - look 진입마다 직전 tell 길이를 기록한다.
 * 제품 코드(src/)는 읽기만 한다.
 */
import { FloorSim, canSee, angleDiff, type NpcMode } from '../../src/core';

/** 시선 시작 원인
 *  - tellLook: 전조(tell) → look으로 돌아본 순간 (공정)
 *  - playerEnter: NPC는 그대로, 플레이어가 콘 안으로 들어감 (플레이어 책임)
 *  - npcAdvance: NPC가 방향 그대로 전진하며 콘이 플레이어에 닿음 (화면 밖 경고 대상)
 *  - turnCorner: 걷는 중 모퉁이(경로 노드)에서 전조 없이 방향 전환 (D-038 대상)
 *  - turnResume: wait/look 후 다시 걷기 시작하며 전조 없이 방향 전환 (D-038 대상)
 *  - turnTalkEnd: 말걸기 종료 후 원래 방향으로 즉시 복귀 (전조 없음)
 *  - talkStart: 말걸기 시작 시 NPC가 플레이어 쪽으로 즉시 돌아봄 (전조 없음)
 *  - other: 위로 분류 안 됨
 */
export type OnsetCause =
  | 'tellLook' | 'playerEnter' | 'npcAdvance' | 'turnCorner' | 'turnResume' | 'turnTalkEnd' | 'talkStart' | 'other';

export const UNFAIR_CAUSES: readonly OnsetCause[] = ['turnCorner', 'turnResume', 'turnTalkEnd', 'talkStart'];

export interface Onset { t: number; npc: string; cause: OnsetCause; }
export interface UntoldTurn { t: number; npc: string; kind: 'corner' | 'resume' | 'talkEnd' | 'talkStart'; seesPlayer: boolean; deltaDeg: number; }
export interface LookStart { t: number; npc: string; tellSec: number; required: number; }

interface NpcSnap { x: number; y: number; facing: number; mode: NpcMode; walkFrom: NpcMode | 'init'; walkSteps: number; tellStart: number; }

export class Observer {
  readonly onsets: Onset[] = [];
  readonly turns: UntoldTurn[] = [];
  readonly looks: LookStart[] = [];
  /** npc 인덱스별 현재 노출 에피소드의 시작 원인 */
  readonly episodeCause: (OnsetCause | null)[];
  private snaps: NpcSnap[];

  constructor(readonly sim: FloorSim) {
    this.snaps = sim.npcs.map((n) => ({ x: n.x, y: n.y, facing: n.facing, mode: n.mode, walkFrom: 'init', walkSteps: 0, tellStart: n.mode === 'tell' ? 0 : -1 }));
    this.episodeCause = sim.npcs.map(() => null);
  }

  /** sim.step() 한 번 + 관찰 */
  step(): void {
    const sim = this.sim;
    if (sim.outcome !== 'playing') return;
    const wasSeeing = sim.seeing.slice();
    sim.step();
    const p = sim.player.pos;
    sim.npcs.forEach((n, i) => {
      const s = this.snaps[i]!;
      const turned = angleDiff(n.facing, s.facing) > 1e-6;
      // tell 시작 시각 / look 진입 기록
      if (n.mode === 'tell' && s.mode !== 'tell') s.tellStart = sim.time;
      if (n.mode === 'look' && s.mode === 'tell') {
        this.looks.push({ t: sim.time, npc: n.def.id, tellSec: sim.time - s.tellStart, required: n.def.tellSec });
      }
      // 걷기 진입 출처
      if (n.mode === 'walk' && s.mode !== 'walk') { s.walkFrom = s.mode; s.walkSteps = 0; }
      if (n.mode === 'walk') s.walkSteps++;

      // 전조 없는 방향 전환 분류
      let turnKind: UntoldTurn['kind'] | null = null;
      if (turned) {
        if (n.mode === 'look' && s.mode === 'tell') turnKind = null; // 정상(전조 후)
        else if (n.mode === 'talk' && s.mode !== 'talk') turnKind = 'talkStart';
        else if (s.mode === 'talk' && n.mode !== 'talk') turnKind = 'talkEnd';
        else if (n.mode === 'walk' && s.walkSteps <= 2 && s.walkFrom !== 'walk') turnKind = 'resume';
        else if (n.mode === 'walk') turnKind = 'corner';
        else turnKind = 'corner';
        if (turnKind) {
          this.turns.push({
            t: sim.time, npc: n.def.id, kind: turnKind,
            seesPlayer: sim.seeing[i] === true,
            deltaDeg: (angleDiff(n.facing, s.facing) * 180) / Math.PI,
          });
        }
      }

      // 시선 시작 원인
      if (sim.seeing[i] && !wasSeeing[i]) {
        let cause: OnsetCause;
        const cone = n.def.cone;
        const prevPosPrevFacing = canSee(sim.map, { x: s.x, y: s.y }, s.facing, cone, p);
        const curPosPrevFacing = canSee(sim.map, n.pos, s.facing, cone, p);
        if (n.mode === 'look' && s.mode === 'tell') cause = 'tellLook';
        else if (turnKind === 'talkStart') cause = 'talkStart';
        else if (turned && !curPosPrevFacing) {
          cause = turnKind === 'resume' ? 'turnResume' : turnKind === 'talkEnd' ? 'turnTalkEnd' : 'turnCorner';
        } else if (prevPosPrevFacing) cause = 'playerEnter';
        else if (curPosPrevFacing) cause = 'npcAdvance';
        else cause = 'other';
        this.onsets.push({ t: sim.time, npc: n.def.id, cause });
        this.episodeCause[i] = cause;
      }
      if (!sim.seeing[i]) this.episodeCause[i] = null;

      s.x = n.x; s.y = n.y; s.facing = n.facing; s.mode = n.mode;
    });
  }

  /** caught 순간 원인: 지금 보고 있는 NPC 중 배율이 가장 큰 NPC의 에피소드 원인 */
  caughtCause(): { npc: string; cause: OnsetCause } | null {
    const sim = this.sim;
    let best = -1, bestMult = -1;
    sim.npcs.forEach((n, i) => {
      if (sim.seeing[i] && n.def.gazeMultiplier > bestMult) { best = i; bestMult = n.def.gazeMultiplier; }
    });
    if (best < 0) return null;
    return { npc: sim.npcs[best]!.def.id, cause: this.episodeCause[best] ?? 'other' };
  }
}
