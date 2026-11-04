import { RARITIES, START_FREE_PULLS } from '../game/data';
import { nextUnlock } from '../game/progress';
import { FIRST_PULL_RARITY } from '../game/roster';
import { getState, mutate, subscribe } from '../game/state';
import { soldierToPrepare, tutorialStep, type TutorialStep } from '../game/tutorial';
import type { GameState } from '../game/types';
import { ensureSquad, openCombat } from './combat';
import { h } from './dom';
import { getTab, goTo } from './nav';
import { openSoldier } from './roster';

const KNOWN_KEY = 'krazy-troopers-tutorial-known';
/** Délai après lequel une cible introuvable fait apparaître une issue : une partie ne doit jamais rester bloquée. */
const MISSING_TARGET_MS = 2500;
const TOTAL_STEPS = 11;

interface View {
  /** Change quand le contenu de la bulle change. */
  key: string;
  step?: number;
  /** Sans titre, le tutoriel s'efface tout en gardant la main sur les clics. */
  title?: string;
  text?: string;
  /** Élément mis en lumière. */
  target?: string;
  /** Éléments cliquables ; le reste de l'écran est inerte. */
  allow?: string;
  place?: 'auto' | 'top' | 'bottom' | 'center';
  /** Laisse l'écran visible, sans l'assombrir. */
  clear?: boolean;
  /** Laisse passer le clavier : le tirage et le combat ont leurs propres raccourcis. */
  keys?: boolean;
  action?: { label: string; run: () => void };
}

let layer: HTMLElement | null = null;
let hole: HTMLElement;
let bubble: HTMLElement;
let view: View | null = null;
let frame = 0;
let scrolled = false;
let lastSignature = '';
let missingSince = 0;
let shownStuck = false;
let sheet: { id: string; close: () => void } | null = null;

