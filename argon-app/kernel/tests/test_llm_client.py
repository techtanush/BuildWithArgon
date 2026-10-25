# OWNER: ayan
"""llm/client.py, jsonout.py, costs.py — no network: the SDK's aio.interactions is replaced by a fake."""
from __future__ import annotations

import base64
import json
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import BaseModel

from foundry_kernel.contracts import Part
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm import client as client_mod
from foundry_kernel.llm.client import (
    LLMCallError,
    LLMClient,
    compose_input,
    extract_media,
    generation_config,
    video_part,
)
from foundry_kernel.llm.costs import estimate
from foundry_kernel.llm.jsonout import LLMOutputError, extract_json
from foundry_kernel.models import JOBS, job


class HTTPError(Exception):
    def __init__(self, code: int) -> None:
        super().__init__(f"HTTP {code}")
        self.status_code = code


def interaction(text: str = "OK", status: str = "completed", iid: str = "int_1", usage: dict[str, int] | None = None,
                steps: list[Any] | None = None) -> Any:
    u = usage if usage is not None else {"total_input_tokens": 100, "total_output_tokens": 40, "total_thought_tokens": 10,
                                         "total_cached_tokens": 20}
    return SimpleNamespace(id=iid, status=status, output_text=text, usage=SimpleNamespace(**u) if u else None,
                           steps=steps or [], output_image=None, output_audio=None, errors=None)


class FakeAio:
    def __init__(self, creates: list[Any], gets: list[Any] | None = None) -> None:
        self.creates = list(creates)
        self.gets = list(gets or [])
        self.create_kwargs: list[dict[str, Any]] = []

    async def create(self, **kw: Any) -> Any:
        self.create_kwargs.append(kw)
        item = self.creates.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def get(self, **kw: Any) -> Any:
        return self.gets.pop(0)

    async def cancel(self, **kw: Any) -> None:
        return None


def make_client(settings: Any, aio: FakeAio, db: Any = None) -> LLMClient:
    c = LLMClient(settings.model_copy(update={"llm_mode": "live", "long_decode_poll_seconds": 0.0}), db)
    c._client = SimpleNamespace(aio=SimpleNamespace(interactions=aio))
    return c


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    async def instant(_s: float) -> None:
        return None

    monkeypatch.setattr(client_mod.asyncio, "sleep", instant)


def test_generation_config_rules() -> None:
    assert generation_config(job("engineering_design")) == {"thinking_level": "high", "max_output_tokens": 65_536}
    assert generation_config(job("talk")) == {"max_output_tokens": 4_096}  # no thinking_level for Flash (V10)
    assert generation_config(job("texture")) == {"image_config": {"aspect_ratio": "4:1"}}  # signs
    assert generation_config(job("worldgen_critic"), "medium")["thinking_level"] == "medium"  # fast live round
    assert "thinking_level" not in generation_config(job("talk"), "medium")
    for j in JOBS.values():
        assert not set(generation_config(j)) & {"thinking_budget", "temperature", "top_p", "top_k", "cached_content"}


def test_compose_input_parts_including_video() -> None:
    assert compose_input("hi") == "hi"
    parts = compose_input([Part(kind="text", text="t"), Part(kind="image", data=b"\x89PNG", mime="image/png"),
                           video_part(b"webm", "video/webm"), Part(kind="audio", data=b"a", mime="audio/wav")])
    assert [p["type"] for p in parts] == ["text", "image", "video", "audio"]
    assert parts[1] == {"type": "image", "mime_type": "image/png", "data": base64.b64encode(b"\x89PNG").decode()}
    # a Part with a video mime is sent as video even if its kind says image (contract has no "video" kind yet)
    assert compose_input([Part(kind="image", data=b"x", mime="video/mp4")])[0]["type"] == "video"


def test_extract_media_from_steps() -> None:
    img = SimpleNamespace(type="image", data=base64.b64encode(b"jpgbytes").decode(), mime_type="image/jpeg")
    aud = SimpleNamespace(type="audio", data=base64.b64encode(b"wav").decode(), mime_type="audio/wav")
    it = interaction(steps=[SimpleNamespace(type="user_input", content=[]), SimpleNamespace(type="model_output", content=[img, aud])])
    images, audio = extract_media(it)
    assert images == [(b"jpgbytes", "image/jpeg")] and audio == [(b"wav", "audio/wav")]


