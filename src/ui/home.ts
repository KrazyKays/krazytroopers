import { dailyDone } from '../game/combat';
import { dailyKey, dailyModifier, previewCampaign } from '../game/enemies';
import { claimableGoals, claimGoal, GOALS, openGoals, rewardLabel, type GoalDef } from '../game/goals';
import { isUnlocked, nextUnlock } from '../game/progress';
import { biomeFor } from '../game/biomes';
import { sortSquad } from '../game/roster';
import { getState, mutate } from '../game/state';
import type { GameState } from '../game/types';
import { openCombat, type CombatMode } from './combat';
import { fmt, fold, progressBar, soldierSprite, toast } from './components';
import { h } from './dom';
import { nextStep } from './guide';
import { goTo } from './nav';
import { openSoldier } from './roster';

function heroCard(st: GameState): HTMLElement {
  const step = nextStep(st);
  if (!step) {
    return h('div', { class: 'hero' }, h('div', { class: 'hero-icon' }, '🎖️'), h('div', { class: 'hero-body' }, h('h2', null, 'Mission accomplie'), h('p', null, `Toutes les fonctionnalités sont débloquées. Grimpez dans la Tour sans fin (record : étage ${st.towerFloor}), forgez des armes mythiques et poussez la campagne toujours plus loin !`)));
  }
  return h(
    'div',
    { class: 'hero' },
    h('div', { class: 'hero-icon' }, step.icon),
    h('div', { class: 'hero-body' }, h('span', { class: 'eyebrow' }, 'Prochaine étape'), h('h2', null, step.title), h('p', null, step.text)),
    step.action && h('button', { class: 'btn btn-primary btn-big', onclick: step.action.run }, step.action.label, ' →'),
  );
}

function modeCard(o: { icon: string; title: string; line: string; mode: CombatMode; tag?: string }): HTMLElement {
  return h(
    'button',
    { class: 'quick-card', onclick: () => openCombat(o.mode) },
    h('span', { class: 'quick-icon' }, o.icon),
    h('span', { class: 'quick-text' }, h('b', null, o.title), h('small', { class: 'muted' }, o.line)),
    o.tag && h('span', { class: 'tag tag-accent' }, o.tag),
  );
}

/** La campagne domine l'écran ; les modes annexes n'apparaissent qu'une fois débloqués, sur une seule ligne chacun. */
function missions(st: GameState): HTMLElement {
  const next = st.campaignLevel + 1;
  const prev = previewCampaign(next);
  const free = st.soldiers.reduce((n, s) => n + s.trainingsLeft, 0);
  const unlock = nextUnlock(st);
  return h(
    'div',
    { class: 'missions' },
    h(
      'button',
      { class: `mission-main${prev.boss ? ' boss' : ''}`, onclick: () => openCombat('campaign') },
      h('span', { class: 'mission-eyebrow' }, prev.boss ? '☠ Boss' : '🚩 Campagne', ` · ${biomeFor(next).icon} ${biomeFor(next).name}`),
      h('b', { class: 'mission-title' }, `Niveau ${next}`),
      h('span', { class: 'muted' }, `${prev.count} ennemis${prev.elites.length > 0 ? `, dont ${prev.elites.length} élite${prev.elites.length > 1 ? 's' : ''}` : ''}`),
      h('span', { class: 'btn btn-primary btn-big mission-cta' }, 'Préparer le combat →'),
    ),
    h(
      'div',
      { class: 'quick-grid' },
      isUnlocked(st, 'daily') && modeCard({ icon: '📅', title: 'Défi du jour', mode: 'daily', tag: dailyDone(st) ? undefined : 'NOUVEAU', line: dailyDone(st) ? 'Revenez demain' : `« ${dailyModifier(dailyKey()).name} »` }),
      isUnlocked(st, 'survival') && modeCard({ icon: '🔥', title: 'Survie', mode: 'survival', tag: st.survival?.choices ? 'BONUS' : st.survival ? 'EN COURS' : undefined, line: st.survival ? `Pot : ${fmt(st.survival.pot)} or` : `Record : vague ${st.bestWave}` }),
      isUnlocked(st, 'tower') && modeCard({ icon: '🗼', title: 'Tour sans fin', mode: 'tower', line: `Étage ${st.towerFloor + 1} · record ${st.towerFloor}` }),
      modeCard({ icon: '🎯', title: 'Entraînement', mode: 'training', line: free > 0 ? `${free} gratuit${free > 1 ? 's' : ''}` : 'Sans danger, pour l’XP' }),
      unlock && h('div', { class: 'quick-card next-unlock', title: unlock.desc }, h('span', { class: 'quick-icon' }, '🔓'), h('span', { class: 'quick-text' }, h('b', null, unlock.label), h('small', { class: 'muted' }, `Au niveau ${unlock.level} de la campagne`))),
    ),
  );
}

