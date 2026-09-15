create table public.jeopardy_sets (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  board_json jsonb not null,
  final_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint jeopardy_sets_title check (char_length(btrim(title)) between 1 and 80),
  constraint jeopardy_sets_board_object check (jsonb_typeof(board_json) = 'object'),
  constraint jeopardy_sets_final_object check (jsonb_typeof(final_json) = 'object')
);

create table public.jeopardy_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  set_id uuid not null references public.jeopardy_sets(id) on delete restrict,
  join_code text not null unique,
  max_teams integer not null,
  state text not null default 'lobby',
  board_state jsonb not null,
  final_clue jsonb not null,
  active_clue jsonb,
  used_clues jsonb not null default '[]'::jsonb,
  show_answer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jeopardy_sessions_code check (join_code ~ '^[A-Z0-9]{6}$'),
  constraint jeopardy_sessions_max_teams check (max_teams between 1 and 10),
  constraint jeopardy_sessions_state check (state in ('lobby','board','clue','answer','final_wager','final_clue','final_answer','finished')),
  constraint jeopardy_sessions_used_array check (jsonb_typeof(used_clues) = 'array')
);

create table public.jeopardy_teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.jeopardy_sessions(id) on delete cascade,
  name text not null,
  score integer not null default 0,
  team_token uuid not null default gen_random_uuid() unique,
  final_wager integer,
  final_answer text,
  final_submitted boolean not null default false,
  final_scored boolean not null default false,
  created_at timestamptz not null default now(),
  constraint jeopardy_teams_name check (name = btrim(name) and char_length(name) between 1 and 24),
  constraint jeopardy_teams_wager check (final_wager is null or final_wager >= 0),
  constraint jeopardy_teams_answer check (final_answer is null or char_length(final_answer) <= 300)
);

create unique index jeopardy_teams_session_name_unique on public.jeopardy_teams (session_id, lower(name));
create index jeopardy_sessions_teacher_created on public.jeopardy_sessions (teacher_id, created_at desc);
create index jeopardy_teams_session_created on public.jeopardy_teams (session_id, created_at);

alter table public.jeopardy_sets enable row level security;
alter table public.jeopardy_sessions enable row level security;
alter table public.jeopardy_teams enable row level security;

revoke all on public.jeopardy_sets, public.jeopardy_sessions, public.jeopardy_teams from anon;
grant select, insert, update, delete on public.jeopardy_sets, public.jeopardy_sessions, public.jeopardy_teams to authenticated;

create policy "teachers manage their jeopardy sets" on public.jeopardy_sets
for all to authenticated
using (teacher_id = auth.uid() and public.is_teacher())
with check (teacher_id = auth.uid() and public.is_teacher());

create policy "teachers manage their jeopardy sessions" on public.jeopardy_sessions
for all to authenticated
using (teacher_id = auth.uid() and public.is_teacher())
with check (teacher_id = auth.uid() and public.is_teacher());

create policy "teachers manage teams in their sessions" on public.jeopardy_teams
for all to authenticated
using (exists (
  select 1 from public.jeopardy_sessions s
  where s.id = session_id and s.teacher_id = auth.uid() and public.is_teacher()
))
with check (exists (
  select 1 from public.jeopardy_sessions s
  where s.id = session_id and s.teacher_id = auth.uid() and public.is_teacher()
));

create or replace function public.jeopardy_create_session(p_set_id uuid, p_max_teams integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen public.jeopardy_sets%rowtype;
  new_id uuid;
  new_code text;
  safe_board jsonb;
begin
  if not public.is_teacher() then raise exception 'Teacher access required' using errcode = '42501'; end if;
  if p_max_teams not between 1 and 10 then raise exception 'Maximum teams must be between 1 and 10'; end if;
  select * into chosen from public.jeopardy_sets where id = p_set_id and teacher_id = auth.uid();
  if not found then raise exception 'Game set not found'; end if;

  select jsonb_build_object('categories', jsonb_agg(
    jsonb_build_object(
      'name', category->>'name',
      'clues', (select jsonb_agg(jsonb_build_object('value', (clue->>'value')::integer, 'used', false) order by clue_order)
                from jsonb_array_elements(category->'clues') with ordinality q(clue, clue_order))
    ) order by category_order
  )) into safe_board
  from jsonb_array_elements(chosen.board_json->'categories') with ordinality c(category, category_order);

  loop
    new_code := upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '/+=', 'XYZ'), 1, 6));
    exit when new_code ~ '^[A-Z0-9]{6}$' and not exists (select 1 from public.jeopardy_sessions where join_code = new_code);
  end loop;

  insert into public.jeopardy_sessions (teacher_id, set_id, join_code, max_teams, board_state, final_clue)
  values (auth.uid(), chosen.id, new_code, p_max_teams, safe_board, chosen.final_json)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'joinCode', new_code);
end;
$$;

