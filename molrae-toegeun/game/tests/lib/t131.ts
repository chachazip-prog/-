/**
 * T-131 하루 전체 QA 하네스 (헤드리스). buildDayContent + DaySim을 봇으로 끝까지 돌리고
 * 공정성(화면 밖·전조·페이크)·말걸기·배경 동료·인원·퇴근 방해 지연을 매 틱 관찰한다.
 * 제품 코드(src/)는 읽기만 한다. 봇이 쓰는 입력은 사람과 같은 공개 API(tapWorld·tapMission)뿐이고,
 * 봇이 '보는' 정보는 화면에 그려지는 것(콘·전조 '!'·말풍선·가장자리 화살표·미니게임 게이지)으로 한정한다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DaySim, createRng, canSee, inCone, angleDiff, hasLineOfSight, findPath,
  type PatrolNpc, type Rng, type DayContent, type DayEvent, type SimEvent, type Threat, type NpcMode,
} from '../../src/core';
import { buildDayContent, type Tables } from '../../src/content/buildDay';
import { CAMERA_VIEW } from '../../src/config/display';

export const VIEW = CAMERA_VIEW;

export function loadTables(dir: string): Tables {
  const t: Record<string, unknown> = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) t[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return t;
}

export function contentFor(tables: Tables, day: number): DayContent {
  return buildDayContent(tables, day, { push: () => {} });
}

// ── 봇 ─────────────────────────────────────────────────

export interface BotParams {
  readonly name: string;
  /** 위험 신호에 탭 정지(위장)로 반응 */
  readonly disguise: boolean;
  readonly reactMu: number;
  readonly reactSd: number;
  /** 위험 신호를 놓칠 확률(반응 안 함) */
  readonly missRate: number;
  /** 미니게임·게이트 타이밍 오차 σ(초) */
  readonly timingSd: number;
  /** 위험이 사라진 뒤 다시 출발까지(초) */
  readonly resumeDelay: number;
  /** 필수 외 미션 추가 확률 */
  readonly extraMissionProb: number;
  /** 화장실 보너스 욕심(초) */
  readonly restroomBonusSec: number;
  /** 말걸기 말풍선에 반응: none = 무시, stop = 탭(위장), evade = 반대쪽으로 피함 */
  readonly talkReact: 'none' | 'stop' | 'evade';
  /** 말걸기 반응 지연을 고정(초). 없으면 reactMu/Sd */
  readonly talkReactSec?: number;
  /** 인사 QTE 반응(단순 반응시간, '!' 표시 후) */
  readonly qteMu: number;
  readonly qteSd: number;
  /** QTE '?' 단계에서 성급히 누를 확률 */
  readonly qteEarly: number;
  /** 공범 제안 수락 확률 */
  readonly acceptOffer: number;
}

export const BOTS: Record<string, BotParams> = {
  straight: { name: '직진', disguise: false, reactMu: 0, reactSd: 0, missRate: 1, timingSd: 0.10, resumeDelay: 0, extraMissionProb: 1, restroomBonusSec: 2, talkReact: 'none', qteMu: 0.38, qteSd: 0.10, qteEarly: 0.02, acceptOffer: 1 },
  disguise: { name: '위장(캐주얼 기준)', disguise: true, reactMu: 0.38, reactSd: 0.10, missRate: 0.05, timingSd: 0.10, resumeDelay: 0.2, extraMissionProb: 0.5, restroomBonusSec: 2, talkReact: 'stop', qteMu: 0.38, qteSd: 0.10, qteEarly: 0.02, acceptOffer: 0.6 },
  novice: { name: '초보(반응 느림)', disguise: true, reactMu: 0.65, reactSd: 0.15, missRate: 0.2, timingSd: 0.15, resumeDelay: 0.1, extraMissionProb: 0, restroomBonusSec: 0, talkReact: 'stop', qteMu: 0.55, qteSd: 0.15, qteEarly: 0.06, acceptOffer: 0.3 },
};

const ACTION_EST: Record<string, number> = { pour_tap_stop: 2.5, trip_safe_zone: 5.5, nap_tap_toggle: 6, screen_swap_tap: 8.5, rhythm_tap: 6 };

