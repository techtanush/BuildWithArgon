/** Presentation-only conference layout; never changes company records. */
export const executiveSeats = Array.from({length: 12}, (_, i) => ({position: [(i % 2 ? 1 : -1) * 1.15, 0, -2.5 + Math.floor(i / 2)] as [number, number, number], facingY: i % 2 ? -Math.PI / 2 : Math.PI / 2}));
executiveSeats.push({position: [0, 0, -3.5], facingY: 0});
export const demoBriefing = [
 {department: "Engineering", speaker: "Engineering executive", text: "I am currently engineering an AI tutor app. In this scripted demo, the team is preparing a learner flow, lesson screen, and practice feedback."},
 {department: "Marketing", speaker: "Marketing executive", text: "I am writing the growth plan and post. In this scripted demo, the plan covers the AI tutor audience, launch message, and a sample social post."},
 {department: "Executive HQ", speaker: "Chief of Staff", text: "Demo briefing complete. Engineering and Marketing align on the tutor launch. Open Recorded work / communications for actual company records."},
] as const;
