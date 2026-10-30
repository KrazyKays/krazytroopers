import { LOOT_FIRST_CLEAR, LOOT_METER_MAX, LOOT_REPLAY, STAR_CHEST_EVERY, SURVIVAL_REST_HEAL, TRAINING_PER_SOLDIER, type UnlockId } from '../game/data';
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
  squadStats,
  starGold,
  survivalWaveGold,
  totalStars,
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
  type ArmyPreview,
  type SimulationConfig,
} from '../game/enemies';
import { isUnlocked, squadMax, unlockLevel } from '../game/progress';
import { sortSquad, trainingCost } from '../game/roster';
import { activeTactic, synergyStatus, TACTICS } from '../game/squad';
import { getState, mutate, refresh } from '../game/state';
import { weaponForSoldier } from '../game/stats';
import type { GameState, Soldier } from '../game/types';
import { h } from './dom';
import { openBattle } from './battleView';
import { confirmDialog, fmt, getSquadSort, progressBar, soldierSprite, squadToolbar, squadView, stars, toast } from './components';
import { goTo } from './nav';
import { openSoldier } from './roster';

export type CombatMode = 'training' | 'campaign' | 'daily' | 'survival' | 'simulation';

let mode: CombatMode = 'campaign';

/** Modes soumis à un seuil de campagne. */
const MODE_UNLOCK: Partial<Record<CombatMode, UnlockId>> = { daily: 'daily', survival: 'survival', simulation: 'simulation' };

const MODES: { id: CombatMode; icon: string; label: string }[] = [
  { id: 'campaign', icon: '🚩', label: 'Campagne' },
  { id: 'daily', icon: '📅', label: 'Défi du jour' },
  { id: 'survival', icon: '🔥', label: 'Survie' },
  { id: 'training', icon: '🎯', label: 'Entraînement' },
  { id: 'simulation', icon: '🧪', label: 'Simulation' },
];

/** Ouvre l'onglet Combat sur un mode donné (utilisé par le QG et le guide). */
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
  const key = JSON.stringify([req, dailyKey(), st.campaignLevel, st.survival, st.tactic, soldiers.map((s) => [s.level, s.upgrades, st.weapons.find((w) => w.uid === s.weaponUid)?.defId ?? null])]);
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
  const verdict = rate >= 0.8 ? 'Combat sûr' : rate >= 0.5 ? 'Combat risqué' : 'Très dangereux';
  const deaths = est.avgDeaths;
  return h(
    'div',
    { class: `odds odds-${tone}`, title: `Estimation sur ${est.runs} combats simulés avec cette escouade` },
    h('div', { class: 'odds-gauge' }, h('div', { class: 'odds-fill', style: `width:${rate * 100}%` })),
    h('div', { class: 'odds-text' }, h('b', null, `${verdict} · ${Math.round(rate * 100)} % de victoire`), h('small', null, deaths < 0.05 ? 'Aucune perte attendue' : `~${fmt(deaths, 1)} soldat${deaths >= 1.5 ? 's' : ''} perdu${deaths >= 1.5 ? 's' : ''} en moyenne (mort définitive)`)),
  );
}

// Frise de progression : niveaux terminés (avec leurs étoiles), niveau à conquérir, boss, et quelques niveaux verrouillés
function campaignTrack(st: GameState, level: number): HTMLElement {
  const next = st.campaignLevel + 1;
  const start = Math.max(1, Math.min(level - 5, next - 8));
  const nodes = Array.from({ length: 12 }, (_, i) => start + i).map((n) => {
    const state = n <= st.campaignLevel ? 'cleared' : n === next ? 'next' : 'locked';
    const boss = isBossLevel(n);
    const got = st.campaignStars[n] ?? 0;
    const label = state === 'cleared' ? `Niveau ${n} terminé (${got} ★)` : state === 'next' ? `Niveau ${n} : à conquérir` : `Niveau ${n} verrouillé`;
    return h(
      'button',
      {
        class: `track-node track-${state}${boss ? ' track-boss' : ''}${n === level ? ' current' : ''}`,
        disabled: state === 'locked',
        title: boss ? `${label} (boss)` : label,
        onclick: () => { campaignPick = n >= next ? null : n; refresh(); },
      },
      h('span', { class: 'track-num' }, boss ? '☠' : String(n)),
      state === 'cleared' ? stars(got, 3, 'stars-mini') : h('span', { class: 'track-mark' }, state === 'next' ? 'À faire' : '🔒'),
    );
  });
  return h(
    'div',
    { class: 'campaign-track' },
    h('button', { class: 'btn btn-icon', disabled: level <= 1, title: 'Niveau précédent', onclick: () => { campaignPick = level - 1; refresh(); } }, '‹'),
    h('div', { class: 'track-nodes' }, nodes),
    h('button', { class: 'btn btn-icon', disabled: level >= next, title: 'Niveau suivant', onclick: () => { campaignPick = level + 1 >= next ? null : level + 1; refresh(); } }, '›'),
  );
}

