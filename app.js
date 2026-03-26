(function () {
  "use strict";

  const STORAGE_KEYS = {
    LOCAL_DRAFT_WORDS: "hangman_local_draft_words_v1",
    SHARED_WORDS_CACHE: "hangman_shared_words_cache_v1",
    SCORES: "hangman_scores_v1",
    GAME_RECORDS: "hangman_game_records_v1",
    PENDING_REMOTE: "hangman_pending_remote_v1",
    ACTIVE_WORD_SOURCE: "hangman_active_word_source_v1",
    TEACHER_UNLOCKED: "hangman_teacher_unlocked_v1"
  };

  const CONFIG = Object.assign({
    gasWebAppUrl: "",
    apiMode: "direct",
    proxyEndpoint: "/.netlify/functions/sheet-proxy",
    maxWrongGuesses: 10,
    teacherPassword: "cys88888888"
  }, window.HANGMAN_CONFIG || {});

  const DEFAULT_WORDS = [
    { word: "apple", meaning: "苹果", category: "Food", difficulty: "easy" },
    { word: "orange", meaning: "橙子", category: "Food", difficulty: "easy" },
    { word: "teacher", meaning: "老师", category: "School", difficulty: "easy" },
    { word: "student", meaning: "学生", category: "School", difficulty: "easy" },
    { word: "library", meaning: "图书馆", category: "School", difficulty: "medium" },
    { word: "science", meaning: "科学", category: "School", difficulty: "medium" },
    { word: "elephant", meaning: "大象", category: "Animals", difficulty: "medium" },
    { word: "giraffe", meaning: "长颈鹿", category: "Animals", difficulty: "medium" },
    { word: "vegetable", meaning: "蔬菜", category: "Food", difficulty: "medium" },
    { word: "adventure", meaning: "冒险", category: "General", difficulty: "hard" },
    { word: "knowledge", meaning: "知识", category: "General", difficulty: "hard" },
    { word: "chemistry", meaning: "化学", category: "School", difficulty: "hard" }
  ];

  const state = {
    student: null,
    words: [],
    wordSource: "default",
    showMeaning: true,
    game: {
      currentWordObj: null,
      guessed: new Set(),
      wrongGuesses: 0,
      hintsUsed: 0,
      startTime: 0,
      questionEnded: false
    },
    session: {
      total: 0,
      correct: 0,
      failed: 0,
      totalScore: 0,
      records: []
    },
    teacher: {
      draftWords: [],
      sharedWords: [],
      wordLists: [],
      activeWordList: null,
      activeGameMode: "practice",
      maxWrongGuesses: normalizeMaxWrongGuesses(CONFIG.maxWrongGuesses)
    }
  };

  const els = getElements();
  let localFallback;
  let apiClient;
  let storage;
  let scoreService;
  let wordBankService;

  function init() {
    bindTabEvents();
    bindStudentEvents();
    bindTeacherEvents();
    bindRankEvents();
    buildKeyboard();
    restoreTeacherDraft();
    refreshNetworkBadge();
    updateWordBankBadge();
    refreshLeaderboard();
    bootstrapWords();
    refreshTeacherLockState();
    loadWordListsForTeacher();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", refreshNetworkBadge);
  }

  function getElements() {
    return {
      networkBadge: document.getElementById("networkBadge"),
      wordBankBadge: document.getElementById("wordBankBadge"),
      teacherUnlockCard: document.getElementById("teacherUnlockCard"),
      teacherPasswordInput: document.getElementById("teacherPasswordInput"),
      teacherUnlockBtn: document.getElementById("teacherUnlockBtn"),
      teacherUnlockMsg: document.getElementById("teacherUnlockMsg"),
      teacherContentWrap: document.getElementById("teacherContentWrap"),
      studentForm: document.getElementById("studentForm"),
      studentName: document.getElementById("studentName"),
      studentId: document.getElementById("studentId"),
      studentModeHint: document.getElementById("studentModeHint"),
      studentWordListWrap: document.getElementById("studentWordListWrap"),
      studentWordListSelect: document.getElementById("studentWordListSelect"),
      studentFormMsg: document.getElementById("studentFormMsg"),
      startCard: document.getElementById("startCard"),
      gameCard: document.getElementById("gameCard"),
      resultCard: document.getElementById("resultCard"),
      studentInfoText: document.getElementById("studentInfoText"),
      wordMetaText: document.getElementById("wordMetaText"),
      toggleMeaningBtn: document.getElementById("toggleMeaningBtn"),
      wordSlots: document.getElementById("wordSlots"),
      meaningText: document.getElementById("meaningText"),
      keyboard: document.getElementById("keyboard"),
      hintBtn: document.getElementById("hintBtn"),
      nextBtn: document.getElementById("nextBtn"),
      resetBtn: document.getElementById("resetBtn"),
      finishBtn: document.getElementById("finishBtn"),
      scoreText: document.getElementById("scoreText"),
      questionResultText: document.getElementById("questionResultText"),
      uploadStatusText: document.getElementById("uploadStatusText"),
      summaryText: document.getElementById("summaryText"),
      summaryUploadText: document.getElementById("summaryUploadText"),
      restartBtn: document.getElementById("restartBtn"),
      retryPendingBtn: document.getElementById("retryPendingBtn"),
      exportCsvBtn: document.getElementById("exportCsvBtn"),
      importFileInput: document.getElementById("importFileInput"),
      importBtn: document.getElementById("importBtn"),
      dedupeBtn: document.getElementById("dedupeBtn"),
      clearDraftBtn: document.getElementById("clearDraftBtn"),
      useDraftBtn: document.getElementById("useDraftBtn"),
      publishBtn: document.getElementById("publishBtn"),
      loadSharedBtn: document.getElementById("loadSharedBtn"),
      wordListSelect: document.getElementById("wordListSelect"),
      refreshWordListsBtn: document.getElementById("refreshWordListsBtn"),
      setActiveWordListBtn: document.getElementById("setActiveWordListBtn"),
      activeWordListText: document.getElementById("activeWordListText"),
      teacherGameMode: document.getElementById("teacherGameMode"),
      setGameModeBtn: document.getElementById("setGameModeBtn"),
      activeGameModeText: document.getElementById("activeGameModeText"),
      teacherMaxWrongGuesses: document.getElementById("teacherMaxWrongGuesses"),
      setMaxWrongGuessesBtn: document.getElementById("setMaxWrongGuessesBtn"),
      activeMaxWrongGuessesText: document.getElementById("activeMaxWrongGuessesText"),
      teacherName: document.getElementById("teacherName"),
      wordListName: document.getElementById("wordListName"),
      categoryInput: document.getElementById("categoryInput"),
      difficultyInput: document.getElementById("difficultyInput"),
      teacherStatusText: document.getElementById("teacherStatusText"),
      teacherPublishText: document.getElementById("teacherPublishText"),
      draftCountText: document.getElementById("draftCountText"),
      draftTableBody: document.getElementById("draftTableBody"),
      sharedCountText: document.getElementById("sharedCountText"),
      sharedTableBody: document.getElementById("sharedTableBody"),
      refreshRankBtn: document.getElementById("refreshRankBtn"),
      rankTableBody: document.getElementById("rankTableBody")
    };
  }

  function setupServices() {
    localFallback = new LocalStorageFallback();
    apiClient = new ApiClient(CONFIG);
    storage = new SheetStorage(apiClient, localFallback);
    scoreService = new ScoreService(storage);
    wordBankService = new WordBankService(storage);
  }

  function bindTabEvents() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabPanels = document.querySelectorAll(".tab-panel");
    tabButtons.forEach((button) => {
      button.addEventListener("click", function () {
        tabButtons.forEach((b) => b.classList.remove("active"));
        tabPanels.forEach((p) => p.classList.remove("active"));
        button.classList.add("active");
        document.getElementById(button.dataset.tab).classList.add("active");
      });
    });
  }

  function bindStudentEvents() {
    els.studentForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const name = els.studentName.value.trim();
      const studentId = els.studentId.value.trim();
      if (!name || !studentId) {
        setText(els.studentFormMsg, "姓名和学号都不能为空。", "var(--danger)");
        return;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(studentId)) {
        setText(els.studentFormMsg, "学号格式不合法，只允许字母/数字/_/-。", "var(--danger)");
        return;
      }
      const activeGameMode = await resolveActiveGameMode();
      await resolveMaxWrongGuesses();
      if (activeGameMode === "practice") {
        const selected = await applyStudentSelectedWordList();
        if (!selected) return;
      }
      state.student = { name, studentId, mode: activeGameMode };
      state.session = { total: 0, correct: 0, failed: 0, totalScore: 0, records: [] };
      setText(els.studentFormMsg, "");
      els.startCard.classList.add("hidden");
      els.resultCard.classList.add("hidden");
      els.gameCard.classList.remove("hidden");
      nextQuestion();
    });

    els.toggleMeaningBtn.addEventListener("click", function () {
      state.showMeaning = !state.showMeaning;
      els.toggleMeaningBtn.textContent = "释义：" + (state.showMeaning ? "开" : "关");
      renderWord();
    });
    els.hintBtn.addEventListener("click", useHint);
    els.nextBtn.addEventListener("click", nextQuestion);
    els.resetBtn.addEventListener("click", resetSession);
    els.finishBtn.addEventListener("click", finishSession);
    els.restartBtn.addEventListener("click", function () {
      els.resultCard.classList.add("hidden");
      els.startCard.classList.remove("hidden");
    });
    els.retryPendingBtn.addEventListener("click", async function () {
      setText(els.summaryUploadText, "正在补传...", "var(--warn)");
      const result = await scoreService.retryPending();
      setText(
        els.summaryUploadText,
        "补传完成：成功 " + result.success + " 条，失败 " + result.failed + " 条。",
        result.failed ? "var(--warn)" : "var(--ok)"
      );
    });
    els.exportCsvBtn.addEventListener("click", exportScoresCsv);
  }

  function bindTeacherEvents() {
    if (els.teacherUnlockBtn) {
      els.teacherUnlockBtn.addEventListener("click", unlockTeacherMode);
    }
    els.importBtn.addEventListener("click", importWordsFromFile);
    els.dedupeBtn.addEventListener("click", dedupeDraftWords);
    els.clearDraftBtn.addEventListener("click", clearDraftWords);
    els.useDraftBtn.addEventListener("click", function () {
      if (!state.teacher.draftWords.length) {
        setText(els.teacherStatusText, "本地草稿为空，无法切换。", "var(--danger)");
        return;
      }
      state.words = state.teacher.draftWords.slice();
      state.wordSource = "local_draft";
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "local_draft");
      updateWordBankBadge();
      setText(els.teacherStatusText, "学生端已切换为本地草稿词库（仅当前浏览器）。", "var(--ok)");
    });
    els.publishBtn.addEventListener("click", publishDraftWords);
    els.loadSharedBtn.addEventListener("click", loadSharedWordsForTeacher);
    els.refreshWordListsBtn.addEventListener("click", loadWordListsForTeacher);
    els.setActiveWordListBtn.addEventListener("click", setActiveWordListForTeacher);
    els.setGameModeBtn.addEventListener("click", setActiveGameModeForTeacher);
    els.setMaxWrongGuessesBtn.addEventListener("click", setMaxWrongGuessesForTeacher);
  }

  function isTeacherUnlocked() {
    return sessionStorage.getItem(STORAGE_KEYS.TEACHER_UNLOCKED) === "1";
  }

  function refreshTeacherLockState() {
    const unlocked = isTeacherUnlocked();
    if (els.teacherUnlockCard) els.teacherUnlockCard.classList.toggle("hidden", unlocked);
    if (els.teacherContentWrap) els.teacherContentWrap.classList.toggle("hidden", !unlocked);
  }

  async function unlockTeacherMode() {
    const input = (els.teacherPasswordInput && els.teacherPasswordInput.value || "").trim();
    if (!input) {
      setText(els.teacherUnlockMsg, "请输入密码。", "var(--warn)");
      return;
    }
    if (input !== String(CONFIG.teacherPassword || "")) {
      setText(els.teacherUnlockMsg, "密码错误。", "var(--danger)");
      return;
    }
    sessionStorage.setItem(STORAGE_KEYS.TEACHER_UNLOCKED, "1");
    if (els.teacherPasswordInput) els.teacherPasswordInput.value = "";
    setText(els.teacherUnlockMsg, "");
    refreshTeacherLockState();
    await loadWordListsForTeacher();
  }

  function bindRankEvents() {
    els.refreshRankBtn.addEventListener("click", refreshLeaderboard);
  }

  async function bootstrapWords() {
    if (state.teacher.draftWords.length) {
      state.words = state.teacher.draftWords.slice();
      state.wordSource = "local_draft";
      updateWordBankBadge();
      return;
    }

    const savedSource = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE);
    if (savedSource === "local_draft" && state.teacher.draftWords.length) {
      state.words = state.teacher.draftWords.slice();
      state.wordSource = "local_draft";
      updateWordBankBadge();
      return;
    }

    if (location.protocol !== "file:") {
      const active = await wordBankService.loadActiveWordList();
      if (active.words.length) {
        state.words = active.words;
        state.wordSource = "shared";
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "shared");
        state.teacher.activeWordList = active.active || null;
        renderActiveWordListText();
        updateWordBankBadge();
        return;
      }
    }

    state.words = normalizeWords(DEFAULT_WORDS);
    state.wordSource = "default";
    updateWordBankBadge();
  }

  function restoreTeacherDraft() {
    const draft = wordBankService.loadLocalWordList();
    state.teacher.draftWords = draft;
    renderDraftTable();
  }

  function buildKeyboard() {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    els.keyboard.innerHTML = "";
    letters.forEach((letter) => {
      const button = document.createElement("button");
      button.className = "key-btn";
      button.textContent = letter;
      button.dataset.letter = letter;
      button.addEventListener("click", function () {
        handleGuess(letter);
      });
      els.keyboard.appendChild(button);
    });
  }

  function nextQuestion() {
    if (!state.student) return;
    if (!state.words.length) {
      setText(els.questionResultText, "词库为空，请先导入或发布词库。", "var(--danger)");
      return;
    }

    const currentWordObj = state.words[Math.floor(Math.random() * state.words.length)];
    state.game.currentWordObj = currentWordObj;
    state.game.guessed = new Set();
    state.game.wrongGuesses = 0;
    state.game.hintsUsed = 0;
    state.game.startTime = Date.now();
    state.game.questionEnded = false;
    state.session.total += 1;

    resetKeyboardButtons();
    renderWord();
    renderHangman();
    renderScore();
    setText(els.questionResultText, "开始新题。");
    setText(els.uploadStatusText, "");

    const student = state.student;
    els.studentInfoText.textContent = "当前学生：" + student.name + "（" + student.studentId + "）";
    const meta = currentWordObj.category + " / " + displayDifficulty(currentWordObj.difficulty) + " / " + displaySourceText();
    els.wordMetaText.textContent = "词条信息：" + meta;
  }

  function renderWord() {
    const wordObj = state.game.currentWordObj;
    if (!wordObj) return;
    const lower = wordObj.word.toLowerCase();
    els.wordSlots.textContent = lower.split("").map((ch) => (state.game.guessed.has(ch) ? ch : "_")).join(" ");
    els.meaningText.textContent = state.showMeaning ? ("释义：" + (wordObj.meaning || "无")) : "释义已隐藏";
  }

  function handleGuess(letter) {
    if (state.game.questionEnded || !state.game.currentWordObj || state.game.guessed.has(letter)) return;
    state.game.guessed.add(letter);
    disableKey(letter);
    const lowerWord = state.game.currentWordObj.word.toLowerCase();
    if (!lowerWord.includes(letter)) {
      state.game.wrongGuesses += 1;
      renderHangman();
    }
    renderWord();
    evaluateQuestion();
  }

  function useHint() {
    if (state.game.questionEnded || !state.game.currentWordObj) return;
    const word = state.game.currentWordObj.word.toLowerCase();
    const hidden = word.split("").filter((ch) => !state.game.guessed.has(ch));
    if (!hidden.length) {
      setText(els.questionResultText, "当前题目已全部猜出。");
      return;
    }
    const letter = hidden[Math.floor(Math.random() * hidden.length)];
    state.game.hintsUsed += 1;
    handleGuess(letter);
    setText(els.questionResultText, "已提示字母：" + letter + "（本题扣分）", "var(--warn)");
  }

  function evaluateQuestion() {
    const wordObj = state.game.currentWordObj;
    const word = wordObj.word.toLowerCase();
    const allHit = word.split("").every((ch) => state.game.guessed.has(ch));
    const failed = state.game.wrongGuesses >= state.teacher.maxWrongGuesses;
    if (!allHit && !failed) return;

    state.game.questionEnded = true;
    const durationSeconds = Math.max(1, Math.round((Date.now() - state.game.startTime) / 1000));
    const isCorrect = allHit;
    const score = calculateQuestionScore(isCorrect, state.game.wrongGuesses, state.game.hintsUsed, durationSeconds);

    if (isCorrect) {
      state.session.correct += 1;
      setText(els.questionResultText, "答对了。", "var(--ok)");
    } else {
      state.session.failed += 1;
      setText(els.questionResultText, "答错了，答案是 " + wordObj.word.toLowerCase(), "var(--danger)");
    }
    state.session.totalScore += score;

    const record = {
      id: "q_" + Date.now() + "_" + Math.random().toString(16).slice(2, 8),
      timestamp: new Date().toISOString(),
      studentName: state.student.name,
      studentId: state.student.studentId,
      word: wordObj.word,
      category: wordObj.category || "General",
      difficulty: wordObj.difficulty || "medium",
      result: isCorrect ? "correct" : "wrong",
      wrongGuesses: state.game.wrongGuesses,
      hintsUsed: state.game.hintsUsed,
      durationSeconds,
      score,
      deviceType: detectDeviceType(),
      mode: state.student.mode,
      uploadStatus: "pending"
    };
    state.session.records.push(record);
    renderScore();
    uploadSingleRecord(record);
  }

  async function uploadSingleRecord(record) {
    setText(els.uploadStatusText, "成绩上传中...");
    const result = await scoreService.saveScore(record);
    if (result.ok) {
      record.uploadStatus = "uploaded";
      setText(els.uploadStatusText, "成绩已上传。", "var(--ok)");
    } else {
      const message = location.protocol === "file:" ? "当前为本地模式，成绩已暂存到本机。" : "上传失败，已暂存本地，稍后可补传。";
      setText(els.uploadStatusText, message, "var(--warn)");
    }
  }

  function finishSession() {
    if (!state.student) return;
    if (!state.session.records.length) {
      setText(els.questionResultText, "至少完成一题后再提交。", "var(--warn)");
      return;
    }

    const sessionRecord = {
      id: "s_" + Date.now(),
      timestamp: new Date().toISOString(),
      studentName: state.student.name,
      studentId: state.student.studentId,
      total: state.session.total,
      correct: state.session.correct,
      failed: state.session.failed,
      totalScore: state.session.totalScore,
      mode: state.student.mode,
      wordSource: state.wordSource
    };
    scoreService.saveGameRecord(sessionRecord);

    els.gameCard.classList.add("hidden");
    els.resultCard.classList.remove("hidden");
    setText(
      els.summaryText,
      "题数：" + state.session.total + "，正确：" + state.session.correct + "，失败：" + state.session.failed + "，总分：" + state.session.totalScore
    );
    const pending = scoreService.getPendingCount();
    setText(els.summaryUploadText, pending > 0 ? ("有 " + pending + " 条成绩待补传。") : "成绩已全部上传或保存。", pending > 0 ? "var(--warn)" : "var(--ok)");
    refreshLeaderboard();
  }

  function resetSession() {
    state.student = null;
    state.session = { total: 0, correct: 0, failed: 0, totalScore: 0, records: [] };
    els.gameCard.classList.add("hidden");
    els.resultCard.classList.add("hidden");
    els.startCard.classList.remove("hidden");
    setText(els.studentFormMsg, "已重置。");
  }

  function renderScore() {
    setText(
      els.scoreText,
      "总题数：" + state.session.total + " | 正确：" + state.session.correct + " | 失败：" + state.session.failed + " | 总分：" + state.session.totalScore
    );
  }

  function renderHangman() {
    const parts = Array.from(document.querySelectorAll("#hangmanSvg .part")).sort((a, b) => {
      return Number(a.dataset.step || 0) - Number(b.dataset.step || 0);
    });
    const totalParts = parts.length;
    const maxWrong = Math.max(1, normalizeMaxWrongGuesses(state.teacher.maxWrongGuesses));
    const progress = Math.min(maxWrong, Math.max(0, state.game.wrongGuesses));
    const visibleParts = progress <= 0 ? 0 : Math.min(totalParts, Math.ceil((progress / maxWrong) * totalParts));
    parts.forEach((part, index) => {
      part.classList.toggle("show", index < visibleParts);
    });
  }

  function resetKeyboardButtons() {
    els.keyboard.querySelectorAll(".key-btn").forEach((button) => { button.disabled = false; });
  }

  function disableKey(letter) {
    const button = els.keyboard.querySelector('[data-letter="' + letter + '"]');
    if (button) button.disabled = true;
  }

  async function importWordsFromFile() {
    const file = els.importFileInput.files && els.importFileInput.files[0];
    if (!file) {
      setText(els.teacherStatusText, "请先选择文件。", "var(--danger)");
      return;
    }
    setText(els.teacherStatusText, "正在解析文件...");
    try {
      const content = await file.text();
      const category = (els.categoryInput.value || "General").trim();
      const difficulty = els.difficultyInput.value;
      const lower = file.name.toLowerCase();
      const parsed = lower.endsWith(".json")
        ? parseJsonWords(content, category, difficulty)
        : lower.endsWith(".csv")
          ? parseCsvWords(content, category, difficulty)
          : parseTxtWords(content, category, difficulty);
      state.teacher.draftWords = dedupeWords(state.teacher.draftWords.concat(normalizeWords(parsed)));
      wordBankService.saveLocalWordList(state.teacher.draftWords);
      renderDraftTable();
      setText(els.teacherStatusText, "导入完成，本地草稿共 " + state.teacher.draftWords.length + " 条。导入不等于发布。", "var(--ok)");
      state.wordSource = "local_draft";
      state.words = state.teacher.draftWords.slice();
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "local_draft");
      updateWordBankBadge();
    } catch (error) {
      setText(els.teacherStatusText, "导入失败：" + error.message, "var(--danger)");
    }
  }

  function dedupeDraftWords() {
    const before = state.teacher.draftWords.length;
    state.teacher.draftWords = dedupeWords(normalizeWords(state.teacher.draftWords));
    wordBankService.saveLocalWordList(state.teacher.draftWords);
    renderDraftTable();
    setText(els.teacherStatusText, "清洗完成，移除 " + (before - state.teacher.draftWords.length) + " 条重复/非法数据。", "var(--ok)");
  }

  function clearDraftWords() {
    state.teacher.draftWords = [];
    wordBankService.saveLocalWordList([]);
    renderDraftTable();
    setText(els.teacherStatusText, "本地草稿已清空。", "var(--warn)");
    if (state.wordSource === "local_draft") {
      state.wordSource = "default";
      state.words = normalizeWords(DEFAULT_WORDS);
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "default");
      updateWordBankBadge();
    }
  }

  async function publishDraftWords() {
    if (!state.teacher.draftWords.length) {
      setText(els.teacherPublishText, "本地草稿为空，无法发布。", "var(--danger)");
      return;
    }
    const payload = {
      publishTime: new Date().toISOString(),
      teacherName: (els.teacherName.value || "未知老师").trim(),
      wordListName: (els.wordListName.value || "未命名词库").trim(),
      category: (els.categoryInput.value || "General").trim(),
      difficulty: els.difficultyInput.value,
      version: "v" + Date.now(),
      source: "teacher-import",
      words: state.teacher.draftWords.map((item) => ({
        word: item.word,
        meaning: item.meaning || "",
        category: item.category,
        difficulty: item.difficulty,
        status: "active"
      }))
    };

    setText(els.teacherPublishText, "发布中...");
    const result = await wordBankService.publishWordList(payload);
    if (result.ok) {
      state.wordSource = "shared";
      state.words = state.teacher.draftWords.slice();
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "shared");
      updateWordBankBadge();
      setText(els.teacherPublishText, "发布成功。学生端可读取公共词库。", "var(--ok)");
      await loadSharedWordsForTeacher();
      await loadWordListsForTeacher();
      return;
    }

    const offlineMsg = location.protocol === "file:" ? "当前为离线模式，词库尚未发布（已加入待补传队列）。" : "发布失败，已加入待补传队列。";
    setText(els.teacherPublishText, offlineMsg, "var(--warn)");
    updateWordBankBadge();
  }

  async function loadSharedWordsForTeacher() {
    setText(els.teacherStatusText, "正在读取公共词库...");
    const words = await wordBankService.loadSharedWordList();
    state.teacher.sharedWords = words;
    renderSharedTable();
    setText(els.teacherStatusText, words.length ? ("公共词库已读取，共 " + words.length + " 条。") : "未读取到远程词库，已回退本地缓存。", words.length ? "var(--ok)" : "var(--warn)");
  }

  async function loadWordListsForTeacher() {
    const result = await wordBankService.listWordLists();
    state.teacher.wordLists = result.wordLists || [];
    state.teacher.activeWordList = result.active || null;
    state.teacher.activeGameMode = normalizeGameMode(result.activeGameMode || state.teacher.activeGameMode);
    state.teacher.maxWrongGuesses = normalizeMaxWrongGuesses(result.maxWrongGuesses || state.teacher.maxWrongGuesses);

    if (els.wordListSelect) {
      els.wordListSelect.innerHTML = '<option value="">Select shared word list...</option>';
      state.teacher.wordLists.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.wordListName + "|" + item.version;
        option.textContent = item.wordListName + " (" + item.version + ", " + item.count + ")";
        if (state.teacher.activeWordList &&
          state.teacher.activeWordList.wordListName === item.wordListName &&
          state.teacher.activeWordList.version === item.version) {
          option.selected = true;
        }
        els.wordListSelect.appendChild(option);
      });
    }
    renderStudentWordListOptions();
    renderStudentModeControls();
    renderActiveWordListText();
    if (els.teacherGameMode) els.teacherGameMode.value = state.teacher.activeGameMode;
    if (els.teacherMaxWrongGuesses) els.teacherMaxWrongGuesses.value = String(state.teacher.maxWrongGuesses);
    renderActiveGameModeText();
    renderActiveMaxWrongGuessesText();
  }

  async function setActiveWordListForTeacher() {
    if (!els.wordListSelect || !els.wordListSelect.value) {
      setText(els.teacherStatusText, "Please select a shared word list first.", "var(--warn)");
      return;
    }
    const parts = els.wordListSelect.value.split("|");
    const wordListName = parts[0] || "";
    const version = parts[1] || "";
    if (!wordListName || !version) {
      setText(els.teacherStatusText, "Invalid word list selection.", "var(--danger)");
      return;
    }
    setText(els.teacherStatusText, "Updating active word list...", "var(--warn)");
    const result = await wordBankService.setActiveWordList(wordListName, version);
    if (result.ok) {
      state.teacher.activeWordList = result.active || { wordListName, version };
      renderActiveWordListText();
      setText(els.teacherStatusText, "Assigned. Students will use this list on next load.", "var(--ok)");
      const active = await wordBankService.loadActiveWordList();
      if (active.words.length) {
        state.words = active.words;
        state.wordSource = "shared";
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "shared");
        updateWordBankBadge();
      }
      return;
    }
    setText(els.teacherStatusText, "Assign failed: " + (result.error || "unknown error"), "var(--danger)");
  }

  function renderActiveWordListText() {
    if (!els.activeWordListText) return;
    if (!state.teacher.activeWordList) {
      setText(els.activeWordListText, "Active shared word list: not set.", "var(--warn)");
      return;
    }
    setText(
      els.activeWordListText,
      "Active shared word list: " + state.teacher.activeWordList.wordListName + " (" + state.teacher.activeWordList.version + ")",
      "var(--ok)"
    );
  }

  async function setActiveGameModeForTeacher() {
    const mode = normalizeGameMode(els.teacherGameMode && els.teacherGameMode.value);
    setText(els.teacherStatusText, "Updating active game mode...", "var(--warn)");
    const result = await wordBankService.setActiveGameMode(mode);
    if (!result.ok) {
      setText(els.teacherStatusText, "Mode update failed: " + (result.error || "unknown error"), "var(--danger)");
      return;
    }
    state.teacher.activeGameMode = normalizeGameMode(result.activeGameMode || mode);
    renderActiveGameModeText();
    renderStudentModeControls();
    setText(els.teacherStatusText, "学生模式已更新。", "var(--ok)");
  }

  async function setMaxWrongGuessesForTeacher() {
    const maxWrongGuesses = normalizeMaxWrongGuesses(els.teacherMaxWrongGuesses && els.teacherMaxWrongGuesses.value);
    setText(els.teacherStatusText, "Updating max wrong guesses...", "var(--warn)");
    const result = await wordBankService.setMaxWrongGuesses(maxWrongGuesses);
    if (!result.ok) {
      setText(els.teacherStatusText, "Max wrong guesses update failed: " + (result.error || "unknown error"), "var(--danger)");
      return;
    }
    state.teacher.maxWrongGuesses = normalizeMaxWrongGuesses(result.maxWrongGuesses || maxWrongGuesses);
    if (els.teacherMaxWrongGuesses) els.teacherMaxWrongGuesses.value = String(state.teacher.maxWrongGuesses);
    renderActiveMaxWrongGuessesText();
    setText(els.teacherStatusText, "最大尝试次数已更新。", "var(--ok)");
  }

  function renderActiveGameModeText() {
    if (!els.activeGameModeText) return;
    const mode = normalizeGameMode(state.teacher.activeGameMode);
    setText(els.activeGameModeText, "Active game mode: " + (mode === "formal" ? "正式模式" : "练习模式"), "var(--ok)");
  }

  async function resolveActiveGameMode() {
    const mode = await wordBankService.loadActiveGameMode();
    state.teacher.activeGameMode = normalizeGameMode(mode || state.teacher.activeGameMode);
    renderActiveGameModeText();
    renderStudentModeControls();
    return state.teacher.activeGameMode;
  }

  async function resolveMaxWrongGuesses() {
    const value = await wordBankService.loadMaxWrongGuesses();
    state.teacher.maxWrongGuesses = normalizeMaxWrongGuesses(value || state.teacher.maxWrongGuesses);
    renderActiveMaxWrongGuessesText();
    return state.teacher.maxWrongGuesses;
  }

  function renderActiveMaxWrongGuessesText() {
    if (!els.activeMaxWrongGuessesText) return;
    setText(els.activeMaxWrongGuessesText, "Active max wrong guesses: " + state.teacher.maxWrongGuesses, "var(--ok)");
  }

  function renderStudentModeControls() {
    if (!els.studentWordListWrap) return;
    const isPractice = normalizeGameMode(state.teacher.activeGameMode) === "practice";
    els.studentWordListWrap.classList.toggle("hidden", !isPractice);
    if (!els.studentModeHint) return;
    if (isPractice) {
      if (location.protocol === "file:") {
        setText(els.studentModeHint, "当前为本地模式：优先使用本地草稿词库，无草稿则使用默认词库。", "var(--warn)");
      } else {
        setText(els.studentModeHint, "当前为练习模式：有公共词库时必须先选择；若暂无公共词库则使用默认词库。", "var(--ok)");
      }
    } else {
      setText(els.studentModeHint, "当前为正式模式，词库由老师统一指定。", "var(--warn)");
    }
  }

  function renderStudentWordListOptions() {
    if (!els.studentWordListSelect) return;
    els.studentWordListSelect.innerHTML = '<option value="">请选择词库</option>';
    state.teacher.wordLists.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.wordListName + "|" + item.version;
      option.textContent = item.wordListName + " (" + item.version + ", " + item.count + ")";
      if (state.teacher.activeWordList &&
        state.teacher.activeWordList.wordListName === item.wordListName &&
        state.teacher.activeWordList.version === item.version) {
        option.selected = true;
      }
      els.studentWordListSelect.appendChild(option);
    });
  }

  async function applyStudentSelectedWordList() {
    if (location.protocol === "file:") {
      if (state.teacher.draftWords.length) {
        state.words = state.teacher.draftWords.slice();
        state.wordSource = "local_draft";
      } else if (!state.words.length) {
        state.words = normalizeWords(DEFAULT_WORDS);
        state.wordSource = "default";
      }
      updateWordBankBadge();
      return true;
    }

    if (!state.teacher.wordLists.length) {
      const latest = await wordBankService.listWordLists();
      state.teacher.wordLists = latest.wordLists || [];
      state.teacher.activeWordList = latest.active || state.teacher.activeWordList;
      renderStudentWordListOptions();
    }

    if (!state.teacher.wordLists.length) {
      state.words = normalizeWords(DEFAULT_WORDS);
      state.wordSource = "default";
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "default");
      setText(els.studentFormMsg, "当前没有可用的公共词库，已自动使用内置默认词库。", "var(--warn)");
      updateWordBankBadge();
      return true;
    }

    const selected = els.studentWordListSelect ? els.studentWordListSelect.value : "";
    if (!selected) {
      setText(els.studentFormMsg, "请先选择一个公共词库后再开始练习。", "var(--warn)");
      return false;
    }
    const parts = selected.split("|");
    const wordListName = parts[0] || "";
    const version = parts[1] || "";
    if (!wordListName || !version) {
      setText(els.studentFormMsg, "词库选择无效，请重新选择。", "var(--danger)");
      return false;
    }
    const chosen = await wordBankService.loadWordListBySelection(wordListName, version);
    if (!chosen.words.length) {
      setText(els.studentFormMsg, "所选词库为空或读取失败。", "var(--danger)");
      return false;
    }
    state.words = chosen.words;
    state.wordSource = "shared";
    state.teacher.activeWordList = chosen.active || { wordListName, version };
    updateWordBankBadge();
    return true;
  }

  function renderDraftTable() {
    const list = state.teacher.draftWords;
    setText(els.draftCountText, "本地草稿数量：" + list.length + "（仅当前设备）");
    els.draftTableBody.innerHTML = "";
    if (!list.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">暂无数据</td>';
      els.draftTableBody.appendChild(row);
      return;
    }
    list.forEach((item, index) => {
      const row = document.createElement("tr");
      row.innerHTML = "<td>" + escapeHtml(item.wordListName || "-") + "</td>" +
        "<td>" + escapeHtml(item.word) + "</td>" +
        "<td>" + escapeHtml(item.meaning || "") + "</td>" +
        "<td>" + escapeHtml(item.category || "") + "</td>" +
        "<td>" + escapeHtml(displayDifficulty(item.difficulty)) + "</td>" +
        '<td><button data-remove-index="' + index + '">删除</button></td>';
      els.draftTableBody.appendChild(row);
    });
    els.draftTableBody.querySelectorAll("button[data-remove-index]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-remove-index"));
        state.teacher.draftWords.splice(idx, 1);
        wordBankService.saveLocalWordList(state.teacher.draftWords);
        renderDraftTable();
        setText(els.teacherStatusText, "已删除词条。", "var(--ok)");
      });
    });
  }

  function renderSharedTable() {
    const list = state.teacher.sharedWords;
    setText(els.sharedCountText, "公共词库数量：" + list.length);
    els.sharedTableBody.innerHTML = "";
    if (!list.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">暂无数据</td>';
      els.sharedTableBody.appendChild(row);
      return;
    }
    list.slice(0, 300).forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = "<td>" + escapeHtml(item.wordListName || "-") + "</td>" +
        "<td>" + escapeHtml(item.word) + "</td>" +
        "<td>" + escapeHtml(item.meaning || "") + "</td>" +
        "<td>" + escapeHtml(item.category || "") + "</td>" +
        "<td>" + escapeHtml(displayDifficulty(item.difficulty)) + "</td>" +
        "<td>" + escapeHtml(item.version || "-") + "</td>";
      els.sharedTableBody.appendChild(row);
    });
  }

  function refreshNetworkBadge() {
    if (location.protocol === "file:") {
      els.networkBadge.textContent = "当前为 file:// 本地模式";
      els.networkBadge.style.color = "var(--warn)";
      return;
    }
    const online = navigator.onLine;
    els.networkBadge.textContent = online ? "网络：在线" : "网络：离线";
    els.networkBadge.style.color = online ? "var(--ok)" : "var(--danger)";
  }

  function updateWordBankBadge() {
    let text = state.wordSource === "shared" ? "当前词库：已发布公共词库" : state.wordSource === "local_draft" ? "当前词库：本地草稿" : "当前词库：内置默认词库";
    let color = state.wordSource === "shared" ? "var(--ok)" : state.wordSource === "local_draft" ? "var(--warn)" : "var(--muted)";
    if (location.protocol === "file:") {
      text += " | 当前为离线模式，词库尚未发布";
      color = "var(--warn)";
    }
    els.wordBankBadge.textContent = text;
    els.wordBankBadge.style.color = color;
  }

  async function refreshLeaderboard() {
    const rankList = await scoreService.loadLeaderboard();
    els.rankTableBody.innerHTML = "";
    if (!rankList.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">暂无数据</td>';
      els.rankTableBody.appendChild(row);
      return;
    }
    rankList.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = "<td>" + escapeHtml(item.studentName) + "</td>" +
        "<td>" + escapeHtml(item.studentId) + "</td>" +
        "<td>" + item.totalScore + "</td>" +
        "<td>" + item.correct + "</td>" +
        "<td>" + item.failed + "</td>" +
        "<td>" + new Date(item.lastPlayTime || item.timestamp).toLocaleString() + "</td>";
      els.rankTableBody.appendChild(row);
    });
  }

  async function handleOnline() {
    refreshNetworkBadge();
    const result = await scoreService.retryPending();
    if (result.success > 0 || result.failed > 0) {
      setText(els.uploadStatusText, "网络恢复：补传成功 " + result.success + " 条，失败 " + result.failed + " 条。");
    }
  }

  function exportScoresCsv() {
    const csv = scoreService.exportScoresCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hangman_scores_" + Date.now() + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function calculateQuestionScore(correct, wrongGuesses, hintsUsed, durationSeconds) {
    if (!correct) return 0;
    return Math.max(10, 100 - wrongGuesses * 10 - hintsUsed * 15 - Math.floor(durationSeconds / 2));
  }

  function normalizeWords(words) {
    if (!Array.isArray(words)) return [];
    return words.map(normalizeWord).filter(Boolean);
  }

  function normalizeWord(item) {
    if (!item) return null;
    const word = String(item.word || "").trim().toLowerCase();
    if (!/^[a-z][a-z'-]{1,20}$/.test(word)) return null;
    return {
      word,
      meaning: String(item.meaning || "").trim(),
      category: String(item.category || "General").trim(),
      difficulty: normalizeDifficulty(item.difficulty),
      version: item.version || ""
    };
  }

  function normalizeDifficulty(value) {
    const v = String(value || "medium").toLowerCase();
    return v === "easy" || v === "medium" || v === "hard" ? v : "medium";
  }

  function normalizeGameMode(value) {
    const mode = String(value || "practice").toLowerCase();
    return mode === "formal" ? "formal" : "practice";
  }

  function normalizeMaxWrongGuesses(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return 10;
    return Math.max(1, Math.min(10, Math.round(num)));
  }

  function dedupeWords(words) {
    const seen = new Set();
    const result = [];
    words.forEach((item) => {
      const key = item.word.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    });
    return result;
  }

  function parseTxtWords(content, category, difficulty) {
    return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(",");
      return { word: (parts[0] || "").trim(), meaning: (parts[1] || "").trim(), category, difficulty };
    });
  }

  function parseCsvWords(content, category, difficulty) {
    return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const cols = line.split(",").map((c) => c.trim());
      return { word: cols[0] || "", meaning: cols[1] || "", category: cols[2] || category, difficulty: cols[3] || difficulty };
    });
  }

  function parseJsonWords(content, category, difficulty) {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) return [];
    return data.map((item) => typeof item === "string"
      ? { word: item, meaning: "", category, difficulty }
      : { word: item.word || "", meaning: item.meaning || "", category: item.category || category, difficulty: item.difficulty || difficulty });
  }

  function displayDifficulty(v) {
    if (v === "easy") return "简单";
    if (v === "hard") return "困难";
    return "中等";
  }

  function displaySourceText() {
    if (state.wordSource === "shared") return "公共词库";
    if (state.wordSource === "local_draft") return "本地草稿";
    return "默认词库";
  }

  function detectDeviceType() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setText(element, text, color) {
    element.textContent = text || "";
    element.style.color = color || "";
  }

  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function readLocalJson(key, fallback) {
    return safeJsonParse(localStorage.getItem(key) || "", fallback);
  }

  function writeLocalJson(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function ApiClient(config) {
    this.config = config;
  }

  ApiClient.prototype.getEndpoint = function () {
    return this.config.apiMode === "proxy" ? this.config.proxyEndpoint : this.config.gasWebAppUrl;
  };

  ApiClient.prototype.post = async function (action, payload) {
    const endpoint = this.getEndpoint();
    if (!endpoint) throw new Error("未配置远程接口 URL");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload })
    });
    if (!response.ok) throw new Error("网络请求失败：" + response.status);
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "远程返回失败");
    return data;
  };

  function StorageAdapter() {}
  StorageAdapter.prototype.saveScore = async function () {};
  StorageAdapter.prototype.saveGameRecord = function () {};
  StorageAdapter.prototype.loadLeaderboard = async function () { return []; };
  StorageAdapter.prototype.loadLocalWordList = function () { return []; };
  StorageAdapter.prototype.saveLocalWordList = function () {};
  StorageAdapter.prototype.listWordLists = async function () { return { wordLists: [], active: null }; };
  StorageAdapter.prototype.setActiveWordList = async function () { return { ok: false }; };
  StorageAdapter.prototype.loadActiveWordList = async function () { return { words: [], active: null }; };
  StorageAdapter.prototype.loadWordListBySelection = async function () { return { words: [], active: null }; };
  StorageAdapter.prototype.loadActiveGameMode = async function () { return "practice"; };
  StorageAdapter.prototype.setActiveGameMode = async function () { return { ok: false }; };
  StorageAdapter.prototype.loadMaxWrongGuesses = async function () { return 10; };
  StorageAdapter.prototype.setMaxWrongGuesses = async function () { return { ok: false }; };
  StorageAdapter.prototype.loadSharedWordList = async function () { return []; };
  StorageAdapter.prototype.publishWordList = async function () { return { ok: false }; };
  StorageAdapter.prototype.retryPending = async function () { return { success: 0, failed: 0 }; };

  function LocalStorageFallback() {}
  LocalStorageFallback.prototype = Object.create(StorageAdapter.prototype);
  LocalStorageFallback.prototype.constructor = LocalStorageFallback;

  LocalStorageFallback.prototype.saveScore = function (record) {
    const list = readLocalJson(STORAGE_KEYS.SCORES, []);
    list.push(record);
    writeLocalJson(STORAGE_KEYS.SCORES, list);
    return { ok: true, local: true };
  };
  LocalStorageFallback.prototype.saveGameRecord = function (sessionRecord) {
    const list = readLocalJson(STORAGE_KEYS.GAME_RECORDS, []);
    list.push(sessionRecord);
    writeLocalJson(STORAGE_KEYS.GAME_RECORDS, list);
  };
  LocalStorageFallback.prototype.loadLeaderboard = function () {
    return readLocalJson(STORAGE_KEYS.GAME_RECORDS, []).sort((a, b) => b.totalScore - a.totalScore).slice(0, 100);
  };
  LocalStorageFallback.prototype.loadScores = function () {
    return readLocalJson(STORAGE_KEYS.SCORES, []);
  };
  LocalStorageFallback.prototype.saveLocalWordList = function (words) {
    writeLocalJson(STORAGE_KEYS.LOCAL_DRAFT_WORDS, words);
  };
  LocalStorageFallback.prototype.loadLocalWordList = function () {
    return normalizeWords(readLocalJson(STORAGE_KEYS.LOCAL_DRAFT_WORDS, []));
  };
  LocalStorageFallback.prototype.saveSharedWordListCache = function (words) {
    writeLocalJson(STORAGE_KEYS.SHARED_WORDS_CACHE, words);
  };
  LocalStorageFallback.prototype.loadSharedWordListCache = function () {
    return normalizeWords(readLocalJson(STORAGE_KEYS.SHARED_WORDS_CACHE, []));
  };
  LocalStorageFallback.prototype.loadPendingRemote = function () {
    return readLocalJson(STORAGE_KEYS.PENDING_REMOTE, []);
  };
  LocalStorageFallback.prototype.savePendingRemote = function (action, payload) {
    const list = this.loadPendingRemote();
    list.push({ id: "p_" + Date.now() + "_" + Math.random().toString(16).slice(2, 8), action, payload, createdAt: new Date().toISOString() });
    writeLocalJson(STORAGE_KEYS.PENDING_REMOTE, list);
  };
  LocalStorageFallback.prototype.removePendingRemote = function (ids) {
    writeLocalJson(STORAGE_KEYS.PENDING_REMOTE, this.loadPendingRemote().filter((item) => ids.indexOf(item.id) < 0));
  };

  function SheetStorage(apiClient, fallback) {
    this.apiClient = apiClient;
    this.fallback = fallback;
  }
  SheetStorage.prototype = Object.create(StorageAdapter.prototype);
  SheetStorage.prototype.constructor = SheetStorage;

  SheetStorage.prototype.saveScore = async function (record) {
    if (location.protocol === "file:") {
      this.fallback.saveScore(record);
      this.fallback.savePendingRemote("saveScore", record);
      return { ok: false, pending: true };
    }
    try {
      await this.apiClient.post("saveScore", record);
      this.fallback.saveScore(Object.assign({}, record, { uploadStatus: "uploaded" }));
      return { ok: true };
    } catch (error) {
      this.fallback.saveScore(record);
      this.fallback.savePendingRemote("saveScore", record);
      return { ok: false, pending: true, error: error.message };
    }
  };
  SheetStorage.prototype.saveGameRecord = function (sessionRecord) {
    this.fallback.saveGameRecord(sessionRecord);
  };
  SheetStorage.prototype.loadLeaderboard = async function () {
    if (location.protocol === "file:") return this.fallback.loadLeaderboard();
    try {
      const result = await this.apiClient.post("loadLeaderboard", { limit: 100 });
      const rankings = result.data && Array.isArray(result.data.rankings) ? result.data.rankings : [];
      return rankings;
    } catch (error) {
      return this.fallback.loadLeaderboard();
    }
  };
  SheetStorage.prototype.loadScores = function () {
    return this.fallback.loadScores();
  };
  SheetStorage.prototype.saveLocalWordList = function (words) {
    this.fallback.saveLocalWordList(words);
  };
  SheetStorage.prototype.loadLocalWordList = function () {
    return this.fallback.loadLocalWordList();
  };
  SheetStorage.prototype.listWordLists = async function () {
    if (location.protocol === "file:") return { wordLists: [], active: null };
    try {
      const result = await this.apiClient.post("listWordLists", {});
      return {
        wordLists: result.data && Array.isArray(result.data.wordLists) ? result.data.wordLists : [],
        active: result.data ? result.data.active || null : null,
        activeGameMode: result.data ? result.data.activeGameMode || "practice" : "practice",
        maxWrongGuesses: result.data ? result.data.maxWrongGuesses || CONFIG.maxWrongGuesses : CONFIG.maxWrongGuesses
      };
    } catch (error) {
      return { wordLists: [], active: null, activeGameMode: "practice", maxWrongGuesses: CONFIG.maxWrongGuesses };
    }
  };
  SheetStorage.prototype.setActiveWordList = async function (wordListName, version) {
    if (location.protocol === "file:") return { ok: false, error: "file mode" };
    try {
      const result = await this.apiClient.post("setActiveWordList", { wordListName, version });
      return { ok: true, active: result.data ? result.data.active || null : null };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  SheetStorage.prototype.loadActiveWordList = async function () {
    if (location.protocol === "file:") {
      return { words: this.fallback.loadSharedWordListCache(), active: null };
    }
    try {
      const result = await this.apiClient.post("loadActiveWordList", {});
      const words = normalizeWords(result.data && result.data.words ? result.data.words : []);
      const active = result.data ? result.data.active || null : null;
      if (words.length) this.fallback.saveSharedWordListCache(words);
      return { words, active };
    } catch (error) {
      return { words: this.fallback.loadSharedWordListCache(), active: null };
    }
  };
  SheetStorage.prototype.loadWordListBySelection = async function (wordListName, version) {
    if (location.protocol === "file:") {
      return { words: this.fallback.loadSharedWordListCache(), active: null };
    }
    try {
      const result = await this.apiClient.post("loadWordListBySelection", { wordListName, version });
      const words = normalizeWords(result.data && result.data.words ? result.data.words : []);
      const active = result.data ? result.data.active || null : null;
      if (words.length) this.fallback.saveSharedWordListCache(words);
      return { words, active };
    } catch (error) {
      return { words: this.fallback.loadSharedWordListCache(), active: null };
    }
  };
  SheetStorage.prototype.loadActiveGameMode = async function () {
    if (location.protocol === "file:") return "practice";
    try {
      const result = await this.apiClient.post("getActiveGameMode", {});
      return normalizeGameMode(result.data && result.data.activeGameMode ? result.data.activeGameMode : "practice");
    } catch (error) {
      return "practice";
    }
  };
  SheetStorage.prototype.setActiveGameMode = async function (mode) {
    if (location.protocol === "file:") return { ok: false, error: "file mode" };
    try {
      const result = await this.apiClient.post("setActiveGameMode", { mode: normalizeGameMode(mode) });
      return {
        ok: true,
        activeGameMode: normalizeGameMode(result.data && result.data.activeGameMode ? result.data.activeGameMode : mode)
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  SheetStorage.prototype.loadMaxWrongGuesses = async function () {
    if (location.protocol === "file:") return normalizeMaxWrongGuesses(CONFIG.maxWrongGuesses);
    try {
      const result = await this.apiClient.post("getMaxWrongGuesses", {});
      return normalizeMaxWrongGuesses(result.data && result.data.maxWrongGuesses ? result.data.maxWrongGuesses : CONFIG.maxWrongGuesses);
    } catch (error) {
      return normalizeMaxWrongGuesses(CONFIG.maxWrongGuesses);
    }
  };
  SheetStorage.prototype.setMaxWrongGuesses = async function (maxWrongGuesses) {
    if (location.protocol === "file:") return { ok: false, error: "file mode" };
    try {
      const value = normalizeMaxWrongGuesses(maxWrongGuesses);
      const result = await this.apiClient.post("setMaxWrongGuesses", { maxWrongGuesses: value });
      return {
        ok: true,
        maxWrongGuesses: normalizeMaxWrongGuesses(result.data && result.data.maxWrongGuesses ? result.data.maxWrongGuesses : value)
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  SheetStorage.prototype.loadSharedWordList = async function () {
    if (location.protocol === "file:") return this.fallback.loadSharedWordListCache();
    try {
      const result = await this.apiClient.post("loadSharedWordList", {});
      const words = normalizeWords(result.data && result.data.words ? result.data.words : []);
      if (words.length) this.fallback.saveSharedWordListCache(words);
      return words;
    } catch (error) {
      return this.fallback.loadSharedWordListCache();
    }
  };
  SheetStorage.prototype.publishWordList = async function (payload) {
    if (location.protocol === "file:") {
      this.fallback.savePendingRemote("publishWordList", payload);
      return { ok: false, pending: true };
    }
    try {
      await this.apiClient.post("publishWordList", payload);
      this.fallback.saveSharedWordListCache(payload.words || []);
      return { ok: true };
    } catch (error) {
      this.fallback.savePendingRemote("publishWordList", payload);
      return { ok: false, pending: true, error: error.message };
    }
  };
  SheetStorage.prototype.retryPending = async function () {
    const pending = this.fallback.loadPendingRemote();
    if (!pending.length || location.protocol === "file:") return { success: 0, failed: pending.length };
    let success = 0;
    let failed = 0;
    const doneIds = [];
    for (let i = 0; i < pending.length; i += 1) {
      const item = pending[i];
      try {
        await this.apiClient.post(item.action, item.payload);
        success += 1;
        doneIds.push(item.id);
      } catch (error) {
        failed += 1;
      }
    }
    if (doneIds.length) this.fallback.removePendingRemote(doneIds);
    return { success, failed };
  };

  function ScoreService(storageAdapter) {
    this.storage = storageAdapter;
  }
  ScoreService.prototype.saveScore = async function (record) {
    return this.storage.saveScore(record);
  };
  ScoreService.prototype.saveGameRecord = function (record) {
    this.storage.saveGameRecord(record);
  };
  ScoreService.prototype.retryPending = async function () {
    return this.storage.retryPending();
  };
  ScoreService.prototype.getPendingCount = function () {
    return localFallback.loadPendingRemote().length;
  };
  ScoreService.prototype.loadLeaderboard = async function () {
    return this.storage.loadLeaderboard();
  };
  ScoreService.prototype.exportScoresCsv = function () {
    const list = this.storage.loadScores();
    const headers = ["timestamp", "studentName", "studentId", "word", "category", "difficulty", "result", "wrongGuesses", "hintsUsed", "durationSeconds", "score", "deviceType", "mode", "uploadStatus"];
    const lines = [headers.join(",")];
    list.forEach((item) => lines.push(headers.map((h) => csvEscape(item[h])).join(",")));
    return lines.join("\n");
  };

  function WordBankService(storageAdapter) {
    this.storage = storageAdapter;
  }
  WordBankService.prototype.loadLocalWordList = function () {
    return this.storage.loadLocalWordList();
  };
  WordBankService.prototype.saveLocalWordList = function (words) {
    this.storage.saveLocalWordList(words);
  };
  WordBankService.prototype.publishWordList = async function (payload) {
    return this.storage.publishWordList(payload);
  };
  WordBankService.prototype.listWordLists = async function () {
    return this.storage.listWordLists();
  };
  WordBankService.prototype.setActiveWordList = async function (wordListName, version) {
    return this.storage.setActiveWordList(wordListName, version);
  };
  WordBankService.prototype.loadActiveWordList = async function () {
    return this.storage.loadActiveWordList();
  };
  WordBankService.prototype.loadWordListBySelection = async function (wordListName, version) {
    return this.storage.loadWordListBySelection(wordListName, version);
  };
  WordBankService.prototype.loadActiveGameMode = async function () {
    return this.storage.loadActiveGameMode();
  };
  WordBankService.prototype.setActiveGameMode = async function (mode) {
    return this.storage.setActiveGameMode(mode);
  };
  WordBankService.prototype.loadMaxWrongGuesses = async function () {
    return this.storage.loadMaxWrongGuesses();
  };
  WordBankService.prototype.setMaxWrongGuesses = async function (maxWrongGuesses) {
    return this.storage.setMaxWrongGuesses(maxWrongGuesses);
  };
  WordBankService.prototype.loadSharedWordList = async function () {
    return this.storage.loadSharedWordList();
  };

  function csvEscape(value) {
    const str = String(value == null ? "" : value);
    if (str.indexOf(",") >= 0 || str.indexOf('"') >= 0 || str.indexOf("\n") >= 0) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  setupServices();
  init();
})();
