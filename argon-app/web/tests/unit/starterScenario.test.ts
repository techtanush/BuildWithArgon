import { describe, expect, it } from "vitest";
import { starterScenario } from "../../src/shared/starterScenario";
describe("starter scenario selection", () => {
  it.each(["Customer support chatbot for shops", "Pantry inventory planner", "Chatbot for hotel reservations"])("keeps unrelated ideas generic: %s", brief => { expect(starterScenario(brief)).toEqual({}); });
  it.each(["AI tutor for calculus", "Tutoring app", "Study assistant for exam revision"])("selects tutoring intent: %s", brief => { expect(starterScenario(brief)).toEqual({scenario: "ai_tutor_demo"}); });
});
