import { DT, simulate, type BattleResult, type BattleUnit } from './battle';
import { BOSS_FREE_PULLS, COLOSSUS_PULLS, DAILY_PULL_EVERY, LOOT_FIRST_CLEAR, PITY_LIMIT, RARITY_ORDER, LOOT_METER_MAX, LOOT_REPLAY, MAX_LEVEL, PULL_COST, RESCUE_PULLS, SAFE_LEVELS, STAR_CHEST_EVERY, SURVIVAL_REST_HEAL, type UnlockDef } from './data';
import { grantLevelPicks } from './upgrades';
import { activePosition, activeTactic, applySquadBonuses, synergyStatus } from './squad';
import {
  buildCampaignEnemies,
  buildColossus,
  buildDailyEnemies,
  buildSimulationEnemies,
  buildSurvivalEnemies,
  buildTrainingEnemies,
  colossusMaxHp,
  dailyKey,
  dailyLevel,
  dailyModifier,
  isBossLevel,
  isTowerBoss,
  applyTowerCurses,
  buildTowerEnemies,
  towerLevel,
  survivalWaveLevel,
  type DailyModifier,
  type SimulationConfig,
} from './enemies';
import { soldierLook } from './look';
import { isUnlocked, squadMax, unlockLevel, unlocksBetween } from './progress';
import { rollWeaponDrop, trainingCost, weaponOfRarity } from './roster';
import { soldierMods, addXp, computeStats, weaponForSoldier } from './stats';
import { applyBoons, GREED_BONUS, boonCount, mercUnit, newRun, rollBoons } from './survival';
import { newWeaponItem, resolveWeapon } from './weapons';
import { mulberry32, randomSeed, type Rng } from './rng';
import type { GameState, Soldier, WeaponDef } from './types';

export type BattleMode = 'training' | 'campaign' | 'daily' | 'survival' | 'fodder' | 'tower';

export type BattleRequest =
  | { mode: 'training'; squad: string[] }
  | { mode: 'campaign'; squad: string[]; level: number }
  /** `date` : clé AAAA-MM-JJ du défi, aujourd'hui par défaut. */
  | { mode: 'daily'; squad: string[]; date?: string }
  /** L'escouade n'est lue qu'au départ de l'expédition ; ensuite, ce sont les soldats encore engagés. */
  | { mode: 'survival'; squad: string[] }
  /** Tour sans fin : toujours l'étage suivant le dernier franchi. */
  | { mode: 'tower'; squad: string[] };

export interface SoldierReport {
  id: string;
  name: string;
  xpGained: number;
  levelsGained: number;
  newLevel: number;
  died: boolean;
  /** Tombé au combat mais rapatrié : il survit, avec son XP si l'escouade a gagné. */
  wounded: boolean;
  kills: number;
  dealt: number;
  taken: number;
  healed: number;
  healGiven: number;
}

export interface SurvivalReport {
  wave: number;
  /** Or en jeu après cette vague (ou versé, si l'expédition s'arrête). */
  pot: number;
  /** L'expédition est terminée : la moitié du pot a été versée (défaite), ou tout le pot (plus aucun soldat debout). */
  ended: boolean;
  /** Seule la moitié du pot a été versée (défaite). */
  halved: boolean;
  /** Bonus proposés pour la vague suivante. */
  choices: string[] | null;
}

export interface TowerReport {
  floor: number;
  /** Étage franchi pour la première fois. */
  firstClear: boolean;
  best: number;
}

export interface ColossusReport {
  rank: number;
  /** Dégâts infligés par ce sacrifice. */
  dealt: number;
  /** PV restants du Colosse, sur `maxHp`. */
  left: number;
  maxHp: number;
  killed: boolean;
  /** Crans gagnés sur la garantie de recrutement. */
  pity: number;
  /** Armes perdues avec les soldats sacrifiés. */
  weaponsLost: number;
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
  tower?: TowerReport;
  colossus?: ColossusReport;
  /** Or payé au lancement pour les soldats sans entraînement gratuit. */
  trainingFee?: number;
  /** Campagne gagnée : étoiles obtenues, nouvelles étoiles (au-delà du record) et coffres ouverts. */
  stars?: { got: number; best: number; gained: number; gold: number; chests: number };
  /** Campagne gagnée : remplissage de la jauge de butin (une arme tombe quand elle est pleine). */
  loot?: { gained: number; meter: number };
  /** Défaite avec plusieurs soldats tombés : le joueur doit encore désigner celui qui ne reviendra pas (voir chooseLoss). */
  lossChoice?: boolean;
}

