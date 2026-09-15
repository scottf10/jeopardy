const SUPABASE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm";

export async function createSupabaseClient(config, auth = {}) {
  const { createClient } = await import(SUPABASE_URL);
  return createClient(config.supabaseUrl, config.supabaseAnonKey, { auth });
}
