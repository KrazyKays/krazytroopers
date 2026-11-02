/** Chapitres de campagne : chaque tranche de CHAPTER_SIZE niveaux a son décor, du bocage à la forteresse. */
export interface Biome {
  id: string;
  name: string;
  icon: string;
  /** Petite phrase d'ambiance affichée sur la carte. */
  tagline: string;
}

export const CHAPTER_SIZE = 10;

export const BIOMES: Biome[] = [
  { id: 'plains', name: 'Bocage paisible', icon: '🌳', tagline: 'Des haies, des vaches, et des ennemis derrière chaque buisson.' },
  { id: 'desert', name: 'Désert brûlant', icon: '🏜️', tagline: 'Sable dans les bottes, soleil de plomb et mirages armés.' },
  { id: 'tundra', name: 'Toundra gelée', icon: '❄️', tagline: 'Les doigts gèlent sur la détente. Les boss, eux, ont des moufles.' },
  { id: 'city', name: 'Ville en ruines', icon: '🏙️', tagline: 'Chaque fenêtre cache un tireur. Chaque égout, un démineur.' },
  { id: 'volcano', name: 'Volcan grondant', icon: '🌋', tagline: 'La lave est chaude, les ennemis le sont encore plus.' },
  { id: 'fortress', name: 'Forteresse du Maréchal', icon: '🏰', tagline: 'Le cœur de l’armée ennemie. Personne n’en est jamais revenu.' },
];

/** Chapitre (à partir de 0) d'un niveau de campagne. */
export function chapterOf(level: number): number {
  return Math.floor((Math.max(1, level) - 1) / CHAPTER_SIZE);
}

/** Décor d'un chapitre : le dernier se répète une fois la liste épuisée. */
export function biomeOfChapter(chapter: number): Biome {
  return BIOMES[Math.min(chapter, BIOMES.length - 1)];
}

export function biomeFor(level: number): Biome {
  return biomeOfChapter(chapterOf(level));
}
