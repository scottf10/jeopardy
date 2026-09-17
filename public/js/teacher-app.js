import { getRuntimeConfig } from "./config.js";
import { downloadAnswerKey } from "./answer-key-pdf.js";
import { buzzSecondsRemaining } from "./buzzer.js";
import { clueKey, extractWorksheetRows, normalizeImportedGame } from "./game-set.js";
import { rankTeams, winnerAnnouncement } from "./leaderboard.js";
import { createTeacherService } from "./teacher-service.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  auth: $("#auth-view"), dashboard: $("#dashboard-view"), authMessage: $("#auth-message"),
  dashboardMessage: $("#dashboard-message"), signIn: $("#sign-in"), signOut: $("#sign-out"),
  library: $("#library-view"), host: $("#host-view"), importForm: $("#import-form"),
  importButton: $("#import-form button[type='submit']"),
  setTitle: $("#set-title"), importFile: $("#import-file"), setsList: $("#sets-list"),
  sessionSet: $("#session-set"), maxTeams: $("#max-teams"), createSession: $("#create-session"),
  hostCode: $("#host-code"), backLibrary: $("#back-library"), startGame: $("#start-game"),
  beginFinal: $("#begin-final"), board: $("#host-board"), clue: $("#host-clue"),
  hostCategory: $("#host-category"), hostValue: $("#host-value"), hostQuestion: $("#host-question"),
  hostAnswer: $("#host-answer"), revealAnswer: $("#reveal-answer"), returnBoard: $("#return-board"),
  buzzSeconds: $("#buzz-seconds"), saveBuzzSeconds: $("#save-buzz-seconds"),
  buzzerStatus: $("#host-buzzer-status"),
  final: $("#host-final"), finalCategory: $("#final-category"), finalQuestion: $("#final-question"),
  finalAnswer: $("#final-answer"), finalScoringStatus: $("#final-scoring-status"),
  revealFinal: $("#reveal-final"), showLeaderboard: $("#show-leaderboard"),
  leaderboard: $("#host-leaderboard"), leaderboardList: $("#teacher-leaderboard"),
  teacherWinner: $("#teacher-winner"),
  finishGame: $("#finish-game"), teams: $("#host-teams"), teamCount: $("#host-team-count"),
  teamsPanel: $("#teams-panel"), hostLayout: $(".host-layout"),
};

let service;
let gameSets = [];
let currentSession = null;
let currentSet = null;
let teams = [];
let pollTimer;
let countdownTimer;
let endingSession = false;
let hostPollInFlight = false;
let hostRevision = 0;
let lastHostState = "";
let importPending = false;
let sessionCreatePending = false;
let clueOpening = false;
let sessionPatchPending = false;
let buzzPausePending = false;
const HOST_SESSION_KEY = "jeopardy-host-session";
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
  const questions = extractWorksheetRows(
    XLSX.utils.sheet_to_json(questionsSheet, { header: 1, defval: "", blankrows: false }),
    { includeValue: true, sheetName: "Questions" },
  );
  const finalRows = extractWorksheetRows(
    XLSX.utils.sheet_to_json(finalSheet, { header: 1, defval: "", blankrows: false }),
    { sheetName: "Final Jeopardy" },
  );
  return normalizeImportedGame(title, questions, finalRows[0]);
}

