import { useEffect, useRef, useState } from 'react';
import type { FaceSpec } from '../npc/FaceSpec';
import './CameraAvatarCapture.css';

export interface CameraAvatarCaptureProps {
  ventureId: string | null;
  onPersonalized: (face: FaceSpec) => void;
  onCancel: () => void;
}
export function stopCameraTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}
export default function CameraAvatarCapture({ ventureId, onPersonalized, onCancel }: CameraAvatarCaptureProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const cameraGeneration = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [camera, setCamera] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  function stop() {
    cameraGeneration.current++;
    stopCameraTracks(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsed(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  async function startCamera() {
    stop(); setError(''); setCamera(false);
    const generation = cameraGeneration.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is unavailable. Choose an image instead.');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 768 } }, audio: false });
      if (!mounted.current || generation !== cameraGeneration.current) { stopCameraTracks(media); return; }
      stream.current = media; setCamera(true);
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
    } catch { stop(); if (mounted.current) { setCamera(false); setError('Camera unavailable or permission denied. Choose an image or use manual selection.'); } }
  }
  function capture() {
    const element = video.current;
    if (!element?.videoWidth) { setError('Wait for the camera preview before capturing.'); return; }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 768 / Math.max(element.videoWidth, element.videoHeight));
    canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) { stop(); setCamera(false); setError('Capture unavailable. Choose an image instead.'); return; }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    stop(); setCamera(false); // Stop every track immediately, before asynchronous encoding.
    canvas.toBlob(blob => { if (mounted.current && blob) { setPhoto(blob); setConsent(false); } }, 'image/jpeg', 0.85);
  }
  function choose(file?: File) {
    stop(); setCamera(false); setError(''); setConsent(false); setPhoto(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024 || !file.size) {
      setError('Choose a JPEG, PNG or WebP image no larger than 2 MB.'); return;
    }
    setPhoto(file);
  }
  function cancel() { stop(); request.current?.abort(); setPhoto(null); onCancel(); }
  async function personalize() {
    if (!photo || !consent || !ventureId || busy) return;
    stop(); setCamera(false); setBusy(true); setElapsed(0); setError('');
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const form = new FormData(); form.append('image', photo, 'avatar-photo'); form.append('consent', 'true');
      const res = await fetch(`/v1/ventures/${encodeURIComponent(ventureId)}/player/avatar`, { method: 'POST', body: form, signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || data?.detail || 'Argon is unavailable.');
      if (data?.kind !== 'photo-inspired-profile' || data?.photorealistic !== false || data?.face?.agent_id !== 'player') throw new Error('Argon returned an invalid appearance profile.');
      if (mounted.current && !controller.signal.aborted) { setPhoto(null); onPersonalized(data.face); }
    } catch (e) {
      if (mounted.current) setError(`${e instanceof Error && e.name !== 'AbortError' ? e.message : 'The request timed out or was cancelled.'} Use manual selection, or retry later.`);
    } finally { clearTimeout(timeout); if (mounted.current) setBusy(false); request.current = null; }
  }
  return <section className="camera-avatar" aria-label="Photo-inspired avatar">
    <h3>Photo-inspired appearance</h3>
    <p>Argon matches visible hair, skin colors and clothing to this avatar. This is not a 3D scan or a new photorealistic mesh.</p>
    <video ref={video} muted playsInline className={camera ? '' : 'camera-avatar-hidden'} aria-label="Camera preview" />
    {preview && <img src={preview} alt="Your selected photo, held locally until you consent and submit" />}
    <div className="camera-avatar-actions">
      <button type="button" disabled={busy} onClick={startCamera}>Enable camera</button>
      {camera && <button type="button" onClick={capture}>Capture photo</button>}
      <label>Choose image <input aria-label="Choose image" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => choose(e.target.files?.[0])} /></label>
    </div>
    <label className="camera-avatar-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /> I consent to sending this image to Gemini and using venture credits to personalize my avatar.</label>
    <p>The app processes your photo in memory without storing it. Gemini processes the submitted image under its provider policies.</p>
    {!ventureId && <p role="status">Select a venture first, or use manual selection.</p>}
    {busy && <p role="status">Creating a photo-inspired profile… {elapsed}s. Aiming for about 10 seconds, but this can take longer.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="camera-avatar-actions"><button type="button" disabled={!photo || !consent || !ventureId || busy} onClick={personalize}>Personalize with Argon</button><button type="button" onClick={cancel}>Use manual selection</button></div>
  </section>;
}
export { CameraAvatarCapture };
