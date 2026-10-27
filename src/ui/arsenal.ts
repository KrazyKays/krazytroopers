import { RARITIES, RARITY_ORDER, WEAPONS_BY_ID } from '../game/data';
import { sellWeapon } from '../game/roster';
import { getState, mutate } from '../game/state';
import { h } from './dom';
import { fmt, toast, weaponIcon } from './components';

export function renderArsenal(): HTMLElement {
  const st = getState();
  const owners = new Map(st.soldiers.filter((s) => s.weaponUid).map((s) => [s.weaponUid as string, s.name]));
  const sorted = [...st.weapons].sort(
    (a, b) => RARITY_ORDER.indexOf(WEAPONS_BY_ID[b.defId].rarity) - RARITY_ORDER.indexOf(WEAPONS_BY_ID[a.defId].rarity) || a.defId.localeCompare(b.defId),
  );
  return h(
    'section',
    null,
    h('h2', null, `Arsenal (${st.weapons.length})`),
    h('p', { class: 'muted' }, "Les armes s'obtiennent en campagne. Équipez-les depuis la fiche d'un soldat, ou vendez les doublons pour de l'or."),
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
              weaponIcon(def),
              h(
                'div',
                { class: 'weapon-info' },
                h('b', { style: `color:${info.color}` }, def.name),
                h('small', null, `${info.label} · ${fmt(def.damage)} dégâts · portée ${fmt(def.range)} · ${fmt(def.cooldown, 2)} s${def.aoe ? ` · zone ${def.aoe}` : ''}`),
                h('small', { class: 'muted' }, owner ? `Équipée par ${owner}` : 'Disponible'),
              ),
              h(
                'button',
                {
                  class: 'btn btn-small',
                  onclick: () => {
                    if (owner && !confirm(`${def.name} est équipée par ${owner}. Vendre quand même ?`)) return;
                    const gold = mutate((state) => sellWeapon(state, w.uid));
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
