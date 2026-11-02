import { getState, mutate, parseSave, replaceState, resetState, serializeState } from '../game/state';
import { BATTLE_SPEEDS } from '../game/types';
import { h } from './dom';
import { confirmDialog, toast } from './components';

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
    void confirmDialog({ title: 'Importer cette sauvegarde ?', body: 'La partie actuelle sera remplacée. Pensez à l’exporter avant si vous voulez la garder.', confirm: 'Importer', danger: true }).then((ok) => {
      if (!ok) return;
      replaceState(data);
      toast('Sauvegarde importée.', 'good');
    });
  });
}

async function newGame(): Promise<void> {
  const ok = await confirmDialog({ title: 'Nouvelle partie ?', body: 'Toute la progression sera effacée définitivement : soldats, armes, or et campagne.', confirm: 'Tout effacer', danger: true });
  if (!ok) return;
  resetState();
  toast('Nouvelle partie.');
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
    h('h2', { class: 'section-title' }, 'Affichage'),
    h(
      'div',
      { class: 'panel' },
      h(
        'label',
        { class: 'sim-check row' },
        h('input', { type: 'checkbox', checked: !st.hideGuide, onchange: (e) => mutate((g) => { g.hideGuide = !(e.target as HTMLInputElement).checked; }) }),
        ' Afficher le guide « prochaine étape » en haut de l’écran',
      ),
    ),
    h('h2', { class: 'section-title' }, 'Statistiques'),
    h(
      'div',
      { class: 'panel' },
      h('p', null, `Victoires : ${st.stats.won} · Défaites : ${st.stats.lost} · Soldats tombés : ${st.stats.deaths} · Ennemis éliminés : ${st.stats.kills}`),
      h('p', null, `Tirages effectués : ${st.totalPulls} · Campagne : niveau ${st.campaignLevel} terminé`),
      h('p', null, `Série de défis du jour : ${st.dailyStreak} · Record en survie : vague ${st.bestWave}`),
    ),
    h('h2', { class: 'section-title' }, 'Combat'),
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
    h('h2', { class: 'section-title' }, 'Sauvegarde'),
    h(
      'div',
      { class: 'panel' },
      h('p', { class: 'muted' }, "La partie est enregistrée automatiquement dans ce navigateur. Exportez-la pour la sauvegarder ou la transférer ailleurs."),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: exportSave }, 'Exporter'),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Importer'),
        h('button', { class: 'btn btn-danger', onclick: () => void newGame() }, 'Nouvelle partie'),
        fileInput,
      ),
    ),
  );
}
