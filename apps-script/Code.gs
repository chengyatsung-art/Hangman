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

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
