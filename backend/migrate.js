// One-off schema set-up / upgrade, run before rolling out a new version:
//   docker compose run --rm backend node backend/migrate.js      (or: npm run migrate)
// The backend also does this itself at start-up (under an advisory lock, so two nodes
// can't clash) unless SCHEMA_SETUP=skip is set; this script works either way.
import store from './store.js';

try {
  const started = Date.now();
  await store.migrate();
  console.log(`[MIGRATE] Schema is up to date (${Date.now() - started} ms)`);
  await store.pool.end();
  process.exit(0);
} catch (e) {
  console.error('[MIGRATE] Failed:', e.message);
  process.exit(1);
}
