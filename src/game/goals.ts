import { WEAPONS_BY_ID } from './data';
import { totalStars } from './combat';
import type { GameState } from './types';

export interface GoalReward {
  gold?: number;
  freePulls?: number;
}

export interface GoalDef {
  id: string;
  label: string;
  desc: string;
  need: number;
  progress: (st: GameState) => number;
  reward: GoalReward;
}

const maxSoldierLevel = (st: GameState): number => st.soldiers.reduce((m, s) => Math.max(m, s.level + (s.titles.includes('legion') ? 30 : 0)), 0);

// Objectifs à long terme : chacun se réclame une seule fois, dans l'ordre où le joueur les atteint
export const GOALS: GoalDef[] = [
  { id: 'recruit5', label: 'Première escouade', desc: 'Recruter 4 soldats', need: 4, progress: (st) => st.totalPulls, reward: { gold: 100 } },
  { id: 'win1', label: 'Baptême du feu', desc: 'Remporter un combat', need: 1, progress: (st) => st.stats.won, reward: { gold: 60 } },
  { id: 'campaign5', label: 'Premier boss', desc: 'Terminer le niveau 5 de la campagne', need: 5, progress: (st) => st.campaignLevel, reward: { freePulls: 1 } },
  { id: 'stars15', label: 'Sans bavure', desc: 'Réunir 15 étoiles de campagne', need: 15, progress: totalStars, reward: { gold: 200 } },
  { id: 'level10', label: 'Vétéran', desc: 'Avoir un soldat de niveau 10', need: 10, progress: maxSoldierLevel, reward: { gold: 150 } },
  { id: 'kills100', label: 'Nettoyeur', desc: 'Éliminer 100 ennemis', need: 100, progress: (st) => st.stats.kills, reward: { gold: 150 } },
  { id: 'campaign10', label: 'Percée', desc: 'Terminer le niveau 10 de la campagne', need: 10, progress: (st) => st.campaignLevel, reward: { gold: 300 } },
  { id: 'streak3', label: 'Assidu', desc: 'Remporter 3 défis du jour d’affilée', need: 3, progress: (st) => st.dailyStreak, reward: { freePulls: 1 } },
  { id: 'legendary', label: 'Arme de légende', desc: 'Posséder une arme légendaire', need: 1, progress: (st) => st.weapons.filter((w) => WEAPONS_BY_ID[w.defId]?.rarity === 'legendary').length, reward: { gold: 200 } },
  { id: 'wave10', label: 'Increvables', desc: 'Atteindre la vague 10 en survie', need: 10, progress: (st) => st.bestWave, reward: { freePulls: 1 } },
  { id: 'stars45', label: 'Perfectionniste', desc: 'Réunir 45 étoiles de campagne', need: 45, progress: totalStars, reward: { freePulls: 2 } },
  { id: 'campaign20', label: 'Offensive générale', desc: 'Terminer le niveau 20 de la campagne', need: 20, progress: (st) => st.campaignLevel, reward: { gold: 600 } },
  { id: 'kills1000', label: 'Machine de guerre', desc: 'Éliminer 1 000 ennemis', need: 1000, progress: (st) => st.stats.kills, reward: { freePulls: 2 } },
  { id: 'legend', label: 'Légende vivante', desc: 'Amener un soldat au niveau 30', need: 30, progress: maxSoldierLevel, reward: { freePulls: 2 } },
  { id: 'campaign30', label: 'Victoire totale', desc: 'Terminer le niveau 30 de la campagne', need: 30, progress: (st) => st.campaignLevel, reward: { freePulls: 3 } },
];

export function goalDone(st: GameState, g: GoalDef): boolean {
  return g.progress(st) >= g.need;
}

/** Objectifs atteints dont la récompense attend d'être réclamée. */
export function claimableGoals(st: GameState): GoalDef[] {
  return GOALS.filter((g) => !st.claimedGoals.includes(g.id) && goalDone(st, g));
}

/** Objectifs encore en cours, les plus avancés d'abord. */
export function openGoals(st: GameState): GoalDef[] {
  return GOALS.filter((g) => !st.claimedGoals.includes(g.id) && !goalDone(st, g)).sort((a, b) => b.progress(st) / b.need - a.progress(st) / a.need);
}

export function claimGoal(st: GameState, id: string): GoalReward | null {
  const g = GOALS.find((x) => x.id === id);
  if (!g || st.claimedGoals.includes(id) || !goalDone(st, g)) return null;
  st.claimedGoals.push(id);
  st.gold += g.reward.gold ?? 0;
  st.freePulls += g.reward.freePulls ?? 0;
  return g.reward;
}

export function rewardLabel(r: GoalReward): string {
  return [r.gold && `${r.gold} or`, r.freePulls && `${r.freePulls} tirage${r.freePulls > 1 ? 's' : ''} gratuit${r.freePulls > 1 ? 's' : ''}`].filter(Boolean).join(' + ');
}