function gauss(r: Rng): number {
  const u = Math.max(1e-12, r.next()), v = r.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 화면에 화살표가 그려지는 사원증 줄(GameScene edgeArrowKey와 같은 규칙: boss/guard/snitch/hr) */
export function lanyardOf(sim: DaySim, n: PatrolNpc): string {
  const a = n.def.actorId ?? '';
  if (a.startsWith('background:')) return 'background';
  return sim.content.actors[a]?.lanyard ?? 'background';
}
export const ARROW_LANYARDS = new Set(['boss', 'guard', 'snitch', 'hr']);

export class Bot {
  private r: Rng;
  private wasDanger = new Map<PatrolNpc, boolean>();
  private reactAt = Infinity;
  private reactTalkAt = Infinity;
  private aware = false;
  private clearSince = 0;
  private stoppedAt = -1;
  private ignoreUntil = new Map<PatrolNpc, number>();
  private gateTapAt = Infinity;
  private gateNext = 0;
  private prevMarker = -1;
  private coffeeTarget = -1;
  private napThr = -1;
  private biteTarget = 0;
  private doExtra: boolean;
  private lastRetarget = -1;
  private evadeTarget: { x: number; y: number } | null = null;
  private freezeAt = Infinity;
  private qteObj: unknown = null;
  private qteAt = Infinity;
  private qteEarlyAt = Infinity;
  private offerSeen: unknown = null;
  /** 말걸기 반응 로그: 전조 시작마다 반응했는가 */
  readonly talkReactions: { npc: string; t: number }[] = [];

  constructor(readonly p: BotParams, readonly sim: DaySim, seed: string) {
    this.r = createRng(`bot-${p.name}-${seed}`);
    this.doExtra = this.r.chance(p.extraMissionProb);
  }

  private delay(): number { return Math.max(0.1, this.p.reactMu + this.p.reactSd * gauss(this.r)); }

  /** 화면에 보이는 위험 신호 */
  private dangerOf(n: PatrolNpc, th: Threat): 'gaze' | 'talk' | null {
    const f = this.sim.floor;
    if (n.gazeMultiplier <= 0 || lanyardOf(this.sim, n) === 'background') return null;
    if ((this.ignoreUntil.get(n) ?? -1) > f.time && th !== 'seeing' && th !== 'turning') return null;
    const on = f.isOnScreen(n);
    if (n.mode === 'tell' && n.tellKind === 'talk') return on ? 'talk' : null;
    if (n.ignoresPlayer) return null;
    if (on) {
      if (th === 'seeing' || th === 'turning') return 'gaze';
      if (n.coneActive) {
        const c = n.cone;
        const p = f.player.pos;
        if (inCone(n.pos, n.facing, { range: c.range + 1.5, halfAngleDeg: c.halfAngleDeg + 10 }, p) && hasLineOfSight(f.map, n.pos, p)) return 'gaze';
      }
      return null;
    }
    // 화면 밖: 화살표(깜빡이는 turning, 가장 큰 approaching)
    if (!ARROW_LANYARDS.has(lanyardOf(this.sim, n))) return null;
    if (th === 'turning') return 'gaze';
    if (th === 'approaching' && f.camera) {
      const above = n.y < f.camera.visibleTop;
      const edge = above ? f.camera.visibleTop - n.y : n.y - f.camera.visibleBottom;
      if (edge < 3) return 'gaze';
    }
    return null;
  }

  /** 매 스텝 sim.step() 전에 호출 */
  act(): void {
    const sim = this.sim, f = sim.floor, p = f.player, now = f.time, P = this.p;
    if (sim.phase === 'intro' || sim.phase === 'ended') return;
    // 1) 위험 인지
    let dangerGaze = false, dangerTalk = false;
    for (const n of f.npcs) {
      const d = this.dangerOf(n, f.threatOfNpc(n));
      const was = this.wasDanger.get(n) === true;
      this.wasDanger.set(n, d !== null);
      if (d === 'gaze') dangerGaze = true;
      if (d === 'talk') dangerTalk = true;
      if (d && !was) {
        if (d === 'talk' && P.talkReact !== 'none') {
          const dl = P.talkReactSec ?? this.delay();
          if (P.talkReactSec !== undefined || !this.r.chance(P.missRate)) this.reactTalkAt = Math.min(this.reactTalkAt, now + dl);
        } else if (d === 'gaze' && P.disguise && !this.r.chance(P.missRate)) this.reactAt = Math.min(this.reactAt, now + this.delay());
      }
    }
    const danger = dangerGaze || (dangerTalk && P.talkReact === 'stop');
    if (!dangerGaze && !dangerTalk) { this.aware = false; this.reactAt = Infinity; this.reactTalkAt = Infinity; }
    if (danger) this.clearSince = now; // 위험 지속
    if (now >= this.reactAt) { this.reactAt = Infinity; if (dangerGaze) this.aware = true; }
    const talkFire = now >= this.reactTalkAt;
    if (talkFire) this.reactTalkAt = Infinity;
    const clearFor = now - this.clearSince;

    // 1-2) 인사 QTE('?' → '!' 후 짧게 탭). QTE 중 다른 탭은 모두 QTE 입력이 되므로 다른 행동 금지
    if (sim.qteActive && sim.qte) {
      const q = sim.qte;
      if (this.qteObj !== q) {
        this.qteObj = q; this.qteAt = Infinity;
        this.qteEarlyAt = this.r.chance(P.qteEarly) ? now + this.r.range(0, q.preCueSec) : Infinity;
      }
      if (q.phase === 'precue' && now >= this.qteEarlyAt) { sim.tapQte(0.1); return; }
      if (q.phase === 'window' && this.qteAt === Infinity) this.qteAt = now + Math.max(0.12, P.qteMu + P.qteSd * gauss(this.r));
      if (q.phase === 'window' && now >= this.qteAt) sim.tapQte(0.1);
      return;
    }
    // 1-3) 대표님 얼음(전조 1.0초: 비네트·BGM 정지·모두 고개 듦) → 이동·행동 멈춤(모든 봇 공통, GDD §16 '얼음 중 이동 금지')
    if (sim.frozen) { if (this.freezeAt === Infinity) this.freezeAt = now + this.delay(); } else this.freezeAt = Infinity;
    if (sim.frozen && now >= this.freezeAt) {
      if (p.mode === 'moving') { this.stop(); return; }
      if (sim.activity) { this.playActivity(true); return; }
      return;
    }
    if (sim.frozen) { this.plan(); return; }
    // 1-4) 공범 제안
    if (sim.offer && this.offerSeen !== sim.offer) { this.offerSeen = sim.offer; if (this.r.chance(P.acceptOffer)) sim.acceptOffer(); }

    // 2) 게이트
    if (sim.phase === 'leave' && sim.leaveStage === 'gate') { this.gate(); return; }
    this.prevMarker = -1; this.gateTapAt = Infinity;

    if (p.mode === 'talked') return;

    // 3) 말걸기 반응
    if (talkFire && dangerTalk) {
      this.talkReactions.push({ npc: 'talk', t: now });
      if (P.talkReact === 'stop' && p.mode === 'moving' && !sim.activity) { this.stop(); return; }
      if (P.talkReact === 'evade' && !sim.activity) { this.evade(); return; }
    }
    if (this.evadeTarget) {
      if (!dangerTalk || p.mode !== 'moving') { this.evadeTarget = null; }
      return;
    }

    // 4) 미니게임
    if (sim.activity) { this.playActivity(this.aware && dangerGaze); return; }

    // 5) 이동 중 위험 → 정지(위장)
    const inPack = sim.phase === 'leave' && sim.leaveStage === 'pack' && sim.playerAtSeat;
    if (p.mode === 'moving' && this.aware && dangerGaze && !sim.gateOpen && !inPack) { this.stop(); return; }

    // 6) 위장 중 → 위험이 사라지면 재출발 (오래 막히면 조바심에 출발)
    if (p.mode === 'disguised' && f.resumeDestination && !p.paused) {
      const waited = this.stoppedAt >= 0 ? now - this.stoppedAt : 0;
      if ((!danger && clearFor >= P.resumeDelay) || waited > 4) {
        if (waited > 4) for (const n of f.npcs) this.ignoreUntil.set(n, now + 2);
        this.tapSelf();
        this.stoppedAt = -1;
      }
      return;
    }
    if (danger && P.disguise && p.mode !== 'moving' && this.aware) return; // 위험 중에는 새 출발 안 함

    // 7) 계획
    this.plan();
  }

  private tapSelf(): void { const t = this.sim.floor.player.tile; this.sim.tapWorld(t.x, t.y); }
  private stop(): void { this.tapSelf(); this.stoppedAt = this.sim.floor.time; }

  private evade(): void {
    // 말 거는 사람 반대쪽으로 2~3칸: 이동 중이면 첫 탭은 정지(조작 규칙), 같은 틱에 두 번째 탭으로 목적지
    const f = this.sim.floor, p = f.player;
    const n = f.npcs.find((x) => x.mode === 'tell' && x.tellKind === 'talk');
    if (!n) return;
    const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy) || 1;
    let best: { x: number; y: number } | null = null, bestD = -1;
    const t = p.tile;
    for (let yy = t.y - 3; yy <= t.y + 3; yy++) for (let xx = t.x - 3; xx <= t.x + 3; xx++) {
      const along = ((xx + 0.5 - n.x) * dx + (yy + 0.5 - n.y) * dy) / d;
      const path = findPath(f.map, t, { x: xx, y: yy }, f.blockedForPlayer);
      if (!path || path.length === 0 || path.length > 4) continue;
      if (along > bestD) { bestD = along; best = { x: xx, y: yy }; }
    }
    if (!best) return;
    if (p.mode === 'moving') this.sim.tapWorld(t.x, t.y);
    this.sim.tapWorld(best.x, best.y);
    this.evadeTarget = best;
  }

  private gate(): void {
    const sim = this.sim, now = sim.floor.time;
    const C = sim.content.leave.gate.markerCycleSec;
    const m = sim.gateMarker;
    if (this.prevMarker < 0) { this.prevMarker = m; this.gateNext = now + 0.3; return; }
    const up = m >= this.prevMarker;
    this.prevMarker = m;
    if (now < this.gateNext) return;
    if (this.gateTapAt === Infinity) {
      const phase = up ? m / 2 : 1 - m / 2;
      let target = 0.25;
      while ((target - phase) * C < 0.25) target += 0.5;
      this.gateTapAt = now + (target - phase) * C + this.p.timingSd * gauss(this.r);
    }
    if (now + 1e-9 >= this.gateTapAt) {
      const t = sim.floor.player.tile;
      sim.tapWorld(t.x, t.y);
      this.gateTapAt = Infinity;
      this.gateNext = now + 0.35;
      this.prevMarker = -1;
    }
  }

  private playActivity(aware: boolean): void {
    const sim = this.sim, v = sim.activityView();
    if (!v) return;
    const P = this.p, now = sim.floor.time;
    const tap = () => sim.tapWorld(0, 0);
    const hr = sim.hrCountdown !== null;
    switch (v.kind) {
      case 'pour': {
        if (this.coffeeTarget < 0) this.coffeeTarget = (v.band[0] + v.band[1]) / 2 + 0.45 * P.timingSd * gauss(this.r);
        if (v.paused) { if (!aware && now - this.clearSince >= P.resumeDelay) tap(); return; }
        if (aware && v.level < v.band[0] - 0.02) { tap(); return; }
        if (v.level >= this.coffeeTarget) { tap(); this.coffeeTarget = -1; }
        return;
      }
      case 'restroom':
        if (v.restLeft <= 0 && (hr || v.bonusSec >= Math.min(v.bonusMax, P.restroomBonusSec) - 1e-6)) tap();
        return;
      case 'nap': {
        if (this.napThr < 0) this.napThr = 0.6 + 0.35 * P.timingSd * gauss(this.r);
        if (aware) { if (!v.headUp) tap(); return; }
        if (!v.headUp && v.head >= this.napThr) { tap(); this.napThr = -1; }
        else if (v.headUp && v.head <= 0.08 && now - this.clearSince >= P.resumeDelay) tap();
        return;
      }
      case 'shop':
        if (aware && v.shopping) { tap(); return; }
        if (!v.shopping && !aware && now - this.clearSince >= P.resumeDelay) tap();
        return;
      case 'snack': {
        if (aware || sim.floor.gazeNow > 0) return;
        if (v.bites === 0 || v.sinceLast >= this.biteTarget) {
          tap();
          this.biteTarget = Math.max(0.3, 0.8 + P.timingSd * gauss(this.r));
        }
        return;
      }
    }
  }

  private plan(): void {
    const sim = this.sim, f = sim.floor, p = f.player, c = sim.content, now = f.time;
    if (p.mode === 'moving' || p.paused) {
      // 보고 달리기 가로막기: 목표 갱신
      if (sim.reportActive && sim.snackStock > 0 && now - this.lastRetarget > 0.3) this.interceptReport();
      return;
    }
    if (sim.phase === 'day') {
      if (sim.hrCountdown !== null) { if (!sim.playerAtSeat) f.moveTo(c.playerSeat); return; }
      if (sim.reportActive) {
        if (sim.snackStock > 0) this.interceptReport(); else if (!sim.playerAtSeat) f.moveTo(c.playerSeat);
        return;
      }
      const carry = sim.missions.find((m) => m.state === 'carry');
      if (carry) { if (!sim.playerAtSeat) sim.tapMission(carry.def.id); return; }
      if (sim.pendingMission) { sim.tapMission(sim.pendingMission.def.id); return; }
      if (!sim.playerAtSeat) { f.moveTo(c.playerSeat); return; }
      // 자리: 미션 고르기(업무 할당량 시간 예산)
      const done = sim.missionsDone();
      if (!this.doExtra && done >= c.missionsRequired) return;
      const open = sim.missions.filter((m) => m.state === 'open' && !m.blocked).sort((a, b) => a.def.unlockAtSec - b.def.unlockAtSec);
      const m = open[0];
      if (!m) return;
      const R = c.dayPhaseSec - sim.dayTime;
      // 기획 시간 예산(§12-2)과 같은 방식: 왕복 이동 + 행동 예상 + 여유 0.5초, 할당량은 남은 업무 시간 + 0.3초
      const W = Math.max(0, c.work.quota - sim.work) / c.work.fillPerSec + 0.3;
      let E = m.def.mechanic === 'trip_safe_zone' ? 3.3 + this.p.restroomBonusSec : (ACTION_EST[m.def.mechanic] ?? 6);
      if (m.def.startsAt === 'arrive_spot') {
        const path = findPath(f.map, c.playerSeat, m.def.spot);
        E += ((path?.length ?? 15) * 2) / f.rules.playerSpeedTilesPerSec + 0.5;
      }
      if (E > R) return;
      if (sim.work >= c.work.quota || R - E >= W) sim.tapMission(m.def.id);
      return;
    }
    if (sim.phase === 'leave') {
      switch (sim.leaveStage) {
        case 'pack': if (!sim.playerAtSeat) f.moveTo(c.playerSeat); return;
        case 'walk': f.moveTo(c.leave.gate.spot); return;
        case 'lobby': f.moveTo(c.leave.exitSpot); return;
        default: return;
      }
    }
  }

  private interceptReport(): void {
    const f = this.sim.floor;
    this.lastRetarget = f.time;
    const run = f.findNpc((n) => n.def.actorId === 'snitch' && !n.def.seated);
    if (!run) return;
    const goal = { x: Math.floor(run.x), y: Math.floor(run.y) };
    f.moveTo(goal);
  }
}

