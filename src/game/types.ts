export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Team = 'ally' | 'enemy';
export type TitleId = 'legende' | 'legion';

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
}

export interface WeaponItem {
  uid: string;
  defId: string;
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
}

export interface SurvivalRun {
  squad: string[];
  /** Dernière vague remportée. */
  wave: number;
  /** Or accumulé, versé en encaissant. */
  pot: number;
  /** PV restants de chaque soldat encore engagé. */
  hp: Record<string, number>;
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

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
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
}

export interface SpriteLook {
  skin: string;
  hair: string;
  uniform: string;
  helmet: string;
  weaponId: string;
}
