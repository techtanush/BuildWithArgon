// OWNER: mahin
import * as THREE from "three";
import { getWorldApi } from "../../shared/worldApi";
import type { Manifest, ManifestBuilding } from "../../shared/contracts";
import {
  EMPTY_MANIFEST,
  type AssetManifest,
} from "../assets/manifest.contract";
import {loadManifest} from "../assets/loadManifest";
import { MaterialLibrary } from "../kit/materials";
import { createLookKit } from "../kit/LookKit";
import { createLights, applyEnvironment } from "../kit/lights";
import { City } from "../city/City";
import {createUrbanManifest,cityHeight,cityOnRoad,urbanEnabled,CITY_LIMIT,cityDistrict} from "../city/urbanLayout";
import { selectedFace, type AvatarSelection, type CameraMode } from "../player/avatarPreferences";
import { Player } from "../player/Player";
import { Car } from "../vehicle/Car";
import { ChaseCamera } from "../vehicle/ChaseCamera";
import { RoadGraph } from "../nav/RoadGraph";
import { Gps } from "../nav/Gps";
import { Race } from "../nav/Race";
import { NpcManager, type ManagedNpc } from "../npc/NpcManager";
import {
  ConversationController,
  type ConversationState,
} from "../conversation/ConversationController";
import { Input } from "./Input";
import { Loop } from "./Loop";
import {
  initialQuality,
  QualityMonitor,
  QUALITY,
  type QualityChoice,
} from "./Quality";
import { SceneManager } from "./SceneManager";
import type { Interior } from "../interiors/Interior";
import type { Collider } from "../player/Collision";
import { speak } from "../conversation/Speech";
import {poll} from "../activity/network";
import {CompletionTracker, loadActivity, type Activity} from "../activity/workplace";
export type Mode =
  | "workplace"
  | "loading"
  | "foot"
  | "car"
  | "conversation"
  | "race"
  | "map"
  | "paused"
  | "transition";
