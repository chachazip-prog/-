import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { loadFloorContent, loadFloorPresentation } from '../content';
import { FloorSim, conePolygon, daySeed, tilesInZone, type Threat } from '../core';
import { SceneKey } from './keys';
import { addPixelText, fitPanel, placeText, setPixelText, type UIText } from '../ui/pixelText';

/** 렌더링 기준값 (게임플레이 수치 아님) */
const TILE = 16;
const HUD_H = 18;
/** HUD 게이지 막대 세로 중심 (barY 5 + barH 8 / 2) */
const HUD_BAR_MID = 9;
/** 카메라 추적 시 화면 안 플레이어 세로 위치 비율 (위로 진행하므로 아래쪽에 둠) */
const CAM_ANCHOR_Y = 0.6;
/** 카메라 추적 지수 감쇠 속도(1/초). 프레임레이트 무관 */
const CAM_FOLLOW_RATE = 8;
const CONE_RAYS = 14;
const ARROW_MARGIN = 7;

/** 회색 박스 팔레트 (라이트 모드 기준. 빨강은 상사·위험 신호 전용 — D-025) */
const COLOR = {
  floor: 0xe6e6ea,
  grid: 0xd6d6dc,
  wall: 0x5c5c68,
  desk: 0xb4b0a4,
  cover: 0x6f8a78, // 파티션·화분·복사기(엄폐물)
  seat: 0xc7d9f2,
  pantry: 0xf2e6bf,
  exit: 0xc4e8c4,
  player: 0x2f63c8,
  playerDisguised: 0x7f9fd8,
  path: 0x2f63c8,
  boss: 0xd02a2a,
  guard: 0x222228,
  hudBg: 0xf4f4f6,
  barBg: 0xc8c8d0,
  barFill: 0xd02a2a,
  warnApproach: 0xe0b020,
  text: 0x1b1b22,
  textMuted: 0x4a4a55,
  textDev: 0x55555f,
  panel: 0xffffff,
} as const;

const KIND_COLOR: Readonly<Record<string, number>> = {
  wall: COLOR.wall, desk: COLOR.desk, partition: COLOR.cover, plant: COLOR.cover, copier: COLOR.cover,
};
const ZONE_COLOR: Readonly<Record<string, number>> = { seat: COLOR.seat, pantry: COLOR.pantry, exit: COLOR.exit };
const ROLE_COLOR: Readonly<Record<string, number>> = { boss: COLOR.boss, guard: COLOR.guard };
const MODE_LABEL = { idle: '', moving: '', disguised: '서류 보는 척', talked: '사원증 확인 중…' } as const;

function seedFromUrl(): string {
  try {
    const s = new URLSearchParams(window.location.search).get('seed');
    if (s) return s;
  } catch { /* noop */ }
  return daySeed(1);
}

/**
 * 탑다운 회색 박스 프로토타입 씬 (T-123, D-033~D-035).
 * 판정·상태는 core/FloorSim이 소유하고, 씬은 입력 전달과 표시만 한다.
 */
export class GameScene extends Phaser.Scene {
  private sim!: FloorSim;
  private offsetX = 0;
  private camY = 0;
  private player!: Phaser.GameObjects.Rectangle;
  private playerLabel!: UIText;
  private playerLabelBg!: Phaser.GameObjects.Rectangle;
  private npcBodies: Phaser.GameObjects.Rectangle[] = [];
  private npcTells: UIText[] = [];
  private cones!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private hudGfx!: Phaser.GameObjects.Graphics;
  private arrows!: Phaser.GameObjects.Graphics;
  private pctText!: UIText;
  private fpsText: UIText | null = null;
  private endText: UIText | null = null;
  private blink = 0;

  constructor() { super(SceneKey.Game); }

