import { mulberry32, shuffle } from './rng';
import type { CombatStats, PositionId, SpriteLook, Team, TraitId } from './types';

export const ARENA_W = 800;
export const ARENA_H = 400;
export const DT = 0.1;
export const MAX_TICKS = 1200;
const SEPARATION = 12;
/** Décalage de la formation de départ selon la position. */
const START_OFFSET: Record<PositionId, number> = { free: 0, front: 24, cover: -14, rear: -40 };
/** Distance gardée derrière la première ligne par un soldat à couvert. */
const COVER_GAP = 14;
/** Distance de la cible à laquelle un soldat en pointe s'arrête. */
const FRONT_CONTACT = 30;
/** À distance : s'arrête à cette part de sa portée, et recule sous REAR_RETREAT, moins vite qu'il n'avance. */
const REAR_HOLD = 0.98;
const REAR_RETREAT = 0.55;
const REAR_RETREAT_SPEED = 0.5;

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
  /** Dégâts ajoutés par seconde de combat, sans rendre l'unité invincible (Colosse). */
  growth?: number;
  /** Affixe d'un ennemi d'élite (affiché en combat et dans l'aperçu). */
  elite?: string;
  /** PV au début du combat (survie : les blessures des vagues précédentes) ; PV max par défaut. */
  hp?: number;
  /** Place dans la formation (« Libre » par défaut). */
  position?: PositionId;
  /** Porte un bouclier : tient la première ligne, sauf position contraire. */
  tank?: boolean;
  /** Trait de personnalité d'un soldat (répliques en combat). */
  trait?: TraitId;
  /** Boss : insensible aux exécutions. */
  boss?: boolean;
  /** Vole : la mêlée ne l'atteint qu'une fois tous les ennemis au sol abattus. */
  flying?: boolean;
  /** Invisible et impossible à cibler jusqu'à sa première attaque. */
  stealth?: boolean;
  /** Porte-étendard : ses alliés proches infligent plus de dégâts et encaissent mieux. */
  banner?: boolean;
  /** Pose une mine à intervalle régulier ; elle explose au passage d'un adversaire. */
  mines?: { every: number; dmg: number; r: number };
  /** Poids de la mécanique spéciale dans le budget de menace d'une armée. */
  threatMult?: number;
}

/** Rayon de l'aura d'un porte-étendard, et ses bonus. */
export const BANNER_RADIUS = 110;
export const BANNER_DMG = 1.2;
export const BANNER_ARMOR = 10;
/** Distance de déclenchement d'une mine, et nombre de mines actives par poseur. */
const MINE_TRIGGER = 16;
const MINE_MAX = 5;
/** Rebond d'une arme à chaîne : portée et part des dégâts. */
const CHAIN_RANGE = 100;
const CHAIN_SHARE = 0.6;
/** Largeur du couloir touché par un tir perforant. */
const PIERCE_WIDTH = 18;
/** Dégâts d'un attaquant de mêlée contre une cible volante. */
const FLYING_MELEE = 0.5;

export type BattleEvent =
  | { t: 'hit'; a: number; b: number; dmg: number; crit: boolean; ranged: boolean; splash: boolean }
  | { t: 'heal'; a: number; b: number; amount: number }
  | { t: 'miss'; a: number; b: number; ranged: boolean }
  | { t: 'blast'; a: number; b: number; r: number }
  | { t: 'die'; i: number }
  | { t: 'save'; i: number }
  /** Un camoufleur se dévoile en attaquant. */
  | { t: 'reveal'; i: number }
  /** Arc électrique (rebond) ou rayon perforant, de l'unité a vers l'unité b. */
  | { t: 'zap'; a: number; b: number }
  | { t: 'mine'; x: number; y: number }
  | { t: 'boom'; x: number; y: number; r: number }
  | { t: 'execute'; i: number };

export interface Frame {
  /** x, y, hp pour chaque unité, à plat. */
  p: number[];
  e: BattleEvent[];
}

