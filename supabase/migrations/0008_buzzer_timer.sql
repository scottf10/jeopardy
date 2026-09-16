alter table public.jeopardy_sessions
  add column buzz_duration_seconds integer not null default 10,
  add column buzz_team_id uuid references public.jeopardy_teams(id) on delete set null,
  add column buzz_started_at timestamptz,
  add column buzzed_team_ids jsonb not null default '[]'::jsonb,
  add constraint jeopardy_sessions_buzz_duration check (buzz_duration_seconds between 3 and 60),
  add constraint jeopardy_sessions_buzzed_array check (jsonb_typeof(buzzed_team_ids) = 'array');

create or replace function public.jeopardy_buzz(p_code text, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.jeopardy_sessions%rowtype;
  mine public.jeopardy_teams%rowtype;
  attempted jsonb;
  buzz_time timestamptz := clock_timestamp();
begin
  select * into selected
  from public.jeopardy_sessions
  where join_code = upper(btrim(p_code))
  for update;

  if not found then raise exception 'Game session not found'; end if;

  select * into mine
  from public.jeopardy_teams
  where session_id = selected.id and team_token = p_token;

  if not found then raise exception 'Team access expired'; end if;
  if selected.state <> 'clue' or selected.active_clue is null or selected.show_answer then
    raise exception 'Buzzing is not open';
  end if;

  attempted := selected.buzzed_team_ids;
  if selected.buzz_team_id is not null then
    if selected.buzz_started_at + make_interval(secs => selected.buzz_duration_seconds) > buzz_time then
      raise exception 'Another team buzzed first';
    end if;
    attempted := attempted || jsonb_build_array(selected.buzz_team_id::text);
  end if;

  if attempted ? mine.id::text then
    raise exception 'Your team has already attempted this clue';
  end if;

  update public.jeopardy_sessions
  set buzz_team_id = mine.id,
      buzz_started_at = buzz_time,
      buzzed_team_ids = attempted,
      updated_at = buzz_time
  where id = selected.id;

  return jsonb_build_object(
    'teamId', mine.id,
    'teamName', mine.name,
    'startedAt', buzz_time,
    'durationSeconds', selected.buzz_duration_seconds
  );
end;
$$;

create or replace function public.jeopardy_resolve_buzz(p_session_id uuid, p_team_id uuid, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.jeopardy_sessions%rowtype;
  clue_value integer;
  attempted jsonb;
begin
  if not public.is_teacher() then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;

  select * into selected
  from public.jeopardy_sessions
  where id = p_session_id and teacher_id = auth.uid()
  for update;

  if not found then raise exception 'Session not found'; end if;
  if selected.state <> 'clue' or selected.active_clue is null then raise exception 'No clue is active'; end if;
  if selected.buzz_team_id is null then raise exception 'No team has buzzed'; end if;
  if selected.buzz_team_id <> p_team_id then raise exception 'The active buzzer has changed'; end if;

  clue_value := (selected.active_clue->>'value')::integer;
  attempted := selected.buzzed_team_ids || jsonb_build_array(selected.buzz_team_id::text);

  update public.jeopardy_teams
  set score = score + case when p_correct then clue_value else -clue_value end
  where id = selected.buzz_team_id and session_id = selected.id;

  update public.jeopardy_sessions
  set state = case when p_correct then 'answer' else state end,
      show_answer = p_correct,
      buzz_team_id = null,
      buzz_started_at = null,
      buzzed_team_ids = attempted,
      updated_at = clock_timestamp()
  where id = selected.id;
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
  effective_attempted jsonb;
  active_buzz boolean;
  active_buzz_name text;
  remaining_ms integer;
  checked_at timestamptz := clock_timestamp();
begin
  select * into selected from public.jeopardy_sessions where join_code = upper(btrim(p_code));
  if not found then raise exception 'Game session not found'; end if;
  select * into mine from public.jeopardy_teams where session_id = selected.id and team_token = p_token;
  if not found then raise exception 'Team access expired'; end if;
  select title into game_title from public.jeopardy_sets where id = selected.set_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'score', score, 'finalSubmitted', final_submitted) order by created_at), '[]'::jsonb)
    into team_list from public.jeopardy_teams where session_id = selected.id;

  active_buzz := selected.buzz_team_id is not null
    and selected.buzz_started_at is not null
    and selected.buzz_started_at + make_interval(secs => selected.buzz_duration_seconds) > checked_at;
  effective_attempted := selected.buzzed_team_ids;

  if selected.buzz_team_id is not null and not active_buzz then
    effective_attempted := effective_attempted || jsonb_build_array(selected.buzz_team_id::text);
  end if;

  if active_buzz then
    select name into active_buzz_name from public.jeopardy_teams where id = selected.buzz_team_id;
    remaining_ms := greatest(0, floor(extract(epoch from (
      selected.buzz_started_at + make_interval(secs => selected.buzz_duration_seconds) - checked_at
    )) * 1000)::integer);
  else
    active_buzz_name := null;
    remaining_ms := 0;
  end if;

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
    'buzzer', jsonb_build_object(
      'durationSeconds', selected.buzz_duration_seconds,
      'teamId', case when active_buzz then selected.buzz_team_id else null end,
      'teamName', active_buzz_name,
      'startedAt', case when active_buzz then selected.buzz_started_at else null end,
      'remainingMs', remaining_ms,
      'buzzedTeamIds', effective_attempted,
      'open', selected.state = 'clue' and not selected.show_answer and not active_buzz,
      'canBuzz', selected.state = 'clue' and not selected.show_answer and not active_buzz and not (effective_attempted ? mine.id::text)
    ),
    'myTeam', jsonb_build_object('id', mine.id, 'name', mine.name, 'score', mine.score, 'finalWager', mine.final_wager, 'finalAnswer', mine.final_answer, 'finalSubmitted', mine.final_submitted)
  );
end;
$$;

revoke all on function public.jeopardy_buzz(text, uuid) from public;
revoke all on function public.jeopardy_resolve_buzz(uuid, uuid, boolean) from public;
grant execute on function public.jeopardy_buzz(text, uuid) to anon, authenticated;
grant execute on function public.jeopardy_resolve_buzz(uuid, uuid, boolean) to authenticated;
