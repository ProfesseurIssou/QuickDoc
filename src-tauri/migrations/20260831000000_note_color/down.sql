-- Down migration: drop the note tint column.
ALTER TABLE notes DROP COLUMN color;
