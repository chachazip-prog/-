/**
 * 조작대 표시·입력 판정(T-170 control-dpad §1-2·§2·§8, art/style-guide §18): 배경, 4방향 원형 패드, 행동 버튼.
 * 판정 규칙은 input/padJudge.ts(순수), 배치는 ui/deckLayout.ts(오른손·왼손 거울). 이 파일은 그림과 포인터 잡기 상태만 가진다.
 * 아트 키가 아직 없으면 Graphics로 대체 그림을 그린다(라이트 모드, 빨강 없음).
 */
import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import type { ActionState } from '../core/day/daySim';
import { judgePad, type PadDir } from '../input/padJudge';
import { color } from '../render/palette';
import { ATLAS_KEY, iconFallback } from '../render/sprites';
import { deckLayout, inRect, type DeckLayout, type Hand } from './deckLayout';
import { addPixelText, placeText, setPixelText, type UIText } from './pixelText';

const DEPTH = 9990;
/** 화살표 위치: 패드 판 중심 기준(아트 §18) */
const ARROW_OFS: Readonly<Record<PadDir, readonly [number, number]>> = { up: [0, -21], down: [0, 19], left: [-20, -1], right: [20, -1] };
const DIRS: readonly PadDir[] = ['up', 'down', 'left', 'right'];

export interface DeckView {
  /** 지금 누르고 있는 방향(표시: 눌린 화살표) */
  readonly padInput: PadDir | null;
  readonly locked: boolean;
  /** 얼음 중 꾹 누름 진행(0~1), 얼음 아님 = null */
  readonly freeze: number | null;
  readonly action: ActionState;
  readonly actionPressed: boolean;
  /** 튜토리얼 맥동 */
  readonly pulseAction: boolean;
  readonly pulsePad: boolean;
  /** 1일차 ④ '손 떼기' 손가락 그림 */
  readonly handRelease: boolean;
  /** 패드 위 문구(얼음 안내 등) */
  readonly padText: string;
  readonly actionLabel: string;
}

export interface DeckOptions {
  readonly hand: Hand;
  readonly lift: number;
  readonly chips: number;
  readonly deadZonePx: number;
  readonly axisHysteresisDeg: number;
}

export class Deck {
  readonly layout: DeckLayout;
  private readonly hasAtlas: boolean;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly bg: Phaser.GameObjects.Image | null;
  private readonly base: Phaser.GameObjects.Image | null;
  private readonly arrows = new Map<PadDir, Phaser.GameObjects.Image>();
  private readonly btn: Phaser.GameObjects.Sprite | null;
  private readonly icon: Phaser.GameObjects.Image | null;
  private readonly label: UIText;
  private readonly padLabel: UIText;
  private readonly padLabelBg: Phaser.GameObjects.Rectangle;
  private readonly hand: Phaser.GameObjects.Sprite | null;
  private judged: PadDir | null = null;
  private pulsing = false;

