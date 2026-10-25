// OWNER: karthik
import { LipSync } from '../../src/world/npc/LipSync';
import { startListening, type SttSession } from '../../src/world/conversation/Stt';
import { speak, type SpeakHandle } from '../../src/world/conversation/Speech';
import { startVoiceCall, type VoiceCallHandle } from '../../src/world/conversation/VoiceCall';
import type { TtsResponse, SttResponse } from '../../src/shared/contracts';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => el<HTMLInputElement>(id).value;
const status = (s: string) => { el('status').textContent = s; };
const lips = new LipSync(); let speech: SpeakHandle | null = null, call: VoiceCallHandle | null = null, listening: SttSession | null = null;
let held = false, callPending = false, capture = 0, endPendingCall = false;
async function request<T>(url: string, body: BodyInit, headers?: HeadersInit): Promise<T> {
  const r = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()).data;
}
const hold = el<HTMLButtonElement>('hold');
hold.onpointerdown = async e => {
  if (held) return; held = true; hold.setPointerCapture(e.pointerId); const generation = ++capture;
  speech?.stop(); status('Listening...');
  const session = await startListening({ prefer: value('stt') as 'server' | 'browser', transcribe: blob => { const form = new FormData(); form.append('audio', blob, `audio.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`); return request<SttResponse>('/v1/voice/transcribe', form); } });
  if (!held || generation !== capture) { session.cancel(); return; } listening = session;
};
const release = async () => {
  held = false; const current = listening; listening = null; if (!current) return;
  status('Transcribing...'); const result = await current.stop(); el<HTMLTextAreaElement>('text').value = result.text;
  status(result.text ? `${result.provider}, ${Math.round(result.latency_ms)} ms after release` : 'No transcript. Type instead.');
};
hold.onpointerup = release; hold.onpointercancel = () => { held = false; capture++; listening?.cancel(); listening = null; status('Cancelled. Type instead.'); };
el('speak').onclick = async () => {
  speech?.stop(); let tts: TtsResponse | null = null;
  try {
    if (value('driver') === 'server') tts = await request('/v1/voice/tts', JSON.stringify({ agent_id: value('agent'), text: value('text') }), { 'Content-Type': 'application/json' });
    status(tts ? `TTS response provider: ${tts.provider}; playback may use browser fallback` : 'Browser speech');
    speech = speak(value('text'), tts, { lipSync: lips });
    const time = await speech.started; if (!Number.isFinite(time)) status('No sound started. Check browser audio permissions or type instead.');
  } catch { status('Speech did not start. Check audio permissions, select browser speech, or type instead.'); }
};
el('stop').onclick = () => { speech?.stop(); listening?.cancel(); listening = null; held = false; capture++; };
el('call').onclick = async () => {
  if (callPending || call && !['ended', 'error', 'unavailable'].includes(call.status)) return;
  if (!value('venture').trim()) { status('Enter a real venture ID first.'); return; }
  callPending = true; endPendingCall = false; speech?.stop();
  try { call = await startVoiceCall({ ventureId: value('venture'), agentId: value('agent'), surface: 'world', lipSync: lips, onStatus: (s, reason) => status(`${s}${reason ? ': ' + reason : ''}`), onTranscript: turn => { el('transcript').textContent += `${turn.role}: ${turn.text}\n`; }, onAnswer: answer => { el('answers').textContent = JSON.stringify(answer, null, 2); } }); if (endPendingCall) await call.end(); } finally { callPending = false; }
};
el('end').onclick = () => { endPendingCall = true; void call?.end(); };
el<HTMLInputElement>('muted').onchange = e => call?.setMuted((e.target as HTMLInputElement).checked);
const canvas = el<HTMLCanvasElement>('mouth'), ctx = canvas.getContext('2d')!; let previous = performance.now(), frame = 0;
function draw(now: number) { const mouth = lips.update((now - previous) / 1000); previous = now; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#5b2929'; ctx.beginPath(); ctx.ellipse(200, 90, mouth.width * 1500, Math.max(2, mouth.open * 1000), 0, 0, 2 * Math.PI); ctx.fill(); frame = requestAnimationFrame(draw); }
frame = requestAnimationFrame(draw);
window.addEventListener('pagehide', () => { endPendingCall = true; held = false; capture++; listening?.cancel(); speech?.stop(); void call?.end(); cancelAnimationFrame(frame); });

window.addEventListener('blur', () => { if (held) { held = false; capture++; listening?.cancel(); listening = null; status('Recording cancelled after focus loss. Type instead.'); } });
