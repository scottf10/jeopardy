create or replace function public.assert_deck_ready_for_activation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  term_count integer;
  relationship_count integer;
  expected_relationship_count integer;
begin
  if new.active is not true then
    return new;
  end if;

  if new.content_version = 'draft'
     or new.content_version like 'demo-%'
     or new.slug like '%placeholder%'
  then
    raise exception 'Placeholder or draft deck content cannot be activated';
  end if;

  select count(*) into term_count
  from public.terms
  where deck_id = new.id;

  if term_count < 1 or term_count > 30 then
    raise exception 'An active deck must contain between 1 and 30 terms; found %', term_count;
  end if;

  expected_relationship_count := (term_count * (term_count - 1)) / 2;
  select count(*) into relationship_count
  from public.relationships
  where deck_id = new.id;

  if relationship_count <> expected_relationship_count then
    raise exception
      'An active deck must contain every unordered relationship pair; expected %, found %',
      expected_relationship_count,
      relationship_count;
  end if;

  return new;
end;
$$;

create trigger decks_validate_before_activation
before update of active on public.decks
for each row
when (new.active = true)
execute function public.assert_deck_ready_for_activation();

create or replace function public.assert_deck_content_mutable()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  affected_deck_id uuid;
  deck_is_active boolean;
begin
  affected_deck_id := case when tg_op = 'DELETE' then old.deck_id else new.deck_id end;

  select active into deck_is_active
  from public.decks
  where id = affected_deck_id;

  if deck_is_active then
    raise exception 'Deactivate a deck before changing its terms or relationships';
  end if;

  if exists (select 1 from public.attempts where deck_id = affected_deck_id) then
    raise exception 'Deck content with saved attempts is immutable; create a new deck revision';
  end if;

  if tg_op = 'UPDATE' and old.deck_id <> new.deck_id then
    if exists (
      select 1 from public.decks where id = new.deck_id and active = true
    ) or exists (
      select 1 from public.attempts where deck_id = new.deck_id
    ) then
      raise exception 'The destination deck is active or has saved attempts';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger terms_require_mutable_deck
before insert or update or delete on public.terms
for each row execute function public.assert_deck_content_mutable();

create trigger relationships_require_mutable_deck
before insert or update or delete on public.relationships
for each row execute function public.assert_deck_content_mutable();

create or replace function public.assert_deck_scoring_config_mutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.attempts where deck_id = old.id) then
    raise exception 'Scoring configuration with saved attempts is immutable; create a new deck revision';
  end if;
  return new;
end;
$$;

create trigger decks_scoring_config_requires_no_attempts
before update of coverage_threshold, max_groups, scoring_version, content_version on public.decks
for each row
when (
  old.coverage_threshold is distinct from new.coverage_threshold
  or old.max_groups is distinct from new.max_groups
  or old.scoring_version is distinct from new.scoring_version
  or old.content_version is distinct from new.content_version
)
execute function public.assert_deck_scoring_config_mutable();