// ── 관찰기 ─────────────────────────────────────────────

interface Snap { mode: NpcMode; tellKind: PatrolNpc['tellKind']; tellStart: number; facing: number; x: number; y: number; lastLookFake: boolean | null }

export interface Fairness {
  gazeTicks: number;
  offscreenGazeTicks: number;
  cameraMismatchTicks: number;
  unexplainedRiseTicks: number;
  onsets: number;
  onsetNoLead: number;
  onsetNoLeadSamples: string[];
  onsetCauses: Record<string, number>;
  looks: number;
  lookShortTell: number;
  lookWithoutTell: number;
  lookSamples: string[];
  fakes: Record<string, { tells: number; fakes: number; consecutive: number }>;
  hudRowGazeTicks: number;
}

export function newFairness(): Fairness {
  return { gazeTicks: 0, offscreenGazeTicks: 0, cameraMismatchTicks: 0, unexplainedRiseTicks: 0, onsets: 0, onsetNoLead: 0, onsetNoLeadSamples: [], onsetCauses: {}, looks: 0, lookShortTell: 0, lookWithoutTell: 0, lookSamples: [], fakes: {}, hudRowGazeTicks: 0 };
}

export interface TalkStat { warn: number; armed: number; talk: number; cancel: Record<string, number>; releaseGainTicks: number; postHoldViol: number; talkSec: number }

