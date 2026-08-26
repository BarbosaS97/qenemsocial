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
const CUSTOM_SIMULADO_MAX_PER_DISCIPLINE = 45;

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

    el.customSimuladoBtn = document.getElementById("custom-simulado-btn");
    el.customSimuladoModal = document.getElementById("custom-simulado-modal");
    el.customSimuladoClose = document.getElementById("custom-simulado-close");
    el.customSimuladoYear = document.getElementById("custom-simulado-year");
    el.customSimuladoRows = document.getElementById("custom-simulado-rows");
    el.customSimuladoTotal = document.getElementById("custom-simulado-total");
    el.customSimuladoGenerate = document.getElementById("custom-simulado-generate");
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

  // Não existe LaTeX nos dados da API enem.dev — o que aparecia como "código
  // bruto" era markdown que nunca era interpretado: **negrito** (citações
  // bibliográficas) e colchetes escapados \[…\] (reticência de trecho
  // omitido, comum em textos de Linguagens). Escapamos o HTML primeiro (segurança)
  // e só depois aplicamos essas duas transformações.
  function formatInlineText(str) {
    let html = escapeHtml(str);
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\\([[\]()*_\\])/g, "$1");
    return html;
  }

  // A própria API enem.dev usa essa URL como valor-sentinela para "não temos
  // essa imagem" (renderiza um cartum "Sorry! This image is broken..." com
  // link para abrir PR no repositório deles). Não é uma URL nossa quebrada —
  // é uma lacuna real nos dados de origem (rara: ~5 de 2.689 questões, todas
  // do ENEM 2023). Trocamos pelo nosso próprio aviso, mais discreto.
  function isMissingImagePlaceholder(url) {
    return url.includes("broken-image");
  }

  function renderImageOrPlaceholder(url) {
    if (isMissingImagePlaceholder(url)) {
      return `<div class="q-image-missing">Imagem não disponível para esta questão.</div>`;
    }
    return `<img class="q-image" src="${escapeHtml(url)}" alt="Imagem da questão" loading="lazy">`;
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
      html += formatInlineText(text.slice(lastIndex, match.index)).replace(/\n/g, "<br>");
      html += renderImageOrPlaceholder(match[1]);
      usedFiles.add(match[1]);
      lastIndex = imageRegex.lastIndex;
    }
    html += formatInlineText(text.slice(lastIndex)).replace(/\n/g, "<br>");

    (files || []).forEach((url) => {
      if (!usedFiles.has(url)) {
        html += renderImageOrPlaceholder(url);
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

  // Simulado personalizado: o aluno escolhe quantas questões quer de cada
  // disciplina (ex: 5 Linguagens + 3 Ciências Humanas + 7 Matemática = 15).
  // Complementa o "Simulado" de 10 questões aleatórias, não o substitui —
  // quem quer rapidez continua usando o botão de sempre.
  const customSimuladoInputs = {}; // { [disciplineValue]: <input> }

  function renderCustomSimuladoRows() {
    if (el.customSimuladoRows.childElementCount > 0) return; // só monta uma vez

    DISCIPLINES.filter((d) => d.value !== "").forEach((d) => {
      const row = document.createElement("div");
      row.className = "custom-simulado-row";

      const label = document.createElement("span");
      label.className = "custom-simulado-row-label";
      label.textContent = d.label;

      const stepper = document.createElement("div");
      stepper.className = "stepper";

      const decrementBtn = document.createElement("button");
      decrementBtn.type = "button";
      decrementBtn.className = "stepper-btn";
      decrementBtn.dataset.action = "decrement";
      decrementBtn.dataset.discipline = d.value;
      decrementBtn.setAttribute("aria-label", `Diminuir questões de ${d.label}`);
      decrementBtn.textContent = "−";

      const input = document.createElement("input");
      input.type = "number";
      input.className = "stepper-input";
      input.min = "0";
      input.max = String(CUSTOM_SIMULADO_MAX_PER_DISCIPLINE);
      input.value = "0";
      input.inputMode = "numeric";
      input.dataset.discipline = d.value;
      input.setAttribute("aria-label", `Quantidade de questões de ${d.label}`);

      const incrementBtn = document.createElement("button");
      incrementBtn.type = "button";
      incrementBtn.className = "stepper-btn";
      incrementBtn.dataset.action = "increment";
      incrementBtn.dataset.discipline = d.value;
      incrementBtn.setAttribute("aria-label", `Aumentar questões de ${d.label}`);
      incrementBtn.textContent = "+";

      stepper.appendChild(decrementBtn);
      stepper.appendChild(input);
      stepper.appendChild(incrementBtn);
      row.appendChild(label);
      row.appendChild(stepper);
      el.customSimuladoRows.appendChild(row);

      customSimuladoInputs[d.value] = input;
    });
  }

  function clampCustomSimuladoInput(input) {
    const value = Math.round(Number(input.value));
    const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), CUSTOM_SIMULADO_MAX_PER_DISCIPLINE);
    input.value = String(clamped);
    return clamped;
  }

  function updateCustomSimuladoTotal() {
    const total = Object.values(customSimuladoInputs).reduce(
      (sum, input) => sum + clampCustomSimuladoInput(input),
      0,
    );
    el.customSimuladoTotal.textContent = `${total} questõ${total === 1 ? "e" : "es"} selecionada${total === 1 ? "" : "s"}`;
    el.customSimuladoGenerate.disabled = total === 0;
    return total;
  }

  function openCustomSimuladoModal() {
    renderCustomSimuladoRows();
    el.customSimuladoYear.textContent = el.yearSelect.value;
    updateCustomSimuladoTotal();
    el.customSimuladoModal.classList.remove("hidden");
    const firstInput = el.customSimuladoRows.querySelector(".stepper-input");
    if (firstInput) firstInput.focus();
  }

  function closeCustomSimuladoModal() {
    el.customSimuladoModal.classList.add("hidden");
  }

  async function startCustomSimulado() {
    const selections = Object.entries(customSimuladoInputs)
      .map(([discipline, input]) => ({ discipline, count: clampCustomSimuladoInput(input) }))
      .filter((s) => s.count > 0);

    if (selections.length === 0) return;

    const year = el.yearSelect.value;
    const requestedTotal = selections.reduce((sum, s) => sum + s.count, 0);

    closeCustomSimuladoModal();
    state.mode = "simulado";
    state.filters.year = year;
    state.filters.discipline = "";

    setStatus("Montando seu simulado personalizado...");
    showView(null);

    try {
      const results = await Promise.all(
        selections.map((s) => Questions.fetchRandom({ year, discipline: s.discipline, limit: s.count })),
      );

      const questions = results.flatMap((r) => r.questions || []);

      if (questions.length === 0) {
        setStatus("Não foi possível montar o simulado — nenhuma questão encontrada para esse ano e essas disciplinas.", true);
        return;
      }

      // Embaralha para misturar as disciplinas em vez de vir em blocos.
      const shuffled = questions.sort(() => Math.random() - 0.5);

      state.questions = shuffled;
      state.currentIndex = 0;
      state.answers = {};

      if (questions.length < requestedTotal) {
        setStatus(
          `Encontramos ${questions.length} de ${requestedTotal} questões pedidas para ${year} (algumas disciplinas tinham menos disponíveis).`,
        );
      } else {
        setStatus("");
      }

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
        span.insertAdjacentHTML("beforeend", ` ${formatInlineText(alt.text)}`);
      }

      if (alt.file) {
        if (isMissingImagePlaceholder(alt.file)) {
          span.insertAdjacentHTML("beforeend", `<div class="q-image-missing">Imagem não disponível para esta alternativa.</div>`);
        } else {
          const img = document.createElement("img");
          img.src = alt.file;
          img.alt = `Alternativa ${alt.letter}`;
          img.className = "alt-image";
          img.loading = "lazy";
          span.appendChild(img);
        }
      } else if (!alt.text) {
        // Raro, mas acontece na fonte de dados: alternativa sem texto E sem
        // imagem (ex: questão com gráficos como opções, onde só algumas
        // imagens foram capturadas). Sem isso, a alternativa aparece em
        // branco, parecendo quebrada.
        span.insertAdjacentHTML("beforeend", `<span class="alt-missing">Conteúdo não disponível para esta alternativa.</span>`);
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
    el.resetStatsBtn.addEventListener("click", resetStats);

    el.answerBtn.addEventListener("click", submitAnswer);
    el.prevBtn.addEventListener("click", () => goToQuestion(-1));
    el.nextBtn.addEventListener("click", () => goToQuestion(1));
    el.backToPracticeBtn.addEventListener("click", backToPractice);

    el.customSimuladoBtn.addEventListener("click", openCustomSimuladoModal);
    el.customSimuladoClose.addEventListener("click", closeCustomSimuladoModal);
    el.customSimuladoGenerate.addEventListener("click", startCustomSimulado);

    el.customSimuladoModal.addEventListener("click", (e) => {
      if (e.target === el.customSimuladoModal) closeCustomSimuladoModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.customSimuladoModal.classList.contains("hidden")) {
        closeCustomSimuladoModal();
      }
    });

    el.customSimuladoRows.addEventListener("click", (e) => {
      const btn = e.target.closest(".stepper-btn");
      if (!btn) return;
      const input = customSimuladoInputs[btn.dataset.discipline];
      const current = clampCustomSimuladoInput(input);
      const delta = btn.dataset.action === "increment" ? 1 : -1;
      input.value = String(current + delta);
      updateCustomSimuladoTotal();
    });

    el.customSimuladoRows.addEventListener("input", (e) => {
      if (e.target.classList.contains("stepper-input")) updateCustomSimuladoTotal();
    });
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
