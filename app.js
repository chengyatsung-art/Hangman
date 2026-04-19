(function () {
  "use strict";

  const STORAGE_KEYS = {
    LOCAL_DRAFT_WORDS: "hangman_local_draft_words_v1",
    SHARED_WORDS_CACHE: "hangman_shared_words_cache_v1",
    SCORES: "hangman_scores_v1",
    GAME_RECORDS: "hangman_game_records_v1",
    PENDING_REMOTE: "hangman_pending_remote_v1",
    ACTIVE_WORD_SOURCE: "hangman_active_word_source_v1",
    TEACHER_UNLOCKED: "hangman_teacher_unlocked_v1",
    ALLOW_WORD_REPEAT: "hangman_allow_word_repeat_v1",
    AUTO_FINISH_WHEN_EXHAUSTED: "hangman_auto_finish_when_exhausted_v1"
  };

  const CONFIG = Object.assign({
    proxyEndpoint: "/api/sheet-proxy",
    maxWrongGuesses: 10,
    teacherPassword: "cys88888888",
    allowWordRepeat: false,
    autoFinishWhenExhausted: false
  }, window.HANGMAN_CONFIG || {});

  const DEFAULT_SCORING_RULES = {
    correctBaseScore: 100,
    wrongGuessPenalty: 10,
    hintPenalty: 15,
    timePenaltySeconds: 2,
    minCorrectScore: 10,
    wrongAnswerScore: 0
  };
  const BUTTON_CLICK_LOCK_MS = 500;

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
    wordSource: "loading",
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
      records: [],
      remainingWordIndexes: []
    },
    teacher: {
      draftWords: [],
      draftOrigin: "manual",
      sharedWords: [],
      wordLists: [],
      randomDrawPlan: {},
      randomDrawSummary: [],
      draftEditor: { open: false, index: -1 },
      wordListMetaEditor: { open: false, originalWordListName: "", originalVersion: "" },
      activeWordList: null,
      activeGameMode: "practice",
      maxWrongGuesses: normalizeMaxWrongGuesses(CONFIG.maxWrongGuesses),
      allowWordRepeat: normalizeAllowWordRepeat(CONFIG.allowWordRepeat),
      autoFinishWhenExhausted: normalizeAutoFinishWhenExhausted(CONFIG.autoFinishWhenExhausted),
      scoringRules: normalizeScoringRules(DEFAULT_SCORING_RULES)
    }
  };

  const els = getElements();
  let localFallback;
  let apiClient;
  let storage;
  let scoreService;
  let wordBankService;
  let bootstrapWordsPromise = Promise.resolve();
  let teacherStatePromise = Promise.resolve();
  let leaderboardLoaded = false;

  function init() {
    bindGlobalButtonClickGuard();
    bindTabEvents();
    bindStudentEvents();
    bindTeacherEvents();
    bindRankEvents();
    buildKeyboard();
    restoreTeacherDraft();
    primeWordSourceFromCache();
    refreshNetworkBadge();
    updateWordBankBadge();
    bootstrapWordsPromise = Promise.resolve();
    refreshTeacherLockState();
    teacherStatePromise = loadWordListsForTeacher();
    bootstrapWordsPromise = teacherStatePromise;
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", refreshNetworkBadge);
  }

  function bindGlobalButtonClickGuard() {
    document.addEventListener("click", function (event) {
      const button = event.target && event.target.closest ? event.target.closest("button") : null;
      if (!button) return;
      if (button.disabled || button.classList.contains("click-locked")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const now = Date.now();
      const lockedUntil = Number(button.dataset.clickLockedUntil || 0);
      if (lockedUntil > now) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      button.dataset.clickLockedUntil = String(now + BUTTON_CLICK_LOCK_MS);
      button.classList.add("click-locked");
      button.setAttribute("aria-disabled", "true");
      window.setTimeout(function () {
        const currentLockedUntil = Number(button.dataset.clickLockedUntil || 0);
        if (currentLockedUntil <= Date.now()) {
          delete button.dataset.clickLockedUntil;
          button.classList.remove("click-locked");
          button.removeAttribute("aria-disabled");
        }
      }, BUTTON_CLICK_LOCK_MS + 50);
    }, true);
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
      studentSubmitBtn: document.getElementById("studentSubmitBtn"),
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
      generateRandomDraftBtn: document.getElementById("generateRandomDraftBtn"),
      clearRandomPlanBtn: document.getElementById("clearRandomPlanBtn"),
      loadSharedBtn: document.getElementById("loadSharedBtn"),
      randomWordListPlan: document.getElementById("randomWordListPlan"),
      randomDraftSummary: document.getElementById("randomDraftSummary"),
      wordListSelect: document.getElementById("wordListSelect"),
      refreshWordListsBtn: document.getElementById("refreshWordListsBtn"),
      setActiveWordListBtn: document.getElementById("setActiveWordListBtn"),
      editWordListMetaBtn: document.getElementById("editWordListMetaBtn"),
      deleteWordListBtn: document.getElementById("deleteWordListBtn"),
      wordListMetaEditorCard: document.getElementById("wordListMetaEditorCard"),
      metaEditorTeacherName: document.getElementById("metaEditorTeacherName"),
      metaEditorWordListName: document.getElementById("metaEditorWordListName"),
      metaEditorVersion: document.getElementById("metaEditorVersion"),
      metaEditorCategory: document.getElementById("metaEditorCategory"),
      metaEditorDifficulty: document.getElementById("metaEditorDifficulty"),
      saveWordListMetaBtn: document.getElementById("saveWordListMetaBtn"),
      cancelWordListMetaBtn: document.getElementById("cancelWordListMetaBtn"),
      activeWordListText: document.getElementById("activeWordListText"),
      teacherGameMode: document.getElementById("teacherGameMode"),
      setGameModeBtn: document.getElementById("setGameModeBtn"),
      activeGameModeText: document.getElementById("activeGameModeText"),
      teacherMaxWrongGuesses: document.getElementById("teacherMaxWrongGuesses"),
      setMaxWrongGuessesBtn: document.getElementById("setMaxWrongGuessesBtn"),
      activeMaxWrongGuessesText: document.getElementById("activeMaxWrongGuessesText"),
      setAllowWordRepeatBtn: document.getElementById("setAllowWordRepeatBtn"),
      activeAllowWordRepeatText: document.getElementById("activeAllowWordRepeatText"),
      setAutoFinishWhenExhaustedBtn: document.getElementById("setAutoFinishWhenExhaustedBtn"),
      activeAutoFinishWhenExhaustedText: document.getElementById("activeAutoFinishWhenExhaustedText"),
      teacherScoreCorrectBase: document.getElementById("teacherScoreCorrectBase"),
      teacherScoreWrongGuessPenalty: document.getElementById("teacherScoreWrongGuessPenalty"),
      teacherScoreHintPenalty: document.getElementById("teacherScoreHintPenalty"),
      teacherScoreTimePenaltySeconds: document.getElementById("teacherScoreTimePenaltySeconds"),
      teacherScoreMinCorrect: document.getElementById("teacherScoreMinCorrect"),
      teacherScoreWrongAnswer: document.getElementById("teacherScoreWrongAnswer"),
      saveScoringRulesBtn: document.getElementById("saveScoringRulesBtn"),
      resetScoringRulesBtn: document.getElementById("resetScoringRulesBtn"),
      activeScoringRulesText: document.getElementById("activeScoringRulesText"),
      scoringExampleFastText: document.getElementById("scoringExampleFastText"),
      scoringExampleChallengeText: document.getElementById("scoringExampleChallengeText"),
      scoringExampleWrongText: document.getElementById("scoringExampleWrongText"),
      scoringRuleExplainText: document.getElementById("scoringRuleExplainText"),
      teacherName: document.getElementById("teacherName"),
      wordListName: document.getElementById("wordListName"),
      versionInput: document.getElementById("versionInput"),
      categoryInput: document.getElementById("categoryInput"),
      difficultyInput: document.getElementById("difficultyInput"),
      teacherStatusText: document.getElementById("teacherStatusText"),
      teacherPublishText: document.getElementById("teacherPublishText"),
      draftCountText: document.getElementById("draftCountText"),
      addDraftWordBtn: document.getElementById("addDraftWordBtn"),
      draftEditorCard: document.getElementById("draftEditorCard"),
      draftEditorTitle: document.getElementById("draftEditorTitle"),
      draftEditorWordListName: document.getElementById("draftEditorWordListName"),
      draftEditorVersion: document.getElementById("draftEditorVersion"),
      draftEditorWord: document.getElementById("draftEditorWord"),
      draftEditorMeaning: document.getElementById("draftEditorMeaning"),
      draftEditorCategory: document.getElementById("draftEditorCategory"),
      draftEditorDifficulty: document.getElementById("draftEditorDifficulty"),
      saveDraftWordBtn: document.getElementById("saveDraftWordBtn"),
      cancelDraftEditBtn: document.getElementById("cancelDraftEditBtn"),
      draftTableBody: document.getElementById("draftTableBody"),
      sharedCountText: document.getElementById("sharedCountText"),
      sharedTableBody: document.getElementById("sharedTableBody"),
      refreshRankBtn: document.getElementById("refreshRankBtn"),
      rankStatusText: document.getElementById("rankStatusText"),
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
        if (button.dataset.tab === "rankTab") {
          refreshLeaderboard();
          leaderboardLoaded = true;
        }
      });
    });
  }

  function bindStudentEvents() {
    updateStudentSubmitState();
    if (els.studentWordListSelect) {
      els.studentWordListSelect.addEventListener("change", function () {
        updateStudentSubmitState();
      });
    }
    els.studentForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const submitButton = event.submitter || els.studentSubmitBtn || els.studentForm.querySelector('button[type="submit"]');
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
      if (submitButton) submitButton.disabled = true;
      setText(els.studentFormMsg, "正在准备游戏，请稍候...", "var(--warn)");
      try {
        await Promise.all([bootstrapWordsPromise, teacherStatePromise]);
        renderActiveGameModeText();
        renderActiveMaxWrongGuessesText();
        renderActiveAllowWordRepeatText();
        renderAutoFinishWhenExhaustedText();
        renderStudentModeControls();
        updateStudentSubmitState();

        const activeGameMode = normalizeGameMode(state.teacher.activeGameMode);
        if (activeGameMode === "practice") {
          const selected = await applyStudentSelectedWordList();
          if (!selected) return;
        }
        state.student = { name, studentId, mode: activeGameMode };
        state.session = { total: 0, correct: 0, failed: 0, totalScore: 0, records: [], remainingWordIndexes: [] };
        resetGameState();
        setText(els.studentFormMsg, "");
        els.startCard.classList.add("hidden");
        els.resultCard.classList.add("hidden");
        els.gameCard.classList.remove("hidden");
        nextQuestion();
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });

    els.toggleMeaningBtn.addEventListener("click", function () {
      state.showMeaning = !state.showMeaning;
      els.toggleMeaningBtn.textContent = "释义：" + (state.showMeaning ? "开" : "关");
      renderWord();
    });
    els.hintBtn.addEventListener("click", useHint);
    els.nextBtn.addEventListener("click", nextQuestion);
    els.resetBtn.addEventListener("click", resetSession);
    els.finishBtn.addEventListener("click", function () {
      finishSession();
    });
    els.restartBtn.addEventListener("click", function () {
      resetGameState();
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
    if (els.generateRandomDraftBtn) {
      els.generateRandomDraftBtn.addEventListener("click", generateRandomDraftWords);
    }
    if (els.clearRandomPlanBtn) {
      els.clearRandomPlanBtn.addEventListener("click", clearRandomDrawPlan);
    }
    els.loadSharedBtn.addEventListener("click", loadSharedWordsForTeacher);
    els.refreshWordListsBtn.addEventListener("click", refreshWordListsForTeacher);
    els.setActiveWordListBtn.addEventListener("click", setActiveWordListForTeacher);
    if (els.editWordListMetaBtn) {
      els.editWordListMetaBtn.addEventListener("click", openWordListMetaEditorForSelection);
    }
    if (els.deleteWordListBtn) {
      els.deleteWordListBtn.addEventListener("click", deleteSelectedWordListForTeacher);
    }
    els.setGameModeBtn.addEventListener("click", setActiveGameModeForTeacher);
    els.setMaxWrongGuessesBtn.addEventListener("click", setMaxWrongGuessesForTeacher);
    if (els.setAllowWordRepeatBtn) {
      els.setAllowWordRepeatBtn.addEventListener("click", setAllowWordRepeatForTeacher);
    }
    if (els.setAutoFinishWhenExhaustedBtn) {
      els.setAutoFinishWhenExhaustedBtn.addEventListener("click", setAutoFinishWhenExhaustedForTeacher);
    }
    if (els.saveScoringRulesBtn) {
      els.saveScoringRulesBtn.addEventListener("click", saveScoringRulesForTeacher);
    }
    if (els.resetScoringRulesBtn) {
      els.resetScoringRulesBtn.addEventListener("click", resetScoringRulesEditorForTeacher);
    }
    [
      els.teacherScoreCorrectBase,
      els.teacherScoreWrongGuessPenalty,
      els.teacherScoreHintPenalty,
      els.teacherScoreTimePenaltySeconds,
      els.teacherScoreMinCorrect,
      els.teacherScoreWrongAnswer
    ].filter(Boolean).forEach((input) => {
      input.addEventListener("input", renderScoringRulesPreviewFromEditor);
    });
    if (els.addDraftWordBtn) {
      els.addDraftWordBtn.addEventListener("click", addDraftWordManually);
    }
    if (els.saveDraftWordBtn) {
      els.saveDraftWordBtn.addEventListener("click", saveDraftEditor);
    }
    if (els.cancelDraftEditBtn) {
      els.cancelDraftEditBtn.addEventListener("click", cancelDraftEditor);
    }
    if (els.saveWordListMetaBtn) {
      els.saveWordListMetaBtn.addEventListener("click", saveWordListMetaEditor);
    }
    if (els.cancelWordListMetaBtn) {
      els.cancelWordListMetaBtn.addEventListener("click", cancelWordListMetaEditor);
    }
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
    const savedSource = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE);
    if (savedSource === "shared") {
      const cachedSharedWords = localFallback.loadSharedWordListCache();
      if (cachedSharedWords.length) {
        state.words = cachedSharedWords.slice();
        state.wordSource = "shared";
        updateWordBankBadge();
      }
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

    if (state.teacher.draftWords.length) {
      state.words = state.teacher.draftWords.slice();
      state.wordSource = "local_draft";
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "local_draft");
      updateWordBankBadge();
      return;
    }

    state.words = normalizeWords(DEFAULT_WORDS);
    state.wordSource = "default";
    updateWordBankBadge();
  }

  function primeWordSourceFromCache() {
    const savedSource = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE);
    if (savedSource === "shared") {
      const cachedSharedWords = localFallback ? localFallback.loadSharedWordListCache() : [];
      if (cachedSharedWords.length) {
        state.wordSource = "shared";
        state.words = cachedSharedWords.slice();
        return;
      }
      state.wordSource = "loading";
      return;
    }
    if (location.protocol === "file:" && state.teacher.draftWords.length) {
      state.wordSource = "local_draft";
      state.words = state.teacher.draftWords.slice();
      return;
    }
    state.wordSource = "loading";
  }

  function restoreTeacherDraft() {
    const draft = wordBankService.loadLocalWordList();
    state.teacher.draftWords = draft;
    renderDraftTable();
    renderRandomDrawSummary();
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
      setText(els.questionResultText, "Word bank is empty. Please import or publish a word list first.", "var(--danger)");
      return;
    }

    if (state.game.currentWordObj && !state.game.questionEnded) {
      const shouldSkip = window.confirm("当前题目还没有完成。继续下一题会把本题判错，是否继续？");
      if (!shouldSkip) {
        setText(els.questionResultText, "已取消跳过当前题目。", "var(--warn)");
        return;
      }
      state.game.wrongGuesses = normalizeMaxWrongGuesses(state.teacher.maxWrongGuesses);
      evaluateQuestion();
    }

    const currentWordObj = pickNextWord();
    if (!currentWordObj) {
      if (!state.teacher.allowWordRepeat && state.teacher.autoFinishWhenExhausted && state.session.records.length) {
        finishSession("所有题目已完成，系统已自动结束本局。");
      } else {
        setText(els.questionResultText, "没有更多题目了，请检查词库设置。", "var(--danger)");
      }
      return;
    }

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
    setText(els.questionResultText, "新一题开始了。");
    setText(els.uploadStatusText, "");

    const student = state.student;
    els.studentInfoText.textContent = "学生：" + student.name + " / " + student.studentId;
    const meta = currentWordObj.category + " / " + displayDifficulty(currentWordObj.difficulty) + " / " + displaySourceText();
    els.wordMetaText.textContent = "单词信息：" + meta;
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
    const score = calculateQuestionScore(
      isCorrect,
      state.game.wrongGuesses,
      state.game.hintsUsed,
      durationSeconds,
      state.teacher.scoringRules
    );

    if (isCorrect) {
      state.session.correct += 1;
      setText(els.questionResultText, "回答正确。", "var(--ok)");
    } else {
      state.session.failed += 1;
      setText(els.questionResultText, "回答错误。答案是：" + wordObj.word.toLowerCase(), "var(--danger)");
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
    setText(els.uploadStatusText, "当前题目已保存，整局结束后统一提交。", "var(--ok)");

    if (shouldAutoFinishAfterQuestion()) {
      finishSession("所有题目已完成，系统已自动结束本局。");
    }
  }

  async function uploadSessionRecords(records) {
    if (!records.length) return { success: 0, failed: 0 };
    const batchResult = await scoreService.saveScores(records);
    if (batchResult && batchResult.ok) {
      records.forEach((record) => {
        record.uploadStatus = "uploaded";
      });
      return { success: records.length, failed: 0 };
    }

    let success = 0;
    let failed = 0;
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const result = await scoreService.saveScore(record);
      if (result.ok) {
        record.uploadStatus = "uploaded";
        success += 1;
      } else {
        record.uploadStatus = "pending";
        failed += 1;
      }
    }
    return { success, failed };
  }

  async function finishSession(reasonText) {
    if (!state.student) return;
    if (!state.session.records.length) {
      setText(els.questionResultText, "至少完成一题后才能结束本局。", "var(--warn)");
      return;
    }

    const finalReasonText = typeof reasonText === "string" ? reasonText : "";
    setText(els.uploadStatusText, "正在统一提交本局成绩...", "var(--warn)");
    const uploadResult = await uploadSessionRecords(state.session.records);

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
      "Total: " + state.session.total + " | Correct: " + state.session.correct + " | Failed: " + state.session.failed + " | Score: " + state.session.totalScore
    );
    const pending = scoreService.getPendingCount();
    const uploadSummary = "已上传：" + uploadResult.success + " | 待补传：" + uploadResult.failed;
    const uploadText = pending > 0 ? (uploadSummary + " | 待补传总数：" + pending) : uploadSummary;
    setText(
      els.summaryUploadText,
      finalReasonText ? (finalReasonText + " " + uploadText) : uploadText,
      pending > 0 ? "var(--warn)" : "var(--ok)"
    );
    refreshLeaderboard();
  }

  function resetGameState() {
    state.game = {
      currentWordObj: null,
      guessed: new Set(),
      wrongGuesses: 0,
      hintsUsed: 0,
      startTime: 0,
      questionEnded: false
    };
    resetKeyboardButtons();
    renderHangman();
    setText(els.wordSlots, "");
    setText(els.meaningText, "");
    setText(els.wordMetaText, "");
    setText(els.studentInfoText, "");
    setText(els.questionResultText, "");
    setText(els.uploadStatusText, "");
    renderScore();
  }

  function resetSession() {
    state.student = null;
    state.session = { total: 0, correct: 0, failed: 0, totalScore: 0, records: [], remainingWordIndexes: [] };
    resetGameState();
    els.gameCard.classList.add("hidden");
    els.resultCard.classList.add("hidden");
    els.startCard.classList.remove("hidden");
    setText(els.studentFormMsg, "已重置。");
    updateStudentSubmitState();
  }

  function renderScore() {
    setText(
      els.scoreText,
      "总题数：" + state.session.total + " | 正确：" + state.session.correct + " | 失败：" + state.session.failed + " | 总分：" + state.session.totalScore
    );
  }

  function renderHangman() {
    const parts = Array.from(document.querySelectorAll("#hangmanSvg .part"));
    const totalSteps = parts.reduce((max, part) => Math.max(max, Number(part.dataset.step || 0)), 0);
    const maxWrong = Math.max(1, normalizeMaxWrongGuesses(state.teacher.maxWrongGuesses));
    const progress = Math.min(maxWrong, Math.max(0, state.game.wrongGuesses));
    const visibleStep = progress <= 0 ? 0 : Math.min(totalSteps, Math.ceil((progress / maxWrong) * totalSteps));
    parts.forEach((part) => {
      const step = Number(part.dataset.step || 0);
      part.classList.toggle("show", step <= visibleStep);
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
      const wordListName = (els.wordListName.value || "未命名词库").trim();
      const category = (els.categoryInput.value || "General").trim();
      const difficulty = els.difficultyInput.value;
      const lower = file.name.toLowerCase();
      const parsed = lower.endsWith(".json")
        ? parseJsonWords(content, wordListName, category, difficulty)
        : lower.endsWith(".csv")
          ? parseCsvWords(content, wordListName, category, difficulty)
          : parseTxtWords(content, wordListName, category, difficulty);
      state.teacher.draftWords = dedupeWords(state.teacher.draftWords.concat(normalizeWords(parsed)));
      state.teacher.draftOrigin = "import";
      wordBankService.saveLocalWordList(state.teacher.draftWords);
      cancelDraftEditor();
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
    syncLocalDraftPreviewIfActive();
    cancelDraftEditor();
    renderDraftTable();
    setText(els.teacherStatusText, "清洗完成，移除 " + (before - state.teacher.draftWords.length) + " 条重复/非法数据。", "var(--ok)");
  }

  function clearDraftWords() {
    state.teacher.draftWords = [];
    state.teacher.draftOrigin = "manual";
    wordBankService.saveLocalWordList([]);
    cancelDraftEditor();
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
      version: (els.versionInput && els.versionInput.value ? els.versionInput.value : "").trim() || ("v" + Date.now()),
      source: "teacher-import",
      words: state.teacher.draftWords.map((item) => ({
        word: item.word,
        meaning: item.meaning || "",
        category: item.category,
        difficulty: item.difficulty,
        status: "active"
      }))
    };
    const existingWordList = findExistingWordList(payload.wordListName, payload.version);
    if (existingWordList) {
      const overwriteRiskText = state.teacher.draftOrigin === "random"
        ? "当前草稿来自随机组卷。继续发布会覆盖原词库，不会自动新建。"
        : "继续发布会覆盖原词库。";
      const shouldOverwrite = window.confirm(
        "在线词库 “" + payload.wordListName + " (" + payload.version + ")” 已存在。\n\n" +
        overwriteRiskText + " 如果你想新建词库，请先修改词库名称或版本。\n\n" +
        "是否仍要覆盖原词库？"
      );
      if (!shouldOverwrite) {
        setText(els.teacherPublishText, "已取消发布。请先修改词库名称或版本，再重新发布。", "var(--warn)");
        return;
      }
    }
    const publishedKey = getWordListKey(payload.wordListName, payload.version);

    setText(els.teacherPublishText, "发布中...");
    const result = await wordBankService.publishWordList(payload);
    if (result.ok) {
      state.wordSource = "shared";
      state.words = state.teacher.draftWords.slice();
      state.teacher.draftOrigin = "manual";
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "shared");
      updateWordBankBadge();
      setText(
        els.teacherPublishText,
        "发布成功：" + payload.wordListName + " (" + payload.version + ")。学生端可读取在线词库。",
        "var(--ok)"
      );
      await loadSharedWordsForTeacher();
      await loadWordListsForTeacher(publishedKey);
      return;
    }

    const offlineMsg = location.protocol === "file:" ? "当前为离线模式，词库尚未发布（已加入待补传队列）。" : "发布失败，已加入待补传队列。";
    setText(els.teacherPublishText, offlineMsg, "var(--warn)");
    updateWordBankBadge();
  }

  async function loadSharedWordsForTeacher() {
    setText(els.teacherStatusText, "正在读取在线词库...");
    const words = await wordBankService.loadSharedWordList();
    state.teacher.sharedWords = words;
    renderSharedTable();
    setText(els.teacherStatusText, words.length ? ("在线词库已读取，共 " + words.length + " 条。") : "未读取到远程词库，已回退本地缓存。", words.length ? "var(--ok)" : "var(--warn)");
  }

  function getPreferredWordListSelection(wordLists, explicitKey, activeWordList) {
    const availableKeys = Array.isArray(wordLists)
      ? wordLists.map((item) => getWordListKey(item.wordListName, item.version))
      : [];
    const preferredKey = typeof explicitKey === "string"
      ? explicitKey
      : (els.wordListSelect ? String(els.wordListSelect.value || "") : "");

    if (preferredKey && availableKeys.indexOf(preferredKey) >= 0) {
      return preferredKey;
    }

    if (activeWordList) {
      const activeKey = getWordListKey(activeWordList.wordListName, activeWordList.version);
      if (availableKeys.indexOf(activeKey) >= 0) {
        return activeKey;
      }
    }

    return "";
  }

  async function loadWordListsForTeacher(preferredSelectionKey) {
    const result = await wordBankService.loadBootstrapData();
    state.teacher.wordLists = result.wordLists || [];
    state.teacher.activeWordList = result.active || null;
    state.teacher.activeGameMode = normalizeGameMode(result.activeGameMode || state.teacher.activeGameMode);
    state.teacher.maxWrongGuesses = normalizeMaxWrongGuesses(result.maxWrongGuesses || state.teacher.maxWrongGuesses);
    if (typeof result.allowWordRepeat !== "undefined") {
      state.teacher.allowWordRepeat = normalizeAllowWordRepeat(result.allowWordRepeat);
    } else {
      state.teacher.allowWordRepeat = await wordBankService.loadAllowWordRepeat();
    }
    if (typeof result.autoFinishWhenExhausted !== "undefined") {
      state.teacher.autoFinishWhenExhausted = normalizeAutoFinishWhenExhausted(result.autoFinishWhenExhausted);
    } else {
      state.teacher.autoFinishWhenExhausted = await wordBankService.loadAutoFinishWhenExhausted();
    }
    if (typeof result.scoringRules !== "undefined") {
      state.teacher.scoringRules = normalizeScoringRules(result.scoringRules);
    } else {
      state.teacher.scoringRules = normalizeScoringRules(await wordBankService.loadScoringRules());
    }

    const activeWords = normalizeWords(result.activeWords || []);
    if (activeWords.length) {
      state.words = activeWords;
      state.wordSource = "shared";
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "shared");
      localFallback.saveSharedWordListCache(activeWords);
    } else if (!state.words.length && !state.teacher.draftWords.length) {
      state.words = normalizeWords(DEFAULT_WORDS);
      state.wordSource = "default";
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "default");
    }
    updateWordBankBadge();

    if (els.wordListSelect) {
      els.wordListSelect.innerHTML = '<option value="">请选择在线词库...</option>';
      state.teacher.wordLists.forEach((item) => {
        const option = document.createElement("option");
        option.value = getWordListKey(item.wordListName, item.version);
        option.textContent = item.wordListName + " (" + item.version + ", " + item.count + ")";
        els.wordListSelect.appendChild(option);
      });
      els.wordListSelect.value = getPreferredWordListSelection(
        state.teacher.wordLists,
        preferredSelectionKey,
        state.teacher.activeWordList
      );
    }
    renderRandomDrawPlanner();
    renderRandomDrawSummary();
    renderStudentWordListOptions();
    renderStudentModeControls();
    updateStudentSubmitState();
    renderActiveWordListText();
    if (els.teacherGameMode) els.teacherGameMode.value = state.teacher.activeGameMode;
    if (els.teacherMaxWrongGuesses) els.teacherMaxWrongGuesses.value = String(state.teacher.maxWrongGuesses);
    renderActiveGameModeText();
    renderActiveMaxWrongGuessesText();
    renderActiveAllowWordRepeatText();
    renderAutoFinishWhenExhaustedText();
    setScoringRulesEditorValues(state.teacher.scoringRules);
    renderActiveScoringRulesText();
  }

  async function refreshWordListsForTeacher() {
    const currentSelectionKey = els.wordListSelect ? String(els.wordListSelect.value || "") : "";
    await loadWordListsForTeacher(currentSelectionKey);
  }

    async function setActiveWordListForTeacher() {
    if (!els.wordListSelect || !els.wordListSelect.value) {
      setText(els.teacherStatusText, "请先选择一个在线词库。", "var(--warn)");
      return;
    }
    const parts = els.wordListSelect.value.split("|");
    const wordListName = parts[0] || "";
    const version = parts[1] || "";
    if (!wordListName || !version) {
      setText(els.teacherStatusText, "在线词库选择无效。", "var(--danger)");
      return;
    }
    setText(els.teacherStatusText, "正在更新当前词库...", "var(--warn)");
    const result = await wordBankService.setActiveWordList(wordListName, version);
    if (result.ok) {
      state.teacher.activeWordList = result.active || { wordListName, version };
      renderActiveWordListText();
      setText(els.teacherStatusText, "已分配在线词库给学生，学生下次进入时将使用该版本。", "var(--ok)");
      const active = await wordBankService.loadActiveWordList();
      if (active.words.length) {
        state.words = active.words;
        state.wordSource = "shared";
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "shared");
        updateWordBankBadge();
      }
      return;
    }
    setText(els.teacherStatusText, "分配词库失败：" + (result.error || "未知错误"), "var(--danger)");
  }

  async function deleteSelectedWordListForTeacher() {
    if (!els.wordListSelect || !els.wordListSelect.value) {
      setText(els.teacherStatusText, "请先选择一个在线词库。", "var(--warn)");
      return;
    }
    const parts = els.wordListSelect.value.split("|");
    const wordListName = parts[0] || "";
    const version = parts[1] || "";
    if (!wordListName || !version) {
      setText(els.teacherStatusText, "词库选择无效。", "var(--danger)");
      return;
    }

    const confirmed = window.confirm(
      "确认删除在线词库 “" + wordListName + " (" + version + ")” 吗？删除后学生端将无法再使用这个版本。"
    );
    if (!confirmed) {
      setText(els.teacherStatusText, "已取消删除。", "var(--warn)");
      return;
    }

    if (els.deleteWordListBtn) els.deleteWordListBtn.disabled = true;
    setText(els.teacherStatusText, "正在删除在线词库...", "var(--warn)");
    try {
      const result = await wordBankService.deleteWordList(wordListName, version);
      if (!result.ok) {
        setText(els.teacherStatusText, "删除失败：" + (result.error || "未知错误"), "var(--danger)");
        return;
      }

      cancelWordListMetaEditor();
      state.teacher.activeWordList = result.active || null;
      state.teacher.sharedWords = [];
      await loadWordListsForTeacher();
      await loadSharedWordsForTeacher();

      const active = await wordBankService.loadActiveWordList();
      if (active.words.length) {
        state.words = active.words;
        state.wordSource = "shared";
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "shared");
      } else if (state.teacher.draftWords.length) {
        state.words = state.teacher.draftWords.slice();
        state.wordSource = "local_draft";
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "local_draft");
      } else {
        state.words = normalizeWords(DEFAULT_WORDS);
        state.wordSource = "default";
        localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "default");
      }
      updateWordBankBadge();

      setText(els.teacherStatusText, "已删除在线词库：" + wordListName + " (" + version + ")，列表和学生端已同步刷新。", "var(--ok)");
    } finally {
      if (els.deleteWordListBtn) els.deleteWordListBtn.disabled = false;
    }
  }

  async function openWordListMetaEditorForSelection() {
    if (!els.wordListSelect || !els.wordListSelect.value) {
      setText(els.teacherStatusText, "请先选择一个在线词库。", "var(--warn)");
      return;
    }
    const parts = els.wordListSelect.value.split("|");
    const wordListName = parts[0] || "";
    const version = parts[1] || "";
    if (!wordListName || !version) {
      setText(els.teacherStatusText, "词库选择无效。", "var(--danger)");
      return;
    }

    setText(els.teacherStatusText, "正在读取词库基本信息...", "var(--warn)");
    const chosen = await wordBankService.loadWordListBySelection(wordListName, version);
    if (!chosen.words.length) {
      setText(els.teacherStatusText, "读取词库失败或词库为空。", "var(--danger)");
      return;
    }

    const first = chosen.words[0];
    state.teacher.wordListMetaEditor = {
      open: true,
      originalWordListName: wordListName,
      originalVersion: version
    };
    if (els.metaEditorTeacherName) els.metaEditorTeacherName.value = String(first.teacherName || "");
    if (els.metaEditorWordListName) els.metaEditorWordListName.value = wordListName;
    if (els.metaEditorVersion) els.metaEditorVersion.value = version;
    if (els.metaEditorCategory) els.metaEditorCategory.value = String(first.category || "");
    if (els.metaEditorDifficulty) els.metaEditorDifficulty.value = normalizeDifficulty(first.difficulty || "medium");
    if (els.wordListMetaEditorCard) els.wordListMetaEditorCard.classList.remove("hidden");
    setText(els.teacherStatusText, "已载入在线词库基本信息，可编辑后保存。", "var(--ok)");
  }

  function cancelWordListMetaEditor() {
    state.teacher.wordListMetaEditor = { open: false, originalWordListName: "", originalVersion: "" };
    if (els.wordListMetaEditorCard) els.wordListMetaEditorCard.classList.add("hidden");
  }

  async function saveWordListMetaEditor() {
    const editorState = state.teacher.wordListMetaEditor || {};
    if (!editorState.open || !editorState.originalWordListName || !editorState.originalVersion) {
      setText(els.teacherStatusText, "当前没有正在编辑的在线词库。", "var(--warn)");
      return;
    }

    const payload = {
      originalWordListName: editorState.originalWordListName,
      originalVersion: editorState.originalVersion,
      teacherName: els.metaEditorTeacherName ? els.metaEditorTeacherName.value : "",
      wordListName: els.metaEditorWordListName ? els.metaEditorWordListName.value : "",
      version: els.metaEditorVersion ? els.metaEditorVersion.value : "",
      category: els.metaEditorCategory ? els.metaEditorCategory.value : "",
      difficulty: els.metaEditorDifficulty ? els.metaEditorDifficulty.value : "medium"
    };

    if (!String(payload.wordListName || "").trim() || !String(payload.version || "").trim()) {
      setText(els.teacherStatusText, "词库名称和版本不能为空。", "var(--danger)");
      return;
    }

    if (els.saveWordListMetaBtn) els.saveWordListMetaBtn.disabled = true;
    setText(els.teacherStatusText, "正在保存词库基本信息...", "var(--warn)");
    try {
      const result = await wordBankService.updateWordListMeta(payload);
      if (!result.ok) {
        setText(els.teacherStatusText, "保存失败：" + formatWordListMetaError(result.error), "var(--danger)");
        return;
      }

      const updated = result.updated || {
        wordListName: String(payload.wordListName || "").trim(),
        version: String(payload.version || "").trim()
      };
      state.teacher.activeWordList = result.active || state.teacher.activeWordList;
      cancelWordListMetaEditor();
      await loadWordListsForTeacher(getWordListKey(updated.wordListName, updated.version));
      await loadSharedWordsForTeacher();
      setText(
        els.teacherStatusText,
        "在线词库基本信息已更新为：" + updated.wordListName + " (" + updated.version + ")",
        "var(--ok)"
      );
    } finally {
      if (els.saveWordListMetaBtn) els.saveWordListMetaBtn.disabled = false;
    }
  }

  function renderActiveWordListText() {
    if (!els.activeWordListText) return;
    if (!state.teacher.activeWordList) {
      setText(els.activeWordListText, "当前在线词库：未设置。", "var(--warn)");
      return;
    }
    setText(
      els.activeWordListText,
      "当前在线词库：" + state.teacher.activeWordList.wordListName + " (" + state.teacher.activeWordList.version + ")",
      "var(--ok)"
    );
  }

  async function setActiveGameModeForTeacher() {
    const mode = normalizeGameMode(els.teacherGameMode && els.teacherGameMode.value);
    setText(els.teacherStatusText, "正在更新学生游戏模式...", "var(--warn)");
    const result = await wordBankService.setActiveGameMode(mode);
    if (!result.ok) {
      setText(els.teacherStatusText, "学生游戏模式更新失败：" + (result.error || "未知错误"), "var(--danger)");
      return;
    }
    state.teacher.activeGameMode = normalizeGameMode(result.activeGameMode || mode);
    renderActiveGameModeText();
    renderStudentModeControls();
    setText(els.teacherStatusText, "学生模式已更新。", "var(--ok)");
  }

  async function setMaxWrongGuessesForTeacher() {
    const maxWrongGuesses = normalizeMaxWrongGuesses(els.teacherMaxWrongGuesses && els.teacherMaxWrongGuesses.value);
    setText(els.teacherStatusText, "正在更新最大尝试次数...", "var(--warn)");
    const result = await wordBankService.setMaxWrongGuesses(maxWrongGuesses);
    if (!result.ok) {
      setText(els.teacherStatusText, "最大尝试次数更新失败：" + (result.error || "未知错误"), "var(--danger)");
      return;
    }
    state.teacher.maxWrongGuesses = normalizeMaxWrongGuesses(result.maxWrongGuesses || maxWrongGuesses);
    if (els.teacherMaxWrongGuesses) els.teacherMaxWrongGuesses.value = String(state.teacher.maxWrongGuesses);
    renderActiveMaxWrongGuessesText();
    setText(els.teacherStatusText, "最大尝试次数已更新。", "var(--ok)");
  }

  async function setAllowWordRepeatForTeacher() {
    const nextValue = !state.teacher.allowWordRepeat;
    setText(els.teacherStatusText, "正在更新重复出词设置...", "var(--warn)");
    const result = await wordBankService.setAllowWordRepeat(nextValue);
    if (!result.ok) {
      setText(els.teacherStatusText, "重复出词设置更新失败：" + (result.error || "未知错误"), "var(--danger)");
      return;
    }
    state.teacher.allowWordRepeat = normalizeAllowWordRepeat(result.allowWordRepeat);
    renderActiveAllowWordRepeatText();
    renderAutoFinishWhenExhaustedText();
    if (result.remoteSynced === false) {
      setText(els.teacherStatusText, "重复出词设置已在本地更新，远程同步暂不可用。", "var(--warn)");
      return;
    }
    setText(els.teacherStatusText, "重复出词设置已更新。", "var(--ok)");
  }

  async function setAutoFinishWhenExhaustedForTeacher() {
    const nextValue = !state.teacher.autoFinishWhenExhausted;
    setText(els.teacherStatusText, "正在更新自动结束设置...", "var(--warn)");
    const result = await wordBankService.setAutoFinishWhenExhausted(nextValue);
    if (!result.ok) {
      setText(els.teacherStatusText, "自动结束设置更新失败：" + (result.error || "未知错误"), "var(--danger)");
      return;
    }
    state.teacher.autoFinishWhenExhausted = normalizeAutoFinishWhenExhausted(result.autoFinishWhenExhausted);
    renderAutoFinishWhenExhaustedText();
    if (result.remoteSynced === false) {
      setText(els.teacherStatusText, "自动结束设置已在本地更新，远程同步暂不可用。", "var(--warn)");
      return;
    }
    setText(els.teacherStatusText, "自动结束设置已更新。", "var(--ok)");
  }

  async function saveScoringRulesForTeacher() {
    const rules = readScoringRulesFromEditor();
    setText(els.teacherStatusText, "正在更新评分规则...", "var(--warn)");
    const result = await wordBankService.setScoringRules(rules);
    if (!result.ok) {
      setText(els.teacherStatusText, "评分规则更新失败：" + (result.error || "未知错误"), "var(--danger)");
      return;
    }
    state.teacher.scoringRules = normalizeScoringRules(result.scoringRules || rules);
    setScoringRulesEditorValues(state.teacher.scoringRules);
    renderActiveScoringRulesText();
    if (result.remoteSynced === false) {
      setText(els.teacherStatusText, "评分规则已在本地更新，远程同步暂不可用。", "var(--warn)");
      return;
    }
    setText(els.teacherStatusText, "评分规则已更新。", "var(--ok)");
  }

  function resetScoringRulesEditorForTeacher() {
    setScoringRulesEditorValues(DEFAULT_SCORING_RULES);
    setText(els.teacherStatusText, "默认评分规则已填入，点击“保存评分规则”后生效。", "var(--warn)");
  }

  function renderActiveGameModeText() {
    if (!els.activeGameModeText) return;
    const mode = normalizeGameMode(state.teacher.activeGameMode);
    setText(els.activeGameModeText, "当前游戏模式：" + (mode === "formal" ? "正式模式" : "练习模式"), "var(--ok)");
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

  async function resolveAllowWordRepeat() {
    const value = await wordBankService.loadAllowWordRepeat();
    state.teacher.allowWordRepeat = normalizeAllowWordRepeat(value);
    renderActiveAllowWordRepeatText();
    return state.teacher.allowWordRepeat;
  }

  async function resolveAutoFinishWhenExhausted() {
    const value = await wordBankService.loadAutoFinishWhenExhausted();
    state.teacher.autoFinishWhenExhausted = normalizeAutoFinishWhenExhausted(value);
    renderAutoFinishWhenExhaustedText();
    return state.teacher.autoFinishWhenExhausted;
  }

  async function resolveScoringRules() {
    const value = await wordBankService.loadScoringRules();
    state.teacher.scoringRules = normalizeScoringRules(value || state.teacher.scoringRules);
    setScoringRulesEditorValues(state.teacher.scoringRules);
    renderActiveScoringRulesText();
    return state.teacher.scoringRules;
  }

  function renderActiveMaxWrongGuessesText() {
    if (!els.activeMaxWrongGuessesText) return;
    setText(els.activeMaxWrongGuessesText, "当前最大尝试次数：" + state.teacher.maxWrongGuesses, "var(--ok)");
  }

  function renderActiveAllowWordRepeatText() {
    if (els.setAllowWordRepeatBtn) {
      els.setAllowWordRepeatBtn.textContent = state.teacher.allowWordRepeat
        ? "允许重复出词：开（点击切换）"
        : "允许重复出词：关（点击切换）";
    }
    if (!els.activeAllowWordRepeatText) return;
    setText(
      els.activeAllowWordRepeatText,
      "当前重复出词：" + (state.teacher.allowWordRepeat ? "允许" : "不允许"),
      "var(--ok)"
    );
  }

  function renderAutoFinishWhenExhaustedText() {
    if (els.setAutoFinishWhenExhaustedBtn) {
      els.setAutoFinishWhenExhaustedBtn.textContent = state.teacher.autoFinishWhenExhausted
        ? "词库用尽后自动结束：开（点击切换）"
        : "词库用尽后自动结束：关（点击切换）";
      els.setAutoFinishWhenExhaustedBtn.disabled = !!state.teacher.allowWordRepeat;
    }
    if (!els.activeAutoFinishWhenExhaustedText) return;
    if (state.teacher.allowWordRepeat) {
      setText(els.activeAutoFinishWhenExhaustedText, "当前自动结束：允许重复出词时此设置不生效", "var(--warn)");
      return;
    }
    setText(
      els.activeAutoFinishWhenExhaustedText,
      "当前自动结束：" + (state.teacher.autoFinishWhenExhausted ? "开启" : "关闭"),
      "var(--ok)"
    );
  }

  function pickNextWord() {
    if (!state.words.length) return null;
    if (state.teacher.allowWordRepeat) {
      return state.words[Math.floor(Math.random() * state.words.length)];
    }
    let pool = Array.isArray(state.session.remainingWordIndexes) ? state.session.remainingWordIndexes : [];
    pool = pool.filter((index) => Number.isInteger(index) && index >= 0 && index < state.words.length);
    if (!pool.length) {
      if (state.teacher.autoFinishWhenExhausted && state.session.records.length) {
        state.session.remainingWordIndexes = [];
        return null;
      }
      pool = state.words.map(function (_, index) { return index; });
    }
    const randomPos = Math.floor(Math.random() * pool.length);
    const wordIndex = pool.splice(randomPos, 1)[0];
    state.session.remainingWordIndexes = pool;
    return state.words[wordIndex] || null;
  }

  function shouldAutoFinishAfterQuestion() {
    return !state.teacher.allowWordRepeat &&
      state.teacher.autoFinishWhenExhausted &&
      Array.isArray(state.session.remainingWordIndexes) &&
      state.session.remainingWordIndexes.length === 0;
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
        setText(els.studentModeHint, "当前为练习模式：有在线词库时必须先选择；若暂无在线词库则使用默认词库。", "var(--ok)");
      }
    } else {
      setText(els.studentModeHint, "当前为正式模式，词库由老师统一指定。", "var(--warn)");
    }
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

  function setScoringRulesEditorValues(rules) {
    const normalized = normalizeScoringRules(rules);
    if (els.teacherScoreCorrectBase) els.teacherScoreCorrectBase.value = String(normalized.correctBaseScore);
    if (els.teacherScoreWrongGuessPenalty) els.teacherScoreWrongGuessPenalty.value = String(normalized.wrongGuessPenalty);
    if (els.teacherScoreHintPenalty) els.teacherScoreHintPenalty.value = String(normalized.hintPenalty);
    if (els.teacherScoreTimePenaltySeconds) els.teacherScoreTimePenaltySeconds.value = String(normalized.timePenaltySeconds);
    if (els.teacherScoreMinCorrect) els.teacherScoreMinCorrect.value = String(normalized.minCorrectScore);
    if (els.teacherScoreWrongAnswer) els.teacherScoreWrongAnswer.value = String(normalized.wrongAnswerScore);
    renderActiveScoringRulesText(normalized);
  }

  function readScoringRulesFromEditor() {
    return normalizeScoringRules({
      correctBaseScore: els.teacherScoreCorrectBase ? els.teacherScoreCorrectBase.value : undefined,
      wrongGuessPenalty: els.teacherScoreWrongGuessPenalty ? els.teacherScoreWrongGuessPenalty.value : undefined,
      hintPenalty: els.teacherScoreHintPenalty ? els.teacherScoreHintPenalty.value : undefined,
      timePenaltySeconds: els.teacherScoreTimePenaltySeconds ? els.teacherScoreTimePenaltySeconds.value : undefined,
      minCorrectScore: els.teacherScoreMinCorrect ? els.teacherScoreMinCorrect.value : undefined,
      wrongAnswerScore: els.teacherScoreWrongAnswer ? els.teacherScoreWrongAnswer.value : undefined
    });
  }

  function renderScoringRulesPreviewFromEditor() {
    renderActiveScoringRulesText(readScoringRulesFromEditor());
  }

  function renderActiveScoringRulesText(rulesInput) {
    if (!els.activeScoringRulesText) return;
    const rules = normalizeScoringRules(rulesInput || state.teacher.scoringRules);
    setText(
      els.activeScoringRulesText,
      "当前规则：答对基础分 " + rules.correctBaseScore +
        "，每错猜扣 " + rules.wrongGuessPenalty +
        "，每提示扣 " + rules.hintPenalty +
        "，每 " + rules.timePenaltySeconds + " 秒扣 1 分，答对最低 " + rules.minCorrectScore +
        "，答错得 " + rules.wrongAnswerScore + " 分。",
      "var(--ok)"
    );

    if (els.scoringExampleFastText) {
      const fastScore = calculateQuestionScore(true, 0, 0, 10, rules);
      els.scoringExampleFastText.textContent = "答对 + 0 次错猜 + 0 次提示 + 10 秒 = " + fastScore + " 分";
    }
    if (els.scoringExampleChallengeText) {
      const challengeScore = calculateQuestionScore(true, 2, 1, 30, rules);
      els.scoringExampleChallengeText.textContent = "答对 + 2 次错猜 + 1 次提示 + 30 秒 = " + challengeScore + " 分";
    }
    if (els.scoringExampleWrongText) {
      const wrongScore = calculateQuestionScore(false, 0, 0, 20, rules);
      els.scoringExampleWrongText.textContent = "答错 = " + wrongScore + " 分";
    }
    if (els.scoringRuleExplainText) {
      els.scoringRuleExplainText.textContent =
        "结算顺序：先按答对基础分扣除错猜、提示、时间分，再应用最低保底分；如果答错，则直接使用“答错得分”。";
    }
  }

  function updateStudentSubmitState() {
    if (!els.studentSubmitBtn) return;
    const mode = normalizeGameMode(state.teacher.activeGameMode);
    const button = els.studentSubmitBtn;

    if (location.protocol !== "file:" && mode === "practice" && !state.teacher.wordLists.length && !state.teacher.activeWordList) {
      button.disabled = true;
      button.textContent = "正在加载模式...";
      return;
    }

    if (mode === "formal") {
      button.disabled = false;
      button.textContent = "进入游戏";
      return;
    }

    if (location.protocol === "file:") {
      button.disabled = false;
      button.textContent = "进入游戏";
      return;
    }

    if (!state.teacher.wordLists.length) {
      button.disabled = false;
      button.textContent = "进入游戏";
      return;
    }

    const selected = els.studentWordListSelect ? els.studentWordListSelect.value : "";
    button.disabled = !selected;
    button.textContent = selected ? "进入游戏" : "请先选择词库";
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
    updateStudentSubmitState();
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
      setText(els.studentFormMsg, "当前没有可用的在线词库，已自动使用内置默认词库。", "var(--warn)");
      updateWordBankBadge();
      return true;
    }

    const selected = els.studentWordListSelect ? els.studentWordListSelect.value : "";
    if (!selected) {
      setText(els.studentFormMsg, "请先选择一个在线词库后再开始练习。", "var(--warn)");
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

  function getWordListKey(wordListName, version) {
    return String(wordListName || "").trim() + "|" + String(version || "").trim();
  }

  function findExistingWordList(wordListName, version) {
    const key = getWordListKey(wordListName, version);
    return (state.teacher.wordLists || []).find((item) => getWordListKey(item.wordListName, item.version) === key) || null;
  }

  function preparePublishMetaForRandomDraft() {
    const now = Date.now();
    const currentName = els.wordListName ? String(els.wordListName.value || "").trim() : "";
    const currentVersion = els.versionInput ? String(els.versionInput.value || "").trim() : "";
    const existing = currentName && currentVersion ? findExistingWordList(currentName, currentVersion) : null;

    if (els.wordListName && !currentName) {
      els.wordListName.value = "随机词库";
    }
    if (els.versionInput && (!currentVersion || existing)) {
      els.versionInput.value = "v" + now;
    }
  }

  function formatDraftSourceLabel(item) {
    const wordListName = String(item && item.wordListName || "").trim();
    const version = String(item && item.version || "").trim();
    if (wordListName && version) return wordListName + " (" + version + ")";
    if (wordListName) return wordListName;
    return "手动草稿";
  }

  function renderRandomDrawPlanner() {
    if (!els.randomWordListPlan) return;
    if (!state.teacher.wordLists.length) {
      els.randomWordListPlan.innerHTML = '<div class="teacher-random-plan-empty">当前没有可用的在线词库，无法随机组卷。</div>';
      return;
    }

    els.randomWordListPlan.innerHTML = "";
    state.teacher.wordLists.forEach((item) => {
      const key = getWordListKey(item.wordListName, item.version);
      const savedPlan = state.teacher.randomDrawPlan[key] || {};
      const row = document.createElement("div");
      row.className = "teacher-random-plan-item";
      row.innerHTML = '<div class="teacher-random-plan-meta">' +
        '<label class="teacher-random-plan-check">' +
        '<input type="checkbox" data-random-plan-check="' + escapeHtml(key) + '"' + (savedPlan.selected ? " checked" : "") + " />" +
        '<span class="teacher-random-plan-title">' + escapeHtml(item.wordListName + " (" + item.version + ")") + "</span>" +
        "</label>" +
        '<span class="teacher-random-plan-sub">可用词数：' + Number(item.count || 0) + "</span>" +
        "</div>" +
        '<div class="teacher-random-plan-controls">' +
        '<input type="number" min="0" step="1" data-random-plan-count="' + escapeHtml(key) + '" value="' + Number(savedPlan.count || 0) + '" />' +
        "</div>";
      els.randomWordListPlan.appendChild(row);
    });

    els.randomWordListPlan.querySelectorAll("input[data-random-plan-check]").forEach((input) => {
      input.addEventListener("change", function () {
        const key = input.getAttribute("data-random-plan-check");
        ensureRandomDrawPlanEntry(key).selected = !!input.checked;
      });
    });
    els.randomWordListPlan.querySelectorAll("input[data-random-plan-count]").forEach((input) => {
      input.addEventListener("input", function () {
        const key = input.getAttribute("data-random-plan-count");
        const value = Math.max(0, Math.round(Number(input.value) || 0));
        input.value = String(value);
        const entry = ensureRandomDrawPlanEntry(key);
        entry.count = value;
        if (value > 0) {
          entry.selected = true;
          const checkbox = els.randomWordListPlan.querySelector('input[data-random-plan-check="' + key + '"]');
          if (checkbox) checkbox.checked = true;
        }
      });
    });
  }

  function renderRandomDrawSummary() {
    if (!els.randomDraftSummary) return;
    const summary = Array.isArray(state.teacher.randomDrawSummary) ? state.teacher.randomDrawSummary : [];
    if (!summary.length) {
      els.randomDraftSummary.innerHTML = "";
      return;
    }
    els.randomDraftSummary.innerHTML = summary.map((item) => {
      const shortageText = item.shortage > 0 ? "，缺少 " + item.shortage + " 个" : "";
      const warnClass = item.shortage > 0 ? " warn" : "";
      return '<div class="teacher-random-summary-item' + warnClass + '">' +
        escapeHtml(item.wordListName + " (" + item.version + ")") +
        "：请求 " + Number(item.requested || 0) +
        "，生成 " + Number(item.generated || 0) +
        "，可用唯一词 " + Number(item.available || 0) +
        shortageText +
        "</div>";
    }).join("");
  }

  function ensureRandomDrawPlanEntry(key) {
    if (!state.teacher.randomDrawPlan[key]) {
      state.teacher.randomDrawPlan[key] = { selected: false, count: 0 };
    }
    return state.teacher.randomDrawPlan[key];
  }

  function clearRandomDrawPlan() {
    state.teacher.randomDrawPlan = {};
    state.teacher.randomDrawSummary = [];
    renderRandomDrawPlanner();
    renderRandomDrawSummary();
    setText(els.teacherStatusText, "随机组卷计划已清空。", "var(--warn)");
  }

  async function generateRandomDraftWords() {
    if (!state.teacher.wordLists.length) {
      setText(els.teacherStatusText, "当前没有可用的在线词库，无法随机组卷。", "var(--danger)");
      return;
    }

    const selectedPlans = state.teacher.wordLists.map((item) => {
      const key = getWordListKey(item.wordListName, item.version);
      const plan = state.teacher.randomDrawPlan[key] || {};
      return {
        key: key,
        wordListName: item.wordListName,
        version: item.version,
        availableCount: Number(item.count || 0),
        requested: Math.max(0, Math.round(Number(plan.count) || 0)),
        selected: !!plan.selected
      };
    }).filter((item) => item.selected && item.requested > 0);

    if (!selectedPlans.length) {
      setText(els.teacherStatusText, "请至少选择一个词库，并填写大于 0 的抽取数量。", "var(--danger)");
      return;
    }

    if (state.teacher.draftWords.length) {
      const shouldReplace = window.confirm("生成随机草稿会覆盖当前本地草稿，是否继续？");
      if (!shouldReplace) {
        setText(els.teacherStatusText, "已取消生成随机草稿。", "var(--warn)");
        return;
      }
    }

    if (els.generateRandomDraftBtn) els.generateRandomDraftBtn.disabled = true;
    setText(els.teacherStatusText, "正在从所选词库生成随机草稿...", "var(--warn)");
    try {
      const loadedGroups = await Promise.all(selectedPlans.map(async function (item) {
        const result = await wordBankService.loadWordListBySelection(item.wordListName, item.version);
        const words = shuffleArray(dedupeWords(normalizeWords(result.words || []))).map((word) => Object.assign({}, word, {
          wordListName: item.wordListName,
          version: item.version
        }));
        return Object.assign({}, item, {
          words: words,
          availableUniqueCount: words.length,
          generatedCount: 0
        });
      }));

      const generated = [];
      const seen = new Set();
      let madeProgress = true;
      while (madeProgress) {
        madeProgress = false;
        loadedGroups.forEach((group) => {
          if (group.generatedCount >= group.requested) return;
          while (group.words.length) {
            const candidate = group.words.shift();
            if (seen.has(candidate.word)) continue;
            seen.add(candidate.word);
            generated.push(candidate);
            group.generatedCount = (group.generatedCount || 0) + 1;
            madeProgress = true;
            break;
          }
        });
      }

      state.teacher.randomDrawSummary = loadedGroups.map((group) => ({
        wordListName: group.wordListName,
        version: group.version,
        requested: group.requested,
        generated: group.generatedCount || 0,
        available: group.availableUniqueCount || 0,
        shortage: Math.max(0, group.requested - (group.generatedCount || 0))
      }));
      renderRandomDrawSummary();

      if (!generated.length) {
        state.teacher.draftWords = [];
        wordBankService.saveLocalWordList([]);
        cancelDraftEditor();
        renderDraftTable();
        setText(els.teacherStatusText, "没有生成任何词条，请检查配额或词库内容。", "var(--danger)");
        return;
      }

      state.teacher.draftWords = generated;
      state.teacher.draftOrigin = "random";
      wordBankService.saveLocalWordList(state.teacher.draftWords);
      preparePublishMetaForRandomDraft();
      cancelDraftEditor();
      renderDraftTable();
      state.wordSource = "local_draft";
      state.words = state.teacher.draftWords.slice();
      localStorage.setItem(STORAGE_KEYS.ACTIVE_WORD_SOURCE, "local_draft");
      updateWordBankBadge();

      const totalShortage = state.teacher.randomDrawSummary.reduce((sum, item) => sum + item.shortage, 0);
      setText(
        els.teacherStatusText,
        totalShortage > 0
          ? ("随机草稿已生成，共 " + generated.length + " 条；部分词库唯一词不足，请检查摘要。已自动准备新的版本号，避免覆盖原在线词库。")
          : ("随机草稿已生成，共 " + generated.length + " 条。可继续手动编辑后发布；已自动准备新的版本号，避免覆盖原在线词库。"),
        totalShortage > 0 ? "var(--warn)" : "var(--ok)"
      );
    } catch (error) {
      setText(els.teacherStatusText, "随机组卷失败：" + error.message, "var(--danger)");
    } finally {
      if (els.generateRandomDraftBtn) els.generateRandomDraftBtn.disabled = false;
    }
  }

  function addDraftWordManually() {
    openDraftEditor({
      wordListName: "手动补充",
      version: "",
      word: "",
      meaning: "",
      category: (els.categoryInput && els.categoryInput.value || "General").trim(),
      difficulty: els.difficultyInput && els.difficultyInput.value ? els.difficultyInput.value : "medium"
    }, -1);
  }

  function editDraftWord(index) {
    const current = state.teacher.draftWords[index];
    if (!current) return;
    openDraftEditor(current, index);
  }

  function openDraftEditor(initial, index) {
    state.teacher.draftEditor = { open: true, index: typeof index === "number" ? index : -1 };
    if (els.draftEditorTitle) {
      els.draftEditorTitle.textContent = index >= 0 ? "编辑草稿词条" : "新增草稿词条";
    }
    if (els.draftEditorWordListName) els.draftEditorWordListName.value = String(initial.wordListName || "");
    if (els.draftEditorVersion) els.draftEditorVersion.value = String(initial.version || "");
    if (els.draftEditorWord) els.draftEditorWord.value = String(initial.word || "");
    if (els.draftEditorMeaning) els.draftEditorMeaning.value = String(initial.meaning || "");
    if (els.draftEditorCategory) els.draftEditorCategory.value = String(initial.category || "General");
    if (els.draftEditorDifficulty) els.draftEditorDifficulty.value = normalizeDifficulty(initial.difficulty || "medium");
    if (els.draftEditorCard) els.draftEditorCard.classList.remove("hidden");
    if (els.draftEditorWord) els.draftEditorWord.focus();
  }

  function cancelDraftEditor() {
    state.teacher.draftEditor = { open: false, index: -1 };
    if (els.draftEditorCard) els.draftEditorCard.classList.add("hidden");
  }

  function saveDraftEditor() {
    const item = {
      wordListName: els.draftEditorWordListName ? els.draftEditorWordListName.value : "",
      version: els.draftEditorVersion ? els.draftEditorVersion.value : "",
      word: els.draftEditorWord ? els.draftEditorWord.value : "",
      meaning: els.draftEditorMeaning ? els.draftEditorMeaning.value : "",
      category: els.draftEditorCategory ? els.draftEditorCategory.value : "",
      difficulty: els.draftEditorDifficulty ? els.draftEditorDifficulty.value : "medium"
    };
    const normalized = normalizeWord(item);
    if (!normalized) {
      setText(els.teacherStatusText, "词条无效，请输入合法英文单词。", "var(--danger)");
      return;
    }

    const editIndex = state.teacher.draftEditor ? state.teacher.draftEditor.index : -1;
    if (hasDuplicateDraftWord(normalized.word, editIndex >= 0 ? editIndex : void 0)) {
      setText(els.teacherStatusText, "草稿中已存在相同单词：" + normalized.word, "var(--warn)");
      return;
    }

    if (editIndex >= 0) {
      state.teacher.draftWords[editIndex] = normalized;
    } else {
      state.teacher.draftWords.push(normalized);
    }
    wordBankService.saveLocalWordList(state.teacher.draftWords);
    syncLocalDraftPreviewIfActive();
    renderDraftTable();
    cancelDraftEditor();
    setText(els.teacherStatusText, editIndex >= 0 ? "已更新词条。" : "已手动新增词条。", "var(--ok)");
  }

  function hasDuplicateDraftWord(word, ignoreIndex) {
    const target = String(word || "").trim().toLowerCase();
    return state.teacher.draftWords.some((item, index) => index !== ignoreIndex && item.word === target);
  }

  function formatWordListMetaError(error) {
    const message = String(error || "未知错误");
    if (message.indexOf("target wordListName and version already exists") >= 0) {
      return "词库名称和版本组合已存在，请更换后再保存。";
    }
    if (message.indexOf("target word list not found") >= 0) {
      return "未找到目标在线词库，可能已被删除或改名。";
    }
    return message;
  }

  function syncLocalDraftPreviewIfActive() {
    if (state.wordSource === "local_draft") {
      state.words = state.teacher.draftWords.slice();
      updateWordBankBadge();
    }
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
      row.innerHTML = "<td>" + escapeHtml(formatDraftSourceLabel(item)) + "</td>" +
        "<td>" + escapeHtml(item.word) + "</td>" +
        "<td>" + escapeHtml(item.meaning || "") + "</td>" +
        "<td>" + escapeHtml(item.category || "") + "</td>" +
        "<td>" + escapeHtml(displayDifficulty(item.difficulty)) + "</td>" +
        '<td><button data-edit-index="' + index + '">编辑</button> <button data-remove-index="' + index + '">删除</button></td>';
      els.draftTableBody.appendChild(row);
    });
    els.draftTableBody.querySelectorAll("button[data-edit-index]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-edit-index"));
        editDraftWord(idx);
      });
    });
    els.draftTableBody.querySelectorAll("button[data-remove-index]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-remove-index"));
        state.teacher.draftWords.splice(idx, 1);
        wordBankService.saveLocalWordList(state.teacher.draftWords);
        syncLocalDraftPreviewIfActive();
        renderDraftTable();
        setText(els.teacherStatusText, "已删除词条。", "var(--ok)");
      });
    });
  }

  function renderSharedTable() {
    const list = state.teacher.sharedWords;
    setText(els.sharedCountText, "在线词库数量：" + list.length);
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
    let text = "当前词库：内置默认词库";
    let color = "var(--muted)";
    if (state.wordSource === "shared") {
      text = "当前词库：在线词库";
      color = "var(--ok)";
    } else if (state.wordSource === "local_draft") {
      text = "当前词库：本地草稿";
      color = "var(--warn)";
    } else if (state.wordSource === "loading") {
      text = "当前词库：正在同步...";
      color = "var(--warn)";
    }
    if (location.protocol === "file:") {
      text += " | 当前为离线模式，词库尚未发布";
      color = "var(--warn)";
    }
    els.wordBankBadge.textContent = text;
    els.wordBankBadge.style.color = color;
  }

  async function refreshLeaderboard() {
    if (els.refreshRankBtn) els.refreshRankBtn.disabled = true;
    if (els.rankStatusText) setText(els.rankStatusText, "正在刷新排行榜...", "var(--warn)");
    try {
      const rankList = await scoreService.loadLeaderboard();
      els.rankTableBody.innerHTML = "";
      if (!rankList.length) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="6">暂无数据</td>';
        els.rankTableBody.appendChild(row);
        if (els.rankStatusText) setText(els.rankStatusText, "已刷新，当前暂无数据。", "var(--warn)");
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
      if (els.rankStatusText) setText(els.rankStatusText, "已刷新，共 " + rankList.length + " 条记录。", "var(--ok)");
    } catch (error) {
      if (els.rankStatusText) setText(els.rankStatusText, "刷新失败，请稍后重试。", "var(--danger)");
    } finally {
      if (els.refreshRankBtn) els.refreshRankBtn.disabled = false;
    }
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

  function calculateQuestionScore(correct, wrongGuesses, hintsUsed, durationSeconds, scoringRules) {
    const rules = normalizeScoringRules(scoringRules);
    if (!correct) return rules.wrongAnswerScore;
    return Math.max(
      rules.minCorrectScore,
      rules.correctBaseScore -
        wrongGuesses * rules.wrongGuessPenalty -
        hintsUsed * rules.hintPenalty -
        Math.floor(durationSeconds / rules.timePenaltySeconds)
    );
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
      wordListName: String(item.wordListName || "").trim(),
      teacherName: String(item.teacherName || "").trim(),
      publishTime: item.publishTime || "",
      status: String(item.status || "").trim(),
      source: String(item.source || "").trim(),
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

  function normalizeAllowWordRepeat(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }

  function normalizeAutoFinishWhenExhausted(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }

  function normalizeMaxWrongGuesses(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return 10;
    return Math.max(1, Math.min(12, Math.round(num)));
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

  function shuffleArray(list) {
    const copy = Array.isArray(list) ? list.slice() : [];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function parseTxtWords(content, wordListName, category, difficulty) {
    return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(",");
      return {
        wordListName,
        word: (parts[0] || "").trim(),
        meaning: (parts[1] || "").trim(),
        category,
        difficulty
      };
    });
  }

  function parseCsvWords(content, wordListName, category, difficulty) {
    return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const cols = line.split(",").map((c) => c.trim());
      return {
        wordListName: cols[4] || wordListName,
        word: cols[0] || "",
        meaning: cols[1] || "",
        category: cols[2] || category,
        difficulty: cols[3] || difficulty
      };
    });
  }

  function parseJsonWords(content, wordListName, category, difficulty) {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) return [];
    return data.map((item) => typeof item === "string"
      ? { wordListName, word: item, meaning: "", category, difficulty }
      : {
        wordListName: item.wordListName || wordListName,
        word: item.word || "",
        meaning: item.meaning || "",
        category: item.category || category,
        difficulty: item.difficulty || difficulty
      });
  }

  function displayDifficulty(v) {
    if (v === "easy") return "简单";
    if (v === "hard") return "困难";
    return "中等";
  }

  function displaySourceText() {
    if (state.wordSource === "shared") return "在线词库";
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
    return this.config.proxyEndpoint;
  };

  ApiClient.prototype.post = async function (action, payload) {
    const endpoint = this.getEndpoint();
    if (!endpoint) throw new Error("未配置远程接口 URL");
    const requestBody = { action, payload };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) throw new Error("网络请求失败：" + response.status);
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "远程返回失败");
    return data;
  };

  function StorageAdapter() {}
  StorageAdapter.prototype.saveScore = async function () {};
  StorageAdapter.prototype.saveScores = async function () { return { ok: false }; };
  StorageAdapter.prototype.saveGameRecord = function () {};
  StorageAdapter.prototype.loadLeaderboard = async function () { return []; };
  StorageAdapter.prototype.loadLocalWordList = function () { return []; };
  StorageAdapter.prototype.saveLocalWordList = function () {};
  StorageAdapter.prototype.loadBootstrapData = async function () { return { wordLists: [], active: null, activeWords: [] }; };
  StorageAdapter.prototype.listWordLists = async function () { return { wordLists: [], active: null }; };
  StorageAdapter.prototype.setActiveWordList = async function () { return { ok: false }; };
  StorageAdapter.prototype.updateWordListMeta = async function () { return { ok: false }; };
  StorageAdapter.prototype.deleteWordList = async function () { return { ok: false }; };
  StorageAdapter.prototype.loadActiveWordList = async function () { return { words: [], active: null }; };
  StorageAdapter.prototype.loadWordListBySelection = async function () { return { words: [], active: null }; };
  StorageAdapter.prototype.loadActiveGameMode = async function () { return "practice"; };
  StorageAdapter.prototype.setActiveGameMode = async function () { return { ok: false }; };
  StorageAdapter.prototype.loadMaxWrongGuesses = async function () { return 10; };
  StorageAdapter.prototype.setMaxWrongGuesses = async function () { return { ok: false }; };
  StorageAdapter.prototype.loadAllowWordRepeat = async function () { return false; };
  StorageAdapter.prototype.setAllowWordRepeat = async function () { return { ok: false, allowWordRepeat: false }; };
  StorageAdapter.prototype.loadAutoFinishWhenExhausted = async function () { return false; };
  StorageAdapter.prototype.setAutoFinishWhenExhausted = async function () { return { ok: false, autoFinishWhenExhausted: false }; };
  StorageAdapter.prototype.loadScoringRules = async function () { return normalizeScoringRules(DEFAULT_SCORING_RULES); };
  StorageAdapter.prototype.setScoringRules = async function () { return { ok: false, scoringRules: normalizeScoringRules(DEFAULT_SCORING_RULES) }; };
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
  LocalStorageFallback.prototype.loadAllowWordRepeat = function () {
    const raw = localStorage.getItem(STORAGE_KEYS.ALLOW_WORD_REPEAT);
    if (raw == null) return normalizeAllowWordRepeat(CONFIG.allowWordRepeat);
    return normalizeAllowWordRepeat(raw);
  };
  LocalStorageFallback.prototype.setAllowWordRepeat = function (allowWordRepeat) {
    localStorage.setItem(STORAGE_KEYS.ALLOW_WORD_REPEAT, normalizeAllowWordRepeat(allowWordRepeat) ? "1" : "0");
    return { ok: true, allowWordRepeat: this.loadAllowWordRepeat() };
  };
  LocalStorageFallback.prototype.loadAutoFinishWhenExhausted = function () {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTO_FINISH_WHEN_EXHAUSTED);
    if (raw == null) return normalizeAutoFinishWhenExhausted(CONFIG.autoFinishWhenExhausted);
    return normalizeAutoFinishWhenExhausted(raw);
  };
  LocalStorageFallback.prototype.setAutoFinishWhenExhausted = function (autoFinishWhenExhausted) {
    localStorage.setItem(STORAGE_KEYS.AUTO_FINISH_WHEN_EXHAUSTED, normalizeAutoFinishWhenExhausted(autoFinishWhenExhausted) ? "1" : "0");
    return { ok: true, autoFinishWhenExhausted: this.loadAutoFinishWhenExhausted() };
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
  SheetStorage.prototype.saveScores = async function (records) {
    if (location.protocol === "file:") {
      for (let i = 0; i < records.length; i += 1) {
        this.fallback.saveScore(records[i]);
        this.fallback.savePendingRemote("saveScore", records[i]);
      }
      return { ok: false, pending: true };
    }
    try {
      await this.apiClient.post("saveScores", { records });
      for (let i = 0; i < records.length; i += 1) {
        this.fallback.saveScore(Object.assign({}, records[i], { uploadStatus: "uploaded" }));
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
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
  SheetStorage.prototype.loadBootstrapData = async function () {
    if (location.protocol === "file:") {
      return {
        wordLists: [],
        active: null,
        activeGameMode: "practice",
        maxWrongGuesses: CONFIG.maxWrongGuesses,
        allowWordRepeat: this.fallback.loadAllowWordRepeat(),
        autoFinishWhenExhausted: this.fallback.loadAutoFinishWhenExhausted(),
        scoringRules: normalizeScoringRules(DEFAULT_SCORING_RULES),
        activeWords: this.fallback.loadSharedWordListCache()
      };
    }
    try {
      const result = await this.apiClient.post("loadBootstrapData", {});
      const data = result.data || {};
      const activeWords = normalizeWords(data.activeWords || []);
      if (activeWords.length) this.fallback.saveSharedWordListCache(activeWords);
      return {
        wordLists: Array.isArray(data.wordLists) ? data.wordLists : [],
        active: data.active || null,
        activeGameMode: data.activeGameMode || "practice",
        maxWrongGuesses: data.maxWrongGuesses || CONFIG.maxWrongGuesses,
        allowWordRepeat: Object.prototype.hasOwnProperty.call(data, "allowWordRepeat")
          ? normalizeAllowWordRepeat(data.allowWordRepeat)
          : this.fallback.loadAllowWordRepeat(),
        autoFinishWhenExhausted: Object.prototype.hasOwnProperty.call(data, "autoFinishWhenExhausted")
          ? normalizeAutoFinishWhenExhausted(data.autoFinishWhenExhausted)
          : this.fallback.loadAutoFinishWhenExhausted(),
        scoringRules: Object.prototype.hasOwnProperty.call(data, "scoringRules")
          ? normalizeScoringRules(data.scoringRules)
          : normalizeScoringRules(DEFAULT_SCORING_RULES),
        activeWords
      };
    } catch (error) {
      return {
        wordLists: [],
        active: null,
        activeGameMode: "practice",
        maxWrongGuesses: CONFIG.maxWrongGuesses,
        allowWordRepeat: this.fallback.loadAllowWordRepeat(),
        autoFinishWhenExhausted: this.fallback.loadAutoFinishWhenExhausted(),
        scoringRules: normalizeScoringRules(DEFAULT_SCORING_RULES),
        activeWords: this.fallback.loadSharedWordListCache()
      };
    }
  };
  SheetStorage.prototype.listWordLists = async function () {
    if (location.protocol === "file:") {
      return {
        wordLists: [],
        active: null,
        activeGameMode: "practice",
        maxWrongGuesses: CONFIG.maxWrongGuesses,
        allowWordRepeat: this.fallback.loadAllowWordRepeat(),
        autoFinishWhenExhausted: this.fallback.loadAutoFinishWhenExhausted(),
        scoringRules: normalizeScoringRules(DEFAULT_SCORING_RULES)
      };
    }
    try {
      const result = await this.apiClient.post("listWordLists", {});
      return {
        wordLists: result.data && Array.isArray(result.data.wordLists) ? result.data.wordLists : [],
        active: result.data ? result.data.active || null : null,
        activeGameMode: result.data ? result.data.activeGameMode || "practice" : "practice",
        maxWrongGuesses: result.data ? result.data.maxWrongGuesses || CONFIG.maxWrongGuesses : CONFIG.maxWrongGuesses,
        allowWordRepeat: result.data && Object.prototype.hasOwnProperty.call(result.data, "allowWordRepeat")
          ? normalizeAllowWordRepeat(result.data.allowWordRepeat)
          : this.fallback.loadAllowWordRepeat(),
        autoFinishWhenExhausted: result.data && Object.prototype.hasOwnProperty.call(result.data, "autoFinishWhenExhausted")
          ? normalizeAutoFinishWhenExhausted(result.data.autoFinishWhenExhausted)
          : this.fallback.loadAutoFinishWhenExhausted(),
        scoringRules: result.data && Object.prototype.hasOwnProperty.call(result.data, "scoringRules")
          ? normalizeScoringRules(result.data.scoringRules)
          : normalizeScoringRules(DEFAULT_SCORING_RULES)
      };
    } catch (error) {
      return {
        wordLists: [],
        active: null,
        activeGameMode: "practice",
        maxWrongGuesses: CONFIG.maxWrongGuesses,
        allowWordRepeat: this.fallback.loadAllowWordRepeat(),
        autoFinishWhenExhausted: this.fallback.loadAutoFinishWhenExhausted(),
        scoringRules: normalizeScoringRules(DEFAULT_SCORING_RULES)
      };
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
  SheetStorage.prototype.updateWordListMeta = async function (payload) {
    if (location.protocol === "file:") return { ok: false, error: "file mode" };
    try {
      const result = await this.apiClient.post("updateWordListMeta", payload);
      return {
        ok: true,
        active: result.data ? result.data.active || null : null,
        updated: result.data ? result.data.updated || null : null
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  SheetStorage.prototype.deleteWordList = async function (wordListName, version) {
    if (location.protocol === "file:") return { ok: false, error: "file mode" };
    try {
      const result = await this.apiClient.post("deleteWordList", { wordListName, version });
      return {
        ok: true,
        active: result.data ? result.data.active || null : null,
        deleted: result.data ? result.data.deleted || null : null
      };
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
  SheetStorage.prototype.loadAllowWordRepeat = async function () {
    if (location.protocol === "file:") return this.fallback.loadAllowWordRepeat();
    try {
      const result = await this.apiClient.post("getAllowWordRepeat", {});
      const value = normalizeAllowWordRepeat(result.data && result.data.allowWordRepeat);
      this.fallback.setAllowWordRepeat(value);
      return value;
    } catch (error) {
      return this.fallback.loadAllowWordRepeat();
    }
  };
  SheetStorage.prototype.setAllowWordRepeat = async function (allowWordRepeat) {
    const value = normalizeAllowWordRepeat(allowWordRepeat);
    this.fallback.setAllowWordRepeat(value);
    if (location.protocol === "file:") {
      return { ok: true, allowWordRepeat: value, remoteSynced: false };
    }
    try {
      const result = await this.apiClient.post("setAllowWordRepeat", { allowWordRepeat: value });
      const finalValue = normalizeAllowWordRepeat(
        result.data && Object.prototype.hasOwnProperty.call(result.data, "allowWordRepeat")
          ? result.data.allowWordRepeat
          : value
      );
      this.fallback.setAllowWordRepeat(finalValue);
      return { ok: true, allowWordRepeat: finalValue, remoteSynced: true };
    } catch (error) {
      return { ok: true, allowWordRepeat: value, remoteSynced: false, error: error.message };
    }
  };
  SheetStorage.prototype.loadAutoFinishWhenExhausted = async function () {
    if (location.protocol === "file:") return this.fallback.loadAutoFinishWhenExhausted();
    try {
      const result = await this.apiClient.post("getAutoFinishWhenExhausted", {});
      const value = normalizeAutoFinishWhenExhausted(result.data && result.data.autoFinishWhenExhausted);
      this.fallback.setAutoFinishWhenExhausted(value);
      return value;
    } catch (error) {
      return this.fallback.loadAutoFinishWhenExhausted();
    }
  };
  SheetStorage.prototype.setAutoFinishWhenExhausted = async function (autoFinishWhenExhausted) {
    const value = normalizeAutoFinishWhenExhausted(autoFinishWhenExhausted);
    this.fallback.setAutoFinishWhenExhausted(value);
    if (location.protocol === "file:") {
      return { ok: true, autoFinishWhenExhausted: value, remoteSynced: false };
    }
    try {
      const result = await this.apiClient.post("setAutoFinishWhenExhausted", { autoFinishWhenExhausted: value });
      const finalValue = normalizeAutoFinishWhenExhausted(
        result.data && Object.prototype.hasOwnProperty.call(result.data, "autoFinishWhenExhausted")
          ? result.data.autoFinishWhenExhausted
          : value
      );
      this.fallback.setAutoFinishWhenExhausted(finalValue);
      return { ok: true, autoFinishWhenExhausted: finalValue, remoteSynced: true };
    } catch (error) {
      return { ok: true, autoFinishWhenExhausted: value, remoteSynced: false, error: error.message };
    }
  };
  SheetStorage.prototype.loadScoringRules = async function () {
    if (location.protocol === "file:") return normalizeScoringRules(DEFAULT_SCORING_RULES);
    try {
      const result = await this.apiClient.post("getScoringRules", {});
      return normalizeScoringRules(result.data && result.data.scoringRules);
    } catch (error) {
      return normalizeScoringRules(DEFAULT_SCORING_RULES);
    }
  };
  SheetStorage.prototype.setScoringRules = async function (scoringRules) {
    const value = normalizeScoringRules(scoringRules);
    if (location.protocol === "file:") {
      return { ok: true, scoringRules: value, remoteSynced: false };
    }
    try {
      const result = await this.apiClient.post("setScoringRules", value);
      const finalValue = normalizeScoringRules(
        result.data && Object.prototype.hasOwnProperty.call(result.data, "scoringRules")
          ? result.data.scoringRules
          : value
      );
      return { ok: true, scoringRules: finalValue, remoteSynced: true };
    } catch (error) {
      return { ok: false, scoringRules: value, error: error.message };
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
  ScoreService.prototype.saveScores = async function (records) {
    return this.storage.saveScores(records);
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
  WordBankService.prototype.loadBootstrapData = async function () {
    return this.storage.loadBootstrapData();
  };
  WordBankService.prototype.listWordLists = async function () {
    return this.storage.listWordLists();
  };
  WordBankService.prototype.setActiveWordList = async function (wordListName, version) {
    return this.storage.setActiveWordList(wordListName, version);
  };
  WordBankService.prototype.updateWordListMeta = async function (payload) {
    return this.storage.updateWordListMeta(payload);
  };
  WordBankService.prototype.deleteWordList = async function (wordListName, version) {
    return this.storage.deleteWordList(wordListName, version);
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
  WordBankService.prototype.loadAllowWordRepeat = async function () {
    return this.storage.loadAllowWordRepeat();
  };
  WordBankService.prototype.setAllowWordRepeat = async function (allowWordRepeat) {
    return this.storage.setAllowWordRepeat(allowWordRepeat);
  };
  WordBankService.prototype.loadAutoFinishWhenExhausted = async function () {
    return this.storage.loadAutoFinishWhenExhausted();
  };
  WordBankService.prototype.setAutoFinishWhenExhausted = async function (autoFinishWhenExhausted) {
    return this.storage.setAutoFinishWhenExhausted(autoFinishWhenExhausted);
  };
  WordBankService.prototype.loadScoringRules = async function () {
    return this.storage.loadScoringRules();
  };
  WordBankService.prototype.setScoringRules = async function (scoringRules) {
    return this.storage.setScoringRules(scoringRules);
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
