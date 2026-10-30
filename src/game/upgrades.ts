import { LEGEND_UPGRADES, LEGION_PICKS, MAX_LEVEL, PICK_LEVELS, TRAINING_PER_SOLDIER, UPGRADE_CHOICES, UPGRADES, UPGRADES_BY_ID } from './data';
import { isUnlocked } from './progress';
import { shuffle, type Rng } from './rng';
import { computeStats, powerScore, weaponForSoldier } from './stats';
import type { GameState, Soldier, UpgradeDef, WeaponDef } from './types';

// ---------- Rangs ----------

export function maxRank(u: UpgradeDef): number {
  return u.maxRank ?? 1;
}

/** Nombre de fois où le soldat a pris cette amélioration. */
export function upgradeRank(s: Soldier, id: string): number {
  return s.upgrades.reduce((n, u) => n + (u === id ? 1 : 0), 0);
}

/** Améliorations du soldat regroupées par rang, dans l'ordre où il les a prises. */
export function upgradeSummary(s: Soldier): { def: UpgradeDef; rank: number }[] {
  const seen = new Map<string, number>();
  for (const id of s.upgrades) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([id]) => UPGRADES_BY_ID[id]).map(([id, rank]) => ({ def: UPGRADES_BY_ID[id], rank }));
}

// ---------- Emplacements ----------

/**
 * Nombre total d'améliorations auquel un soldat a droit : un emplacement par palier de PICK_LEVELS atteint,
 * plus LEGION_PICKS par Légion d'honneur. Le niveau max n'en apporte aucun : il sert à accorder la Légion.
 */
export function entitledPicks(level: number, legions = 0): number {
  return PICK_LEVELS.filter((l) => l <= Math.min(level, MAX_LEVEL - 1)).length + legions * LEGION_PICKS;
}

/** Plafond d'améliorations d'un soldat (tous paliers atteints). */
export function upgradeCap(s: Soldier): number {
  return entitledPicks(MAX_LEVEL, s.legions);
}

/** Prochain niveau qui débloquera un emplacement, ou null s'il n'en gagnera plus. */
export function nextPickLevel(s: Soldier): number | null {
  return PICK_LEVELS.find((l) => l > s.level && entitledPicks(l, s.legions) > s.upgrades.length + s.picksLeft) ?? null;
}

/** Propositions : améliorations dont le rang max n'est pas atteint, plus celles de Légende pour un soldat titré. */
export function rollUpgradeChoices(rng: Rng, s: Soldier): string[] {
  const open = (list: UpgradeDef[]) => list.filter((u) => upgradeRank(s, u.id) < maxRank(u)).map((u) => u.id);
  // Une Légende se voit proposer en priorité une amélioration de Légende, s'il en reste à prendre
  const legend = s.titles.includes('legende') ? shuffle(rng, open(LEGEND_UPGRADES)).slice(0, 1) : [];
  return [...legend, ...shuffle(rng, open(UPGRADES)).slice(0, UPGRADE_CHOICES - legend.length)];
}

/** Recalcule les choix en attente pour que le total (pris + en attente) suive les paliers du soldat. */
export function grantLevelPicks(s: Soldier, rng: Rng = Math.random): void {
  s.picksLeft = Math.max(0, entitledPicks(s.level, s.legions) - s.upgrades.length);
  if (s.picksLeft === 0) s.upgradeChoices = null;
  else if (!s.upgradeChoices?.length) s.upgradeChoices = rollUpgradeChoices(rng, s);
}

export function pickUpgrade(st: GameState, soldierId: string, upgradeId: string, rng: Rng = Math.random): boolean {
  const s = st.soldiers.find((x) => x.id === soldierId);
  const def = UPGRADES_BY_ID[upgradeId];
  if (!s || !def || s.picksLeft <= 0 || !s.upgradeChoices?.includes(upgradeId) || upgradeRank(s, upgradeId) >= maxRank(def)) return false;
  s.upgrades.push(upgradeId);
  s.picksLeft--;
  s.upgradeChoices = s.picksLeft > 0 ? rollUpgradeChoices(rng, s) : null;
  return true;
}

