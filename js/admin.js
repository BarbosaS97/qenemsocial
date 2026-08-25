// QEnemSocial - painel admin
// Guarda a chave de administrador em sessionStorage (some ao fechar a aba) e
// só a valida de verdade quando a Edge Function responde — não há como
// "validar localmente" uma chave secreta sem perguntar ao servidor.

const Admin = (() => {
  const ADMIN_KEY_STORAGE = "qenemsocial_admin_key";

  const el = {};

  function cacheDom() {
    el.gate = document.getElementById("admin-gate");
    el.content = document.getElementById("admin-content");
    el.keyForm = document.getElementById("admin-key-form");
    el.keyInput = document.getElementById("admin-key-input");
    el.error = document.getElementById("admin-error");
    el.importBtn = document.getElementById("import-btn");
    el.status = document.getElementById("import-status");
    el.log = document.getElementById("import-log");
    el.fromYear = document.getElementById("from-year-input");
    el.toYear = document.getElementById("to-year-input");
  }

  function getStoredKey() {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE);
  }

  function setStoredKey(key) {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  }

  function clearStoredKey() {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  }

  function showGate(withError) {
    el.gate.classList.remove("hidden");
    el.content.classList.add("hidden");
    el.error.classList.toggle("hidden", !withError);
  }

  function showContent() {
    el.gate.classList.add("hidden");
    el.content.classList.remove("hidden");
  }

  function appendLog(line) {
    el.log.textContent += `${line}\n`;
    el.log.scrollTop = el.log.scrollHeight;
  }

  function handleEvent(event) {
    switch (event.type) {
      case "start":
        appendLog(`Importando provas de ${event.fromYear} a ${event.toYear}...`);
        break;
      case "year-start":
        appendLog(`Ano ${event.year}: buscando questões na API...`);
        break;
      case "batch":
        appendLog(`  Ano ${event.year}: +${event.batchSize} questões (total do ano: ${event.importedInYear})`);
        break;
      case "retry":
        appendLog(
          `  Ano ${event.year}: API pediu para esperar (limite de requisições). Tentando de novo em ${Math.round(
            event.waitMs / 1000,
          )}s (tentativa ${event.attempt}/${event.maxAttempts})...`,
        );
        break;
      case "year-done":
        appendLog(`Ano ${event.year} concluído: ${event.imported} questões importadas.`);
        el.status.textContent = `${event.totalImported} questões importadas até agora (último ano processado: ${event.year})...`;
        break;
      case "done":
        appendLog(`Concluído! ${event.totalImported} questões importadas no total.`);
        el.status.textContent = `Concluído: ${event.totalImported} questões importadas.`;
        break;
      case "rate-limited": {
        const minutes = Math.ceil(event.retryAfterSeconds / 60);
        appendLog(
          `A API pediu uma espera longa demais (~${minutes} min) para continuar com segurança dentro de uma única chamada.`,
        );
        appendLog(`Parada em segurança no ano ${event.year}. Aguarde uns minutos e clique em importar de novo.`);
        el.status.textContent = `Pausado no ano ${event.year} — espere ~${minutes} min e importe de novo (o campo "De" já foi ajustado).`;
        el.fromYear.value = String(event.year);
        break;
      }
      case "error":
        appendLog(`Erro: ${event.message}`);
        el.status.textContent = "A importação parou por causa de um erro (veja o log).";
        break;
      default:
        break;
    }
  }

  async function runImport(key) {
    el.importBtn.disabled = true;
    el.log.textContent = "";
    el.status.textContent = "Iniciando importação...";

    const fromYear = Number(el.fromYear.value) || 2009;
    const toYear = Number(el.toYear.value) || 2023;

    try {
      const res = await fetch(CONFIG.IMPORT_FUNCTION_URL, {
        method: "POST",
        headers: {
          "x-admin-key": key,
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fromYear, toYear }),
      });

      if (res.status === 401) {
        clearStoredKey();
        showGate(true);
        return;
      }

      if (!res.ok || !res.body) {
        appendLog(`Erro ao iniciar importação (HTTP ${res.status}).`);
        el.status.textContent = "Falhou.";
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleEvent(JSON.parse(line));
          } catch {
            // linha incompleta ou inválida: ignora, o buffer já cuida de remontar
          }
        }
      }
    } catch (err) {
      appendLog(`Erro de conexão: ${err.message}`);
      el.status.textContent = "Falhou.";
    } finally {
      el.importBtn.disabled = false;
    }
  }

  function bindEvents() {
    el.keyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = el.keyInput.value.trim();
      if (!key) return;
      setStoredKey(key);
      el.keyInput.value = "";
      showContent();
    });

    el.importBtn.addEventListener("click", () => {
      const key = getStoredKey();
      if (!key) {
        showGate(false);
        return;
      }
      runImport(key);
    });
  }

  function init() {
    cacheDom();
    bindEvents();
    if (getStoredKey()) {
      showContent();
    } else {
      showGate(false);
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", Admin.init);
