import { COLOSSUS_HP, COLOSSUS_HP_PER_RANK, WEAPONS_BY_ID } from './data';
import { levelMult } from './stats';
import { ARENA_W, BANNER_ARMOR, BANNER_DMG, type BattleUnit } from './battle';
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
  /** Mécanique propre à la troupe (troupes de fin de partie). */
  special?: Pick<BattleUnit, 'flying' | 'stealth' | 'banner' | 'mines'>;
  /** Poids supplémentaire de la mécanique dans le budget de menace. */
  threatMult?: number;
  scale?: number;
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
  // Fin de partie : chaque troupe impose une réponse (tireurs contre les drones, pas de zone contre l'étendard…)
  { id: 'deminer', name: 'Démineur', hp: 90, power: 0.7, speed: 62, armor: 5, weapon: 'pistol', minLevel: 22, weight: 7, uniform: '#5a5a2a', helmet: '#c8a83a', special: { mines: { every: 3.5, dmg: 3, r: 42 } }, threatMult: 1.25 },
  { id: 'drone', name: 'Drone', hp: 55, power: 0.85, speed: 95, armor: 0, weapon: 'smg', minLevel: 25, weight: 8, uniform: '#3a3f46', helmet: '#9aa4ae', special: { flying: true }, threatMult: 1.3, scale: 0.85 },
  { id: 'banner', name: 'Porte-étendard', hp: 140, power: 0.6, speed: 55, armor: 10, weapon: 'spear', minLevel: 28, weight: 5, uniform: '#7a1f3a', helmet: '#e0b03a', special: { banner: true }, threatMult: 1.5 },
  { id: 'stalker', name: 'Camoufleur', hp: 70, power: 1.2, speed: 78, armor: 0, weapon: 'revolver', minLevel: 32, weight: 7, uniform: '#2f3a2a', helmet: '#4a5a3a', special: { stealth: true }, threatMult: 1.2 },
];

/** Mécanique spéciale d'une troupe, en clair (aperçu, wiki). */
export function specialDesc(id: string): string | null {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t?.special) return null;
  if (t.special.mines) return 'Pose des mines qui explosent au passage de vos soldats';
  if (t.special.flying) return 'Vole : seules les armes à distance l’atteignent tant qu’il reste des ennemis au sol (mêlée à 50 % ensuite), et la zone l’épargne';
  if (t.special.banner) return `Aura : ses alliés proches font +${Math.round((BANNER_DMG - 1) * 100)} % de dégâts et ont +${BANNER_ARMOR} armure. Abattez-le en premier`;
  if (t.special.stealth) return 'Invisible et impossible à cibler jusqu’à son premier tir';
  return null;
}

const BOSS_NAMES = ['Capitaine Moustache', 'Général Pétard', 'Colonel Boulet', 'Sergent Massacre', 'Commandant Tonnerre', 'Maréchal Bedaine'];
const BOSS_WEAPONS = ['shotgun', 'bazooka', 'minigun', 'railgun', 'mortar'];

export const BOSS_EVERY = 5;
export const isBossLevel = (level: number): boolean => level % BOSS_EVERY === 0;

/**
 * Puissance de base d'un ennemi selon le niveau : sert à l'entraînement et à la simulation. Pour les vrais combats,
 * l'armée est ensuite recalée sur le budget de menace du niveau (voir fitToBudget).
 */
export function levelPower(level: number): number {
  return 0.5 + 0.035 * level + 0.0012 * level * level;
}

/** Troupes ennemies, pour les présenter dans le wiki. */
export const ENEMY_TEMPLATES: readonly Pick<Template, 'id' | 'name' | 'weapon' | 'minLevel'>[] = TEMPLATES;

export function campaignEnemyCount(level: number): number {
  return Math.min(2 + Math.floor(level * 0.55), 18);
}

// ---------- Élites ----------

export interface EliteAffix {
  id: string;
  name: string;
  desc: string;
  apply: (s: CombatStats) => void;
}

