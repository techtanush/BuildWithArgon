-- Preview app accounts remain behind the venture owner's gateway authorization.
CREATE TABLE starter_auth_users (
 id TEXT PRIMARY KEY, venture_id TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
 email TEXT NOT NULL, salt BLOB NOT NULL, password_hash BLOB NOT NULL,
 UNIQUE(venture_id,email)
);
CREATE TABLE starter_auth_sessions (
 token_hash TEXT PRIMARY KEY, venture_id TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES starter_auth_users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX starter_auth_session_expiry ON starter_auth_sessions(expires_at);
CREATE TABLE starter_auth_limits (
 venture_id TEXT PRIMARY KEY REFERENCES ventures(id) ON DELETE CASCADE,
 window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
);
