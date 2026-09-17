import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ordinalPlace, rankTeams, teamNameUsesPluralVerb, winnerAnnouncement,
} from "../public/js/leaderboard.js";

test("leaderboard ranks teams from highest to lowest and handles ties fairly", () => {
  const ranked = rankTeams([
    { id: "a", name: "Alpha", score: 200 },
    { id: "b", name: "Beta", score: 500 },
    { id: "c", name: "Gamma", score: 200 },
    { id: "d", name: "Delta", score: -100 },
  ]);
  assert.deepEqual(ranked.map((team) => team.name), ["Beta", "Alpha", "Gamma", "Delta"]);
  assert.deepEqual(ranked.map((team) => team.rank), [1, 2, 2, 4]);
  assert.deepEqual(ranked.map((team) => team.place), ["1st", "2nd", "2nd", "4th"]);
  assert.equal(ordinalPlace(11), "11th");
  assert.equal(ordinalPlace(22), "22nd");
});

test("winner announcements deterministically choose win or wins", () => {
  assert.equal(winnerAnnouncement("The Scholars"), "The Scholars win!");
  assert.equal(winnerAnnouncement("The Wolves"), "The Wolves win!");
  assert.equal(winnerAnnouncement("Smith & Jones"), "Smith & Jones win!");
  assert.equal(winnerAnnouncement("Rock & Roll"), "Rock & Roll win!");
  assert.equal(winnerAnnouncement("The People"), "The People win!");
  assert.equal(winnerAnnouncement("Team Rocket"), "Team Rocket wins!");
  assert.equal(winnerAnnouncement("The Boss"), "The Boss wins!");
  assert.equal(winnerAnnouncement("The Genius"), "The Genius wins!");
  assert.equal(winnerAnnouncement("Alex"), "Alex wins!");
  assert.equal(teamNameUsesPluralVerb("The Scholars"), true);
  assert.equal(teamNameUsesPluralVerb("The Boss"), false);
});

test("leaderboard state and teacher reveal controls are wired end to end", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/0012_leaderboard_state.sql", import.meta.url), "utf8");
  const teacher = fs.readFileSync(new URL("../public/teacher/index.html", import.meta.url), "utf8");
  const teacherApp = fs.readFileSync(new URL("../public/js/teacher-app.js", import.meta.url), "utf8");
  const teamApp = fs.readFileSync(new URL("../public/js/team-app.js", import.meta.url), "utf8");
  assert.match(sql, /'leaderboard'/);
  assert.match(teacher, /id="show-leaderboard"/);
  assert.match(teacher, /id="teacher-leaderboard"/);
  assert.match(teacherApp, /team\.final_submitted && !team\.final_scored/);
  assert.match(teacherApp, /state: "leaderboard"/);
  assert.match(teamApp, /state === "leaderboard"/);
  assert.match(teamApp, /leaderboardMarkup\(state\.teams\)/);
});
