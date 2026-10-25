# OWNER: tanush
"""Scheduled payment work consumes the same standing grant as agent tools."""
from ..contracts import HandlerResult, NewMessage
from .base import PaymentInstruction, execute_payment_requests, payload


class WalletPaymentHandler:
    ticket_types = ("wallet.pay",)

    async def handle(self, ticket, ctx):
        instruction = PaymentInstruction.model_validate(payload(ticket))
        result = (await execute_payment_requests(ctx, [instruction]))[0]
        status = result["status"]
        return HandlerResult(outcome="failed" if status in {"failed", "blocked"} else "done",
            note=f"Wallet payment execution status: {status}. Only a confirmed receipt proves settlement.",
            result={"wallet_payment": result},
            messages=[NewMessage(channel_slug="dept-finance-people",
                body=f"Payment for invoice {instruction.reference}: {status}. Settlement requires a verified chain receipt.")])
