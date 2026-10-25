// OWNER: mahin
export type Quality = "high" | "medium" | "low";
export type QualityChoice = Quality | "auto";
export const QUALITY = {
  high: { pixelRatio: 1.5, shadows: 2048, trees: 130 },
  medium: { pixelRatio: 1, shadows: 1024, trees: 90 },
  low: { pixelRatio: 0.85, shadows: 1024, trees: 55 },
} as const;
export function initialQuality(search = location.search): QualityChoice {
  const q = new URLSearchParams(search).get("quality");
  if (q === "high" || q === "medium" || q === "low") return q;
  try {
    const saved = localStorage.getItem("foundry.quality");
    if (["high", "medium", "low", "auto"].includes(saved ?? ""))
      return saved as QualityChoice;
  } catch {}
  return "auto";
}
export class QualityMonitor {
  choice: QualityChoice;
  current: Quality;
  private elapsed = 0;
  private frames = 0;
  private slow = 0;
  constructor(choice: QualityChoice) {
    this.choice = choice;
    this.current = choice === "auto" ? "high" : choice;
  }
  set(choice: QualityChoice) {
    this.choice = choice;
    this.current = choice === "auto" ? "high" : choice;
    this.slow = 0;
    try {
      localStorage.setItem("foundry.quality", choice);
    } catch {}
    return this.current;
  }
  sample(dt: number) {
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 2) return null;
    const fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    if (this.choice === "auto" && fps < 35) this.slow += 2;
    else this.slow = 0;
    if (this.slow >= 6 && this.current !== "low") {
      this.current = this.current === "high" ? "medium" : "low";
      this.slow = 0;
      return this.current;
    }
    return null;
  }
}
