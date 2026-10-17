ALTER TABLE ingredients ADD COLUMN bot_hidden INTEGER NOT NULL DEFAULT 0;
UPDATE ingredients SET bot_hidden = 1 WHERE name IN ('하이볼', '온더락');
