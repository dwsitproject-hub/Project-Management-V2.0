import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dbStore from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

// Serve docs folder for static assets (logo, etc)
app.use('/docs', express.static(path.join(__dirname, '..', 'docs')));

// Serve frontend static files (for local development)
// In production, frontend is served by the separate frontend container (nginx)
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// API routes
import initiativesRouter from './routes/initiatives.js';
import dashboardRouter from './routes/dashboard.js';
import crDashboardRouter from './routes/cr-dashboard.js';
import dailySnapshotsRouter from './routes/daily-snapshots.js';
import lookupsRouter from './routes/lookups.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import userDashboardRouter from './routes/user-dashboard.js';
import commentsRouter from './routes/comments.js';
import tasksRouter from './routes/tasks.js';
import documentsRouter from './routes/documents.js';
import profileRouter from './routes/profile.js';
import notificationsRouter from './routes/notifications.js';
import meetingNotesRouter from './routes/meeting-notes.js';
import { authenticateToken } from './middleware/auth.js';
import { requestTimeout } from './middleware/timeout.js';
import apiV1CrsRouter from './routes/api-v1-crs.js';
import dwsApplicationsRouter from './routes/dws-applications.js';
import managementDashboardRouter from './routes/management-dashboard.js';
import ssoRouter from './routes/sso.js';

// Public routes
// SSO consumer (DWS Hub) — mounted before authRouter; additive to local login.
app.use('/api/auth/sso', ssoRouter);
app.use('/api/auth', authRouter);
app.use('/api/lookups', lookupsRouter);

// Protected routes (require authentication)
app.use('/api/initiatives', authenticateToken, initiativesRouter);
app.use('/api/dashboard', authenticateToken, dashboardRouter);
app.use('/api/cr-dashboard', authenticateToken, crDashboardRouter);
app.use('/api/daily-snapshots', authenticateToken, dailySnapshotsRouter);
app.use('/api/user-dashboard', userDashboardRouter);
app.use('/api/admin', adminRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/profile', authenticateToken, profileRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/meeting-notes', meetingNotesRouter);
app.use('/api/v1/crs', authenticateToken, requestTimeout(5000), apiV1CrsRouter);
app.use('/api/dws-applications', authenticateToken, dwsApplicationsRouter);
app.use('/api/management-dashboard', authenticateToken, managementDashboardRouter);

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  console.error('Error message:', err.message);
  console.error('Error stack:', err.stack);
  if (!res.headersSent) {
    const errorDetails = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production'
      ? { message: err.message, stack: err.stack }
      : undefined;
    res.status(500).json({
      error: 'Internal server error',
      ...(errorDetails && { details: errorDetails })
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Note: Frontend SPA routing is now handled by the frontend container (nginx)
// This backend only serves API endpoints and /docs static assets

const PORT = process.env.PORT || 3000;
const FRONTEND_PORT = process.env.FRONTEND_PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces

// Start backend API server
app.listen(PORT, HOST, () => {
  console.log(`Backend API server listening on:`);
  console.log(`  - Local:   http://localhost:${PORT}`);
  console.log(`  - Network: http://172.30.18.102:${PORT}`);

  // Initialize daily snapshots on server start
  import('./daily-snapshots.js').then(async m => {
    await m.initializeDailySnapshots();
  });
});

// Start frontend server on port 8080 (for local development)
// This creates a separate Express server that serves the frontend and proxies API calls
if (process.env.NODE_ENV !== 'production' || process.env.SERVE_FRONTEND === 'true') {
  const frontendApp = express();
  frontendApp.use(express.json());
  frontendApp.use(cors());
  
  // Proxy API requests to backend
  frontendApp.use('/api', (req, res) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: req.originalUrl,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${PORT}` },
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err);
      res.status(500).json({ error: 'Backend server not available' });
    });
    
    if (req.body && Object.keys(req.body).length > 0) {
      proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
  });
  
  // Serve frontend static files
  frontendApp.use(express.static(frontendPath));
  frontendApp.use('/docs', express.static(path.join(__dirname, '..', 'docs')));
  
  // SPA routing - serve index.html for all non-API routes
  frontendApp.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/docs')) {
      res.sendFile(path.join(frontendPath, 'index.html'));
    }
  });
  
  frontendApp.listen(FRONTEND_PORT, HOST, () => {
    console.log(`Frontend server listening on:`);
    console.log(`  - Local:   http://localhost:${FRONTEND_PORT}`);
    console.log(`  - Network: http://172.30.18.102:${FRONTEND_PORT}`);
  });
}

// Daily snapshot creation - runs every 24 hours to track milestone durations
setInterval(async () => {
  try {
    const snapshotMod = await import('./daily-snapshots.js');
    snapshotMod.createDailySnapshot();
  } catch (e) {
    console.error('Daily snapshot error:', e.message);
  }
}, 24 * 60 * 60 * 1000); // 24 hours

// 5-minute Google Sheets auto-sync (Project and CR tabs) if env configured
const SHEET_ID = process.env.SHEET_ID;
const GID = process.env.GID;
const CR_GID = process.env.CR_GID;
if (SHEET_ID && GID) {
  const runSync = async () => {
    try {
      // Sync Project tab
      const projectMod = await import('./sync_google_sheets.js');
      await projectMod.default();

      // Sync CR tab if configured
      if (CR_GID) {
        const crMod = await import('./sync_google_sheets_cr.js');
        await crMod.default();
      }

      // Create daily snapshot after sync to capture changes
      const snapshotMod = await import('./daily-snapshots.js');
      snapshotMod.createDailySnapshot();
    } catch (e) {
      console.error('Auto-sync error:', e.message);
    }
  };
  setInterval(runSync, 5 * 60 * 1000);
  // initial sync on boot (non-blocking)
  runSync();
}