export const ELITE_AFFIXES: EliteAffix[] = [
  { id: 'armored', name: 'Blindé', desc: '+25 armure', apply: (s) => { s.armor += 25; } },
  { id: 'frenzied', name: 'Enragé', desc: '+40 % dégâts sous 50 % PV, +15 % vitesse', apply: (s) => { s.berserk = true; s.speed *= 1.15; } },
  { id: 'swift', name: 'Véloce', desc: '+50 % vitesse, +15 % esquive', apply: (s) => { s.speed *= 1.5; s.dodge += 0.15; } },
  { id: 'vampiric', name: 'Vampire', desc: 'Soigne 25 % des dégâts infligés', apply: (s) => { s.lifesteal += 0.25; } },
  { id: 'regen', name: 'Régénérant', desc: 'Régénère 2 % des PV par seconde', apply: (s) => { s.regen += 0.02; } },
];

/** Nombre d'élites d'un niveau de campagne : aucun avant le niveau 6, puis un de plus tous les 7 niveaux. */
export function eliteCount(level: number): number {
  return level < 6 ? 0 : Math.min(4, 1 + Math.floor((level - 6) / 7));
}

function makeElite(u: BattleUnit, affix: EliteAffix): void {
  u.stats.maxHp *= 1.25;
  affix.apply(u.stats);
  u.elite = affix.name;
  u.name = `${u.name} d'élite`;
  u.scale = 1.15;
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
  return { id: `e${index}`, team: 'enemy', name: nameOverride ?? t.name, look, scale: t.scale ?? scale, stats, ...t.special, threatMult: t.threatMult };
}

function compose(level: number, count: number, rng: Rng): Template[] {
  const pool = TEMPLATES.filter((t) => t.minLevel <= level);
  const entries = pool.map((t) => [t, t.weight] as const);
  return Array.from({ length: count }, () => weightedPick(rng, entries));
}

/**
 * Menace d'une unité : racine de sa résistance par son efficacité offensive, à la manière des lois de Lanchester
 * (la force d'une armée croît avec le carré de la somme de ces valeurs). Coefficients mesurés en simulation : à budget
 * égal, la portée pèse très lourd (un tireur d'élite tire sans riposte) et la mêlée peu (elle meurt en traversant le feu).
 */
function threat(u: BattleUnit): number {
  const s = u.stats;
  const offense = (s.damage / s.cooldown) * (1 + s.aoe / 80) * (s.ranged ? Math.pow(s.range / 150, 1.3) : 0.4);
  return Math.sqrt(s.maxHp * (1 + s.armor / 100) * offense) * (u.threatMult ?? 1);
}

/** Les boss restent un cran au-dessus des niveaux qui les entourent. */
const BOSS_BUDGET = 1.05;
/** Menace d'un soldat de niveau 1 bien équipé, mesurée en simulation : l'unité de mesure du budget. */
const THREAT_PER_SOLDIER = 164;

/**
 * Budget de menace d'un niveau : la force qu'on attend du joueur à ce stade, et non une courbe arbitraire.
 * Il suit l'escouade prévue (3 à 6 soldats), leur niveau prévu (les soldats progressent moins vite que la campagne)
 * et leur équipement prévu (améliorations, armes et recrues plus rares). Il est continu : une place d'escouade
 * ou une arme légendaire sont de vrais soulagements, que les niveaux suivants rattrapent peu à peu.
 */
export function threatBudget(level: number): number {
  const squad = 3 + (3 * Math.min(level, 25)) / 25;
  const soldier = levelMult(1 + 0.72 * (level - 1));
  // L'escouade de départ n'a que des armes communes : son retard est comblé sur les premiers niveaux
  const gear = 0.14 + 0.44 * Math.min(1, (level - 1) / 10);
  return THREAT_PER_SOLDIER * squad * soldier * gear;
}

/**
 * Recale une armée sur le budget de son niveau. Sans cela, un ennemi de plus ou un tirage riche en Brutes
 * crée un mur isolé : la composition doit changer la manière de jouer un combat, pas sa difficulté.
 */
function fitToBudget(units: BattleUnit[], level: number, bossLevel: boolean): BattleUnit[] {
  const total = units.reduce((sum, u) => sum + threat(u), 0);
  const k = (threatBudget(level) * (bossLevel ? BOSS_BUDGET : 1)) / total;
  for (const u of units) {
    u.stats.maxHp *= k;
    u.stats.damage *= k;
  }
  return units;
}

