import { describe, expect, it } from 'vitest';
import { simulate, type BattleUnit } from './battle';
import { campaignStarsFor, launchBattle, squadStats, totalStars } from './combat';
import { STAR_CHEST_EVERY, WEAPONS_BY_ID } from './data';
import { buildCampaignEnemies, eliteCount, previewCampaign } from './enemies';
import { claimGoal, claimableGoals } from './goals';
import { unlockLevel } from './progress';
import { mulberry32 } from './rng';
import { createSoldier } from './roster';
import { synergyStatus } from './squad';
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
    expect(st.starChests).toBe(1);
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
