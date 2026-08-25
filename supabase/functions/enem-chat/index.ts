// QEnemSocial - Edge Function: enem-chat
// Chat com IA (DeepSeek) para tirar dúvidas sobre a questão que o aluno está vendo.
//
// POST /enem-chat
// Body: { sessionId: string, question: {...}, messages: [{ role: "user"|"assistant", content }] }
//
// Variáveis de ambiente esperadas:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetadas pela plataforma)
//   DEEPSEEK_API_KEY (secret configurado manualmente: supabase secrets set DEEPSEEK_API_KEY=...)

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

const MESSAGE_LIMIT = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 20;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface QuestionContext {
  year?: number;
  discipline?: string;
  context?: string;
  alternativesIntroduction?: string;
  alternatives?: { letter: string; text: string }[];
  correctAnswer?: string;
}

function isValidMessage(msg: unknown): msg is ChatMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.trim().length > 0 &&
    m.content.length <= MAX_MESSAGE_LENGTH
  );
}

function buildSystemPrompt(question: QuestionContext): string {
  const alternativesText = (question.alternatives ?? [])
    .map((a) => `${a.letter}) ${a.text}`)
    .join("\n");

  return [
    "Você é o Pepito, um tutor educacional especializado em ajudar estudantes a entenderem questões do ENEM.",
    "Responda SEMPRE em português do Brasil, de forma clara, direta e didática.",
    "Baseie suas respostas exclusivamente na questão fornecida abaixo. Não invente informações que não estejam no enunciado.",
    "Se o aluno perguntar por que uma alternativa está certa ou errada, explique o raciocínio passo a passo.",
    "Se a pergunta não tiver relação com esta questão, gentilmente redirecione o aluno de volta ao tema.",
    "Escreva em texto corrido, como numa conversa falada. Não use markdown: nada de asteriscos, hífens de lista, cabeçalhos ou negrito/itálico. Organize as ideias em parágrafos curtos e bem separados por uma linha em branco, em vez de listas.",
    "",
    `Ano: ${question.year ?? "não informado"}`,
    `Disciplina: ${question.discipline ?? "não informada"}`,
    "",
    "Enunciado:",
    question.context || "(sem enunciado)",
    "",
    question.alternativesIntroduction || "",
    "Alternativas:",
    alternativesText || "(sem alternativas)",
    "",
    `Gabarito (alternativa correta): ${question.correctAnswer ?? "não informado"}`,
  ].join("\n");
}

async function checkAndIncrementUsage(sessionId: string) {
  const { data: existing, error: selErr } = await supabase
    .from("chat_sessions")
    .select("message_count")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (selErr) throw new Error(`Falha ao consultar sessão de chat: ${selErr.message}`);

  const currentCount = existing?.message_count ?? 0;
  if (currentCount >= MESSAGE_LIMIT) {
    return { count: currentCount, limitReached: true };
  }

  const newCount = currentCount + 1;
  const { error: upsertErr } = await supabase
    .from("chat_sessions")
    .upsert(
      { session_id: sessionId, message_count: newCount, last_used_at: new Date().toISOString() },
      { onConflict: "session_id" },
    );

  if (upsertErr) throw new Error(`Falha ao atualizar sessão de chat: ${upsertErr.message}`);

  return { count: newCount, limitReached: false };
}

async function callDeepSeek(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.4,
      // 600 cortava explicações mais longas no meio da frase (raciocínio
      // incompleto). Português consome mais tokens por ideia que inglês, então
      // damos bastante margem para o Pepito sempre terminar o pensamento.
      max_tokens: 1024,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`DeepSeek respondeu ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const reply = choice?.message?.content;
  if (typeof reply !== "string") {
    throw new Error("Resposta inesperada da DeepSeek.");
  }

  // Mesmo com bastante margem, um raciocínio muito longo ainda pode bater no
  // limite. Nesse caso avisamos o aluno em vez de entregar o texto cortado
  // silenciosamente como se fosse a resposta completa.
  if (choice?.finish_reason === "length") {
    return `${reply}\n\n(A resposta ficou longa e foi cortada aqui. Pergunte "continue" se quiser o resto.)`;
  }

  return reply;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  if (!DEEPSEEK_API_KEY) {
    return jsonResponse({ error: "Chat indisponível: DEEPSEEK_API_KEY não configurada no projeto." }, 500);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId || sessionId.length > 100) {
      return jsonResponse({ error: "sessionId inválido." }, 400);
    }

    const question: QuestionContext = body.question ?? {};
    if (!question.context || !Array.isArray(question.alternatives)) {
      return jsonResponse({ error: "Contexto da questão ausente ou inválido." }, 400);
    }

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages = rawMessages.filter(isValidMessage).slice(-MAX_HISTORY_MESSAGES);

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return jsonResponse({ error: "É necessário enviar uma mensagem do aluno." }, 400);
    }

    const usage = await checkAndIncrementUsage(sessionId);
    if (usage.limitReached) {
      return jsonResponse(
        {
          error: `Limite de ${MESSAGE_LIMIT} mensagens atingido nesta sessão.`,
          usage: { count: usage.count, limit: MESSAGE_LIMIT },
        },
        429,
      );
    }

    const systemPrompt = buildSystemPrompt(question);
    const reply = await callDeepSeek([{ role: "system", content: systemPrompt }, ...messages]);

    return jsonResponse({
      reply,
      usage: { count: usage.count, limit: MESSAGE_LIMIT },
    });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro desconhecido" }, 500);
  }
});
