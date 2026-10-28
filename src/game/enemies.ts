import { WEAPONS_BY_ID } from './data';
import { ARENA_W, type BattleUnit } from './battle';
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
  // Ennemis de milieu de partie : un soigneur à abattre en priorité, et un tireur à zone
  { id: 'medic', name: 'Infirmier', hp: 70, power: 0.8, speed: 60, armor: 0, weapon: 'medic', minLevel: 14, weight: 7, uniform: '#e0e0e0', helmet: '#b02a2a' },
  { id: 'shocker', name: 'Électricien', hp: 90, power: 0.8, speed: 58, armor: 5, weapon: 'tesla', minLevel: 18, weight: 7, uniform: '#2a4a6a', helmet: '#7fd4ff' },
];

const BOSS_NAMES = ['Capitaine Moustache', 'Général Pétard', 'Colonel Boulet', 'Sergent Massacre', 'Commandant Tonnerre', 'Maréchal Bedaine'];
const BOSS_WEAPONS = ['shotgun', 'bazooka', 'minigun', 'railgun', 'mortar'];

export const BOSS_EVERY = 5;
export const isBossLevel = (level: number): boolean => level % BOSS_EVERY === 0;

/**
 * Multiplicateur de puissance des ennemis de campagne. Légèrement quadratique : les soldats montent en
 * puissance (niveau, améliorations, armes) plus vite qu'une courbe linéaire, et la fin de campagne doit le suivre.
 */
export function levelPower(level: number): number {
  return 0.5 + 0.035 * level + 0.0012 * level * level;
}

export function campaignEnemyCount(level: number): number {
  return Math.min(2 + Math.floor(level * 0.55), 18);
}

/** Retouches appliquées à toute une armée (défi du jour). */
interface ArmyMods {
  power?: number;
  armor?: number;
  speed?: number;
  cooldown?: number;
}

function makeEnemy(t: Template, weapon: WeaponDef, index: number, m: number, scale = 1, nameOverride?: string, mods: ArmyMods = {}): BattleUnit {
  const look: SpriteLook = { skin: '#c9a27a', hair: '#222', uniform: t.uniform, helmet: t.helmet, weaponId: weapon.id };
  const p = m * (mods.power ?? 1);
  const stats: CombatStats = {
    maxHp: t.hp * p,
    damage: weapon.damage * t.power * p,
    range: weapon.range,
    cooldown: weapon.cooldown * (mods.cooldown ?? 1),
    speed: t.speed * (mods.speed ?? 1),
    armor: t.armor + (mods.armor ?? 0),
    crit: 0.05,
    dodge: 0.02,
    lifesteal: 0,
    regen: 0,
    aoe: weapon.heal ? 0 : weapon.aoe,
    ranged: weapon.range > 60,
    berserk: false,
    secondWind: false,
    heal: !!weapon.heal,
  };
  return { id: `e${index}`, team: 'enemy', name: nameOverride ?? t.name, look, scale, stats };
}

function compose(level: number, count: number, rng: Rng): Template[] {
  const pool = TEMPLATES.filter((t) => t.minLevel <= level);
  const entries = pool.map((t) => [t, t.weight] as const);
  return Array.from({ length: count }, () => weightedPick(rng, entries));
}

/** Armée « normale » d'un niveau : `bosses` d'entre eux remplacent autant de soldats. */
function army(level: number, count: number, bosses: number, rng: Rng, mods: ArmyMods = {}, forced?: Template): BattleUnit[] {
  const m = levelPower(level);
  const troops = Math.max(0, count - bosses);
  const templates = forced ? Array.from({ length: troops }, () => forced) : compose(level, troops, rng);
  const units = templates.map((t, i) => makeEnemy(t, WEAPONS_BY_ID[t.weapon], i, m * range(rng, 0.95, 1.05), 1, undefined, mods));
  for (let b = 0; b < bosses; b++) units.push(makeBoss(level + b * BOSS_EVERY, units.length, m, mods));
  return units;
}

