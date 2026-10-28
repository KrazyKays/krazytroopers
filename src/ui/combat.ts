import { SQUAD_MAX, TRAINING_PER_SOLDIER } from '../game/data';
import { campaignGold, campaignXp, DEFAULT_SIMULATION, estimateBattle, estimateSimulation, ESTIMATE_RUNS, launchBattle, launchSimulation, trainingXp, TRAINING_GOLD, type BattleRequest, type SimulationEstimate } from '../game/combat';
import { isBossLevel, previewCampaign, SIM_ENEMY_TYPES, SIM_MAX_ENEMIES, simulationPool, type SimulationConfig } from '../game/enemies';
import { sortSquad } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import type { GameState, Soldier } from '../game/types';
import { h } from './dom';
import { openBattle } from './battleView';
import { fmt, getSquadSort, squadToolbar, squadView, toast } from './components';
import { goTo } from './nav';
import { openSoldier } from './roster';

type Mode = 'training' | 'campaign' | 'simulation';

let mode: Mode = 'training';

/** Ouvre l'onglet Combat sur un mode donné (utilisé par le guide). */
export function openCombat(m: Mode): void {
  mode = m;
  if (m === 'campaign') campaignPick = null;
  goTo('combat');
}

// Estimation d'un vrai combat : recalculée seulement si l'escouade, ses stats ou l'adversaire changent
let battleEstimate: { key: string; value: SimulationEstimate } | null = null;

function battleRequest(level: number): BattleRequest {
  const squad = [...selected];
  return mode === 'training' ? { mode: 'training', squad } : { mode: 'campaign', squad, level };
}

function currentBattleEstimate(st: GameState, req: BattleRequest): SimulationEstimate | null {
  const soldiers = req.squad.map((id) => st.soldiers.find((s) => s.id === id)!);
  const key = JSON.stringify([req, soldiers.map((s) => [s.level, s.upgrades, st.weapons.find((w) => w.uid === s.weaponUid)?.defId ?? null])]);
  if (battleEstimate?.key !== key) {
    const res = estimateBattle(st, req);
    if (!res.ok) return null;
    battleEstimate = { key, value: res };
  }
  return battleEstimate.value;
}

function estimateLine(est: SimulationEstimate): HTMLElement {
  const rate = est.wins / est.runs;
  const tone = rate >= 0.8 ? 'good' : rate >= 0.5 ? 'warn' : 'bad';
  const verdict = rate >= 0.8 ? 'Combat sûr' : rate >= 0.5 ? 'Combat risqué' : 'Combat très dangereux';
  const deaths = est.avgDeaths;
  return h(
    'div',
    { class: `odds odds-${tone}`, title: `Estimation sur ${est.runs} combats simulés avec cette escouade` },
    h('b', null, `${verdict} : ~${Math.round(rate * 100)} % de victoire`),
    h('span', null, deaths < 0.05 ? ' · aucune perte attendue' : ` · ~${fmt(deaths, 1)} soldat${deaths >= 1.5 ? 's' : ''} perdu${deaths >= 1.5 ? 's' : ''} en moyenne (mort définitive)`),
  );
}

// Frise de progression : niveaux terminés, niveau à conquérir, boss, et quelques niveaux verrouillés
function campaignTrack(st: GameState, level: number): HTMLElement {
  const next = st.campaignLevel + 1;
  const start = Math.max(1, Math.min(level - 5, next - 8));
  const nodes = Array.from({ length: 12 }, (_, i) => start + i).map((n) => {
    const state = n <= st.campaignLevel ? 'cleared' : n === next ? 'next' : 'locked';
    const boss = isBossLevel(n);
    const label = state === 'cleared' ? `Niveau ${n} terminé` : state === 'next' ? `Niveau ${n} : à conquérir` : `Niveau ${n} verrouillé`;
    return h(
      'button',
      {
        class: `track-node track-${state}${boss ? ' track-boss' : ''}${n === level ? ' current' : ''}`,
        disabled: state === 'locked',
        title: boss ? `${label} (boss)` : label,
        onclick: () => { campaignPick = n >= next ? null : n; refresh(); },
      },
      h('span', { class: 'track-num' }, String(n)),
      h('span', { class: 'track-mark' }, boss ? '☠' : state === 'cleared' ? '✓' : state === 'next' ? '►' : '·'),
    );
  });
  return h(
    'div',
    { class: 'campaign-track' },
    h('button', { class: 'btn btn-small', disabled: level <= 1, title: 'Niveau précédent', onclick: () => { campaignPick = level - 1; refresh(); } }, '◀'),
    h('div', { class: 'track-nodes' }, nodes),
    h('button', { class: 'btn btn-small', disabled: level >= next, title: 'Niveau suivant', onclick: () => { campaignPick = level + 1 >= next ? null : level + 1; refresh(); } }, '▶'),
  );
}
const selected = new Set<string>();
let campaignPick: number | null = null;
const sim: SimulationConfig = { ...DEFAULT_SIMULATION };
/** Dernière estimation, valable tant que l'escouade et la configuration n'ont pas changé. */
let estimate: { key: string; value: SimulationEstimate } | null = null;

