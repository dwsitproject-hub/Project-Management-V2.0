import express from 'express';
import store from '../store.js';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

// Test route to verify router is working
// Get all comments for an initiative
router.get('/initiative/:initiativeId', authenticateToken, async (req, res) => {
  const data = await store.read();
  const comments = (data.comments || []).filter(c => c.initiativeId === req.params.initiativeId);
  // Sort by createdAt descending (newest first)
  comments.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(comments);
});

// Helper function to parse @mentions from comment text
function parseMentions(text) {
  if (!text) return [];
  
  // Find all @ symbols and extract the mention text
  // A mention can include spaces (e.g., "@Jerry Pratama")
  // Stop when we hit: another @, punctuation, or a space followed by a word (next word in sentence)
  const mentions = [];
  const seen = new Set();
  
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@') {
      let mentionStart = i + 1;
      let mentionEnd = mentionStart;
      let lastSpacePos = -1;
      
      // Collect characters until we hit a stopping point
      while (mentionEnd < text.length) {
        const char = text[mentionEnd];
        
        // Stop at another @
        if (char === '@') break;
        
        // Stop at punctuation (but allow dots and hyphens within the mention)
        if ([',', '!', '?', ':', ';', ')', ']', '(', '['].includes(char)) break;
        
        // Stop at period if it's followed by space or end (likely sentence end)
        if (char === '.' && (mentionEnd + 1 >= text.length || text[mentionEnd + 1] === ' ')) break;
        
        // Track spaces - if we see a space, check if this is the end of the mention
        if (char === ' ') {
          lastSpacePos = mentionEnd;
          // Look ahead to see what comes after the space(s)
          let lookAhead = mentionEnd + 1;
          while (lookAhead < text.length && text[lookAhead] === ' ') lookAhead++; // Skip multiple spaces
          
          // If we see multiple spaces, this is likely the end of the mention
          if (lookAhead > mentionEnd + 1) {
            break; // Stop before the first space
          }
          
          if (lookAhead < text.length) {
            const nextChar = text[lookAhead];
            // If next char is @ or punctuation, stop here (before the space)
            if (nextChar === '@' || [',', '!', '?', ':', ';', ')', ']', '(', '[', '.'].includes(nextChar)) {
              break;
            }
            
            // If we've already collected a name with a space (like "Jerry Pratama"),
            // and the next word starts with lowercase, it's likely the next word in the sentence
            const currentMention = text.substring(mentionStart, mentionEnd).trim();
            if (currentMention.includes(' ')) {
              // We have a multi-word name, check if next word is clearly separate
              // Extract the next word
              let nextWordEnd = lookAhead;
              while (nextWordEnd < text.length && /[\w-]/.test(text[nextWordEnd])) {
                nextWordEnd++;
              }
              const nextWord = text.substring(lookAhead, nextWordEnd).toLowerCase();
              // Common words that indicate the next part of the sentence
              const commonWords = ['test', 'tes', 'the', 'is', 'a', 'an', 'and', 'or', 'but', 'to', 'for', 'of', 'in', 'on', 'at'];
              if (commonWords.includes(nextWord) || nextWord.length <= 2) {
                // This looks like the next word in the sentence, not part of the mention
                break; // Stop before the space
              }
            }
          }
          mentionEnd++;
        } else if (/[\w.-]/.test(char)) {
          // Allow word characters, hyphens, and dots
          mentionEnd++;
        } else {
          // Any other character stops the mention
          break;
        }
      }
      
      // Extract the mention text and clean it up
      let mentionText = text.substring(mentionStart, mentionEnd).trim();
      
      // Remove trailing spaces and ensure we don't have multiple spaces
      mentionText = mentionText.replace(/\s+/g, ' ').trim();
      
      // Only add if it's not empty and we haven't seen it
      if (mentionText && !seen.has(mentionText.toLowerCase())) {
        mentions.push(mentionText);
        seen.add(mentionText.toLowerCase());
      }
      
      i = mentionEnd;
    } else {
      i++;
    }
  }
  
  return mentions;
}

