import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const emptyDatabase = { users: [], authSessions: [], profiles: [], sessions: [] };
let writeQueue = Promise.resolve();

function storagePaths() {
  const storageDir = path.resolve(process.env.DATA_DIR || "storage");
  return { storageDir, databasePath: path.join(storageDir, "database.json") };
}

export async function readDatabase() {
  const { storageDir, databasePath } = storagePaths();
  await mkdir(storageDir, { recursive: true });
  try {
    const stored = JSON.parse(await readFile(databasePath, "utf8"));
    return {
      users: Array.isArray(stored.users) ? stored.users : [],
      authSessions: Array.isArray(stored.authSessions) ? stored.authSessions : [],
      profiles: Array.isArray(stored.profiles) ? stored.profiles : [],
      sessions: Array.isArray(stored.sessions) ? stored.sessions : []
    };
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(emptyDatabase);
    throw error;
  }
}

export function updateDatabase(mutator) {
  const operation = writeQueue.then(async () => {
    const { databasePath } = storagePaths();
    const database = await readDatabase();
    const result = await mutator(database);
    await writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
