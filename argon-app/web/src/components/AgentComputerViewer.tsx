// OWNER: ayan — standalone computer monitor; no provider credentials or fake state.
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Computer, ComputerAction } from '../shared/contracts';
import './AgentComputerViewer.css';

interface Task { id: string; goal: string; status: string; steps: number; actions: ComputerAction[] }
export interface AgentComputerViewerProps { ventureId: string; agentId?: string; pollIntervalMs?: number }

/** Only explicit HTTPS Spaces links. Never interpolate a space ID or open credential-bearing URLs. */
export function safeSpacesWatchUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}
async function data<T>(url: string, signal: AbortSignal, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method, signal, cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Computer service returned HTTP ${response.status}.`);
  const envelope = await response.json();
  if (!envelope || !('data' in envelope)) throw new Error('Computer service returned an invalid response.');
  return envelope.data as T;
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'Computer service unavailable.'; }

/** Serial polling: abort on selection/unmount, pause in background tabs, including an initially empty list. */
function usePoll(run: (signal: AbortSignal) => Promise<void>, dependencies: unknown[], interval: number) {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    async function tick() {
      clearTimeout(timer);
      if (controller.signal.aborted || busy) return;
      if (!document.hidden) {
        busy = true;
        try { await run(controller.signal); } finally { busy = false; }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void tick(), Math.max(1000, interval));
    }
    const visible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', visible);
    void tick();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  // The caller supplies all values read by run, analogous to useEffect.
  }, [...dependencies, interval]);
}

export function AgentComputerViewer({ ventureId, agentId, pollIntervalMs = 2000 }: AgentComputerViewerProps) {
  const [computers, setComputers] = useState<Computer[]>([]);
  const [selected, setSelected] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState('');
  const [task, setTask] = useState<Task | null>(null);
  const [taskError, setTaskError] = useState('');
  const [screen, setScreen] = useState<{ id: string; url: string; at: string } | null>(null);
  const [screenError, setScreenError] = useState('');
  const [stopping, setStopping] = useState<string | null>(null);
  const [stopError, setStopError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const stopController = useRef<AbortController | null>(null);
  const listScope = useRef(ventureId);
  listScope.current = ventureId;
  useEffect(() => () => { stopController.current?.abort(); }, []);
  useEffect(() => { setComputers([]); setLoaded(false); setSelected(''); setListError(''); setStopError(''); }, [ventureId]);
  usePoll(async signal => {
    if (!ventureId) return;
    try {
      const result = await data<{ items: Computer[] }>(`/v1/ventures/${encodeURIComponent(ventureId)}/computers`, signal);
      if (!Array.isArray(result.items)) throw new Error('Computer service returned an invalid list.');
      if (!signal.aborted) { setComputers(result.items); setListError(''); setLoaded(true); }
    } catch (error) { if (!signal.aborted) { setListError(message(error)); setLoaded(true); } }
  }, [ventureId, refresh], pollIntervalMs);
  const choices = computers.filter(c => !agentId || c.agent_id === agentId);
  const computer = choices.find(c => c.id === selected) ?? choices[0];
  const id = computer?.id;
  const taskId = computer?.current_task?.id;
  useEffect(() => { setTask(null); setTaskError(''); }, [taskId]);
  usePoll(async signal => {
    if (!taskId) return;
    try {
      const result = await data<Task>(`/v1/computer-tasks/${encodeURIComponent(taskId)}`, signal);
      if (!signal.aborted) { setTask(result); setTaskError(''); }
    } catch (error) { if (!signal.aborted) setTaskError(message(error)); }
  }, [taskId, refresh], pollIntervalMs);
  useEffect(() => { setScreen(null); setScreenError(''); }, [id]);
  // Each polling scope owns its object URLs, so switching agents cannot leak or show another desktop.
  const screenUrls = useRef(new Set<string>());
  useEffect(() => () => { screenUrls.current.forEach(url => URL.revokeObjectURL(url)); screenUrls.current.clear(); }, [id]);
  usePoll(async signal => {
    if (!id) return;
    try {
      const response = await fetch(`/v1/computers/${encodeURIComponent(id)}/screen.png`, { signal, cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 404 ? 'No screenshot available yet.' : `Screenshot unavailable (HTTP ${response.status}).`);
      const image = await response.blob();
      if (signal.aborted) return;
      const url = URL.createObjectURL(image);
      screenUrls.current.forEach(old => URL.revokeObjectURL(old));
      screenUrls.current.clear(); screenUrls.current.add(url);
      setScreen({ id, url, at: new Date().toLocaleTimeString() }); setScreenError('');
    } catch (error) { if (!signal.aborted) setScreenError(message(error)); }
  }, [id, refresh], pollIntervalMs);
  async function stop() {
    if (!computer || stopController.current) return;
    const controller = new AbortController(); stopController.current = controller;
    const scope = ventureId;
    setStopping(computer.id); setStopError('');
    try {
      const result = await data<Computer>(`/v1/computers/${encodeURIComponent(computer.id)}/stop`, controller.signal, 'POST');
      if (!controller.signal.aborted && listScope.current === scope) {
        setComputers(items => items.map(item => item.id === result.id ? result : item));
        setRefresh(value => value + 1);
      }
    } catch (error) { if (!controller.signal.aborted && listScope.current === scope) setStopError(message(error)); }
    finally { stopController.current = null; if (!controller.signal.aborted) setStopping(null); }
  }
  const watch = computer?.provider === 'cua_space' ? safeSpacesWatchUrl(computer.watch_url) : undefined;
  const currentScreen = screen?.id === id ? screen : null;
  const currentTask = task?.id === taskId ? task : null;
  return <section className="acv" aria-label="Agent computer viewer">
    <header className="acv-header"><div><p className="acv-eyebrow">COMPUTER OBSERVATORY</p><h1>Agent computers</h1><p>Recorded desktops and actions from Cua. Viewing does not start or fund a computer.</p></div><button onClick={() => setRefresh(value => value + 1)}>Refresh</button></header>
    {!ventureId ? <p role="status">Choose a venture to view its agent computers.</p> : <>
      {listError && <p className="acv-error" role="alert">{listError} {computers.length > 0 && 'Showing last reported state.'}</p>}
      {stopError && <p className="acv-error" role="alert">Stop failed: {stopError}</p>}
      {!loaded && <p role="status">Loading agent computers…</p>}
      {loaded && !choices.length && !listError && <div className="acv-empty"><h2>No computer reported</h2><p>{agentId ? `No computer is assigned to ${agentId}.` : 'No agent computer is assigned to this venture yet.'} Cua may be off or no task has requested a computer.</p></div>}
      {computer && <>
        <div className="acv-toolbar"><label>Agent computer <select value={computer.id} onChange={event => setSelected(event.target.value)}>{choices.map(c => <option key={c.id} value={c.id}>{c.agent_id} · {c.id}</option>)}</select></label><span className="acv-status">Last reported: {computer.status}</span><span>{computer.provider === 'cua_space' ? 'Cua Spaces' : computer.provider}</span><button className="acv-stop" disabled={Boolean(stopping) || computer.status === 'stopped'} onClick={() => void stop()}>{stopping === id ? 'Stopping…' : 'Stop computer'}</button>{watch && <a href={watch} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Cua Spaces</a>}</div>
        <div className="acv-layout"><div className="acv-monitor"><div className="acv-screen">{currentScreen ? <img src={currentScreen.url} alt={`Last recorded desktop for ${computer.agent_id}`} onError={() => { setScreen(null); setScreenError('Screenshot could not be displayed.'); }} /> : <p role="status">{screenError || 'Waiting for a recorded screenshot…'}</p>}</div><p className="acv-caption">{currentScreen ? `Last screenshot fetched at ${currentScreen.at}.` : 'Screenshots appear after the agent records a step.'} Updates every {Math.max(1000, pollIntervalMs) / 1000}s while this tab is visible. Not a live video stream.</p>{currentScreen && screenError && <p role="status" className="acv-error">{screenError} Showing the previous screenshot.</p>}<h2>Current task</h2><p>{computer.current_task?.goal ?? 'No active task reported.'}</p>{computer.current_task && <p>{computer.current_task.status} · {computer.current_task.steps} steps</p>}{computer.current_task?.status === 'waiting_approval' && <p className="acv-approval">Waiting for human approval. Review the request in Approvals; this viewer cannot approve actions.</p>}{!watch && computer.provider === 'cua_space' && <p>No safe external Spaces watch URL was provided. Recorded screenshots remain available here.</p>}</div>
        <aside className="acv-history" aria-label="Computer action history"><h2>Action history</h2>{taskError && <p className="acv-error" role="alert">{taskError}</p>}{!taskId ? <p>No active task. The API only lists actions for an identified task.</p> : !currentTask ? <p>Loading recorded actions…</p> : !currentTask.actions.length ? <p>No actions recorded yet.</p> : <ol>{currentTask.actions.map((action, index) => <li key={`${action.step}-${index}`}><div><strong>Step {action.step}</strong><span className={`acv-guard acv-guard-${action.guard}`}>{action.guard}</span></div><p>{action.reason || 'No reason recorded.'}</p><details><summary>Action details</summary><pre>{JSON.stringify(action.action, null, 2)}</pre></details><time dateTime={action.created_at}>{action.created_at}</time></li>)}</ol>}</aside></div>
      </>}
    </>}
  </section>;
}

/** Standalone /computers?ventureId=...&agentId=... or /computers/:ventureId/:agentId?. */
export default function AgentComputerViewerPage() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const [draftVenture, setDraftVenture] = useState('');
  const [draftAgent, setDraftAgent] = useState('');
  const ventureId = params.ventureId ?? search.get('ventureId') ?? '';
  const agentId = params.agentId ?? search.get('agentId') ?? undefined;
  if (!ventureId) return <main className="acv">
    <p className="acv-eyebrow">COMPUTER OBSERVATORY</p>
    <h1>View an agent computer</h1>
    <p>Enter an existing venture ID to load its reported Cua computers. This does not start a computer.</p>
    <form className="acv-selector" onSubmit={event => {
      event.preventDefault();
      if (draftVenture.trim()) setSearch({ ventureId: draftVenture.trim(), ...(draftAgent.trim() ? { agentId: draftAgent.trim() } : {}) });
    }}>
      <label htmlFor="acv-venture">Venture ID</label>
      <input id="acv-venture" required value={draftVenture} onChange={event => setDraftVenture(event.target.value)} placeholder="ven_…" />
      <label htmlFor="acv-agent">Agent ID (optional)</label>
      <input id="acv-agent" value={draftAgent} onChange={event => setDraftAgent(event.target.value)} placeholder="eng.qa" />
      <button type="submit" disabled={!draftVenture.trim()}>View computers</button>
    </form>
  </main>;
  return <AgentComputerViewer key={ventureId} ventureId={ventureId} agentId={agentId} />;
}