const selected = new Set<string>();
let campaignPick: number | null = null;
const sim: SimulationConfig = { ...DEFAULT_SIMULATION };
/** Dernière estimation, valable tant que l'escouade et la configuration n'ont pas changé. */
let estimate: { key: string; value: SimulationEstimate } | null = null;

const simKey = (): string => JSON.stringify([sim, [...selected].sort(), getState().tactic]);
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

function toggleSoldier(st: GameState, s: Soldier): void {
  if (!eligible(s)) {
    toast(`${s.name} est au niveau maximum et n'a plus d'entraînement gratuit.`, 'bad');
    return;
  }
  const max = squadMax(st);
  if (selected.has(s.id)) selected.delete(s.id);
  else if (selected.size >= max) toast(`Maximum ${max} soldats par combat.`, 'bad');
  else selected.add(s.id);
  refresh();
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
    if (after.survival) replay = { label: `Vague suivante (${after.survival.wave + 1})`, run: launch };
  } else if (mode !== 'daily' && selected.size > 0) {
    const nextLevel = Math.min(campaignPick ?? after.campaignLevel + 1, after.campaignLevel + 1);
    const replayLabel = mode === 'training' ? 'Nouvel entraînement' : nextLevel > level ? `Niveau suivant (${nextLevel})` : `Rejouer le niveau ${level}`;
    const fee = mode === 'training' ? trainingFee(after.soldiers.filter((s) => selected.has(s.id))) : 0;
    replay = { label: `${replayLabel}${feeLabel(fee)}`, run: launch };
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

// ---------- Briefings ----------

/** Récompense d'arme d'une victoire de campagne, selon le remplissage actuel de la jauge de butin. */
function lootLabel(st: GameState, gain: number): string {
  return st.lootMeter + gain >= LOOT_METER_MAX ? '🔫 arme (jauge pleine)' : `🔫 +${gain} butin`;
}

function brief(icon: string, title: string, ...body: (HTMLElement | false | null | undefined | (HTMLElement | false)[])[]): HTMLElement {
  return h('div', { class: 'panel brief' }, h('div', { class: 'panel-head' }, h('h3', null, h('span', { class: 'brief-icon' }, icon), title)), ...body);
}

function rewards(...items: (string | false)[]): HTMLElement {
  return h('div', { class: 'rewards' }, h('span', { class: 'muted small' }, 'Récompenses'), items.filter(Boolean).map((r) => h('span', { class: 'reward-chip' }, r)));
}

function enemyChips(prev: ArmyPreview): HTMLElement {
  return h(
    'div',
    { class: 'enemy-list' },
    prev.groups.map((g) => h('span', { class: `enemy-chip${g.name.includes("d'élite") ? ' elite' : ''}` }, `${g.count} × ${g.name}`)),
    prev.elites.length > 0 &&
      h('div', { class: 'elite-notes' }, prev.elites.map((a) => h('span', { class: 'note note-warn small' }, h('b', null, `Élite ${a.name}`), ` : ${a.desc}`))),
  );
}

function stepper(label: string, value: number, min: number, max: number, set: (v: number) => void, big = 0): HTMLElement {
  const btn = (text: string, delta: number) =>
    h('button', { class: 'btn btn-small', disabled: delta < 0 ? value <= min : value >= max, onclick: () => { set(Math.min(max, Math.max(min, value + delta))); refresh(); } }, text);
  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('div', { class: 'stepper' }, big > 0 && btn('«', -big), btn('−', -1), h('b', null, String(value)), btn('+', 1), big > 0 && btn('»', big)),
  );
}

