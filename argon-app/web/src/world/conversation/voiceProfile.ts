/** Fictional NPC presentation follows the authored, MIT-licensed Microsoft body asset.
 * These are existing account catalog voices, verified by read-only /voices on 2026-10-25.
 * No inference about a real person's gender, names, face geometry, or hairstyles.
 * Only voice_id is allowed by the current provider agent's TTS override policy.
 */
const PROFILES = {
  'microsoft-rocketbox/Female_Adult_01-jaw': { presentation: 'female', voiceId: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', useCase: 'conversational' },
  'microsoft-rocketbox/Female_Adult_02-active': { presentation: 'female', voiceId: 'uYXf8XasLslADfZ2MB4u', name: 'Hope', useCase: 'conversational' },
  'microsoft-rocketbox/Male_Adult_01-active': { presentation: 'male', voiceId: 'cjVigY5qzO86Huf0OWal', name: 'Eric', useCase: 'conversational' },
} as const;
export function voiceForAuthoredAsset(assetId?: string) {
  return assetId && Object.prototype.hasOwnProperty.call(PROFILES, assetId) ? PROFILES[assetId as keyof typeof PROFILES] : undefined;
}
