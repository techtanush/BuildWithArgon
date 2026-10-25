# OWNER: karthik — seed version; replace/extend freely but keep the public signatures.
"""`foundry-eval grounding` — 06-execution/04-evals.md §2. Loads evals/fixtures/grounding_state.json into a
temp DB, asks every question in argon-app/evals/grounding/questions.yaml through tanush's
conversation.talk.talk / conversation.concierge.ask, scores facts / citations / routes / fabrication /
checker agreement, writes argon-app/evals/results/grounding-<ts>.json and eval_results rows."""


def main(argv: list[str]) -> None:
    print("grounding eval not implemented yet (owner: karthik)")
