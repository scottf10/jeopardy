create table public.teacher_allowlist (
  email citext primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint teacher_allowlist_email_format check (
    email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

alter table public.teacher_allowlist enable row level security;
revoke all on table public.teacher_allowlist from anon, authenticated;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.teacher_allowlist
      where email = (auth.jwt() ->> 'email')::citext
        and active = true
    );
$$;

revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;

grant select, insert, update on table public.decks to authenticated;
grant select, insert, update, delete on table public.terms to authenticated;
grant select, insert, update, delete on table public.relationships to authenticated;
grant select on table public.attempts to authenticated;

create policy "allowlisted teachers can read all decks"
on public.decks
for select
to authenticated
using (public.is_teacher());

create policy "allowlisted teachers can create decks"
on public.decks
for insert
to authenticated
with check (public.is_teacher() and active = false);

create policy "allowlisted teachers can update decks"
on public.decks
for update
to authenticated
using (public.is_teacher())
with check (public.is_teacher());

create policy "allowlisted teachers can read all terms"
on public.terms
for select
to authenticated
using (public.is_teacher());

create policy "allowlisted teachers can create terms"
on public.terms
for insert
to authenticated
with check (public.is_teacher());

create policy "allowlisted teachers can update terms"
on public.terms
for update
to authenticated
using (public.is_teacher())
with check (public.is_teacher());

create policy "allowlisted teachers can delete terms"
on public.terms
for delete
to authenticated
using (public.is_teacher());

create policy "allowlisted teachers can read all relationships"
on public.relationships
for select
to authenticated
using (public.is_teacher());

create policy "allowlisted teachers can create relationships"
on public.relationships
for insert
to authenticated
with check (public.is_teacher());

create policy "allowlisted teachers can update relationships"
on public.relationships
for update
to authenticated
using (public.is_teacher())
with check (public.is_teacher());

create policy "allowlisted teachers can delete relationships"
on public.relationships
for delete
to authenticated
using (public.is_teacher());

create policy "allowlisted teachers can review attempts"
on public.attempts
for select
to authenticated
using (public.is_teacher());

create or replace function public.teacher_add_term(
  p_deck_id uuid,
  p_term_key text,
  p_label text,
  p_sort_order integer
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_term_id uuid;
begin
  if not public.is_teacher() then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;

  if (select active from public.decks where id = p_deck_id) then
    raise exception 'Deactivate the deck before adding vocabulary';
  end if;

  if (select count(*) from public.terms where deck_id = p_deck_id) >= 30 then
    raise exception 'A deck may contain no more than 30 terms';
  end if;

  insert into public.terms (deck_id, term_key, label, sort_order)
  values (p_deck_id, p_term_key, p_label, p_sort_order)
  returning id into new_term_id;

  insert into public.relationships (deck_id, term_a_id, term_b_id, weight)
  select
    p_deck_id,
    least(existing.id, new_term_id),
    greatest(existing.id, new_term_id),
    0
  from public.terms existing
  where existing.deck_id = p_deck_id
    and existing.id <> new_term_id;

  return new_term_id;
end;
$$;

revoke all on function public.teacher_add_term(uuid, text, text, integer) from public;
grant execute on function public.teacher_add_term(uuid, text, text, integer) to authenticated;

comment on table public.teacher_allowlist is
  'Private Google-account email allowlist for the Concept Sort teacher dashboard.';
comment on function public.is_teacher() is
  'Returns true only for an authenticated Google account on the private active allowlist.';

