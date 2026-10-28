import type { Mods, Rarity, TitleId, UpgradeDef, WeaponDef } from './types';

/** Places dans l'escouade au départ ; la campagne en débloque d'autres (voir UNLOCKS). */
export const SQUAD_BASE = 4;
export const TRAINING_PER_SOLDIER = 3;
export const PULL_COST = 100;
export const PULL10_COST = 900;
export const PITY_LIMIT = 20;
export const WEAPON_PULL_COST = 80;
export const WEAPON_PULL10_COST = 720;
export const START_GOLD = 200;
export const START_FREE_PULLS = 5;
export const MAX_LEVEL = 30;
export const UPGRADE_PICKS = 3;
export const UPGRADE_CHOICES = 3;
export const PICK_EVERY_LEVELS = 5;
export const MAX_UPGRADES = 8;
// Ennemis éliminés au total (toutes escouades confondues) pour débloquer le choix automatique des améliorations.
export const AUTO_PICK_KILLS = 500;

export type UnlockId = 'armory' | 'simulation' | 'squad5' | 'daily' | 'forge' | 'survival' | 'squad6';

export interface UnlockDef {
  id: UnlockId;
  /** Niveau de campagne à terminer pour débloquer. */
  level: number;
  label: string;
  desc: string;
}

// Seuils de progression : chaque palier de campagne ouvre une nouvelle mécanique, pour ne pas tout montrer d'emblée
export const UNLOCKS: UnlockDef[] = [
  { id: 'armory', level: 1, label: 'Armurerie', desc: "Achetez des armes au hasard dans l'onglet Recruter." },
  { id: 'simulation', level: 2, label: 'Simulation', desc: 'Testez votre escouade sans risque face aux adversaires de votre choix.' },
  { id: 'squad5', level: 5, label: "5e place d'escouade", desc: "Engagez jusqu'à 5 soldats par combat." },
  { id: 'daily', level: 6, label: 'Défi du jour', desc: 'Un combat unique chaque jour, avec une règle spéciale et de grosses récompenses.' },
  { id: 'forge', level: 8, label: 'Forge', desc: "Fusionnez 3 armes d'une même rareté en une arme de la rareté supérieure." },
  { id: 'survival', level: 12, label: 'Mode Survie', desc: 'Enchaînez les vagues sans soins complets : encaissez vos gains ou risquez tout.' },
  { id: 'squad6', level: 20, label: "6e place d'escouade", desc: "Engagez jusqu'à 6 soldats par combat." },
];

/** Chaque premier passage d'un boss offre un tirage de soldat gratuit. */
export const BOSS_FREE_PULLS = 1;

/** Forge : nombre d'armes d'une même rareté à fondre, et coût en or selon la rareté de départ. */
export const FORGE_INPUT = 3;
export const FORGE_FEE: Record<Exclude<Rarity, 'legendary'>, number> = { common: 20, rare: 60, epic: 150 };

/** Survie : part des PV max regagnée entre deux vagues. */
export const SURVIVAL_REST_HEAL = 0.25;

export const TITLES: Record<TitleId, { label: string; desc: string }> = {
  legende: { label: 'Légende', desc: 'Atteint le niveau maximum' },
  legion: { label: "Légion d'honneur", desc: "Décoré de la Légion d'honneur" },
};

export interface RarityInfo {
  label: string;
  color: string;
  statMult: number;
  rate: number;
  sellValue: number;
  releaseValue: number;
}

