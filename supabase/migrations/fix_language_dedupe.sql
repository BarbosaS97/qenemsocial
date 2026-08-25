-- QEnemSocial - correção: questões duplicadas na tabela enem_questions
--
-- Causa raiz: a constraint "unique (year, number, language)" nunca pegava
-- duplicatas em linhas com language = NULL, porque no Postgres NULL nunca é
-- considerado igual a NULL numa UNIQUE constraint padrão. Toda vez que a
-- importação rodava de novo, cada questão sem variação de idioma (a grande
-- maioria — só as de espanhol/inglês têm language preenchido) virava uma
-- linha NOVA em vez de atualizar a existente.
--
-- Este script: (1) remove as duplicatas mantendo a linha mais recente de
-- cada grupo, (2) normaliza language para nunca mais ser NULL (usa '' no
-- lugar), o que faz a constraint existente voltar a funcionar de verdade.

-- Passo 1: remove duplicatas, mantendo só a linha de maior id em cada grupo
-- (year, number, language) — "is not distinct from" trata NULL = NULL
-- corretamente aqui, ao contrário da constraint.
delete from public.enem_questions a
using public.enem_questions b
where a.year = b.year
  and a.number = b.number
  and a.language is not distinct from b.language
  and a.id < b.id;

-- Passo 2: normaliza NULL -> '' e trava a coluna como NOT NULL, para a
-- constraint (year, number, language) passar a funcionar de verdade daqui
-- para frente (string vazia É comparável consigo mesma; NULL não é).
update public.enem_questions set language = '' where language is null;
alter table public.enem_questions alter column language set default '';
alter table public.enem_questions alter column language set not null;
