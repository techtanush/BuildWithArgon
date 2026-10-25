# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Ticket type -> handler class ("module:Class"), imported lazily so missing modules don't break startup.
Entries for engineering/support point at ayan's modules and must not be renamed."""
from __future__ import annotations

import importlib
from typing import Any

P = "foundry_kernel.departments."
REGISTRY: dict[str, str] = {
    # tanush
    "brief": P + "intake:IntakeHandler",
    "spec.write": P + "intake:IntakeHandler",
    "review.skeptic": P + "office_hours:OfficeHoursHandler",
    "plan.request": P + "chief_of_staff:ChiefOfStaffHandler",
    "cos.report": P + "chief_of_staff:ChiefOfStaffHandler",
    "cos.standup": P + "chief_of_staff:ChiefOfStaffHandler",
    "capability.gap": P + "chief_of_staff:ChiefOfStaffHandler",
    "agent.request": P + "requests:RequestHandler",
    "chat.reply": P + "chat:ChatReplyHandler",
    "decision.review": P + "pivot:PivotHandler",
    "finance.budget": P + "finance_people:FinancePeopleHandler",
    "people.hire": P + "finance_people:FinancePeopleHandler",
    "research.market": P + "base:ArtifactHandler",
    "research.competitors": P + "base:ArtifactHandler",
    "validation.synthetic_panel": P + "base:ArtifactHandler",
    "validation.interview_plan": P + "base:ArtifactHandler",
    "growth.positioning": P + "base:ArtifactHandler",
    "growth.launch_plan": P + "base:ArtifactHandler",
    "leads.icp": P + "base:ArtifactHandler",
    "sales.proposal": P + "base:ArtifactHandler",
    # ayan (do not rename)
    "eng.design": P + "engineering:EngineeringHandler",
    "eng.build": P + "engineering:EngineeringHandler",
    "eng.fix": P + "engineering:EngineeringHandler",
    "eng.review": P + "engineering:EngineeringHandler",
    "qa.verify": P + "engineering:EngineeringHandler",
    "support.issue": P + "support:SupportHandler",
}


def load_handler(ticket_type: str) -> Any:
    module_name, cls = REGISTRY[ticket_type].split(":")
    return getattr(importlib.import_module(module_name), cls)()
