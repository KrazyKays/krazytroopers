import { AUTO_PICK_KILLS, MAX_LEVEL, MAX_UPGRADES, PICK_EVERY_LEVELS, PITY_LIMIT, PULL_COST, SQUAD_MAX, START_FREE_PULLS, TRAINING_PER_SOLDIER, UPGRADE_PICKS } from '../game/data';
import { getState, mutate, parseSave, replaceState, resetState, serializeState } from '../game/state';
import { BATTLE_SPEEDS } from '../game/types';
import { h } from './dom';
import { toast } from './components';

function exportSave(): void {
  const blob = new Blob([serializeState()], { type: 'application/json' });
  const a = h('a', { class: '' });
  a.href = URL.createObjectURL(blob);
  a.download = `krazy-troopers-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importSave(file: File): void {
  file.text().then((raw) => {
    const data = parseSave(raw);
    if (!data) {
      toast('Fichier de sauvegarde invalide.', 'bad');
      return;
    }
    if (!confirm('Remplacer la partie actuelle par cette sauvegarde ?')) return;
    replaceState(data);
    toast('Sauvegarde importée.', 'good');
  });
}

export function renderSettings(): HTMLElement {
  const st = getState();
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) importSave(f);
  } });
  return h(
    'section',
    null,
    h('h2', null, 'Règles du jeu'),
    h(
      'div',
      { class: 'panel' },
      h(
        'ul',
        { class: 'rules' },
        h('li', null, h('b', null, 'Recruter : '), `tirez des soldats au hasard (${PULL_COST} or). Chaque nouveau joueur commence avec ${START_FREE_PULLS} tirages gratuits. Un soldat Épique ou mieux est garanti tous les ${PITY_LIMIT} tirages.`),
        h('li', null, h('b', null, 'Améliorer : '), `chaque recrue propose ${UPGRADE_PICKS} fois de suite 3 améliorations, puis une nouvelle fois tous les ${PICK_EVERY_LEVELS} niveaux, dans la limite de ${MAX_UPGRADES} améliorations : à vous d'en choisir une à chaque fois.`),
        h('li', null, h('b', null, 'Choix automatique : '), `une fois ${AUTO_PICK_KILLS} ennemis éliminés au total, vous pouvez choisir au hasard toutes les améliorations en attente de toute l'escouade, pour gagner du temps quand elle grandit.`),
        h(
          'li',
          null,
          h('b', null, "Légion d'honneur : "),
          `au niveau ${MAX_LEVEL}, un soldat devient Légende et ne gagne plus d'amélioration. Vous pouvez alors lui accorder la Légion d'honneur : vous retirez les améliorations de votre choix (facultatif), puis il repart au niveau 1 avec son XP remis à zéro. Ses statistiques de base repartent donc de zéro, mais il garde son titre Légende et les améliorations que vous n'avez pas retirées. Il propose alors 3 améliorations de Légende, bien plus puissantes, et gagne ${TRAINING_PER_SOLDIER} entraînements supplémentaires. Chaque amélioration conservée est une amélioration de moins à choisir en remontant. Vous pouvez accorder la Légion plusieurs fois au même soldat, à chaque fois qu'il atteint le niveau ${MAX_LEVEL}.`,
        ),
        h('li', null, h('b', null, "S'entraîner : "), `chaque soldat peut participer à ${TRAINING_PER_SOLDIER} combats d'entraînement dans sa vie pour gagner de l'expérience.`),
        h('li', null, h('b', null, 'Campagne : '), `engagez jusqu'à ${SQUAD_MAX} soldats niveau après niveau face à toujours plus d'ennemis. Récompenses : armes, XP et or. Un boss vous attend tous les 5 niveaux.`),
        h('li', null, h('b', null, 'Danger : '), "un soldat qui meurt dans un combat (entraînement ou campagne) est mort définitivement : il quitte l'escouade."),
        h('li', null, h('b', null, 'Équiper : '), "donnez à chaque soldat l'arme qui lui convient ; les armes à zone ou à longue portée changent tout."),
      ),
    ),
    h('h2', null, 'Statistiques'),
    h(
      'div',
      { class: 'panel' },
      h('p', null, `Victoires : ${st.stats.won} · Défaites : ${st.stats.lost} · Soldats tombés : ${st.stats.deaths} · Ennemis éliminés : ${st.stats.kills}`),
      h('p', null, `Tirages effectués : ${st.totalPulls} · Campagne : niveau ${st.campaignLevel} terminé`),
    ),
    h('h2', null, 'Combat'),
    h(
      'div',
      { class: 'panel' },
      h('p', { class: 'muted' }, 'Vitesse de combat par défaut. Elle peut toujours être modifiée pendant un combat.'),
      h(
        'div',
        { class: 'row' },
        BATTLE_SPEEDS.map((s) =>
          h(
            'button',
            {
              class: `btn btn-small${st.battleSpeed === s ? ' active' : ''}`,
              onclick: () => mutate((g) => { g.battleSpeed = s; }),
            },
            `x${s}`,
          ),
        ),
      ),
    ),
    h('h2', null, 'Sauvegarde'),
    h(
      'div',
      { class: 'panel' },
      h('p', { class: 'muted' }, "La partie est enregistrée automatiquement dans ce navigateur. Exportez-la pour la sauvegarder ou la transférer ailleurs."),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: exportSave }, 'Exporter'),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Importer'),
        h('button', { class: 'btn btn-danger', onclick: () => { if (confirm('Effacer définitivement la partie ?')) { resetState(); toast('Nouvelle partie.'); } } }, 'Nouvelle partie'),
        fileInput,
      ),
    ),
  );
}
