create or replace function public.jeopardy_submit_final(
  p_code text,
  p_token uuid,
  p_wager integer,
  p_answer text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.jeopardy_sessions%rowtype;
  mine public.jeopardy_teams%rowtype;
  clean_answer text := btrim(p_answer);
begin
  select * into selected
  from public.jeopardy_sessions
  where join_code = upper(btrim(p_code))
  for update;

  if not found then raise exception 'Game session not found'; end if;

  select * into mine
  from public.jeopardy_teams
  where session_id = selected.id and team_token = p_token
  for update;

  if not found then raise exception 'Team access expired'; end if;
  if selected.state not in ('final_wager', 'final_clue') then raise exception 'Final submissions are closed'; end if;
  if mine.final_submitted then raise exception 'Your final response is already locked'; end if;
  if p_wager is null or p_wager < 0 or p_wager > greatest(mine.score, 0) then
    raise exception 'Wager must be between 0 and your current score';
  end if;
  if char_length(clean_answer) not between 1 and 300 then
    raise exception 'Enter a response up to 300 characters';
  end if;

  update public.jeopardy_teams
  set final_wager = p_wager,
      final_answer = clean_answer,
      final_submitted = true
  where id = mine.id;
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
    'clue', case when selected.state in ('final_wager','final_clue','final_answer','finished') then selected.final_clue->>'clue' else null end,
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

revoke all on function public.jeopardy_submit_final(text, uuid, integer, text) from public;
grant execute on function public.jeopardy_submit_final(text, uuid, integer, text) to anon, authenticated;
