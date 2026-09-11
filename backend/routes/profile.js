import express from 'express';
import bcrypt from 'bcryptjs';
import store from '../store.js';
import { authenticateToken } from '../middleware/auth.js';
import { matchAccessRule } from '../accessRules.js';

const router = express.Router();

// Get current user profile
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const data = await store.read();
    const user = data.users.find(u => u.id === userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return user data without password hash
    const { passwordHash, activationToken, activationTokenExpiry, ...userData } = user;
    // Convert teamMemberIds string to array
    if (userData.teamMemberIds && typeof userData.teamMemberIds === 'string') {
      userData.teamMemberIds = userData.teamMemberIds.split(',').filter(Boolean);
    } else if (!userData.teamMemberIds) {
      userData.teamMemberIds = [];
    }
    // Attach the access rule that applies to this user so the SPA can enforce
    // the admin-configured Access Matrix (e.g. Management Dashboard visibility).
    userData.matchedAccessRule = matchAccessRule(user, data.accessRules || []);
    res.json(userData);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, departmentId } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    
    const data = await store.read();
    const userIndex = data.users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if email is already taken by another user
    const existingUser = data.users.find(u => u.id !== userId && u.email?.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use by another user' });
    }
    
    // Update user data
    data.users[userIndex] = {
      ...data.users[userIndex],
      name,
      email,
      ...(departmentId !== undefined && { departmentId })
    };
    
    await store.write(data);
    
    // Return updated user data without password hash
    const { passwordHash, activationToken, activationTokenExpiry, ...updatedUser } = data.users[userIndex];
    res.json(updatedUser);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add team member (for managers only)
router.post('/team-members', async (req, res) => {
  try {
    const userId = req.user.id;
    const { teamMemberId } = req.body;
    
    if (!teamMemberId) {
      return res.status(400).json({ error: 'Team member ID is required' });
    }
    
    const data = await store.read();
    const manager = data.users.find(u => u.id === userId);
    
    if (!manager) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is a manager
    if (manager.type !== 'Manager') {
      return res.status(403).json({ error: 'Only managers can manage team members' });
    }
    
    // Check if team member exists
    const teamMember = data.users.find(u => u.id === teamMemberId);
    if (!teamMember) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    
    // Prevent adding yourself
    if (teamMemberId === userId) {
      return res.status(400).json({ error: 'Cannot add yourself as a team member' });
    }
    
    // Get current team members
    const currentTeamMembers = manager.teamMemberIds 
      ? (typeof manager.teamMemberIds === 'string' ? manager.teamMemberIds.split(',').filter(Boolean) : manager.teamMemberIds)
      : [];
    
    // Check if already in team
    if (currentTeamMembers.includes(teamMemberId)) {
      return res.status(409).json({ error: 'User is already in your team' });
    }
    
    // Add team member
    currentTeamMembers.push(teamMemberId);
    manager.teamMemberIds = currentTeamMembers.join(',');
    
    await store.write(data);
    
    res.json({ 
      ok: true, 
      message: 'Team member added successfully',
      teamMemberIds: currentTeamMembers
    });
  } catch (error) {
    console.error('Add team member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove team member (for managers only)
router.delete('/team-members/:teamMemberId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { teamMemberId } = req.params;
    
    const data = await store.read();
    const manager = data.users.find(u => u.id === userId);
    
    if (!manager) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is a manager
    if (manager.type !== 'Manager') {
      return res.status(403).json({ error: 'Only managers can manage team members' });
    }
    
    // Get current team members
    const currentTeamMembers = manager.teamMemberIds 
      ? (typeof manager.teamMemberIds === 'string' ? manager.teamMemberIds.split(',').filter(Boolean) : manager.teamMemberIds)
      : [];
    
    // Remove team member
    const updatedTeamMembers = currentTeamMembers.filter(id => id !== teamMemberId);
    manager.teamMemberIds = updatedTeamMembers.length > 0 ? updatedTeamMembers.join(',') : null;
    
    await store.write(data);
    
    res.json({ 
      ok: true, 
      message: 'Team member removed successfully',
      teamMemberIds: updatedTeamMembers
    });
  } catch (error) {
    console.error('Remove team member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.put('/password', async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Current password, new password, and confirm password are required' });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New password and confirm password do not match' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    const data = await store.read();
    const userIndex = data.users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = data.users[userIndex];
    
    // Verify current password
    if (!user.passwordHash) {
      return res.status(400).json({ error: 'Current password is not set' });
    }
    
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    data.users[userIndex] = {
      ...data.users[userIndex],
      passwordHash: newPasswordHash
    };
    
    await store.write(data);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

