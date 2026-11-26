/**
 * 방향 패드 판정(T-170 control-dpad §1-2). 순수 함수(Phaser·DOM 무관) — 씬과 테스트가 같은 판정을 쓴다.
 * 손가락 위치를 패드 중심에서 잰 각도로 4개 부채꼴(위·아래·왼쪽·오른쪽)로 나눈다(화살표 모양 안을 누를 필요 없음).
 * - 중심 데드존(deadZonePx) 안 = 방향 없음(정지)
 * - 축 전환 히스테리시스(axisHysteresisDeg): 지금 방향을 유지하려면 45° 경계보다 이 각도만큼 더 넘어가야 바뀐다
 * - 포인터 잡기: 패드 밖으로 밀려나가도 각도로 계속 판정(호출 쪽이 같은 포인터를 계속 넘김)
 */
export type PadDir = 'up' | 'down' | 'left' | 'right';

const CENTER: Readonly<Record<PadDir, number>> = { right: 0, down: 90, left: 180, up: -90 };

function angDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d < -180) d += 360;
  if (d > 180) d -= 360;
  return Math.abs(d);
}

/** dx, dy = 손가락 − 패드 중심(화면 좌표, y 아래가 +). prev = 직전 방향 */
export function judgePad(dx: number, dy: number, prev: PadDir | null, deadZonePx: number, hysteresisDeg: number): PadDir | null {
  if (Math.hypot(dx, dy) < deadZonePx) return null;
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (prev && angDiff(a, CENTER[prev]) <= 45 + hysteresisDeg) return prev;
  let best: PadDir = 'right', bd = Infinity;
  for (const d of ['right', 'down', 'left', 'up'] as const) {
    const v = angDiff(a, CENTER[d]);
    if (v < bd) { bd = v; best = d; }
  }
  return best;
}
