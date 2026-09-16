import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npxCli = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "nodejs", "node_modules", "npm", "bin", "npx-cli.js");
const teacherEmail = String(process.env.TEACHER_EMAIL ?? "").trim().toLowerCase();
const siteOrigin = String(process.env.SITE_ORIGIN ?? "https://jeopardy-7cj.pages.dev").replace(/\/$/, "");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail)) throw new Error("TEACHER_EMAIL is required.");
if (!/^https:\/\/[a-z0-9.-]+$/i.test(siteOrigin)) throw new Error("SITE_ORIGIN must be an HTTPS origin.");

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function dbQuery(sql) {
  const compactSql = sql.replace(/\s+/g, " ").trim();
  const output = execFileSync(
    process.execPath,
    [npxCli, "--yes", "supabase@latest", "db", "query", "--linked", "--agent", "yes", compactSql],
    { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const start = output.indexOf("{");
  if (start < 0) throw new Error("Supabase query returned no JSON result.");
  return JSON.parse(output.slice(start)).rows ?? [];
}

async function request(config, pathname, body) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${pathname}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${config.supabaseAnonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function runtimeConfig() {
  const response = await fetch(`${siteOrigin}/runtime-config.js`);
  assert.equal(response.status, 200, "production runtime config must load");
  const source = await response.text();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, "runtime config must contain a JSON object");
  return JSON.parse(source.slice(start, end + 1));
}

let setId;
let sessionId;
try {
  const accessRows = dbQuery(`
    select u.id::text as teacher_id,
           exists(select 1 from public.teacher_allowlist a where a.email = u.email::citext and a.active) as allowed
    from auth.users u
    where lower(u.email) = lower(${sqlLiteral(teacherEmail)})
    limit 1;
  `);
  assert.equal(accessRows.length, 1, "teacher Google account must exist in Supabase Auth");
  assert.equal(accessRows[0].allowed, true, "teacher Google account must be allowlisted");
  const teacherId = accessRows[0].teacher_id;

  const setRows = dbQuery(`
    with categories as (
      select jsonb_agg(
        jsonb_build_object(
          'name', 'Category ' || category_number,
          'clues', (
            select jsonb_agg(
              jsonb_build_object('value', clue_number * 100, 'clue', 'Verification clue', 'answer', 'Verification answer')
              order by clue_number
            )
            from generate_series(1, 5) clue_number
          )
        ) order by category_number
      ) as data
      from generate_series(1, 6) category_number
    )
    insert into public.jeopardy_sets (teacher_id, title, board_json, final_json)
    select ${sqlLiteral(teacherId)}::uuid,
           'Automated launch verification',
           jsonb_build_object('categories', data),
           jsonb_build_object('category', 'Verification', 'clue', 'Final verification clue', 'answer', 'Final verification answer')
    from categories
    returning id::text;
  `);
  setId = setRows[0].id;

  const claims = JSON.stringify({ sub: teacherId, email: teacherEmail, role: "authenticated" });
  const sessionRows = dbQuery(`
    with claims as (
      select set_config('request.jwt.claim.sub', ${sqlLiteral(teacherId)}, true),
             set_config('request.jwt.claims', ${sqlLiteral(claims)}, true)
    )
    select public.jeopardy_create_session(${sqlLiteral(setId)}::uuid, 10) as result
    from claims;
  `);
  const created = typeof sessionRows[0].result === "string" ? JSON.parse(sessionRows[0].result) : sessionRows[0].result;
  sessionId = created.id;
  const code = created.joinCode;
  assert.match(code, /^[A-Z0-9]{6}$/);

  const config = await runtimeConfig();
  const teams = [];
  for (let index = 1; index <= 10; index += 1) {
    const joined = await request(config, "rpc/jeopardy_join_session", { p_code: code, p_team_name: `Verification Team ${index}` });
    assert.equal(joined.response.status, 200, `team ${index} must be able to join`);
    teams.push(joined.payload);
  }
  const overLimit = await request(config, "rpc/jeopardy_join_session", { p_code: code, p_team_name: "Verification Team 11" });
  assert.notEqual(overLimit.response.status, 200, "an eleventh team must be rejected");

  const firstState = await request(config, "rpc/jeopardy_team_state", { p_code: code, p_token: teams[0].token });
  assert.equal(firstState.response.status, 200);
  assert.equal(firstState.payload.maxTeams, 10);
  assert.equal(firstState.payload.teams.length, 10);
  assert.equal(firstState.payload.state, "lobby");

  dbQuery(`
    update public.jeopardy_sessions
    set state = 'clue',
        active_clue = '{"value":100,"clue":"Verification clue","answer":"Verification answer","categoryName":"Verification"}'::jsonb,
        show_answer = false,
        buzz_team_id = null,
        buzz_started_at = null,
        buzzed_team_ids = '[]'::jsonb
    where id = ${sqlLiteral(sessionId)}::uuid
    returning id::text;
  `);
  const firstBuzz = await request(config, "rpc/jeopardy_buzz", { p_code: code, p_token: teams[0].token });
  assert.equal(firstBuzz.response.status, 200, "first eligible team must win the buzz");
  const blockedBuzz = await request(config, "rpc/jeopardy_buzz", { p_code: code, p_token: teams[1].token });
  assert.notEqual(blockedBuzz.response.status, 200, "a second team cannot replace an active buzzer");
  const buzzState = await request(config, "rpc/jeopardy_team_state", { p_code: code, p_token: teams[1].token });
  assert.equal(buzzState.payload.buzzer.teamId, teams[0].teamId);
  assert.equal(buzzState.payload.buzzer.teamName, "Verification Team 1");
  assert.ok(buzzState.payload.buzzer.remainingMs > 0);

  dbQuery(`
    with claims as (
      select set_config('request.jwt.claim.sub', ${sqlLiteral(teacherId)}, true),
             set_config('request.jwt.claims', ${sqlLiteral(claims)}, true)
    )
    select public.jeopardy_resolve_buzz(${sqlLiteral(sessionId)}::uuid, ${sqlLiteral(teams[0].teamId)}::uuid, false)
    from claims;
  `);
  const secondBuzz = await request(config, "rpc/jeopardy_buzz", { p_code: code, p_token: teams[1].token });
  assert.equal(secondBuzz.response.status, 200, "another team may buzz after an incorrect response");
  dbQuery(`
    with claims as (
      select set_config('request.jwt.claim.sub', ${sqlLiteral(teacherId)}, true),
             set_config('request.jwt.claims', ${sqlLiteral(claims)}, true)
    )
    select public.jeopardy_resolve_buzz(${sqlLiteral(sessionId)}::uuid, ${sqlLiteral(teams[1].teamId)}::uuid, true)
    from claims;
  `);
  const buzzScores = dbQuery(`select name, score from public.jeopardy_teams where id in (${sqlLiteral(teams[0].teamId)}::uuid, ${sqlLiteral(teams[1].teamId)}::uuid) order by name;`);
  assert.deepEqual(buzzScores.map((team) => team.score), [-100, 100]);

  dbQuery(`update public.jeopardy_sessions set state = 'final_wager' where id = ${sqlLiteral(sessionId)}::uuid returning id::text;`);
  const wager = await request(config, "rpc/jeopardy_submit_wager", { p_code: code, p_token: teams[0].token, p_wager: 0 });
  assert.equal(wager.response.status, 204);

  dbQuery(`update public.jeopardy_sessions set state = 'final_clue' where id = ${sqlLiteral(sessionId)}::uuid returning id::text;`);
  const answer = await request(config, "rpc/jeopardy_submit_answer", { p_code: code, p_token: teams[0].token, p_answer: "Verification response" });
  assert.equal(answer.response.status, 204);

  dbQuery(`update public.jeopardy_sessions set state = 'final_answer' where id = ${sqlLiteral(sessionId)}::uuid returning id::text;`);
  const revealed = await request(config, "rpc/jeopardy_team_state", { p_code: code, p_token: teams[0].token });
  assert.equal(revealed.response.status, 200);
  assert.equal(revealed.payload.final.answer, "Final verification answer");
  assert.equal(revealed.payload.myTeam.finalSubmitted, true);

  dbQuery(`
    with claims as (
      select set_config('request.jwt.claim.sub', ${sqlLiteral(teacherId)}, true),
             set_config('request.jwt.claims', ${sqlLiteral(claims)}, true)
    )
    select public.jeopardy_score_final(${sqlLiteral(teams[0].teamId)}::uuid, true)
    from claims;
  `);
  const scored = dbQuery(`select final_scored, score from public.jeopardy_teams where id = ${sqlLiteral(teams[0].teamId)}::uuid;`);
  assert.equal(scored[0].final_scored, true);
  assert.equal(scored[0].score, -100);

  console.log(JSON.stringify({
    siteOrigin,
    teacherAccess: true,
    sessionCodeCreated: true,
    tenTeamsJoined: true,
    eleventhTeamRejected: true,
    firstBuzzWon: true,
    incorrectReopenedBuzzing: true,
    finalJeopardyCompleted: true,
  }));
} finally {
  if (sessionId) dbQuery(`delete from public.jeopardy_sessions where id = ${sqlLiteral(sessionId)}::uuid; select true as cleaned;`);
  if (setId) dbQuery(`delete from public.jeopardy_sets where id = ${sqlLiteral(setId)}::uuid; select true as cleaned;`);
}
