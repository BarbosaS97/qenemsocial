-- QEnemSocial - chat com IA (enem-chat)
-- Controle de uso: até N mensagens por sessão de chat (sessionId gerado no navegador).

create table if not exists public.chat_sessions (
  session_id text primary key,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;

-- Nenhuma policy criada: só a service role (Edge Function enem-chat) acessa esta tabela.
-- GRANT explícito é obrigatório mesmo para a service role — RLS não substitui o
-- GRANT de base do Postgres (ver histórico do enem_questions).
grant select, insert, update on public.chat_sessions to service_role;
