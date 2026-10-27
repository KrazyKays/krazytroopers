import { RARITIES, UPGRADES_BY_ID, WEAPONS_BY_ID } from '../game/data';
import { isAvailable, refresh } from '../game/state';
import { soldierLook } from '../game/look';
import { computeStats, dps, weaponForSoldier, xpForNext } from '../game/stats';
import { SQUAD_SORTS, type SquadSort } from '../game/roster';
import { MAX_LEVEL } from '../game/data';
import type { GameState, Soldier, WeaponDef } from '../game/types';
import { spriteSvg, weaponSvg } from './avatar';
import { h, html } from './dom';

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export const fmt = (n: number, digits = 0): string => n.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function rarityTag(rarity: keyof typeof RARITIES): HTMLElement {
  return h('span', { class: 'rarity-tag', style: `color:${RARITIES[rarity].color}` }, RARITIES[rarity].label);
}

export function soldierSprite(st: GameState, s: Soldier, cls = 'sprite'): HTMLElement {
  return html(spriteSvg(soldierLook(s, weaponForSoldier(s, st.weapons)), cls));
}

export function weaponIcon(w: WeaponDef): HTMLElement {
  return html(weaponSvg(w));
}

export function xpBar(s: Soldier): HTMLElement {
  const max = s.level >= MAX_LEVEL;
  const pct = max ? 100 : (s.xp / xpForNext(s.level)) * 100;
  return h(
    'div',
    { class: 'xpbar', title: max ? 'Niveau maximum' : `${fmt(s.xp)} / ${fmt(xpForNext(s.level))} XP` },
    h('div', { class: 'xpbar-fill', style: `width:${pct}%` }),
  );
}

export function statusPill(s: Soldier, weapon: WeaponDef): HTMLElement {
  if (!isAvailable(s)) return h('span', { class: 'pill pill-dead' }, 'Hors de combat jusqu’à demain');
  if (s.picksLeft > 0) return h('span', { class: 'pill pill-pick' }, `${s.picksLeft} amélioration${s.picksLeft > 1 ? 's' : ''} à choisir`);
  return h('span', { class: 'pill' }, weapon.name);
}

export function soldierCard(st: GameState, s: Soldier, opts: { onclick?: () => void; selected?: boolean; disabled?: boolean } = {}): HTMLElement {
  const weapon = weaponForSoldier(s, st.weapons);
  const stats = computeStats(s, weapon);
  const dead = !isAvailable(s);
  return h(
    'div',
    {
      class: `card rarity-${s.rarity}${opts.selected ? ' selected' : ''}${dead ? ' dead' : ''}${opts.onclick ? ' clickable' : ''}`,
      style: `--rc:${RARITIES[s.rarity].color}`,
      onclick: opts.onclick ? () => opts.onclick!() : undefined,
    },
    h('div', { class: 'card-portrait' }, soldierSprite(st, s)),
    h(
      'div',
      { class: 'card-body' },
      h('div', { class: 'card-name' }, s.favorite && h('span', { class: 'fav-star', title: 'Favori' }, '★ '), s.name),
      h('div', { class: 'card-sub' }, rarityTag(s.rarity), ` · Niv. ${s.level}`),
      xpBar(s),
      h('div', { class: 'card-stats' }, `PV ${fmt(stats.maxHp)} · DPS ${fmt(dps(stats), 1)}`),
      statusPill(s, weapon),
    ),
  );
}

let squadSort: SquadSort = 'level';

export function getSquadSort(): SquadSort {
  return squadSort;
}

export function sortBar(): HTMLElement {
  return h(
    'div',
    { class: 'subtabs' },
    SQUAD_SORTS.map((o) =>
      h('button', { class: `subtab${o.key === squadSort ? ' active' : ''}`, onclick: () => { squadSort = o.key; refresh(); } }, o.label),
    ),
  );
}

export function upgradeLabel(id: string): string {
  return UPGRADES_BY_ID[id]?.name ?? id;
}

export function weaponName(defId: string): string {
  return WEAPONS_BY_ID[defId]?.name ?? defId;
}

interface ModalHandle {
  close: () => void;
  refresh: () => void;
}

const openModals = new Set<ModalHandle>();

export function openModal(render: (close: () => void) => HTMLElement, onClose?: () => void): ModalHandle {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: 'modal' });
  backdrop.appendChild(box);
  const handle: ModalHandle = {
    close: () => {
      if (!openModals.has(handle)) return;
      openModals.delete(handle);
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      onClose?.();
    },
    refresh: () => {
      const scroll = box.scrollTop;
      box.replaceChildren(render(handle.close));
      box.scrollTop = scroll;
    },
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handle.close();
  };
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) handle.close();
  });
  document.addEventListener('keydown', onKey);
  openModals.add(handle);
  handle.refresh();
  document.body.appendChild(backdrop);
  return handle;
}

export function refreshModals(): void {
  for (const m of openModals) m.refresh();
}

export function toast(message: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { class: 'toasts' });
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  host.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
