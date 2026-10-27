import { PITY_LIMIT, PULL10_COST, PULL_COST, RARITIES } from '../game/data';
import { recruit } from '../game/roster';
import { getState, mutate } from '../game/state';
import type { Soldier } from '../game/types';
import { h } from './dom';
import { openModal, soldierCard, toast } from './components';
import { openSoldier } from './roster';

let lastPull: Soldier[] = [];

function doPull(mode: 'free' | 'one' | 'ten'): void {
  const result = mutate((st) => recruit(st, mode));
  if (!result.ok) {
    toast(result.error, 'bad');
    return;
  }
  lastPull = result.soldiers;
  const best = result.soldiers.reduce((a, b) => (RARITIES[b.rarity].statMult > RARITIES[a.rarity].statMult ? b : a));
  if (best.rarity === 'legendary') toast(`Légendaire ! ${best.name} rejoint l'escouade !`, 'good');
  showReveal();
}

function showReveal(): void {
  openModal((close) => {
    const st = getState();
    const cards = lastPull.map((s, i) => {
      const live = st.soldiers.find((x) => x.id === s.id) ?? s;
      const card = soldierCard(st, live, {
        onclick: () => {
          close();
          openSoldier(live.id);
        },
      });
      card.classList.add('reveal');
      card.style.animationDelay = `${i * 120}ms`;
      return card;
    });
    return h(
      'div',
      { class: 'detail' },
      h('button', { class: 'modal-close', onclick: close, title: 'Fermer' }, '×'),
      h('h2', null, lastPull.length > 1 ? 'Nouvelles recrues' : 'Nouvelle recrue'),
      h('p', { class: 'muted' }, 'Cliquez sur une recrue pour choisir ses améliorations.'),
      h('div', { class: `grid reveal-grid${lastPull.length === 1 ? ' single' : ''}` }, cards),
      h('div', { class: 'detail-actions' }, h('button', { class: 'btn', onclick: close }, 'Continuer')),
    );
  });
}

export function renderRecruit(): HTMLElement {
  const st = getState();
  const toPity = PITY_LIMIT - 1 - st.pity;
  return h(
    'section',
    null,
    h('h2', null, 'Recrutement'),
    h('p', { class: 'muted' }, 'Tirez de nouveaux soldats au hasard. Plus la rareté est élevée, plus ils sont solides.'),
    h(
      'div',
      { class: 'recruit-box' },
      h(
        'button',
        { class: 'btn btn-big btn-gold', disabled: !st.freePull, onclick: () => doPull('free') },
        st.freePull ? 'Tirage gratuit du jour' : 'Tirage gratuit déjà utilisé',
      ),
      h('button', { class: 'btn btn-big', disabled: st.gold < PULL_COST, onclick: () => doPull('one') }, `Recruter x1 (${PULL_COST} or)`),
      h('button', { class: 'btn btn-big', disabled: st.gold < PULL10_COST, onclick: () => doPull('ten') }, `Recruter x10 (${PULL10_COST} or)`),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', null, 'Probabilités'),
      h(
        'ul',
        { class: 'rates' },
        (Object.keys(RARITIES) as (keyof typeof RARITIES)[]).map((r) =>
          h('li', null, h('b', { style: `color:${RARITIES[r].color}` }, RARITIES[r].label), ` : ${RARITIES[r].rate} %`),
        ),
      ),
      h('p', { class: 'muted small' }, `Garantie : un soldat Épique ou mieux est assuré tous les ${PITY_LIMIT} tirages (encore ${toPity + 1} tirage${toPity > 0 ? 's' : ''} maximum).`),
      h('p', { class: 'muted small' }, "Chaque soldat recruté reçoit 3 choix d'amélioration parmi 3 propositions. L'or provient des combats ; un tirage gratuit est offert chaque jour."),
    ),
  );
}
