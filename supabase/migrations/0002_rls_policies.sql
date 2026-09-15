alter table public.decks enable row level security;
alter table public.terms enable row level security;
alter table public.relationships enable row level security;
alter table public.attempts enable row level security;

revoke all on table public.decks from anon, authenticated;
revoke all on table public.terms from anon, authenticated;
revoke all on table public.relationships from anon, authenticated;
revoke all on table public.attempts from anon, authenticated;

grant select on table public.decks to anon;
grant select on table public.terms to anon;
grant select on table public.relationships to anon;
grant insert on table public.attempts to anon;

create policy "anonymous students can read active decks"
on public.decks
for select
to anon
using (active = true);

create policy "anonymous students can read terms from active decks"
on public.terms
for select
to anon
using (
  exists (
    select 1
    from public.decks
    where decks.id = terms.deck_id
      and decks.active = true
  )
);

create policy "anonymous students can read relationships from active decks"
on public.relationships
for select
to anon
using (
  exists (
    select 1
    from public.decks
    where decks.id = relationships.deck_id
      and decks.active = true
  )
);

create policy "anonymous students can insert attempts for active decks"
on public.attempts
for insert
to anon
with check (
  exists (
    select 1
    from public.decks
    where decks.id = attempts.deck_id
      and decks.active = true
      and decks.scoring_version = attempts.scoring_version
      and decks.content_version = attempts.content_version
  )
);

-- No anonymous or authenticated SELECT, UPDATE, or DELETE policy exists for attempts.
-- No anonymous INSERT, UPDATE, or DELETE policy exists for deck content.
-- Instructor access for MVP is through the trusted Supabase dashboard/service role.


