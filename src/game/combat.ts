import { DT, simulate, type BattleResult, type BattleUnit } from './battle';
import { BOSS_FREE_PULLS, LOOT_FIRST_CLEAR, LOOT_METER_MAX, LOOT_REPLAY, MAX_LEVEL, STAR_CHEST_EVERY, SURVIVAL_REST_HEAL, type UnlockDef } from './data';
import { grantLevelPicks } from './upgrades';
import { activeTactic, applySquadBonuses, synergyStatus } from './squad';
import {
  buildCampaignEnemies,
  buildDailyEnemies,
  buildSimulationEnemies,
  buildSurvivalEnemies,
  buildTrainingEnemies,
  dailyKey,
  dailyLevel,
  dailyModifier,
  isBossLevel,
  survivalWaveLevel,
  type DailyModifier,
  type SimulationConfig,
} from './enemies';
import { soldierLook } from './look';
import { isUnlocked, squadMax, unlockLevel, unlocksBetween } from './progress';
import { rollWeaponDrop, trainingCost } from './roster';
import { aggregateMods, addXp, computeStats, weaponForSoldier } from './stats';
import { nextUid } from './state';
import { mulberry32, randomSeed, type Rng } from './rng';
import type { GameState, Soldier, WeaponDef } from './types';

export type BattleMode = 'training' | 'campaign' | 'daily' | 'survival';

export type BattleRequest =
  | { mode: 'training'; squad: string[] }
  | { mode: 'campaign'; squad: string[]; level: number }
  /** `date` : clé AAAA-MM-JJ du défi, aujourd'hui par défaut. */
  | { mode: 'daily'; squad: string[]; date?: string }
  /** L'escouade n'est lue qu'au départ de l'expédition ; ensuite, ce sont les soldats encore engagés. */
  | { mode: 'survival'; squad: string[] };

export interface SoldierReport {
  id: string;
  name: string;
  xpGained: number;
  levelsGained: number;
  newLevel: number;
  died: boolean;
  /** Tombé au combat mais rapatrié (victoire, ou entraînement) : il survit, sans XP. */
  wounded: boolean;
  kills: number;
  dealt: number;
  taken: number;
  healed: number;
}

export interface SurvivalReport {
  wave: number;
  /** Or en jeu après cette vague (ou versé, si l'expédition s'arrête). */
  pot: number;
  /** L'expédition est terminée (escouade vaincue) : la moitié du pot a été versée. */
  ended: boolean;
}

export interface BattleReport {
  mode: BattleMode;
  level: number | null;
  won: boolean;
  timeout: boolean;
  firstClear: boolean;
  gold: number;
  weapon: WeaponDef | null;
  soldiers: SoldierReport[];
  /** Tirages de soldat gratuits gagnés (boss, défi du jour). */
  freePulls: number;
  /** Fonctionnalités débloquées par ce combat. */
  unlocked: UnlockDef[];
  daily?: { modifier: DailyModifier; streak: number };
  survival?: SurvivalReport;
  /** Or payé au lancement pour les soldats sans entraînement gratuit. */
  trainingFee?: number;
  /** Campagne gagnée : étoiles obtenues, nouvelles étoiles (au-delà du record) et coffres ouverts. */
  stars?: { got: number; best: number; gained: number; gold: number; chests: number };
  /** Campagne gagnée : remplissage de la jauge de butin (une arme tombe quand elle est pleine). */
  loot?: { gained: number; meter: number };
}

export type BattleLaunch =
  | { ok: true; units: BattleUnit[]; result: BattleResult; report: BattleReport }
  | { ok: false; error: string };

export function trainingXp(avgLevel: number): number {
  return Math.round(40 + 10 * avgLevel);
}

export function trainingGold(avgLevel: number): number {
  return Math.round(10 + 4 * avgLevel);
}

/** Un soldat sans entraînement gratuit peut encore s'entraîner en payant, sauf au niveau maximum. */
export function canTrain(s: Soldier): boolean {
  return s.trainingsLeft > 0 || s.level < MAX_LEVEL;
}