create or replace function public.jeopardy_join_session(p_code text, p_team_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.jeopardy_sessions%rowtype;
  new_team public.jeopardy_teams%rowtype;
  clean_name text := btrim(p_team_name);
begin
  select * into selected from public.jeopardy_sessions where join_code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if selected.state <> 'lobby' then raise exception 'This game has already started'; end if;
  if char_length(clean_name) not between 1 and 24 then raise exception 'Team name must be 1–24 characters'; end if;
  if (select count(*) from public.jeopardy_teams where session_id = selected.id) >= selected.max_teams then raise exception 'This game is full'; end if;
  insert into public.jeopardy_teams (session_id, name) values (selected.id, clean_name) returning * into new_team;
  return jsonb_build_object('teamId', new_team.id, 'token', new_team.team_token);
exception when unique_violation then
  raise exception 'That team name is already in use';
end;
$$;

create or replace function public.jeopardy_team_state(p_code text, p_token uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  selected public.jeopardy_sessions%rowtype;
  mine public.jeopardy_teams%rowtype;
  game_title text;
  team_list jsonb;
  active_safe jsonb;
  final_safe jsonb;
begin
  select * into selected from public.jeopardy_sessions where join_code = upper(btrim(p_code));
  if not found then raise exception 'Game session not found'; end if;
  select * into mine from public.jeopardy_teams where session_id = selected.id and team_token = p_token;
  if not found then raise exception 'Team access expired'; end if;
  select title into game_title from public.jeopardy_sets where id = selected.set_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'score', score, 'finalSubmitted', final_submitted) order by created_at), '[]'::jsonb)
    into team_list from public.jeopardy_teams where session_id = selected.id;
  active_safe := case when selected.active_clue is null then null else
    (selected.active_clue - 'answer') || jsonb_build_object('answer', case when selected.show_answer then selected.active_clue->'answer' else null end)
  end;
  final_safe := jsonb_build_object(
    'category', selected.final_clue->>'category',
    'clue', case when selected.state in ('final_clue','final_answer','finished') then selected.final_clue->>'clue' else null end,
    'answer', case when selected.state in ('final_answer','finished') then selected.final_clue->>'answer' else null end
  );
  return jsonb_build_object(
    'title', game_title, 'state', selected.state, 'maxTeams', selected.max_teams,
    'board', selected.board_state, 'active', active_safe, 'final', final_safe, 'teams', team_list,
    'myTeam', jsonb_build_object('id', mine.id, 'name', mine.name, 'score', mine.score, 'finalWager', mine.final_wager, 'finalAnswer', mine.final_answer, 'finalSubmitted', mine.final_submitted)
  );
end;
$$;

create or replace function public.jeopardy_submit_wager(p_code text, p_token uuid, p_wager integer)
returns void language plpgsql security definer set search_path = public as $$
declare selected public.jeopardy_sessions%rowtype; mine public.jeopardy_teams%rowtype;
begin
  select * into selected from public.jeopardy_sessions where join_code = upper(btrim(p_code));
  select * into mine from public.jeopardy_teams where session_id = selected.id and team_token = p_token;
  if mine.id is null then raise exception 'Team access expired'; end if;
  if selected.state <> 'final_wager' then raise exception 'Wagers are closed'; end if;
  if p_wager < 0 or p_wager > greatest(mine.score, 0) then raise exception 'Wager must be between 0 and your current score'; end if;
  update public.jeopardy_teams set final_wager = p_wager where id = mine.id;
end; $$;

create or replace function public.jeopardy_submit_answer(p_code text, p_token uuid, p_answer text)
returns void language plpgsql security definer set search_path = public as $$
declare selected public.jeopardy_sessions%rowtype; mine public.jeopardy_teams%rowtype; clean_answer text := btrim(p_answer);
begin
  select * into selected from public.jeopardy_sessions where join_code = upper(btrim(p_code));
  select * into mine from public.jeopardy_teams where session_id = selected.id and team_token = p_token;
  if mine.id is null then raise exception 'Team access expired'; end if;
  if selected.state <> 'final_clue' then raise exception 'Responses are closed'; end if;
  if mine.final_wager is null then raise exception 'Submit a wager first'; end if;
  if char_length(clean_answer) not between 1 and 300 then raise exception 'Enter a response up to 300 characters'; end if;
  update public.jeopardy_teams set final_answer = clean_answer, final_submitted = true where id = mine.id;
end; $$;

create or replace function public.jeopardy_score_final(p_team_id uuid, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.jeopardy_teams%rowtype;
  session_state text;
begin
  if not public.is_teacher() then raise exception 'Teacher access required' using errcode = '42501'; end if;

  select t, s.state into selected, session_state
  from public.jeopardy_teams t
  join public.jeopardy_sessions s on s.id = t.session_id
  where t.id = p_team_id and s.teacher_id = auth.uid()
  for update of t;

  if not found then raise exception 'Team not found'; end if;
  if session_state <> 'final_answer' then raise exception 'Final responses are not ready to score'; end if;
  if selected.final_scored then raise exception 'This final response has already been scored'; end if;

  update public.jeopardy_teams
  set score = score + case when p_correct then coalesce(final_wager, 0) else -coalesce(final_wager, 0) end,
      final_scored = true
  where id = selected.id;
end;
$$;

revoke all on function public.jeopardy_create_session(uuid, integer) from public;
revoke all on function public.jeopardy_join_session(text, text) from public;
revoke all on function public.jeopardy_team_state(text, uuid) from public;
revoke all on function public.jeopardy_submit_wager(text, uuid, integer) from public;
revoke all on function public.jeopardy_submit_answer(text, uuid, text) from public;
revoke all on function public.jeopardy_score_final(uuid, boolean) from public;
grant execute on function public.jeopardy_create_session(uuid, integer) to authenticated;
grant execute on function public.jeopardy_join_session(text, text) to anon, authenticated;
grant execute on function public.jeopardy_team_state(text, uuid) to anon, authenticated;
grant execute on function public.jeopardy_submit_wager(text, uuid, integer) to anon, authenticated;
grant execute on function public.jeopardy_submit_answer(text, uuid, text) to anon, authenticated;
grant execute on function public.jeopardy_score_final(uuid, boolean) to authenticated;
