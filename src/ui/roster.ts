import { MAX_LEVEL, PICK_EVERY_LEVELS, RARITIES, RARITY_ORDER, UPGRADES_BY_ID, WEAPONS_BY_ID, SQUAD_MAX } from '../game/data';
import { equipWeapon, NAME_MAX_LENGTH, pickUpgrade, releaseSoldier, renameSoldier, sortSquad, toggleFavorite } from '../game/roster';
import { getState, mutate } from '../game/state';
import { computeStats, dps, weaponForSoldier, xpForNext } from '../game/stats';
import type { Soldier } from '../game/types';
import { h } from './dom';
import { fmt, getSquadSort, openModal, rarityTag, sortBar, soldierCard, soldierSprite, toast, weaponIcon, xpBar } from './components';

export function renderRoster(): HTMLElement {
  const st = getState();
  if (st.soldiers.length === 0) {
    return h(
      'section',
      { class: 'panel empty' },
      h('h2', null, 'Votre escouade est vide'),
      h('p', null, "Rendez-vous dans l'onglet « Recruter » pour tirer vos premiers soldats."),
    );
  }
  const pending = st.soldiers.reduce((n, s) => n + s.picksLeft, 0);
  return h(
    'section',
    null,
    h('div', { class: 'section-head' }, h('h2', null, `Escouade (${st.soldiers.length})`), pending > 0 && h('span', { class: 'pill pill-pick' }, `${pending} amélioration${pending > 1 ? 's' : ''} en attente`)),
    h('p', { class: 'muted' }, `Cliquez sur un soldat pour choisir ses améliorations et gérer son équipement. Une nouvelle amélioration est débloquée tous les ${PICK_EVERY_LEVELS} niveaux. Vous pouvez engager ${SQUAD_MAX} soldats par combat.`),
    sortBar(),
    h('div', { class: 'grid' }, sortSquad(st, getSquadSort()).map((s) => soldierCard(st, s, { onclick: () => openSoldier(s.id) }))),
  );
}

function statRow(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat-row' }, h('span', null, label), h('b', null, value));
}

function renameForm(s: Soldier): HTMLElement {
  const input = h('input', { class: 'rename-input', type: 'text', value: s.name, maxlength: NAME_MAX_LENGTH });
  return h(
    'form',
    {
      class: 'rename-form',
      onsubmit: (e) => {
        e.preventDefault();
        if (!mutate((st) => renameSoldier(st, s.id, input.value))) toast('Le nom ne peut pas être vide.', 'bad');
      },
    },
    input,
    h('button', { class: 'btn btn-small', type: 'submit' }, 'Renommer'),
  );
}

