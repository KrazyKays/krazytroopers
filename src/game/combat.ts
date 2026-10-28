import { DT, simulate, type BattleResult, type BattleUnit } from './battle';
import { SQUAD_MAX } from './data';
import { buildCampaignEnemies, buildSimulationEnemies, buildTrainingEnemies, isBossLevel, type SimulationConfig } from './enemies';
import { soldierLook } from './look';
import { grantLevelPicks, rollWeaponDrop } from './roster';
import { aggregateMods, addXp, computeStats, weaponForSoldier } from './stats';
import { nextUid } from './state';
import { mulberry32, randomSeed, type Rng } from './rng';
import type { GameState, Soldier, WeaponDef } from './types';

export type BattleRequest =
  | { mode: 'training'; squad: string[] }
  | { mode: 'campaign'; squad: string[]; level: number };

export interface SoldierReport {
  id: string;
  name: string;
  xpGained: number;
  levelsGained: number;
  newLevel: number;
  died: boolean;
  kills: number;
  dealt: number;
  taken: number;
  healed: number;
}

export interface BattleReport {
  mode: 'training' | 'campaign';
  level: number | null;
  won: boolean;
  timeout: boolean;
  firstClear: boolean;
  gold: number;
  weapon: WeaponDef | null;
  soldiers: SoldierReport[];
}

export type BattleLaunch =
  | { ok: true; units: BattleUnit[]; result: BattleResult; report: BattleReport }
  | { ok: false; error: string };

export function trainingXp(avgLevel: number): number {
  return Math.round(40 + 10 * avgLevel);
}

export function campaignXp(level: number): number {
  return 30 + 10 * level;
}

export function campaignGold(level: number, firstClear: boolean): number {
  return firstClear ? 40 + 15 * level : 15 + 5 * level;
}

export const TRAINING_GOLD = 12;

function allyUnits(st: GameState, squad: Soldier[]): BattleUnit[] {
  return squad.map((s) => {
    const weapon = weaponForSoldier(s, st.weapons);
    return { id: s.id, team: 'ally', name: s.name, look: soldierLook(s, weapon), scale: 1, soldierId: s.id, stats: computeStats(s, weapon) };
  });
}

export type SimulationLaunch = { ok: true; units: BattleUnit[]; result: BattleResult } | { ok: false; error: string };

export const DEFAULT_SIMULATION: SimulationConfig = { opponent: 'scarecrow', count: 1, level: 1, boss: false };

function simulationSquad(st: GameState, squadIds: string[]): Soldier[] | string {
  if (squadIds.length < 1 || squadIds.length > SQUAD_MAX) return `Choisissez entre 1 et ${SQUAD_MAX} soldats.`;
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
  const squad = simulationSquad(st, squadIds);
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
  /** Nombre moyen de soldats tombés par combat. */
  avgDeaths: number;
}

export type EstimateLaunch = ({ ok: true } & SimulationEstimate) | { ok: false; error: string };

/** Joue `runs` simulations à graines différentes pour estimer les chances de l'escouade. */
export function estimateSimulation(st: GameState, squadIds: string[], cfg: SimulationConfig, runs = ESTIMATE_RUNS, seed: number = randomSeed()): EstimateLaunch {
  const squad = simulationSquad(st, squadIds);
  if (typeof squad === 'string') return { ok: false, error: squad };
  return { ok: true, ...estimateRuns(allyUnits(st, squad), (rng) => buildSimulationEnemies(cfg, rng), runs, seed) };
}

/**
 * Estime les chances d'un vrai combat (entraînement ou campagne) avant de le lancer,
 * face aux mêmes ennemis que `launchBattle`, sans rien modifier.
 */
export function estimateBattle(st: GameState, req: BattleRequest, runs = ESTIMATE_RUNS, seed: number = randomSeed()): EstimateLaunch {
  const squad = simulationSquad(st, req.squad);
  if (typeof squad === 'string') return { ok: false, error: squad };
  const avgLevel = squad.reduce((sum, s) => sum + s.level, 0) / squad.length;
  const enemies = req.mode === 'campaign' ? () => buildCampaignEnemies(req.level) : (rng: Rng) => buildTrainingEnemies(Math.round(avgLevel), squad.length, rng);
  return { ok: true, ...estimateRuns(allyUnits(st, squad), enemies, runs, seed) };
}

