DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  username TEXT,
  github_username TEXT,
  discord_username TEXT,
  camel_coins INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS plugins;
CREATE TABLE plugins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_url TEXT NOT NULL UNIQUE,
  name TEXT,
  description TEXT,
  author TEXT,
  current_version TEXT,
  download_url TEXT,
  status TEXT DEFAULT 'pending',
  submitter_github_id TEXT,
  user_id INTEGER,
  latest_commit_hash TEXT,
  asset_sha TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

