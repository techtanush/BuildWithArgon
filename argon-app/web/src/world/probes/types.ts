// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

// The capture-page <-> capture-script handshake (05-world/10-render-critique-loop.md §1–3).
// mahin implements it (CapturePage.tsx + probes.ts); ayan consumes it (scripts/capture.ts, kernel worldgen).
//
// One page load = one building in one mode. The page computes the probes that apply to that mode:
//   exterior: P1 P2 P3 P6 P7 P8 P10      interior: P1 P2 P4 P5 P6 P7 P8
// P9 (nonblank) is computed by scripts/capture.ts from the PNGs. The script merges both modes + P9 into
// kernel/data/worldgen/runs/<run>/probes/iter-<n>/<dept>.json as a BuildingProbeReport.
export type ProbeId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10';
export const CRITICAL_PROBES: ProbeId[] = ['P1', 'P2', 'P3', 'P4', 'P5'];
export const PROBE_NAMES: Record<ProbeId, string> = {
  P1: 'loads', P2: 'bounds', P3: 'entrance', P4: 'slots', P5: 'reachability',
  P6: 'overlap', P7: 'budget', P8: 'lights', P9: 'nonblank', P10: 'sign_visible',
};

export type CaptureMode = 'exterior' | 'interior';
export type CaptureSource = 'staging' | 'generated' | 'fallback';
export type ExteriorCamera = 'ext-1' | 'ext-2' | 'ext-3';
export type InteriorCamera = 'int-1' | 'int-2' | 'int-3';
export type CameraName = ExteriorCamera | InteriorCamera;
export const CAMERAS: Record<CaptureMode, CameraName[]> = {
  exterior: ['ext-1', 'ext-2', 'ext-3'],
  interior: ['int-1', 'int-2', 'int-3'],
};

export interface ProbeCheck {
  id: ProbeId;
  pass: boolean;
  /** Human-readable failure details, fed to the critic (e.g. "slot s3 is 0.4 m from the east wall"). */
  details: string;
}

export interface ProbeResult {
  building: string; // department id
  mode: CaptureMode;
  source: CaptureSource;
  probes: ProbeCheck[];
  stats: { triangles: number; drawCalls: number; lights: number; kitCalls: number };
  consoleErrors: string[];
}

export interface FoundryProbeHandle {
  ready: boolean;
  error?: string;
  result?: ProbeResult;
  setCamera(name: CameraName): Promise<void>;
}

export interface BuildingProbeReport {
  building: string;
  source: CaptureSource;
  probes: ProbeCheck[]; // P1..P10, P1/P2/P6/P7/P8 pass only if they pass in both modes
  probe_score: number; // passed / 10
  critical_pass: boolean;
  screenshots: Partial<Record<CameraName, string>>; // relative paths
  stats: { exterior?: ProbeResult['stats']; interior?: ProbeResult['stats'] };
  consoleErrors: string[];
}

declare global {
  interface Window {
    __foundryProbe?: FoundryProbeHandle;
  }
}
