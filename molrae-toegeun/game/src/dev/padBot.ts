/**
 * T-170 개발용 단순 봇(스모크·성별 대칭 검사, QA 정식 봇 아님). 옛 탭 봇과 같은 규칙을 패드 입력으로 한다.
 * 미션을 순서대로(시작 칸까지 걸어가 행동 버튼/칩), 전조·시선이 보이면 손 떼기, 끝나면 자리로, 퇴근은 게이트까지.
 * 매 스텝: bot.beforeStep() → sim.step() → bot.afterStep(i)
 */
import { PadPilot, type DaySim } from '../core';

export interface PadBotOpts {
  /** 업무 게이지가 할당량의 이 비율 이상이면 미션 출발 */
  readonly workBeforeMission: number;
  /** 시설 미션(화장실 피신)을 먼저 고름 */
  readonly preferFacility?: boolean;
}

export class PadBot {
  readonly pilot: PadPilot;
  private stoppedAt = -1;
  constructor(private readonly sim: DaySim, private readonly opts: PadBotOpts) { this.pilot = new PadPilot(sim); }

  beforeStep(): void { this.pilot.drive(); }

  afterStep(i: number): void {
    const sim = this.sim, f = sim.floor, p = f.player, c = sim.content, pilot = this.pilot;
    // 인사 QTE는 '!' 창에서 짧게 톡, 얼음 중에는 손 떼고 기다림, 공범 제안은 수락
    if (sim.qteActive) { if (sim.qte!.phase === 'window') sim.tapAction(0.1); return; }
    if (sim.frozen) { if (!pilot.paused && pilot.goal) pilot.pause(); this.stoppedAt = sim.time; return; }
    if (sim.offer && sim.actionState().kind === 'accept') sim.tapAction();
    if (sim.leaveStage === 'gate' && Math.abs(sim.gateMarker - 0.5) < sim.gateWindow / 4) { sim.tapAction(); return; }
    if (sim.phase === 'intro' || i % 6 !== 0) return;
    const threatened = f.npcs.some((n) => { const th = f.threatOfNpc(n); return (th === 'seeing' || th === 'turning') && n.gazeMultiplier > 0; });
    if (p.mode === 'moving' && !p.onPath && threatened && !sim.gateOpen) { pilot.pause(); this.stoppedAt = sim.time; return; }
    if (pilot.paused && !threatened && sim.time - this.stoppedAt > 0.3) { pilot.resume(); return; }
    const v = sim.activityView();
    if (v) {
      if (v.kind === 'pour' && !v.paused && v.level >= v.band[0] + 0.03) sim.tapAction();
      else if (v.kind === 'restroom' && v.restLeft <= 0 && v.bonusSec >= v.bonusMax - 0.01) sim.tapAction();
      else if (v.kind === 'nap' && ((!v.headUp && v.head > 0.75) || (v.headUp && v.head < 0.1))) sim.tapAction();
      else if (v.kind === 'snack' && v.sinceLast >= 0.7) sim.tapAction();
      else if (v.kind === 'grab' && v.done) sim.tapAction();
      else if (v.kind === 'queue' && v.stage === 'window') sim.tapAction();
      return;
    }
    if (pilot.busy || pilot.paused || p.mode === 'talked' || p.onPath || threatened) return;
    if (sim.phase === 'day') {
      const carry = sim.missions.find((m) => m.state === 'carry');
      const opens = sim.missions.filter((m) => m.state === 'open' && !m.blocked);
      if (this.opts.preferFacility) opens.sort((a, b) => Number(!!b.def.facilityMission) - Number(!!a.def.facilityMission));
      // 출력 작업이 나와 있으면 그것부터(프린터에서 집기)
      const open = opens.find((m) => !!m.job) ?? opens[0];
      if (carry) { if (!sim.playerAtSeat) pilot.goTo(c.playerSeat); else pilot.stop(); }
      else if (open && (sim.work >= c.work.quota * this.opts.workBeforeMission || !!open.job)) {
        const t = sim.missionStartTile(open);
        if (p.tile.x === t.x && p.tile.y === t.y && p.stoppedAtCenter) { pilot.stop(); sim.tapChip(open.def.id); }
        else pilot.goTo(t);
      } else if (!sim.playerAtSeat) pilot.goTo(c.playerSeat);
      else pilot.stop();
    } else if (sim.phase === 'leave') {
      if (sim.leaveStage === 'walk') pilot.goTo(c.leave.gate.spot);
      else if (sim.leaveStage === 'pack' && !sim.playerAtSeat) pilot.goTo(c.playerSeat);
      else pilot.stop();
    }
  }
}