async def test_generate_sends_verified_shape_and_counts_thought_tokens(settings: Any) -> None:
    aio = FakeAio([interaction("OK")])
    res = await make_client(settings, aio).generate("cos_report", "hello", system="be brief", previous_interaction_id="int_0")
    kw = aio.create_kwargs[0]
    assert kw["model"] == "gemini-4-argon" and kw["input"] == "hello" and kw["system_instruction"] == "be brief"
    assert kw["previous_interaction_id"] == "int_0" and kw["generation_config"]["thinking_level"] == "medium"
    assert "background" not in kw
    assert (res.text, res.tokens_in, res.tokens_out, res.cached_in) == ("OK", 100, 50, 20)
    assert res.cost_usd == pytest.approx(((80 + 20 * 0.05) * 2 + 50 * 10) / 1e6) and not res.estimated_cost


async def test_retries_on_503_but_not_on_400(settings: Any) -> None:
    aio = FakeAio([HTTPError(503), HTTPError(429), interaction("fine")])
    assert (await make_client(settings, aio).generate("talk", "x")).text == "fine"
    assert len(aio.create_kwargs) == 3
    aio2 = FakeAio([HTTPError(400)])
    with pytest.raises(LLMCallError) as e:
        await make_client(settings, aio2).generate("talk", "x")
    assert e.value.status_code == 400 and len(aio2.create_kwargs) == 1


async def test_background_long_decode_polls_until_done(settings: Any) -> None:
    progress: list[str] = []

    async def on_progress(msg: str) -> None:
        progress.append(msg)

    aio = FakeAio([interaction("", status="in_progress")], gets=[interaction("", status="queued"), interaction("DONE")])
    res = await make_client(settings, aio).generate("engineering_build", "build", on_progress=on_progress)
    assert res.text == "DONE" and aio.create_kwargs[0]["background"] is True
    assert aio.create_kwargs[0]["generation_config"] == {"thinking_level": "high", "max_output_tokens": 262_144}


async def test_failed_interaction_raises(settings: Any) -> None:
    aio = FakeAio([interaction("", status="failed")])
    with pytest.raises(LLMCallError, match="failed"):
        await make_client(settings, aio).generate("talk", "x")


async def test_accounting_ledger_run_and_logs(settings: Any, db: Any) -> None:
    vid, rid = new_id("ven"), new_id("run")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, composio_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                         (vid, "T", "t", "idea", "Alex", f"foundry:{vid}", utc_now(), utc_now()))
        await tx.execute("INSERT INTO runs (id, venture_id, kind, job, model, status, created_at) VALUES (?,?,?,?,?,?,?)",
                         (rid, vid, "ticket", "cos_report", "gemini-4-argon", "running", utc_now()))
    secret = "AIza" + "S" * 35
    aio = FakeAio([interaction(f"leak {secret}")])
    res = await make_client(settings, aio, db).generate("cos_report", "x", run_id=rid, venture_id=vid, agent_id="cos.orchestrator",
                                                        department_id="chief-of-staff")
    assert "AIza" not in res.text  # redacted
    led = await db.fetch_all("SELECT * FROM ledger WHERE run_id = ?", (rid,))
    assert len(led) == 1 and led[0]["kind"] == "model" and led[0]["units_out"] == 50
    run = await db.fetch_one("SELECT tokens_in, tokens_out, interaction_id, cost_usd FROM runs WHERE id = ?", (rid,))
    assert run["tokens_in"] == 100 and run["interaction_id"] == "int_1" and run["cost_usd"] > 0
    venture = await db.fetch_one("SELECT spent_usd FROM ventures WHERE id = ?", (vid,))
    assert venture["spent_usd"] == pytest.approx(run["cost_usd"])
    logs = [r["message"] for r in await db.fetch_all("SELECT message FROM run_logs WHERE run_id = ?", (rid,))]
    assert logs[0].startswith("→ cos_report model=gemini-4-argon thinking=medium") and logs[-1].startswith("← cos_report tokens_in=100")
    ok = await db.fetch_one("SELECT value_json FROM kv WHERE key = 'provider.gemini.last_ok_at'")
    assert ok is not None


