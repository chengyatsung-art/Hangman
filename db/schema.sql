CREATE TABLE IF NOT EXISTS scores (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  student_id TEXT NOT NULL DEFAULT '',
  word TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  wrong_guesses INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  upload_status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_student_id ON scores (student_id);
CREATE INDEX IF NOT EXISTS idx_scores_timestamp_desc ON scores (timestamp DESC);

CREATE TABLE IF NOT EXISTS word_lists (
  id BIGSERIAL PRIMARY KEY,
  word_list_name TEXT NOT NULL,
  version TEXT NOT NULL,
  teacher_name TEXT NOT NULL DEFAULT '',
  publish_time TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'teacher-import',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (word_list_name, version)
);

CREATE INDEX IF NOT EXISTS idx_word_lists_publish_time_desc ON word_lists (publish_time DESC);

CREATE TABLE IF NOT EXISTS word_list_words (
  id BIGSERIAL PRIMARY KEY,
  word_list_id BIGINT NOT NULL REFERENCES word_lists (id) ON DELETE CASCADE,
  word TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_word_list_words_list_status
  ON word_list_words (word_list_id, status, sort_order);

CREATE TABLE IF NOT EXISTS app_runtime_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_word_list_id BIGINT REFERENCES word_lists (id) ON DELETE SET NULL,
  active_game_mode TEXT NOT NULL DEFAULT 'practice',
  max_wrong_guesses INTEGER NOT NULL DEFAULT 10,
  allow_word_repeat BOOLEAN NOT NULL DEFAULT FALSE,
  auto_finish_when_exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  score_correct_base INTEGER NOT NULL DEFAULT 100,
  score_wrong_guess_penalty INTEGER NOT NULL DEFAULT 10,
  score_hint_penalty INTEGER NOT NULL DEFAULT 15,
  score_time_penalty_seconds INTEGER NOT NULL DEFAULT 2,
  score_min_correct INTEGER NOT NULL DEFAULT 10,
  score_wrong_answer INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_runtime_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
