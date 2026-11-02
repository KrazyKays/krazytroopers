import { BOSS_EVERY, campaignEnemyCount, DAILY_MODIFIERS, ELITE_AFFIXES, eliteCount, ENEMY_TEMPLATES } from '../game/enemies';
import {
  BARRACKS,
  BOSS_FREE_PULLS,
  COLOSSUS_HP,
  COLOSSUS_HP_PER_RANK,
  COLOSSUS_PULLS,
  DAILY_PULL_EVERY,
  FORGE_FEE,
  FORGE_INPUT,
  LEGEND_UPGRADES,
  LEGION_PICKS,
  LOOT_FIRST_CLEAR,
  LOOT_METER_MAX,
  LOOT_REPLAY,
  MAX_LEVEL,
  MAX_UPGRADES,
  PICK_LEVELS,
  PITY_LIMIT,
  PULL10_COST,
  PULL_COST,
  RARITIES,
  RARITY_ORDER,
  SQUAD_BASE,
  STAR_CHEST_EVERY,
  START_FREE_PULLS,
  SURVIVAL_REST_HEAL,
  TRAINING_PER_SOLDIER,
  UNLOCKS,
  UPGRADE_CHOICES,
  UPGRADE_KINDS,
  UPGRADES,
  WEAPONS,
  WEAPON_PULL10_COST,
  WEAPON_PULL_COST,
  WEAPONS_BY_ID,
} from '../game/data';
import { unlockLevel } from '../game/progress';
import { FAMILY_LABELS, SYNERGIES, TACTICS, weaponFamily } from '../game/squad';
import { getState } from '../game/state';
import { BASE_HP, BASE_SPEED } from '../game/stats';
import type { GameState, UpgradeDef } from '../game/types';
import { fmt, weaponTraits } from './components';
import { h, type Child } from './dom';

interface Article {
  title: string;
  body: Child[];
}

interface Section {
  id: string;
  icon: string;
  label: string;
  articles: Article[];
}

const p = (...children: Child[]) => h('p', null, ...children);
const b = (text: string) => h('b', null, text);
const list = (...items: Child[]) => h('ul', { class: 'rules' }, items.map((i) => h('li', null, i)));

function table(headers: string[], rows: Child[][]): HTMLElement {
  return h('div', { class: 'wiki-table' }, h('table', { class: 'stats-table' }, h('tr', null, headers.map((t) => h('th', null, t))), rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))));
}

function weaponRows(): Child[][] {
  const order = (id: string) => RARITY_ORDER.indexOf(WEAPONS_BY_ID[id].rarity);
  return WEAPONS.filter((w) => w.droppable)
    .sort((x, y) => order(x.id) - order(y.id))
    .map((w) => {
      const family = weaponFamily(w);
      const traits = [...weaponTraits(w), w.armor && `Armure +${w.armor}`].filter(Boolean).join(', ');
      return [
        w.name,
        h('span', { style: `color:${RARITIES[w.rarity].color};font-weight:700` }, RARITIES[w.rarity].label),
        family ? FAMILY_LABELS[family] : '—',
        fmt(w.damage / w.cooldown, 1),
        fmt(w.range),
        w.aoe ? fmt(w.aoe) : '—',
        traits || '—',
      ];
    });
}

const upgradeRows = (upgrades: UpgradeDef[]): Child[][] => upgrades.map((u) => [u.name, `${UPGRADE_KINDS[u.kind].icon} ${UPGRADE_KINDS[u.kind].label}`, String(u.maxRank ?? 1), u.desc]);

