import { PITY_LIMIT, PULL_COST, SQUAD_MAX, TRAINING_PER_DAY, UPGRADE_PICKS } from '../game/data';
import { getState, parseSave, replaceState, resetState, serializeState } from '../game/state';
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
        h('li', null, h('b', null, 'Recruter : '), `tirez des soldats au hasard (${PULL_COST} or, ou 1 tirage gratuit par jour). Un soldat Épique ou mieux est garanti tous les ${PITY_LIMIT} tirages.`),
        h('li', null, h('b', null, 'Améliorer : '), `chaque recrue propose ${UPGRADE_PICKS} fois de suite 3 améliorations : à vous d'en choisir une à chaque fois.`),
        h('li', null, h('b', null, "S'entraîner : "), `${TRAINING_PER_DAY} combats d'entraînement par jour pour gagner de l'expérience.`),
        h('li', null, h('b', null, 'Campagne : '), `engagez jusqu'à ${SQUAD_MAX} soldats niveau après niveau face à toujours plus d'ennemis. Récompenses : armes, XP et or. Un boss vous attend tous les 5 niveaux.`),
        h('li', null, h('b', null, 'Danger : '), "un soldat qui meurt dans un combat (entraînement ou campagne) est indisponible jusqu'au lendemain (minuit, heure locale)."),
        h('li', null, h('b', null, 'Équiper : '), "donnez à chaque soldat l'arme qui lui convient ; les armes à zone ou à longue portée changent tout."),
      ),
    ),
    h('h2', null, 'Statistiques'),
    h(
      'div',
      { class: 'panel' },
      h('p', null, `Victoires : ${st.stats.won} · Défaites : ${st.stats.lost} · Soldats tombés : ${st.stats.deaths}`),
      h('p', null, `Tirages effectués : ${st.totalPulls} · Campagne : niveau ${st.campaignLevel} terminé`),
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