const simKey = (): string => JSON.stringify([sim, [...selected].sort()]);
const simMaxLevel = (st: GameState): number => Math.max(10, st.campaignLevel + 10);

function eligible(s: Soldier): boolean {
  return mode !== 'training' || s.trainingsLeft > 0;
}

// Retire les soldats morts ou devenus inéligibles : la sélection survit ainsi d'un combat à l'autre
function pruneSelection(st: GameState): void {
  for (const id of [...selected]) {
    const s = st.soldiers.find((x) => x.id === id);
    if (!s || !eligible(s)) selected.delete(id);
  }
}

function autoSelect(st: GameState): void {
  selected.clear();
  const ready = st.soldiers.filter(eligible);
  for (const s of sortSquad(st, getSquadSort(), ready).slice(0, SQUAD_MAX)) selected.add(s.id);
}

function launch(): void {
  const st = getState();
  pruneSelection(st);
  if (selected.size === 0) {
    toast('Aucun soldat disponible dans la sélection.', 'bad');
    refresh();
    return;
  }
  const squad = [...selected];
  if (mode === 'simulation') {
    // aucune conséquence : la sélection reste en place pour relancer tout de suite
    const run = launchSimulation(st, squad, sim);
    if (!run.ok) {
      toast(run.error, 'bad');
      return;
    }
    const title =
      sim.opponent === 'scarecrow'
        ? `Simulation — ${sim.count} épouvantail${sim.count > 1 ? 's' : ''}`
        : `Simulation — ${sim.count} ennemi${sim.count > 1 ? 's' : ''}, niveau ${sim.level}`;
    openBattle(title, run.units, run.result, null, () => refresh(), { label: 'Relancer', run: launch });
    return;
  }
  const level = Math.min(campaignPick ?? st.campaignLevel + 1, st.campaignLevel + 1);
  const res = mutate((state) => launchBattle(state, mode === 'training' ? { mode: 'training', squad } : { mode: 'campaign', squad, level }));
  if (!res.ok) {
    toast(res.error, 'bad');
    return;
  }
  const title = mode === 'training' ? 'Entraînement' : `Campagne — niveau ${level}`;
  // Les survivants restent sélectionnés : on peut enchaîner le combat suivant directement depuis l'écran de résultat
  const after = getState();
  pruneSelection(after);
  const nextLevel = Math.min(campaignPick ?? after.campaignLevel + 1, after.campaignLevel + 1);
  const replayLabel = mode === 'training' ? 'Nouvel entraînement' : nextLevel > level ? `Niveau suivant (${nextLevel})` : `Rejouer le niveau ${level}`;
  openBattle(
    title,
    res.units,
    res.result,
    res.report,
    // l'état est déjà enregistré : on rafraîchit simplement l'écran
    () => refresh(),
    selected.size > 0 ? { label: `${replayLabel} — ${selected.size} soldat${selected.size > 1 ? 's' : ''}`, run: launch } : undefined,
  );
}

function runEstimate(): void {
  const res = estimateSimulation(getState(), [...selected], sim);
  if (!res.ok) {
    toast(res.error, 'bad');
    return;
  }
  estimate = { key: simKey(), value: res };
  refresh();
}

function stepper(label: string, value: number, min: number, max: number, set: (v: number) => void, big = 0): HTMLElement {
  const btn = (text: string, delta: number) =>
    h('button', { class: 'btn btn-small', disabled: delta < 0 ? value <= min : value >= max, onclick: () => { set(Math.min(max, Math.max(min, value + delta))); refresh(); } }, text);
  return h(
    'div',
    { class: 'sim-field' },
    h('span', { class: 'muted small' }, label),
    h('div', { class: 'stepper' }, big > 0 && btn('«', -big), btn('−', -1), h('b', null, String(value)), btn('+', 1), big > 0 && btn('»', big)),
  );
}

