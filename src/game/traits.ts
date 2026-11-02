import type { Mods, TraitId } from './types';

/**
 * Trait de personnalité : un bonus compensé par un défaut (la puissance moyenne reste celle d'un soldat sans trait,
 * pour ne pas fausser l'équilibrage), et des répliques lancées en combat.
 */
export interface TraitDef {
  id: TraitId;
  name: string;
  icon: string;
  desc: string;
  mods: Partial<Mods>;
  /** Répliques selon la situation. */
  lines: { start: string[]; kill: string[]; hurt: string[]; ally: string[] };
}

export const TRAITS: TraitDef[] = [
  {
    id: 'hothead',
    name: 'Tête brûlée',
    icon: '🔥',
    desc: '+10 % dégâts, +10 % vitesse, −12 % PV',
    mods: { dmgPct: 0.1, speedPct: 0.1, hpPct: -0.12 },
    lines: { start: ['À l’attaque !', 'Qui m’aime me suive !', 'Je fonce, on verra après !'], kill: ['Au suivant !', 'Trop facile !', 'Encore !'], hurt: ['Même pas mal !', 'Ça chatouille !'], ally: ['Vengeance !', 'Ils vont payer !'] },
  },
  {
    id: 'coward',
    name: 'Trouillard',
    icon: '😱',
    desc: '+8 % esquive, −10 % dégâts',
    mods: { dodge: 0.08, dmgPct: -0.1 },
    lines: { start: ['On est obligés d’y aller ?', 'J’ai oublié mon goûter…', 'Après vous, je vous en prie.'], kill: ['Je l’ai eu ? Je l’ai eu !', 'Pardon, pardon !'], hurt: ['Maman !', 'Au secours !', 'Je veux rentrer !'], ally: ['On va tous mourir !', 'Pas lui !'] },
  },
  {
    id: 'glutton',
    name: 'Gourmand',
    icon: '🍗',
    desc: '+12 % PV, −15 % vitesse, −5 % dégâts',
    mods: { hpPct: 0.12, speedPct: -0.15, dmgPct: -0.05 },
    lines: { start: ['On mange quand ?', 'J’ai pris des sandwichs.', 'Ça creuse, la guerre.'], kill: ['Ça ouvre l’appétit !', 'Miam.'], hurt: ['Pas le ventre !', 'Mon casse-croûte !'], ally: ['Il me devait un croissant !'] },
  },
  {
    id: 'lucky',
    name: 'Veinard',
    icon: '🍀',
    desc: '+6 % de coups critiques, −6 % PV',
    mods: { crit: 0.06, hpPct: -0.06 },
    lines: { start: ['Aujourd’hui, c’est mon jour !', 'Croisons les doigts.'], kill: ['Coup de chance !', 'Pile dans le mille !'], hurt: ['Raté… enfin presque.', 'Bon, pas cette fois.'], ally: ['La chance tourne…'] },
  },
  {
    id: 'stoic',
    name: 'Stoïque',
    icon: '🗿',
    desc: '+6 armure, −6 % dégâts',
    mods: { armor: 6, dmgPct: -0.06 },
    lines: { start: ['…', 'Allons-y.', 'Je tiendrai.'], kill: ['Un de moins.', 'Suivant.'], hurt: ['Hmpf.', 'Rien de grave.'], ally: ['Il ne sera pas oublié.'] },
  },
  {
    id: 'nerd',
    name: 'Intello',
    icon: '🤓',
    desc: '+15 % d’XP gagnée, −5 % PV',
    mods: { xpPct: 0.15, hpPct: -0.05 },
    lines: { start: ['Selon mes calculs, on gagne.', 'Probabilité de succès : élevée.'], kill: ['Trajectoire parfaite.', 'CQFD.'], hurt: ['Ce n’était pas prévu !', 'Erreur d’arrondi !'], ally: ['Les statistiques étaient contre lui.'] },
  },
  {
    id: 'myopic',
    name: 'Myope',
    icon: '👓',
    desc: '+10 % dégâts, −12 % portée',
    mods: { rangePct: -0.12, dmgPct: 0.1 },
    lines: { start: ['C’est qui, eux ?', 'Ils sont où, les méchants ?'], kill: ['J’ai touché quelque chose !', 'C’était un ennemi, j’espère ?'], hurt: ['Qui m’a tapé ?', 'Mes lunettes !'], ally: ['Il est où, Bob ?'] },
  },
  {
    id: 'tough',
    name: 'Increvable',
    icon: '💪',
    desc: 'Régénère 0,5 % des PV par seconde, −8 % dégâts',
    mods: { regenPct: 0.005, dmgPct: -0.08 },
    lines: { start: ['On va leur montrer !', 'Ça va être long pour eux.'], kill: ['Il fallait pas me chercher.', 'Au tapis !'], hurt: ['C’est tout ?', 'J’en ai vu d’autres !'], ally: ['Relève-toi, soldat !'] },
  },
  {
    id: 'speedy',
    name: 'Fusée',
    icon: '💨',
    desc: '+18 % vitesse de déplacement, −8 % PV',
    mods: { speedPct: 0.18, hpPct: -0.08 },
    lines: { start: ['Le dernier arrivé a perdu !', 'Zoum !'], kill: ['Trop lent !', 'Même pas vu venir !'], hurt: ['J’ai trébuché !', 'Aïe, un caillou !'], ally: ['J’arrive !'] },
  },
  {
    id: 'joker',
    name: 'Farceur',
    icon: '🤡',
    desc: '+5 % esquive, −5 % PV',
    mods: { dodge: 0.05, hpPct: -0.05 },
    lines: { start: ['Vous connaissez celle du bazooka ?', 'Souriez, on est filmés !'], kill: ['Elle était bonne, celle-là !', 'Tadaaa !'], hurt: ['Pas drôle !', 'Ça, c’était pas prévu au spectacle.'], ally: ['Il ne rira plus…'] },
  },
];

export const TRAITS_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t])) as Record<TraitId, TraitDef>;

/** Répliques des ennemis, pour leur donner un peu de répondant. */
export const ENEMY_LINES = { boss: ['Vous ne passerez pas !', 'À l’assaut, bande de mollusques !', 'Je vais vous écraser !', 'Personne ne sort d’ici vivant !'], kill: ['Ha ! Un de moins !', 'Trop faibles !'] };

/** Trait déterministe d'un soldat, tiré de son identifiant et de son nom (anciennes sauvegardes, nouvelles recrues). */
export function traitFor(id: string, name: string): TraitId {
  let hash = 2166136261;
  for (const c of `${id}:${name}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return TRAITS[(hash >>> 0) % TRAITS.length].id;
}
