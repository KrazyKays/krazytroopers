import { PITY_LIMIT, PULL10_COST, PULL_COST, RARITIES, RARITY_ORDER, WEAPON_PULL10_COST, WEAPON_PULL_COST, WEAPONS, WEAPONS_BY_ID } from '../game/data';
import { buyWeapons, recruit } from '../game/roster';
import { getState, mutate } from '../game/state';
import type { WeaponDef } from '../game/types';
import { h } from './dom';
import { fmt, soldierCard, toast, weaponIcon } from './components';
import { playGacha } from './gacha';
import { goTo } from './nav';
import { openSoldier } from './roster';

type SoldierMode = 'free' | 'one' | 'ten';
type WeaponMode = 'one' | 'ten';

/** Bouton « Encore » de fin de tirage, s'il reste de quoi payer. */
function againButton(close: () => void, label: string, can: boolean, run: () => void): HTMLElement | false {
  return can && h('button', { class: 'btn btn-gold', onclick: () => { close(); run(); } }, label);
}

function doPull(mode: SoldierMode): void {
  const result = mutate((st) => recruit(st, mode));
  if (!result.ok) {
    toast(result.error, 'bad');
    return;
  }
  const st = getState();
  const soldiers = result.soldiers;
  playGacha({
    kind: 'soldier',
    title: soldiers.length > 1 ? 'Nouvelles recrues' : 'Nouvelle recrue',
    items: soldiers.map((s) => ({ rarity: s.rarity, front: soldierCard(st, s), onOpen: () => openSoldier(s.id) })),
    actions: (close) =>
      [
        h('button', { class: 'btn', onclick: close }, 'Continuer'),
        h('button', { class: 'btn', onclick: () => { close(); openSoldier(soldiers[0].id); } }, 'Améliorer les recrues'),
        mode === 'free'
          ? againButton(close, `Encore un tirage gratuit (${getState().freePulls})`, getState().freePulls > 0, () => doPull('free'))
          : againButton(close, `Encore ×${soldiers.length} — ${fmt(mode === 'ten' ? PULL10_COST : PULL_COST)} or`, getState().gold >= (mode === 'ten' ? PULL10_COST : PULL_COST), () => doPull(mode)),
      ].filter((b): b is HTMLElement => !!b),
  });
}

function weaponFront(def: WeaponDef, isNew: boolean): HTMLElement {
  const info = RARITIES[def.rarity];
  return h(
    'div',
    { class: 'weapon-card gacha-weapon', style: `--rc:${info.color}` },
    isNew && h('span', { class: 'gacha-new' }, 'Nouveau !'),
    h('b', { class: 'weapon-name', style: `color:${info.color}` }, def.name),
    h('div', { class: 'weapon-art' }, weaponIcon(def)),
    h('small', { class: 'rarity-tag', style: `color:${info.color}` }, info.label),
    h('small', { class: 'muted' }, `DPS ${fmt(def.damage / def.cooldown, 1)} · Portée ${fmt(def.range)}${def.armor ? ` · Armure +${def.armor}` : ''}`),
  );
}

function doWeaponPull(mode: WeaponMode): void {
  const known = new Set(getState().weapons.map((w) => w.defId));
  const result = mutate((st) => buyWeapons(st, mode));
  if (!result.ok) {
    toast(result.error, 'bad');
    return;
  }
  const cost = mode === 'ten' ? WEAPON_PULL10_COST : WEAPON_PULL_COST;
  playGacha({
    kind: 'weapon',
    title: result.weapons.length > 1 ? 'Nouvelles armes' : 'Nouvelle arme',
    items: result.weapons.map((w) => {
      const def = WEAPONS_BY_ID[w.defId];
      const isNew = !known.has(def.id);
      known.add(def.id);
      return { rarity: def.rarity, front: weaponFront(def, isNew), onOpen: () => goTo('arsenal') };
    }),
    actions: (close) =>
      [
        h('button', { class: 'btn', onclick: close }, 'Continuer'),
        h('button', { class: 'btn', onclick: () => { close(); goTo('arsenal'); } }, "Voir l'arsenal"),
        againButton(close, `Encore ×${result.weapons.length} — ${fmt(cost)} or`, getState().gold >= cost, () => doWeaponPull(mode)),
      ].filter((b): b is HTMLElement => !!b),
  });
}

