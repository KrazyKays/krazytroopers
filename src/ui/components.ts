import { MAX_LEVEL, RARITIES, RARITY_ORDER, TITLES, UPGRADES_BY_ID, WEAPONS_BY_ID } from '../game/data';
import { getState, getVersion, mutate, refresh, replaceState } from '../game/state';
import { soldierLook } from '../game/look';
import { computeStats, dps, weaponForSoldier, xpForNext } from '../game/stats';
import { SQUAD_SORTS, sortSquad, type SquadSort } from '../game/roster';
import type { GameState, Rarity, Soldier, TitleId, WeaponDef } from '../game/types';
import { spriteSvg, weaponSvg } from './avatar';
import { h, html, type Child } from './dom';

export const fmt = (n: number, digits = 0): string => n.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function rarityTag(rarity: keyof typeof RARITIES): HTMLElement {
  return h('span', { class: 'rarity-tag', style: `color:${RARITIES[rarity].color}` }, RARITIES[rarity].label);
}

export function titleTags(s: Soldier): HTMLElement[] {
  return s.titles.map((t) => h('span', { class: `title-tag title-${t}`, title: TITLES[t].desc }, TITLES[t].label));
}

export function soldierSprite(st: GameState, s: Soldier, cls = 'sprite'): HTMLElement {
  return html(spriteSvg(soldierLook(s, weaponForSoldier(s, st.weapons)), cls));
}

export function weaponIcon(w: WeaponDef): HTMLElement {
  return html(weaponSvg(w));
}