/**
 * Or à payer pour lancer un entraînement : chaque soldat sans entraînement gratuit paie le sien,
 * au tarif de son niveau actuel. Payé au lancement, il ne peut pas être stocké pour plus tard.
 */
export function trainingFee(squad: readonly Soldier[]): number {
  return squad.reduce((sum, s) => sum + (s.trainingsLeft > 0 ? 0 : trainingCost(s)), 0);
}

export function campaignXp(level: number): number {
  return 30 + 10 * level;
}

export function campaignGold(level: number, firstClear: boolean): number {
  return firstClear ? 40 + 15 * level : 12 + 4 * level;
}

/** Récompense du défi du jour ; la série de jours consécutifs ajoute un bonus, plafonné à une semaine. */
export function dailyGold(level: number, streak: number): number {
  return 60 + 12 * level + 20 * Math.min(Math.max(streak - 1, 0), 6);
}

/** Or ajouté au pot de survie par chaque vague remportée. */
export function survivalWaveGold(waveLevel: number): number {
  return 10 + 6 * waveLevel;
}

/** Stats de combat de chaque soldat, tactique et synergies de l'escouade comprises. */
export function squadStats(st: GameState, squad: readonly Soldier[]): Map<string, ReturnType<typeof computeStats>> {
  const weapons = squad.map((s) => weaponForSoldier(s, st.weapons));
  const synergies = synergyStatus(weapons);
  const tactic = activeTactic(st);
  return new Map(squad.map((s, i) => [s.id, applySquadBonuses(computeStats(s, weapons[i]), weapons[i], tactic, synergies)]));
}

function allyUnits(st: GameState, squad: Soldier[], hp?: Record<string, number>): BattleUnit[] {
  const stats = squadStats(st, squad);
  return squad.map((s) => {
    const weapon = weaponForSoldier(s, st.weapons);
    return { id: s.id, team: 'ally', name: s.name, look: soldierLook(s, weapon), scale: 1, soldierId: s.id, stats: stats.get(s.id)!, hp: hp?.[s.id] };
  });
}

/** Étoiles d'une victoire de campagne : 3 sans perte, 2 si au plus la moitié de l'escouade est tombée, 1 sinon. */
export function campaignStarsFor(fallen: number, squadSize: number): number {
  return fallen === 0 ? 3 : fallen <= squadSize / 2 ? 2 : 1;
}

/** Or offert par chaque nouvelle étoile d'un niveau. */
export function starGold(level: number): number {
  return 5 + 2 * level;
}

export function totalStars(st: GameState): number {
  return Object.values(st.campaignStars).reduce((a, b) => a + b, 0);
}

export type SimulationLaunch = { ok: true; units: BattleUnit[]; result: BattleResult } | { ok: false; error: string };

export const DEFAULT_SIMULATION: SimulationConfig = { opponent: 'scarecrow', count: 1, level: 1, boss: false };

function resolveSquad(st: GameState, squadIds: string[]): Soldier[] | string {
  const max = squadMax(st);
  if (squadIds.length < 1 || squadIds.length > max) return `Choisissez entre 1 et ${max} soldats.`;
  const squad: Soldier[] = [];
  for (const id of squadIds) {
    const s = st.soldiers.find((x) => x.id === id);
    if (!s) return 'Soldat introuvable.';
    if (squad.includes(s)) return 'Soldat en double.';
    squad.push(s);
  }
  return squad;
}

/**
 * Simulation sans conséquence : ne modifie ni l'état, ni l'XP, ni l'or, ni les soldats,
 * ni les entraînements restants.
 */
export function launchSimulation(st: GameState, squadIds: string[], cfg: SimulationConfig = DEFAULT_SIMULATION, seed: number = randomSeed()): SimulationLaunch {
  const squad = resolveSquad(st, squadIds);
  if (typeof squad === 'string') return { ok: false, error: squad };
  const units = [...allyUnits(st, squad), ...buildSimulationEnemies(cfg, mulberry32(seed ^ 0x9e3779b9))];
  return { ok: true, units, result: simulate(units, seed) };
}

export const ESTIMATE_RUNS = 50;

