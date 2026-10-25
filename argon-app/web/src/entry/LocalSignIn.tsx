import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LOCAL_PROFILE_KEY, readLocalProfile } from './profile';
import './entry.css';
import YcbfBrand from '../shared/YcbfBrand';

export default function LocalSignIn({ onContinue }: { onContinue?: () => void }) {
  const [name, setName] = useState(() => readLocalProfile().name);
  const navigate = useNavigate();
  return <main className="foundry-entry entry-signin"><Link className="entry-brand" to="/welcome"><YcbfBrand/></Link><section className="entry-signin-card"><p className="entry-kicker">LOCAL DEMO · FOUNDER PROFILE</p><h1>Make yourself<br /><em>at home.</em></h1><p>This demo does not sign you into an account. Your optional display name stays in this browser until you use it to create a venture.</p><form onSubmit={(event) => {
    event.preventDefault();
    try { localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({ name: name.trim() })); } catch { /* Profile is optional, including when storage is unavailable. */ }
    onContinue?.();
    navigate('/onboarding');
  }}><label htmlFor="demo-founder-name">Display name <span>(optional)</span></label><input id="demo-founder-name" autoComplete="given-name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?"/><button className="entry-button entry-orange" type="submit">Continue with local demo ↗</button></form><div className="entry-demo-notice"><strong>No password. No identity verification.</strong><p>This profile grants no backend access. Server authentication and provider permissions are unchanged. Creating or starting a venture uses the configured backend and may use providers. GitHub requires separate authorization and approval.</p></div><Link className="entry-text-link" to="/dashboard">Already have a venture? Open dashboard →</Link></section><p className="entry-fineprint">You stay in control of the decisions that matter.</p></main>;
}