function simulationInfo(st: GameState): HTMLElement {
  sim.level = Math.min(Math.max(1, sim.level), simMaxLevel(st));
  const dummy = sim.opponent === 'scarecrow';
  const opponent = h(
    'select',
    { class: 'select', onchange: (e) => { sim.opponent = (e.target as HTMLSelectElement).value; if (sim.opponent === 'scarecrow') sim.boss = false; refresh(); } },
    h('option', { value: 'scarecrow' }, 'Épouvantail (cible invincible)'),
    h('option', { value: 'mixed' }, 'Troupes mixtes (selon le niveau)'),
    SIM_ENEMY_TYPES.map((t) => h('option', { value: t.id }, `Uniquement : ${t.name}`)),
  );
  opponent.value = sim.opponent;

  const count = `${sim.count} ${dummy ? `épouvantail${sim.count > 1 ? 's' : ''}` : `ennemi${sim.count > 1 ? 's' : ''}`}`;
  const desc = dummy
    ? `${count} invincible${sim.count > 1 ? 's' : ''} : chacun frappe le soldat le plus proche, de plus en plus fort. Idéal pour mesurer les dégâts et l'endurance de l'escouade.`
    : `${count} à la puissance du niveau ${sim.level}${sim.boss ? ', dont un boss' : ''} : ${simulationPool(sim).join(', ')}.`;

  const est = estimate && estimate.key === simKey() ? estimate.value : null;
  const pct = (n: number) => `${Math.round((n / (est?.runs ?? 1)) * 100)} %`;

  return brief(
    '🧪',
    'Simulation de combat',
    h('p', { class: 'muted' }, "Aucune conséquence : pas d'XP, pas d'or, aucun soldat ne meurt vraiment. Testez tactiques et synergies !"),
    h(
      'div',
      { class: 'sim-config' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Adversaire'), opponent),
      stepper('Nombre d’ennemis', sim.count, 1, SIM_MAX_ENEMIES, (v) => { sim.count = v; }),
      !dummy && stepper('Puissance (niveau)', sim.level, 1, simMaxLevel(st), (v) => { sim.level = v; }, 5),
      !dummy && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: sim.boss, onchange: (e) => { sim.boss = (e.target as HTMLInputElement).checked; refresh(); } }), ' Inclure un boss'),
    ),
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'muted small' }, 'Raccourcis :'),
      h('button', { class: 'btn btn-small', disabled: selected.size === 0, onclick: () => { sim.count = selected.size; refresh(); } }, 'À égalité'),
      h('button', { class: 'btn btn-small', disabled: selected.size === 0, onclick: () => { sim.count = Math.min(SIM_MAX_ENEMIES, selected.size * 2); refresh(); } }, 'Deux contre un'),
      !dummy && h('button', { class: 'btn btn-small', onclick: () => { sim.level = Math.min(st.campaignLevel + 1, simMaxLevel(st)); refresh(); } }, `Niveau de campagne (${st.campaignLevel + 1})`),
    ),
    h('p', null, desc),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', disabled: selected.size === 0, onclick: runEstimate }, `📊 Estimer sur ${ESTIMATE_RUNS} combats`),
      est &&
        (dummy
          ? h('span', null, `Survie moyenne : ${est.avgDuration.toFixed(1)} s · ${pct(est.timeouts)} des combats tenus jusqu'au bout`)
          : h('span', null, h('b', { class: est.wins >= est.runs / 2 ? 'good' : 'bad' }, `${pct(est.wins)} de victoires`), ` · ${pct(est.losses)} de défaites`, est.timeouts > 0 && ` · ${pct(est.timeouts)} hors temps`, ` · ${est.avgDuration.toFixed(1)} s en moyenne`)),
    ),
  );
}

function lockedInfo(id: UnlockId, icon: string, title: string, text: string): HTMLElement {
  return h(
    'div',
    { class: 'panel locked-panel' },
    h('div', { class: 'locked-icon' }, '🔒'),
    h('h3', null, `${icon} ${title}`),
    h('p', null, text),
    h('p', { class: 'muted' }, `Se débloque en terminant le niveau ${unlockLevel(id)} de la campagne.`),
    h('button', { class: 'btn btn-primary', onclick: () => { mode = 'campaign'; campaignPick = null; refresh(); } }, 'Aller à la campagne'),
  );
}

