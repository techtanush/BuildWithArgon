// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

// From architecture-files/05-world/05-characters-and-faces.md. Shared by Character.ts (mahin),
// the dashboard Portrait fallback (tanush) and kernel worldgen/faces.py (ayan, mirrored in contracts.py).
export const SKIN = ['#F6D7C3', '#EDC1A0', '#D9A37E', '#B97A56', '#8D5A3B', '#5E3A26'] as const;
export type SkinTone = (typeof SKIN)[number];
export const HAIR_COLORS = ['#1E1B18', '#3B2A20', '#6B4226', '#A0612E', '#D9B26A', '#B7B7B7', '#7A3B6E', '#2F5D8A'];
export const EYE_COLORS = ['#3B2A20', '#5B7A3A', '#3E6C9E', '#6B4F2A', '#2B2B2B'];
export const HAIR_STYLES = ['short', 'buzz', 'bob', 'long', 'bun', 'curly', 'ponytail', 'bald', 'mohawk', 'waves'] as const;
export const BROWS = ['straight', 'arched', 'thick'] as const;
export const NOSES = ['button', 'round', 'long'] as const;
export const ACCESSORIES = ['none', 'glasses_round', 'glasses_square', 'headset', 'hard_hat', 'beanie', 'earrings', 'scarf', 'visor', 'bowtie'] as const;
export const OUTFITS = ['hoodie', 'blazer', 'overalls', 'sweater', 'vest', 'jacket', 'apron', 'lab_coat'] as const;

export interface FaceSpec {
  agent_id: string;
  skin: SkinTone | string;
  hair_style: (typeof HAIR_STYLES)[number];
  hair_color: string;
  eye_color: string;
  brow: (typeof BROWS)[number];
  nose: (typeof NOSES)[number];
  accessory: (typeof ACCESSORIES)[number];
  outfit: (typeof OUTFITS)[number];
  outfit_color: string;
  pants_color: string;
  height: number; // 0.92 … 1.08
  build: number; // 0.90 … 1.10
  names: { skin: string; hair: string; eyes: string; outfit: string; accessory: string };
}
