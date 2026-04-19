const fs = require("fs");
const path = require("path");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.scores && !args.words && !args.settings) {
    throw new Error("At least one of --scores, --words, or --settings is required");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL");
  }

  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1
  });

  const summary = {
    scores: 0,
    wordLists: 0,
    words: 0,
    settingsUpdated: false
  };

  const settingsMap = args.settings ? loadSettings(args.settings) : new Map();
  const scores = args.scores ? loadCsvObjects(args.scores) : [];
  const wordRows = args.words ? loadCsvObjects(args.words) : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO app_runtime_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");

    if (args.reset) {
      await client.query("TRUNCATE TABLE scores, word_list_words, word_lists RESTART IDENTITY CASCADE");
      await client.query(
        [
          "UPDATE app_runtime_settings",
          "SET active_word_list_id = NULL,",
          "    active_game_mode = 'practice',",
          "    max_wrong_guesses = 10,",
          "    allow_word_repeat = FALSE,",
          "    auto_finish_when_exhausted = FALSE,",
          "    updated_at = NOW()",
          "WHERE id = 1"
        ].join(" ")
      );
    }

    if (scores.length) {
      summary.scores = await importScores(client, scores);
    }

    if (wordRows.length) {
      const wordListMap = await importWordLists(client, wordRows);
      summary.wordLists = wordListMap.size;
      summary.words = wordRows.filter(function (row) {
        return normalizeText(row.word);
      }).length;
    }

    if (settingsMap.size) {
      summary.settingsUpdated = await importSettings(client, settingsMap);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log("Import completed.");
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv) {
  const args = {
    help: false,
    reset: false,
    scores: "",
    words: "",
    settings: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--help" || item === "-h") {
      args.help = true;
      continue;
    }
    if (item === "--reset") {
      args.reset = true;
      continue;
    }
    if (item === "--scores" || item === "--words" || item === "--settings") {
      const key = item.slice(2);
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for " + item);
      }
      args[key] = value;
      i += 1;
      continue;
    }
    throw new Error("Unknown argument: " + item);
  }

  return args;
}

function printHelp() {
  console.log("Usage:");
  console.log("  node scripts/import-gas-csv.js --scores Scores.csv --words SharedWordBank.csv --settings Settings.csv [--reset]");
}

function loadCsvObjects(filePath) {
  const absolutePath = path.resolve(filePath);
  const text = fs.readFileSync(absolutePath, "utf8");
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(function (header) {
    return normalizeText(header);
  });
  return rows.slice(1).map(function (row) {
    const item = {};
    for (let i = 0; i < headers.length; i += 1) {
      item[headers[i]] = row[i] == null ? "" : row[i];
    }
    return item;
  });
}

function loadSettings(filePath) {
  const rows = loadCsvObjects(filePath);
  const settings = new Map();
  rows.forEach(function (row) {
    const key = normalizeText(row.key);
    if (!key) return;
    settings.set(key, row.value == null ? "" : String(row.value));
  });
  return settings;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(value);
      value = "";
      continue;
    }
    if (char === "\r") {
      if (next === "\n") i += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter(function (item) {
    return item.length > 1 || normalizeText(item[0]);
  });
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeTextOrFallback(value, fallback) {
  return normalizeText(value) || normalizeText(fallback);
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeGameMode(value) {
  return normalizeText(value).toLowerCase() === "formal" ? "formal" : "practice";
}

function normalizeMaxWrongGuesses(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 10;
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

async function importScores(client, rows) {
  let count = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    await client.query(
      [
        "INSERT INTO scores (timestamp, student_name, student_id, word, category, difficulty, result, wrong_guesses, hints_used, duration_seconds, score, device_type, mode, upload_status)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
      ].join(" "),
      [
        normalizeTimestamp(row.timestamp),
        normalizeText(row.studentName),
        normalizeText(row.studentId),
        normalizeText(row.word),
        normalizeText(row.category),
        normalizeText(row.difficulty),
        normalizeText(row.result),
        Math.max(0, Math.round(Number(row.wrongGuesses) || 0)),
        Math.max(0, Math.round(Number(row.hintsUsed) || 0)),
        Math.max(0, Math.round(Number(row.durationSeconds) || 0)),
        Math.round(Number(row.score) || 0),
        normalizeText(row.deviceType),
        normalizeText(row.mode),
        normalizeTextOrFallback(row.uploadStatus, "uploaded")
      ]
    );
    count += 1;
  }
  return count;
}

async function importWordLists(client, rows) {
  const groups = new Map();
  rows.forEach(function (row, index) {
    const wordListName = normalizeText(row.wordListName);
    const version = normalizeText(row.version);
    const word = normalizeText(row.word);
    if (!wordListName || !version || !word) return;
    const key = wordListName + "|" + version;
    if (!groups.has(key)) {
      groups.set(key, {
        meta: {
          wordListName: wordListName,
          version: version,
          teacherName: normalizeTextOrFallback(row.teacherName, "未知老师"),
          publishTime: normalizeTimestamp(row.publishTime),
          source: normalizeTextOrFallback(row.source, "teacher-import")
        },
        words: []
      });
    }
    groups.get(key).words.push({
      word: word,
      meaning: normalizeText(row.meaning),
      category: normalizeText(row.category),
      difficulty: normalizeText(row.difficulty),
      status: normalizeTextOrFallback(row.status, "active"),
      sortOrder: index
    });
  });

  for (const entry of groups.values()) {
    const meta = entry.meta;
    const result = await client.query(
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
      [meta.wordListName, meta.version, meta.teacherName, meta.publishTime, meta.source]
    );

    const wordListId = result.rows[0].id;
    await client.query("DELETE FROM word_list_words WHERE word_list_id = $1", [wordListId]);

    for (let i = 0; i < entry.words.length; i += 1) {
      const item = entry.words[i];
      await client.query(
        [
          "INSERT INTO word_list_words (word_list_id, word, meaning, category, difficulty, status, sort_order)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7)"
        ].join(" "),
        [wordListId, item.word, item.meaning, item.category, item.difficulty, item.status, i]
      );
    }
  }

  return groups;
}

async function importSettings(client, settings) {
  const activeWordListName = normalizeText(settings.get("activeWordListName"));
  const activeVersion = normalizeText(settings.get("activeVersion"));
  let activeWordListId = null;

  if (activeWordListName && activeVersion) {
    const result = await client.query(
      "SELECT id FROM word_lists WHERE word_list_name = $1 AND version = $2 LIMIT 1",
      [activeWordListName, activeVersion]
    );
    if (result.rows.length) {
      activeWordListId = result.rows[0].id;
    } else {
      console.warn("Active word list in settings was not found:", activeWordListName, activeVersion);
    }
  }

  await client.query(
    [
      "UPDATE app_runtime_settings",
      "SET active_word_list_id = $1,",
      "    active_game_mode = $2,",
      "    max_wrong_guesses = $3,",
      "    allow_word_repeat = $4,",
      "    auto_finish_when_exhausted = $5,",
      "    updated_at = NOW()",
      "WHERE id = 1"
    ].join(" "),
    [
      activeWordListId,
      normalizeGameMode(settings.get("activeGameMode")),
      normalizeMaxWrongGuesses(settings.get("maxWrongGuesses")),
      normalizeBoolean(settings.get("allowWordRepeat")),
      normalizeBoolean(settings.get("autoFinishWhenExhausted"))
    ]
  );

  return true;
}

main().catch(function (error) {
  console.error("Import failed:", error.message);
  process.exit(1);
});