// Le texte reprend les constantes du jeu dès que possible : un rééquilibrage met ainsi le wiki à jour
function sections(st: GameState): Section[] {
  return [
    {
      id: 'faq',
      icon: '❓',
      label: 'FAQ',
      articles: [
        {
          title: 'Le Fusil médical avec Soif de sang soigne-t-il aussi le lanceur ?',
          body: [
            p(b('Non. '), 'Quand il soigne un allié, seule la cible regagne des PV : le vol de vie (Soif de sang, Sang de vampire) ne se déclenche que sur les ', b('dégâts infligés'), ', et un soin n’en est pas un.'),
            p('Il ne sert que lorsque personne n’a besoin de soins : le soldat tire alors sur l’ennemi et récupère une part des dégâts de ces tirs. Le soigneur peut par ailleurs se soigner lui-même avec son fusil, s’il est l’allié le plus blessé.'),
          ],
        },
        {
          title: 'Quelles améliorations choisir pour un Fusil médical ?',
          body: [
            list(
              [b('Utiles : '), 'Force brute et Canon de verre (soins plus forts), Doigts agiles (soins plus fréquents), Œil de lynx (un critique double le soin), Lunette (plus de portée).'],
              [b('Limitées aux tirs sur l’ennemi : '), 'Soif de sang et Rage. Elles n’augmentent jamais les soins, et la mention « Conseillée » ne les valorise donc pas sur un soigneur.'],
              [b('Sans effet : '), 'Munitions explosives : un soigneur ne fait jamais de dégâts de zone.'],
            ),
          ],
        },
        {
          title: 'Les coups critiques des soigneurs soignent-ils deux fois plus ?',
          body: [p(b('Oui. '), 'Un soin a les mêmes chances d’être critique qu’un tir et rend alors deux fois plus de PV, sans dépasser les PV max de la cible. Œil de lynx augmente donc aussi les soins.')],
        },
        {
          title: 'Les dégâts de zone s’appliquent-ils aux soins du Fusil médical ?',
          body: [p(b('Non. '), 'Chaque soin ne rend des PV qu’à un seul allié, le plus blessé. Le rayon de zone d’un soigneur reste toujours à 0, même avec Munitions explosives ou un bonus de rayon : ses tirs sur l’ennemi ne font donc pas non plus de dégâts de zone.')],
        },
        {
          title: 'Un soldat tombé au combat est-il perdu ?',
          body: [
            list(
              [b('Victoire : '), 'il est rapatrié, sans XP.'],
              [b('Défaite ou temps écoulé : '), 'il meurt définitivement, en campagne, au défi du jour comme en survie.'],
              [b('Entraînement et simulation : '), 'il ne risque rien.'],
              [b('Chair à canon : '), 'tout soldat engagé est perdu, même en cas de victoire.'],
            ),
          ],
        },
        {
          title: 'Que devient l’arme d’un soldat mort ou renvoyé ?',
          body: [p('Elle reste dans votre arsenal : seul le soldat disparaît. Seule exception : un soldat sacrifié en Chair à canon perd son arme avec lui.')],
        },
        {
          title: 'Que se passe-t-il si le combat dure trop longtemps ?',
          body: [p('Un combat s’arrête après 120 secondes de jeu. Sans vainqueur, il compte comme une défaite : les soldats déjà tombés meurent, les autres survivent et gagnent l’XP réduite d’une défaite.')],
        },
        {
          title: 'Le vol de vie fonctionne-t-il sur les dégâts de zone ?',
          body: [p('Non : il ne compte que les dégâts réellement infligés à la cible principale, après réduction par son armure. Les dégâts de zone autour d’elle ne soignent pas.')],
        },
        {
          title: 'Changer d’arme fait-il perdre les améliorations ?',
          body: [p('Non : les améliorations appartiennent au soldat et changer d’arme est gratuit. Si l’arme choisie est déjà portée par un autre soldat, les deux échangent leurs armes.')],
        },
        {
          title: 'Un défi du jour perdu peut-il être retenté ?',
          body: [p('Non : une seule tentative par jour, gagnée ou perdue, et une défaite remet la série de victoires à zéro. Comme en campagne, une défaite tue les soldats tombés.')],
        },
        {
          title: 'Dernier souffle fonctionne-t-il à chaque vague de survie ?',
          body: [p('Oui : il agit une fois par combat, et chaque vague est un nouveau combat.')],
        },
        {
          title: 'Comment obtenir des tirages gratuits ?',
          body: [list(`${START_FREE_PULLS} au début de la partie.`, `Première victoire contre un boss : ${BOSS_FREE_PULLS} tirage.`, `Défi du jour : 1 tirage toutes les ${DAILY_PULL_EVERY} victoires d’affilée.`, `Coffre d’étoiles : 1 tirage toutes les ${STAR_CHEST_EVERY} étoiles.`, `Mort du Colosse (Chair à canon) : ${COLOSSUS_PULLS} tirages.`, 'Certains objectifs du QG.')],
        },
        {
          title: 'Que faire des soldats en trop ?',
          body: [p('Renvoyez-les contre un peu d’or, ou sacrifiez-les en Chair à canon : pas d’or, mais la garantie de recrutement avance et le Colosse se rapproche de la mort. Dans les deux cas, une place se libère en caserne. Marquez vos soldats précieux comme favoris : ils ne peuvent pas être sacrifiés. Attention, un soldat sacrifié perd aussi son arme : déséquipez celle que vous voulez garder.')],
        },
        {
          title: 'Comment obtenir des armes ?',
          body: [list(`Jauge de butin de la campagne : une arme tous les ${LOOT_METER_MAX} crans.`, 'Première victoire contre un boss : arme de rareté améliorée.', 'Victoire au défi du jour : arme de rareté améliorée.', `Survie : arme de rareté améliorée toutes les ${BOSS_EVERY} vagues.`, `Armurerie, après le niveau ${unlockLevel('armory')} de la campagne.`, `Forge, après le niveau ${unlockLevel('forge')} de la campagne.`)],
        },
        {
          title: 'Pourquoi rejouer d’anciens niveaux ?',
          body: [p('Pour décrocher les étoiles manquantes, remplir la jauge de butin et gagner de l’or et de l’XP. Un niveau rejoué rapporte toutefois moins d’or et deux fois moins d’XP que sa première victoire, et une défaite y reste mortelle.')],
        },
      ],
    },
    {
      id: 'combat',
      icon: '⚔️',
      label: 'Combat',
      articles: [
        {
          title: 'Déroulement d’un combat',
          body: [p('Les combats se jouent seuls : chaque soldat avance vers l’ennemi le plus proche et frappe dès qu’il est à portée. Vos choix se font avant : escouade, armes, améliorations et tactique. La Chasse aux blessés change la cible : l’ennemi à portée qui a le moins de PV en proportion.')],
        },
        {
          title: 'Calcul des dégâts',
          body: [
            list(
              [b('Base : '), 'dégâts du soldat, avec une variation de ±10 % à chaque coup.'],
              [b('Rage : '), '×1,4 sous 50 % des PV.'],
              [b('Critique : '), '×2.'],
              [b('Armure : '), 'dégâts reçus × 100 / (100 + armure). Par exemple, 50 d’armure retirent un tiers des dégâts.'],
              [b('Esquive : '), 'annule le coup direct, mais pas les dégâts de zone.'],
            ),
          ],
        },
        {
          title: 'Dégâts de zone',
          body: [p('Le coup principal touche la cible ; les autres ennemis dans le rayon autour d’elle subissent 60 % de ses dégâts, critique compris. Ces dégâts ne peuvent pas être esquivés, mais l’armure les réduit. Si la cible esquive, il n’y a pas d’explosion.')],
        },
        {
          title: 'Soins, vol de vie et régénération',
          body: [
            list(
              [b('Fusil médical : '), 'soigne l’allié vivant le plus blessé en proportion de ses PV, lui-même compris, s’il est sous 90 % de ses PV. Sinon, le soldat tire sur l’ennemi. Le soin dépend des dégâts du soldat, peut être critique et ignore l’armure.'],
              [b('Statistiques de fin de combat : '), 'les soins reçus comptent toutes les origines ; les soins donnés ne comptent que le fusil médical, y compris sur soi-même.'],
              [b('Vol de vie : '), 'rend au soldat une part des dégâts infligés à sa cible principale.'],
              [b('Régénération : '), 'rend chaque seconde un pourcentage des PV max.'],
              [b('Limites : '), 'les PV ne dépassent jamais le maximum, et aucun soin ne relève un soldat tombé.'],
            ),
          ],
        },
        {
          title: 'Plafonds des statistiques',
          body: [list('Critique : 5 % de base, 75 % au maximum.', 'Esquive : 3 % de base, 50 % au maximum.', 'Temps de recharge : améliorations limitées à −50 %, et jamais moins de 0,12 s.', 'Vitesse : jamais moins de 30.')],
        },
      ],
    },
    {
      id: 'soldiers',
      icon: '🪖',
      label: 'Soldats',
      articles: [
        {
          title: 'Rareté',
          body: [
            p('La rareté d’un soldat multiplie ses PV et ses dégâts. Celle d’une arme n’ajoute pas de multiplicateur : ses valeurs figurent dans la liste des armes.'),
            table(['Rareté', 'Multiplicateur', 'Taux', 'Renvoi'], RARITY_ORDER.map((r) => [RARITIES[r].label, `×${fmt(RARITIES[r].statMult, 2)}`, `${RARITIES[r].rate} %`, `${RARITIES[r].releaseValue} or`])),
            p(`Un soldat Épique ou mieux est garanti au plus tard au ${PITY_LIMIT}e tirage sans en avoir obtenu.`),
          ],
        },
        {
          title: 'Statistiques et niveaux',
          body: [p(`Base : ${BASE_HP} PV et une vitesse de ${BASE_SPEED}. Chaque soldat a un tirage individuel de ±10 % en PV, dégâts et vitesse. Chaque niveau ajoute 8 % de PV et de dégâts par rapport au niveau 1, sans changer la vitesse. Le niveau maximum est ${MAX_LEVEL}.`)],
        },
        {
          title: 'Expérience',
          body: [
            list(
              'Un soldat tombé ne gagne pas d’XP, même en cas de victoire.',
              'Défaite : 40 % de l’XP normale pour les survivants (50 % à l’entraînement).',
              'Niveau de campagne rejoué ou vague de survie : 50 % de l’XP d’un niveau équivalent.',
              `Entraînement : ${TRAINING_PER_SOLDIER} gratuits par soldat, puis payants selon son niveau.`,
            ),
          ],
        },
        {
          title: 'Améliorations',
          body: [p(`Un emplacement à l’arrivée, puis aux niveaux ${PICK_LEVELS.slice(1).join(', ')}, soit ${MAX_UPGRADES} au total. Choisissez parmi ${UPGRADE_CHOICES} propositions, relançables contre de l’or. Une amélioration à plusieurs rangs peut être reprise, et ses effets s’additionnent.`)],
        },
        {
          title: 'Légende et Légion d’honneur',
          body: [p(`Au niveau ${MAX_LEVEL}, un soldat devient Légende. Vous pouvez alors lui accorder la Légion d’honneur, autant de fois qu’il atteint ce niveau : il repart au niveau 1 et garde son titre ainsi que les améliorations que vous ne retirez pas. Il gagne ${LEGION_PICKS} emplacements supplémentaires, regagnés en remontant les paliers, ${TRAINING_PER_SOLDIER} entraînements gratuits et l’accès aux améliorations de Légende.`)],
        },
        {
          title: 'Caserne et escouade',
          body: [
            p(`La caserne limite le nombre de soldats que vous possédez ; ${SQUAD_BASE} d’entre eux peuvent combattre au début, et la campagne ajoute des places.`),
            table(['Campagne terminée', 'Places en caserne'], BARRACKS.map(([level, cap]) => [level ? `Niveau ${level}` : 'Départ', String(cap)])),
          ],
        },
      ],
    },
    {
      id: 'weapons',
      icon: '🧰',
      label: 'Armes',
      articles: [
        {
          title: 'Liste des armes',
          body: [p('Valeurs de base de l’arme, avant les bonus du soldat. Pour le Fusil médical, le DPS indique les soins par seconde. Sans arme, un soldat se bat avec ses Poings nus.'), table(['Arme', 'Rareté', 'Famille', 'DPS', 'Portée', 'Zone', 'Bonus'], weaponRows())],
        },
        {
          title: 'Mêlée ou distance ?',
          body: [p('Les armes de mêlée frappent plus fort et apportent des bonus de survie, mais leur porteur doit traverser le feu ennemi. Les boucliers apportent beaucoup d’armure et activent Couverture pour toute l’escouade.')],
        },
        {
          title: 'Acheter, vendre, forger',
          body: [
            list(
              `Armurerie : ${WEAPON_PULL_COST} or l’arme, ${WEAPON_PULL10_COST} or les 10, avec les mêmes taux que le recrutement et sa propre garantie.`,
              `Vente : ${RARITY_ORDER.map((r) => `${RARITIES[r].label} ${RARITIES[r].sellValue} or`).join(', ')}.`,
              `Forge : ${FORGE_INPUT} armes non équipées d’une même rareté donnent une arme au hasard de la rareté supérieure. Coût : ${(['common', 'rare', 'epic'] as const).map((r) => `${RARITIES[r].label} ${FORGE_FEE[r]} or`).join(', ')}. Les armes légendaires ne se fusionnent pas.`,
            ),
          ],
        },
      ],
    },
    {
      id: 'upgrades',
      icon: '✨',
      label: 'Améliorations',
      articles: [
        { title: 'Améliorations courantes', body: [table(['Nom', 'Type', 'Rangs', 'Effet'], upgradeRows(UPGRADES))] },
        { title: 'Améliorations de Légende', body: [p('Proposées aux soldats titrés Légende, à raison d’une au plus par série de propositions.'), table(['Nom', 'Type', 'Rangs', 'Effet'], upgradeRows(LEGEND_UPGRADES))] },
      ],
    },
    {
      id: 'squad',
      icon: '🎖️',
      label: 'Tactiques et synergies',
      articles: [
        {
          title: 'Tactiques',
          body: [p('Une seule tactique s’applique à toute l’escouade, dans tous les modes de combat.'), list(...TACTICS.map((t) => [b(`${t.icon} ${t.name} : `), t.desc]))],
        },
        {
          title: 'Synergies',
          body: [p('Elles dépendent des armes des soldats engagés dans le combat. Les Poings nus n’appartiennent à aucune famille.'), list(...SYNERGIES.map((s) => [b(`${s.icon} ${s.name} (${s.family ? `${s.need} ${FAMILY_LABELS[s.family]}` : `${s.need} familles`}) : `), s.desc]))],
        },
      ],
    },
    {
      id: 'enemies',
      icon: '👾',
      label: 'Ennemis',
      articles: [
        {
          title: 'Troupes',
          body: [p(`Un niveau de campagne compte de ${campaignEnemyCount(1)} à ${campaignEnemyCount(99)} ennemis, de plus en plus puissants.`), table(['Ennemi', 'Arme', 'Apparaît au niveau'], ENEMY_TEMPLATES.map((t) => [t.name, WEAPONS_BY_ID[t.weapon].name, String(t.minLevel)]))],
        },
        {
          title: 'Boss',
          body: [p(`Un boss mène l’armée tous les ${BOSS_EVERY} niveaux de campagne et toutes les ${BOSS_EVERY} vagues de survie.`)],
        },
        {
          title: 'Élites',
          body: [
            p(`Les élites apparaissent en campagne et en survie, à partir du niveau ${FIRST_ELITE_LEVEL} : leur nombre augmente ensuite d’un tous les 7 niveaux, jusqu’à ${eliteCount(99)}. Une élite a 25 % de PV en plus et un affixe, annoncé dans le briefing.`),
            list(...ELITE_AFFIXES.map((a) => [b(`${a.name} : `), a.desc])),
          ],
        },
      ],
    },
    {
      id: 'modes',
      icon: '🗺️',
      label: 'Modes de jeu',
      articles: [
        {
          title: 'Campagne',
          body: [p('Le mode principal, niveau après niveau : XP, or, butin et étoiles. Certains paliers débloquent de nouvelles fonctionnalités.')],
        },
        {
          title: 'Chair à canon',
          body: [
            p(`Envoyez des soldats contre le Colosse. Ses blessures se conservent d’un sacrifice à l’autre, et sa rage grandit pendant le combat. Il a ${fmt(COLOSSUS_HP)} PV au rang 1, puis ${Math.round(COLOSSUS_HP_PER_RANK * 100)} % de plus à chaque rang.`),
            list(
              [b('Coût : '), 'tous les soldats engagés sont perdus, même si le Colosse tombe. Leurs armes sont perdues avec eux. Ni or ni XP.'],
              [b('À chaque sacrifice : '), `la garantie de recrutement avance d’un cran par soldat (Commun), jusqu’à ${RARITY_ORDER.length} (Légendaire).`],
              [b('À sa mort : '), `${COLOSSUS_PULLS} tirages gratuits, et la prochaine recrue sera Épique ou mieux.`],
              [b('Protégés : '), 'les favoris et les soldats engagés dans une expédition de survie.'],
            ),
          ],
        },
        {
          title: 'Entraînement',
          body: [p(`Sans danger, face à des cibles affaiblies : personne n’y meurt. Chaque soldat a ${TRAINING_PER_SOLDIER} entraînements gratuits, puis paie selon son niveau au lancement du combat.`)],
        },
        {
          title: 'Simulation',
          body: [p('Testez votre escouade face aux adversaires de votre choix : ni récompense, ni perte.')],
        },
        {
          title: 'Défi du jour',
          body: [
            p(`Une tentative par jour, sans élite, avec une règle spéciale. Une victoire rapporte de l’or et une arme de rareté améliorée. Les jours consécutifs augmentent l’or, jusqu’à une semaine de série, et chaque série de ${DAILY_PULL_EVERY} victoires d’affilée offre 1 tirage gratuit.`),
            list(...DAILY_MODIFIERS.map((m) => [b(`${m.name} : `), m.desc])),
          ],
        },
        {
          title: 'Survie',
          body: [p(`Enchaînez les vagues avec les mêmes soldats, qui ne récupèrent que ${Math.round(SURVIVAL_REST_HEAL * 100)} % de leurs PV entre deux vagues. Les premières vagues sont plus faciles que votre niveau de campagne, puis chaque vague monte d’un niveau. Un soldat tombé lors d’une vague gagnée est rapatrié et quitte l’expédition. L’or s’accumule dans un pot : encaissez-le quand vous voulez, car une défaite n’en laisse que la moitié et tue les soldats tombés.`)],
        },
      ],
    },
    {
      id: 'progress',
      icon: '🚩',
      label: 'Progression',
      articles: [
        {
          title: 'Déblocages de la campagne',
          body: [
            h(
              'ul',
              { class: 'unlock-list' },
              UNLOCKS.map((u) => {
                const done = st.campaignLevel >= u.level;
                return h('li', { class: done ? 'unlocked' : 'locked' }, h('span', { class: 'unlock-level' }, done ? '✓' : `Niv. ${u.level}`), h('b', null, u.label), h('span', { class: 'muted small' }, u.desc));
              }),
            ),
          ],
        },
        {
          title: 'Recrutement',
          body: [p(`${PULL_COST} or le soldat, ${PULL10_COST} or les 10. Les tirages gratuits s’utilisent à l’unité. Il faut une place libre en caserne.`)],
        },
        {
          title: 'Butin',
          body: [p(`Chaque victoire de campagne remplit la jauge de butin : ${LOOT_FIRST_CLEAR} crans pour une première victoire, ${LOOT_REPLAY} pour un niveau rejoué. Une arme tombe à ${LOOT_METER_MAX} crans. La première victoire contre un boss garantit à la place une arme de rareté améliorée.`)],
        },
        {
          title: 'Étoiles',
          body: [p(`Une victoire de campagne vaut 3 étoiles sans soldat tombé, 2 si au plus la moitié de l’escouade est tombée, 1 sinon. Chaque nouvelle étoile rapporte de l’or, et un coffre offre un tirage gratuit toutes les ${STAR_CHEST_EVERY} étoiles.`)],
        },
        {
          title: 'Objectifs',
          body: [p('Des défis à long terme, visibles au QG. Une fois atteint, chacun se réclame une seule fois contre de l’or ou des tirages gratuits.')],
        },
      ],
    },
  ];
}

