// Gives an EXISTING user a local (email + password) sign-in, e.g. in a copy of the
// production database where everyone signs in through DWS Hub SSO and has no password.
// The password comes from the environment and is never printed.
//
//   docker compose ... run --rm -e PM_LOCAL_EMAIL=someone@energi-up.com pm-api-1 node backend/scripts/set-local-password.js
//   (PM_LOCAL_PASSWORD from the secrets file; at least 12 characters)
//
// Optional: PM_LOCAL_MAKE_ADMIN=true also makes that user an admin.
import bcrypt from 'bcryptjs';
import store from '../store.js';

const email = String(process.env.PM_LOCAL_EMAIL || '').trim().toLowerCase();
const password = process.env.PM_LOCAL_PASSWORD || '';
const makeAdmin = String(process.env.PM_LOCAL_MAKE_ADMIN || '').toLowerCase() === 'true';

try {
  if (!email) throw new Error('set PM_LOCAL_EMAIL to the user\'s e-mail address');
  if (password.length < 12) throw new Error('PM_LOCAL_PASSWORD must be set and at least 12 characters');
  const data = await store.read();
  const user = (data.users || []).find((u) => String(u.email || '').toLowerCase() === email);
  if (!user) throw new Error(`no user with e-mail ${email}`);
  user.passwordHash = await bcrypt.hash(password, 10);
  user.active = true;
  user.emailActivated = true;
  if (makeAdmin) user.isAdmin = true;
  await store.write(data);
  console.log(`[LOCAL-PASSWORD] ${email} can now sign in with e-mail and password${makeAdmin ? ' (admin)' : ''}`);
  await store.pool.end();
  process.exit(0);
} catch (e) {
  console.error('[LOCAL-PASSWORD] Failed:', e.message);
  process.exit(1);
}