function simulationInfo(st: GameState): HTMLElement {
  sim.level = Math.min(Math.max(1, sim.level), simMaxLevel(st));
  const dummy = sim.opponent === 'scarecrow';
  const opponent = h(
    'select',
    { onchange: (e) => { sim.opponent = (e.target as HTMLSelectElement).value; if (sim.opponent === 'scarecrow') sim.boss = false; refresh(); } },
    h('option', { value: 'scarecrow' }, 'Épouvantail (cible invincible)'),
    h('option', { value: 'mixed' }, 'Troupes mixtes (selon le niveau)'),
    SIM_ENEMY_TYPES.map((t) => h('option', { value: t.id }, `Uniquement : ${t.name}`)),
  );
  opponent.value = sim.opponent;

  const count = `${sim.count} ${dummy ? `épouvantail${sim.count > 1 ? 's' : ''}` : `ennemi${sim.count > 1 ? 's' : ''}`}`;
  const desc = dummy
    ? `${count} invincible${sim.count > 1 ? 's' : ''} : chacun frappe le soldat le plus proche, à 0 de dégâts au début, puis ses coups gagnent en puissance avec le temps. Idéal pour mesurer les dégâts et l'endurance de l'escouade.`
    : `${count} à la puissance du niveau ${sim.level} de la campagne${sim.boss ? ', dont un boss' : ''} : ${simulationPool(sim).join(', ')}.`;

  const est = estimate && estimate.key === simKey() ? estimate.value : null;
  const pct = (n: number) => `${Math.round((n / (est?.runs ?? 1)) * 100)} %`;

  return h(
    'div',
    { class: 'panel' },
    h('h3', null, 'Simulation de combat'),
    h(
      'div',
      { class: 'sim-config' },
      h('label', { class: 'sim-field' }, h('span', { class: 'muted small' }, 'Adversaire'), opponent),
      stepper('Nombre d’ennemis', sim.count, 1, SIM_MAX_ENEMIES, (v) => { sim.count = v; }),
      !dummy && stepper('Puissance (niveau)', sim.level, 1, simMaxLevel(st), (v) => { sim.level = v; }, 5),
      !dummy &&
        h(
          'label',
          { class: 'sim-field sim-check' },
          h('input', { type: 'checkbox', checked: sim.boss, onchange: (e) => { sim.boss = (e.target as HTMLInputElement).checked; refresh(); } }),
          ' Inclure un boss',
        ),
    ),
    h(
      'div',
      { class: 'row sim-presets' },
      h('span', { class: 'muted small' }, 'Effectif :'),
      h('button', { class: 'btn btn-small', disabled: selected.size === 0, onclick: () => { sim.count = selected.size; refresh(); } }, 'À égalité'),
      h('button', { class: 'btn btn-small', disabled: selected.size === 0, onclick: () => { sim.count = Math.min(SIM_MAX_ENEMIES, selected.size * 2); refresh(); } }, 'Deux contre un'),
      !dummy && h('button', { class: 'btn btn-small', onclick: () => { sim.level = Math.min(st.campaignLevel + 1, simMaxLevel(st)); refresh(); } }, `Niveau de campagne (${st.campaignLevel + 1})`),
    ),
    h('p', null, desc),
    h(
      'div',
      { class: 'row sim-estimate' },
      h('button', { class: 'btn btn-small', disabled: selected.size === 0, onclick: runEstimate }, `Estimer sur ${ESTIMATE_RUNS} combats`),
      est &&
        (dummy
          ? h('span', null, `Survie moyenne : ${est.avgDuration.toFixed(1)} s · ${pct(est.timeouts)} des combats tenus jusqu'au bout`)
          : h(
              'span',
              null,
              h('b', { class: est.wins >= est.runs / 2 ? 'good' : 'bad' }, `${pct(est.wins)} de victoires`),
              ` · ${pct(est.losses)} de défaites`,
              est.timeouts > 0 && ` · ${pct(est.timeouts)} hors temps`,
              ` · durée moyenne ${est.avgDuration.toFixed(1)} s · ${est.avgDeaths.toFixed(1)} soldat${est.avgDeaths >= 2 ? 's' : ''} perdu${est.avgDeaths >= 2 ? 's' : ''} en moyenne`,
            )),
    ),
    h('p', { class: 'muted small' }, "Aucune conséquence : pas d'XP, pas d'or, aucun soldat ne meurt vraiment et les entraînements ne sont pas consommés."),
  );
}

