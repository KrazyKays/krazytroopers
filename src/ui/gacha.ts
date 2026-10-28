import { RARITIES, RARITY_ORDER } from '../game/data';
import type { Rarity } from '../game/types';
import { h } from './dom';
import { isMuted, sfx, toggleMute } from './sfx';

export interface GachaItem {
  rarity: Rarity;
  /** Face révélée de la carte. */
  front: HTMLElement;
  /** Clic sur la carte une fois révélée (la séquence se ferme d'abord). */
  onOpen?: () => void;
}

export interface GachaOpts {
  kind: 'soldier' | 'weapon';
  title: string;
  items: GachaItem[];
  /** Boutons affichés une fois toutes les cartes révélées. */
  actions: (close: () => void) => HTMLElement[];
}

const rank = (r: Rarity): number => RARITY_ORDER.indexOf(r);
const CRATE_LABEL = { soldier: 'Recrues', weapon: 'Armes' };

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Gerbe d'étincelles centrée sur `at` (ou sur l'écran). */
function sparks(host: HTMLElement, color: string, count: number, power: number, at?: HTMLElement): void {
  if (reducedMotion()) return;
  const r = at?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = power * (0.4 + Math.random() * 0.8);
    const dur = 500 + Math.random() * 600;
    const p = h('span', {
      class: 'gacha-spark',
      style: `left:${x}px;top:${y}px;--c:${Math.random() < 0.25 ? '#fff' : color};--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist}px;--sz:${3 + Math.random() * 6}px;--d:${dur}ms`,
    });
    host.appendChild(p);
    setTimeout(() => p.remove(), dur);
  }
}

/**
 * Séquence de tirage : une caisse tremble en prenant la couleur de la meilleure rareté,
 * s'ouvre, puis les cartes se retournent une à une (avec suspense pour les Épiques et Légendaires).
 */
