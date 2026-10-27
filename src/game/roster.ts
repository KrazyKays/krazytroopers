import {
  FIRST_NAMES,
  HAIR_COLORS,
  HELMET_COLORS,
  NICKNAMES,
  PITY_LIMIT,
  PULL10_COST,
  PULL_COST,
  RARITIES,
  RARITY_ORDER,
  SKIN_TONES,
  UNIFORM_COLORS,
  UPGRADES,
  UPGRADE_CHOICES,
  UPGRADE_PICKS,
  WEAPONS,
  WEAPONS_BY_ID,
} from './data';
import { nextUid } from './state';
import { pick, range, shuffle, weightedPick, type Rng } from './rng';
import type { GameState, Rarity, Soldier, WeaponDef } from './types';

export function rollRarity(rng: Rng, pity: number): Rarity {
  if (pity >= PITY_LIMIT - 1) {
    return weightedPick(rng, [
      ['epic', RARITIES.epic.rate],
      ['legendary', RARITIES.legendary.rate],
    ] as const);
  }
  return weightedPick(rng, RARITY_ORDER.map((r) => [r, RARITIES[r].rate] as const));
}

export function rollUpgradeChoices(rng: Rng, owned: readonly string[]): string[] {
  const pool = UPGRADES.filter((u) => !owned.includes(u.id)).map((u) => u.id);
  return shuffle(rng, pool).slice(0, UPGRADE_CHOICES);
}

function autoEquip(st: GameState, s: Soldier): void {
  const taken = new Set(st.soldiers.map((x) => x.weaponUid));
  const free = st.weapons.filter((w) => !taken.has(w.uid));
  const rank = (defId: string) => RARITY_ORDER.indexOf(WEAPONS_BY_ID[defId]?.rarity ?? 'common');
  free.sort((a, b) => rank(b.defId) - rank(a.defId));
  if (free[0]) s.weaponUid = free[0].uid;
}

export function createSoldier(st: GameState, rarity: Rarity, rng: Rng): Soldier {
  const s: Soldier = {
    id: nextUid(st, 's'),
    name: `${pick(rng, FIRST_NAMES)} ${pick(rng, NICKNAMES)}`,
    rarity,
    appearance: {
      skin: Math.floor(rng() * SKIN_TONES.length),
      hair: Math.floor(rng() * HAIR_COLORS.length),
      uniform: Math.floor(rng() * UNIFORM_COLORS.length),
      helmet: Math.floor(rng() * HELMET_COLORS.length),
    },
    hpRoll: range(rng, 0.9, 1.1),
    powerRoll: range(rng, 0.9, 1.1),
    speedRoll: range(rng, 0.9, 1.1),
    level: 1,
    xp: 0,
    upgrades: [],
    upgradeChoices: null,
    picksLeft: UPGRADE_PICKS,
    weaponUid: null,
    deadUntil: null,
    kills: 0,
  };
  s.upgradeChoices = rollUpgradeChoices(rng, s.upgrades);
  return s;
}

export type RecruitResult = { ok: true; soldiers: Soldier[]; free: boolean } | { ok: false; error: string };

export function recruit(st: GameState, mode: 'free' | 'one' | 'ten', rng: Rng = Math.random): RecruitResult {
  const count = mode === 'ten' ? 10 : 1;
  if (mode === 'free') {
    if (!st.freePull) return { ok: false, error: 'Le tirage gratuit du jour a déjà été utilisé.' };
  } else {
    const cost = mode === 'ten' ? PULL10_COST : PULL_COST;
    if (st.gold < cost) return { ok: false, error: "Pas assez d'or." };
    st.gold -= cost;
  }
  if (mode === 'free') st.freePull = false;

  const soldiers: Soldier[] = [];
  for (let i = 0; i < count; i++) {
    const rarity = rollRarity(rng, st.pity);
    st.pity = rarity === 'epic' || rarity === 'legendary' ? 0 : st.pity + 1;
    st.totalPulls++;
    const s = createSoldier(st, rarity, rng);
    autoEquip(st, s);
    st.soldiers.push(s);
    soldiers.push(s);
  }
  return { ok: true, soldiers, free: mode === 'free' };
}

export function pickUpgrade(st: GameState, soldierId: string, upgradeId: string): boolean {
  const s = st.soldiers.find((x) => x.id === soldierId);
  if (!s || s.picksLeft <= 0 || !s.upgradeChoices?.includes(upgradeId)) return false;
  s.upgrades.push(upgradeId);
  s.picksLeft--;
  s.upgradeChoices = s.picksLeft > 0 ? rollUpgradeChoices(Math.random, s.upgrades) : null;
  return true;
}

export function equipWeapon(st: GameState, soldierId: string, weaponUid: string | null): void {
  const s = st.soldiers.find((x) => x.id === soldierId);
  if (!s) return;
  if (weaponUid) {
    const other = st.soldiers.find((x) => x.weaponUid === weaponUid && x.id !== s.id);
    if (other) other.weaponUid = s.weaponUid;
  }
  s.weaponUid = weaponUid;
}

export function sellWeapon(st: GameState, uid: string): number {
  const idx = st.weapons.findIndex((w) => w.uid === uid);
  if (idx < 0) return 0;
  const def = WEAPONS.find((w) => w.id === st.weapons[idx].defId);
  for (const s of st.soldiers) if (s.weaponUid === uid) s.weaponUid = null;
  st.weapons.splice(idx, 1);
  const value = def ? RARITIES[def.rarity].sellValue : 0;
  st.gold += value;
  return value;
}

export function releaseSoldier(st: GameState, id: string): number {
  const idx = st.soldiers.findIndex((s) => s.id === id);
  if (idx < 0) return 0;
  const value = RARITIES[st.soldiers[idx].rarity].releaseValue;
  st.soldiers.splice(idx, 1);
  st.gold += value;
  return value;
}

export function rollWeaponDrop(level: number, boss: boolean, rng: Rng = Math.random): WeaponDef {
  const weights: [Rarity, number][] = [
    ['common', Math.max(10, 70 - 3 * level)],
    ['rare', 25 + level],
    ['epic', Math.min(30, Math.max(0, level - 4) * 2)],
    ['legendary', Math.min(12, Math.max(0, level - 14) * 1.5)],
  ];
  let rarity = weightedPick(rng, weights.filter(([, w]) => w > 0));
  if (boss) rarity = RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, RARITY_ORDER.indexOf(rarity) + 1)];
  const pool = WEAPONS.filter((w) => w.droppable && w.rarity === rarity);
  return pick(rng, pool);
}
