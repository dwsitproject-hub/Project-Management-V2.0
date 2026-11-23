# Project & Change Request Management System

A web-based project and change request management application with authentication, and user management.

## 🚀 Features

- **Project & Change Request Management**: Track projects and change requests with status, priority, milestones, and more
- **User Authentication**: Secure login, registration, password reset, and email activation
- **Role-Based Access Control**: Admin and user roles with appropriate permissions
- **Dashboard & Analytics**: Comprehensive dashboards with project insights and metrics
- **Daily Snapshots**: Automatic tracking of milestone durations and project aging
- **Comments & Tasks**: Collaboration features for projects and change requests
- **Meeting Notes**: Capture structured meeting notes with participants, action items, email delivery log, and history tracking
- **Notifications**: Real-time notifications for important events
- **Document Management**: Upload and manage project-related documents

## 📋 Architecture

The system consists of:
- **Frontend**: Nginx serving static files (React/vanilla JS)
- **Backend**: Node.js/Express API server
- **Database**: PostgreSQL for data persistence
- **Containerization**: Docker and Docker Compose for easy deployment

## 🌐 Production Environment

**Production URLs:**
- **Frontend**: http://pm.energi-up.com:1817 (or http://147.139.176.70:1817)
- **Backend API**: http://8.215.56.98:1819

**Server Configuration:**
- Frontend Server: `172.28.80.50` (Private) / `147.139.176.70:1817` (Public) / `pm.energi-up.com`
- Backend Server: `172.28.80.51` (Private) / `8.215.56.98:1819` (Public)

For detailed production deployment instructions, see [DEPLOYMENT-ALIYUN.md](DEPLOYMENT-ALIYUN.md).

## 🛠️ Quick Start

### Option 1: Docker Compose (Recommended)

#### Local Development

```bash
# Start all services (defaults to local environment)
docker-compose up -d

# Or use helper script
.\docker-compose.local.bat    # Windows
.\docker-compose.local.ps1    # PowerShell
```

Access the application:
- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:3000
- **Database**: localhost:5434

#### Environment-Specific Configuration

This project supports separate configurations for **Local**, **Testing**, and **Production** environments.

See [ENVIRONMENT-SETUP.md](ENVIRONMENT-SETUP.md) for detailed instructions.

**Quick commands:**
- Local: `docker-compose up -d` (or use `docker-compose.local.bat`)
- Testing: `docker-compose -f docker-compose.yml -f docker-compose.testing.yml up -d`
- Production: `docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d`

### Option 2: Legacy Setup (Without Docker)

1. Install Node.js (v18+)
2. Install dependencies: `npm install`
3. Initialize datastore: `npm run migrate` (creates/updates database schema)
4. Start the server:
   - **Windows (Batch)**: Double-click `start-server.bat`
   - **Windows (PowerShell)**: Run `.\start-server.ps1`
   - **Or manually**: `npm run dev`

Access: http://localhost:3000

## 📚 API Documentation

### Public Endpoints (No Authentication)

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token
- `POST /api/auth/activate` - Activate account with token
- `GET /health` - Health check endpoint

### Protected Endpoints (Require Authentication)

- `GET /api/initiatives` - Get all projects/change requests
- `GET /api/initiatives/:id` - Get specific initiative
- `POST /api/initiatives` - Create new initiative
- `PUT /api/initiatives/:id` - Update initiative
- `DELETE /api/initiatives/:id` - Delete initiative
- `GET /api/dashboard` - Get dashboard analytics
- `GET /api/cr-dashboard` - Get CR dashboard analytics
- `GET /api/user-dashboard` - Get user-specific dashboard
- `GET /api/lookups` - Get lookup data (users, departments)
- `GET /api/profile` - Get user profile
- `PUT /api/profile` - Update user profile
- `GET /api/admin/users` - Get all users (Admin only)
- `POST /api/comments` - Add comment
- `GET /api/tasks` - Get tasks
- `POST /api/tasks` - Create task
- `GET /api/documents` - Get documents
- `POST /api/documents` - Upload document
- `GET /api/notifications` - Get notifications
- `GET /api/meeting-notes` - List meeting notes by initiative/type/status
- `POST /api/meeting-notes` - Create a meeting note with participants and action items
- `GET /api/meeting-notes/:id` - Get a meeting note detail
- `PUT /api/meeting-notes/:id` - Update a meeting note (increments version/history)
- `DELETE /api/meeting-notes/:id` - Soft-delete a meeting note
- `POST /api/meeting-notes/:id/send` - Send meeting note email and record delivery log

See [docs/requirements.md](docs/requirements.md) for full API documentation.

## 🔐 Authentication & User Management

### User Registration

Users can register with:
- Name
- Email
- Password (minimum 6 characters)

### Email Activation

- For allowed email domains: Activation link sent via email
- For other domains: Requires admin approval

### Password Reset

