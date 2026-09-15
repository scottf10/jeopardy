import { getRuntimeConfig } from "./config.js";
import { clueKey, normalizeImportedGame } from "./game-set.js";
import { createTeacherService } from "./teacher-service.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  auth: $("#auth-view"), dashboard: $("#dashboard-view"), authMessage: $("#auth-message"),
  dashboardMessage: $("#dashboard-message"), signIn: $("#sign-in"), signOut: $("#sign-out"),
  library: $("#library-view"), host: $("#host-view"), importForm: $("#import-form"),
  setTitle: $("#set-title"), importFile: $("#import-file"), setsList: $("#sets-list"),
  sessionSet: $("#session-set"), maxTeams: $("#max-teams"), createSession: $("#create-session"),
  hostCode: $("#host-code"), backLibrary: $("#back-library"), startGame: $("#start-game"),
  beginFinal: $("#begin-final"), board: $("#host-board"), clue: $("#host-clue"),
  hostCategory: $("#host-category"), hostValue: $("#host-value"), hostQuestion: $("#host-question"),
  hostAnswer: $("#host-answer"), revealAnswer: $("#reveal-answer"), returnBoard: $("#return-board"),
  final: $("#host-final"), finalCategory: $("#final-category"), finalQuestion: $("#final-question"),
  finalAnswer: $("#final-answer"), showFinalClue: $("#show-final-clue"), revealFinal: $("#reveal-final"),
  finishGame: $("#finish-game"), teams: $("#host-teams"),
};

