/** 게임 시계 'HH:MM' → 분 */
export function hhmm(s: string): number {
  const m = /^(\d+):(\d+)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
