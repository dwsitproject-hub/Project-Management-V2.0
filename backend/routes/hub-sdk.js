// Downstream Hub SDK — per-environment configuration for the SPA.
//
// PM Tools is plain static files with no build step, so the SDK URL and key can't be
// baked into index.html per environment. The SPA asks for them here instead (the
// frontend's nginx already proxies /api/* to this backend on every environment).
//
// Env (all optional — the SDK simply stays off when URL or key is missing):
//   HUB_SDK_URL      e.g. http://test-dwshub.kpndomain.com/api/sdk/v1/hub-sdk.js
//   HUB_SDK_KEY      dwsk_… from Hub → Admin → Applications → Project Management → SDK
//   HUB_SDK_RELEASE  deployed git commit (short SHA) so Sentinel reads the exact code;
//                    GIT_SHA is accepted as an alias
//   HUB_SDK_DEBUG    "true" logs [DwsHub] lines in the browser console (staging only)
//
// The key is publishable by design: the Hub only accepts data from PM's registered origins.

import express from 'express';

const router = express.Router();

// Same rules the Hub applies (DWS Hub lib/sdkPolicy.js): a bad key gets 403 invalid_key
// on every request, and a bad release is silently dropped.
const SDK_KEY_RE = /^dwsk_[A-Za-z0-9_-]{20,60}$/;
const RELEASE_RE = /^[A-Za-z0-9][A-Za-z0-9._+\-]{0,63}$/;

const isTrue = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
// docker env_file keeps trailing "# comments" as part of the value; none of these
// values can legitimately contain '#', so cut there.
const envValue = (name) => String(process.env[name] || '').split('#')[0].trim();

function readConfig() {
  const src = envValue('HUB_SDK_URL');
  const appKey = envValue('HUB_SDK_KEY');
  if (!src || !appKey) return { enabled: false };
  if (!/^https?:\/\//i.test(src)) return { enabled: false, problem: 'HUB_SDK_URL must start with http:// or https://' };
  if (!SDK_KEY_RE.test(appKey)) return { enabled: false, problem: 'HUB_SDK_KEY is not a valid dwsk_… key (copy it from the Hub snippet)' };

  const rawRelease = envValue('HUB_SDK_RELEASE') || envValue('GIT_SHA');
  const release = RELEASE_RE.test(rawRelease) ? rawRelease : null;
  return {
    enabled: true,
    src,
    appKey,
    release,
    debug: isTrue(process.env.HUB_SDK_DEBUG),
    problem: rawRelease && !release ? 'HUB_SDK_RELEASE is not a commit SHA/tag — sent without a release' : null,
  };
}

const boot = readConfig();
if (boot.problem) console.warn(`[HUB-SDK] ${boot.problem}`);
console.log(`[HUB-SDK] ${boot.enabled ? `enabled (release ${boot.release || 'none'})` : 'disabled'}`);

router.get('/config', (_req, res) => {
  const { problem: _problem, ...cfg } = readConfig();
  res.set('Cache-Control', 'no-store');
  return res.json(cfg.enabled ? { ...cfg, release: cfg.release || null } : { enabled: false });
});

export default router;