export const RARITIES: Record<Rarity, RarityInfo> = {
  common: { label: 'Commun', color: '#9aa5a0', statMult: 1, rate: 60, sellValue: 10, releaseValue: 20 },
  rare: { label: 'Rare', color: '#4aa3ff', statMult: 1.15, rate: 28, sellValue: 30, releaseValue: 50 },
  epic: { label: 'Épique', color: '#b46cff', statMult: 1.3, rate: 9, sellValue: 80, releaseValue: 120 },
  legendary: { label: 'Légendaire', color: '#ffb02e', statMult: 1.5, rate: 3, sellValue: 200, releaseValue: 300 },
};

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export const WEAPONS: WeaponDef[] = [
  { id: 'fists', name: 'Poings nus', rarity: 'common', damage: 6, range: 24, cooldown: 0.7, aoe: 0, shape: 'fists', color: '#d9b38c', droppable: false },
  // Mêlée : le soldat doit traverser le feu ennemi, d'où des dégâts plus élevés et des bonus de survie propres à l'arme
  { id: 'knife', name: 'Couteau', rarity: 'common', damage: 11, range: 26, cooldown: 0.5, aoe: 0, dodge: 0.08, speedPct: 0.2, shape: 'knife', color: '#c8ccd0', droppable: true },
  { id: 'pistol', name: 'Pistolet', rarity: 'common', damage: 11, range: 150, cooldown: 0.8, aoe: 0, shape: 'pistol', color: '#9aa0a6', droppable: true },
  { id: 'crossbow', name: 'Arbalète', rarity: 'common', damage: 22, range: 230, cooldown: 1.5, aoe: 0, crit: 0.1, shape: 'crossbow', color: '#8a6a3a', droppable: true },
  { id: 'shotgun', name: 'Fusil à pompe', rarity: 'rare', damage: 40, range: 95, cooldown: 1.5, aoe: 0, shape: 'shotgun', color: '#7a5a3a', droppable: true },
  { id: 'smg', name: 'Mitraillette', rarity: 'rare', damage: 8, range: 130, cooldown: 0.3, aoe: 0, shape: 'smg', color: '#6f7780', droppable: true },
  { id: 'rifle', name: "Fusil d'assaut", rarity: 'rare', damage: 13, range: 190, cooldown: 0.5, aoe: 0, shape: 'rifle', color: '#5d6b58', droppable: true },
  { id: 'revolver', name: 'Revolver', rarity: 'rare', damage: 30, range: 170, cooldown: 1.1, aoe: 0, crit: 0.15, shape: 'revolver', color: '#b08d57', droppable: true },
  { id: 'sword', name: 'Épée', rarity: 'rare', damage: 26, range: 30, cooldown: 0.8, aoe: 0, lifesteal: 0.1, shape: 'sword', color: '#dfe6ee', droppable: true },
  { id: 'spear', name: 'Hallebarde', rarity: 'rare', damage: 22, range: 50, cooldown: 0.85, aoe: 0, armor: 6, shape: 'spear', color: '#a9b4bd', droppable: true },
  { id: 'launcher', name: 'Lance-grenades', rarity: 'rare', damage: 30, range: 180, cooldown: 1.8, aoe: 45, shape: 'launcher', color: '#6a7a4a', droppable: true },
  { id: 'flamer', name: 'Lance-flammes', rarity: 'epic', damage: 9, range: 80, cooldown: 0.3, aoe: 30, shape: 'flame', color: '#c0392b', droppable: true },
  { id: 'sniper', name: 'Fusil de précision', rarity: 'epic', damage: 70, range: 380, cooldown: 2, aoe: 0, shape: 'sniper', color: '#3d4a5c', droppable: true },
  { id: 'bazooka', name: 'Bazooka', rarity: 'epic', damage: 55, range: 230, cooldown: 1.8, aoe: 55, shape: 'bazooka', color: '#5a6b3c', droppable: true },
  { id: 'axe', name: 'Hache de guerre', rarity: 'epic', damage: 48, range: 30, cooldown: 1.3, aoe: 35, lifesteal: 0.1, shape: 'axe', color: '#b8bfc6', droppable: true },
  { id: 'tesla', name: 'Canon Tesla', rarity: 'epic', damage: 24, range: 150, cooldown: 0.9, aoe: 40, shape: 'tesla', color: '#7fd4ff', droppable: true },
  // Soigneur : ses « dégâts » deviennent des soins sur l'allié le plus blessé ; il ne tire que si personne n'est blessé
  { id: 'medic', name: 'Fusil médical', rarity: 'epic', damage: 16, range: 160, cooldown: 1, aoe: 0, heal: true, shape: 'medic', color: '#e8f4f0', droppable: true },
  { id: 'minigun', name: 'Minigun', rarity: 'legendary', damage: 11, range: 200, cooldown: 0.2, aoe: 0, shape: 'minigun', color: '#ffb02e', droppable: true },
  { id: 'railgun', name: 'Railgun', rarity: 'legendary', damage: 150, range: 450, cooldown: 3, aoe: 0, shape: 'railgun', color: '#3fe0ff', droppable: true },
  { id: 'katana', name: 'Katana plasma', rarity: 'legendary', damage: 45, range: 30, cooldown: 0.8, aoe: 25, lifesteal: 0.15, speedPct: 0.2, shape: 'katana', color: '#ff4fd8', droppable: true },
  { id: 'mortar', name: 'Obusier', rarity: 'legendary', damage: 80, range: 420, cooldown: 2.8, aoe: 70, shape: 'mortar', color: '#9c7a3c', droppable: true },
  { id: 'buckler', name: 'Bouclier de fortune', rarity: 'common', damage: 8, range: 26, cooldown: 0.8, aoe: 0, armor: 12, shape: 'shield', color: '#8a6a4a', droppable: true },
  { id: 'riot', name: 'Bouclier anti-émeute', rarity: 'rare', damage: 12, range: 26, cooldown: 0.9, aoe: 0, armor: 22, shape: 'shield', color: '#3d6e8f', droppable: true },
  { id: 'tower', name: 'Bouclier blindé', rarity: 'epic', damage: 20, range: 28, cooldown: 1.1, aoe: 0, armor: 32, shape: 'shield', color: '#56654a', droppable: true },
  { id: 'aegis', name: 'Égide', rarity: 'legendary', damage: 34, range: 30, cooldown: 1, aoe: 25, armor: 50, shape: 'shield', color: '#ffd45e', droppable: true },
];

