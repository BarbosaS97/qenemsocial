// QEnemSocial - Edge Function: enem-proxy
// Serve questões EXCLUSIVAMENTE do cache no Supabase (enem_questions).
//
// GET /enem-proxy?year=2022&discipline=matematica&language=&limit=10&offset=0
// GET /enem-proxy?mode=random&limit=10&year=2022&discipline=matematica
//
// Esta function não fala mais com a API enem.dev. O cache (2009-2023) foi
// populado inteiramente pela Edge Function import-questions, disparada
// manualmente pelo painel admin — esse é agora o único caminho autorizado
// para buscar dados na API externa. Isso evita que o tráfego normal de
// usuários dispare chamadas para uma API de terceiros com rate limit restrito
// (a causa de toda a dor de cabeça de importação já resolvida). Se algum
// ano/disciplina não estiver no cache, a resposta vem vazia em vez de tentar
// buscar ao vivo — para adicionar dados novos (ex: um ENEM futuro), rode a
// importação pelo painel admin.
//
// Variáveis de ambiente esperadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;

    const mode = params.get("mode") ?? "list";
    const year = params.get("year") ? Number(params.get("year")) : null;
    const discipline = params.get("discipline");
    const language = params.get("language");
    const limit = Math.min(Number(params.get("limit") ?? "20"), 60);
    const offset = Number(params.get("offset") ?? "0");

    if (mode === "random") {
      let query = supabase.from("enem_questions").select("*");
      if (year) query = query.eq("year", year);
      if (discipline) query = query.eq("discipline", discipline);
      if (language) query = query.eq("language", language);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const pool = data ?? [];
      const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, limit);
      return jsonResponse({ questions: shuffled, total: pool.length });
    }

    // mode === "list"
    if (!year) {
      return jsonResponse({ error: "Parâmetro 'year' é obrigatório para mode=list." }, 400);
    }

    let query = supabase
      .from("enem_questions")
      .select("*", { count: "exact" })
      .eq("year", year)
      .order("number", { ascending: true })
      .range(offset, offset + limit - 1);

    if (discipline) query = query.eq("discipline", discipline);
    if (language) query = query.eq("language", language);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    return jsonResponse({ questions: data, total: count, limit, offset });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro desconhecido" }, 500);
  }
});