function goalRow(st: GameState, g: GoalDef, claimable: boolean): HTMLElement {
  const p = Math.min(g.progress(st), g.need);
  return h(
    'div',
    { class: `goal${claimable ? ' goal-ready' : ''}` },
    h('span', { class: 'goal-icon' }, claimable ? '🏆' : '🎯'),
    h('div', { class: 'goal-body' }, h('b', null, g.label), h('span', { class: 'muted small' }, g.desc), !claimable && progressBar(p / g.need, `${fmt(p)} / ${fmt(g.need)}`)),
    claimable
      ? h('button', { class: 'btn btn-primary btn-small', onclick: () => { const r = mutate((s) => claimGoal(s, g.id)); if (r) toast(`Récompense : ${rewardLabel(r)} !`, 'good'); } }, `Réclamer · ${rewardLabel(g.reward)}`)
      : h('span', { class: 'goal-reward' }, rewardLabel(g.reward)),
  );
}

function goalsPanel(st: GameState): HTMLElement {
  const ready = claimableGoals(st);
  const open = openGoals(st);
  // Une récompense à réclamer passe avant tout ; sinon, seul l'objectif le plus proche reste en vue
  const shown = ready.length > 0 ? [] : open.slice(0, 1);
  const rest = ready.length > 0 ? open : open.slice(1);
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h3', null, '🏆 Objectifs'), h('span', { class: 'muted small' }, `${st.claimedGoals.length} / ${GOALS.length}`)),
    h('div', { class: 'goal-list' }, ready.slice(0, 2).map((g) => goalRow(st, g, true)), shown.map((g) => goalRow(st, g, false))),
    rest.length > 0 && fold('goals', `Voir les ${rest.length} autres objectifs`, h('div', { class: 'goal-list' }, rest.map((g) => goalRow(st, g, false)))),
    ready.length === 0 && open.length === 0 && h('p', { class: 'muted' }, 'Tous les objectifs sont accomplis. Bravo !'),
  );
}

function squadPanel(st: GameState): HTMLElement {
  const top = sortSquad(st, 'dps').slice(0, 6);
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h3', null, '🪖 Escouade'), h('button', { class: 'btn btn-ghost btn-small', onclick: () => goTo('roster') }, 'Gérer →')),
    st.soldiers.length === 0
      ? h('div', { class: 'empty' }, h('p', null, 'Aucun soldat pour l’instant.'), h('button', { class: 'btn btn-primary', onclick: () => goTo('recruit') }, 'Recruter'))
      : h('div', { class: 'mini-squad' }, top.map((s) => h('button', { class: `mini-soldier rarity-${s.rarity}`, title: `${s.name} · Niv. ${s.level}`, onclick: () => openSoldier(s.id) }, soldierSprite(st, s), h('span', null, `Niv. ${s.level}`)))),
  );
}

export function renderHome(): HTMLElement {
  const st = getState();
  return h(
    'section',
    { class: 'home' },
    heroCard(st),
    missions(st),
    h('div', { class: 'home-cols' }, goalsPanel(st), squadPanel(st)),
  );
}