const FIRST_ELITE_LEVEL = Array.from({ length: 100 }, (_, i) => i).find((l) => eliteCount(l) > 0);

/** Recherche insensible à la casse, aux accents et au type d'apostrophe. */
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/’/g, "'").toLowerCase();

// Conservés d'un rendu à l'autre, comme les réglages de simulation de l'onglet Combat
let category = 'all';
let query = '';

export function renderWiki(): HTMLElement {
  const data = sections(getState());
  const empty = h('p', { class: 'muted', hidden: true }, 'Aucun résultat : essayez un autre mot, par exemple le nom d’une arme ou d’une amélioration.');

  const blocks = data.map((section) => {
    const articles = section.articles.map((a) => {
      const el = h('details', { class: 'wiki-article' }, h('summary', null, a.title), h('div', { class: 'wiki-body' }, ...a.body));
      return { el, text: normalize(el.textContent ?? '') };
    });
    const el = h('div', { class: 'wiki-section' }, h('h2', { class: 'section-title' }, `${section.icon} ${section.label}`), h('div', { class: 'panel' }, articles.map((a) => a.el)));
    return { id: section.id, el, articles };
  });

  // Filtre sur place plutôt que par un nouveau rendu : le champ de recherche garde ainsi le focus
  const applyFilter = (): void => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const block of blocks) {
      let visible = 0;
      for (const a of block.articles) {
        const match = (category === 'all' || category === block.id) && words.every((w) => a.text.includes(w));
        a.el.hidden = !match;
        if (match) visible++;
      }
      block.el.hidden = visible === 0;
      shown += visible;
    }
    empty.hidden = shown > 0;
  };

  // Une recherche déplie ses résultats ; l'effacer replie tout
  const openMatches = (): void => {
    for (const block of blocks) for (const a of block.articles) a.el.open = query.trim() !== '';
  };

  const chips: { id: string; el: HTMLElement }[] = [{ id: 'all', label: 'Tout' }, ...data].map((c) => ({
    id: c.id,
    el: h('button', { class: `chip${category === c.id ? ' active' : ''}`, onclick: () => {
      category = c.id;
      for (const other of chips) other.el.classList.toggle('active', other.id === category);
      applyFilter();
    } }, c.label),
  }));

  const search = h('input', { class: 'wiki-search', type: 'text', placeholder: 'Rechercher : soif de sang, armure, forge…', value: query, oninput: (e) => {
    query = (e.target as HTMLInputElement).value;
    applyFilter();
    openMatches();
  } });

  applyFilter();
  openMatches();

  return h(
    'section',
    null,
    h(
      'div',
      { class: 'panel' },
      p('La boucle de jeu : ', b('recrutez'), ' des soldats, ', b('choisissez leurs améliorations'), ' et ', b('équipez-les'), ', puis ', b('combattez'), ' pour gagner XP, or et armes.'),
      search,
      h('div', { class: 'wiki-chips' }, chips.map((c) => c.el)),
    ),
    empty,
    blocks.map((block) => block.el),
  );
}
