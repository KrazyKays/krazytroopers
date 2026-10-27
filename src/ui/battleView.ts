import { ARENA_H, ARENA_W, type BattleEvent, type BattleResult, type BattleUnit, type Frame } from '../game/battle';
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

export function openBattle(title: string, units: BattleUnit[], result: BattleResult, report: BattleReport, onClose: () => void): void {
  const frames = result.frames;
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

  function projectile(ax: number, ay: number, bx: number, by: number): void {
    const p = h('div', { class: 'projectile', style: `${pos(ax, ay - 12)};transition:none` });
    p.style.zIndex = '999';
    arena.appendChild(p);
    void p.offsetWidth;
    p.style.transition = `left ${90 / speed}ms linear, top ${90 / speed}ms linear`;
    p.style.left = `${(bx / ARENA_W) * 100}%`;
    p.style.top = `${((by - 12) / ARENA_H) * 100}%`;
    setTimeout(() => p.remove(), 120 / speed);
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
  const skipBtn = h('button', { class: 'btn btn-small', onclick: skip }, 'Passer');
  const controls = h('div', { class: 'battle-controls' }, speedButtons, skipBtn);

  function close(): void {
    window.clearTimeout(timer);
    overlay.remove();
    onClose();
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    controls.remove();
    overlay.appendChild(resultPanel(report, close));
  }

  overlay.append(h('div', { class: 'battle-top' }, h('h2', null, title), controls), hud, arena);
  document.body.appendChild(overlay);
  applyFrame(frames[0], true);
  idx = 1;
  timer = window.setTimeout(step, 600);
}

function resultPanel(report: BattleReport, close: () => void): HTMLElement {
  const title = report.won ? 'Victoire !' : report.timeout ? 'Temps écoulé — défaite' : 'Défaite';
  const rows = report.soldiers.map((s) =>
    h(
      'li',
      { class: s.died ? 'died' : '' },
      h('b', null, s.name),
      s.died ? ' est tombé au combat : indisponible jusqu’à demain.' : ` +${fmt(s.xpGained)} XP`,
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
    h('ul', { class: 'result-list' }, rows),
    toggle,
    detailsBox,
    h(
      'div',
      { class: 'result-rewards' },
      report.gold > 0 && h('span', { class: 'reward' }, `+${fmt(report.gold)} or`),
      report.weapon && h('span', { class: 'reward', style: `color:${RARITIES[report.weapon.rarity].color}` }, weaponIcon(report.weapon), ` ${report.weapon.name} obtenu !`),
    ),
    h('button', { class: 'btn btn-big', onclick: close }, 'Retour'),
  );
}
