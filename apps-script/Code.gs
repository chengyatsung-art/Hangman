/**
 * Google Apps Script for Hangman project.
 * 1) Create two sheets in one spreadsheet:
 *    - Scores
 *    - SharedWordBank
 * 2) Fill SCRIPT_PROPERTY: SPREADSHEET_ID=your_sheet_id
 * 3) Deploy as Web App (Anyone with link).
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    var action = body.action;
    var payload = body.payload || {};

    if (action === "saveScore") {
      saveScore_(payload);
      return json_({ ok: true, message: "score saved" });
    }

    if (action === "publishWordList") {
      publishWordList_(payload);
      return json_({ ok: true, message: "word list published" });
    }

    if (action === "loadSharedWordList") {
      var words = loadSharedWordList_();
      return json_({ ok: true, data: { words: words } });
    }

    if (action === "listWordLists") {
      var wordLists = listWordLists_();
      var active = getActiveWordList_();
      var activeGameMode = getActiveGameMode_();
      var maxWrongGuesses = getMaxWrongGuesses_();
      return json_({ ok: true, data: { wordLists: wordLists, active: active, activeGameMode: activeGameMode, maxWrongGuesses: maxWrongGuesses } });
    }

    if (action === "setActiveWordList") {
      setActiveWordList_(payload);
      var current = getActiveWordList_();
      return json_({ ok: true, data: { active: current }, message: "active word list updated" });
    }

    if (action === "loadActiveWordList") {
      var activeWords = loadActiveWordList_();
      return json_({ ok: true, data: activeWords });
    }

    if (action === "loadWordListBySelection") {
      var selectedWords = loadWordListBySelection_(payload);
      return json_({ ok: true, data: selectedWords });
    }

    if (action === "getActiveGameMode") {
      return json_({ ok: true, data: { activeGameMode: getActiveGameMode_() } });
    }

    if (action === "setActiveGameMode") {
      setActiveGameMode_(payload);
      return json_({ ok: true, data: { activeGameMode: getActiveGameMode_() }, message: "active game mode updated" });
    }

    if (action === "getMaxWrongGuesses") {
      return json_({ ok: true, data: { maxWrongGuesses: getMaxWrongGuesses_() } });
    }

    if (action === "setMaxWrongGuesses") {
      setMaxWrongGuesses_(payload);
      return json_({ ok: true, data: { maxWrongGuesses: getMaxWrongGuesses_() }, message: "max wrong guesses updated" });
    }

    if (action === "loadLeaderboard") {
      var rankings = loadLeaderboard_(payload);
      return json_({ ok: true, data: { rankings: rankings } });
    }

    return json_({ ok: false, message: "unknown action: " + action });
  } catch (err) {
    return json_({ ok: false, message: err.message });
  }
}

function saveScore_(record) {
  var sheet = getSheet_("Scores");
  ensureScoreHeader_(sheet);
  sheet.appendRow([
    record.timestamp || "",
    record.studentName || "",
    record.studentId || "",
    record.word || "",
    record.category || "",
    record.difficulty || "",
    record.result || "",
    record.wrongGuesses || 0,
    record.hintsUsed || 0,
    record.durationSeconds || 0,
    record.score || 0,
    record.deviceType || "",
    record.mode || "",
    "uploaded"
  ]);
}

function publishWordList_(payload) {
  var sheet = getSheet_("SharedWordBank");
  ensureWordHeader_(sheet);
  var words = payload.words || [];
  for (var i = 0; i < words.length; i++) {
    var item = words[i];
    sheet.appendRow([
      payload.publishTime || new Date().toISOString(),
      payload.teacherName || "",
      payload.wordListName || "",
      item.category || payload.category || "",
      item.difficulty || payload.difficulty || "",
      item.word || "",
      item.meaning || "",
      item.status || "active",
      payload.version || "v1",
      payload.source || "teacher-import"
    ]);
  }
}

function loadSharedWordList_() {
  var sheet = getSheet_("SharedWordBank");
  ensureWordHeader_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var result = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[7]) !== "active") continue;
    result.push({
      publishTime: row[0],
      teacherName: row[1],
      wordListName: row[2],
      category: row[3],
      difficulty: row[4],
      word: row[5],
      meaning: row[6],
      status: row[7],
      version: row[8],
      source: row[9]
    });
  }
  return result;
}

function listWordLists_() {
  var sheet = getSheet_("SharedWordBank");
  ensureWordHeader_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var map = {};
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[7]) !== "active") continue;
    var wordListName = String(row[2] || "").trim();
    var version = String(row[8] || "").trim();
    if (!wordListName || !version) continue;
    var key = wordListName + "|" + version;
    if (!map[key]) {
      map[key] = {
        wordListName: wordListName,
        version: version,
        publishTime: String(row[0] || ""),
        category: String(row[3] || ""),
        difficulty: String(row[4] || ""),
        count: 0
      };
    }
    map[key].count += 1;
  }

  var list = [];
  for (var k in map) {
    if (map.hasOwnProperty(k)) list.push(map[k]);
  }
  list.sort(function (a, b) {
    return String(b.publishTime).localeCompare(String(a.publishTime));
  });
  return list;
}

function setActiveWordList_(payload) {
  var wordListName = String(payload && payload.wordListName || "").trim();
  var version = String(payload && payload.version || "").trim();
  if (!wordListName || !version) {
    throw new Error("wordListName and version are required");
  }

  var list = listWordLists_();
  var exists = false;
  for (var i = 0; i < list.length; i++) {
    if (list[i].wordListName === wordListName && list[i].version === version) {
      exists = true;
      break;
    }
  }
  if (!exists) throw new Error("target word list not found");

  setSetting_("activeWordListName", wordListName);
  setSetting_("activeVersion", version);
  setSetting_("activeUpdatedAt", new Date().toISOString());
}

function getActiveWordList_() {
  var name = getSetting_("activeWordListName");
  var version = getSetting_("activeVersion");
  if (!name || !version) return null;
  return { wordListName: name, version: version };
}

function loadActiveWordList_() {
  var active = getActiveWordList_();
  if (!active) {
    var candidates = listWordLists_();
    if (!candidates.length) return { words: [], active: null };
    active = {
      wordListName: candidates[0].wordListName,
      version: candidates[0].version
    };
    setActiveWordList_(active);
  }

  return { words: loadWordsByList_(active.wordListName, active.version), active: active };
}

function loadWordListBySelection_(payload) {
  var wordListName = String(payload && payload.wordListName || "").trim();
  var version = String(payload && payload.version || "").trim();
  if (!wordListName || !version) {
    throw new Error("wordListName and version are required");
  }
  return {
    words: loadWordsByList_(wordListName, version),
    active: { wordListName: wordListName, version: version }
  };
}

function loadWordsByList_(wordListName, version) {
  var sheet = getSheet_("SharedWordBank");
  ensureWordHeader_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var result = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[7]) !== "active") continue;
    if (String(row[2] || "").trim() !== wordListName) continue;
    if (String(row[8] || "").trim() !== version) continue;
    result.push({
      publishTime: row[0],
      teacherName: row[1],
      wordListName: row[2],
      category: row[3],
      difficulty: row[4],
      word: row[5],
      meaning: row[6],
      status: row[7],
      version: row[8],
      source: row[9]
    });
  }
  return result;
}

function getActiveGameMode_() {
  var mode = String(getSetting_("activeGameMode") || "").trim().toLowerCase();
  if (mode !== "formal" && mode !== "practice") mode = "practice";
  return mode;
}

function setActiveGameMode_(payload) {
  var mode = String(payload && payload.mode || "").trim().toLowerCase();
  if (mode !== "formal" && mode !== "practice") {
    throw new Error("mode must be practice or formal");
  }
  setSetting_("activeGameMode", mode);
  setSetting_("activeModeUpdatedAt", new Date().toISOString());
}

function getMaxWrongGuesses_() {
  var raw = Number(getSetting_("maxWrongGuesses"));
  if (isNaN(raw)) raw = 10;
  if (raw < 1) raw = 1;
  if (raw > 10) raw = 10;
  return Math.round(raw);
}

function setMaxWrongGuesses_(payload) {
  var raw = Number(payload && payload.maxWrongGuesses);
  if (isNaN(raw)) throw new Error("maxWrongGuesses must be a number");
  raw = Math.round(raw);
  if (raw < 1 || raw > 10) throw new Error("maxWrongGuesses must be between 1 and 10");
  setSetting_("maxWrongGuesses", raw);
  setSetting_("maxWrongGuessesUpdatedAt", new Date().toISOString());
}

function loadLeaderboard_(payload) {
  var sheet = getSheet_("Scores");
  ensureScoreHeader_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  var rankMap = {};
  var i;
  for (i = 0; i < values.length; i++) {
    var row = values[i];
    var studentName = String(row[1] || "").trim();
    var studentId = String(row[2] || "").trim();
    if (!studentId) continue;

    var score = Number(row[10]);
    if (isNaN(score)) score = 0;

    var result = String(row[6] || "").toLowerCase();
    var key = studentId + "|" + studentName;
    if (!rankMap[key]) {
      rankMap[key] = {
        studentName: studentName,
        studentId: studentId,
        totalScore: 0,
        correct: 0,
        failed: 0,
        games: 0,
        lastPlayTime: ""
      };
    }

    var item = rankMap[key];
    item.totalScore += score;
    if (result === "correct") item.correct += 1;
    if (result === "wrong") item.failed += 1;
    item.games += 1;

    var ts = String(row[0] || "");
    if (ts && (!item.lastPlayTime || ts > item.lastPlayTime)) {
      item.lastPlayTime = ts;
    }
  }

  var list = [];
  for (var k in rankMap) {
    if (rankMap.hasOwnProperty(k)) list.push(rankMap[k]);
  }

  list.sort(function (a, b) {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return String(a.lastPlayTime).localeCompare(String(b.lastPlayTime));
  });

  var limit = Number(payload && payload.limit ? payload.limit : 100);
  if (isNaN(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;
  return list.slice(0, limit);
}

function getSheet_(name) {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Missing script property: SPREADSHEET_ID");
  }
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureScoreHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow([
    "timestamp", "studentName", "studentId", "word", "category", "difficulty",
    "result", "wrongGuesses", "hintsUsed", "durationSeconds", "score",
    "deviceType", "mode", "uploadStatus"
  ]);
}

function ensureWordHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow([
    "publishTime", "teacherName", "wordListName", "category", "difficulty",
    "word", "meaning", "status", "version", "source"
  ]);
}

function getSettingsSheet_() {
  var sheet = getSheet_("Settings");
  if (sheet.getLastRow() <= 0) {
    sheet.appendRow(["key", "value", "updatedAt"]);
  }
  return sheet;
}

function getSetting_(key) {
  var sheet = getSettingsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "";
  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === key) return String(values[i][1] || "");
  }
  return "";
}

function setSetting_(key, value) {
  var sheet = getSettingsSheet_();
  sheet.appendRow([key, String(value || ""), new Date().toISOString()]);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
