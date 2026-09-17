alter table public.jeopardy_sessions
  drop constraint jeopardy_sessions_state;

alter table public.jeopardy_sessions
  add constraint jeopardy_sessions_state check (
    state in ('lobby','board','clue','answer','final_wager','final_clue','final_answer','leaderboard','finished')
  );
