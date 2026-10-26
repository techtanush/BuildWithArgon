/** Only tutoring intent selects the prebuilt tutoring shell. Chatbot alone is generic. */
export function starterScenario(brief: string): {scenario?: "ai_tutor_demo"} {
  return /\b(tutor(?:ing)?|learning companion|study assistant)\b/i.test(brief) ? {scenario: "ai_tutor_demo"} : {};
}
