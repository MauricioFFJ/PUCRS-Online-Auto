# Automação PUCRS Online – Assistir Aulas

Automação que:
- Faz login no Campus Digital (login Microsoft) com e-mail e senha definidos em Secrets.
- Entra em “Ver Disciplinas”, pega os dois primeiros links do trimestre atual.
- Para cada disciplina: dá play no vídeo (se houver), aguarda o término e clica em “Avançar”.
- Repete até “Avançar” não existir mais. Depois, repete na segunda disciplina.
- Salva trace e vídeos como artefatos do workflow para auditoria.

---

## Requisitos

- Definir secrets no repositório:
  - `EMAIL`: e-mail institucional.
  - `PASSWORD`: senha.
- Opcional: usar o input `discipline_list_url` do workflow para alterar a URL de lista de disciplinas.

---

## Como executar no GitHub Actions

1. Vá em Actions → “Assistir Vídeos PUCRS” → Run workflow.
2. (Opcional) Informe `discipline_list_url` (padrão: https://campusdigital.pucrs.br/courses/10?actions=disciplines/).
3. Acompanhe o job: os logs mostram cada passo agrupado por fase.
4. Ao final, baixe os artefatos:
   - `playwright-trace.zip` (trace interativo).
   - `session-videos/` (gravações da sessão).

---

## Execução local

```bash
# 1) Instalar dependências e navegadores
npm install
npx playwright install --with-deps

# 2) Exportar credenciais (somente local)
export EMAIL="seu-email@pucrs.br"
export PASSWORD="sua-senha"

# 3) Rodar
node src/assistir.js