/** Armée « normale » d'un niveau : `bosses` d'entre eux remplacent autant de soldats. */
function army(level: number, count: number, bosses: number, rng: Rng, mods: ArmyMods = {}, forced?: Template, elites = 0): BattleUnit[] {
  const m = levelPower(level);
  const troops = Math.max(0, count - bosses);
  const templates = forced ? Array.from({ length: troops }, () => forced) : compose(level, troops, rng);
  const units = templates.map((t, i) => makeEnemy(t, WEAPONS_BY_ID[t.weapon], i, m * range(rng, 0.95, 1.05), 1, undefined, mods));
  for (let e = 0; e < Math.min(elites, units.length); e++) makeElite(units[units.length - 1 - e], ELITE_AFFIXES[Math.floor(rng() * ELITE_AFFIXES.length)]);
  for (let b = 0; b < bosses; b++) units.push(makeBoss(level + b * BOSS_EVERY, units.length, m, mods));
  return units;
}

export function buildCampaignEnemies(level: number): BattleUnit[] {
  return fitToBudget(army(level, campaignEnemyCount(level), isBossLevel(level) ? 1 : 0, mulberry32(level * 7919 + 13), {}, undefined, eliteCount(level)), level, isBossLevel(level));
}

function makeBoss(level: number, index: number, m: number, mods: ArmyMods = {}): BattleUnit {
  // le boss du palier de 5 niveaux en cours (niveaux 1 à 5 → premier boss)
  const k = Math.max(0, Math.ceil(level / BOSS_EVERY) - 1);
  const weapon = WEAPONS_BY_ID[BOSS_WEAPONS[k % BOSS_WEAPONS.length]];
  const bossT: Template = { id: 'boss', name: BOSS_NAMES[k % BOSS_NAMES.length], hp: 320, power: 0.75, speed: 55, armor: 10, weapon: weapon.id, minLevel: 1, weight: 0, uniform: '#5a1a1a', helmet: '#d4a017' };
  return { ...makeEnemy(bossT, weapon, index, m, 1.6, bossT.name, mods), boss: true };
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
  return fitToBudget(dailyArmy(key, level), level, false);
}

function dailyArmy(key: string, level: number): BattleUnit[] {
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
  return fitToBudget(army(level, campaignEnemyCount(level), isBossLevel(wave) ? 1 : 0, rng, {}, undefined, eliteCount(level)), level, isBossLevel(wave));
}

// ---------- Chair à canon ----------

export function colossusMaxHp(rank: number): number {
  return COLOSSUS_HP * (1 + COLOSSUS_HP_PER_RANK * (rank - 1));
}

/** Le Colosse : ses PV se conservent d'un sacrifice à l'autre, et sa rage grandissante finit par abattre n'importe qui. */
export function buildColossus(rank: number, hp: number): BattleUnit {
  const look: SpriteLook = { skin: '#8fa06a', hair: '#222', uniform: '#3a2a4a', helmet: '#7a1f1f', weaponId: 'minigun' };
  const stats: CombatStats = {
    maxHp: colossusMaxHp(rank),
    damage: 30,
    range: 110,
    cooldown: 1.2,
    speed: 90,
    armor: 20,
    crit: 0,
    dodge: 0,
    lifesteal: 0,
    regen: 0,
    aoe: 40,
    ranged: true,
    berserk: false,
    secondWind: false,
    heal: false,
  };
  return { id: 'colossus', team: 'enemy', name: `Le Colosse (rang ${rank})`, look, scale: 1.8, stats, hp, growth: 4, boss: true };
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

export interface ArmyPreview {
  count: number;
  boss: boolean;
  /** Types de troupes, avec leur effectif. */
  groups: { name: string; count: number }[];
  /** Affixes des élites présents. */
  elites: EliteAffix[];
}

export function previewCampaign(level: number): ArmyPreview {
  return previewUnits(buildCampaignEnemies(level), isBossLevel(level));
}

export function previewUnits(units: BattleUnit[], boss: boolean): ArmyPreview {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.name, (counts.get(u.name) ?? 0) + 1);
  const elites = [...new Set(units.map((u) => u.elite).filter(Boolean))].map((name) => ELITE_AFFIXES.find((a) => a.name === name)!);
  return { count: units.length, boss, groups: [...counts].map(([name, count]) => ({ name, count })), elites };
}

