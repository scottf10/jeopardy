# Classroom Jeopardy

Classroom-friendly Jeopardy game for `jeopardy.mrflorence.com`.

## Features

- Google-authenticated teacher control room restricted by the existing private teacher allowlist.
- Reusable question sets imported from an Excel template.
- Six categories with five clues each plus Final Jeopardy.
- New live sessions with six-character join codes and 1–10 team devices.
- Teacher-controlled clue reveals, scoring, wagers, Final Jeopardy responses, and final scoreboard.
- Anonymous team devices use a temporary session token and cannot read question-set answers directly.

## Stack

- HTML, CSS, and vanilla JavaScript
- Supabase/PostgreSQL and Supabase Auth
- Cloudflare Pages

## Commands

- `npm test`
- `npm run build` (requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`)
- `npm run verify:production` (requires `TEACHER_EMAIL`; creates and removes isolated verification data)
- `npm run serve`

Apply every file in `supabase/migrations/` in filename order. The first five migrations are the shared teacher/auth foundation; `0006_jeopardy_schema.sql` adds the isolated Jeopardy tables and RPCs.
