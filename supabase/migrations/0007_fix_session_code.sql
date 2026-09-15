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
    new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when new_code ~ '^[A-Z0-9]{6}$' and not exists (select 1 from public.jeopardy_sessions where join_code = new_code);
  end loop;

  insert into public.jeopardy_sessions (teacher_id, set_id, join_code, max_teams, board_state, final_clue)
  values (auth.uid(), chosen.id, new_code, p_max_teams, safe_board, chosen.final_json)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'joinCode', new_code);
end;
$$;

revoke all on function public.jeopardy_create_session(uuid, integer) from public;
grant execute on function public.jeopardy_create_session(uuid, integer) to authenticated;
