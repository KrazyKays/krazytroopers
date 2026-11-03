import { cashOutSurvival, chooseLoss, dailyDone, estimateBattle, launchBattle, launchFodder, type BattleReport, type BattleRequest } from './combat';
import { DT } from './battle';
import { FORGE_FEE, FORGE_INPUT, MAX_LEVEL, PULL_COST, RARITIES, RARITY_ORDER, WEAPON_PULL_COST, WEAPONS_BY_ID } from './data';
import { dailyKey, isBossLevel } from './enemies';
import { claimableGoals, claimGoal } from './goals';
import { isUnlocked, squadMax } from './progress';
import { mulberry32 } from './rng';
import { barracksCap, buyWeapons, equipWeapon, forgeableWeapons, forgeWeapons, recruit, releaseSoldier, sellWeapon, trainingCost } from './roster';
import { TACTICS } from './squad';
import { createInitialState } from './state';
import { computeStats, powerScore, weaponForSoldier } from './stats';
import { pickUpgrade, recommendedUpgrade } from './upgrades';
import { pickBoon } from './survival';
import type { GameState, Soldier, TacticId } from './types';

// Bot de playtest : joue une partie entière avec les vraies règles du jeu, pour mesurer le rythme et l'économie.
// Aucune règle n'est réécrite ici, le bot ne fait qu'appeler les mêmes fonctions que l'interface.

export interface Profile {
  id: string;
  label: string;
  /** Chances de victoire minimales pour tenter le prochain niveau de campagne. */
  risk: number;
  /** Suit les conseils d'amélioration, compose ses armes et ajuste tactique et positions. */
  smart: boolean;
  /** Revient chercher les étoiles manquantes. */
  stars: boolean;
  /** Paie des entraînements une fois les gratuits épuisés. */
  paidTraining: boolean;
  /** Utilise les modes annexes : défi du jour, survie, Chair à canon. */
  sideModes: boolean;
  /** Vitesse de combat habituelle (l'interface propose ×0,5 à ×4). */
  speed: number;
  /** Minutes jouées par jour : ne compte que pour le défi du jour. */
  minutesPerDay: number;
}

export const PROFILES: Profile[] = [
  { id: 'rusher', label: 'Fonceur', risk: 0.5, smart: true, stars: false, paidTraining: false, sideModes: false, speed: 4, minutesPerDay: 60 },
  { id: 'regular', label: 'Régulier', risk: 0.8, smart: true, stars: false, paidTraining: false, sideModes: true, speed: 2, minutesPerDay: 30 },
  { id: 'completionist', label: 'Complétiste', risk: 0.9, smart: true, stars: true, paidTraining: true, sideModes: true, speed: 2, minutesPerDay: 60 },
  { id: 'casual', label: 'Débutant', risk: 0.6, smart: false, stars: false, paidTraining: false, sideModes: false, speed: 1, minutesPerDay: 20 },
];

/** Temps passé hors combat, en secondes : préparer et lancer, puis lire le résultat. */
const FIGHT_OVERHEAD = 15;
const PICK_TIME = 8;
const PULL_TIME = 6;
const ESTIMATE_RUNS = 8;

export interface Milestone {
  level: number;
  hours: number;
  fights: number;
  losses: number;
  deaths: number;
  avgLevel: number;
  gold: number;
  soldiers: number;
  bestWeapon: string;
}

export interface GoldBook {
  campaign: number;
  stars: number;
  training: number;
  daily: number;
  survival: number;
  goals: number;
  sales: number;
  recruit: number;
  armory: number;
  forge: number;
  trainingFees: number;
}

export interface Playthrough {
  profile: string;
  seed: number;
  milestones: Milestone[];
  /** Combats joués pour passer de chaque niveau au suivant : révèle les murs de difficulté. */
  fightsPerLevel: Record<number, number>;
  hours: number;
  fights: number;
  wins: number;
  losses: number;
  deaths: number;
  campaignLevel: number;
  book: GoldBook;
  pulls: number;
  freePullsEarned: number;
  weaponsFound: Record<string, number>;
  /** Heures de jeu à la première occurrence de chaque jalon. */
  firsts: Record<string, number>;
  modeCount: Record<string, number>;
  /** Partie bloquée : plus aucun soldat ni de quoi en recruter. */
  stuck: boolean;
  days: number;
  stars: number;
  colossusRank: number;
  bestWave: number;
}

