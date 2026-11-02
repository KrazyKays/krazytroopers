import { describe, expect, it } from 'vitest';
import { simulate, type BattleUnit } from './battle';
import { campaignStarsFor, launchBattle, squadStats, totalStars } from './combat';
import { STAR_CHEST_EVERY, WEAPONS_BY_ID } from './data';
import { buildCampaignEnemies, eliteCount, previewCampaign } from './enemies';
import { claimGoal, claimableGoals } from './goals';
import { unlockLevel } from './progress';
import { mulberry32 } from './rng';
import { createSoldier } from './roster';
import { activePosition, synergyStatus } from './squad';
import { createInitialState, parseSave } from './state';
import { computeStats } from './stats';
import type { GameState } from './types';

function squadState(weapons: string[], level = 10): GameState {
  const st = createInitialState();
  st.weapons = [];
  const rng = mulberry32(7);
  weapons.forEach((defId, i) => {
    const s = createSoldier(st, 'common', rng);
    s.level = level;
    st.weapons.push({ uid: `tw${i}`, defId });
    s.weaponUid = `tw${i}`;
    st.soldiers.push(s);
  });
  return st;
}

const ids = (st: GameState) => st.soldiers.map((s) => s.id);

describe('synergies', () => {
  it('s’activent selon les familles d’armes de l’escouade', () => {
    const active = (w: string[]) => synergyStatus(w.map((id) => WEAPONS_BY_ID[id])).filter((s) => s.active).map((s) => s.def.id);
    expect(active(['pistol', 'pistol'])).toEqual([]);
    expect(active(['pistol', 'rifle', 'smg'])).toEqual(['volley']);
    expect(active(['knife', 'sword', 'buckler', 'medic'])).toEqual(['blades', 'cover', 'medbay']);
    expect(active(['knife', 'buckler', 'medic', 'sniper'])).toContain('mixed');
  });

  it('renforcent les porteurs de la famille, ou toute l’escouade', () => {
    const st = squadState(['knife', 'sword', 'buckler']);
    st.campaignLevel = 0;
    const stats = squadStats(st, st.soldiers);
    const [knifer, , shield] = st.soldiers;
    const base = computeStats(knifer, WEAPONS_BY_ID.knife);
    expect(stats.get(knifer.id)!.speed).toBeCloseTo(base.speed * 1.15);
    // la couverture du bouclier profite à tous, y compris aux soldats de mêlée
    expect(stats.get(knifer.id)!.armor).toBe(base.armor + 6);
    expect(stats.get(shield.id)!.armor).toBe(computeStats(shield, WEAPONS_BY_ID.buckler).armor + 6);
  });
});

describe('tactiques', () => {
  it('ne s’appliquent qu’une fois débloquées', () => {
    const st = squadState(['pistol']);
    st.tactic = 'bulwark';
    const base = computeStats(st.soldiers[0], WEAPONS_BY_ID.pistol);
    expect(squadStats(st, st.soldiers).get(st.soldiers[0].id)!.armor).toBe(base.armor);
    st.campaignLevel = unlockLevel('tactics');
    expect(squadStats(st, st.soldiers).get(st.soldiers[0].id)!.armor).toBe(base.armor + 12);
  });

  it('la chasse aux blessés vise l’ennemi le plus entamé à portée', () => {
    const st = squadState(['sniper']);
    st.campaignLevel = unlockLevel('tactics');
    st.tactic = 'hunters';
    const ally: BattleUnit = { id: 'a', team: 'ally', name: 'A', look: { skin: '', hair: '', uniform: '', helmet: '', weaponId: 'sniper' }, scale: 1, stats: { ...squadStats(st, st.soldiers).get(st.soldiers[0].id)!, cooldown: 1 } };
    const [near, far] = buildCampaignEnemies(1);
    for (const e of [near, far]) e.stats = { ...e.stats, damage: 0, speed: 0, maxHp: 100000 };
    far.hp = 10;
    const result = simulate([ally, near, far], 1);
    const shot = result.frames.flatMap((f) => f.e).find((e) => e.t === 'hit' || e.t === 'miss');
    expect(shot && (shot.t === 'hit' || shot.t === 'miss') && shot.b).toBe(2);
  });
});

