import { START_GOLD, START_WEAPONS, TRAINING_PER_DAY } from './data';
import { dayKey, now } from './clock';
import type { GameState, Soldier } from './types';

const SAVE_KEY = 'krazy-troopers-save-v1';

export function createInitialState(): GameState {
  const st: GameState = {
    version: 1,
    gold: START_GOLD,
    pity: 0,
    totalPulls: 0,
    soldiers: [],
    weapons: [],
    campaignLevel: 0,
    dayKey: dayKey(),
    trainingLeft: TRAINING_PER_DAY,
    freePull: true,
    nextId: 1,
    stats: { won: 0, lost: 0, deaths: 0 },
  };
  for (const defId of START_WEAPONS) st.weapons.push({ uid: `w${st.nextId++}`, defId });
  return st;
}

export function isAvailable(s: Soldier, t: number = now()): boolean {
  return s.deadUntil === null || t >= s.deadUntil;
}

/** Nouveau jour : entraînements, tirage gratuit, et retour des soldats tombés. Renvoie true si l'état a changé. */
export function ensureDay(st: GameState, t: number = now()): boolean {
  let changed = false;
  const key = dayKey(t);
  if (st.dayKey !== key) {
    st.dayKey = key;
    st.trainingLeft = TRAINING_PER_DAY;
    st.freePull = true;
    changed = true;
  }
  for (const s of st.soldiers) {
    if (s.deadUntil !== null && t >= s.deadUntil) {
      s.deadUntil = null;
      changed = true;
    }
  }
  return changed;
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

export function parseSave(raw: string): GameState | null {
  try {
    const data = JSON.parse(raw);
    return isValidState(data) ? data : null;
  } catch {
    return null;
  }
}

let state: GameState = createInitialState();
const listeners = new Set<() => void>();

export function getState(): GameState {
  return state;
}

export function loadState(): void {
  const raw = localStorage.getItem(SAVE_KEY);
  const loaded = raw ? parseSave(raw) : null;
  state = loaded ?? createInitialState();
  ensureDay(state);
}

export function replaceState(next: GameState): void {
  state = next;
  ensureDay(state);
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