function estimateRuns(allies: BattleUnit[], enemies: (rng: Rng) => BattleUnit[], runs: number, seed: number): SimulationEstimate {
  const out: SimulationEstimate = { runs, wins: 0, losses: 0, timeouts: 0, avgDuration: 0, avgDeaths: 0 };
  for (let r = 0; r < runs; r++) {
    const s = (seed + r * 0x6d2b79f5) >>> 0;
    const result = simulate([...allies, ...enemies(mulberry32(s ^ 0x9e3779b9))], s);
    if (result.winner === 'ally') out.wins++;
    else if (result.winner === 'enemy') out.losses++;
    else out.timeouts++;
    out.avgDuration += (result.ticks * DT) / runs;
    out.avgDeaths += result.deadIds.length / runs;
  }
  return out;
}

export function launchBattle(st: GameState, req: BattleRequest, seed: number = randomSeed()): BattleLaunch {
  if (req.squad.length < 1 || req.squad.length > SQUAD_MAX) return { ok: false, error: `Choisissez entre 1 et ${SQUAD_MAX} soldats.` };
  const squad: Soldier[] = [];
  for (const id of req.squad) {
    const s = st.soldiers.find((x) => x.id === id);
    if (!s) return { ok: false, error: 'Soldat introuvable.' };
    if (req.mode === 'training' && s.trainingsLeft <= 0) return { ok: false, error: `${s.name} n'a plus d'entraînement disponible.` };
    if (squad.includes(s)) return { ok: false, error: 'Soldat en double.' };
    squad.push(s);
  }

  const isCampaign = req.mode === 'campaign';
  const level = isCampaign ? req.level : null;
  if (isCampaign && (req.level < 1 || req.level > st.campaignLevel + 1)) return { ok: false, error: "Ce niveau n'est pas débloqué." };

  const allies = allyUnits(st, squad);
  const avgLevel = squad.reduce((sum, s) => sum + s.level, 0) / squad.length;
  const enemies = isCampaign ? buildCampaignEnemies(req.level) : buildTrainingEnemies(Math.round(avgLevel), squad.length, mulberry32(seed ^ 0x9e3779b9));
  const units = [...allies, ...enemies];
  const result = simulate(units, seed);
  const won = result.winner === 'ally';

  const firstClear = isCampaign && won && req.level === st.campaignLevel + 1;
  const baseXp = isCampaign ? campaignXp(req.level) * (firstClear ? 1 : 0.5) : trainingXp(avgLevel);
  const xp = won ? baseXp : baseXp * (isCampaign ? 0.4 : 0.5);

  const soldiers: SoldierReport[] = squad.map((s) => {
    const died = result.deadIds.includes(s.id);
    const gained = died ? 0 : Math.round(xp * (1 + aggregateMods(s.upgrades).xpPct));
    const levelsGained = addXp(s, gained);
    grantLevelPicks(s);
    const kills = result.kills[s.id] ?? 0;
    const { dealt, taken, healed } = result.totals[s.id];
    s.kills += kills;
    st.stats.kills += kills;
    if (!isCampaign) s.trainingsLeft--;
    if (died) st.stats.deaths++;
    return { id: s.id, name: s.name, xpGained: gained, levelsGained, newLevel: s.level, died, kills, dealt, taken, healed };
  });
  st.soldiers = st.soldiers.filter((s) => !result.deadIds.includes(s.id));

  let gold = 0;
  let weapon: WeaponDef | null = null;
  if (won) {
    st.stats.won++;
    if (isCampaign) {
      gold = campaignGold(req.level, firstClear);
      if (firstClear) st.campaignLevel = req.level;
      if (firstClear || Math.random() < 0.25) {
        weapon = rollWeaponDrop(req.level, isBossLevel(req.level));
        st.weapons.push({ uid: nextUid(st, 'w'), defId: weapon.id });
      }
    } else {
      gold = TRAINING_GOLD;
    }
    st.gold += gold;
  } else {
    st.stats.lost++;
  }

  return {
    ok: true,
    units,
    result,
    report: { mode: req.mode, level, won, timeout: result.winner === 'timeout', firstClear, gold, weapon, soldiers },
  };
}