/** Bonus propres à une arme, en clair (vide si elle n'en a pas). */
export function weaponTraits(w: WeaponDef): string[] {
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  return [
    w.heal && 'Soigne l’allié le plus blessé',
    w.lifesteal && `Vol de vie ${pct(w.lifesteal)}`,
    w.crit && `Critique +${pct(w.crit)}`,
    w.dodge && `Esquive +${pct(w.dodge)}`,
    w.speedPct && `Vitesse +${pct(w.speedPct)}`,
  ].filter((t): t is string => !!t);
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

// L'arme équipée reste visible même quand des améliorations sont à choisir
export function statusPills(s: Soldier, weapon: WeaponDef): HTMLElement[] {
  const weaponPill = s.weaponUid
    ? h('span', { class: 'pill', style: `color:${RARITIES[weapon.rarity].color};border-color:${RARITIES[weapon.rarity].color}` }, weapon.name)
    : h('span', { class: 'pill pill-warn', title: 'Ce soldat se bat à mains nues : équipez-lui une arme' }, 'Sans arme');
  if (s.picksLeft > 0) return [h('span', { class: 'pill pill-pick' }, `${s.picksLeft} amélioration${s.picksLeft > 1 ? 's' : ''} à choisir`), weaponPill];
  return [weaponPill];
}

// Les titres ne sont pas écrits dans la tuile : ils apparaissent en badge sur l'image et colorent le nom
const TITLE_BADGE_ICON: Record<TitleId, string> = { legende: '★', legion: '♦' };

export interface CardOpts {
  onclick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

function cardClass(base: string, s: Soldier, opts: CardOpts): string {
  return [base, `rarity-${s.rarity}`, opts.selected && 'selected', opts.onclick && 'clickable', opts.disabled && 'disabled', s.picksLeft > 0 && 'has-pick'].filter(Boolean).join(' ');
}

export function soldierCard(st: GameState, s: Soldier, opts: CardOpts = {}): HTMLElement {
  const weapon = weaponForSoldier(s, st.weapons);
  const stats = computeStats(s, weapon);
  const trainings = s.trainingsLeft > 0 ? ` · ${s.trainingsLeft} entraînement${s.trainingsLeft > 1 ? 's' : ''} restant${s.trainingsLeft > 1 ? 's' : ''}` : '';
  const badges = s.titles.map((t) => h('span', { class: `title-badge title-badge-${t}`, title: TITLES[t].label }, TITLE_BADGE_ICON[t]));
  const nameClass = ['card-name', ...s.titles.map((t) => `name-${t}`)].join(' ');
  return h(
    'div',
    {
      class: cardClass('card', s, opts),
      style: `--rc:${RARITIES[s.rarity].color}`,
      title: opts.disabled ? opts.disabledReason : undefined,
      onclick: opts.onclick ? () => opts.onclick!() : undefined,
    },
    opts.selected && h('span', { class: 'card-check' }, '✓'),
    h('div', { class: 'card-portrait' }, soldierSprite(st, s), ...badges),
    h(
      'div',
      { class: 'card-body' },
      h('div', { class: nameClass }, s.favorite && h('span', { class: 'fav-star', title: 'Favori' }, '★ '), s.name),
      h('div', { class: 'card-sub' }, rarityTag(s.rarity), ` · Niv. ${s.level}`),
      xpBar(s),
      h('div', { class: 'card-stats' }, `PV ${fmt(stats.maxHp)} · DPS ${fmt(dps(stats), 1)}${trainings}`),
      statusPills(s, weapon),
    ),
  );
}

// Version compacte de la carte, pour parcourir une grande escouade d'un coup d'œil
export function soldierRow(st: GameState, s: Soldier, opts: CardOpts = {}): HTMLElement {
  const weapon = weaponForSoldier(s, st.weapons);
  const stats = computeStats(s, weapon);
  const nameClass = ['row-name', ...s.titles.map((t) => `name-${t}`)].join(' ');
  return h(
    'div',
    {
      class: cardClass('soldier-row', s, opts),
      style: `--rc:${RARITIES[s.rarity].color}`,
      title: opts.disabled ? opts.disabledReason : undefined,
      onclick: opts.onclick ? () => opts.onclick!() : undefined,
    },
    h('span', { class: 'row-check' }, opts.selected ? '✓' : ''),
    h('div', { class: 'row-portrait' }, soldierSprite(st, s)),
    h(
      'div',
      { class: nameClass },
      s.favorite && h('span', { class: 'fav-star', title: 'Favori' }, '★ '),
      s.name,
      s.titles.map((t) => h('span', { class: `row-title title-badge-${t}`, title: TITLES[t].label }, ` ${TITLE_BADGE_ICON[t]}`)),
    ),
    h('span', { class: 'row-level' }, rarityTag(s.rarity), ` Niv. ${s.level}`),
    h('span', { class: 'row-stat' }, `PV ${fmt(stats.maxHp)}`),
    h('span', { class: 'row-stat' }, `DPS ${fmt(dps(stats), 1)}`),
    h('span', { class: 'row-stat', title: 'Entraînements restants' }, `Entr. ${s.trainingsLeft}`),
    h('span', { class: 'row-pills' }, statusPills(s, weapon)),
  );
}

// ---------- Tri, filtres et affichage de l'escouade (partagés entre Escouade et Combat) ----------

type SquadFilter = 'all' | 'pick' | 'unarmed' | 'training' | 'favorite';
type SquadLayout = 'cards' | 'list';

const FILTERS: { key: SquadFilter; label: string; test: (s: Soldier) => boolean }[] = [
  { key: 'all', label: 'Tous', test: () => true },
  { key: 'pick', label: 'À améliorer', test: (s) => s.picksLeft > 0 },
  { key: 'unarmed', label: 'Sans arme', test: (s) => !s.weaponUid },
  { key: 'training', label: 'Entraînables', test: (s) => s.trainingsLeft > 0 },
  { key: 'favorite', label: 'Favoris', test: (s) => s.favorite },
];

const LAYOUT_KEY = 'krazy-troopers-layout';

let squadSort: SquadSort = 'level';
let squadFilter: SquadFilter = 'all';
let rarityFilter: Rarity | 'all' = 'all';
let squadLayout: SquadLayout = readLayout();

function readLayout(): SquadLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function setLayout(layout: SquadLayout): void {
  squadLayout = layout;
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // simple préférence d'affichage : on s'en passe
  }
  refresh();
}

export function getSquadSort(): SquadSort {
  return squadSort;
}

/** Soldats triés puis filtrés selon les réglages de la barre d'outils. */
export function visibleSquad(st: GameState): Soldier[] {
  const test = FILTERS.find((f) => f.key === squadFilter)!.test;
  return sortSquad(st, squadSort).filter((s) => test(s) && (rarityFilter === 'all' || s.rarity === rarityFilter));
}

export function squadToolbar(st: GameState): HTMLElement {
  const rarity = h(
    'select',
    { class: 'toolbar-select', title: 'Filtrer par rareté', onchange: (e) => { rarityFilter = (e.target as HTMLSelectElement).value as Rarity | 'all'; refresh(); } },
    h('option', { value: 'all' }, 'Toutes raretés'),
    RARITY_ORDER.map((r) => h('option', { value: r }, `${RARITIES[r].label} (${st.soldiers.filter((s) => s.rarity === r).length})`)),
  );
  rarity.value = rarityFilter;
  const chip = (active: boolean, label: string, onclick: () => void, title?: string) => h('button', { class: `chip${active ? ' active' : ''}`, title, onclick }, label);
  return h(
    'div',
    { class: 'squad-toolbar' },
    h(
      'div',
      { class: 'toolbar-group' },
      h('span', { class: 'muted small' }, 'Afficher'),
      FILTERS.map((f) => chip(squadFilter === f.key, `${f.label} (${st.soldiers.filter(f.test).length})`, () => { squadFilter = f.key; refresh(); })),
      rarity,
    ),
    h(
      'div',
      { class: 'toolbar-group' },
      h('span', { class: 'muted small' }, 'Trier par'),
      SQUAD_SORTS.map((o) => chip(o.key === squadSort, o.label, () => { squadSort = o.key; refresh(); })),
      h('span', { class: 'toolbar-sep' }),
      chip(squadLayout === 'cards', '▦ Cartes', () => setLayout('cards'), 'Affichage en cartes'),
      chip(squadLayout === 'list', '☰ Liste', () => setLayout('list'), 'Affichage en liste compacte'),
    ),
  );
}

/** Grille (ou liste) des soldats visibles ; prévient quand les filtres masquent tout. */
export function squadView(st: GameState, optsFor: (s: Soldier) => CardOpts): HTMLElement {
  const list = visibleSquad(st);
  if (list.length === 0) {
    return h(
      'div',
      { class: 'panel empty' },
      h('p', { class: 'muted' }, 'Aucun soldat ne correspond à ces filtres.'),
      h('button', { class: 'btn btn-small', onclick: () => { squadFilter = 'all'; rarityFilter = 'all'; refresh(); } }, 'Réinitialiser les filtres'),
    );
  }
  return squadLayout === 'list'
    ? h('div', { class: 'soldier-list' }, list.map((s) => soldierRow(st, s, optsFor(s))))
    : h('div', { class: 'grid' }, list.map((s) => soldierCard(st, s, optsFor(s))));
}

// ---------- Comparaison d'armes ----------

/** Écarts de stats si `s` passait de l'arme `from` à l'arme `to` (seules les différences sont listées). */
export function weaponDelta(s: Soldier, from: WeaponDef, to: WeaponDef): HTMLElement {
  const a = computeStats(s, from);
  const b = computeStats(s, to);
  const parts: [string, number, number][] = [
    ['DPS', dps(b) - dps(a), 1],
    ['portée', b.range - a.range, 0],
    ['armure', b.armor - a.armor, 0],
    ['zone', b.aoe - a.aoe, 0],
  ];
  const shown = parts.filter(([, d, digits]) => Math.abs(d) >= (digits ? 0.05 : 0.5));
  if (shown.length === 0) return h('small', { class: 'delta muted' }, 'Aucun changement');
  return h(
    'small',
    { class: 'delta' },
    shown.map(([label, d, digits], i) => [i > 0 && ' · ', h('span', { class: d > 0 ? 'up' : 'down' }, `${label} ${d > 0 ? '+' : '−'}${fmt(Math.abs(d), digits)}`)]),
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

export function openModal(render: (close: () => void) => HTMLElement, onClose?: () => void, cls = ''): ModalHandle {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: `modal ${cls}` });
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
  // Seule la fenêtre du dessus réagit à Échap : une confirmation peut s'ouvrir par-dessus une fiche
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && [...openModals].at(-1) === handle) {
      e.stopImmediatePropagation();
      handle.close();
    }
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

export interface ToastAction {
  label: string;
  run: () => void;
}

export function toast(message: string, kind: 'info' | 'good' | 'bad' = 'info', action?: ToastAction): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { class: 'toasts' });
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const t = h(
    'div',
    { class: `toast toast-${kind}${action ? ' toast-action' : ''}` },
    message,
    action && h('button', { class: 'btn btn-small', onclick: () => { t.remove(); action.run(); } }, action.label),
  );
  host.appendChild(t);
  setTimeout(() => t.remove(), action ? 7000 : 3500);
}

