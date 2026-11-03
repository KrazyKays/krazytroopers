import { describe, expect, it } from 'vitest';
import { simulate, type BattleUnit } from './battle';
import { campaignXp, canDie, cashOutSurvival, dailyGold, estimateBattle, launchBattle, launchFodder } from './combat';
import { BOSS_FREE_PULLS, COLOSSUS_PULLS, FIRST_NAMES, DAILY_PULL_EVERY, FORGE_FEE, PITY_LIMIT, MAX_LEVEL, SQUAD_BASE, TRAINING_PER_SOLDIER, UNLOCKS, WEAPONS_BY_ID } from './data';
import { buildDailyEnemies, buildScarecrow, colossusMaxHp, dailyKey } from './enemies';
import { squadMax, unlockLevel, unlocksBetween } from './progress';
import { soldierLook } from './look';
import { mulberry32 } from './rng';
import { createSoldier, forgeWeapons, sortSquad, trainingCost } from './roster';
import { createInitialState, parseSave } from './state';
import { computeStats, powerScore, weaponForSoldier } from './stats';
import { recommendedUpgrade, upgradeGains } from './upgrades';
import { pickBoon } from './survival';
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

describe('liste des soldats', () => {
  it('ne reprend un prénom déjà présent que lorsque tous ont servi', () => {
    const st = createInitialState();
    const rng = mulberry32(7);
    const first = (s: { name: string }) => s.name.split(' ')[0];
    for (let i = 0; i < FIRST_NAMES.length; i++) st.soldiers.push(createSoldier(st, 'common', rng));
    expect(new Set(st.soldiers.map(first)).size).toBe(FIRST_NAMES.length);
    expect(FIRST_NAMES).toContain(first(createSoldier(st, 'common', rng)));
  });

  it('trie par puissance décroissante', () => {
    const st = squadState(3, 1);
    st.soldiers[2].level = 20;
    const sorted = sortSquad(st, 'power');
    const power = (s: GameState['soldiers'][number]) => powerScore(computeStats(s, weaponForSoldier(s, st.weapons)));
    expect(sorted[0].id).toBe(st.soldiers[2].id);
    expect(power(sorted[0])).toBeGreaterThanOrEqual(power(sorted[1]));
    expect(power(sorted[1])).toBeGreaterThanOrEqual(power(sorted[2]));
  });

  it('montre le halo de Légende et la médaille de la Légion sur le soldat', () => {
    const st = squadState(1, 1);
    const s = st.soldiers[0];
    expect(soldierLook(s)).toMatchObject({ legend: false, medal: false });
    s.titles = ['legende'];
    expect(soldierLook(s)).toMatchObject({ legend: true, medal: false });
    s.titles = ['legende', 'legion'];
    expect(soldierLook(s)).toMatchObject({ legend: true, medal: true });
  });
});

