import { describe, expect, it } from 'vitest';
import { simulate, type BattleUnit } from './battle';
import { launchBattle, TOWER_LEGENDARY_EVERY } from './combat';
import { FORGE_FEE, WEAPON_MAX_PLUS, WEAPON_PLUS_DMG, WEAPON_PLUS_MATERIAL, WEAPONS_BY_ID } from './data';
import { biomeFor, chapterOf } from './biomes';
import { buildCampaignEnemies, buildTowerEnemies, isTowerBoss, towerCurses } from './enemies';
import { unlockLevel } from './progress';
import { mulberry32 } from './rng';
import { createSoldier, forgeWeapons, rollWeaponDrop, sellWeapon } from './roster';
import { createInitialState, parseSave, serializeState } from './state';
import { computeStats, powerScore, weaponForSoldier } from './stats';
import { MAX_MERCS, pickBoon, rollBoons } from './survival';
import { TRAITS, TRAITS_BY_ID, traitFor } from './traits';
import { resolveWeapon, upgradeWeapon } from './weapons';
import type { CombatStats, GameState } from './types';

function squadState(n: number, level: number, weapon: string): GameState {
  const st = createInitialState();
  st.weapons = [];
  const rng = mulberry32(5);
  for (let i = 0; i < n; i++) {
    const s = createSoldier(st, 'rare', rng);
    s.level = level;
    st.weapons.push({ uid: `e${i}`, defId: weapon });
    s.weaponUid = `e${i}`;
    st.soldiers.push(s);
  }
  return st;
}

const ids = (st: GameState) => st.soldiers.map((s) => s.id);

const baseStats = (o: Partial<CombatStats> = {}): CombatStats => ({
  maxHp: 100,
  damage: 10,
  range: 200,
  cooldown: 1,
  speed: 0,
  armor: 0,
  crit: 0,
  dodge: 0,
  lifesteal: 0,
  regen: 0,
  aoe: 0,
  ranged: true,
  berserk: false,
  secondWind: false,
  heal: false,
  ...o,
});

const unit = (id: string, team: 'ally' | 'enemy', x: Partial<BattleUnit> = {}, stats: Partial<CombatStats> = {}): BattleUnit => ({
  id,
  team,
  name: id,
  look: { skin: '', hair: '', uniform: '', helmet: '', weaponId: 'pistol' },
  scale: 1,
  stats: baseStats(stats),
  ...x,
});

describe('personnalités', () => {
  it('chaque recrue a un trait, qui modifie ses stats', () => {
    const st = squadState(1, 1, 'pistol');
    const s = st.soldiers[0];
    expect(TRAITS_BY_ID[s.trait]).toBeDefined();
    const plain = computeStats({ ...s, trait: 'myopic' }, WEAPONS_BY_ID.pistol);
    const stoic = computeStats({ ...s, trait: 'stoic' }, WEAPONS_BY_ID.pistol);
    expect(stoic.armor).toBe(plain.armor + 6);
    expect(stoic.damage).toBeCloseTo((plain.damage / 1.1) * 0.94);
    expect(computeStats({ ...s, trait: 'glutton' }, WEAPONS_BY_ID.pistol).maxHp).toBeCloseTo(plain.maxHp * 1.12);
  });

  it('les anciennes sauvegardes reçoivent un trait stable', () => {
    const st = squadState(2, 1, 'pistol');
    const raw = JSON.parse(serializeState());
    const old = JSON.parse(JSON.stringify({ ...raw, soldiers: st.soldiers.map(({ trait: _t, ...rest }) => rest), weapons: st.weapons }));
    const loaded = parseSave(JSON.stringify(old))!;
    for (const s of loaded.soldiers) expect(s.trait).toBe(traitFor(s.id, s.name));
    expect(loaded.towerFloor).toBe(0);
  });

  it('aucun trait ne rend un soldat nettement plus fort qu’un autre', () => {
    const s = squadState(1, 10, 'rifle').soldiers[0];
    const scores = TRAITS.map((t) => powerScore(computeStats({ ...s, trait: t.id }, WEAPONS_BY_ID.rifle)));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const base = powerScore(computeStats({ ...s, trait: undefined as never }, WEAPONS_BY_ID.rifle));
    expect(Math.abs(avg / base - 1)).toBeLessThan(0.03);
    for (const v of scores) expect(Math.abs(v / base - 1)).toBeLessThan(0.08);
  });

  it('tous les traits ont des répliques pour chaque situation', () => {
    for (const t of TRAITS) for (const lines of Object.values(t.lines)) expect(lines.length).toBeGreaterThan(0);
  });
});

