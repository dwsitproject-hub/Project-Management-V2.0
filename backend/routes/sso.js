// DWS Hub SSO consumer — ADDITIVE to the existing email/password login.
//
// Two mechanisms, each activated only when its env vars are present:
//   1. OIDC (Authorization Code + PKCE, RS256)  — the recommended path.
//        GET  /api/auth/sso/oidc/login     start SP-initiated login
//        GET  /api/auth/sso/oidc/callback  handle SP- AND IdP-initiated callbacks
//   2. HS256 POST bridge (legacy)          — kept for backward compatibility.
//        POST /api/auth/sso/hub            Hub auto-POSTs a short-lived HS256 JWT
//
// On success either path mints the SAME app JWT that POST /api/auth/login issues
// (keyed on the local user's UUID) and hands it to the SPA via a URL-fragment
// redirect:  <FRONTEND_URL>/#sso?token=<appJwt>
// so all existing middleware / permissions / frontend code keep working unchanged.

import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import store from '../store.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ---- Configuration (read once at module load) -----------------------------
const OIDC_DISCOVERY_URL = process.env.OIDC_DISCOVERY_URL || '';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const OIDC_SCOPES = process.env.OIDC_SCOPES || 'openid email profile';
const APP_PUBLIC_ORIGIN = (process.env.APP_PUBLIC_ORIGIN || 'http://localhost:8080').replace(/\/+$/, '');
const OIDC_REDIRECT_URI =
  process.env.OIDC_REDIRECT_URI || `${APP_PUBLIC_ORIGIN}/api/auth/sso/oidc/callback`;
const FRONTEND_URL = (process.env.FRONTEND_URL || APP_PUBLIC_ORIGIN).replace(/\/+$/, '');

const SSO_TOKEN_SECRET = process.env.SSO_TOKEN_SECRET || '';
const SSO_JIT_ENABLED = String(process.env.SSO_JIT_ENABLED || 'false').toLowerCase() === 'true';

const OIDC_ENABLED = Boolean(OIDC_DISCOVERY_URL && OIDC_CLIENT_ID);
const BRIDGE_ENABLED = Boolean(SSO_TOKEN_SECRET);

const APP_JWT_TTL = '8h'; // must match routes/auth.js login token lifetime
const TX_COOKIE = 'sso_tx'; // holds PKCE state/nonce/verifier between login and callback

// ---- OIDC discovery (cached) ----------------------------------------------
let _meta = null;
let _metaFetchedAt = 0;
let _jwks = null;
const META_TTL_MS = 60 * 60 * 1000; // 1h

async function loadMetadata() {
  const now = Date.now();
  if (_meta && now - _metaFetchedAt < META_TTL_MS) return _meta;
  const resp = await fetch(OIDC_DISCOVERY_URL, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`discovery ${resp.status}`);
  const meta = await resp.json();
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (!meta[k]) throw new Error(`discovery document missing ${k}`);
  }
  _meta = meta;
  _metaFetchedAt = now;
  _jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  return meta;
}

// ---- Helpers ---------------------------------------------------------------
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function frontendRedirect(res, params) {
  const qs = new URLSearchParams(params).toString();
  // Token/error travel in the URL fragment so they are never sent to a server.
  return res.redirect(303, `${FRONTEND_URL}/#sso?${qs}`);
}

/**
 * Map a Hub-verified identity to a local user, then mint the app JWT and hand
 * it to the SPA. Local login and password hashes are never touched here.
 */
async function finalizeSsoLogin(res, { email, subject, provider }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return frontendRedirect(res, { error: 'SSO token had no email' });

  const data = await store.read();
  let user = (data.users || []).find((u) => String(u.email || '').toLowerCase() === cleanEmail);
  let isNewUser = false;

  if (!user) {
    if (!SSO_JIT_ENABLED) {
      return frontendRedirect(res, {
        error: 'No account found for your email. Please contact an administrator for access.',
      });
    }
    // JIT provisioning: create a local user with no usable password.
    user = {
      id: crypto.randomUUID(),
      name: cleanEmail.split('@')[0],
      email: cleanEmail,
      role: 'User',
      departmentId: null,
      active: true,
      passwordHash: null, // no password — SSO only until they set one
      isAdmin: 0,
      emailActivated: true, // Hub verified the email
    };
    data.users.push(user);
    isNewUser = true;
  }

  if (user.active === false) {
    return frontendRedirect(res, { error: 'Your account is inactive. Please contact an administrator.' });
  }

  // store.write() rewrites the WHOLE store and is serialized, so it must stay off
  // the login hot path — otherwise every click queues a full-DB write and, under
  // contention, the callback stalls past nginx's timeout (504). A returning,
  // already-activated user changes nothing here and writes nothing.
  let mustPersist = isNewUser;
  // Hub verified the email — a stronger signal than the email-link flow — so mark
  // SSO users activated (keeps the API middleware happy). Only flips once.
  if (!user.emailActivated) { user.emailActivated = true; mustPersist = true; }
  if (user.ssoSubject !== subject) { user.ssoSubject = subject; mustPersist = true; }
  if (user.ssoProvider !== provider) { user.ssoProvider = provider; mustPersist = true; }
  // NB: deliberately do NOT persist a per-login timestamp — it is not worth a
  // full-store write on every login.
  if (mustPersist) await store.write(data);

  const isAdmin = !!user.isAdmin;
  const appToken = jwt.sign(
    { sub: user.id, email: user.email || '', name: user.name || '', isAdmin },
    JWT_SECRET,
    { expiresIn: APP_JWT_TTL }
  );
  console.log(`[SSO] ${provider} login: ${user.email}`);
  return frontendRedirect(res, { token: appToken });
}

