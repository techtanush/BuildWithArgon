// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import CameraAvatarCapture, { stopCameraTracks } from '../../../src/world/player/CameraAvatarCapture';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
describe('camera avatar consent and cleanup', () => {
  it('stops all tracks', () => {
    const a = vi.fn(), b = vi.fn();
    stopCameraTracks({ getTracks: () => [{ stop: a }, { stop: b }] } as any);
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce();
  });
  it('does not request camera or upload on mount; requires consent', async () => {
    const getUserMedia = vi.fn(), fetcher = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.stubGlobal('fetch', fetcher);
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<CameraAvatarCapture ventureId="v" onCancel={() => {}} onPersonalized={() => {}} />));
    expect(getUserMedia).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
    expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Personalize with Argon')!.disabled).toBe(true);
    await act(async () => root.unmount()); vi.unstubAllGlobals();
  });
  it('stops a camera permission result arriving after unmount', async () => {
    let resolve!: (stream: any) => void;
    const stop = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(r => { resolve = r; }) } });
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<CameraAvatarCapture ventureId="v" onCancel={() => {}} onPersonalized={() => {}} />));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Enable camera')!.click());
    await act(async () => root.unmount());
    await act(async () => resolve({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalledOnce();
  });
});

it('stops tracks immediately on capture before encoding and supports manual cancel', async () => {
  const stop = vi.fn(), cancel = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => { expect(stop).toHaveBeenCalledOnce(); });
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<CameraAvatarCapture ventureId="v" onCancel={cancel} onPersonalized={() => {}} />));
  const click = async (text: string) => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text)!.click());
  await click('Enable camera');
  const video = host.querySelector('video')!;
  Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 } });
  await click('Capture photo'); expect(stop).toHaveBeenCalledOnce();
  await click('Enable camera'); await click('Use manual selection');
  expect(stop).toHaveBeenCalledTimes(2); expect(cancel).toHaveBeenCalledOnce();
  await act(async () => root.unmount()); vi.restoreAllMocks();
});

it('rejects invalid file types without uploading', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<CameraAvatarCapture ventureId="v" onCancel={() => {}} onPersonalized={() => {}} />));
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [new File(['text'], 'bad.txt', { type: 'text/plain' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(host.querySelector('[role=alert]')!.textContent).toContain('JPEG, PNG or WebP');
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => root.unmount()); vi.unstubAllGlobals();
});
