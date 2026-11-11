# Docker Setup Guide

This project includes Docker configuration for easy deployment and development.

## Prerequisites

- Docker Desktop (Windows/Mac) or Docker Engine + Docker Compose (Linux)
- `.env` file with your configuration (see below)

## Quick Start

### 1. Create `.env` file

Create a `.env` file in the project root with:

```env
DATABASE_URL=postgres://postgres:postgres123@postgres:5432/project_management_v2

# Admin user configuration
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=Admin123!
ADMIN_NAME=Administrator

# JWT Secret (change in production!)
JWT_SECRET=your-secret-key-change-me-in-production
```

### 2. Build and start containers

```bash
# Build the Docker images
npm run docker:build

# Start all services (PostgreSQL + Backend)
npm run docker:up

# View logs
npm run docker:logs
```

### 3. Initialize database

After containers are running, initialize the database:

```bash
# Import existing data from data.json (if you have it)
docker-compose exec backend npm run db:import-json

# Seed admin user
docker-compose exec backend npm run db:seed-admin

```

### 4. Access the application

- **Frontend/Backend**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **PostgreSQL**: localhost:5433 (from host) or `postgres:5432` (from containers)

## Docker Commands

### Using npm scripts:

```bash
npm run docker:build    # Build Docker images
npm run docker:up        # Start containers in background
npm run docker:down       # Stop and remove containers
npm run docker:logs      # View logs (follow mode)
npm run docker:restart   # Restart containers
npm run docker:ps         # List running containers
```

### Using docker-compose directly:

```bash
docker-compose build              # Build images
docker-compose up -d              # Start in background
docker-compose up                 # Start in foreground (see logs)
docker-compose down               # Stop and remove
docker-compose down -v            # Stop and remove volumes (deletes DB data!)
docker-compose logs -f backend    # View backend logs
docker-compose logs -f postgres   # View database logs
docker-compose exec backend sh    # Access backend container shell
docker-compose exec postgres psql -U postgres -d project_management_v2  # Access database
```

## Services

### Backend Service
- **Image**: Built from `Dockerfile`
- **Port**: 3000
- **Environment**: Loads from `.env` file
- **Volumes**: Mounts `.env` file (read-only)

### PostgreSQL Service
- **Image**: `postgres:16-alpine`
- **Port**: 5433 (host) → 5432 (container)
- **Database**: `project_management_v2`
- **User**: `postgres`
- **Password**: `postgres123`
- **Data**: Persisted in `postgres_data` volume

## Development with Docker

For development with hot-reload, you can use an override file:

1. Copy `.docker-compose.override.yml.example` to `.docker-compose.override.yml`
2. Modify as needed for your development setup
3. Run `docker-compose up` (it automatically uses the override file)

## Troubleshooting

### Database connection errors

If the backend can't connect to PostgreSQL:
- Wait a few seconds after `docker-compose up` for PostgreSQL to be ready
- Check logs: `docker-compose logs postgres`
- Verify health: `docker-compose ps` (should show "healthy" for postgres)

### Port already in use

If port 3000 or 5433 is already in use:
- Change ports in `docker-compose.yml`
- Or stop the conflicting service

### Environment variables not loading

- Ensure `.env` file exists in project root
- Check file permissions
- Verify variable names match what the app expects

### Reset everything

To completely reset (⚠️ deletes all data):

```bash
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

Then re-run database initialization steps.

## Production Deployment

For production:

1. **Change default passwords** in `.env`
2. **Set a strong JWT_SECRET**
3. **Use environment variables** instead of `.env` file (more secure)
4. **Enable SSL/TLS** for PostgreSQL connections
5. **Use a reverse proxy** (nginx/traefik) for HTTPS
6. **Set up backups** for the PostgreSQL volume
7. **Configure resource limits** in `docker-compose.yml`

Example production `docker-compose.prod.yml`:

```yaml
services:
  backend:
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - JWT_SECRET=${JWT_SECRET}
      # ... other vars from environment
    # Remove .env volume mount
    restart: always
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