/** QA 독립 카메라(maps.camera + display 값으로 다시 계산) — 코어 CameraModel과 비교용 */
class QaCamera {
  focusY: number; top: number;
  constructor(private c: DayContent, private mapH: number, py: number) { this.focusY = py; this.top = this.target(); }
  private target(): number {
    let t = this.focusY - this.c.camera.visibleAboveTiles;
    if (this.c.camera.clampToMap) {
      const min = -VIEW.insetTopTiles;
      const max = Math.max(min, this.mapH - VIEW.viewHeightTiles + VIEW.insetBottomTiles);
      t = Math.min(Math.max(min, t), max);
    }
    return t;
  }
  step(py: number): void {
    const dz = this.c.camera.deadZoneTiles;
    if (py > this.focusY + dz) this.focusY = py - dz; else if (py < this.focusY - dz) this.focusY = py + dz;
    const t = this.target();
    this.top += (t - this.top) * this.c.camera.lerpPerFrame;
    if (Math.abs(t - this.top) < 1e-3) this.top = t;
  }
  on(y: number): boolean { return y >= this.top + VIEW.insetTopTiles && y <= this.top + VIEW.viewHeightTiles - VIEW.insetBottomTiles; }
  inHudRows(y: number): boolean { return (y >= this.top && y < this.top + VIEW.insetTopTiles) || (y > this.top + VIEW.viewHeightTiles - VIEW.insetBottomTiles && y <= this.top + VIEW.viewHeightTiles); }
  full(y: number): boolean { return y >= this.top && y <= this.top + VIEW.viewHeightTiles; }
}