export function openSoldier(id: string): void {
  openModal((close) => {
    const st = getState();
    const s = st.soldiers.find((x) => x.id === id);
    if (!s) {
      queueMicrotask(close);
      return h('div');
    }
    const weapon = weaponForSoldier(s, st.weapons);
    const stats = computeStats(s, weapon);
    const info = RARITIES[s.rarity];

    const header = h(
      'div',
      { class: 'detail-head', style: `--rc:${info.color}` },
      h('div', { class: 'detail-portrait' }, soldierSprite(st, s)),
      h(
        'div',
        null,
        renameForm(s),
        h('div', null, rarityTag(s.rarity), ` · Niveau ${s.level}${s.level >= MAX_LEVEL ? ' (max)' : ''}`),
        xpBar(s),
        s.level < MAX_LEVEL && h('div', { class: 'muted small' }, `${fmt(s.xp)} / ${fmt(xpForNext(s.level))} XP`),
        h('div', { class: 'muted small' }, `${s.kills} ennemi${s.kills > 1 ? 's' : ''} éliminé${s.kills > 1 ? 's' : ''}`),
      ),
    );

    const statsBlock = h(
      'div',
      { class: 'stats-grid' },
      statRow('PV', fmt(stats.maxHp)),
      statRow('Dégâts / coup', fmt(stats.damage, 1)),
      statRow('DPS', fmt(dps(stats), 1)),
      statRow('Portée', fmt(stats.range)),
      statRow('Vitesse', fmt(stats.speed)),
      statRow('Armure', fmt(stats.armor)),
      statRow('Critique', `${fmt(stats.crit * 100)} %`),
      statRow('Esquive', `${fmt(stats.dodge * 100)} %`),
    );

    let upgrades: HTMLElement;
    if (s.picksLeft > 0 && s.upgradeChoices) {
      const n = s.upgrades.length + 1;
      upgrades = h(
        'div',
        { class: 'upgrade-block' },
        h('h3', null, `Amélioration ${n} — choisissez-en une`),
        h(
          'div',
          { class: 'choices' },
          s.upgradeChoices.map((uid) => {
            const u = UPGRADES_BY_ID[uid];
            return h(
              'button',
              {
                class: 'choice',
                onclick: () => {
                  mutate((state) => pickUpgrade(state, s.id, uid));
                },
              },
              h('b', null, u.name),
              h('span', null, u.desc),
            );
          }),
        ),
      );
    } else {
      upgrades = h('div', { class: 'upgrade-block' }, h('h3', null, 'Améliorations'));
    }
    if (s.upgrades.length > 0) {
      upgrades.appendChild(
        h('ul', { class: 'upgrade-list' }, s.upgrades.map((uid) => h('li', null, h('b', null, UPGRADES_BY_ID[uid].name), ` — ${UPGRADES_BY_ID[uid].desc}`))),
      );
    }

    const owners = new Map(st.soldiers.filter((x) => x.weaponUid).map((x) => [x.weaponUid as string, x]));
    const weaponList = h(
      'div',
      { class: 'weapon-list' },
      [...st.weapons]
        .sort((a, b) => RARITY_ORDER.indexOf(WEAPONS_BY_ID[b.defId].rarity) - RARITY_ORDER.indexOf(WEAPONS_BY_ID[a.defId].rarity))
        .map((w) => {
          const def = WEAPONS_BY_ID[w.defId];
          const owner = owners.get(w.uid);
          return h(
            'button',
            {
              class: `weapon-item${s.weaponUid === w.uid ? ' active' : ''}`,
              style: `--rc:${RARITIES[def.rarity].color}`,
              onclick: () => mutate((state) => equipWeapon(state, s.id, w.uid)),
            },
            weaponIcon(def),
            h(
              'span',
              null,
              h('b', { style: `color:${RARITIES[def.rarity].color}` }, def.name),
              h('small', null, `${fmt(def.damage)} dégâts · portée ${fmt(def.range)} · ${fmt(def.cooldown, 2)} s${def.aoe ? ` · zone ${def.aoe}` : ''}`),
              owner && owner.id !== s.id && h('small', { class: 'muted owner' }, `Équipée par ${owner.name}`),
            ),
          );
        }),
      h(
        'button',
        { class: `weapon-item${s.weaponUid === null ? ' active' : ''}`, onclick: () => mutate((state) => equipWeapon(state, s.id, null)) },
        weaponIcon(WEAPONS_BY_ID.fists),
        h('span', null, h('b', null, 'Poings nus'), h('small', null, 'Aucune arme')),
      ),
    );

    return h(
      'div',
      { class: 'detail' },
      h('button', { class: 'modal-close', onclick: close, title: 'Fermer' }, '×'),
      header,
      statsBlock,
      upgrades,
      h('div', { class: 'upgrade-block' }, h('h3', null, `Arme : ${weapon.name}`), weaponList),
      h(
        'div',
        { class: 'detail-actions' },
        h(
          'button',
          { class: `btn${s.favorite ? ' btn-gold' : ''}`, onclick: () => mutate((state) => toggleFavorite(state, s.id)) },
          s.favorite ? '★ Retirer des favoris' : '☆ Ajouter aux favoris',
        ),
        h(
          'button',
          {
            class: 'btn btn-danger',
            onclick: () => {
              const warning = s.favorite ? ' Ce soldat est dans vos favoris.' : '';
              if (!confirm(`Renvoyer ${s.name} pour ${info.releaseValue} or ?${warning}`)) return;
              const gold = mutate((state) => releaseSoldier(state, s.id));
              toast(`${s.name} a quitté l'escouade (+${gold} or).`);
              close();
            },
          },
          `Renvoyer (+${info.releaseValue} or)`,
        ),
      ),
    );
  });
}
