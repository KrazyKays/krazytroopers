import { ARENA_H, ARENA_W, DT, type BattleEvent, type BattleResult, type BattleUnit, type Frame } from '../game/battle';
import { LOOT_METER_MAX, RARITIES, UPGRADE_KINDS, UPGRADES_BY_ID } from '../game/data';
import { biomeFor } from '../game/biomes';
import { chooseLoss, type BattleReport } from '../game/combat';
import { getState, mutate } from '../game/state';
import { BOONS_BY_ID, pickBoon } from '../game/survival';
import { ENEMY_LINES, TRAITS_BY_ID } from '../game/traits';
import { pickUpgrade, recommendedUpgrade, SOLDIER_ROLES, soldierRole } from '../game/upgrades';
import { BATTLE_SPEEDS, type BattleSpeed } from '../game/types';
import { h, html } from './dom';
import { spriteSvg } from './avatar';
import { fmt, fold, stars, toast, weaponIcon } from './components';

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

  const arena = h('div', { class: `arena biome-${biomeFor(report?.level ?? 1).id}` });
  const hud = h('div', { class: 'battle-hud' });
  const views: UnitView[] = units.map((u) => {
    const facing: 1 | -1 = u.team === 'ally' ? 1 : -1;
    const fill = h('div', { class: 'hp-fill' });
    const sprite = html(spriteSvg(u.look, 'sprite'));
    const spriteWrap = h('div', { class: 'unit-sprite', style: `transform:scaleX(${facing})` }, sprite);
    const cls = [`unit team-${u.team}`, u.elite && 'elite', u.flying && 'flying', u.stealth && 'stealthed', u.banner && 'banner', u.boss && 'boss'].filter(Boolean).join(' ');
    const el = h(
      'div',
      { class: cls, style: `--s:${u.scale}` },
      h('div', { class: 'hpbar' }, fill),
      spriteWrap,
      u.elite ? h('div', { class: 'unit-name' }, `★ ${u.elite}`) : u.scale > 1 && h('div', { class: 'unit-name' }, u.name),
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

  // ---------- Répliques ----------
  // Une bulle par soldat toutes les 2,5 s de combat au plus, et une à la fois toutes les 0,8 s : du sel, pas du bruit
  const lastSaid = new Array<number>(units.length).fill(-Infinity);
  let lastAny = -Infinity;
  const pickLine = (lines: readonly string[]) => lines[Math.floor(Math.random() * lines.length)];
  function say(i: number, line: string | undefined, force = false): void {
    if (!line || finished) return;
    const now = idx * DT;
    if (!force && (now - lastSaid[i] < 2.5 || now - lastAny < 0.8)) return;
    if (views[i].el.classList.contains('dead')) return;
    lastSaid[i] = now;
    lastAny = now;
    const bubble = h('div', { class: `bubble bubble-${units[i].team}` }, line);
    views[i].el.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1700);
  }
  const traitLine = (i: number, kind: 'start' | 'kill' | 'hurt' | 'ally'): string | undefined => {
    const t = units[i].trait ? TRAITS_BY_ID[units[i].trait!] : undefined;
    return t && pickLine(t.lines[kind]);
  };
  function openingLines(): void {
    const allies = units.map((u, i) => ({ u, i })).filter(({ u }) => u.team === 'ally' && u.trait);
    const speaker = allies[Math.floor(Math.random() * allies.length)];
    if (speaker) say(speaker.i, traitLine(speaker.i, 'start'), true);
    const boss = units.findIndex((u) => u.team === 'enemy' && u.boss && !u.dummy);
    if (boss >= 0) setTimeout(() => say(boss, pickLine(ENEMY_LINES.boss), true), 900);
  }

  // Lignes de rayon (rebonds, tirs perforants) et mines posées au sol
  function zap(ax: number, ay: number, bx: number, by: number): void {
    const len = Math.hypot(bx - ax, by - ay);
    const angle = Math.atan2(((by - ay) / ARENA_H) * arena.clientHeight, ((bx - ax) / ARENA_W) * arena.clientWidth);
    const line = h('div', { class: 'zap', style: `${pos(ax, ay - 12)};width:${(len / ARENA_W) * 100}%;transform:rotate(${angle}rad)` });
    line.style.zIndex = '998';
    arena.appendChild(line);
    setTimeout(() => line.remove(), 220 / speed);
  }
  const mineEls: { x: number; y: number; el: HTMLElement }[] = [];

  function applyEvents(frame: Frame): void {
    let shown = 0;
    const killers = new Map<number, number>();
    for (const ev of frame.e as BattleEvent[]) if (ev.t === 'hit') killers.set(ev.b, ev.a);
    for (const ev of frame.e as BattleEvent[]) {
      if (ev.t === 'reveal') {
        views[ev.i].el.classList.remove('stealthed');
        floater(frame.p[ev.i * 3], frame.p[ev.i * 3 + 1], 'Repéré !', 'miss');
        continue;
      }
      if (ev.t === 'zap') {
        zap(frame.p[ev.a * 3], frame.p[ev.a * 3 + 1], frame.p[ev.b * 3], frame.p[ev.b * 3 + 1]);
        continue;
      }
      if (ev.t === 'mine') {
        const el = h('div', { class: 'mine', style: pos(ev.x, ev.y) });
        arena.prepend(el);
        mineEls.push({ x: ev.x, y: ev.y, el });
        continue;
      }
      if (ev.t === 'boom') {
        const k = mineEls.findIndex((m) => Math.abs(m.x - ev.x) < 1 && Math.abs(m.y - ev.y) < 1);
        if (k >= 0) mineEls.splice(k, 1)[0].el.remove();
        blast(ev.x, ev.y, ev.r);
        continue;
      }
      if (ev.t === 'execute') {
        floater(frame.p[ev.i * 3], frame.p[ev.i * 3 + 1], 'Exécuté !', 'crit dmg-enemy');
        continue;
      }
      if (ev.t === 'die') {
        if (units[ev.i].team === 'enemy') {
          const killer = killers.get(ev.i);
          if (killer !== undefined && units[killer].team === 'ally' && Math.random() < 0.35) say(killer, traitLine(killer, 'kill'));
        } else {
          const killer = killers.get(ev.i);
          if (killer !== undefined && units[killer].boss && Math.random() < 0.5) say(killer, pickLine(ENEMY_LINES.kill));
          const friends = units.map((_, i) => i).filter((i) => i !== ev.i && units[i].team === 'ally' && units[i].trait && frame.p[i * 3 + 2] > 0);
          const friend = friends[Math.floor(Math.random() * friends.length)];
          if (friend !== undefined && Math.random() < 0.6) say(friend, traitLine(friend, 'ally'));
        }
        continue;
      }
      if (ev.t === 'hit' && ev.crit && units[ev.b].team === 'ally' && Math.random() < 0.3) say(ev.b, traitLine(ev.b, 'hurt'));
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
        if (units[ev.i].team === 'ally') setTimeout(() => say(ev.i, traitLine(ev.i, 'hurt'), true), 300);
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
    const totalAllies = units.filter((u) => u.team === 'ally').length;
    const totalEnemies = units.length - totalAllies;
    hud.replaceChildren(
      h('span', { class: 'hud-side hud-ally' }, `🪖 ${allies} / ${totalAllies}`),
      h('span', { class: 'hud-time' }, `${((Math.max(0, idx - 1)) * DT).toFixed(1)} s`),
      h('span', { class: 'hud-side hud-enemy' }, `${enemies} / ${totalEnemies} 💀`),
    );
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
    } else if (getState().pendingLoss) {
      // Le choix du soldat perdu ne se contourne pas au clavier : seul le panneau de résultat permet de le faire
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
    for (const v of views) v.el.classList.remove('stealthed');
    for (const b of arena.querySelectorAll('.bubble')) b.remove();
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
  setTimeout(openingLines, 350);
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
      h('td', null, fmt(Math.round(t.healGiven))),
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
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'stats-table' },
        h('tr', null, h('th', null, 'Soldat'), h('th', null, 'État'), h('th', null, 'Élim.'), h('th', null, 'Infligés'), h('th', null, 'DPS'), h('th', null, 'Subis'), h('th', null, 'Soins reçus'), h('th', null, 'Soins donnés')),
        rows,
      ),
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

/** Améliorations gagnées pendant le combat, à choisir sans quitter l'écran de résultat. */
function pendingPicks(ids: ReadonlySet<string>): HTMLElement | false {
  const pending = () => getState().soldiers.filter((s) => ids.has(s.id) && s.picksLeft > 0 && s.upgradeChoices?.length);
  if (pending().length === 0) return false;
  const box = h('div', { class: 'result-picks' });
  const draw = (): void => {
    const st = getState();
    const list = pending();
    if (list.length === 0) {
      box.replaceChildren(h('p', { class: 'note note-good small' }, '✓ Toutes les nouvelles améliorations sont choisies.'));
      return;
    }
    box.replaceChildren(
      h('h3', null, '⬆ Nouvelles améliorations'),
      ...list.slice(0, 3).map((s) => {
        const best = recommendedUpgrade(st, s);
        return h(
          'div',
          { class: 'pick-row' },
          h('b', { class: 'pick-name' }, `${s.name} · niv. ${s.level}`, s.picksLeft > 1 && h('small', { class: 'muted' }, ` (${s.picksLeft} à choisir)`)),
          h(
            'div',
            { class: 'pick-choices' },
            s.upgradeChoices!.map((uid) => {
              const u = UPGRADES_BY_ID[uid];
              return h(
                'button',
                { class: `pick-choice kind-${u.kind}${uid === best ? ' best' : ''}`, title: uid === best ? `Conseillé pour son orientation : ${SOLDIER_ROLES[soldierRole(st, s)].label}` : u.desc, onclick: () => { mutate((state) => pickUpgrade(state, s.id, uid)); draw(); } },
                h('b', null, `${UPGRADE_KINDS[u.kind].icon} ${u.name}`, uid === best && h('span', { class: 'tag tag-accent' }, 'Conseillé')),
                h('small', null, u.desc),
              );
            }),
          ),
        );
      }),
      ...(list.length > 3 ? [h('p', { class: 'muted small' }, `Et ${list.length - 3} autre${list.length - 3 > 1 ? 's' : ''} soldat${list.length - 3 > 1 ? 's' : ''} : voir l'onglet Soldats.`)] : []),
    );
  };
  draw();
  return box;
}

/** Bonus d'expédition à choisir avant la vague suivante. */
export function boonPicker(onPick?: () => void): HTMLElement | false {
  const run = getState().survival;
  if (!run?.choices) return false;
  const box = h('div', { class: 'boon-picker' });
  const draw = (): void => {
    const cur = getState().survival;
    if (!cur?.choices) {
      const last = cur?.boons.at(-1);
      box.replaceChildren(h('p', { class: 'note note-good small' }, '✓ Bonus choisi', last ? ` : ${BOONS_BY_ID[last].icon} ${BOONS_BY_ID[last].name}` : '', '. En route pour la vague suivante !'));
      return;
    }
    box.replaceChildren(
      h('h3', null, '🎁 Choisissez un bonus pour la suite de l’expédition'),
      h(
        'div',
        { class: 'boon-choices' },
        cur.choices.map((id) => {
          const b = BOONS_BY_ID[id];
          return h(
            'button',
            {
              class: 'boon',
              onclick: () => {
                const r = mutate((st) => pickBoon(st, id));
                if (r.ok && r.merc) toast(`${r.merc.name} rejoint l'expédition !`, 'good');
                draw();
                onPick?.();
              },
            },
            h('span', { class: 'boon-icon' }, b.icon),
            h('b', null, b.name),
            h('small', null, b.desc),
          );
        }),
      ),
    );
  };
  draw();
  return box;
}

/**
 * Choix du soldat tombé qui ne reviendra pas. Rien n'est définitif avant la confirmation : la perte est irréversible,
 * et un simple clic ne doit pas la décider. `report` met à jour le bilan du combat en cours, s'il est encore affiché.
 */
export function lossPicker(onChosen: () => void, report?: BattleReport): HTMLElement | false {
  const pending = getState().pendingLoss;
  if (!pending) return false;
  const box = h('div', { class: 'loss-picker' });
  const draw = (picked: string | null): void => {
    const fallen = getState().soldiers.filter((s) => pending.includes(s.id));
    const chosen = fallen.find((s) => s.id === picked);
    box.replaceChildren(
      h('h3', null, '☠️ Vous ne pouvez pas tous les ramener'),
      h('p', { class: 'small' }, 'Choisissez le soldat qui ne reviendra pas. Il sera perdu définitivement ; son arme reste dans votre arsenal et les autres sont rapatriés, sans XP.'),
      h(
        'div',
        { class: 'boon-choices' },
        fallen.map((s) =>
          h(
            'button',
            { class: `boon loss-choice${s.id === picked ? ' picked' : ''}`, onclick: () => draw(s.id) },
            h('b', null, s.favorite ? `⭐ ${s.name}` : s.name),
            h('small', null, `${RARITIES[s.rarity].label} · niv. ${s.level} · ${s.upgrades.length} amélioration${s.upgrades.length > 1 ? 's' : ''} · ${fmt(s.kills)} élim.`),
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'btn btn-danger',
          disabled: !chosen,
          onclick: () => {
            if (!chosen) return;
            mutate((st) => chooseLoss(st, chosen.id, report));
            onChosen();
          },
        },
        chosen ? `Laisser ${chosen.name} derrière` : 'Sélectionnez un soldat',
      ),
    );
  };
  draw(null);
  return box;
}

function resultPanel(report: BattleReport, close: () => void, replay?: ReplayAction): HTMLElement {
  const choosing = !!report.lossChoice;
  const title = report.colossus ? (report.colossus.killed ? 'Colosse abattu !' : 'Sacrifice accompli') : report.won ? 'Victoire !' : report.timeout ? 'Temps écoulé — défaite' : 'Défaite';
  const survivors = new Set(report.soldiers.filter((s) => !s.died).map((s) => s.id));
  const picks = getState().soldiers.filter((s) => survivors.has(s.id) && s.picksLeft > 0).length;
  const totalTaken = report.soldiers.reduce((sum, s) => sum + s.taken, 0);
  const row = (s: BattleReport['soldiers'][number]) =>
    h(
      'li',
      { class: s.died ? 'died' : s.wounded ? 'wounded' : '' },
      h('b', null, s.name),
      s.died
        ? report.colossus ? ' a été sacrifié : il quitte l’escouade.' : ' est mort au combat : il quitte l’escouade.'
        : s.wounded
          ? report.won
            ? `${report.mode === 'training' ? ' a été mis K.O.' : ' est tombé pour l’escouade'} après avoir encaissé ${Math.round((s.taken / Math.max(1, totalTaken)) * 100)} % des dégâts : +${fmt(s.xpGained)} XP`
            : report.mode === 'training' ? ' a été mis K.O. : il s’en remettra (pas d’XP).' : ' est tombé mais a été rapatrié (pas d’XP).'
          : ` +${fmt(s.xpGained)} XP`,
      s.levelsGained > 0 && h('span', { class: 'levelup' }, ` Niveau ${s.newLevel} !`),
      s.kills > 0 && h('span', { class: 'muted' }, ` (${s.kills} élimination${s.kills > 1 ? 's' : ''})`),
    );
  // Une mort, un nouveau niveau ou un soldat tombé pour une victoire se voient tout de suite ; le détail de chaque soldat reste à la demande
  const dead = report.soldiers.filter((s) => s.died).length;
  const brought = report.soldiers.filter((s) => s.wounded).length;
  const lossNote =
    !choosing &&
    !report.won &&
    !report.colossus &&
    dead + brought > 0 &&
    h(
      'p',
      { class: `note ${dead > 0 ? 'note-bad' : 'note-good'}` },
      dead > 0
        ? `☠️ ${dead} soldat${dead > 1 ? 's' : ''} mort${dead > 1 ? 's' : ''} définitivement${brought > 0 ? `, ${brought} rapatrié${brought > 1 ? 's' : ''} sans XP` : ''}.`
        : `Personne n'est mort : ${brought > 1 ? `les ${brought} soldats tombés sont rapatriés` : 'le soldat tombé est rapatrié'}, sans XP.`,
    );
  const notable = report.soldiers.filter((s) => s.died || s.levelsGained > 0 || (report.won && s.wounded));
  const details = h(
    'table',
    { class: 'stats-table' },
    h('tr', null, h('th', null, 'Soldat'), h('th', null, 'Infligés'), h('th', null, 'Subis'), h('th', null, 'Soins reçus'), h('th', null, 'Soins donnés')),
    report.soldiers.map((s) => h('tr', { class: s.died ? 'died' : '' }, h('td', null, s.name), h('td', null, fmt(Math.round(s.dealt))), h('td', null, fmt(Math.round(s.taken))), h('td', null, fmt(Math.round(s.healed))), h('td', null, fmt(Math.round(s.healGiven))))),
  );
  const panel = h(
    'div',
    { class: `result ${report.won || report.colossus ? 'won' : 'lost'}` },
    h('h2', null, title),
    lossNote,
    // Le panneau se redessine une fois le choix fait : le bilan et les boutons n'ont de sens qu'à ce moment-là
    choosing && lossPicker(() => panel.replaceWith(resultPanel(report, close, replay)), report),
    report.colossus && h('p', { class: report.colossus.killed ? 'levelup' : 'muted' }, `${fmt(report.colossus.dealt)} dégâts infligés. ${report.colossus.killed ? 'Un Colosse plus résistant prend sa place.' : `Il lui reste ${fmt(report.colossus.left)} / ${fmt(report.colossus.maxHp)} PV.`}`),
    report.stars && h('div', { class: 'result-stars' }, stars(report.stars.got, 3, 'stars-huge'), report.stars.gained > 0 ? h('small', null, `+${report.stars.gained} nouvelle${report.stars.gained > 1 ? 's' : ''} étoile${report.stars.gained > 1 ? 's' : ''}`) : report.stars.best > report.stars.got && h('small', { class: 'muted' }, `Record : ${report.stars.best} ★`)),
    report.firstClear && h('p', { class: 'levelup' }, `Niveau ${report.level} de la campagne terminé !`),
    report.daily &&
      h('p', { class: report.won ? 'levelup' : 'muted' }, report.won ? `Défi « ${report.daily.modifier.name} » relevé ! Série : ${report.daily.streak} jour${report.daily.streak > 1 ? 's' : ''}.` : `Défi « ${report.daily.modifier.name} » perdu : la série repart à zéro.`),
    report.survival &&
      h(
        'p',
        { class: report.survival.ended ? 'muted' : 'levelup' },
        report.survival.ended
          ? report.survival.halved
            ? `Expédition terminée après ${report.survival.wave} vague${report.survival.wave > 1 ? 's' : ''} : la moitié du pot est versée.`
            : `Vague ${report.survival.wave} remportée, mais plus aucun soldat debout : les mercenaires rapportent tout le pot.`
          : `Vague ${report.survival.wave} remportée ! Pot : ${fmt(report.survival.pot)} or. Continuez, ou encaissez depuis l'onglet Combat.`,
      ),
    report.survival && !report.survival.ended && boonPicker(),
    report.tower &&
      h('p', { class: report.won ? 'levelup' : 'muted' }, report.won ? `Étage ${report.tower.floor} de la Tour franchi ! Record : étage ${report.tower.best}.` : `L'étage ${report.tower.floor} résiste : aucun soldat n'est perdu dans la Tour, retentez votre chance.`),
    h(
      'div',
      { class: 'result-rewards' },
      report.trainingFee && h('span', { class: 'reward cost', title: 'Entraînements payants, réglés au lancement' }, `−${fmt(report.trainingFee)} or d'entraînement`),
      report.colossus && report.colossus.pity > 0 && h('span', { class: 'reward' }, `🎯 Garantie de recrutement +${report.colossus.pity}`),
      report.colossus && report.colossus.weaponsLost > 0 && h('span', { class: 'reward cost' }, `−${report.colossus.weaponsLost} arme${report.colossus.weaponsLost > 1 ? 's' : ''}`),
      report.gold > 0 && h('span', { class: 'reward' }, `🪙 +${fmt(report.gold)} or`, report.stars && report.stars.gold > 0 ? h('small', null, ` (dont ${fmt(report.stars.gold)} d'étoiles)`) : null),
      report.weapon && h('span', { class: 'reward', style: `color:${RARITIES[report.weapon.rarity].color}` }, weaponIcon(report.weapon), ` ${report.weapon.name} obtenu !`),
      report.freePulls > 0 && h('span', { class: 'reward' }, `🎟️ +${report.freePulls} tirage${report.freePulls > 1 ? 's' : ''} gratuit${report.freePulls > 1 ? 's' : ''}`),
      report.stars && report.stars.chests > 0 && h('span', { class: 'reward reward-chest' }, `🎁 Coffre d'étoiles ouvert !`),
      report.loot && !report.weapon && h('span', { class: 'reward' }, `🔫 Butin ${report.loot.meter} / ${LOOT_METER_MAX}`),
    ),
    report.unlocked.length > 0 &&
      h(
        'div',
        { class: 'unlock-box' },
        h('b', null, report.unlocked.length > 1 ? 'Nouveautés débloquées !' : 'Nouveauté débloquée !'),
        h('ul', null, report.unlocked.map((u) => h('li', null, h('b', null, u.label), ` : ${u.desc}`))),
      ),
    notable.length > 0 && h('ul', { class: 'result-list' }, notable.map(row)),
    !choosing && picks > 0 && pendingPicks(survivors),
    !choosing && resultActions(close, replay),
    fold('result-details', 'Détail du combat', [h('ul', { class: 'result-list' }, report.soldiers.map(row)), h('div', { class: 'table-scroll' }, details)]),
  );
  return panel;
}
