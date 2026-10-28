import { AUTO_PICK_KILLS, LEGEND_UPGRADES, MAX_LEVEL, MAX_UPGRADES, PICK_EVERY_LEVELS, RARITIES, RARITY_ORDER, TRAINING_PER_SOLDIER, UPGRADES_BY_ID, WEAPONS_BY_ID } from '../game/data';
import { squadMax } from '../game/progress';
import { autoPickAll, autoPickUnlocked, buyTraining, equipWeapon, legionOfHonor, NAME_MAX_LENGTH, pickUpgrade, releaseSoldier, releaseSoldiers, renameSoldier, sortSquad, toggleFavorite, trainingCost } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import { computeStats, dps, weaponForSoldier, xpForNext } from '../game/stats';
import type { GameState, Rarity, Soldier } from '../game/types';
import { h } from './dom';
import { goTo } from './nav';
import { confirmDialog, fmt, getSquadSort, openModal, rarityTag, soldierSprite, squadToolbar, squadView, titleTags, toast, undoable, weaponDelta, weaponIcon, xpBar } from './components';

const legendIds = new Set(LEGEND_UPGRADES.map((u) => u.id));

const RARITY_PLURAL: Record<Rarity, string> = { common: 'communs', rare: 'rares', epic: 'épiques', legendary: 'légendaires' };

// Sélection multiple pour renvoyer des soldats (le renvoi rapporte de l'or)
const selected = new Set<string>();
let selectMode = false;

// Les favoris ne sont jamais renvoyés par lot de rareté
function releasableByRarity(st: GameState, rarity: Rarity): Soldier[] {
  return st.soldiers.filter((s) => s.rarity === rarity && !s.favorite);
}

async function autoPickEverything(pending: number): Promise<void> {
  const ok = await confirmDialog({
    title: 'Choix automatique',
    body: `Choisir au hasard les ${pending} amélioration${pending > 1 ? 's' : ''} en attente de toute l'escouade ? Les choix ne pourront pas être modifiés.`,
    confirm: 'Choisir au hasard',
  });
  if (!ok) return;
  const picks = mutate((st) => autoPickAll(st));
  toast(`${picks} amélioration${picks > 1 ? 's' : ''} choisie${picks > 1 ? 's' : ''} au hasard.`, 'good');
}

async function releaseSoldierList(list: Soldier[]): Promise<void> {
  if (list.length === 0) return;
  const gold = list.reduce((sum, s) => sum + RARITIES[s.rarity].releaseValue, 0);
  const favorites = list.filter((s) => s.favorite);
  const ok = await confirmDialog({
    title: `Renvoyer ${list.length} soldat${list.length > 1 ? 's' : ''} ?`,
    body: [
      h('p', null, `Vous recevrez ${fmt(gold)} or. Vous pourrez annuler juste après.`),
      h('ul', { class: 'confirm-list' }, list.map((s) => h('li', null, rarityTag(s.rarity), ` ${s.name} · Niv. ${s.level}${s.favorite ? ' ★' : ''}`))),
      favorites.length > 0 && h('p', { class: 'warn' }, `Attention : ${favorites.length} favori${favorites.length > 1 ? 's' : ''} dans la liste.`),
    ],
    confirm: `Renvoyer (+${fmt(gold)} or)`,
    danger: true,
  });
  if (!ok) return;
  const ids = list.map((s) => s.id);
  for (const id of ids) selected.delete(id);
  undoable(
    (st) => releaseSoldiers(st, ids),
    (earned) => `${list.length} soldat${list.length > 1 ? 's' : ''} ${list.length > 1 ? 'ont' : 'a'} quitté l'escouade (+${fmt(earned)} or).`,
  );
}

