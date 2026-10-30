export type Tab = 'home' | 'roster' | 'recruit' | 'combat' | 'arsenal' | 'settings';

let current: Tab = 'home';
let onChange: () => void = () => {};

export function getTab(): Tab {
  return current;
}

// main.ts branche ici son rendu : les écrans peuvent ainsi proposer un lien direct vers un autre onglet
export function initNav(tab: Tab, render: () => void): void {
  current = tab;
  onChange = render;
}

export function goTo(tab: Tab): void {
  current = tab;
  window.scrollTo(0, 0);
  onChange();
}