export interface PlayOptions {
  /** Niveau de campagne à atteindre. */
  target: number;
  maxHours: number;
  maxFights: number;
}

const rarityRank = (id: string): number => RARITY_ORDER.indexOf(WEAPONS_BY_ID[id].rarity);

function power(st: GameState, s: Soldier): number {
  return powerScore(computeStats(s, weaponForSoldier(s, st.weapons)));
}

/** Toutes les armes vont aux meilleurs soldats, l'une après l'autre : le bot rééquipe sans arrière-pensée. */
function equipBest(st: GameState, smart: boolean): void {
  const soldiers = [...st.soldiers].sort((a, b) => b.level - a.level || RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
  if (!smart) {
    // Le débutant ne compare que la rareté : la plus rare possible, la première venue
    const held = new Set(st.soldiers.map((s) => s.weaponUid));
    const free = st.weapons.filter((w) => !held.has(w.uid)).sort((a, b) => rarityRank(b.defId) - rarityRank(a.defId));
    for (const s of soldiers) {
      const mine = s.weaponUid ? st.weapons.find((w) => w.uid === s.weaponUid) : null;
      if (free.length > 0 && (!mine || rarityRank(free[0].defId) > rarityRank(mine.defId))) equipWeapon(st, s.id, free.shift()!.uid);
    }
    return;
  }
  for (const s of soldiers) s.weaponUid = null;
  const pool = [...st.weapons];
  for (const s of soldiers) {
    let best = -1;
    let bestScore = 0;
    pool.forEach((w, i) => {
      const score = powerScore(computeStats(s, WEAPONS_BY_ID[w.defId]));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    s.weaponUid = pool[best].uid;
    pool.splice(best, 1);
  }
}

function bestSquad(st: GameState, list: readonly Soldier[] = st.soldiers): string[] {
  return [...list].sort((a, b) => power(st, b) - power(st, a)).slice(0, squadMax(st)).map((s) => s.id);
}

function placeSquad(st: GameState, smart: boolean): void {
  if (!smart || !isUnlocked(st, 'positions')) return;
  for (const s of st.soldiers) {
    const w = weaponForSoldier(s, st.weapons);
    s.position = w.shape === 'shield' ? 'front' : w.range >= 260 || w.heal ? 'rear' : 'free';
  }
}

function winRate(st: GameState, req: BattleRequest, seed: number): number {
  const est = estimateBattle(st, req, ESTIMATE_RUNS, seed);
  return est.ok ? est.wins / est.runs : 0;
}

export function playThrough(profile: Profile, seed: number, opts: PlayOptions): Playthrough {
  const rng = mulberry32(seed);
  // Les tirages du jeu utilisent Math.random par défaut : on le fixe pour rendre la partie reproductible
  const realRandom = Math.random;
  Math.random = rng;
  try {
    return run(profile, seed, opts);
  } finally {
    Math.random = realRandom;
  }
}

function run(profile: Profile, seed: number, opts: PlayOptions): Playthrough {
  const st = createInitialState();
  const rand = Math.random;
  const book: GoldBook = { campaign: 0, stars: 0, training: 0, daily: 0, survival: 0, goals: 0, sales: 0, recruit: 0, armory: 0, forge: 0, trainingFees: 0 };
  const out: Playthrough = {
    profile: profile.id,
    seed,
    milestones: [],
    fightsPerLevel: {},
    hours: 0,
    fights: 0,
    wins: 0,
    losses: 0,
    deaths: 0,
    campaignLevel: 0,
    book,
    pulls: 0,
    freePullsEarned: 0,
    weaponsFound: { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 },
    firsts: {},
    modeCount: {},
    stuck: false,
    days: 0,
    stars: 0,
    colossusRank: 1,
    bestWave: 0,
  };
  let seconds = 0;
  let fightsSinceLevel = 0;
  let bestWeaponRank = -1;
  let lastTacticLevel = -1;
  let safeReplay = 1;
  const first = (key: string) => {
    if (out.firsts[key] === undefined) out.firsts[key] = seconds / 3600;
  };
  const dayKeyOf = (day: number): string => dailyKey(new Date(2030, 0, 1 + day));
  const today = (): number => Math.floor(seconds / (profile.minutesPerDay * 60));

  const note = (report: BattleReport, ticks: number) => {
    out.fights++;
    fightsSinceLevel++;
    seconds += (ticks * DT) / profile.speed + FIGHT_OVERHEAD;
    out.modeCount[report.mode] = (out.modeCount[report.mode] ?? 0) + 1;
    if (report.won) out.wins++;
    else out.losses++;
    out.deaths += report.soldiers.filter((s) => s.died).length;
    out.freePullsEarned += report.freePulls;
    if (report.weapon) out.weaponsFound[report.weapon.rarity]++;
    if (report.trainingFee) book.trainingFees += report.trainingFee;
    const starGold = report.stars?.gold ?? 0;
    if (report.mode === 'campaign') {
      book.campaign += report.gold - starGold;
      book.stars += starGold;
    } else if (report.mode === 'training') book.training += report.gold;
    else if (report.mode === 'daily') book.daily += report.gold;
    else if (report.mode === 'survival') book.survival += report.gold;
  };

  const manage = () => {
    for (const g of claimableGoals(st)) {
      const r = claimGoal(st, g.id);
      book.goals += r?.gold ?? 0;
      out.freePullsEarned += r?.freePulls ?? 0;
      seconds += 3;
    }
    const cap = () => barracksCap(st);
    while (st.freePulls > 0 && st.soldiers.length < cap()) {
      if (!recruit(st, 'free').ok) break;
      out.pulls++;
      seconds += PULL_TIME;
    }
    // Forge : les armes qui dorment au fond de l'arsenal montent d'une rareté
    if (isUnlocked(st, 'forge')) {
      equipBest(st, profile.smart);
      for (const r of ['common', 'rare', 'epic'] as const) {
        while (forgeableWeapons(st, r).length >= FORGE_INPUT && st.gold >= FORGE_FEE[r]) {
          const res = forgeWeapons(st, r, undefined, rand);
          if (!res.ok) break;
          book.forge += FORGE_FEE[r];
          seconds += PULL_TIME;
        }
      }
    }
    // Dépenses : d'abord compléter l'escouade, puis améliorer l'arsenal et la caserne, en gardant une petite réserve
    let spent = true;
    while (spent) {
      spent = false;
      const wanted = squadMax(st) + (profile.smart ? 2 : 1);
      const armed = st.soldiers.filter((s) => s.weaponUid).length;
      const needSoldier = st.soldiers.length < wanted && st.soldiers.length < cap();
      if (st.soldiers.length < squadMax(st) && st.gold >= PULL_COST && st.soldiers.length < cap()) {
        if (recruit(st, 'one').ok) {
          book.recruit += PULL_COST;
          out.pulls++;
          seconds += PULL_TIME;
          spent = true;
          continue;
        }
      }
      if (isUnlocked(st, 'armory') && st.weapons.length < squadMax(st) && st.gold >= WEAPON_PULL_COST && armed < st.soldiers.length) {
        if (buyWeapons(st, 'one', rand).ok) {
          book.armory += WEAPON_PULL_COST;
          seconds += PULL_TIME;
          spent = true;
          continue;
        }
      }
      const reserve = profile.smart ? 100 : 0;
      if (needSoldier && st.gold >= PULL_COST + reserve && recruit(st, 'one').ok) {
        book.recruit += PULL_COST;
        out.pulls++;
        seconds += PULL_TIME;
        spent = true;
        continue;
      }
      if (st.gold >= PULL_COST + reserve + 150 && st.soldiers.length < cap() && rand() < 0.3 && recruit(st, 'one').ok) {
        book.recruit += PULL_COST;
        out.pulls++;
        seconds += PULL_TIME;
        spent = true;
        continue;
      }
      if (isUnlocked(st, 'armory') && st.gold >= WEAPON_PULL_COST + reserve + 150 && buyWeapons(st, 'one', rand).ok) {
        book.armory += WEAPON_PULL_COST;
        seconds += PULL_TIME;
        spent = true;
      }
    }
    // Caserne pleine : le bot libère les recrues faibles pour continuer à tirer, comme le ferait un joueur
    if (st.soldiers.length >= cap() && st.gold >= PULL_COST) {
      const keep = new Set(bestSquad(st));
      const spare = st.soldiers.filter((s) => !keep.has(s.id) && !st.survival?.squad.includes(s.id) && RARITY_ORDER.indexOf(s.rarity) < 2).sort((a, b) => a.level - b.level)[0];
      if (spare) {
        const value = releaseSoldier(st, spare.id);
        book.sales += value;
      }
    }
    // Soldats et armes
    equipBest(st, profile.smart);
    for (const s of st.soldiers) {
      while (s.picksLeft > 0 && s.upgradeChoices?.length) {
        const id = profile.smart ? (recommendedUpgrade(st, s) ?? s.upgradeChoices[0]) : s.upgradeChoices[Math.floor(rand() * s.upgradeChoices.length)];
        if (!pickUpgrade(st, s.id, id, rand)) break;
        seconds += PICK_TIME;
      }
    }
    equipBest(st, profile.smart);
    placeSquad(st, profile.smart);
    // Revente du surplus quand l'or manque pour compléter l'escouade
    if (st.gold < PULL_COST && st.soldiers.length < squadMax(st)) {
      const used = new Set(st.soldiers.map((s) => s.weaponUid));
      for (const w of [...st.weapons].filter((x) => !used.has(x.uid)).sort((a, b) => rarityRank(a.defId) - rarityRank(b.defId))) {
        book.sales += sellWeapon(st, w.uid);
        if (st.gold >= PULL_COST) break;
      }
    }
    for (const w of st.weapons) {
      const r = rarityRank(w.defId);
      if (r > bestWeaponRank) bestWeaponRank = r;
      if (r >= 2) first('Arme épique');
      if (r >= 3) first('Arme légendaire');
    }
    for (const s of st.soldiers) {
      if (s.rarity === 'legendary') first('Soldat légendaire');
      if (s.level >= 10) first('Soldat niv. 10');
      if (s.level >= 20) first('Soldat niv. 20');
      if (s.level >= MAX_LEVEL) first('Soldat niv. 30');
    }
  };

  const pickTactic = () => {
    if (!profile.smart || !isUnlocked(st, 'tactics') || lastTacticLevel === st.campaignLevel) return;
    lastTacticLevel = st.campaignLevel;
    let best: TacticId = st.tactic;
    let bestRate = -1;
    const squad = bestSquad(st);
    for (const t of TACTICS) {
      st.tactic = t.id;
      const rate = winRate(st, { mode: 'campaign', squad, level: st.campaignLevel + 1 }, seed + st.campaignLevel);
      if (rate > bestRate) {
        bestRate = rate;
        best = t.id;
      }
    }
    st.tactic = best;
  };

  const milestone = () => {
    const best = RARITY_ORDER[bestWeaponRank] ?? 'common';
    out.milestones.push({
      level: st.campaignLevel,
      hours: seconds / 3600,
      fights: out.fights,
      losses: out.losses,
      deaths: out.deaths,
      avgLevel: st.soldiers.length ? bestSquad(st).reduce((n, id) => n + st.soldiers.find((s) => s.id === id)!.level, 0) / Math.min(st.soldiers.length, squadMax(st)) : 0,
      gold: st.gold,
      soldiers: st.soldiers.length,
      bestWeapon: RARITIES[best].label,
    });
  };

  const fight = (req: BattleRequest): BattleReport | null => {
    const r = launchBattle(st, req, Math.floor(rand() * 2 ** 32));
    if (!r.ok) return null;
    // Comme un joueur, le bot laisse derrière lui le moins précieux des soldats tombés
    if (st.pendingLoss) {
      const lost = st.soldiers.filter((s) => st.pendingLoss!.includes(s.id)).sort((a, b) => power(st, a) - power(st, b))[0];
      chooseLoss(st, lost.id, r.report);
    }
    note(r.report, r.result.ticks);
    return r.report;
  };

  while (st.campaignLevel < opts.target && seconds < opts.maxHours * 3600 && out.fights < opts.maxFights) {
    manage();
    if (st.soldiers.length === 0) {
      if (st.gold < PULL_COST && st.freePulls === 0 && !st.weapons.length) {
        out.stuck = true;
        break;
      }
      continue;
    }
    pickTactic();
    let squad = bestSquad(st);
    const next = st.campaignLevel + 1;
    const fightSeed = out.fights * 31 + seed;

    // Le rendez-vous du jour passe avant le reste, s'il n'est pas perdu d'avance
    if (profile.sideModes && isUnlocked(st, 'daily')) {
      const key = dayKeyOf(today());
      if (!dailyDone(st, key) && winRate(st, { mode: 'daily', squad, date: key }, fightSeed) >= 0.7) {
        fight({ mode: 'daily', squad, date: key });
        continue;
      }
    }

    // Tentative du prochain niveau
    if (winRate(st, { mode: 'campaign', squad, level: next }, fightSeed) >= profile.risk) {
      const before = st.campaignLevel;
      const report = fight({ mode: 'campaign', squad, level: next });
      if (report && st.campaignLevel > before) {
        out.fightsPerLevel[st.campaignLevel] = fightsSinceLevel;
        fightsSinceLevel = 0;
        milestone();
        if (isBossLevel(st.campaignLevel)) first(`Boss ${st.campaignLevel}`);
      }
      continue;
    }

    // Survie de temps en temps : on enchaîne tant que c'est sûr, puis on encaisse
    if (profile.sideModes && (isUnlocked(st, 'survival') || st.survival) && out.fights % 20 === 0) {
      let wave = 0;
      while (wave < 15) {
        if (st.survival?.choices) pickBoon(st, st.survival.choices[0], rand);
        const req: BattleRequest = { mode: 'survival', squad: st.survival?.squad ?? squad };
        if (winRate(st, req, fightSeed + wave) < 0.8) break;
        const report = fight(req);
        if (!report || report.survival?.ended) break;
        wave++;
      }
      if (st.survival) {
        const pot = cashOutSurvival(st);
        book.survival += pot;
      }
      if (wave > 0) continue;
      squad = bestSquad(st);
    }

    // Chair à canon : les soldats en trop partent contre le Colosse quand la caserne déborde
    if (profile.sideModes && isUnlocked(st, 'fodder') && st.soldiers.length >= barracksCap(st)) {
      const keep = new Set(squad);
      const spare = st.soldiers.filter((s) => !keep.has(s.id) && !st.survival?.squad.includes(s.id) && RARITY_ORDER.indexOf(s.rarity) < 2).sort((a, b) => a.level - b.level).slice(0, squadMax(st));
      if (spare.length >= 2) {
        const r = launchFodder(st, spare.map((s) => s.id), Math.floor(rand() * 2 ** 32));
        if (r.ok) {
          note(r.report, r.result.ticks);
          continue;
        }
      }
    }

    // Sinon, on farme : entraînements gratuits, étoiles manquantes, entraînement payant, puis dernier niveau rejoué
    const fresh = st.soldiers.filter((s) => s.trainingsLeft > 0);
    if (fresh.length > 0) {
      const ids = bestSquad(st, fresh);
      if (fight({ mode: 'training', squad: ids })) continue;
    }
    if (profile.stars) {
      let replay = 0;
      for (let l = st.campaignLevel; l >= Math.max(1, st.campaignLevel - 8); l--) {
        if ((st.campaignStars[l] ?? 0) < 3) {
          replay = l;
          break;
        }
      }
      if (replay > 0 && winRate(st, { mode: 'campaign', squad, level: replay }, fightSeed) >= 0.9) {
        fight({ mode: 'campaign', squad, level: replay });
        continue;
      }
    }
    if (profile.paidTraining) {
      const members = squad.map((id) => st.soldiers.find((s) => s.id === id)!);
      const fee = members.reduce((n, s) => n + (s.trainingsLeft > 0 ? 0 : trainingCost(s)), 0);
      if (st.gold >= fee + 200 && members.every((s) => s.level < MAX_LEVEL)) {
        fight({ mode: 'training', squad });
        continue;
      }
    }
    let replayed = false;
    const top = Math.min(st.campaignLevel, safeReplay + 1);
    for (let l = top; l >= 1; l -= Math.max(1, Math.floor(l / 4))) {
      if (winRate(st, { mode: 'campaign', squad, level: l }, fightSeed) >= 0.8) {
        safeReplay = l;
        fight({ mode: 'campaign', squad, level: l });
        replayed = true;
        break;
      }
    }
    if (!replayed) safeReplay = 1;
    if (!replayed) {
      // Rien de sûr : l'entraînement payant reste le dernier recours, sinon un combat risqué
      const members = squad.map((id) => st.soldiers.find((s) => s.id === id)!);
      const fee = members.reduce((n, s) => n + (s.trainingsLeft > 0 ? 0 : trainingCost(s)), 0);
      if (st.gold >= fee) fight({ mode: 'training', squad });
      else fight({ mode: 'campaign', squad, level: Math.max(1, st.campaignLevel) });
    }
  }
  out.hours = seconds / 3600;
  out.campaignLevel = st.campaignLevel;
  out.days = today();
  out.stars = Object.values(st.campaignStars).reduce((a, b) => a + b, 0);
  out.colossusRank = st.colossus.rank;
  out.bestWave = st.bestWave;
  return out;
}
