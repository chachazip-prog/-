import Phaser from 'phaser';
import { AdFlow } from '../ads/adFlow';
import { audio, bgmHysteresisSec } from '../audio/audio';
import { buildSoundCues, tellSfxFor, type SoundCues } from '../audio/cues';
import { DangerStageTracker, stageThresholdsFromCues, type DangerStage } from '../audio/dangerStage';
import { HUD_TOP_PX, LOGICAL_HEIGHT, LOGICAL_WIDTH, cameraViewNow, deckBottomPx, deckLiftPx } from '../config/display';
import { getStrings, lastAuthoredDay, loadDayContent } from '../content';
import { DaySim, conePolygon, isGateOnly, zoneAt, type DayEvent, type PatrolNpc, type SimEvent, type Threat } from '../core';
import type { ActionKind } from '../core/day/daySim';
import type { PadDir } from '../input/padJudge';
import { controlHandOr } from '../state/controlHand';
import { Deck } from '../ui/dpad';
import { getDataTables } from '../data/loader';
import { getPlatform } from '../platform';
import { applyDayResult, loadProgress, saveProgress } from '../state/progress';
import { UiButton } from '../ui/button';
import { color, overlay, pulseAlpha } from '../render/palette';
import { ATLAS_KEY, coneOverlayKeys, edgeArrowKey, facing4, spriteKeyFor, type Facing4 } from '../render/sprites';
import { TILE, buildTileLayout, missingArt } from '../render/tilemap';
import { iconFallback } from '../render/sprites';
import { Hud, missionChipLabel, type BorderStage } from '../ui/hud';
import type { PlayerVariant } from '../content/gender';
import { addPixelText, fitPanel, placeText, setPixelText, setWrap, textBox, type UIText } from '../ui/pixelText';
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
/** 오버레이(컷인·이어하기 제안·결과) 깊이 */
const OV = 12000;
/** 의심 루프 시작 임계·rate 식(sound-list: 0.5부터, rate = 1 + (의심 − 0.5) × 0.8, 최대 1.4) */
const SUSP_LOOP_FROM = 0.5;
/** 화면 안에 들어오는 가운데 x(토스트 폭 기준) */
function textBoxCenterX(t: UIText, cx: number): number { const hw = textBox(t).w / 2 + 5; return Math.min(LOGICAL_WIDTH - hw, Math.max(hw, cx)); }

export interface GameSceneData { day?: number; skipCeo?: boolean; seenHints?: readonly string[]; playerVariant?: PlayerVariant | null }

