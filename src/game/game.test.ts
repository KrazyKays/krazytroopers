import { afterEach, describe, expect, it } from 'vitest';
import { simulate } from './battle';
import { setNow, nextMidnight } from './clock';
import { launchBattle } from './combat';
import { PITY_LIMIT, PULL_COST, TRAINING_PER_DAY, UPGRADE_CHOICES, UPGRADE_PICKS, WEAPONS_BY_ID } from './data';
import { buildCampaignEnemies } from './enemies';
import { mulberry32 } from './rng';
import { createSoldier, equipWeapon, grantLevelPicks, pickUpgrade, recruit, releaseSoldier, sellWeapon, sortSquad, toggleFavorite } from './roster';
import { createInitialState, ensureDay, isAvailable } from './state';
import { computeStats } from './stats';
import { soldierLook } from './look';
import type { GameState, Soldier } from './types';

afterEach(() => setNow(null));

function stateWithSoldiers(n: number, level = 1): GameState {
  const st = createInitialState();
  const rng = mulberry32(42);
  for (let i = 0; i < n; i++) {
    const s = createSoldier(st, 'common', rng);
    s.level = level;
    const w = { uid: `tw${i}`, defId: 'rifle' };
    st.weapons.push(w);
    s.weaponUid = w.uid;
    st.soldiers.push(s);
  }
  return st;
}

describe('combat', () => {
  it('est déterministe pour une même graine', () => {
    const st = stateWithSoldiers(3);
    const allies = st.soldiers.map((s) => ({
      id: s.id,
      team: 'ally' as const,
      name: s.name,
      look: soldierLook(s),
      scale: 1,
      soldierId: s.id,
      stats: computeStats(s, WEAPONS_BY_ID.pistol),
    }));
    const units = [...allies, ...buildCampaignEnemies(2)];
    const a = simulate(units, 123);
    const b = simulate(units, 123);
    expect(a.winner).toBe(b.winner);
    expect(a.ticks).toBe(b.ticks);
    expect(a.frames.at(-1)).toEqual(b.frames.at(-1));
  });
});

describe('recrutement', () => {
  it("débite l'or et refuse si insuffisant", () => {
    const st = createInitialState();
    st.gold = PULL_COST;
    expect(recruit(st, 'one').ok).toBe(true);
    expect(st.gold).toBe(0);
    expect(recruit(st, 'one').ok).toBe(false);
  });

  it('limite le tirage gratuit à un par jour', () => {
    const st = createInitialState();
    expect(recruit(st, 'free').ok).toBe(true);
    expect(recruit(st, 'free').ok).toBe(false);
    expect(st.soldiers).toHaveLength(1);
    st.dayKey = 'hier';
    ensureDay(st);
    expect(recruit(st, 'free').ok).toBe(true);
  });

  it('garantit un épique ou mieux au bout de la série de pitié', () => {
    const st = createInitialState();
    st.gold = 100000;
    const rng = () => 0; // tire toujours le plus commun
    const rarities: string[] = [];
    for (let i = 0; i < PITY_LIMIT; i++) {
      const r = recruit(st, 'one', rng);
      if (r.ok) rarities.push(r.soldiers[0].rarity);
    }
    expect(rarities.slice(0, PITY_LIMIT - 1).every((r) => r === 'common')).toBe(true);
    expect(['epic', 'legendary']).toContain(rarities[PITY_LIMIT - 1]);
  });

  it('propose 3 améliorations à choisir 3 fois, et les débloque tous les 5 niveaux', () => {
    const st = createInitialState();
    const s = createSoldier(st, 'rare', mulberry32(1));
    st.soldiers.push(s);
    for (let i = 0; i < UPGRADE_PICKS; i++) {
      expect(s.upgradeChoices).toHaveLength(UPGRADE_CHOICES);
      expect(pickUpgrade(st, s.id, 'inconnue')).toBe(false);
      expect(pickUpgrade(st, s.id, s.upgradeChoices![0])).toBe(true);
    }
    expect(s.upgrades).toHaveLength(UPGRADE_PICKS);
    expect(new Set(s.upgrades).size).toBe(UPGRADE_PICKS);
    expect(s.upgradeChoices).toBeNull();
    expect(pickUpgrade(st, s.id, 'vitality')).toBe(false);

    s.picksLeft = 0;
    s.level = 5;
    grantLevelPicks(s, 4);
    expect(s.picksLeft).toBe(1);
    expect(s.upgradeChoices).toHaveLength(UPGRADE_CHOICES);
  });
});

