import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeImportedGame } from "../public/js/game-set.js";

function rows() {
  return Array.from({ length: 6 }, (_, category) =>
    [100, 200, 300, 400, 500].map((value) => ({
      Category: `Category ${category + 1}`, Value: value,
      Clue: `Clue ${category + 1}-${value}`, Answer: `Answer ${category + 1}-${value}`,
    })),
  ).flat();
}

test("normalizes a complete six-category board and Final Jeopardy", () => {
  const game = normalizeImportedGame("Review", rows(), { Category: "Final", Clue: "Last clue", Answer: "Last answer" });
  assert.equal(game.board.categories.length, 6);
  assert.deepEqual(game.board.categories[0].clues.map((clue) => clue.value), [100, 200, 300, 400, 500]);
  assert.equal(game.final.answer, "Last answer");
});

test("rejects incomplete boards and missing final questions", () => {
  assert.throws(() => normalizeImportedGame("Review", rows().slice(1), { Category: "F", Clue: "Q", Answer: "A" }), /one clue for each value/);
  assert.throws(() => normalizeImportedGame("Review", rows(), {}), /Final Jeopardy/);
});

test("database contract protects games and limits classroom sessions", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/0006_jeopardy_schema.sql", import.meta.url), "utf8");
  assert.match(sql, /max_teams between 1 and 10/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /revoke all on public\.jeopardy_sets, public\.jeopardy_sessions, public\.jeopardy_teams from anon/);
  assert.match(sql, /team_token uuid not null/);
  assert.match(sql, /case when selected\.show_answer then selected\.active_clue->'answer' else null end/);
  assert.match(sql, /final_scored boolean not null default false/);
  assert.match(sql, /jeopardy_score_final/);
});

test("teacher and team entry points expose the required classroom controls", () => {
  const teacher = fs.readFileSync(new URL("../public/teacher/index.html", import.meta.url), "utf8");
  const team = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(teacher, /Download template/);
  assert.match(teacher, /Maximum teams/);
  assert.match(teacher, /Final Jeopardy/);
  assert.match(team, /Game code/);
  assert.match(team, /Team name/);
});
