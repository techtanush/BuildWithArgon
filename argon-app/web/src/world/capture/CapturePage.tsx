// OWNER: mahin
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Manifest } from "../../shared/contracts";
import manifestData from "../data/manifest.fallback.json";
import { createKit } from "../kit/primitives";
import { createRenderer } from "../kit/LookKit";
import { createComposer } from "../kit/post";
import { applyEnvironment, createLights } from "../kit/lights";
import { fallbackModule } from "../buildings/fallback/archetypes";
import { generatedModules } from "../buildings/generated";
import { Character } from "../npc/Character";
import { faceForNpc } from "../npc/faces";
import { pickAvatar } from "../npc/avatars";
import { loadManifest } from "../assets/loadManifest";
import { MaterialLibrary } from "../kit/materials";
import type { BuildingModule, Vec3 } from "../kit/types";
import { recordKit, runProbes, type ProbeRecording } from "../probes/probes";
import {
  CAMERAS,
  WALK_PATH_SECONDS,
  type CameraName,
  type CaptureMode,
  type CaptureSource,
  type FoundryProbeHandle,
  type WalkPath,
} from "../probes/types";

const staging = import.meta.glob<{ default: BuildingModule }>(
  "../buildings/staging/*.ts",
);
export const CAMERA_POSES: Record<
  CameraName,
  { position: Vec3; target: Vec3 }