export interface RunResult {
  day: number; bot: string; seed: string; rank: string;
  outcome: string; stars: number; timeSec: number; peak: number; work: number; quota: number;
  missionsDone: number; missionsTotal: number; missionsRequired: number;
  missions: { id: string; started: boolean; state: string; reason?: string; sec?: number }[];
  caughtBy: string | null; caughtCause: string | null;
  leaveStart: number; leaveSec: number | null; leaveIntsStarted: string[]; leaveTalkSec: number; leaveBlockedSec: number;
  gateAttempts: number; gateFails: number; earlyBonus: boolean; slack: number;
  closeCalls: number;
  maxOnScreen: number; maxOnScreenFull: number; maxOnFloor: number;
  bgGaze: number; bgArrow: number; bgBlocked: number; bgWaitTicks: number;
  gateStageRise: number; gateStageNonStaleRise: number; gateStageSec: number;
  int08TellRise: number; int08TellTicks: number;
  int04BlockWaitSec: number | null;
  ceo: { visit: string; started: boolean; eyeContact: boolean; qte: string | null; caughtDuring: boolean; gainDuring: number; freezeOtherGazeTicks: number; clockViol: number; missionClockViol: number; resumeNoTell: number; resumeOnsets: number };
  elevCeo: { started: boolean; qte: string | null; caughtAfter: boolean };
  acc: { joined: number; doneWithAcc: number; pointsWithAcc: number; basePointsWithAcc: number };
  continued: boolean;
  suspGain: Record<string, number>;
  talk: Record<string, TalkStat>;
  fair: Fairness;
}

export interface RunOpts {
  /** 퇴근 방해(INT-01 제외)를 뺀 변형(퇴근 방해 지연 비교용) */
  stripLeaveInterrupts?: boolean;
  maxSec?: number;
}

const INSTANT_DAY_EVENTS = new Set(['missionFail', 'hrAbsent', 'gate']);

