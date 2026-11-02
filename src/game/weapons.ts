import { AFFIX_CHANCE, FISTS, RARITIES, WEAPON_MAX_PLUS, WEAPON_PLUS_COST, WEAPON_PLUS_DMG, WEAPON_PLUS_MATERIAL, WEAPONS_BY_ID } from './data';
import { isUnlocked, unlockLevel } from './progress';
import { pick, type Rng } from './rng';
import type { GameState, WeaponDef, WeaponItem } from './types';

// ---------- Préfixes ----------

/** Préfixe d'arme : un bonus tiré à l'obtention, qui distingue deux exemplaires d'une même arme. */
export interface WeaponAffix {
  id: string;
  /** Complément du nom (« Fusil d'assaut du Vampire »). */
  suffix: string;
  desc: string;
  apply: (w: WeaponDef) => void;
  /** Le préfixe n'a aucun sens pour cette arme (zone sur un soigneur…). */
  excludes?: (w: WeaponDef) => boolean;
}

export const WEAPON_AFFIXES: WeaponAffix[] = [
  { id: 'brute', suffix: 'de la Brute', desc: '+15 % dégâts', apply: (w) => { w.damage *= 1.15; } },
  { id: 'swift', suffix: 'du Vif', desc: '−12 % de temps de recharge', apply: (w) => { w.cooldown *= 0.88; } },
  { id: 'eagle', suffix: 'de l’Aigle', desc: '+15 % portée, +5 % critique', apply: (w) => { w.range *= 1.15; w.crit = (w.crit ?? 0) + 0.05; }, excludes: (w) => w.range < 60 },
  { id: 'vampire', suffix: 'du Vampire', desc: '+8 % de vol de vie', apply: (w) => { w.lifesteal = (w.lifesteal ?? 0) + 0.08; }, excludes: (w) => !!w.heal },
  { id: 'fortress', suffix: 'de la Forteresse', desc: '+15 armure', apply: (w) => { w.armor = (w.armor ?? 0) + 15; } },
  { id: 'ghost', suffix: 'du Fantôme', desc: '+6 % esquive', apply: (w) => { w.dodge = (w.dodge ?? 0) + 0.06; } },
  { id: 'blast', suffix: 'de l’Artificier', desc: '+12 de rayon de zone', apply: (w) => { w.aoe += 12; }, excludes: (w) => !!w.heal },
  { id: 'lucky', suffix: 'du Veinard', desc: '+10 % de coups critiques', apply: (w) => { w.crit = (w.crit ?? 0) + 0.1; } },
  { id: 'runner', suffix: 'du Coureur', desc: '+15 % vitesse de déplacement', apply: (w) => { w.speedPct = (w.speedPct ?? 0) + 0.15; } },
];

export const AFFIXES_BY_ID: Record<string, WeaponAffix> = Object.fromEntries(WEAPON_AFFIXES.map((a) => [a.id, a]));

/** Tire (ou non) un préfixe pour une arme qui vient d'être obtenue. */
export function rollAffix(def: WeaponDef, rng: Rng): string | undefined {
  if (rng() >= AFFIX_CHANCE[def.rarity]) return undefined;
  return pick(rng, WEAPON_AFFIXES.filter((a) => !a.excludes?.(def))).id;
}

/** Nouvel exemplaire d'arme, avec son préfixe éventuel. */
export function newWeaponItem(st: GameState, def: WeaponDef, rng: Rng = Math.random): WeaponItem {
  const item: WeaponItem = { uid: `w${st.nextId++}`, defId: def.id };
  const affix = rollAffix(def, rng);
  if (affix) item.affix = affix;
  return item;
}

// ---------- Arme effective ----------

const cache = new Map<string, WeaponDef>();

