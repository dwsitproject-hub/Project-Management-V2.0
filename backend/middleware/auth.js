import jwt from 'jsonwebtoken';
import store from '../store.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // API Client token: sub = client:<id>
    // Runs on every request and only looks things up (never mutates), so use the
    // shared cached store instead of paying for a private deep copy.
    const data = await store.readShared();
    const sub = String(decoded.sub || '');
    if (sub.startsWith('client:')) {
      const clientInternalId = sub.slice('client:'.length);
      const apiClient = (data.apiClients || []).find((c) => c.id === clientInternalId);
      if (!apiClient || apiClient.active === false) {
        return res.status(401).json({ error: 'API client not found or inactive' });
      }

      req.user = {
        type: 'client',
        id: apiClient.id,
        name: apiClient.name,
        clientId: apiClient.clientId,
        scopes: String(decoded.scopes || '').split(' ').filter(Boolean),
        isAdmin: false,
        role: 'ApiClient',
      };
      return next();
    }

    // User token: sub = userId
    const user = (data.users || []).find(u => u.id === decoded.sub);

    if (!user || !user.active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Check email activation for non-admin users
    if (!user.isAdmin && !user.emailActivated) {
      return res.status(403).json({ error: 'Email not activated. Please check your email for activation link.' });
    }

    req.user = {
      type: 'user',
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: !!user.isAdmin,
      role: user.role,
    };

    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requireScopes(...requiredScopes) {
  return (req, res, next) => {
    // For user tokens, allow (existing UI behavior).
    if (req.user?.type === 'user') return next();

    const scopes = new Set(req.user?.scopes || []);
    const ok = requiredScopes.every((s) => scopes.has(s));
    if (!ok) {
      return res.status(403).json({ error: 'Insufficient scope' });
    }
    next();
  };
}