function pullButton(label: string, cost: number, gold: number, run: () => void, bonus?: string): HTMLElement {
  const missing = cost - gold;
  return h(
    'button',
    { class: 'btn btn-big btn-pull', disabled: missing > 0, onclick: run },
    label,
    h('small', null, missing > 0 ? `Il manque ${fmt(missing)} or` : bonus),
  );
}

/** Barre des probabilités, chaque rareté occupant la largeur de son taux. */
function ratesBar(): HTMLElement {
  return h(
    'div',
    { class: 'rates-bar' },
    RARITY_ORDER.map((r) =>
      h('span', { class: 'rates-seg', style: `--rc:${RARITIES[r].color};flex:${RARITIES[r].rate}`, title: `${RARITIES[r].label} : ${RARITIES[r].rate} %` }, h('small', null, `${RARITIES[r].rate} %`)),
    ),
  );
}

function pityMeter(pity: number, what: string): HTMLElement {
  const left = PITY_LIMIT - pity;
  return h(
    'div',
    { class: 'pity' },
    h('div', { class: 'pity-track' }, h('div', { class: 'pity-fill', style: `width:${(pity / (PITY_LIMIT - 1)) * 100}%` })),
    h('small', { class: 'muted' }, left <= 1 ? `Prochain tirage : ${what} Épique ou mieux garanti !` : `${what} Épique ou mieux garanti d'ici ${left} tirages`),
  );
}

function banner(cls: string, emblem: HTMLElement, title: string, tagline: string, ...body: (HTMLElement | false)[]): HTMLElement {
  return h(
    'div',
    { class: `banner ${cls}` },
    h('div', { class: 'banner-head' }, h('div', { class: 'banner-emblem' }, emblem), h('div', null, h('h3', null, title), h('p', { class: 'muted small' }, tagline))),
    ...body,
  );
}

export function renderRecruit(): HTMLElement {
  const st = getState();
  const legendaries = WEAPONS.filter((w) => w.droppable && w.rarity === 'legendary');
  return h(
    'section',
    null,
    h('h2', null, 'Recrutement'),
    h('p', { class: 'muted' }, "Tirez de nouveaux soldats et de nouvelles armes au hasard. Plus la rareté est élevée, plus ils sont puissants. L'or provient des combats."),
    h(
      'div',
      { class: 'banners' },
      banner(
        'banner-soldier',
        h('span', null, '★'),
        'Recrues',
        "Chaque soldat recruté reçoit 3 choix d'amélioration parmi 3 propositions.",
        ratesBar(),
        pityMeter(st.pity, 'Soldat'),
        h(
          'div',
          { class: 'recruit-box' },
          st.freePulls > 0 && h('button', { class: 'btn btn-big btn-gold btn-free', onclick: () => doPull('free') }, `Tirage gratuit (${st.freePulls} restant${st.freePulls > 1 ? 's' : ''})`),
          pullButton(`Recruter ×1 — ${PULL_COST} or`, PULL_COST, st.gold, () => doPull('one')),
          pullButton(`Recruter ×10 — ${fmt(PULL10_COST)} or`, PULL10_COST, st.gold, () => doPull('ten'), `1 soldat offert (${fmt(PULL_COST * 10 - PULL10_COST)} or d'économie)`),
        ),
      ),
      banner(
        'banner-weapon',
        h('span', null, '✦'),
        'Armurerie',
        'Les armes achetées rejoignent votre arsenal, prêtes à être équipées.',
        ratesBar(),
        pityMeter(st.weaponPity, 'Arme'),
        h('div', { class: 'banner-featured', title: 'Armes légendaires à gagner' }, legendaries.map((w) => h('div', { class: 'featured-weapon', title: w.name }, weaponIcon(w)))),
        h(
          'div',
          { class: 'recruit-box' },
          pullButton(`Acheter ×1 — ${WEAPON_PULL_COST} or`, WEAPON_PULL_COST, st.gold, () => doWeaponPull('one')),
          pullButton(`Acheter ×10 — ${fmt(WEAPON_PULL10_COST)} or`, WEAPON_PULL10_COST, st.gold, () => doWeaponPull('ten'), `1 arme offerte (${fmt(WEAPON_PULL_COST * 10 - WEAPON_PULL10_COST)} or d'économie)`),
        ),
      ),
    ),
    st.gold < Math.min(PULL_COST, WEAPON_PULL_COST) && st.freePulls <= 0 && h('p', { class: 'muted small' }, "Pas assez d'or ? Les combats (entraînement et campagne) en rapportent, tout comme le renvoi de soldats et la vente d'armes."),
  );
}
