// QEnemSocial - Pepito, o chat flutuante com IA (DeepSeek)
// Escuta o evento "qenemsocial:question" (disparado por app.js) para saber
// qual questão está em tela e usar como contexto do chat.
//
// A folha do chat (chat-sheet) ocupa o rodapé inteiro e tem altura livre,
// controlada pelo usuário arrastando a lapela (chat-tab) entre 0 (só a
// lapela visível) e quase o topo da tela.

const Pepito = (() => {
  const SESSION_KEY = "qenemsocial_chat_session";
  const HISTORY_STORAGE_KEY = "qenemsocial_chat_history";
  const MAX_STORED_CONVERSATIONS = 50;
  const TRANSITION = "height 0.32s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
  const TOP_MARGIN = 16;
  const DEFAULT_OPEN_RATIO = 0.6;
  const DEFAULT_OPEN_MAX = 640;
  const TYPING_DELAY_MIN = 25;
  const TYPING_DELAY_RANGE = 35;
  const REQUEST_TIMEOUT_MS = 30000;
  const SCROLL_STICK_THRESHOLD = 60;

  const state = {
    height: 0,
    question: null,
    history: [],
    messageCount: 0,
    limitReached: false,
    sending: false,
  };

  const el = {};
  let typingToken = 0;

  function getSessionId() {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  // Conversa com o Pepito guardada por questão (localStorage, sobrevive a
  // recarregar a página e a trocar de questão e voltar). O limite de
  // mensagens da sessão continua controlado à parte (sessionStorage +
  // servidor) — isso aqui é só o HISTÓRICO de texto, não afeta a cota.
  function loadAllHistories() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveAllHistories(all) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // localStorage cheio ou indisponível (ex: modo privado) — ignora
      // silenciosamente, a conversa só não persiste desta vez.
    }
  }

  function loadHistoryForQuestion(questionId) {
    const all = loadAllHistories();
    return all[questionId]?.messages || [];
  }

  function saveHistoryForQuestion(questionId, history) {
    const all = loadAllHistories();

    if (history.length === 0) {
      delete all[questionId];
    } else {
      all[questionId] = { messages: history, updatedAt: Date.now() };
    }

    // Chaves numéricas em objetos JS são reordenadas pelo motor (ordem
    // crescente), não pela ordem de inserção — por isso guardamos updatedAt
    // e ordenamos por ele na hora de decidir o que descartar, em vez de
    // confiar na ordem das chaves.
    const entries = Object.entries(all);
    if (entries.length > MAX_STORED_CONVERSATIONS) {
      entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const excess = entries.length - MAX_STORED_CONVERSATIONS;
      for (let i = 0; i < excess; i += 1) delete all[entries[i][0]];
    }

    saveAllHistories(all);
  }

  function cacheDom() {
    el.sheet = document.getElementById("chat-sheet");
    el.tab = document.getElementById("chat-tab");
    el.toggleIcon = document.getElementById("chat-toggle-icon");
    el.messages = document.getElementById("chat-messages");
    el.form = document.getElementById("chat-form");
    el.input = document.getElementById("chat-input");
    el.sendBtn = document.getElementById("chat-send-btn");
    el.usage = document.getElementById("chat-usage");
  }

  function getMaxHeight() {
    return window.innerHeight - TOP_MARGIN;
  }

  function getDefaultOpenHeight() {
    return Math.min(window.innerHeight * DEFAULT_OPEN_RATIO, DEFAULT_OPEN_MAX);
  }

  // Altura livre: a folha e a lapela são sincronizadas pelo mesmo valor,
  // então a lapela sempre acompanha a borda superior da folha.
  function setHeight(px, animate) {
    const clamped = Math.min(Math.max(px, 0), getMaxHeight());
    const transition = animate ? TRANSITION : "none";
    el.sheet.style.transition = transition;
    el.tab.style.transition = transition;
    el.sheet.style.height = `${clamped}px`;
    el.tab.style.bottom = `${clamped}px`;
    state.height = clamped;

    const isOpen = clamped > 0;
    el.tab.setAttribute("aria-expanded", String(isOpen));
    el.toggleIcon.textContent = isOpen ? "⌄" : "⌃";
  }

  function setupDrag() {
    let dragging = false;
    let moved = false;
    let startY = 0;
    let startHeight = 0;
    let suppressClick = false;

    el.tab.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      startY = e.clientY;
      startHeight = state.height;
      el.tab.setPointerCapture(e.pointerId);
    });

    el.tab.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const delta = startY - e.clientY; // arrastar para cima aumenta a altura
      if (Math.abs(delta) > 4) moved = true;
      setHeight(startHeight + delta, false);
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        // Arraste livre: fica exatamente onde o usuário soltou, sem "encaixar".
        suppressClick = true;
      }
    }

    el.tab.addEventListener("pointerup", endDrag);
    el.tab.addEventListener("pointercancel", endDrag);

    el.tab.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      // Toque simples (sem arrastar) alterna entre fechado e uma altura confortável.
      setHeight(state.height > 0 ? 0 : getDefaultOpenHeight(), true);
    });

    window.addEventListener("resize", () => {
      if (!dragging) setHeight(state.height, false);
    });
  }

  // Rede de segurança: mesmo pedindo à IA para não usar markdown, removemos
  // qualquer asterisco/traço/cabeçalho que ainda escape, para o texto sempre
  // fluir como uma conversa normal, sem símbolos de formatação visíveis.
  function sanitizeAssistantText(text) {
    return text
      .replace(/```([\s\S]*?)```/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/_([^_\n]+)_/g, "$1")
      .replace(/^[ \t]*[-*•]\s+/gm, "")
      .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Rolagem "grudenta": só acompanha o fundo automaticamente se o usuário já
  // estava perto do fim. Se ele rolar para cima pra reler algo, a digitação
  // não briga mais com o gesto dele puxando a tela de volta pra baixo a cada
  // palavra — isso é o que fazia a rolagem parecer imprecisa.
  function isNearBottom() {
    const { scrollHeight, scrollTop, clientHeight } = el.messages;
    return scrollHeight - scrollTop - clientHeight < SCROLL_STICK_THRESHOLD;
  }

  function scrollMessagesToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function appendMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `chat-message role-${role}`;
    bubble.textContent = text;
    el.messages.appendChild(bubble);
    scrollMessagesToBottom();
    return bubble;
  }

  // Efeito de digitação: revela a resposta palavra por palavra, com uma
  // pequena variação de tempo para parecer mais natural. Cancela sozinho
  // se uma nova questão for carregada (ou o chat resetado) no meio do efeito.
  function typeMessage(bubbleEl, fullText) {
    const token = typingToken;
    const tokens = fullText.split(/(\s+)/).filter((t) => t.length > 0);
    bubbleEl.textContent = "";

    return new Promise((resolve) => {
      let i = 0;
      function step() {
        if (token !== typingToken || i >= tokens.length) {
          resolve();
          return;
        }
        const shouldStick = isNearBottom();
        bubbleEl.textContent += tokens[i];
        i += 1;
        if (shouldStick) scrollMessagesToBottom();
        setTimeout(step, TYPING_DELAY_MIN + Math.random() * TYPING_DELAY_RANGE);
      }
      step();
    });
  }

  function disciplineLabel(question) {
    return question.discipline || "questão";
  }

  function resetChat(question) {
    typingToken += 1;
    state.question = question;
    el.messages.innerHTML = "";

    const savedHistory = question.id != null ? loadHistoryForQuestion(question.id) : [];

    if (savedHistory.length > 0) {
      // Já tem conversa guardada pra essa questão: restaura as bolhas exatas
      // em vez de mostrar de novo a intro de "nova questão" (não é nova).
      state.history = savedHistory;
      savedHistory.forEach((msg) => appendMessage(msg.role, msg.content));
    } else {
      state.history = [];
      appendMessage(
        "system",
        `Sou o Pepito! Nova questão carregada (${disciplineLabel(question)} · ${question.year}). Pergunte o que quiser sobre ela.`,
      );
    }

    updateInputAvailability();
  }

  function updateUsageUI() {
    el.usage.textContent = `${state.messageCount}/${CONFIG.CHAT_MESSAGE_LIMIT} mensagens`;
  }

  function updateInputAvailability() {
    const noQuestion = !state.question;
    const blocked = state.limitReached || noQuestion || state.sending;
    el.input.disabled = blocked;
    el.sendBtn.disabled = blocked;
    el.input.placeholder = state.limitReached
      ? "Limite de mensagens atingido nesta sessão"
      : noQuestion
      ? "Carregue uma questão para conversar..."
      : "Pergunte ao Pepito sobre a questão...";
  }

  function buildQuestionPayload(q) {
    return {
      year: q.year,
      discipline: q.discipline,
      context: q.context || q.title || "",
      alternativesIntroduction: q.alternatives_introduction || "",
      alternatives: (q.alternatives || []).map((a) => ({ letter: a.letter, text: a.text })),
      correctAnswer: q.correct_answer,
    };
  }

  async function sendMessage(text) {
    if (!state.question || state.limitReached || state.sending) return;

    state.sending = true;
    updateInputAvailability();

    appendMessage("user", text);
    state.history.push({ role: "user", content: text });

    const typingBubble = appendMessage("assistant", "Pepito está digitando...");
    typingBubble.classList.add("chat-typing");

    // Timeout explícito: sem isso, se a DeepSeek ou a Edge Function travarem,
    // o chat fica preso em "digitando..." pra sempre, sem nenhuma saída a não
    // ser recarregar a página.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(CONFIG.CHAT_FUNCTION_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          sessionId: getSessionId(),
          question: buildQuestionPayload(state.question),
          messages: state.history,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        typingBubble.remove();
        state.history.pop();
        if (res.status === 429) {
          state.limitReached = true;
          appendMessage("system", body.error || "Limite de mensagens atingido nesta sessão.");
        } else {
          appendMessage("system", body.error || `Erro ao consultar a IA (HTTP ${res.status}).`);
        }
        return;
      }

      const cleaned = sanitizeAssistantText(body.reply);
      state.history.push({ role: "assistant", content: cleaned });
      if (state.question.id != null) saveHistoryForQuestion(state.question.id, state.history);

      typingBubble.classList.remove("chat-typing");
      await typeMessage(typingBubble, cleaned);

      if (body.usage) {
        state.messageCount = body.usage.count;
        state.limitReached = body.usage.count >= body.usage.limit;
        updateUsageUI();
      }
    } catch (err) {
      typingBubble.remove();
      state.history.pop();
      const message =
        err.name === "AbortError"
          ? "O Pepito demorou demais para responder. Tente novamente."
          : `Erro de conexão: ${err.message}`;
      appendMessage("system", message);
    } finally {
      clearTimeout(timeoutId);
      state.sending = false;
      updateInputAvailability();
    }
  }

  function bindEvents() {
    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = el.input.value.trim();
      if (!text) return;
      el.input.value = "";
      sendMessage(text);
    });

    setupDrag();

    document.addEventListener("qenemsocial:question", (e) => {
      resetChat(e.detail);
    });
  }

  function init() {
    cacheDom();
    setHeight(0, false);
    updateInputAvailability();
    updateUsageUI();
    bindEvents();
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", Pepito.init);
