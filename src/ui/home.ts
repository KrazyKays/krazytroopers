import { dailyDone, totalStars } from '../game/combat';
import { STAR_CHEST_EVERY } from '../game/data';
import { dailyKey, dailyLevel, dailyModifier, isBossLevel, previewCampaign } from '../game/enemies';
import { claimableGoals, claimGoal, GOALS, openGoals, rewardLabel, type GoalDef } from '../game/goals';
import { isUnlocked, nextUnlock, squadMax, unlockLevel } from '../game/progress';
import { barracksCap, sortSquad } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import type { GameState } from '../game/types';
import { openCombat, type CombatMode } from './combat';
import { fmt, progressBar, soldierSprite, toast } from './components';
import { h } from './dom';
import { nextStep } from './guide';
import { goTo } from './nav';
import { openSoldier } from './roster';

let showAllGoals = false;

function heroCard(st: GameState): HTMLElement {
  const step = nextStep(st);
  if (!step) {
    return h('div', { class: 'hero' }, h('div', { class: 'hero-icon' }, '🎖️'), h('div', { class: 'hero-body' }, h('h2', null, 'Mission accomplie'), h('p', null, 'Toutes les fonctionnalités sont débloquées. Visez les 3 étoiles partout et les objectifs restants !')));
  }
  return h(
    'div',
    { class: 'hero' },
    h('div', { class: 'hero-icon' }, step.icon),
    h('div', { class: 'hero-body' }, h('span', { class: 'eyebrow' }, 'Prochaine étape'), h('h2', null, step.title), h('p', null, step.text)),
    step.action && h('button', { class: 'btn btn-primary btn-big', onclick: step.action.run }, step.action.label, ' →'),
  );
}

function modeCard(o: { icon: string; title: string; lines: (string | HTMLElement | false)[]; cta: string; mode: CombatMode; locked?: string; highlight?: boolean; tag?: string }): HTMLElement {
  return h(
    'button',
    { class: `quick-card${o.locked ? ' locked' : ''}${o.highlight ? ' highlight' : ''}`, onclick: () => openCombat(o.mode) },
    h('div', { class: 'quick-head' }, h('span', { class: 'quick-icon' }, o.locked ? '🔒' : o.icon), h('b', null, o.title), o.tag && h('span', { class: 'tag tag-accent' }, o.tag)),
    h('div', { class: 'quick-lines' }, o.locked ? h('span', { class: 'muted' }, o.locked) : o.lines.filter(Boolean).map((l) => h('span', null, l))),
    h('span', { class: 'quick-cta' }, o.locked ? 'Voir' : o.cta, ' →'),
  );
}

function quickCards(st: GameState): HTMLElement {
  const next = st.campaignLevel + 1;
  const prev = previewCampaign(next);
  const free = st.soldiers.reduce((n, s) => n + s.trainingsLeft, 0);
  const daily = isUnlocked(st, 'daily');
  const surv = isUnlocked(st, 'survival');
  return h(
    'div',
    { class: 'quick-grid' },
    modeCard({
      icon: '🚩',
      title: 'Campagne',
      mode: 'campaign',
      tag: prev.boss ? 'BOSS' : undefined,
      highlight: true,
      lines: [`Niveau ${next} · ${prev.count} ennemis`, prev.elites.length > 0 && `${prev.elites.length} élite${prev.elites.length > 1 ? 's' : ''} : ${prev.elites.map((e) => e.name).join(', ')}`, progressBar((totalStars(st) % STAR_CHEST_EVERY) / STAR_CHEST_EVERY, `Coffre d'étoiles : ${totalStars(st) % STAR_CHEST_EVERY} / ${STAR_CHEST_EVERY} ★`)],
      cta: 'Préparer',
    }),
    modeCard({
      icon: '📅',
      title: 'Défi du jour',
      mode: 'daily',
      locked: daily ? undefined : `Niveau ${unlockLevel('daily')} de la campagne`,
      tag: daily && !dailyDone(st) ? 'NOUVEAU' : undefined,
      lines: [`« ${dailyModifier(dailyKey()).name} » · puissance ${dailyLevel(st.campaignLevel)}`, dailyDone(st) ? 'Déjà tenté : revenez demain' : 'Une tentative, grosses récompenses', st.dailyStreak > 0 && `Série : ${st.dailyStreak} jour${st.dailyStreak > 1 ? 's' : ''}`],
      cta: dailyDone(st) ? 'Voir' : 'Relever',
    }),
    modeCard({
      icon: '🔥',
      title: 'Survie',
      mode: 'survival',
      locked: surv ? undefined : `Niveau ${unlockLevel('survival')} de la campagne`,
      tag: st.survival ? 'EN COURS' : undefined,
      lines: st.survival ? [`Vague ${st.survival.wave} remportée`, `Pot : ${fmt(st.survival.pot)} or`] : ['Enchaînez les vagues', `Record : vague ${st.bestWave}`],
      cta: st.survival ? 'Continuer' : 'Partir',
    }),
    modeCard({
      icon: '🎯',
      title: 'Entraînement',
      mode: 'training',
      lines: ['Sans danger, pour l’XP', `${free} entraînement${free > 1 ? 's' : ''} gratuit${free > 1 ? 's' : ''} dans l’escouade`],
      cta: "S'entraîner",
    }),
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
  const shown = showAllGoals ? open : open.slice(0, Math.max(0, 3 - Math.min(ready.length, 2)));
  const done = st.claimedGoals.length;
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h3', null, '🏆 Objectifs'), h('span', { class: 'muted small' }, `${done} / ${GOALS.length} accomplis`)),
    h('div', { class: 'goal-list' }, ready.map((g) => goalRow(st, g, true)), shown.map((g) => goalRow(st, g, false))),
    open.length > 3 && h('button', { class: 'btn btn-ghost btn-small', onclick: () => { showAllGoals = !showAllGoals; refresh(); } }, showAllGoals ? 'Réduire' : `Voir les ${open.length} objectifs en cours`),
    ready.length === 0 && open.length === 0 && h('p', { class: 'muted' }, 'Tous les objectifs sont accomplis. Bravo !'),
  );
}

