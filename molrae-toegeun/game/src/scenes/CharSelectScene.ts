import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { getStrings } from '../content';
import { isPlayerVariant, type PlayerVariant } from '../content/gender';
import { getDataTables } from '../data/loader';
import { getPlatform } from '../platform';
import { color } from '../render/palette';
import { ATLAS_KEY } from '../render/sprites';
import { savePlayerVariant } from '../state/playerVariant';
import { UiButton } from '../ui/button';
import { addPixelText, placeText, setWrap, type UIText } from '../ui/pixelText';
import { SceneKey } from './keys';
import type { PrepSceneData } from './PrepScene';

/** first = 첫 출근 전(필수, 선택 후 출근 준비로) / change = 설정 '내 캐릭터'(다음 판부터 적용, 타이틀로 복귀) */
export interface CharSelectData { mode: 'first' | 'change'; day?: number; current?: PlayerVariant | null }

interface Card { v: PlayerVariant; x: number; y: number; w: number; h: number; card: Phaser.GameObjects.Image; label: UIText }

/** 카드 배율(아트 40×52 → 정수 2배) */
const SCALE = 2;

/**
 * 캐릭터 선택(D-088, rules.characters.playerSelection): 카드 2장 같은 크기·같은 강조, 미리 선택된 쪽 없음(preselected false),
 * 고르기 전에는 확인 버튼 비활성. 선택은 Storage에만 저장(D-095).
 */
export class CharSelectScene extends Phaser.Scene {
  private data0: CharSelectData = { mode: 'first' };
  private chosen: PlayerVariant | null = null;
  private cards: Card[] = [];

  constructor() { super(SceneKey.CharSelect); }

  init(data: CharSelectData): void {
    this.data0 = data;
    this.chosen = null; // 설정에서 열어도 미리 선택하지 않음(preselected false)
    this.cards = [];
  }

  create(): void {
    const str = getStrings();
    const sel = ((getDataTables()['rules'] as { characters?: { playerSelection?: Record<string, unknown>; playerVariants?: { id?: unknown; labelKey?: unknown }[] } })?.characters) ?? {};
    const ps = sel.playerSelection ?? {};
    const key = (k: string, d: string) => (typeof ps[k] === 'string' ? ps[k] as string : d);
    const order = (Array.isArray(ps['displayOrder']) ? ps['displayOrder'] : ['m', 'f']).filter(isPlayerVariant);
    const labelOf = (v: PlayerVariant) => {
      const pv = (sel.playerVariants ?? []).find((x) => x.id === v);
      return typeof pv?.labelKey === 'string' ? pv.labelKey : `charsel.option.${v}`;
    };
    const ink = color('outline');
    const cx = LOGICAL_WIDTH / 2;
    this.cameras.main.setBackgroundColor(color('wall'));
    this.add.rectangle(6, 16, LOGICAL_WIDTH - 12, LOGICAL_HEIGHT - 32, 0xffffff, 0.96).setOrigin(0, 0).setStrokeStyle(1, color('dark'));
    const title = addPixelText(this, 0, 0, str.t(key('titleKey', 'charsel.title')), { role: 'label', color: ink, align: 'center', lineSpacing: 2 });
    setWrap(title, LOGICAL_WIDTH - 28); placeText(title, cx, 28, 0.5, 0);

    const tex = this.textures.exists(ATLAS_KEY) ? this.textures.get(ATLAS_KEY) : null;
    const cw = 40 * SCALE, ch = 52 * SCALE, gap = 6;
    const left = Math.round(cx - cw - gap / 2), top = 64;
    order.slice(0, 2).forEach((v, i) => {
      const x = left + i * (cw + gap), y = top;
      const card = tex?.has('ui/charsel_card') ? this.add.image(x, y, ATLAS_KEY, 'ui/charsel_card').setOrigin(0, 0).setScale(SCALE)
        : this.add.image(x, y, '__WHITE').setOrigin(0, 0).setDisplaySize(cw, ch);
      // 초상(32×40, 원점 (0.5,1)) = 카드 (20, 42)
      const pf = `ui/charsel_portrait_${v}`;
      if (tex?.has(pf)) this.add.image(x + 20 * SCALE, y + 42 * SCALE, ATLAS_KEY, pf).setOrigin(0.5, 1).setScale(SCALE);
      const label = addPixelText(this, 0, 0, str.t(labelOf(v)), { role: 'label', color: ink, align: 'center' });
      placeText(label, x + cw / 2, y + 47 * SCALE, 0.5, 0.5);
      this.cards.push({ v, x, y, w: cw, h: ch, card, label });
    });
    const note = addPixelText(this, 0, 0, str.t(key('noteKey', 'charsel.note')), { role: 'label', color: color('dark'), lineSpacing: 2 });
    setWrap(note, LOGICAL_WIDTH - 28); placeText(note, 14, top + ch + 10, 0, 0);
    const go = new UiButton(this, 30, LOGICAL_HEIGHT - 62, LOGICAL_WIDTH - 60, 30, str.t(key('confirmKey', 'charsel.confirm')), { depth: 10, style: 'primary' });
    go.setEnabled(false);
    let busy = false;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (busy) return;
      const c = this.cards.find((k) => p.x >= k.x && p.x < k.x + k.w && p.y >= k.y && p.y < k.y + k.h);
      if (c) { this.select(c.v); go.setEnabled(true); return; }
      if (!go.contains(p.x, p.y) || !this.chosen) return;
      busy = true;
      const v = this.chosen;
      void savePlayerVariant(getPlatform().storage, v).then(() => {
        if (this.data0.mode === 'first') this.scene.start(SceneKey.Prep, { day: this.data0.day ?? 1, playerVariant: v } satisfies PrepSceneData);
        else this.scene.start(SceneKey.Title, { toastKey: v !== this.data0.current ? key('changedToastKey', 'settings.character_changed') : undefined });
      });
    });
  }

  /** 선택 강조: 두 카드 같은 판, 고른 쪽만 _on(같은 크기) */
  private select(v: PlayerVariant): void {
    this.chosen = v;
    const tex = this.textures.exists(ATLAS_KEY) ? this.textures.get(ATLAS_KEY) : null;
    for (const c of this.cards) {
      const on = c.v === v;
      if (tex?.has('ui/charsel_card_on')) c.card.setFrame(on ? 'ui/charsel_card_on' : 'ui/charsel_card');
      else c.card.setTint(on ? color('cool') : 0xffffff);
    }
  }
}
