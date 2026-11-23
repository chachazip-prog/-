/**
 * 세로 추적 카메라 모델 (순수 TS, 고정 스텝). 렌더링과 '화면 밖 판정'(X10, rules.offscreenWarning.offscreenSourceNoGain)이
 * 같은 값을 쓰도록 카메라 위치를 코어가 소유한다. 씬은 top을 그대로 스크롤 값으로 쓴다.
 *
 * maps.json camera: visibleAboveTiles / visibleBelowTiles / deadZoneTiles / lerpPerFrame / clampToMap.
 * - 초점(focusY)은 플레이어 발밑 y가 deadZone을 벗어난 만큼만 따라간다.
 * - 카메라 위쪽 끝 = focusY - visibleAboveTiles, 매 스텝 lerpPerFrame 비율로 목표에 다가간다(1/60초 스텝 기준).
 * - 보이는 지도 행 = [top + insetTop, top + viewHeight - insetBottom]. inset은 HUD가 가리는 행(표시 설정, config/display.ts)
 */
export interface CameraRules {
  readonly visibleAboveTiles: number;
  readonly visibleBelowTiles: number;
  readonly deadZoneTiles: number;
  readonly lerpPerFrame: number;
  readonly clampToMap: boolean;
}

export interface CameraView {
  /** 화면 전체 높이(타일) */
  readonly viewHeightTiles: number;
  /** 화면 위·아래를 HUD가 가리는 높이(타일). 이 영역의 인물은 '화면 밖' */
  readonly insetTopTiles: number;
  readonly insetBottomTiles: number;
}

export class CameraModel {
  focusY: number;
  top: number;

  constructor(private readonly rules: CameraRules, private readonly view: CameraView, private readonly mapHeight: number, playerY: number) {
    this.focusY = playerY;
    this.top = this.target();
  }

  private target(): number {
    let t = this.focusY - this.rules.visibleAboveTiles;
    // clampToMap: 지도 위·아래 끝 행이 HUD에 가리지 않고 보이는 영역 끝에 오도록 HUD 높이만큼 여유를 둔다
    if (this.rules.clampToMap) {
      const min = -this.view.insetTopTiles;
      const max = Math.max(min, this.mapHeight - this.view.viewHeightTiles + this.view.insetBottomTiles);
      t = Math.min(Math.max(min, t), max);
    }
    return t;
  }

  /** 즉시 맞춤(판 시작·재시작) */
  snap(playerY: number): void {
    this.focusY = playerY;
    this.top = this.target();
  }

  /** 고정 스텝 1회. stepScale = dt / (1/60) (lerpPerFrame이 60fps 기준이므로) */
  step(playerY: number, stepScale: number): void {
    const dz = this.rules.deadZoneTiles;
    if (playerY > this.focusY + dz) this.focusY = playerY - dz;
    else if (playerY < this.focusY - dz) this.focusY = playerY + dz;
    const t = this.target();
    const k = 1 - Math.pow(1 - Math.min(1, Math.max(0, this.rules.lerpPerFrame)), stepScale);
    this.top += (t - this.top) * k;
    if (Math.abs(t - this.top) < 1e-3) this.top = t;
  }

  get visibleTop(): number { return this.top + this.view.insetTopTiles; }
  get visibleBottom(): number { return this.top + this.view.viewHeightTiles - this.view.insetBottomTiles; }

  /** 발밑 y(타일 연속 좌표)가 보이는 지도 영역 안인가 */
  isOnScreen(y: number): boolean { return y >= this.visibleTop && y <= this.visibleBottom; }
}
