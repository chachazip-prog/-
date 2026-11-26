/**
 * T-170 조작 위치(오른손/왼손) 설정. 부팅 때 저장값을 읽어 두고(main.ts), 씬은 동기로 읽는다.
 * 저장은 진행 저장(Storage 어댑터, mt.progress.v1의 controlHand)에 함께 한다. 값이 없으면 데이터 기본(rules.input.layout.defaultHand)
 */
import type { StorageAdapter } from '../platform';
import { loadProgress, saveProgress } from './progress';

export type ControlHand = 'right' | 'left';

let current: ControlHand | null = null;

/** 저장된 값(없으면 null = 데이터 기본값 사용) */
export function controlHandSaved(): ControlHand | null { return current; }

export function controlHandOr(def: ControlHand): ControlHand { return current ?? def; }

export async function loadControlHand(s: StorageAdapter): Promise<ControlHand | null> {
  const p = await loadProgress(s);
  current = p.controlHand ?? null;
  return current;
}

export async function saveControlHand(s: StorageAdapter, hand: ControlHand): Promise<void> {
  current = hand;
  const p = await loadProgress(s);
  await saveProgress(s, { ...p, controlHand: hand });
}
