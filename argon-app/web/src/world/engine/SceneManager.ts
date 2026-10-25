// OWNER: mahin
import { Interior } from "../interiors/Interior";
import type { Manifest, ManifestBuilding } from "../../shared/contracts";
import type { AssetManifest } from "../assets/manifest.contract";
/** Four-interior LRU, independently disposed from shared town materials. */
export class SceneManager {
  current = "city";
  private cache = new Map<string, Interior>();
  constructor(
    private manifest: Manifest,
    private assets?: AssetManifest,
  ) {}
  get(building: ManifestBuilding) {
    let entry = this.cache.get(building.department_id);
    if (entry) this.cache.delete(building.department_id);
    else entry = new Interior(building, this.manifest, this.assets);
    this.cache.set(building.department_id, entry);
    while (this.cache.size > 4) {
      const key = this.cache.keys().next().value!;
      this.cache.get(key)!.dispose();
      this.cache.delete(key);
    }
    return entry;
  }
  dispose() {
    this.cache.forEach((x) => x.dispose());
    this.cache.clear();
  }
}
