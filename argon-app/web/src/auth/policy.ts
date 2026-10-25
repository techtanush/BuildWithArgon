export type AuthMode = 'clerk' | 'demo' | 'unconfigured';
export function resolveAuthMode(config: { publishableKey?: string; dev: boolean; demoFlag?: string; hostname: string }): AuthMode {
  if (config.publishableKey?.trim()) return 'clerk';
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(config.hostname);
  return config.dev && loopback && config.demoFlag === 'true' ? 'demo' : 'unconfigured';
}
export function safeReturnTo(value: string | null, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) return fallback;
  if (/^\/(signin|signup|signout|auth|demo)(\/|\?|#|$)/.test(value)) return fallback;
  return value;
}
