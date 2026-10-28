import { EMPTY_MODS, MAX_LEVEL, RARITIES, UPGRADES_BY_ID, WEAPONS_BY_ID, FISTS } from './data';
import type { CombatStats, Mods, Soldier, WeaponDef } from './types';

export const BASE_HP = 90;
export const BASE_SPEED = 70;

export function levelMult(level: number): number {
  return 1 + 0.08 * (level - 1);
}

export function xpForNext(level: number): number {
  return 40 + 18 * (level - 1);
}

export function aggregateMods(upgradeIds: readonly string[]): Mods {
  const m: Mods = { ...EMPTY_MODS };
  for (const id of upgradeIds) {
    const u = UPGRADES_BY_ID[id];
    if (!u) continue;
    for (const [k, v] of Object.entries(u.mods) as [keyof Mods, number | boolean][]) {
      if (typeof v === 'boolean') (m[k] as boolean) = (m[k] as boolean) || v;
      else (m[k] as number) += v;
    }
  }
  return m;
}

export function computeStats(s: Soldier, weapon: WeaponDef): CombatStats {
  const r = RARITIES[s.rarity].statMult;
  const lm = levelMult(s.level);
  const m = aggregateMods(s.upgrades);
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
  };
}

export function weaponForSoldier(s: Soldier, weapons: readonly { uid: string; defId: string }[]): WeaponDef {
  if (!s.weaponUid) return FISTS;
  const item = weapons.find((w) => w.uid === s.weaponUid);
  return item ? (WEAPONS_BY_ID[item.defId] ?? FISTS) : FISTS;
}

export function dps(stats: CombatStats): number {
  return stats.damage / stats.cooldown;
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
