import './style.css';
import { dailyDone, totalStars } from './game/combat';
import { claimableGoals } from './game/goals';
import { isUnlocked } from './game/progress';
import { getState, loadState, subscribe } from './game/state';
import { h } from './ui/dom';
import { fmt, refreshModals } from './ui/components';
import { getTab, goTo, initNav, type Tab } from './ui/nav';
import { renderArsenal } from './ui/arsenal';
import { renderCombat } from './ui/combat';
import { renderGuide } from './ui/guide';
import { renderHome } from './ui/home';
import { renderRecruit } from './ui/recruit';
import { renderRoster } from './ui/roster';
import { renderSettings } from './ui/settings';
import type { GameState } from './game/types';

interface TabDef {
  id: Tab;
  label: string;
  icon: string;
  hint: string;
  render: () => HTMLElement;
  badge?: (st: GameState) => { value: number | string; title: string } | null;
}

// Ordre de la boucle de jeu : le QG oriente, puis on gère l'escouade, on combat, et on recrute avec les gains
const TABS: TabDef[] = [
  { id: 'home', label: 'QG', icon: '🏠', hint: 'Prochaine étape, objectifs et accès rapides', render: renderHome, badge: (st) => { const n = claimableGoals(st).length; return n ? { value: n, title: 'Objectifs à réclamer' } : null; } },
  { id: 'roster', label: 'Escouade', icon: '🪖', hint: 'Vos soldats : améliorations et équipement', render: renderRoster, badge: (st) => { const n = st.soldiers.filter((s) => s.picksLeft > 0).length; return n ? { value: n, title: 'Soldats avec des améliorations à choisir' } : null; } },
  { id: 'combat', label: 'Combat', icon: '⚔️', hint: 'Campagne, défi du jour, survie, entraînement', render: renderCombat, badge: (st) => (isUnlocked(st, 'daily') && !dailyDone(st) ? { value: '!', title: 'Défi du jour disponible' } : null) },
  { id: 'recruit', label: 'Recrutement', icon: '🎲', hint: 'Tirer de nouveaux soldats et de nouvelles armes', render: renderRecruit, badge: (st) => (st.freePulls ? { value: st.freePulls, title: 'Tirages gratuits disponibles' } : null) },
  { id: 'arsenal', label: 'Arsenal', icon: '🧰', hint: 'Vos armes : équiper, vendre, forger', render: renderArsenal },
  { id: 'settings', label: 'Infos', icon: '📖', hint: 'Règles, statistiques et sauvegarde', render: renderSettings },
];

loadState();
initNav(getState().soldiers.length === 0 ? 'recruit' : 'home', render);

const root = document.getElementById('app')!;
const navEl = h('nav', { class: 'nav' });
const resourcesEl = h('div', { class: 'resources' });
const titleEl = h('div', { class: 'page-title' });
const mainEl = h('main', { class: 'content' });

root.append(
  h(
    'div',
    { class: 'shell' },
    h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'KT'), h('span', { class: 'brand-name' }, 'Krazy Troopers')), navEl),
    h('div', { class: 'main' }, h('header', { class: 'topbar' }, titleEl, resourcesEl), mainEl),
  ),
);

function resource(icon: string, value: string, title: string, onclick?: () => void): HTMLElement {
  return h('button', { class: `resource${onclick ? ' clickable' : ''}`, title, onclick, disabled: !onclick }, h('span', { class: 'resource-icon' }, icon), h('b', null, value));
}

function render(): void {
  const st = getState();
  const tab = getTab();
  const def = TABS.find((t) => t.id === tab)!;
  titleEl.replaceChildren(h('h1', null, def.label), h('span', { class: 'page-hint' }, def.hint));
  resourcesEl.replaceChildren(
    resource('🪙', fmt(st.gold), 'Or disponible'),
    resource('🎟️', String(st.freePulls), 'Tirages gratuits', st.freePulls > 0 ? () => goTo('recruit') : undefined),
    resource('🚩', String(st.campaignLevel), 'Dernier niveau de campagne terminé'),
    resource('⭐', String(totalStars(st)), 'Étoiles de campagne'),
  );
  navEl.replaceChildren(
    ...TABS.map((t) => {
      const badge = t.badge?.(st);
      return h(
        'button',
        { class: `nav-item${t.id === tab ? ' active' : ''}`, title: t.hint, onclick: () => goTo(t.id) },
        h('span', { class: 'nav-icon' }, t.icon),
        h('span', { class: 'nav-label' }, t.label),
        badge && h('span', { class: 'badge', title: badge.title }, badge.value),
      );
    }),
  );
  const guide = tab === 'home' ? null : renderGuide();
  mainEl.replaceChildren(...(guide ? [guide] : []), def.render());
  refreshModals();
}

subscribe(render);

render();
