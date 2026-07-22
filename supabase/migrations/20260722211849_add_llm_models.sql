-- Admin-curated catalog of LLM models offered for enrichment. Rows are
-- edited directly in Supabase Studio (service role bypasses RLS); the app
-- only ever reads this table. After the seed below, row content is
-- operational data, NOT schema — future model additions/edits happen in
-- Studio, never in migrations.

create table public.llm_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(btrim(provider)) > 0),
  model_id text not null check (char_length(btrim(model_id)) > 0),
  label text not null check (char_length(btrim(label)) > 0),
  enabled boolean not null default true,
  is_default boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (provider, model_id),
  -- Studio edits bypass app validation; constraints are the only guard.
  constraint llm_models_default_enabled check (not is_default or enabled)
);

-- At most one default row. Swapping the default in Studio is a two-step
-- edit: clear the old row first, then set the new one.
create unique index llm_models_single_default_idx
  on public.llm_models (is_default)
  where is_default;

alter table public.llm_models enable row level security;

-- Shared read-only reference table: any signed-in user reads it; no write
-- policies on purpose — writes happen via Studio / service role only.
create policy "llm_models_select_authenticated"
  on public.llm_models for select
  to authenticated
  using (true);

insert into public.llm_models
  (provider, model_id, label, enabled, is_default, sort_order)
values
  ('openai', 'gpt-5.4-mini', 'GPT-5.4 mini — recommended', true, true, 0),
  ('openai', 'gpt-5.4-nano', 'GPT-5.4 nano — fastest, cheapest', true, false, 1),
  ('openai', 'gpt-5.4', 'GPT-5.4 — highest quality', false, false, 2);