function isKnownPlayer(): boolean {
  try {
    return localStorage.getItem(KNOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberPlayer(): void {
  try {
    localStorage.setItem(KNOWN_KEY, '1');
  } catch {
    // stockage indisponible : le tutoriel ne pourra simplement pas être passé la prochaine fois
  }
}

function closeSheet(): void {
  sheet?.close();
  sheet = null;
}

function finishTutorial(): void {
  closeSheet();
  mutate((g) => { g.tutorial = null; });
}

function battleView(st: GameState): View {
  const common = { allow: '.battle-overlay', clear: true, keys: true };
  if (!document.querySelector('.battle-overlay .result')) {
    return { ...common, key: 'watch', step: 8, title: 'Le combat se joue tout seul', text: 'Vos soldats agissent sans vous : tout se décide pendant la préparation. Vous pouvez accélérer ou passer le combat.', place: 'bottom' };
  }
  return st.stats.won > 0
    ? { ...common, key: 'result-won', step: 9, title: 'Victoire !', text: 'Voici vos gains : de l’or, de l’XP, des étoiles et une arme garantie pour ce premier niveau. Cliquez sur Retour quand vous avez terminé.', place: 'top' }
    : { ...common, key: 'result-lost', step: 9, title: 'Défaite, sans gravité', text: 'Personne ne meurt sur ce niveau. Cliquez sur Retour pour retenter votre chance.', place: 'top' };
}

function gachaView(st: GameState): View {
  // Pendant l'ouverture de la caisse, rien ne doit détourner l'attention
  if (!document.querySelector('.gacha-actions')) return { key: 'gacha', allow: '.gacha', clear: true, keys: true };
  const text =
    st.totalPulls === 1 ? 'La rareté augmente les statistiques d’un soldat. Celle-ci vous est offerte pour démarrer : préparons ce soldat au combat.'
    : st.totalPulls < START_FREE_PULLS ? 'Encore un tirage gratuit, et votre escouade sera au complet.'
    : 'Votre escouade est au complet pour vos premiers combats. Il reste à préparer ces recrues.';
  return { key: `gacha-done-${st.totalPulls}`, step: st.totalPulls === 1 ? 2 : 5, title: 'Nouvelle recrue !', text, target: '.gacha-actions', allow: '.gacha-actions, .gacha-mute', place: 'top', clear: true, keys: true };
}

function soldierView(st: GameState, step: TutorialStep): View | null {
  const todo = step === 'soldier' ? soldierToPrepare(st) : null;
  const first = st.totalPulls === 1;
  // Une fois prêt, le soldat reste affiché le temps de voir le résultat, même si le suivant attend
  if (sheet && sheet.id !== todo?.soldier.id) {
    const name = st.soldiers.find((s) => s.id === sheet!.id)?.name ?? 'Votre soldat';
    return {
      key: `ready-${sheet.id}`,
      step: first ? 4 : 6,
      title: `${name} : prêt au combat`,
      text: 'Ses statistiques tiennent compte de son amélioration et de son arme.',
      target: '.stats-main',
      action: { label: 'Continuer', run: closeSheet },
    };
  }
  if (!todo) return null;
  const id = todo.soldier.id;
  if (!sheet) {
    const handle = openSoldier(id, () => { if (sheet?.id === id) sheet = null; });
    sheet = { id, close: handle.close };
  }
  const name = todo.soldier.name;
  if (todo.need === 'pick') {
    const pick = { target: '.upgrade-block .choices', allow: '.choice' };
    return first
      ? { ...pick, key: 'pick-first', step: 3, title: 'Choisissez une amélioration', text: `${name} peut progresser. Le badge « Conseillé » indique le choix le plus adapté, mais les trois sont possibles : à vous de décider.` }
      : { ...pick, key: `pick-${id}`, step: 6, title: 'À vous de jouer', text: `Choisissez l’amélioration de ${name}.` };
  }
  const list = document.querySelector('.weapon-list')?.closest('details');
  if (list) list.open = true;
  const weapon = { target: '.weapon-list', allow: '.weapon-item:not(.active):not(.taken)' };
  return first
    ? { ...weapon, key: 'weapon-first', step: 4, title: 'Équipez une arme', text: `${name} n’a pas d’arme et se battrait à mains nues. Choisissez-en une parmi celles disponibles.` }
    : { ...weapon, key: `weapon-${id}`, step: 6, title: 'À vous de jouer', text: `Donnez une arme à ${name}.` };
}

/** Écran que le tutoriel attend, déduit de l'état de la partie et de ce qui est affiché. */
function currentView(st: GameState): View | null {
  const step = tutorialStep(st);
  if (!step) return null;
  if (document.querySelector('.battle-overlay')) return battleView(st);
  if (document.querySelector('.gacha')) return gachaView(st);
  const soldier = soldierView(st, step);
  if (soldier) return soldier;
  switch (step) {
    case 'intro':
      if (getTab() !== 'recruit') goTo('recruit');
      return {
        key: 'intro',
        step: 1,
        title: 'Bienvenue, commandant !',
        text: 'Formez une escouade, équipez-la et menez-la au combat. Suivez ce court tutoriel jusqu’à votre première victoire.',
        place: 'center',
        action: { label: 'Compris', run: () => mutate((g) => { if (g.tutorial) g.tutorial.introDone = true; }) },
      };
    case 'pull': {
      if (getTab() !== 'recruit') goTo('recruit');
      const free = { target: '.btn-free', allow: '.btn-free' };
      const plural = st.freePulls > 1;
      return st.totalPulls === 0
        ? { ...free, key: 'pull-first', step: 2, title: 'Recrutez votre premier soldat', text: `Vous avez ${st.freePulls} tirages gratuits. Le tout premier vous garantit une recrue ${RARITIES[FIRST_PULL_RARITY].label}.` }
        : { ...free, key: `pull-${st.totalPulls}`, step: 5, title: 'Complétez votre escouade', text: `Il vous reste ${st.freePulls} tirage${plural ? 's' : ''} gratuit${plural ? 's' : ''} : utilisez-${plural ? 'les' : 'le'} pour recruter ${plural ? 'vos prochains soldats' : 'votre dernier soldat'}.` };
    }
    case 'fight': {
      if (getTab() !== 'combat') openCombat('campaign');
      ensureSquad();
      const launch = { target: '.launch-bar', allow: '.launch-buttons .btn-primary', step: 7 };
      return st.stats.lost > 0
        ? { ...launch, key: 'fight-retry', title: 'Retentez votre chance', text: 'Votre escouade n’a rien perdu : relancez le niveau 1.' }
        : { ...launch, key: 'fight', title: 'Partez au combat', text: 'Votre escouade est engagée. Le verdict estime vos chances de victoire : consultez-le avant chaque combat, puis lancez le niveau 1.' };
    }
    case 'goal':
      if (getTab() !== 'home') goTo('home');
      return { key: 'goal', step: 10, title: 'Réclamez votre récompense', text: 'Votre victoire accomplit l’objectif « Baptême du feu ». Les objectifs rapportent de l’or et des tirages, à réclamer ici, au QG.', target: '.goal-ready .btn', allow: '.goal-ready .btn' };
    case 'end': {
      if (getTab() !== 'home') goTo('home');
      const unlock = nextUnlock(st);
      return {
        key: 'end',
        step: 11,
        title: 'Tutoriel terminé !',
        text: `${unlock ? `Le niveau ${unlock.level} de la campagne débloque « ${unlock.label} ». ` : ''}Ce cadre vous indiquera toujours la prochaine chose utile à faire. Bonne chance, commandant !`,
        target: '.hero',
        action: { label: 'Commencer à jouer', run: finishTutorial },
      };
    }
    default:
      return null;
  }
}

function renderBubble(v: View, stuck: boolean): void {
  const canSkip = stuck || isKnownPlayer();
  bubble.replaceChildren(
    h('span', { class: 'eyebrow' }, v.step ? `Tutoriel · étape ${v.step} / ${TOTAL_STEPS}` : 'Tutoriel'),
    h('b', { class: 'tuto-title' }, v.title),
    h('p', { class: 'tuto-text' }, v.text),
    h(
      'div',
      { class: 'tuto-actions' },
      canSkip && h('button', { class: 'btn btn-small btn-ghost', onclick: finishTutorial }, 'Passer le tutoriel'),
      v.action && h('button', { class: 'btn btn-primary', onclick: v.action.run }, v.action.label),
    ),
  );
  if (v.action) bubble.querySelector<HTMLElement>('.btn-primary')?.focus();
}

function placeBubble(v: View, rect: DOMRect | null): void {
  const gap = 14;
  const margin = 12;
  const b = bubble.getBoundingClientRect();
  let left = (window.innerWidth - b.width) / 2;
  let top: number;
  if (v.place === 'top') top = margin;
  else if (v.place === 'bottom') top = window.innerHeight - b.height - margin;
  else if (v.place === 'center' || !rect) top = (window.innerHeight - b.height) / 2;
  else {
    left = rect.left + rect.width / 2 - b.width / 2;
    const below = window.innerHeight - rect.bottom;
    top = below >= b.height + gap + margin || below >= rect.top ? rect.bottom + gap : rect.top - b.height - gap;
  }
  bubble.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - b.width - margin))}px`;
  bubble.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - b.height - margin))}px`;
}

