import { SURVIVAL_REST_HEAL, TRAINING_PER_SOLDIER, type UnlockId } from '../game/data';
import {
  campaignGold,
  campaignXp,
  canTrain,
  cashOutSurvival,
  dailyDone,
  dailyGold,
  DEFAULT_SIMULATION,
  estimateBattle,
  estimateSimulation,
  ESTIMATE_RUNS,
  launchBattle,
  launchSimulation,
  survivalWaveGold,
  trainingFee,
  trainingGold,
  trainingXp,
  type BattleRequest,
  type SimulationEstimate,
} from '../game/combat';
import {
  buildDailyEnemies,
  dailyKey,
  dailyLevel,
  dailyModifier,
  isBossLevel,
  previewCampaign,
  previewUnits,
  SIM_ENEMY_TYPES,
  SIM_MAX_ENEMIES,
  simulationPool,
  survivalBaseLevel,
  survivalWaveLevel,
  type SimulationConfig,
} from '../game/enemies';
import { isUnlocked, squadMax, unlockLevel } from '../game/progress';
import { sortSquad, trainingCost } from '../game/roster';
import { getState, mutate, refresh } from '../game/state';
import { computeStats, weaponForSoldier } from '../game/stats';
import type { GameState, Soldier } from '../game/types';
import { h } from './dom';
import { openBattle } from './battleView';
import { confirmDialog, fmt, getSquadSort, squadToolbar, squadView, toast } from './components';
import { goTo } from './nav';
import { openSoldier } from './roster';

export type CombatMode = 'training' | 'campaign' | 'daily' | 'survival' | 'simulation';

let mode: CombatMode = 'training';

/** Modes soumis à un seuil de campagne. */
const MODE_UNLOCK: Partial<Record<CombatMode, UnlockId>> = { daily: 'daily', survival: 'survival', simulation: 'simulation' };

/** Ouvre l'onglet Combat sur un mode donné (utilisé par le guide). */
export function openCombat(m: CombatMode): void {
  mode = m;
  if (m === 'campaign') campaignPick = null;
  goTo('combat');
}

// Estimation d'un vrai combat : recalculée seulement si l'escouade, ses stats ou l'adversaire changent
let battleEstimate: { key: string; value: SimulationEstimate } | null = null;

function battleRequest(st: GameState, level: number): BattleRequest {
  const squad = [...selected];
  switch (mode) {
    case 'training':
      return { mode: 'training', squad };
    case 'daily':
      return { mode: 'daily', squad };
    case 'survival':
      return { mode: 'survival', squad: st.survival?.squad ?? squad };
    default:
      return { mode: 'campaign', squad, level };
  }
}

function currentBattleEstimate(st: GameState, req: BattleRequest): SimulationEstimate | null {
  const soldiers = req.squad.map((id) => st.soldiers.find((s) => s.id === id)).filter((s): s is Soldier => !!s);
  const key = JSON.stringify([req, dailyKey(), st.campaignLevel, st.survival, soldiers.map((s) => [s.level, s.upgrades, st.weapons.find((w) => w.uid === s.weaponUid)?.defId ?? null])]);
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
  return mode !== 'training' || canTrain(s);
}

// La sélection auto ne dépense jamais d'or : un entraînement payant se choisit à la main
function autoEligible(s: Soldier): boolean {
  return mode !== 'training' || s.trainingsLeft > 0;
}

const paidTraining = (s: Soldier): boolean => mode === 'training' && s.trainingsLeft <= 0 && canTrain(s);

function feeLabel(fee: number): string {
  return fee > 0 ? ` — ${fmt(fee)} or` : '';
}

const locked = (st: GameState): UnlockId | null => {
  const id = MODE_UNLOCK[mode];
  return id && !isUnlocked(st, id) ? id : null;
};

// Retire les soldats morts ou devenus inéligibles : la sélection survit ainsi d'un combat à l'autre
function pruneSelection(st: GameState): void {
  for (const id of [...selected]) {
    const s = st.soldiers.find((x) => x.id === id);
    if (!s || !eligible(s)) selected.delete(id);
  }
}

function autoSelect(st: GameState): void {
  selected.clear();
  const ready = st.soldiers.filter(autoEligible);
  for (const s of sortSquad(st, getSquadSort(), ready).slice(0, squadMax(st))) selected.add(s.id);
}

const TITLES: Record<Exclude<CombatMode, 'simulation' | 'campaign'>, string> = { training: 'Entraînement', daily: 'Défi du jour', survival: 'Survie' };