export interface SimulationEstimate {
  runs: number;
  wins: number;
  losses: number;
  timeouts: number;
  /** Durée moyenne d'un combat, en secondes. */
  avgDuration: number;
  /** Nombre moyen de soldats perdus par combat (définitivement, hors simulation). */
  avgDeaths: number;
}

export type EstimateLaunch = ({ ok: true } & SimulationEstimate) | { ok: false; error: string };

/** Joue `runs` simulations à graines différentes pour estimer les chances de l'escouade. */
export function estimateSimulation(st: GameState, squadIds: string[], cfg: SimulationConfig, runs = ESTIMATE_RUNS, seed: number = randomSeed()): EstimateLaunch {
  const squad = resolveSquad(st, squadIds);
  if (typeof squad === 'string') return { ok: false, error: squad };
  return { ok: true, ...estimateRuns(allyUnits(st, squad), (rng) => buildSimulationEnemies(cfg, rng), runs, seed, 'always') };
}

/** Escouade et ennemis d'un vrai combat, communs au lancement et à l'estimation. */
interface Setup {
  squad: Soldier[];
  allies: BattleUnit[];
  enemies: (rng: Rng) => BattleUnit[];
  level: number | null;
}

function setupBattle(st: GameState, req: BattleRequest): Setup | string {
  if (req.mode === 'survival') {
    const run = st.survival;
    if (!run && !isUnlocked(st, 'survival')) return `Le mode Survie se débloque au niveau ${unlockLevel('survival')} de la campagne.`;
    const squad = resolveSquad(st, run ? run.squad.filter((id) => st.soldiers.some((s) => s.id === id)) : req.squad);
    if (typeof squad === 'string') return run ? "Plus aucun soldat engagé dans l'expédition." : squad;
    const wave = (run?.wave ?? 0) + 1;
    return { squad, allies: allyUnits(st, squad, run?.hp), enemies: (rng) => buildSurvivalEnemies(wave, st.campaignLevel, rng), level: survivalWaveLevel(wave, st.campaignLevel) };
  }
  const squad = resolveSquad(st, req.squad);
  if (typeof squad === 'string') return squad;
  const allies = allyUnits(st, squad);
  if (req.mode === 'training') {
    const maxed = squad.find((s) => !canTrain(s));
    if (maxed) return `${maxed.name} est au niveau maximum et n'a plus d'entraînement gratuit.`;
    const avgLevel = Math.round(squad.reduce((sum, s) => sum + s.level, 0) / squad.length);
    return { squad, allies, enemies: (rng) => buildTrainingEnemies(avgLevel, squad.length, rng), level: null };
  }
  if (req.mode === 'daily') {
    if (!isUnlocked(st, 'daily')) return `Le défi du jour se débloque au niveau ${unlockLevel('daily')} de la campagne.`;
    const key = req.date ?? dailyKey();
    const level = dailyLevel(st.campaignLevel);
    return { squad, allies, enemies: () => buildDailyEnemies(key, level), level };
  }
  if (req.level < 1 || req.level > st.campaignLevel + 1) return "Ce niveau n'est pas débloqué.";
  return { squad, allies, enemies: () => buildCampaignEnemies(req.level), level: req.level };
}

/**
 * Estime les chances d'un vrai combat avant de le lancer, face aux mêmes ennemis que `launchBattle`,
 * sans rien modifier.
 */
export function estimateBattle(st: GameState, req: BattleRequest, runs = ESTIMATE_RUNS, seed: number = randomSeed()): EstimateLaunch {
  const setup = setupBattle(st, req);
  if (typeof setup === 'string') return { ok: false, error: setup };
  return { ok: true, ...estimateRuns(setup.allies, setup.enemies, runs, seed, req.mode === 'training' ? 'never' : 'onLoss') };
}

/** Quand les soldats tombés meurent vraiment : toujours (simulation, pour mesurer), sur défaite, ou jamais (entraînement). */
type Lethality = 'always' | 'onLoss' | 'never';

