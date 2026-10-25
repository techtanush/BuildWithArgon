# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

"""Error types rendered as {"error": {"code", "message", "details"}} by app.py.
Adapted from foundry (Zero Downtime build): backend/factory/src/foundry_factory/errors.py."""
from __future__ import annotations

from typing import Any


class KernelError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


class NotFoundError(KernelError):
    def __init__(self, resource: str, identifier: str) -> None:
        super().__init__(404, "not_found", f"{resource} {identifier} was not found")


class ConflictError(KernelError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(409, "conflict", message, details)


class DependencyError(KernelError):
    def __init__(self, dependency: str, message: str, *, unavailable: bool = False) -> None:
        super().__init__(503 if unavailable else 502, "dependency_error", message, {"dependency": dependency})


class GateNotApproved(KernelError):
    def __init__(self, approval_id: str | None, gate_type: str) -> None:
        super().__init__(409, "gate_not_approved", f"{gate_type} action requires an approved approval", {"approval_id": approval_id})


class NotImplementedYet(KernelError):
    def __init__(self, what: str, owner: str) -> None:
        super().__init__(501, "not_implemented", f"{what} is not implemented on this branch yet (owner: {owner})")