class Flag(BaseModel):
    ok: bool


class SourceQuote(BaseModel):
    ref: str = ""
    quote: str = ""


class ConversationNativeOutput(BaseModel):
    text: str
    citations: list[SourceQuote] = []


async def test_generate_json_repairs_once_with_previous_interaction(settings: Any) -> None:
    aio = FakeAio([interaction("not json", iid="int_a"), interaction('{"ok": true}', iid="int_b")])
    model, res = await make_client(settings, aio).generate_json("triage", "x", Flag)
    assert model.ok is True and res.interaction_id == "int_b"
    assert aio.create_kwargs[1]["previous_interaction_id"] == "int_a"
    aio2 = FakeAio([interaction("nope"), interaction("still nope")])
    with pytest.raises(LLMOutputError):
        await make_client(settings, aio2).generate_json("triage", "x", Flag)


async def test_conversation_native_schema_bounds_authoritative_source_refs(settings: Any) -> None:
    prompt = json.dumps({"question": "What happened?", "source_refs": ["R1", "R2"]})
    aio = FakeAio([interaction('{"text":"Done.","citations":[{"ref":"R1","quote":"Done."}]}')])
    output, _ = await make_client(settings, aio).generate_json("talk", prompt, ConversationNativeOutput)
    assert output.text == "Done."
    schema = aio.create_kwargs[0]["response_format"]
    quote = schema["$defs"]["SourceQuote"]
    assert quote["properties"]["ref"] == {"type": "string", "enum": ["R1", "R2"]}
    assert quote["properties"]["quote"] == {"type": "string", "minLength": 1, "maxLength": 160}
    assert quote["required"] == ["ref", "quote"]
    assert schema["properties"]["text"]["maxLength"] == 1200
    assert schema["properties"]["citations"]["maxItems"] == 6


async def test_run_agent_shape(settings: Any) -> None:
    aio = FakeAio([interaction("", status="queued")], gets=[interaction("hello")])
    res = await make_client(settings, aio).run_agent(agent="antigravity-preview-09-2026", agent_config={"type": "antigravity", "model": "gemini-4-argon"},
                                                     prompt="echo hello", environment="remote")
    kw = aio.create_kwargs[0]
    assert kw["agent"] == "antigravity-preview-09-2026" and kw["environment"] == "remote" and kw["background"] is True
    assert res.text == "hello" and res.model == "gemini-4-argon"


async def test_generate_images(settings: Any) -> None:
    img = SimpleNamespace(type="image", data=base64.b64encode(b"img").decode(), mime_type="image/jpeg")
    aio = FakeAio([interaction("", steps=[SimpleNamespace(type="model_output", content=[img])])])
    res = await make_client(settings, aio).generate_images("texture", "a sign")
    assert res.images == [(b"img", "image/jpeg")] and aio.create_kwargs[0]["response_modalities"] == ["image"]


def test_extract_json_variants() -> None:
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! {"a": [1, 2]} hope that helps') == {"a": [1, 2]}
    assert extract_json('x {"a": "}"} y {"b": 2}') == {"a": "}"}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_costs(monkeypatch: pytest.MonkeyPatch) -> None:
    assert estimate("gemini-4-argon", 1_000_000, 0) == (2.0, False)
    assert estimate("gemini-4-argon", 1_000_000, 0, cached_in=1_000_000)[0] == pytest.approx(0.1)
    assert estimate("gemini-3.8-flash", 1000, 1000) == (0.0, True)
    monkeypatch.setenv("PRICE_GEMINI_3_8_FLASH_IN", "0.5")
    monkeypatch.setenv("PRICE_GEMINI_3_8_FLASH_OUT", "1.5")
    assert estimate("gemini-3.8-flash", 1_000_000, 1_000_000) == (2.0, False)


