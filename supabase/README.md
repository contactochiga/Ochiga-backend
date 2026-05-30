# Ochiga Backend Supabase Migration Workflow

This folder contains Supabase CLI-ready migrations for the Ochiga backend.

## Current Policy

- Do not commit `.env` files or secrets.
- Do not paste service role keys into migration files.
- Do not run production `db push` unless the Supabase project reference and credentials are confirmed.
- Keep source SQL in `migrations/` if needed for historical compatibility, but copy production-ready migrations into `supabase/migrations/` using Supabase timestamp filenames.

## Required CLI Setup

Install the Supabase CLI if it is not available:

```bash
brew install supabase/tap/supabase
```

Or use the official Supabase installation method for your environment.

Verify:

```bash
supabase --version
```

## Link The Project

Run this only after confirming the correct production or staging project reference:

```bash
supabase link --project-ref <PROJECT_REF>
```

## Push Migrations

Run this only after the project is linked and credentials are confirmed:

```bash
supabase db push
```

## Filename Rules

Supabase migrations should use timestamp-style filenames:

```text
YYYYMMDDHHMMSS_descriptive_name.sql
```

Examples:

```text
20260522000200_ai_command_hardening.sql
20260522000100_edge_phase1_hardening.sql
```

## Adding Future Migrations

1. Create a SQL file in `supabase/migrations/` with a valid timestamp filename.
2. Use `create table if not exists`, `alter table if exists`, and `create index if not exists` where possible.
3. Avoid destructive changes unless they are planned and backed up.
4. Never include credentials, API keys, tokens, passwords, private keys, or local paths.
5. Run local review/checks before pushing.
6. Link the correct Supabase project.
7. Run `supabase db push` only after confirmation.

## Current Migration Set

The current migration set was copied from backend `migrations/` into `supabase/migrations/` and renamed to Supabase-valid filenames. `migrations/schema.sql` was intentionally not copied because it is a base schema dump, not a timestamped migration.
