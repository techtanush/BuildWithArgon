// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MapOverlay} from '../../../src/world/hud/MapOverlay';
import manifest from '../../../src/world/data/manifest.fallback.json';
let root: Root, host: HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
function mount() {
  const travel = vi.fn(), race = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<MapOverlay manifest={manifest as any} position={[0,0]} onTravel={travel} onRace={race} onClose={() => {}} />));
  return {travel, race};
}
it('shows thirteen department names, not building codes or people-first entries', () => {
  mount();
  expect(host.querySelectorAll('.map-building')).toHaveLength(13);
  expect(host.querySelectorAll('.directory-department')).toHaveLength(13);
  expect(host.textContent).not.toMatch(/D0[1-9]|Everyone in Foundry/);
  expect(host.textContent).toContain('Growth & Marketing');
  for (const marker of host.querySelectorAll('.map-building')) {
    expect(marker.getAttribute('aria-label')).toContain('Select ');
    expect(marker.querySelector('text')?.textContent).toBeTruthy();
  }
});
it('binds each department travel and race action to its actual lead', () => {
  const {travel, race} = mount();
  for (const card of Array.from(host.querySelectorAll('.directory-department'))) {
    const lead = manifest.npcs.find(n => n.department_id === card.getAttribute('data-department') && n.is_lead)!;
    const buttons = card.querySelectorAll('button');
    act(() => buttons[0].click()); expect(travel).toHaveBeenLastCalledWith(lead.agent_id);
    act(() => buttons[1].click()); expect(race).toHaveBeenLastCalledWith(lead.agent_id);
  }
});
it('selects a department with Space and resets to all departments', () => {
  mount();
  const marker = host.querySelector('.map-building')!;
  act(() => marker.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true})));
  expect(host.querySelectorAll('.directory-department')).toHaveLength(1);
  act(() => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Show all departments')!.click());
  expect(host.querySelectorAll('.directory-department')).toHaveLength(13);
});
