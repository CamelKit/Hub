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

-- Crowdsourced Drop Telemetry & Wiki Aggregation
CREATE TABLE IF NOT EXISTS npc_kill_totals (
  npc_def_id INTEGER PRIMARY KEY,
  npc_name TEXT NOT NULL,
  combat_level INTEGER DEFAULT 0,
  total_kills INTEGER DEFAULT 0,
  last_killed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS npc_drop_totals (
  npc_def_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  item_name TEXT,
  total_drops INTEGER DEFAULT 0,
  total_quantity INTEGER DEFAULT 0,
  min_quantity INTEGER DEFAULT 1,
  max_quantity INTEGER DEFAULT 1,
  unique_reporters INTEGER DEFAULT 0,
  status TEXT DEFAULT 'unconfirmed', -- 'unconfirmed' | 'confirmed'
  last_dropped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (npc_def_id, item_id)
);

CREATE TABLE IF NOT EXISTS drop_reporters (
  reporter_hash TEXT NOT NULL,
  npc_def_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reporter_hash, npc_def_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_npc_drop_status ON npc_drop_totals(status);
CREATE INDEX IF NOT EXISTS idx_drop_reporters_item ON drop_reporters(npc_def_id, item_id);

