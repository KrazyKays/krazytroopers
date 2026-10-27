import { RARITY_ORDER, SQUAD_MAX, TRAINING_PER_DAY } from '../game/data';
import { campaignGold, campaignXp, launchBattle, trainingXp, TRAINING_GOLD } from '../game/combat';
import { previewCampaign } from '../game/enemies';
import { getState, isAvailable, mutate, refresh } from '../game/state';
import type { GameState } from '../game/types';
import { h } from './dom';
import { openBattle } from './battleView';
import { fmt, soldierCard, toast } from './components';

type Mode = 'training' | 'campaign';

let mode: Mode = 'training';
const selected = new Set<string>();
let campaignPick: number | null = null;

function autoSelect(st: GameState): void {
  selected.clear();
  const ready = st.soldiers.filter((s) => isAvailable(s)).sort((a, b) => b.level - a.level || RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
  for (const s of ready.slice(0, SQUAD_MAX)) selected.add(s.id);
}

function launch(): void {
  const st = getState();
  const squad = [...selected];
  const level = Math.min(campaignPick ?? st.campaignLevel + 1, st.campaignLevel + 1);
  const res = mutate((state) => launchBattle(state, mode === 'training' ? { mode: 'training', squad } : { mode: 'campaign', squad, level }));
  if (!res.ok) {
    toast(res.error, 'bad');
    return;
  }
  selected.clear();
  const title = mode === 'training' ? 'Entraînement' : `Campagne — niveau ${level}`;
  openBattle(title, res.units, res.result, res.report, () => {
    // l'état est déjà enregistré : on rafraîchit simplement l'écran
    refresh();
  });
}

export function renderCombat(): HTMLElement {
  const st = getState();
  for (const id of [...selected]) {
    const s = st.soldiers.find((x) => x.id === id);
    if (!s || !isAvailable(s)) selected.delete(id);
  }
  const nextLevel = st.campaignLevel + 1;
  const level = Math.min(campaignPick ?? nextLevel, nextLevel);

  const tabs = h(
    'div',
    { class: 'subtabs' },
    h('button', { class: `subtab${mode === 'training' ? ' active' : ''}`, onclick: () => { mode = 'training'; refresh(); } }, `Entraînement (${st.trainingLeft}/${TRAINING_PER_DAY})`),
    h('button', { class: `subtab${mode === 'campaign' ? ' active' : ''}`, onclick: () => { mode = 'campaign'; refresh(); } }, `Campagne (niveau ${nextLevel})`),
  );

  let info: HTMLElement;
  if (mode === 'training') {
    const avg = selected.size ? [...selected].reduce((n, id) => n + (st.soldiers.find((s) => s.id === id)?.level ?? 1), 0) / selected.size : 1;
    info = h(
      'div',
      { class: 'panel' },
      h('h3', null, "Combat d'entraînement"),
      h('p', null, `Affrontez des cibles adaptées au niveau de votre escouade pour gagner de l'expérience (environ ${fmt(trainingXp(avg))} XP par survivant, ${TRAINING_GOLD} or en cas de victoire).`),
      h('p', { class: 'muted small' }, `Vous disposez de ${TRAINING_PER_DAY} entraînements par jour. Un soldat vaincu est indisponible jusqu'au lendemain.`),
    );
  } else {
    const prev = previewCampaign(level);
    const cleared = level <= st.campaignLevel;
    info = h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'level-picker' },
        h('button', { class: 'btn btn-small', disabled: level <= 1, onclick: () => { campaignPick = level - 1; refresh(); } }, '◀'),
        h('h3', null, `Niveau ${level}${prev.boss ? ' — BOSS' : ''}`),
        h('button', { class: 'btn btn-small', disabled: level >= nextLevel, onclick: () => { campaignPick = level + 1; refresh(); } }, '▶'),
      ),
      h('p', null, `${prev.count} ennemis : ${prev.names.join(', ')}.`),
      h(
        'p',
        null,
        cleared
          ? `Niveau déjà terminé : récompenses réduites (${fmt(campaignXp(level) / 2)} XP, ${fmt(campaignGold(level, false))} or, arme possible).`
          : `Récompenses : ${fmt(campaignXp(level))} XP par survivant, ${fmt(campaignGold(level, true))} or et une arme garantie.`,
      ),
      h('p', { class: 'muted small' }, 'En cas de défaite, les soldats survivants gagnent un peu d’XP ; les soldats tombés sont indisponibles jusqu’au lendemain.'),
    );
  }

  const ready = st.soldiers.filter((s) => isAvailable(s)).length;
  const unarmed = [...selected].map((id) => st.soldiers.find((s) => s.id === id)).filter((s) => s && !s.weaponUid);
  const canLaunch = selected.size >= 1 && (mode === 'campaign' || st.trainingLeft > 0);

  const squadPanel = h(
    'div',
    null,
    h(
      'div',
      { class: 'section-head' },
      h('h3', null, `Escouade engagée : ${selected.size} / ${SQUAD_MAX}`),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-small', onclick: () => { autoSelect(st); refresh(); } }, 'Sélection auto'),
        h('button', { class: 'btn btn-small', onclick: () => { selected.clear(); refresh(); } }, 'Vider'),
      ),
    ),
    st.soldiers.length === 0
      ? h('p', { class: 'muted' }, "Vous n'avez aucun soldat : recrutez-en dans l'onglet « Recruter ».")
      : h(
          'div',
          { class: 'grid' },
          [...st.soldiers]
            .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)) || b.level - a.level)
            .map((s) =>
              soldierCard(st, s, {
                selected: selected.has(s.id),
                onclick: () => {
                  if (!isAvailable(s)) {
                    toast(`${s.name} est hors de combat jusqu'à demain.`, 'bad');
                    return;
                  }
                  if (selected.has(s.id)) selected.delete(s.id);
                  else if (selected.size >= SQUAD_MAX) toast(`Maximum ${SQUAD_MAX} soldats par combat.`, 'bad');
                  else selected.add(s.id);
                  refresh();
                },
              }),
            ),
        ),
    unarmed.length > 0 && h('p', { class: 'warn' }, `Attention : ${unarmed.map((s) => s!.name).join(', ')} ${unarmed.length > 1 ? 'combattent' : 'combat'} à mains nues. Équipez une arme depuis l'onglet Escouade.`),
    ready === 0 && st.soldiers.length > 0 && h('p', { class: 'warn' }, "Tous vos soldats sont hors de combat : ils reviendront demain. En attendant, vous pouvez recruter."),
  );

  const launchBtn = h(
    'button',
    { class: 'btn btn-big btn-gold', disabled: !canLaunch, onclick: launch },
    mode === 'training' ? (st.trainingLeft > 0 ? "Lancer l'entraînement" : "Plus d'entraînement aujourd'hui") : `Lancer le niveau ${level}`,
  );

  return h('section', null, h('h2', null, 'Combat'), tabs, info, squadPanel, h('div', { class: 'launch-bar' }, launchBtn));
}

