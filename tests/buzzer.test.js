import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buzzSecondsRemaining, createBuzzDeadline } from "../public/js/buzzer.js";

test("countdown rounds up and never becomes negative", () => {
  const deadline = createBuzzDeadline(10_000, 1_000);
  assert.equal(deadline, 11_000);
  assert.equal(buzzSecondsRemaining(deadline, 1_001), 10);
  assert.equal(buzzSecondsRemaining(deadline, 10_001), 1);
  assert.equal(buzzSecondsRemaining(deadline, 11_001), 0);
});

test("buzzer migration atomically locks the session and excludes prior attempts", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/0008_buzzer_timer.sql", import.meta.url), "utf8");
  assert.match(sql, /for update/);
  assert.match(sql, /Another team buzzed first/);
  assert.match(sql, /Your team has already attempted this clue/);
  assert.match(sql, /buzz_duration_seconds between 3 and 60/);
  assert.match(sql, /jeopardy_resolve_buzz/);
  assert.match(sql, /grant execute on function public\.jeopardy_buzz\(text, uuid\) to anon, authenticated/);
});

test("teacher and team clients expose timer and Space-key controls", () => {
  const teacher = fs.readFileSync(new URL("../public/teacher/index.html", import.meta.url), "utf8");
  const teacherApp = fs.readFileSync(new URL("../public/js/teacher-app.js", import.meta.url), "utf8");
  const teacherService = fs.readFileSync(new URL("../public/js/teacher-service.js", import.meta.url), "utf8");
  const teamApp = fs.readFileSync(new URL("../public/js/team-app.js", import.meta.url), "utf8");
  assert.match(teacher, /id="buzz-seconds"/);
  assert.match(teacher, /id="host-buzzer-status"/);
  assert.match(teacherApp, /resolveBuzz/);
  assert.match(teacherApp, /Return to the game library\? This will end the game for every team/);
  assert.match(teacherApp, /Finish this game\? Every team will be disconnected/);
  assert.match(teacherApp, /window\.addEventListener\("beforeunload"/);
  assert.match(teacherApp, /window\.addEventListener\("pagehide"/);
  assert.match(teacherService, /keepalive: true/);
  assert.match(teacherService, /endSessionOnUnload/);
  assert.match(teacherService, /method: "DELETE"/);
  assert.match(teacherService, /async deleteSession/);
  assert.match(teacherService, /async removeTeam/);
  assert.match(teacherApp, /Teams \(\$\{teams\.length\} \/ \$\{currentSession\.max_teams\}\)/);
  assert.match(teacherApp, /Remove from lobby/);
  assert.match(teacherApp, /await service\.deleteSession\(sessionId\)/);
  assert.match(teacherApp, /hostPollInFlight/);
  assert.match(teacherApp, /sessionCreatePending/);
  assert.match(teamApp, /event\.code !== "Space"/);
  assert.match(teamApp, /Press SPACE to buzz/);
  assert.match(teamApp, /function leaveFinishedGame/);
  assert.match(teamApp, /localStorage\.removeItem\(TEAM_SESSION_KEY\)/);
  assert.match(teamApp, /localStorage\.setItem\(TEAM_SESSION_KEY/);
  assert.match(teamApp, /pollInFlight/);
  assert.match(teamApp, /joinPending/);
  assert.match(teamApp, /function contentStateKey/);
  assert.match(teamApp, /Lock in wager and response/);
  assert.match(teamApp, /service\.submitFinal/);
  assert.match(teamApp, /Game session not found\|Game code not found\|Team access expired/);
});

test("Final Jeopardy submission is combined, validated, and locked atomically", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/0010_final_submission.sql", import.meta.url), "utf8");
  assert.match(sql, /jeopardy_submit_final/);
  assert.match(sql, /for update/);
  assert.match(sql, /final_submitted then raise exception/);
  assert.match(sql, /p_wager > greatest\(mine\.score, 0\)/);
  assert.match(sql, /final_wager = p_wager,[\s\S]*final_answer = clean_answer,[\s\S]*final_submitted = true/);
  assert.match(sql, /grant execute on function public\.jeopardy_submit_final\(text, uuid, integer, text\) to anon, authenticated/);
});

test("teacher can pause an active buzzer without opening it to other teams", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/0011_pause_buzzer.sql", import.meta.url), "utf8");
  const teacherApp = fs.readFileSync(new URL("../public/js/teacher-app.js", import.meta.url), "utf8");
  const teamApp = fs.readFileSync(new URL("../public/js/team-app.js", import.meta.url), "utf8");
  assert.match(sql, /buzz_paused_remaining_ms/);
  assert.match(sql, /jeopardy_set_buzz_paused/);
  assert.match(sql, /selected\.buzz_paused_remaining_ms is not null[\s\S]*Another team buzzed first/);
  assert.match(sql, /'paused', active_buzz and selected\.buzz_paused_remaining_ms is not null/);
  assert.match(sql, /grant execute on function public\.jeopardy_set_buzz_paused\(uuid, boolean\) to authenticated/);
  assert.match(teacherApp, /Pause timer/);
  assert.match(teacherApp, /Resume timer/);
  assert.match(teacherApp, /service\.setBuzzPaused/);
  assert.match(teamApp, /Timer paused — this team still has the floor/);
});