/** Part de l'XP d'un niveau regagnée en le rejouant. */
export const REPLAY_XP = 0.4;

export type BattleLaunch =
  | { ok: true; units: BattleUnit[]; result: BattleResult; report: BattleReport }
  | { ok: false; error: string };

export function trainingXp(avgLevel: number): number {
  return Math.round(30 + 6 * avgLevel);
}

export function trainingGold(avgLevel: number): number {
  return Math.round(5 + 2 * avgLevel);
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
  return 25 + 7 * level;
}

export function campaignGold(level: number, firstClear: boolean): number {
  return firstClear ? 30 + 10 * level : Math.round(8 + level / 2);
}

/** Récompense du défi du jour ; la série de jours consécutifs ajoute un bonus, plafonné à une semaine. */
export function dailyGold(level: number, streak: number): number {
  return 40 + 8 * level + 15 * Math.min(Math.max(streak - 1, 0), 6);
}

/** Or d'un étage de la Tour franchi pour la première fois. */
export function towerGold(floor: number): number {
  return 40 + 10 * floor;
}

/** Tour : un tirage et une arme légendaire tous les 10 étages, une arme mythique tous les 20. */
export const TOWER_LEGENDARY_EVERY = 10;
export const TOWER_MYTHIC_EVERY = 20;

/** Or ajouté au pot de survie par chaque vague remportée. */
export function survivalWaveGold(waveLevel: number): number {
  return 6 + 2 * waveLevel;
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
    return { id: s.id, team: 'ally', name: s.name, look: soldierLook(s, weapon), scale: 1, soldierId: s.id, stats: stats.get(s.id)!, hp: hp?.[s.id], position: activePosition(st, s), tank: weapon.shape === 'shield', trait: s.trait };
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

export type OddsTier = 'danger' | 'risky' | 'doable' | 'easy';

export const ODDS_TIERS: Record<OddsTier, { label: string; hint: string; rank: number }> = {
  danger: { label: 'Danger', hint: 'Défaite probable', rank: 1 },
  risky: { label: 'Risqué', hint: 'Issue incertaine', rank: 2 },
  doable: { label: 'Faisable', hint: 'Bonnes chances, rien de garanti', rank: 3 },
  easy: { label: 'Aisé', hint: 'Large marge, mais une défaite reste possible', rank: 4 },
};

/**
 * Verdict volontairement prudent : on juge sur la borne basse de l'intervalle de Wilson à 95 %, pas sur le taux brut.
 * Sur 50 combats simulés, un combat gagné à 97 % affiche 50 victoires sur 50 une fois sur cinq : seul un sans-faute
 * mérite « Aisé », et même lui ne garantit rien, d'où l'absence de pourcentage à l'écran.
 */
export function oddsTier({ wins, runs }: Pick<SimulationEstimate, 'wins' | 'runs'>): OddsTier {
  const z = 1.96;
  const rate = wins / runs;
  const spread = z * Math.sqrt((rate * (1 - rate)) / runs + (z * z) / (4 * runs * runs));
  const floor = (rate + (z * z) / (2 * runs) - spread) / (1 + (z * z) / runs);
  return floor >= 0.9 ? 'easy' : floor >= 0.65 ? 'doable' : floor >= 0.35 ? 'risky' : 'danger';
}

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
    if (run?.choices) return "Choisissez d'abord un bonus d'expédition.";
    const wave = (run?.wave ?? 0) + 1;
    const allies = [...allyUnits(st, squad, run?.hp), ...(run?.mercs ?? []).map((m) => mercUnit(m, run!.hp[m.id]))];
    if (run) applyBoons(allies, run);
    return { squad, allies, enemies: (rng) => buildSurvivalEnemies(wave, st.campaignLevel, rng), level: survivalWaveLevel(wave, st.campaignLevel) };
  }
  if (req.mode === 'tower') {
    if (!isUnlocked(st, 'tower')) return `La Tour sans fin se débloque au niveau ${unlockLevel('tower')} de la campagne.`;
    const squad = resolveSquad(st, req.squad);
    if (typeof squad === 'string') return squad;
    const floor = st.towerFloor + 1;
    return { squad, allies: applyTowerCurses(allyUnits(st, squad), floor), enemies: () => buildTowerEnemies(floor), level: towerLevel(floor) };
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
  return { ok: true, ...estimateRuns(setup.allies, setup.enemies, runs, seed, canDie(st, req) ? 'onLoss' : 'never') };
}