def test_fake_mode_returns_fake_client(settings: Any) -> None:
    from foundry_kernel.llm.client import build_llm_client
    from foundry_kernel.llm.fake import FakeLLM

    assert isinstance(build_llm_client(settings), FakeLLM)
    assert json.loads(json.dumps({"x": 1})) == {"x": 1}


async def test_incomplete_returns_partial_text(settings: Any) -> None:
    aio = FakeAio([interaction("", status="in_progress")], gets=[interaction("<<<FILE path=\"a.ts\">>>\npartial", status="incomplete")])
    res = await make_client(settings, aio).generate("engineering_build", "x")
    assert res.raw_status == "incomplete" and res.text.endswith("partial")


def test_worldgen_and_system_jobs_match_the_agent_matrix() -> None:
    import json as _json

    from foundry_kernel.config import KERNEL_DIR

    caps = _json.loads((KERNEL_DIR / "data" / "agent_capabilities.json").read_text())
    for name in ("world.architect", "world.critic", "world.face-designer", "world.sign-painter", "computer.driver"):
        assert set(caps["system_agents"][name]["jobs"]) <= set(JOBS)
    assert not {"worldgen_critic_fast", "worldgen_patch_fast", "sign"} & set(JOBS)

async def test_native_json_schema_preserves_repair_accounting(settings: Any, db: Any) -> None:
    aio = FakeAio([interaction("invalid", iid="first"), interaction('{"ok": true}', iid="second")])
    out, _ = await make_client(settings, aio, db).generate_json("triage", "x", Flag)
    assert out.ok
    for call in aio.create_kwargs:
        assert call["response_format"] == Flag.model_json_schema()
        assert call["response_mime_type"] == "application/json"
    assert len(await db.fetch_all("SELECT * FROM ledger")) == 2

async def test_missing_usage_estimates_input_and_marks_cost_estimated(settings: Any) -> None:
    aio = FakeAio([interaction("answer", usage={})])
    res = await make_client(settings, aio).generate("cos_report", "x" * 400)
    assert res.tokens_in == 100 and res.estimated_cost and res.cost_usd > 0

@pytest.mark.parametrize("status", ["failed", "cancelled", "budget_exceeded"])
async def test_failed_interaction_accounts_billable_usage_without_healthy_status(settings: Any, db: Any, status: str) -> None:
    vid, rid = new_id("ven"), new_id("run")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id,name,slug,idea,founder_name,composio_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                         (vid,"T",vid,"idea","Alex",f"foundry:{vid}",utc_now(),utc_now()))
        await tx.execute("INSERT INTO runs (id,venture_id,kind,job,model,status,created_at) VALUES (?,?,?,?,?,?,?)",
                         (rid,vid,"ticket","cos_report","gemini-4-argon","running",utc_now()))
    it = interaction("partial",status=status)
    it.errors = [SimpleNamespace(message="failed with ghp_" + "a" * 30)]
    with pytest.raises(LLMCallError) as exc:
        await make_client(settings, FakeAio([it]), db).generate("cos_report","x",run_id=rid,venture_id=vid)
    assert "ghp_" not in str(exc.value)
    rows = await db.fetch_all("SELECT * FROM ledger WHERE run_id=?", (rid,))
    assert len(rows) == 1 and rows[0]["units_in"] == 100 and rows[0]["units_out"] == 50
    run = await db.fetch_one("SELECT tokens_in,tokens_out,cost_usd FROM runs WHERE id=?", (rid,))
    venture = await db.fetch_one("SELECT spent_usd FROM ventures WHERE id=?", (vid,))
    assert run["tokens_in"] == 100 and run["tokens_out"] == 50 and run["cost_usd"] > 0
    assert venture["spent_usd"] == pytest.approx(run["cost_usd"])
    assert await db.fetch_one("SELECT * FROM kv WHERE key='provider.gemini.last_ok_at'") is None
    error = await db.fetch_one("SELECT value_json FROM kv WHERE key='provider.gemini.last_error'")
    assert error and "ghp_" not in error["value_json"]