describe('arsenal', () => {
  it('échange une arme déjà équipée et la vend proprement', () => {
    const st = stateWithSoldiers(2);
    const [a, b] = st.soldiers;
    const [w1, w2] = st.weapons;
    equipWeapon(st, a.id, w1.uid);
    equipWeapon(st, b.id, w2.uid);
    equipWeapon(st, b.id, w1.uid);
    expect(b.weaponUid).toBe(w1.uid);
    expect(a.weaponUid).toBe(w2.uid);
    const gold = st.gold;
    expect(sellWeapon(st, w1.uid)).toBeGreaterThan(0);
    expect(st.gold).toBeGreaterThan(gold);
    expect(b.weaponUid).toBeNull();
    expect(releaseSoldier(st, a.id)).toBeGreaterThan(0);
    expect(st.soldiers).toHaveLength(1);
  });
});

describe('escouade triée', () => {
  it('place les favoris en tête et trie par niveau puis ancienneté', () => {
    const st = stateWithSoldiers(3);
    const [a, b, c] = st.soldiers;
    a.level = 2;
    b.level = 5;
    c.level = 2;
    toggleFavorite(st, c.id);
    expect(sortSquad(st, 'level').map((s) => s.id)).toEqual([b.id, a.id, c.id]);
    expect(sortSquad(st, 'favorite').map((s) => s.id)).toEqual([c.id, b.id, a.id]);
    expect(sortSquad(st, 'seniority').map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  });

  it('bascule le statut favori', () => {
    const st = stateWithSoldiers(1);
    const [s] = st.soldiers;
    toggleFavorite(st, s.id);
    expect(s.favorite).toBe(true);
    toggleFavorite(st, s.id);
    expect(s.favorite).toBe(false);
  });
});

describe('entraînement et campagne', () => {
  it('consomme les entraînements du jour et donne de l’expérience', () => {
    const st = stateWithSoldiers(5, 20);
    const squad = st.soldiers.map((s) => s.id);
    for (let i = 0; i < TRAINING_PER_DAY; i++) {
      const r = launchBattle(st, { mode: 'training', squad }, i + 1);
      expect(r.ok).toBe(true);
    }
    expect(st.trainingLeft).toBe(0);
    expect(launchBattle(st, { mode: 'training', squad }, 9).ok).toBe(false);
    expect(st.soldiers.some((s) => s.xp > 0 || s.level > 20)).toBe(true);
  });

  it('refuse un niveau verrouillé, puis donne une arme à la première victoire', () => {
    const st = stateWithSoldiers(5, 3);
    const squad = st.soldiers.map((s) => s.id);
    const weapons = st.weapons.length;
    expect(launchBattle(st, { mode: 'campaign', squad, level: 2 }).ok).toBe(false);
    const r = launchBattle(st, { mode: 'campaign', squad, level: 1 }, 7);
    expect(r.ok && r.report.won).toBe(true);
    expect(st.campaignLevel).toBe(1);
    expect(st.weapons.length).toBe(weapons + 1);
    expect(r.ok && r.report.firstClear).toBe(true);
  });

  it("met hors de combat jusqu'au lendemain les soldats tombés", () => {
    setNow(new Date(2026, 0, 10, 15, 30).getTime());
    const st = stateWithSoldiers(1, 1);
    st.campaignLevel = 9;
    const id = st.soldiers[0].id;
    const r = launchBattle(st, { mode: 'campaign', squad: [id], level: 10 }, 5);
    expect(r.ok && r.report.won).toBe(false);
    const s: Soldier = st.soldiers[0];
    expect(s.deadUntil).toBe(new Date(2026, 0, 11).getTime());
    expect(isAvailable(s)).toBe(false);
    expect(launchBattle(st, { mode: 'training', squad: [id] }).ok).toBe(false);

    setNow(new Date(2026, 0, 10, 23, 59).getTime());
    ensureDay(st);
    expect(s.deadUntil).not.toBeNull();

    setNow(nextMidnight() + 1000);
    expect(ensureDay(st)).toBe(true);
    expect(s.deadUntil).toBeNull();
    expect(st.trainingLeft).toBe(TRAINING_PER_DAY);
    expect(isAvailable(s)).toBe(true);
  });
});
