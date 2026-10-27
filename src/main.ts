import './style.css';
import { getState, loadState, subscribe } from './game/state';
import { h } from './ui/dom';
import { fmt, refreshModals } from './ui/components';
import { renderArsenal } from './ui/arsenal';
import { renderCombat } from './ui/combat';
import { renderRecruit } from './ui/recruit';
import { renderRoster } from './ui/roster';
import { renderSettings } from './ui/settings';

type Tab = 'roster' | 'recruit' | 'combat' | 'arsenal' | 'settings';

const TABS: { id: Tab; label: string; render: () => HTMLElement }[] = [
  { id: 'roster', label: 'Escouade', render: renderRoster },
  { id: 'recruit', label: 'Recruter', render: renderRecruit },
  { id: 'combat', label: 'Combat', render: renderCombat },
  { id: 'arsenal', label: 'Arsenal', render: renderArsenal },
  { id: 'settings', label: 'Infos', render: renderSettings },
];

loadState();
let tab: Tab = getState().soldiers.length === 0 ? 'recruit' : 'roster';

const root = document.getElementById('app')!;
const goldEl = h('span', { class: 'gold' });
const tabsEl = h('nav', { class: 'tabs' });
const mainEl = h('main', { class: 'content' });

root.append(
  h('header', { class: 'topbar' }, h('h1', null, 'Krazy Troopers'), h('div', { class: 'hud' }, goldEl)),
  tabsEl,
  mainEl,
);

function render(): void {
  const st = getState();
  goldEl.textContent = `${fmt(st.gold)} or`;
  tabsEl.replaceChildren(
    ...TABS.map((t) => {
      const badge = t.id === 'roster' ? st.soldiers.reduce((n, s) => n + (s.picksLeft > 0 ? 1 : 0), 0) : t.id === 'recruit' && st.freePulls > 0 ? 1 : 0;
      return h(
        'button',
        {
          class: `tab${t.id === tab ? ' active' : ''}`,
          onclick: () => {
            tab = t.id;
            render();
          },
        },
        t.label,
        badge > 0 && h('span', { class: 'badge' }, badge),
      );
    }),
  );
  mainEl.replaceChildren(TABS.find((t) => t.id === tab)!.render());
  refreshModals();
}

subscribe(render);

render();
