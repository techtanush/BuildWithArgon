.PHONY: dev kernel web test test-kernel test-web typecheck worldgen eval api-types seed manifest ownership

kernel:
	cd kernel && uv run uvicorn foundry_kernel.app:app --host 127.0.0.1 --port 8787 --reload

web:
	cd web && pnpm dev

dev:
	$(MAKE) -j2 kernel web

seed:
	cd kernel && uv run python -m foundry_kernel.seed

api-types:
	cd web && pnpm gen:api

test: test-kernel test-web

test-kernel:
	cd kernel && uv run pytest -q

test-web:
	cd web && pnpm typecheck && pnpm test

typecheck:
	cd web && pnpm typecheck

worldgen:
	cd kernel && uv run foundry-worldgen --all

eval:
	cd kernel && uv run foundry-eval engineering && uv run foundry-eval grounding

# Regenerate the world's offline manifest from the frozen layout module.
manifest:
	cd kernel && uv run python -m foundry_kernel.world_layout > ../web/src/world/data/manifest.fallback.json

# Usage: make ownership WHO=ayan   (checks files changed vs origin/main)
ownership:
	python3 scripts/check_ownership.py $(WHO)
