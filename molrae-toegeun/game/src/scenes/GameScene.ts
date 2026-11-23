import Phaser from 'phaser';
import { CAMERA_VIEW, HUD_BOTTOM_PX, HUD_TOP_PX, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { getStrings, lastAuthoredDay, loadDayContent } from '../content';
import { DaySim, conePolygon, isGateOnly, zoneAt, type DayEvent, type PatrolNpc, type SimEvent, type Threat } from '../core';
import { color, overlay, pulseAlpha } from '../render/palette';
import { ATLAS_KEY, coneOverlayKeys, edgeArrowKey, facing4, spriteKeyFor, type Facing4 } from '../render/sprites';
import { TILE, buildTileLayout } from '../render/tilemap';
import { Hud, type BorderStage } from '../ui/hud';
import { addPixelText, fitPanel, placeText, setPixelText, setWrap, type UIText } from '../ui/pixelText';
import { SceneKey } from './keys';

/** 렌더링 기준값 (게임플레이 수치 아님) */
const CONE_RAYS = 14;
/** 캐릭터 발밑이 타일 중심보다 아래로 내려오는 px (스타일 가이드 §4: depth = 발밑 y) */
const FOOT_PX = 6;
/** 말걸기 전조 시 NPC가 플레이어 쪽으로 다가서는 표시 거리(px) — 판정 위치는 그대로 */
const TALK_LEAN_PX = 2;
const ARROW_MARGIN = 9;
const TOAST_SEC = 1.4;
const D = { ground: -1000, cover: -950, shadow: -900, cone: -800, path: -700, overhead: 5000 } as const;

export interface GameSceneData { day?: number }

interface ActorView {
  sprite: Phaser.GameObjects.Sprite;
  mark: Phaser.GameObjects.Sprite;
  bubble: UIText;
  bubbleBg: Phaser.GameObjects.Rectangle;
  base: string;
  lanyard: string;
  bgIdle?: { anims: readonly string[]; next: number; range: readonly [number, number] };
}

function urlParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}

/**
 * 하루 한 판 씬 (T-129): DaySim(core)이 판정·상태를 소유하고, 씬은 입력 전달과 표시만 한다.
 * 카메라 위치도 코어 CameraModel 값을 그대로 써서 '화면 밖 판정(X10)'과 화면이 일치한다.
 */
export class GameScene extends Phaser.Scene {
  private sim!: DaySim;
  private day = 1;
  private offsetX = 0;
  private hud!: Hud;
  private views = new Map<PatrolNpc, ActorView>();
  private player!: Phaser.GameObjects.Sprite;
  private playerLabel!: UIText;
  private playerLabelBg!: Phaser.GameObjects.Rectangle;
  private shadows!: Phaser.GameObjects.Graphics;
  private cones!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private pathDots: Phaser.GameObjects.Image[] = [];
  private dest!: Phaser.GameObjects.Sprite;
  private arrows: Phaser.GameObjects.Image[] = [];
  private stalls: { img: Phaser.GameObjects.Image; x: number; y: number }[] = [];
  private gateTiles: { x: number; y: number }[] = [];
  private toast!: UIText;
  private toastBg!: Phaser.GameObjects.Rectangle;
  private toastLeft = 0;
  private banner!: UIText;
  private bannerBg!: Phaser.GameObjects.Rectangle;
  private result: UIText | null = null;
  private resultAge = 0;
  private t = 0;
  private gateFlash: { key: string; left: number; flashes: number; on: number; off: number; icon: string } | null = null;
  private gateIcon!: Phaser.GameObjects.Image;
  private unreachableLeft = 0;
  private hasAtlas = false;

  constructor() { super(SceneKey.Game); }

  init(data: GameSceneData): void {
    const q = Number(urlParam('day'));
    this.day = Math.max(1, Math.floor(data.day ?? (Number.isFinite(q) && q > 0 ? q : 1)));
  }

