import { isUnlocked } from './progress';
import type { CombatStats, GameState, TacticId, WeaponDef, WeaponShape } from './types';

// ---------- Tactiques ----------

export interface TacticDef {
  id: TacticId;
  name: string;
  icon: string;
  desc: string;
  hpPct?: number;
  dmgPct?: number;
  speedPct?: number;
  armor?: number;
  focusWeak?: boolean;
}

export const TACTICS: TacticDef[] = [
  { id: 'balanced', name: 'Équilibrée', icon: '⚖️', desc: 'Aucun bonus ni malus : chacun vise l’ennemi le plus proche.' },
  { id: 'assault', name: 'Assaut', icon: '⚡', desc: '+25 % vitesse et +10 % dégâts, mais −10 % PV. Idéal pour la mêlée et contre les tireurs.', speedPct: 0.25, dmgPct: 0.1, hpPct: -0.1 },
  { id: 'bulwark', name: 'Rempart', icon: '🛡️', desc: '+12 armure et +10 % PV, mais −25 % vitesse. Laissez l’ennemi venir à vous.', armor: 12, hpPct: 0.1, speedPct: -0.25 },
  { id: 'hunters', name: 'Chasse aux blessés', icon: '🎯', desc: 'Vise l’ennemi le plus affaibli à portée pour achever les cibles plus vite, −5 % dégâts.', dmgPct: -0.05, focusWeak: true },
];

export const TACTICS_BY_ID = Object.fromEntries(TACTICS.map((t) => [t.id, t])) as Record<TacticId, TacticDef>;

/** Tactique réellement appliquée : « Équilibrée » tant que les tactiques ne sont pas débloquées. */
export function activeTactic(st: GameState): TacticDef {
  return isUnlocked(st, 'tactics') ? (TACTICS_BY_ID[st.tactic] ?? TACTICS_BY_ID.balanced) : TACTICS_BY_ID.balanced;
}

// ---------- Synergies ----------

export type WeaponFamily = 'melee' | 'shield' | 'gun' | 'precision' | 'explosive' | 'medic';

export const FAMILY_LABELS: Record<WeaponFamily, string> = {
  melee: 'Mêlée',
  shield: 'Bouclier',
  gun: 'Tir',
  precision: 'Précision',
  explosive: 'Explosif',
  medic: 'Soin',
};

const FAMILY_OF: Record<WeaponShape, WeaponFamily | null> = {
  fists: null,
  knife: 'melee',
  sword: 'melee',
  katana: 'melee',
  axe: 'melee',
  spear: 'melee',
  shield: 'shield',
  pistol: 'gun',
  smg: 'gun',
  rifle: 'gun',
  revolver: 'gun',
  shotgun: 'gun',
  crossbow: 'gun',
  minigun: 'gun',
  sniper: 'precision',
  railgun: 'precision',
  launcher: 'explosive',
  bazooka: 'explosive',
  mortar: 'explosive',
  flame: 'explosive',
  tesla: 'explosive',
  medic: 'medic',
};

export function weaponFamily(w: WeaponDef): WeaponFamily | null {
  return FAMILY_OF[w.shape];
}

export interface SynergyDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Famille requise (absente : synergie de diversité). */
  family?: WeaponFamily;
  /** Nombre d'armes de la famille (ou de familles différentes) nécessaire. */
  need: number;
  /** Ne profite qu'aux porteurs de la famille, ou à toute l'escouade. */
  scope: 'family' | 'squad';
  apply: (s: CombatStats) => void;
}

export const SYNERGIES: SynergyDef[] = [
  { id: 'blades', name: 'Fer de lance', icon: '🗡️', family: 'melee', need: 2, scope: 'family', desc: 'Mêlée : +15 % vitesse et +8 % esquive.', apply: (s) => { s.speed *= 1.15; s.dodge = Math.min(0.5, s.dodge + 0.08); } },
  { id: 'volley', name: 'Feu nourri', icon: '🔫', family: 'gun', need: 3, scope: 'family', desc: 'Tir : −12 % de temps de recharge.', apply: (s) => { s.cooldown = Math.max(0.12, s.cooldown * 0.88); } },
  { id: 'snipers', name: 'Tireurs embusqués', icon: '🔭', family: 'precision', need: 2, scope: 'family', desc: 'Précision : +15 % critique et +10 % portée.', apply: (s) => { s.crit = Math.min(0.75, s.crit + 0.15); s.range *= 1.1; } },
  { id: 'boom', name: 'Artificiers', icon: '💥', family: 'explosive', need: 2, scope: 'family', desc: 'Explosifs : +15 % dégâts et +10 de rayon.', apply: (s) => { s.damage *= 1.15; s.aoe += 10; } },
  { id: 'cover', name: 'Couverture', icon: '🛡️', family: 'shield', need: 1, scope: 'squad', desc: 'Toute l’escouade : +6 armure.', apply: (s) => { s.armor += 6; } },
  { id: 'medbay', name: 'Infirmerie', icon: '➕', family: 'medic', need: 1, scope: 'squad', desc: 'Toute l’escouade : régénère 1 % des PV par seconde.', apply: (s) => { s.regen += 0.01; } },
  { id: 'mixed', name: 'Polyvalence', icon: '🎖️', need: 4, scope: 'squad', desc: '4 familles d’armes différentes : toute l’escouade +10 % PV.', apply: (s) => { s.maxHp *= 1.1; } },
];

export interface SynergyStatus {
  def: SynergyDef;
  have: number;
  active: boolean;
}

/** État de chaque synergie pour une escouade donnée, par ses armes. */
export function synergyStatus(weapons: readonly WeaponDef[]): SynergyStatus[] {
  const counts = new Map<WeaponFamily, number>();
  for (const w of weapons) {
    const f = weaponFamily(w);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return SYNERGIES.map((def) => {
    const have = def.family ? (counts.get(def.family) ?? 0) : counts.size;
    return { def, have, active: have >= def.need };
  });
}

/** Applique tactique et synergies actives aux stats d'un soldat, selon son arme. Modifie `stats`. */
export function applySquadBonuses(stats: CombatStats, weapon: WeaponDef, tactic: TacticDef, synergies: readonly SynergyStatus[]): CombatStats {
  stats.maxHp *= Math.max(0.3, 1 + (tactic.hpPct ?? 0));
  stats.damage *= 1 + (tactic.dmgPct ?? 0);
  stats.speed = Math.max(30, stats.speed * (1 + (tactic.speedPct ?? 0)));
  stats.armor += tactic.armor ?? 0;
  if (tactic.focusWeak) stats.focusWeak = true;
  const family = weaponFamily(weapon);
  for (const s of synergies) {
    if (!s.active) continue;
    if (s.def.scope === 'squad' || s.def.family === family) s.def.apply(stats);
  }
  // un soigneur ne fait jamais de dégâts de zone, même avec un bonus de rayon
  if (stats.heal) stats.aoe = 0;
  return stats;
}
