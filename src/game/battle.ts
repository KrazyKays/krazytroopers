import { mulberry32, shuffle } from './rng';
import type { CombatStats, SpriteLook, Team } from './types';

export const ARENA_W = 800;
export const ARENA_H = 400;
export const DT = 0.1;
export const MAX_TICKS = 1200;
const SEPARATION = 12;

export interface BattleUnit {
  id: string;
  team: Team;
  name: string;
  look: SpriteLook;
  scale: number;
  soldierId?: string;
  stats: CombatStats;
  /** Cible factice (mode simulation) : invincible, et ses dégâts augmentent de `growth` par seconde de combat. */
  dummy?: { growth: number };
  /** Affixe d'un ennemi d'élite (affiché en combat et dans l'aperçu). */
  elite?: string;
  /** PV au début du combat (survie : les blessures des vagues précédentes) ; PV max par défaut. */
  hp?: number;
}

export type BattleEvent =
  | { t: 'hit'; a: number; b: number; dmg: number; crit: boolean; ranged: boolean; splash: boolean }
  | { t: 'heal'; a: number; b: number; amount: number }
  | { t: 'miss'; a: number; b: number; ranged: boolean }
  | { t: 'blast'; a: number; b: number; r: number }
  | { t: 'die'; i: number }
  | { t: 'save'; i: number };

export interface Frame {
  /** x, y, hp pour chaque unité, à plat. */
  p: number[];
  e: BattleEvent[];
}

export interface UnitTotals {
  dealt: number;
  taken: number;
  healed: number;
}

export interface BattleResult {
  winner: Team | 'timeout';
  frames: Frame[];
  ticks: number;
  deadIds: string[];
  kills: Record<string, number>;
  totals: Record<string, UnitTotals>;
  /** PV restants de chaque allié à la fin du combat. */
  hpLeft: Record<string, number>;
}

function formation(n: number, team: Team): { x: number; y: number }[] {
  const perCol = Math.min(8, Math.max(n, 1));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const inCol = Math.min(perCol, n - col * perCol);
    const y = ARENA_H / 2 + (row - (inCol - 1) / 2) * Math.min(48, (ARENA_H - 70) / Math.max(inCol - 1, 1));
    const dx = col * 38 + (row % 2) * 12;
    out.push({ x: team === 'ally' ? 70 + dx : ARENA_W - 70 - dx, y });
  }
  return out;
}

