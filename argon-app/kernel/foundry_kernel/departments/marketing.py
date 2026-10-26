"""Marketing plan export from actual model output; no publishing credentials or network."""
from __future__ import annotations

import hashlib
import io
import textwrap
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from ..contracts import NewMessage
from ..records import clean
from .base import ArtifactHandler, payload


def render_plan_pdf(title: str, content: str) -> bytes:
    """Plain-text, paginated PDF. Markdown/HTML/URLs are inert text, never executable."""
    if not content.strip():
        raise ValueError("Cannot export an empty marketing plan")
    if len(content) > 500_000:
        raise ValueError("Marketing plan exceeds export limit")
    lines = []
    for paragraph in (title + "\n\n" + content).splitlines():
        # PDF literal strings cannot inject objects, scripts, actions, or links.
        normalized = paragraph.expandtabs(4).encode("cp1252", "replace").decode("cp1252")
        lines.extend(textwrap.wrap(normalized, width=84, replace_whitespace=True) or [""])
    writer = PdfWriter()
    font = writer._add_object(DictionaryObject({NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Courier"),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding")}))
    for start in range(0, len(lines), 49):
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        commands = [b"BT /F1 10 Tf 14 TL 48 744 Td"]
        for line in lines[start:start + 49]:
            raw = line.encode("cp1252").replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
            raw = bytes(c if c >= 32 else 32 for c in raw)
            commands.append(b"(" + raw + b") Tj T*")
        commands.append(b"ET")
        stream = DecodedStreamObject()
        stream.set_data(b"\n".join(commands))
        page[NameObject("/Contents")] = writer._add_object(stream)
    target = io.BytesIO()
    writer.write(target)
    return target.getvalue()


class MarketingHandler(ArtifactHandler):
    ticket_types = ("growth.launch_plan",)

    async def handle(self, ticket, ctx):
        ticket = {**ticket, "body": ticket.get("body", "") + "\nInclude a final section headed '## LinkedIn post' containing a polished 120-220 word app-specific launch post, plain text only, grounded exclusively in actual venture context and plan. Lead with the customer's problem and specific product value; end with one honest call to action. Never invent traction, launch status, URLs, or users. Draft only; do not publish."}
        if payload(ticket).get("research") is True:
            from .marketing_research import researched_plan
            result = await researched_plan(ticket, ctx)
        else:
            result = await super().handle(ticket, ctx)
        if result.outcome != "done":
            return result
        for artifact in result.artifacts:
            if artifact.kind != "plan":
                continue
            artifact.title = clean(artifact.title, ctx.settings)
            artifact.content_md = clean(artifact.content_md, ctx.settings)
            artifact.summary = clean(artifact.summary, ctx.settings)
            document = render_plan_pdf(artifact.title, artifact.content_md)
            digest = hashlib.sha256(document).hexdigest()
            root = Path(ctx.settings.data_dir) / "marketing-pdfs"
            root.mkdir(parents=True, exist_ok=True)
            (root / (digest + ".pdf")).write_bytes(document)
            artifact.uri = f"/v1/ventures/{ctx.venture['id']}/marketing/{digest}.pdf"
            # Exact intended destination, not a claim of connection, approval, or publication.
            artifact.meta.update({"pdf_sha256": digest, "pdf_mime": "application/pdf",
                "publication_status": "awaiting_github_and_approved_publisher",
                "publication_branch": "marketing", "publication_paths": ["marketing/plan.md", "marketing/plan.pdf"],
                "publication_note": "Local PDF ready. GitHub publication is not implemented; requires the venture's connected repository and exact-content approval."})
        if payload(ticket).get("research") is True:
            from .marketing_research import post_as
            plan_artifact = next(a for a in result.artifacts if a.kind == "plan")
            basis = "No external market research verified; assumptions and validation tasks only. Relevant sources can be added later." if plan_artifact.meta.get("research_mode") == "brief_based" else "Based on retrieved official sources; draft only, nothing published."
            await post_as(ctx, "gr.growth-planner", "Marketing plan PDF is ready: " + plan_artifact.uri + ". SHA-256: " + plan_artifact.meta["pdf_sha256"] + ". " + basis)
        result.messages.append(NewMessage(channel_slug="dept-growth", body="Marketing plan and PDF are ready. GitHub publication awaits a connected venture repository and an approved scoped publisher; nothing was pushed."))
        return result
