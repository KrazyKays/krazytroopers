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
  totalPulls: number;
  soldiers: Soldier[];
  weapons: WeaponItem[];
  campaignLevel: number;
  freePulls: number;
  nextId: number;
  stats: { won: number; lost: number; deaths: number };
  battleSpeed: BattleSpeed;
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
  | 'railgun';

export interface WeaponDef {
  id: string;
  name: string;
  rarity: Rarity;
  damage: number;
  range: number;
  cooldown: number;
  aoe: number;
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
}

export interface SpriteLook {
  skin: string;
  hair: string;
  uniform: string;
  helmet: string;
  weaponId: string;
}
