import { describe, expect, it } from 'vitest';
import { cashOutSurvival, dailyGold, estimateBattle, launchBattle } from './combat';
import { BOSS_FREE_PULLS, FORGE_FEE, MAX_LEVEL, SQUAD_BASE, TRAINING_PER_SOLDIER, UNLOCKS, WEAPONS_BY_ID } from './data';
import { buildDailyEnemies, dailyKey } from './enemies';
import { squadMax, unlockLevel, unlocksBetween } from './progress';
import { mulberry32 } from './rng';
import { createSoldier, forgeWeapons, trainingCost } from './roster';
import { createInitialState, parseSave } from './state';
import { computeStats } from './stats';
import type { GameState } from './types';

/** `n` soldats communs au niveau donné, chacun équipé de son arme, sans les armes de départ. */
function squadState(n: number, level: number, weapon = 'rifle'): GameState {
  const st = createInitialState();
  st.weapons = [];
  const rng = mulberry32(42);
  for (let i = 0; i < n; i++) {
    const s = createSoldier(st, 'common', rng);
    s.level = level;
    const w = { uid: `tw${i}`, defId: weapon };
    st.weapons.push(w);
    s.weaponUid = w.uid;
    st.soldiers.push(s);
  }
  return st;
}

const ids = (st: GameState) => st.soldiers.map((s) => s.id);

describe('rapatriement des blessés', () => {
  it('garde dans l’escouade les soldats tombés lors d’une victoire, sans XP', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const st = squadState(4, 4);
      st.campaignLevel = 7;
      const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 8 }, seed);
      if (!r.ok || !r.report.won || r.result.deadIds.length === 0) continue;
      found = true;
      const fallen = r.report.soldiers.filter((s) => r.result.deadIds.includes(s.id));
      expect(fallen.every((s) => s.wounded && !s.died && s.xpGained === 0)).toBe(true);
      expect(st.soldiers).toHaveLength(4);
      expect(st.stats.deaths).toBe(0);
    }
    expect(found).toBe(true);
  });

  it('ne tue jamais à l’entraînement', () => {
    const st = squadState(1, 1, 'fists');
    st.soldiers[0].trainingsLeft = 50;
    for (let seed = 1; seed <= 20; seed++) {
      const r = launchBattle(st, { mode: 'training', squad: ids(st) }, seed);
      expect(r.ok && r.report.soldiers.every((s) => !s.died)).toBe(true);
    }
    expect(st.soldiers).toHaveLength(1);
    expect(st.stats.deaths).toBe(0);
  });

  it('ne compte comme pertes attendues que les défaites', () => {
    const st = squadState(4, 30, 'railgun');
    const est = estimateBattle(st, { mode: 'campaign', squad: ids(st), level: 1 }, 10, 1);
    expect(est.ok && est.avgDeaths).toBe(0);
  });

  it('tue les soldats tombés lors d’une défaite', () => {
    const st = squadState(1, 1, 'fists');
    st.campaignLevel = 9;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 10 }, 5);
    expect(r.ok && !r.report.won && r.report.soldiers[0].died).toBe(true);
    expect(st.soldiers).toHaveLength(0);
  });
});

describe('seuils de progression', () => {
  it('agrandit l’escouade avec la campagne', () => {
    const st = squadState(6, 10);
    expect(squadMax(st)).toBe(SQUAD_BASE);
    expect(launchBattle(st, { mode: 'campaign', squad: ids(st).slice(0, SQUAD_BASE + 1), level: 1 }).ok).toBe(false);
    st.campaignLevel = unlockLevel('squad5');
    expect(squadMax(st)).toBe(SQUAD_BASE + 1);
    st.campaignLevel = unlockLevel('squad6');
    expect(squadMax(st)).toBe(SQUAD_BASE + 2);
  });

  it('annonce les déblocages et offre un tirage gratuit au premier boss vaincu', () => {
    const st = squadState(4, 30, 'railgun');
    st.campaignLevel = 4;
    const free = st.freePulls;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 5 }, 3);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.won).toBe(true);
    expect(r.report.unlocked.map((u) => u.id)).toEqual(['squad5']);
    expect(r.report.freePulls).toBe(BOSS_FREE_PULLS);
    expect(st.freePulls).toBe(free + BOSS_FREE_PULLS);
    expect(unlocksBetween(0, 100)).toHaveLength(UNLOCKS.length);
  });

  it('verrouille les modes avant leur palier', () => {
    const st = squadState(2, 30, 'railgun');
    expect(launchBattle(st, { mode: 'daily', squad: ids(st), date: '2026-01-01' }).ok).toBe(false);
    expect(launchBattle(st, { mode: 'survival', squad: ids(st) }).ok).toBe(false);
    expect(forgeWeapons(st, 'common').ok).toBe(false);
  });
});