// ---- Public: which SSO modes are enabled (frontend uses this) --------------
router.get('/config', (_req, res) => {
  res.json({ oidc: OIDC_ENABLED, bridge: BRIDGE_ENABLED });
});

// ---- OIDC: start SP-initiated login ----------------------------------------
router.get('/oidc/login', async (req, res) => {
  if (!OIDC_ENABLED) return res.status(404).send('OIDC SSO is not configured');
  try {
    const meta = await loadMetadata();
    const state = b64url(crypto.randomBytes(16));
    const nonce = b64url(crypto.randomBytes(16));
    const { verifier, challenge } = pkcePair();

    // Stash the transaction in a short-lived signed, httpOnly cookie (stateless).
    const tx = jwt.sign({ state, nonce, verifier }, JWT_SECRET, { expiresIn: '10m' });
    res.cookie(TX_COOKIE, tx, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      maxAge: 10 * 60 * 1000,
      path: '/api/auth/sso',
    });

    const authUrl = new URL(meta.authorization_endpoint);
    authUrl.searchParams.set('client_id', OIDC_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', OIDC_REDIRECT_URI);
    authUrl.searchParams.set('scope', OIDC_SCOPES);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    return res.redirect(302, authUrl.toString());
  } catch (e) {
    console.warn('[SSO] oidc/login failed:', e.message);
    return frontendRedirect(res, { error: 'Could not start SSO login' });
  }
});

// ---- OIDC: exchange an authorization code for tokens (JSON body, per Hub) ---
async function exchangeCode(meta, code, codeVerifier) {
  const resp = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: OIDC_REDIRECT_URI, // required — must match exactly
      client_id: OIDC_CLIENT_ID, // public client, no secret
      code_verifier: codeVerifier,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`token endpoint ${resp.status}: ${text.slice(0, 300)}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('token response not JSON'); }
  if (!body.id_token) throw new Error('no id_token in token response');
  return body.id_token;
}

async function verifyIdToken(meta, idToken) {
  const { payload } = await jwtVerify(idToken, _jwks, {
    issuer: meta.issuer,
    audience: OIDC_CLIENT_ID,
  });
  return payload; // exp/iat enforced by jwtVerify
}

// ---- OIDC: callback (handles BOTH SP- and IdP-initiated flows) --------------
router.get('/oidc/callback', async (req, res) => {
  if (!OIDC_ENABLED) return res.status(404).send('OIDC SSO is not configured');
  try {
    const meta = await loadMetadata();
    const code = req.query.code;
    if (!code) throw new Error('missing authorization code');

    const queryVerifier = req.query.code_verifier; // present ⇒ IdP-initiated (Hub tile)
    let codeVerifier;
    let expectedNonce = null;

    if (queryVerifier) {
      // IdP-initiated: no session state to check; the id_token signature is the
      // trust anchor (verified below against the Hub's JWKS).
      codeVerifier = String(queryVerifier);
    } else {
      // SP-initiated: recover state/nonce/verifier from our signed cookie.
      const txRaw = req.cookies?.[TX_COOKIE];
      if (!txRaw) throw new Error('missing SSO transaction cookie');
      let tx;
      try { tx = jwt.verify(txRaw, JWT_SECRET); } catch { throw new Error('invalid SSO transaction'); }
      if (!req.query.state || req.query.state !== tx.state) throw new Error('state mismatch');
      codeVerifier = tx.verifier;
      expectedNonce = tx.nonce;
    }

    const idToken = await exchangeCode(meta, String(code), codeVerifier);
    const claims = await verifyIdToken(meta, idToken);
    if (expectedNonce && claims.nonce && claims.nonce !== expectedNonce) {
      throw new Error('nonce mismatch');
    }
    if (!claims.sub) throw new Error('id_token had no subject');

    res.clearCookie(TX_COOKIE, { path: '/api/auth/sso' });
    return finalizeSsoLogin(res, {
      email: claims.email,
      subject: `oidc:${claims.sub}`,
      provider: 'oidc',
    });
  } catch (e) {
    console.warn('[SSO] oidc/callback failed:', e.message);
    return frontendRedirect(res, { error: 'SSO login failed' });
  }
});

// ---- Legacy HS256 POST bridge ----------------------------------------------
// Hub auto-POSTs application/x-www-form-urlencoded with a single field `token`.
router.post('/hub', express.urlencoded({ extended: false }), async (req, res) => {
  if (!BRIDGE_ENABLED) return res.status(503).send('SSO bridge is not configured');
  const token = req.body?.token;
  if (!token) return res.status(400).send('Missing token');

  let payload;
  try {
    payload = jwt.verify(token, SSO_TOKEN_SECRET, { algorithms: ['HS256'], clockTolerance: 10 });
  } catch {
    return res.status(401).send('Invalid or expired token');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!email || !payload.user_id) return res.status(400).send('Invalid token payload');

  return finalizeSsoLogin(res, {
    email,
    subject: `hub:${payload.user_id}`,
    provider: 'hub',
  });
});

export default router;
