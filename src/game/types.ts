export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type Team = 'ally' | 'enemy';
export type TitleId = 'legende' | 'legion';
export type TacticId = 'balanced' | 'assault' | 'bulwark' | 'hunters';
export type PositionId = 'free' | 'front' | 'cover' | 'rear';
export type TraitId = 'hothead' | 'coward' | 'glutton' | 'lucky' | 'stoic' | 'nerd' | 'myopic' | 'tough' | 'speedy' | 'joker';

export interface Appearance {
  skin: number;
  hair: number;
  uniform: number;
  helmet: number;
}

export interface Soldier {
  id: string;
  name: string;
  rarity: Rarity;
  appearance: Appearance;
  hpRoll: number;
  powerRoll: number;
  speedRoll: number;
  level: number;
  xp: number;
  upgrades: string[];
  upgradeChoices: string[] | null;
  picksLeft: number;
  titles: TitleId[];
  weaponUid: string | null;
  trainingsLeft: number;
  kills: number;
  favorite: boolean;
  /** Nombre de Légions d'honneur reçues : chacune ouvre des emplacements d'amélioration supplémentaires. */
  legions: number;
  /** Place du soldat dans la formation au combat. */
  position: PositionId;
  /** Trait de personnalité : un petit bonus de stats et des répliques en combat. */
  trait: TraitId;
}

export interface WeaponItem {
  uid: string;
  defId: string;
  /** Préfixe aléatoire tiré à l'obtention (voir WEAPON_AFFIXES). */
  affix?: string;
  /** Niveau d'amélioration à l'Atelier, de 0 à WEAPON_MAX_PLUS. */
  plus?: number;
}

export const BATTLE_SPEEDS = [0.5, 1, 2, 4] as const;
export type BattleSpeed = (typeof BATTLE_SPEEDS)[number];

export interface GameState {
  version: 1;
  gold: number;
  pity: number;
  /** Tirages d'armes depuis la dernière arme Épique ou mieux. */
  weaponPity: number;
  totalPulls: number;
  soldiers: Soldier[];
  weapons: WeaponItem[];
  campaignLevel: number;
  freePulls: number;
  nextId: number;
  stats: { won: number; lost: number; deaths: number; kills: number };
  battleSpeed: BattleSpeed;
  /** Le joueur a masqué le bandeau « prochaine étape ». */
  hideGuide: boolean;
  /** Date (AAAA-MM-JJ) du dernier défi du jour tenté. */
  lastDaily: string | null;
  /** Jours consécutifs de défi du jour remporté. */
  dailyStreak: number;
  /** Expédition de survie en cours, s'il y en a une. */
  survival: SurvivalRun | null;
  /** Meilleure vague atteinte en survie. */
  bestWave: number;
  /** Chair à canon : rang du Colosse et dégâts déjà encaissés, conservés d'un sacrifice à l'autre. */
  colossus: { rank: number; damage: number };
  /** Tactique d'escouade appliquée aux combats. */
  tactic: TacticId;
  /** Meilleur nombre d'étoiles (1 à 3) obtenu sur chaque niveau de campagne. */
  campaignStars: Record<number, number>;
  /** Coffres d'étoiles déjà ouverts. */
  starChests: number;
  /** Objectifs dont la récompense a été réclamée. */
  claimedGoals: string[];
  /** Jauge de butin : une arme tombe chaque fois qu'elle se remplit (voir LOOT_METER_MAX). */
  lootMeter: number;
  /** Tour sans fin : dernier étage franchi. */
  towerFloor: number;
}

export interface SurvivalRun {
  squad: string[];
  /** Dernière vague remportée. */
  wave: number;
  /** Or accumulé, versé en encaissant. */
  pot: number;
  /** PV restants de chaque soldat encore engagé (et des mercenaires). */
  hp: Record<string, number>;
  /** Bonus d'expédition déjà choisis (voir SURVIVAL_BOONS). */
  boons: string[];
  /** Bonus proposés après la dernière vague, à choisir avant la suivante. */
  choices: string[] | null;
  /** Mercenaires recrutés pendant l'expédition. */
  mercs: Mercenary[];
}

export interface Mercenary {
  id: string;
  name: string;
  weaponId: string;
  level: number;
}

export type WeaponShape =
  | 'fists'
  | 'knife'
  | 'sword'
  | 'katana'
  | 'axe'
  | 'pistol'
  | 'smg'
  | 'rifle'
  | 'shotgun'
  | 'sniper'
  | 'bazooka'
  | 'launcher'
  | 'flame'
  | 'minigun'
  | 'railgun'
  | 'shield'
  | 'crossbow'
  | 'revolver'
  | 'spear'
  | 'medic'
  | 'tesla'
  | 'mortar';

export interface WeaponDef {
  id: string;
  name: string;
  rarity: Rarity;
  damage: number;
  range: number;
  cooldown: number;
  aoe: number;
  /** Armure apportée par l'arme en plus des stats du soldat (boucliers). */
  armor?: number;
  /** Bonus propres à l'arme, ajoutés à ceux du soldat. */
  lifesteal?: number;
  dodge?: number;
  crit?: number;
  speedPct?: number;
  /** Arme de soin : soigne l'allié le plus blessé au lieu de tirer, tant qu'il y en a un. */
  heal?: boolean;
  /** Effets uniques des armes mythiques. */
  chain?: number;
  pierce?: boolean;
  execute?: number;
  thorns?: number;
  shape: WeaponShape;
  color: string;
  droppable: boolean;
}

export interface Mods {
  hpPct: number;
  dmgPct: number;
  speedPct: number;
  armor: number;
  crit: number;
  lifesteal: number;
  regenPct: number;
  dodge: number;
  rangePct: number;
  cdPct: number;
  aoe: number;
  xpPct: number;
  berserk: boolean;
  secondWind: boolean;
}

export type UpgradeKind = 'attack' | 'defense' | 'mobility' | 'support';

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  kind: UpgradeKind;
  /** Nombre de fois où l'amélioration peut être prise : ses effets s'additionnent (1 par défaut). */
  maxRank?: number;
  mods: Partial<Mods>;
}

export interface CombatStats {
  maxHp: number;
  damage: number;
  range: number;
  cooldown: number;
  speed: number;
  armor: number;
  crit: number;
  dodge: number;
  lifesteal: number;
  regen: number;
  aoe: number;
  ranged: boolean;
  berserk: boolean;
  secondWind: boolean;
  heal: boolean;
  /** Vise l'ennemi le plus affaibli à portée plutôt que le plus proche (tactique « Chasse aux blessés »). */
  focusWeak?: boolean;
  /** Le coup rebondit sur ce nombre d'ennemis proches (60 % des dégâts). */
  chain?: number;
  /** Le tir traverse et touche tous les ennemis alignés. */
  pierce?: boolean;
  /** Achève les cibles passées sous cette part de leurs PV. */
  execute?: number;
  /** Renvoie cette part des dégâts subis à l'attaquant. */
  thorns?: number;
}

export interface SpriteLook {
  skin: string;
  hair: string;
  uniform: string;
  helmet: string;
  weaponId: string;
}