/** Statistiques réelles d'un exemplaire : arme de base, préfixe et améliorations de l'Atelier. */
export function resolveWeapon(item: Pick<WeaponItem, 'defId' | 'affix' | 'plus'>): WeaponDef {
  const base = WEAPONS_BY_ID[item.defId] ?? FISTS;
  const plus = Math.min(WEAPON_MAX_PLUS, item.plus ?? 0);
  const affix = item.affix ? AFFIXES_BY_ID[item.affix] : undefined;
  if (!affix && plus === 0) return base;
  const key = `${base.id}|${affix?.id ?? ''}|${plus}`;
  let w = cache.get(key);
  if (!w) {
    w = { ...base };
    affix?.apply(w);
    w.damage *= 1 + WEAPON_PLUS_DMG * plus;
    w.name = `${base.name}${affix ? ` ${affix.suffix}` : ''}${plus > 0 ? ` +${plus}` : ''}`;
    cache.set(key, w);
  }
  return w;
}

/** Valeur de revente : la rareté, plus un quart par cran d'amélioration. */
export function weaponSellValue(item: WeaponItem): number {
  const def = WEAPONS_BY_ID[item.defId];
  if (!def) return 0;
  return Math.round(RARITIES[def.rarity].sellValue * (1 + 0.25 * (item.plus ?? 0)));
}

// ---------- Atelier ----------

export function upgradeCost(item: WeaponItem): number {
  const def = WEAPONS_BY_ID[item.defId];
  return WEAPON_PLUS_COST[def.rarity] * ((item.plus ?? 0) + 1);
}

/** L'amélioration au cran suivant consomme-t-elle une arme ? */
export function upgradeNeedsMaterial(item: WeaponItem): boolean {
  return (item.plus ?? 0) + 1 >= WEAPON_PLUS_MATERIAL;
}

/** Armes non équipées, de même rareté et sans amélioration, pouvant servir de matériau à `item`. */
export function upgradeMaterials(st: GameState, item: WeaponItem): WeaponItem[] {
  const rarity = WEAPONS_BY_ID[item.defId].rarity;
  const equipped = new Set(st.soldiers.map((s) => s.weaponUid));
  return st.weapons.filter((w) => w.uid !== item.uid && !equipped.has(w.uid) && !w.plus && WEAPONS_BY_ID[w.defId]?.rarity === rarity);
}

export type UpgradeWeaponResult = { ok: true; plus: number; consumed: string | null } | { ok: false; error: string };

export function upgradeWeapon(st: GameState, uid: string): UpgradeWeaponResult {
  if (!isUnlocked(st, 'workshop')) return { ok: false, error: `L'atelier ouvre au niveau ${unlockLevel('workshop')} de la campagne.` };
  const item = st.weapons.find((w) => w.uid === uid);
  if (!item || !WEAPONS_BY_ID[item.defId] || item.defId === FISTS.id) return { ok: false, error: 'Arme introuvable.' };
  if ((item.plus ?? 0) >= WEAPON_MAX_PLUS) return { ok: false, error: `Cette arme est déjà au maximum (+${WEAPON_MAX_PLUS}).` };
  const cost = upgradeCost(item);
  if (st.gold < cost) return { ok: false, error: "Pas assez d'or." };
  let consumed: string | null = null;
  if (upgradeNeedsMaterial(item)) {
    // le matériau le moins précieux part en premier : sans préfixe d'abord
    const material = upgradeMaterials(st, item).sort((a, b) => Number(!!a.affix) - Number(!!b.affix))[0];
    if (!material) return { ok: false, error: `À partir de +${WEAPON_PLUS_MATERIAL}, il faut aussi sacrifier une arme ${RARITIES[WEAPONS_BY_ID[item.defId].rarity].label.toLowerCase()} non équipée et non améliorée.` };
    consumed = material.uid;
    st.weapons = st.weapons.filter((w) => w.uid !== material.uid);
  }
  st.gold -= cost;
  item.plus = (item.plus ?? 0) + 1;
  return { ok: true, plus: item.plus, consumed };
}
