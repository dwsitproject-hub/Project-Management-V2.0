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

const isTrue = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());

router.get('/config', (_req, res) => {
  const src = String(process.env.HUB_SDK_URL || '').trim();
  const appKey = String(process.env.HUB_SDK_KEY || '').trim();
  if (!src || !appKey) return res.json({ enabled: false });

  const release = String(process.env.HUB_SDK_RELEASE || process.env.GIT_SHA || '').trim().slice(0, 64);
  res.set('Cache-Control', 'no-store');
  return res.json({
    enabled: true,
    src,
    appKey,
    release: release || null,
    debug: isTrue(process.env.HUB_SDK_DEBUG),
  });
});

export default router;
