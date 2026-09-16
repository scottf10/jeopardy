alter table public.jeopardy_sessions
  drop constraint jeopardy_sessions_set_id_fkey,
  add constraint jeopardy_sessions_set_id_fkey
    foreign key (set_id)
    references public.jeopardy_sets(id)
    on delete cascade;
