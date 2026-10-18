/**
 * Blocks until MySQL accepts connections, then exits 0. Used by the Docker
 * entrypoint so migrations don't race the database container's first boot.
 * Reuses mysql2 (already a dependency) - no extra tooling in the image.
 */
const mysql = require("mysql2/promise");

const host = process.env.MYSQL_HOST ?? "localhost";
const port = Number(process.env.MYSQL_PORT ?? 3306);
const user = process.env.MYSQL_USER ?? "root";
const password = process.env.MYSQL_PASSWORD ?? "";
const attempts = Number(process.env.DB_WAIT_ATTEMPTS ?? 60);
const delayMs = Number(process.env.DB_WAIT_DELAY_MS ?? 2000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let connection;
    try {
      connection = await mysql.createConnection({
        host,
        port,
        user,
        password,
        connectTimeout: 5000,
      });
      await connection.ping();
      await connection.end();
      console.log(`MySQL is ready at ${host}:${port}`);
      return;
    } catch (err) {
      if (connection) connection.destroy().catch(() => {});
      console.log(`MySQL not ready (${attempt}/${attempts}): ${err.message}`);
      await sleep(delayMs);
    }
  }
  throw new Error(
    `MySQL did not become reachable at ${host}:${port} after ${attempts} attempts`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