describe('rapatriement des blessés', () => {
  it('annonce la mort définitive seulement là où une défaite peut tuer', () => {
    const st = createInitialState();
    st.campaignLevel = 5;
    expect(canDie(st, { mode: 'campaign', level: 5, squad: [] })).toBe(false);
    expect(canDie(st, { mode: 'campaign', level: 6, squad: [] })).toBe(true);
    st.campaignLevel = 6;
    expect(canDie(st, { mode: 'campaign', level: 6, squad: [] })).toBe(false);
    expect(canDie(st, { mode: 'training', squad: [] })).toBe(false);
    expect(canDie(st, { mode: 'tower', squad: [] })).toBe(false);
    expect(canDie(st, { mode: 'daily', squad: [] })).toBe(true);
    expect(canDie(st, { mode: 'survival', squad: [] })).toBe(true);
  });

  it('garde dans l’escouade les soldats tombés lors d’une victoire, avec la même XP que les autres', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const st = squadState(4, 9);
      st.campaignLevel = 7;
      const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 8 }, seed);
      if (!r.ok || !r.report.won || r.result.deadIds.length === 0) continue;
      found = true;
      const fallen = r.report.soldiers.filter((s) => r.result.deadIds.includes(s.id));
      const expected = Math.round(campaignXp(8));
      expect(fallen.every((s) => s.wounded && !s.died && s.xpGained === expected)).toBe(true);
      expect(st.soldiers).toHaveLength(4);
      expect(st.stats.deaths).toBe(0);
    }
    expect(found).toBe(true);
  });

  it('ne donne pas d’XP aux soldats tombés lors d’une défaite', () => {
    const st = squadState(4, 1, 'fists');
    st.campaignLevel = 9;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 10 }, 1);
    expect(r.ok && !r.report.won).toBe(true);
    if (!r.ok) return;
    const fallen = r.report.soldiers.filter((s) => r.result.deadIds.includes(s.id));
    expect(fallen.length).toBeGreaterThan(0);
    expect(fallen.every((s) => s.xpGained === 0)).toBe(true);
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
    const st = squadState(3, 30, 'railgun');
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
    st.campaignLevel = unlockLevel('squad4');
    expect(squadMax(st)).toBe(SQUAD_BASE + 1);
    st.campaignLevel = unlockLevel('squad5');
    expect(squadMax(st)).toBe(SQUAD_BASE + 2);
    st.campaignLevel = unlockLevel('squad6');
    expect(squadMax(st)).toBe(SQUAD_BASE + 3);
  });

  it('annonce les déblocages et offre un tirage gratuit au premier boss vaincu', () => {
    const st = squadState(4, 30, 'railgun');
    st.campaignLevel = 4;
    const free = st.freePulls;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 5 }, 3);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.won).toBe(true);
    expect(r.report.unlocked.map((u) => u.id)).toEqual(['simulation', 'positions']);
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
    expect(day1.report.freePulls).toBe(0);
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
    // un bonus doit être choisi avant la vague suivante
    expect(st.survival!.choices).toHaveLength(3);
    expect(launchBattle(st, { mode: 'survival', squad: [] }, 2).ok).toBe(false);
    expect(pickBoon(st, st.survival!.choices!.find((c) => c !== 'tough')!).ok).toBe(true);
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
    st.survival = { squad: ids(st), wave: 9, pot: 101, hp: {}, boons: [], choices: null, mercs: [] };
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
    expect(knife.dodge).toBeCloseTo(base.dodge + WEAPONS_BY_ID.knife.dodge!);
    expect(knife.speed).toBeGreaterThan(base.speed);
    expect(computeStats(s, WEAPONS_BY_ID.sword).lifesteal).toBeCloseTo(WEAPONS_BY_ID.sword.lifesteal!);
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

  it('ne conseille ni la Rage ni le vol de vie à un soigneur, contrairement à un tireur', () => {
    const choices = ['vampire', 'berserk', 'power'];
    const medic = squadState(1, 10, 'medic');
    medic.soldiers[0].upgradeChoices = choices;
    const gains = upgradeGains(medic, medic.soldiers[0]);
    expect(gains.get('vampire')).toBe(0);
    expect(gains.get('berserk')).toBe(0);
    expect(recommendedUpgrade(medic, medic.soldiers[0])).toBe('power');

    const rifle = squadState(1, 10);
    rifle.soldiers[0].upgradeChoices = choices;
    const rifleGains = upgradeGains(rifle, rifle.soldiers[0]);
    expect(rifleGains.get('vampire')).toBeGreaterThan(0);
    expect(rifleGains.get('berserk')).toBeGreaterThan(0);
  });

  describe('règles de soin', () => {
    const ally = (id: string, maxHp: number, hp: number, heal: boolean): BattleUnit => ({
      id,
      team: 'ally',
      name: id,
      look: buildScarecrow().look,
      scale: 1,
      hp,
      stats: { ...buildScarecrow().stats, maxHp, damage: 1, range: 800, cooldown: 1, lifesteal: 1, heal },
    });
    const target: BattleUnit = { ...buildScarecrow(), dummy: { growth: 0 } };

    it('soigner un allié ne rend aucun PV au soigneur', () => {
      const r = simulate([ally('medic', 100, 50, true), ally('patient', 100000, 1, false), target], 1);
      expect(r.frames.flatMap((f) => f.e).some((e) => e.t === 'heal' && e.b === 1)).toBe(true);
      expect(r.hpLeft.medic).toBe(50);
    });

    it('distingue les soins donnés des soins reçus', () => {
      const r = simulate([ally('medic', 100, 100, true), ally('patient', 100000, 1, false), target], 1);
      const { medic, patient } = r.totals;
      expect(medic.healGiven).toBeGreaterThan(0);
      expect(medic.healed).toBe(0);
      expect(patient.healGiven).toBe(0);
      // le patient reçoit le soin du médecin, plus son propre vol de vie
      expect(patient.healed).toBeGreaterThan(medic.healGiven);
    });

    it('un soin critique rend deux fois plus de PV', () => {
      const medic = ally('medic', 100, 100, true);
      medic.stats.damage = 10;
      medic.stats.crit = 1;
      const r = simulate([medic, ally('patient', 100000, 1, false), target], 1);
      const heals = r.frames.flatMap((f) => f.e).filter((e) => e.t === 'heal');
      expect(heals.length).toBeGreaterThan(0);
      expect(heals.every((e) => e.t === 'heal' && e.amount >= 18)).toBe(true);
    });

    it('tirer sur un ennemi quand personne n’est blessé soigne le soigneur', () => {
      const r = simulate([ally('medic', 100, 95, true), target], 1);
      expect(r.hpLeft.medic).toBeGreaterThan(95);
    });
  });
});

