// OWNER: karthik
import { expect, it } from 'vitest';
import { LipSync } from '../../../src/world/npc/LipSync';
import { REST, VISEMES } from '../../../src/world/npc/visemes';
it('alignment converges and anticipates the next character', () => {
  const audio = {currentTime: 0.1} as HTMLAudioElement, lip = new LipSync();
  lip.start({kind:'alignment',audio,alignment:{chars:['a','m'],starts:[0,0.2],ends:[0.2,0.4]}});
  expect(lip.update(1).open).toBeCloseTo(VISEMES.A.open);
  audio.currentTime = 0.18; expect(lip.update(1).open).toBeCloseTo(VISEMES.A.open * 0.7);
});
it('boundary is silent until a word, expires at 180ms and stops over 120ms', () => {
  let time = 0; const lip = new LipSync(() => time); lip.start({kind:'boundary'});
  expect(lip.update(1)).toEqual(REST); lip.onBoundary(); expect(lip.update(1).open).toBeGreaterThan(0.02);
  time = 0.2; expect(lip.update(1).open).toBeCloseTo(REST.open);
  lip.onBoundary(); lip.update(1); lip.stop(); expect(lip.speaking).toBe(false);
  lip.update(0.06); expect(lip.mouth.open).toBeGreaterThan(REST.open); lip.update(0.06); expect(lip.mouth).toEqual(REST);
});
it('level clamps bad provider values and analyser measures RMS', () => {
  const lip = new LipSync(); lip.start({kind:'level',level:()=>10}); expect(lip.update(1).open).toBeCloseTo(0.07);
  lip.start({kind:'level',level:()=>NaN}); expect(lip.update(1).open).toBeCloseTo(0);
  const analyser = {fftSize:0,getFloatTimeDomainData:(array:Float32Array)=>array.fill(0.05)} as unknown as AnalyserNode;
  lip.start({kind:'analyser',analyser}); expect(analyser.fftSize).toBe(1024); expect(lip.update(1).open).toBeCloseTo(0.027);
});
