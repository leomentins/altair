# Despedida: plano de implementação

> **Para agentes:** use superpowers:subagent-driven-development ou superpowers:executing-plans para executar este plano tarefa por tarefa.

**Objetivo:** o projeto ganha uma despedida ao lado da saudação, com teste.

**Fase:** F1

**Modelo:** sonnet

**Largura do ciclo:** 1

## Restrições globais

- Sem dependência npm.

### Tarefa 1: a despedida

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Verificação:** `grep -q 'export function despedida' src/despedida.mjs`
**Commit:** EXEMPLO-1-despedida-F1/T1 — despedida

**Arquivos:**
- Criar: `src/despedida.mjs`

- [ ] **Passo 1: escrever `despedida(nome)` em `src/despedida.mjs`**
- [ ] **Passo 2: commit**

### Tarefa 2: fechamento da fase

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Marcas:** fechamento-de-fase
**Verificação:** `test -f src/despedida.mjs`
**Commit:** EXEMPLO-1-despedida-F1/T2 — fechamento de F1

**Arquivos:**
- Modificar: `README.md`

- [ ] **Passo 1: citar a despedida no README**
- [ ] **Passo 2: commit**