describe('chair à canon', () => {
  const fodder = (n: number, weapon = 'pistol', level = 1): GameState => {
    const st = squadState(n, level, weapon);
    st.campaignLevel = 10;
    return st;
  };

  it('perd tous les soldats engagés avec leurs armes et conserve les blessures du Colosse', () => {
    const st = fodder(4);
    const spare = st.soldiers[3].weaponUid;
    const engaged = ids(st).slice(0, 3);
    const r = launchFodder(st, engaged, 1);
    if (!r.ok) throw new Error(r.error);
    expect(st.soldiers).toHaveLength(1);
    expect(st.weapons.map((w) => w.uid)).toEqual([spare]);
    expect(r.report.colossus?.weaponsLost).toBe(3);
    expect(st.pity).toBe(3);
    expect(st.gold).toBe(createInitialState().gold);
    expect(st.colossus.rank).toBe(1);
    expect(st.colossus.damage).toBeGreaterThan(0);
    expect(r.report.colossus?.left).toBeCloseTo(colossusMaxHp(1) - st.colossus.damage);
    expect(r.report.soldiers.every((s) => s.died && s.xpGained === 0)).toBe(true);
  });

  it('récompense la mort du Colosse, même si des soldats restent debout', () => {
    const st = fodder(3);
    st.colossus.damage = colossusMaxHp(1) - 1;
    const pulls = st.freePulls;
    const r = launchFodder(st, ids(st), 2);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.colossus?.killed).toBe(true);
    expect(st.soldiers).toHaveLength(0);
    expect(st.freePulls).toBe(pulls + COLOSSUS_PULLS);
    expect(st.pity).toBe(PITY_LIMIT - 1);
    expect(st.colossus).toEqual({ rank: 2, damage: 0 });
    expect(colossusMaxHp(2)).toBeGreaterThan(colossusMaxHp(1));
  });

  it('protège les favoris et les soldats en expédition', () => {
    const st = fodder(2);
    st.soldiers[0].favorite = true;
    expect(launchFodder(st, [st.soldiers[0].id]).ok).toBe(false);
    st.survival = { squad: [st.soldiers[1].id], wave: 1, pot: 0, hp: {}, boons: [], choices: null, mercs: [] };
    expect(launchFodder(st, [st.soldiers[1].id]).ok).toBe(false);
    expect(st.soldiers).toHaveLength(2);
  });

  it('reste verrouillé avant son palier de campagne', () => {
    const st = fodder(1);
    st.campaignLevel = 0;
    expect(launchFodder(st, ids(st)).ok).toBe(false);
    expect(st.soldiers).toHaveLength(1);
  });

  it('ne met pas la garantie au-delà du tirage garanti', () => {
    const st = fodder(3);
    st.pity = PITY_LIMIT - 2;
    launchFodder(st, ids(st), 3);
    expect(st.pity).toBe(PITY_LIMIT - 1);
  });
});

describe('tirages gratuits', () => {
  it('le défi du jour n’en offre qu’au bout d’une série', () => {
    const st = squadState(3, 15);
    st.campaignLevel = 7;
    const start = new Date(2026, 0, 1);
    const pulls: number[] = [];
    for (let d = 0; d < DAILY_PULL_EVERY * 2; d++) {
      st.soldiers.forEach((s) => { s.level = 30; });
      const date = dailyKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d));
      const r = launchBattle(st, { mode: 'daily', squad: ids(st).slice(0, 3), date }, d + 1);
      if (!r.ok) throw new Error(r.error);
      expect(r.report.won).toBe(true);
      pulls.push(r.report.freePulls);
    }
    expect(pulls).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it('recale les coffres d’une ancienne sauvegarde sans reprendre de tickets', () => {
    const st = createInitialState();
    st.campaignStars = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3 };
    st.starChests = 2;
    st.freePulls = 5;
    const loaded = parseSave(JSON.stringify(st))!;
    expect(loaded.starChests).toBe(1);
    expect(loaded.freePulls).toBe(5);
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
