// QEnemSocial - Edge Function: import-questions
// Importa TODAS as questões da API enem.dev (2009-2023) para o cache no
// Supabase, incluindo imagens (campo files). Devolve o progresso em tempo
// real via streaming NDJSON (uma linha JSON por evento).
//
// POST /import-questions
// Header obrigatório: x-admin-key: <ADMIN_SECRET>
//
// Variáveis de ambiente esperadas:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetadas pela plataforma)
//   ADMIN_SECRET (secret manual: supabase secrets set ADMIN_SECRET=...)
//   ENEM_API_BASE_URL (opcional, default https://api.enem.dev/v1)
//
// SEGURANÇA: o atalho de teclado no frontend (Ctrl+Alt+Shift+A) é só uma
// conveniência de navegação — não protege nada, qualquer pessoa pode ler o
// JS e descobrir o atalho. A proteção de verdade é a checagem de
// ADMIN_SECRET abaixo. Este projeto não tem sistema de login/usuários (é
// "sem cadastro" por design), então não existe uma coluna is_admin real para
// consultar; esta chave compartilhada é o substituto seguro e pragmático até
// que exista autenticação de verdade.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
const ENEM_API_BASE_URL = Deno.env.get("ENEM_API_BASE_URL") ?? "https://api.enem.dev/v1";

const MIN_YEAR = 2009;
const MAX_YEAR = 2023;
const BATCH_SIZE = 50;
const QUESTIONS_PER_YEAR_CAP = 200; // uma prova completa cabe nisso, com folga

// A API enem.dev aplica rate limit (HTTP 429) e, quando isso acontece, pede
// esperas bem longas (Retry-After de até ~5 minutos). Dormir isso tudo dentro
// de uma única invocação da Edge Function não é seguro: a plataforma mata
// funções que rodam além do limite de execução (bem menor que 5 minutos), o
// que trava o cliente sem nenhum erro claro. Por isso: pausas proativas bem
// mais folgadas (evita bater no limite) + um teto curto de espera por retry
// (se a API pedir mais que isso, desistimos daquela tentativa e avisamos o
// admin com o ano exato para retomar, em vez de travar a function).
const BATCH_DELAY_MS = 1500;
const YEAR_DELAY_MS = 2500;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 3000;
const RETRY_MAX_WAIT_MS = 15000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface RawAlternative {
  letter: string;
  text: string;
  file?: string | null;
}

interface RawQuestion {
  title?: string;
  index: number;
  discipline?: string;
  language?: string | null;
  context?: string | null;
  alternativesIntroduction?: string | null;
  alternatives: RawAlternative[];
  correctAlternative: string;
  files?: string[];
}

function normalizeQuestion(raw: RawQuestion, year: number) {
  return {
    year,
    number: raw.index,
    discipline: raw.discipline ?? "desconhecida",
    // "" em vez de null: NULL nunca é igual a NULL numa UNIQUE constraint do
    // Postgres, o que quebrava o upsert (year, number, language) e duplicava
    // toda questão sem variação de idioma a cada nova importação.
    language: raw.language ?? "",
    title: raw.title ?? null,
    context: raw.context ?? null,
    alternatives_introduction: raw.alternativesIntroduction ?? null,
    alternatives: (raw.alternatives ?? []).map((a) => ({
      letter: a.letter,
      text: a.text,
      file: a.file ?? null,
    })),
    correct_answer: raw.correctAlternative,
    files: raw.files ?? [],
  };
}

type Emit = (event: Record<string, unknown>) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchPage {
  questions: RawQuestion[];
  // A API às vezes devolve menos itens que o "limit" pedido no MEIO dos
  // dados, não só no fim — então "veio menos que o pedido" não pode ser o
  // sinal de "acabou". O sinal correto é este hasMore vindo da própria API.
  hasMore: boolean;
}