export function runDay(content0: DayContent, botP: BotParams, seed: string, opts: RunOpts = {}): RunResult {
  const content: DayContent = opts.stripLeaveInterrupts
    ? { ...content0, interrupts: content0.interrupts.filter((i) => i.phase !== 'leave' || i.id === 'INT-01') }
    : content0;
  const sim = new DaySim(content, { view: VIEW }, seed);
  const f = sim.floor;
  const bot = new Bot(botP, sim, seed);
  const H = content.floor.rules.fixedStepSec;
  const qcam = new QaCamera(content, f.map.height, f.player.y);
  const fair = newFairness();
  const snaps = new Map<PatrolNpc, Snap>();
  const hist = new Map<PatrolNpc, boolean[]>(); // NPC 객체 → 최근 틱 '화면 안 또는 화살표'. 교체(replaceNpc)된 객체는 같은 액터의 사라진 객체 이력을 이어받음
  let prevNpcs: PatrolNpc[] = [];
  const LEAD = Math.round(0.4 / H);
  const talk: Record<string, TalkStat> = {};
  const ts = (a: string): TalkStat => (talk[a] ??= { warn: 0, armed: 0, talk: 0, cancel: {}, releaseGainTicks: 0, postHoldViol: 0, talkSec: 0 });
  const suspGain: Record<string, number> = {};
  const missionStart = new Map<string, number>();
  const mres = new Map<string, { state: string; reason?: string; sec?: number }>();
  const leaveInts = new Set<string>();
  let leaveStart = -1, leaveTalkSec = 0, leaveBlockedSec = 0, gateFails = 0, earlyBonus = false, closeCalls = 0;
  let maxOn = 0, maxFull = 0, maxFloor = 0, bgGaze = 0, bgArrow = 0, bgBlocked = 0, bgWait = 0;
  let gateRise = 0, gateNonStale = 0, gateSec = 0, int08Rise = 0, int08Ticks = 0;
  let int04Wait: number | null = null; let int04Active = false;
  let caughtCause: string | null = null;
  const ceo = { visit: 'none', started: false, eyeContact: false, qte: null as string | null, caughtDuring: false, gainDuring: 0, freezeOtherGazeTicks: 0, clockViol: 0, missionClockViol: 0, resumeNoTell: 0, resumeOnsets: 0 };
  const elevCeo = { started: false, qte: null as string | null, caughtAfter: false };
  const acc = { joined: 0, doneWithAcc: 0, pointsWithAcc: 0, basePointsWithAcc: 0 };
  let freezeEndAt = -1, wasFrozen = false;
  let accJoinedMission: string | null = null;
  const talkWarnAt = new Map<PatrolNpc, { t: number; armed: boolean }>();
  let postTalkUntil = -1;
  const keyOf = (n: PatrolNpc) => `${n.def.actorId ?? n.def.id}`;
  const maxSteps = Math.round((opts.maxSec ?? 200) / H);

  for (let i = 0; i < maxSteps && sim.phase !== 'ended'; i++) {
    bot.act();
    const before = f.suspicion.value;
    const stageBefore = sim.leaveStage, phaseBefore = sim.phase;
    const clockPausedBefore = sim.clockPaused, dayTimeBefore = sim.dayTime;
    const mElapsed = sim.missions.map((m) => (m.startedAt !== null ? f.time - m.startedAt : null));
    const ceoActiveBefore = !['none', 'pending', 'skipped', 'done', 'cancelled'].includes(sim.ceoState);
    sim.step();
    if (clockPausedBefore && sim.clockPaused && sim.phase === 'day') {
      if (Math.abs(sim.dayTime - dayTimeBefore) > 1e-12) ceo.clockViol++;
      sim.missions.forEach((m, k) => { const e0 = mElapsed[k]; if (e0 !== null && e0 !== undefined && m.startedAt !== null && Math.abs((f.time - m.startedAt) - e0) > 1e-9) ceo.missionClockViol++; });
    }
    if (ceoActiveBefore && f.suspicion.value > before) ceo.gainDuring += f.suspicion.value - before;
    if (ceoActiveBefore && (sim.phase as string) === 'ended' && sim.result?.outcome === 'caught') ceo.caughtDuring = true;
    if (sim.frozen) f.npcs.forEach((n, k) => { if (f.seeing[k] && n.def.actorId !== 'ceo') ceo.freezeOtherGazeTicks++; });
    if (wasFrozen && !sim.frozen) freezeEndAt = f.time;
    wasFrozen = sim.frozen;
    qcam.step(f.player.y);
    const dayEv: DayEvent[] = sim.drainEvents();
    const flEv: SimEvent[] = sim.drainFloorEvents();
    const now = f.time;
    const delta = f.suspicion.value - before;
    let instant = '';
    for (const e of dayEv) {
      if (e.type === 'missionStart') missionStart.set(e.id, now);
      if (e.type === 'missionDone') mres.set(e.id, { state: 'done', sec: now - (missionStart.get(e.id) ?? now) });
      if (e.type === 'missionFail') mres.set(e.id, { state: 'failed', reason: e.reason });
      if (e.type === 'gate' && e.result === 'fail') { gateFails++; instant = 'gate_beep'; }
      if (e.type === 'missionFail') instant = `mission_${e.reason}:${e.id}`;
      if (e.type === 'hrAbsent') instant = 'hr_absent';
      if (e.type === 'report' && e.result === 'arrive') instant = 'report_arrive';
      if (e.type === 'phase' && e.phase === 'leave') leaveStart = now;
      if (e.type === 'interrupt' && sim.phase === 'leave') leaveInts.add(e.id);
      if (e.type === 'interrupt' && e.id === 'INT-04' && sim.phase === 'leave') int04Active = true;
      if (e.type === 'toast' && e.key === 'event.leave.early_bonus') earlyBonus = true;
      if (e.type === 'closeCall') closeCalls++;
      if (e.type === 'ceo' && e.stage === 'tell') ceo.started = true;
      if (e.type === 'qte' && e.stage === 'result') { if (e.source === 'ceo') ceo.qte = e.result ?? null; else elevCeo.qte = e.result ?? null; }
      if (e.type === 'interrupt' && e.id === 'INT-11') elevCeo.started = true;
      if (e.type === 'offerEnd' && e.accepted) accJoinedMission = e.missionId;
      if (e.type === 'accomplice' && e.action === 'join') acc.joined++;
      if (e.type === 'accomplice' && e.action === 'leave') accJoinedMission = null;
      if (e.type === 'missionDone' && accJoinedMission === e.id) { acc.doneWithAcc++; acc.pointsWithAcc += e.points; acc.basePointsWithAcc += content.missions.find((m) => m.id === e.id)?.reward.slackPoints ?? 0; }
      void INSTANT_DAY_EVENTS;
    }
    if (activitySnackNoise(flEv, dayEv)) instant ||= 'snack_noise';
    for (const e of flEv) {
      const n = f.findNpc((x) => x.def.id === (e as { npc?: string }).npc);
      const a = n?.def.actorId ?? (e as { npc?: string }).npc ?? '?';
      if (e.type === 'talkWarn') { ts(a).warn++; if (n) talkWarnAt.set(n, { t: now, armed: false }); }
      if (e.type === 'talk') {
        ts(a).talk++;
        if (sim.phase === 'leave') {
          const id = n?.def.actorId ? content.actors[n.def.actorId]?.talkEnabledBy : undefined;
          if (id && id !== 'INT-01') leaveInts.add(id);
        }
      }
      if (e.type === 'talkCancel') { const s = ts(a); s.cancel[e.reason] = (s.cancel[e.reason] ?? 0) + 1; }
      if (e.type === 'talkEnd') postTalkUntil = now + (content.floor.rules.movement?.postTalkHoldSec ?? 0);
      if (e.type === 'blocked') {
        const nx = f.player.remainingPath()[0];
        if (nx) {
          const tx = Math.floor(nx.x), ty = Math.floor(nx.y);
          const blocker = f.npcs.find((m) => Math.floor(m.x) === tx && Math.floor(m.y) === ty && m.mode !== 'walk' && m.mode !== 'spawn' && !m.def.passable);
          if (blocker && lanyardOf(sim, blocker) === 'background') bgBlocked++;
        }
      }
    }
    // 말걸기 전조 중 radius 진입 기록
    for (const [n, w] of talkWarnAt) {
      if (n.mode === 'tell' && n.tellKind === 'talk' && n.def.talk && Math.hypot(f.player.x - n.x, f.player.y - n.y) <= n.def.talk.radius) w.armed = true;
      if (!(n.mode === 'tell' && n.tellKind === 'talk')) { if (w.armed) ts(n.def.actorId ?? '?').armed++; talkWarnAt.delete(n); }
    }
    if (f.player.mode === 'talked' && f.talkingNpc) { ts(f.talkingNpc.def.actorId ?? '?').talkSec += H; if (sim.phase === 'leave') leaveTalkSec += H; }
    if (sim.phase === 'leave' && f.player.paused) leaveBlockedSec += H;
    if (int04Active && int04Wait === null) int04Wait = 0;
    if (int04Active && sim.phase === 'leave' && f.player.paused && zoneTileNear(f.player.tile, 5, 23, 2)) int04Wait = (int04Wait ?? 0) + H;

    // 인원
    let on = 1, full = 1;
    for (const n of f.npcs) { if (f.isOnScreen(n)) on++; if (qcam.full(n.y)) full++; }
    maxOn = Math.max(maxOn, on); maxFull = Math.max(maxFull, full); maxFloor = Math.max(maxFloor, f.npcs.length + 1);

    // 시선·공정성
    let anySee = false;
    const gone = prevNpcs.filter((n) => !f.npcs.includes(n));
    for (const n of f.npcs) if (!hist.has(n)) {
      const pre = gone.find((g) => g.def.actorId === n.def.actorId && Math.hypot(g.x - n.x, g.y - n.y) < 1.01);
      hist.set(n, pre ? (hist.get(pre) ?? []).slice() : []);
    }
    prevNpcs = f.npcs.slice();
    f.npcs.forEach((n, k) => {
      const s = snaps.get(n) ?? { mode: n.mode, tellKind: n.tellKind, tellStart: n.mode === 'tell' ? now : -1, facing: n.facing, x: n.x, y: n.y, lastLookFake: null };
      const key = keyOf(n);
      const coreOn = f.isOnScreen(n), qaOn = qcam.on(n.y);
      if (f.seeing[k]) {
        anySee = true;
        fair.gazeTicks++;
        if (!coreOn || !qaOn) fair.offscreenGazeTicks++;
        if (qcam.inHudRows(n.y)) fair.hudRowGazeTicks++;
        if (lanyardOf(sim, n) === 'background') bgGaze++;
      }
      if (coreOn !== qaOn) fair.cameraMismatchTicks++;
      const th = f.threatOfNpc(n);
      const lan = lanyardOf(sim, n);
      const arrow = !coreOn && ARROW_LANYARDS.has(lan) && (th === 'turning' || th === 'approaching');
      if (lan === 'background' && !coreOn && (th === 'turning' || th === 'approaching')) bgArrow++;
      const h = hist.get(n) ?? [];
      // 시선 시작(onset)
      const wasSeeing = snapsSeeing.get(n) === true;
      if (f.seeing[k] && !wasSeeing) {
        fair.onsets++;
        let cause: string;
        if (n.mode === 'look' && s.mode === 'tell') cause = 'tellLook';
        else if (angleDiff(n.facing, s.facing) > 1e-6 && !canSee(f.map, n.pos, s.facing, n.cone, f.player.pos)) cause = `turnNoTell(${s.mode}->${n.mode})`;
        else if (canSee(f.map, { x: s.x, y: s.y }, s.facing, n.cone, f.player.pos)) cause = 'playerEnter';
        else cause = 'npcAdvance';
        fair.onsetCauses[cause] = (fair.onsetCauses[cause] ?? 0) + 1;
        if (freezeEndAt >= 0 && now - freezeEndAt <= 3) { ceo.resumeOnsets++; if (cause !== 'tellLook' && cause !== 'playerEnter') ceo.resumeNoTell++; }
        const window = h.slice(-LEAD);
        const ok = window.length >= LEAD && window.every(Boolean);
        if (!ok) {
          fair.onsetNoLead++;
          if (fair.onsetNoLeadSamples.length < 8) fair.onsetNoLeadSamples.push(`${content.day}일 ${seed} t=${now.toFixed(2)} ${key} 창 ${window.filter(Boolean).length}/${LEAD}틱 ${cause}`);
        }
      }
      h.push(coreOn || arrow);
      if (h.length > LEAD + 2) h.shift();
      // 전조·페이크
      if (n.mode === 'tell' && s.mode !== 'tell') { s.tellStart = now - H; s.tellKind = n.tellKind; }
      if (n.mode === 'look' && s.mode !== 'look') {
        fair.looks++;
        if (s.mode !== 'tell') { fair.lookWithoutTell++; if (fair.lookSamples.length < 8) fair.lookSamples.push(`${key} ${s.mode}->look t=${now.toFixed(2)}`); }
        else {
          const dur = now - s.tellStart;
          const req = s.tellKind === 'talk' ? 0.5 : 0.4;
          if (dur < req - 1e-6) { fair.lookShortTell++; if (fair.lookSamples.length < 8) fair.lookSamples.push(`${key} tell(${s.tellKind}) ${dur.toFixed(3)}s`); }
        }
      }
      if (s.mode === 'tell' && s.tellKind === 'look' && n.mode !== 'tell') {
        const fk = (fair.fakes[key] ??= { tells: 0, fakes: 0, consecutive: 0 });
        const isFake = n.mode === 'fake';
        fk.tells++;
        if (isFake) { fk.fakes++; if (s.lastLookFake === true) fk.consecutive++; }
        s.lastLookFake = isFake;
      }
      // releaseSec: 보내 준 직후 그 NPC로 인한 상승 없음(ignoresPlayer면 seeing false여야 함)
      if (n.releaseLeft > 0 && f.seeing[k]) ts(n.def.actorId ?? '?').releaseGainTicks++;
      // INT-08 퇴근 전조(회의 끝 '수고하셨습니다~' 대기) 중 상승
      if (sim.phase === 'leave' && n.def.patrolId && /meeting/.test(n.def.patrolId) && n.stopId === 'stop_in_meeting' && (n.mode === 'wait' || n.mode === 'hold')) {
        int08Ticks++;
        if (delta > 1e-12 && f.seeing[k]) int08Rise += delta;
      }
      s.mode = n.mode; s.facing = n.facing; s.x = n.x; s.y = n.y; if (n.mode !== 'tell') s.tellKind = n.tellKind;
      snaps.set(n, s);
      snapsSeeing.set(n, f.seeing[k] === true);
    });
    if (postTalkUntil >= now && delta > 1e-12 && !instant) {
      const tn = [...talkWarnAt.keys()][0]; void tn;
      ts('postTalk').postHoldViol++;
    }
    if (delta > 1e-12) {
      if (!instant && !anySee) {
        if (ceoActiveBefore || sim.frozen) instant = 'ceo_freeze_rule';
        else if (sim.follower) instant = 'accomplice_seen';
        else if (dayEv.some((e) => e.type === 'qte' && e.stage === 'result')) instant = 'qte_penalty';
      }
      if (!anySee && !instant) fair.unexplainedRiseTicks++;
      const cat = instant ? instant.split(':')[0]! : `gaze_${sim.posture}`;
      suspGain[cat] = (suspGain[cat] ?? 0) + delta;
    }
    if (phaseBefore === 'leave' && stageBefore === 'gate' && sim.leaveStage === 'gate') {
      gateSec += H;
      if (delta > 1e-12 && instant !== 'gate_beep') gateRise += delta;
      if (delta > 1e-12 && instant !== 'gate_beep' && delta / H > (content.floor.rules.suspicion.disguiseStalePerSec ?? 0) * 2.0 + 1e-9) gateNonStale += delta;
    }
    if ((sim.phase as string) === 'ended' && sim.result?.outcome === 'caught') caughtCause = instant || `gaze:${sim.result.caughtBy ?? '?'}:${lastPostureSee(sim)}`;
  }
  const r = sim.result;
  const snapsMissions = sim.missions.map((m) => ({ id: m.def.id, started: missionStart.has(m.def.id), ...(mres.get(m.def.id) ?? { state: m.state }) }));
  const leaveEnd = r && (r.outcome === 'leave' || r.outcome === 'leave_short') ? r.timeSec : null;
  // 게이트 단계 상승 중 정체 규칙 외(위장 정체 0.03×배율이 아닌 상승) — 단계 내 상승률로 판정
  return {
    day: content.day, bot: botP.name, seed, rank: content.rankId,
    outcome: r?.outcome ?? 'timeout', stars: r?.stars ?? -1, timeSec: (r?.timeSec ?? f.time) + content.introSec, peak: f.suspicion.peak,
    work: sim.work, quota: content.work.quota, missionsDone: sim.missionsDone(), missionsTotal: sim.missions.length, missionsRequired: content.missionsRequired,
    missions: snapsMissions, caughtBy: r?.caughtBy ?? null, caughtCause,
    leaveStart, leaveSec: leaveEnd !== null && leaveStart >= 0 ? leaveEnd - leaveStart : null,
    leaveIntsStarted: [...leaveInts].filter((x) => x !== 'INT-01'), leaveTalkSec, leaveBlockedSec,
    gateAttempts: sim.gateAttempts, gateFails, earlyBonus, slack: r?.slackPoints ?? 0, closeCalls,
    maxOnScreen: maxOn, maxOnScreenFull: maxFull, maxOnFloor: maxFloor,
    bgGaze, bgArrow, bgBlocked, bgWaitTicks: bgWait,
    gateStageRise: gateRise, gateStageNonStaleRise: gateNonStale, gateStageSec: gateSec,
    int08TellRise: int08Rise, int08TellTicks: int08Ticks, int04BlockWaitSec: int04Wait,
    suspGain, talk, fair,
    ceo: { ...ceo, visit: r?.ceoVisit ?? 'none', eyeContact: r?.eyeContact ?? false },
    elevCeo: { ...elevCeo, caughtAfter: elevCeo.started && r?.outcome === 'caught' },
    acc, continued: r?.continued ?? false,
  };
}

const snapsSeeing = new WeakMap<PatrolNpc, boolean>();

function activitySnackNoise(_f: SimEvent[], d: DayEvent[]): boolean {
  return d.some((e) => e.type === 'toast' && e.key === 'event.snack.noise');
}
function zoneTileNear(t: { x: number; y: number }, x: number, y: number, r: number): boolean {
  return Math.abs(t.x - x) <= r && Math.abs(t.y - y) <= r;
}
function lastPostureSee(sim: DaySim): string { return sim.posture; }
