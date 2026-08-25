// QEnemSocial - acesso a questões (via Edge Function) e estatísticas locais

const Questions = (() => {
  async function callEdgeFunction(params) {
    const url = new URL(CONFIG.EDGE_FUNCTION_URL);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    });

    const res = await fetch(url.toString(), {
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erro ao buscar questões (HTTP ${res.status})`);
    }

    return res.json();
  }

  function fetchList({ year, discipline, language, limit = 10, offset = 0 }) {
    return callEdgeFunction({ mode: "list", year, discipline, language, limit, offset });
  }

  function fetchRandom({ year, discipline, language, limit = 10 }) {
    return callEdgeFunction({ mode: "random", year, discipline, language, limit });
  }

  return { fetchList, fetchRandom };
})();

const Stats = (() => {
  const STORAGE_KEY = "qenemsocial_stats";

  function getStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { correct: 0, wrong: 0, byDiscipline: {} };
    } catch {
      return { correct: 0, wrong: 0, byDiscipline: {} };
    }
  }

  function saveStats(stats) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }

  function recordAnswer(discipline, isCorrect) {
    const stats = getStats();
    if (isCorrect) stats.correct += 1;
    else stats.wrong += 1;

    if (!stats.byDiscipline[discipline]) {
      stats.byDiscipline[discipline] = { correct: 0, wrong: 0 };
    }
    if (isCorrect) stats.byDiscipline[discipline].correct += 1;
    else stats.byDiscipline[discipline].wrong += 1;

    saveStats(stats);
    return stats;
  }

  function resetStats() {
    const empty = { correct: 0, wrong: 0, byDiscipline: {} };
    saveStats(empty);
    return empty;
  }

  return { getStats, saveStats, recordAnswer, resetStats };
})();
