export function getRuntimeConfig() {
  const config = globalThis.__JEOPARDY_CONFIG__ ?? {};
  const supabaseUrl = String(config.supabaseUrl ?? "").trim().replace(/\/$/, "");
  const supabaseAnonKey = String(config.supabaseAnonKey ?? "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) || supabaseAnonKey.length < 20) {
    throw new Error("The game service is not configured.");
  }
  return { supabaseUrl, supabaseAnonKey };
}
