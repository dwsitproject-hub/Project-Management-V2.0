import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import store from '../store.js';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';
import { crDocumentUploaded } from '../services/cr-email-queue.js';
import { UPLOADS_DIR as uploadsDir, resolveDocumentPath } from '../services/uploads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

// Files go to UPLOADS_DIR (services/uploads.js): the shared Synology folder on
// staging / production, checked for write access at start-up (server.js).

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Ensure directory exists (should already exist from Dockerfile, but double-check)
      await fs.mkdir(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    } catch (error) {
      console.error('Error ensuring uploads directory exists:', error);
      cb(error, null);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuid()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

// Get all documents for an initiative
router.get('/initiative/:initiativeId', authenticateToken, async (req, res) => {
  const data = await store.read();
  const documents = (data.documents || []).filter(d => d.initiativeId === req.params.initiativeId);
  // Sort by uploadedAt descending (newest first)
  documents.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  res.json(documents);
});

// Upload a document
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { initiativeId } = req.body;
  if (!initiativeId) {
    // Clean up uploaded file if initiativeId is missing
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'initiativeId is required' });
  }

  const data = await store.read();
  const id = uuid();
  const uploadedAt = now();
  
  const document = {
    id,
    initiativeId,
    fileName: req.file.originalname,
    filePath: req.file.path,
    sizeBytes: req.file.size,
    uploadedBy: req.user.id,
    uploadedAt
  };

  if (!data.documents) data.documents = [];
  data.documents.push(document);
  await store.write(data);

  // A CR's creation email waits for its documents: push it to ~15 s after this upload
  // so every file uploaded with the CR is attached (services/cr-email-queue.js).
  try {
    const initiative = data.initiatives.find((i) => i.id === initiativeId);
    if (initiative?.type === 'CR' && (await crDocumentUploaded(initiativeId))) {
      console.log(`[CR EMAIL] Document added to "${initiative.name}"; email will include it`);
    }
  } catch (emailError) {
    console.error('[EMAIL ERROR] Could not reschedule the CR creation email:', emailError.message);
    // Don't fail the document upload if email fails
  }

  res.status(201).json(document);
});

// Download a document
router.get('/:id/download', authenticateToken, async (req, res) => {
  const data = await store.read();
  const document = (data.documents || []).find(d => d.id === req.params.id);
  
  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  try {
    const filePath = await resolveDocumentPath(document.filePath);

    if (!filePath) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    res.download(filePath, document.fileName, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error downloading file' });
        }
      }
    });
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Error serving file' });
  }
});

// Delete a document
router.delete('/:id', authenticateToken, async (req, res) => {
  const data = await store.read();
  const document = (data.documents || []).find(d => d.id === req.params.id);
  
  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Only author or admin can delete
  if (document.uploadedBy !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'You can only delete your own documents' });
  }

  // Delete file from filesystem
  try {
    const filePath = await resolveDocumentPath(document.filePath);
    if (filePath) await fs.unlink(filePath).catch(() => {
      // File might already be deleted, continue anyway
    });
  } catch (error) {
    console.error('Error deleting file:', error);
  }

  // Remove from database
  data.documents = (data.documents || []).filter(d => d.id !== req.params.id);
  await store.write(data);

  res.json({ ok: true });
});

export default router;