  constructor(private readonly scene: Phaser.Scene, private readonly opts: DeckOptions) {
    this.layout = deckLayout(opts.hand, opts.lift, opts.chips);
    this.hasAtlas = scene.textures.exists(ATLAS_KEY);
    const L = this.layout;
    const fix = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T, d = 0): T => { o.setScrollFactor(0); o.setDepth(DEPTH + d); return o; };
    this.g = fix(scene.add.graphics(), 0);
    this.bg = this.has('ui/deck_bg') ? fix(scene.add.image(L.bg.x, L.bg.y, ATLAS_KEY, 'ui/deck_bg'), 0) : null;
    this.g.setDepth(DEPTH + 1);
    this.base = this.has('ui/dpad_base') ? fix(scene.add.image(L.pad.cx, L.pad.cy, ATLAS_KEY, 'ui/dpad_base').setOrigin(0.5, 30.5 / 64), 2) : null;
    for (const d of DIRS) {
      const k = `ui/dpad_arrow_${d}`;
      if (this.has(k)) this.arrows.set(d, fix(scene.add.image(L.pad.cx + ARROW_OFS[d][0], L.pad.cy + ARROW_OFS[d][1], ATLAS_KEY, k), 3));
    }
    this.btn = this.has('ui/action_btn') ? fix(scene.add.sprite(L.action.cx, L.action.cy, ATLAS_KEY, 'ui/action_btn'), 2) : null;
    this.icon = this.hasAtlas ? fix(this.has('ui/action_icon/idle') ? scene.add.image(L.action.cx, L.action.cy - 1, ATLAS_KEY, 'ui/action_icon/idle') : scene.add.image(L.action.cx, L.action.cy - 1, ATLAS_KEY), 3) : null;
    this.label = fix(addPixelText(scene, 0, 0, '', { role: 'label', color: color('outline') }), 3);
    this.padLabelBg = fix(scene.add.rectangle(0, 0, 1, 1, 0xffffff, 0.94).setStrokeStyle(1, color('cool')), 4).setVisible(false);
    this.padLabel = fix(addPixelText(scene, 0, 0, '', { role: 'label', color: color('outline') }), 5);
    this.hand = this.has('tutorial/hand_release_0') ? fix(scene.add.sprite(0, 0, ATLAS_KEY, 'tutorial/hand_release_0'), 6).setVisible(false) : null;
    if (this.hand) {
      const left = opts.hand === 'left';
      this.hand.setFlipX(left).setOrigin(left ? 0.5625 : 0.4375, 0.0625).setPosition(L.pad.cx + (left ? -6 : 6), L.pad.cy + 4);
      if (scene.anims.exists('tutorial/hand_release')) this.hand.play('tutorial/hand_release');
    }
  }

  private has(frame: string): boolean { return this.hasAtlas && this.scene.textures.get(ATLAS_KEY).has(frame); }

  /** 조작대 영역(칩·버튼·패드 전체) */
  inDeck(_x: number, y: number): boolean { return y >= this.layout.top; }
  hitPad(x: number, y: number): boolean { return inRect(this.layout.pad.hit, x, y); }
  hitAction(x: number, y: number): boolean { return inRect(this.layout.action.hit, x, y); }

  /** 패드 방향 판정(포인터 잡기: 패드 밖이어도 각도로 판정, 히스테리시스는 직전 방향 기준) */
  judge(x: number, y: number): PadDir | null {
    this.judged = judgePad(x - this.layout.pad.cx, y - this.layout.pad.cy, this.judged, this.opts.deadZonePx, this.opts.axisHysteresisDeg);
    return this.judged;
  }

  resetJudge(): void { this.judged = null; }

  update(t: number, v: DeckView): void {
    const L = this.layout, g = this.g;
    g.clear();
    // 배경(아트 없으면 밝은 판 + 위 1px 외곽선). 세이프 에어리어로 올렸으면 아래 여백도 같은 색
    if (!this.bg) {
      g.fillStyle(color('wall'), 1).fillRect(0, L.top, LOGICAL_WIDTH, LOGICAL_HEIGHT - L.top);
      g.fillStyle(color('outline'), 1).fillRect(0, L.top, LOGICAL_WIDTH, 1);
    } else if (L.top + 72 < LOGICAL_HEIGHT) g.fillStyle(color('wall'), 1).fillRect(0, L.top + 72, LOGICAL_WIDTH, LOGICAL_HEIGHT - L.top - 72);
    // 패드
    const frozen = v.freeze !== null;
    const padAlpha = v.locked ? 0.4 : 1;
    // 튜토리얼 패드 맥동(1초에 1회)
    const pulse = v.pulsePad && !v.padInput && (t % 1) < 0.5;
    if (this.base) {
      this.base.setFrame(frozen && this.has('ui/dpad_base_frozen') ? 'ui/dpad_base_frozen' : v.locked && this.has('ui/dpad_base_locked') ? 'ui/dpad_base_locked' : 'ui/dpad_base');
      this.base.setAlpha(v.locked ? 0.4 : 1).setScale(1);
    } else {
      g.fillStyle(0xffffff, padAlpha).fillCircle(L.pad.cx, L.pad.cy, 30);
      g.lineStyle(frozen ? 2 : 1, frozen ? color('cool') : color('outline'), padAlpha).strokeCircle(L.pad.cx, L.pad.cy, 30);
      g.fillStyle(color('mid'), padAlpha).fillCircle(L.pad.cx, L.pad.cy, 2);
    }
    if (pulse) g.lineStyle(1, color('point2'), 1).strokeCircle(L.pad.cx, L.pad.cy, 33);
    for (const d of DIRS) {
      const on = v.padInput === d && !v.locked;
      const im = this.arrows.get(d);
      if (im) {
        im.setFrame(on && this.has(`ui/dpad_arrow_${d}_pressed`) ? `ui/dpad_arrow_${d}_pressed` : `ui/dpad_arrow_${d}`).setAlpha(padAlpha);
      } else {
        // 대체 화살표: 삼각형(눌림 = 1px 내려감 + 진함, 색만으로 구분하지 않음)
        const [ox, oy] = ARROW_OFS[d];
        const cx = L.pad.cx + ox, cy = L.pad.cy + oy + (on ? 1 : 0);
        const c = on ? color('suit') : color('outline');
        g.fillStyle(c, padAlpha);
        const s = 5;
        if (d === 'up') g.fillTriangle(cx, cy - s, cx - s, cy + s - 1, cx + s, cy + s - 1);
        else if (d === 'down') g.fillTriangle(cx, cy + s, cx - s, cy - s + 1, cx + s, cy - s + 1);
        else if (d === 'left') g.fillTriangle(cx - s, cy, cx + s - 1, cy - s, cx + s - 1, cy + s);
        else g.fillTriangle(cx + s, cy, cx - s + 1, cy - s, cx - s + 1, cy + s);
      }
    }
    // 얼음 중 꾹 누름 진행(패드 바깥 링)
    if (frozen && v.freeze! > 0 && v.freeze! < 1) {
      g.lineStyle(2, color('cool'), 1);
      g.beginPath();
      g.arc(L.pad.cx, L.pad.cy, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.freeze!, false);
      g.strokePath();
    }
    // 행동 버튼
    const a = v.action;
    const dim = !a.enabled || a.kind === 'none';
    const pressed = v.actionPressed && !dim;
    if (this.btn) {
      const wantPulse = v.pulseAction && !dim && !pressed && this.scene.anims.exists('ui/action_btn_pulse');
      if (wantPulse && !this.pulsing) { this.btn.play('ui/action_btn_pulse'); this.pulsing = true; }
      if (!wantPulse) {
        if (this.pulsing) { this.btn.anims.stop(); this.pulsing = false; }
        this.btn.setFrame(pressed && this.has('ui/action_btn_pressed') ? 'ui/action_btn_pressed' : dim && this.has('ui/action_btn_dim') ? 'ui/action_btn_dim' : 'ui/action_btn');
      }
      this.btn.setAlpha(dim ? 0.4 : 1);
    } else {
      g.fillStyle(0xffffff, dim ? 0.4 : 1).fillCircle(L.action.cx, L.action.cy + (pressed ? 1 : 0), 19);
      g.lineStyle(v.pulseAction && Math.floor(t * 2) % 2 === 0 ? 2 : 1, v.pulseAction ? color('point2') : color('cool'), dim ? 0.4 : 1).strokeCircle(L.action.cx, L.action.cy + (pressed ? 1 : 0), 19);
    }
    if (this.icon) {
      const want = `ui/action_icon/${a.icon}`;
      const mi = a.missionIcon ? (this.has(a.missionIcon) ? a.missionIcon : this.has(iconFallback(a.missionIcon)) ? iconFallback(a.missionIcon) : null) : null;
      const frame = this.has(want) ? want : mi ?? (this.has('ui/action_icon/idle') ? 'ui/action_icon/idle' : null);
      this.icon.setVisible(!!frame);
      if (frame) this.icon.setFrame(frame).setPosition(L.action.cx, L.action.cy + (pressed ? 0 : -1)).setAlpha(dim ? 0.4 : 1);
    }
    setPixelText(this.label, v.actionLabel);
    placeText(this.label, L.action.cx, L.action.labelY + 4, 0.5, 0.5);
    this.label.setAlpha(dim ? 0.5 : 1);
    // 패드 위 문구(얼음! 꾹 눌러야 움직여요): 게임 화면 쪽 조작대 바로 위
    const pt = v.padText;
    this.padLabel.setVisible(pt !== '');
    if (pt) {
      setPixelText(this.padLabel, pt);
      const half = this.padLabel.width / 2 + 4;
      const x = Math.min(LOGICAL_WIDTH - half, Math.max(half, L.pad.cx));
      placeText(this.padLabel, Math.round(x), L.top - 9, 0.5, 0.5);
      this.padLabelBg.setVisible(true).setPosition(Math.round(x), L.top - 9).setSize(this.padLabel.width + 6, this.padLabel.height + 4).setOrigin(0.5, 0.5);
    } else this.padLabelBg.setVisible(false);
    this.hand?.setVisible(v.handRelease);
  }
}
