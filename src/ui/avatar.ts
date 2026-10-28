import { WEAPONS_BY_ID, FISTS } from '../game/data';
import type { SpriteLook, WeaponDef } from '../game/types';

const BODY = [
  '...HHHHHH...',
  '..HHHHHHHH..',
  '..HHHHHHHH..',
  '..RSSSSSSR..',
  '..SSESSESS..',
  '...SSSSSS...',
  '.DUUUUUUUUD.',
  '.DUUBBBBUUD.',
  '.DUUUUUUUUD.',
  '.SUUUUUUUUS.',
  '..UUUUUUUU..',
  '..DD....DD..',
  '..DD....DD..',
  '.KKK....KKK.',
];

type Rect = [number, number, number, number, string];

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

function weaponRects(w: WeaponDef): Rect[] {
  const c = w.color;
  const d = '#59606a';
  const wood = '#6b4a2b';
  switch (w.shape) {
    case 'fists':
      return [];
    case 'knife':
      return [[11, 5, 1, 4, c], [10, 9, 3, 1, d]];
    case 'sword':
      return [[11, 2, 1, 7, c], [10, 9, 3, 1, d]];
    case 'katana':
      return [[11, 1, 1, 8, c], [10, 9, 3, 1, d], [12, 2, 1, 6, '#ffffff55']];
    case 'axe':
      return [[11, 4, 1, 6, wood], [12, 4, 2, 3, c]];
    case 'pistol':
      return [[11, 8, 3, 1, d], [11, 9, 1, 1, d], [13, 8, 1, 1, c]];
    case 'smg':
      return [[11, 8, 5, 1, d], [12, 9, 1, 2, d], [15, 8, 1, 1, c]];
    case 'rifle':
      return [[10, 8, 9, 1, d], [12, 9, 1, 2, d], [18, 8, 1, 1, c], [10, 9, 1, 1, c]];
    case 'shotgun':
      return [[10, 8, 8, 1, c], [10, 9, 3, 1, wood]];
    case 'sniper':
      return [[9, 8, 11, 1, d], [13, 7, 3, 1, c], [11, 9, 1, 2, d]];
    case 'bazooka':
      return [[8, 5, 11, 3, c], [18, 5, 1, 3, d]];
    case 'launcher':
      return [[10, 8, 6, 2, c], [11, 10, 1, 1, d]];
    case 'flame':
      return [[11, 8, 5, 1, d], [16, 8, 2, 1, '#ff7a1a'], [10, 7, 2, 3, c]];
    case 'minigun':
      return [[10, 7, 8, 3, d], [18, 7, 2, 1, c], [18, 9, 2, 1, c]];
    case 'railgun':
      return [[9, 7, 11, 2, c], [9, 9, 3, 1, d]];
    case 'shield':
      return [[13, 4, 4, 8, c], [13, 4, 4, 1, '#ffffff55'], [14, 7, 2, 2, d], [13, 12, 4, 1, d]];
    case 'crossbow':
      return [[10, 8, 7, 1, wood], [16, 6, 1, 5, c], [15, 6, 1, 1, c], [15, 10, 1, 1, c], [11, 9, 1, 1, d]];
    case 'revolver':
      return [[11, 8, 4, 1, c], [12, 7, 2, 1, d], [11, 9, 1, 2, wood]];
    case 'spear':
      return [[11, 1, 1, 10, wood], [11, 0, 1, 1, c], [12, 1, 2, 3, c], [10, 2, 1, 1, c]];
    case 'medic':
      return [[10, 8, 7, 2, c], [12, 8, 3, 1, '#d33'], [13, 7, 1, 3, '#d33'], [11, 10, 1, 1, d]];
    case 'tesla':
      return [[10, 8, 6, 2, d], [16, 7, 2, 4, c], [12, 7, 2, 1, c], [18, 8, 1, 2, '#ffffff']];
    case 'mortar':
      return [[8, 6, 11, 3, c], [18, 6, 1, 3, d], [10, 9, 2, 2, d], [15, 9, 2, 2, d]];
  }
}

function rectsToSvg(rects: Rect[]): string {
  return rects.map(([x, y, w, hh, fill]) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${fill}"/>`).join('');
}

export function spriteSvg(look: SpriteLook, cls = 'sprite'): string {
  const colors: Record<string, string> = {
    H: look.helmet,
    S: look.skin,
    R: look.hair,
    E: '#1b1b1b',
    U: look.uniform,
    D: darken(look.uniform, 0.7),
    B: '#3a2f20',
    K: '#2b2b2b',
  };
  const rects: Rect[] = [];
  BODY.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x;
      while (end + 1 < row.length && row[end + 1] === ch) end++;
      if (ch !== '.') rects.push([x, y, end - x + 1, 1, colors[ch]]);
      x = end + 1;
    }
  });
  const weapon = WEAPONS_BY_ID[look.weaponId] ?? FISTS;
  rects.push(...weaponRects(weapon));
  return `<svg class="${cls}" viewBox="0 0 20 14" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rectsToSvg(rects)}</svg>`;
}

export function weaponSvg(weapon: WeaponDef, cls = 'weapon-icon'): string {
  const rects = weaponRects(weapon);
  if (rects.length === 0) {
    return `<svg class="${cls}" viewBox="0 0 20 14" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="6" width="4" height="4" fill="${weapon.color}"/></svg>`;
  }
  return `<svg class="${cls}" viewBox="8 0 12 14" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rectsToSvg(rects)}</svg>`;
}

