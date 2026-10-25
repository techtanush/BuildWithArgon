# OWNER: tanush
"""Small persistent-state builders shared by Lane A regression tests."""
from foundry_kernel.ids import new_id, utc_now


async def insert_venture(db, *, budget=25.0, status="draft"):
    vid = new_id("ven")
    now = utc_now()
    async with db.tx() as tx:
        await tx.execute(
            "INSERT INTO ventures (id,name,slug,idea,founder_name,composio_user_id,budget_usd,status,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (vid, "Contract venture", vid, "Useful software", "Tanush", f"foundry:{vid}", budget, status, now, now),
        )
    return vid


async def insert_ticket(db, vid, *, status="open", attempts=0, payload="{}"):
    tid = new_id("tkt")
    now = utc_now()
    async with db.tx() as tx:
        await tx.execute(
            "INSERT INTO tickets (id,venture_id,type,department_id,assigned_agent_id,title,status,attempts,payload_json,created_by,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (tid, vid, "review.skeptic", "office-hours", "oh.skeptic", "Review ambiguities", status, attempts, payload, "human", now, now),
        )
    return tid


async def execute(db, sql, params=()):
    async with db.tx() as tx:
        return await tx.execute(sql, params)