export interface WorldState {
  ventureId: string | null;
  workplace: {departmentId: string; name: string} | null;
  activity: Activity | null;
  activityError: string | null;
  ready: boolean;
  error: string | null;
  mode: Mode;
  place: string;
  scene: string;
  manifest: Manifest | null;
  offline: boolean;
  mock: boolean;
  prompt: string;
  conversation: ConversationState | null;
  remoteConcierge: boolean;
  fps: number;
  calls: number;
  triangles: number;
  quality: QualityChoice;
  actualQuality: string;
  fade: boolean;
  toast: string;
  position: [number, number];
  yaw: number;
  speed: number;
  race: {
    state: string;
    time: number;
    countdown: number;
    countdownLabel?: string;
    checkpoint: number;
    total: number;
    best?: number;
  } | null;
}
export const initialWorldState: WorldState = {
  ventureId: null,
  workplace: null,
  activity: null,
  activityError: null,
  ready: false,
  error: null,
  mode: "loading",
  place: "Founders Plaza",
  scene: "city",
  manifest: null,
  offline: false,
  mock: false,
  prompt: "",
  conversation: null,
  remoteConcierge: false,
  fps: 0,
  calls: 0,
  triangles: 0,
  quality: "auto",
  actualQuality: "high",
  fade: false,
  toast: "",
  position: [0, 16],
  yaw: 0,
  speed: 0,
  race: null,
};
export class Engine {
  readonly api = getWorldApi();
  readonly world = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1600);
  readonly player = new Player(this.camera);
  readonly car = new Car();
  readonly chase = new ChaseCamera(this.camera);
  readonly gps = new Gps();
  readonly quality = new QualityMonitor(initialQuality());
  state: WorldState = {
    ...initialWorldState,
    quality: this.quality.choice,
    actualQuality: this.quality.current,
    mock: this.api.mode === "mock",
  };
  manifest!: Manifest;
  city!: City;
  scenes!: SceneManager;
  cityNpcs!: NpcManager;
  npcs!: NpcManager;
  interior: Interior | null = null;
  graph!: RoadGraph;
  conversation!: ConversationController;
  race!: Race;
  private materials!: MaterialLibrary;
  private view!: ReturnType<typeof createLookKit>;
  private lights?: ReturnType<typeof createLights>;
  private envCleanup?: () => void;
  private lightingRevision=0;
  private assets: AssetManifest = EMPTY_MANIFEST;
  private input: Input;
  private loop: Loop;
  private disposed = false;
  private elapsed = 0;
  private sampleTime = 0;
  private sampleFrames = 0;
  private publishTime = 0;
  private target: (() => void) | null = null;
  private resumeMode: Mode = "foot";
  /** The vehicle/race stays where it is while a remote Nova overlay is open. */
  private conversationResumeMode: "foot" | "car" | "race" = "foot";
  private hotReload = () => {
    if (this.state.ready) location.reload();
  };
  private routeAgent: string | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private transitionToken = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private observer: ResizeObserver;
  private seenArtifacts: Set<string> | null = null;
  private activityStartedAt = Date.now();
  private stopActivity?: () => void;
  private readonly completions = new CompletionTracker();
  private voice?: ReturnType<typeof speak>;
  constructor(
    readonly canvas: HTMLCanvasElement,
    private opts: {
      ventureId: string | null;
      goto?: string;
      avatar?: AvatarSelection;
      cameraMode?: CameraMode;
      onChange: (state: WorldState) => void;
    },
  ) {
    this.state = {...this.state, ventureId: opts.ventureId};
    this.input = new Input(
      canvas,
      (x, y) => {
        if (this.state.mode === "foot" || this.state.mode === "conversation")
          this.player.look(x, y);
      },
      (key, down) => this.onKey(key, down),
    );
    this.loop = new Loop(
      (dt) => this.update(dt),
      (dt) => this.render(dt),
    );
    window.addEventListener("foundry:buildings-changed", this.hotReload);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
  }
  private patch(p: Partial<WorldState>) {
    if (this.disposed) return;
    if (p.mode && p.mode !== this.state.mode) {
      this.input.clear();
      this.player.velocity.set(0, 0, 0);
    }
    this.state = { ...this.state, ...p };
    this.opts.onChange(this.state);
  }
  private later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
  }
  async start() {
    try {
      const result = await this.api.manifest(this.opts.ventureId);
      if (this.disposed) return;
      this.manifest = urbanEnabled()?createUrbanManifest(result.manifest):result.manifest;
      this.patch({ manifest: this.manifest, offline: result.offline });
      this.assets=await loadManifest();
      if (this.disposed) return;
      this.materials = new MaterialLibrary(undefined, this.quality.current);
      await this.materials.load(this.assets, this.quality.current);
      if(this.disposed){this.materials.dispose();return;}
      this.city = new City(this.manifest, this.materials, this.assets);
      this.city.setQuality(this.quality.current);
      this.world.add(this.city.group, this.car.group, this.gps.group);
      const selection=this.opts.avatar ?? {assetId:null,styleId:'slate'};
      this.world.add(this.player.setAvatar(selectedFace(selection),this.assets.characters.find(a=>a.id===selection.assetId)));
      this.player.setCameraMode(this.opts.cameraMode ?? 'third');
      this.cityNpcs = new NpcManager({
        scene: this.city.group,
        manifest: this.manifest,
        buildingId: null,
        assetManifest: this.assets,
      });
      this.npcs = this.cityNpcs;
      this.scenes = new SceneManager(this.manifest, this.assets);
      this.graph = new RoadGraph(this.manifest.roads);
      this.car.teleport(
        this.manifest.plaza.car.pos[0],
        this.manifest.plaza.car.pos[2],
        this.manifest.plaza.car.heading,
      );
      void this.car.loadAsset(this.assets.vehicles[0]);
      this.player.teleport(
        this.manifest.plaza.spawn.pos,
        this.manifest.plaza.spawn.yaw,
      );
      this.view = createLookKit(this.canvas, {
        quality: this.quality.current,
        scene: this.world,
        camera: this.camera,
      });
      this.lighting("exterior");
      this.resize();
      this.race = new Race({
        heightAt: urbanEnabled()?cityHeight:undefined,
        onFinish: () => {
          this.toast("You arrived. Heading inside…");
          this.later(() => {
            if (this.routeAgent) void this.travel(this.routeAgent);
          }, 1200);
        },
      });
      this.world.add(this.race.group);
      this.conversation = new ConversationController({
        api: this.api,
        ventureId: this.opts.ventureId,
        conciergeId: this.manifest.plaza.concierge.agent_id,
        offline: result.offline,
        onChange: (s) => this.patch({ conversation: s }),
        getLipSync: (id) => this.npcs.get(id)?.character.lipSync,
        getAvatarAssetId: (id) => (this.npcs.get(id) ?? this.cityNpcs.get(id))?.character.avatarAssetId,
        onRoute: (id, mode) =>
          mode === "race" ? this.startRace(id) : void this.travel(id),
      });
      this.patch({ ready: true, mode: "foot",place:urbanEnabled()?"Founders Square":"Founders Plaza" });
      if(this.opts.ventureId && !this.state.mock && !result.offline) {
        this.stopActivity = poll(signal => loadActivity(this.opts.ventureId!, signal), data => {
          this.patch({activity:data,activityError:null});
          this.applyActivity();
          if(this.seenArtifacts) {
            for(const artifact of data.artifacts) if(!this.seenArtifacts.has(artifact.id) && artifact.created_at && Date.parse(artifact.created_at)>this.activityStartedAt) this.toast(`New recorded artifact: ${artifact.title}. Open a workspace to inspect it.`,8000);
          }
          const seen=this.seenArtifacts ?? new Set<string>(); for(const artifact of data.artifacts) seen.add(artifact.id); while(seen.size>1000) seen.delete(seen.values().next().value!); this.seenArtifacts=seen;
          for(const run of this.completions.observe(data.runs)) this.toast(`${run.job || run.kind} · ${run.status}. Open a workspace for the recorded run.`,8000);
        }, error => this.patch({activityError:error.message}));
      }
      this.installDebug();
      this.loop.start();
      if (this.opts.goto) void this.travel(this.opts.goto);
      else if(!urbanEnabled())
        this.later(() => {
          if (this.state.mode === "foot") {
            const nova = this.npcs.get(this.manifest.plaza.concierge.agent_id);
            if (nova) this.engage(nova, true);
          }
        }, 800);
    } catch (e) {
      this.patch({
        error: e instanceof Error ? e.message : String(e),
        mode: "paused",
      });
    }
  }
  private lighting(mode: "exterior" | "interior") {
    const revision=++this.lightingRevision;
    this.lights?.dispose();
    this.envCleanup?.();
    this.lights = createLights(
      this.world,
      this.camera,
      mode,
      this.quality.current,
      this.assets,
    );
    void applyEnvironment(
      this.view.renderer,
      this.world,
      mode,
      this.assets,
      ()=>!this.disposed&&revision===this.lightingRevision,
    ).then((cleanup) => {
      if (this.disposed||revision!==this.lightingRevision) cleanup();
      else this.envCleanup = cleanup;
    });
  }
  private resize() {
    if (!this.view) return;
    const rect = this.canvas.getBoundingClientRect();
    this.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
    this.view.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  }
  private colliders(): Collider[] {
    return this.interior?.colliders ?? this.city.colliders;
  }
  private update(dt: number) {
    if (!this.state.ready) return;
    this.elapsed += dt;
    const mode = this.state.mode;
    if (this.input.blocked) this.player.velocity.set(0, 0, 0);
    const moving = ["KeyW", "KeyA", "KeyS", "KeyD"].some((k) =>
      this.input.down(k),
    );
    if (mode === "conversation" && moving) this.closeConversation();
    if (this.state.mode === "foot")
      this.player.update(
        dt,
        {
          forward:
            Number(this.input.down("KeyW")) - Number(this.input.down("KeyS")),
          right:
            Number(this.input.down("KeyD")) - Number(this.input.down("KeyA")),
          sprint: this.input.down("ShiftLeft") || this.input.down("ShiftRight"),
        },
        this.colliders(),
        this.interior ? Infinity : (urbanEnabled()?CITY_LIMIT:310),
      );
    if(this.state.mode === "foot" && !this.interior && urbanEnabled())this.player.position.y += cityHeight(this.player.position.x,this.player.position.z);
    if (mode === "car" || mode === "race") {
      if (this.race.state !== "countdown")
        this.car.update(
          dt,
          {
            throttle: Number(this.input.down("KeyW")),
            brake: this.input.down("KeyS"),
            steer:
              Number(this.input.down("KeyA")) - Number(this.input.down("KeyD")),
            handbrake: this.input.down("Space"),
          },
          this.city.colliders,
          urbanEnabled()?cityOnRoad:undefined,
          urbanEnabled()?CITY_LIMIT:310,
        );
      const ground=urbanEnabled()?cityHeight(this.car.state.x,this.car.state.z):0;if(urbanEnabled())this.car.followTerrain(cityHeight);
      this.chase.update(dt, this.car.state,false,ground,urbanEnabled()?cityHeight:undefined);
      this.race.update(dt, [this.car.state.x, this.car.state.z]);
      this.gps.update(dt, [this.car.state.x, this.car.state.z]);
    }
    const footView = this.state.mode === "foot" || this.state.mode === "conversation";
    this.player.present(dt, footView, this.state.mode === 'foot' && moving && this.player.velocity.lengthSq()>0.01,
      this.interior ? 0 : urbanEnabled() ? cityHeight(this.player.position.x,this.player.position.z) : 0, this.colliders());
    if (mode !== "map" && mode !== "paused" && mode !== "transition") {
      this.city.update(this.elapsed);
      this.npcs.update(dt, this.camera.position);
    }
    if (this.state.mode === "foot") this.findInteraction();
    else if (this.state.prompt) this.patch({ prompt: "" });
    this.lights?.update();
    this.publishTime += dt;
    if (this.publishTime > 0.15) {
      this.publishTime = 0;
      const driving = mode === "car" || mode === "race";
      this.patch({
        position: this.interior ? this.interior.building.plot_center : driving
          ? [this.car.state.x, this.car.state.z]
          : [this.player.position.x, this.player.position.z],
        place:this.interior?this.interior.building.name:urbanEnabled()?cityDistrict(driving?this.car.state.x:this.player.position.x,driving?this.car.state.z:this.player.position.z):"Founders Plaza",
        yaw: driving ? this.car.state.heading : this.player.yaw,
        speed: Math.abs(this.car.state.speed) * 3.6,
        race:
          this.race.state === "idle" || this.race.state === "abandoned"
            ? null
            : {
                state: this.race.state,
                time: this.race.elapsed,
                countdown: this.race.countdown,
                countdownLabel: this.race.countdownLabel,
                checkpoint: this.race.nextCheckpoint,
                total: this.race.checkpoints.length,
                best: this.race.result?.best,
              },
      });
    }
  }
  private render(dt: number) {
    if (!this.view || this.disposed) return;
    this.view.render();
    this.sampleFrames++;
    this.sampleTime += dt;
    if (this.sampleTime >= 1) {
      this.patch({
        fps: Math.round(this.sampleFrames / this.sampleTime),
        calls: this.view.renderer.info.render.calls,
        triangles: this.view.renderer.info.render.triangles,
      });
      this.sampleTime = 0;
      this.sampleFrames = 0;
    }
    const next = this.quality.sample(dt);
    if (next) {
      this.applyQuality();
      this.toast(`Quality adjusted to ${next} for smoother movement.`);
    }
  }
  private findInteraction() {
    let best = Infinity,
      label = "",
      action: (() => void) | null = null;
    const p = this.player.position;
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const offer = (
      point: THREE.Vector3,
      max: number,
      text: string,
      fn: () => void,
    ) => {
      const dx = point.x - p.x,
        dz = point.z - p.z,
        d = Math.hypot(dx, dz);
      const facing =
        d < 1.2 || (dx * forward.x + dz * forward.z) / Math.max(0.001, d) > 0.5;
      if (d <= max && d < best && facing) {
        best = d;
        label = text;
        action = fn;
      }
    };
    for (const npc of this.npcs.entries.values())
      offer(
        npc.position,
        2.2,
        `Talk to ${npc.npc.display_name} · ${npc.npc.title}`,
        () => this.engage(npc),
      );
    if (this.interior) {
      offer(
        new THREE.Vector3(0, 0, 6.2),
        2.2,
        "Leave building",
        () => void this.exitInterior(),
      );
      if (this.interior.building.department_id === "chief-of-staff")
        offer(
          new THREE.Vector3(0, 0, 0),
          2.2,
          "Listen to the latest standup",
          () => void this.playStandup(),
        );
    } else {
      for (const door of this.city.doors)
        offer(
          door.position,
          2.6,
          `Enter ${door.building.name}`,
          () => void this.enterInterior(door.building),
        );
      offer(this.car.group.position, 3.5, "Drive the company car", () =>
        this.enterCar(),
      );
    }
    this.target = action;
    if (label !== this.state.prompt) this.patch({ prompt: label });
  }
  interact() {
    if (!["foot","car","race","conversation"].includes(this.state.mode)) return;
    if (this.state.mode === "conversation") {
      this.closeConversation();
      return;
    }
    if (this.state.mode === "car" || this.state.mode === "race") {
      if (Math.abs(this.car.state.speed) > 2) {
        this.toast("Slow down before leaving the car.");
        return;
      }
      const exit=this.car.exitPosition();if(urbanEnabled())exit[1]+=cityHeight(exit[0],exit[2]);this.player.teleport(exit,this.car.state.heading);
      this.race.cancel();
      this.patch({ mode: "foot" });
      return;
    }
    this.target?.();
  }
  private onKey(code: string, down: boolean) {
    if (!this.state.ready) return;
    if (!down) {
      if (code === "KeyV") void this.conversation.stopPushToTalk();
      return;
    }
    // Keep Nova reachable above every overlay. Input already ignores text fields.
    if (code === "KeyN") {
      this.openNova();
      return;
    }
    if (this.state.mode === "workplace") {
      if(code === "Escape") this.closeWorkplace();
      return;
    }
    if (code === "Escape") {
      if (this.state.mode === "conversation") this.closeConversation();
      else if (this.state.mode === "map" || this.state.mode === "paused")
        this.resume();
      else this.pause();
      return;
    }
    if (code === "KeyM") {
      this.state.mode === "map" ? this.resume() : this.showMap();
      return;
    }
    if (code === "KeyE") {
      this.interact();
      return;
    }
    if (code === "KeyC" && this.state.mode === "conversation") {
      this.conversation.toggleCall();
      return;
    }
    if (code === "KeyV") {
      if (this.state.mode === "foot") {
        const near = this.npcs.nearest(
          this.player.position.clone().setY(0.8),
          2.4,
        );
        if (near) this.engage(near);
      }
      if (this.state.mode === "conversation")
        void this.conversation.startPushToTalk();
    }
    if (
      code === "KeyR" &&
      (this.state.mode === "car" || this.state.mode === "race")
    )
      this.car.reset(this.graph);
    if (
      code === "KeyQ" &&
      (this.state.mode === "car" || this.state.mode === "race")
    ) {
      this.race.cancel();
      this.gps.setPath([]);
      this.patch({ mode: "car" });
      this.toast("Race abandoned.");
    }
    if (code === "Digit1") this.conversation.followRoute("race");
    if (code === "Digit2") this.conversation.followRoute("travel");
  }
  engage(npc: ManagedNpc, greeting = false) {
    this.voice?.stop();
    this.npcs.setActive(npc.npc.agent_id);
    this.conversation.open(npc.npc);
    this.patch({ mode: "conversation", prompt: "", remoteConcierge: false });
    this.input.unlock();
    if (greeting) {
      void this.conversation.greet();
      this.toast(
        "Welcome to Foundry. Ask Nova a question, or explore the town.",
      );
    }
  }
  closeConversation() {
    this.voice?.stop();
    this.conversation?.close();
    this.npcs?.setActive(null);
    const mode = this.state.remoteConcierge ? this.conversationResumeMode : "foot";
    this.patch({ mode, remoteConcierge: false });
  }
  /** Opens the real concierge endpoint without moving the player to Nova's plaza slot. */
  openNova() {
    if (!this.state.ready || this.state.mode === "transition") return;
    const nova = this.manifest.npcs.find(
      (npc) => npc.agent_id === this.manifest.plaza.concierge.agent_id,
    );
    if (!nova) {
      this.toast("Nova is not available in this town.");
      return;
    }
    // Reopening Nova is intentionally a no-op: preserve the current exchange and audio state.
    if (this.state.remoteConcierge && this.state.conversation?.npc?.agent_id === nova.agent_id) return;
    const modalBase = ["map", "paused"].includes(this.state.mode)
      ? this.resumeMode
      : this.state.mode;
    this.conversationResumeMode =
      modalBase === "car" || modalBase === "race" ? modalBase : "foot";
    this.voice?.stop();
    // ConversationController.open closes any old call before switching agents.
    this.npcs?.setActive(null);
    this.conversation.open(nova);
    this.input.unlock();
    this.patch({ mode: "conversation", prompt: "", workplace: null, remoteConcierge: true });
  }
  sendText(text: string) {
    return this.conversation.send(text);
  }
  setAudioEnabled(enabled:boolean) { this.conversation?.setAudioEnabled(enabled); if(!enabled)this.voice?.stop(); }
  toggleCall() { this.conversation.toggleCall(); }
  endCall() { this.conversation.endCall(); }
  muteCall(muted: boolean) { this.conversation.setCallMuted(muted); }
  holdVoice() {
    return this.conversation.startPushToTalk();
  }
  releaseVoice() {
    return this.conversation.stopPushToTalk();
  }
  showMap() {
    this.resumeMode =
      this.state.mode === "car" || this.state.mode === "race"
        ? this.state.mode
        : "foot";
    this.conversation?.close();
    this.input.unlock();
    this.patch({ mode: "map", workplace:null, remoteConcierge: false });
  }
  openWorkplace() {
    const building=this.interior?.building;
    if(!building || !["foot","conversation"].includes(this.state.mode)) return;
    this.conversation?.close(); this.npcs?.setActive(null); this.input.unlock();
    this.patch({mode:"workplace", prompt:"", workplace:{departmentId:building.department_id,name:building.name}, remoteConcierge:false});
  }
  closeWorkplace() {
    this.input.unlock(); this.patch({mode:"foot",workplace:null});
  }
  async meetDepartmentLeads() {
    const building=this.manifest?.buildings.find(b=>b.department_id==="chief-of-staff");
    if(building) await this.enterInterior(building);
    else this.toast("The executive building is not available in this town.");
  }
  private applyActivity() {
    const activity=this.state.activity; if(!activity)return;
    const map: Record<string,{status:string;current_ticket_id?:string;active_run_id?:string;run_status?:string;ticket_status?:string}>={};
    for(const agent of activity.agents) {
      const run=activity.runs.find(r=>r.agent_id===agent.id && r.status==="running");
      const ticket=activity.tickets.find(t=>t.id===run?.ticket_id || (t.id===agent.state.current_ticket_id && t.status==="in_progress"));
      map[agent.id]={status:agent.state.status, ...(run?{active_run_id:run.id,run_status:run.status}:{}), ...(ticket?{current_ticket_id:ticket.id,ticket_status:ticket.status}:{})};
    }
    for(const manager of new Set([this.cityNpcs,this.npcs])) (manager as NpcManager & {applyActivity?:(value:Record<string,{status:string;current_ticket_id?:string;active_run_id?:string;run_status?:string;ticket_status?:string}>)=>void})?.applyActivity?.(map);
  }
  pause() {
    this.resumeMode =
      this.state.mode === "car" || this.state.mode === "race"
        ? this.state.mode
        : "foot";
    this.input.unlock();
    this.patch({ mode: "paused", remoteConcierge: false });
  }
  resume() {
    this.patch({ mode: this.resumeMode });
  }
  private async transition(fn: () => void) {
    if (this.state.mode === "transition") return false;
    const token = ++this.transitionToken;
    this.conversation.close();
    this.input.unlock();
    this.patch({ mode: "transition", fade: true, workplace:null, remoteConcierge:false });
    try {
      await new Promise((r) => setTimeout(r, 120));
      if (this.disposed || token !== this.transitionToken) return false;
      fn();
      await new Promise((r) => setTimeout(r, 80));
      return !this.disposed && token === this.transitionToken;
    } catch (error) {
      console.error("Room transition failed", error);
      this.toast("Could not change rooms. Please try again.");
      return false;
    } finally {
      if (!this.disposed && token === this.transitionToken) {
        this.input.unlock();
        this.player.velocity.set(0, 0, 0);
        this.player.present(0, true, false, this.interior ? 0 : urbanEnabled() ? cityHeight(this.player.position.x, this.player.position.z) : 0, this.colliders());
        this.patch({ mode: "foot", fade: false });
      }
    }
  }
  async enterInterior(building: ManifestBuilding) {
    return this.transition(() => {
      const room = this.scenes.get(building);
      if (this.interior) this.world.remove(this.interior.group);
      this.interior = room;
      this.city.group.visible = false;
      this.car.group.visible = false;
      this.gps.group.visible = false;
      this.race.group.visible = false;
      this.world.add(this.interior.group);
      this.npcs = this.interior.npcs;
      this.applyActivity();
      this.scenes.current = `interior:${building.department_id}`;
      this.player.teleport([0, 1.65, 5.4], 0);
      this.lighting("interior");
      this.patch({ scene: this.scenes.current, place: building.name });
    });
  }
  async exitInterior() {
    const b = this.interior?.building;
    if (!b) return;
    await this.transition(() => {
      const door = this.city.doors.find(
        (d) => d.building.department_id === b.department_id,
      );
      if (!door) throw new Error("Room exit door is unavailable");
      this.showCity();
      const p = door.position.clone();
      p.x -= Math.sin(b.theta) * 2.5;
      p.z += Math.cos(b.theta) * 2.5;
      p.y = 1.65+(urbanEnabled()?cityHeight(p.x,p.z):0);
      this.player.teleport(p, Math.PI - b.theta);
    });
  }
  private showCity() {
    if (this.interior) this.world.remove(this.interior.group);
    this.interior = null;
    this.city.group.visible = true;
    this.car.group.visible = true;
    this.gps.group.visible = true;
    this.race.group.visible = true;
    this.npcs = this.cityNpcs;
    this.scenes.current = "city";
    this.lighting("exterior");
    this.patch({ scene: "city", place: urbanEnabled()?"Founders Square":"Founders Plaza" });
  }
  async travel(agentId: string) {
    const npc = this.manifest.npcs.find((n) => n.agent_id === agentId);
    if (!npc) {
      this.toast("That agent is not in this town.");
      return;
    }
    this.race.cancel();
    this.patch({ remoteConcierge: false });
    this.gps.setPath([]);
    const b = this.manifest.buildings.find(
      (b) => b.building_id === npc.building_id,
    );
    const arrived = b ? await this.enterInterior(b) : await this.transition(() => this.showCity());
    if (!arrived || this.disposed) return;
    const person = this.npcs.get(agentId);
    if (!person) {
      this.toast("This building is missing the agent’s slot.");
      return;
    }
    const angle = person.group.rotation.y;
    const p = person.position
      .clone()
      .add(new THREE.Vector3(Math.sin(angle) * 2, 1.65, Math.cos(angle) * 2));
    p.y = 1.65 + (this.interior ? 0 : urbanEnabled() ? cityHeight(p.x, p.z) : 0);
    this.player.teleport(p, angle);
    this.engage(person);
    void this.conversation.greet();
  }
  enterCar(assisted = false) {
    if(this.interior || this.state.mode !== "foot") return;
    if(!assisted && this.player.position.distanceTo(this.car.group.position.clone().setY(this.player.position.y)) > 3.5) {this.toast("Walk up to the parked company car, then press E.");return;}
    this.conversation.close();
    if(urbanEnabled())this.car.followTerrain(cityHeight);
    this.chase.update(0,this.car.state,true,urbanEnabled()?cityHeight(this.car.state.x,this.car.state.z):0,urbanEnabled()?cityHeight:undefined);
    this.patch({ mode: "car", prompt: "" });
  }
  startRace(agentId: string) {
    const npc = this.manifest.npcs.find((n) => n.agent_id === agentId);
    const building = this.manifest.buildings.find(
      (b) => b.building_id === npc?.building_id,
    );
    if (!building) {
      void this.travel(agentId);
      return;
    }
    this.conversation.close();
    this.patch({ remoteConcierge: false });
    if (this.interior) {
      const departure = this.interior.building;
      this.showCity();
      const d = this.city.doors.find((d) => d.building === departure);
      if (d) this.player.teleport([d.position.x, 1.65, d.position.z], 0);
    }
    this.input.unlock();
    const near = this.graph.nearestNodes(
      this.player.position.x,
      this.player.position.z,
      1,
    )[0];
    if (!near) return;
    const route = this.graph.path(near.pos, building.door_node);
    if (route.length < 2) {
      this.toast("Could not find a route.");
      return;
    }
    const heading = Math.atan2(
      -(route[1][0] - route[0][0]),
      -(route[1][1] - route[0][1]),
    );
    // Keep the ghost on the route centerline and place the player in the adjacent lane.
    this.car.teleport(
      route[0][0] + Math.cos(heading) * 2.6,
      route[0][1] - Math.sin(heading) * 2.6,
      heading,
    );
    this.routeAgent = agentId;
    this.gps.setPath(route,urbanEnabled()?{heightAt:cityHeight,orthogonal:true}:undefined);
    this.race.start(route, building.building_id);
    if(urbanEnabled())for(const child of this.race.group.children)child.position.y+=cityHeight(child.position.x,child.position.z);
    this.chase.update(0,this.car.state,true,urbanEnabled()?cityHeight(this.car.state.x,this.car.state.z):0,urbanEnabled()?cityHeight:undefined);
    this.patch({ mode: "race" });
  }
  async playStandup() {
    this.voice?.stop();
    try {
      const standup = await this.api.standupLatest(
        this.opts.ventureId ?? "ven_mock",
      );
      for (const update of [
        ...standup.updates,
        ...(standup.decisions ? [standup.decisions] : []),
      ]) {
        if (
          this.disposed ||
          this.interior?.building.department_id !== "chief-of-staff"
        )
          break;
        this.toast(
          `${this.manifest.npcs.find((n) => n.agent_id === update.agent_id)?.display_name ?? update.agent_id}: ${update.text}`,
          15000,
        );
        const tts = await this.api.tts(update.agent_id, update.text);
        this.voice = speak(update.text, tts, {
          lipSync: this.npcs.get(update.agent_id)?.character.lipSync,
        });
        await this.voice.done;
      }
    } catch {
      this.toast("Standup playback unavailable.");
    }
  }
  setCameraMode(mode: CameraMode) { this.player.setCameraMode(mode); }
  setQuality(choice: QualityChoice) {
    this.quality.set(choice);
    this.applyQuality();
  }
  private applyQuality() {
    this.view.renderer.setPixelRatio(
      Math.min(devicePixelRatio || 1, QUALITY[this.quality.current].pixelRatio),
    );
    this.view.setQuality(this.quality.current);
    this.city.setQuality(this.quality.current);
    this.lighting(this.interior ? "interior" : "exterior");
    this.resize();
    this.patch({
      quality: this.quality.choice,
      actualQuality: this.quality.current,
    });
  }
  toast(text: string, ms = 4500) {
    clearTimeout(this.toastTimer);
    this.patch({ toast: text });
    this.toastTimer = setTimeout(() => this.patch({ toast: "" }), ms);
  }
  private installDebug() {
    if (import.meta.env.DEV) {
      const self = this;
      (window as any).__foundryDebug = {
        get ready() {
          return self.state.ready;
        },
        get scene() {
          return self.scenes.current;
        },
        get mode() {
          return self.state.mode;
        },
        travel: (id: string) => self.travel(id),
        race: (id: string) => self.startRace(id),
        playerPos: () => self.player.position.toArray(),
        fps: () => self.state.fps,
        interact: () => self.interact(),
        exit: () => self.exitInterior(),
        renderInfo: () => ({ ...self.view.renderer.info.render }),
        pose:(pos:[number,number,number],yaw:number,pitch=0)=>{self.closeConversation();self.player.teleport(pos,yaw);self.player.look(0,-pitch/0.0022);self.camera.rotation.x=pitch;},
        cityManifest:()=>self.manifest,
        visualAssets:()=>({environment:self.world.userData.environmentSource,textures:[...self.materials.cache].filter(([,m])=>!!m.userData.assetTexture).map(([key,m])=>({key,source:m.userData.assetTexture})),hdris:self.assets.hdris.map(h=>h.id)}),
        inspectView:(pos:[number,number,number],target:[number,number,number])=>{self.closeConversation();self.loop.stop();self.camera.position.fromArray(pos);self.camera.lookAt(new THREE.Vector3(...target));self.lights?.update();self.view.render();},
        resumeView:()=>self.loop.start(),
        drive:()=>self.enterCar(),
      };
    }
  }
  dispose() {
    this.stopActivity?.();
    this.disposed = true;
    window.removeEventListener("foundry:buildings-changed", this.hotReload);
    this.transitionToken++;
    this.timers.forEach(clearTimeout);
    clearTimeout(this.toastTimer);
    this.loop.stop();
    this.input.dispose();
    this.observer.disconnect();
    this.voice?.stop();
    this.conversation?.dispose();
    this.cityNpcs?.dispose();
    this.scenes?.dispose();
    this.city?.dispose();
    this.player.dispose();
    this.car.dispose();
    this.gps.dispose();
    this.race?.dispose();
    this.lights?.dispose();
    this.envCleanup?.();
    this.materials?.dispose();
    this.view?.dispose();
    if (import.meta.env.DEV) delete (window as any).__foundryDebug;
  }
}
