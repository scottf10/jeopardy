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
    buzz(code, token) {
      return rpc("jeopardy_buzz", { p_code: code, p_token: token });
    },
    submitFinal(code, token, wager, answer) {
      return rpc("jeopardy_submit_final", {
        p_code: code,
        p_token: token,
        p_wager: wager,
        p_answer: answer,
      });
    },
  };
}
