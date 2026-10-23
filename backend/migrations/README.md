# Database migrations

`config/schema.sql` is the bootstrap schema and is replayed on every deploy by
`npm run db:migrate`. It must stay idempotent (`CREATE TABLE IF NOT EXISTS`,
`DO` blocks, `ALTER TYPE ... ADD VALUE IF NOT EXISTS`).

After the first deployment, every schema change is a new file in this directory:

- name it `NNN_short_description.sql` (zero-padded, applied in filename order)
- never edit a migration that has already been applied — the runner refuses it
- keep each migration runnable inside a single transaction