type Overlay = 'none' | 'cutin' | 'offer' | 'result' | 'busy';

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
  private arrows: Phaser.GameObjects.Image[] = [];
  private stalls: { img: Phaser.GameObjects.Image; x: number; y: number; base: string; hiding: string }[] = [];
  /** 전높이 칸막이·큐비클(D-080): 플레이어가 뒤(rect)에 서면 알파 0.5 */
  private occluders: { img: Phaser.GameObjects.Image; rect: readonly [number, number, number, number] }[] = [];
  /** 회의실 문 '사용 중' 덮개(순회 meeting 중) */
  private busyDoors: Phaser.GameObjects.Image[] = [];
  /** 순회 '메모 남기기' 책상 메모지(D-120): 팀장이 메모를 붙이고 떠난 뒤 그날 끝까지 표시 */
  private memoProps: Phaser.GameObjects.Image[] = [];
  /** 팀장 출발 말풍선 아이콘(목적지) */
  private tourIcon!: Phaser.GameObjects.Image;
  private tourIconFor: { npc: string; left: number; frame: string } | null = null;
  private awayBadge!: UIText;
  private awayBadgeBg!: Phaser.GameObjects.Rectangle;
  private carryIcon!: Phaser.GameObjects.Image;
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
  private hasAtlas = false;
  // ── T-133 ──
  private skipCeo = false;
  private seenHints = new Set<string>();
  private cues!: SoundCues;
  private stage!: DangerStageTracker;
  private ads!: AdFlow;
  private rewardedThisGame = false;
  private salaryDoubled = false;
  private overlay: Overlay = 'none';
  private overlayAge = 0;
  private cutinLeft = 0;
  private ovObjects: Phaser.GameObjects.GameObject[] = [];
  private buttons: { b: UiButton; act: () => void }[] = [];
  private vignette!: Phaser.GameObjects.Graphics;
  private centerText!: UIText;
  private centerBg!: Phaser.GameObjects.Rectangle;
  private follower: Phaser.GameObjects.Sprite | null = null;
  private routeDots: { img: Phaser.GameObjects.Image }[] = [];
  private routeLeft = 0;
  private demo: { actor: string; left: number } | null = null;
  private missionArrows: Phaser.GameObjects.Image[] = [];
  /** zone_only 장소 반짝임(fx/zone_hint, 드러난 뒤 그 미션이 끝날 때까지) */
  private zoneHints = new Map<string, Phaser.GameObjects.Sprite>();
  // ── T-170 조작대·입력 ──
  private deck!: Deck;
  /** 포인터 잡기(control-dpad §1-2): 패드에서 시작한 터치 id, 행동 버튼·게임 화면 터치 id와 누른 시각 */
  private padPtr: number | null = null;
  private actPtr: { id: number; at: number } | null = null;
  private fieldPtr: { id: number; at: number } | null = null;
  private keyDir: PadDir | null = null;
  private guideSteps: Phaser.GameObjects.Sprite[] = [];
  private guidePin!: Phaser.GameObjects.Image;
  private useHint!: Phaser.GameObjects.Sprite;
  private bumpFx!: Phaser.GameObjects.Sprite;
  private headIcon!: Phaser.GameObjects.Image;
  private headIconLeft = 0;
  private lastActionIcon = '';
  private stepBackLeft = 0;
  private prevPlayerMode = 'idle';
  private debugText: UIText | null = null;
  private domCleanup: (() => void) | null = null;
  private prevMode = new Map<PatrolNpc, string>();

  private salaryText: UIText | null = null;
  private centerLeft = 0;

  constructor() { super(SceneKey.Game); }

  init(data: GameSceneData): void {
    const q = Number(urlParam('day'));
    this.day = Math.max(1, Math.floor(data.day ?? (Number.isFinite(q) && q > 0 ? q : 1)));
    this.skipCeo = data.skipCeo === true;
    this.seenHints = new Set(data.seenHints ?? []);
    this.variant = data.playerVariant ?? null;
  }

  /** 이번 판 외형(그림 전용). 판 도중에는 바뀌지 않음(D-088 다음 판부터) */
  private variant: PlayerVariant | null = null;
  /** T-151 시설 표시: 화장실 문 위 '!'·그림자(C3 전조), 청소 중 표지·남은 초 */
  private doorAlert!: Phaser.GameObjects.Image;
  private cleanSign: Phaser.GameObjects.Image | null = null;
  private cleanLabel!: UIText;
  private cleanLabelBg!: Phaser.GameObjects.Rectangle;

  create(): void {
    const str = getStrings();
    const content = loadDayContent(this.day, this.variant);
    this.sim = new DaySim(content, { view: cameraViewNow(), skipCeoVisit: this.skipCeo, seenHints: this.seenHints }, urlParam('seed') ?? content.seed);
    this.cues = buildSoundCues(getDataTables());
    // 위험 단계 임계(rules.visualCues: suspicionHigh.threshold·dangerBorder.alertSuspicionMin, T-136). 없으면 경고 후 단계 상승 없음(적발 1.0만)
    const th = stageThresholdsFromCues(content.visualCues);
    if (!th) console.warn('[data] rules.visualCues 임계값 없음(suspicionHigh.threshold / dangerBorder.alertSuspicionMin)');
    this.stage = new DangerStageTracker(th ?? { dangerSuspicion: 1, alertSuspicion: 1 }, bgmHysteresisSec());
    this.ads = new AdFlow(getPlatform());
    this.rewardedThisGame = false;
    this.salaryDoubled = false;
    this.overlay = 'none';
    this.ovObjects = [];
    this.buttons = [];
    this.routeDots = [];
    this.missionArrows = [];
    this.zoneHints = new Map();
    this.follower = null;
    this.demo = null;
    this.padPtr = null; this.actPtr = null; this.fieldPtr = null; this.keyDir = null;
    this.guideSteps = []; this.headIconLeft = 0; this.lastActionIcon = ''; this.stepBackLeft = 0; this.prevPlayerMode = 'idle';
    this.debugText = null;
    this.prevMode = new Map();
    this.sayLeft = new Map();
    this.salaryText = null;
    this.hasAtlas = this.textures.exists(ATLAS_KEY);
    this.views = new Map();
    this.pathDots = [];
    this.arrows = [];
    this.stalls = [];
    this.occluders = [];
    this.busyDoors = [];
    this.memoProps = [];
    this.tourIconFor = null;
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
    // T-170 길 안내(fx/guide_step 발자국 + fx/guide_pin), 사용 가능 표시(fx/use_hint), 범프 먼지(fx/bump), 머리 위 행동 아이콘
    const has = (f: string) => this.atlasHas(f);
    for (let i = 0; i < Math.max(1, content.controls.guideTrailTiles); i++) {
      const sp = this.add.sprite(0, 0, ATLAS_KEY, has('fx/guide_step_0') ? 'fx/guide_step_0' : 'dot/hint').setDepth(D.path + 1).setVisible(false);
      if (this.anims.exists('fx/guide_step')) sp.play({ key: 'fx/guide_step', startFrame: i % 2 });
      this.guideSteps.push(sp);
    }
    this.guidePin = this.img(0, 0, has('fx/guide_pin') ? 'fx/guide_pin' : 'fx/dest_0').setOrigin(0.5, has('fx/guide_pin') ? 1 : 0.5).setDepth(D.overhead - 1).setVisible(false);
    this.useHint = this.add.sprite(0, 0, ATLAS_KEY, has('fx/use_hint_0') ? 'fx/use_hint_0' : 'ui/suspect').setDepth(D.overhead - 1).setVisible(false);
    if (this.anims.exists('fx/use_hint')) this.useHint.play('fx/use_hint');
    this.bumpFx = this.add.sprite(0, 0, ATLAS_KEY, has('fx/bump_0') ? 'fx/bump_0' : 'ui/suspect').setDepth(D.overhead - 1).setVisible(false);
    this.bumpFx.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.bumpFx.setVisible(false));
    this.headIcon = this.img(0, 0, has('fx/head_icon/idle') ? 'fx/head_icon/idle' : 'ui/suspect').setDepth(D.overhead + 2).setVisible(false);

    // T-151: 선택한 외형(content.skins.player). 아틀라스에 없으면 대체 그림(playerSelection.fallbackSprite)
    const sk = content.skins;
    this.playerKey = sk && this.atlasHas(`${sk.player}/idle_down`) ? sk.player : (sk?.playerFallback ?? content.playerSpriteKey ?? 'player');
    this.player = this.add.sprite(0, 0, ATLAS_KEY, `${this.playerKey}/idle_up`).setOrigin(0.5, 1);
    for (let i = 0; i < 96; i++) this.routeDots.push({ img: this.img(0, 0, 'dot/hint').setDepth(D.path).setVisible(false) });
    for (let i = 0; i < 4; i++) this.missionArrows.push(this.img(0, 0, 'ui/edge_down').setScrollFactor(0).setDepth(9000).setVisible(false));
    this.playerLabelBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.85).setDepth(D.overhead);
    this.playerLabel = addPixelText(this, 0, 0, '', { role: 'label', color: color('outline') }).setDepth(D.overhead + 1);
    this.toastBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.9).setDepth(D.overhead + 2);
    this.toast = addPixelText(this, 0, 0, '', { role: 'label', color: color('outline') }).setDepth(D.overhead + 3);
    // T-151: 긴 반응 문구(시설 리액션 등)가 화면 폭을 넘지 않게 줄바꿈
    setWrap(this.toast, LOGICAL_WIDTH - 24);
    this.gateIcon = this.img(0, 0, 'ui/gate_fail').setDepth(D.overhead + 4).setVisible(false);
    this.followerBubbleBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.92).setDepth(D.overhead + 1).setStrokeStyle(1, color('dark')).setVisible(false);
    this.followerBubble = addPixelText(this, 0, 0, '', { role: 'label', color: color('outline') }).setDepth(D.overhead + 2).setVisible(false);
    this.followerSay = 0;
    for (let i = 0; i < 8; i++) this.arrows.push(this.img(0, 0, 'edge_boss/down_2').setScrollFactor(0).setDepth(9000).setVisible(false));
    this.tourIcon = this.img(0, 0, 'ui/suspect').setDepth(D.overhead + 3).setVisible(false);
    this.carryIcon = this.img(0, 0, 'ui/suspect').setDepth(D.overhead).setVisible(false);
    this.awayBadgeBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.92).setScrollFactor(0).setDepth(9001).setStrokeStyle(1, color('dark')).setVisible(false);
    this.doorAlert = this.img(0, 0, this.atlasHas('icon_door_alert') ? 'icon_door_alert' : 'ui/alert').setDepth(D.overhead + 3).setVisible(false);
    this.cleanLabelBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.92).setDepth(D.overhead + 1).setStrokeStyle(1, color('dark')).setVisible(false);
    this.cleanLabel = addPixelText(this, 0, 0, '', { role: 'label', color: color('outline') }).setDepth(D.overhead + 2).setVisible(false);
    if (content.facility?.cleaning && this.atlasHas('furn2/sign_wet')) {
      const d = content.facility.restroom.mine.door;
      this.cleanSign = this.img(this.offsetX + d.x * TILE + TILE / 2, (d.y + 1) * TILE, 'furn2/sign_wet').setOrigin(0.5, 1).setDepth((d.y + 1) * TILE + 1).setVisible(false);
    }
    this.awayBadge = addPixelText(this, 0, 0, str.t('hud.tl_away'), { role: 'label', color: color('outline') }).setScrollFactor(0).setDepth(9002).setVisible(false);

    // T-170 조작대(오른손·왼손 거울, 세이프 에어리어만큼 올림)
    this.deck = new Deck(this, {
      hand: content.controls.handSetting ? controlHandOr(content.controls.defaultHand) : content.controls.defaultHand,
      lift: deckLiftPx(), chips: this.sim.missions.length,
      deadZonePx: content.controls.deadZonePx, axisHysteresisDeg: content.controls.axisHysteresisDeg,
    });
    this.hud = new Hud(this, this.sim, str, this.deck.layout);
    this.bannerBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.94).setScrollFactor(0).setDepth(11000).setStrokeStyle(1, color('dark'));
    this.banner = addPixelText(this, 0, 0, '', { role: 'body', color: color('outline'), align: 'center', lineSpacing: 3 }).setScrollFactor(0).setDepth(11001);
    const weekday = str.t(`day.weekday.${content.weekday}`);
    const title = str.variants(content.titleKey) > 1 ? str.t(content.titleKey, undefined, content.day) : str.t(content.titleKey);
    setPixelText(this.banner, `${str.t('day.intro', { n: content.day, weekday })}\n${title}`);
    placeText(this.banner, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT * 0.42, 0.5, 0.5);
    fitPanel(this.bannerBg, this.banner, 10, 7);

    this.vignette = this.add.graphics().setScrollFactor(0).setDepth(9500);
    this.centerBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.92).setScrollFactor(0).setDepth(9600).setStrokeStyle(1, color('point')).setVisible(false);
    this.centerText = addPixelText(this, 0, 0, '', { role: 'body', color: color('point'), align: 'center', scale: 2 }).setScrollFactor(0).setDepth(9601).setVisible(false);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.bindDomInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { audio.stopBgm(); this.domCleanup?.(); this.domCleanup = null; });
    if (import.meta.env.DEV) this.debugText = addPixelText(this, 2, HUD_TOP_PX + 1, '', { role: 'label', color: color('outline') }).setScrollFactor(0).setDepth(9700);
    audio.startBgm();
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
    const tex = this.hasAtlas ? this.textures.get(ATLAS_KEY) : null;
    const layout = buildTileLayout(c, (f) => !!tex && tex.has(f));
    if (import.meta.env.DEV && missingArt.size > 0) console.info(`[art] 없는 키 → 기존 키로 대체: ${[...missingArt].join(', ')}`);
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
      if ((o.frame === 'tall/stall' || o.frame === 'tile2/shower_stall') && o.tile) this.stalls.push({ img: im, x: o.tile.x, y: o.tile.y, base: o.frame, hiding: o.frame === 'tall/stall' ? 'tall/stall_hiding' : 'tile2/shower_stall_hiding' });
      if (o.occlude) this.occluders.push({ img: im, rect: o.occlude });
      if (o.memo) { im.setVisible(false); this.memoProps.push(im); }
      if (o.meetingDoor && tex?.has('tall2/glass_door_busy')) {
        this.busyDoors.push(this.img(this.offsetX + o.x, o.y, 'tall2/glass_door_busy').setOrigin(0.5, 1).setDepth(o.y + 0.5).setVisible(false));
      }
    }
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isGateOnly(map, x, y)) this.gateTiles.push({ x, y });
    // 세로 유리벽(D-053: 이동 차단·시선 통과)은 아트 T-135 스프라이트(tilemap.ts objects)로 그림
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
    if (this.overlay !== 'none') {
      // 오버레이 버튼만 받음. 결과·제안 화면이 뜬 직후 보호 시간(rules.input.resultInputGuardSec, BUG-006)
      if (this.overlay === 'cutin' || this.overlay === 'busy' || this.overlayAge < sim.content.resultInputGuardSec) return;
      const hit = this.buttons.find((x) => x.b.contains(pointer.x, pointer.y));
      if (hit) { audio.sfx('sfx_tap'); hit.act(); }
      return;
    }
    if (sim.phase === 'ended') return;
    const x = pointer.x, y = pointer.y, id = pointer.id;
    // ① 방향 패드: 이 터치는 뗄 때까지 패드 입력(포인터 잡기, 멀티터치 패드 1 + 행동 1)
    if (this.padPtr === null && this.deck.hitPad(x, y)) {
      this.padPtr = id;
      this.deck.resetJudge();
      sim.setPad(this.deck.judge(x, y));
      return;
    }
    // ② 행동 버튼
    if (this.actPtr === null && this.deck.hitAction(x, y)) {
      this.actPtr = { id, at: this.time.now };
      this.afterAction(sim.pressAction('button'));
      return;
    }
    // ③ HUD(칩·제안 말풍선·안내 상자)
    const hit = this.hud.hitTest(x, y);
    if (hit === 'offer') { if (sim.acceptOffer()) audio.sfx('sfx_pop'); return; }
    if (hit === 'hint') { this.hud.dismissHint(); return; }
    if (hit?.startsWith('chip:')) {
      const before = sim.guide?.id ?? null;
      if (sim.tapChip(hit.slice(5))) { const on = sim.guide && sim.guide.id !== before; audio.sfx(on ? 'sfx_pop' : 'sfx_tap', on ? 0.5 : 1); }
      return;
    }
    if (hit === 'hud' || this.deck.inDeck(x, y)) return;
    // ④ 게임 화면: 집중 상황이면 행동 버튼과 같음(누름·뗌 판정), 아니면 무시(1~3일차 안내)
    if (this.fieldPtr === null) {
      this.fieldPtr = { id, at: this.time.now };
      this.afterAction(sim.pressPlayfield());
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.padPtr !== pointer.id || !pointer.isDown) return;
    this.sim.setPad(this.deck.judge(pointer.x, pointer.y));
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const id = pointer.id;
    if (this.padPtr === id) { this.padPtr = null; this.deck.resetJudge(); this.sim.setPad(this.keyDir); }
    if (this.actPtr && this.actPtr.id === id) { const d = this.actPtr; this.actPtr = null; this.sim.releaseAction((this.time.now - d.at) / 1000); }
    if (this.fieldPtr && this.fieldPtr.id === id) { const d = this.fieldPtr; this.fieldPtr = null; this.sim.releasePlayfield((this.time.now - d.at) / 1000); }
  }

  /** M10: 입력이 끊기면(pointercancel·앱 전환·visibilitychange·창 blur) 모두 뗀 것으로(정지 = 위장) */
  private releaseAllInput(): void {
    if (this.actPtr) { const d = this.actPtr; this.actPtr = null; this.sim.releaseAction((this.time.now - d.at) / 1000); }
    if (this.fieldPtr) { const d = this.fieldPtr; this.fieldPtr = null; this.sim.releasePlayfield((this.time.now - d.at) / 1000); }
    this.padPtr = null; this.keyDir = null;
    this.deck.resetJudge();
    this.sim.setPad(null);
  }

  /** WebView 터치 설정(control-dpad §8-4): 끊김 = 떼기, 길게 누름 메뉴 차단. 개발 빌드는 방향키·스페이스도 받음 */
  private bindDomInput(): void {
    const canvas = this.game.canvas;
    const cancel = () => this.releaseAllInput();
    const vis = () => { if (document.visibilityState !== 'visible') cancel(); };
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('touchcancel', cancel);
    canvas.addEventListener('contextmenu', noMenu);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', vis);
    const KEYS: Record<string, PadDir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const down = (e: KeyboardEvent) => {
      const d = KEYS[e.key];
      if (d) { e.preventDefault(); if (this.keyDir !== d) { this.keyDir = d; if (this.padPtr === null) this.sim.setPad(d); } return; }
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && this.overlay === 'none') { e.preventDefault(); this.actPtr = { id: -1, at: this.time.now }; this.afterAction(this.sim.pressAction('button')); }
    };
    const up = (e: KeyboardEvent) => {
      const d = KEYS[e.key];
      if (d && this.keyDir === d) { this.keyDir = null; if (this.padPtr === null) this.sim.setPad(null); }
      if ((e.key === ' ' || e.key === 'Enter') && this.actPtr?.id === -1) { const a = this.actPtr; this.actPtr = null; this.sim.releaseAction((this.time.now - a.at) / 1000); }
    };
    if (import.meta.env.DEV) { window.addEventListener('keydown', down); window.addEventListener('keyup', up); }
    this.domCleanup = () => {
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('touchcancel', cancel);
      canvas.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }

  private afterAction(k: ActionKind | 'ignored'): void {
    if (k === 'none' || k === 'ignored') return;
    if (k !== 'greet') audio.sfx('sfx_tap', 0.8);
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    // 튜토리얼 슬로모(표시 시간만 늦춤, 판정은 같은 고정 스텝)
    if (this.overlay === 'none') this.sim.advance(dt * this.sim.timeScale);
    for (const e of this.sim.drainEvents()) this.onDayEvent(e);
    for (const e of this.sim.drainFloorEvents()) this.onFloorEvent(e);
    if (this.result) this.resultAge += dt;
    this.overlayAge += dt;
    if (this.overlay === 'cutin') { this.cutinLeft -= dt; if (this.cutinLeft <= 0) void this.afterCutin(); }
    this.syncView(dt);
  }

  private onDayEvent(e: DayEvent): void {
    const str = getStrings();
    switch (e.type) {
      case 'hint':
        // 튜토리얼 문구 키가 'tutorial.<id>'에 없고 '<id>'(missions.stringsKo)에 있으면 그것(T-145)
        if (e.key.startsWith('tutorial.') && !str.has(e.key) && !str.has(e.key.slice(9))) break; // 문구 없는 튜토리얼(기획 추가 대기)은 생략
        this.hud.hint(!str.has(e.key) && e.key.startsWith('tutorial.') && str.has(e.key.slice(9)) ? e.key.slice(9) : e.key);
        if (e.key.startsWith('tutorial.') && !this.seenHints.has(e.key)) { this.seenHints.add(e.key); this.saveSeenHints(); }
        break;
      case 'toast': this.showToast(str.t(e.key)); break;
      case 'closeCall': this.showToast(str.t('hud.close_call')); break;
      case 'missionDone': this.showToast(str.t('hud.mission_done')); audio.sfx('sfx_mission_complete'); break;
      case 'ceo':
        if (e.stage === 'tell') this.showCenter(str.t('hud.ceo_freeze'), 2.2);
        break;
      case 'qte':
        if (e.stage === 'cue') audio.sfx('sfx_pop');
        if (e.stage === 'result' && e.result === 'success') this.showToast(str.t(e.source === 'ceo' ? 'hud.mission_done' : 'hud.gate_ok'));
        break;
      case 'eyeContact': audio.sfx('sfx_mission_complete'); break;
      case 'offer': audio.sfx(this.cues.interrupt['INT-12'] ?? 'sfx_pop'); break;
      case 'accomplice':
        if (e.action === 'cough') { audio.sfx('sfx_cough'); this.npcSayFollower(str.t('npc.accomplice.cough')); }
        break;
      case 'say': this.npcSay(this.sim.floor.findNpc((n) => n.def.id === e.npc), str.t(e.key, { name: str.t('ui.player_default_name') }), e.sec); break;
      case 'routeHint': this.showRoutes(e.routes, e.sec); break;
      case 'offscreenDemo': this.demo = { actor: e.actor, left: e.sec }; break;
      case 'continued': this.stage.update(0, { stopped: false, freeze: false, turningOrSeeing: false, suspicion: 0, leavePhase: false, offscreenApproaching: 0 }); break;
      case 'missionFail': {
        const m = this.sim.content.missions.find((x) => x.id === e.id);
        this.showToast(str.t(e.reason === 'timeout' ? 'event.result.timeout' : 'event.result.fail', undefined, Math.floor(this.t)));
        void m;
        break;
      }
      case 'interrupt':
        if (e.textKey) this.showToast(str.t(e.textKey, { name: str.t('ui.player_default_name') }));
        if (e.id !== 'INT-12') audio.sfx(this.cues.interrupt[e.id]);
        break;
      case 'gate': {
        const cue = (this.sim.content.visualCues[e.result === 'pass' ? 'gateOk' : 'gateFail'] ?? {}) as Record<string, unknown>;
        const n = (k: string, d: number) => (typeof cue[k] === 'number' ? cue[k] as number : d);
        const flashes = n('flashes', e.result === 'pass' ? 1 : 3);
        const dur = n('durationSec', 0.6);
        this.gateFlash = { key: e.result === 'pass' ? 'gate_pass_flash' : 'gate_fail_flash', left: dur, flashes, on: dur / (flashes * 2), off: dur / (flashes * 2), icon: typeof cue['overlayIcon'] === 'string' ? cue['overlayIcon'] as string : 'ui/gate_fail' };
        if (e.result === 'pass') this.showToast(str.t(typeof cue['textKey'] === 'string' ? cue['textKey'] as string : 'hud.gate_ok'));
        else this.showToast(str.t('hud.gate_attempts_left', { n: this.sim.content.leave.gate.maxAttempts - this.sim.gateAttempts }));
        audio.sfx(typeof cue['pairsWith'] === 'string' ? cue['pairsWith'] as string : undefined);
        break;
      }
      case 'hrAbsent': this.showToast(str.t('react.hr_inspector.absent')); break;
      case 'tour':
        if (e.stage === 'stand') {
          // 출발 전조(D-075 확장): 의자 미는 소리(화면 밖이어도 1회) + 목적지 아이콘 말풍선 + 대사
          const sfx = (e.sfx ?? []).find((k) => audio.knows(k));
          if (sfx) audio.sfx(sfx);
          const npc = this.sim.floor.findNpc((n) => n.def.id === e.npc);
          const sec = (this.sim.content.bossTours?.[0]?.standTellSec ?? 1) + 0.6;
          // 처음 보는 아이콘(아트 미도착)은 대체표(iconFallback) → 그것도 없으면 아이콘 없이 대사만
          if (e.icon) this.tourIconFor = { npc: e.npc ?? '', left: sec, frame: this.atlasHas(e.icon) ? e.icon : this.atlasHas(iconFallback(e.icon)) ? iconFallback(e.icon) : '' };
          if (e.lineKey) this.npcSay(npc, str.t(e.lineKey), sec);
        }
        break;
      case 'tourEndTell': {
        const sfx = (e.sfx ?? []).find((k) => audio.knows(k));
        if (sfx) audio.sfx(sfx);
        if (e.lineKey) this.npcSay(this.sim.floor.findNpc((n) => n.def.id === e.npc), str.t(e.lineKey), 1.2);
        break;
      }
      case 'missionStage': {
        const SFX: Record<string, string> = { cupReady: 'sfx_cup_ready', parcelPicked: 'sfx_locker_open', printGrab: 'sfx_pop', cupPicked: 'sfx_pop' };
        let k = SFX[e.stage];
        if (e.stage === 'snackNoise' && e.id === 'chat') k = 'sfx_laugh_burst';
        if (e.stage === 'coffeeOverflow' && e.id === 'window') k = 'sfx_sneeze';
        if (e.stage === 'trayExposed') this.showToast(str.t('react.print.found'));
        if (e.stage === 'cupReady') this.showToast(str.t('event.cafe.name'));
        if (k) audio.sfx(k);
        break;
      }
      case 'couponStamp': audio.sfx('sfx_stamp'); break;
      case 'missionUnlocked': {
        // 변형이 붙은 미션: '미션 이름 · 변형 라벨'(시설 미션은 facilityLabelKey, S-04)
        const m = this.sim.content.missions.find((x) => x.id === e.id);
        if (m?.modifierLabels?.length) this.showToast(missionChipLabel(str, m));
        break;
      }
      case 'facility': {
        // C3 전조: 발소리 크레셴도(칸 안에서도 들림, audibleInsideStall) + 문구. other 날은 경고 없음(누가 쓰는지 알리지 않음, T-17)
        const st = this.sim.content.facility?.stop;
        if (e.stage === 'tell' && e.relation === 'same') {
          audio.sfx('sfx_footsteps_crescendo');
          if (st?.tellTextKey) this.showToast(str.t(st.tellTextKey));
        }
        break;
      }
      case 'phase': if (e.phase === 'day') { this.banner.setVisible(false); this.bannerBg.setVisible(false); } break;
      case 'result': this.onResult(); break;
      default: break;
    }
  }

  private onFloorEvent(e: SimEvent): void {
    const str = getStrings();
    if (e.type === 'tell') {
      // 전조 효과음: 앉은 상사 고유음 / 걷는 사람 walkTellSfx(화면 안일 때만, 화면 밖은 화살표 깜빡임)
      const npc = this.sim.floor.findNpc((n) => n.def.id === e.npc);
      // 순회 일어나기 전조(stop_tour_stand)는 의자 미는 소리가 이미 나므로 회전음 생략(BUG-018 출발 전조)
      if (npc && npc.gazeMultiplier > 0 && npc.tellKind !== 'talk' && npc.def.actorId && npc.stopId !== 'stop_tour_stand') {
        const actor = npc.def.actorId ?? '';
        const onlyOn = this.cues.walkTellOnScreenOnly[actor] !== false;
        const recheck = npc.tellKind === 'look' && npc.def.waypoints[npc.waypointIndex]?.lookIsRecheck === true;
        if (npc.def.seated || !onlyOn || this.sim.floor.isOnScreen(npc)) audio.sfx(tellSfxFor(this.cues, actor, !!npc.def.seated, npc.tellKind === 'turn' ? 'turn' : 'look', recheck));
      }
    } else if (e.type === 'talkWarn') {
      const npc = this.sim.floor.findNpc((n) => n.def.id === e.npc);
      const intId = npc?.def.actorId ? this.sim.content.actors[npc.def.actorId]?.talkEnabledBy : undefined;
      if (intId) audio.sfx(this.cues.interrupt[intId]);
    } else if (e.type === 'caught') {
      audio.sfx('sfx_caught');
    } else if (e.type === 'talkCancel') {
      const npc = this.sim.floor.findNpc((n) => n.def.id === e.npc);
      const actor = npc?.def.actorId ? this.sim.content.actors[npc.def.actorId] : undefined;
      // T-134 ④: 혼잣말은 조용한 취소(위장·그냥 지나감)에만. 들어왔다 피하면 돌아보기만 함
      if (e.reason === 'disguised' || e.reason === 'missed') this.npcSay(npc, str.t(actor?.dodgedLineKey ?? 'talk.dodged_default'), 1.4);
    } else if (e.type === 'talk') {
      const npc = this.sim.floor.findNpc((n) => n.def.id === e.npc);
      const actor = npc?.def.actorId ? this.sim.content.actors[npc.def.actorId] : undefined;
      const int = actor?.talkEnabledBy ? this.sim.content.interrupts.find((i) => i.id === actor.talkEnabledBy) : undefined;
      const lineKey = int ? (this.sim.phase === 'leave' && typeof int.effect['leaveLineKey'] === 'string' ? int.effect['leaveLineKey'] : int.effect['talkLineKey']) : undefined;
      if (typeof lineKey === 'string') this.npcSay(npc, str.t(lineKey, { name: str.t('ui.player_default_name') }, Math.floor(this.sim.time)), npc?.def.talk?.durationSec ?? 1.5);
    } else if (e.type === 'bump') {
      // M6 범프: '툭' 먼지(fx/bump, 무음 대응) + sfx_tap −6반음 별칭(sfx_bump, 없으면 sfx_tap 작게)
      const [vx, vy] = e.dir === 'up' ? [0, -1] : e.dir === 'down' ? [0, 1] : e.dir === 'left' ? [-1, 0] : [1, 0];
      const w = this.toWorld(e.x + 0.5 + vx! * 0.45, e.y + 0.5 + vy! * 0.45);
      this.bumpFx.setPosition(Math.round(w.x), Math.round(w.y)).setVisible(true);
      if (this.anims.exists('fx/bump')) this.bumpFx.play('fx/bump'); else this.time.delayedCall(200, () => this.bumpFx.setVisible(false));
      if (audio.knows('sfx_bump')) audio.sfx('sfx_bump'); else audio.sfx('sfx_tap', 0.4);
    }
  }

  private sayLeft = new Map<PatrolNpc, number>();
  private playerKey = 'player';
  private followerSay = 0;
  private followerBubble!: UIText;
  private followerBubbleBg!: Phaser.GameObjects.Rectangle;
  private npcSay(npc: PatrolNpc | undefined, text: string, sec: number): void {
    if (!npc) return;
    const v = this.viewFor(npc);
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
    // 외형 = 액터 + 변형(T-145). 변형 키가 아틀라스에 없으면 기본 외형
    const has = (f: string) => this.atlasHas(f);
    const info = this.sim.content.actors[actorId];
    const base0 = bg ? spriteKeyFor(undefined, bg.sprite, bg.variant, has) : spriteKeyFor(actorId, info?.spriteKey, info?.spriteVariant, has);
    // T-151 남녀 변형(D-103: <역할>_<m|f>/<프레임>, 데이터 spriteKey 우선). 그림이 없으면 기존 외형
    const sk = this.sim.content.skins;
    const want = sk ? (bg ? sk.background[npc.def.id] : sk.byPatrol[npc.def.patrolId ?? ''] ?? sk.byActor[actorId]) : undefined;
    const base = want && has(`${want}/idle_down`) ? want : base0;
    const lanyard = bg ? 'background' : (this.sim.content.actors[actorId]?.lanyard ?? 'background');
    const sprite = this.add.sprite(0, 0, ATLAS_KEY, `${base}/idle_down`).setOrigin(0.5, 1);
    // T-159 K-02: 머리 위 표식('!'·말풍선 아이콘·같은/다른 성별 표식)은 모든 말풍선·토스트(D.overhead + 1~3)보다 위
    const mark = this.add.sprite(0, 0, ATLAS_KEY, 'ui/suspect').setOrigin(0.5, 1).setDepth(D.overhead + 4).setVisible(false);
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

    // 위험 단계: BGM 2스템과 화면 테두리가 같은 단계·같은 히스테리시스(visualCues.dangerBorder.followsBgmHysteresis)
    const threats = new Map<PatrolNpc, Threat>();
    for (const n of floor.npcs) threats.set(n, floor.threatOfNpc(n));
    const offApproach = [...threats.entries()].filter(([n, th]) => (th === 'turning' || th === 'approaching') && n.gazeMultiplier > 0 && !floor.isOnScreen(n)).length;
    const turnSee = floor.gazeNow > 0 || [...threats.entries()].some(([n, th]) => th === 'turning' && n.gazeMultiplier > 0);
    const ds: DangerStage = this.stage.update(dt, {
      stopped: sim.phase === 'ended' || this.overlay !== 'none', freeze: sim.frozen, turningOrSeeing: turnSee,
      suspicion: sim.suspicion, leavePhase: sim.phase === 'leave', offscreenApproaching: offApproach,
    });
    audio.setStage(ds);
    const stage: BorderStage = sim.phase === 'intro' || ds === 'stopped' || ds === 'freeze' ? 'calm' : ds;
    // 의심 루프(보는 중 + 의심 0.5 이상)
    const loopOn = floor.gazeNow > 0 && sim.suspicion >= SUSP_LOOP_FROM && sim.phase !== 'ended';
    audio.loop('sfx_suspicion_loop', loopOn, Math.min(1.4, 1 + (sim.suspicion - SUSP_LOOP_FROM) * 0.8));

    // ── 플레이어 ──
    const p = floor.player;
    const pw = this.toWorld(p.x, p.y);
    // 손을 떼어 뒤쪽 칸 중심으로 붙는 순간(이동 방향 반대로 붙음) = 흠칫 반걸음(carry 중엔 건너뜀)
    if (this.prevPlayerMode === 'moving' && p.mode === 'disguised' && !p.centered && !sim.carryProp()) {
      const c = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
      const back = Math.cos(p.facing) * (c.x - p.x) + Math.sin(p.facing) * (c.y - p.y) < 0;
      if (back && this.atlasHas(`${this.playerKey}/disguise_step_back_${facing4(p.facing)}_0`)) this.stepBackLeft = 2 / 14;
    }
    if (p.mode === 'moving' || p.mode === 'talked') this.stepBackLeft = 0;
    this.prevPlayerMode = p.mode;
    const hidden = sim.activity?.mechanic === 'trip_safe_zone';
    this.player.setPosition(Math.round(pw.x), Math.round(pw.y) + FOOT_PX).setDepth(Math.round(pw.y) + FOOT_PX).setVisible(!hidden);
    const pdir = facing4(p.facing);
    let label = '';
    const pk = this.playerKey;
    if (sim.phase === 'ended' && sim.result?.outcome === 'caught') this.playAnim(this.player, `${pk}/caught`, `${pk}/caught`);
    else if (p.mode === 'moving') this.playAnim(this.player, `${pk}/walk_${pdir}`);
    else if (p.mode === 'talked') {
      this.playAnim(this.player, `${pk}/idle_${pdir}`);
      // T-159 K-02: 화장실 마주침 정지(본부장 대사 + 반응 토스트가 이미 있음)에는 '듣는 중…' 라벨을 더하지 않음
      const fsv0 = sim.facilityStopView();
      if (!(fsv0 && fsv0.relation === 'same' && fsv0.stage === 'inside')) label = str.t('player.mode.talked');
    }
    else if (sim.activity || sim.seatedWorking || (sim.phase === 'leave' && sim.leaveStage === 'pack' && sim.playerAtSeat)) this.playAnim(this.player, `${pk}/idle_up`);
    else if (this.stepBackLeft > 0 && floor.playerStill && !sim.gateOpen) {
      // M3 뒤로 붙기 = '흠칫 반걸음'(player/disguise_step_back_<dir>, 14fps 1회) → 이어서 위장 자세
      this.stepBackLeft -= dt;
      this.playAnim(this.player, `${pk}/disguise_step_back_${pdir}`, `${pk}/disguise`);
    } else if (floor.playerStill && !(sim.gateOpen)) {
      const pose = this.poseId();
      const d2 = pdir === 'up' ? 'down' : pdir;
      this.playAnim(this.player, `${pk}/pose_${pose}_${d2}`, `${pk}/disguise`);
      if (p.mode === 'disguised') label = str.t('player.mode.disguised');
    } else this.playAnim(this.player, `${pk}/idle_${pdir}`);
    setPixelText(this.playerLabel, label).setVisible(label !== '' && !hidden);
    placeText(this.playerLabel, pw.x, Math.round(pw.y) + FOOT_PX - 22, 0.5, 1);
    fitPanel(this.playerLabelBg, this.playerLabel, 2, 1);
    // 칸 안 플레이어는 그리지 않고 닫힌 문 + '사용 중'(하늘색 표시창)으로(S-02·artRules.occupantInStall)
    for (const s of this.stalls) { const on = hidden && p.tile.x === s.x && p.tile.y === s.y; s.img.setFrame(on && this.atlasHas(s.hiding) ? s.hiding : s.base); }

    // 토스트(플레이어 머리 위)
    if (this.toastLeft > 0) this.toastLeft -= dt;
    this.toast.setVisible(this.toastLeft > 0 && sim.phase !== 'ended');
    const tw = textBox(this.toast).w / 2 + 5;
    placeText(this.toast, Math.min(LOGICAL_WIDTH - tw, Math.max(tw, pw.x)), Math.round(pw.y) - 26 - (label ? 12 : 0), 0.5, 1);
    fitPanel(this.toastBg, this.toast, 3, 2);

    // ── 경로 점선·목적지 ──
    const path = p.remainingPath();
    const showPath = (p.mode === 'moving' || p.paused) && sim.phase !== 'ended';
    this.pathDots.forEach((d, i) => {
      const n = path[i];
      d.setVisible(showPath && !!n && i < path.length - 1);
      if (n) { const w = this.toWorld(n.x, n.y); d.setPosition(Math.round(w.x), Math.round(w.y)); }
    });
    this.syncPadExtras(dt, pw);

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
      // 대표님 재확인 전조(bosses.ceo.sim.fake.visual 'stop_and_shoulder', T-136 ③): 멈춘 채 어깨 들썩 = 1px 위아래(약 3Hz).
      // [임시] 전용 프레임이 아트에 없어 스프라이트 위치로 표현
      const shrug = npc.mode === 'tell' && npc.tellKind === 'look' && npc.def.waypoints[npc.waypointIndex]?.lookIsRecheck === true
        && Math.floor(npc.modeTime / 0.17) % 2 === 1 ? -1 : 0;
      const sx = Math.round(w.x + lx), sy = Math.round(w.y + ly) + FOOT_PX + shrug;
      v.sprite.setPosition(sx, sy).setDepth(sy).setVisible(npc.mode !== 'spawn');
      const dir: Facing4 = npc.tellKind === 'turn' && npc.pendingFacing !== null ? facing4(npc.pendingFacing) : facing4(npc.facing);
      const isFrozen = sim.frozen && npc !== sim.ceoOnFloor;
      if (isFrozen) {
        // 얼음(H3·H4): 모두 멈추고 고개 듦(정면). 배경 동료도 연출로 얼음
        v.sprite.anims.stop();
        const f = `${v.base}/idle_down`;
        if (this.textures.get(ATLAS_KEY).has(f)) v.sprite.setFrame(f);
      } else if (v.bgIdle && npc.mode !== 'walk') {
        if (t >= v.bgIdle.next) {
          const k = v.bgIdle.anims[Math.floor(t) % v.bgIdle.anims.length]!;
          const key = `${v.base}/${k.replace(/_\d+$/, '')}`;
          this.playAnim(v.sprite, key, `${v.base}/${k}`);
          // 1회 재생 애니(sit_stretch 등, repeat 0)는 끝나면 첫 번째 반복 애니(sit_type)로 복귀 (art §12)
          const a = this.anims.get(key);
          if (a && a.repeat === 0) {
            const loopKey = `${v.base}/${v.bgIdle.anims[0]!.replace(/_\d+$/, '')}`;
            v.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => { if (loopKey !== key) this.playAnim(v.sprite, loopKey); });
          }
          v.bgIdle.next = t + v.bgIdle.range[0] + ((Math.floor(t * 7) % 10) / 10) * (v.bgIdle.range[1] - v.bgIdle.range[0]);
        }
      } else if (npc.mode === 'walk') this.playAnim(v.sprite, `${v.base}/walk_${dir}`);
      else {
        // 팀장 순회 프레임(아트 §13-6): 앉음 sit_up/sit_down(dy −3), 출발 전조 rise_*(1회), 목적지 대기 포즈(wait_up). 애니가 없는 캐릭터는 idle
        const sd = dir === 'down' ? 'down' : dir === 'up' ? 'up' : null;
        const stop = sim.tourStopOf(npc);
        // 일어나기는 걷기 방향 전조(BUG-018) 중에도 자리 방향(facing) 기준으로 재생
        const f0 = facing4(npc.facing);
        const sdStand = f0 === 'down' ? 'down' : f0 === 'up' ? 'up' : null;
        const rise = sdStand ? `${v.base}/rise_${sdStand}` : '';
        const pose = stop?.pose && npc.mode === 'wait' ? this.poseAnim(v.base, stop.pose, f0) : null;
        if (npc.stopId === 'stop_tour_stand' && sdStand && this.anims.exists(rise)) {
          if (v.sprite.anims.currentAnim?.key !== rise) v.sprite.play(rise);
        } else if ((npc.def.seated || npc.stopId === 'stop_tour_sit') && sd && this.anims.exists(`${v.base}/sit_${sd}`)) {
          this.playAnim(v.sprite, `${v.base}/sit_${sd}`);
          v.sprite.setY(sy - 3);
        } else if (pose) this.playAnim(v.sprite, pose);
        else this.playAnim(v.sprite, `${v.base}/idle_${dir}`);
      }
      // 페이크(헛기침) 효과음: tell → fake 전환
      const pm = this.prevMode.get(npc);
      if (pm === 'tell' && npc.mode === 'fake' && npc.def.actorId) audio.sfx(this.cues.fake[npc.def.actorId] ?? 'sfx_cough');
      this.prevMode.set(npc, npc.mode);
      if (npc.mode !== 'spawn') this.shadows.fillEllipse(sx, sy - 1, 11, 4);

      const seeing = floor.seeing[i] === true && npc.gazeMultiplier > 0;
      const keys = coneOverlayKeys(v.lanyard);
      // 얼음 중 대표님 콘은 판정에 들어가지 않으므로 그리지 않음(보이는 콘 = 판정, 전역 규칙은 비네트로 표시)
      const ceoGlobal = npc === sim.ceoOnFloor && (sim.ceoState === 'tell' || sim.ceoState === 'freeze' || sim.ceoState === 'qte');
      if (npc.coneActive && !ceoGlobal) {
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
      const qteHere = sim.qteActive && npc === sim.ceoOnFloor;
      if (qteHere) {
        // 인사 QTE: '?'(예고) → '!'(지금 톡)
        const cue = sim.qte!.phase === 'window';
        v.mark.anims.stop(); v.mark.setFrame(cue ? 'ui/alert' : 'ui/suspect').setVisible(true).setPosition(sx, headY);
        if (!this.sayLeft.has(npc)) setPixelText(v.bubble, str.t(cue ? 'boss.ceo.cue' : 'boss.ceo.question'));
      } else if (isFrozen) {
        v.mark.setVisible(false);
      } else if (talkWarn) {
        this.playAnim(v.mark, 'hud/talk', 'hud/talk_0');
        v.mark.setVisible(true).setPosition(sx, headY);
        const actor = npc.def.actorId ? this.sim.content.actors[npc.def.actorId] : undefined;
        if (!this.sayLeft.has(npc)) setPixelText(v.bubble, str.t(actor?.warnLineKey ?? 'talk.warn_default', { name: str.t('ui.player_default_name') }));
      } else if (seeing) {
        v.mark.anims.stop(); v.mark.setFrame('ui/alert').setVisible(true).setPosition(sx, headY);
      } else if ((npc.mode === 'tell' || (npc.mode === 'wait' && npc.stopId === 'stop_tour_stand')) && npc.def.gazeMultiplier > 0) {
        // 팀장 순회 '일어나기 전조'(D-075, T-144)도 돌아보기 전조와 같은 '!' 깜빡임 [임시 표시 — 아트 전용 프레임 생기면 교체]
        v.mark.anims.stop(); v.mark.setFrame('ui/suspect').setVisible(blink).setPosition(sx, headY);
      } else if (npc.mode === 'talk' || npc.mode === 'phone') {
        v.mark.anims.stop(); v.mark.setFrame(npc.mode === 'phone' ? 'hud/hey' : 'hud/talk_2').setVisible(npc.mode === 'talk').setPosition(sx, headY);
      } else v.mark.setVisible(false);
      // T-151 본부장 화장실 들름: 판정에 걸리는 순간 머리 위 '!'(insideCue ≥ 0.4초, 콘 대신), 들름 동안 같은/다른 성별 표식(D-093)
      const fsv = sim.facilityStopView();
      if (fsv && fsv.npc === npc && !isFrozen) {
        const mk = fsv.cue ? (this.atlasHas('icon_door_alert') ? 'icon_door_alert' : 'ui/alert') : sim.content.skins?.mark[fsv.relation];
        if (mk && this.atlasHas(mk)) { v.mark.anims.stop(); v.mark.setFrame(mk).setVisible(true).setPosition(sx, headY); }
      }
      // 대사 말풍선
      const say = this.sayLeft.get(npc);
      if (say !== undefined) { const left = say - dt; if (left <= 0) this.sayLeft.delete(npc); else this.sayLeft.set(npc, left); }
      // T-159 K-02: 본부장 화장실 들름 장면에서는 본부장 말풍선만(+ 플레이어 토스트 = 최대 2개). 다른 인물의 말걸기 전조는 머리 위 아이콘(mark)으로 남음
      const facQuiet = !!fsv && fsv.npc !== npc && fsv.relation === 'same' && fsv.stage !== 'walk';
      const bubbleOn = (this.sayLeft.has(npc) || talkWarn || qteHere) && !facQuiet;
      v.bubble.setVisible(bubbleOn);
      if (bubbleOn) {
        placeText(v.bubble, Math.min(LOGICAL_WIDTH - 58, Math.max(58, sx)), headY - 13, 0.5, 1);
        fitPanel(v.bubbleBg, v.bubble, 3, 2);
      } else v.bubbleBg.setVisible(false);

      // 화면 밖 경고 화살표(D-034, 색 = 사원증 줄, 크기 = 거리 3단계)
      const th = threats.get(npc) ?? 'none';
      const ak = edgeArrowKey(v.lanyard);
      const demo = this.demo && npc.def.actorId === this.demo.actor;
      if (ak && !floor.isOnScreen(npc) && (demo || th === 'turning' || th === 'approaching') && npc.gazeMultiplier >= 0 && arrowIdx < this.arrows.length) {
        if ((th === 'turning' || demo) && !blink) continue;
        const above = npc.y < (floor.camera?.visibleTop ?? 0);
        const edgeTiles = above ? (floor.camera?.visibleTop ?? 0) - npc.y : npc.y - (floor.camera?.visibleBottom ?? 0);
        const size = edgeTiles < 3 ? 3 : edgeTiles < 7 ? 2 : 1;
        const ar = this.arrows[arrowIdx++]!;
        const ay = above ? HUD_TOP_PX + ARROW_MARGIN : LOGICAL_HEIGHT - deckBottomPx() - ARROW_MARGIN;
        ar.setFrame(`${ak}/down_${size}`).setVisible(true).setAngle(above ? 180 : 0)
          .setPosition(Math.round(Phaser.Math.Clamp(sx, ARROW_MARGIN, LOGICAL_WIDTH - ARROW_MARGIN)), ay);
      }
      void camTop;
    }
    for (let k = arrowIdx; k < this.arrows.length; k++) this.arrows[k]!.setVisible(false);
    // T-159 K-02: 화장실 마주침에서 반응 토스트(플레이어 머리 위)가 본부장 말풍선과 겹치면 토스트를 말풍선 위로 올림(말풍선 2개가 포개지지 않게)
    const fsvT = sim.facilityStopView();
    const dv = fsvT && fsvT.relation === 'same' ? this.views.get(fsvT.npc) : undefined;
    if (dv && dv.bubbleBg.visible && this.toast.visible) {
      const a = this.toastBg.getBounds(), b = dv.bubbleBg.getBounds();
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) { // (Phaser.Geom은 커스텀 빌드에 없음)
        placeText(this.toast, textBoxCenterX(this.toast, a.centerX), Math.floor(b.top) - 4, 0.5, 1);
        fitPanel(this.toastBg, this.toast, 3, 2);
      }
    }
    if (this.demo) { this.demo.left -= dt; if (this.demo.left <= 0) this.demo = null; }
    this.syncExtras(dt, pw);
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

  /** T-133 표시: 공범, 얼음 비네트, 중앙 문구, 경로 힌트, 화면 밖 미션 장소 화살표 */
  /** T-170 조작대·길 안내·사용 표시·머리 위 행동 아이콘·디버그 오버레이 */
  private syncPadExtras(dt: number, pw: { x: number; y: number }): void {
    const sim = this.sim, str = getStrings();
    const playing = sim.phase !== 'ended' && this.overlay === 'none';
    const act = sim.actionState();
    const hk = this.hud.hintKey;
    const label = act.labelKey && str.has(act.labelKey) ? str.t(act.labelKey) : '';
    const fz = sim.padFreezeProgress;
    this.deck.update(this.t, {
      padInput: playing ? sim.padInput : null,
      locked: sim.padLocked && sim.phase !== 'intro',
      freeze: fz,
      action: act,
      actionPressed: this.actPtr !== null,
      pulseAction: playing && (hk === 'tutorial.tut_use' || hk === 'tutorial.tut_gate' || hk === 'tutorial.tut_coffee' || (act.kind === 'use' && sim.content.tutorialIds.includes('tut_use'))),
      pulsePad: playing && hk === 'tutorial.tut_pad_move',
      handRelease: playing && hk === 'tutorial.tut_pad_release',
      padText: playing && fz !== null && str.has('hud.pad_frozen') ? str.t('hud.pad_frozen') : '',
      actionLabel: label,
    });
    // 길 안내: 앞 N칸 발자국(진행 방향으로 회전) + 목적지 핀(칸 중심 4px 아래). 화면 밖 목적지는 흰 화살표(syncExtras)
    const g = playing ? sim.guide : null;
    const trail = g?.trail ?? [];
    let prev = sim.floor.player.tile;
    this.guideSteps.forEach((sp, i) => {
      const tt = trail[i];
      sp.setVisible(!!tt);
      if (!tt) return;
      const ang = tt.x > prev.x ? 90 : tt.x < prev.x ? -90 : tt.y > prev.y ? 180 : 0;
      sp.setAngle(ang).setPosition(this.offsetX + tt.x * TILE + TILE / 2, tt.y * TILE + TILE / 2);
      prev = tt;
    });
    this.guidePin.setVisible(!!g);
    if (g) this.guidePin.setPosition(this.offsetX + g.goal.x * TILE + TILE / 2, g.goal.y * TILE + TILE / 2 + 4).setDepth(g.goal.y * TILE + TILE + 2);
    // 사용 가능한 사물 위 작은 흰 화살표(fx/use_hint)
    const ut = playing && act.kind === 'use' ? act.useTile : undefined;
    this.useHint.setVisible(!!ut);
    if (ut) this.useHint.setPosition(this.offsetX + ut.x * TILE + TILE / 2, ut.y * TILE - 4);
    // 행동 아이콘이 바뀌면 머리 위에도 0.6초(엄지에 버튼이 가려도 알 수 있게, §8-2)
    const iconKey = act.kind === 'none' ? '' : act.icon;
    if (iconKey !== this.lastActionIcon) { this.lastActionIcon = iconKey; if (iconKey) this.headIconLeft = 0.6; }
    if (this.headIconLeft > 0) this.headIconLeft -= dt;
    const hf = `fx/head_icon/${iconKey}`;
    const showHead = playing && this.headIconLeft > 0 && !!iconKey && this.atlasHas(hf) && this.player.visible;
    this.headIcon.setVisible(showHead);
    if (showHead) this.headIcon.setFrame(hf).setPosition(Math.round(pw.x), Math.round(pw.y) - 18);
    // 개발 빌드 전용: 이동 구간 η·범프·코너 보정(control-dpad §9-3 #12)
    if (this.debugText) {
      const eta = sim.padEta;
      const ps = sim.floor.padStats;
      setPixelText(this.debugText, `eta ${eta === null ? '-' : eta.toFixed(2)} trip ${sim.padMetrics.trips} bump ${ps.bumps} assist ${ps.cornerAssists}`);
    }
  }

  private atlasHas(frame: string): boolean { return this.hasAtlas && this.textures.get(ATLAS_KEY).has(frame); }

  /**
   * 순회 목적지 대기 포즈(데이터 pose 'teamlead/wait_up', 'teamlead/wait_side' 등) → 이 인물 외형의 애니 키(T-164).
   * 접두(캐릭터)는 데이터 값 대신 지금 외형(v.base: teamlead_m/_f)으로 바꾸고(D-087·D-088: 그림만 다르고 판정 같음),
   * 그 이름이 없으면 바라보는 방향 접미('_left'·'_right'·'_up'·'_down')를 붙여 찾는다. 다 없으면 데이터 원본 키, 그래도 없으면 null(idle)
   */
  private poseAnim(base: string, pose: string, facing: Facing4): string | null {
    const name = pose.includes('/') ? pose.slice(pose.indexOf('/') + 1) : pose;
    const cands = [`${base}/${name}`, `${base}/${name}_${facing}`, pose, `${pose}_${facing}`];
    return cands.find((k) => this.anims.exists(k)) ?? null;
  }

  private syncExtras(dt: number, pw: { x: number; y: number }): void {
    const sim = this.sim, floor = sim.floor;
    // T-151 C3 전조(same 날): 내 화장실 문 위 '!' + 문 그림자(칸 안에서도 보임). other 날은 경고 없음
    const fsv = sim.facilityStopView();
    const alertOn = !!fsv && fsv.relation === 'same' && fsv.stage !== 'inside';
    this.doorAlert.setVisible(alertOn && Math.floor(this.t / 0.25) % 2 === 0);
    if (alertOn) {
      const d = fsv!.door;
      this.doorAlert.setPosition(this.offsetX + d.x * TILE + TILE / 2, d.y * TILE - 2);
      const sh = overlay('shadow');
      this.fx.fillStyle(sh.color, Math.min(0.6, sh.alpha * 2)).fillRect(this.offsetX + d.x * TILE + 2, d.y * TILE + 10, TILE - 4, 5);
    }
    // T-151 C4: 청소 중 표지 + 남은 초(미화팀 인물 없음, tone-guide #9)
    const cl = sim.content.facility?.cleaning;
    const clOn = !!cl && sim.cleaningActive && sim.phase === 'day';
    this.cleanSign?.setVisible(clOn);
    this.cleanLabel.setVisible(clOn);
    if (clOn) {
      const d = sim.content.facility!.restroom.mine.door;
      setPixelText(this.cleanLabel, getStrings().t(cl!.signKey, { n: Math.ceil(sim.cleaningLeftSec) }));
      placeText(this.cleanLabel, Math.min(LOGICAL_WIDTH - 40, Math.max(40, this.offsetX + d.x * TILE + TILE / 2)), d.y * TILE - 4, 0.5, 1);
      fitPanel(this.cleanLabelBg, this.cleanLabel, 2, 1);
    } else this.cleanLabelBg.setVisible(false);
    // D-080: 전높이 칸막이·큐비클 뒤에 선 플레이어 → 칸막이 알파 0.5
    const pt = floor.player.tile;
    for (const o of this.occluders) {
      const [rx, ry, rw, rh] = o.rect;
      o.img.setAlpha(pt.x >= rx && pt.x < rx + rw && pt.y >= ry && pt.y < ry + rh ? 0.5 : 1);
    }
    // 회의실 문 '사용 중'(순회 meeting, 통행은 유지)
    const busy = sim.meetingDoorBusy();
    for (const d of this.busyDoors) d.setVisible(busy);
    // 메모 남기기: 목적지 대기를 마치고 복귀 전조(몸 돌림)에 들어가면 메모지 표시(이후 그날 유지)
    if (this.memoProps.length > 0 && !this.memoProps[0]!.visible
      && sim.touringNpcs().some((n) => sim.tourStopOf(n)?.id === 'desk_memo' && n.mode === 'tell' && n.tellKind === 'turn')) {
      for (const m of this.memoProps) m.setVisible(true);
    }
    // 팀장 출발 말풍선 아이콘
    if (this.tourIconFor) {
      this.tourIconFor.left -= dt;
      const npc = floor.findNpc((n) => n.def.id === this.tourIconFor!.npc);
      const v = npc ? this.views.get(npc) : undefined;
      if (!v || this.tourIconFor.left <= 0 || !this.tourIconFor.frame) { this.tourIcon.setVisible(false); if (!v || this.tourIconFor.left <= 0) this.tourIconFor = null; }
      else {
        // BUG-023: 대사 말풍선이 떠 있으면 아이콘을 말풍선 위(가운데)에 둬 문구를 가리지 않음. 말풍선이 없으면 머리 위
        const bub = v.bubbleBg.visible ? v.bubbleBg.getBounds() : null;
        const iy = bub ? Math.round(bub.top) - Math.ceil(this.tourIcon.displayHeight / 2) - 1 : v.sprite.y - 30;
        const ix = bub ? Math.round(bub.centerX) : v.sprite.x;
        this.tourIcon.setFrame(this.tourIconFor.frame).setPosition(ix, iy).setVisible(true);
      }
    } else this.tourIcon.setVisible(false);
    // HUD '자리 비움' 배지(남은 시간은 표시 안 함)
    // 자리 비움 = 의자를 떠난 뒤(일어나기 전조 중에는 아직 자리)
    const away = sim.phase === 'day' && sim.touringNpcs().some((n) => !(n.stopId === 'stop_tour_stand' && n.mode !== 'walk'));
    this.awayBadge.setVisible(away);
    // T-155: 튜토리얼·안내 상자(같은 HUD_TOP_PX + 6 줄, 화면 폭 전체)가 떠 있으면 그 아래로 내려 겹치지 않게
    if (away) {
      const hb = this.hud.hintBottomPx();
      placeText(this.awayBadge, LOGICAL_WIDTH - 6, hb !== null ? Math.ceil(hb) + 5 : HUD_TOP_PX + 6, 1, 0);
      fitPanel(this.awayBadgeBg, this.awayBadge, 3, 2);
    } else this.awayBadgeBg.setVisible(false);
    // 들고 오는 소품(아트 player/carry_* 전 임시: 미션 아이콘을 머리 위에)
    const prop = sim.phase === 'day' ? sim.carryProp() : null;
    const carryM = prop ? sim.missions.find((m) => m.state === 'carry') : undefined;
    const icon = carryM && this.atlasHas(carryM.def.iconSprite) ? carryM.def.iconSprite : carryM ? iconFallback(carryM.def.iconSprite) : null;
    this.carryIcon.setVisible(!!icon && this.atlasHas(icon));
    if (icon && this.atlasHas(icon)) this.carryIcon.setFrame(icon).setPosition(Math.round(pw.x), Math.round(pw.y) - 14);
    // 출력 진행 루프(sfx_printer_run: 시작 loop true, 완료·일시정지 false)
    audio.loop('sfx_printer_run', sim.printing && this.overlay === 'none');
    // 공범 동료(따라오기)
    const f = sim.follower;
    if (f && !this.follower) this.follower = this.add.sprite(0, 0, ATLAS_KEY, 'accomplice/idle_down').setOrigin(0.5, 1);
    if (!f && this.follower) { this.follower.destroy(); this.follower = null; }
    if (f && this.follower) {
      const w = this.toWorld(f.x, f.y);
      const sy = Math.round(w.y) + FOOT_PX;
      this.follower.setPosition(Math.round(w.x), sy).setDepth(sy);
      const d = facing4(f.facing);
      this.playAnim(this.follower, f.moving ? `accomplice/walk_${d}` : `accomplice/idle_${d}`, `accomplice/idle_${d}`);
      this.shadows.fillEllipse(Math.round(w.x), sy - 1, 11, 4);
      if (this.followerSay > 0) {
        this.followerSay -= dt;
        placeText(this.followerBubble, Math.min(LOGICAL_WIDTH - 50, Math.max(50, w.x)), sy - 34, 0.5, 1);
        this.followerBubble.setVisible(this.followerSay > 0);
        fitPanel(this.followerBubbleBg, this.followerBubble, 3, 2);
      }
    }
    if (!f || this.followerSay <= 0) { this.followerBubble.setVisible(false); this.followerBubbleBg.setVisible(false); }
    // 대표님 순시 비네트(all_heads_up_vignette, 무음에서도 BGM 정지와 같은 정보). 색은 팔레트 dark
    const vg = this.vignette;
    vg.clear();
    if (sim.frozen) {
      const top = HUD_TOP_PX, bot = LOGICAL_HEIGHT - deckBottomPx(), h = bot - top;
      // 화면 전체를 살짝 어둡게 + 가장자리 4단 띠(바깥일수록 진함). 깜빡임 없음
      vg.fillStyle(color('dark'), 0.16).fillRect(0, top, LOGICAL_WIDTH, h);
      for (let i = 0; i < 4; i++) {
        const e = 10 * (i + 1);
        vg.fillStyle(color('dark'), 0.16);
        vg.fillRect(0, top, LOGICAL_WIDTH, e).fillRect(0, bot - e, LOGICAL_WIDTH, e);
        vg.fillRect(0, top + e, e, h - 2 * e).fillRect(LOGICAL_WIDTH - e, top + e, e, h - 2 * e);
      }
    }
    // 중앙 큰 문구('얼음!', QTE '!')
    if (sim.qteActive && sim.qte!.phase === 'window') this.showCenter(getStrings().t('hud.tell_mark'), 0.05);
    if (this.centerLeft > 0) this.centerLeft -= dt;
    const showC = this.centerLeft > 0 && this.overlay === 'none';
    this.centerText.setVisible(showC);
    if (showC) { placeText(this.centerText, LOGICAL_WIDTH / 2, HUD_TOP_PX + 64, 0.5, 0.5); fitPanel(this.centerBg, this.centerText, 6, 4); }
    else this.centerBg.setVisible(false);
    // 경로 힌트 점선(dot/hint = 우회, dot/caution = 지름길)
    if (this.routeLeft > 0) { this.routeLeft -= dt; if (this.routeLeft <= 0) for (const d of this.routeDots) d.img.setVisible(false); }
    // zone_only(T-155): 드러난 장소 반짝임(하늘색 점선 링)
    for (const m of sim.missions) {
      if (!m.def.zoneEntry) continue;
      const on = sim.phase === 'day' && !!m.revealed && (m.state === 'open' || m.state === 'locked');
      let zh = this.zoneHints.get(m.def.id);
      if (on && !zh && this.atlasHas('fx/zone_hint')) {
        zh = this.add.sprite(this.offsetX + m.def.spot.x * TILE + TILE / 2, m.def.spot.y * TILE + TILE / 2, ATLAS_KEY, 'fx/zone_hint').setDepth(D.cover + 3);
        if (this.anims.exists('fx/zone_hint')) zh.play('fx/zone_hint');
        this.zoneHints.set(m.def.id, zh);
      }
      zh?.setVisible(on);
    }
    // 화면 밖 미션 장소(흰 화살표, offscreenWarning.missionMarkerArrows)
    let ai = 0;
    const cam = floor.camera;
    if (cam && (sim.phase === 'day' || (sim.phase === 'leave' && !!sim.guide))) {
      const targets: { x: number; y: number }[] = [];
      for (const m of sim.missions) {
        if (m.state === 'carry') targets.push(sim.content.playerSeat);
        else if ((m.state === 'open' && !m.blocked && m.def.startsAt === 'arrive_spot') || sim.pendingMission === m) targets.push(sim.missionTarget(m));
      }
      // T-170: 길 안내 목적지(핀)가 화면 밖이면 기존 흰 화살표
      const gg = sim.guide?.goal;
      if (gg && !targets.some((q) => q.x === gg.x && q.y === gg.y)) targets.unshift(gg);
      for (const tg of targets) {
        if (ai >= this.missionArrows.length) break;
        const cy = tg.y + 0.5;
        if (cy >= cam.visibleTop && cy <= cam.visibleBottom) continue;
        const above = cy < cam.visibleTop;
        const ar = this.missionArrows[ai++]!;
        const x = Phaser.Math.Clamp(this.offsetX + tg.x * TILE + TILE / 2, ARROW_MARGIN, LOGICAL_WIDTH - ARROW_MARGIN);
        ar.setVisible(true).setAngle(above ? 180 : 0).setPosition(Math.round(x), above ? HUD_TOP_PX + ARROW_MARGIN + 10 : LOGICAL_HEIGHT - deckBottomPx() - ARROW_MARGIN - 10);
      }
    }
    for (let k = ai; k < this.missionArrows.length; k++) this.missionArrows[k]!.setVisible(false);
    void pw;
  }

  private showRoutes(routes: readonly { kind: 'hint' | 'caution'; tiles: readonly { x: number; y: number }[] }[], sec: number): void {
    let i = 0;
    for (const r of routes) {
      for (let k = 0; k < r.tiles.length; k += 1) {
        const d = this.routeDots[i++];
        if (!d) break;
        const tt = r.tiles[k]!;
        d.img.setFrame(r.kind === 'hint' ? 'dot/hint' : 'dot/caution').setVisible(true)
          .setPosition(this.offsetX + tt.x * TILE + TILE / 2, tt.y * TILE + TILE / 2);
      }
    }
    for (; i < this.routeDots.length; i++) this.routeDots[i]!.img.setVisible(false);
    this.routeLeft = sec;
  }

  private showCenter(text: string, sec: number): void {
    setPixelText(this.centerText, text);
    this.centerLeft = Math.max(this.centerLeft, sec);
  }

  private npcSayFollower(text: string): void {
    setPixelText(this.followerBubble, text);
    this.followerSay = 1.2;
  }

  private saveSeenHints(): void {
    const st = getPlatform().storage;
    const keys = [...this.seenHints];
    void loadProgress(st).then((p) => saveProgress(st, { ...p, seenHints: keys }));
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

  // ── 판 종료: 적발 컷인(플레이 상태) → 이어하기 제안(D-050) → 결과(월급·2배 버튼) → 전면광고 예고(D-031) → 다음 날 ──

  private onResult(): void {
    const r = this.sim.result;
    if (!r) return;
    this.releaseAllInput();
    audio.loop('sfx_suspicion_loop', false);
    if (r.outcome === 'caught') {
      // 컷인(rules.caughtCutin.durationSec): 잡은 사람의 리액션. 이 동안은 플레이 상태라 광고·광고 제안 없음(ads.global.playStates caught_cutin, D-023·D-050 ①)
      this.overlay = 'cutin';
      this.overlayAge = 0;
      this.cutinLeft = this.sim.content.caughtCutinSec ?? 0;
      const str = getStrings();
      const react = r.reactionKey ? str.t(r.reactionKey, { name: str.t('ui.player_default_name') }, Math.floor(r.timeSec)) : '';
      this.panel([str.t('result.title_caught'), react].filter((x) => x).join('\n\n'), LOGICAL_HEIGHT * 0.4);
      return;
    }
    audio.sfx('sfx_clockout_fanfare');
    this.showResult();
  }

  private async afterCutin(): Promise<void> {
    if (this.overlay !== 'cutin') return;
    this.overlay = 'busy';
    const sim = this.sim;
    // ⑥ 광고 미지원·하루 상한이면 제안 화면을 건너뜀(누를 수 없는 버튼 금지)
    const can = sim.canContinue && (await this.ads.canOffer('continue'));
    if (!this.scene.isActive()) return;
    this.clearOverlay();
    if (can) this.showContinueOffer(); else this.showResult();
  }

  private clearOverlay(): void {
    for (const o of this.ovObjects) o.destroy();
    for (const b of this.buttons) b.b.destroy();
    this.ovObjects = [];
    this.buttons = [];
    this.salaryText = null;
  }

  /** 중앙 패널 + 여러 줄 글자. 반환: 글자 아래 y */
  private panel(text: string, cy: number, extraBottom = 0): number {
    const bg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.96).setScrollFactor(0).setDepth(OV).setStrokeStyle(1, color('dark'));
    const t = addPixelText(this, 0, 0, text, { role: 'label', color: color('outline'), align: 'center', lineSpacing: 3 }).setScrollFactor(0).setDepth(OV + 1);
    setWrap(t, LOGICAL_WIDTH - 36);
    placeText(t, LOGICAL_WIDTH / 2, cy, 0.5, 0.5);
    fitPanel(bg, t, 10, 8);
    bg.setSize(bg.width, bg.height + extraBottom);
    this.ovObjects.push(bg, t);
    const b = t.getBounds();
    return Math.round(b.bottom);
  }

  private addButton(y: number, text: string, act: () => void): UiButton {
    // D-050 ②: 제안 화면의 두 버튼은 같은 크기·같은 스타일(normal)
    const b = new UiButton(this, 22, y, LOGICAL_WIDTH - 44, 26, text, { depth: OV + 2, style: 'normal', role: 'label' });
    this.buttons.push({ b, act });
    return b;
  }

  /**
   * 이어하기 제안(D-050 ①~⑦): 탭 전 광고 없음, 같은 크기 거절 버튼, 카운트다운 없음, 광고·보상 명시,
   * 보상 수령 때만 재개(실패·중도 종료 = 결과 + 안내, 자동 재시도 없음), 중립적 거절 문구.
   */
  private showContinueOffer(): void {
    const str = getStrings();
    const pl = this.ads.placement('continue');
    this.overlay = 'offer';
    this.overlayAge = 0;
    const lines = [str.t('result.title_caught'), '', str.t(pl?.descKey ?? 'ad.continue_desc'), '', str.t('ad.continue_leaderboard_note')];
    const bottom = this.panel(lines.join('\n'), LOGICAL_HEIGHT * 0.32, 72);
    const y1 = bottom + 14;
    const yes = this.addButton(y1, str.t(pl?.labelKey ?? 'ad.continue'), () => { void this.watchContinue(); });
    this.addButton(y1 + yes.h + 8, str.t(pl?.declineLabelKey ?? 'ad.continue_decline'), () => { this.clearOverlay(); this.showResult(); });
  }

  private async watchContinue(): Promise<void> {
    const str = getStrings();
    const pl = this.ads.placement('continue');
    this.overlay = 'busy';
    for (const b of this.buttons) b.b.setEnabled(false);
    const r = await this.ads.showRewarded('continue');
    if (!this.scene.isActive()) return;
    this.clearOverlay();
    if (r === 'rewarded' && this.sim.continueFromCheckpoint()) {
      this.rewardedThisGame = true;
      this.overlay = 'none';
      this.result = null;
      return;
    }
    // ⑤ 중도 종료·실패: 결과 화면 + 안내(자동 재시도·다른 광고 없음)
    this.showResult();
    this.showOverlayToast(str.t(r === 'not_completed' ? (pl?.notCompletedKey ?? 'ad.continue_not_completed') : (pl?.unavailableKey ?? 'ad.continue_unavailable')));
  }

  private salaryNow(): number {
    const r = this.sim.result;
    return r ? r.salary * (this.salaryDoubled ? 2 : 1) : 0;
  }

  private showResult(): void {
    const r = this.sim.result;
    if (!r) return;
    const str = getStrings();
    this.overlay = 'result';
    this.overlayAge = 0;
    this.result = this.result ?? addPixelText(this, -100, -100, '', { role: 'label' }).setVisible(false);
    this.resultAge = 0;
    const reaction = r.outcome !== 'caught' && r.reactionKey ? str.t(r.reactionKey, { name: str.t('ui.player_default_name') }, Math.floor(r.timeSec)) : '';
    const lines = [
      str.t(r.titleKey),
      str.t('result.stars', { n: r.stars }),
      reaction,
      r.eyeContact ? str.t('boss.ceo.eye_contact') : '',
      str.t('result.peak_suspicion', { n: Math.round(r.peakSuspicion * 100) }),
      str.t('result.missions', { n: r.missionsDone, total: r.missionsTotal }),
      `${str.t('hud.work')} ${Math.round(r.work * 100)}% / ${Math.round(r.quota * 100)}%`,
      str.t('result.slack_points', { n: r.slackPoints }),
      str.t('result.play_time', { n: r.timeSec.toFixed(1) }),
      r.continued ? str.t('result.leaderboard_skipped_continue') : '',
      // T-170 §6-1 ⑩: 1일차 결과 화면 한 줄 '설정에서 조작 위치를 바꿀 수 있어요'(한 번만)
      this.handSettingLine(),
    ].filter((l) => l !== '');
    const bottom = this.panel(lines.join('\n'), LOGICAL_HEIGHT * 0.36, 86);
    // 월급(닢, D-061)은 따로 크게
    const sal = addPixelText(this, 0, 0, str.t('result.salary', { n: this.salaryNow() }), { role: 'body', color: color('outline') }).setScrollFactor(0).setDepth(OV + 1);
    placeText(sal, LOGICAL_WIDTH / 2, bottom + 12, 0.5, 0.5);
    this.ovObjects.push(sal);
    this.salaryText = sal;
    let y = bottom + 24;
    // ⑧ 월급 2배는 버튼으로만(팝업 자동 제안 없음). 이어하기를 본 판에도 버튼은 둘 수 있음(전면만 생략)
    const pl = this.ads.placement('salary_double');
    const nextLabel = str.t(r.stars >= 1 ? 'ui.next_day' : 'ui.retry');
    const next = this.addButton(y + 32, nextLabel, () => { void this.finishDay(); });
    void (async () => {
      const ok = r.salary > 0 && (await this.ads.canOffer('salary_double'));
      if (!ok || !this.scene.isActive() || this.overlay !== 'result') return;
      this.addButton(y, str.t(pl?.labelKey ?? 'ad.salary_double'), () => { void this.watchSalaryDouble(); });
    })();
    void next;
    // '오늘 광고 끝'(D-031·D-066): 하루 보상형 상한이면 보상형 버튼은 canOffer에서 숨겨지고, 안내 토스트는 하루 1회
    void this.notifyDailyCap();
    y += 0;
  }

  private handSettingLine(): string {
    const key = 'tutorial.tut_hand_setting';
    const str = getStrings();
    if (!this.sim.content.tutorialIds.includes('tut_hand_setting') || !str.has(key) || this.seenHints.has(key)) return '';
    this.seenHints.add(key);
    this.saveSeenHints();
    return str.t(key);
  }

  private async watchSalaryDouble(): Promise<void> {
    const str = getStrings();
    const btn = this.buttons.find((x) => x.b.label.text === str.t(this.ads.placement('salary_double')?.labelKey ?? 'ad.salary_double'));
    this.overlay = 'busy';
    btn?.b.setEnabled(false);
    const r = await this.ads.showRewarded('salary_double');
    if (!this.scene.isActive()) return;
    this.overlay = 'result';
    if (r === 'rewarded') {
      this.salaryDoubled = true;
      this.rewardedThisGame = true;
      if (btn) { btn.b.setVisible(false); btn.b.enabled = false; }
      void this.notifyDailyCap();
      if (this.salaryText) { setPixelText(this.salaryText, str.t('result.salary', { n: this.salaryNow() })); placeText(this.salaryText, LOGICAL_WIDTH / 2, this.salaryText.y + 6, 0.5, 0.5); }
    } else {
      btn?.b.setEnabled(true);
      if (r === 'unavailable') this.showOverlayToast(str.t('ad.continue_unavailable'));
    }
  }

  /** D-066: 하루 보상형 상한 도달 안내(ads.rewarded.dailyCapReachedKey). 같은 날 1회 */
  private async notifyDailyCap(): Promise<void> {
    const key = await this.ads.dailyCapNoticeKey();
    if (!key || !this.scene.isActive() || this.overlay !== 'result') return;
    const str = getStrings();
    if (str.has(key)) this.showOverlayToast(str.t(key));
  }

  private toastOv: { t: UIText; bg: Phaser.GameObjects.Rectangle; left: number } | null = null;
  private showOverlayToast(text: string, sec = 2.2): void {
    if (this.toastOv) { this.toastOv.t.destroy(); this.toastOv.bg.destroy(); }
    const bg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.97).setScrollFactor(0).setDepth(OV + 10).setStrokeStyle(1, color('point2'));
    const t = addPixelText(this, 0, 0, text, { role: 'label', color: color('outline'), align: 'center' }).setScrollFactor(0).setDepth(OV + 11);
    setWrap(t, LOGICAL_WIDTH - 40);
    placeText(t, LOGICAL_WIDTH / 2, HUD_TOP_PX + 14, 0.5, 0);
    fitPanel(bg, t, 5, 4);
    // BUG-024: 결과·제안 패널(오버레이 첫 사각형)과 겹치면 패널 위쪽 여백으로 올림(위가 모자라면 화면 맨 위 2px부터, 그래도 겹치면 패널 아래)
    const pane = this.ovObjects.find((o): o is Phaser.GameObjects.Rectangle => o instanceof Phaser.GameObjects.Rectangle && o.visible);
    if (pane) {
      const pb = pane.getBounds(), tb = bg.getBounds();
      if (tb.bottom > pb.top - 2 && tb.top < pb.bottom) {
        const h = tb.height;
        const top = Math.round(pb.top) - 3 - h;
        const below = Math.round(pb.bottom) + 3;
        const y = top >= 2 ? top : below + h <= LOGICAL_HEIGHT - 2 ? below : 2;
        placeText(t, LOGICAL_WIDTH / 2, y + 4, 0.5, 0);
        fitPanel(bg, t, 5, 4);
      }
    }
    this.toastOv = { t, bg, left: sec };
    this.time.delayedCall(sec * 1000, () => { if (this.toastOv?.t === t) { t.destroy(); bg.destroy(); this.toastOv = null; } });
  }

  /** 다음 날(또는 다시): 진행·월급 저장 → 리더보드(이어간 판 제외, D-056) → 전면광고 판정·예고 → 출근 준비 */
  private async finishDay(): Promise<void> {
    const r = this.sim.result;
    if (!r) return;
    this.overlay = 'busy';
    for (const b of this.buttons) b.b.setEnabled(false);
    const platform = getPlatform();
    const prog = await loadProgress(platform.storage);
    await saveProgress(platform.storage, { ...applyDayResult(prog, this.day, r.stars), wallet: prog.wallet + this.salaryNow(), seenHints: [...this.seenHints] });
    const submit = !r.continued || this.sim.content.continueAd?.submitScoreToLeaderboard === true;
    if (submit && platform.leaderboard.isSupported() && r.slackPoints > 0) void platform.leaderboard.submitScore(r.slackPoints);
    this.events.emit('day-finished', { day: this.day, result: r });
    this.game.events.emit('mt-day-finished', { day: this.day, result: r });
    // ⑧: 이 판에 보상형(이어하기·월급 2배)을 봤으면 전면광고 없음(interstitial.skipIfRewardedWatchedThisGame)
    await this.ads.afterGame(this.rewardedThisGame, (key, sec) => new Promise<void>((res) => {
      this.showOverlayToast(getStrings().t(key), sec);
      this.time.delayedCall(sec * 1000, () => res());
    }));
    const next = r.stars >= 1 ? Math.min(this.day + 1, Math.max(lastAuthoredDay() + 50, this.day + 1)) : this.day;
    this.scene.start(SceneKey.Prep, { day: next, playerVariant: this.variant });
  }
}
