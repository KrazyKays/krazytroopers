import { describe, expect, it } from 'vitest';
import { deathsAmong, estimateBattle, launchBattle } from './combat';
import { PULL_COST, RESCUE_PULLS, SAFE_LEVELS, START_LOOT, LOOT_FIRST_CLEAR, LOOT_METER_MAX, WEAPONS_BY_ID } from './data';
import { buildCampaignEnemies, threatBudget } from './enemies';
import { PROFILES, playThrough } from './playtest';
import { mulberry32 } from './rng';
import { createSoldier } from './roster';
import { createInitialState } from './state';
import { computeStats, levelMult, powerScore, xpForNext } from './stats';
import type { GameState } from './types';

function squadState(count: number, level: number, weapon: string): GameState {
  const st = createInitialState();
  st.weapons = [];
  const rng = mulberry32(3);
  for (let i = 0; i < count; i++) {
    const s = createSoldier(st, 'common', rng);
    s.level = level;
    st.weapons.push({ uid: `b${i}`, defId: weapon });
    s.weaponUid = `b${i}`;
    st.soldiers.push(s);
  }
  return st;
}

const ids = (st: GameState) => st.soldiers.map((s) => s.id);

describe('conséquences d’une défaite', () => {
  it('ne coûte qu’un tiers des soldats tombés, arrondi au supérieur', () => {
    expect([1, 2, 3, 4, 6].map(deathsAmong)).toEqual([1, 1, 1, 2, 2]);
    const st = squadState(6, 1, 'fists');
    st.campaignLevel = 20;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 20 }, 5);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.won).toBe(false);
    expect(r.report.soldiers.filter((s) => s.died)).toHaveLength(2);
    expect(r.report.soldiers.filter((s) => s.wounded)).toHaveLength(4);
    expect(st.soldiers).toHaveLength(4);
    expect(st.stats.deaths).toBe(2);
  });

  it('épargne tout le monde sur les premiers niveaux de campagne', () => {
    const st = squadState(3, 1, 'fists');
    st.campaignLevel = SAFE_LEVELS - 1;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: SAFE_LEVELS }, 5);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.won).toBe(false);
    expect(st.soldiers).toHaveLength(3);
  });

  it('envoie des renforts à un joueur sans soldat ni or, jamais aux autres', () => {
    const st = squadState(1, 1, 'fists');
    st.campaignLevel = 19;
    st.freePulls = 0;
    st.gold = PULL_COST - 1;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 20 }, 5);
    if (!r.ok) throw new Error(r.error);
    expect(st.soldiers).toHaveLength(0);
    expect(st.freePulls).toBe(RESCUE_PULLS);

    const rich = squadState(1, 1, 'fists');
    rich.campaignLevel = 19;
    rich.freePulls = 0;
    rich.gold = PULL_COST;
    launchBattle(rich, { mode: 'campaign', squad: ids(rich), level: 20 }, 5);
    expect(rich.freePulls).toBe(0);
  });
});

describe('courbe de difficulté', () => {
  it('le budget de menace augmente à chaque niveau', () => {
    for (let level = 1; level < 40; level++) expect(threatBudget(level + 1)).toBeGreaterThan(threatBudget(level));
  });

  it('une armée pèse son budget, quelle que soit sa composition', () => {
    // Le cumul de PV d'un niveau suit le budget : pas d'effondrement ni de bond isolé d'un niveau à l'autre
    const hp = (level: number) => buildCampaignEnemies(level).reduce((sum, u) => sum + u.stats.maxHp, 0);
    for (let level = 2; level < 30; level++) expect(hp(level) / hp(level - 1)).toBeLessThan(2.5);
  });

  it('les premiers niveaux restent à la portée de l’escouade de départ', () => {
    const st = createInitialState();
    const rng = mulberry32(11);
    for (let i = 0; i < 3; i++) {
      const s = createSoldier(st, 'common', rng);
      s.weaponUid = st.weapons[i].uid;
      st.soldiers.push(s);
    }
    const est = estimateBattle(st, { mode: 'campaign', squad: ids(st), level: 1 }, 40, 7);
    expect(est.ok && est.wins / est.runs).toBeGreaterThanOrEqual(0.8);
  });
});

describe('progression', () => {
  it('chaque niveau vaut autant que le précédent, et coûte plus d’XP', () => {
    for (let level = 1; level < 30; level++) {
      expect(levelMult(level + 1) / levelMult(level)).toBeCloseTo(1.05);
      expect(xpForNext(level + 1)).toBeGreaterThan(xpForNext(level));
    }
  });

  it('le premier niveau de campagne offre toujours une arme', () => {
    expect(START_LOOT + LOOT_FIRST_CLEAR).toBe(LOOT_METER_MAX);
  });

  it('la note de puissance classe les armes selon leur valeur en combat', () => {
    const s = squadState(1, 10, 'pistol').soldiers[0];
    const note = (id: string) => powerScore(computeStats(s, WEAPONS_BY_ID[id]));
    // La mêlée ne doit pas écraser les armes à distance de même rareté, contrairement à ce qu'elle vaut au combat
    expect(note('katana') / note('minigun')).toBeLessThan(1.25);
    expect(note('sword') / note('rifle')).toBeLessThan(1.25);
    expect(note('railgun')).toBeGreaterThan(note('sniper'));
    expect(note('rifle')).toBeGreaterThan(note('pistol'));
  });

  it('une partie complète ne va ni trop vite ni dans une impasse', () => {
    const regular = PROFILES.find((p) => p.id === 'regular')!;
    const run = playThrough(regular, 1000, { target: 8, maxHours: 4, maxFights: 800 });
    expect(run.stuck).toBe(false);
    expect(run.campaignLevel).toBeGreaterThanOrEqual(5);
    // Le premier boss demande du temps : ni expédié en quelques combats, ni un mur
    const boss = run.milestones.find((m) => m.level === 5)!;
    expect(boss.fights).toBeGreaterThan(10);
    expect(boss.fights).toBeLessThan(300);
    expect(run.milestones.find((m) => m.level === 1)!.fights).toBe(1);
  });
});
