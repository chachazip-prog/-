import Phaser from 'phaser';
import { AdFlow } from '../ads/adFlow';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { getStrings, loadDayContent } from '../content';
import { getPlatform } from '../platform';
import { color } from '../render/palette';
import { ATLAS_KEY } from '../render/sprites';
import { loadProgress } from '../state/progress';
import { UiButton } from '../ui/button';
import { addPixelText, fitPanel, placeText, setPixelText, setWrap, type UIText } from '../ui/pixelText';
import type { GameSceneData } from './GameScene';
import { SceneKey } from './keys';

export interface PrepSceneData { day?: number }

/**
 * 출근 준비 화면(GDD §3, D-027): 오늘 정보 + 대표님 순시 예보. CEO 순시 패스(보상형 광고)는 여기서만 고른다.
 * 광고 미지원 환경·하루 상한이면 패스 버튼을 보여 주지 않는다(누를 수 없는 버튼 금지).
 */
export class PrepScene extends Phaser.Scene {
  private day = 1;
  private skipCeo = false;
  private busy = false;
  private buttons: UiButton[] = [];
  private toast!: UIText;
  private toastBg!: Phaser.GameObjects.Rectangle;
  private toastLeft = 0;
  private seenHints: string[] = [];

  constructor() { super(SceneKey.Prep); }

  init(data: PrepSceneData): void {
    this.day = Math.max(1, Math.floor(data.day ?? 1));
    this.skipCeo = false;
    this.busy = false;
    this.buttons = [];
  }

  create(): void {
    const str = getStrings();
    const c = loadDayContent(this.day);
    const ink = color('outline');
    const cx = LOGICAL_WIDTH / 2;
    this.cameras.main.setBackgroundColor(color('wall'));
    const panel = this.add.rectangle(8, 24, LOGICAL_WIDTH - 16, LOGICAL_HEIGHT - 48, 0xffffff, 0.96).setOrigin(0, 0).setStrokeStyle(1, color('dark'));
    void panel;
    placeText(addPixelText(this, 0, 0, str.t('prep.title'), { role: 'body', color: ink }), cx, 40, 0.5, 0.5);
    placeText(addPixelText(this, 0, 0, str.t('prep.today', { n: c.day, weekday: str.t(`day.weekday.${c.weekday}`) }), { role: 'label', color: color('dark') }), cx, 58, 0.5, 0.5);
    const title = addPixelText(this, 0, 0, str.variants(c.titleKey) > 1 ? str.t(c.titleKey, undefined, c.day) : str.t(c.titleKey), { role: 'label', color: ink, align: 'center' });
    setWrap(title, LOGICAL_WIDTH - 32); placeText(title, cx, 76, 0.5, 0);
    let y = Math.max(104, Math.round(title.getBounds().bottom) + 14);
    const line = (text: string, col = ink) => {
      const t = addPixelText(this, 0, 0, text, { role: 'label', color: col, lineSpacing: 2 }); setWrap(t, LOGICAL_WIDTH - 32); placeText(t, 16, y, 0, 0);
      y = Math.round(t.getBounds().bottom) + 6; return t;
    };
    line(str.t('prep.missions', { n: c.missions.length, total: c.missionsRequired }));
    line(str.t('prep.quota', { n: Math.round(c.work.quota * 100) }));
    y += 6;
    const ceoLine = addPixelText(this, 0, 0, str.t(c.ceoVisit ? 'prep.ceo_forecast' : 'prep.ceo_none'), { role: 'label', color: c.ceoVisit ? color('point') : color('dark') });
    setWrap(ceoLine, LOGICAL_WIDTH - 48);
    const icon = str.icon('prep.ceo_forecast');
    if (c.ceoVisit && icon && this.textures.exists(ATLAS_KEY) && this.textures.get(ATLAS_KEY).has(icon)) {
      this.add.image(22, y + 5, ATLAS_KEY, icon);
      placeText(ceoLine, 32, y, 0, 0);
    } else placeText(ceoLine, 16, y, 0, 0);
    y += 22;

    const go = new UiButton(this, 30, LOGICAL_HEIGHT - 70, LOGICAL_WIDTH - 60, 30, str.t('prep.go'), { depth: 10, style: 'primary' });
    this.buttons.push(go);

    this.toastBg = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.95).setDepth(20).setStrokeStyle(1, color('dark')).setVisible(false);
    this.toast = addPixelText(this, 0, 0, '', { role: 'label', color: ink, align: 'center' }).setDepth(21).setVisible(false);
    setWrap(this.toast, LOGICAL_WIDTH - 40);

    const platform = getPlatform();
    const flow = new AdFlow(platform);
    let pass: UiButton | null = null;
    let passDesc: UIText | null = null;
    if (c.prep?.ceoPassAvailable) {
      void flow.canOffer('ceo_pass').then((ok) => {
        if (!ok || !this.scene.isActive()) return;
        const p = flow.placement('ceo_pass');
        pass = new UiButton(this, 16, y, LOGICAL_WIDTH - 32, 26, str.t(p?.labelKey ?? 'ad.ceo_pass'), { depth: 10, style: 'normal', role: 'label' });
        this.buttons.push(pass);
        passDesc = addPixelText(this, 0, 0, str.t(p?.descKey ?? 'ad.ceo_pass_desc'), { role: 'label', color: color('dark') });
        setWrap(passDesc, LOGICAL_WIDTH - 32); placeText(passDesc, 16, y + pass.h + 4, 0, 0);
      });
    }
    void loadProgress(platform.storage).then((p) => { this.seenHints = p.seenHints; });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (ptr: Phaser.Input.Pointer) => {
      if (this.busy) return;
      if (go.contains(ptr.x, ptr.y)) {
        this.scene.start(SceneKey.Game, { day: this.day, skipCeo: this.skipCeo, seenHints: this.seenHints } satisfies GameSceneData);
        return;
      }
      if (pass && pass.contains(ptr.x, ptr.y)) {
        // 사용자가 버튼을 누른 뒤에만 광고 로드·노출(D-050 ① 준용)
        this.busy = true;
        const pb = pass;
        pb.setEnabled(false);
        void flow.showRewarded('ceo_pass').then((r) => {
          this.busy = false;
          if (!this.scene.isActive()) return;
          if (r === 'rewarded') {
            this.skipCeo = true;
            pb.setVisible(false); passDesc?.setVisible(false);
            setPixelText(ceoLine, str.t('prep.ceo_none'));
          } else {
            pb.setEnabled(true);
            // 중도 종료는 안내 문구 키가 CEO 패스용으로 따로 없음(ad.continue_not_completed는 이어하기 전용) → 버튼만 복구 [문구 키 요청]
            if (r === 'unavailable') this.showToast(str.t('ad.continue_unavailable'));
          }
        });
      }
    });
  }

  private showToast(text: string): void {
    setPixelText(this.toast, text);
    placeText(this.toast, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 100, 0.5, 1);
    this.toast.setVisible(true);
    fitPanel(this.toastBg, this.toast, 4, 3);
    this.toastLeft = 2;
  }

  override update(_t: number, delta: number): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= delta / 1000;
      if (this.toastLeft <= 0) { this.toast.setVisible(false); this.toastBg.setVisible(false); }
    }
  }
}
