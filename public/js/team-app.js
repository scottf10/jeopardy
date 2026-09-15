import { getRuntimeConfig } from "./config.js";
import { createTeamService } from "./team-service.js";

const elements = {
  joinView: document.querySelector("#join-view"), gameView: document.querySelector("#game-view"),
  joinForm: document.querySelector("#join-form"), code: document.querySelector("#join-code"),
  name: document.querySelector("#team-name"), message: document.querySelector("#join-message"),
  title: document.querySelector("#game-title"), myName: document.querySelector("#my-team-name"),
  myScore: document.querySelector("#my-score"), connection: document.querySelector("#connection-message"),
  content: document.querySelector("#team-content"), scoreboard: document.querySelector("#scoreboard"),
};

let service;
let credentials;
let pollTimer;
let lastState = "";
const money = (value) => `${value < 0 ? "-$" : "$"}${Math.abs(Number(value)).toLocaleString()}`;
const setMessage = (text) => { elements.message.textContent = text; };

function escapeText(value) {
  const span = document.createElement("span");
  span.textContent = String(value ?? "");
  return span.innerHTML;
}

function renderScoreboard(state) {
  elements.scoreboard.innerHTML = state.teams.map((team) =>
    `<div class="score-tile"><strong>${escapeText(team.name)}</strong><span>${money(team.score)}</span></div>`,
  ).join("");
  const mine = state.teams.find((team) => team.id === state.myTeam.id) ?? state.myTeam;
  elements.myName.textContent = mine.name;
  elements.myScore.textContent = money(mine.score);
}

function renderBoard(board) {
  const categories = board?.categories ?? [];
  return `<div class="jeopardy-board">${categories.map((category) =>
    `<div class="board-category">${escapeText(category.name)}</div>`,
  ).join("")}${[0, 1, 2, 3, 4].map((row) => categories.map((category) => {
    const clue = category.clues[row];
    return `<div class="board-clue ${clue.used ? "used" : ""}">${clue.used ? "" : `$${clue.value}`}</div>`;
  }).join("")).join("")}</div>`;
}

function renderContent(state) {
  elements.title.textContent = state.title;
  renderScoreboard(state);
  if (state.state === "lobby") {
    elements.content.innerHTML = `<div class="waiting"><p class="eyebrow">You're in</p><h2>Waiting for the teacher to start</h2><p>${state.teams.length} of ${state.maxTeams} teams joined</p></div>`;
  } else if (state.state === "board") {
    elements.content.innerHTML = renderBoard(state.board);
  } else if (state.state === "clue" || state.state === "answer") {
    const active = state.active ?? {};
    elements.content.innerHTML = `<div class="active-clue"><p class="eyebrow">${escapeText(active.categoryName)}</p><div class="clue-value">${money(active.value)}</div><h2>${escapeText(active.clue)}</h2>${active.answer ? `<p class="answer">${escapeText(active.answer)}</p>` : ""}</div>`;
  } else if (state.state === "final_wager") {
    const max = Math.max(0, Number(state.myTeam.score));
    elements.content.innerHTML = `<form id="wager-form" class="final-form"><p class="eyebrow">Final Jeopardy</p><h2>${escapeText(state.final.category)}</h2><label for="wager">Wager (maximum ${money(max)})</label><input id="wager" type="number" min="0" max="${max}" value="${state.myTeam.finalWager ?? 0}" required><button class="button gold" type="submit">Lock wager</button><p>${state.myTeam.finalWager !== null ? "Wager submitted. You may change it until the clue appears." : ""}</p></form>`;
    document.querySelector("#wager-form").addEventListener("submit", submitWager);
  } else if (state.state === "final_clue") {
    elements.content.innerHTML = `<form id="answer-form" class="final-form"><p class="eyebrow">Final Jeopardy — ${escapeText(state.final.category)}</p><h2>${escapeText(state.final.clue)}</h2><label for="final-response">Your response</label><input id="final-response" maxlength="300" value="${escapeText(state.myTeam.finalAnswer ?? "")}" required><button class="button gold" type="submit">Lock response</button><p>${state.myTeam.finalSubmitted ? "Response submitted. You may change it until time is called." : ""}</p></form>`;
    document.querySelector("#answer-form").addEventListener("submit", submitAnswer);
  } else if (state.state === "final_answer") {
    elements.content.innerHTML = `<div class="active-clue"><p class="eyebrow">Final Jeopardy — ${escapeText(state.final.category)}</p><h2>${escapeText(state.final.clue)}</h2><p class="answer">${escapeText(state.final.answer)}</p><p>Waiting for the teacher to score responses.</p></div>`;
  } else {
    const winner = [...state.teams].sort((a, b) => b.score - a.score)[0];
    elements.content.innerHTML = `<div class="waiting"><p class="eyebrow">Game over</p><h2>${winner ? `${escapeText(winner.name)} wins!` : "Thanks for playing!"}</h2></div>`;
  }
}

async function submitWager(event) {
  event.preventDefault();
  try { await service.submitWager(credentials.code, credentials.token, Number(document.querySelector("#wager").value)); await poll(); }
  catch (error) { elements.connection.textContent = error.message; }
}

async function submitAnswer(event) {
  event.preventDefault();
  try { await service.submitAnswer(credentials.code, credentials.token, document.querySelector("#final-response").value); await poll(); }
  catch (error) { elements.connection.textContent = error.message; }
}

async function poll() {
  if (!credentials) return;
  try {
    const state = await service.state(credentials.code, credentials.token);
    elements.connection.textContent = "Connected";
    const serialized = JSON.stringify(state);
    if (serialized !== lastState) { lastState = serialized; renderContent(state); }
  } catch (error) { elements.connection.textContent = `Reconnecting… ${error.message}`; }
}

elements.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = elements.code.value.trim().toUpperCase();
  const name = elements.name.value.trim();
  if (!/^[A-Z0-9]{6}$/.test(code) || !name) return setMessage("Enter a six-character code and a team name.");
  try {
    const joined = await service.join(code, name);
    credentials = { code, token: joined.token };
    sessionStorage.setItem("jeopardy-team", JSON.stringify(credentials));
    elements.joinView.hidden = true; elements.gameView.hidden = false;
    await poll(); pollTimer = setInterval(poll, 1200);
  } catch (error) { setMessage(error.message); }
});

async function initialize() {
  try {
    service = await createTeamService(getRuntimeConfig());
    const saved = JSON.parse(sessionStorage.getItem("jeopardy-team") || "null");
    if (saved?.code && saved?.token) {
      credentials = saved; elements.joinView.hidden = true; elements.gameView.hidden = false;
      try {
        const state = await service.state(credentials.code, credentials.token);
        elements.connection.textContent = "Connected";
        lastState = JSON.stringify(state);
        renderContent(state);
        pollTimer = setInterval(poll, 1200);
      } catch {
        sessionStorage.removeItem("jeopardy-team");
        credentials = null;
        elements.gameView.hidden = true;
        elements.joinView.hidden = false;
        setMessage("Your previous game has ended. Enter a new game code to play again.");
      }
    }
  } catch (error) { setMessage(error.message); }
}
window.addEventListener("beforeunload", () => clearInterval(pollTimer));
initialize();
