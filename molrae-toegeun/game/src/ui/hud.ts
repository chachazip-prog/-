/**
 * 게임 HUD (카메라 고정, 라이트 모드). 상단: 시계·의심·업무(할당량 눈금)·간식 / 하단: 미션 칩.
 * 미션 칩·HUD 영역 탭은 '화면 탭'으로 치지 않는다(rules.input.hudTapDoesNotStop) → 씬이 hitTest로 먼저 걸러 냄.
 * 색·맥동은 art/palette.json overlay(gauge_danger, border_*), 칩 상태 규격은 style-guide §11-4.
 */
import Phaser from 'phaser';
import { HUD_BOTTOM_PX, HUD_TOP_PX, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import type { Strings } from '../content/strings';
import type { DaySim } from '../core/day/daySim';
import { color, overlay, pulseAlpha } from '../render/palette';
import { ATLAS_KEY, iconFallback } from '../render/sprites';
import { addPixelText, fitPanel, placeText, setPixelText, setWrap, type UIText } from './pixelText';

const DEPTH = 10000;
const CHIP = 24;
const CHIP_GAP = 4;
const BAR_X = 52;

export type BorderStage = 'calm' | 'alert' | 'finale' | 'danger';

export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly border: Phaser.GameObjects.Graphics;
  private readonly clock: UIText;
  private readonly rank: UIText;
  private readonly pct: UIText;
  private readonly snack: UIText;
  private readonly chipIcons: Phaser.GameObjects.Image[] = [];
  private readonly chipDone: Phaser.GameObjects.Image[] = [];
  /** 변형 배지 대체 점(아트 mod/* 전) */
  private readonly modDots: { x: number; y: number }[] = [];
  private readonly stageText: UIText;
  private readonly leaveIcon: Phaser.GameObjects.Image | null;
  private readonly panelText: UIText;
  private readonly hintText: UIText;
  private readonly hintBg: Phaser.GameObjects.Rectangle;
  private readonly hasAtlas: boolean;
  private readonly offerText: UIText;
  private readonly offerIcon: Phaser.GameObjects.Image | null;
  private offerBox: { x: number; y: number; w: number; h: number } | null = null;
  private hintQueue: string[] = [];
  private hintLeft = 0;
  private flash: { color: number; alpha: number; left: number; on: number; off: number } | null = null;

  constructor(scene: Phaser.Scene, private readonly sim: DaySim, private readonly str: Strings) {
    this.hasAtlas = scene.textures.exists(ATLAS_KEY);
    const ink = color('outline');
    this.border = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH - 1);
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    const fixed = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T): T => { o.setScrollFactor(0); o.setDepth(DEPTH + 1); return o; };
    this.clock = fixed(addPixelText(scene, 0, 0, fmtClock(sim.clockMin), { role: 'num', color: ink })); // 데이터 시계(rules.day.clockStart)
    this.rank = fixed(addPixelText(scene, 0, 0, str.t(`rank.${sim.content.rankId}.name`), { role: 'label', color: color('dark') }));
    placeText(fixed(addPixelText(scene, 0, 0, str.t('hud.suspicion'), { role: 'label', color: ink })), 30, 6, 0, 0.5);
    placeText(fixed(addPixelText(scene, 0, 0, str.t('hud.work'), { role: 'label', color: ink })), 30, 18, 0, 0.5);
    this.pct = fixed(addPixelText(scene, 0, 0, '0%', { role: 'num', color: ink }));
    this.snack = fixed(addPixelText(scene, 0, 0, '1', { role: 'num', color: ink }));
    if (this.hasAtlas) fixed(scene.add.image(150, 18, ATLAS_KEY, 'icon_snack'));
    sim.missions.forEach((m, i) => {
      const x = 4 + i * (CHIP + CHIP_GAP) + CHIP / 2, y = LOGICAL_HEIGHT - HUD_BOTTOM_PX / 2;
      if (this.hasAtlas) {
        // 새 미션 아이콘(T-146 작업 중)이 아직 없으면 기존 아이콘으로 대체
        const tex = scene.textures.get(ATLAS_KEY);
        this.chipIcons.push(fixed(scene.add.image(x, y, ATLAS_KEY, tex.has(m.def.iconSprite) ? m.def.iconSprite : iconFallback(m.def.iconSprite))));
        // 변형 배지(mod/<type>, 8×8): 아트가 없으면 칩 오른쪽 위 작은 점
        const mt = m.def.modifierTypes?.[0];
        if (mt && tex.has(`mod/${mt}`)) fixed(scene.add.image(x + CHIP / 2 - 4, y - CHIP / 2 + 4, ATLAS_KEY, `mod/${mt}`));
        else if (mt) this.modDots.push({ x: x + CHIP / 2 - 4, y: y - CHIP / 2 + 3 });
        this.chipDone.push(fixed(scene.add.image(x + CHIP / 2 - 3, y - CHIP / 2 + 3, ATLAS_KEY, 'icon_done')).setVisible(false));
      }
    });
    this.leaveIcon = this.hasAtlas ? fixed(scene.add.image(4 + CHIP / 2, LOGICAL_HEIGHT - HUD_BOTTOM_PX / 2, ATLAS_KEY, 'icon_leave')).setVisible(false) : null;
    this.stageText = fixed(addPixelText(scene, 0, 0, '', { role: 'label', color: ink }));
    this.panelText = fixed(addPixelText(scene, 0, 0, '', { role: 'label', color: ink }));
    this.hintBg = fixed(scene.add.rectangle(0, 0, 1, 1, 0xffffff, 0.94)).setStrokeStyle(1, color('dark'));
    this.hintText = fixed(addPixelText(scene, 0, 0, '', { role: 'label', color: ink, lineSpacing: 2 }));
    setWrap(this.hintText, LOGICAL_WIDTH - 20);
    this.hintBg.setDepth(DEPTH + 1); this.hintText.setDepth(DEPTH + 2);
    this.offerText = fixed(addPixelText(scene, 0, 0, '', { role: 'label', color: ink }));
    setWrap(this.offerText, LOGICAL_WIDTH - 40);
    this.offerIcon = this.hasAtlas ? fixed(scene.add.image(0, 0, ATLAS_KEY, 'hud/offer')).setVisible(false) : null;
  }

  /** 지금 떠 있는 안내를 닫음(모든 안내는 건너뛸 수 있음, GDD §13) */
  dismissHint(): void { this.hintLeft = 0; }

  /** HUD가 가로챌 탭인가(칩 id, 'hud', null = 지도 탭) */
  hitTest(x: number, y: number): string | null {
    if (y < HUD_TOP_PX) return 'hud';
    const ob = this.offerBox;
    if (ob && x >= ob.x && x < ob.x + ob.w && y >= ob.y && y < ob.y + ob.h) return 'offer';
    if (this.hintLeft > 0 && this.hintBg.visible) {
      const hb = this.hintBg.getBounds();
      if (hb.contains(x, y)) return 'hint';
    }
    if (y >= LOGICAL_HEIGHT - HUD_BOTTOM_PX) {
      const i = Math.floor((x - 4) / (CHIP + CHIP_GAP));
      const m = this.sim.missions[i];
      const inChip = m && x - 4 - i * (CHIP + CHIP_GAP) < CHIP;
      return inChip && this.sim.phase === 'day' ? `chip:${m.def.id}` : 'hud';
    }
    return null;
  }

  hint(key: string): void {
    if (this.hintQueue.includes(key)) return;
    this.hintQueue.push(key);
  }

  /** 게이트 등 짧은 화면 깜빡임(무음 대응 visualCues) */
  flashScreen(cueKey: string, flashes: number, onSec: number, offSec: number): void {
    const o = overlay(cueKey);
    this.flash = { color: o.color, alpha: o.alpha, left: flashes * (onSec + offSec), on: onSec, off: offSec };
  }

  update(dt: number, t: number, stage: BorderStage): void {
    const sim = this.sim, g = this.g;
    g.clear();
    // 상단
    g.fillStyle(0xffffff, 1).fillRect(0, 0, LOGICAL_WIDTH, HUD_TOP_PX);
    g.fillStyle(color('light'), 1).fillRect(0, HUD_TOP_PX - 1, LOGICAL_WIDTH, 1);
    setPixelText(this.clock, fmtClock(sim.clockMin));
    placeText(this.clock, 3, 6, 0, 0.5);
    placeText(this.rank, 3, 18, 0, 0.5);
    // 의심 게이지 (visualCues.suspicionHigh: 임계 이상이면 빨강 맥동, 아래는 노랑)
    const sv = sim.suspicion;
    const cue = (sim.content.visualCues['suspicionHigh'] ?? {}) as Record<string, unknown>;
    const thr = typeof cue['threshold'] === 'number' ? cue['threshold'] as number : 0.7;
    const bw = 92;
    g.fillStyle(color('light'), 1).fillRect(BAR_X, 3, bw, 6);
    const danger = sv >= thr;
    const gd = overlay('gauge_danger');
    g.fillStyle(danger ? gd.color : color('point2'), danger ? pulseAlpha(gd, t) + 0.25 : 1).fillRect(BAR_X, 3, Math.round(bw * sv), 6);
    const edgeOn = danger && Math.floor(t / ((gd.periodSec ?? 0.5) / 2)) % 2 === 0;
    g.lineStyle(1, danger ? (edgeOn ? 0xffffff : gd.color) : color('mid'), 1).strokeRect(BAR_X - 0.5, 2.5, bw + 1, 7);
    setPixelText(this.pct, `${Math.round(sv * 100)}%`);
    placeText(this.pct, BAR_X + bw + 4, 6, 0, 0.5);
    // 업무 게이지 + 할당량 눈금
    const ww = 80;
    g.fillStyle(color('light'), 1).fillRect(BAR_X, 15, ww, 6);
    const met = sim.work >= sim.content.work.quota;
    g.fillStyle(met ? color('green_sh') : color('shirt'), 1).fillRect(BAR_X, 15, Math.round(ww * sim.work), 6);
    g.lineStyle(1, color('mid'), 1).strokeRect(BAR_X - 0.5, 14.5, ww + 1, 7);
    const qx = BAR_X + Math.round(ww * sim.content.work.quota);
    g.fillStyle(color('outline'), 1).fillRect(qx, 13, 1, 10);
    if (sim.seatedWorking && Math.floor(t * 2) % 2 === 0) g.fillStyle(0xffffff, 0.5).fillRect(BAR_X, 15, Math.round(ww * sim.work), 2);
    setPixelText(this.snack, String(sim.snackStock));
    placeText(this.snack, 158, 18, 0, 0.5);

    // 하단 미션 칩
    const by = LOGICAL_HEIGHT - HUD_BOTTOM_PX;
    g.fillStyle(0xffffff, 1).fillRect(0, by, LOGICAL_WIDTH, HUD_BOTTOM_PX);
    g.fillStyle(color('light'), 1).fillRect(0, by, LOGICAL_WIDTH, 1);
    const leaving = sim.phase === 'leave' || (sim.phase === 'ended' && sim.result?.outcome !== 'caught' && sim.leaveTime > 0);
    this.leaveIcon?.setVisible(leaving);
    sim.missions.forEach((m, i) => {
      this.chipIcons[i]?.setVisible(!leaving);
      if (!leaving) for (const d of this.modDots) g.fillStyle(color('point'), 1).fillRect(d.x - 1, d.y - 1, 3, 3);
    if (leaving) { this.chipDone[i]?.setVisible(false); return; }
      const x = 4 + i * (CHIP + CHIP_GAP), y = by + 2;
      const st = m.state;
      const locked = st === 'locked' || m.blocked || sim.phase !== 'day' && st !== 'done';
      const border = st === 'done' ? color('green_sh') : st === 'active' || st === 'carry' || sim.pendingMission === m ? color('cool') : locked ? color('light') : color('outline');
      g.fillStyle(0xffffff, 1).fillRect(x, y, CHIP, CHIP);
      g.lineStyle(st === 'active' || st === 'carry' || st === 'done' ? 2 : 1, border, 1).strokeRect(x + 0.5, y + 0.5, CHIP - 1, CHIP - 1);
      this.chipDone[i]?.setVisible(st === 'done');
      this.chipIcons[i]?.setAlpha(st === 'failed' ? 0.35 : 1);
      if (locked && st !== 'failed') g.fillStyle(color('light'), 0.5).fillRect(x + 1, y + 1, CHIP - 2, CHIP - 2);
      if (st === 'failed') g.lineStyle(1, color('mid'), 1).lineBetween(x + 4, y + CHIP - 4, x + CHIP - 4, y + 4);
      if (m.startedAt !== null && (st === 'active' || st === 'carry' || st === 'open')) {
        const left = Math.max(0, 1 - (sim.time - m.startedAt) / m.def.timeLimitSec);
        g.fillStyle(left < 0.3 ? color('point2') : color('cool'), 1).fillRect(x + 2, y + CHIP - 3, Math.round((CHIP - 4) * left), 1);
      }
    });
    if (leaving) {
      g.fillStyle(0xffffff, 1).fillRect(4, by + 2, CHIP, CHIP);
      g.lineStyle(2, color('green_sh'), 1).strokeRect(4.5, by + 2.5, CHIP - 1, CHIP - 1);
    }
    // 단계 문구(하단 칩 오른쪽)
    let stageKey = '';
    if (sim.phase === 'leave') stageKey = sim.leaveStage === 'pack' ? 'event.leave.pack' : sim.leaveStage === 'gate' ? 'event.leave.gate' : sim.leaveStage === 'elevator' ? 'event.leave.elevator' : 'event.leave.name';
    else if (sim.hrCountdown !== null) stageKey = 'hud.seat_countdown';
    else if (sim.ceoState === 'tell' || sim.ceoState === 'freeze') stageKey = 'hud.ceo_freeze';
    const stageStr = stageKey ? this.str.t(stageKey, { n: Math.ceil(sim.hrCountdown ?? 0) }) : '';
    setPixelText(this.stageText, stageStr);
    const chipsRight = leaving ? 4 + CHIP + 6 : 4 + sim.missions.length * (CHIP + CHIP_GAP) + 2;
    placeText(this.stageText, chipsRight, by + HUD_BOTTOM_PX / 2, 0, 0.5);

    if (sim.phase !== 'ended') this.drawPanel(t); else setPixelText(this.panelText, '');
    this.drawOffer();
    this.drawHint(dt);
    this.drawBorder(t, stage, dt);
  }

  /** 미션 행동·가방·게이트 진행 패널(하단 칩 바로 위) */
  private drawPanel(t: number): void {
    const sim = this.sim, g = this.g;
    const y0 = LOGICAL_HEIGHT - HUD_BOTTOM_PX - 22, x0 = 6, w = LOGICAL_WIDTH - 12;
    let label = '';
    const bar = (v: number, col: number, band?: readonly [number, number], mark?: number) => {
      const bx = x0 + 4, bwid = w - 8, bY = y0 + 14;
      g.fillStyle(color('light'), 1).fillRect(bx, bY, bwid, 5);
      if (band) g.fillStyle(color('green'), 1).fillRect(bx + Math.round(bwid * band[0]), bY - 1, Math.max(1, Math.round(bwid * (band[1] - band[0]))), 7);
      g.fillStyle(col, 1).fillRect(bx, bY, Math.round(bwid * Math.min(1, Math.max(0, v))), 5);
      if (mark !== undefined) g.fillStyle(color('outline'), 1).fillRect(bx + Math.round(bwid * mark) - 1, bY - 2, 2, 9);
    };
    const v = sim.activityView();
    let show = true;
    if (v) {
      switch (v.kind) {
        case 'pour': label = this.str.t(v.paused ? 'event.coffee.paused' : 'event.coffee.name'); break;
        case 'restroom': label = this.str.t(v.restLeft > 0 ? 'event.restroom.inside' : 'event.restroom.leave_hint'); break;
        case 'nap': label = this.str.t(v.head > 0.7 && !v.headUp ? 'event.nap.head_warning' : v.headUp ? 'event.nap.head_up' : 'event.nap.name'); break;
        case 'shop': label = v.items >= v.itemsRequired ? this.str.t('event.shopping.checkout') : this.str.t('event.shopping.cart', { n: v.items, total: v.itemsRequired }); break;
        case 'snack': label = `${this.str.t(sim.activeMissionDef?.nameKey ?? 'event.snack.name')} ${v.bites}/${v.required}`; break;
        // T-145 새 방식
        case 'fetch': label = this.str.t(sim.activeMissionDef?.nameKey ?? 'event.parcel.name'); break;
        case 'remote_start': label = this.str.t(sim.activeMissionDef?.nameKey ?? 'event.print.name'); break;
        case 'grab': label = `${this.str.t(sim.activeMissionDef?.nameKey ?? 'event.print.name')} ${v.pages}/${v.pagesRequired}`; break;
        case 'queue': label = this.str.t(sim.activeMissionDef?.nameKey ?? 'event.cafe.name'); break;
      }
      if (v.kind === 'pour' && sim.activeMissionDef && sim.activeMissionDef.id !== 'coffee') label = this.str.t(sim.activeMissionDef.nameKey);
    } else if (sim.phase === 'leave' && sim.leaveStage === 'pack') label = this.str.t('event.leave.pack');
    else if (sim.phase === 'leave' && sim.leaveStage === 'gate') {
      const left = sim.content.leave.gate.maxAttempts - sim.gateAttempts;
      label = this.str.t('hud.gate_attempts_left', { n: left });
    } else show = false;
    setPixelText(this.panelText, show ? label : '');
    if (!show) return;
    g.fillStyle(0xffffff, 0.94).fillRect(x0, y0, w, 21);
    g.lineStyle(1, color('dark'), 1).strokeRect(x0 + 0.5, y0 + 0.5, w - 1, 20);
    placeText(this.panelText, x0 + 4, y0 + 6, 0, 0.5);
    if (v) {
      switch (v.kind) {
        case 'pour': bar(v.level / v.overflow, color('wood_sh'), [v.band[0] / v.overflow, v.band[1] / v.overflow]); break;
        case 'restroom': bar(v.restLeft > 0 ? 1 - v.restLeft / 3 : v.bonusSec / v.bonusMax, v.restLeft > 0 ? color('cool') : color('point2')); break;
        case 'nap': bar(v.head, v.head >= v.threshold ? color('point2') : color('suit'), undefined, 1 - v.fatigue); break;
        case 'shop': bar(v.items >= v.itemsRequired ? v.checkout / v.checkoutSec : (v.items + v.cart) / v.itemsRequired, v.shopping ? color('suit') : color('green_sh')); break;
        case 'snack': bar(Math.min(1, v.sinceLast / (v.window[1] * 1.2)), v.sinceLast >= v.window[0] && v.sinceLast <= v.window[1] ? color('green') : color('mid'),
          [v.window[0] / (v.window[1] * 1.2), v.window[1] / (v.window[1] * 1.2)]); break;
        case 'fetch': bar(v.progress / v.total, v.paused ? color('green_sh') : color('suit')); break;
        case 'remote_start': bar(v.progress / v.total, color('suit')); break;
        case 'grab': bar(v.pages / v.pagesRequired, v.done ? color('green') : v.paused ? color('mid') : color('cool')); break;
        case 'queue': bar(v.progress / Math.max(0.01, v.total), v.stage === 'window' ? color('green') : v.stage === 'tell' ? color('point2') : v.paused ? color('green_sh') : color('suit')); break;
      }
    } else if (sim.leaveStage === 'pack') bar(sim.packProgress / sim.content.leave.packSec, color('green_sh'));
    else if (sim.leaveStage === 'gate') {
      const wnd = sim.gateWindow;
      const wc = sim.content.leave.gate.windowCenter ?? 0.5;
      bar(0, color('mid'), [wc - wnd / 2, wc + wnd / 2], sim.gateMarker);
      void t;
    }
  }

  /** 공범 제안 말풍선(INT-12): 칩 위에 고정 패널로 띄우고, 패널 탭 = 수락(HUD 입력) */
  private drawOffer(): void {
    const o = this.sim.offer;
    const show = !!o && this.sim.phase === 'day';
    this.offerText.setVisible(show);
    this.offerIcon?.setVisible(show);
    if (!show || !o) { this.offerBox = null; return; }
    setPixelText(this.offerText, this.str.t(o.textKey));
    const x0 = 6, w = LOGICAL_WIDTH - 12;
    const y0 = LOGICAL_HEIGHT - HUD_BOTTOM_PX - 22 - 26;
    const g = this.g;
    g.fillStyle(0xffffff, 0.96).fillRect(x0, y0, w, 22);
    g.lineStyle(2, color('green_sh'), 1).strokeRect(x0 + 1, y0 + 1, w - 2, 20);
    this.offerIcon?.setPosition(x0 + 12, y0 + 11);
    placeText(this.offerText, x0 + 24, y0 + 11, 0, 0.5);
    // 남은 시간 막대(강제 제안이면 없음)
    if (Number.isFinite(o.left)) {
      const k = Math.max(0, o.left / (this.sim.content.accomplice?.offerSec ?? 2.5));
      g.fillStyle(color('green'), 1).fillRect(x0 + 3, y0 + 18, Math.round((w - 6) * k), 1);
    }
    this.offerBox = { x: x0, y: y0, w, h: 22 };
  }

  private drawHint(dt: number): void {
    if (this.hintLeft <= 0 && this.hintQueue.length > 0) {
      const key = this.hintQueue.shift()!;
      setPixelText(this.hintText, this.str.t(key));
      this.hintLeft = 4.0;
    }
    if (this.hintLeft > 0) this.hintLeft -= dt;
    const vis = this.hintLeft > 0 && this.sim.phase !== 'ended';
    this.hintText.setVisible(vis);
    if (vis) {
      placeText(this.hintText, 10, HUD_TOP_PX + 6, 0, 0);
      fitPanel(this.hintBg, this.hintText, 4, 3);
    } else this.hintBg.setVisible(false);
  }

  private drawBorder(t: number, stage: BorderStage, dt: number): void {
    const b = this.border;
    b.clear();
    const key = `border_${stage}`;
    const o = overlay(key);
    const wpx = o.widthPx ?? 0;
    if (stage !== 'calm' && wpx > 0) {
      const a = pulseAlpha(o, t);
      b.fillStyle(o.color, a);
      const top = HUD_TOP_PX, bot = LOGICAL_HEIGHT - HUD_BOTTOM_PX;
      b.fillRect(0, top, LOGICAL_WIDTH, wpx).fillRect(0, bot - wpx, LOGICAL_WIDTH, wpx);
      b.fillRect(0, top + wpx, wpx, bot - top - wpx * 2).fillRect(LOGICAL_WIDTH - wpx, top + wpx, wpx, bot - top - wpx * 2);
    }
    if (this.flash) {
      const f = this.flash;
      const cyc = f.on + f.off;
      const on = cyc <= 0 || (f.left % cyc) > f.off;
      if (on) b.fillStyle(f.color, f.alpha).fillRect(0, HUD_TOP_PX, LOGICAL_WIDTH, LOGICAL_HEIGHT - HUD_TOP_PX - HUD_BOTTOM_PX);
      f.left -= dt;
      if (f.left <= 0) this.flash = null;
    }
  }
}

function fmtClock(clockMin: number): string {
  const min = Math.floor(clockMin);
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