/** Fenêtre de confirmation du jeu, à la place du `confirm()` du navigateur. */
export function confirmDialog(o: { title: string; body?: Child; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let accepted = false;
    openModal(
      (close) =>
        h(
          'div',
          { class: 'confirm' },
          h('h3', null, o.title),
          o.body && h('div', { class: 'confirm-body' }, o.body),
          h(
            'div',
            { class: 'detail-actions' },
            h('button', { class: 'btn', onclick: close }, 'Annuler'),
            h('button', { class: `btn confirm-ok ${o.danger ? 'btn-danger' : 'btn-gold'}`, onclick: () => { accepted = true; close(); } }, o.confirm),
          ),
        ),
      () => resolve(accepted),
      'modal-small',
    );
    document.querySelector<HTMLElement>('.modal-small .confirm-ok')?.focus();
  });
}

/**
 * Applique une action destructrice (renvoi, vente) en proposant de l'annuler pendant quelques secondes.
 * L'annulation n'est permise que si rien d'autre n'a modifié la partie entre-temps.
 */
export function undoable<T>(fn: (st: GameState) => T, message: (result: T) => string): T {
  const snapshot = structuredClone(getState());
  const result = mutate(fn);
  const version = getVersion();
  toast(message(result), 'info', {
    label: 'Annuler',
    run: () => {
      if (getVersion() !== version) {
        toast("Impossible d'annuler : la partie a changé depuis.", 'bad');
        return;
      }
      replaceState(snapshot);
      toast('Action annulée.', 'good');
    },
  });
  return result;
}
