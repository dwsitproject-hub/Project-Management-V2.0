import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dbStore from './store.js';
import { startCrEmailSweeper, stopCrEmailSweeper } from './services/cr-email-queue.js';
import { checkUploadsDir } from './services/uploads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Behind WAF / ALB / API Gateway: trust X-Forwarded-For / -Proto from that many proxy
// hops (TRUST_PROXY=2), or from the listed networks (e.g. TRUST_PROXY=192.168.0.0/16).
// Unset = trust none (today's behaviour). Lets req.ip, req.secure and req.protocol show
// the browser's real values instead of the last proxy's.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY.trim();
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v.split(',').map((x) => x.trim()));
}
warnAboutUnsafeConfig();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

// (No /docs route any more: nothing uses it, and it published every file in docs/ —
// deployment notes, portfolio CSVs — to anyone, without a login.)

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
import projectImportRouter from './routes/project-import.js';
import userDashboardRouter from './routes/user-dashboard.js';
import commentsRouter from './routes/comments.js';
import tasksRouter from './routes/tasks.js';
import documentsRouter from './routes/documents.js';
import profileRouter from './routes/profile.js';
import notificationsRouter from './routes/notifications.js';
import meetingNotesRouter from './routes/meeting-notes.js';
import { authenticateToken, requireAdmin } from './middleware/auth.js';
import { requestTimeout } from './middleware/timeout.js';
import { crsRouter as apiV1CrsRouter, initiativesRouter as apiV1InitiativesRouter } from './routes/api-v1-initiatives.js';
import dwsApplicationsRouter from './routes/dws-applications.js';
import departmentsRouter from './routes/departments.js';
import erpModulesRouter from './routes/erp-modules.js';
import erpIntegrationRouter from './routes/erp-integration.js';
import managementDashboardRouter from './routes/management-dashboard.js';
import ssoRouter from './routes/sso.js';
import hubSdkRouter from './routes/hub-sdk.js';

// Public routes
// Downstream Hub SDK settings for the SPA (public: the SDK key is publishable)
app.use('/api/hub-sdk', hubSdkRouter);
// SSO consumer (DWS Hub) — mounted before authRouter; additive to local login.
app.use('/api/auth/sso', ssoRouter);
app.use('/api/auth', authRouter);
// Users (names, e-mails, roles) and system URLs: signed-in users only (was public).
app.use('/api/lookups', authenticateToken, lookupsRouter);

// Protected routes (require authentication)
app.use('/api/initiatives', authenticateToken, initiativesRouter);
app.use('/api/dashboard', authenticateToken, dashboardRouter);
app.use('/api/cr-dashboard', authenticateToken, crDashboardRouter);
app.use('/api/daily-snapshots', authenticateToken, dailySnapshotsRouter);
app.use('/api/user-dashboard', userDashboardRouter);
// Admin: bulk project upload from the Excel planning template
app.use('/api/admin/project-import', authenticateToken, requireAdmin, projectImportRouter);
app.use('/api/admin', adminRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/profile', authenticateToken, profileRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/meeting-notes', meetingNotesRouter);
// ERP CR sync (scope cr:sync). Longer timeout: batches and 30 MB documents.
app.use('/api/v1/integrations/erp', authenticateToken, requestTimeout(30000), erpIntegrationRouter);
app.use('/api/v1/crs', authenticateToken, requestTimeout(5000), apiV1CrsRouter);
app.use('/api/v1/initiatives', authenticateToken, requestTimeout(5000), apiV1InitiativesRouter);
app.use('/api/dws-applications', authenticateToken, dwsApplicationsRouter);
// Department Master (admin only); everyone else reads departments via /api/lookups
app.use('/api/departments', authenticateToken, requireAdmin, departmentsRouter);
app.use('/api/erp-modules', authenticateToken, erpModulesRouter);
app.use('/api/management-dashboard', authenticateToken, managementDashboardRouter);

// Health — for the ALB / API Gateway health checks. Also under /api/ so a check sent
// through the gateway's /api/* route reaches it.
//   /health/live   the process is up (never touches the DB)
//   /health/ready  ready for traffic: DB answers within 2 s, and not shutting down
//   /health        kept for existing checks (same as live)
let shuttingDown = false;
const live = (_req, res) => res.json({ ok: true });
const ready = async (_req, res) => {
  if (shuttingDown) return res.status(503).json({ ok: false, reason: 'shutting down' });
  const db = await dbStore.ping(2000);
  res.status(db.ok ? 200 : 503).json({ ok: db.ok, db: db.ok ? 'ok' : db.error });
};
app.get(['/health', '/health/live', '/api/health', '/api/health/live'], live);
app.get(['/health/ready', '/api/health/ready'], ready);

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
const server = app.listen(PORT, HOST, () => {
  console.log(`Backend API server listening on:`);
  console.log(`  - Local:   http://localhost:${PORT}`);
  console.log(`  - Network: http://172.30.18.102:${PORT}`);

  // Read-only DB health signal for deployments (replaces the old boot-time full rewrite).
  dbStore.read()
    .then((d) => {
      console.log(`[STORE] Connected - Users: ${(d.users || []).length}, Initiatives: ${(d.initiatives || []).length}`);
      // Needs the schema (crEmailQueue), which the first read creates.
      startCrEmailSweeper();
    })
    .catch((e) => {
      console.error('[STORE] Initial read failed:', e.message);
      startCrEmailSweeper(); // its sweeps retry until the DB is reachable
    });
  checkUploadsDir();
});

// Graceful shutdown (docker stop / a rolling deploy sends SIGTERM): fail /health/ready
// so the load balancer stops sending traffic, stop taking new connections, let
// in-flight requests and queued saves finish, then close the DB pool. Gives up after
// SHUTDOWN_TIMEOUT_MS (default 25 s; set the container's stop_grace_period above it).
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 25000);
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SHUTDOWN] ${signal} received, draining (max ${SHUTDOWN_TIMEOUT_MS} ms)...`);
  const force = setTimeout(() => {
    console.error('[SHUTDOWN] Timed out, exiting with requests still open');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();
  stopCrEmailSweeper();
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeIdleConnections?.(); // keep-alive sockets with no request in flight
  });
  await dbStore.drain().catch(() => {});
  await dbStore.pool.end().catch(() => {});
  console.log('[SHUTDOWN] Clean exit');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/** Loud start-up warnings for settings that are unsafe in production. */
function warnAboutUnsafeConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = process.env.JWT_SECRET || '';
  if (!secret || /^dev-secret-change-me/.test(secret) || secret.length < 32) {
    console.error('[CONFIG] !!! JWT_SECRET is missing, a default, or shorter than 32 characters. ' +
      'Every node must share one long random secret.');
  }
  if (!process.env.DATABASE_URL) console.error('[CONFIG] !!! DATABASE_URL is not set.');
}

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
