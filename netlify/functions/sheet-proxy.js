let poolPromise;
const DEFAULT_SCORING_RULES = {
  correctBaseScore: 100,
  wrongGuessPenalty: 10,
  hintPenalty: 15,
  timePenaltySeconds: 2,
  minCorrectScore: 10,
  wrongAnswerScore: 0
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, message: "Method Not Allowed" });
  }

  const requestBody = event.body || "{}";
  let parsedBody = {};
  try {
    parsedBody = JSON.parse(requestBody);
  } catch (error) {
    return jsonResponse(400, { ok: false, message: "Invalid JSON body", detail: error.message });
  }

  if (!process.env.DATABASE_URL) {
    return jsonResponse(500, {
      ok: false,
      message: "Missing DATABASE_URL. This project is Neon-only and no longer supports GAS fallback."
    });
  }

  try {
    const result = await handleDatabaseAction(parsedBody.action, parsedBody.payload || {});
    return jsonResponse(200, result);
  } catch (error) {
    console.error("Neon action failed:", error);
    return jsonResponse(500, { ok: false, message: error.message || "Database action failed" });
  }
};

async function handleDatabaseAction(action, payload) {
  if (!action) {
    throw new Error("Missing action");
  }

  switch (action) {
    case "saveScore":
      await saveScore(payload || {});
      return { ok: true, message: "score saved" };
    case "saveScores":
      await saveScores(payload || {});
      return { ok: true, message: "scores saved" };
    case "publishWordList":
      await publishWordList(payload || {});
      return { ok: true, message: "word list published" };
    case "loadSharedWordList":
      return { ok: true, data: { words: await loadSharedWordList() } };
    case "listWordLists":
      return { ok: true, data: await listWordLists() };
    case "loadBootstrapData":
      return { ok: true, data: await loadBootstrapData() };
    case "setActiveWordList":
      await setActiveWordList(payload || {});
      return { ok: true, data: { active: await getActiveWordList() }, message: "active word list updated" };
    case "updateWordListMeta":
      return { ok: true, data: await updateWordListMeta(payload || {}), message: "word list meta updated" };
    case "deleteWordList":
      return { ok: true, data: await deleteWordList(payload || {}), message: "word list deleted" };
    case "loadActiveWordList":
      return { ok: true, data: await loadActiveWordList() };
    case "loadWordListBySelection":
      return { ok: true, data: await loadWordListBySelection(payload || {}) };
    case "getActiveGameMode":
      return { ok: true, data: { activeGameMode: await getActiveGameMode() } };
    case "setActiveGameMode":
      await setActiveGameMode(payload || {});
      return { ok: true, data: { activeGameMode: await getActiveGameMode() }, message: "active game mode updated" };
    case "getMaxWrongGuesses":
      return { ok: true, data: { maxWrongGuesses: await getMaxWrongGuesses() } };
    case "setMaxWrongGuesses":
      await setMaxWrongGuesses(payload || {});
      return { ok: true, data: { maxWrongGuesses: await getMaxWrongGuesses() }, message: "max wrong guesses updated" };
    case "getAllowWordRepeat":
      return { ok: true, data: { allowWordRepeat: await getAllowWordRepeat() } };
    case "setAllowWordRepeat":
      await setAllowWordRepeat(payload || {});
      return { ok: true, data: { allowWordRepeat: await getAllowWordRepeat() }, message: "allow word repeat updated" };
    case "getAutoFinishWhenExhausted":
      return { ok: true, data: { autoFinishWhenExhausted: await getAutoFinishWhenExhausted() } };
    case "setAutoFinishWhenExhausted":
      await setAutoFinishWhenExhausted(payload || {});
      return {
        ok: true,
        data: { autoFinishWhenExhausted: await getAutoFinishWhenExhausted() },
        message: "auto finish when exhausted updated"
      };
    case "getScoringRules":
      return { ok: true, data: { scoringRules: await getScoringRules() } };
    case "setScoringRules":
      await setScoringRules(payload || {});
      return { ok: true, data: { scoringRules: await getScoringRules() }, message: "scoring rules updated" };
    case "loadLeaderboard":
      return { ok: true, data: { rankings: await loadLeaderboard(payload || {}) } };
    default:
      throw new Error("unknown action: " + action);
  }
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = import("@neondatabase/serverless").then(function (pkg) {
      return new pkg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 3
      });
    });
  }
  return poolPromise;
}