export function simulate(units: BattleUnit[], seed: number): BattleResult {
  const rng = mulberry32(seed);
  const n = units.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const hp = new Float64Array(n);
  const cd = new Float64Array(n);
  const secondWindUsed = new Array<boolean>(n).fill(false);
  const killCount = new Array<number>(n).fill(0);
  const totalDealt = new Float64Array(n);
  const totalTaken = new Float64Array(n);
  const totalHealed = new Float64Array(n);

  for (const team of ['ally', 'enemy'] as Team[]) {
    const idx = units.map((u, i) => (u.team === team ? i : -1)).filter((i) => i >= 0);
    const pos = formation(idx.length, team);
    idx.forEach((i, k) => {
      x[i] = pos[k].x;
      y[i] = pos[k].y;
    });
  }
  for (let i = 0; i < n; i++) {
    hp[i] = Math.min(units[i].stats.maxHp, units[i].hp ?? units[i].stats.maxHp);
    cd[i] = rng() * units[i].stats.cooldown;
  }

  const r1 = (v: number) => Math.round(v * 10) / 10;
  const snapshot = (e: BattleEvent[]): Frame => {
    const p: number[] = [];
    for (let i = 0; i < n; i++) p.push(r1(x[i]), r1(y[i]), r1(Math.max(0, hp[i])));
    return { p, e };
  };

  const frames: Frame[] = [snapshot([])];
  const order = Array.from({ length: n }, (_, i) => i);
  let winner: BattleResult['winner'] = 'timeout';
  let ticks = 0;

  const alive = (i: number) => hp[i] > 0;
  const nearestEnemy = (i: number): number => {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (units[j].team === units[i].team || !alive(j)) continue;
      const d = (x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  };
  // Ennemi à portée le plus entamé (en proportion de ses PV) ; à défaut, le plus proche
  const weakestInRange = (i: number): number => {
    const range2 = units[i].stats.range ** 2;
    let best = -1;
    let bestRatio = Infinity;
    for (let j = 0; j < n; j++) {
      if (units[j].team === units[i].team || !alive(j)) continue;
      if ((x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2 > range2) continue;
      const ratio = hp[j] / units[j].stats.maxHp;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = j;
      }
    }
    return best >= 0 ? best : nearestEnemy(i);
  };
  // Allié vivant le plus blessé (en proportion de ses PV), soigneur compris ; -1 si tout le monde est en forme
  const mostInjuredAlly = (i: number): number => {
    let best = -1;
    let bestRatio = 0.9;
    for (let j = 0; j < n; j++) {
      if (units[j].team !== units[i].team || !alive(j)) continue;
      const ratio = hp[j] / units[j].stats.maxHp;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = j;
      }
    }
    return best;
  };

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    ticks = tick;
    const events: BattleEvent[] = [];
    shuffle(rng, order);

    const heal = (target: number, amount: number): void => {
      const before = hp[target];
      hp[target] = Math.min(units[target].stats.maxHp, before + amount);
      totalHealed[target] += hp[target] - before;
    };

    const hurt = (target: number, dmg: number, source: number): number => {
      const T = units[target].stats;
      const real = (dmg * 100) / (100 + T.armor);
      if (units[target].dummy) {
        totalDealt[source] += real;
        totalTaken[target] += real;
        return real;
      }
      hp[target] -= real;
      totalDealt[source] += real;
      totalTaken[target] += real;
      if (hp[target] <= 0) {
        if (T.secondWind && !secondWindUsed[target]) {
          secondWindUsed[target] = true;
          hp[target] = T.maxHp * 0.25;
          events.push({ t: 'save', i: target });
        } else {
          killCount[source]++;
          events.push({ t: 'die', i: target });
        }
      }
      return real;
    };

    for (const i of order) {
      if (!alive(i)) continue;
      const S = units[i].stats;
      if (S.regen > 0) heal(i, S.regen * S.maxHp * DT);
      cd[i] -= DT;
      const patient = S.heal ? mostInjuredAlly(i) : -1;
      if (patient >= 0) {
        const dx = x[patient] - x[i];
        const dy = y[patient] - y[i];
        const d = Math.hypot(dx, dy);
        if (d <= S.range) {
          if (cd[i] > 0) continue;
          cd[i] = Math.max(cd[i], -DT) + S.cooldown;
          const amount = S.damage * (0.9 + rng() * 0.2) * (rng() < S.crit ? 2 : 1);
          const before = hp[patient];
          heal(patient, amount);
          events.push({ t: 'heal', a: i, b: patient, amount: Math.round(hp[patient] - before) });
        } else {
          const step = Math.min(S.speed * DT, d - S.range * 0.9);
          x[i] += (dx / d) * step;
          y[i] += (dy / d) * step;
        }
        continue;
      }
      const t = S.focusWeak ? weakestInRange(i) : nearestEnemy(i);
      if (t < 0) continue;
      const dx = x[t] - x[i];
      const dy = y[t] - y[i];
      const d = Math.hypot(dx, dy);
      if (d <= S.range) {
        if (cd[i] > 0) continue;
        cd[i] = Math.max(cd[i], -DT) + S.cooldown;
        const T = units[t].stats;
        if (rng() < T.dodge) {
          events.push({ t: 'miss', a: i, b: t, ranged: S.ranged });
          continue;
        }
        const dummy = units[i].dummy;
        let dmg = (S.damage + (dummy ? dummy.growth * tick * DT : 0)) * (0.9 + rng() * 0.2);
        if (S.berserk && hp[i] < S.maxHp * 0.5) dmg *= 1.4;
        const crit = rng() < S.crit;
        if (crit) dmg *= 2;
        const dealt = hurt(t, dmg, i);
        events.push({ t: 'hit', a: i, b: t, dmg: Math.round(dealt), crit, ranged: S.ranged, splash: false });
        if (S.lifesteal > 0) heal(i, dealt * S.lifesteal);
        if (S.aoe > 0) {
          events.push({ t: 'blast', a: i, b: t, r: S.aoe });
          for (let j = 0; j < n; j++) {
            if (j === t || units[j].team === units[i].team || !alive(j)) continue;
            if (Math.hypot(x[j] - x[t], y[j] - y[t]) <= S.aoe) {
              const splash = hurt(j, dmg * 0.6, i);
              events.push({ t: 'hit', a: i, b: j, dmg: Math.round(splash), crit: false, ranged: false, splash: true });
            }
          }
        }
      } else {
        const step = Math.min(S.speed * DT, d - S.range * 0.9);
        x[i] += (dx / d) * step;
        y[i] += (dy / d) * step;
      }
    }

    for (let i = 0; i < n; i++) {
      if (!alive(i)) continue;
      for (let j = i + 1; j < n; j++) {
        if (!alive(j)) continue;
        let dx = x[j] - x[i];
        let dy = y[j] - y[i];
        let d = Math.hypot(dx, dy);
        if (d >= SEPARATION) continue;
        if (d < 0.01) {
          const a = rng() * Math.PI * 2;
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        }
        const push = (SEPARATION - d) / 2;
        x[i] -= (dx / d) * push;
        y[i] -= (dy / d) * push;
        x[j] += (dx / d) * push;
        y[j] += (dy / d) * push;
      }
    }
    for (let i = 0; i < n; i++) {
      x[i] = Math.min(ARENA_W - 10, Math.max(10, x[i]));
      y[i] = Math.min(ARENA_H - 10, Math.max(30, y[i]));
    }

    frames.push(snapshot(events));

    let allies = 0;
    let enemies = 0;
    for (let i = 0; i < n; i++) {
      if (!alive(i)) continue;
      if (units[i].team === 'ally') allies++;
      else enemies++;
    }
    if (allies === 0 || enemies === 0) {
      winner = allies === 0 ? 'enemy' : 'ally';
      break;
    }
  }

  const deadIds: string[] = [];
  const kills: Record<string, number> = {};
  const totals: Record<string, UnitTotals> = {};
  const hpLeft: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const u = units[i];
    totals[u.id] = { dealt: totalDealt[i], taken: totalTaken[i], healed: totalHealed[i] };
    if (u.team !== 'ally') continue;
    if (!alive(i)) deadIds.push(u.id);
    kills[u.id] = killCount[i];
    hpLeft[u.id] = Math.max(0, hp[i]);
  }
  return { winner, frames, ticks, deadIds, kills, totals, hpLeft };
}