function estimateRuns(allies: BattleUnit[], enemies: (rng: Rng) => BattleUnit[], runs: number, seed: number, lethal: Lethality): SimulationEstimate {
  const out: SimulationEstimate = { runs, wins: 0, losses: 0, timeouts: 0, avgDuration: 0, avgDeaths: 0 };
  for (let r = 0; r < runs; r++) {
    const s = (seed + r * 0x6d2b79f5) >>> 0;
    const result = simulate([...allies, ...enemies(mulberry32(s ^ 0x9e3779b9))], s);
    if (result.winner === 'ally') out.wins++;
    else if (result.winner === 'enemy') out.losses++;
    else out.timeouts++;
    out.avgDuration += (result.ticks * DT) / runs;
    if (lethal === 'always' || (lethal === 'onLoss' && result.winner !== 'ally')) out.avgDeaths += result.deadIds.length / runs;
  }
  return out;
}

/** Hier, au format de `dailyKey`. */
function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dailyKey(new Date(y, m - 1, d - 1));
}

export function dailyDone(st: GameState, key: string = dailyKey()): boolean {
  return st.lastDaily === key;
}

export function launchBattle(st: GameState, req: BattleRequest, seed: number = randomSeed()): BattleLaunch {
  const dayKey = req.mode === 'daily' ? (req.date ?? dailyKey()) : '';
  if (req.mode === 'daily' && dailyDone(st, dayKey)) return { ok: false, error: 'Défi du jour déjà tenté : revenez demain !' };
  const setup = setupBattle(st, req);
  if (typeof setup === 'string') return { ok: false, error: setup };
  const { squad, allies, level } = setup;
  const fee = req.mode === 'training' ? trainingFee(squad) : 0;
  if (st.gold < fee) return { ok: false, error: `Pas assez d'or : cet entraînement coûte ${fee} or.` };
  st.gold -= fee;

  const enemies = setup.enemies(mulberry32(seed ^ 0x9e3779b9));
  const units = [...allies, ...enemies];
  const result = simulate(units, seed);
  const won = result.winner === 'ally';
  // Une victoire permet de rapatrier les blessés, et l'entraînement n'est jamais mortel : seule une défaite tue
  const lethal = req.mode !== 'training' && !won;

  const firstClear = req.mode === 'campaign' && won && req.level === st.campaignLevel + 1;
  const avgLevel = squad.reduce((sum, s) => sum + s.level, 0) / squad.length;
  const baseXp =
    req.mode === 'training' ? trainingXp(avgLevel)
    : req.mode === 'survival' ? campaignXp(level!) * 0.5
    : req.mode === 'daily' ? campaignXp(level!)
    : campaignXp(req.level) * (firstClear ? 1 : 0.5);
  const xp = won ? baseXp : baseXp * (req.mode === 'training' ? 0.5 : 0.4);

  const soldiers: SoldierReport[] = squad.map((s) => {
    const fell = result.deadIds.includes(s.id);
    const died = fell && lethal;
    const gained = fell ? 0 : Math.round(xp * (1 + aggregateMods(s.upgrades).xpPct));
    const levelsGained = addXp(s, gained);
    grantLevelPicks(s);
    const kills = result.kills[s.id] ?? 0;
    const { dealt, taken, healed } = result.totals[s.id];
    s.kills += kills;
    st.stats.kills += kills;
    if (req.mode === 'training' && s.trainingsLeft > 0) s.trainingsLeft--;
    if (died) st.stats.deaths++;
    return { id: s.id, name: s.name, xpGained: gained, levelsGained, newLevel: s.level, died, wounded: fell && !died, kills, dealt, taken, healed };
  });
  const dead = new Set(soldiers.filter((s) => s.died).map((s) => s.id));
  st.soldiers = st.soldiers.filter((s) => !dead.has(s.id));

  const report: BattleReport = { mode: req.mode, level, won, timeout: result.winner === 'timeout', firstClear, gold: 0, weapon: null, soldiers, freePulls: 0, unlocked: [] };
  const grantWeapon = (w: WeaponDef) => {
    report.weapon = w;
    st.weapons.push({ uid: nextUid(st, 'w'), defId: w.id });
  };

  if (won) st.stats.won++;
  else st.stats.lost++;

  if (req.mode === 'training') {
    if (fee > 0) report.trainingFee = fee;
    if (won) report.gold = trainingGold(avgLevel);
  } else if (req.mode === 'campaign') {
    if (won) {
      report.gold = campaignGold(req.level, firstClear);
      if (firstClear) {
        report.unlocked = unlocksBetween(st.campaignLevel, req.level);
        st.campaignLevel = req.level;
        if (isBossLevel(req.level)) report.freePulls = BOSS_FREE_PULLS;
      }
      // Butin régulier : la première victoire d'un boss garantit une arme améliorée ; sinon la jauge se remplit
      if (firstClear && isBossLevel(req.level)) grantWeapon(rollWeaponDrop(req.level, true));
      else {
        const gained = firstClear ? LOOT_FIRST_CLEAR : LOOT_REPLAY;
        st.lootMeter += gained;
        if (st.lootMeter >= LOOT_METER_MAX) {
          st.lootMeter -= LOOT_METER_MAX;
          grantWeapon(rollWeaponDrop(req.level, false));
        }
        report.loot = { gained, meter: st.lootMeter };
      }
      const got = campaignStarsFor(result.deadIds.length, squad.length);
      const prev = st.campaignStars[req.level] ?? 0;
      const gained = Math.max(0, got - prev);
      st.campaignStars[req.level] = Math.max(prev, got);
      const chests = Math.floor(totalStars(st) / STAR_CHEST_EVERY) - st.starChests;
      st.starChests += chests;
      report.stars = { got, best: st.campaignStars[req.level], gained, gold: gained * starGold(req.level), chests };
      report.gold += report.stars.gold;
      report.freePulls += chests;
    }
  } else if (req.mode === 'daily') {
    const streak = won ? (st.lastDaily === previousDay(dayKey) ? st.dailyStreak + 1 : 1) : 0;
    st.lastDaily = dayKey;
    st.dailyStreak = streak;
    report.daily = { modifier: dailyModifier(dayKey), streak };
    if (won) {
      report.gold = dailyGold(level!, streak);
      report.freePulls = 1;
      grantWeapon(rollWeaponDrop(level!, true));
    }
  } else {
    report.survival = survivalAfterWave(st, squad, allies, result, won, level!, grantWeapon);
    // le pot n'est versé qu'à la fin de l'expédition (encaissement, ou moitié en cas de défaite)
    if (report.survival.ended) report.gold = report.survival.pot;
  }
  st.gold += report.gold;
  st.freePulls += report.freePulls;

  return { ok: true, units, result, report };
}