async function withTransaction(work) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureRuntimeSettings(db) {
  await db.query(
    "ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS score_correct_base INTEGER NOT NULL DEFAULT 100"
  );
  await db.query(
    "ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS score_wrong_guess_penalty INTEGER NOT NULL DEFAULT 10"
  );
  await db.query(
    "ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS score_hint_penalty INTEGER NOT NULL DEFAULT 15"
  );
  await db.query(
    "ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS score_time_penalty_seconds INTEGER NOT NULL DEFAULT 2"
  );
  await db.query(
    "ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS score_min_correct INTEGER NOT NULL DEFAULT 10"
  );
  await db.query(
    "ALTER TABLE app_runtime_settings ADD COLUMN IF NOT EXISTS score_wrong_answer INTEGER NOT NULL DEFAULT 0"
  );
  await db.query("INSERT INTO app_runtime_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
}

function jsonResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function normalizeText(value, fallback) {
  return String(value == null ? (fallback || "") : value).trim();
}

function normalizeTextOrFallback(value, fallback) {
  const normalized = normalizeText(value);
  return normalized || normalizeText(fallback);
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeGameMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "formal" ? "formal" : "practice";
}

function normalizeMaxWrongGuesses(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 10;
  return Math.max(1, Math.min(12, Math.round(parsed)));
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return Math.max(0, Math.round(Number(fallback) || 0));
  return Math.max(0, Math.round(parsed));
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return Math.max(1, Math.round(Number(fallback) || 1));
  return Math.max(1, Math.round(parsed));
}

function normalizeScoringRules(value) {
  const source = value || {};
  const minCorrectScore = normalizeNonNegativeInteger(source.minCorrectScore, DEFAULT_SCORING_RULES.minCorrectScore);
  const correctBaseScore = normalizeNonNegativeInteger(source.correctBaseScore, DEFAULT_SCORING_RULES.correctBaseScore);
  return {
    correctBaseScore: Math.max(minCorrectScore, correctBaseScore),
    wrongGuessPenalty: normalizeNonNegativeInteger(source.wrongGuessPenalty, DEFAULT_SCORING_RULES.wrongGuessPenalty),
    hintPenalty: normalizeNonNegativeInteger(source.hintPenalty, DEFAULT_SCORING_RULES.hintPenalty),
    timePenaltySeconds: normalizePositiveInteger(source.timePenaltySeconds, DEFAULT_SCORING_RULES.timePenaltySeconds),
    minCorrectScore: minCorrectScore,
    wrongAnswerScore: normalizeNonNegativeInteger(source.wrongAnswerScore, DEFAULT_SCORING_RULES.wrongAnswerScore)
  };
}

function normalizeScoreRecord(record) {
  return {
    timestamp: normalizeTimestamp(record.timestamp),
    studentName: normalizeText(record.studentName),
    studentId: normalizeText(record.studentId),
    word: normalizeText(record.word),
    category: normalizeText(record.category),
    difficulty: normalizeText(record.difficulty),
    result: normalizeText(record.result),
    wrongGuesses: Math.max(0, Math.round(Number(record.wrongGuesses) || 0)),
    hintsUsed: Math.max(0, Math.round(Number(record.hintsUsed) || 0)),
    durationSeconds: Math.max(0, Math.round(Number(record.durationSeconds) || 0)),
    score: Math.round(Number(record.score) || 0),
    deviceType: normalizeText(record.deviceType),
    mode: normalizeText(record.mode),
    uploadStatus: "uploaded"
  };
}

async function saveScore(record) {
  const normalized = normalizeScoreRecord(record);
  const pool = await getPool();
  await pool.query(
    [
      "INSERT INTO scores (timestamp, student_name, student_id, word, category, difficulty, result, wrong_guesses, hints_used, duration_seconds, score, device_type, mode, upload_status)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
    ].join(" "),
    [
      normalized.timestamp,
      normalized.studentName,
      normalized.studentId,
      normalized.word,
      normalized.category,
      normalized.difficulty,
      normalized.result,
      normalized.wrongGuesses,
      normalized.hintsUsed,
      normalized.durationSeconds,
      normalized.score,
      normalized.deviceType,
      normalized.mode,
      normalized.uploadStatus
    ]
  );
}

async function saveScores(payload) {
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (!records.length) return;

  await withTransaction(async function (client) {
    for (let i = 0; i < records.length; i += 1) {
      const normalized = normalizeScoreRecord(records[i] || {});
      await client.query(
        [
          "INSERT INTO scores (timestamp, student_name, student_id, word, category, difficulty, result, wrong_guesses, hints_used, duration_seconds, score, device_type, mode, upload_status)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
        ].join(" "),
        [
          normalized.timestamp,
          normalized.studentName,
          normalized.studentId,
          normalized.word,
          normalized.category,
          normalized.difficulty,
          normalized.result,
          normalized.wrongGuesses,
          normalized.hintsUsed,
          normalized.durationSeconds,
          normalized.score,
          normalized.deviceType,
          normalized.mode,
          normalized.uploadStatus
        ]
      );
    }
  });
}

async function publishWordList(payload) {
  const publishTime = normalizeTimestamp(payload.publishTime);
  const teacherName = normalizeTextOrFallback(payload.teacherName, "未知老师");
  const wordListName = normalizeTextOrFallback(payload.wordListName, "未命名词库");
  const version = normalizeText(payload.version);
  const source = normalizeTextOrFallback(payload.source, "teacher-import");
  const words = Array.isArray(payload.words) ? payload.words : [];
  const sanitizedWords = words
    .map(function (item) {
      return {
        word: normalizeText(item && item.word),
        meaning: normalizeText(item && item.meaning),
        category: normalizeTextOrFallback(item && item.category, payload.category),
        difficulty: normalizeTextOrFallback(item && item.difficulty, payload.difficulty),
        status: normalizeTextOrFallback(item && item.status, "active")
      };
    })
    .filter(function (item) {
      return item.word;
    });

  if (!version) {
    throw new Error("version is required");
  }
  if (!sanitizedWords.length) {
    throw new Error("words cannot be empty");
  }

  await withTransaction(async function (client) {
    await ensureRuntimeSettings(client);

    const wordListResult = await client.query(
      [
        "INSERT INTO word_lists (word_list_name, version, teacher_name, publish_time, source, status)",
        "VALUES ($1, $2, $3, $4, $5, 'active')",
        "ON CONFLICT (word_list_name, version) DO UPDATE",
        "SET teacher_name = EXCLUDED.teacher_name,",
        "    publish_time = EXCLUDED.publish_time,",
        "    source = EXCLUDED.source,",
        "    status = 'active'",
        "RETURNING id"
      ].join(" "),
      [wordListName, version, teacherName, publishTime, source]
    );

    const wordListId = wordListResult.rows[0].id;
    await client.query("DELETE FROM word_list_words WHERE word_list_id = $1", [wordListId]);

    for (let i = 0; i < sanitizedWords.length; i += 1) {
      const item = sanitizedWords[i];
      await client.query(
        [
          "INSERT INTO word_list_words (word_list_id, word, meaning, category, difficulty, status, sort_order)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7)"
        ].join(" "),
        [
          wordListId,
          item.word,
          item.meaning,
          item.category,
          item.difficulty,
          item.status,
          i
        ]
      );
    }

    const activeResult = await client.query("SELECT active_word_list_id FROM app_runtime_settings WHERE id = 1");
    if (!activeResult.rows[0] || activeResult.rows[0].active_word_list_id == null) {
      await client.query(
        "UPDATE app_runtime_settings SET active_word_list_id = $1, updated_at = NOW() WHERE id = 1",
        [wordListId]
      );
    }
  });
}

async function loadSharedWordList() {
  const pool = await getPool();
  const result = await pool.query(
    [
      "SELECT wl.publish_time AS \"publishTime\", wl.teacher_name AS \"teacherName\", wl.word_list_name AS \"wordListName\",",
      "       w.category, w.difficulty, w.word, w.meaning, w.status, wl.version, wl.source",
      "FROM word_list_words w",
      "JOIN word_lists wl ON wl.id = w.word_list_id",
      "WHERE wl.status = 'active' AND w.status = 'active'",
      "ORDER BY wl.publish_time DESC, wl.id DESC, w.sort_order ASC, w.id ASC"
    ].join(" ")
  );
  return result.rows;
}

async function listWordLists() {
  const pool = await getPool();
  await ensureRuntimeSettings(pool);
  const wordListsResult = await pool.query(
    [
      "SELECT wl.word_list_name AS \"wordListName\", wl.version, wl.publish_time AS \"publishTime\", wl.teacher_name AS \"teacherName\",",
      "       COALESCE(MIN(NULLIF(w.category, '')), '') AS category,",
      "       COALESCE(MIN(NULLIF(w.difficulty, '')), '') AS difficulty,",
      "       COUNT(*) FILTER (WHERE w.status = 'active')::INT AS count",
      "FROM word_lists wl",
      "LEFT JOIN word_list_words w ON w.word_list_id = wl.id",
      "WHERE wl.status = 'active'",
      "GROUP BY wl.id",
      "ORDER BY wl.publish_time DESC, wl.id DESC"
    ].join(" ")
  );
  const active = await ensureActiveWordList(pool);
  const settings = await getRuntimeSettings(pool);

  return {
    wordLists: wordListsResult.rows,
    active: active,
    activeGameMode: settings.activeGameMode,
    maxWrongGuesses: settings.maxWrongGuesses,
    allowWordRepeat: settings.allowWordRepeat,
    autoFinishWhenExhausted: settings.autoFinishWhenExhausted,
    scoringRules: settings.scoringRules
  };
}

async function loadBootstrapData() {
  const wordListData = await listWordLists();
  const activeWordsResult = await loadActiveWordList();
  return {
    wordLists: wordListData.wordLists,
    active: wordListData.active,
    activeGameMode: wordListData.activeGameMode,
    maxWrongGuesses: wordListData.maxWrongGuesses,
    allowWordRepeat: wordListData.allowWordRepeat,
    autoFinishWhenExhausted: wordListData.autoFinishWhenExhausted,
    scoringRules: wordListData.scoringRules,
    activeWords: activeWordsResult.words
  };
}

async function setActiveWordList(payload) {
  const wordListName = normalizeText(payload.wordListName);
  const version = normalizeText(payload.version);
  if (!wordListName || !version) {
    throw new Error("wordListName and version are required");
  }

  const pool = await getPool();
  await ensureRuntimeSettings(pool);
  const result = await pool.query(
    "SELECT id FROM word_lists WHERE word_list_name = $1 AND version = $2 AND status = 'active' LIMIT 1",
    [wordListName, version]
  );
  if (!result.rows.length) {
    throw new Error("target word list not found");
  }

  await pool.query(
    "UPDATE app_runtime_settings SET active_word_list_id = $1, updated_at = NOW() WHERE id = 1",
    [result.rows[0].id]
  );
}

async function updateWordListMeta(payload) {
  const originalWordListName = normalizeText(payload.originalWordListName);
  const originalVersion = normalizeText(payload.originalVersion);
  const teacherName = normalizeTextOrFallback(payload.teacherName, "未知老师");
  const wordListName = normalizeText(payload.wordListName);
  const version = normalizeText(payload.version);
  const category = normalizeTextOrFallback(payload.category, "General");
  const difficulty = normalizeTextOrFallback(payload.difficulty, "medium");

  if (!originalWordListName || !originalVersion) {
    throw new Error("originalWordListName and originalVersion are required");
  }
  if (!wordListName || !version) {
    throw new Error("wordListName and version are required");
  }

  return withTransaction(async function (client) {
    await ensureRuntimeSettings(client);
    const currentResult = await client.query(
      [
        "SELECT id FROM word_lists",
        "WHERE word_list_name = $1 AND version = $2 AND status = 'active'",
        "LIMIT 1"
      ].join(" "),
      [originalWordListName, originalVersion]
    );
    if (!currentResult.rows.length) {
      throw new Error("target word list not found");
    }

    const targetId = currentResult.rows[0].id;
    const duplicateResult = await client.query(
      [
        "SELECT id FROM word_lists",
        "WHERE word_list_name = $1 AND version = $2 AND status = 'active' AND id <> $3",
        "LIMIT 1"
      ].join(" "),
      [wordListName, version, targetId]
    );
    if (duplicateResult.rows.length) {
      throw new Error("target wordListName and version already exists");
    }

    await client.query(
      [
        "UPDATE word_lists",
        "SET teacher_name = $1, word_list_name = $2, version = $3",
        "WHERE id = $4"
      ].join(" "),
      [teacherName, wordListName, version, targetId]
    );

    await client.query(
      [
        "UPDATE word_list_words",
        "SET category = $1, difficulty = $2",
        "WHERE word_list_id = $3"
      ].join(" "),
      [category, difficulty, targetId]
    );

    return {
      updated: {
        wordListName: wordListName,
        version: version,
        teacherName: teacherName,
        category: category,
        difficulty: difficulty
      },
      active: await ensureActiveWordList(client)
    };
  });
}

async function deleteWordList(payload) {
  const wordListName = normalizeText(payload.wordListName);
  const version = normalizeText(payload.version);
  if (!wordListName || !version) {
    throw new Error("wordListName and version are required");
  }

  return withTransaction(async function (client) {
    await ensureRuntimeSettings(client);
    const currentResult = await client.query(
      "SELECT id FROM word_lists WHERE word_list_name = $1 AND version = $2 AND status = 'active' LIMIT 1",
      [wordListName, version]
    );
    if (!currentResult.rows.length) {
      throw new Error("target word list not found");
    }

    const targetId = currentResult.rows[0].id;
    await client.query(
      "UPDATE word_lists SET status = 'deleted' WHERE id = $1",
      [targetId]
    );

    const settingsResult = await client.query(
      "SELECT active_word_list_id FROM app_runtime_settings WHERE id = 1"
    );
    const activeWordListId = settingsResult.rows[0] ? settingsResult.rows[0].active_word_list_id : null;
    if (activeWordListId === targetId) {
      const fallbackResult = await client.query(
        "SELECT id FROM word_lists WHERE status = 'active' ORDER BY publish_time DESC, id DESC LIMIT 1"
      );
      const nextId = fallbackResult.rows.length ? fallbackResult.rows[0].id : null;
      await client.query(
        "UPDATE app_runtime_settings SET active_word_list_id = $1, updated_at = NOW() WHERE id = 1",
        [nextId]
      );
    }

    return {
      deleted: { wordListName: wordListName, version: version },
      active: await ensureActiveWordList(client)
    };
  });
}

async function getActiveWordList() {
  const pool = await getPool();
  return ensureActiveWordList(pool);
}

async function ensureActiveWordList(db) {
  await ensureRuntimeSettings(db);
  const currentResult = await db.query(
    [
      "SELECT wl.word_list_name AS \"wordListName\", wl.version, wl.id",
      "FROM app_runtime_settings s",
      "LEFT JOIN word_lists wl ON wl.id = s.active_word_list_id",
      "WHERE s.id = 1"
    ].join(" ")
  );
  const current = currentResult.rows[0];
  if (current && current.id != null) {
    return { wordListName: current.wordListName, version: current.version };
  }

  const latestResult = await db.query(
    "SELECT id, word_list_name AS \"wordListName\", version FROM word_lists WHERE status = 'active' ORDER BY publish_time DESC, id DESC LIMIT 1"
  );
  if (!latestResult.rows.length) {
    return null;
  }

  const latest = latestResult.rows[0];
  await db.query("UPDATE app_runtime_settings SET active_word_list_id = $1, updated_at = NOW() WHERE id = 1", [latest.id]);
  return { wordListName: latest.wordListName, version: latest.version };
}

async function loadActiveWordList() {
  const pool = await getPool();
  const active = await ensureActiveWordList(pool);
  if (!active) {
    return { words: [], active: null };
  }
  const words = await loadWordsBySelection(pool, active.wordListName, active.version);
  return { words: words, active: active };
}

async function loadWordListBySelection(payload) {
  const wordListName = normalizeText(payload.wordListName);
  const version = normalizeText(payload.version);
  if (!wordListName || !version) {
    throw new Error("wordListName and version are required");
  }

  const pool = await getPool();
  const words = await loadWordsBySelection(pool, wordListName, version);
  return {
    words: words,
    active: { wordListName: wordListName, version: version }
  };
}

async function loadWordsBySelection(db, wordListName, version) {
  const result = await db.query(
    [
      "SELECT wl.publish_time AS \"publishTime\", wl.teacher_name AS \"teacherName\", wl.word_list_name AS \"wordListName\",",
      "       w.category, w.difficulty, w.word, w.meaning, w.status, wl.version, wl.source",
      "FROM word_list_words w",
      "JOIN word_lists wl ON wl.id = w.word_list_id",
      "WHERE wl.word_list_name = $1 AND wl.version = $2 AND wl.status = 'active' AND w.status = 'active'",
      "ORDER BY w.sort_order ASC, w.id ASC"
    ].join(" "),
    [wordListName, version]
  );
  return result.rows;
}

async function getRuntimeSettings(db) {
  await ensureRuntimeSettings(db);
  const result = await db.query(
    [
      "SELECT active_game_mode, max_wrong_guesses, allow_word_repeat, auto_finish_when_exhausted,",
      "       score_correct_base, score_wrong_guess_penalty, score_hint_penalty,",
      "       score_time_penalty_seconds, score_min_correct, score_wrong_answer",
      "FROM app_runtime_settings WHERE id = 1"
    ].join(" ")
  );
  const row = result.rows[0] || {};
  return {
    activeGameMode: normalizeGameMode(row.active_game_mode),
    maxWrongGuesses: normalizeMaxWrongGuesses(row.max_wrong_guesses),
    allowWordRepeat: Boolean(row.allow_word_repeat),
    autoFinishWhenExhausted: Boolean(row.auto_finish_when_exhausted),
    scoringRules: normalizeScoringRules({
      correctBaseScore: row.score_correct_base,
      wrongGuessPenalty: row.score_wrong_guess_penalty,
      hintPenalty: row.score_hint_penalty,
      timePenaltySeconds: row.score_time_penalty_seconds,
      minCorrectScore: row.score_min_correct,
      wrongAnswerScore: row.score_wrong_answer
    })
  };
}

async function getActiveGameMode() {
  const pool = await getPool();
  return (await getRuntimeSettings(pool)).activeGameMode;
}

async function setActiveGameMode(payload) {
  const pool = await getPool();
  await ensureRuntimeSettings(pool);
  await pool.query(
    "UPDATE app_runtime_settings SET active_game_mode = $1, updated_at = NOW() WHERE id = 1",
    [normalizeGameMode(payload.mode)]
  );
}

async function getMaxWrongGuesses() {
  const pool = await getPool();
  return (await getRuntimeSettings(pool)).maxWrongGuesses;
}

async function setMaxWrongGuesses(payload) {
  const pool = await getPool();
  await ensureRuntimeSettings(pool);
  await pool.query(
    "UPDATE app_runtime_settings SET max_wrong_guesses = $1, updated_at = NOW() WHERE id = 1",
    [normalizeMaxWrongGuesses(payload.maxWrongGuesses)]
  );
}

async function getAllowWordRepeat() {
  const pool = await getPool();
  return (await getRuntimeSettings(pool)).allowWordRepeat;
}

async function setAllowWordRepeat(payload) {
  const pool = await getPool();
  await ensureRuntimeSettings(pool);
  await pool.query(
    "UPDATE app_runtime_settings SET allow_word_repeat = $1, updated_at = NOW() WHERE id = 1",
    [normalizeBoolean(payload.allowWordRepeat)]
  );
}

async function getAutoFinishWhenExhausted() {
  const pool = await getPool();
  return (await getRuntimeSettings(pool)).autoFinishWhenExhausted;
}

async function setAutoFinishWhenExhausted(payload) {
  const pool = await getPool();
  await ensureRuntimeSettings(pool);
  await pool.query(
    "UPDATE app_runtime_settings SET auto_finish_when_exhausted = $1, updated_at = NOW() WHERE id = 1",
    [normalizeBoolean(payload.autoFinishWhenExhausted)]
  );
}

async function getScoringRules() {
  const pool = await getPool();
  return (await getRuntimeSettings(pool)).scoringRules;
}

async function setScoringRules(payload) {
  const pool = await getPool();
  await ensureRuntimeSettings(pool);
  const rules = normalizeScoringRules(payload);
  await pool.query(
    [
      "UPDATE app_runtime_settings",
      "SET score_correct_base = $1,",
      "    score_wrong_guess_penalty = $2,",
      "    score_hint_penalty = $3,",
      "    score_time_penalty_seconds = $4,",
      "    score_min_correct = $5,",
      "    score_wrong_answer = $6,",
      "    updated_at = NOW()",
      "WHERE id = 1"
    ].join(" "),
    [
      rules.correctBaseScore,
      rules.wrongGuessPenalty,
      rules.hintPenalty,
      rules.timePenaltySeconds,
      rules.minCorrectScore,
      rules.wrongAnswerScore
    ]
  );
}

async function loadLeaderboard(payload) {
  const limit = Math.max(1, Math.min(500, Math.round(Number(payload.limit) || 100)));
  const pool = await getPool();
  const result = await pool.query(
    [
      "SELECT student_name AS \"studentName\", student_id AS \"studentId\",",
      "       COALESCE(SUM(score), 0)::INT AS \"totalScore\",",
      "       COUNT(*) FILTER (WHERE LOWER(result) = 'correct')::INT AS correct,",
      "       COUNT(*) FILTER (WHERE LOWER(result) = 'wrong')::INT AS failed,",
      "       COUNT(*)::INT AS games,",
      "       MAX(timestamp) AS \"lastPlayTime\"",
      "FROM scores",
      "WHERE student_id <> ''",
      "GROUP BY student_id, student_name",
      "ORDER BY \"totalScore\" DESC, correct DESC, \"lastPlayTime\" ASC",
      "LIMIT $1"
    ].join(" "),
    [limit]
  );
  return result.rows;
}