function launch(): void {
  const st = getState();
  pruneSelection(st);
  if (mode === 'survival' && st.survival) {
    launchFight(st, st.campaignLevel + 1);
    return;
  }
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
  launchFight(st, Math.min(campaignPick ?? st.campaignLevel + 1, st.campaignLevel + 1));
}

function launchFight(st: GameState, level: number): void {
  const wave = (st.survival?.wave ?? 0) + 1;
  const res = mutate((state) => launchBattle(state, battleRequest(state, level)));
  if (!res.ok) {
    toast(res.error, 'bad');
    return;
  }
  const title = mode === 'campaign' ? `Campagne — niveau ${level}` : mode === 'survival' ? `Survie — vague ${wave}` : TITLES[mode as keyof typeof TITLES];
  // Les survivants restent sélectionnés : on peut enchaîner le combat suivant directement depuis l'écran de résultat
  const after = getState();
  pruneSelection(after);
  let replay: { label: string; run: () => void } | undefined;
  if (mode === 'survival') {
    if (after.survival) replay = { label: `Vague suivante (${after.survival.wave + 1}) — ${after.survival.squad.length} soldat${after.survival.squad.length > 1 ? 's' : ''}`, run: launch };
  } else if (mode !== 'daily' && selected.size > 0) {
    const nextLevel = Math.min(campaignPick ?? after.campaignLevel + 1, after.campaignLevel + 1);
    const replayLabel = mode === 'training' ? 'Nouvel entraînement' : nextLevel > level ? `Niveau suivant (${nextLevel})` : `Rejouer le niveau ${level}`;
    const fee = mode === 'training' ? trainingFee(after.soldiers.filter((s) => selected.has(s.id))) : 0;
    replay = { label: `${replayLabel} — ${selected.size} soldat${selected.size > 1 ? 's' : ''}${feeLabel(fee)}`, run: launch };
  }
  // l'état est déjà enregistré : on rafraîchit simplement l'écran
  openBattle(title, res.units, res.result, res.report, () => refresh(), replay);
}

