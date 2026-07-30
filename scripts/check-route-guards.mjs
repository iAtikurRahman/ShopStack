// Fails (exit 1) if any route.ts under src/app/api/{company,store}/** exports
// an HTTP method handler that isn't built via withAuth(...). This is the
// guardrail against regressing to the old per-route opt-in requireAuth()
// pattern, where it was easy to add a route and forget the check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/api/company", "src/app/api/store"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function findRouteFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...findRouteFiles(fullPath));
    } else if (entry === "route.ts") {
      files.push(fullPath);
    }
  }
  return files;
}

const violations = [];

for (const root of ROOTS) {
  let routeFiles;
  try {
    routeFiles = findRouteFiles(root);
  } catch {
    continue;
  }

  for (const file of routeFiles) {
    const content = readFileSync(file, "utf8");

    for (const method of HTTP_METHODS) {
      const bareExportPattern = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`);
      if (bareExportPattern.test(content)) {
        violations.push(`${file}: exports a bare "${method}" function instead of withAuth(...)`);
        continue;
      }

      const constPattern = new RegExp(`export\\s+const\\s+${method}\\s*=([\\s\\S]{0,80})`);
      const match = content.match(constPattern);
      if (match && !/^withAuth\s*[<(]/.test(match[1].trimStart())) {
        violations.push(`${file}: "${method}" is not wrapped in withAuth(...)`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Route guard check failed:\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${violations.length} violation(s) found.`);
  process.exit(1);
}

console.log("Route guard check passed: every company/store API route uses withAuth().");
