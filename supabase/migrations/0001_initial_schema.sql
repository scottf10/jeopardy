create extension if not exists pgcrypto;
create extension if not exists citext;

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  active boolean not null default false,
  coverage_threshold numeric(4, 3) not null default 0.500,
  max_groups integer not null default 10,
  scoring_version text not null default '1.0',
  content_version text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint decks_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint decks_name_not_blank check (length(btrim(name)) between 1 and 100),
  constraint decks_description_length check (description is null or length(description) <= 500),
  constraint decks_coverage_threshold_range check (coverage_threshold between 0 and 1),
  constraint decks_max_groups_range check (max_groups between 1 and 10),
  constraint decks_scoring_version_not_blank check (length(btrim(scoring_version)) between 1 and 30),
  constraint decks_content_version_not_blank check (length(btrim(content_version)) between 1 and 100)
);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  term_key text not null,
  label citext not null,
  sort_order integer not null,
  constraint terms_deck_id_id_unique unique (deck_id, id),
  constraint terms_key_unique unique (deck_id, term_key),
  constraint terms_label_unique unique (deck_id, label),
  constraint terms_sort_order_unique unique (deck_id, sort_order),
  constraint terms_key_format check (term_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint terms_label_not_blank check (length(btrim(label)) between 1 and 100),
  constraint terms_sort_order_positive check (sort_order > 0)
);

create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  term_a_id uuid not null,
  term_b_id uuid not null,
  weight numeric(4, 3) not null,
  constraint relationships_term_a_foreign
    foreign key (deck_id, term_a_id) references public.terms(deck_id, id) on delete cascade,
  constraint relationships_term_b_foreign
    foreign key (deck_id, term_b_id) references public.terms(deck_id, id) on delete cascade,
  constraint relationships_pair_order check (term_a_id < term_b_id),
  constraint relationships_pair_unique unique (deck_id, term_a_id, term_b_id),
  constraint relationships_weight_range check (weight between 0 and 1)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  client_attempt_id uuid not null unique,
  user_id text not null,
  deck_id uuid not null references public.decks(id) on delete restrict,
  groups_json jsonb not null,
  relationship_quality numeric(6, 2) not null,
  weighted_coverage numeric(6, 2) not null,
  final_score numeric(6, 2) not null,
  scoring_version text not null,
  content_version text not null,
  submitted_at timestamptz not null default now(),
  constraint attempts_user_id_format check (user_id ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint attempts_groups_is_array check (jsonb_typeof(groups_json) = 'array'),
  constraint attempts_relationship_quality_range check (relationship_quality between 0 and 100),
  constraint attempts_weighted_coverage_range check (weighted_coverage between 0 and 100),
  constraint attempts_final_score_range check (final_score between 0 and 100),
  constraint attempts_scoring_version_not_blank check (length(btrim(scoring_version)) between 1 and 30),
  constraint attempts_content_version_not_blank check (length(btrim(content_version)) between 1 and 100)
);

create index terms_deck_sort_index on public.terms (deck_id, sort_order);
create index relationships_deck_index on public.relationships (deck_id);
create index attempts_deck_submitted_index on public.attempts (deck_id, submitted_at desc);
create index attempts_user_submitted_index on public.attempts (user_id, submitted_at desc);

comment on table public.attempts is
  'Immutable raw concept sorts and deterministic score outputs. Anonymous clients may insert but never read.';
comment on column public.attempts.groups_json is
  'Ordered array of submitted groups with group names and stable term_ids. Preserve for later rescoring.';
comment on column public.attempts.content_version is
  'Identifies the exact educator deck/matrix revision independently of scoring_version.';

