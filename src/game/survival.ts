import type { BattleUnit } from './battle';
import { MAX_LEVEL, TRAINING_PER_SOLDIER, WEAPONS } from './data';
import { survivalWaveLevel } from './enemies';
import { soldierLook } from './look';
import { freshName } from './roster';
import { pick, shuffle, type Rng } from './rng';
import { computeStats } from './stats';
import { resolveWeapon } from './weapons';
import type { CombatStats, GameState, Mercenary, Soldier, SurvivalRun } from './types';

// Survie façon roguelite : après chaque vague, l'escouade choisit un bonus parmi trois pour le reste de l'expédition.

export interface SurvivalBoon {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Bonus permanent pour l'expédition, appliqué aux stats de chaque allié (soldats et mercenaires). */
  apply?: (s: CombatStats) => void;
  /** Effet immédiat, non conservé (soin, recrue). */
  instant?: boolean;
}

export const BOON_CHOICES = 3;
export const MAX_MERCS = 2;
/** Part d'or supplémentaire au pot par « Contrat juteux ». */
export const GREED_BONUS = 0.35;

export const SURVIVAL_BOONS: SurvivalBoon[] = [
  { id: 'fury', name: 'Furie', icon: '😡', desc: '+15 % dégâts', apply: (s) => { s.damage *= 1.15; } },
  { id: 'sandbags', name: 'Sacs de sable', icon: '🧱', desc: '+8 armure', apply: (s) => { s.armor += 8; } },
  { id: 'adrenaline', name: 'Adrénaline', icon: '⚡', desc: '+15 % vitesse, −8 % de recharge', apply: (s) => { s.speed *= 1.15; s.cooldown = Math.max(0.12, s.cooldown * 0.92); } },
  { id: 'blood', name: 'Rations de sang', icon: '🩸', desc: '+6 % de vol de vie', apply: (s) => { if (!s.heal) s.lifesteal += 0.06; } },
  { id: 'nurse', name: 'Infirmier de campagne', icon: '➕', desc: 'Régénère 1 % des PV par seconde', apply: (s) => { s.regen += 0.01; } },
  { id: 'focus', name: 'Œil du tireur', icon: '🎯', desc: '+10 % de coups critiques', apply: (s) => { s.crit = Math.min(0.75, s.crit + 0.1); } },
  { id: 'blast', name: 'Caisse de grenades', icon: '💥', desc: '+12 de rayon de zone', apply: (s) => { if (!s.heal) s.aoe += 12; } },
  { id: 'tough', name: 'Rations doubles', icon: '🍖', desc: '+12 % PV', apply: (s) => { s.maxHp *= 1.12; } },
  { id: 'greed', name: 'Contrat juteux', icon: '💰', desc: `+${Math.round(GREED_BONUS * 100)} % d’or au pot à chaque vague` },
  { id: 'medkit', name: 'Ravitaillement', icon: '🚑', desc: 'Soigne entièrement l’expédition', instant: true },
  { id: 'merc', name: 'Mercenaire', icon: '🤠', desc: 'Un mercenaire rejoint l’expédition (sans XP, il part à sa fin)', instant: true },
];

export const BOONS_BY_ID: Record<string, SurvivalBoon> = Object.fromEntries(SURVIVAL_BOONS.map((b) => [b.id, b]));

export function newRun(squad: string[]): SurvivalRun {
  return { squad, wave: 0, pot: 0, hp: {}, boons: [], choices: null, mercs: [] };
}

/** Trois bonus au hasard ; le mercenaire n'est proposé que s'il reste de la place. */
export function rollBoons(run: SurvivalRun, rng: Rng): string[] {
  const pool = SURVIVAL_BOONS.filter((b) => b.id !== 'merc' || run.mercs.length < MAX_MERCS).map((b) => b.id);
  return shuffle(rng, pool).slice(0, BOON_CHOICES);
}

export function boonCount(run: SurvivalRun, id: string): number {
  return run.boons.filter((b) => b === id).length;
}

export type PickBoonResult = { ok: true; boon: SurvivalBoon; merc?: Mercenary } | { ok: false; error: string };

export function pickBoon(st: GameState, id: string, rng: Rng = Math.random): PickBoonResult {
  const run = st.survival;
  if (!run?.choices) return { ok: false, error: 'Aucun bonus à choisir.' };
  if (!run.choices.includes(id)) return { ok: false, error: 'Ce bonus n’est pas proposé.' };
  const boon = BOONS_BY_ID[id];
  run.choices = null;
  if (id === 'medkit') {
    run.hp = {};
    return { ok: true, boon };
  }
  if (id === 'merc') {
    const merc: Mercenary = {
      id: `m${st.nextId++}`,
      name: freshName(st, rng),
      weaponId: pick(rng, WEAPONS.filter((w) => w.droppable && (w.rarity === 'rare' || w.rarity === 'epic') && !w.heal)).id,
      // au niveau qu'aurait un soldat de la puissance de la prochaine vague
      level: Math.min(MAX_LEVEL, Math.max(1, Math.round(0.72 * survivalWaveLevel(run.wave + 1, st.campaignLevel)))),
    };
    run.mercs.push(merc);
    return { ok: true, boon, merc };
  }
  run.boons.push(id);
  return { ok: true, boon };
}

/** Un mercenaire se bat comme un soldat Rare de son niveau, sans amélioration. */
export function mercUnit(m: Mercenary, hp?: number): BattleUnit {
  const soldier: Soldier = {
    id: m.id,
    name: m.name,
    rarity: 'rare',
    appearance: { skin: m.id.length % 5, hair: m.name.length % 6, uniform: 7, helmet: 5 },
    hpRoll: 1,
    powerRoll: 1,
    speedRoll: 1,
    level: m.level,
    xp: 0,
    upgrades: [],
    upgradeChoices: null,
    picksLeft: 0,
    titles: [],
    weaponUid: null,
    trainingsLeft: TRAINING_PER_SOLDIER,
    kills: 0,
    favorite: false,
    legions: 0,
    position: 'free',
    trait: 'stoic',
  };
  const weapon = resolveWeapon({ defId: m.weaponId });
  return { id: m.id, team: 'ally', name: `${m.name} (mercenaire)`, look: soldierLook(soldier, weapon), scale: 1, stats: computeStats(soldier, weapon), hp, tank: weapon.shape === 'shield' };
}

/** Applique les bonus d'expédition aux alliés. Modifie leurs stats. */
export function applyBoons(allies: BattleUnit[], run: SurvivalRun): BattleUnit[] {
  for (const id of run.boons) {
    const apply = BOONS_BY_ID[id]?.apply;
    if (apply) for (const u of allies) apply(u.stats);
  }
  return allies;
}
