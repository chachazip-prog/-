/**
 * 플레이어 외형 선택 저장(T-151, D-088·D-095). 앱인토스 Storage(로컬은 mock)에만 둔다.
 * playerSelection.analytics(sendVariant·logVariant false): 이 값은 분석 이벤트·오류 로그·리더보드·공유 텍스트로 보내지 않는다.
 * → 이 모듈 밖으로는 그림 선택용으로만 넘기고, console 로그에도 값을 찍지 않는다.
 */
import { getDataTables } from '../data/loader';
import { isPlayerVariant, type PlayerVariant } from '../content/gender';
import type { StorageAdapter } from '../platform';

function storageKey(): string {
  const sel = ((getDataTables()['rules'] as { characters?: { playerSelection?: { storageSlot?: unknown } } } | undefined)?.characters?.playerSelection) ?? {};
  return `mt.${typeof sel.storageSlot === 'string' ? sel.storageSlot : 'player.variant'}`;
}

/** 저장된 외형. 없거나 읽기 실패면 null(= 첫 출근 전 선택 화면 필수, 기본값 없음) */
export async function loadPlayerVariant(s: StorageAdapter): Promise<PlayerVariant | null> {
  try { const v = await s.getItem(storageKey()); return isPlayerVariant(v) ? v : null; } catch { return null; }
}

export async function savePlayerVariant(s: StorageAdapter, v: PlayerVariant): Promise<void> {
  try { await s.setItem(storageKey(), v); } catch { console.warn('[player] 외형 저장 실패'); }
}