describe('armes : préfixes, atelier, mythiques', () => {
  it('un préfixe et les crans d’amélioration modifient l’arme réelle', () => {
    const base = WEAPONS_BY_ID.rifle;
    expect(resolveWeapon({ defId: 'rifle' })).toBe(base);
    const brute = resolveWeapon({ defId: 'rifle', affix: 'brute', plus: 2 });
    expect(brute.damage).toBeCloseTo(base.damage * 1.15 * (1 + 2 * WEAPON_PLUS_DMG));
    expect(brute.name).toBe(`${base.name} de la Brute +2`);
    expect(brute.id).toBe(base.id);
  });

  it('l’atelier améliore contre de l’or, puis contre une arme de même rareté', () => {
    const st = squadState(1, 1, 'rifle');
    st.campaignLevel = unlockLevel('workshop');
    st.gold = 1_000_000;
    const uid = st.weapons[0].uid;
    for (let i = 1; i < WEAPON_PLUS_MATERIAL; i++) expect(upgradeWeapon(st, uid).ok).toBe(true);
    // sans matériau, le cran suivant est refusé
    expect(upgradeWeapon(st, uid).ok).toBe(false);
    st.weapons.push({ uid: 'mat', defId: 'smg' });
    const r = upgradeWeapon(st, uid);
    expect(r.ok && r.consumed).toBe('mat');
    expect(st.weapons.some((w) => w.uid === 'mat')).toBe(false);
    expect(weaponForSoldier(st.soldiers[0], st.weapons).damage).toBeCloseTo(WEAPONS_BY_ID.rifle.damage * (1 + WEAPON_PLUS_MATERIAL * WEAPON_PLUS_DMG));
    st.weapons[0].plus = WEAPON_MAX_PLUS;
    expect(upgradeWeapon(st, uid).ok).toBe(false);
  });

  it('l’atelier reste fermé avant son palier', () => {
    const st = squadState(1, 1, 'rifle');
    st.gold = 10000;
    expect(upgradeWeapon(st, st.weapons[0].uid).ok).toBe(false);
  });

  it('une arme améliorée se revend plus cher', () => {
    const st = squadState(1, 1, 'rifle');
    st.weapons.push({ uid: 'a', defId: 'rifle', plus: 4 });
    const gold = st.gold;
    sellWeapon(st, 'a');
    expect(st.gold - gold).toBe(60);
  });

  it('la forge mythique fond 3 légendaires en une mythique, une fois débloquée', () => {
    const st = createInitialState();
    st.gold = 100000;
    st.weapons = ['minigun', 'railgun', 'katana'].map((defId, i) => ({ uid: `l${i}`, defId }));
    st.campaignLevel = unlockLevel('forge');
    expect(forgeWeapons(st, 'legendary').ok).toBe(false);
    st.campaignLevel = unlockLevel('mythicforge');
    const r = forgeWeapons(st, 'legendary');
    expect(r.ok && WEAPONS_BY_ID[r.weapon.defId].rarity).toBe('mythic');
    expect(r.ok && r.weapon.affix).toBeTruthy();
    expect(st.gold).toBe(100000 - FORGE_FEE.legendary);
  });

  it('un boss ne lâche jamais de mythique', () => {
    for (let i = 0; i < 300; i++) expect(rollWeaponDrop(60, true, mulberry32(i)).rarity).not.toBe('mythic');
  });

  it('le rebond touche plusieurs ennemis proches', () => {
    const a = unit('a', 'ally', {}, { damage: 50, chain: 2, range: 1000 });
    const foes = [0, 1, 2].map((i) => unit(`f${i}`, 'enemy', {}, { damage: 0, maxHp: 1000, range: 10 }));
    const r = simulate([a, ...foes], 3);
    const hurt = new Set(r.frames.flatMap((f) => f.e).filter((e) => e.t === 'hit').map((e) => (e.t === 'hit' ? e.b : -1)));
    expect(hurt.size).toBe(3);
  });

  it('l’exécution achève une cible affaiblie, mais jamais un boss', () => {
    const a = unit('a', 'ally', {}, { damage: 1, execute: 0.5, range: 1000 });
    const weak = unit('w', 'enemy', { hp: 40 }, { damage: 0, maxHp: 100, range: 10 });
    const r = simulate([a, weak], 1);
    expect(r.frames.flatMap((f) => f.e).some((e) => e.t === 'execute')).toBe(true);
    const boss = unit('b', 'enemy', { hp: 40, boss: true }, { damage: 0, maxHp: 100, range: 10 });
    const r2 = simulate([unit('a', 'ally', {}, { damage: 1, execute: 0.5, range: 1000 }), boss], 1);
    expect(r2.frames.flatMap((f) => f.e).some((e) => e.t === 'execute')).toBe(false);
  });

  it('les épines renvoient une part des dégâts', () => {
    const a = unit('a', 'ally', {}, { damage: 100, maxHp: 100000, range: 1000 });
    const thorny = unit('t', 'enemy', {}, { damage: 0, maxHp: 100000, thorns: 0.5, range: 10 });
    const r = simulate([a, thorny], 1);
    expect(r.totals.a.taken).toBeGreaterThan(0);
    expect(r.totals.a.taken).toBeCloseTo(r.totals.t.taken * 0.5, 0);
  });
});