export function playGacha(o: GachaOpts): void {
  const calm = reducedMotion();
  const best = o.items.reduce((a, b) => (rank(b.rarity) > rank(a.rarity) ? b : a)).rarity;
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, calm ? Math.min(ms, 60) : ms);
    timers.add(id);
  };
  const clearTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  let stage: 'crate' | 'cards' | 'done' = 'crate';
  const flipped = o.items.map(() => false);

  const overlay = h('div', { class: `gacha gacha-kind-${o.kind}`, style: `--best:${RARITIES[best].color}` });
  const stageEl = h('div', { class: 'gacha-stage' });
  const footer = h('div', { class: 'gacha-footer' });
  const muteBtn = h('button', { class: 'gacha-mute', title: 'Activer / couper le son', onclick: () => { toggleMute(); muteBtn.textContent = isMuted() ? '🔇' : '🔊'; } }, isMuted() ? '🔇' : '🔊');
  overlay.append(h('div', { class: 'gacha-bg' }), muteBtn, h('h2', { class: 'gacha-title' }, o.title), stageEl, footer);

  const close = () => {
    clearTimers();
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };

  // ---------- Étape 1 : la caisse ----------
  const crate = h(
    'button',
    { class: `gacha-crate gacha-crate-${o.kind}`, title: 'Ouvrir', onclick: () => openCrate() },
    h('span', { class: 'gacha-crate-lid' }),
    h('span', { class: 'gacha-crate-label' }, CRATE_LABEL[o.kind]),
    h('span', { class: 'gacha-crate-count' }, `×${o.items.length}`),
  );
  stageEl.append(h('div', { class: 'gacha-crate-wrap' }, h('div', { class: 'gacha-crate-glow' }), crate), h('p', { class: 'gacha-hint' }, 'Touchez la caisse pour l’ouvrir'));
  footer.append(h('button', { class: 'btn btn-small gacha-skip', onclick: () => revealAll() }, 'Tout révéler'));

  // La caisse s'agite de plus en plus, puis trahit la meilleure rareté par sa lueur
  const rattles = calm ? 0 : 6 + rank(best) * 2;
  for (let i = 0; i < rattles; i++) later(150 + i * (900 / rattles), () => sfx.rattle());
  later(700, () => overlay.classList.add('gacha-tease', `gacha-tease-${best}`));
  later(1500 + rank(best) * 250, () => openCrate());

  function openCrate(): void {
    if (stage !== 'crate') return;
    stage = 'cards';
    clearTimers();
    overlay.classList.add('gacha-tease', `gacha-tease-${best}`);
    sfx.burst();
    const flash = h('div', { class: 'gacha-flash' });
    overlay.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
    sparks(overlay, RARITIES[best].color, 30 + rank(best) * 20, 260 + rank(best) * 80, crate);
    if (best === 'legendary') shake();
    showCards();
  }

  // ---------- Étape 2 : les cartes ----------
  const cards = o.items.map((it, i) =>
    h(
      'div',
      { class: `gacha-card rarity-${it.rarity}`, style: `--rc:${RARITIES[it.rarity].color};--i:${i}`, onclick: () => (flipped[i] ? openItem(i) : flip(i)) },
      h(
        'div',
        { class: 'gacha-inner' },
        h('div', { class: 'gacha-back' }, h('span', { class: 'gacha-back-mark' }, '?')),
        h('div', { class: 'gacha-front' }, h('div', { class: 'gacha-rays' }), h('div', { class: 'gacha-shine' }), it.front),
      ),
    ),
  );

  function showCards(): void {
    const grid = h('div', { class: `gacha-grid${o.items.length === 1 ? ' single' : ''}` }, cards);
    stageEl.replaceChildren(grid);
    later(350 + o.items.length * 70, nextFlip);
  }

  function nextFlip(): void {
    const i = flipped.indexOf(false);
    if (i < 0) return;
    const r = o.items[i].rarity;
    if (rank(r) >= rank('epic') && !calm) {
      cards[i].classList.add('charging');
      sfx.charge();
      later(r === 'legendary' ? 1000 : 650, () => {
        flip(i);
        later(450, nextFlip);
      });
    } else {
      flip(i);
      later(o.items.length === 1 ? 0 : 230, nextFlip);
    }
  }

  function flip(i: number, quiet = false): void {
    if (flipped[i] || stage === 'crate') return;
    flipped[i] = true;
    const card = cards[i];
    const r = o.items[i].rarity;
    card.classList.remove('charging');
    card.classList.add('flipped');
    if (!quiet) {
      sfx.flip();
      later(120, () => sfx.reveal(r));
    }
    if (rank(r) >= rank('rare')) later(150, () => sparks(overlay, RARITIES[r].color, [0, 10, 28, 60][rank(r)], [0, 90, 160, 260][rank(r)], card));
    if (r === 'legendary' && !quiet) later(150, shake);
    if (flipped.every(Boolean)) finish();
  }

  function revealAll(): void {
    if (stage === 'crate') openCrate();
    if (stage === 'done') return;
    clearTimers();
    for (let i = 0; i < cards.length; i++) flip(i, true);
    sfx.reveal(best);
  }

  function openItem(i: number): void {
    const fn = o.items[i].onOpen;
    if (!fn || stage !== 'done') return;
    close();
    fn();
  }

  function shake(): void {
    overlay.classList.remove('gacha-shake');
    void overlay.offsetWidth;
    overlay.classList.add('gacha-shake');
  }

  // ---------- Étape 3 : bilan ----------
  function finish(): void {
    stage = 'done';
    const counts = RARITY_ORDER.map((r) => [r, o.items.filter((it) => it.rarity === r).length] as const)
      .filter(([, n]) => n > 0)
      .reverse();
    footer.replaceChildren(
      h(
        'div',
        { class: 'gacha-summary' },
        counts.map(([r, n]) => h('span', { class: 'gacha-count', style: `--rc:${RARITIES[r].color}` }, `${n} ${RARITIES[r].label}`)),
      ),
      h('div', { class: 'gacha-actions' }, o.actions(close)),
    );
    later(0, () => footer.querySelector<HTMLElement>('.gacha-actions .btn')?.focus());
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      if (stage === 'done') close();
      else revealAll();
    } else if ((e.key === ' ' || e.key === 'Enter') && stage !== 'done') {
      e.preventDefault();
      if (stage === 'crate') openCrate();
      else revealAll();
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  crate.focus();
}
