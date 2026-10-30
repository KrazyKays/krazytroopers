import { FORGE_FEE, FORGE_INPUT, RARITIES, RARITY_ORDER, WEAPONS_BY_ID } from '../game/data';
import { isUnlocked, unlockLevel } from '../game/progress';
import { equipWeapon, forgeableWeapons, forgeWeapons, sellWeapons, sortSquad } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import { weaponForSoldier } from '../game/stats';
import type { GameState, Rarity, WeaponItem } from '../game/types';
import { h } from './dom';
import { confirmDialog, familyTag, fmt, getSquadSort, openModal, rarityTag, soldierSprite, toast, undoable, weaponDelta, weaponIcon, weaponTraits } from './components';
import { playGacha } from './gacha';
import { weaponFront } from './recruit';
import { goTo } from './nav';
import { openSoldier } from './roster';

const RARITY_PLURAL: Record<Rarity, string> = { common: 'communes', rare: 'rares', epic: 'épiques', legendary: 'légendaires' };

const selected = new Set<string>();

// Armes vendables en lot : non équipées (une arme équipée se vend une par une, depuis sa tuile)
function sellableWeapons(rarity?: Rarity): WeaponItem[] {
  const st = getState();
  const equipped = new Set(st.soldiers.map((s) => s.weaponUid));
  return st.weapons.filter((w) => !equipped.has(w.uid) && (!rarity || WEAPONS_BY_ID[w.defId].rarity === rarity));
}

function statItem(label: string, value: string): HTMLElement {
  return h('div', { class: 'weapon-stat' }, h('span', { class: 'weapon-stat-label' }, label), h('b', null, value));
}

function weaponsValue(items: WeaponItem[]): number {
  return items.reduce((sum, w) => sum + RARITIES[WEAPONS_BY_ID[w.defId].rarity].sellValue, 0);
}

async function sellItems(items: WeaponItem[]): Promise<void> {
  if (items.length === 0) return;
  const gold = weaponsValue(items);
  const counts = new Map<string, number>();
  for (const w of items) counts.set(w.defId, (counts.get(w.defId) ?? 0) + 1);
  const ok = await confirmDialog({
    title: `Vendre ${items.length} arme${items.length > 1 ? 's' : ''} ?`,
    body: [
      h('p', null, `Vous recevrez ${fmt(gold)} or. Vous pourrez annuler juste après.`),
      h('ul', { class: 'confirm-list' }, [...counts].map(([defId, n]) => h('li', { style: `color:${RARITIES[WEAPONS_BY_ID[defId].rarity].color}` }, `${WEAPONS_BY_ID[defId].name}${n > 1 ? ` ×${n}` : ''}`))),
    ],
    confirm: `Vendre (+${fmt(gold)} or)`,
  });
  if (!ok) return;
  for (const w of items) selected.delete(w.uid);
  undoable(
    (st) => sellWeapons(st, items.map((w) => w.uid)),
    (earned) => `${items.length} arme${items.length > 1 ? 's' : ''} vendue${items.length > 1 ? 's' : ''} (+${fmt(earned)} or).`,
  );
}

// Choisir le soldat qui recevra l'arme, en voyant ce que chacun y gagne ou y perd
function openEquip(uid: string): void {
  openModal((close) => {
    const st = getState();
    const item = st.weapons.find((w) => w.uid === uid);
    if (!item) {
      queueMicrotask(close);
      return h('div');
    }
    const def = WEAPONS_BY_ID[item.defId];
    // Les soldats sans arme d'abord : ce sont eux qui en ont le plus besoin
    const soldiers = sortSquad(st, getSquadSort()).sort((a, b) => Number(!!a.weaponUid) - Number(!!b.weaponUid));
    return h(
      'div',
      { class: 'detail' },
      h('button', { class: 'modal-close', onclick: close, title: 'Fermer (Échap)' }, '×'),
      h('h2', { style: `color:${RARITIES[def.rarity].color}` }, `Équiper : ${def.name}`),
      h('p', { class: 'muted small' }, "Choisissez un soldat. Si l'arme est déjà portée par quelqu'un, les deux soldats échangent leurs armes."),
      soldiers.length === 0
        ? h('p', { class: 'muted' }, 'Aucun soldat dans l’escouade.')
        : h(
            'div',
            { class: 'equip-list' },
            soldiers.map((s) => {
              const current = weaponForSoldier(s, st.weapons);
              const holds = s.weaponUid === uid;
              return h(
                'button',
                {
                  class: `equip-item${holds ? ' active' : ''}`,
                  disabled: holds,
                  onclick: () => {
                    mutate((state) => equipWeapon(state, s.id, uid));
                    toast(`${s.name} s'équipe de : ${def.name}.`, 'good');
                    close();
                  },
                },
                h('div', { class: 'row-portrait' }, soldierSprite(st, s)),
                h(
                  'span',
                  { class: 'equip-info' },
                  h('b', null, s.name),
                  h('small', null, rarityTag(s.rarity), ` · Niv. ${s.level} · `, s.weaponUid ? current.name : h('span', { class: 'warn' }, 'sans arme')),
                  holds ? h('small', null, 'Équipée actuellement') : weaponDelta(s, current, def),
                ),
              );
            }),
          ),
    );
  });
}

