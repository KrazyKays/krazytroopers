import { RARITIES, RARITY_ORDER, WEAPONS_BY_ID } from '../game/data';
import { sellWeapons } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import type { Rarity, WeaponItem } from '../game/types';
import { h } from './dom';
import { fmt, toast, weaponIcon } from './components';

const RARITY_PLURAL: Record<Rarity, string> = { common: 'communes', rare: 'rares', epic: 'épiques', legendary: 'légendaires' };

const selected = new Set<string>();

// Armes vendables : non équipées (une arme équipée se vend depuis la fiche du soldat, avec confirmation)
function sellableWeapons(rarity?: Rarity): WeaponItem[] {
  const st = getState();
  const equipped = new Set(st.soldiers.map((s) => s.weaponUid));
  return st.weapons.filter((w) => !equipped.has(w.uid) && (!rarity || WEAPONS_BY_ID[w.defId].rarity === rarity));
}

function weaponsValue(items: WeaponItem[]): number {
  return items.reduce((sum, w) => sum + RARITIES[WEAPONS_BY_ID[w.defId].rarity].sellValue, 0);
}

function sellItems(items: WeaponItem[], label: string): void {
  if (items.length === 0) return;
  const gold = weaponsValue(items);
  if (!confirm(`${label} : vendre ${items.length} arme${items.length > 1 ? 's' : ''} pour ${fmt(gold)} or ?`)) return;
  const earned = mutate((st) => sellWeapons(st, items.map((w) => w.uid)));
  for (const w of items) selected.delete(w.uid);
  toast(`${items.length} arme${items.length > 1 ? 's' : ''} vendue${items.length > 1 ? 's' : ''} (+${fmt(earned)} or).`);
}

export function renderArsenal(): HTMLElement {
  const st = getState();
  const owners = new Map(st.soldiers.filter((s) => s.weaponUid).map((s) => [s.weaponUid as string, s.name]));
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
    h('h2', null, `Arsenal (${st.weapons.length})`),
    h('p', { class: 'muted' }, "Les armes s'obtiennent en campagne. Équipez-les depuis la fiche d'un soldat, ou vendez les doublons pour de l'or."),
    st.weapons.length > 0 &&
      h(
        'div',
        { class: 'bulk-bar' },
        h('span', { class: 'muted small' }, 'Vente par rareté :'),
        RARITY_ORDER.map((r) => {
          const items = sellableWeapons(r);
          return h(
            'button',
            {
              class: 'btn btn-small',
              disabled: items.length === 0,
              onclick: () => sellItems(items, `Armes ${RARITY_PLURAL[r]}`),
            },
            `Vendre les ${RARITY_PLURAL[r]} (${items.length})`,
          );
        }),
      ),
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
          h('button', { class: 'btn btn-small btn-gold', onclick: () => sellItems(selection, 'Sélection') }, `Vendre la sélection (+${fmt(weaponsValue(selection))} or)`),
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
              weaponIcon(def),
              h(
                'div',
                { class: 'weapon-info' },
                h('b', { style: `color:${info.color}` }, def.name),
                h('small', null, `${info.label} · ${fmt(def.damage)} dégâts · portée ${fmt(def.range)} · ${fmt(def.cooldown, 2)} s${def.aoe ? ` · zone ${def.aoe}` : ''}${def.armor ? ` · armure +${def.armor}` : ''}`),
                h('small', { class: 'muted' }, owner ? `Équipée par ${owner}` : 'Disponible'),
              ),
              h(
                'button',
                {
                  class: 'btn btn-small',
                  onclick: () => {
                    if (owner && !confirm(`${def.name} est équipée par ${owner}. Vendre quand même ?`)) return;
                    const gold = mutate((state) => sellWeapons(state, [w.uid]));
                    selected.delete(w.uid);
                    toast(`${def.name} vendue (+${gold} or).`);
                  },
                },
                `Vendre ${info.sellValue} or`,
              ),
            );
          }),
        ),
  );
}
