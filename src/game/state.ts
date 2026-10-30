import { MAX_LEVEL, STAR_CHEST_EVERY, START_FREE_PULLS, START_GOLD, START_LOOT, START_WEAPONS, TRAINING_PER_SOLDIER } from './data';
import { grantLevelPicks } from './upgrades';
import type { GameState, Soldier } from './types';

const SAVE_KEY = 'krazy-troopers-save-v1';

export function createInitialState(): GameState {
  const st: GameState = {
    version: 1,
    gold: START_GOLD,
    pity: 0,
    weaponPity: 0,
    totalPulls: 0,
    soldiers: [],
    weapons: [],
    campaignLevel: 0,
    freePulls: START_FREE_PULLS,
    nextId: 1,
    stats: { won: 0, lost: 0, deaths: 0, kills: 0 },
    battleSpeed: 1,
    hideGuide: false,
    lastDaily: null,
    dailyStreak: 0,
    survival: null,
    bestWave: 0,
    tactic: 'balanced',
    campaignStars: {},
    starChests: 0,
    claimedGoals: [],
    lootMeter: START_LOOT,
  };
  for (const defId of START_WEAPONS) st.weapons.push({ uid: `w${st.nextId++}`, defId });
  return st;
}

function isValidState(x: unknown): x is GameState {
  const s = x as GameState;
  return (
    !!s &&
    s.version === 1 &&
    typeof s.gold === 'number' &&
    Array.isArray(s.soldiers) &&
    Array.isArray(s.weapons) &&
    typeof s.campaignLevel === 'number' &&
    typeof s.nextId === 'number'
  );
}

// Sauvegardes antérieures aux étoiles : chaque niveau terminé compte pour une étoile, sans coffre rétroactif.
function starsOf(data: GameState): Pick<GameState, 'campaignStars' | 'starChests'> {
  if (data.campaignStars && typeof data.campaignStars === 'object') return { campaignStars: data.campaignStars, starChests: data.starChests ?? 0 };
  const campaignStars: Record<number, number> = {};
  for (let l = 1; l <= data.campaignLevel; l++) campaignStars[l] = 1;
  return { campaignStars, starChests: Math.floor(data.campaignLevel / STAR_CHEST_EVERY) };
}

export function parseSave(raw: string): GameState | null {
  try {
    const data = JSON.parse(raw);
    return isValidState(data)
      ? {
          ...data,
          battleSpeed: data.battleSpeed ?? 1,
          hideGuide: !!data.hideGuide,
          freePulls: typeof data.freePulls === 'number' ? data.freePulls : 0,
          weaponPity: typeof data.weaponPity === 'number' ? data.weaponPity : 0,
          lastDaily: typeof data.lastDaily === 'string' ? data.lastDaily : null,
          dailyStreak: typeof data.dailyStreak === 'number' ? data.dailyStreak : 0,
          survival: data.survival ?? null,
          bestWave: typeof data.bestWave === 'number' ? data.bestWave : 0,
          tactic: data.tactic ?? 'balanced',
          ...starsOf(data),
          claimedGoals: Array.isArray(data.claimedGoals) ? data.claimedGoals : [],
          lootMeter: typeof data.lootMeter === 'number' ? data.lootMeter : START_LOOT,
          // Sauvegardes antérieures au compteur global : on reprend les éliminations encore connues des soldats.
          stats: {
            ...data.stats,
            kills: data.stats?.kills ?? data.soldiers.reduce((n: number, s: Soldier) => n + (s.kills ?? 0), 0),
          },
          soldiers: data.soldiers.map((s: Soldier) => {
            const titles = s.titles ?? (s.level >= MAX_LEVEL ? ['legende'] : []);
            const soldier: Soldier = {
              ...s,
              favorite: !!s.favorite,
              titles,
              trainingsLeft: s.trainingsLeft ?? TRAINING_PER_SOLDIER,
              legions: s.legions ?? (titles.includes('legion') ? 1 : 0),
            };
            // les paliers d'amélioration ont changé : on recale les choix en attente, sans rien retirer
            grantLevelPicks(soldier);
            return soldier;
          }),
        }
      : null;
  } catch {
    return null;
  }
}

let state: GameState = createInitialState();
const listeners = new Set<() => void>();
// Incrémenté à chaque modification enregistrée : permet de savoir si une annulation est encore sûre
let version = 0;

export function getVersion(): number {
  return version;
}

export function getState(): GameState {
  return state;
}

export function loadState(): void {
  const raw = localStorage.getItem(SAVE_KEY);
  const loaded = raw ? parseSave(raw) : null;
  state = loaded ?? createInitialState();
}

export function replaceState(next: GameState): void {
  state = next;
  commit();
}

export function resetState(): void {
  state = createInitialState();
  commit();
}

export function serializeState(): string {
  return JSON.stringify(state);
}

function save(): void {
  try {
    localStorage.setItem(SAVE_KEY, serializeState());
  } catch {
    // stockage indisponible : on continue sans sauvegarde
  }
}

export function refresh(): void {
  for (const l of listeners) l();
}

export function commit(): void {
  version++;
  save();
  refresh();
}

export function mutate<T>(fn: (st: GameState) => T): T {
  const result = fn(state);
  commit();
  return result;
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function nextUid(st: GameState, prefix: string): string {
  return `${prefix}${st.nextId++}`;
}