async function fetchFromEnemApi(
  year: number,
  limit: number,
  offset: number,
  emit: Emit,
): Promise<FetchPage> {
  const url = `${ENEM_API_BASE_URL}/exams/${year}/questions?limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const res = await fetch(url);

    if (res.ok) {
      const data = await res.json();
      const questions: RawQuestion[] = Array.isArray(data)
        ? (data as RawQuestion[])
        : Array.isArray(data?.questions)
        ? (data.questions as RawQuestion[])
        : [];
      // Fallback defensivo caso metadata.hasMore não venha: assume que só
      // acabou quando o lote vier vazio (nunca por ele vir "curto").
      const hasMore = typeof data?.metadata?.hasMore === "boolean" ? data.metadata.hasMore : questions.length > 0;
      return { questions, hasMore };
    }

    // 429 = rate limit da API externa.
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const requestedWaitMs = Number.isFinite(retryAfterMs)
        ? retryAfterMs
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

      // A API às vezes pede minutos de espera. Dormir isso tudo dentro da
      // function é arriscado (a plataforma pode matá-la antes), então só
      // esperamos até um teto curto e sobrevivível; se precisar de mais que
      // isso, desistimos JÁ e avisamos quanto tempo esperar e em que ano
      // retomar, em vez de travar a function tentando aguentar o tempo todo.
      if (requestedWaitMs > RETRY_MAX_WAIT_MS) {
        throw new Error(
          `RATE_LIMIT:${year}:${Math.ceil(requestedWaitMs / 1000)}`,
        );
      }

      if (attempt < MAX_FETCH_ATTEMPTS) {
        emit({ type: "retry", year, offset, attempt, maxAttempts: MAX_FETCH_ATTEMPTS, waitMs: requestedWaitMs });
        await sleep(requestedWaitMs);
        continue;
      }
    }

    throw new Error(`enem.dev respondeu ${res.status} para ${url}`);
  }

  throw new Error(`enem.dev continuou limitando a taxa de requisições para ${url} após ${MAX_FETCH_ATTEMPTS} tentativas`);
}

async function importYear(year: number, emit: Emit): Promise<number> {
  let offset = 0;
  let imported = 0;

  while (imported < QUESTIONS_PER_YEAR_CAP) {
    const { questions, hasMore } = await fetchFromEnemApi(year, BATCH_SIZE, offset, emit);
    if (questions.length === 0) break;

    const rows = questions.map((q) => normalizeQuestion(q, year));
    const { error } = await supabase
      .from("enem_questions")
      .upsert(rows, { onConflict: "year,number,language" });

    if (error) throw new Error(`Falha ao gravar ${year}: ${error.message}`);

    imported += questions.length;
    // Avança pela quantidade REAL recebida, não pelo BATCH_SIZE pedido — a
    // API pode devolver menos que o limite no meio dos dados (era a causa
    // do bug de 2019/2023 importarem só uma fração das questões).
    offset += questions.length;
    emit({ type: "batch", year, batchSize: questions.length, importedInYear: imported });

    if (!hasMore) break;

    // Pausa entre lotes do mesmo ano para não bater no rate limit de novo.
    await sleep(BATCH_DELAY_MS);
  }

  return imported;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  const adminKey = req.headers.get("x-admin-key");
  if (!ADMIN_SECRET || !adminKey || adminKey !== ADMIN_SECRET) {
    return jsonResponse({ error: "Acesso negado." }, 401);
  }

  // fromYear/toYear opcionais no corpo: permitem retomar a importação a
  // partir de um ano específico depois de um rate limit, em vez de sempre
  // ter que refazer os anos que já foram importados com sucesso.
  const body = await req.json().catch(() => ({}));
  const fromYear = Math.min(Math.max(Number(body?.fromYear) || MIN_YEAR, MIN_YEAR), MAX_YEAR);
  const toYear = Math.min(Math.max(Number(body?.toYear) || MAX_YEAR, fromYear), MAX_YEAR);

  const encoder = new TextEncoder();
  let totalImported = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (event) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        emit({ type: "start", fromYear, toYear });

        for (let year = fromYear; year <= toYear; year++) {
          emit({ type: "year-start", year });
          const imported = await importYear(year, emit);
          totalImported += imported;
          emit({ type: "year-done", year, imported, totalImported });

          if (year < toYear) await sleep(YEAR_DELAY_MS);
        }

        emit({ type: "done", totalImported });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro desconhecido";
        const rateLimitMatch = message.match(/^RATE_LIMIT:(\d+):(\d+)$/);

        if (rateLimitMatch) {
          emit({
            type: "rate-limited",
            year: Number(rateLimitMatch[1]),
            retryAfterSeconds: Number(rateLimitMatch[2]),
            totalImported,
          });
        } else {
          emit({ type: "error", message, totalImported });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...CORS_HEADERS, "Content-Type": "application/x-ndjson" },
  });
});