function dailyInfo(st: GameState): HTMLElement {
  const key = dailyKey();
  const mod = dailyModifier(key);
  const level = dailyLevel(st.campaignLevel);
  const prev = previewUnits(buildDailyEnemies(key, level), mod.id === 'bosses');
  const done = dailyDone(st, key);
  const streakNext = st.dailyStreak + 1;
  return brief(
    '📅',
    `Défi du jour : ${mod.name}`,
    h('p', { class: 'note' }, mod.desc),
    h('p', { class: 'muted small' }, `Puissance du niveau ${level} · ${prev.count} ennemis`),
    enemyChips(prev),
    done
      ? h('p', { class: 'note note-good' }, `Défi déjà tenté. Revenez demain${st.dailyStreak > 0 ? ` pour prolonger votre série (${st.dailyStreak} jour${st.dailyStreak > 1 ? 's' : ''})` : ''} !`)
      : rewards(`🪙 ${fmt(dailyGold(level, streakNext))} or`, '🎟️ 1 tirage', '🔫 arme de boss', `✨ ${fmt(campaignXp(level))} XP`),
    h('p', { class: 'muted small' }, `Une seule tentative par jour. Série : ${st.dailyStreak} jour${st.dailyStreak > 1 ? 's' : ''} (+20 or par jour consécutif, jusqu'à 7). Une défaite remet la série à zéro et les soldats tombés meurent.`),
  );
}

function survivalInfo(st: GameState): HTMLElement {
  const run = st.survival;
  if (!run) {
    const base = survivalBaseLevel(st.campaignLevel);
    return brief(
      '🔥',
      'Survie',
      h('p', null, `Enchaînez des vagues de plus en plus fortes, à partir de la puissance du niveau ${base}. Chaque vague gagnée remplit le pot (${fmt(survivalWaveGold(base))} or pour la première) ; un boss lâche une arme toutes les 5 vagues.`),
      h('p', { class: 'note note-warn' }, `Pas de soin complet : chaque soldat ne récupère que ${Math.round(SURVIVAL_REST_HEAL * 100)} % de ses PV entre deux vagues. Une défaite ne laisse que la moitié du pot, et les soldats tombés meurent.`),
      h('p', { class: 'muted small' }, `Record : vague ${st.bestWave}.`),
    );
  }
  const soldiers = run.squad.map((id) => st.soldiers.find((s) => s.id === id)).filter((s): s is Soldier => !!s);
  const nextLevel = survivalWaveLevel(run.wave + 1, st.campaignLevel);
  const stats = squadStats(st, soldiers);
  return brief(
    '🔥',
    `Expédition : ${run.wave} vague${run.wave > 1 ? 's' : ''} remportée${run.wave > 1 ? 's' : ''}`,
    h('div', { class: 'pot' }, h('span', null, 'Pot'), h('b', null, `🪙 ${fmt(run.pot)} or`)),
    h('p', null, `Prochaine vague : puissance du niveau ${nextLevel}${isBossLevel(run.wave + 1) ? ', avec un boss' : ''} (+${fmt(survivalWaveGold(nextLevel))} or).`),
    h(
      'ul',
      { class: 'survival-hp' },
      soldiers.map((s) => {
        const max = stats.get(s.id)!.maxHp;
        const hp = Math.min(max, run.hp[s.id] ?? max);
        return h('li', null, h('span', null, s.name), progressBar(hp / max, `${fmt(hp)} / ${fmt(max)} PV`, hp / max < 0.35 ? 'progress-bad' : 'progress-good'));
      }),
    ),
    h('button', { class: 'btn btn-primary', onclick: () => void cashOut() }, `Encaisser ${fmt(run.pot)} or et rentrer`),
  );
}

function trainingInfo(st: GameState): HTMLElement {
  const avg = selected.size ? [...selected].reduce((n, id) => n + (st.soldiers.find((s) => s.id === id)?.level ?? 1), 0) / selected.size : 1;
  return brief(
    '🎯',
    "Combat d'entraînement",
    h('p', null, "Des cibles adaptées au niveau de votre escouade pour gagner de l'expérience, sans aucun risque."),
    rewards(`✨ ~${fmt(trainingXp(avg))} XP par soldat debout`, `🪙 ${fmt(trainingGold(avg))} or si victoire`),
    h('p', { class: 'muted small' }, `Un soldat K.O. s'en remet mais ne gagne pas d'XP. Chaque soldat a ${TRAINING_PER_SOLDIER} entraînements gratuits ; ensuite, son entraînement se paie au lancement selon son niveau.`),
  );
}