> = {
  "ext-1": { position: [0, 1.7, 30], target: [0, 5, 0] },
  "ext-2": { position: [-24, 8, 24], target: [0, 4, 0] },
  "ext-3": { position: [18, 34, 18], target: [0, 0, 0] },
  "int-1": { position: [0, 1.65, 6], target: [0, 1.4, -7] },
  "int-2": { position: [7.5, 3.6, 5.5], target: [-3, 0.5, -3] },
  "int-3": { position: [0, 12, 0.01], target: [0, 0, 0] },
  portrait: { position: [0.9, 1.68, 1.75], target: [0, 1.55, 0] },
};
const emptyRecording = (): ProbeRecording => ({
  calls: 0,
  colliders: [],
  slots: [],
  entrances: [],
  signs: [],
  lights: 0,
});
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Capture is deliberately static: only playPath schedules animation frames. */
export default function CapturePage() {
  const root = useRef<HTMLDivElement>(null);
  const query = new URLSearchParams(window.location.search);
  const portrait = query.get("mode") === "portrait";
  useEffect(() => {
    let disposed = false,
      frame = 0,
      playing = false;
    let cancelPath: (() => void) | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let cleanupScene: (() => void) | undefined;
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.message);
    const onReject = (event: PromiseRejectionEvent) =>
      errors.push(errorText(event.reason));
    const previousConsoleError = console.error;
    const captureError = (...args: unknown[]) => {
      errors.push(args.map(errorText).join(" "));
      previousConsoleError(...args);
    };
    console.error = captureError;
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    const handle: FoundryProbeHandle = {
      ready: false,
      setCamera: async () => {
        throw new Error("Capture not ready");
      },
      playPath: async () => {
        throw new Error("Capture not ready");
      },
    };
    window.__foundryProbe = handle;
    const boot = async () => {
      const params = new URLSearchParams(window.location.search);
      const mode = (params.get("mode") ?? "exterior") as CaptureMode;
      const source = (params.get("source") ?? "fallback") as CaptureSource;
      if (!["exterior", "interior", "portrait"].includes(mode))
        throw new Error(`Invalid capture mode: ${mode}`);
      if (!["fallback", "generated", "staging"].includes(source))
        throw new Error(`Invalid capture source: ${source}`);
      const manifest = manifestData as Manifest;
      const building = params.get("building") ?? "engineering";
      const definition = manifest.buildings.find(
        (b) => b.department_id === building,
      );
      if (mode !== "portrait" && !definition)
        throw new Error(`Unknown department: ${building}`);
      const width = mode === "portrait" ? 768 : 1280,
        height = mode === "portrait" ? 768 : 720;
      const canvas = document.createElement("canvas");
      root.current!.appendChild(canvas);
      renderer = createRenderer(canvas, "high");
      renderer!.setPixelRatio(1);
      renderer!.setSize(width, height);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        mode === "portrait" ? 35 : 50,
        width / height,
        0.05,
        180,
      );
      const lighting = createLights(
        scene,
        camera,
        mode === "interior" ? "interior" : "exterior",
        "high",
      );
      const composer = createComposer(
        renderer,
        scene,
        camera,
        width,
        height,
        "high",
      );
      let kitBuild: ReturnType<typeof createKit> | undefined,
        character: Character | undefined;
      let recording = emptyRecording();
      const resources: THREE.Object3D[] = [];
      const materials = new MaterialLibrary(
        {
          accent: definition?.color ?? "#8193a6",
          accentDark: new THREE.Color(definition?.color ?? "#8193a6")
            .multiplyScalar(0.55)
            .getStyle(),
        },
        "high",
      );
      cleanupScene = () => {
        kitBuild?.dispose();
        character?.dispose();
        lighting.dispose();
        composer.dispose();
        materials.dispose();
        scene.environment?.dispose();
        resources.forEach((o) =>
          o.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              for (const m of Array.isArray(obj.material)
                ? obj.material
                : [obj.material])
                m.dispose();
            }
          }),
        );
      };
      const assets = await loadManifest();
      await materials.load(assets);
      await applyEnvironment(
        renderer,
        scene,
        mode === "interior" ? "interior" : "exterior",
        assets,
      );
      if (disposed) return;
      if (mode === "portrait") {
        const id = params.get("agent") ?? "eng.builder";
        const npc = manifest.npcs.find((n) => n.agent_id === id);
        if (!npc) throw new Error(`Unknown agent: ${id}`);
        const color =
          manifest.buildings.find((b) => b.department_id === npc.department_id)
            ?.color ?? "#8193a6";
        scene.background = new THREE.Color(color);
        const face = faceForNpc(
            npc,
            npc.agent_id === "concierge" ? "#C6A34B" : color,
          ),
          used = new Set<string>();
        let avatar: ReturnType<typeof pickAvatar> = undefined;
        for (const peer of manifest.npcs.filter(
          (n) => n.building_id === npc.building_id,
        )) {
          const selected = pickAvatar(
            faceForNpc(peer, peer.agent_id === "concierge" ? "#C6A34B" : color),
            assets.characters,
            used,
          );
          if (selected) used.add(selected.id);
          if (peer.agent_id === id) {
            avatar = selected;
            break;
          }
        }
        character = new Character(face, { avatar });
        await character.ready;
        if (disposed) return;
        scene.add(character.group);
        // Three-point studio setup, additional to soft environment fill.
        for (const [color, intensity, pos] of [
          [0xffe7d6, 4, [2, 3, 3]],
          [0xdceaff, 2, [-2, 2, 2]],
          [0xffffff, 5, [0, 3, -2]],
        ] as const) {
          const light = new THREE.DirectionalLight(color, intensity);
          light.position.set(pos[0], pos[1], pos[2]);
          scene.add(light);
        }
      } else {
        let module: BuildingModule;
        if (source === "fallback") module = fallbackModule(building);
        else if (source === "generated") {
          const found = generatedModules[building];
          if (!found) throw new Error(`No generated module for ${building}`);
          module = found;
        } else {
          const loader = staging[`../buildings/staging/${building}.ts`];
          if (!loader) throw new Error(`No staging module for ${building}`);
          module = (await loader()).default;
        }
        kitBuild = createKit({
          mode,
          departmentId: building,
          materials,
          shell: module.interiorShell,
          colors: {
            accent: definition!.color,
            accentDark: new THREE.Color(definition!.color)
              .multiplyScalar(0.55)
              .getStyle(),
          },
        });
        const recorder = recordKit(kitBuild.kit);
        recording = recorder.recording;
        // Failed requested modules must not silently render a fallback and score as successful.
        if (mode === "exterior") module.buildExterior(recorder.kit);
        else module.buildInterior(recorder.kit);
        kitBuild.finalize();
        recording.colliders = kitBuild.recording.colliders.map((c) => ({
          x: c.x,
          z: c.z,
          halfX: c.halfX ?? c.radius ?? 0,
          halfZ: c.halfZ ?? c.radius ?? 0,
          yaw: c.rotY,
          minY: c.yMin,
          maxY: c.yMax,
          radius: c.kind === "circle" ? c.radius : undefined,
        }));
        scene.add(kitBuild.group);
        if (mode === "exterior") {
          const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(60, 60),
            materials.get("grass"),
          );
          ground.rotation.x = -Math.PI / 2;
          ground.position.y = -0.03;
          ground.receiveShadow = true;
          scene.add(ground);
          resources.push(ground);
        }
      }
      const render = () => {
        if (disposed) return;
        lighting.update();
        renderer!.info.reset();
        composer.render();
      };
      const setPose = (name: CameraName) => {
        const pose = CAMERA_POSES[name];
        camera.position.fromArray(pose.position);
        camera.lookAt(...pose.target);
        camera.updateMatrixWorld();
        kitBuild?.group.traverse((o) => {
          if (/ceiling/i.test(o.name)) o.visible = name !== "int-3";
        });
      };
      const refreshResult = () => {
        const bounds: { min: Vec3; max: Vec3 }[] = [];
        kitBuild?.group.updateMatrixWorld(true);
        kitBuild?.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            const box = new THREE.Box3().setFromObject(obj);
            bounds.push({
              min: box.min.toArray() as Vec3,
              max: box.max.toArray() as Vec3,
            });
          }
        });
        let signVisibility:
          { areaRatio: number; unoccluded: boolean } | undefined;
        if (mode === "exterior" && kitBuild && recording.signs.length === 1) {
          const sign = recording.signs[0],
            probeCamera = camera.clone();
          probeCamera.position.fromArray(CAMERA_POSES["ext-1"].position);
          probeCamera.lookAt(...CAMERA_POSES["ext-1"].target);
          probeCamera.updateMatrixWorld();
          const center = new THREE.Vector3(...sign.pos),
            right = new THREE.Vector3(
              Math.cos(sign.rotY ?? 0),
              0,
              -Math.sin(sign.rotY ?? 0),
            );
          const points = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([x, y]) =>
            center
              .clone()
              .addScaledVector(right, (x * sign.width) / 2)
              .add(new THREE.Vector3(0, (y * sign.width) / 8, 0))
              .project(probeCamera),
          );
          const area =
            Math.abs(
              points.reduce((sum, p, i) => {
                const q = points[(i + 1) % 4];
                return sum + p.x * q.y - q.x * p.y;
              }, 0),
            ) / 8;
          const ray = new THREE.Raycaster(
            probeCamera.position,
            center.clone().sub(probeCamera.position).normalize(),
          );
          const hits = ray.intersectObject(kitBuild.group, true);
          const first = hits[0];
          const signMesh = kitBuild.recording.signs[0]?.mesh;
          let hitSign = false;
          for (
            let obj: THREE.Object3D | undefined = first?.object;
            obj;
            obj = obj.parent ?? undefined
          ) {
            if (obj === signMesh) hitSign = true;
          }
          signVisibility = {
            areaRatio: points.every(
              (p) =>
                Math.abs(p.x) <= 1 &&
                Math.abs(p.y) <= 1 &&
                p.z >= -1 &&
                p.z <= 1,
            )
              ? area
              : 0,
            unoccluded: hitSign,
          };
        }
        // Geometry accounting is independent of camera occlusion and excludes the capture ground/post passes.
        handle.result = runProbes({
          building,
          mode,
          source,
          recording,
          bounds,
          triangles:
            kitBuild?.recording.triangles ?? renderer!.info.render.triangles,
          drawCalls:
            kitBuild?.recording.drawCalls ?? renderer!.info.render.calls,
          consoleErrors: errors,
          signVisibility,
        });
      };
      handle.setCamera = async (name) => {
        if (!CAMERAS[mode].includes(name))
          throw new Error(`Camera ${name} is invalid for ${mode}`);
        if (playing) throw new Error("Camera path is running");
        setPose(name);
        render();
        refreshResult();
      };
      handle.playPath = async (name: WalkPath) => {
        if (
          (mode === "exterior" && name !== "ext-orbit") ||
          (mode === "interior" && name !== "int-walk") ||
          mode === "portrait"
        )
          throw new Error(`Path ${name} is invalid for ${mode}`);
        if (playing) throw new Error("Camera path is already running");
        playing = true;
        kitBuild?.group.traverse((o) => {
          if (/ceiling/i.test(o.name)) o.visible = true;
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const started = performance.now();
            cancelPath = () => reject(new Error("Capture disposed"));
            const tick = (now: number) => {
              if (disposed) return;
              const t = Math.min(
                1,
                (now - started) / (WALK_PATH_SECONDS[name] * 1000),
              );
              if (name === "ext-orbit") {
                const angle = t * Math.PI * 2;
                camera.position.set(
                  Math.sin(angle) * 24,
                  1.7 + 6.3 * t,
                  Math.cos(angle) * 24,
                );
                camera.lookAt(0, 4, 0);
              } else {
                camera.position.set(0, 1.65, 6 * (1 - t));
                camera.lookAt(Math.sin((t * Math.PI) / 2) * 3, 1.4, -7);
              }
              render();
              if (t < 1) frame = requestAnimationFrame(tick);
              else resolve();
            };
            frame = requestAnimationFrame(tick);
          });
        } finally {
          playing = false;
          cancelPath = undefined;
        }
        refreshResult();
      };
      await handle.setCamera(CAMERAS[mode][0]);
      handle.ready = true;
    };
    void boot().catch((error) => {
      if (!disposed) {
        handle.error = errorText(error);
        handle.result = runProbes({
          building: query.get("building") ?? "engineering",
          mode: (query.get("mode") ?? "exterior") as CaptureMode,
          source: (query.get("source") ?? "fallback") as CaptureSource,
          recording: emptyRecording(),
          bounds: [],
          triangles: 0,
          drawCalls: 0,
          consoleErrors: errors,
          buildError: errorText(error),
        });
        handle.ready = true;
      }
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelPath?.();
      cleanupScene?.();
      renderer?.dispose();
      root.current?.replaceChildren();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
      if (console.error === captureError) console.error = previousConsoleError;
      if (window.__foundryProbe === handle) delete window.__foundryProbe;
    };
  }, []);
  return (
    <div
      id="capture-root"
      ref={root}
      style={{
        width: portrait ? 768 : 1280,
        height: portrait ? 768 : 720,
        overflow: "hidden",
        background: "#121821",
      }}
    />
  );
}
