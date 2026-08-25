-- QEnemSocial - schema inicial
-- Cache local de questões do ENEM (fonte: api.enem.dev)

create table if not exists public.enem_questions (
  id bigserial primary key,
  year integer not null,
  number integer not null,
  discipline text not null,
  language text,
  title text,
  context text,
  alternatives_introduction text,
  alternatives jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint enem_questions_unique unique (year, number, language)
);

create index if not exists enem_questions_year_idx on public.enem_questions (year);
create index if not exists enem_questions_discipline_idx on public.enem_questions (discipline);
create index if not exists enem_questions_year_discipline_idx on public.enem_questions (year, discipline);

alter table public.enem_questions enable row level security;

-- Leitura pública (não há autenticação no sistema)
drop policy if exists "enem_questions_select_public" on public.enem_questions;
create policy "enem_questions_select_public"
  on public.enem_questions
  for select
  to anon, authenticated
  using (true);

-- Nenhuma policy de insert/update/delete é criada: com RLS habilitado,
-- apenas a service role (usada pela Edge Function) pode escrever na tabela.

-- GRANTs de privilégio (obrigatórios: RLS só se aplica depois que o GRANT
-- básico permite o acesso; sem isso, dá "permission denied" mesmo para
-- a service role, que ignora RLS mas não ignora ACL de tabela).
grant select on public.enem_questions to anon, authenticated;
grant select, insert, update, delete on public.enem_questions to service_role;
grant usage, select on sequence public.enem_questions_id_seq to service_role;
