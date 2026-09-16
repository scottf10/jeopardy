import { createSupabaseClient } from "./supabase-client.js";

export async function createTeacherService(config) {
  const client = await createSupabaseClient(config, {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  });
  let accessToken = "";
  client.auth.onAuthStateChange((_event, session) => {
    accessToken = session?.access_token ?? "";
  });
  const fail = (result, message) => {
    if (result.error) throw new Error(`${message}: ${result.error.message}`);
    return result.data;
  };
  return {
    async getSession() {
      const session = (await client.auth.getSession()).data.session;
      accessToken = session?.access_token ?? "";
      return session;
    },
    onAuthStateChange(callback) {
      return client.auth.onAuthStateChange(callback).data.subscription;
    },
    async signIn() {
      const redirectTo = `${location.origin}/teacher/`;
      const result = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (result.error) throw new Error(result.error.message);
    },
    async signOut() {
      await client.auth.signOut();
    },
    async isTeacher() {
      return Boolean(fail(await client.rpc("is_teacher"), "Teacher access could not be checked"));
    },
    async listSets() {
      return fail(
        await client.from("jeopardy_sets").select("*").order("created_at", { ascending: false }),
        "Game sets could not be loaded",
      );
    },
    async saveSet(game) {
      return fail(
        await client
          .from("jeopardy_sets")
          .insert({ title: game.title, board_json: game.board, final_json: game.final })
          .select("*")
          .single(),
        "Game set could not be saved",
      );
    },
    async deleteSet(id) {
      return fail(
        await client.from("jeopardy_sets").delete().eq("id", id).select("id").single(),
        "Game set could not be deleted",
      );
    },
    async createSession(setId, maxTeams) {
      return fail(
        await client.rpc("jeopardy_create_session", { p_set_id: setId, p_max_teams: maxTeams }),
        "Session could not be created",
      );
    },
    async getGameSession(id) {
      return fail(
        await client.from("jeopardy_sessions").select("*").eq("id", id).single(),
        "Session could not be loaded",
      );
    },
    async updateSession(id, patch) {
      return fail(
        await client.from("jeopardy_sessions").update(patch).eq("id", id).select("*").single(),
        "Session could not be updated",
      );
    },
    endSessionOnUnload(id) {
      if (!accessToken || !id) return;
      fetch(`${config.supabaseUrl}/rest/v1/jeopardy_sessions?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          apikey: config.supabaseAnonKey,
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({ state: "finished", buzz_team_id: null, buzz_started_at: null }),
      }).catch(() => {});
    },
    async listTeams(sessionId) {
      return fail(
        await client
          .from("jeopardy_teams")
          .select("id,name,score,final_wager,final_answer,final_submitted,final_scored,created_at")
          .eq("session_id", sessionId)
          .order("created_at"),
        "Teams could not be loaded",
      );
    },
    async setTeamScore(teamId, score) {
      return fail(
        await client.from("jeopardy_teams").update({ score }).eq("id", teamId).select("id").single(),
        "Score could not be updated",
      );
    },
    async resolveBuzz(sessionId, teamId, correct) {
      return fail(
        await client.rpc("jeopardy_resolve_buzz", {
          p_session_id: sessionId,
          p_team_id: teamId,
          p_correct: correct,
        }),
        "Buzzed answer could not be scored",
      );
    },
    async scoreFinal(teamId, correct) {
      return fail(
        await client.rpc("jeopardy_score_final", { p_team_id: teamId, p_correct: correct }),
        "Final response could not be scored",
      );
    },
  };
}