let service;
let gameSets = [];
let currentSession = null;
let currentSet = null;
let teams = [];
let pollTimer;
const money = (value) => `${value < 0 ? "-$" : "$"}${Math.abs(Number(value)).toLocaleString()}`;
const message = (text, success = false) => {
  elements.dashboardMessage.textContent = text;
  elements.dashboardMessage.classList.toggle("success", success);
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function parseWorkbook(file, title) {
  const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const questionsSheet = workbook.Sheets.Questions;
  const finalSheet = workbook.Sheets["Final Jeopardy"];
  if (!questionsSheet || !finalSheet) throw new Error("Use the Questions and Final Jeopardy sheets in the template.");
  const questions = XLSX.utils.sheet_to_json(questionsSheet, { defval: "" });
  const finalRows = XLSX.utils.sheet_to_json(finalSheet, { defval: "" });
  return normalizeImportedGame(title, questions, finalRows[0]);
}

function renderSets() {
  elements.setsList.replaceChildren();
  elements.sessionSet.replaceChildren(new Option("Choose a game set", ""));
  gameSets.forEach((set) => {
    const card = element("div", undefined, "set-card");
    const text = element("div");
    text.append(element("strong", set.title), element("small", `${set.board_json.categories.length} categories`));
    const remove = element("button", "Delete", "button secondary");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete “${set.title}”?`)) return;
      try { await service.deleteSet(set.id); await loadSets(); message("Game set deleted.", true); }
      catch (error) { message(error.message); }
    });
    card.append(text, remove);
    elements.setsList.append(card);
    elements.sessionSet.append(new Option(set.title, set.id));
  });
  elements.createSession.disabled = gameSets.length === 0;
  if (!gameSets.length) elements.setsList.append(element("p", "No saved game sets yet."));
}

async function loadSets() {
  gameSets = await service.listSets();
  renderSets();
}

function renderBoard() {
  elements.board.replaceChildren();
  if (!currentSet) return;
  const used = new Set(currentSession.used_clues ?? []);
  currentSet.board_json.categories.forEach((category) => elements.board.append(element("div", category.name, "board-category")));
  for (let clueIndex = 0; clueIndex < 5; clueIndex += 1) {
    currentSet.board_json.categories.forEach((category, categoryIndex) => {
      const clue = category.clues[clueIndex];
      const key = clueKey(categoryIndex, clueIndex);
      const button = element("button", used.has(key) ? "" : money(clue.value), `board-clue${used.has(key) ? " used" : ""}`);
      button.type = "button";
      button.disabled = used.has(key) || currentSession.state === "lobby";
      button.addEventListener("click", () => openClue(category, clue, categoryIndex, clueIndex));
      elements.board.append(button);
    });
  }
}

function renderTeams() {
  elements.teams.replaceChildren();
  if (!teams.length) { elements.teams.append(element("p", "Waiting for teams to join…")); return; }
  teams.forEach((team) => {
    const card = element("div", undefined, "host-team");
    const top = element("div", undefined, "host-team-row");
    top.append(element("strong", team.name), element("span", money(team.score), "host-team-score"));
    const controls = element("div", undefined, "score-controls");
    const value = Number(currentSession?.active_clue?.value ?? 100);
    const subtract = element("button", `−${money(value)}`, "button secondary");
    const add = element("button", `+${money(value)}`, "button primary");
    subtract.addEventListener("click", () => changeScore(team, -value));
    add.addEventListener("click", () => changeScore(team, value));
    controls.append(subtract, add);
    card.append(top, controls);
    if (["final_answer", "finished"].includes(currentSession?.state)) {
      const response = element("div", undefined, "final-response");
      response.append(
        element("div", `Wager: ${money(team.final_wager ?? 0)}`),
        element("div", `Response: ${team.final_answer || "No response"}`),
      );
      const finalControls = element("div", undefined, "score-controls");
      const wrong = element("button", team.final_scored ? "Scored" : "Incorrect", "button secondary");
      const right = element("button", "Correct", "button gold");
      wrong.disabled = team.final_scored;
      right.disabled = team.final_scored;
      wrong.addEventListener("click", () => scoreFinal(team, false));
      right.addEventListener("click", () => scoreFinal(team, true));
      finalControls.append(wrong, right); response.append(finalControls); card.append(response);
    }
    elements.teams.append(card);
  });
}

async function changeScore(team, amount) {
  try { await service.setTeamScore(team.id, Number(team.score) + amount); await pollHost(); }
  catch (error) { message(error.message); }
}

async function scoreFinal(team, correct) {
  try { await service.scoreFinal(team.id, correct); await pollHost(); }
  catch (error) { message(error.message); }
}

async function openClue(category, clue, categoryIndex, clueIndex) {
  const key = clueKey(categoryIndex, clueIndex);
  const used = [...new Set([...(currentSession.used_clues ?? []), key])];
  const board = structuredClone(currentSession.board_state);
  board.categories[categoryIndex].clues[clueIndex].used = true;
  currentSession = await service.updateSession(currentSession.id, {
    state: "clue", active_clue: { ...clue, categoryName: category.name, categoryIndex, clueIndex },
    show_answer: false, used_clues: used, board_state: board,
  });
  renderHost();
}

function renderHost() {
  if (!currentSession || !currentSet) return;
  elements.hostCode.textContent = currentSession.join_code;
  elements.startGame.hidden = currentSession.state !== "lobby";
  elements.beginFinal.hidden = ["final_wager", "final_clue", "final_answer", "finished"].includes(currentSession.state);
  elements.board.hidden = currentSession.state !== "board" && currentSession.state !== "lobby";
  elements.clue.hidden = !["clue", "answer"].includes(currentSession.state);
  elements.final.hidden = !["final_wager", "final_clue", "final_answer", "finished"].includes(currentSession.state);
  renderBoard(); renderTeams();
  if (!elements.clue.hidden) {
    const clue = currentSession.active_clue;
    elements.hostCategory.textContent = clue.categoryName;
    elements.hostValue.textContent = money(clue.value);
    elements.hostQuestion.textContent = clue.clue;
    elements.hostAnswer.textContent = clue.answer;
    elements.hostAnswer.hidden = !currentSession.show_answer;
    elements.revealAnswer.hidden = currentSession.show_answer;
  }
  if (!elements.final.hidden) {
    elements.finalCategory.textContent = currentSession.final_clue.category;
    elements.finalQuestion.textContent = currentSession.state === "final_wager" ? "Teams are entering wagers." : currentSession.final_clue.clue;
    elements.finalAnswer.textContent = currentSession.final_clue.answer;
    elements.finalAnswer.hidden = !["final_answer", "finished"].includes(currentSession.state);
    elements.showFinalClue.hidden = currentSession.state !== "final_wager";
    elements.revealFinal.hidden = currentSession.state !== "final_clue";
    elements.finishGame.hidden = currentSession.state !== "final_answer";
  }
}

async function pollHost() {
  if (!currentSession) return;
  try {
    [currentSession, teams] = await Promise.all([
      service.getGameSession(currentSession.id), service.listTeams(currentSession.id),
    ]);
    renderHost();
  } catch (error) { message(error.message); }
}

async function showHost(session) {
  currentSession = session;
  currentSet = gameSets.find((set) => set.id === session.set_id) ?? null;
  elements.library.hidden = true; elements.host.hidden = false;
  await pollHost();
  clearInterval(pollTimer); pollTimer = setInterval(pollHost, 1500);
}

elements.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = elements.importFile.files[0];
  if (!file) return message("Choose a completed workbook.");
  try {
    message("Checking workbook…");
    const game = await parseWorkbook(file, elements.setTitle.value);
    await service.saveSet(game); elements.importForm.reset(); await loadSets();
    message(`Saved “${game.title}”.`, true);
  } catch (error) { message(error.message); }
});

elements.createSession.addEventListener("click", async () => {
  const setId = elements.sessionSet.value;
  const maxTeams = Number(elements.maxTeams.value);
  if (!setId || !Number.isInteger(maxTeams) || maxTeams < 1 || maxTeams > 10) return message("Choose a game set and 1–10 teams.");
  try {
    const created = await service.createSession(setId, maxTeams);
    const session = await service.getGameSession(created.id);
    await showHost(session);
  } catch (error) { message(error.message); }
});

elements.startGame.addEventListener("click", async () => { currentSession = await service.updateSession(currentSession.id, { state: "board" }); renderHost(); });
elements.revealAnswer.addEventListener("click", async () => { currentSession = await service.updateSession(currentSession.id, { state: "answer", show_answer: true }); renderHost(); });
elements.returnBoard.addEventListener("click", async () => { currentSession = await service.updateSession(currentSession.id, { state: "board", active_clue: null, show_answer: false }); renderHost(); });
elements.beginFinal.addEventListener("click", async () => { currentSession = await service.updateSession(currentSession.id, { state: "final_wager", active_clue: null }); renderHost(); });
elements.showFinalClue.addEventListener("click", async () => { currentSession = await service.updateSession(currentSession.id, { state: "final_clue" }); renderHost(); });
elements.revealFinal.addEventListener("click", async () => { currentSession = await service.updateSession(currentSession.id, { state: "final_answer" }); await pollHost(); });
elements.finishGame.addEventListener("click", async () => { currentSession = await service.updateSession(currentSession.id, { state: "finished" }); await pollHost(); });
elements.backLibrary.addEventListener("click", () => { clearInterval(pollTimer); currentSession = null; elements.host.hidden = true; elements.library.hidden = false; });
elements.signIn.addEventListener("click", async () => { try { await service.signIn(); } catch (error) { elements.authMessage.textContent = error.message; } });
elements.signOut.addEventListener("click", async () => { await service.signOut(); location.reload(); });

async function initialize() {
  try {
    service = await createTeacherService(getRuntimeConfig());
    const session = await service.getSession();
    if (!session) return;
    if (!(await service.isTeacher())) { elements.authMessage.textContent = "This Google account is not approved for teacher access."; return; }
    elements.auth.hidden = true; elements.dashboard.hidden = false;
    await loadSets();
  } catch (error) { elements.authMessage.textContent = error.message; }
}
window.addEventListener("beforeunload", () => clearInterval(pollTimer));
initialize();
