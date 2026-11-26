import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { devPlayerVariant, getStrings } from '../content';
import type { PlayerVariant } from '../content/gender';
import { getPlatform } from '../platform';
import { color } from '../render/palette';
import { loadPlayerVariant } from '../state/playerVariant';
import { loadProgress } from '../state/progress';
import { controlHandOr, saveControlHand, type ControlHand } from '../state/controlHand';
import { getDataTables } from '../data/loader';
import { UiButton } from '../ui/button';
import { addPixelText, fitPanel, placeText, setPixelText, setWrap } from '../ui/pixelText';
import type { CharSelectData } from './CharSelectScene';
import { SceneKey } from './keys';
import type { PrepSceneData } from './PrepScene';

export interface TitleSceneData { toastKey?: string | undefined }

export class TitleScene extends Phaser.Scene {
  private day = 1;
  private variant: PlayerVariant | null = null;
  private ready = false;
  private toastKey: string | undefined;

  constructor() { super(SceneKey.Title); }

  init(data: TitleSceneData): void { this.toastKey = data?.toastKey; this.ready = false; }

  create(): void {
    const str = getStrings();
    const cx = LOGICAL_WIDTH / 2;
    this.cameras.main.setBackgroundColor(color('wall'));
    // 타이틀은 12px 폰트를 정수 2배로 (도트 유지)
    placeText(addPixelText(this, 0, 0, str.t('ui.title'), { role: 'body', color: color('outline'), scale: 2 }), cx, LOGICAL_HEIGHT * 0.35, 0.5, 0.5);
    const start = addPixelText(this, 0, 0, str.t('ui.tap_to_start'), { role: 'body', color: color('dark') });
    placeText(start, cx, LOGICAL_HEIGHT * 0.65, 0.5, 0.5);
    let forced = 0;
    try { forced = Number(new URLSearchParams(window.location.search).get('day')) || 0; } catch { /* noop */ }
    // 설정 > 내 캐릭터(D-088: 다음 판부터 적용). 외형을 고른 뒤에만 보임
    let settings: UiButton | null = null;
    const storage = getPlatform().storage;
    void Promise.all([loadProgress(storage), loadPlayerVariant(storage)]).then(([p, v]) => {
      if (!this.scene.isActive()) return;
      this.day = forced > 0 ? forced : p.unlockedDay;
      this.variant = devPlayerVariant() ?? v;
      this.ready = true;
      if (this.day > 1) {
        setPixelText(start, str.t('ui.continue_day', { n: this.day }));
        placeText(start, cx, LOGICAL_HEIGHT * 0.65, 0.5, 0.5);
      }
      if (v) settings = new UiButton(this, 40, LOGICAL_HEIGHT - 44, LOGICAL_WIDTH - 80, 22, str.t('settings.character'), { depth: 10, style: 'normal', role: 'label' });
      // T-170 설정 '조작 위치'(오른손/왼손, control-dpad §1-4·Q8 A): 톡할 때마다 바꾸고 바로 저장. 문구 키가 없으면 버튼 없음
      if (handSetting && str.has('settings.control_hand') && str.has('settings.control_hand.right')) {
        const label = () => `${str.t('settings.control_hand')}: ${str.t(`settings.control_hand.${hand}`)}`;
        handBtn = new UiButton(this, 40, LOGICAL_HEIGHT - (v ? 72 : 44), LOGICAL_WIDTH - 80, 22, label(), { depth: 10, style: 'normal', role: 'label' });
        toggleHand = () => { hand = hand === 'right' ? 'left' : 'right'; handBtn?.setText(label()); void saveControlHand(storage, hand); };
      }
    });
    const layoutRules = ((getDataTables()['rules'] as { input?: { layout?: { defaultHand?: string; handSetting?: boolean } } } | undefined)?.input?.layout) ?? {};
    const handSetting = layoutRules.handSetting !== false;
    let hand: ControlHand = controlHandOr(layoutRules.defaultHand === 'left' ? 'left' : 'right');
    let handBtn: UiButton | null = null;
    let toggleHand: (() => void) | null = null;
    if (this.toastKey && str.has(this.toastKey)) {
      const bg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.95).setStrokeStyle(1, color('dark'));
      const t = addPixelText(this, 0, 0, str.t(this.toastKey), { role: 'label', color: color('outline'), align: 'center' });
      setWrap(t, LOGICAL_WIDTH - 40); placeText(t, cx, LOGICAL_HEIGHT * 0.8, 0.5, 0.5); fitPanel(bg, t, 4, 3);
      this.time.delayedCall(2200, () => { bg.destroy(); t.destroy(); });
    }
    this.input.on(Phaser.Input.Events.POINTER_UP, (ptr: Phaser.Input.Pointer) => {
      if (!this.ready) return;
      if (handBtn && toggleHand && handBtn.contains(ptr.x, ptr.y)) { toggleHand(); return; }
      if (settings && settings.contains(ptr.x, ptr.y)) {
        this.scene.start(SceneKey.CharSelect, { mode: 'change', current: this.variant } satisfies CharSelectData);
        return;
      }
      // 첫 출근 전 필수 선택(playerSelection.requiredBeforeFirstDay, 기본값 없음)
      if (!this.variant) this.scene.start(SceneKey.CharSelect, { mode: 'first', day: this.day } satisfies CharSelectData);
      else this.scene.start(SceneKey.Prep, { day: this.day, playerVariant: this.variant } satisfies PrepSceneData);
    });
  }
}