// ---------- Relance des propositions ----------

export function rerollCost(s: Soldier): number {
  return 20 + 4 * s.level;
}

export type RerollResult = { ok: true; cost: number } | { ok: false; error: string };

/** Remplace les propositions en attente contre de l'or. */
export function rerollUpgrades(st: GameState, soldierId: string, rng: Rng = Math.random): RerollResult {
  const s = st.soldiers.find((x) => x.id === soldierId);
  if (!s || s.picksLeft <= 0) return { ok: false, error: 'Aucune amélioration en attente.' };
  const cost = rerollCost(s);
  if (st.gold < cost) return { ok: false, error: "Pas assez d'or." };
  st.gold -= cost;
  s.upgradeChoices = rollUpgradeChoices(rng, s);
  return { ok: true, cost };
}

// ---------- Conseil ----------

/** Stats du soldat s'il prenait l'amélioration `id` en plus des siennes. */
export function statsWith(s: Soldier, weapon: WeaponDef, id: string) {
  return computeStats({ ...s, upgrades: [...s.upgrades, id] }, weapon);
}

/** Gain de puissance (en %) qu'apporterait chaque proposition, selon l'arme actuelle du soldat. */
export function upgradeGains(st: GameState, s: Soldier): Map<string, number> {
  const weapon = weaponForSoldier(s, st.weapons);
  const base = powerScore(computeStats(s, weapon));
  return new Map((s.upgradeChoices ?? []).map((id) => [id, powerScore(statsWith(s, weapon, id)) / base - 1]));
}

/** Proposition conseillée : celle qui augmente le plus la puissance du soldat avec son arme actuelle. */
export function recommendedUpgrade(st: GameState, s: Soldier): string | null {
  let best: string | null = null;
  let bestGain = -Infinity;
  for (const [id, gain] of upgradeGains(st, s)) {
    if (gain > bestGain) {
      bestGain = gain;
      best = id;
    }
  }
  return best;
}

export function autoPickUnlocked(st: GameState): boolean {
  return isUnlocked(st, 'autopick');
}

/** Choisit la proposition conseillée pour toutes les améliorations en attente de l'escouade. Renvoie le nombre de choix faits. */
export function autoPickAll(st: GameState, rng: Rng = Math.random): number {
  if (!autoPickUnlocked(st)) return 0;
  let picks = 0;
  for (const s of st.soldiers) {
    while (s.picksLeft > 0 && s.upgradeChoices?.length) {
      const id = recommendedUpgrade(st, s) ?? s.upgradeChoices[0];
      if (!pickUpgrade(st, s.id, id, rng)) break;
      picks++;
    }
  }
  return picks;
}

// ---------- Légion d'honneur ----------

/**
 * Au niveau max, le soldat repart au niveau 1 en gardant les améliorations non retirées. Chaque Légion
 * ouvre LEGION_PICKS emplacements de plus, regagnés en remontant les paliers, et des entraînements gratuits.
 */
export function legionOfHonor(st: GameState, soldierId: string, removed: readonly string[]): boolean {
  const s = st.soldiers.find((x) => x.id === soldierId);
  if (!s || s.level < MAX_LEVEL || s.picksLeft > 0) return false;
  if (removed.some((id) => !s.upgrades.includes(id))) return false;
  // retirer un id ne retire qu'un rang : on enlève une occurrence par entrée
  const kept = [...s.upgrades];
  for (const id of removed) kept.splice(kept.indexOf(id), 1);
  s.upgrades = kept;
  s.level = 1;
  s.xp = 0;
  s.legions++;
  s.upgradeChoices = null;
  grantLevelPicks(s);
  s.trainingsLeft += TRAINING_PER_SOLDIER;
  if (!s.titles.includes('legion')) s.titles.push('legion');
  return true;
}