function forge(rarity: Rarity): void {
  const known = new Set(getState().weapons.map((w) => w.defId));
  const res = mutate((st) => forgeWeapons(st, rarity));
  if (!res.ok) {
    toast(res.error, 'bad');
    return;
  }
  for (const uid of res.consumed) selected.delete(uid);
  const def = WEAPONS_BY_ID[res.weapon.defId];
  playGacha({
    kind: 'weapon',
    title: 'Forge',
    items: [{ rarity: def.rarity, front: weaponFront(def, !known.has(def.id)) }],
    actions: (close) => [h('button', { class: 'btn', onclick: close }, 'Continuer')],
  });
}

// Forge : les doublons d'une rareté deviennent une arme de la rareté supérieure (seules les armes non équipées partent)
function forgePanel(st: GameState): HTMLElement | false {
  if (st.weapons.length === 0) return false;
  if (!isUnlocked(st, 'forge')) {
    return h('p', { class: 'muted small locked-note' }, `🔒 Forge : fusionnez ${FORGE_INPUT} armes d'une rareté en une arme de la rareté supérieure. Se débloque au niveau ${unlockLevel('forge')} de la campagne.`);
  }
  const rarities = RARITY_ORDER.filter((r): r is Exclude<Rarity, 'legendary'> => r !== 'legendary');
  return h(
    'div',
    { class: 'bulk-bar forge-bar' },
    h('span', { class: 'muted small' }, `Forge (${FORGE_INPUT} armes non équipées → 1 de rareté supérieure) :`),
    rarities.map((r) => {
      const have = forgeableWeapons(st, r).length;
      const fee = FORGE_FEE[r];
      const next = RARITY_ORDER[RARITY_ORDER.indexOf(r) + 1];
      return h(
        'button',
        {
          class: 'btn btn-small btn-rarity',
          style: `--rc:${RARITIES[next].color}`,
          disabled: have < FORGE_INPUT || st.gold < fee,
          title: have < FORGE_INPUT ? `Il faut ${FORGE_INPUT} armes ${RARITY_PLURAL[r]} non équipées (vous en avez ${have}).` : st.gold < fee ? `Il manque ${fmt(fee - st.gold)} or.` : undefined,
          onclick: () => forge(r),
        },
        `${RARITY_PLURAL[r]} (${have}/${FORGE_INPUT}) → ${RARITIES[next].label} · ${fee} or`,
      );
    }),
  );
}

