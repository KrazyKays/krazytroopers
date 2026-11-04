import { describe, expect, it } from 'vitest';
import { launchBattle } from './combat';
import { claimGoal } from './goals';
import { mulberry32 } from './rng';
import { equipWeapon, recruit } from './roster';
import { createInitialState, parseSave } from './state';
import { soldierToPrepare, tutorialStep } from './tutorial';
import { pickUpgrade } from './upgrades';
import type { GameState } from './types';

/** Prépare entièrement le prochain soldat, comme le joueur guidé. */
function prepare(st: GameState): void {
  const equipped = () => new Set(st.soldiers.map((s) => s.weaponUid));
  for (let todo = soldierToPrepare(st); todo; todo = soldierToPrepare(st)) {
    if (todo.need === 'pick') pickUpgrade(st, todo.soldier.id, todo.soldier.upgradeChoices![0]);
    else equipWeapon(st, todo.soldier.id, st.weapons.find((w) => !equipped().has(w.uid))!.uid);
  }
}

function readySquad(seed: number): GameState {
  const st = createInitialState();
  const rng = mulberry32(seed);
  for (let i = 0; i < 3; i++) recruit(st, 'free', rng);
  prepare(st);
  return st;
}

describe('tutoriel', () => {
  it('enchaîne les étapes de la nouvelle partie à la première victoire', () => {
    const st = createInitialState();
    const rng = mulberry32(7);
    expect(tutorialStep(st)).toBe('intro');
    st.tutorial!.introDone = true;
    expect(tutorialStep(st)).toBe('pull');

    recruit(st, 'free', rng);
    expect(tutorialStep(st)).toBe('soldier');
    expect(soldierToPrepare(st)?.need).toBe('pick');
    pickUpgrade(st, st.soldiers[0].id, st.soldiers[0].upgradeChoices![0]);
    expect(soldierToPrepare(st)?.need).toBe('weapon');
    equipWeapon(st, st.soldiers[0].id, st.weapons[0].uid);

    // Les recrues suivantes attendent la fin des tirages pour être préparées
    expect(tutorialStep(st)).toBe('pull');
    recruit(st, 'free', rng);
    expect(tutorialStep(st)).toBe('pull');
    recruit(st, 'free', rng);
    expect(tutorialStep(st)).toBe('soldier');
    prepare(st);
    expect(tutorialStep(st)).toBe('fight');

    st.stats.won = 1;
    expect(tutorialStep(st)).toBe('goal');
    expect(claimGoal(st, 'win1')).not.toBeNull();
    expect(tutorialStep(st)).toBe('end');
    st.tutorial = null;
    expect(tutorialStep(st)).toBeNull();
  });

  it('a de quoi armer les trois premières recrues', () => {
    const st = readySquad(1);
    expect(st.soldiers).toHaveLength(3);
    expect(st.soldiers.every((s) => s.weaponUid && s.picksLeft === 0)).toBe(true);
  });

  it('ne fait pas repasser par la préparation si la victoire rapporte une amélioration', () => {
    const st = readySquad(2);
    st.tutorial!.introDone = true;
    st.stats.won = 1;
    st.soldiers[0].picksLeft = 1;
    st.soldiers[0].upgradeChoices = ['x'];
    expect(tutorialStep(st)).toBe('goal');
  });

  it('un niveau 1 perdu ne coûte aucun soldat et le tutoriel propose de retenter', () => {
    let wins = 0;
    const runs = 200;
    for (let seed = 1; seed <= runs; seed++) {
      const st = readySquad(seed);
      st.tutorial!.introDone = true;
      const res = launchBattle(st, { mode: 'campaign', level: 1, squad: st.soldiers.map((s) => s.id) }, seed);
      if (!res.ok) throw new Error(res.error);
      expect(st.soldiers).toHaveLength(3);
      expect(st.pendingLoss).toBeNull();
      if (res.report.won) {
        wins++;
        expect(res.report.weapon).toBeTruthy();
        expect(tutorialStep(st)).toBe('goal');
      } else expect(tutorialStep(st)).toBe('fight');
    }
    expect(wins / runs).toBeGreaterThan(0.9);
  });

  it('ne se déclenche pas sur une sauvegarde déjà entamée', () => {
    const old = readySquad(3) as Partial<GameState>;
    delete old.tutorial;
    expect(parseSave(JSON.stringify(old))!.tutorial).toBeNull();
  });

  it('se déclenche sur une ancienne sauvegarde encore vierge, et reprend là où il en était', () => {
    const blank = createInitialState() as Partial<GameState>;
    delete blank.tutorial;
    expect(parseSave(JSON.stringify(blank))!.tutorial).toEqual({ introDone: false });

    const running = createInitialState();
    running.tutorial = { introDone: true };
    expect(parseSave(JSON.stringify(running))!.tutorial).toEqual({ introDone: true });

    running.tutorial = null;
    expect(parseSave(JSON.stringify(running))!.tutorial).toBeNull();
  });
});