function ensureLayer(): void {
  if (layer) return;
  hole = h('div', { class: 'tuto-hole' });
  bubble = h('div', { class: 'tuto-bubble' });
  layer = h('div', { class: 'tuto' }, hole, bubble);
  document.body.appendChild(layer);
  view = null;
}

function tick(): void {
  frame = 0;
  const st = getState();
  const next = currentView(st);
  if (!next) {
    view = null;
    layer?.remove();
    layer = null;
    return;
  }
  ensureLayer();
  const changed = next.key !== view?.key;
  view = next;
  if (changed) {
    scrolled = false;
    missingSince = 0;
    shownStuck = false;
  }
  const target = next.target ? document.querySelector<HTMLElement>(next.target) : null;
  if (target) missingSince = 0;
  else if (next.target && missingSince === 0) missingSince = performance.now();
  const stuck = missingSince > 0 && performance.now() - missingSince > MISSING_TARGET_MS;

  const silent = !next.title;
  bubble.hidden = silent;
  if (!silent && (changed || stuck !== shownStuck)) {
    shownStuck = stuck;
    renderBubble(next, stuck);
    lastSignature = '';
  }
  if (target && !scrolled) {
    scrolled = true;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // La cible peut bouger à tout moment (défilement, écran reconstruit) : on la suit à chaque image
  const rect = target?.getBoundingClientRect() ?? null;
  const signature = `${next.key}|${rect ? [rect.left, rect.top, rect.width, rect.height].map(Math.round).join() : ''}|${window.innerWidth}x${window.innerHeight}`;
  if (signature !== lastSignature) {
    lastSignature = signature;
    hole.className = `tuto-hole${next.clear || silent ? ' clear' : ''}${rect ? ' on-target' : ''}`;
    const pad = 6;
    hole.style.cssText = rect ? `left:${rect.left - pad}px;top:${rect.top - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px` : 'left:50%;top:50%;width:0;height:0';
    if (!silent) placeBubble(next, rect);
  }
  schedule();
}

function schedule(): void {
  if (!frame) frame = requestAnimationFrame(tick);
}

function nudge(): void {
  if (bubble.hidden) return;
  bubble.classList.remove('tuto-nudge');
  void bubble.offsetWidth;
  bubble.classList.add('tuto-nudge');
}

const isAllowed = (t: Element): boolean => !!t.closest?.('.tuto-bubble') || (!!view?.allow && !!t.closest?.(view.allow));

// Ces filtres passent avant ceux du jeu : les écrans n'ont pas à connaître le tutoriel
function guardClick(e: Event): void {
  if (!view || isAllowed(e.target as Element)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  nudge();
}

// Un clic à côté d'une fiche la fermerait ; l'intérieur reste libre pour pouvoir la faire défiler
function guardBackdrop(e: Event): void {
  if (view && (e.target as Element).classList?.contains('modal-backdrop')) e.stopImmediatePropagation();
}

function guardKeys(e: KeyboardEvent): void {
  if (!view || view.keys || !['Escape', 'Enter', ' '].includes(e.key)) return;
  if (e.key !== 'Escape' && isAllowed(e.target as Element)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function initTutorial(): void {
  window.addEventListener('click', guardClick, true);
  window.addEventListener('mousedown', guardBackdrop, true);
  window.addEventListener('keydown', guardKeys, true);
  const sync = (): void => {
    if (getState().tutorial) schedule();
    // Une partie sans tutoriel en attente : ce joueur connaît le jeu et pourra le passer s'il recommence
    else rememberPlayer();
  };
  subscribe(sync);
  sync();
}