function squadPanel(st: GameState): HTMLElement {
  const top = sortSquad(st, 'dps').slice(0, 6);
  const pending = st.soldiers.filter((s) => s.picksLeft > 0).length;
  const unarmed = st.soldiers.filter((s) => !s.weaponUid).length;
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h3', null, '🪖 Escouade'), h('button', { class: 'btn btn-ghost btn-small', onclick: () => goTo('roster') }, 'Gérer →')),
    st.soldiers.length === 0
      ? h('div', { class: 'empty' }, h('p', null, 'Aucun soldat pour l’instant.'), h('button', { class: 'btn btn-primary', onclick: () => goTo('recruit') }, 'Recruter'))
      : [
          h('div', { class: 'mini-squad' }, top.map((s) => h('button', { class: `mini-soldier rarity-${s.rarity}`, title: `${s.name} · Niv. ${s.level}`, onclick: () => openSoldier(s.id) }, soldierSprite(st, s), h('span', null, `Niv. ${s.level}`)))),
          h(
            'div',
            { class: 'kpis' },
            h('div', { class: 'kpi' }, h('b', null, `${st.soldiers.length}/${barracksCap(st)}`), h('span', null, 'caserne')),
            h('div', { class: 'kpi' }, h('b', null, `${squadMax(st)}`), h('span', null, 'par combat')),
            h('div', { class: `kpi${pending ? ' kpi-warn' : ''}` }, h('b', null, String(pending)), h('span', null, 'à améliorer')),
            h('div', { class: `kpi${unarmed ? ' kpi-warn' : ''}` }, h('b', null, String(unarmed)), h('span', null, 'sans arme')),
          ),
        ],
  );
}

function progressPanel(st: GameState): HTMLElement {
  const next = nextUnlock(st);
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h3', null, '🔓 Progression')),
    next
      ? [
          h('p', null, h('b', null, next.label), h('span', { class: 'muted' }, ` — ${next.desc}`)),
          progressBar(st.campaignLevel / next.level, `Campagne ${st.campaignLevel} / ${next.level}`),
        ]
      : h('p', { class: 'muted' }, 'Toutes les fonctionnalités sont débloquées.'),
    h(
      'div',
      { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', null, fmt(st.stats.won)), h('span', null, 'victoires')),
      h('div', { class: 'kpi' }, h('b', null, fmt(st.stats.kills)), h('span', null, 'éliminations')),
      h('div', { class: 'kpi' }, h('b', null, String(totalStars(st))), h('span', null, 'étoiles')),
      h('div', { class: 'kpi' }, h('b', null, String(st.bestWave)), h('span', null, 'record survie')),
    ),
    isBossLevel(st.campaignLevel + 1) && h('p', { class: 'note note-warn' }, '☠ Le prochain niveau de campagne est un boss : préparez-vous !'),
  );
}

export function renderHome(): HTMLElement {
  const st = getState();
  return h(
    'section',
    { class: 'home' },
    heroCard(st),
    h('h2', { class: 'section-title' }, 'Missions'),
    quickCards(st),
    h('div', { class: 'home-cols' }, goalsPanel(st), h('div', { class: 'stack' }, squadPanel(st), progressPanel(st))),
  );
}
