import { FORGE_FEE, FORGE_INPUT, RARITIES, RARITY_ORDER, WEAPON_MAX_PLUS, WEAPON_PLUS_DMG, WEAPON_PLUS_MATERIAL, WEAPONS_BY_ID } from '../game/data';
import { isUnlocked, unlockLevel } from '../game/progress';
import { upgradeCost, upgradeMaterials, upgradeNeedsMaterial, upgradeWeapon, weaponSellValue } from '../game/weapons';
import { equipWeapon, forgeableWeapons, forgeWeapons, sellWeapons, sortSquad } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import { weaponForSoldier } from '../game/stats';
import type { GameState, Rarity, WeaponItem } from '../game/types';
import { h } from './dom';
import { confirmDialog, familyTag, fmt, fold, getSquadSort, itemDef, itemTags, openModal, rarityTag, soldierSprite, toast, undoable, weaponDelta, weaponIcon, weaponTraits } from './components';
import { playGacha } from './gacha';
import { weaponFront } from './recruit';
import { goTo } from './nav';
import { openSoldier } from './roster';

const RARITY_PLURAL: Record<Rarity, string> = { common: 'communes', rare: 'rares', epic: 'épiques', legendary: 'légendaires', mythic: 'mythiques' };

const selected = new Set<string>();

type WeaponFilter = 'all' | 'free' | 'equipped';
let weaponFilter: WeaponFilter = 'all';

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
  return items.reduce((sum, w) => sum + weaponSellValue(w), 0);
}