export function renderRoster(): HTMLElement {
  const st = getState();
  if (st.soldiers.length === 0) {
    return h(
      'section',
      { class: 'panel empty' },
      h('h2', null, 'Votre escouade est vide'),
      h('p', null, 'Commencez par recruter vos premiers soldats.'),
      h('button', { class: 'btn btn-big btn-gold', onclick: () => goTo('recruit') }, st.freePulls > 0 ? `Recruter (${st.freePulls} tirage${st.freePulls > 1 ? 's' : ''} gratuit${st.freePulls > 1 ? 's' : ''})` : 'Recruter'),
    );
  }
  const ids = new Set(st.soldiers.map((s) => s.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  const picked = st.soldiers.filter((s) => selected.has(s.id));
  const pending = st.soldiers.reduce((n, s) => n + s.picksLeft, 0);
  const firstPending = sortSquad(st, getSquadSort()).find((s) => s.picksLeft > 0);
  return h(
    'section',
    null,
    h(
      'div',
      { class: 'section-head' },
      h('h2', null, `Escouade (${st.soldiers.length})`),
      firstPending && !selectMode && h('button', { class: 'btn btn-small btn-gold', onclick: () => openSoldier(firstPending.id) }, `Choisir les améliorations (${pending})`),
    ),
    h('p', { class: 'muted' }, `Cliquez sur un soldat pour choisir ses améliorations et son arme. Engagez jusqu'à ${squadMax(st)} soldats par combat.`),
    squadToolbar(st),
    h(
      'div',
      { class: 'bulk-bar' },
      h(
        'button',
        {
          class: `btn btn-small${selectMode ? ' active' : ''}`,
          onclick: () => {
            selectMode = !selectMode;
            selected.clear();
            refresh();
          },
        },
        selectMode ? 'Terminer' : 'Renvoyer des soldats…',
      ),
      !selectMode &&
        (autoPickUnlocked(st)
          ? h('button', { class: 'btn btn-small', disabled: pending === 0, onclick: () => autoPickEverything(pending) }, `Choisir au hasard les améliorations en attente (${pending})`)
          : pending > 0 && h('span', { class: 'muted small' }, `Choix automatique débloqué à ${AUTO_PICK_KILLS} ennemis éliminés (${fmt(st.stats.kills)} / ${AUTO_PICK_KILLS})`)),
    ),
    selectMode &&
      h(
        'div',
        { class: 'panel select-panel' },
        h('p', { class: 'muted small' }, "Cliquez sur les soldats à renvoyer : chacun rapporte de l'or selon sa rareté. Les favoris ne sont jamais ajoutés par les raccourcis."),
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'muted small' }, 'Ajouter tous les :'),
          RARITY_ORDER.map((r) => {
            const list = releasableByRarity(st, r);
            return h(
              'button',
              { class: 'btn btn-small btn-rarity', style: `color:${RARITIES[r].color}`, disabled: list.length === 0, onclick: () => { for (const s of list) selected.add(s.id); refresh(); } },
              `${RARITY_PLURAL[r]} (${list.length})`,
            );
          }),
          h('button', { class: 'btn btn-small', disabled: picked.length === 0, onclick: () => { selected.clear(); refresh(); } }, 'Vider'),
        ),
        h(
          'div',
          { class: 'section-head select-summary' },
          h('b', null, `${picked.length} sélectionné${picked.length > 1 ? 's' : ''}`),
          h(
            'button',
            { class: 'btn btn-danger', disabled: picked.length === 0, onclick: () => void releaseSoldierList(picked) },
            `Renvoyer la sélection (+${fmt(picked.reduce((sum, s) => sum + RARITIES[s.rarity].releaseValue, 0))} or)`,
          ),
        ),
      ),
    squadView(st, (s) => ({
      selected: selectMode && selected.has(s.id),
      onclick: selectMode
        ? () => {
            if (selected.has(s.id)) selected.delete(s.id);
            else selected.add(s.id);
            refresh();
          }
        : () => openSoldier(s.id),
    })),
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

function legionBlock(s: Soldier, removed: Set<string>): HTMLElement {
  return h(
    'div',
    { class: 'upgrade-block legion-block' },
    h('h3', null, "Légion d'honneur"),
    h(
      'p',
      { class: 'muted small' },
      `${s.name} a atteint le niveau max. Cochez les améliorations à retirer (facultatif). Une fois la Légion accordée :`,
    ),
    h(
      'ul',
      { class: 'muted small legion-effects' },
      h('li', null, `${s.name} repart au niveau 1, avec son XP remis à zéro : ses statistiques baissent fortement jusqu'à ce qu'il remonte.`),
      h('li', null, 'Les améliorations cochées sont perdues. Celles que vous gardez restent, et chacune réduit le nombre de choix à faire en remontant.'),
      h('li', null, `Il propose 3 améliorations de Légende, bien plus puissantes, et gagne ${TRAINING_PER_SOLDIER} entraînements supplémentaires.`),
      h('li', null, "Il garde le titre Légende et reçoit le titre Légion d'honneur. Cette décision est définitive."),
    ),
    h(
      'div',
      { class: 'legion-options' },
      s.upgrades.map((uid) =>
        h(
          'label',
          { class: 'legion-option' },
          h('input', {
            type: 'checkbox',
            checked: removed.has(uid),
            onchange: (e) => {
              if ((e.target as HTMLInputElement).checked) removed.add(uid);
              else removed.delete(uid);
            },
          }),
          h('span', null, h('b', null, UPGRADES_BY_ID[uid].name), ` — ${UPGRADES_BY_ID[uid].desc}`),
        ),
      ),
    ),
    h(
      'button',
      {
        class: 'btn btn-gold',
        onclick: async () => {
          const toRemove = [...removed];
          const ok = await confirmDialog({
            title: `Légion d'honneur pour ${s.name} ?`,
            body: [
              h('p', null, `${s.name} repartira au niveau 1 (XP remise à zéro, statistiques fortement réduites).`),
              toRemove.length > 0 && h('p', null, `Améliorations retirées : ${toRemove.map((id) => UPGRADES_BY_ID[id].name).join(', ')}.`),
              h('p', { class: 'warn' }, 'Cette action est définitive.'),
            ],
            confirm: "Accorder la Légion d'honneur",
          });
          if (!ok || !mutate((st) => legionOfHonor(st, s.id, toRemove))) return;
          removed.clear();
          toast(`${s.name} reçoit la Légion d'honneur.`, 'good');
        },
      },
      "Accorder la Légion d'honneur",
    ),
  );
}

// Niveau auquel le soldat débloquera sa prochaine amélioration (null s'il n'en gagnera plus)
function nextPickLevel(s: Soldier): number | null {
  if (s.upgrades.length + s.picksLeft >= MAX_UPGRADES) return null;
  const level = (Math.floor(s.level / PICK_EVERY_LEVELS) + 1) * PICK_EVERY_LEVELS;
  return level < MAX_LEVEL ? level : null;
}

export function openSoldier(id: string): void {
  const legionRemoved = new Set<string>();
  let current = id;
  openModal((close) => {
    const st = getState();
    const s = st.soldiers.find((x) => x.id === current);
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
        h('div', null, rarityTag(s.rarity), ` · Niveau ${s.level}${s.level >= MAX_LEVEL ? ' (max)' : ''}`, titleTags(s)),
        xpBar(s),
        s.level < MAX_LEVEL && h('div', { class: 'muted small' }, `${fmt(s.xp)} / ${fmt(xpForNext(s.level))} XP`),
        h('div', { class: 'muted small' }, `${s.kills} ennemi${s.kills > 1 ? 's' : ''} éliminé${s.kills > 1 ? 's' : ''}`),
        h(
          'div',
          { class: 'row training-row' },
          h('span', { class: 'muted small' }, `${s.trainingsLeft} entraînement${s.trainingsLeft > 1 ? 's' : ''} restant${s.trainingsLeft > 1 ? 's' : ''}`),
          s.level < MAX_LEVEL &&
            h(
              'button',
              {
                class: 'btn btn-small',
                disabled: st.gold < trainingCost(s),
                title: 'Un entraînement de plus pour ce soldat : un moyen de convertir l’or en XP',
                onclick: () => {
                  const res = mutate((state) => buyTraining(state, s.id));
                  if (typeof res === 'string') toast(res, 'bad');
                },
              },
              `+1 entraînement (${fmt(trainingCost(s))} or)`,
            ),
        ),
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
                class: `choice${legendIds.has(uid) ? ' choice-legend' : ''}`,
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
      const next = nextPickLevel(s);
      upgrades = h(
        'div',
        { class: 'upgrade-block' },
        h('h3', null, `Améliorations (${s.upgrades.length} / ${MAX_UPGRADES})`),
        next !== null && h('p', { class: 'muted small' }, `Prochaine amélioration au niveau ${next}.`),
      );
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
              s.weaponUid === w.uid ? h('small', null, 'Équipée') : weaponDelta(s, weapon, def),
              owner && owner.id !== s.id && h('small', { class: 'muted owner' }, `Équipée par ${owner.name} (échange)`),
            ),
          );
        }),
      h(
        'button',
        { class: `weapon-item${s.weaponUid === null ? ' active' : ''}`, onclick: () => mutate((state) => equipWeapon(state, s.id, null)) },
        weaponIcon(WEAPONS_BY_ID.fists),
        h('span', null, h('b', null, 'Poings nus'), s.weaponUid === null ? h('small', null, 'Aucune arme') : weaponDelta(s, weapon, WEAPONS_BY_ID.fists)),
      ),
    );

    const legion = s.level >= MAX_LEVEL && s.picksLeft === 0 ? legionBlock(s, legionRemoved) : null;

    // Enchaîner les choix d'amélioration sans repasser par la liste
    const nextPending = s.picksLeft === 0 ? sortSquad(st, getSquadSort()).find((x) => x.picksLeft > 0) : undefined;
    const nextBanner =
      nextPending &&
      h(
        'div',
        { class: 'next-pending' },
        h('span', null, `${s.name} est à jour. ${nextPending.name} a ${nextPending.picksLeft} amélioration${nextPending.picksLeft > 1 ? 's' : ''} à choisir.`),
        h('button', { class: 'btn btn-small btn-gold', onclick: () => { current = nextPending.id; legionRemoved.clear(); refresh(); } }, 'Soldat suivant →'),
      );

    return h(
      'div',
      { class: 'detail' },
      h('button', { class: 'modal-close', onclick: close, title: 'Fermer (Échap)' }, '×'),
      header,
      nextBanner,
      statsBlock,
      upgrades,
      legion,
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
            onclick: async () => {
              // Un renvoi simple s'annule depuis le message ; seul un favori demande confirmation
              if (s.favorite && !(await confirmDialog({ title: `Renvoyer ${s.name} ?`, body: 'Ce soldat est dans vos favoris.', confirm: `Renvoyer (+${info.releaseValue} or)`, danger: true }))) return;
              close();
              undoable((state) => releaseSoldier(state, s.id), (gold) => `${s.name} a quitté l'escouade (+${gold} or).`);
            },
          },
          `Renvoyer (+${info.releaseValue} or)`,
        ),
      ),
    );
  });
}