describe('troupes de fin de partie', () => {
  it('la mêlée ignore un drone tant qu’il reste des ennemis au sol', () => {
    const melee = unit('m', 'ally', {}, { damage: 5, range: 30, ranged: false, speed: 80, maxHp: 100000 });
    const drone = unit('d', 'enemy', { flying: true }, { damage: 0, maxHp: 1000, range: 10 });
    const grunt = unit('g', 'enemy', {}, { damage: 0, maxHp: 1000, range: 10 });
    const r = simulate([melee, drone, grunt], 1);
    const firstHit = r.frames.flatMap((f) => f.e).find((e) => e.t === 'hit');
    expect(firstHit && firstHit.t === 'hit' && firstHit.b).toBe(2);
  });

  it('un camoufleur ne peut pas être ciblé avant de tirer', () => {
    const shooter = unit('s', 'ally', {}, { damage: 5, maxHp: 100000, range: 1000 });
    const stalker = unit('c', 'enemy', { stealth: true }, { damage: 1, maxHp: 1000, range: 50, speed: 0 });
    const r = simulate([shooter, stalker], 1);
    // immobile et hors de portée, il ne se dévoile jamais : le combat va au bout du temps sans un tir
    expect(r.frames.flatMap((f) => f.e).some((e) => e.t === 'hit' && e.a === 0)).toBe(false);
    expect(r.winner).toBe('timeout');
  });

  it('un démineur pose des mines qui explosent au passage', () => {
    const runner = unit('r', 'ally', {}, { damage: 1, range: 10, ranged: false, speed: 60, maxHp: 100000 });
    const deminer = unit('d', 'enemy', { mines: { every: 1, dmg: 5, r: 40 } }, { damage: 10, maxHp: 100000, range: 20, ranged: false, speed: 0 });
    const r = simulate([runner, deminer], 1);
    const events = r.frames.flatMap((f) => f.e);
    expect(events.some((e) => e.t === 'mine')).toBe(true);
    expect(events.some((e) => e.t === 'boom')).toBe(true);
  });

  it('apparaissent tard dans la campagne', () => {
    const names = (level: number) => new Set(buildCampaignEnemies(level).map((u) => u.name.replace(" d'élite", '')));
    for (const level of [5, 15, 20]) for (const n of ['Démineur', 'Drone', 'Porte-étendard', 'Camoufleur']) expect(names(level).has(n)).toBe(false);
    const late = new Set<string>();
    for (let level = 33; level < 45; level++) for (const n of names(level)) late.add(n);
    expect(['Démineur', 'Drone', 'Porte-étendard', 'Camoufleur'].filter((n) => late.has(n)).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Tour sans fin', () => {
  it('ajoute une malédiction tous les 5 étages, avec un boss', () => {
    expect(towerCurses(5)).toHaveLength(0);
    expect(towerCurses(6)).toHaveLength(1);
    expect(towerCurses(16)).toHaveLength(3);
    expect(isTowerBoss(10)).toBe(true);
    expect(buildTowerEnemies(10).some((u) => u.boss)).toBe(true);
    // un étage est fixe : on peut s'y préparer
    expect(buildTowerEnemies(7).map((u) => u.name)).toEqual(buildTowerEnemies(7).map((u) => u.name));
  });

  it('monte d’un étage par victoire, sans mort en cas de défaite', () => {
    const st = squadState(6, 30, 'railgun');
    st.campaignLevel = unlockLevel('tower');
    const win = launchBattle(st, { mode: 'tower', squad: ids(st) }, 1);
    expect(win.ok && win.report.won).toBe(true);
    expect(st.towerFloor).toBe(1);

    const weak = squadState(2, 1, 'pistol');
    weak.campaignLevel = unlockLevel('tower');
    weak.towerFloor = TOWER_LEGENDARY_EVERY * 3;
    const loss = launchBattle(weak, { mode: 'tower', squad: ids(weak) }, 1);
    expect(loss.ok && loss.report.won).toBe(false);
    expect(weak.soldiers).toHaveLength(2);
    expect(weak.towerFloor).toBe(TOWER_LEGENDARY_EVERY * 3);
  });

  it('reste verrouillée avant son palier', () => {
    const st = squadState(1, 30, 'railgun');
    st.campaignLevel = unlockLevel('tower') - 1;
    expect(launchBattle(st, { mode: 'tower', squad: ids(st) }, 1).ok).toBe(false);
  });
});

describe('survie roguelite', () => {
  it('applique les bonus choisis, et les mercenaires rejoignent le combat', () => {
    const st = squadState(4, 30, 'railgun');
    st.campaignLevel = unlockLevel('survival');
    const w1 = launchBattle(st, { mode: 'survival', squad: ids(st) }, 1);
    expect(w1.ok && w1.report.survival?.choices).toHaveLength(3);
    st.survival!.choices = ['fury', 'merc', 'medkit'];
    expect(pickBoon(st, 'fury').ok).toBe(true);
    expect(st.survival!.boons).toEqual(['fury']);
    const w2 = launchBattle(st, { mode: 'survival', squad: [] }, 2);
    if (!w2.ok) throw new Error(w2.error);
    const ally = w2.units.find((u) => u.id === st.soldiers[0].id)!;
    expect(ally.stats.damage).toBeGreaterThan(computeStats(st.soldiers[0], WEAPONS_BY_ID.railgun).damage * 1.14);
    st.survival!.choices = ['merc', 'medkit', 'fury'];
    const merc = pickBoon(st, 'merc');
    expect(merc.ok && merc.merc).toBeTruthy();
    const w3 = launchBattle(st, { mode: 'survival', squad: [] }, 3);
    expect(w3.ok && w3.units.some((u) => u.id === st.survival?.mercs[0]?.id || u.name.includes('mercenaire'))).toBe(true);
  });

  it('ne propose plus de mercenaire quand l’expédition est complète', () => {
    const run = { squad: [], wave: 3, pot: 0, hp: {}, boons: [], choices: null, mercs: Array.from({ length: MAX_MERCS }, (_, i) => ({ id: `m${i}`, name: 'M', weaponId: 'rifle', level: 5 })) };
    for (let i = 0; i < 50; i++) expect(rollBoons(run, mulberry32(i))).not.toContain('merc');
  });

  it('refuse un bonus qui n’est pas proposé', () => {
    const st = squadState(1, 30, 'railgun');
    st.survival = { squad: ids(st), wave: 1, pot: 0, hp: {}, boons: [], choices: ['fury', 'focus', 'blast'], mercs: [] };
    expect(pickBoon(st, 'greed').ok).toBe(false);
    expect(pickBoon(st, 'focus').ok).toBe(true);
    expect(pickBoon(st, 'fury').ok).toBe(false);
  });
});

describe('carte de campagne', () => {
  it('découpe la campagne en chapitres de 10 niveaux', () => {
    expect(chapterOf(1)).toBe(0);
    expect(chapterOf(10)).toBe(0);
    expect(chapterOf(11)).toBe(1);
    expect(biomeFor(1).id).toBe('plains');
    expect(biomeFor(25).id).toBe('tundra');
    expect(biomeFor(500).id).toBe('fortress');
  });
});
