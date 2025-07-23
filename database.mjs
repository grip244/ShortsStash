import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import chalk from 'chalk';

// This function sets up and returns the database connection.
async function initializeDatabase() {
  const db = await open({
    filename: './shortstash.sqlite',
    driver: sqlite3.Database,
  });

 await db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      last_video_id TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel_id INTEGER,
      upload_date TEXT,
      downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels (id)
    );
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    -- Set a default value so we don't have to check for nulls
    INSERT OR IGNORE INTO settings (key, value) VALUES ('normal_video_mode', 'prompt');
`);

  console.log(chalk.green('Database initialized successfully.'));
  return db;
}

export const dbPromise = initializeDatabase();