// ---------- Tour sans fin ----------

export interface TowerCurse {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Effet sur les ennemis (après recalage sur le budget, pour durcir vraiment l'étage). */
  enemy?: (s: CombatStats) => void;
  /** Effet sur vos soldats. */
  ally?: (s: CombatStats) => void;
  /** Ennemis supplémentaires, et élites supplémentaires. */
  extra?: number;
  elites?: number;
}

/** Une malédiction s'ajoute tous les TOWER_CURSE_EVERY étages ; une fois la liste épuisée, elles se cumulent à nouveau. */
export const TOWER_CURSE_EVERY = 5;
export const TOWER_CURSES: TowerCurse[] = [
  { id: 'swift', name: 'Pas de course', icon: '💨', desc: 'Ennemis +20 % vitesse', enemy: (s) => { s.speed *= 1.2; } },
  { id: 'armor', name: 'Blindage', icon: '🛡️', desc: 'Ennemis +15 armure', enemy: (s) => { s.armor += 15; } },
  { id: 'weary', name: 'Fatigue', icon: '🥱', desc: 'Vos soldats −12 % PV', ally: (s) => { s.maxHp *= 0.88; } },
  { id: 'regen', name: 'Sang chaud', icon: '🩸', desc: 'Ennemis : régénèrent 1 % des PV par seconde', enemy: (s) => { s.regen += 0.01; } },
  { id: 'elite', name: 'Corps d’élite', icon: '★', desc: 'Deux élites de plus', elites: 2 },
  { id: 'fury', name: 'Furie', icon: '😡', desc: 'Ennemis +20 % dégâts', enemy: (s) => { s.damage *= 1.2; } },
  { id: 'fog', name: 'Brouillard', icon: '🌫️', desc: 'Portée de vos soldats −15 %', ally: (s) => { s.range *= 0.85; } },
  { id: 'horde', name: 'Renforts', icon: '👥', desc: '+3 ennemis', extra: 3 },
];

/** Puissance d'un étage : au-dessus de la fin de la campagne, un niveau de plus par étage. */
export function towerLevel(floor: number): number {
  return 20 + floor;
}

export const isTowerBoss = (floor: number): boolean => floor % TOWER_CURSE_EVERY === 0;

/** Malédictions actives à un étage, dans l'ordre où elles sont apparues (doublons possibles après un tour complet). */
export function towerCurses(floor: number): TowerCurse[] {
  const count = Math.floor((floor - 1) / TOWER_CURSE_EVERY);
  return Array.from({ length: count }, (_, k) => TOWER_CURSES[k % TOWER_CURSES.length]);
}

/** Ennemis d'un étage : fixes pour un étage donné, pour qu'on puisse s'y préparer. */
export function buildTowerEnemies(floor: number): BattleUnit[] {
  const level = towerLevel(floor);
  const curses = towerCurses(floor);
  const rng = mulberry32(floor * 104729 + 7);
  const count = Math.min(24, campaignEnemyCount(level) + curses.reduce((n, c) => n + (c.extra ?? 0), 0));
  const elites = Math.min(count, eliteCount(level) + curses.reduce((n, c) => n + (c.elites ?? 0), 0));
  const units = fitToBudget(army(level, count, isTowerBoss(floor) ? 1 : 0, rng, {}, undefined, elites), level, isTowerBoss(floor));
  for (const c of curses) if (c.enemy) for (const u of units) c.enemy(u.stats);
  return units;
}

/** Applique aux soldats les malédictions d'un étage. Modifie les stats. */
export function applyTowerCurses(allies: BattleUnit[], floor: number): BattleUnit[] {
  for (const c of towerCurses(floor)) if (c.ally) for (const u of allies) c.ally(u.stats);
  return allies;
}
