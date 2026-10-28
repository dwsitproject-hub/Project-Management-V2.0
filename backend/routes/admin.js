import express from 'express';
import store from '../store.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(authenticateToken);
router.use(requireAdmin);

// Get all users
router.get('/users', async (req, res) => {
  try {
    const data = await store.read();
    // Don't return password hashes
    const users = data.users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      type: u.type || null,
      departmentId: u.departmentId,
      active: u.active,
      isAdmin: !!u.isAdmin,
      emailActivated: u.emailActivated || false,
      createdAt: u.createdAt
    }));
    return res.json(users);
  } catch (e) {
    console.error('Get users error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Get single user
router.get('/users/:id', async (req, res) => {
  try {
    const data = await store.read();
    const user = data.users.find(u => u.id === req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      type: user.type || null,
      departmentId: user.departmentId,
      active: user.active,
      isAdmin: !!user.isAdmin,
      emailActivated: user.emailActivated || false,
      createdAt: user.createdAt
    });
  } catch (e) {
    console.error('Get user error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Update user
router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, role, type, departmentId, active, isAdmin, emailActivated } = req.body || {};
    const data = await store.read();
    const user = data.users.find(u => u.id === req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (type !== undefined) user.type = type;
    if (departmentId !== undefined) user.departmentId = departmentId;
    if (active !== undefined) user.active = active;
    if (isAdmin !== undefined) user.isAdmin = isAdmin ? 1 : 0;
    if (emailActivated !== undefined) user.emailActivated = emailActivated;

    await store.write(data);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Update user error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Set/reset user password (admin only)
router.put('/users/:id/password', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const data = await store.read();
    const user = data.users.find(u => u.id === req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    user.passwordHash = passwordHash;
    
    // Auto-activate user if they didn't have a password (new account setup)
    if (!user.emailActivated) {
      user.emailActivated = true;
    }

    await store.write(data);
    return res.json({ ok: true, message: 'Password updated successfully' });
  } catch (e) {
    console.error('Set password error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Create user
router.post('/users', async (req, res) => {
  try {
    const { name, email, role, type, departmentId, active, isAdmin, password } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const data = await store.read();
    const existing = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const id = crypto.randomUUID();
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    
    data.users.push({
      id,
      name,
      email,
      role: role || null,
      type: type || null,
      departmentId: departmentId || null,
      active: active !== undefined ? active : true,
      passwordHash,
      isAdmin: isAdmin ? 1 : 0,
      emailActivated: true, // Admin-created users are auto-activated
      activationToken: null,
      activationTokenExpiry: null,
      createdAt: new Date().toISOString()
    });

    await store.write(data);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error('Create user error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const data = await store.read();
    const index = data.users.findIndex(u => u.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting yourself
    if (data.users[index].id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    data.users.splice(index, 1);
    await store.write(data);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Delete user error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Get user roles (for role management)
router.get('/roles', async (req, res) => {
  try {
    // Predefined list of available roles
    const predefinedRoles = [
      'Admin',
      'SeniorManagement',
      'PMO',
      'IT Manager',
      'IT PM',
      'ITPIC',
      'BusinessOwner',
      'User'
    ];
    
    const data = await store.read();
    // Get unique roles from users (to include any custom roles that might exist)
    const existingRoles = [...new Set(data.users.map(u => u.role).filter(Boolean))];
    
    // Combine predefined roles with existing custom roles, removing duplicates
    const allRoles = [...new Set([...predefinedRoles, ...existingRoles])];
    
    // Sort roles with predefined ones first, then custom ones
    const sortedRoles = [
      ...predefinedRoles.filter(r => allRoles.includes(r)),
      ...allRoles.filter(r => !predefinedRoles.includes(r))
    ];
    
    return res.json(sortedRoles);
  } catch (e) {
    console.error('Get roles error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Update user roles in bulk
router.post('/users/bulk-update-roles', async (req, res) => {
  try {
    const { updates } = req.body || {}; // Array of { userId, role }
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Updates must be an array' });
    }

    const data = await store.read();
    updates.forEach(({ userId, role }) => {
      const user = data.users.find(u => u.id === userId);
      if (user && role !== undefined) {
        user.role = role;
      }
    });

    await store.write(data);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Bulk update roles error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// --- Access Rules Management (for User Access Management Roles) ---

// Get all access rules
router.get('/access-rules', async (req, res) => {
  try {
    const data = await store.read();
    const rules = data.accessRules || [];
    return res.json(rules);
  } catch (e) {
    console.error('Get access rules error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Replace all access rules (admin can edit matrix)
router.post('/access-rules', async (req, res) => {
  try {
    const { rules } = req.body || {};
    if (!Array.isArray(rules)) {
      return res.status(400).json({ error: 'Rules must be an array' });
    }

    const data = await store.read();
    data.accessRules = rules.map(r => ({
      id: r.id || crypto.randomUUID(),
      role: r.role || null,
      type: r.type || null,
      emailDomain: r.emailDomain || null,
      canViewProjectDashboard: !!r.canViewProjectDashboard,
      canViewProjectList: !!r.canViewProjectList,
      canCreateProject: !!r.canCreateProject,
      canEditAnyProject: !!r.canEditAnyProject,
      restrictProjectVisibilityToOwnTeamOnly: !!r.restrictProjectVisibilityToOwnTeamOnly,
      restrictProjectEditToOwnTeamOnly: !!r.restrictProjectEditToOwnTeamOnly,
      canViewCRDashboard: !!r.canViewCRDashboard,
      canViewCRList: !!r.canViewCRList,
      canCreateCR: !!r.canCreateCR,
      canEditCR: !!r.canEditCR,
      canViewMasterDwsApplication: !!r.canViewMasterDwsApplication,
      canViewManagementDashboard: !!r.canViewManagementDashboard,
    }));

    await store.write(data);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Save access rules error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// --- API Clients (for external integrations) ---

router.get('/api-clients', async (_req, res) => {
  try {
    const data = await store.read();
    const clients = (data.apiClients || []).map((c) => ({
      id: c.id,
      name: c.name,
      clientId: c.clientId,
      scopes: c.scopes || null,
      active: c.active !== false,
      createdAt: c.createdAt,
    }));
    return res.json(clients);
  } catch (e) {
    console.error('Get api clients error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/api-clients', async (req, res) => {
  try {
    const { name, clientId, clientSecret, scopes, active } = req.body || {};
    if (!name || !clientId || !clientSecret) {
      return res.status(400).json({ error: 'name, clientId and clientSecret are required' });
    }

    const data = await store.read();
    const exists = (data.apiClients || []).some(
      (c) => String(c.clientId || '').toLowerCase() === String(clientId).toLowerCase()
    );
    if (exists) {
      return res.status(409).json({ error: 'clientId already exists' });
    }

    if (!data.apiClients) data.apiClients = [];
    const id = crypto.randomUUID();
    const clientSecretHash = await bcrypt.hash(String(clientSecret), 10);
    data.apiClients.push({
      id,
      name,
      clientId,
      clientSecretHash,
      scopes: String(scopes || 'cr:read cr:write').trim(),
      active: active !== undefined ? !!active : true,
      createdAt: new Date().toISOString(),
    });

    await store.write(data);
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error('Create api client error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Change an existing client: scopes (e.g. add project:read project:write), active
// (false = its tokens stop working on the next request), name, or rotate the secret.
const API_CLIENT_SCOPES = ['cr:read', 'cr:write', 'project:read', 'project:write'];

router.patch('/api-clients/:id', async (req, res) => {
  try {
    const { name, scopes, active, clientSecret } = req.body || {};
    const data = await store.read();
    const client = (data.apiClients || []).find((c) => c.id === req.params.id);
    if (!client) return res.status(404).json({ error: 'Not found' });

    if (scopes !== undefined) {
      const list = String(scopes).split(/\s+/).filter(Boolean);
      const unknown = list.filter((s) => !API_CLIENT_SCOPES.includes(s));
      if (!list.length || unknown.length) {
        return res.status(400).json({ error: `scopes must be space-separated values from: ${API_CLIENT_SCOPES.join(' ')}` });
      }
      client.scopes = [...new Set(list)].join(' ');
    }
    if (name !== undefined) client.name = String(name);
    if (active !== undefined) client.active = !!active;
    if (clientSecret !== undefined) {
      if (!clientSecret) return res.status(400).json({ error: 'clientSecret cannot be empty' });
      client.clientSecretHash = await bcrypt.hash(String(clientSecret), 10);
    }

    await store.write(data);
    return res.json({ ok: true, id: client.id, scopes: client.scopes, active: client.active !== false });
  } catch (e) {
    console.error('Update api client error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;