function campaignInfo(st: GameState, level: number): HTMLElement {
  const nextLevel = st.campaignLevel + 1;
  const prev = previewCampaign(level);
  const cleared = level <= st.campaignLevel;
  const best = st.campaignStars[level] ?? 0;
  const total = totalStars(st);
  return brief(
    prev.boss ? '☠️' : '🚩',
    `Niveau ${level}${prev.boss ? ' — BOSS' : ''}`,
    campaignTrack(st, level),
    h(
      'div',
      { class: 'brief-row' },
      h('div', { class: 'brief-stars' }, h('span', { class: 'muted small' }, 'Record'), stars(best, 3, 'stars-big')),
      level < nextLevel && h('button', { class: 'btn btn-small', onclick: () => { campaignPick = null; refresh(); } }, `Aller au niveau ${nextLevel} →`),
    ),
    h('p', { class: 'muted small' }, `${prev.count} ennemis`),
    enemyChips(prev),
    cleared
      ? rewards(`✨ ${fmt(campaignXp(level) / 2)} XP`, `🪙 ${fmt(campaignGold(level, false))} or`, lootLabel(st, LOOT_REPLAY), best < 3 && `⭐ +${fmt(starGold(level))} or par nouvelle étoile`)
      : rewards(`✨ ${fmt(campaignXp(level))} XP`, `🪙 ${fmt(campaignGold(level, true))} or`, prev.boss ? '🔫 arme de boss garantie' : lootLabel(st, LOOT_FIRST_CLEAR), prev.boss && '🎟️ 1 tirage', `⭐ +${fmt(starGold(level))} or par étoile`),
    h('div', { class: 'star-rules' }, h('span', null, stars(3, 3, 'stars-mini'), ' aucune perte'), h('span', null, stars(2, 3, 'stars-mini'), ' ≤ moitié tombée'), h('span', null, stars(1, 3, 'stars-mini'), ' victoire')),
    h(
      'div',
      { class: 'meters' },
      progressBar(st.lootMeter / LOOT_METER_MAX, `🔫 Jauge de butin : ${st.lootMeter} / ${LOOT_METER_MAX} (une arme quand elle est pleine)`, 'progress-loot'),
      progressBar((total % STAR_CHEST_EVERY) / STAR_CHEST_EVERY, `⭐ Coffre d'étoiles (1 tirage) : ${total % STAR_CHEST_EVERY} / ${STAR_CHEST_EVERY}`),
    ),
    h('p', { class: 'muted small' }, 'Victoire : les soldats tombés sont rapatriés (sans XP). Défaite : ils meurent définitivement.'),
  );
}

// ---------- Préparation : emplacements, tactique, synergies ----------

function slots(st: GameState, squad: Soldier[], fixed: boolean): HTMLElement {
  const max = fixed ? squad.length : squadMax(st);
  return h(
    'div',
    { class: 'slots' },
    Array.from({ length: max }, (_, i) => {
      const s = squad[i];
      if (!s) return h('div', { class: 'slot empty', title: 'Emplacement libre : choisissez un soldat ci-dessous' }, '+');
      const w = weaponForSoldier(s, st.weapons);
      return h(
        'button',
        { class: `slot rarity-${s.rarity}`, title: fixed ? s.name : `${s.name} — cliquer pour retirer`, disabled: fixed, onclick: () => { selected.delete(s.id); refresh(); } },
        soldierSprite(st, s),
        h('span', { class: 'slot-name' }, s.name.split(' ')[0]),
        h('span', { class: 'slot-sub' }, `Niv. ${s.level} · ${s.weaponUid ? w.name : 'mains nues'}`),
      );
    }),
  );
}

function tacticPicker(st: GameState): HTMLElement {
  if (!isUnlocked(st, 'tactics')) {
    return h('div', { class: 'prep-block' }, h('h4', null, 'Tactique'), h('p', { class: 'muted small' }, `🔒 Les tactiques se débloquent au niveau ${unlockLevel('tactics')} de la campagne.`));
  }
  const cur = activeTactic(st);
  return h(
    'div',
    { class: 'prep-block' },
    h('h4', null, 'Tactique'),
    h(
      'div',
      { class: 'tactics' },
      TACTICS.map((t) => h('button', { class: `tactic${t.id === cur.id ? ' active' : ''}`, title: t.desc, onclick: () => mutate((g) => { g.tactic = t.id; }) }, h('span', { class: 'tactic-icon' }, t.icon), h('b', null, t.name))),
    ),
    h('p', { class: 'muted small' }, cur.desc),
  );
}