async function cashOut(): Promise<void> {
  const run = getState().survival;
  if (!run) return;
  const ok = await confirmDialog({ title: `Encaisser ${fmt(run.pot)} or ?`, body: `L'expédition s'arrête après ${run.wave} vague${run.wave > 1 ? 's' : ''} et tous les soldats rentrent indemnes.`, confirm: `Encaisser (+${fmt(run.pot)} or)` });
  if (!ok) return;
  const gold = mutate((st) => cashOutSurvival(st));
  toast(`Expédition terminée : +${fmt(gold)} or.`, 'good');
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

function lockedInfo(id: UnlockId, title: string, text: string): HTMLElement {
  return h(
    'div',
    { class: 'panel locked-panel' },
    h('h3', null, `🔒 ${title}`),
    h('p', null, text),
    h('p', { class: 'muted' }, `Se débloque en terminant le niveau ${unlockLevel(id)} de la campagne.`),
    h('button', { class: 'btn btn-small', onclick: () => { mode = 'campaign'; campaignPick = null; refresh(); } }, 'Aller à la campagne'),
  );
}

function dailyInfo(st: GameState): HTMLElement {
  const key = dailyKey();
  const mod = dailyModifier(key);
  const level = dailyLevel(st.campaignLevel);
  const prev = previewUnits(buildDailyEnemies(key, level), mod.id === 'bosses');
  const done = dailyDone(st, key);
  const streakNext = st.dailyStreak + 1;
  return h(
    'div',
    { class: 'panel daily-panel' },
    h('h3', null, `Défi du jour : ${mod.name}`),
    h('p', null, mod.desc),
    h('p', null, `Puissance du niveau ${level} · ${prev.count} ennemis : ${prev.names.join(', ')}.`),
    done
      ? h('p', { class: 'good' }, `Défi du jour déjà tenté. Revenez demain pour un nouveau défi${st.dailyStreak > 0 ? ` et prolonger votre série (${st.dailyStreak} jour${st.dailyStreak > 1 ? 's' : ''})` : ''} !`)
      : h('p', null, `Récompenses : ${fmt(dailyGold(level, streakNext))} or, 1 tirage gratuit, une arme de boss et ${fmt(campaignXp(level))} XP par survivant.`),
    h('p', { class: 'muted small' }, `Une seule tentative par jour. Série en cours : ${st.dailyStreak} jour${st.dailyStreak > 1 ? 's' : ''} (bonus de +20 or par jour consécutif, jusqu'à 7). Une défaite remet la série à zéro et les soldats tombés meurent.`),
  );
}

function survivalInfo(st: GameState): HTMLElement {
  const run = st.survival;
  if (!run) {
    const base = survivalBaseLevel(st.campaignLevel);
    return h(
      'div',
      { class: 'panel' },
      h('h3', null, 'Survie'),
      h('p', null, `Enchaînez des vagues de plus en plus fortes, en partant de la puissance du niveau ${base}. Chaque vague remportée ajoute de l'or au pot (${fmt(survivalWaveGold(base))} or pour la première), et toutes les 5 vagues un boss lâche une arme.`),
      h('p', null, `Pas de soin complet entre les vagues : chaque soldat ne récupère que ${Math.round(SURVIVAL_REST_HEAL * 100)} % de ses PV. Les soldats tombés lors d'une vague gagnée sont rapatriés et quittent l'expédition.`),
      h('p', { class: 'muted small' }, `Encaissez le pot quand vous voulez. En cas de défaite, vous ne gardez que la moitié du pot et les soldats tombés meurent. Record : vague ${st.bestWave}.`),
    );
  }
  const soldiers = run.squad.map((id) => st.soldiers.find((s) => s.id === id)).filter((s): s is Soldier => !!s);
  const nextLevel = survivalWaveLevel(run.wave + 1, st.campaignLevel);
  return h(
    'div',
    { class: 'panel survival-panel' },
    h('h3', null, `Expédition en cours : ${run.wave} vague${run.wave > 1 ? 's' : ''} remportée${run.wave > 1 ? 's' : ''}`),
    h('p', null, h('b', { class: 'gold' }, `Pot : ${fmt(run.pot)} or`), ` · Prochaine vague : puissance du niveau ${nextLevel}${isBossLevel(run.wave + 1) ? ', avec un boss' : ''} (+${fmt(survivalWaveGold(nextLevel))} or).`),
    h(
      'ul',
      { class: 'survival-hp' },
      soldiers.map((s) => {
        const max = computeStats(s, weaponForSoldier(s, st.weapons)).maxHp;
        const hp = Math.min(max, run.hp[s.id] ?? max);
        return h('li', null, h('span', null, s.name), h('div', { class: 'hpbar-inline' }, h('div', { class: 'hp-fill', style: `width:${(hp / max) * 100}%` })), h('small', { class: 'muted' }, `${fmt(hp)} / ${fmt(max)} PV`));
      }),
    ),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-gold', onclick: () => void cashOut() }, `Encaisser ${fmt(run.pot)} or`)),
  );
}

export function renderCombat(): HTMLElement {
  const st = getState();
  pruneSelection(st);
  const nextLevel = st.campaignLevel + 1;
  const level = Math.min(campaignPick ?? nextLevel, nextLevel);
  const max = squadMax(st);

  const tab = (m: CombatMode, label: string) => {
    const lock = MODE_UNLOCK[m];
    const isLocked = !!lock && !isUnlocked(st, lock);
    return h(
      'button',
      { class: `subtab${mode === m ? ' active' : ''}${isLocked ? ' locked' : ''}`, title: isLocked ? `Débloqué au niveau ${unlockLevel(lock!)} de la campagne` : undefined, onclick: () => { mode = m; refresh(); } },
      isLocked ? `🔒 ${label}` : label,
    );
  };
  const dailyReady = isUnlocked(st, 'daily') && !dailyDone(st);
  const tabs = h(
    'div',
    { class: 'subtabs' },
    tab('training', 'Entraînement'),
    tab('campaign', `Campagne (niveau ${nextLevel})`),
    h('span', { class: 'subtab-wrap' }, tab('daily', 'Défi du jour'), dailyReady && h('span', { class: 'badge', title: 'Défi du jour disponible' }, '!')),
    tab('survival', st.survival ? `Survie (vague ${st.survival.wave + 1})` : 'Survie'),
    tab('simulation', 'Simulation'),
  );

  const lockId = locked(st);
  let info: HTMLElement;
  if (lockId === 'daily') {
    info = lockedInfo(lockId, 'Défi du jour', 'Un combat unique par jour, avec une règle spéciale (horde, commando d’élite, deux boss…) et de grosses récompenses : or, tirage gratuit et arme de boss.');
  } else if (lockId === 'survival') {
    info = lockedInfo(lockId, 'Survie', 'Enchaînez les vagues avec les mêmes soldats, sans soin complet entre deux vagues : encaissez vos gains ou risquez tout pour la vague suivante.');
  } else if (lockId === 'simulation') {
    info = lockedInfo(lockId, 'Simulation', 'Testez votre escouade sans aucun risque face aux adversaires de votre choix, et estimez ses chances.');
  } else if (mode === 'training') {
    const avg = selected.size ? [...selected].reduce((n, id) => n + (st.soldiers.find((s) => s.id === id)?.level ?? 1), 0) / selected.size : 1;
    info = h(
      'div',
      { class: 'panel' },
      h('h3', null, "Combat d'entraînement"),
      h('p', null, `Affrontez des cibles adaptées au niveau de votre escouade pour gagner de l'expérience (environ ${fmt(trainingXp(avg))} XP par soldat resté debout, ${fmt(trainingGold(avg))} or en cas de victoire).`),
      h('p', { class: 'muted small' }, `Sans danger : un soldat mis K.O. à l'entraînement s'en remet, mais ne gagne pas d'XP. Chaque soldat a ${TRAINING_PER_SOLDIER} entraînements gratuits ; ensuite, vous pouvez encore l'engager en payant son entraînement au lancement (selon son niveau).`),
    );
  } else if (mode === 'simulation') {
    info = simulationInfo(st);
  } else if (mode === 'daily') {
    info = dailyInfo(st);
  } else if (mode === 'survival') {
    info = survivalInfo(st);
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
          : `Récompenses : ${fmt(campaignXp(level))} XP par survivant, ${fmt(campaignGold(level, true))} or et une arme garantie${prev.boss ? ', améliorée par le boss, plus un tirage gratuit' : ''}.`,
      ),
      h('p', { class: 'muted small' }, 'En cas de victoire, les soldats tombés sont rapatriés (sans XP). En cas de défaite, les survivants gagnent un peu d’XP et les soldats tombés meurent définitivement.'),
    );
  }

  const runActive = mode === 'survival' && !!st.survival;
  const picked = st.soldiers.filter((s) => selected.has(s.id));
  const unarmed = picked.filter((s) => !s.weaponUid);
  const fee = mode === 'training' ? trainingFee(picked) : 0;
  const broke = st.gold < fee;
  const blocked = !!lockId || (mode === 'daily' && dailyDone(st));
  const canLaunch = !blocked && !broke && (runActive ? st.survival!.squad.some((id) => st.soldiers.some((s) => s.id === id)) : selected.size >= 1);

  const squadPanel = runActive || lockId ? null : h(
    'div',
    null,
    h(
      'div',
      { class: 'section-head' },
      h('h3', null, `Escouade engagée : ${selected.size} / ${max}`),
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
            disabledReason: `${s.name} est au niveau maximum et n'a plus d'entraînement gratuit.`,
            cost: paidTraining(s) ? { text: `Entr. ${fmt(trainingCost(s))} or`, title: `Entraînements gratuits épuisés : engager ${s.name} coûte ${fmt(trainingCost(s))} or, payés au lancement.` } : undefined,
            onclick: () => {
              if (!eligible(s)) {
                toast(`${s.name} est au niveau maximum et n'a plus d'entraînement gratuit.`, 'bad');
                return;
              }
              if (selected.has(s.id)) selected.delete(s.id);
              else if (selected.size >= max) toast(`Maximum ${max} soldats par combat.`, 'bad');
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
        'Plus aucun entraînement gratuit : sélectionnez des soldats pour un entraînement payant, ou partez en campagne. ',
        h('button', { class: 'link', onclick: () => { mode = 'campaign'; refresh(); } }, 'Passer à la campagne'),
      ),
    fee > 0 &&
      h(
        'p',
        { class: broke ? 'warn' : 'muted small' },
        `Entraînement payant pour ${picked.filter(paidTraining).map((s) => s.name).join(', ')} : ${fmt(fee)} or au lancement`,
        broke ? ` (il vous manque ${fmt(fee - st.gold)} or).` : '.',
      ),
  );

  const label =
    mode === 'training' ? `Lancer l'entraînement${feeLabel(fee)}`
    : mode === 'simulation' ? 'Lancer la simulation'
    : mode === 'daily' ? 'Relever le défi'
    : mode === 'survival' ? (st.survival ? `Lancer la vague ${st.survival.wave + 1}` : "Partir en expédition")
    : `Lancer le niveau ${level}`;
  const launchBtn =
    !lockId &&
    h(
      'button',
      { class: 'btn btn-big btn-gold', disabled: !canLaunch, onclick: launch },
      canLaunch ? label
      : mode === 'daily' && dailyDone(st) ? 'Revenez demain'
      : runActive ? "Plus aucun soldat dans l'expédition"
      : broke ? `Il manque ${fmt(fee - st.gold)} or`
      : 'Sélectionnez au moins un soldat',
    );
  const quickPick = !canLaunch && !blocked && !broke && !runActive && st.soldiers.some(autoEligible) && h('button', { class: 'btn btn-big', onclick: () => { autoSelect(st); refresh(); } }, 'Sélection auto');
  const est = canLaunch && mode !== 'simulation' ? currentBattleEstimate(st, battleRequest(st, level)) : null;

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