/**
 * Soldats perdus lors d'une défaite : un seul, quelle que soit la taille de l'escouade. Une perte qui grandirait
 * avec l'escouade punirait le joueur d'engager les places qu'il vient de débloquer.
 */
export function deathsAmong(fallen: number): number {
  return Math.min(1, fallen);
}

/** Une défaite peut-elle coûter un soldat dans ce combat ? */
export function canDie(st: GameState, req: BattleRequest): boolean {
  // Rejouer un niveau conquis sert à se renforcer : ce rattrapage ne doit pas pouvoir creuser le retard
  if (req.mode === 'campaign') return req.level > SAFE_LEVELS && req.level > st.campaignLevel;
  // La Tour est un défi de puissance : on y retente sa chance sans perdre personne
  return req.mode !== 'training' && req.mode !== 'tower';
}

/** Désigne le soldat tombé qui ne reviendra pas ; les autres sont rapatriés. Renvoie faux si ce choix n'est pas possible. */
export function chooseLoss(st: GameState, soldierId: string, report?: BattleReport): boolean {
  if (!st.pendingLoss?.includes(soldierId)) return false;
  st.pendingLoss = null;
  st.soldiers = st.soldiers.filter((s) => s.id !== soldierId);
  st.stats.deaths++;
  if (report) {
    report.lossChoice = false;
    const lost = report.soldiers.find((s) => s.id === soldierId);
    if (lost) {
      lost.died = true;
      lost.wounded = false;
    }
  }
  return true;
}

/** Quand les soldats tombés meurent vraiment : toujours (simulation, pour mesurer), sur défaite, ou jamais (entraînement). */
type Lethality = 'always' | 'onLoss' | 'never';

function estimateRuns(allies: BattleUnit[], enemies: (rng: Rng) => BattleUnit[], runs: number, seed: number, lethal: Lethality): SimulationEstimate {
  const out: SimulationEstimate = { runs, wins: 0, losses: 0, timeouts: 0, avgDuration: 0, avgDeaths: 0 };
  const soldierIds = new Set(allies.filter((u) => u.soldierId).map((u) => u.id));
  for (let r = 0; r < runs; r++) {
    const s = (seed + r * 0x6d2b79f5) >>> 0;
    const result = simulate([...allies, ...enemies(mulberry32(s ^ 0x9e3779b9))], s);
    if (result.winner === 'ally') out.wins++;
    else if (result.winner === 'enemy') out.losses++;
    else out.timeouts++;
    out.avgDuration += (result.ticks * DT) / runs;
    if (lethal === 'always' || (lethal === 'onLoss' && result.winner !== 'ally')) out.avgDeaths += (lethal === 'always' ? result.deadIds.length : deathsAmong(result.deadIds.filter((id) => soldierIds.has(id)).length)) / runs;
  }
  return out;
}

const PENDING_LOSS_ERROR = 'Choisissez d’abord le soldat qui ne reviendra pas de la dernière défaite.';

/** Hier, au format de `dailyKey`. */
function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dailyKey(new Date(y, m - 1, d - 1));
}

export function dailyDone(st: GameState, key: string = dailyKey()): boolean {
  return st.lastDaily === key;
}

