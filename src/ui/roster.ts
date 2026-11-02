import { LEGEND_UPGRADES, LEGION_PICKS, MAX_LEVEL, PICK_LEVELS, RARITIES, RARITY_ORDER, TRAINING_PER_SOLDIER, UPGRADE_KINDS, UPGRADES_BY_ID, WEAPONS_BY_ID } from '../game/data';
import { isUnlocked } from '../game/progress';
import { barracksCap, equipWeapon, NAME_MAX_LENGTH, releaseSoldier, releaseSoldiers, renameSoldier, sortSquad, toggleFavorite, trainingCost } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import { computeStats, dps, powerScore, weaponForSoldier } from '../game/stats';
import {
  autoPickAll,
  autoPickUnlocked,
  entitledPicks,
  legionOfHonor,
  maxRank,
  nextPickLevel,
  pickUpgrade,
  recommendedUpgrade,
  rerollCost,
  rerollUpgrades,
  upgradeCap,
  upgradeGains,
  upgradeRank,
  upgradeSummary,
} from '../game/upgrades';
import type { GameState, Rarity, Soldier, WeaponDef } from '../game/types';
import { h } from './dom';
import { goTo } from './nav';
import { confirmDialog, familyTag, fmt, fold, getSquadSort, openModal, positionPicker, rarityTag, soldierSprite, squadToolbar, squadView, titleTags, toast, undoable, weaponDelta, weaponIcon, xpBar } from './components';


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
    body: `Prendre l'amélioration conseillée pour les ${pending} choix en attente de toute l'escouade ? Les choix ne pourront pas être modifiés.`,
    confirm: 'Appliquer les conseils',
  });
  if (!ok) return;
  const picks = mutate((st) => autoPickAll(st));
  toast(`${picks} amélioration${picks > 1 ? 's' : ''} choisie${picks > 1 ? 's' : ''}.`, 'good');
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
      h('h2', { class: 'section-title' }, `Escouade · caserne ${st.soldiers.length} / ${barracksCap(st)}`),
      firstPending && !selectMode && h('button', { class: 'btn btn-primary', onclick: () => openSoldier(firstPending.id) }, `⬆ Choisir les améliorations (${pending})`),
    ),
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
          ? h('button', { class: 'btn btn-small', disabled: pending === 0, onclick: () => autoPickEverything(pending) }, `✨ Appliquer les conseils (${pending})`)
          : false),
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
      h('li', null, `Les améliorations cochées sont perdues (un rang par case). Il gagne ${LEGION_PICKS} emplacements d'amélioration de plus, qui se regagnent en remontant les paliers.`),
      h('li', null, `Ses propositions incluent des améliorations de Légende, bien plus puissantes, et il gagne ${TRAINING_PER_SOLDIER} entraînements gratuits supplémentaires.`),
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
        h('h2', { class: 'detail-name' }, s.name),
        h('div', null, rarityTag(s.rarity), ` · Niveau ${s.level}${s.level >= MAX_LEVEL ? ' (max)' : ''}`, titleTags(s)),
        xpBar(s),
      ),
    );

    const statsBlock = h(
      'div',
      { class: 'stats-grid stats-main' },
      statRow('Puissance', fmt(powerScore(stats))),
      statRow('PV', fmt(stats.maxHp)),
      statRow('DPS', fmt(dps(stats), 1)),
    );
    const statsMore = fold(
      'soldier-stats',
      'Statistiques détaillées',
      [
        h(
          'div',
          { class: 'stats-grid' },
          statRow('Dégâts / coup', fmt(stats.damage, 1)),
          statRow('Portée', fmt(stats.range)),
          statRow('Vitesse', fmt(stats.speed)),
          statRow('Armure', fmt(stats.armor)),
          statRow('Critique', `${fmt(stats.crit * 100)} %`),
          statRow('Esquive', `${fmt(stats.dodge * 100)} %`),
          statRow('Éliminations', fmt(s.kills)),
          statRow('Entraînements gratuits', s.trainingsLeft > 0 ? String(s.trainingsLeft) : s.level < MAX_LEVEL ? `0 (ensuite ${fmt(trainingCost(s))} or)` : '0'),
        ),
        renameForm(s),
      ],
    );

    const upgrades = upgradeBlock(st, s, weapon);

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
              h('b', { style: `color:${RARITIES[def.rarity].color}` }, def.name, ' ', familyTag(def)),
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
      fold('soldier-weapon', [`Arme : ${s.weaponUid ? weapon.name : 'aucune'} `, familyTag(weapon)], weaponList, !s.weaponUid),
      isUnlocked(st, 'positions') && fold('soldier-position', 'Position au combat', positionPicker(s)),
      statsMore,
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

