alter table public.attempts
  drop constraint attempts_user_id_format;

alter table public.attempts
  add constraint attempts_student_name_format check (
    user_id = btrim(user_id)
    and char_length(user_id) between 1 and 24
  );

comment on column public.attempts.user_id is
  'Student-chosen display name, limited to 24 characters. The legacy column name is retained for backward compatibility.';