export function launchBattle(st: GameState, req: BattleRequest, seed: number = randomSeed()): BattleLaunch {
  if (st.pendingLoss) return { ok: false, error: PENDING_LOSS_ERROR };
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
  // Une victoire permet de rapatrier les blessés ; ni l'entraînement, ni les premiers niveaux, ni un niveau rejoué ne sont mortels
  const lethal = !won && canDie(st, req);

  const firstClear = req.mode === 'campaign' && won && req.level === st.campaignLevel + 1;
  const avgLevel = squad.reduce((sum, s) => sum + s.level, 0) / squad.length;
  const baseXp =
    req.mode === 'training' ? trainingXp(avgLevel)
    : req.mode === 'survival' ? campaignXp(level!) * 0.5
    : req.mode === 'daily' ? campaignXp(level!)
    : req.mode === 'tower' ? campaignXp(level!) * 0.5
    : campaignXp(req.level) * (firstClear ? 1 : REPLAY_XP);
  const xp = won ? baseXp : baseXp * (req.mode === 'training' ? 0.5 : 0.4);

  // Les mercenaires tombés ne comptent pas : seul un soldat du joueur peut être perdu. S'ils sont plusieurs, le joueur choisit.
  const fallenSoldiers = lethal ? squad.filter((s) => result.deadIds.includes(s.id)).map((s) => s.id) : [];
  const casualties = new Set(fallenSoldiers.length === 1 ? fallenSoldiers : []);
  const soldiers: SoldierReport[] = squad.map((s) => {
    const fell = result.deadIds.includes(s.id);
    const died = casualties.has(s.id);
    // Une victoire profite à toute l'escouade : un tank tombe parce qu'il protège les autres, et les étoiles sanctionnent déjà les pertes
    const gained = fell && !won ? 0 : Math.round(xp * (1 + soldierMods(s).xpPct));
    const levelsGained = addXp(s, gained);
    grantLevelPicks(s);
    const kills = result.kills[s.id] ?? 0;
    const { dealt, taken, healed, healGiven } = result.totals[s.id];
    s.kills += kills;
    st.stats.kills += kills;
    if (req.mode === 'training' && s.trainingsLeft > 0) s.trainingsLeft--;
    if (died) st.stats.deaths++;
    return { id: s.id, name: s.name, xpGained: gained, levelsGained, newLevel: s.level, died, wounded: fell && !died, kills, dealt, taken, healed, healGiven };
  });
  st.soldiers = st.soldiers.filter((s) => !casualties.has(s.id));

  const report: BattleReport = { mode: req.mode, level, won, timeout: result.winner === 'timeout', firstClear, gold: 0, weapon: null, soldiers, freePulls: 0, unlocked: [] };
  if (fallenSoldiers.length > 1) {
    st.pendingLoss = fallenSoldiers;
    report.lossChoice = true;
  }
  const grantWeapon = (w: WeaponDef) => {
    const item = newWeaponItem(st, w);
    st.weapons.push(item);
    report.weapon = resolveWeapon(item);
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
      report.freePulls = streak % DAILY_PULL_EVERY === 0 ? 1 : 0;
      grantWeapon(rollWeaponDrop(level!, true));
    }
  } else if (req.mode === 'tower') {
    const floor = st.towerFloor + 1;
    const first = won;
    if (won) {
      st.towerFloor = floor;
      report.gold = towerGold(floor);
      if (isTowerBoss(floor)) grantWeapon(floor % TOWER_MYTHIC_EVERY === 0 ? weaponOfRarity(Math.random, 'mythic') : floor % TOWER_LEGENDARY_EVERY === 0 ? weaponOfRarity(Math.random, 'legendary') : rollWeaponDrop(level!, true));
      if (floor % TOWER_LEGENDARY_EVERY === 0) report.freePulls = 1;
    }
    report.tower = { floor, firstClear: first, best: st.towerFloor };
  } else {
    report.survival = survivalAfterWave(st, squad, allies, result, won, level!, grantWeapon, mulberry32(seed ^ 0xb005));
    // le pot n'est versé qu'à la fin de l'expédition (encaissement, ou moitié en cas de défaite)
    if (report.survival.ended) report.gold = report.survival.pot;
  }
  st.gold += report.gold;
  st.freePulls += report.freePulls;
  grantRescue(st, report);

  return { ok: true, units, result, report };
}

/** Plus de soldats ni de quoi en recruter : l'état-major envoie des renforts plutôt que de bloquer la partie. */
function grantRescue(st: GameState, report: BattleReport): void {
  if (st.soldiers.length > 0 || st.freePulls > 0 || st.gold >= PULL_COST) return;
  st.freePulls = RESCUE_PULLS;
  report.freePulls += RESCUE_PULLS;
}

/** Crans de garantie de recrutement rapportés par un soldat sacrifié, selon sa rareté. */
export function sacrificePity(s: Soldier): number {
  return RARITY_ORDER.indexOf(s.rarity) + 1;
}

/** Un soldat ne peut être sacrifié ni s'il est favori, ni s'il est engagé dans une expédition de survie. */
export function canSacrifice(st: GameState, s: Soldier): boolean {
  return !s.favorite && !st.survival?.squad.includes(s.id);
}

/**
 * Chair à canon : tous les soldats engagés sont perdus avec leur arme, quoi qu'il arrive. Sans cela, une escouade solide
 * tuerait le Colosse sans risque, et ses récompenses deviendraient gratuites.
 */
