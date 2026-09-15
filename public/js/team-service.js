import { createSupabaseClient } from "./supabase-client.js";

export async function createTeamService(config) {
  const client = await createSupabaseClient(config, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  const rpc = async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    join(code, name) {
      return rpc("jeopardy_join_session", { p_code: code, p_team_name: name });
    },
    state(code, token) {
      return rpc("jeopardy_team_state", { p_code: code, p_token: token });
    },
    submitWager(code, token, wager) {
      return rpc("jeopardy_submit_wager", { p_code: code, p_token: token, p_wager: wager });
    },
    submitAnswer(code, token, answer) {
      return rpc("jeopardy_submit_answer", { p_code: code, p_token: token, p_answer: answer });
    },
  };
}
