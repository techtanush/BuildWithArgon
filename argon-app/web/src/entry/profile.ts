// A display preference only. Never an authentication credential or API authorization.
export const LOCAL_PROFILE_KEY = 'foundry.local-demo-profile';
export function readLocalProfile(): { name: string } {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) ?? '{}');
    return { name: typeof value.name === 'string' ? value.name.slice(0, 60) : '' };
  } catch { return { name: '' }; }
}