export function launchFodder(st: GameState, squadIds: string[], seed: number = randomSeed()): BattleLaunch {
  if (st.pendingLoss) return { ok: false, error: PENDING_LOSS_ERROR };
  if (!isUnlocked(st, 'fodder')) return { ok: false, error: `Ce mode se débloque au niveau ${unlockLevel('fodder')} de la campagne.` };
  const squad = resolveSquad(st, squadIds);
  if (typeof squad === 'string') return { ok: false, error: squad };
  const kept = squad.find((s) => !canSacrifice(st, s));
  if (kept) return { ok: false, error: `${kept.name} ne peut pas être sacrifié (favori ou en expédition).` };

  const { rank, damage } = st.colossus;
  const maxHp = colossusMaxHp(rank);
  const hpBefore = maxHp - damage;
  const units = [...allyUnits(st, squad), buildColossus(rank, hpBefore)];
  const result = simulate(units, seed);
  const killed = result.winner === 'ally';
  const dealt = Math.min(hpBefore, result.totals.colossus.taken);

  const soldiers: SoldierReport[] = squad.map((s) => {
    const kills = result.kills[s.id] ?? 0;
    const { dealt: done, taken, healed, healGiven } = result.totals[s.id];
    s.kills += kills;
    st.stats.kills += kills;
    st.stats.deaths++;
    return { id: s.id, name: s.name, xpGained: 0, levelsGained: 0, newLevel: s.level, died: true, wounded: false, kills, dealt: done, taken, healed, healGiven };
  });
  st.soldiers = st.soldiers.filter((s) => !squad.includes(s));
  const lost = new Set(squad.map((s) => s.weaponUid));
  const weaponsBefore = st.weapons.length;
  st.weapons = st.weapons.filter((w) => !lost.has(w.uid));

  const pityBefore = st.pity;
  st.pity = Math.min(PITY_LIMIT - 1, st.pity + squad.reduce((n, s) => n + sacrificePity(s), 0));
  const report: BattleReport = { mode: 'fodder', level: null, won: killed, timeout: result.winner === 'timeout', firstClear: false, gold: 0, weapon: null, soldiers, freePulls: 0, unlocked: [] };
  if (killed) {
    st.stats.won++;
    st.colossus = { rank: rank + 1, damage: 0 };
    st.pity = PITY_LIMIT - 1;
    report.freePulls = COLOSSUS_PULLS;
    st.freePulls += COLOSSUS_PULLS;
  } else {
    st.colossus.damage = damage + dealt;
  }
  report.colossus = { rank, dealt, left: killed ? 0 : hpBefore - dealt, maxHp, killed, pity: st.pity - pityBefore, weaponsLost: weaponsBefore - st.weapons.length };
  grantRescue(st, report);
  return { ok: true, units, result, report };
}

function survivalAfterWave(st: GameState, squad: Soldier[], allies: BattleUnit[], result: BattleResult, won: boolean, waveLevel: number, grantWeapon: (w: WeaponDef) => void, rng: Rng): SurvivalReport {
  const run = st.survival ?? newRun(squad.map((s) => s.id));
  if (!won) {
    st.survival = null;
    return { wave: run.wave, pot: Math.floor(run.pot / 2), ended: true, halved: true, choices: null };
  }
  run.wave++;
  run.pot += Math.round(survivalWaveGold(waveLevel) * (1 + GREED_BONUS * boonCount(run, 'greed')));
  st.bestWave = Math.max(st.bestWave, run.wave);
  if (isBossLevel(run.wave)) grantWeapon(rollWeaponDrop(waveLevel, true));
  // Les tombés sont rapatriés et quittent l'expédition ; les autres soufflent un peu avant la vague suivante
  const standing = squad.filter((s) => !result.deadIds.includes(s.id));
  run.squad = standing.map((s) => s.id);
  run.mercs = run.mercs.filter((m) => !result.deadIds.includes(m.id));
  run.hp = Object.fromEntries(
    [...standing.map((s) => s.id), ...run.mercs.map((m) => m.id)].map((id) => {
      const maxHp = allies.find((u) => u.id === id)!.stats.maxHp;
      return [id, Math.min(maxHp, result.hpLeft[id] + maxHp * SURVIVAL_REST_HEAL)];
    }),
  );
  // Plus aucun soldat debout (seuls des mercenaires ont tenu) : l'expédition rentre avec tout le pot
  if (standing.length === 0) {
    st.survival = null;
    return { wave: run.wave, pot: run.pot, ended: true, halved: false, choices: null };
  }
  run.choices = rollBoons(run, rng);
  st.survival = run;
  return { wave: run.wave, pot: run.pot, ended: false, halved: false, choices: run.choices };
}

/** Met fin à l'expédition de survie et verse tout le pot. */
export function cashOutSurvival(st: GameState): number {
  const run = st.survival;
  if (!run) return 0;
  st.survival = null;
  st.gold += run.pot;
  return run.pot;
}
