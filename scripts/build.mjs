import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const supabaseUrl = String(process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY ?? "").trim();

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error("SUPABASE_URL must be a valid Supabase project URL.");
}
if (supabaseAnonKey.length < 20) throw new Error("SUPABASE_ANON_KEY is missing or invalid.");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(path.join(projectRoot, "public"), outputDirectory, { recursive: true });
await mkdir(path.join(outputDirectory, "downloads"), { recursive: true });
await cp(
  path.join(projectRoot, "outputs", "jeopardy-template", "jeopardy-import-template.xlsx"),
  path.join(outputDirectory, "downloads", "jeopardy-import-template.xlsx"),
);

const config = JSON.stringify({ supabaseUrl, supabaseAnonKey }).replaceAll("<", "\\u003c");
await writeFile(
  path.join(outputDirectory, "runtime-config.js"),
  `globalThis.__JEOPARDY_CONFIG__ = ${config};\n`,
  "utf8",
);
console.log(`Built production site in ${outputDirectory}`);