export function buildCampaignEnemies(level: number): BattleUnit[] {
  return army(level, campaignEnemyCount(level), isBossLevel(level) ? 1 : 0, mulberry32(level * 7919 + 13));
}

function makeBoss(level: number, index: number, m: number, mods: ArmyMods = {}): BattleUnit {
  // le boss du palier de 5 niveaux en cours (niveaux 1 à 5 → premier boss)
  const k = Math.max(0, Math.ceil(level / BOSS_EVERY) - 1);
  const weapon = WEAPONS_BY_ID[BOSS_WEAPONS[k % BOSS_WEAPONS.length]];
  const bossT: Template = { id: 'boss', name: BOSS_NAMES[k % BOSS_NAMES.length], hp: 450, power: 0.9, speed: 55, armor: 15, weapon: weapon.id, minLevel: 1, weight: 0, uniform: '#5a1a1a', helmet: '#d4a017' };
  return makeEnemy(bossT, weapon, index, m, 1.6, bossT.name, mods);
}

export function buildTrainingEnemies(avgLevel: number, squadSize: number, rng: Rng = Math.random): BattleUnit[] {
  const count = Math.max(2, squadSize);
  const m = levelPower(avgLevel) * 0.75;
  return compose(avgLevel, count, rng).map((t, i) => makeEnemy(t, WEAPONS_BY_ID[t.weapon], i, m * range(rng, 0.9, 1.1), 1, `${t.name} (cible)`));
}

// ---------- Défi du jour ----------

export interface DailyModifier {
  id: string;
  name: string;
  desc: string;
}

export const DAILY_MODIFIERS: DailyModifier[] = [
  { id: 'horde', name: 'La horde', desc: 'Deux fois plus d’ennemis, mais 40 % moins puissants chacun : misez sur les armes à zone.' },
  { id: 'elite', name: 'Commando d’élite', desc: 'Moitié moins d’ennemis, mais 80 % plus puissants : misez sur les dégâts purs.' },
  { id: 'snipers', name: 'Nid de tireurs', desc: 'Uniquement des tireurs d’élite : foncez au contact ou esquivez.' },
  { id: 'brutes', name: 'Mur de muscles', desc: 'Uniquement des brutes, avec +20 armure : préférez les gros coups aux rafales.' },
  { id: 'bosses', name: 'Conseil de guerre', desc: 'Deux boss mènent la troupe.' },
  { id: 'blitz', name: 'Blitzkrieg', desc: 'Ennemis 60 % plus rapides et cadence de tir +30 % : protégez vos tireurs.' },
];