describe('forge', () => {
  it('fond 3 armes non équipées en une arme de la rareté supérieure, doublons en premier', () => {
    const st = squadState(1, 1, 'knife');
    st.campaignLevel = unlockLevel('forge');
    for (const id of ['pistol', 'crossbow', 'pistol', 'knife']) st.weapons.push({ uid: `f${id}${st.weapons.length}`, defId: id });
    st.gold = FORGE_FEE.common;
    const r = forgeWeapons(st, 'common', undefined, mulberry32(1));
    if (!r.ok) throw new Error(r.error);
    expect(WEAPONS_BY_ID[r.weapon.defId].rarity).toBe('rare');
    expect(st.gold).toBe(0);
    // arme équipée + 1 commune restante + la nouvelle
    expect(st.weapons).toHaveLength(3);
    expect(st.weapons.some((w) => w.uid === st.soldiers[0].weaponUid)).toBe(true);
    expect(r.consumed.filter((uid) => uid.startsWith('fpistol'))).toHaveLength(2);
    expect(forgeWeapons(st, 'common').ok).toBe(false);
    expect(forgeWeapons(st, 'legendary').ok).toBe(false);
  });
});

describe('défi du jour', () => {
  it('une tentative par jour, avec une série qui grandit les jours consécutifs', () => {
    const st = squadState(4, 30, 'railgun');
    st.campaignLevel = unlockLevel('daily');
    const day1 = launchBattle(st, { mode: 'daily', squad: ids(st), date: '2026-03-01' }, 1);
    if (!day1.ok) throw new Error(day1.error);
    expect(day1.report.won).toBe(true);
    expect(day1.report.freePulls).toBe(1);
    expect(day1.report.weapon).not.toBeNull();
    expect(st.dailyStreak).toBe(1);
    expect(launchBattle(st, { mode: 'daily', squad: ids(st), date: '2026-03-01' }).ok).toBe(false);
    const day2 = launchBattle(st, { mode: 'daily', squad: ids(st), date: '2026-03-02' }, 2);
    expect(day2.ok && day2.report.daily?.streak).toBe(2);
    // un jour sauté : la série repart à 1
    launchBattle(st, { mode: 'daily', squad: ids(st), date: '2026-03-04' }, 3);
    expect(st.dailyStreak).toBe(1);
    expect(dailyGold(10, 3)).toBeGreaterThan(dailyGold(10, 1));
  });

  it('propose les mêmes ennemis toute la journée', () => {
    const a = buildDailyEnemies('2026-05-05', 10).map((u) => [u.name, Math.round(u.stats.maxHp)]);
    const b = buildDailyEnemies('2026-05-05', 10).map((u) => [u.name, Math.round(u.stats.maxHp)]);
    expect(a).toEqual(b);
    expect(dailyKey(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});

describe('survie', () => {
  it('accumule un pot de vague en vague, garde les blessures, puis encaisse', () => {
    const st = squadState(4, 30, 'railgun');
    st.campaignLevel = unlockLevel('survival');
    const gold = st.gold;
    const w1 = launchBattle(st, { mode: 'survival', squad: ids(st) }, 1);
    if (!w1.ok) throw new Error(w1.error);
    expect(w1.report.won).toBe(true);
    expect(st.survival?.wave).toBe(1);
    expect(st.survival!.pot).toBeGreaterThan(0);
    // rien n'est versé avant la fin de l'expédition
    expect(st.gold).toBe(gold);
    // l'escouade de l'expédition est reprise, quelle que soit la sélection
    const w2 = launchBattle(st, { mode: 'survival', squad: [] }, 2);
    expect(w2.ok && w2.report.survival?.wave).toBe(2);
    for (const s of st.soldiers.filter((x) => st.survival!.squad.includes(x.id))) {
      expect(st.survival!.hp[s.id]).toBeLessThanOrEqual(computeStats(s, WEAPONS_BY_ID.railgun).maxHp + 1e-6);
    }
    const pot = st.survival!.pot;
    expect(cashOutSurvival(st)).toBe(pot);
    expect(st.survival).toBeNull();
    expect(st.gold).toBe(gold + pot);
    expect(st.bestWave).toBe(2);
  });

  it('ne verse que la moitié du pot en cas de défaite', () => {
    const st = squadState(1, 1, 'fists');
    st.campaignLevel = 40;
    st.survival = { squad: ids(st), wave: 9, pot: 101, hp: {} };
    const gold = st.gold;
    const r = launchBattle(st, { mode: 'survival', squad: [] }, 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.won).toBe(false);
    expect(r.report.survival?.ended).toBe(true);
    expect(st.survival).toBeNull();
    expect(st.gold).toBe(gold + 50);
  });
});

describe('armes à bonus', () => {
  it('ajoutent leurs bonus propres aux stats du soldat', () => {
    const s = squadState(1, 1).soldiers[0];
    const base = computeStats(s, WEAPONS_BY_ID.pistol);
    const knife = computeStats(s, WEAPONS_BY_ID.knife);
    expect(knife.dodge).toBeCloseTo(base.dodge + 0.08);
    expect(knife.speed).toBeGreaterThan(base.speed);
    expect(computeStats(s, WEAPONS_BY_ID.sword).lifesteal).toBeCloseTo(0.1);
    expect(computeStats(s, WEAPONS_BY_ID.medic).heal).toBe(true);
    expect(computeStats(s, WEAPONS_BY_ID.medic).aoe).toBe(0);
  });

  it('le fusil médical soigne les alliés blessés', () => {
    const st = squadState(3, 10);
    st.weapons[0].defId = 'medic';
    st.campaignLevel = 9;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 10 }, 4);
    if (!r.ok) throw new Error(r.error);
    const heals = r.result.frames.flatMap((f) => f.e).filter((e) => e.t === 'heal');
    expect(heals.length).toBeGreaterThan(0);
    expect(heals.every((e) => e.t === 'heal' && r.units[e.b].team === 'ally' && e.amount >= 0)).toBe(true);
  });
});

describe('entraînements payants', () => {
  it('fait payer au lancement les soldats sans entraînement gratuit, au tarif de leur niveau', () => {
    const st = squadState(2, 3);
    const [free, paid] = st.soldiers;
    paid.trainingsLeft = 0;
    const cost = trainingCost(paid);
    st.gold = cost - 1;
    const refused = launchBattle(st, { mode: 'training', squad: ids(st) }, 1);
    expect(refused.ok).toBe(false);
    expect(st.gold).toBe(cost - 1);
    expect(free.trainingsLeft).toBe(TRAINING_PER_SOLDIER);

    st.gold = cost;
    const r = launchBattle(st, { mode: 'training', squad: ids(st) }, 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.trainingFee).toBe(cost);
    expect(st.gold).toBe(r.report.gold);
    expect(free.trainingsLeft).toBe(TRAINING_PER_SOLDIER - 1);
    expect(paid.trainingsLeft).toBe(0);
  });

  it('ne permet pas d’entraîner un soldat au niveau maximum sans entraînement gratuit', () => {
    const st = squadState(1, MAX_LEVEL);
    st.soldiers[0].trainingsLeft = 0;
    st.gold = 1e6;
    expect(launchBattle(st, { mode: 'training', squad: ids(st) }, 1).ok).toBe(false);
  });
});

describe('sauvegarde', () => {
  it('complète les anciennes sauvegardes avec les nouveaux champs', () => {
    const old: Partial<GameState> = createInitialState();
    delete old.lastDaily;
    delete old.dailyStreak;
    delete old.survival;
    delete old.bestWave;
    const st = parseSave(JSON.stringify(old));
    expect(st).not.toBeNull();
    expect(st!.lastDaily).toBeNull();
    expect(st!.dailyStreak).toBe(0);
    expect(st!.survival).toBeNull();
    expect(st!.bestWave).toBe(0);
  });
});