function synergyPanel(st: GameState, squad: Soldier[]): HTMLElement {
  const status = synergyStatus(squad.map((s) => weaponForSoldier(s, st.weapons)));
  const active = status.filter((s) => s.active);
  return h(
    'div',
    { class: 'prep-block' },
    h('h4', null, 'Synergies ', h('span', { class: 'muted small' }, `${active.length} active${active.length > 1 ? 's' : ''}`)),
    h(
      'div',
      { class: 'synergies' },
      status.map((s) =>
        h(
          'div',
          { class: `synergy${s.active ? ' active' : ''}`, title: s.def.desc },
          h('span', { class: 'synergy-icon' }, s.def.icon),
          h('span', { class: 'synergy-body' }, h('b', null, s.def.name), h('small', null, s.def.desc)),
          h('span', { class: 'synergy-count' }, `${Math.min(s.have, s.def.need)}/${s.def.need}`),
        ),
      ),
    ),
  );
}

export function renderCombat(): HTMLElement {
  const st = getState();
  pruneSelection(st);
  const nextLevel = st.campaignLevel + 1;
  const level = Math.min(campaignPick ?? nextLevel, nextLevel);
  const max = squadMax(st);

  const dailyReady = isUnlocked(st, 'daily') && !dailyDone(st);
  const tabs = h(
    'div',
    { class: 'mode-tabs' },
    MODES.map((m) => {
      const lock = MODE_UNLOCK[m.id];
      const isLocked = !!lock && !isUnlocked(st, lock);
      const status =
        isLocked ? `Niv. ${unlockLevel(lock!)}`
        : m.id === 'campaign' ? `Niveau ${nextLevel}`
        : m.id === 'daily' ? (dailyDone(st) ? 'Fait' : 'Disponible')
        : m.id === 'survival' ? (st.survival ? `Vague ${st.survival.wave + 1}` : `Record ${st.bestWave}`)
        : m.id === 'training' ? 'Sans risque'
        : 'Sans conséquence';
      return h(
        'button',
        { class: `mode-tab${mode === m.id ? ' active' : ''}${isLocked ? ' locked' : ''}`, onclick: () => { mode = m.id; refresh(); } },
        h('span', { class: 'mode-icon' }, isLocked ? '🔒' : m.icon),
        h('span', { class: 'mode-text' }, h('b', null, m.label), h('small', null, status)),
        m.id === 'daily' && dailyReady && h('span', { class: 'badge' }, '!'),
      );
    }),
  );

  const lockId = locked(st);
  const info =
    lockId === 'daily' ? lockedInfo(lockId, '📅', 'Défi du jour', 'Un combat unique par jour, avec une règle spéciale (horde, commando d’élite, deux boss…) et de grosses récompenses : or, tirage gratuit et arme de boss.')
    : lockId === 'survival' ? lockedInfo(lockId, '🔥', 'Survie', 'Enchaînez les vagues avec les mêmes soldats, sans soin complet entre deux vagues : encaissez vos gains ou risquez tout.')
    : lockId === 'simulation' ? lockedInfo(lockId, '🧪', 'Simulation', 'Testez votre escouade sans aucun risque face aux adversaires de votre choix, et estimez ses chances.')
    : mode === 'training' ? trainingInfo(st)
    : mode === 'simulation' ? simulationInfo(st)
    : mode === 'daily' ? dailyInfo(st)
    : mode === 'survival' ? survivalInfo(st)
    : campaignInfo(st, level);

  const runActive = mode === 'survival' && !!st.survival;
  const runSquad = runActive ? st.survival!.squad.map((id) => st.soldiers.find((s) => s.id === id)).filter((s): s is Soldier => !!s) : [];
  const picked = runActive ? runSquad : [...selected].map((id) => st.soldiers.find((s) => s.id === id)).filter((s): s is Soldier => !!s);
  const unarmed = picked.filter((s) => !s.weaponUid);
  const fee = mode === 'training' ? trainingFee(picked) : 0;
  const broke = st.gold < fee;
  const blocked = !!lockId || (mode === 'daily' && dailyDone(st));
  const canLaunch = !blocked && !broke && (runActive ? runSquad.length > 0 : selected.size >= 1);

  const prep =
    !lockId &&
    h(
      'div',
      { class: 'panel prep' },
      h(
        'div',
        { class: 'panel-head' },
        h('h3', null, runActive ? `🪖 Expédition (${runSquad.length})` : `🪖 Escouade engagée : ${selected.size} / ${max}`),
        !runActive &&
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn btn-small', onclick: () => { autoSelect(st); refresh(); }, title: 'Prendre les meilleurs soldats selon le tri choisi' }, '✨ Auto'),
            h('button', { class: 'btn btn-small btn-ghost', disabled: selected.size === 0, onclick: () => { selected.clear(); refresh(); } }, 'Vider'),
          ),
      ),
      slots(st, picked, runActive),
      unarmed.length > 0 &&
        h(
          'p',
          { class: 'note note-warn small' },
          'À mains nues : ',
          unarmed.map((s, i) => [i > 0 && ', ', h('button', { class: 'link', title: 'Ouvrir la fiche pour équiper une arme', onclick: () => openSoldier(s.id) }, s.name)]),
          '.',
        ),
      fee > 0 && h('p', { class: `note small${broke ? ' note-bad' : ''}` }, `Entraînement payant (${picked.filter(paidTraining).map((s) => s.name).join(', ')}) : ${fmt(fee)} or${broke ? ` — il manque ${fmt(fee - st.gold)} or` : ''}.`),
      h('div', { class: 'prep-grid' }, tacticPicker(st), synergyPanel(st, picked)),
    );

  const picker =
    !lockId &&
    !runActive &&
    h(
      'div',
      { class: 'picker' },
      h('h3', { class: 'section-title' }, 'Choisir les soldats'),
      st.soldiers.length === 0
        ? h('div', { class: 'panel empty' }, h('p', null, "Vous n'avez aucun soldat."), h('button', { class: 'btn btn-primary', onclick: () => goTo('recruit') }, 'Recruter des soldats'))
        : [
            squadToolbar(st),
            squadView(st, (s) => ({
              selected: selected.has(s.id),
              disabled: !eligible(s),
              disabledReason: `${s.name} est au niveau maximum et n'a plus d'entraînement gratuit.`,
              cost: paidTraining(s) ? { text: `🎯 ${fmt(trainingCost(s))} or`, title: `Entraînements gratuits épuisés : engager ${s.name} coûte ${fmt(trainingCost(s))} or, payés au lancement.` } : undefined,
              onclick: () => toggleSoldier(st, s),
            })),
          ],
      mode === 'training' &&
        st.soldiers.length > 0 &&
        st.soldiers.every((s) => s.trainingsLeft <= 0) &&
        h('p', { class: 'note note-warn' }, 'Plus aucun entraînement gratuit : sélectionnez des soldats pour un entraînement payant, ou partez en campagne. ', h('button', { class: 'link', onclick: () => { mode = 'campaign'; refresh(); } }, 'Passer à la campagne')),
    );

  const label =
    mode === 'training' ? `Lancer l'entraînement${feeLabel(fee)}`
    : mode === 'simulation' ? 'Lancer la simulation'
    : mode === 'daily' ? 'Relever le défi'
    : mode === 'survival' ? (st.survival ? `Lancer la vague ${st.survival.wave + 1}` : 'Partir en expédition')
    : `Lancer le niveau ${level}`;
  const launchBtn = h(
    'button',
    { class: 'btn btn-big btn-primary', disabled: !canLaunch, onclick: launch, title: canLaunch ? 'Lancer le combat' : undefined },
    canLaunch ? `⚔ ${label}`
    : mode === 'daily' && dailyDone(st) ? 'Revenez demain'
    : runActive ? "Plus aucun soldat dans l'expédition"
    : broke ? `Il manque ${fmt(fee - st.gold)} or`
    : 'Sélectionnez au moins un soldat',
  );
  const quickPick = !canLaunch && !blocked && !broke && !runActive && st.soldiers.some(autoEligible) && h('button', { class: 'btn btn-big', onclick: () => { autoSelect(st); refresh(); } }, '✨ Sélection auto');
  const est = canLaunch && mode !== 'simulation' ? currentBattleEstimate(st, battleRequest(st, level)) : null;

  return h(
    'section',
    { class: 'combat' },
    tabs,
    h('div', { class: 'combat-cols' }, info, prep),
    picker,
    !lockId && h('div', { class: 'launch-bar' }, est ? estimateLine(est) : h('span', { class: 'muted small' }, mode === 'simulation' ? 'Simulation : aucune perte réelle.' : 'Sélectionnez votre escouade pour voir vos chances.'), h('div', { class: 'launch-buttons' }, quickPick, launchBtn)),
  );
}
