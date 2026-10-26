import { createContext, useContext, useState, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useUser } from '@clerk/react';
import { useNavigate } from 'react-router-dom';
import { resolveAuthMode, type AuthMode } from './policy';
import { readLocalProfile } from '../entry/profile';
export type AuthState = { mode: AuthMode; loaded: boolean; signedIn: boolean; name: string; beginDemo: () => void; endDemo: () => void };
const noop = () => {};
export const AuthContext = createContext<AuthState>({ mode: 'unconfigured', loaded: true, signedIn: false, name: '', beginDemo: noop, endDemo: noop });
export const useAppAuth = () => useContext(AuthContext);
function ClerkSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  return <AuthContext.Provider value={{ mode: 'clerk', loaded: isLoaded && userLoaded, signedIn: !!isSignedIn, name: user?.fullName || user?.firstName || '', beginDemo: noop, endDemo: noop }}>{children}</AuthContext.Provider>;
}
export default function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  const mode = resolveAuthMode({ publishableKey: key, dev: import.meta.env.DEV, demoFlag: import.meta.env.VITE_ENABLE_LOCAL_DEMO, hostname: window.location.hostname });
  const [demo, setDemo] = useState(() => { if (mode !== 'demo') return false; try { return sessionStorage.getItem('ycbf.localDemoEntered') === 'true'; } catch { return false; } });
  if (mode === 'clerk') return <ClerkProvider publishableKey={key!} routerPush={(to: string) => navigate(to)} routerReplace={(to: string) => navigate(to, { replace: true })} signInUrl="/signin" signUpUrl="/signup" signInFallbackRedirectUrl="/dashboard" signUpForceRedirectUrl="/onboarding" afterSignOutUrl="/signin"><ClerkSession>{children}</ClerkSession></ClerkProvider>;
  return <AuthContext.Provider value={{ mode, loaded: true, signedIn: mode === 'demo' && demo, name: mode === 'demo' && demo ? readLocalProfile().name : '', beginDemo: () => { if (mode === 'demo') { try { sessionStorage.setItem('ycbf.localDemoEntered', 'true'); } catch {} setDemo(true); } }, endDemo: () => { try { sessionStorage.removeItem('ycbf.localDemoEntered'); } catch {} setDemo(false); } }}>{children}</AuthContext.Provider>;
}