async function sellItems(items: WeaponItem[]): Promise<void> {
  if (items.length === 0) return;
  const gold = weaponsValue(items);
  const counts = new Map<string, number>();
  const byName = new Map<string, WeaponItem>();
  for (const w of items) {
    const name = itemDef(w).name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    byName.set(name, w);
  }
  const ok = await confirmDialog({
    title: `Vendre ${items.length} arme${items.length > 1 ? 's' : ''} ?`,
    body: [
      h('p', null, `Vous recevrez ${fmt(gold)} or. Vous pourrez annuler juste après.`),
      h('ul', { class: 'confirm-list' }, [...counts].map(([name, n]) => h('li', { style: `color:${RARITIES[WEAPONS_BY_ID[byName.get(name)!.defId].rarity].color}` }, `${name}${n > 1 ? ` ×${n}` : ''}`))),
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
    const def = itemDef(item);
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
  const def = itemDef(res.weapon);
  playGacha({
    kind: 'weapon',
    title: def.rarity === 'mythic' ? 'Forge mythique' : 'Forge',
    items: [{ rarity: def.rarity, front: weaponFront(def, !known.has(def.id), res.weapon) }],
    actions: (close) => [h('button', { class: 'btn', onclick: close }, 'Continuer')],
  });
}

// Forge : les doublons d'une rareté deviennent une arme de la rareté supérieure (seules les armes non équipées partent)
function forgePanel(st: GameState): HTMLElement | false {
  if (st.weapons.length === 0) return false;
  if (!isUnlocked(st, 'forge')) return false;
  const rarities = RARITY_ORDER.filter((r): r is Exclude<Rarity, 'mythic'> => r !== 'mythic' && (r !== 'legendary' || isUnlocked(st, 'mythicforge')));
  const ready = rarities.filter((r) => forgeableWeapons(st, r).length >= FORGE_INPUT && st.gold >= FORGE_FEE[r]).length;
  return fold(`arsenal-forge`, `⚒️ Forge${ready > 0 ? ` : ${ready} fusion${ready > 1 ? 's' : ''} possible${ready > 1 ? 's' : ''}` : ''}`, h(
    'div',
    { class: 'bulk-bar forge-bar' },
    h('span', { class: 'muted small' }, `${FORGE_INPUT} armes non équipées → 1 de rareté supérieure`),
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
  ));
}

// Atelier : +1 à +10, payé en or, puis en sacrifiant une arme de même rareté à partir de +5
function upgradeButton(st: GameState, w: WeaponItem): HTMLElement {
  const plus = w.plus ?? 0;
  if (plus >= WEAPON_MAX_PLUS) return h('span', { class: 'tag tag-plus' }, `Maximum +${WEAPON_MAX_PLUS}`);
  const cost = upgradeCost(w);
  const material = upgradeNeedsMaterial(w);
  const materials = material ? upgradeMaterials(st, w).length : 1;
  const reason = st.gold < cost ? `Il manque ${fmt(cost - st.gold)} or.` : materials === 0 ? `Il faut une autre arme ${RARITIES[WEAPONS_BY_ID[w.defId].rarity].label.toLowerCase()} non équipée et non améliorée.` : undefined;
  return h(
    'button',
    {
      class: 'btn btn-small btn-gold',
      disabled: !!reason,
      title: reason ?? `+${Math.round(WEAPON_PLUS_DMG * 100)} % dégâts${material ? ' · consomme une arme de même rareté' : ''}`,
      onclick: () => {
        const r = mutate((state) => upgradeWeapon(state, w.uid));
        if (!r.ok) toast(r.error, 'bad');
        else {
          if (r.consumed) selected.delete(r.consumed);
          toast(`Arme améliorée à +${r.plus} !`, 'good');
        }
      },
    },
    `⚒ +${plus + 1} · ${fmt(cost)} or${material ? ' + 1 arme' : ''}`,
  );
}

function workshopNote(st: GameState): HTMLElement {
  return isUnlocked(st, 'workshop')
    ? h('p', { class: 'muted small' }, `⚒ Atelier : chaque cran ajoute +${Math.round(WEAPON_PLUS_DMG * 100)} % de dégâts (jusqu'à +${WEAPON_MAX_PLUS}). À partir de +${WEAPON_PLUS_MATERIAL}, une arme de même rareté, non équipée et non améliorée, est aussi consommée.`)
    : h('p', { class: 'muted small' }, `🔒 L'Atelier (améliorations +1 à +${WEAPON_MAX_PLUS}) ouvre au niveau ${unlockLevel('workshop')} de la campagne.`);
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
    (a, b) => RARITY_ORDER.indexOf(WEAPONS_BY_ID[b.defId].rarity) - RARITY_ORDER.indexOf(WEAPONS_BY_ID[a.defId].rarity) || (b.plus ?? 0) - (a.plus ?? 0) || a.defId.localeCompare(b.defId),
  );
  const workshop = isUnlocked(st, 'workshop');
  const selection = sellable.filter((w) => selected.has(w.uid));
  const shown = sorted.filter((w) => weaponFilter === 'all' || owners.has(w.uid) === (weaponFilter === 'equipped'));
  const filterChip = (key: WeaponFilter, label: string, count: number) => h('button', { class: `chip${weaponFilter === key ? ' active' : ''}`, onclick: () => { weaponFilter = key; refresh(); } }, `${label} (${count})`);

  return h(
    'section',
    null,
    h('h2', { class: 'section-title' }, `Armes (${st.weapons.length})`),
    unarmed > 0 &&
      free > 0 &&
      h(
        'p',
        { class: 'warn' },
        `${unarmed} soldat${unarmed > 1 ? 's' : ''} sans arme alors que ${free} arme${free > 1 ? 's sont disponibles' : ' est disponible'}. `,
        h('button', { class: 'link', onclick: () => goTo('roster') }, 'Voir les soldats'),
      ),
    sellable.length > 0 &&
      fold(
        'arsenal-sell',
        `Vendre en lot (${sellable.length} non équipées)`,
        h(
          'div',
          { class: 'bulk-bar' },
          RARITY_ORDER.map((r) => {
            const items = sellableWeapons(r);
            return h(
              'button',
              { class: 'btn btn-small btn-rarity', disabled: items.length === 0, onclick: () => void sellItems(items) },
              `${RARITY_PLURAL[r]} (${items.length})`,
            );
          }),
        ),
      ),
    forgePanel(st),
    st.weapons.length > 0 && workshopNote(st),
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
    st.weapons.length > 0 && h('div', { class: 'row' }, filterChip('all', 'Toutes', st.weapons.length), filterChip('free', '✓ Libres', free), filterChip('equipped', '🪖 Équipées', owners.size)),
    shown.length === 0
      ? h('p', { class: 'muted' }, st.weapons.length === 0 ? 'Aucune arme pour le moment.' : 'Aucune arme dans cette catégorie.')
      : h(
          'div',
          { class: 'weapon-grid' },
          shown.map((w) => {
            const def = itemDef(w);
            const info = RARITIES[def.rarity];
            const owner = owners.get(w.uid);
            const value = weaponSellValue(w);
            return h(
              'div',
              { class: `weapon-card rarity-${def.rarity} ${owner ? 'is-equipped' : 'is-free'}`, style: `--rc:${info.color}` },
              owner
                ? h('div', { class: 'weapon-status status-equipped' }, soldierSprite(st, owner), h('span', null, 'Équipée par ', h('button', { class: 'link', title: 'Ouvrir la fiche du soldat', onclick: () => openSoldier(owner.id) }, owner.name)))
                : h('div', { class: 'weapon-status status-free' }, '✓ Libre'),
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
              itemTags(w).length > 0 && h('div', { class: 'weapon-tags' }, itemTags(w)),
              h('div', { class: 'weapon-art' }, weaponIcon(def)),
              h(
                'div',
                { class: 'weapon-stats' },
                statItem('DPS', fmt(def.damage / def.cooldown, 1)),
                statItem('Portée', fmt(def.range)),
                def.aoe ? statItem('Zone', fmt(def.aoe)) : false,
                def.armor ? statItem('Armure', `+${fmt(def.armor)}`) : false,
              ),
              weaponTraits(def).length > 0 && h('small', { class: 'weapon-traits' }, weaponTraits(def).join(' · ')),
              h(
                'div',
                { class: 'weapon-actions' },
                h('button', { class: 'btn btn-small', disabled: st.soldiers.length === 0, onclick: () => openEquip(w.uid) }, 'Équiper sur…'),
                workshop && upgradeButton(st, w),
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
                  `Vendre ${value} or`,
                ),
              ),
            );
          }),
        ),
  );
}