  create(): void {
    const str = getStrings();
    const content = loadDayContent(this.day);
    this.sim = new DaySim(content, { view: CAMERA_VIEW }, urlParam('seed') ?? content.seed);
    this.hasAtlas = this.textures.exists(ATLAS_KEY);
    this.views = new Map();
    this.pathDots = [];
    this.arrows = [];
    this.stalls = [];
    this.gateTiles = [];
    this.result = null;
    this.resultAge = 0;
    this.t = 0;
    this.toastLeft = 0;
    const map = this.sim.floor.map;
    this.offsetX = Math.floor((LOGICAL_WIDTH - map.width * TILE) / 2);
    this.cameras.main.setBackgroundColor(color('dark'));

    this.buildMap();
    this.shadows = this.add.graphics().setDepth(D.shadow);
    this.cones = this.add.graphics().setDepth(D.cone);
    this.fx = this.add.graphics().setDepth(D.cover + 1);
    for (let i = 0; i < 64; i++) this.pathDots.push(this.img(0, 0, 'dot/path').setDepth(D.path).setVisible(false));
    this.dest = this.add.sprite(0, 0, ATLAS_KEY, 'fx/dest_0').setDepth(D.path + 1).setVisible(false);
    if (this.anims.exists('fx/dest')) this.dest.play('fx/dest');

    this.player = this.add.sprite(0, 0, ATLAS_KEY, 'player/idle_up').setOrigin(0.5, 1);
    this.playerLabelBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.85).setDepth(D.overhead);
    this.playerLabel = addPixelText(this, 0, 0, '', { role: 'label', color: color('outline') }).setDepth(D.overhead + 1);
    this.toastBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.9).setDepth(D.overhead + 2);
    this.toast = addPixelText(this, 0, 0, '', { role: 'label', color: color('outline') }).setDepth(D.overhead + 3);
    this.gateIcon = this.img(0, 0, 'ui/gate_fail').setDepth(D.overhead + 4).setVisible(false);
    for (let i = 0; i < 8; i++) this.arrows.push(this.img(0, 0, 'edge_boss/down_2').setScrollFactor(0).setDepth(9000).setVisible(false));

    this.hud = new Hud(this, this.sim, str);
    this.bannerBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.94).setScrollFactor(0).setDepth(11000).setStrokeStyle(1, color('dark'));
    this.banner = addPixelText(this, 0, 0, '', { role: 'body', color: color('outline'), align: 'center', lineSpacing: 3 }).setScrollFactor(0).setDepth(11001);
    const weekday = str.t(`day.weekday.${content.weekday}`);
    const title = str.variants(content.titleKey) > 1 ? str.t(content.titleKey, undefined, content.day) : str.t(content.titleKey);
    setPixelText(this.banner, `${str.t('day.intro', { n: content.day, weekday })}\n${title}`);
    placeText(this.banner, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT * 0.42, 0.5, 0.5);
    fitPanel(this.bannerBg, this.banner, 10, 7);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // 개발 빌드 전용: 자동화(스크린샷·수동 디버그) 훅. 프로덕션 번들에서는 제거됨
    if (import.meta.env.DEV) (window as unknown as { __mtDay?: DaySim; __mtScene?: GameScene }).__mtDay = this.sim;
    if (import.meta.env.DEV) (window as unknown as { __mtScene?: GameScene }).__mtScene = this;
    this.syncView(0);
  }

  private img(x: number, y: number, frame: string): Phaser.GameObjects.Image {
    return this.hasAtlas ? this.add.image(x, y, ATLAS_KEY, frame) : this.add.image(x, y, '__WHITE');
  }

  // ── 지도 ─────────────────────────────────────────────

  private buildMap(): void {
    const c = this.sim.content;
    const map = this.sim.floor.map;
    const layout = buildTileLayout(c);
    const rt = this.add.renderTexture(this.offsetX, 0, map.width * TILE, map.height * TILE).setOrigin(0, 0).setDepth(D.ground);
    if (this.hasAtlas) {
      layout.ground.forEach((frame, i) => {
        const x = i % map.width, y = Math.floor(i / map.width);
        rt.drawFrame(ATLAS_KEY, frame, x * TILE, y * TILE);
      });
    }
    for (const o of layout.objects) {
      const im = this.img(this.offsetX + o.x, o.y, o.frame).setOrigin(0.5, 1).setFlipX(o.flipX === true);
      im.setDepth(o.y + (o.depthBias ?? 0));
      if (o.frame === 'tall/stall' && o.tile) this.stalls.push({ img: im, x: o.tile.x, y: o.tile.y });
    }
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isGateOnly(map, x, y)) this.gateTiles.push({ x, y });
    // 유리벽(세로, D-053: 이동 차단·시선 통과) — 세로 유리 스프라이트가 없어 코드로 그림
    const gl = this.add.graphics();
    for (const p of layout.glass) {
      const x = this.offsetX + p.x * TILE + TILE / 2, y = p.y * TILE;
      gl.fillStyle(color('cool'), p.door ? 0.12 : 0.22).fillRect(x - 3, y - 8, 6, TILE + 8);
      gl.fillStyle(color('outline'), 1).fillRect(x - 3, y - 8, 1, TILE + 8).fillRect(x + 2, y - 8, 1, TILE + 8);
      if (!p.door) gl.fillStyle(0xffffff, 0.8).fillRect(x - 1, y - 4, 1, 5);
      else gl.fillStyle(color('mid'), 1).fillRect(x - 2, y + 4, 4, 1);
    }
    gl.setDepth((layout.glass[0]?.y ?? 0) * TILE + TILE);
    // 엄폐 칸(maps.coverSpots): 바닥 반짝임
    for (const s of this.coverSpots()) {
      const sp = this.add.sprite(this.offsetX + s.x * TILE + TILE / 2, s.y * TILE + TILE / 2, ATLAS_KEY, 'fx/cover_glint_0').setDepth(D.cover + 2);
      if (this.anims.exists('fx/cover_glint')) sp.play({ key: 'fx/cover_glint', startFrame: (s.x + s.y) % 4 });
    }
  }

  private coverSpots(): readonly { x: number; y: number }[] { return this.sim.content.coverSpots; }

  // ── 입력 ─────────────────────────────────────────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const sim = this.sim;
    if (sim.phase === 'ended') {
      // 연타하던 탭으로 결과를 못 보고 넘어가지 않도록 보호 시간(rules.input.resultInputGuardSec, BUG-006)
      if (this.result && this.resultAge >= sim.content.resultInputGuardSec) this.onResultTap();
      return;
    }
    const hit = this.hud.hitTest(pointer.x, pointer.y);
    if (hit?.startsWith('chip:')) { sim.tapMission(hit.slice(5)); return; }
    if (hit === 'hud') return; // HUD 탭은 화면 탭이 아님(rules.input.hudTapDoesNotStop)
    const tx = Math.floor((pointer.worldX - this.offsetX) / TILE);
    const ty = Math.floor(pointer.worldY / TILE);
    const r = sim.tapWorld(tx, ty);
    if (r === 'unreachable') this.unreachableLeft = 0.8;
  }

  private onResultTap(): void {
    const r = this.sim.result;
    const next = r && r.stars >= 1 ? Math.min(this.day + 1, Math.max(lastAuthoredDay() + 50, this.day + 1)) : this.day;
    this.events.emit('day-finished', { day: this.day, result: r });
    this.game.events.emit('mt-day-finished', { day: this.day, result: r });
    this.scene.restart({ day: next } satisfies GameSceneData);
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.sim.advance(dt);
    for (const e of this.sim.drainEvents()) this.onDayEvent(e);
    for (const e of this.sim.drainFloorEvents()) this.onFloorEvent(e);
    if (this.result) this.resultAge += dt;
    this.syncView(dt);
  }

  private onDayEvent(e: DayEvent): void {
    const str = getStrings();
    switch (e.type) {
      case 'hint': this.hud.hint(e.key); break;
      case 'toast': this.showToast(str.t(e.key)); break;
      case 'closeCall': this.showToast(str.t('hud.close_call')); break;
      case 'missionDone': this.showToast(str.t('hud.mission_done')); break;
      case 'missionFail': {
        const m = this.sim.content.missions.find((x) => x.id === e.id);
        this.showToast(str.t(e.reason === 'timeout' ? 'event.result.timeout' : 'event.result.fail', undefined, Math.floor(this.t)));
        void m;
        break;
      }
      case 'interrupt': if (e.textKey) this.showToast(str.t(e.textKey, { name: str.t('ui.player_default_name') })); break;
      case 'gate': {
        const cue = (this.sim.content.visualCues[e.result === 'pass' ? 'gateOk' : 'gateFail'] ?? {}) as Record<string, unknown>;
        const n = (k: string, d: number) => (typeof cue[k] === 'number' ? cue[k] as number : d);
        const flashes = n('flashes', e.result === 'pass' ? 1 : 3);
        const dur = n('durationSec', 0.6);
        this.gateFlash = { key: e.result === 'pass' ? 'gate_pass_flash' : 'gate_fail_flash', left: dur, flashes, on: dur / (flashes * 2), off: dur / (flashes * 2), icon: typeof cue['overlayIcon'] === 'string' ? cue['overlayIcon'] as string : 'ui/gate_fail' };
        if (e.result === 'pass') this.showToast(str.t(typeof cue['textKey'] === 'string' ? cue['textKey'] as string : 'hud.gate_ok'));
        else this.showToast(str.t('hud.gate_attempts_left', { n: this.sim.content.leave.gate.maxAttempts - this.sim.gateAttempts }));
        break;
      }
      case 'hrAbsent': this.showToast(str.t('react.hr_inspector.absent')); break;
      case 'phase': if (e.phase === 'day') { this.banner.setVisible(false); this.bannerBg.setVisible(false); } break;
      case 'result': this.showResult(); break;
      default: break;
    }
  }

  private onFloorEvent(e: SimEvent): void {
    const str = getStrings();
    if (e.type === 'talkCancel') {
      const npc = this.sim.floor.findNpc((n) => n.def.id === e.npc);
      const actor = npc?.def.actorId ? this.sim.content.actors[npc.def.actorId] : undefined;
      if (e.reason === 'disguised' || e.reason === 'escaped') this.npcSay(npc, str.t(actor?.dodgedLineKey ?? 'talk.dodged_default'), 1.4);
    } else if (e.type === 'talk') {
      const npc = this.sim.floor.findNpc((n) => n.def.id === e.npc);
      const actor = npc?.def.actorId ? this.sim.content.actors[npc.def.actorId] : undefined;
      const int = actor?.talkEnabledBy ? this.sim.content.interrupts.find((i) => i.id === actor.talkEnabledBy) : undefined;
      const lineKey = int ? (this.sim.phase === 'leave' && typeof int.effect['leaveLineKey'] === 'string' ? int.effect['leaveLineKey'] : int.effect['talkLineKey']) : undefined;
      if (typeof lineKey === 'string') this.npcSay(npc, str.t(lineKey, { name: str.t('ui.player_default_name') }, Math.floor(this.sim.time)), npc?.def.talk?.durationSec ?? 1.5);
    } else if (e.type === 'tap' && e.result === 'unreachable') this.unreachableLeft = 0.8;
  }

  private sayLeft = new Map<PatrolNpc, number>();
  private npcSay(npc: PatrolNpc | undefined, text: string, sec: number): void {
    if (!npc) return;
    const v = this.views.get(npc);
    if (!v) return;
    setPixelText(v.bubble, text);
    this.sayLeft.set(npc, sec);
  }

  private showToast(text: string): void {
    setPixelText(this.toast, text);
    this.toastLeft = TOAST_SEC;
  }

  // ── 표시 ─────────────────────────────────────────────

  private toWorld(x: number, y: number): { x: number; y: number } {
    return { x: this.offsetX + x * TILE, y: y * TILE };
  }

  private viewFor(npc: PatrolNpc): ActorView {
    let v = this.views.get(npc);
    if (v) return v;
    const actorId = npc.def.actorId ?? '';
    const bg = actorId.startsWith('background:') ? this.sim.content.background.find((b) => b.npc.id === npc.def.id) : undefined;
    const base = bg ? bg.sprite : spriteKeyFor(actorId);
    const lanyard = bg ? 'background' : (this.sim.content.actors[actorId]?.lanyard ?? 'background');
    const sprite = this.add.sprite(0, 0, ATLAS_KEY, `${base}/idle_down`).setOrigin(0.5, 1);
    const mark = this.add.sprite(0, 0, ATLAS_KEY, 'ui/suspect').setOrigin(0.5, 1).setDepth(D.overhead).setVisible(false);
    const bubbleBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.92).setDepth(D.overhead + 1).setStrokeStyle(1, color('dark')).setVisible(false);
    const bubble = addPixelText(this, 0, 0, '', { role: 'label', color: color('outline') }).setDepth(D.overhead + 2).setVisible(false);
    setWrap(bubble, 110);
    v = { sprite, mark, bubble, bubbleBg, base, lanyard };
    if (bg && bg.behavior !== 'walk' && bg.idleAnims.length > 0) v.bgIdle = { anims: bg.idleAnims, next: 0, range: bg.idleAnimEverySecRange };
    this.views.set(npc, v);
    return v;
  }

  private playAnim(s: Phaser.GameObjects.Sprite, key: string, fallbackFrame?: string): void {
    if (this.anims.exists(key)) {
      if (s.anims.currentAnim?.key !== key || !s.anims.isPlaying) s.play(key, true);
    } else if (fallbackFrame && this.textures.get(ATLAS_KEY).has(fallbackFrame)) {
      s.anims.stop();
      s.setFrame(fallbackFrame);
    }
  }

  private cameraTop(): number {
    const cam = this.sim.floor.camera;
    return cam ? Math.round(cam.top * TILE) : 0;
  }

  private syncView(dt: number): void {
    const sim = this.sim, floor = sim.floor;
    const t = this.t;
    const str = getStrings();
    this.cameras.main.scrollY = this.cameraTop();

    // 퇴근 중 의심 0.7 이상 = danger, 전조·접근 = alert, 퇴근 = finale (visualCues.dangerBorder)
    let stage: BorderStage = sim.phase === 'leave' ? 'finale' : 'calm';
    const threats = new Map<PatrolNpc, Threat>();
    for (const n of floor.npcs) threats.set(n, floor.threatOfNpc(n));
    const anyTurning = [...threats.entries()].some(([n, th]) => (th === 'turning' || th === 'approaching') && n.gazeMultiplier > 0 && !floor.isOnScreen(n));
    if (anyTurning || [...threats.entries()].some(([n, th]) => th === 'turning' && n.gazeMultiplier > 0)) stage = 'alert';
    if (sim.suspicion >= 0.7 || floor.gazeNow > 0) stage = 'danger';
    if (sim.phase === 'intro' || sim.phase === 'ended') stage = 'calm';

    // ── 플레이어 ──
    const p = floor.player;
    const pw = this.toWorld(p.x, p.y);
    const hidden = sim.activity?.mechanic === 'trip_safe_zone';
    this.player.setPosition(Math.round(pw.x), Math.round(pw.y) + FOOT_PX).setDepth(Math.round(pw.y) + FOOT_PX).setVisible(!hidden);
    const pdir = facing4(p.facing);
    let label = '';
    if (sim.phase === 'ended' && sim.result?.outcome === 'caught') this.playAnim(this.player, 'player/caught', 'player/caught');
    else if (p.mode === 'moving') this.playAnim(this.player, `player/walk_${pdir}`);
    else if (p.mode === 'talked') { this.playAnim(this.player, `player/idle_${pdir}`); label = str.t('player.mode.talked'); }
    else if (sim.activity || sim.seatedWorking || (sim.phase === 'leave' && sim.leaveStage === 'pack' && sim.playerAtSeat)) this.playAnim(this.player, 'player/idle_up');
    else if (floor.playerStill && !(sim.gateOpen)) {
      const pose = this.poseId();
      const d2 = pdir === 'up' ? 'down' : pdir;
      this.playAnim(this.player, `player/pose_${pose}_${d2}`, 'player/disguise');
      if (p.mode === 'disguised') label = str.t('player.mode.disguised');
    } else this.playAnim(this.player, `player/idle_${pdir}`);
    if (this.unreachableLeft > 0) { this.unreachableLeft -= dt; label = str.t('hud.unreachable'); }
    setPixelText(this.playerLabel, label).setVisible(label !== '' && !hidden);
    placeText(this.playerLabel, pw.x, Math.round(pw.y) + FOOT_PX - 22, 0.5, 1);
    fitPanel(this.playerLabelBg, this.playerLabel, 2, 1);
    for (const s of this.stalls) s.img.setFrame(hidden && p.tile.x === s.x && p.tile.y === s.y ? 'tall/stall_hiding' : 'tall/stall');

    // 토스트(플레이어 머리 위)
    if (this.toastLeft > 0) this.toastLeft -= dt;
    this.toast.setVisible(this.toastLeft > 0 && sim.phase !== 'ended');
    placeText(this.toast, Math.min(LOGICAL_WIDTH - 50, Math.max(50, pw.x)), Math.round(pw.y) - 26 - (label ? 12 : 0), 0.5, 1);
    fitPanel(this.toastBg, this.toast, 3, 2);

    // ── 경로 점선·목적지 ──
    const path = p.remainingPath();
    const showPath = (p.mode === 'moving' || p.paused) && sim.phase !== 'ended';
    this.pathDots.forEach((d, i) => {
      const n = path[i];
      d.setVisible(showPath && !!n && i < path.length - 1);
      if (n) { const w = this.toWorld(n.x, n.y); d.setPosition(Math.round(w.x), Math.round(w.y)); }
    });
    const dest = floor.destination;
    this.dest.setVisible(showPath && !!dest);
    if (dest) this.dest.setPosition(this.offsetX + dest.x * TILE + TILE / 2, dest.y * TILE + TILE / 2);

    // ── NPC + 시선 콘 + 그림자 ──
    this.shadows.clear();
    this.cones.clear();
    this.fx.clear();
    const sh = overlay('shadow');
    this.shadows.fillStyle(sh.color, sh.alpha);
    if (!hidden) this.shadows.fillEllipse(Math.round(pw.x), Math.round(pw.y) + FOOT_PX - 1, 11, 4);
    const seen = new Set<PatrolNpc>();
    const blink = Math.floor(t / 0.25) % 2 === 0;
    let arrowIdx = 0;
    const camTop = this.cameraTop();
    for (let i = 0; i < floor.npcs.length; i++) {
      const npc = floor.npcs[i]!;
      seen.add(npc);
      const v = this.viewFor(npc);
      const w = this.toWorld(npc.x, npc.y);
      const talkWarn = npc.mode === 'tell' && npc.tellKind === 'talk';
      const lean = talkWarn && npc.pendingFacing !== null ? Math.min(1, npc.modeTime / 0.25) * TALK_LEAN_PX : 0;
      const lx = npc.pendingFacing !== null ? Math.cos(npc.pendingFacing) * lean : 0;
      const ly = npc.pendingFacing !== null ? Math.sin(npc.pendingFacing) * lean : 0;
      const sx = Math.round(w.x + lx), sy = Math.round(w.y + ly) + FOOT_PX;
      v.sprite.setPosition(sx, sy).setDepth(sy).setVisible(npc.mode !== 'spawn');
      const dir: Facing4 = npc.tellKind === 'turn' && npc.pendingFacing !== null ? facing4(npc.pendingFacing) : facing4(npc.facing);
      if (v.bgIdle && npc.mode !== 'walk') {
        if (t >= v.bgIdle.next) {
          const k = v.bgIdle.anims[Math.floor(t) % v.bgIdle.anims.length]!;
          const key = `${v.base}/${k.replace(/_\d+$/, '')}`;
          this.playAnim(v.sprite, key, `${v.base}/${k}`);
          v.bgIdle.next = t + v.bgIdle.range[0] + ((Math.floor(t * 7) % 10) / 10) * (v.bgIdle.range[1] - v.bgIdle.range[0]);
        }
      } else if (npc.mode === 'walk') this.playAnim(v.sprite, `${v.base}/walk_${dir}`);
      else this.playAnim(v.sprite, `${v.base}/idle_${dir}`);
      if (npc.mode !== 'spawn') this.shadows.fillEllipse(sx, sy - 1, 11, 4);

      const seeing = floor.seeing[i] === true && npc.gazeMultiplier > 0;
      const keys = coneOverlayKeys(v.lanyard);
      if (npc.coneActive) {
        const o = overlay(seeing ? 'cone_alert' : keys.normal);
        const a = seeing && !blink ? o.alpha * 0.6 : o.alpha;
        const poly = conePolygon(floor.map, npc.pos, npc.facing, npc.cone, CONE_RAYS).map((q) => new Phaser.Math.Vector2(this.offsetX + q.x * TILE, q.y * TILE));
        this.cones.fillStyle(o.color, a).fillPoints(poly, true);
        this.cones.lineStyle(1, o.color, o.edgeAlpha).strokePoints(poly, true);
      }
      // 전조: 돌아볼 방향 점선 콘(cone_tell, 2px 칠·2px 띄움, 0.1초마다 1px 흐름)
      if (npc.mode === 'tell' && npc.pendingFacing !== null && npc.cone.range > 0 && npc.def.gazeMultiplier > 0) {
        const o = overlay(keys.tell);
        const poly = conePolygon(floor.map, npc.pos, npc.pendingFacing, npc.cone, CONE_RAYS).map((q) => ({ x: this.offsetX + q.x * TILE, y: q.y * TILE }));
        this.cones.fillStyle(o.color, o.alpha).fillPoints(poly.map((q) => new Phaser.Math.Vector2(q.x, q.y)), true);
        this.dashedPoly(poly, o.color, o.edgeAlpha, o.dash ?? [2, 2], Math.floor(t / 0.1));
      }
      // 머리 위 표시: 말걸기 전조 = 말풍선(hud/talk) + 문구, 돌아보기 전조 = '!'(hud.tell_mark 대신 아트 ui/suspect), 보는 중 = ui/alert
      const headY = sy - 21;
      if (talkWarn) {
        this.playAnim(v.mark, 'hud/talk', 'hud/talk_0');
        v.mark.setVisible(true).setPosition(sx, headY);
        const actor = npc.def.actorId ? this.sim.content.actors[npc.def.actorId] : undefined;
        if (!this.sayLeft.has(npc)) setPixelText(v.bubble, str.t(actor?.warnLineKey ?? 'talk.warn_default', { name: str.t('ui.player_default_name') }));
      } else if (seeing) {
        v.mark.anims.stop(); v.mark.setFrame('ui/alert').setVisible(true).setPosition(sx, headY);
      } else if (npc.mode === 'tell' && npc.def.gazeMultiplier > 0) {
        v.mark.anims.stop(); v.mark.setFrame('ui/suspect').setVisible(blink).setPosition(sx, headY);
      } else if (npc.mode === 'talk' || npc.mode === 'phone') {
        v.mark.anims.stop(); v.mark.setFrame(npc.mode === 'phone' ? 'hud/hey' : 'hud/talk_2').setVisible(npc.mode === 'talk').setPosition(sx, headY);
      } else v.mark.setVisible(false);
      // 대사 말풍선
      const say = this.sayLeft.get(npc);
      if (say !== undefined) { const left = say - dt; if (left <= 0) this.sayLeft.delete(npc); else this.sayLeft.set(npc, left); }
      const bubbleOn = this.sayLeft.has(npc) || talkWarn;
      v.bubble.setVisible(bubbleOn);
      if (bubbleOn) {
        placeText(v.bubble, Math.min(LOGICAL_WIDTH - 58, Math.max(58, sx)), headY - 13, 0.5, 1);
        fitPanel(v.bubbleBg, v.bubble, 3, 2);
      } else v.bubbleBg.setVisible(false);

      // 화면 밖 경고 화살표(D-034, 색 = 사원증 줄, 크기 = 거리 3단계)
      const th = threats.get(npc) ?? 'none';
      const ak = edgeArrowKey(v.lanyard);
      if (ak && !floor.isOnScreen(npc) && (th === 'turning' || th === 'approaching') && npc.gazeMultiplier >= 0 && arrowIdx < this.arrows.length) {
        if (th === 'turning' && !blink) continue;
        const above = npc.y < (floor.camera?.visibleTop ?? 0);
        const edgeTiles = above ? (floor.camera?.visibleTop ?? 0) - npc.y : npc.y - (floor.camera?.visibleBottom ?? 0);
        const size = edgeTiles < 3 ? 3 : edgeTiles < 7 ? 2 : 1;
        const ar = this.arrows[arrowIdx++]!;
        const ay = above ? HUD_TOP_PX + ARROW_MARGIN : LOGICAL_HEIGHT - HUD_BOTTOM_PX - ARROW_MARGIN;
        ar.setFrame(`${ak}/down_${size}`).setVisible(true).setAngle(above ? 180 : 0)
          .setPosition(Math.round(Phaser.Math.Clamp(sx, ARROW_MARGIN, LOGICAL_WIDTH - ARROW_MARGIN)), ay);
      }
      void camTop;
    }
    for (let k = arrowIdx; k < this.arrows.length; k++) this.arrows[k]!.setVisible(false);
    // 사라진 NPC 정리
    for (const [npc, v] of this.views) {
      if (seen.has(npc)) continue;
      v.sprite.destroy(); v.mark.destroy(); v.bubble.destroy(); v.bubbleBg.destroy();
      this.views.delete(npc);
      this.sayLeft.delete(npc);
    }

    // 엄폐 칸 바닥 맥동(cover_tile)
    const ct = overlay('cover_tile');
    this.fx.fillStyle(ct.color, pulseAlpha(ct, t));
    for (const s of this.coverSpots()) this.fx.fillRect(this.offsetX + s.x * TILE + 1, s.y * TILE + 1, TILE - 2, TILE - 2);
    // 게이트 깜빡임(visualCues gateFail/gateOk)
    this.gateIcon.setVisible(false);
    if (this.gateFlash) {
      const gf = this.gateFlash;
      const o = overlay(gf.key);
      const cyc = gf.on + gf.off;
      if (cyc <= 0 || (gf.left % cyc) > gf.off) {
        this.cones.fillStyle(o.color, o.alpha);
        for (const g of this.gateTiles) this.cones.fillRect(this.offsetX + g.x * TILE, g.y * TILE, TILE, TILE);
      }
      const gs = sim.content.leave.gate.spot;
      this.gateIcon.setFrame(gf.icon).setVisible(true).setPosition(this.offsetX + gs.x * TILE + TILE / 2, gs.y * TILE - 6 - (gf.key === 'gate_pass_flash' ? Math.round((1 - gf.left / 0.6) * 4) : 0));
      gf.left -= dt;
      if (gf.left <= 0) this.gateFlash = null;
    }

    this.hud.update(dt, t, stage);
  }

  /** 위장 포즈 id (rules.disguise.poseByZone, 아트 §11-1) */
  private poseId(): string {
    const pz = this.sim.content.poseByZone;
    const map = this.sim.floor.map;
    const tt = this.sim.floor.player.tile;
    const nearKind = (k: string) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.sim.floor.kindAt(tt.x + dx!, tt.y + dy!) === k);
    let key = 'default';
    if (nearKind('copier')) key = 'near_copier';
    else if (nearKind('plant')) key = 'near_plant';
    else {
      const z = zoneAt(map, tt.x, tt.y) ?? this.sim.content.zones.find((zz) => tt.x >= zz.rect[0] && tt.y >= zz.rect[1] && tt.x < zz.rect[0] + zz.rect[2] && tt.y < zz.rect[1] + zz.rect[3])?.id;
      if (z === 'pantry') key = 'pantry';
      else if (z === 'lobby' || z === 'gate_hall') key = 'lobby';
      else if (z === 'corridor_mid') key = 'corridor';
    }
    return pz[key] ?? pz['default'] ?? 'read_document';
  }

  private dashedPoly(pts: { x: number; y: number }[], col: number, alpha: number, dash: readonly [number, number], phase: number): void {
    const [on, off] = dash;
    const period = on + off;
    let acc = phase % period;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % n]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < len; d += 1) {
        if ((acc + d) % period < on) this.cones.fillStyle(col, alpha).fillRect(Math.round(a.x + ((b.x - a.x) * d) / len), Math.round(a.y + ((b.y - a.y) * d) / len), 1, 1);
      }
      acc = (acc + len) % period;
    }
  }

  private showResult(): void {
    const r = this.sim.result;
    if (!r || this.result) return;
    const str = getStrings();
    const panel = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.95).setScrollFactor(0).setDepth(12000).setStrokeStyle(1, color('dark'));
    const reaction = r.reactionKey ? `${str.t(r.reactionKey, { name: str.t('ui.player_default_name') }, Math.floor(r.timeSec))}\n\n` : '';
    const lines = [
      str.t(r.titleKey),
      str.t('result.stars', { n: r.stars }),
      '',
      reaction.trim(),
      str.t('result.peak_suspicion', { n: Math.round(r.peakSuspicion * 100) }),
      str.t('result.missions', { n: r.missionsDone, total: r.missionsTotal }),
      `${str.t('hud.work')} ${Math.round(r.work * 100)}% / ${Math.round(r.quota * 100)}%`,
      str.t('result.slack_points', { n: r.slackPoints }),
      str.t('result.salary', { n: r.salary }),
      str.t('result.play_time', { n: r.timeSec.toFixed(1) }),
      '',
      str.t(r.stars >= 1 ? 'ui.next_day' : 'ui.tap_to_retry'),
    ].filter((l, i, a) => !(l === '' && a[i - 1] === ''));
    this.result = addPixelText(this, 0, 0, lines.join('\n'), { role: 'label', color: color('outline'), align: 'center', lineSpacing: 3 })
      .setScrollFactor(0).setDepth(12001);
    setWrap(this.result, LOGICAL_WIDTH - 30);
    placeText(this.result, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, 0.5, 0.5);
    fitPanel(panel, this.result, 10, 8);
  }
}