describe('positions', () => {
  const unit = (id: string, position: BattleUnit['position'], speed: number, tank = false): BattleUnit => {
    const st = squadState(['pistol']);
    return { id, team: 'ally', name: id, look: { skin: '', hair: '', uniform: '', helmet: '', weaponId: 'pistol' }, scale: 1, position, tank, stats: { ...computeStats(st.soldiers[0], WEAPONS_BY_ID.pistol), speed, damage: 0, maxHp: 100000 } };
  };
  const shield = (speed: number): BattleUnit => {
    const u = unit('shield', 'free', speed, true);
    return { ...u, stats: { ...u.stats, range: 26, ranged: false } };
  };
  const foe = (): BattleUnit => {
    const [e] = buildCampaignEnemies(1);
    return { ...e, stats: { ...e.stats, damage: 0, speed: 0, range: 10, maxHp: 100000 } };
  };
  // abscisse de l'unité d'indice `i` à chaque image
  const track = (units: BattleUnit[], i: number) => simulate(units, 1).frames.map((f) => f.p[i * 3]);

  it('à couvert : un soldat rapide ne dépasse pas le bouclier avant le contact', () => {
    const covered = track([shield(40), unit('fast', 'cover', 200), foe()], 1);
    const tank = track([shield(40), unit('fast', 'cover', 200), foe()], 0);
    covered.forEach((x, i) => expect(x).toBeLessThan(tank[i]));
    // sans la consigne, il part loin devant
    const free = track([shield(40), unit('fast', 'free', 200), foe()], 1);
    expect(free[20]).toBeGreaterThan(tank[20]);
  });

  it('à couvert : un soldat de mêlée rejoint le combat une fois le bouclier engagé', () => {
    const melee = unit('melee', 'cover', 200);
    const xs = track([shield(100), { ...melee, stats: { ...melee.stats, range: 26, ranged: false } }, foe()], 1);
    expect(xs[xs.length - 1]).toBeGreaterThan(690);
  });

  it('à couvert : avance librement sans première ligne, et un bouclier à couvert n’en forme pas une', () => {
    const alone = track([unit('solo', 'cover', 100), foe()], 0);
    expect(alone[alone.length - 1]).toBeGreaterThan(500);
    const xs = track([{ ...shield(100), position: 'cover' }, foe()], 0);
    expect(xs[xs.length - 1]).toBeGreaterThan(690);
  });

  it('en pointe : part devant et s’approche au contact, même à portée de tir', () => {
    const xs = track([unit('front', 'front', 100), foe()], 0);
    const free = track([unit('free', 'free', 100), foe()], 0);
    expect(xs[0]).toBeGreaterThan(free[0]);
    expect(xs[xs.length - 1]).toBeGreaterThan(free[free.length - 1] + 80);
  });

  it('à distance : s’arrête plus loin et recule devant un ennemi qui approche', () => {
    const far = track([unit('rear', 'rear', 400), foe()], 0);
    const free = track([unit('free', 'free', 400), foe()], 0);
    expect(far[far.length - 1]).toBeLessThan(free[free.length - 1]);
    const chaser = foe();
    chaser.stats.speed = 30;
    const xs = track([unit('rear', 'rear', 100), chaser], 0);
    expect(xs[xs.length - 1]).toBeLessThan(Math.max(...xs));
  });

  it('ne s’appliquent qu’une fois débloquées, et les anciennes sauvegardes restent libres', () => {
    const st = squadState(['pistol']);
    st.soldiers[0].position = 'rear';
    expect(activePosition(st, st.soldiers[0])).toBe('free');
    st.campaignLevel = unlockLevel('positions');
    expect(activePosition(st, st.soldiers[0])).toBe('rear');
    const raw = JSON.parse(JSON.stringify(st));
    delete raw.soldiers[0].position;
    expect(parseSave(JSON.stringify(raw))!.soldiers[0].position).toBe('free');
  });
});

describe('élites', () => {
  it('apparaissent à partir du niveau 6 et sont annoncés dans l’aperçu', () => {
    expect(eliteCount(5)).toBe(0);
    expect(eliteCount(6)).toBe(1);
    expect(buildCampaignEnemies(5).some((u) => u.elite)).toBe(false);
    expect(buildCampaignEnemies(12).filter((u) => u.elite)).toHaveLength(eliteCount(12));
    expect(previewCampaign(12).elites.length).toBeGreaterThan(0);
  });
});

describe('étoiles de campagne', () => {
  it('notent la victoire selon les pertes', () => {
    expect(campaignStarsFor(0, 4)).toBe(3);
    expect(campaignStarsFor(2, 4)).toBe(2);
    expect(campaignStarsFor(3, 4)).toBe(1);
  });

  it('ne récompensent que les nouvelles étoiles, et ouvrent des coffres', () => {
    const st = squadState(['railgun', 'railgun', 'railgun'], 30);
    st.campaignLevel = 1;
    for (let l = 1; l <= STAR_CHEST_EVERY / 3; l++) st.campaignStars[l] = 3;
    st.campaignStars[2] = 0;
    const before = st.freePulls;
    const r = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 2 }, 5);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.stars?.got).toBe(3);
    expect(r.report.stars?.gained).toBe(3);
    expect(totalStars(st)).toBe(STAR_CHEST_EVERY);
    expect(r.report.stars?.chests).toBe(1);
    expect(st.freePulls).toBe(before + 1);
    const again = launchBattle(st, { mode: 'campaign', squad: ids(st), level: 2 }, 5);
    if (!again.ok) throw new Error(again.error);
    expect(again.report.stars?.gained).toBe(0);
    expect(again.report.stars?.gold).toBe(0);
  });

  it('les anciennes sauvegardes reçoivent une étoile par niveau terminé', () => {
    const old: Partial<GameState> = { ...createInitialState(), campaignLevel: 13 };
    delete old.campaignStars;
    delete old.starChests;
    const st = parseSave(JSON.stringify(old))!;
    expect(totalStars(st)).toBe(13);
    expect(st.starChests).toBe(Math.floor(13 / STAR_CHEST_EVERY));
  });
});

describe('objectifs', () => {
  it('se réclament une seule fois, une fois atteints', () => {
    const st = createInitialState();
    expect(claimGoal(st, 'win1')).toBeNull();
    st.stats.won = 1;
    expect(claimableGoals(st).map((g) => g.id)).toContain('win1');
    const gold = st.gold;
    expect(claimGoal(st, 'win1')).toEqual({ gold: 60 });
    expect(st.gold).toBe(gold + 60);
    expect(claimGoal(st, 'win1')).toBeNull();
  });
});
