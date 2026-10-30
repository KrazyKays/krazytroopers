import { FORGE_INPUT, STAR_CHEST_EVERY, MAX_LEVEL, MAX_UPGRADES, PITY_LIMIT, PULL_COST, START_FREE_PULLS, SURVIVAL_REST_HEAL, TRAINING_PER_SOLDIER, UNLOCKS, PICK_LEVELS, LEGION_PICKS } from '../game/data';
import { squadMax } from '../game/progress';
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
    h('h2', { class: 'section-title' }, 'Règles du jeu'),
    h(
      'div',
      { class: 'panel' },
      h(
        'p',
        null,
        'La boucle de jeu : ',
        h('b', null, 'recrutez'),
        ' des soldats, ',
        h('b', null, 'choisissez leurs améliorations'),
        ' et ',
        h('b', null, 'équipez-les'),
        ', puis ',
        h('b', null, 'combattez'),
        " pour gagner XP, or et armes. Attention : un soldat tombé au combat est perdu pour toujours.",
      ),
      h(
        'label',
        { class: 'sim-check row' },
        h('input', { type: 'checkbox', checked: !st.hideGuide, onchange: (e) => mutate((g) => { g.hideGuide = !(e.target as HTMLInputElement).checked; }) }),
        ' Afficher le guide « prochaine étape » en haut de l’écran',
      ),
    ),
    h(
      'details',
      { class: 'panel rules-details' },
      h('summary', null, 'Règles détaillées'),
      h(
        'ul',
        { class: 'rules' },
        h('li', null, h('b', null, 'Recruter : '), `tirez des soldats au hasard (${PULL_COST} or). Chaque nouveau joueur commence avec ${START_FREE_PULLS} tirages gratuits. Un soldat Épique ou mieux est garanti tous les ${PITY_LIMIT} tirages.`),
        h('li', null, h('b', null, 'Améliorer : '), `chaque soldat gagne un emplacement d'amélioration à son arrivée puis aux niveaux ${PICK_LEVELS.slice(1).join(', ')} (${MAX_UPGRADES} au total). À chaque fois, choisissez parmi 3 propositions : l'aperçu montre l'effet exact sur ses statistiques et la proposition « Conseillée » est celle qui le renforce le plus avec son arme. Certaines améliorations ont plusieurs rangs et peuvent être reprises. Les propositions peuvent être relancées contre un peu d'or.`),
        h('li', null, h('b', null, 'Choix automatique : '), "au niveau 10 de la campagne, appliquez en un clic l'amélioration conseillée à toute l'escouade."),
        h('li', null, h('b', null, 'Caserne : '), "le nombre de soldats est limité au début et grandit avec la campagne : prenez le temps de découvrir chaque mécanique avant de gérer une grande armée."),
        h('li', null, h('b', null, 'Butin : '), "chaque victoire de campagne remplit la jauge de butin (2 crans pour une première victoire, 1 pour un niveau rejoué) ; une arme tombe tous les 4 crans. La première victoire contre un boss garantit une arme de meilleure rareté."),
        h(
          'li',
          null,
          h('b', null, "Légion d'honneur : "),
          `au niveau ${MAX_LEVEL}, un soldat devient Légende et ne gagne plus d'amélioration. Vous pouvez alors lui accorder la Légion d'honneur : vous retirez les améliorations de votre choix (facultatif), puis il repart au niveau 1 avec son XP remis à zéro. Il garde son titre Légende et les améliorations non retirées, gagne ${LEGION_PICKS} emplacements d'amélioration supplémentaires (regagnés en remontant les paliers), des propositions de Légende bien plus puissantes et ${TRAINING_PER_SOLDIER} entraînements gratuits. Vous pouvez accorder la Légion plusieurs fois au même soldat, à chaque fois qu'il atteint le niveau ${MAX_LEVEL}.`,
        ),
        h('li', null, h('b', null, "S'entraîner : "), `chaque soldat dispose de ${TRAINING_PER_SOLDIER} combats d'entraînement, sans danger, pour gagner de l'expérience. Ensuite, vous pouvez encore l'engager en payant son entraînement au lancement, selon son niveau.`),
        h('li', null, h('b', null, 'Campagne : '), `engagez jusqu'à ${squadMax(st)} soldats niveau après niveau face à toujours plus d'ennemis. Récompenses : armes, XP et or. Un boss vous attend tous les 5 niveaux : sa première victoire offre une meilleure arme et un tirage gratuit.`),
        h('li', null, h('b', null, 'Danger : '), "en cas de victoire, les soldats tombés sont rapatriés (sans XP). En cas de défaite, ils meurent définitivement et quittent l'escouade. L'entraînement n'est jamais mortel."),
        h('li', null, h('b', null, 'Équiper : '), "donnez à chaque soldat l'arme qui lui convient. Les armes de mêlée ont des bonus de survie (vol de vie, esquive, armure), le Fusil médical soigne vos troupes, et les armes à zone ou à longue portée changent tout."),
        h('li', null, h('b', null, 'Tactiques : '), "dès le niveau 3 de la campagne, choisissez avant chaque combat la tactique de l'escouade : Assaut (rapide et agressif), Rempart (armure et PV), Chasse aux blessés (achève les cibles affaiblies) ou Équilibrée."),
        h('li', null, h('b', null, 'Synergies : '), "chaque arme appartient à une famille (mêlée, tir, précision, explosif, bouclier, soin). Réunir plusieurs armes d'une même famille, ou 4 familles différentes, active des bonus d'escouade. Composez votre équipe en conséquence !"),
        h('li', null, h('b', null, 'Élites : '), "à partir du niveau 4, certains ennemis sont des élites dotées d'un affixe (Blindé, Enragé, Véloce, Vampire, Régénérant). Ils sont annoncés dans le briefing : adaptez-vous."),
        h('li', null, h('b', null, 'Étoiles : '), `chaque victoire de campagne vaut 1 à 3 étoiles selon vos pertes (3 sans aucun soldat tombé). Chaque nouvelle étoile rapporte de l'or, et toutes les ${STAR_CHEST_EVERY} étoiles un coffre offre un tirage gratuit : rejouez les anciens niveaux pour les décrocher.`),
        h('li', null, h('b', null, 'Objectifs : '), 'des défis à long terme, visibles au QG, dont la récompense (or ou tirages gratuits) se réclame une fois atteints.'),
        h('li', null, h('b', null, 'Forge : '), `fusionnez ${FORGE_INPUT} armes non équipées d'une même rareté en une arme de la rareté supérieure, contre un peu d'or.`),
        h('li', null, h('b', null, 'Défi du jour : '), "une tentative par jour face à une armée à règle spéciale. Les victoires consécutives augmentent la récompense."),
        h('li', null, h('b', null, 'Survie : '), `enchaînez les vagues avec les mêmes soldats, qui ne récupèrent que ${Math.round(SURVIVAL_REST_HEAL * 100)} % de leurs PV entre deux vagues. Encaissez le pot quand vous voulez ; une défaite n'en laisse que la moitié.`),
      ),
    ),
    h('h2', { class: 'section-title' }, 'Progression'),
    h(
      'div',
      { class: 'panel' },
      h('p', { class: 'muted' }, 'Chaque palier de la campagne débloque une nouvelle fonctionnalité.'),
      h(
        'ul',
        { class: 'unlock-list' },
        UNLOCKS.map((u) => {
          const done = st.campaignLevel >= u.level;
          return h('li', { class: done ? 'unlocked' : 'locked' }, h('span', { class: 'unlock-level' }, done ? '✓' : `Niv. ${u.level}`), h('b', null, u.label), h('span', { class: 'muted small' }, u.desc));
        }),
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
