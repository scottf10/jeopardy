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
  const teamApp = fs.readFileSync(new URL("../public/js/team-app.js", import.meta.url), "utf8");
  assert.match(teacher, /id="buzz-seconds"/);
  assert.match(teacher, /id="host-buzzer-status"/);
  assert.match(teacherApp, /resolveBuzz/);
  assert.match(teamApp, /event\.code !== "Space"/);
  assert.match(teamApp, /Press SPACE to buzz/);
  assert.match(teamApp, /function leaveFinishedGame/);
  assert.match(teamApp, /sessionStorage\.removeItem\("jeopardy-team"\)/);
});