// Helper function to find user by name or email
function findUserByMention(data, mention) {
  if (!mention || !data.users) return null;
  
  const lowerMention = mention.toLowerCase().trim();
  
  // First try exact matches
  let user = data.users.find(u => {
    if (u.active === false) return false;
    const name = (u.name || '').toLowerCase().trim();
    const nameNoSpaces = name.replace(/\s+/g, '');
    const email = (u.email || '').toLowerCase();
    const emailPrefix = email.split('@')[0];
    
    // Exact matches (highest priority)
    return name === lowerMention || 
           nameNoSpaces === lowerMention ||
           emailPrefix === lowerMention ||
           email === lowerMention;
  });
  
  // If no exact match, try partial matches
  if (!user) {
    user = data.users.find(u => {
      if (u.active === false) return false;
      const name = (u.name || '').toLowerCase().trim();
      const nameNoSpaces = name.replace(/\s+/g, '');
      const emailPrefix = (u.email || '').toLowerCase().split('@')[0];
      
      // Partial matches - mention must be at least 3 characters
      if (lowerMention.length < 3) return false;
      
      return (name && name.includes(lowerMention)) ||
             (nameNoSpaces && nameNoSpaces.includes(lowerMention)) ||
             (emailPrefix && emailPrefix.includes(lowerMention));
    });
  }
  
  return user || null;
}

// Create a new comment
router.post('/', authenticateToken, async (req, res) => {
  const { initiativeId, body } = req.body;
  if (!initiativeId || !body || !body.trim()) {
    return res.status(400).json({ error: 'initiativeId and body are required' });
  }
  
  const data = await store.read();
  const id = uuid();
  const createdAt = now();
  const comment = {
    id,
    initiativeId,
    authorId: req.user.id,
    body: body.trim(),
    createdAt,
    updatedAt: null
  };
  
  if (!data.comments) data.comments = [];
  data.comments.push(comment);
  
  // Parse mentions and create notifications
  const mentions = parseMentions(body);
  console.log('Comment created - body:', body);
  console.log('Parsed mentions:', mentions);
  
  const initiative = data.initiatives.find(i => i.id === initiativeId);
  const author = data.users.find(u => u.id === req.user.id);
  const authorName = author ? (author.name || author.email || 'Someone') : 'Someone';
  const initiativeName = initiative ? (initiative.name || 'an initiative') : 'an initiative';
  
  if (!data.notifications) data.notifications = [];
  
  for (const mention of mentions) {
    const mentionedUser = findUserByMention(data, mention);
    console.log(`Looking for mention: "${mention}" - Found user:`, mentionedUser ? { id: mentionedUser.id, name: mentionedUser.name, email: mentionedUser.email } : 'NOT FOUND');
    
    if (mentionedUser && mentionedUser.id !== req.user.id) {
      // Don't notify if user mentioned themselves
      const notificationId = uuid();
      const notification = {
        id: notificationId,
        userId: mentionedUser.id,
        type: 'mention',
        title: `${authorName} mentioned you`,
        message: `${authorName} mentioned you in a comment on "${initiativeName}"`,
        initiativeId: initiativeId,
        commentId: id,
        read: false,
        createdAt: createdAt
      };
      data.notifications.push(notification);
      console.log('Notification created for user:', mentionedUser.id, mentionedUser.name);
      console.log('Notification data:', JSON.stringify(notification, null, 2));
      console.log('Total notifications before write:', data.notifications.length);
    } else if (mentionedUser && mentionedUser.id === req.user.id) {
      console.log('Skipping notification - user mentioned themselves');
    } else {
      console.log('No user found for mention:', mention);
    }
  }
  
  console.log('Writing data with', data.notifications?.length || 0, 'notifications');
  await store.write(data);
  console.log('Data written successfully');
  
  res.status(201).json(comment);
});

// Update a comment
router.put('/:id', authenticateToken, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'body is required' });
  }
  
  const data = await store.read();
  const comment = (data.comments || []).find(c => c.id === req.params.id);
  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }
  
  // Only author can update their comment
  if (comment.authorId !== req.user.id) {
    return res.status(403).json({ error: 'You can only update your own comments' });
  }
  
  comment.body = body.trim();
  comment.updatedAt = now();
  await store.write(data);
  
  res.json(comment);
});

// Delete a comment
router.delete('/:id', authenticateToken, async (req, res) => {
  const data = await store.read();
  const comment = (data.comments || []).find(c => c.id === req.params.id);
  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }
  
  // Only author or admin can delete
  if (comment.authorId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }
  
  data.comments = (data.comments || []).filter(c => c.id !== req.params.id);
  await store.write(data);
  
  res.json({ ok: true });
});

export default router;

