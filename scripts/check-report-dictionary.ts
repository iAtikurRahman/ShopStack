/**
 * Every dictionary key a report uses has to exist in both locales.
 *
 * The routes and the report builders answer in keys (`reports.col.revenue`), and
 * the client resolves them - which means a missing key does not fail a build, it
 * renders the raw key on the screen and a blank in the PDF. `bn` is typed against
 * `en`, so a *missing* Bengali key is caught by `tsc`, but an English key that
 * no code path ever asked for (or one that was renamed in a builder and not here)
 * is not. This check closes that gap: it reads the keys out of the source and
 * fails if the dictionaries cannot answer all of them.
 *
 * Run: npm run check:report-dictionary
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { en as reportsEn } from "../src/lib/i18n/dictionaries/en/reports";
import { bn as reportsBn } from "../src/lib/i18n/dictionaries/bn/reports";

const ROOT = path.join(process.cwd(), "src");
const KEY_PATTERN = /["'`](reports\.[A-Za-z0-9_.]+)["'`]/g;
/** A key built at runtime, e.g. `reports.family.${family}`. The whole key
 *  cannot be known statically, but its prefix can, and it is enough to know the
 *  dictionaries have to answer *something* under it. */
const PREFIX_PATTERN = /["'`]?(reports\.[A-Za-z0-9_.]*)\$\{/g;

/** Every `reports.x.y` string literal under src/, plus runtime key prefixes. */
function collectUsedKeys(dir: string, found = new Set<string>(), prefixes = new Set<string>()): { keys: Set<string>; prefixes: Set<string> } {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // node_modules and generated clients are not scanned.
      if (entry === "generated" || entry.startsWith(".")) continue;
      collectUsedKeys(full, found, prefixes);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    const source = readFileSync(full, "utf8");
    for (const match of source.matchAll(KEY_PATTERN)) {
      found.add(match[1]);
    }
    for (const match of source.matchAll(PREFIX_PATTERN)) {
      prefixes.add(match[1]);
    }
  }
  return { keys: found, prefixes };
}

/** Flattens a nested dictionary to dotted leaf paths. */
function flatten(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    out.add(prefix);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

const used = collectUsedKeys(ROOT);
const provided = flatten(reportsEn);
const providedBn = flatten(reportsBn);

/** True when a key is written literally, or falls under a runtime prefix. */
function answered(key: string, dictionary: Set<string>): boolean {
  if (dictionary.has(key)) return true;
  for (const prefix of used.prefixes) {
    // The captured prefix already ends in ".", so compare without adding one.
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

const missingEn = [...used.keys].filter((key) => !answered(key, provided)).sort();
const missingBn = [...used.keys].filter((key) => !answered(key, providedBn)).sort();
/** A key nothing asks for is dead weight in both locales; report it so it gets deleted. */
const unused = [...provided].filter((key) => !answered(key, used.keys)).sort();

let failed = false;
if (missingEn.length > 0) {
  failed = true;
  console.error(`Missing ${missingEn.length} English key(s):`);
  for (const key of missingEn) console.error(`  ${key}`);
}
if (missingBn.length > 0) {
  failed = true;
  console.error(`Missing ${missingBn.length} Bengali key(s):`);
  for (const key of missingBn) console.error(`  ${key}`);
}
if (unused.length > 0) {
  console.warn(`${unused.length} unused English key(s):`);
  for (const key of unused) console.warn(`  ${key}`);
}

console.log(`${used.keys.size} report keys in use (${used.prefixes.size} runtime prefixes), ${provided.size} defined (en), ${providedBn.size} (bn).`);
if (failed) process.exit(1);