function renderSets() {
  elements.setsList.replaceChildren();
  elements.sessionSet.replaceChildren(new Option("Choose a game set", ""));
  gameSets.forEach((set) => {
    const card = element("div", undefined, "set-card");
    const text = element("div");
    text.append(element("strong", set.title), element("small", `${set.board_json.categories.length} categories`));
    const actions = element("div", undefined, "set-card-actions");
    const answerKey = element("button", "Answer key PDF", "button primary");
    answerKey.type = "button";
    answerKey.addEventListener("click", async () => {
      answerKey.disabled = true;
      try {
        await downloadAnswerKey(set);
        message(`Downloaded the answer key for “${set.title}”.`, true);
      } catch (error) { message(`Answer key could not be created: ${error.message}`); }
      finally { answerKey.disabled = false; }
    });
    const remove = element("button", "Delete", "button secondary");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete “${set.title}”? This also removes its previous sessions and team scores.`)) return;
      remove.disabled = true;
      try { await service.deleteSet(set.id); await loadSets(); message("Game set deleted.", true); }
      catch (error) { message(error.message); }
      finally { remove.disabled = false; }
    });
    actions.append(answerKey, remove);
    card.append(text, actions);
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
  elements.teamCount.textContent = currentSession?.state === "lobby"
    ? `Teams (${teams.length} / ${currentSession.max_teams})`
    : `Teams (${teams.length})`;
  if (!teams.length) { elements.teams.append(element("p", "Waiting for teams to join…")); return; }
  teams.forEach((team) => {
    const card = element("div", undefined, "host-team");
    card.classList.toggle("is-buzzed", team.id === currentSession?.buzz_team_id);
    const top = element("div", undefined, "host-team-row");
    top.append(element("strong", team.name), element("span", money(team.score), "host-team-score"));
    card.append(top);
    if (currentSession?.state === "lobby") {
      const controls = element("div", undefined, "score-controls");
      const remove = element("button", "Remove from lobby", "button secondary");
      remove.type = "button";
      remove.addEventListener("click", () => removeTeam(team));
      controls.append(remove);
      card.append(controls);
    } else if (!["final_wager", "final_clue", "final_answer", "leaderboard", "finished"].includes(currentSession?.state)) {
      const controls = element("div", undefined, "score-controls");
      const value = Number(currentSession?.active_clue?.value ?? 100);
      const subtract = element("button", `−${money(value)}`, "button secondary");
      const add = element("button", `+${money(value)}`, "button primary");
      subtract.addEventListener("click", () => changeScore(team, -value));
      add.addEventListener("click", () => changeScore(team, value));
      controls.append(subtract, add);
      card.append(controls);
    }
    if (["final_wager", "final_clue", "final_answer"].includes(currentSession?.state)) {
      const response = element("div", undefined, "final-response");
      if (team.final_submitted) {
        response.append(
          element("strong", "Locked in"),
          element("div", `Wager: ${money(team.final_wager)}`),
          element("div", `Response: ${team.final_answer}`),
        );
      } else {
        response.append(element("div", "Waiting for wager and response…"));
      }
      if (currentSession?.state === "final_answer" && team.final_submitted) {
        const finalControls = element("div", undefined, "score-controls");
        const wrong = element("button", team.final_scored ? "Scored" : "Deduct wager", "button secondary");
        const right = element("button", "Award wager", "button gold");
        wrong.disabled = team.final_scored;
        right.disabled = team.final_scored;
        wrong.addEventListener("click", () => scoreFinal(team, false));
        right.addEventListener("click", () => scoreFinal(team, true));
        finalControls.append(wrong, right);
        response.append(finalControls);
      }
      card.append(response);
    }
    elements.teams.append(card);
  });
}

function renderLeaderboard() {
  elements.leaderboardList.replaceChildren();
  const ranked = rankTeams(teams);
  elements.teacherWinner.textContent = winnerAnnouncement(ranked[0]?.name);
  ranked.forEach((team, index) => {
    const row = element("div", undefined, `leaderboard-row${index === 0 ? " winner" : ""}`);
    row.append(
      element("span", team.place, "leaderboard-place"),
      element("strong", team.name, "leaderboard-name"),
      element("span", money(team.score), "leaderboard-score"),
    );
    elements.leaderboardList.append(row);
  });
}

function renderHostBuzzer() {
  clearInterval(countdownTimer);
  elements.buzzerStatus.replaceChildren();
  if (document.activeElement !== elements.buzzSeconds) {
    elements.buzzSeconds.value = String(currentSession.buzz_duration_seconds ?? 10);
  }

  const buzzedTeam = teams.find((team) => team.id === currentSession.buzz_team_id);
  if (!buzzedTeam || !currentSession.buzz_started_at) {
    elements.buzzerStatus.append(
      element("p", currentSession.state === "clue" ? "Buzzing is open — teams can press Space." : "Buzzing opens with a clue."),
    );
    return;
  }

  const title = element("p", "First buzz", "eyebrow");
  const name = element("h3", buzzedTeam.name);
  const countdown = element("div", "", "buzz-countdown");
  const paused = currentSession.buzz_paused_remaining_ms != null;
  const note = element("p", paused ? "Timer paused — this team still owns the buzzer." : "Answering now");
  const actions = element("div", undefined, "buzzer-actions");
  const pause = element("button", paused ? "Resume timer" : "Pause timer", "button primary");
  const wrong = element("button", `Incorrect (−${money(currentSession.active_clue?.value ?? 0)})`, "button secondary");
  const correct = element("button", `Correct (+${money(currentSession.active_clue?.value ?? 0)})`, "button gold");
  pause.type = "button";
  wrong.type = "button";
  correct.type = "button";
  pause.addEventListener("click", () => toggleBuzzPause(!paused));
  wrong.addEventListener("click", () => resolveBuzz(buzzedTeam.id, false));
  correct.addEventListener("click", () => resolveBuzz(buzzedTeam.id, true));
  actions.append(pause, wrong, correct);
  elements.buzzerStatus.append(title, name, countdown, note, actions);

  const deadline = paused
    ? Date.now() + Number(currentSession.buzz_paused_remaining_ms)
    : Date.parse(currentSession.buzz_started_at) + Number(currentSession.buzz_duration_seconds ?? 10) * 1000;
  const tick = () => {
    const seconds = buzzSecondsRemaining(deadline);
    countdown.textContent = String(seconds);
    if (seconds === 0) {
      note.textContent = "Time’s up — other eligible teams may buzz.";
      clearInterval(countdownTimer);
    }
  };
  tick();
  if (!paused && buzzSecondsRemaining(deadline) > 0) countdownTimer = setInterval(tick, 200);
}

async function changeScore(team, amount) {
  try { await service.setTeamScore(team.id, Number(team.score) + amount); await pollHost(); }
  catch (error) { message(error.message); }
}

async function removeTeam(team) {
  if (!confirm(`Remove “${team.name}” and free this team spot?`)) return;
  try {
    await service.removeTeam(team.id);
    await pollHost();
    message(`${team.name} was removed from the lobby.`, true);
  } catch (error) { message(error.message); }
}

async function scoreFinal(team, correct) {
  try { await service.scoreFinal(team.id, correct); await pollHost(); }
  catch (error) { message(error.message); }
}

async function resolveBuzz(teamId, correct) {
  try {
    hostRevision += 1;
    await service.resolveBuzz(currentSession.id, teamId, correct);
    lastHostState = "";
    await pollHost();
  } catch (error) { message(error.message); }
}

async function toggleBuzzPause(paused) {
  if (buzzPausePending) return;
  buzzPausePending = true;
  try {
    hostRevision += 1;
    await service.setBuzzPaused(currentSession.id, paused);
    lastHostState = "";
    await pollHost();
  } catch (error) { message(error.message); }
  finally { buzzPausePending = false; }
}

async function updateGameSession(patch) {
  hostRevision += 1;
  currentSession = await service.updateSession(currentSession.id, patch);
  return currentSession;
}

async function applySessionPatch(patch) {
  if (sessionPatchPending) return;
  sessionPatchPending = true;
  try {
    await updateGameSession(patch);
    renderHost();
  } catch (error) { message(error.message); }
  finally { sessionPatchPending = false; }
}

async function openClue(category, clue, categoryIndex, clueIndex) {
  if (clueOpening) return;
  clueOpening = true;
  const key = clueKey(categoryIndex, clueIndex);
  const used = [...new Set([...(currentSession.used_clues ?? []), key])];
  const board = structuredClone(currentSession.board_state);
  board.categories[categoryIndex].clues[clueIndex].used = true;
  try {
    await updateGameSession({
      state: "clue", active_clue: { ...clue, categoryName: category.name, categoryIndex, clueIndex },
      show_answer: false, used_clues: used, board_state: board,
      buzz_team_id: null, buzz_started_at: null, buzz_paused_remaining_ms: null, buzzed_team_ids: [],
    });
    renderHost();
  } catch (error) { message(error.message); }
  finally { clueOpening = false; }
}

function renderHost() {
  if (!currentSession || !currentSet) return;
  clearInterval(countdownTimer);
  elements.hostCode.textContent = currentSession.join_code;
  elements.startGame.hidden = currentSession.state !== "lobby";
  elements.beginFinal.hidden = currentSession.state === "lobby" || ["final_wager", "final_clue", "final_answer", "leaderboard", "finished"].includes(currentSession.state);
  elements.board.hidden = currentSession.state !== "board" && currentSession.state !== "lobby";
  elements.clue.hidden = !["clue", "answer"].includes(currentSession.state);
  elements.final.hidden = !["final_wager", "final_clue", "final_answer", "finished"].includes(currentSession.state);
  elements.leaderboard.hidden = currentSession.state !== "leaderboard";
  elements.teamsPanel.hidden = currentSession.state === "leaderboard";
  elements.hostLayout.classList.toggle("is-leaderboard", currentSession.state === "leaderboard");
  renderBoard(); renderTeams();
  if (!elements.clue.hidden) {
    const clue = currentSession.active_clue;
    elements.hostCategory.textContent = clue.categoryName;
    elements.hostValue.textContent = money(clue.value);
    elements.hostQuestion.textContent = clue.clue;
    elements.hostAnswer.textContent = clue.answer;
    elements.hostAnswer.hidden = !currentSession.show_answer;
    elements.revealAnswer.hidden = currentSession.show_answer;
    renderHostBuzzer();
  }
  if (!elements.final.hidden) {
    elements.finalCategory.textContent = currentSession.final_clue.category;
    elements.finalQuestion.textContent = currentSession.final_clue.clue;
    elements.finalAnswer.textContent = currentSession.final_clue.answer;
    elements.finalAnswer.hidden = !["final_answer", "finished"].includes(currentSession.state);
    elements.revealFinal.hidden = !["final_wager", "final_clue"].includes(currentSession.state);
    const unscored = teams.filter((team) => team.final_submitted && !team.final_scored).length;
    elements.finalScoringStatus.hidden = currentSession.state !== "final_answer";
    elements.finalScoringStatus.textContent = unscored
      ? `${unscored} locked response${unscored === 1 ? "" : "s"} still need scoring.`
      : "Final scoring is complete. The leaderboard is ready.";
    elements.showLeaderboard.hidden = currentSession.state !== "final_answer";
    elements.showLeaderboard.disabled = unscored > 0;
  }
  if (!elements.leaderboard.hidden) renderLeaderboard();
  lastHostState = JSON.stringify([currentSession, teams]);
}

async function pollHost() {
  if (!currentSession || hostPollInFlight) return;
  hostPollInFlight = true;
  const sessionId = currentSession.id;
  const revision = hostRevision;
  try {
    const [nextSession, nextTeams] = await Promise.all([
      service.getGameSession(sessionId), service.listTeams(sessionId),
    ]);
    if (revision !== hostRevision || currentSession?.id !== sessionId) return;
    currentSession = nextSession;
    teams = nextTeams;
    const serialized = JSON.stringify([currentSession, teams]);
    if (serialized !== lastHostState) renderHost();
  } catch (error) { message(error.message); }
  finally { hostPollInFlight = false; }
}

async function showHost(session) {
  currentSession = session;
  currentSet = gameSets.find((set) => set.id === session.set_id) ?? null;
  lastHostState = "";
  localStorage.setItem(HOST_SESSION_KEY, session.id);
  elements.library.hidden = true; elements.host.hidden = false;
  await pollHost();
  clearInterval(pollTimer); pollTimer = setInterval(pollHost, 650);
}

function hasActiveSession() {
  return Boolean(currentSession && currentSession.state !== "finished");
}

async function endCurrentSession() {
  if (!hasActiveSession() || endingSession) return false;
  endingSession = true;
  const sessionId = currentSession.id;
  try {
    hostRevision += 1;
    await service.deleteSession(sessionId);
    localStorage.removeItem(HOST_SESSION_KEY);
    return true;
  } finally {
    endingSession = false;
  }
}

function returnToLibrary(successText) {
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  currentSession = null;
  currentSet = null;
  teams = [];
  lastHostState = "";
  elements.host.hidden = true;
  elements.library.hidden = false;
  if (successText) message(successText, true);
}

elements.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (importPending) return;
  const file = elements.importFile.files[0];
  if (!file) return message("Choose a completed workbook.");
  importPending = true;
  elements.importButton.disabled = true;
  try {
    message("Checking workbook…");
    const game = await parseWorkbook(file, elements.setTitle.value);
    await service.saveSet(game); elements.importForm.reset(); await loadSets();
    message(`Saved “${game.title}”.`, true);
  } catch (error) { message(error.message); }
  finally { importPending = false; elements.importButton.disabled = false; }
});

elements.createSession.addEventListener("click", async () => {
  if (sessionCreatePending) return;
  const setId = elements.sessionSet.value;
  const maxTeams = Number(elements.maxTeams.value);
  if (!setId || !Number.isInteger(maxTeams) || maxTeams < 1 || maxTeams > 10) return message("Choose a game set and 1–10 teams.");
  sessionCreatePending = true;
  elements.createSession.disabled = true;
  try {
    const created = await service.createSession(setId, maxTeams);
    const session = await service.getGameSession(created.id);
    await showHost(session);
  } catch (error) { message(error.message); }
  finally { sessionCreatePending = false; elements.createSession.disabled = gameSets.length === 0; }
});

elements.startGame.addEventListener("click", () => applySessionPatch({ state: "board" }));
elements.revealAnswer.addEventListener("click", () => applySessionPatch({ state: "answer", show_answer: true, buzz_team_id: null, buzz_started_at: null, buzz_paused_remaining_ms: null }));
elements.returnBoard.addEventListener("click", () => applySessionPatch({ state: "board", active_clue: null, show_answer: false, buzz_team_id: null, buzz_started_at: null, buzz_paused_remaining_ms: null, buzzed_team_ids: [] }));
elements.beginFinal.addEventListener("click", () => applySessionPatch({ state: "final_clue", active_clue: null, buzz_team_id: null, buzz_started_at: null, buzz_paused_remaining_ms: null, buzzed_team_ids: [] }));
elements.saveBuzzSeconds.addEventListener("click", async () => {
  const seconds = Number(elements.buzzSeconds.value);
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 60) return message("Answer time must be between 3 and 60 seconds.");
  try {
    await updateGameSession({ buzz_duration_seconds: seconds });
    message(`Answer timer updated to ${seconds} seconds.`, true);
    renderHost();
  } catch (error) { message(error.message); }
});
elements.revealFinal.addEventListener("click", () => applySessionPatch({ state: "final_answer" }));
elements.showLeaderboard.addEventListener("click", () => applySessionPatch({ state: "leaderboard" }));
elements.finishGame.addEventListener("click", async () => {
  if (!confirm("Finish this game? Every team will be disconnected and returned to the join screen.")) return;
  try {
    await endCurrentSession();
    returnToLibrary("Game ended and its session data was cleared.");
  } catch (error) { message(error.message); }
});
elements.backLibrary.addEventListener("click", async () => {
  if (hasActiveSession() && !confirm("Return to the game library? This will end the game for every team.")) return;
  try {
    await endCurrentSession();
    returnToLibrary("Game ended and its session data was cleared.");
  } catch (error) { message(error.message); }
});
elements.signIn.addEventListener("click", async () => { try { await service.signIn(); } catch (error) { elements.authMessage.textContent = error.message; } });
elements.signOut.addEventListener("click", async () => {
  if (hasActiveSession() && !confirm("Sign out? This will end the game for every team.")) return;
  try {
    await endCurrentSession();
    await service.signOut();
    location.reload();
  } catch (error) { message(error.message); }
});

async function initialize() {
  try {
    service = await createTeacherService(getRuntimeConfig());
    const session = await service.getSession();
    if (!session) return;
    if (!(await service.isTeacher())) { elements.authMessage.textContent = "This Google account is not approved for teacher access."; return; }
    elements.auth.hidden = true; elements.dashboard.hidden = false;
    await loadSets();
    const savedSessionId = localStorage.getItem(HOST_SESSION_KEY);
    if (savedSessionId) {
      try {
        const savedSession = await service.getGameSession(savedSessionId);
        if (savedSession.state !== "finished") await showHost(savedSession);
        else localStorage.removeItem(HOST_SESSION_KEY);
      } catch {
        localStorage.removeItem(HOST_SESSION_KEY);
      }
    }
  } catch (error) { elements.authMessage.textContent = error.message; }
}
window.addEventListener("beforeunload", (event) => {
  if (!hasActiveSession()) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => {
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  if (hasActiveSession()) {
    localStorage.removeItem(HOST_SESSION_KEY);
    service.endSessionOnUnload(currentSession.id);
  }
});
initialize();
