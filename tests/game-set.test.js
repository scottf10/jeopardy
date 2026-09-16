import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractWorksheetRows, normalizeImportedGame } from "../public/js/game-set.js";
import { answerKeyFilename } from "../public/js/answer-key-pdf.js";

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

test("finds import headings even when the workbook has title rows", () => {
  const questions = extractWorksheetRows([
    ["Jeopardy questions"],
    ["Six categories × five clues"],
    [],
    ["Category", "Value", "Question", "Answer"],
    ["Variables", 100, "What is x?", "10"],
  ], { includeValue: true, sheetName: "Questions" });
  const final = extractWorksheetRows([
    ["Final Jeopardy"],
    [],
    ["Category", "Clue", "Answer"],
    ["Variables", "Final clue", "Final answer"],
  ], { sheetName: "Final Jeopardy" });
  assert.deepEqual(questions, [{ Category: "Variables", Value: 100, Clue: "What is x?", Answer: "10", _rowNumber: 5 }]);
  assert.deepEqual(final, [{ Category: "Variables", Clue: "Final clue", Answer: "Final answer", _rowNumber: 4 }]);
});

test("category names are matched without case or surrounding-space differences", () => {
  const mixedRows = rows();
  mixedRows[1].Category = " category 1 ";
  const game = normalizeImportedGame("Review", mixedRows, { Category: "F", Clue: "Q", Answer: "A" });
  assert.equal(game.board.categories.length, 6);
});

test("database contract protects games and limits classroom sessions", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/0006_jeopardy_schema.sql", import.meta.url), "utf8");
  const deleteSql = fs.readFileSync(new URL("../supabase/migrations/0009_delete_saved_sets.sql", import.meta.url), "utf8");
  assert.match(sql, /max_teams between 1 and 10/);
  assert.match(sql, /where join_code = upper\(btrim\(p_code\)\) for update/);
  assert.match(sql, /gen_random_uuid\(\)/);
  assert.doesNotMatch(sql, /gen_random_bytes\(/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /revoke all on public\.jeopardy_sets, public\.jeopardy_sessions, public\.jeopardy_teams from anon/);
  assert.match(sql, /team_token uuid not null/);
  assert.match(sql, /case when selected\.show_answer then selected\.active_clue->'answer' else null end/);
  assert.match(sql, /final_scored boolean not null default false/);
  assert.match(sql, /jeopardy_score_final/);
  assert.match(sql, /create policy "teachers manage their jeopardy sets"/);
  assert.match(sql, /teacher_id = auth\.uid\(\) and public\.is_teacher\(\)/);
  assert.match(deleteSql, /foreign key \(set_id\)[\s\S]*references public\.jeopardy_sets\(id\)[\s\S]*on delete cascade/);
});

test("teacher and team entry points expose the required classroom controls", () => {
  const teacher = fs.readFileSync(new URL("../public/teacher/index.html", import.meta.url), "utf8");
  const team = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const teacherService = fs.readFileSync(new URL("../public/js/teacher-service.js", import.meta.url), "utf8");
  const teacherApp = fs.readFileSync(new URL("../public/js/teacher-app.js", import.meta.url), "utf8");
  const template = fs.statSync(new URL("../outputs/jeopardy-template/jeopardy-import-template.xlsx", import.meta.url));
  assert.match(teacher, /Download template/);
  assert.match(teacher, /Maximum teams/);
  assert.match(teacher, /Final Jeopardy/);
  assert.match(team, /Game code/);
  assert.match(team, /Team name/);
  assert.match(teacherService, /from\("jeopardy_sets"\)\.select/);
  assert.match(teacherService, /\.insert\(\{ title: game\.title, board_json: game\.board, final_json: game\.final \}\)/);
  assert.match(teacherService, /rpc\("jeopardy_create_session"/);
  assert.match(teacherApp, /normalizeImportedGame/);
  assert.match(teacherApp, /previous sessions and team scores/);
  assert.ok(template.size > 1_000, "the downloadable workbook must be present and non-empty");
});

test("answer-key downloads use safe filenames and include all game sections", () => {
  assert.equal(answerKeyFilename("Honors JavaScript: Unit 1 / Review"), "honors-javascript-unit-1-review-answer-key.pdf");
  assert.equal(answerKeyFilename("***"), "jeopardy-answer-key.pdf");
  const pdfModule = fs.readFileSync(new URL("../public/js/answer-key-pdf.js", import.meta.url), "utf8");
  const teacherApp = fs.readFileSync(new URL("../public/js/teacher-app.js", import.meta.url), "utf8");
  assert.match(pdfModule, /for \(const category of set\.board_json\.categories\)/);
  assert.match(pdfModule, /for \(const item of category\.clues/);
  assert.match(pdfModule, /set\.final_json\.clue/);
  assert.match(pdfModule, /set\.final_json\.answer/);
  assert.match(pdfModule, /Teacher answer key - keep private/);
  assert.match(teacherApp, /Answer key PDF/);
  assert.match(teacherApp, /downloadAnswerKey\(set\)/);
});