export const WEAPONS_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const FISTS = WEAPONS_BY_ID.fists;
export const START_WEAPONS = ['pistol', 'pistol', 'knife'];

export const UPGRADES: UpgradeDef[] = [
  { id: 'vitality', name: 'Constitution', desc: '+25 % PV', mods: { hpPct: 0.25 } },
  { id: 'power', name: 'Force brute', desc: '+20 % dégâts', mods: { dmgPct: 0.2 } },
  { id: 'sprint', name: 'Jambes de feu', desc: '+25 % vitesse de déplacement', mods: { speedPct: 0.25 } },
  { id: 'plating', name: 'Gilet pare-balles', desc: '+20 armure (réduit les dégâts reçus)', mods: { armor: 20 } },
  { id: 'eagle', name: 'Œil de lynx', desc: '+20 % de chances de coup critique (x2 dégâts)', mods: { crit: 0.2 } },
  { id: 'vampire', name: 'Soif de sang', desc: 'Soigne 15 % des dégâts infligés', mods: { lifesteal: 0.15 } },
  { id: 'regen', name: 'Trousse de soin', desc: 'Régénère 2 % des PV par seconde', mods: { regenPct: 0.02 } },
  { id: 'ghost', name: 'Fantôme', desc: '+15 % de chances d’esquive', mods: { dodge: 0.15 } },
  { id: 'scope', name: 'Lunette', desc: '+30 % de portée', mods: { rangePct: 0.3 } },
  { id: 'rapid', name: 'Doigts agiles', desc: '-25 % de temps de recharge', mods: { cdPct: -0.25 } },
  { id: 'blast', name: 'Munitions explosives', desc: 'Dégâts de zone (rayon +35)', mods: { aoe: 35 } },
  { id: 'berserk', name: 'Rage', desc: '+40 % dégâts sous 50 % PV', mods: { berserk: true } },
  { id: 'tank', name: 'Colosse', desc: '+50 % PV, -15 % vitesse', mods: { hpPct: 0.5, speedPct: -0.15 } },
  { id: 'glass', name: 'Canon de verre', desc: '+45 % dégâts, -25 % PV', mods: { dmgPct: 0.45, hpPct: -0.25 } },
  { id: 'lastbreath', name: 'Dernier souffle', desc: 'Survit une fois par combat à un coup fatal (reprend 25 % PV)', mods: { secondWind: true } },
  { id: 'studious', name: 'Élève brillant', desc: '+30 % d’XP gagnée', mods: { xpPct: 0.3 } },
];

