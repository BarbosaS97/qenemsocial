// QEnemSocial - lógica principal da aplicação

const DISCIPLINES = [
  { value: "", label: "Todas as disciplinas" },
  { value: "linguagens", label: "Linguagens" },
  { value: "ciencias-humanas", label: "Ciências Humanas" },
  { value: "ciencias-natureza", label: "Ciências da Natureza" },
  { value: "matematica", label: "Matemática" },
];

const MIN_YEAR = 2009;
const MAX_YEAR = 2023;

const App = (() => {
  const state = {
    mode: "practice", // "practice" | "simulado"
    questions: [],
    currentIndex: 0,
    answers: {}, // { [questionId]: letterEscolhida }
    filters: { year: "2023", discipline: "", language: "" },
  };

  const el = {};

  function cacheDom() {
    el.yearSelect = document.getElementById("year-select");
    el.disciplineSelect = document.getElementById("discipline-select");
    el.loadBtn = document.getElementById("load-btn");
    el.simuladoBtn = document.getElementById("simulado-btn");
    el.resetStatsBtn = document.getElementById("reset-stats-btn");

    el.statusArea = document.getElementById("status-area");
    el.questionArea = document.getElementById("question-area");
    el.resultsArea = document.getElementById("results-area");

    el.qNumber = document.getElementById("q-number");
    el.qDiscipline = document.getElementById("q-discipline");
    el.qContext = document.getElementById("q-context");
    el.qIntro = document.getElementById("q-intro");
    el.qAlternatives = document.getElementById("q-alternatives");
    el.qFeedback = document.getElementById("q-feedback");

    el.answerBtn = document.getElementById("answer-btn");
    el.prevBtn = document.getElementById("prev-btn");
    el.nextBtn = document.getElementById("next-btn");
    el.progress = document.getElementById("progress");
    el.progressFill = document.getElementById("progress-fill");

    el.statCorrect = document.getElementById("stat-correct");
    el.statWrong = document.getElementById("stat-wrong");
    el.statAccuracy = document.getElementById("stat-accuracy");

    el.resultsSummary = document.getElementById("results-summary");
    el.backToPracticeBtn = document.getElementById("back-to-practice-btn");
  }

  function populateSelects() {
    for (let y = MAX_YEAR; y >= MIN_YEAR; y--) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = y;
      el.yearSelect.appendChild(opt);
    }
    el.yearSelect.value = state.filters.year;

    DISCIPLINES.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.value;
      opt.textContent = d.label;
      el.disciplineSelect.appendChild(opt);
    });
  }

  function disciplineLabel(value) {
    return DISCIPLINES.find((d) => d.value === value)?.label ?? value;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  // A API enem.dev embute as imagens do enunciado como markdown (![](url))
  // dentro de `context`, na posição exata em que devem aparecer na leitura.
  // `files` traz as mesmas URLs à parte; usamos como rede de segurança para
  // imagens que porventura não estejam referenciadas inline.
  function renderContextWithImages(text, files) {
    const usedFiles = new Set();
    const imageRegex = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;

    let html = "";
    let lastIndex = 0;
    let match;
    while ((match = imageRegex.exec(text)) !== null) {
      html += escapeHtml(text.slice(lastIndex, match.index)).replace(/\n/g, "<br>");
      html += `<img class="q-image" src="${escapeHtml(match[1])}" alt="Imagem da questão" loading="lazy">`;
      usedFiles.add(match[1]);
      lastIndex = imageRegex.lastIndex;
    }
    html += escapeHtml(text.slice(lastIndex)).replace(/\n/g, "<br>");

    (files || []).forEach((url) => {
      if (!usedFiles.has(url)) {
        html += `<img class="q-image" src="${escapeHtml(url)}" alt="Imagem da questão" loading="lazy">`;
      }
    });

    return html;
  }

  function setStatus(message, isError = false) {
    el.statusArea.textContent = message;
    el.statusArea.classList.toggle("status-error", isError);
    el.statusArea.classList.toggle("hidden", !message);
  }

  function showView(view) {
    el.questionArea.classList.toggle("hidden", view !== "question");
    el.resultsArea.classList.toggle("hidden", view !== "results");
  }

  async function loadPractice() {
    state.mode = "practice";
    state.filters.year = el.yearSelect.value;
    state.filters.discipline = el.disciplineSelect.value;

    setStatus("Carregando questões...");
    showView(null);

    try {
      const { questions } = await Questions.fetchList({
        year: state.filters.year,
        discipline: state.filters.discipline,
        limit: 20,
        offset: 0,
      });

      if (!questions || questions.length === 0) {
        setStatus("Nenhuma questão encontrada para esse filtro.", true);
        return;
      }

      state.questions = questions;
      state.currentIndex = 0;
      state.answers = {};
      setStatus("");
      showView("question");
      renderQuestion();
    } catch (err) {
      setStatus(`Erro: ${err.message}`, true);
    }
  }

  async function startSimulado() {
    state.mode = "simulado";
    state.filters.year = el.yearSelect.value;
    state.filters.discipline = el.disciplineSelect.value;

    setStatus("Montando simulado...");
    showView(null);

    try {
      const { questions } = await Questions.fetchRandom({
        year: state.filters.year,
        discipline: state.filters.discipline,
        limit: 10,
      });

      if (!questions || questions.length === 0) {
        setStatus("Não foi possível montar o simulado com esse filtro.", true);
        return;
      }

      state.questions = questions;
      state.currentIndex = 0;
      state.answers = {};
      setStatus("");
      showView("question");
      renderQuestion();
    } catch (err) {
      setStatus(`Erro: ${err.message}`, true);
    }
  }

  function currentQuestion() {
    return state.questions[state.currentIndex];
  }

  function renderQuestion() {
    const q = currentQuestion();
    if (!q) return;

    document.dispatchEvent(new CustomEvent("qenemsocial:question", { detail: q }));

    el.qNumber.textContent = `Questão ${q.number} · ${q.year}`;
    el.qDiscipline.textContent = disciplineLabel(q.discipline);
    el.qContext.innerHTML = renderContextWithImages(q.context || q.title || "", q.files);
    el.qIntro.textContent = q.alternatives_introduction || "";

    el.qAlternatives.innerHTML = "";
    q.alternatives.forEach((alt) => {
      const label = document.createElement("label");
      label.className = "alternative";
      label.dataset.letter = alt.letter;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "alternative";
      input.value = alt.letter;
      if (state.answers[q.id] === alt.letter) input.checked = true;

      const span = document.createElement("span");
      span.className = "alternative-content";

      const strong = document.createElement("strong");
      strong.textContent = alt.letter;
      span.appendChild(strong);

      if (alt.text) {
        span.appendChild(document.createTextNode(` ${alt.text}`));
      }

      if (alt.file) {
        const img = document.createElement("img");
        img.src = alt.file;
        img.alt = `Alternativa ${alt.letter}`;
        img.className = "alt-image";
        img.loading = "lazy";
        span.appendChild(img);
      }

      label.appendChild(input);
      label.appendChild(span);
      el.qAlternatives.appendChild(label);
    });

    const answered = state.answers[q.id] !== undefined;
    el.qFeedback.classList.add("hidden");
    el.qFeedback.textContent = "";
    if (answered) showFeedback(q, state.answers[q.id]);

    el.prevBtn.disabled = state.currentIndex === 0;
    el.nextBtn.disabled = state.currentIndex === state.questions.length - 1;
    el.progress.textContent = `Questão ${state.currentIndex + 1} de ${state.questions.length}`;
    el.progressFill.style.width = `${((state.currentIndex + 1) / state.questions.length) * 100}%`;
    el.answerBtn.disabled = answered;
  }

  function showFeedback(q, chosenLetter) {
    const isCorrect = chosenLetter === q.correct_answer;
    el.qFeedback.classList.remove("hidden");
    el.qFeedback.classList.toggle("feedback-correct", isCorrect);
    el.qFeedback.classList.toggle("feedback-wrong", !isCorrect);
    el.qFeedback.textContent = isCorrect
      ? "Você acertou!"
      : `Você errou. Gabarito: ${q.correct_answer}`;

    [...el.qAlternatives.children].forEach((label) => {
      label.classList.remove("is-correct", "is-wrong");
      if (label.dataset.letter === q.correct_answer) label.classList.add("is-correct");
      else if (label.dataset.letter === chosenLetter) label.classList.add("is-wrong");
    });
  }

  function submitAnswer() {
    const q = currentQuestion();
    if (!q) return;

    const checked = el.qAlternatives.querySelector("input:checked");
    if (!checked) {
      setStatus("Selecione uma alternativa antes de responder.", true);
      return;
    }
    setStatus("");

    const letter = checked.value;
    state.answers[q.id] = letter;

    const isCorrect = letter === q.correct_answer;
    Stats.recordAnswer(q.discipline, isCorrect);
    updateStatsPanel();

    showFeedback(q, letter);
    el.answerBtn.disabled = true;

    if (state.mode === "simulado" && state.currentIndex === state.questions.length - 1) {
      const allAnswered = state.questions.every((question) => state.answers[question.id] !== undefined);
      if (allAnswered) {
        setTimeout(finishSimulado, 800);
      }
    }
  }

  function goToQuestion(delta) {
    const nextIndex = state.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= state.questions.length) return;
    state.currentIndex = nextIndex;
    renderQuestion();
  }

  function finishSimulado() {
    const total = state.questions.length;
    let correct = 0;
    state.questions.forEach((q) => {
      if (state.answers[q.id] === q.correct_answer) correct += 1;
    });

    el.resultsSummary.innerHTML = `
      <p class="results-score">${correct} / ${total} acertos</p>
      <p>${Math.round((correct / total) * 100)}% de aproveitamento neste simulado.</p>
    `;
    showView("results");
  }

  function updateStatsPanel() {
    const stats = Stats.getStats();
    const total = stats.correct + stats.wrong;
    const accuracy = total > 0 ? Math.round((stats.correct / total) * 100) : 0;

    el.statCorrect.textContent = stats.correct;
    el.statWrong.textContent = stats.wrong;
    el.statAccuracy.textContent = `${accuracy}%`;
  }

  function resetStats() {
    if (!confirm("Zerar suas estatísticas locais?")) return;
    Stats.resetStats();
    updateStatsPanel();
  }

  function backToPractice() {
    showView(null);
    setStatus("Escolha um ano e disciplina, ou inicie um simulado.");
  }

  function bindEvents() {
    el.loadBtn.addEventListener("click", loadPractice);
    el.simuladoBtn.addEventListener("click", startSimulado);
    el.resetStatsBtn.addEventListener("click", resetStats);

    el.answerBtn.addEventListener("click", submitAnswer);
    el.prevBtn.addEventListener("click", () => goToQuestion(-1));
    el.nextBtn.addEventListener("click", () => goToQuestion(1));
    el.backToPracticeBtn.addEventListener("click", backToPractice);
  }

  function init() {
    cacheDom();
    populateSelects();
    bindEvents();
    updateStatsPanel();
    setStatus("Escolha um ano e disciplina, ou inicie um simulado.");
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