// ---------- Améliorations ----------

/** Emplacements d'amélioration : pris, à choisir, puis verrouillés jusqu'à leur palier de niveau. */
function slotTrack(s: Soldier): HTMLElement {
  const cap = upgradeCap(s);
  const taken = s.upgrades.length;
  const pending = s.picksLeft;
  // niveau de déblocage de chaque emplacement restant (paliers de base, puis ceux regagnés après une Légion)
  const levels: number[] = [];
  for (const l of PICK_LEVELS) if (entitledPicks(l, s.legions) > taken + pending + levels.length && levels.length < cap - taken - pending) levels.push(l);
  return h(
    'div',
    { class: 'upgrade-slots' },
    Array.from({ length: taken }, () => h('span', { class: 'uslot taken', title: 'Amélioration prise' }, '✓')),
    Array.from({ length: pending }, () => h('span', { class: 'uslot pending', title: 'Amélioration à choisir' }, '!')),
    levels.map((l) => h('span', { class: 'uslot locked', title: `Se débloque au niveau ${l}` }, `${l}`)),
  );
}

function upgradeBlock(st: GameState, s: Soldier, weapon: WeaponDef): HTMLElement {
  const next = nextPickLevel(s);
  const block = h(
    'div',
    { class: 'upgrade-block' },
    h(
      'div',
      { class: 'panel-head' },
      h('h3', null, `Améliorations ${s.upgrades.length} / ${upgradeCap(s)}`),
      next !== null && s.picksLeft === 0 && h('span', { class: 'muted small' }, `Prochaine au niveau ${next}`),
    ),
    slotTrack(s),
  );

  if (s.picksLeft > 0 && s.upgradeChoices) {
    const gains = upgradeGains(st, s);
    const best = recommendedUpgrade(st, s);
    const legend = new Set(LEGEND_UPGRADES.map((u) => u.id));
    const cost = rerollCost(s);
    block.append(
      h('p', { class: 'muted small' }, s.picksLeft > 1 ? `Encore ${s.picksLeft} à choisir.` : 'Choisissez une amélioration.'),
      h(
        'div',
        { class: 'choices' },
        s.upgradeChoices.map((uid) => {
          const u = UPGRADES_BY_ID[uid];
          const rank = upgradeRank(s, uid) + 1;
          const gain = gains.get(uid) ?? 0;
          const kind = UPGRADE_KINDS[u.kind];
          return h(
            'button',
            { class: `choice kind-${u.kind}${legend.has(uid) ? ' choice-legend' : ''}${uid === best ? ' choice-best' : ''}`, onclick: () => mutate((state) => pickUpgrade(state, s.id, uid)) },
            h('span', { class: 'choice-top' }, h('span', { class: 'choice-kind', title: kind.label }, kind.icon), uid === best && h('span', { class: 'tag tag-accent', title: `Selon l'arme actuelle : ${weapon.name}` }, 'Conseillé')),
            h('b', null, u.name, maxRank(u) > 1 && h('span', { class: 'rank' }, ` rang ${rank}/${maxRank(u)}`)),
            h('span', { class: 'choice-desc' }, u.desc),
            gain > 0.0005 && h('small', { class: 'choice-gain' }, `Puissance +${fmt(gain * 100, 1)} %`),
          );
        }),
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn btn-small',
            disabled: st.gold < cost,
            title: st.gold < cost ? `Il manque ${fmt(cost - st.gold)} or` : 'Remplacer les trois propositions',
            onclick: () => {
              const r = mutate((state) => rerollUpgrades(state, s.id));
              if (!r.ok) toast(r.error, 'bad');
            },
          },
          `🎲 Autres propositions — ${fmt(cost)} or`,
        ),
      ),
    );
  }

  const owned = upgradeSummary(s);
  if (owned.length > 0) {
    block.append(
      fold(
        'soldier-upgrades',
        `Améliorations prises (${s.upgrades.length})`,
        h(
          'ul',
          { class: 'upgrade-owned' },
          owned.map(({ def, rank }) =>
            h(
              'li',
              { class: `kind-${def.kind}` },
              h('span', { class: 'choice-kind', title: UPGRADE_KINDS[def.kind].label }, UPGRADE_KINDS[def.kind].icon),
              h('b', null, def.name),
              maxRank(def) > 1 && h('span', { class: 'rank' }, `rang ${rank}/${maxRank(def)}`),
              h('span', { class: 'muted small' }, def.desc),
            ),
          ),
        ),
      ),
    );
  }
  return block;
}