export function renderArsenal(): HTMLElement {
  const st = getState();
  const owners = new Map(st.soldiers.filter((s) => s.weaponUid).map((s) => [s.weaponUid as string, s]));
  const unarmed = st.soldiers.filter((s) => !s.weaponUid).length;
  const free = st.weapons.length - owners.size;
  const sellable = sellableWeapons();
  const sellableUids = new Set(sellable.map((w) => w.uid));
  for (const uid of [...selected]) if (!sellableUids.has(uid)) selected.delete(uid);

  const sorted = [...st.weapons].sort(
    (a, b) => RARITY_ORDER.indexOf(WEAPONS_BY_ID[b.defId].rarity) - RARITY_ORDER.indexOf(WEAPONS_BY_ID[a.defId].rarity) || a.defId.localeCompare(b.defId),
  );
  const selection = sellable.filter((w) => selected.has(w.uid));

  return h(
    'section',
    null,
    h('h2', { class: 'section-title' }, `Arsenal (${st.weapons.length})`),
    h(
      'p',
      { class: 'muted' },
      "Les armes s'obtiennent en campagne ou à l'",
      h('button', { class: 'link', onclick: () => goTo('recruit') }, 'armurerie'),
      ". Équipez-les avec « Équiper sur… », ou vendez les doublons pour de l'or.",
    ),
    unarmed > 0 &&
      free > 0 &&
      h(
        'p',
        { class: 'warn' },
        `${unarmed} soldat${unarmed > 1 ? 's' : ''} sans arme alors que ${free} arme${free > 1 ? 's sont disponibles' : ' est disponible'}. `,
        h('button', { class: 'link', onclick: () => goTo('roster') }, "Aller à l'escouade"),
      ),
    st.weapons.length > 0 &&
      h(
        'div',
        { class: 'bulk-bar' },
        h('span', { class: 'muted small' }, 'Vendre les armes non équipées :'),
        RARITY_ORDER.map((r) => {
          const items = sellableWeapons(r);
          return h(
            'button',
            { class: 'btn btn-small btn-rarity', disabled: items.length === 0, onclick: () => void sellItems(items) },
            `${RARITY_PLURAL[r]} (${items.length})`,
          );
        }),
      ),
    forgePanel(st),
    selected.size > 0 &&
      h(
        'div',
        { class: 'section-head' },
        h('b', null, `${selected.size} sélectionnée${selected.size > 1 ? 's' : ''}`),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn btn-small', onclick: () => { for (const w of sellable) selected.add(w.uid); refresh(); } }, 'Tout sélectionner'),
          h('button', { class: 'btn btn-small', onclick: () => { selected.clear(); refresh(); } }, 'Vider'),
          h('button', { class: 'btn btn-small btn-gold', onclick: () => void sellItems(selection) }, `Vendre la sélection (+${fmt(weaponsValue(selection))} or)`),
        ),
      ),
    sorted.length === 0
      ? h('p', { class: 'muted' }, 'Aucune arme pour le moment.')
      : h(
          'div',
          { class: 'weapon-grid' },
          sorted.map((w) => {
            const def = WEAPONS_BY_ID[w.defId];
            const info = RARITIES[def.rarity];
            const owner = owners.get(w.uid);
            return h(
              'div',
              { class: 'weapon-card', style: `--rc:${info.color}` },
              h(
                'div',
                { class: 'weapon-head' },
                h('input', {
                  class: 'weapon-check',
                  type: 'checkbox',
                  checked: selected.has(w.uid),
                  disabled: !!owner,
                  title: owner ? 'Arme équipée : non vendable en lot' : 'Sélectionner pour la vente',
                  onchange: (e) => {
                    if ((e.target as HTMLInputElement).checked) selected.add(w.uid);
                    else selected.delete(w.uid);
                    refresh();
                  },
                }),
                h('b', { class: 'weapon-name', style: `color:${info.color}` }, def.name),
                familyTag(def),
              ),
              h('div', { class: 'weapon-art' }, weaponIcon(def)),
              h(
                'div',
                { class: 'weapon-stats' },
                statItem('Dégâts', fmt(def.damage)),
                statItem('Portée', fmt(def.range)),
                statItem('Recharge', `${fmt(def.cooldown, 2)} s`),
                statItem('DPS', fmt(def.damage / def.cooldown, 1)),
                def.aoe ? statItem('Zone', fmt(def.aoe)) : false,
                def.armor ? statItem('Armure', `+${fmt(def.armor)}`) : false,
              ),
              weaponTraits(def).length > 0 && h('small', { class: 'weapon-traits' }, weaponTraits(def).join(' · ')),
              owner
                ? h('small', { class: 'owner' }, `${info.label} · Équipée par `, h('button', { class: 'link', title: 'Ouvrir la fiche du soldat', onclick: () => openSoldier(owner.id) }, owner.name))
                : h('small', { class: 'muted' }, `${info.label} · Disponible`),
              h(
                'div',
                { class: 'weapon-actions' },
                h('button', { class: 'btn btn-small', disabled: st.soldiers.length === 0, onclick: () => openEquip(w.uid) }, 'Équiper sur…'),
                h(
                  'button',
                  {
                    class: `btn btn-small${owner ? ' btn-danger' : ''}`,
                    title: owner ? `${owner.name} se retrouvera à mains nues` : undefined,
                    onclick: () => {
                      selected.delete(w.uid);
                      undoable(
                        (state) => sellWeapons(state, [w.uid]),
                        (gold) => `${def.name} vendue (+${gold} or).${owner ? ` ${owner.name} se bat désormais à mains nues.` : ''}`,
                      );
                    },
                  },
                  `Vendre ${info.sellValue} or`,
                ),
              ),
            );
          }),
        ),
  );
}
