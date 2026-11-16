# database

Cloud SQL for PostgreSQL 16, private IP only, SSL required, daily backups, audit-friendly
logging flags. Creates the app database and user, and stores the full `DATABASE_URL` in Secret
Manager (`<name>-database-url`) for Cloud Run to mount. pgvector is enabled by the first
migration (`CREATE EXTENSION vector`), not a flag.
