// Shared access-rule matching, used by /api/profile (to tell the SPA a user's
// effective access) and by route guards (to enforce it server-side).

// Does an access-rule's emailDomain pattern match a user's email?
// Supports exact ("@energi-up.com") and negated ("!*@energi-up.com") forms.
export function emailDomainMatches(pattern, email) {
  if (!pattern) return true; // blank = matches anyone
  const e = String(email || '').toLowerCase();
  const p = String(pattern).trim();
  if (p.startsWith('!')) {
    const domain = p.replace(/^!\*?/, '').toLowerCase(); // "!*@energi-up.com" -> "@energi-up.com"
    return domain ? !e.endsWith(domain) : true;
  }
  return e.endsWith(p.toLowerCase());
}

// Pick the most specific saved access rule that applies to this user (or null).
export function matchAccessRule(user, rules) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const email = String(user?.email || '').toLowerCase();
  const type = user?.type || null;
  const role = user?.role || null;
  let best = null;
  let bestScore = -1;
  for (const r of rules) {
    if (r.role && r.role !== role) continue;
    if (r.type && r.type !== type) continue;
    if (!emailDomainMatches(r.emailDomain, email)) continue;
    // Prefer rules that pin more attributes (type is the strongest signal).
    const score = (r.type ? 2 : 0) + (r.role ? 1 : 0) + (r.emailDomain ? 1 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

// May this user VIEW the Management Dashboard? Admins always; others per the matrix.
export function canViewManagementDashboard(user, rules) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const rule = matchAccessRule(user, rules);
  return !!(rule && rule.canViewManagementDashboard);
}