  create(): void {
    this.sim = new FloorSim(loadFloorContent(), seedFromUrl());
    this.npcBodies = [];
    this.npcTells = [];
    this.endText = null;
    const map = this.sim.map;
    this.offsetX = Math.floor((LOGICAL_WIDTH - map.width * TILE) / 2);
    this.cameras.main.setBackgroundColor(COLOR.wall);

    this.buildMapTexture();
    this.add.image(this.offsetX, 0, 'floor-map').setOrigin(0, 0);
    this.addZoneLabels();

    this.pathGfx = this.add.graphics();
    this.cones = this.add.graphics();

    // 캐릭터: 회색 박스 단계는 12×16 몸통 사각형 (스프라이트 프레임 16×20 — D-036 — 확정 시 교체)
    for (const npc of this.sim.npcs) {
      const body = this.add.rectangle(0, 0, 12, 16, ROLE_COLOR[npc.def.role] ?? COLOR.guard).setOrigin(0.5, 0.75);
      const tell = addPixelText(this, 0, 0, '!', { role: 'body', color: COLOR.boss }).setVisible(false);
      this.npcBodies.push(body);
      this.npcTells.push(tell);
    }
    this.player = this.add.rectangle(0, 0, 12, 16, COLOR.player).setOrigin(0.5, 0.75).setStrokeStyle(1, 0xffffff);
    // 한글 라벨은 10px(8px 한글 금지 — D-042). 배경은 BitmapText 뒤 사각형
    this.playerLabelBg = this.add.rectangle(0, 0, 1, 1, COLOR.panel, 0.8);
    this.playerLabel = addPixelText(this, 0, 0, '', { role: 'label', color: COLOR.text });

    // HUD (카메라 고정)
    this.arrows = this.add.graphics().setScrollFactor(0);
    this.hudGfx = this.add.graphics().setScrollFactor(0);
    // HUD 텍스트 세로 위치: 게이지 막대(y 5~13)의 가운데에 잉크 영역을 맞춤
    placeText(addPixelText(this, 0, 0, '의심', { role: 'label', color: COLOR.text }).setScrollFactor(0), 4, HUD_BAR_MID, 0, 0.5);
    this.pctText = addPixelText(this, 124, 0, '0%', { role: 'label', color: COLOR.text }).setScrollFactor(0);
    placeText(this.pctText, 124, HUD_BAR_MID, 0, 0.5);
    if (import.meta.env.DEV) {
      this.fpsText = addPixelText(this, 0, 0, '60fps', { role: 'num', color: COLOR.textDev }).setScrollFactor(0);
      placeText(this.fpsText, LOGICAL_WIDTH - 3, HUD_BAR_MID, 1, 0.5);
    }

    // 카메라 초기 위치: 플레이어 기준 즉시 맞춤
    this.camY = this.cameraTarget();
    this.cameras.main.scrollY = Math.round(this.camY);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // 개발 빌드 전용: 브라우저 자동화(스크린샷·수동 디버그)에서 시뮬레이션 상태를 읽기 위한 훅. 프로덕션 번들에서는 제거됨
    if (import.meta.env.DEV) (window as unknown as { __mtSim?: FloorSim }).__mtSim = this.sim;
    this.syncView(0);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.sim.outcome !== 'playing') {
      this.scene.restart();
      return;
    }
    if (pointer.y < HUD_H && this.sim.player.mode !== 'moving') return; // HUD 영역 탭은 이동 명령으로 쓰지 않음
    const tx = Math.floor((pointer.worldX - this.offsetX) / TILE);
    const ty = Math.floor(pointer.worldY / TILE);
    this.sim.tap(tx, ty);
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
    this.sim.advance(dt);
    this.sim.drainEvents(); // TODO: 사운드·연출 트리거 연결
    this.syncView(dt);
  }

  // ── 렌더링 ───────────────────────────────────────────

  private buildMapTexture(): void {
    const map = this.sim.map;
    if (this.textures.exists('floor-map')) this.textures.remove('floor-map');
    const g = this.make.graphics({}, false);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        const kind = map.kinds[i] ?? 'floor';
        const zone = map.zones[i];
        const px = x * TILE, py = y * TILE;
        g.fillStyle((zone ? ZONE_COLOR[zone] : undefined) ?? COLOR.floor);
        g.fillRect(px, py, TILE, TILE);
        if (map.walkable[i]) {
          g.fillStyle(COLOR.grid);
          g.fillRect(px, py, TILE, 1);
          g.fillRect(px, py, 1, TILE);
        }
        const kc = KIND_COLOR[kind];
        if (kc !== undefined) {
          g.fillStyle(kc);
          if (kind === 'wall') g.fillRect(px, py, TILE, TILE);
          else if (kind === 'desk') g.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          else if (kind === 'plant') g.fillCircle(px + 8, py + 8, 6);
          else g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        }
      }
    }
    g.generateTexture('floor-map', map.width * TILE, map.height * TILE);
    g.destroy();
  }

  private addZoneLabels(): void {
    const labels = loadFloorPresentation().zoneLabels;
    for (const [zone, label] of Object.entries(labels)) {
      const tiles = tilesInZone(this.sim.map, zone);
      if (tiles.length === 0) continue;
      let sx = 0, sy = 0;
      for (const t of tiles) { sx += t.x + 0.5; sy += t.y + 0.5; }
      const t = addPixelText(this, 0, 0, label, { role: 'label', color: COLOR.textMuted }).setAlpha(0.85);
      placeText(t, this.offsetX + (sx / tiles.length) * TILE, (sy / tiles.length) * TILE, 0.5, 0.5);
    }
  }

  private toWorld(x: number, y: number): { x: number; y: number } {
    return { x: this.offsetX + x * TILE, y: y * TILE };
  }

  private cameraTarget(): number {
    const py = this.sim.player.y * TILE;
    const min = -HUD_H;
    const max = this.sim.map.height * TILE - LOGICAL_HEIGHT;
    return Math.min(max, Math.max(min, py - LOGICAL_HEIGHT * CAM_ANCHOR_Y));
  }

  private syncView(dt: number): void {
    const sim = this.sim;
    this.blink = (this.blink + dt) % 0.4;
    const blinkOn = this.blink < 0.2;

    // 카메라: 부드러운 추적(내부 실수) + 정수 픽셀 스냅
    const target = this.cameraTarget();
    this.camY += (target - this.camY) * (1 - Math.exp(-CAM_FOLLOW_RATE * dt));
    if (Math.abs(target - this.camY) < 0.25) this.camY = target;
    const cam = this.cameras.main;
    cam.scrollY = Math.round(this.camY);

    // 플레이어
    const p = sim.player;
    const pw = this.toWorld(p.x, p.y);
    this.player.setPosition(Math.round(pw.x), Math.round(pw.y));
    this.player.setFillStyle(p.mode === 'disguised' ? COLOR.playerDisguised : COLOR.player);
    const label = MODE_LABEL[p.mode];
    setPixelText(this.playerLabel, label).setVisible(label !== '');
    placeText(this.playerLabel, pw.x, Math.round(pw.y) - 15, 0.5, 1);
    fitPanel(this.playerLabelBg, this.playerLabel, 2, 1);

    // 경로 표시
    this.pathGfx.clear();
    if (p.mode === 'moving' && sim.outcome === 'playing') {
      this.pathGfx.fillStyle(COLOR.path, 0.55);
      for (const n of p.remainingPath()) {
        const w = this.toWorld(n.x, n.y);
        this.pathGfx.fillRect(Math.round(w.x) - 1, Math.round(w.y) - 1, 2, 2);
      }
      if (sim.destination) {
        const d = this.toWorld(sim.destination.x, sim.destination.y);
        this.pathGfx.lineStyle(1, COLOR.path, 0.9);
        this.pathGfx.strokeRect(Math.round(d.x) + 2.5, Math.round(d.y) + 2.5, TILE - 5, TILE - 5);
      }
    }

    // NPC + 시선 콘
    this.cones.clear();
    const viewTop = cam.scrollY + HUD_H, viewBottom = cam.scrollY + LOGICAL_HEIGHT;
    this.arrows.clear();
    sim.npcs.forEach((npc, i) => {
      const w = this.toWorld(npc.x, npc.y);
      const body = this.npcBodies[i]!;
      body.setPosition(Math.round(w.x), Math.round(w.y));
      const color = ROLE_COLOR[npc.def.role] ?? COLOR.guard;
      const seeing = sim.seeing[i] === true;
      const poly = conePolygon(sim.map, npc.pos, npc.facing, npc.def.cone, CONE_RAYS)
        .map((v) => new Phaser.Math.Vector2(this.offsetX + v.x * TILE, v.y * TILE));
      this.cones.fillStyle(color, seeing ? 0.38 : 0.18);
      this.cones.fillPoints(poly, true);
      // 전조: 머리 위 '!' 깜빡임 + 돌아볼 방향 점선
      const tell = this.npcTells[i]!;
      const telling = npc.mode === 'tell';
      tell.setVisible(telling && blinkOn);
      placeText(tell, w.x, Math.round(w.y) - 14, 0.5, 1);
      if (telling && npc.pendingFacing !== null) {
        this.cones.lineStyle(1, color, 0.8);
        const len = npc.def.cone.range * TILE * 0.5;
        for (let k = 2; k < len; k += 4) {
          const x = w.x + Math.cos(npc.pendingFacing) * k, y = w.y + Math.sin(npc.pendingFacing) * k;
          this.cones.fillStyle(color, 0.8);
          this.cones.fillRect(Math.round(x), Math.round(y), 1, 1);
        }
      }
      // 화면 밖 위험 경고 (D-034)
      const offscreen = w.y < viewTop - 4 || w.y > viewBottom + 4;
      if (offscreen) this.drawEdgeArrow(w.x, w.y - cam.scrollY, sim.threatOf(i), blinkOn);
    });

    // HUD
    this.drawHud();
    if (this.fpsText) {
      setPixelText(this.fpsText, `${Math.round(this.game.loop.actualFps)}fps`);
      placeText(this.fpsText, LOGICAL_WIDTH - 3, HUD_BAR_MID, 1, 0.5);
    }

    if (sim.outcome !== 'playing' && !this.endText) {
      const msg = sim.outcome === 'escaped' ? '퇴근 성공!' : '들킴…';
      const panel = this.add.rectangle(0, 0, 1, 1, COLOR.panel, 0.9).setScrollFactor(0);
      this.endText = addPixelText(this, 0, 0,
        `${msg}\n\n최고 의심 ${Math.round(sim.suspicion.peak * 100)}%\n${sim.time.toFixed(1)}초\n\n탭해서 다시`,
        { role: 'body', color: COLOR.text, align: 'center', lineSpacing: 2 }).setScrollFactor(0);
      placeText(this.endText, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, 0.5, 0.5);
      fitPanel(panel, this.endText, 10, 8);
    }
  }

  /** 화면 가장자리 화살표. sx/sy는 화면 좌표(카메라 기준) */
  private drawEdgeArrow(sx: number, sy: number, threat: Threat, blinkOn: boolean): void {
    if (threat === 'none') return;
    const color = threat === 'approaching' ? COLOR.warnApproach : COLOR.boss;
    if (threat === 'turning' && !blinkOn) return;
    const cx = LOGICAL_WIDTH / 2, cy = (HUD_H + LOGICAL_HEIGHT) / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const ex = Math.round(Phaser.Math.Clamp(sx, ARROW_MARGIN, LOGICAL_WIDTH - ARROW_MARGIN));
    const ey = Math.round(Phaser.Math.Clamp(sy, HUD_H + ARROW_MARGIN, LOGICAL_HEIGHT - ARROW_MARGIN));
    const s = threat === 'seeing' ? 6 : 5;
    const tip = { x: ex + Math.cos(ang) * s, y: ey + Math.sin(ang) * s };
    const l = { x: ex + Math.cos(ang + 2.4) * s, y: ey + Math.sin(ang + 2.4) * s };
    const r = { x: ex + Math.cos(ang - 2.4) * s, y: ey + Math.sin(ang - 2.4) * s };
    this.arrows.fillStyle(0xffffff, 0.9);
    this.arrows.fillCircle(ex, ey, s + 2);
    this.arrows.fillStyle(color, 1);
    this.arrows.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  }

  private drawHud(): void {
    const sim = this.sim;
    const g = this.hudGfx;
    g.clear();
    g.fillStyle(COLOR.hudBg, 1);
    g.fillRect(0, 0, LOGICAL_WIDTH, HUD_H);
    const barX = 30, barY = 5, barW = 90, barH = 8;
    g.fillStyle(COLOR.barBg, 1);
    g.fillRect(barX, barY, barW, barH);
    const v = sim.suspicion.value;
    g.fillStyle(COLOR.barFill, 1);
    g.fillRect(barX, barY, Math.round(barW * v), barH);
    if (sim.seeing.some((s) => s)) {
      g.lineStyle(1, COLOR.barFill, 1);
      g.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
    }
    setPixelText(this.pctText, `${Math.round(v * 100)}%`);
  }
}
