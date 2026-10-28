import { ARENA_H, ARENA_W, DT, type BattleEvent, type BattleResult, type BattleUnit, type Frame } from '../game/battle';
import { RARITIES } from '../game/data';
import type { BattleReport } from '../game/combat';
import { getState } from '../game/state';
import { BATTLE_SPEEDS, type BattleSpeed } from '../game/types';
import { h, html } from './dom';
import { spriteSvg } from './avatar';
import { fmt, weaponIcon } from './components';

interface UnitView {
  el: HTMLElement;
  fill: HTMLElement;
  sprite: HTMLElement;
  facing: 1 | -1;
}

export interface ReplayAction {
  label: string;
  run: () => void;
}

/**
 * `report` est nul pour une simulation : pas de récompense ni de progression à annoncer.
 * `onReplay`, s'il est fourni, ajoute un bouton pour enchaîner aussitôt un nouveau combat avec la même escouade.
 */
export function openBattle(title: string, units: BattleUnit[], result: BattleResult, report: BattleReport | null, onClose: () => void, onReplay?: ReplayAction): void {
  const frames = result.frames;
  // Le bouton qui a lancé le combat garde sinon le focus sous l'overlay : Espace ou Entrée le relanceraient
  (document.activeElement as HTMLElement | null)?.blur();
  let speed: BattleSpeed = getState().battleSpeed;
  let idx = 0;
  let timer: number | undefined;
  let finished = false;

  const arena = h('div', { class: 'arena' });
  const hud = h('div', { class: 'battle-hud' });
  const views: UnitView[] = units.map((u) => {
    const facing: 1 | -1 = u.team === 'ally' ? 1 : -1;
    const fill = h('div', { class: 'hp-fill' });
    const sprite = html(spriteSvg(u.look, 'sprite'));
    const spriteWrap = h('div', { class: 'unit-sprite', style: `transform:scaleX(${facing})` }, sprite);
    const el = h(
      'div',
      { class: `unit team-${u.team}`, style: `--s:${u.scale}` },
      h('div', { class: 'hpbar' }, fill),
      spriteWrap,
      u.scale > 1 && h('div', { class: 'unit-name' }, u.name),
    );
    arena.appendChild(el);
    return { el, fill, sprite: spriteWrap, facing };
  });

  const pos = (x: number, y: number) => `left:${(x / ARENA_W) * 100}%;top:${(y / ARENA_H) * 100}%;z-index:${Math.round(y)}`;

  function floater(x: number, y: number, text: string, cls: string): void {
    const f = h('div', { class: `floater ${cls}`, style: pos(x, y - 30) }, text);
    f.style.zIndex = '1000';
    arena.appendChild(f);
    setTimeout(() => f.remove(), 700);
  }

  function projectile(ax: number, ay: number, bx: number, by: number, cls = 'projectile'): void {
    const p = h('div', { class: cls, style: `${pos(ax, ay - 12)};transition:none` });
    p.style.zIndex = '999';
    arena.appendChild(p);
    void p.offsetWidth;
    p.style.transition = `left ${90 / speed}ms linear, top ${90 / speed}ms linear`;
    p.style.left = `${(bx / ARENA_W) * 100}%`;
    p.style.top = `${((by - 12) / ARENA_H) * 100}%`;
    setTimeout(() => p.remove(), 120 / speed);
  }

  function blast(x: number, y: number, r: number): void {
    const zone = h('div', { class: 'blast', style: `${pos(x, y)};width:${((r * 2) / ARENA_W) * 100}%;animation-duration:${600 / speed}ms` });
    arena.prepend(zone);
    setTimeout(() => zone.remove(), 600 / speed);
  }

  function applyEvents(frame: Frame): void {
    let shown = 0;
    for (const ev of frame.e as BattleEvent[]) {
      if (ev.t === 'hit') {
        const target = views[ev.b];
        target.el.classList.add('hurt');
        setTimeout(() => target.el.classList.remove('hurt'), 140);
        const ax = frame.p[ev.a * 3];
        const ay = frame.p[ev.a * 3 + 1];
        const bx = frame.p[ev.b * 3];
        const by = frame.p[ev.b * 3 + 1];
        const face: 1 | -1 = bx >= ax ? 1 : -1;
        views[ev.a].facing = face;
        views[ev.a].sprite.style.transform = `scaleX(${face})`;
        if (ev.ranged && !ev.splash) projectile(ax, ay, bx, by);
        else if (!ev.ranged && !ev.splash) {
          views[ev.a].el.classList.add('lunge');
          setTimeout(() => views[ev.a].el.classList.remove('lunge'), 140);
        }
        if (shown++ < 8) {
          const ally = units[ev.b].team === 'ally';
          floater(bx, by, ev.crit ? `${ev.dmg}!` : String(ev.dmg), `${ally ? 'dmg-ally' : 'dmg-enemy'}${ev.crit ? ' crit' : ''}`);
        }
      } else if (ev.t === 'heal') {
        const bx = frame.p[ev.b * 3];
        const by = frame.p[ev.b * 3 + 1];
        if (ev.a !== ev.b) projectile(frame.p[ev.a * 3], frame.p[ev.a * 3 + 1], bx, by, 'projectile heal');
        if (shown++ < 8) floater(bx, by, `+${ev.amount}`, 'heal');
      } else if (ev.t === 'blast') {
        blast(frame.p[ev.b * 3], frame.p[ev.b * 3 + 1], ev.r);
      } else if (ev.t === 'miss') {
        floater(frame.p[ev.b * 3], frame.p[ev.b * 3 + 1], 'Raté', 'miss');
      } else if (ev.t === 'save') {
        floater(frame.p[ev.i * 3], frame.p[ev.i * 3 + 1], 'Dernier souffle !', 'save');
      }
    }
  }

  function applyFrame(frame: Frame, instant = false): void {
    let allies = 0;
    let enemies = 0;
    units.forEach((u, i) => {
      const v = views[i];
      const x = frame.p[i * 3];
      const y = frame.p[i * 3 + 1];
      const hp = frame.p[i * 3 + 2];
      const prevLeft = parseFloat(v.el.style.left || '-1');
      const newLeft = (x / ARENA_W) * 100;
      if (!instant && prevLeft >= 0 && Math.abs(newLeft - prevLeft) > 0.05) {
        const face: 1 | -1 = newLeft > prevLeft ? 1 : -1;
        if (face !== v.facing) {
          v.facing = face;
          v.sprite.style.transform = `scaleX(${face})`;
        }
      }
      v.el.setAttribute('style', `${pos(x, y)};--s:${u.scale};--tick:${instant ? 0 : 100 / speed}ms`);
      v.fill.style.width = `${Math.max(0, (hp / u.stats.maxHp) * 100)}%`;
      v.el.classList.toggle('dead', hp <= 0);
      if (hp > 0) {
        if (u.team === 'ally') allies++;
        else enemies++;
      }
    });
    hud.textContent = `Alliés : ${allies} / ${units.filter((u) => u.team === 'ally').length}   ·   Ennemis : ${enemies} / ${units.filter((u) => u.team === 'enemy').length}`;
  }

  function step(): void {
    if (idx >= frames.length) {
      finish();
      return;
    }
    const f = frames[idx++];
    applyFrame(f);
    applyEvents(f);
    timer = window.setTimeout(step, 100 / speed);
  }

  function skip(): void {
    if (finished) return;
    window.clearTimeout(timer);
    idx = frames.length;
    applyFrame(frames[frames.length - 1], true);
    finish();
  }

  const overlay = h('div', { class: 'battle-overlay' });
  const speedButtons = BATTLE_SPEEDS.map((s) =>
    h(
      'button',
      {
        class: `btn btn-small${s === speed ? ' active' : ''}`,
        onclick: (e) => {
          speed = s;
          speedButtons.forEach((b) => b.classList.remove('active'));
          (e.currentTarget as HTMLElement).classList.add('active');
        },
      },
      `x${s}`,
    ),
  );
  const skipBtn = h('button', { class: 'btn btn-small', onclick: skip, title: 'Afficher directement le résultat (Espace ou Échap)' }, 'Passer');
  const controls = h('div', { class: 'battle-controls' }, speedButtons, skipBtn);

  // Clavier : Espace/Échap passe le combat, puis Échap ferme et Entrée enchaîne (ou ferme)
  const onKey = (e: KeyboardEvent) => {
    if (!finished) {
      if (e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        skip();
      }
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (replay) replay();
      else close();
    }
  };
  document.addEventListener('keydown', onKey);

  function close(): void {
    window.clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    onClose();
  }

  const replay = onReplay && (() => { close(); onReplay.run(); });

  function finish(): void {
    if (finished) return;
    finished = true;
    controls.remove();
    const action = replay && onReplay && { label: onReplay.label, run: replay };
    const panel = report ? resultPanel(report, close, action) : simulationPanel(units, result, close, action);
    overlay.appendChild(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  overlay.append(h('div', { class: 'battle-top' }, h('h2', null, title), controls), hud, arena);
  document.body.appendChild(overlay);
  applyFrame(frames[0], true);
  idx = 1;
  timer = window.setTimeout(step, 600);
}

function simulationPanel(units: BattleUnit[], result: BattleResult, close: () => void, replay?: ReplayAction): HTMLElement {
  const duration = result.ticks * DT;
  const last = result.frames[result.frames.length - 1];
  const enemies = units.map((u, i) => ({ u, i })).filter(({ u }) => u.team === 'enemy');
  const dummies = enemies.every(({ u }) => u.dummy);
  const enemiesLeft = enemies.filter(({ i }) => last.p[i * 3 + 2] > 0).length;
  const allies = units.filter((u) => u.team === 'ally');
  const fallen = result.deadIds.length;

  const title = dummies
    ? result.winner === 'timeout' ? "L'escouade a tenu jusqu'au bout" : `Escouade tombée après ${duration.toFixed(1)} s`
    : result.winner === 'ally' ? 'Victoire simulée' : result.winner === 'timeout' ? 'Temps écoulé — défaite simulée' : 'Défaite simulée';
  const won = result.winner === 'ally' || (dummies && result.winner === 'timeout');

  const rows = allies.map((u) => {
    const t = result.totals[u.id];
    const dead = result.deadIds.includes(u.id);
    return h(
      'tr',
      { class: dead ? 'died' : '' },
      h('td', null, u.name),
      h('td', null, dead ? 'Tombé' : 'Debout'),
      h('td', null, fmt(result.kills[u.id] ?? 0)),
      h('td', null, fmt(Math.round(t.dealt))),
      h('td', null, (t.dealt / Math.max(duration, DT)).toFixed(1)),
      h('td', null, fmt(Math.round(t.taken))),
      h('td', null, fmt(Math.round(t.healed))),
    );
  });
  return h(
    'div',
    { class: `result ${won ? 'won' : 'lost'}` },
    h('h2', null, title),
    h(
      'p',
      { class: 'muted' },
      `Durée : ${duration.toFixed(1)} s · Pertes : ${fallen} / ${allies.length}`,
      !dummies && ` · Ennemis restants : ${enemiesLeft} / ${enemies.length}`,
      '. Aucune récompense, aucune perte réelle.',
    ),
    h(
      'table',
      { class: 'stats-table' },
      h('tr', null, h('th', null, 'Soldat'), h('th', null, 'État'), h('th', null, 'Élim.'), h('th', null, 'Infligés'), h('th', null, 'DPS'), h('th', null, 'Subis'), h('th', null, 'Soins')),
      rows,
    ),
    resultActions(close, replay),
  );
}

function resultActions(close: () => void, replay?: ReplayAction): HTMLElement {
  return h(
    'div',
    { class: 'row result-actions' },
    replay && h('button', { class: 'btn btn-big btn-gold', onclick: replay.run, title: 'Entrée' }, replay.label),
    h('button', { class: 'btn btn-big', onclick: close, title: 'Échap' }, 'Retour'),
  );
}

function resultPanel(report: BattleReport, close: () => void, replay?: ReplayAction): HTMLElement {
  const title = report.won ? 'Victoire !' : report.timeout ? 'Temps écoulé — défaite' : 'Défaite';
  const survivors = new Set(report.soldiers.filter((s) => !s.died).map((s) => s.id));
  const picks = getState().soldiers.filter((s) => survivors.has(s.id) && s.picksLeft > 0).length;
  const rows = report.soldiers.map((s) =>
    h(
      'li',
      { class: s.died ? 'died' : s.wounded ? 'wounded' : '' },
      h('b', null, s.name),
      s.died
        ? ' est mort au combat : il quitte l’escouade.'
        : s.wounded
          ? report.mode === 'training' ? ' a été mis K.O. : il s’en remettra (pas d’XP).' : ' est tombé mais a été rapatrié grâce à la victoire (pas d’XP).'
          : ` +${fmt(s.xpGained)} XP`,
      s.levelsGained > 0 && h('span', { class: 'levelup' }, ` Niveau ${s.newLevel} !`),
      s.kills > 0 && h('span', { class: 'muted' }, ` (${s.kills} élimination${s.kills > 1 ? 's' : ''})`),
    ),
  );
  const details = h(
    'table',
    { class: 'stats-table' },
    h('tr', null, h('th', null, 'Soldat'), h('th', null, 'Infligés'), h('th', null, 'Subis'), h('th', null, 'Soins reçus')),
    report.soldiers.map((s) => h('tr', { class: s.died ? 'died' : '' }, h('td', null, s.name), h('td', null, fmt(Math.round(s.dealt))), h('td', null, fmt(Math.round(s.taken))), h('td', null, fmt(Math.round(s.healed))))),
  );
  const detailsBox = h('div', { hidden: true }, details);
  const toggle = h(
    'button',
    {
      class: 'btn btn-small',
      onclick: () => {
        detailsBox.hidden = !detailsBox.hidden;
        toggle.textContent = detailsBox.hidden ? 'Stats avancées' : 'Masquer les stats avancées';
      },
    },
    'Stats avancées',
  );
  return h(
    'div',
    { class: `result ${report.won ? 'won' : 'lost'}` },
    h('h2', null, title),
    report.firstClear && h('p', { class: 'levelup' }, `Niveau ${report.level} de la campagne terminé !`),
    report.daily &&
      h('p', { class: report.won ? 'levelup' : 'muted' }, report.won ? `Défi « ${report.daily.modifier.name} » relevé ! Série : ${report.daily.streak} jour${report.daily.streak > 1 ? 's' : ''}.` : `Défi « ${report.daily.modifier.name} » perdu : la série repart à zéro.`),
    report.survival &&
      h(
        'p',
        { class: report.survival.ended ? 'muted' : 'levelup' },
        report.survival.ended
          ? `Expédition terminée après ${report.survival.wave} vague${report.survival.wave > 1 ? 's' : ''} : la moitié du pot est versée.`
          : `Vague ${report.survival.wave} remportée ! Pot : ${fmt(report.survival.pot)} or. Continuez, ou encaissez depuis l'onglet Combat.`,
      ),
    h('ul', { class: 'result-list' }, rows),
    toggle,
    detailsBox,
    h(
      'div',
      { class: 'result-rewards' },
      report.trainingFee && h('span', { class: 'reward cost', title: 'Entraînements payants, réglés au lancement' }, `−${fmt(report.trainingFee)} or d'entraînement`),
      report.gold > 0 && h('span', { class: 'reward' }, `+${fmt(report.gold)} or`),
      report.weapon && h('span', { class: 'reward', style: `color:${RARITIES[report.weapon.rarity].color}` }, weaponIcon(report.weapon), ` ${report.weapon.name} obtenu !`),
      report.freePulls > 0 && h('span', { class: 'reward' }, `+${report.freePulls} tirage${report.freePulls > 1 ? 's' : ''} gratuit${report.freePulls > 1 ? 's' : ''}`),
    ),
    report.unlocked.length > 0 &&
      h(
        'div',
        { class: 'unlock-box' },
        h('b', null, report.unlocked.length > 1 ? 'Nouveautés débloquées !' : 'Nouveauté débloquée !'),
        h('ul', null, report.unlocked.map((u) => h('li', null, h('b', null, u.label), ` : ${u.desc}`))),
      ),
    picks > 0 && h('p', { class: 'pill pill-pick result-hint' }, `${picks} soldat${picks > 1 ? 's ont' : ' a'} de nouvelles améliorations à choisir (onglet Escouade).`),
    resultActions(close, replay),
  );
}
