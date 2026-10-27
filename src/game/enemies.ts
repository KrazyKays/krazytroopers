import { WEAPONS_BY_ID } from './data';
import type { BattleUnit } from './battle';
import { mulberry32, range, weightedPick, type Rng } from './rng';
import type { CombatStats, SpriteLook, WeaponDef } from './types';

interface Template {
  id: string;
  name: string;
  hp: number;
  power: number;
  speed: number;
  armor: number;
  weapon: string;
  minLevel: number;
  weight: number;
  uniform: string;
  helmet: string;
}

const TEMPLATES: Template[] = [
  { id: 'grunt', name: 'Fantassin', hp: 80, power: 1, speed: 64, armor: 0, weapon: 'pistol', minLevel: 1, weight: 40, uniform: '#8a3b3b', helmet: '#4a1f1f' },
  { id: 'stabber', name: 'Coupe-jarret', hp: 60, power: 1.1, speed: 90, armor: 0, weapon: 'knife', minLevel: 2, weight: 20, uniform: '#7a4a2a', helmet: '#3a2a1a' },
  { id: 'brute', name: 'Brute', hp: 160, power: 1, speed: 50, armor: 10, weapon: 'axe', minLevel: 3, weight: 15, uniform: '#5a3a3a', helmet: '#2f2f35' },
  { id: 'sniper', name: "Tireur d'élite", hp: 50, power: 0.7, speed: 55, armor: 0, weapon: 'sniper', minLevel: 4, weight: 10, uniform: '#5a2a4a', helmet: '#2a1a2a' },
  { id: 'gunner', name: 'Mitrailleur', hp: 100, power: 0.9, speed: 55, armor: 5, weapon: 'rifle', minLevel: 5, weight: 18, uniform: '#8a5a2a', helmet: '#4a3a1a' },
  { id: 'rocket', name: 'Lance-roquettes', hp: 90, power: 0.6, speed: 52, armor: 0, weapon: 'bazooka', minLevel: 7, weight: 8, uniform: '#6a2a2a', helmet: '#1f1f1f' },
];

const BOSS_NAMES = ['Capitaine Moustache', 'Général Pétard', 'Colonel Boulet', 'Sergent Massacre', 'Commandant Tonnerre', 'Maréchal Bedaine'];
const BOSS_WEAPONS = ['shotgun', 'bazooka', 'minigun', 'railgun'];

export const BOSS_EVERY = 5;
export const isBossLevel = (level: number): boolean => level % BOSS_EVERY === 0;

/** Multiplicateur de puissance des ennemis de campagne. */
export function levelPower(level: number): number {
  return 0.55 + 0.04 * level;
}

export function campaignEnemyCount(level: number): number {
  return Math.min(2 + Math.floor(level * 0.5), 18);
}

function makeEnemy(t: Template, weapon: WeaponDef, index: number, m: number, scale = 1, nameOverride?: string): BattleUnit {
  const look: SpriteLook = { skin: '#c9a27a', hair: '#222', uniform: t.uniform, helmet: t.helmet, weaponId: weapon.id };
  const stats: CombatStats = {
    maxHp: t.hp * m,
    damage: weapon.damage * t.power * m,
    range: weapon.range,
    cooldown: weapon.cooldown,
    speed: t.speed,
    armor: t.armor,
    crit: 0.05,
    dodge: 0.02,
    lifesteal: 0,
    regen: 0,
    aoe: weapon.aoe,
    ranged: weapon.range > 60,
    berserk: false,
    secondWind: false,
  };
  return { id: `e${index}`, team: 'enemy', name: nameOverride ?? t.name, look, scale, stats };
}

function compose(level: number, count: number, rng: Rng): Template[] {
  const pool = TEMPLATES.filter((t) => t.minLevel <= level);
  const entries = pool.map((t) => [t, t.weight] as const);
  return Array.from({ length: count }, () => weightedPick(rng, entries));
}

export function buildCampaignEnemies(level: number): BattleUnit[] {
  const rng = mulberry32(level * 7919 + 13);
  const m = levelPower(level);
  const count = campaignEnemyCount(level);
  const boss = isBossLevel(level);
  const templates = compose(level, boss ? count - 1 : count, rng);
  const units = templates.map((t, i) => makeEnemy(t, WEAPONS_BY_ID[t.weapon], i, m * range(rng, 0.95, 1.05)));
  if (boss) {
    const k = level / BOSS_EVERY - 1;
    const weapon = WEAPONS_BY_ID[BOSS_WEAPONS[k % BOSS_WEAPONS.length]];
    const bossT: Template = { id: 'boss', name: BOSS_NAMES[k % BOSS_NAMES.length], hp: 450, power: 0.9, speed: 55, armor: 15, weapon: weapon.id, minLevel: 1, weight: 0, uniform: '#5a1a1a', helmet: '#d4a017' };
    units.push(makeEnemy(bossT, weapon, units.length, m, 1.6, bossT.name));
  }
  return units;
}

export function buildTrainingEnemies(avgLevel: number, squadSize: number, rng: Rng = Math.random): BattleUnit[] {
  const count = Math.max(2, squadSize);
  const m = levelPower(avgLevel) * 0.75;
  return compose(avgLevel, count, rng).map((t, i) => makeEnemy(t, WEAPONS_BY_ID[t.weapon], i, m * range(rng, 0.9, 1.1), 1, `${t.name} (cible)`));
}

export function previewCampaign(level: number): { count: number; boss: boolean; names: string[] } {
  const units = buildCampaignEnemies(level);
  const names = [...new Set(units.map((u) => u.name))];
  return { count: units.length, boss: isBossLevel(level), names };
}


