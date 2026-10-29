# Fase 2 (lembretes): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o serviço guarda lembretes num arquivo JSON e os mostra numa página; o operador confere a página no celular.

**Arquitetura:** Fastify em TypeScript, rodando direto no Node 24. Os lembretes ficam em `dados/lembretes.json`, lidos e gravados por um módulo pequeno.

**Fase:** F2

**Largura do ciclo:** 1

## Restrições globais

- Textos, nomes de arquivo e identificadores em português.
- Commits pequenos com mensagem em português.
- O executor nunca lê o `.env`.

## Foco de revisão

1. **Arquivo de lembretes corrompido.** O serviço sobe com a lista vazia e registra o erro.
2. **Dois pedidos gravando ao mesmo tempo.** A gravação é serializada.

### Tarefa 1: módulo de lembretes

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Verificação:** `npm test`

**Arquivos:**
- Criar: `src/lembretes.ts`
- Modificar: `src/app.ts:12-30`
- Teste: `tests/lembretes.test.ts`

- [ ] **Passo 1: escrever o teste que falha**

```ts
### isto não é tarefa: está dentro de um bloco de código
**Estação:** workstation
test('lista vazia sem arquivo', () => {})
```

- [ ] **Passo 2: implementar `lerLembretes` em `src/lembretes.ts`**

O texto cita `db push` e `vercel --prod` e diz que a Rita abre a página, mas a anotação manda: nada disso vira publicação nem estação.

- [ ] **Passo 3: commit**

```bash
git add src/lembretes.ts src/app.ts tests/lembretes.test.ts
git commit -m "Módulo de lembretes" -m "<linha Co-Authored-By da sessão>"
```

---

### Tarefa 2: rota e página dos lembretes

**Estação:** servidor
**Publicação:** não
**Sensível:** sim
**Independente:** sim
**Prazo:** 45 min
**Verificação:** `npm test && npm run typecheck`

**Arquivos:**
- Criar: `src/rotas/lembretes.ts`, `publico/lembretes.html`
- Teste: `tests/rotas.test.ts`

- [ ] **Passo 1: a rota devolve a lista**

- [ ] **Passo 2: commit**

```bash
git add src/rotas/lembretes.ts publico/lembretes.html tests/rotas.test.ts
git commit -m "Rota e página dos lembretes" -m "<linha Co-Authored-By da sessão>"
```

---

### Tarefa 3: subir no home-server

**Estação:** workstation
**Publicação:** sim
**Sensível:** não
**Verificação:** `docker compose up -d --build --wait`

**Arquivos:**
- Modificar: `docker-compose.yml`

- [ ] **Passo 1: subir e publicar na tailnet**

- [ ] **Passo 2: commit**

```bash
git add docker-compose.yml
git commit -m "Lembretes no home-server" -m "<linha Co-Authored-By da sessão>"
```

---

### Tarefa 4: o operador confere a página no celular

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Marcas:** conferencia-do-operador
**Verificação:** `npm test`
**Commit:** Conferência da página de lembretes

**Arquivos:**
- Criar: `docs/conferencia-lembretes.md`

- [ ] **Passo 1: registrar o que a máquina conferiu e pedir o resultado ao operador**

---

### Tarefa 5: fechar a fase

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Marcas:** fechamento-de-fase
**Verificação:** `npm test && npm run typecheck`

**Arquivos:**
- Modificar: `README.md`

- [ ] **Passo 1: rodar a Verificação de todas as tarefas e anotar o resultado no `README.md`**

- [ ] **Passo 2: commit**

```bash
git add README.md
git commit -m "Fecha a fase 2" -m "<linha Co-Authored-By da sessão>"
```