/** Clé du jour, à l'heure locale du joueur (AAAA-MM-JJ). */
export function dailyKey(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function keySeed(key: string): number {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function dailyModifier(key: string): DailyModifier {
  return DAILY_MODIFIERS[keySeed(key) % DAILY_MODIFIERS.length];
}

/** Le défi suit la progression : un cran au-dessus du dernier niveau de campagne terminé. */
export function dailyLevel(campaignLevel: number): number {
  return Math.max(3, campaignLevel + 1);
}

/** Ennemis du défi : identiques pour toute la journée, quel que soit le nombre d'estimations. */
export function buildDailyEnemies(key: string, level: number): BattleUnit[] {
  const rng = mulberry32(keySeed(key) ^ (level * 2654435761));
  const count = campaignEnemyCount(level);
  const byId = (id: string) => TEMPLATES.find((t) => t.id === id)!;
  switch (dailyModifier(key).id) {
    case 'horde':
      return army(level, Math.min(24, count * 2), 0, rng, { power: 0.6 });
    case 'elite':
      return army(level, Math.max(2, Math.ceil(count / 2)), 0, rng, { power: 1.8 });
    case 'snipers':
      return army(level, count, 0, rng, {}, byId('sniper'));
    case 'brutes':
      return army(level, count, 0, rng, { armor: 20 }, byId('brute'));
    case 'bosses':
      return army(level, count, 2, rng);
    default:
      return army(level, count, 0, rng, { speed: 1.6, cooldown: 0.77 });
  }
}

// ---------- Survie ----------

/** Niveau de départ des vagues : en dessous de la campagne, pour laisser le temps d'empocher quelques vagues. */
export function survivalBaseLevel(campaignLevel: number): number {
  return Math.max(1, Math.floor(campaignLevel * 0.6));
}

export function survivalWaveLevel(wave: number, campaignLevel: number): number {
  return survivalBaseLevel(campaignLevel) + wave - 1;
}

/** Une vague sur 5 est menée par un boss. */
export function buildSurvivalEnemies(wave: number, campaignLevel: number, rng: Rng): BattleUnit[] {
  const level = survivalWaveLevel(wave, campaignLevel);
  return army(level, campaignEnemyCount(level), isBossLevel(wave) ? 1 : 0, rng);
}

// ---------- Simulation ----------

/** Dégâts ajoutés à chaque seconde de combat par l'épouvantail (il part de 0). */
export const SCARECROW_GROWTH = 0.3;

export function buildScarecrow(index = 0): BattleUnit {
  const look: SpriteLook = { skin: '#d9b56a', hair: '#8a6a2a', uniform: '#8a6a2a', helmet: '#5a4a2a', weaponId: 'fists' };
  const stats: CombatStats = {
    maxHp: 1,
    damage: 0,
    // immobile : sa portée couvre l'arène pour toujours frapper le soldat le plus proche, même à distance
    range: ARENA_W,
    cooldown: 1,
    speed: 0,
    armor: 0,
    crit: 0,
    dodge: 0,
    lifesteal: 0,
    regen: 0,
    aoe: 0,
    ranged: false,
    berserk: false,
    secondWind: false,
    heal: false,
  };
  return { id: index ? `scarecrow${index}` : 'scarecrow', team: 'enemy', name: 'Épouvantail', look, scale: 1.2, stats, dummy: { growth: SCARECROW_GROWTH } };
}

/** Adversaire de simulation : épouvantail, mélange réaliste selon le niveau, ou un seul type de troupe. */
export type SimOpponent = 'scarecrow' | 'mixed' | string;

export interface SimulationConfig {
  opponent: SimOpponent;
  count: number;
  level: number;
  boss: boolean;
}

export const SIM_MAX_ENEMIES = 18;
export const SIM_ENEMY_TYPES: { id: string; name: string }[] = TEMPLATES.map((t) => ({ id: t.id, name: t.name }));

export function simulationPool(cfg: SimulationConfig): string[] {
  if (cfg.opponent === 'scarecrow') return ['Épouvantail'];
  const pool = cfg.opponent === 'mixed' ? TEMPLATES.filter((t) => t.minLevel <= cfg.level) : TEMPLATES.filter((t) => t.id === cfg.opponent);
  return pool.map((t) => t.name);
}

/**
 * Ennemis d'une simulation, à la puissance de campagne du niveau choisi. Le boss remplace
 * l'un des ennemis, comme en campagne ; un type imposé ignore le niveau minimal d'apparition.
 */
export function buildSimulationEnemies(cfg: SimulationConfig, rng: Rng): BattleUnit[] {
  const count = Math.min(Math.max(1, Math.round(cfg.count)), SIM_MAX_ENEMIES);
  if (cfg.opponent === 'scarecrow') return Array.from({ length: count }, (_, i) => buildScarecrow(i));
  const level = Math.max(1, Math.round(cfg.level));
  return army(level, count, cfg.boss ? 1 : 0, rng, {}, TEMPLATES.find((t) => t.id === cfg.opponent));
}

export function previewCampaign(level: number): { count: number; boss: boolean; names: string[] } {
  return previewUnits(buildCampaignEnemies(level), isBossLevel(level));
}

export function previewUnits(units: BattleUnit[], boss: boolean): { count: number; boss: boolean; names: string[] } {
  return { count: units.length, boss, names: [...new Set(units.map((u) => u.name))] };
}
