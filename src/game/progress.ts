import { SQUAD_BASE, UNLOCKS, type UnlockDef, type UnlockId } from './data';
import type { GameState } from './types';

const UNLOCKS_BY_ID = Object.fromEntries(UNLOCKS.map((u) => [u.id, u])) as Record<UnlockId, UnlockDef>;

export function unlockLevel(id: UnlockId): number {
  return UNLOCKS_BY_ID[id].level;
}

export function isUnlocked(st: GameState, id: UnlockId): boolean {
  return st.campaignLevel >= unlockLevel(id);
}

/** Nombre de soldats engageables par combat, selon les places débloquées en campagne. */
export function squadMax(st: GameState): number {
  return SQUAD_BASE + (['squad4', 'squad5', 'squad6'] as const).filter((id) => isUnlocked(st, id)).length;
}

/** Déblocages obtenus en passant du niveau de campagne `before` à `after`. */
export function unlocksBetween(before: number, after: number): UnlockDef[] {
  return UNLOCKS.filter((u) => u.level > before && u.level <= after);
}

/** Prochain déblocage à atteindre, pour l'afficher comme objectif. */
export function nextUnlock(st: GameState): UnlockDef | null {
  return UNLOCKS.find((u) => u.level > st.campaignLevel) ?? null;
}
