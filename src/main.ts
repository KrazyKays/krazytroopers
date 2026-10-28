import './style.css';
import { getState, loadState, subscribe } from './game/state';
import { h } from './ui/dom';
import { fmt, refreshModals } from './ui/components';
import { getTab, goTo, initNav, type Tab } from './ui/nav';
import { renderArsenal } from './ui/arsenal';
import { renderCombat } from './ui/combat';
import { renderGuide } from './ui/guide';
import { renderRecruit } from './ui/recruit';
import { renderRoster } from './ui/roster';
import { renderSettings } from './ui/settings';

// Ordre de la boucle de jeu : gérer l'escouade, combattre, puis recruter et équiper avec les gains
const TABS: { id: Tab; label: string; hint: string; render: () => HTMLElement }[] = [
  { id: 'roster', label: 'Escouade', hint: 'Vos soldats : améliorations et équipement', render: renderRoster },
  { id: 'combat', label: 'Combat', hint: 'Entraînement, campagne et simulation', render: renderCombat },
  { id: 'recruit', label: 'Recruter', hint: 'Tirer de nouveaux soldats et de nouvelles armes', render: renderRecruit },
  { id: 'arsenal', label: 'Arsenal', hint: 'Vos armes : équipées ou à vendre', render: renderArsenal },
  { id: 'settings', label: 'Infos', hint: 'Règles, statistiques et sauvegarde', render: renderSettings },
];

loadState();
initNav(getState().soldiers.length === 0 ? 'recruit' : 'roster', render);

const root = document.getElementById('app')!;
const hudEl = h('div', { class: 'hud' });
const tabsEl = h('nav', { class: 'tabs' });
const mainEl = h('main', { class: 'content' });

root.append(h('header', { class: 'topbar' }, h('h1', null, 'Krazy Troopers'), hudEl), tabsEl, mainEl);

function render(): void {
  const st = getState();
  const tab = getTab();
  hudEl.replaceChildren(
    h('span', { class: 'hud-item', title: 'Soldats dans l’escouade' }, `${st.soldiers.length} soldat${st.soldiers.length > 1 ? 's' : ''}`),
    h('span', { class: 'hud-item', title: 'Dernier niveau de campagne terminé' }, `Campagne ${st.campaignLevel}`),
    h('span', { class: 'gold', title: 'Or disponible' }, `${fmt(st.gold)} or`),
  );
  tabsEl.replaceChildren(
    ...TABS.map((t) => {
      const badge = t.id === 'roster' ? st.soldiers.reduce((n, s) => n + (s.picksLeft > 0 ? 1 : 0), 0) : t.id === 'recruit' ? st.freePulls : 0;
      const badgeTitle = t.id === 'roster' ? 'Soldats avec des améliorations à choisir' : 'Tirages gratuits disponibles';
      return h(
        'button',
        { class: `tab${t.id === tab ? ' active' : ''}`, title: t.hint, onclick: () => goTo(t.id) },
        t.label,
        badge > 0 && h('span', { class: 'badge', title: badgeTitle }, badge),
      );
    }),
  );
  const guide = renderGuide();
  mainEl.replaceChildren(...(guide ? [guide] : []), TABS.find((t) => t.id === tab)!.render());
  refreshModals();
}

subscribe(render);

render();
