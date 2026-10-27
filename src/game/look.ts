import { FISTS, HAIR_COLORS, HELMET_COLORS, SKIN_TONES, UNIFORM_COLORS } from './data';
import type { Soldier, SpriteLook, WeaponDef } from './types';

export function soldierLook(s: Soldier, weapon: WeaponDef = FISTS): SpriteLook {
  const a = s.appearance;
  return {
    skin: SKIN_TONES[a.skin],
    hair: HAIR_COLORS[a.hair],
    uniform: UNIFORM_COLORS[a.uniform],
    helmet: HELMET_COLORS[a.helmet],
    weaponId: weapon.id,
  };
}
