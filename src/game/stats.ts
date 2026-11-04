import { EMPTY_MODS, MAX_LEVEL, RARITIES, UPGRADES_BY_ID, FISTS } from './data';
import { TRAITS_BY_ID } from './traits';
import { resolveWeapon } from './weapons';
import type { CombatStats, Mods, Soldier, WeaponDef, WeaponItem } from './types';

export const BASE_HP = 90;
export const BASE_SPEED = 70;

/** Croissance géométrique : chaque niveau vaut +5 %, du premier au dernier, et l'XP reste comparable à l'équipement. */
export function levelMult(level: number): number {
  return 1.05 ** (level - 1);
}

// Courbe quadratique : le niveau 30 doit arriver avec la fin de la campagne, pas au bout d'une heure
export function xpForNext(level: number): number {
  const l = level - 1;
  return 70 + 30 * l + 4 * l * l;
}

function addMods(m: Mods, mods: Partial<Mods>): void {
  for (const [k, v] of Object.entries(mods) as [keyof Mods, number | boolean][]) {
    if (typeof v === 'boolean') (m[k] as boolean) = (m[k] as boolean) || v;
    else (m[k] as number) += v;
  }
}

export function aggregateMods(upgradeIds: readonly string[]): Mods {
  const m: Mods = { ...EMPTY_MODS };
  for (const id of upgradeIds) {
    const u = UPGRADES_BY_ID[id];
    if (u) addMods(m, u.mods);
  }
  return m;
}

/** Améliorations et trait de personnalité d'un soldat, cumulés. */
export function soldierMods(s: Soldier): Mods {
  const m = aggregateMods(s.upgrades);
  const trait = s.trait ? TRAITS_BY_ID[s.trait] : undefined;
  if (trait) addMods(m, trait.mods);
  return m;
}

export function computeStats(s: Soldier, weapon: WeaponDef): CombatStats {
  const r = RARITIES[s.rarity].statMult;
  const lm = levelMult(s.level);
  const m = soldierMods(s);
  return {
    maxHp: BASE_HP * r * s.hpRoll * lm * Math.max(0.3, 1 + m.hpPct),
    damage: weapon.damage * r * s.powerRoll * lm * (1 + m.dmgPct),
    range: weapon.range * (1 + m.rangePct),
    // plancher bas : « Doigts agiles » reste utile sur les armes déjà très rapides
    cooldown: Math.max(0.12, weapon.cooldown * (1 + Math.max(-0.5, m.cdPct))),
    speed: Math.max(30, BASE_SPEED * s.speedRoll * (1 + m.speedPct + (weapon.speedPct ?? 0))),
    armor: m.armor + (weapon.armor ?? 0),
    crit: Math.min(0.75, 0.05 + m.crit + (weapon.crit ?? 0)),
    dodge: Math.min(0.5, 0.03 + m.dodge + (weapon.dodge ?? 0)),
    lifesteal: m.lifesteal + (weapon.lifesteal ?? 0),
    regen: m.regenPct,
    // un soigneur ne fait jamais de dégâts de zone, même avec « Munitions explosives »
    aoe: weapon.heal ? 0 : weapon.aoe + m.aoe,
    ranged: weapon.range > 60,
    berserk: m.berserk,
    secondWind: m.secondWind,
    heal: !!weapon.heal,
    chain: weapon.chain,
    pierce: weapon.pierce,
    execute: weapon.execute,
    thorns: weapon.thorns,
  };
}

export function weaponForSoldier(s: Soldier, weapons: readonly WeaponItem[]): WeaponDef {
  if (!s.weaponUid) return FISTS;
  const item = weapons.find((w) => w.uid === s.weaponUid);
  return item ? resolveWeapon(item) : FISTS;
}

export function dps(stats: CombatStats): number {
  return stats.damage / stats.cooldown;
}

/**
 * Note de puissance d'un soldat : moyenne géométrique de sa résistance (PV effectifs, soins compris)
 * et de son efficacité offensive (dégâts moyens, zone, mobilité au corps à corps). Sert à comparer des options.
 * Un soigneur ne compte ni la Rage ni le vol de vie : ils n'agissent que sur ses tirs, pas sur ses soins.
 */
export function powerScore(s: CombatStats): number {
  const { survival, offense } = powerParts(s);
  return Math.sqrt(survival * offense);
}

/** Les deux composantes de la note de puissance : résistance et efficacité offensive. */
export function powerParts(s: CombatStats): { survival: number; offense: number } {
  const hit = s.damage * (1 + s.crit) * (s.berserk && !s.heal ? 1.15 : 1);
  const rate = hit / s.cooldown;
  const offense = rate * (1 + s.aoe / 80) * (s.ranged ? Math.pow(s.range / 150, 0.5) : 0.4 * Math.pow(s.speed / 70, 0.5));
  const ehp = (s.maxHp * (1 + s.armor / 100)) / (1 - s.dodge);
  const lifesteal = s.heal ? 0 : s.lifesteal;
  const survival = (ehp + 20 * s.regen * s.maxHp + 6 * lifesteal * rate) * (s.secondWind ? 1.25 : 1);
  return { survival: Math.max(1, survival), offense: Math.max(0.1, offense) };
}

export function addXp(s: Soldier, amount: number): number {
  if (s.level >= MAX_LEVEL) return 0;
  s.xp += amount;
  let gained = 0;
  while (s.level < MAX_LEVEL && s.xp >= xpForNext(s.level)) {
    s.xp -= xpForNext(s.level);
    s.level++;
    gained++;
  }
  if (s.level >= MAX_LEVEL) {
    s.xp = 0;
    if (!s.titles.includes('legende')) s.titles.push('legende');
  }
  return gained;
}
