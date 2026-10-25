import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { acquireAvatarAsset, AvatarRig, disposeNpcObject, instantiateAvatar } from "../../../src/world/npc/AvatarRig";
import { Character } from "../../../src/world/npc/Character";
import { fallbackFace } from "../../../src/world/npc/faces";
import type { CharacterAsset } from "../../../src/world/assets/manifest.contract";
const asset: CharacterAsset = {
  id: "test",
  url: "/avatar.glb",
  lods: ["/avatar-low.glb"],
  skinTone: 2,
  hair: "short",
  build: "average",
  heightM: 1.78,
  bones: { head: "head", neck: "neck", spine: "spine", jaw: "jaw" },
  visemes: { A: "aa", M: "mm" },
  blink: { both: "blink" },
  outfitMaterial: "shirt",
  animations: [],
  triangles: 10,
  credit: { source: "test", url: "https://example.test", license: "CC0" },
};
function gltf(): GLTF {
  const scene = new THREE.Group();
  const head = new THREE.Bone();
  head.name = "head";
  head.rotation.z = 0.2;
  scene.add(head);
  const jaw = new THREE.Bone();
  jaw.name = "jaw";
  head.add(jaw);
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff" });
  material.name = "shirt";
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  mesh.morphTargetDictionary = { aa: 0, mm: 1, blink: 2 };
  mesh.morphTargetInfluences = [0, 0, 0];
  scene.add(mesh);
  return {
    scene,
    scenes: [scene],
    animations: [],
    cameras: [],
    asset: { version: "2.0" },
    parser: {} as GLTF["parser"],
    userData: {},
  };
}
describe("avatar ownership and animation", () => {
  it("keeps single-material meshes single and offsets bones without drift", () => {
    const model = gltf();
    const mesh = model.scene.children.find(
      (n) => n instanceof THREE.Mesh,
    ) as THREE.Mesh;
    const rig = new AvatarRig(model, asset, fallbackFace("x"));
    expect(Array.isArray(mesh.material)).toBe(false);
    const rot = new THREE.Euler(0.1, 0.2, 0);
    rig.update(0.1, rot, { open: 0.07, width: 0.085 }, 0, true, false);
    const first = model.scene.getObjectByName("head")!.quaternion.clone();
    rig.update(0.1, rot, { open: 0.07, width: 0.085 }, 0, true, false);
    expect(
      model.scene.getObjectByName("head")!.quaternion.angleTo(first),
    ).toBeLessThan(0.00001);
    expect(model.scene.getObjectByName("jaw")!.rotation.x).toBeCloseTo(
      Math.PI / 10,
    );
    rig.dispose();
  });
  it("selects a walking clip when locomotion is requested", () => {
    const model = gltf();
    const walk = new THREE.AnimationClip("Walk", 1, []);
    model.animations = [walk];
    const rig = new AvatarRig(model, asset, fallbackFace("x"));
    rig.update(0.1, new THREE.Euler(), { open: 0, width: 0.07 }, 0, false, false, true);
    expect(rig.mixer.existingAction(walk)?.isRunning()).toBe(true);
    rig.dispose();
  });
  it("shares one decoded asset while cloning material and skeleton state per actor", async () => {
    const source = gltf();
    const material = (source.scene.children.find((n) => n instanceof THREE.Mesh) as THREE.Mesh).material as THREE.Material;
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material);
    const bone = new THREE.Bone();
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    source.scene.add(skinned);
    let loads = 0;
    const load = async () => { loads++; return source; };
    const [first, second] = await Promise.all([
      acquireAvatarAsset("/shared.glb", load),
      acquireAvatarAsset("/shared.glb", load),
    ]);
    expect(loads).toBe(1);
    const one = instantiateAvatar(first.gltf), two = instantiateAvatar(second.gltf);
    const oneMesh = one.scene.getObjectByProperty("type", "Mesh") as THREE.Mesh;
    const twoMesh = two.scene.getObjectByProperty("type", "Mesh") as THREE.Mesh;
    expect(oneMesh.geometry).toBe(twoMesh.geometry);
    expect(oneMesh.material).not.toBe(twoMesh.material);
    const oneSkin = one.scene.getObjectByProperty("type", "SkinnedMesh") as THREE.SkinnedMesh;
    const twoSkin = two.scene.getObjectByProperty("type", "SkinnedMesh") as THREE.SkinnedMesh;
    expect(oneSkin.skeleton).not.toBe(twoSkin.skeleton);
    expect(oneSkin.skeleton.bones[0]).not.toBe(twoSkin.skeleton.bones[0]);
    const dispose = vi.spyOn(oneMesh.geometry, "dispose");
    first.release();
    expect(dispose).not.toHaveBeenCalled();
    expect(twoMesh.geometry.getAttribute("position")).toBeTruthy();
    second.release();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("supports closed M and clears mouth morphs when speech stops", () => {
    const model = gltf(),
      rig = new AvatarRig(model, asset, fallbackFace("x"));
    const mesh = model.scene.children.find(
      (n) => n instanceof THREE.Mesh,
    ) as THREE.Mesh;
    for (let i = 0; i < 10; i++)
      rig.update(
        0.1,
        new THREE.Euler(),
        { open: 0, width: 0.07 },
        0.8,
        true,
        false,
      );
    expect(mesh.morphTargetInfluences![1]).toBeGreaterThan(0.95);
    expect(mesh.morphTargetInfluences![2]).toBe(0.8);
    for (let i = 0; i < 10; i++)
      rig.update(
        0.1,
        new THREE.Euler(),
        { open: 0.004, width: 0.072 },
        0,
        false,
        false,
      );
    expect(mesh.morphTargetInfluences![1]).toBeLessThan(0.001);
    rig.dispose();
  });
  it("disposes shared geometry/material/texture only once per object graph", () => {
    const root = new THREE.Group(),
      geometry = new THREE.BoxGeometry(),
      texture = new THREE.Texture(),
      material = new THREE.MeshStandardMaterial({
        map: texture,
        normalMap: texture,
      });
    root.add(
      new THREE.Mesh(geometry, material),
      new THREE.Mesh(geometry, material),
    );
    const g = vi.spyOn(geometry, "dispose"),
      m = vi.spyOn(material, "dispose"),
      t = vi.spyOn(texture, "dispose");
    disposeNpcObject(root);
    expect(g).toHaveBeenCalledTimes(1);
    expect(m).toHaveBeenCalledTimes(1);
    expect(t).toHaveBeenCalledTimes(1);
  });
  it("makes disposal idempotent and seats the fallback without moving its floor origin", () => {
    const c = new Character(fallbackFace("x"));
    const mesh = c.group.getObjectByProperty("type", "Mesh") as THREE.Mesh;
    const dispose = vi.spyOn(mesh.geometry, "dispose");
    c.setSeated(true);
    c.group.updateMatrixWorld(true);
    expect(c.head.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(
      1.21 * c.face.height,
    );
    expect(c.group.position.y).toBe(0);
    c.setSeated(false);
    c.group.updateMatrixWorld(true);
    expect(c.head.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(
      1.64 * c.face.height,
    );
    c.dispose();
    c.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("releases a GLB that finishes after character disposal", async () => {
    let resolve!: (value: GLTF) => void;
    const load = vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    try {
      const c = new Character(fallbackFace("x"), { avatar: asset });
      c.dispose();
      const model = gltf();
      const mesh = model.scene.children.find(
        (n) => n instanceof THREE.Mesh,
      ) as THREE.Mesh;
      const release = vi.spyOn(mesh.geometry, "dispose");
      resolve(model);
      await c.ready;
      expect(release).toHaveBeenCalledTimes(1);
      expect(c.group.children).toHaveLength(0);
    } finally {
      load.mockRestore();
    }
  });
  it("loads and switches LOD1 only beyond eight meters", async () => {
    const load = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockImplementation(async () => gltf());
    try {
      const c = new Character(fallbackFace("x"), { avatar: asset });
      await c.ready;
      c.update(0.1, new THREE.Vector3(0, 0, 2));
      expect(load).toHaveBeenCalledTimes(1);
      c.update(0.1, new THREE.Vector3(0, 0, 10));
      await Promise.resolve();
      await Promise.resolve();
      c.update(0.1, new THREE.Vector3(0, 0, 10));
      expect(load).toHaveBeenLastCalledWith("/avatar-low.glb");
      expect(load).toHaveBeenCalledTimes(2);
      c.dispose();
    } finally {
      load.mockRestore();
    }
  });
});
