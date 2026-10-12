# Supabase database

Apply migrations in order to a new, empty Supabase project.

Current migration:
- `migrations/0001_initial_schema.sql`: core tables, indexes, RLS enabled, limited starter read policies.

Before production, add audited database RPC functions and explicit per-role policies. No broad write policies are included intentionally.
