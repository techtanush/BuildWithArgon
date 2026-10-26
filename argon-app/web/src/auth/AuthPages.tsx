import { useEffect, useState, type ReactNode } from 'react';
import { AuthenticateWithRedirectCallback, SignIn, SignUp, UserProfile, useClerk } from '@clerk/react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppAuth } from './AuthProvider';
import { safeReturnTo } from './policy';
import LocalSignIn from '../entry/LocalSignIn';
import YcbfBrand from '../shared/YcbfBrand';
import '../entry/entry.css';
import './auth.css';
function AuthFrame({children}: {children: ReactNode}) { return <main className="foundry-entry entry-signin ycbf-auth"><Link className="entry-brand" to="/welcome"><YcbfBrand /></Link><section className="entry-signin-card">{children}</section><p className="entry-fineprint">Your company. Your account. Your decisions.</p></main>; }
export function AuthSetup() { const {mode} = useAppAuth(); return <AuthFrame><p className="entry-kicker">ACCOUNT ACCESS</p><h1>Authentication<br/><em>needs setup.</em></h1><p role="status">Secure sign-in is not configured for this deployment. Workspace access is disabled until the site owner connects Clerk.</p><p className="auth-setup-detail">Configure VITE_CLERK_PUBLISHABLE_KEY for the frontend and Clerk verification on the server, then redeploy. No account has been created or signed in.</p><nav className="auth-links" aria-label="Account navigation"><Link to="/signin">Sign in</Link><Link to="/signup">Create account</Link><Link to="/welcome">Back to YCBF</Link></nav>{mode === 'demo' && <Link className="entry-text-link" to="/demo">Enter explicit localhost demo (not an account)</Link>}</AuthFrame>; }
export function AuthGuard({children}: {children: ReactNode}) {
  const auth = useAppAuth(); const location = useLocation();
  if (auth.mode === 'unconfigured') return <AuthSetup />;
  if (!auth.loaded) return <AuthFrame><p role="status">Checking your secure session…</p></AuthFrame>;
  if (!auth.signedIn) return <Navigate replace to={`${auth.mode === 'demo' ? '/demo' : '/signin'}?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />;
  return <>{children}</>;
}
export function AuthEntry({signup = false}: {signup?: boolean}) {
  const auth = useAppAuth(); const [params] = useSearchParams();
  const destination = signup ? '/onboarding' : safeReturnTo(params.get('returnTo'));
  if (auth.mode !== 'clerk') return <AuthSetup />;
  if (auth.loaded && auth.signedIn) return <Navigate replace to={destination} />;
  return <AuthFrame><p className="entry-kicker">{signup ? 'YOUR NEXT CHAPTER' : 'WELCOME BACK'}</p><h1>{signup ? 'Become a founder.' : 'Your company awaits.'}</h1><p>{signup ? 'Create your secure account to start building.' : 'Sign in to return to your workspace.'}</p><div className="auth-provider">{signup ? <SignUp routing="path" path="/signup" signInUrl="/signin" forceRedirectUrl="/onboarding" /> : <SignIn routing="path" path="/signin" signUpUrl="/signup" forceRedirectUrl={destination} />}</div><nav className="auth-links" aria-label="Account navigation"><Link to={signup ? '/signin' : '/signup'}>{signup ? 'Already have an account? Sign in' : 'New to YCBF? Create account'}</Link><Link to="/welcome">Back to YCBF</Link></nav></AuthFrame>;
}
export function AuthCallback() { return useAppAuth().mode === 'clerk' ? <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/dashboard" signUpForceRedirectUrl="/onboarding" /> : <AuthSetup />; }
export function DemoEntry() { const auth = useAppAuth(); return auth.mode === 'demo' ? <LocalSignIn onContinue={auth.beginDemo} /> : <AuthSetup />; }
export function AccountPage() { const auth = useAppAuth(); return <AuthGuard><AuthFrame><h1>Your account.</h1>{auth.mode === 'clerk' ? <UserProfile routing="path" path="/account" /> : <p>Local demo only. This is not a verified account.</p>}<nav className="auth-links"><Link to="/dashboard">Dashboard</Link><Link to="/signout">Sign out</Link></nav></AuthFrame></AuthGuard>; }
function ClerkSignOut() { const {signOut} = useClerk(); const [error, setError] = useState(false); useEffect(() => { void signOut({redirectUrl: '/signin'}).catch(() => setError(true)); }, [signOut]); return <AuthFrame><p role="status">{error ? 'Sign-out did not complete. Please retry.' : 'Signing out securely…'}</p>{error && <button onClick={() => { setError(false); void signOut({redirectUrl: '/signin'}).catch(() => setError(true)); }}>Retry sign out</button>}</AuthFrame>; }
function DemoSignOut() { const auth = useAppAuth(); const navigate = useNavigate(); useEffect(() => {auth.endDemo(); navigate('/signin', {replace: true});}, []); return null; }
export function SignOutPage() { return useAppAuth().mode === 'clerk' ? <ClerkSignOut /> : <DemoSignOut />; }
