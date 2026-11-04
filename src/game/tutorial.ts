import { START_FREE_PULLS } from './data';
import type { GameState, Soldier } from './types';

export type TutorialStep = 'intro' | 'pull' | 'soldier' | 'fight' | 'goal' | 'end';

export const TUTORIAL_GOAL = 'win1';

/** Prochain soldat à préparer dans le tutoriel, et ce qu'il lui manque. */
export function soldierToPrepare(st: GameState): { soldier: Soldier; need: 'pick' | 'weapon' } | null {
  const equipped = new Set(st.soldiers.map((s) => s.weaponUid));
  const freeWeapon = st.weapons.some((w) => !equipped.has(w.uid));
  for (const soldier of st.soldiers) {
    if (soldier.picksLeft > 0 && soldier.upgradeChoices?.length) return { soldier, need: 'pick' };
    if (!soldier.weaponUid && freeWeapon) return { soldier, need: 'weapon' };
  }
  return null;
}

/**
 * Étape du tutoriel, déduite de la partie elle-même : un rechargement de page reprend donc au bon endroit.
 * Seule la lecture du briefing doit être mémorisée. Renvoie null si le tutoriel est terminé ou ne peut plus avancer.
 */
export function tutorialStep(st: GameState): TutorialStep | null {
  if (!st.tutorial) return null;
  if (!st.tutorial.introDone) return 'intro';
  if (st.stats.won > 0) return st.claimedGoals.includes(TUTORIAL_GOAL) ? 'end' : 'goal';
  const pullsLeft = st.totalPulls < START_FREE_PULLS && st.freePulls > 0;
  const todo = soldierToPrepare(st);
  // Le premier soldat est préparé pas à pas ; les deux suivants ne le sont qu'une fois tous recrutés
  if (todo && (!pullsLeft || st.totalPulls === 1)) return 'soldier';
  if (pullsLeft) return 'pull';
  return st.soldiers.length > 0 ? 'fight' : null;
}
