import { describe, expect, it } from 'vitest';
import { simulate } from './battle';
import { DEFAULT_SIMULATION, estimateBattle, estimateSimulation, launchBattle, launchSimulation } from './combat';
import { AUTO_PICK_KILLS, LEGEND_UPGRADES, MAX_LEVEL, MAX_UPGRADES, PITY_LIMIT, PULL_COST, START_FREE_PULLS, START_GOLD, TRAINING_PER_SOLDIER, UPGRADE_CHOICES, UPGRADE_PICKS, UPGRADES, WEAPON_PULL10_COST, WEAPON_PULL_COST, WEAPONS_BY_ID } from './data';
import { buildCampaignEnemies, SIM_MAX_ENEMIES } from './enemies';
import { mulberry32 } from './rng';
import { autoPickAll, autoPickUnlocked, buyWeapons, createSoldier, entitledPicks, equipWeapon, grantLevelPicks, legionOfHonor, pickUpgrade, recruit, releaseSoldier, releaseSoldiers, sellWeapon, sellWeapons, sortSquad, toggleFavorite } from './roster';
import { createInitialState } from './state';
import { addXp, computeStats } from './stats';
import { soldierLook } from './look';
import type { GameState } from './types';

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

  it('accorde des tirages gratuits à un nouveau joueur, sans les renouveler', () => {
    const st = createInitialState();
    expect(st.gold).toBe(START_GOLD);
    expect(st.freePulls).toBe(START_FREE_PULLS);
    for (let i = 0; i < START_FREE_PULLS; i++) expect(recruit(st, 'free').ok).toBe(true);
    expect(recruit(st, 'free').ok).toBe(false);
    expect(st.soldiers).toHaveLength(START_FREE_PULLS);
    expect(st.gold).toBe(START_GOLD);
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

  it("vend des armes à l'armurerie, avec sa propre garantie", () => {
    const st = createInitialState();
    st.gold = 100000;
    expect(buyWeapons(st, 'one').ok).toBe(false); // armurerie fermée avant le niveau 1 de la campagne
    st.campaignLevel = 1;
    const owned = st.weapons.length;
    st.gold = WEAPON_PULL_COST + WEAPON_PULL10_COST - 1;
    const one = buyWeapons(st, 'one');
    expect(one.ok && one.weapons).toHaveLength(1);
    expect(buyWeapons(st, 'ten').ok).toBe(false);
    expect(st.gold).toBe(WEAPON_PULL10_COST - 1);
    expect(st.weapons).toHaveLength(owned + 1);

    st.gold = 100000;
    st.weaponPity = 0;
    const rarities: string[] = [];
    for (let i = 0; i < PITY_LIMIT; i++) {
      const r = buyWeapons(st, 'one', () => 0);
      if (r.ok) rarities.push(WEAPONS_BY_ID[r.weapons[0].defId].rarity);
    }
    expect(rarities.slice(0, PITY_LIMIT - 1).every((r) => r === 'common')).toBe(true);
    expect(['epic', 'legendary']).toContain(rarities[PITY_LIMIT - 1]);
    expect(st.weaponPity).toBe(0);
    expect(st.pity).toBe(0); // la garantie du recrutement n'est pas touchée
    expect(rarities.every((r, i) => WEAPONS_BY_ID[st.weapons[owned + 1 + i].defId].rarity === r)).toBe(true);
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
    grantLevelPicks(s);
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

  it('vend plusieurs armes en une seule opération', () => {
    const st = stateWithSoldiers(1);
    const count = st.weapons.length;
    const [w1, w2] = st.weapons;
    const gold = st.gold;
    const earned = sellWeapons(st, [w1.uid, w2.uid]);
    expect(earned).toBeGreaterThan(0);
    expect(st.gold).toBe(gold + earned);
    expect(st.weapons).toHaveLength(count - 2);
  });

  it('renvoie plusieurs soldats en une seule opération', () => {
    const st = stateWithSoldiers(3);
    const [a, b] = st.soldiers;
    const earned = releaseSoldiers(st, [a.id, b.id]);
    expect(earned).toBeGreaterThan(0);
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

describe('titres et légion d’honneur', () => {
  it('donne le titre Légende au niveau maximum', () => {
    const st = stateWithSoldiers(1);
    const [s] = st.soldiers;
    addXp(s, 1e9);
    expect(s.level).toBe(MAX_LEVEL);
    expect(s.titles).toEqual(['legende']);
  });

  it('retire les améliorations choisies et repart au niveau 1 avec des choix de légende', () => {
    const st = stateWithSoldiers(1, MAX_LEVEL);
    const [s] = st.soldiers;
    s.titles = ['legende'];
    s.upgrades = ['vitality', 'power', 'sprint'];
    s.picksLeft = 0;
    s.trainingsLeft = 0;
    expect(legionOfHonor(st, s.id, ['power', 'sprint'])).toBe(true);
    expect(s.upgrades).toEqual(['vitality']);
    expect(s.level).toBe(1);
    expect(s.xp).toBe(0);
    expect(s.picksLeft).toBe(UPGRADE_PICKS - 1);
    expect(s.trainingsLeft).toBe(TRAINING_PER_SOLDIER);
    expect(s.upgradeChoices).toHaveLength(UPGRADE_CHOICES);
    expect(s.upgradeChoices!.every((id) => LEGEND_UPGRADES.some((u) => u.id === id))).toBe(true);
    expect(s.titles).toEqual(['legende', 'legion']);
  });

  it('rattrape la courbe après la légion selon le nombre de compétences gardées', () => {
    for (const [kept, picks] of [[0, 3], [2, 1], [3, 0], [5, 0]] as const) {
      const st = stateWithSoldiers(1, MAX_LEVEL);
      const [s] = st.soldiers;
      s.upgrades = UPGRADES.slice(0, kept).map((u) => u.id);
      s.picksLeft = 0;
      expect(legionOfHonor(st, s.id, [])).toBe(true);
      expect(s.picksLeft).toBe(picks);
    }
  });

  it('ne dépasse jamais le plafond de compétences, légion ou non', () => {
    const st = stateWithSoldiers(1, MAX_LEVEL);
    const [s] = st.soldiers;
    s.upgrades = UPGRADES.slice(0, MAX_UPGRADES).map((u) => u.id);
    s.picksLeft = 0;
    expect(legionOfHonor(st, s.id, [])).toBe(true);
    s.level = MAX_LEVEL;
    grantLevelPicks(s);
    expect(s.upgrades.length + s.picksLeft).toBeLessThanOrEqual(MAX_UPGRADES);
  });

  it('refuse la légion avant le niveau max ou avec des améliorations en attente', () => {
    const st = stateWithSoldiers(1, MAX_LEVEL - 1);
    const [s] = st.soldiers;
    s.picksLeft = 0;
    expect(legionOfHonor(st, s.id, [])).toBe(false);
    s.level = MAX_LEVEL;
    s.picksLeft = 1;
    expect(legionOfHonor(st, s.id, [])).toBe(false);
  });

  it('n’offre aucun choix d’amélioration au niveau max', () => {
    expect(entitledPicks(MAX_LEVEL)).toBe(entitledPicks(MAX_LEVEL - 1));
    const st = stateWithSoldiers(1, MAX_LEVEL);
    const [s] = st.soldiers;
    s.upgrades = [];
    grantLevelPicks(s);
    expect(s.picksLeft).toBe(entitledPicks(MAX_LEVEL - 1));
    expect(s.upgradeChoices).not.toBeNull();
  });

  it('plafonne le nombre d’améliorations', () => {
    const st = stateWithSoldiers(1, 4);
    const [s] = st.soldiers;
    s.upgrades = UPGRADES.slice(0, MAX_UPGRADES).map((u) => u.id);
    s.picksLeft = 0;
    s.upgradeChoices = null;
    s.level = 5;
    grantLevelPicks(s);
    expect(s.picksLeft).toBe(0);
    expect(s.upgradeChoices).toBeNull();
  });
});

describe('entraînement et campagne', () => {
  it('limite chaque soldat à 3 entraînements dans sa vie', () => {
    const st = stateWithSoldiers(1, 20);
    const squad = [st.soldiers[0].id];
    for (let i = 0; i < TRAINING_PER_SOLDIER; i++) {
      const r = launchBattle(st, { mode: 'training', squad }, i + 1);
      expect(r.ok).toBe(true);
    }
    expect(st.soldiers[0].trainingsLeft).toBe(0);
    expect(launchBattle(st, { mode: 'training', squad }, 9).ok).toBe(false);
    expect(st.soldiers[0].xp > 0 || st.soldiers[0].level > 20).toBe(true);
  });

  it('refuse un niveau verrouillé, puis donne une arme à la première victoire', () => {
    const st = stateWithSoldiers(4, 3);
    const squad = st.soldiers.map((s) => s.id);
    const weapons = st.weapons.length;
    expect(launchBattle(st, { mode: 'campaign', squad, level: 2 }).ok).toBe(false);
    const r = launchBattle(st, { mode: 'campaign', squad, level: 1 }, 7);
    expect(r.ok && r.report.won).toBe(true);
    expect(st.campaignLevel).toBe(1);
    expect(st.weapons.length).toBe(weapons + 1);
    expect(r.ok && r.report.firstClear).toBe(true);
  });

  it('retire définitivement de l’escouade les soldats tombés', () => {
    const st = stateWithSoldiers(2, 1);
    st.campaignLevel = 9;
    const [fallen, survivor] = st.soldiers;
    const r = launchBattle(st, { mode: 'campaign', squad: [fallen.id], level: 10 }, 5);
    expect(r.ok && r.report.won).toBe(false);
    expect(r.ok && r.report.soldiers[0].died).toBe(true);
    expect(st.soldiers.some((s) => s.id === fallen.id)).toBe(false);
    expect(st.soldiers.some((s) => s.id === survivor.id)).toBe(true);
    expect(launchBattle(st, { mode: 'campaign', squad: [fallen.id], level: 10 }).ok).toBe(false);
  });
});

describe('simulation', () => {
  it('ne modifie ni la progression ni les soldats', () => {
    const st = stateWithSoldiers(3, 2);
    const before = JSON.stringify(st);
    const launch = launchSimulation(st, st.soldiers.map((s) => s.id), DEFAULT_SIMULATION, 7);
    expect(launch.ok).toBe(true);
    expect(JSON.stringify(st)).toBe(before);
  });

  it("garde l'épouvantail debout et ses coups plus forts en fin de combat", () => {
    const st = stateWithSoldiers(2, 1);
    const launch = launchSimulation(st, st.soldiers.map((s) => s.id), DEFAULT_SIMULATION, 7);
    if (!launch.ok) throw new Error(launch.error);
    const sc = launch.units.length - 1;
    expect(launch.result.frames.every((f) => f.p[sc * 3 + 2] === 1)).toBe(true);
    expect(launch.result.deadIds).not.toContain('scarecrow');
    const hits: { dmg: number }[] = [];
    for (const f of launch.result.frames) for (const e of f.e) if (e.t === 'hit' && e.a === sc && !e.splash) hits.push(e);
    expect(hits.length).toBeGreaterThan(2);
    expect(hits[hits.length - 1].dmg).toBeGreaterThan(hits[0].dmg);
  });

  it('aligne le nombre d’ennemis choisi par le joueur, boss compris', () => {
    const st = stateWithSoldiers(2, 1);
    const ids = st.soldiers.map((s) => s.id);
    for (const count of [1, 7, SIM_MAX_ENEMIES]) {
      const launch = launchSimulation(st, ids, { opponent: 'mixed', count, level: 4, boss: true }, 3);
      if (!launch.ok) throw new Error(launch.error);
      const enemies = launch.units.filter((u) => u.team === 'enemy');
      expect(enemies).toHaveLength(count);
      expect(enemies.filter((u) => u.scale > 1)).toHaveLength(1);
      expect(new Set(launch.units.map((u) => u.id)).size).toBe(launch.units.length);
    }
    const dummies = launchSimulation(st, ids, { ...DEFAULT_SIMULATION, count: 3 }, 3);
    expect(dummies.ok && dummies.units.filter((u) => u.dummy)).toHaveLength(3);
  });

  it('impose un seul type de troupe, même avant son niveau d’apparition', () => {
    const st = stateWithSoldiers(1, 1);
    const launch = launchSimulation(st, [st.soldiers[0].id], { opponent: 'rocket', count: 4, level: 1, boss: false }, 3);
    if (!launch.ok) throw new Error(launch.error);
    expect(launch.units.filter((u) => u.team === 'enemy').every((u) => u.name === 'Lance-roquettes')).toBe(true);
  });

  it('estime les chances sans toucher à la progression', () => {
    const st = stateWithSoldiers(3, 20);
    const before = JSON.stringify(st);
    const easy = estimateSimulation(st, st.soldiers.map((s) => s.id), { opponent: 'grunt', count: 1, level: 1, boss: false }, 10, 1);
    const hard = estimateSimulation(st, st.soldiers.map((s) => s.id), { opponent: 'mixed', count: SIM_MAX_ENEMIES, level: 40, boss: true }, 10, 1);
    if (!easy.ok || !hard.ok) throw new Error('estimation impossible');
    expect(easy.wins + easy.losses + easy.timeouts).toBe(10);
    expect(easy.wins).toBe(10);
    expect(hard.wins).toBeLessThan(easy.wins);
    expect(JSON.stringify(st)).toBe(before);
  });
});

describe('estimation avant un vrai combat', () => {
  it('ne consomme ni entraînement ni progression', () => {
    const st = stateWithSoldiers(3, 5);
    const before = JSON.stringify(st);
    const ids = st.soldiers.map((s) => s.id);
    const training = estimateBattle(st, { mode: 'training', squad: ids }, 10, 1);
    const campaign = estimateBattle(st, { mode: 'campaign', squad: ids, level: 1 }, 10, 1);
    if (!training.ok || !campaign.ok) throw new Error('estimation impossible');
    expect(training.wins + training.losses + training.timeouts).toBe(10);
    expect(campaign.wins + campaign.losses + campaign.timeouts).toBe(10);
    expect(JSON.stringify(st)).toBe(before);
  });

  it('donne moins de chances face à un niveau de campagne bien plus élevé', () => {
    const st = stateWithSoldiers(3, 5);
    st.campaignLevel = 39;
    const ids = st.soldiers.map((s) => s.id);
    const easy = estimateBattle(st, { mode: 'campaign', squad: ids, level: 1 }, 10, 1);
    const hard = estimateBattle(st, { mode: 'campaign', squad: ids, level: 40 }, 10, 1);
    if (!easy.ok || !hard.ok) throw new Error('estimation impossible');
    expect(hard.wins).toBeLessThan(easy.wins);
    expect(hard.avgDeaths).toBeGreaterThan(easy.avgDeaths);
  });

  it('refuse une escouade vide', () => {
    expect(estimateBattle(createInitialState(), { mode: 'training', squad: [] }).ok).toBe(false);
  });
});

describe('boucliers', () => {
  it('apportent leur armure en plus de celle du soldat, au corps à corps', () => {
    const s = stateWithSoldiers(1, 1).soldiers[0];
    const bare = computeStats(s, WEAPONS_BY_ID.knife);
    const shielded = computeStats(s, WEAPONS_BY_ID.aegis);
    expect(bare.armor).toBe(0);
    expect(shielded.armor).toBe(WEAPONS_BY_ID.aegis.armor);
    expect(shielded.ranged).toBe(false);
  });
});

describe('choix automatique des améliorations', () => {
  it('reste verrouillé tant que le total d’éliminations n’est pas atteint', () => {
    const st = stateWithSoldiers(2, 1);
    st.stats.kills = AUTO_PICK_KILLS - 1;
    expect(autoPickUnlocked(st)).toBe(false);
    expect(autoPickAll(st, mulberry32(1))).toBe(0);
    expect(st.soldiers.every((s) => s.picksLeft === UPGRADE_PICKS)).toBe(true);
  });

  it('choisit toutes les améliorations en attente de toute l’escouade une fois débloqué', () => {
    const st = stateWithSoldiers(3, 1);
    st.stats.kills = AUTO_PICK_KILLS;
    st.soldiers[1].level = 6;
    for (const s of st.soldiers) grantLevelPicks(s);
    const expected = st.soldiers.reduce((n, s) => n + s.picksLeft, 0);
    expect(autoPickAll(st, mulberry32(7))).toBe(expected);
    for (const s of st.soldiers) {
      expect(s.picksLeft).toBe(0);
      expect(s.upgradeChoices).toBeNull();
      expect(new Set(s.upgrades).size).toBe(s.upgrades.length);
    }
  });

  it('ne choisit que parmi les propositions du soldat', () => {
    const st = stateWithSoldiers(1, 1);
    st.stats.kills = AUTO_PICK_KILLS;
    const [s] = st.soldiers;
    const offered = [...(s.upgradeChoices ?? [])];
    autoPickAll(st, mulberry32(3));
    expect(offered).toContain(s.upgrades[0]);
  });

  it('compte les éliminations de chaque combat dans le total global', () => {
    const st = stateWithSoldiers(3, 20);
    const before = st.stats.kills;
    const launch = launchBattle(st, { mode: 'campaign', squad: st.soldiers.map((s) => s.id), level: 1 }, 99);
    if (!launch.ok) throw new Error(launch.error);
    const total = Object.values(launch.result.kills).reduce((n, k) => n + k, 0);
    expect(st.stats.kills - before).toBe(total);
  });
});
