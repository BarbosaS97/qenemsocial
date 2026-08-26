-- QEnemSocial - remove questões com dados incompletos na fonte (enem.dev)
--
-- 6 questões do ENEM 2023 identificadas com problemas irrecuperáveis:
--   - id 1     (2023, nº 1,   linguagens)        -> imagem ausente na fonte (sentinela broken-image.svg)
--   - id 5133  (2023, nº 44,  linguagens)        -> imagem ausente na fonte
--   - id 5147  (2023, nº 56,  ciencias-humanas)  -> imagem ausente na fonte
--   - id 5156  (2023, nº 65,  ciencias-humanas)  -> imagem ausente na fonte
--   - id 5220  (2023, nº 129, matematica)        -> imagem ausente na fonte
--   - id 5223  (2023, nº 132, matematica)        -> alternativas A-D sem texto e sem imagem
--
-- Confirmado via consulta direta antes de gerar este script: são exatamente
-- essas 6 linhas em todo o banco (2.689 questões) — nenhuma outra bate nos
-- mesmos critérios (sentinela "broken-image" no context, ou alguma
-- alternativa sem text e sem file ao mesmo tempo).

delete from public.enem_questions
where id in (1, 5133, 5147, 5156, 5220, 5223);
