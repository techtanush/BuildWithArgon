# Migrations

`schema.sql` is the frozen base schema. If your branch needs a new table or column, add a NEW file
here named `NNNN_<yourname>_<what>.sql` (e.g. `0101_ayan_computer_indexes.sql`; tanush uses
0001–0099, ayan 0100–0199, mahin 0200–0299). `db.py` applies them in name order after the base
schema and records them in `schema_migrations`. Never edit `schema.sql` or another person's file.
