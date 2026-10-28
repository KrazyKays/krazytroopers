import { PULL_COST } from '../game/data';
import { sortSquad } from '../game/roster';
import { getState, mutate } from '../game/state';
import type { GameState } from '../game/types';
import { openCombat } from './combat';
import { getSquadSort } from './components';
import { h } from './dom';
import { getTab, goTo, type Tab } from './nav';
import { openSoldier } from './roster';

interface Step {
  /** Titre court de l'objectif. */
  title: string;
  text: string;
  action?: { label: string; run: () => void };
  /** Onglet où l'action mène : le bouton est inutile si on y est déjà. */
  tab?: Tab;
}

// Prochaine chose utile à faire, de la plus urgente (bloquante) à la plus facultative.
// Les premières étapes servent d'apprentissage, les suivantes de rappels tout au long de la partie.
function nextStep(st: GameState): Step | null {
  if (st.soldiers.length === 0) {
    if (st.freePulls > 0) return { title: 'Recrutez votre escouade', text: `Vous avez ${st.freePulls} tirage${st.freePulls > 1 ? 's' : ''} gratuit${st.freePulls > 1 ? 's' : ''} pour former vos premiers soldats.`, action: { label: 'Recruter', run: () => goTo('recruit') }, tab: 'recruit' };
    if (st.gold >= PULL_COST) return { title: 'Recrutez des soldats', text: 'Votre escouade est vide : recrutez de nouveaux soldats.', action: { label: 'Recruter', run: () => goTo('recruit') }, tab: 'recruit' };
    return { title: 'Escouade perdue', text: "Plus de soldats ni d'or pour en recruter : vous pouvez recommencer une partie depuis l'onglet Infos.", action: { label: 'Infos', run: () => goTo('settings') }, tab: 'settings' };
  }
  const pending = sortSquad(st, getSquadSort()).filter((s) => s.picksLeft > 0);
  if (pending.length > 0) {
    return {
      title: 'Choisissez des améliorations',
      text: `${pending.length} soldat${pending.length > 1 ? 's ont' : ' a'} des améliorations en attente : elles les rendent bien plus forts.`,
      action: { label: 'Choisir', run: () => openSoldier(pending[0].id) },
    };
  }
  const equipped = new Set(st.soldiers.map((s) => s.weaponUid));
  const free = st.weapons.filter((w) => !equipped.has(w.uid)).length;
  const unarmed = st.soldiers.filter((s) => !s.weaponUid);
  if (unarmed.length > 0 && free > 0) {
    return {
      title: 'Équipez vos soldats',
      text: `${unarmed.length} soldat${unarmed.length > 1 ? 's se battent' : ' se bat'} à mains nues alors que ${free} arme${free > 1 ? 's attendent' : ' attend'} dans l'arsenal.`,
      action: { label: 'Équiper', run: () => openSoldier(unarmed[0].id) },
    };
  }
  if (st.stats.won + st.stats.lost === 0) {
    return { title: 'Premier combat', text: "Lancez un entraînement : des cibles à votre niveau, pour gagner de l'XP sans affronter la campagne.", action: { label: "S'entraîner", run: () => openCombat('training') }, tab: 'combat' };
  }
  if (st.campaignLevel === 0) {
    return { title: 'Lancez la campagne', text: 'Le niveau 1 de la campagne rapporte une arme garantie. Vérifiez les chances de victoire avant de lancer.', action: { label: 'Campagne', run: () => openCombat('campaign') }, tab: 'combat' };
  }
  if (st.freePulls > 0) {
    return { title: 'Tirages gratuits', text: `Il vous reste ${st.freePulls} tirage${st.freePulls > 1 ? 's' : ''} gratuit${st.freePulls > 1 ? 's' : ''}.`, action: { label: 'Recruter', run: () => goTo('recruit') }, tab: 'recruit' };
  }
  return null;
}

export function renderGuide(): HTMLElement | null {
  const st = getState();
  if (st.hideGuide) return null;
  const step = nextStep(st);
  if (!step) return null;
  const here = step.tab !== undefined && step.tab === getTab();
  return h(
    'div',
    { class: 'guide' },
    h('span', { class: 'guide-icon' }, '➤'),
    h('div', { class: 'guide-text' }, h('b', null, step.title), h('span', null, step.text)),
    step.action && !here && h('button', { class: 'btn btn-small btn-gold', onclick: step.action.run }, step.action.label),
    h('button', { class: 'guide-close', title: 'Masquer le guide (réactivable dans Infos)', onclick: () => mutate((g) => { g.hideGuide = true; }) }, '×'),
  );
}