export function renderCombat(): HTMLElement {
  const st = getState();
  pruneSelection(st);
  const nextLevel = st.campaignLevel + 1;
  const level = Math.min(campaignPick ?? nextLevel, nextLevel);

  const tabs = h(
    'div',
    { class: 'subtabs' },
    h('button', { class: `subtab${mode === 'training' ? ' active' : ''}`, onclick: () => { mode = 'training'; refresh(); } }, 'Entraînement'),
    h('button', { class: `subtab${mode === 'campaign' ? ' active' : ''}`, onclick: () => { mode = 'campaign'; refresh(); } }, `Campagne (niveau ${nextLevel})`),
    h('button', { class: `subtab${mode === 'simulation' ? ' active' : ''}`, onclick: () => { mode = 'simulation'; refresh(); } }, 'Simulation'),
  );

  let info: HTMLElement;
  if (mode === 'training') {
    const avg = selected.size ? [...selected].reduce((n, id) => n + (st.soldiers.find((s) => s.id === id)?.level ?? 1), 0) / selected.size : 1;
    info = h(
      'div',
      { class: 'panel' },
      h('h3', null, "Combat d'entraînement"),
      h('p', null, `Affrontez des cibles adaptées au niveau de votre escouade pour gagner de l'expérience (environ ${fmt(trainingXp(avg))} XP par survivant, ${TRAINING_GOLD} or en cas de victoire).`),
      h('p', { class: 'muted small' }, `Chaque soldat peut participer à ${TRAINING_PER_SOLDIER} entraînements dans sa vie. Un soldat vaincu meurt définitivement.`),
    );
  } else if (mode === 'simulation') {
    info = simulationInfo(st);
  } else {
    const prev = previewCampaign(level);
    const cleared = level <= st.campaignLevel;
    info = h(
      'div',
      { class: 'panel' },
      campaignTrack(st, level),
      h(
        'div',
        { class: 'level-picker' },
        h('h3', null, `Niveau ${level}${prev.boss ? ' — BOSS' : ''}${cleared ? ' (terminé)' : ''}`),
        level < nextLevel && h('button', { class: 'btn btn-small', onclick: () => { campaignPick = null; refresh(); } }, `Aller au niveau ${nextLevel}`),
      ),
      h('p', null, `${prev.count} ennemis : ${prev.names.join(', ')}.`),
      h(
        'p',
        null,
        cleared
          ? `Niveau déjà terminé : récompenses réduites (${fmt(campaignXp(level) / 2)} XP, ${fmt(campaignGold(level, false))} or, arme possible).`
          : `Récompenses : ${fmt(campaignXp(level))} XP par survivant, ${fmt(campaignGold(level, true))} or et une arme garantie.`,
      ),
      h('p', { class: 'muted small' }, 'En cas de défaite, les soldats survivants gagnent un peu d’XP ; les soldats tombés meurent définitivement.'),
    );
  }

  const picked = st.soldiers.filter((s) => selected.has(s.id));
  const unarmed = picked.filter((s) => !s.weaponUid);
  const canLaunch = selected.size >= 1;

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
      ? h('div', { class: 'panel empty' }, h('p', null, "Vous n'avez aucun soldat."), h('button', { class: 'btn btn-gold', onclick: () => goTo('recruit') }, 'Recruter des soldats'))
      : h(
          'div',
          null,
          squadToolbar(st),
          squadView(st, (s) => ({
            selected: selected.has(s.id),
            disabled: !eligible(s),
            disabledReason: `${s.name} n'a plus d'entraînement disponible (il peut encore partir en campagne).`,
            onclick: () => {
              if (!eligible(s)) {
                toast(`${s.name} n'a plus d'entraînement disponible.`, 'bad');
                return;
              }
              if (selected.has(s.id)) selected.delete(s.id);
              else if (selected.size >= SQUAD_MAX) toast(`Maximum ${SQUAD_MAX} soldats par combat.`, 'bad');
              else selected.add(s.id);
              refresh();
            },
          })),
        ),
    unarmed.length > 0 &&
      h(
        'p',
        { class: 'warn' },
        'À mains nues : ',
        unarmed.map((s, i) => [i > 0 && ', ', h('button', { class: 'link', title: 'Ouvrir la fiche pour équiper une arme', onclick: () => openSoldier(s.id) }, s.name)]),
        '. Cliquez sur un nom pour lui équiper une arme.',
      ),
    mode === 'training' &&
      st.soldiers.length > 0 &&
      st.soldiers.every((s) => s.trainingsLeft <= 0) &&
      h(
        'p',
        { class: 'warn' },
        'Tous vos soldats ont épuisé leurs entraînements. Ils peuvent encore partir en campagne. ',
        h('button', { class: 'link', onclick: () => { mode = 'campaign'; refresh(); } }, 'Passer à la campagne'),
      ),
  );

  const launchBtn = h(
    'button',
    { class: 'btn btn-big btn-gold', disabled: !canLaunch, onclick: launch },
    !canLaunch
      ? 'Sélectionnez au moins un soldat'
      : mode === 'training' ? "Lancer l'entraînement" : mode === 'simulation' ? 'Lancer la simulation' : `Lancer le niveau ${level}`,
  );
  const quickPick = !canLaunch && st.soldiers.some(eligible) && h('button', { class: 'btn btn-big', onclick: () => { autoSelect(st); refresh(); } }, 'Sélection auto');
  const est = canLaunch && mode !== 'simulation' ? currentBattleEstimate(st, battleRequest(level)) : null;

  return h(
    'section',
    null,
    h('h2', null, 'Combat'),
    tabs,
    info,
    squadPanel,
    h('div', { class: 'launch-bar' }, est && estimateLine(est), h('div', { class: 'launch-buttons' }, quickPick, launchBtn)),
  );
}

