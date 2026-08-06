-- Down migration: drop all QuickDoc tables (used by diesel migrations rollback tooling).
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS projects;