export interface UnitTotals {
  dealt: number;
  taken: number;
  /** Soins reçus, de toutes origines (fusil médical, vol de vie, régénération). */
  healed: number;
  /** Soins prodigués avec un fusil médical. */
  healGiven: number;
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
  const totalHealGiven = new Float64Array(n);
  const hidden = units.map((u) => !!u.stealth);
  const mineCd = units.map((u) => u.mines?.every ?? 0);
  const mines: { x: number; y: number; team: Team; owner: number; dmg: number; r: number }[] = [];
  const banners = units.map((u, i) => (u.banner ? i : -1)).filter((i) => i >= 0);
  const aura = new Array<boolean>(n).fill(false);
  // Unités au sol encore ciblables, par camp : la mêlée ne vise les volants qu'une fois le sol nettoyé
  const ground: Record<Team, number> = { ally: 0, enemy: 0 };

  for (const team of ['ally', 'enemy'] as Team[]) {
    const idx = units.map((u, i) => (u.team === team ? i : -1)).filter((i) => i >= 0);
    const pos = formation(idx.length, team);
    idx.forEach((i, k) => {
      x[i] = pos[k].x + START_OFFSET[units[i].position ?? 'free'];
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
  const targetable = (i: number, j: number): boolean => {
    if (units[j].team === units[i].team || !alive(j) || hidden[j]) return false;
    return !units[j].flying || units[i].stats.ranged || ground[units[j].team] === 0;
  };
  const nearestEnemy = (i: number): number => {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (!targetable(i, j)) continue;
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
      if (!targetable(i, j)) continue;
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

  const hasCover = units.some((u) => u.position === 'cover');
  // Abscisse à ne pas dépasser pour un soldat à couvert : derrière le plus avancé des boucliers et soldats en pointe
  // (à défaut, des soldats libres), jusqu'à ce qu'il engage le combat. Un soigneur ne compte pas : il suit ses blessés.
  const coverLimit = (): number => {
    let lead = -1;
    let leadRank = 0;
    for (let j = 0; j < n; j++) {
      const u = units[j];
      if (u.team !== 'ally' || !alive(j) || u.stats.heal) continue;
      const position = u.position ?? 'free';
      const rank = position === 'front' || (position === 'free' && u.tank) ? 2 : position === 'free' ? 1 : 0;
      if (rank > leadRank || (rank === leadRank && rank > 0 && x[j] > x[lead])) {
        lead = j;
        leadRank = rank;
      }
    }
    if (lead < 0) return Infinity;
    const t = nearestEnemy(lead);
    if (t >= 0 && Math.hypot(x[t] - x[lead], y[t] - y[lead]) <= units[lead].stats.range) return Infinity;
    return x[lead] - COVER_GAP;
  };
  const stopDistance = (i: number): number => {
    const { range } = units[i].stats;
    if (units[i].position === 'rear') return range * REAR_HOLD;
    return units[i].position === 'front' ? Math.min(range * 0.9, FRONT_CONTACT) : range * 0.9;
  };

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    ticks = tick;
    const events: BattleEvent[] = [];
    shuffle(rng, order);
    ground.ally = 0;
    ground.enemy = 0;
    for (let i = 0; i < n; i++) if (alive(i) && !hidden[i] && !units[i].flying) ground[units[i].team]++;
    if (banners.length > 0) {
      for (let i = 0; i < n; i++) {
        aura[i] = false;
        if (!alive(i)) continue;
        for (const b of banners) {
          if (alive(b) && units[b].team === units[i].team && (x[b] - x[i]) ** 2 + (y[b] - y[i]) ** 2 <= BANNER_RADIUS ** 2) {
            aura[i] = true;
            break;
          }
        }
      }
    }

    const heal = (target: number, amount: number): void => {
      const before = hp[target];
      hp[target] = Math.min(units[target].stats.maxHp, before + amount);
      totalHealed[target] += hp[target] - before;
    };

    const hurt = (target: number, dmg: number, source: number, reflect = true): number => {
      const T = units[target].stats;
      const real = (dmg * 100) / (100 + T.armor + (aura[target] ? BANNER_ARMOR : 0));
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
      // Épines : une part des dégâts subis revient à l'attaquant, sans rebondir à nouveau
      if (reflect && T.thorns && source !== target && alive(source) && units[source].team !== units[target].team) hurt(source, real * T.thorns, target, false);
      return real;
    };

    const execute = (target: number, source: number): void => {
      const limit = units[source].stats.execute ?? 0;
      if (!limit || !alive(target) || units[target].boss || units[target].dummy || hp[target] > units[target].stats.maxHp * limit) return;
      totalDealt[source] += hp[target];
      totalTaken[target] += hp[target];
      hp[target] = 0;
      killCount[source]++;
      events.push({ t: 'execute', i: target }, { t: 'die', i: target });
    };

    // Mines : posées à intervalle régulier, elles explosent au passage d'un adversaire
    for (let i = 0; i < n; i++) {
      const M = units[i].mines;
      if (!M || !alive(i)) continue;
      mineCd[i] -= DT;
      if (mineCd[i] <= 0 && mines.filter((m) => m.owner === i).length < MINE_MAX) {
        mineCd[i] = M.every;
        mines.push({ x: x[i], y: y[i], team: units[i].team, owner: i, dmg: units[i].stats.damage * M.dmg, r: M.r });
        events.push({ t: 'mine', x: r1(x[i]), y: r1(y[i]) });
      }
    }
    for (let k = mines.length - 1; k >= 0; k--) {
      const m = mines[k];
      let trigger = false;
      for (let j = 0; j < n && !trigger; j++) {
        if (units[j].team !== m.team && alive(j) && !units[j].flying && (x[j] - m.x) ** 2 + (y[j] - m.y) ** 2 <= MINE_TRIGGER ** 2) trigger = true;
      }
      if (!trigger) continue;
      mines.splice(k, 1);
      events.push({ t: 'boom', x: r1(m.x), y: r1(m.y), r: m.r });
      for (let j = 0; j < n; j++) {
        if (units[j].team === m.team || !alive(j) || units[j].flying) continue;
        if ((x[j] - m.x) ** 2 + (y[j] - m.y) ** 2 <= m.r ** 2) {
          const dealt = hurt(j, m.dmg, m.owner);
          events.push({ t: 'hit', a: m.owner, b: j, dmg: Math.round(dealt), crit: false, ranged: false, splash: true });
        }
      }
    }

    const limit = hasCover ? coverLimit() : Infinity;
    const advance = (i: number, dx: number, dy: number, d: number): void => {
      const step = Math.min(units[i].stats.speed * DT, d - stopDistance(i));
      const nx = x[i] + (dx / d) * step;
      // un soldat déjà passé devant attend sur place que la ligne le rejoigne
      x[i] = units[i].position === 'cover' ? Math.min(nx, Math.max(x[i], limit)) : nx;
      y[i] += (dy / d) * step;
    };

    for (const i of order) {
      if (!alive(i)) continue;
      const S = units[i].stats;
      if (S.regen > 0) heal(i, S.regen * S.maxHp * DT);
      cd[i] -= DT;
      if (units[i].position === 'rear' && S.ranged) {
        const e = nearestEnemy(i);
        const d = e >= 0 ? Math.hypot(x[e] - x[i], y[e] - y[i]) : Infinity;
        if (d > 0.01 && d < S.range * REAR_RETREAT) {
          const step = S.speed * DT * REAR_RETREAT_SPEED;
          x[i] -= ((x[e] - x[i]) / d) * step;
          y[i] -= ((y[e] - y[i]) / d) * step;
        }
      }
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
          totalHealGiven[i] += hp[patient] - before;
          events.push({ t: 'heal', a: i, b: patient, amount: Math.round(hp[patient] - before) });
        } else {
          advance(i, dx, dy, d);
        }
        continue;
      }
      const t = S.focusWeak ? weakestInRange(i) : nearestEnemy(i);
      if (t < 0) continue;
      const dx = x[t] - x[i];
      const dy = y[t] - y[i];
      const d = Math.hypot(dx, dy);
      if (d <= S.range) {
        // en pointe : continue d'avancer tout en attaquant
        if (units[i].position === 'front' && d > stopDistance(i)) advance(i, dx, dy, d);
        if (cd[i] > 0) continue;
        cd[i] = Math.max(cd[i], -DT) + S.cooldown;
        if (hidden[i]) {
          hidden[i] = false;
          events.push({ t: 'reveal', i });
        }
        const T = units[t].stats;
        if (rng() < T.dodge) {
          events.push({ t: 'miss', a: i, b: t, ranged: S.ranged });
          continue;
        }
        const growth = units[i].dummy?.growth ?? units[i].growth ?? 0;
        let dmg = (S.damage + growth * tick * DT) * (0.9 + rng() * 0.2);
        if (S.berserk && hp[i] < S.maxHp * 0.5) dmg *= 1.4;
        if (aura[i]) dmg *= BANNER_DMG;
        const crit = rng() < S.crit;
        if (crit) dmg *= 2;
        const dealt = hurt(t, units[t].flying && !S.ranged ? dmg * FLYING_MELEE : dmg, i);
        events.push({ t: 'hit', a: i, b: t, dmg: Math.round(dealt), crit, ranged: S.ranged, splash: false });
        if (S.lifesteal > 0) heal(i, dealt * S.lifesteal);
        if (S.execute) execute(t, i);
        if (S.chain) {
          // Rebonds : de cible en cible, vers l'ennemi ciblable le plus proche pas encore touché
          const struck = new Set([t]);
          let from = t;
          for (let c = 0; c < S.chain; c++) {
            let next = -1;
            let bestD = CHAIN_RANGE ** 2;
            for (let j = 0; j < n; j++) {
              if (struck.has(j) || !targetable(i, j)) continue;
              const d2 = (x[j] - x[from]) ** 2 + (y[j] - y[from]) ** 2;
              if (d2 < bestD) {
                bestD = d2;
                next = j;
              }
            }
            if (next < 0) break;
            struck.add(next);
            events.push({ t: 'zap', a: from, b: next });
            const bounce = hurt(next, dmg * CHAIN_SHARE, i);
            events.push({ t: 'hit', a: i, b: next, dmg: Math.round(bounce), crit: false, ranged: false, splash: true });
            from = next;
          }
        }
        if (S.pierce) {
          // Perforant : tous les ennemis dans le couloir du tir, jusqu'au bout de la portée
          const ux = dx / d;
          const uy = dy / d;
          let far = t;
          let farAlong = d;
          for (let j = 0; j < n; j++) {
            if (j === t || units[j].team === units[i].team || !alive(j) || hidden[j]) continue;
            const along = (x[j] - x[i]) * ux + (y[j] - y[i]) * uy;
            if (along <= 0 || along > S.range) continue;
            const across = Math.abs((x[j] - x[i]) * uy - (y[j] - y[i]) * ux);
            if (across > PIERCE_WIDTH) continue;
            const through = hurt(j, dmg, i);
            events.push({ t: 'hit', a: i, b: j, dmg: Math.round(through), crit: false, ranged: false, splash: true });
            if (along > farAlong) {
              farAlong = along;
              far = j;
            }
          }
          if (far !== t) events.push({ t: 'zap', a: i, b: far });
        }
        if (S.aoe > 0) {
          events.push({ t: 'blast', a: i, b: t, r: S.aoe });
          for (let j = 0; j < n; j++) {
            if (j === t || units[j].team === units[i].team || !alive(j)) continue;
            if (Math.hypot(x[j] - x[t], y[j] - y[t]) <= S.aoe && !units[j].flying) {
              const splash = hurt(j, dmg * 0.6, i);
              events.push({ t: 'hit', a: i, b: j, dmg: Math.round(splash), crit: false, ranged: false, splash: true });
            }
          }
        }
      } else {
        advance(i, dx, dy, d);
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
    totals[u.id] = { dealt: totalDealt[i], taken: totalTaken[i], healed: totalHealed[i], healGiven: totalHealGiven[i] };
    if (u.team !== 'ally') continue;
    if (!alive(i)) deadIds.push(u.id);
    kills[u.id] = killCount[i];
    hpLeft[u.id] = Math.max(0, hp[i]);
  }
  return { winner, frames, ticks, deadIds, kills, totals, hpLeft };
}
