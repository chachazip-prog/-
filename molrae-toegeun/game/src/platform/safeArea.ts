/** CSS env(safe-area-inset-*)를 읽는 보조(로컬·SDK 실패 시). index.html viewport-fit=cover 필요 */
import type { SafeAreaInsets } from './types';

export function cssSafeAreaInsets(): SafeAreaInsets {
  try {
    if (typeof document === 'undefined') return { top: 0, bottom: 0, left: 0, right: 0 };
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const v = (x: string) => parseFloat(x) || 0;
    const r = { top: v(cs.paddingTop), bottom: v(cs.paddingBottom), left: v(cs.paddingLeft), right: v(cs.paddingRight) };
    el.remove();
    return r;
  } catch { return { top: 0, bottom: 0, left: 0, right: 0 }; }
}