1. User requests password reset via "Forgot Password"
2. Reset link sent to email (valid for 1 hour)
3. User clicks link and sets new password

### Admin Functions

Admins can:
- Activate/deactivate users
- Change user roles
- Manage all projects and change requests
- Access admin dashboard

## 📝 Meeting Notes

The Meeting Notes module provides a structured way to record and distribute project meeting outcomes.

### Main capabilities

- Store meeting metadata (title, type, date/time, facilitator, note taker, location/link)
- Track participants and action items (owner, due date, priority, status)
- Keep revision history/versioning for changes
- Soft-delete notes for safer data recovery
- Send meeting note summaries via email and keep an email delivery log

### Related docs

- [docs/MEETING-NOTES-UI-FUNCTIONAL-TECH-SPEC.md](docs/MEETING-NOTES-UI-FUNCTIONAL-TECH-SPEC.md)

## 🗄️ Database Migrations

The system uses SQL migrations for database schema management.

### Available Migrations

- `migrations/001_initial_schema.sql` - Initial database schema
- `migrations/002_add_notifications_table.sql` - Notifications table
- `migrations/003_update_users_and_initiatives.sql` - User and initiative updates
- `migrations/004_add_meeting_notes_tables.sql` - Meeting notes core tables
- `migrations/005_meeting_notes_soft_delete_two_statuses.sql` - Meeting notes soft-delete and status normalization

### Running Migrations

**With Docker:**
```bash
# Copy migration files to container
docker cp migrations/001_initial_schema.sql project_management_db:/001_initial_schema.sql

# Run migration
docker exec -it project_management_db \
  psql -U postgres -d project_management_v2 -f /001_initial_schema.sql
```

**Manual:**
```bash
psql -U postgres -d project_management_v2 -f migrations/001_initial_schema.sql
```

All migrations are **idempotent** (safe to run multiple times).

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres123
POSTGRES_DB=project_management_v2

# Backend
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Authentication
JWT_SECRET=your-secret-key-here
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=SecurePassword123!
ADMIN_NAME=Administrator

# Frontend URL
FRONTEND_URL=http://147.139.176.70:1817

# Email/SMTP
EMAIL_FROM=noreply@yourcompany.com
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_REJECT_UNAUTHORIZED=true
```

## 📁 Project Structure

```
.
├── backend/              # Backend API server
│   ├── routes/          # API route handlers
│   ├── middleware/      # Express middleware (auth, etc.)
│   ├── services/        # Business logic services
│   └── server.js        # Main server file
├── frontend/            # Frontend static files
│   ├── index.html       # Main HTML file
│   ├── main.js          # Frontend JavaScript
│   ├── styles.css       # Styles
│   └── nginx.conf       # Nginx configuration
├── migrations/          # Database migration SQL files
├── docker-compose.yml   # Main Docker Compose file
└── DEPLOYMENT-ALIYUN.md # Production deployment guide
```

## 🚢 Deployment

### Production Deployment (AliCloud)

See [DEPLOYMENT-ALIYUN.md](DEPLOYMENT-ALIYUN.md) for complete production deployment instructions.

**Quick Summary:**
- Frontend and Backend run on separate servers
- Frontend: Nginx serving static files on port 1817
- Backend: Node.js API on port 1819, PostgreSQL database
- Uses Docker Compose for container management
- Requires NAT Gateway DNAT entries for public access

### Frontend-Only Deployment

For frontend-only deployments, use `docker-compose.frontend.yml`:

```bash
docker compose -f docker-compose.frontend.yml up -d frontend
```

## 🧪 Testing

Run the test suite:

```bash
npm test
# or
node tests/test-suite.js
```

See [tests/README.md](tests/README.md) for test documentation.

## 📖 Documentation

- [DEPLOYMENT-ALIYUN.md](DEPLOYMENT-ALIYUN.md) - Production deployment guide
- [ENVIRONMENT-SETUP.md](ENVIRONMENT-SETUP.md) - Environment configuration
- [EMAIL_SETUP.md](EMAIL_SETUP.md) - Email/SMTP configuration
- [docs/requirements.md](docs/requirements.md) - Full requirements and API docs
- [migrations/README.md](migrations/README.md) - Database migration guide

## 🆘 Troubleshooting

### Network Access Issues

See [NETWORK-ACCESS.md](NETWORK-ACCESS.md) for local network access troubleshooting.

### Production Issues

See [DEPLOYMENT-ALIYUN.md#troubleshooting](DEPLOYMENT-ALIYUN.md#troubleshooting) for production troubleshooting.

### Common Issues

- **Port conflicts**: Check if ports are already in use
- **Database connection**: Verify PostgreSQL is running and credentials are correct
- **Email not working**: Check SMTP configuration in `.env`

## 📝 License

[Add your license here]

## 👥 Contributing

[Add contribution guidelines here]

---

**Last Updated**: January 2025