export const LEGEND_UPGRADES: UpgradeDef[] = [
  { id: 'vitality+', name: 'Constitution d’acier', desc: '+50 % PV', mods: { hpPct: 0.5 } },
  { id: 'power+', name: 'Force titanesque', desc: '+40 % dégâts', mods: { dmgPct: 0.4 } },
  { id: 'sprint+', name: 'Foulées du vent', desc: '+40 % vitesse de déplacement', mods: { speedPct: 0.4 } },
  { id: 'plating+', name: 'Blindage lourd', desc: '+40 armure (réduit les dégâts reçus)', mods: { armor: 40 } },
  { id: 'eagle+', name: 'Regard de faucon', desc: '+35 % de chances de coup critique (x2 dégâts)', mods: { crit: 0.35 } },
  { id: 'vampire+', name: 'Sang de vampire', desc: 'Soigne 30 % des dégâts infligés', mods: { lifesteal: 0.3 } },
  { id: 'regen+', name: 'Régénération divine', desc: 'Régénère 4 % des PV par seconde', mods: { regenPct: 0.04 } },
  { id: 'ghost+', name: 'Spectre', desc: '+30 % de chances d’esquive', mods: { dodge: 0.3 } },
  { id: 'scope+', name: 'Œil de l’aigle', desc: '+60 % de portée', mods: { rangePct: 0.6 } },
  { id: 'rapid+', name: 'Mains de feu', desc: '-45 % de temps de recharge', mods: { cdPct: -0.45 } },
  { id: 'blast+', name: 'Ogives dévastatrices', desc: 'Dégâts de zone (rayon +60)', mods: { aoe: 60 } },
  { id: 'studious+', name: 'Maître d’armes', desc: '+60 % d’XP gagnée', mods: { xpPct: 0.6 } },
];

export const UPGRADES_BY_ID: Record<string, UpgradeDef> = Object.fromEntries([...UPGRADES, ...LEGEND_UPGRADES].map((u) => [u.id, u]));

export const EMPTY_MODS: Mods = {
  hpPct: 0,
  dmgPct: 0,
  speedPct: 0,
  armor: 0,
  crit: 0,
  lifesteal: 0,
  regenPct: 0,
  dodge: 0,
  rangePct: 0,
  cdPct: 0,
  aoe: 0,
  xpPct: 0,
  berserk: false,
  secondWind: false,
};

export const FIRST_NAMES = [
  'Bob', 'Rico', 'Jean-Michel', 'Dédé', 'Gaston', 'Kevin', 'Bernadette', 'Mireille', 'Colette', 'Raymonde',
  'Titouan', 'Fanfan', 'Léon', 'Gégé', 'Brigitte', 'Hubert', 'Lulu', 'Momo', 'Pascal', 'Josiane',
  'Roger', 'Ginette', 'Marcel', 'Odette',
];

export const NICKNAMES = [
  'la Gâchette', 'Gros Bras', 'le Fantôme', 'Boum-Boum', 'le Moustachu', 'Tête Brûlée', 'la Terreur', 'Pas de Chance',
  'le Costaud', 'Mitraillette', 'le Chanceux', 'Petit Pois', 'le Blindé', 'Sans Peur', 'le Balafré', 'Casse-Tout',
  'la Fouine', 'Œil de Lynx', 'le Roc', 'Jamais Content', 'le Poète', 'la Tornade', 'Mauvais Œil', 'le Bleu',
];

export const SKIN_TONES = ['#f1c9a5', '#e0ac82', '#c68a5e', '#8d5a3b', '#5e3b26'];
export const HAIR_COLORS = ['#2a1d12', '#5a3a1e', '#a8742c', '#d9b455', '#b5482a', '#9aa0a6'];
export const UNIFORM_COLORS = ['#4f6b3a', '#3d5a80', '#6b5a3a', '#4a5a4a', '#5a4a6b', '#2f6b6b', '#6b3a4a', '#7a7a3a'];
export const HELMET_COLORS = ['#3a4a2a', '#2b3a52', '#4a4030', '#56606a', '#2f2f35', '#6a5a2a'];
