-- Extensions used across the schema (citext and pg_trgm are trusted: the DB owner can create them).
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