function survivalAfterWave(st: GameState, squad: Soldier[], allies: BattleUnit[], result: BattleResult, won: boolean, waveLevel: number, grantWeapon: (w: WeaponDef) => void): SurvivalReport {
  const run = st.survival ?? { squad: squad.map((s) => s.id), wave: 0, pot: 0, hp: {} };
  if (!won) {
    st.survival = null;
    return { wave: run.wave, pot: Math.floor(run.pot / 2), ended: true };
  }
  run.wave++;
  run.pot += survivalWaveGold(waveLevel);
  st.bestWave = Math.max(st.bestWave, run.wave);
  if (isBossLevel(run.wave)) grantWeapon(rollWeaponDrop(waveLevel, true));
  // Les tombés sont rapatriés et quittent l'expédition ; les autres soufflent un peu avant la vague suivante
  const standing = squad.filter((s) => !result.deadIds.includes(s.id));
  run.squad = standing.map((s) => s.id);
  run.hp = Object.fromEntries(
    standing.map((s) => {
      const maxHp = allies.find((u) => u.id === s.id)!.stats.maxHp;
      return [s.id, Math.min(maxHp, result.hpLeft[s.id] + maxHp * SURVIVAL_REST_HEAL)];
    }),
  );
  st.survival = run;
  return { wave: run.wave, pot: run.pot, ended: false };
}

/** Met fin à l'expédition de survie et verse tout le pot. */
export function cashOutSurvival(st: GameState): number {
  const run = st.survival;
  if (!run) return 0;
  st.survival = null;
  st.gold += run.pot;
  return run.pot;
}
