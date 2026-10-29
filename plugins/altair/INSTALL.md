# Instalar a condução — plugin, declaração do projeto e os três hooks

> O plugin traz o núcleo da condução (`scripts/conducao/`), a skill (`skills/conducao/`) e três
> hooks (`hooks/`), registrados pelo próprio plugin em `hooks/hooks.json`. Nada do projeto mora
> aqui: o que é de cada projeto vem da declaração do adaptador, `.altair/adaptador.json` na raiz
> do repositório conduzido. Os dois guards com modo nascem em `shadow`: registram e não recusam
> nada até o operador promovê-los. Quem separa a filha das outras sessões é o pedido de
> nascimento (`hooks/lib/sessao-operaria.js`), não o usuário do SO.

## 1. Instalar o plugin

```bash
claude plugin marketplace add <endereço do repositório do altair>
claude plugin install altair@altair
```

A skill fica em `/altair:conducao`. Os verbos rodam por `node <raiz do plugin>/scripts/conducao/conducao.mjs`.

## 2. Declarar o projeto

Na raiz do repositório conduzido, `.altair/adaptador.json` (esquema:
`scripts/conducao/adaptador.schema.json`; exemplo completo: `exemplo/.altair/adaptador.json` do
repositório do plugin). O mínimo, com o plano no formato público:

```json
{
  "versao": 4,
  "codigo": "superpowers",
  "pagina": "docs/conducao.md",
  "projeto": "meu-projeto",
  "operadores": [{ "handle": "<handle>", "nome": "<nome>" }],
  "estado": { "pasta": "altair/conducao" },
  "log": { "pasta": "." },
  "pergunta": { "destino": "log" },
  "guardas": { "pastaDoModo": ".claude/state" }
}
```

- `codigo` — `superpowers` lê o plano público (`skills/conducao/references/conduzivel.md`); um
  projeto com formato próprio aponta um `.mjs` em `.altair/`.
- `pagina` — a página do projeto: carimbo de revisão, sonda do push do ramo, verbos de publicação.
- `verificacao` — opcional: `marcaSemCofre` (a variável que a Verificação embrulhada liga em `=1`;
  default `ALTAIR_SEM_COFRE_PRODUCAO`) e `variaveisDeProducao` (as que o embrulho tira do
  ambiente; default nenhuma).
- `guardas.pastaDoModo` — onde os dois guards com modo leem `<guard>-mode`. Sem o campo, ou sem o
  arquivo, eles rodam em `shadow`.
- `sessao` (versão 5) — o contrato do host que `conducao.mjs pre-voo` confere: `cli` (argv que
  lista os plugins em JSON), `settings` (os arquivos de configuração do projeto),
  `variavelDoTrafego` (a que desliga o tráfego não essencial), `ponte.unidade` (a unidade de
  usuário da ponte) e `instrucoes` (globs dos arquivos de instrução do host). Sem eles o
  `pre-voo` diz o campo que falta; `exemplo/.altair/adaptador.json` traz os valores de um host.
- `tiers` (versão 5) — o modelo de cada tier do plano (`mecanico` · `parecer` · `critico` ·
  `inherit`), texto opaco que o `pre-voo` repete quando avisa tarefa de julgamento em `mecanico`.

## O que cada hook faz

| Hook | Evento | Onde age | Efeito |
| --- | --- | --- | --- |
| `operaria-alcance-guard.js` | `PreToolUse` em `archive_session`, `send_message` do conector remoto e `Bash` | toda sessão | Decide a permissão: a operária arquiva só a si mesma, escreve só para `@parent` e empurra só a referência de aviso dela; dentro disso `allow`, fora `ask`. Sem modo: nunca fica calado. |
| `conducao-nonce-guard.js` | `PreToolUse` em `create_session`, `send_message`, `archive_session` | toda sessão que não nasceu de brief da condução | Compara o nonce citado na chamada com a última ação que `conducao.mjs proximo` emitiu (log de eventos). Grava `ok`, `divergencia`, `forma-desconhecida` ou `erro`. **Shadow:** sai 0 sempre. |
| `operaria-stop-guard.js` | `Stop` | só sessão cujo pedido de nascimento é o contrato da operária | Recusa encerrar sem commit da task depois do marcador da tentativa e sem aviso `T<k>-FALHA … <nonce>` na primeira linha da resposta final. Recusa no máximo 3 vezes por sessão; a 4ª libera com `liberado-teto`. **Só em `hard`.** **Shadow:** o fim que recusaria vira `teria-bloqueado` no log e sai 0. |

Corpo e decisões de cada um: o cabeçalho do próprio arquivo. Contraprova:
`node --test hooks/__tests__/*.test.mjs`.

## Primeira medição depois de instalar

A forma do `tool_input` no conector remoto não foi medida neste plugin. A primeira chamada real
de cada ferramenta numa sessão de maestra mede:

```bash
# pasta do log: ALTAIR_CONDUCAO_LOG_DIR, ou ${XDG_STATE_HOME:-~/.local/state}/<estado.pasta>/<log.pasta>/<projeto>
tail -n 20 "<pasta do log>/conducao-nonce-guard.log"
```

- `chaves` de cada linha é a forma real (só nomes, nunca valores).
- `forma-desconhecida` ⇒ o input chegou sem campo texto: o hook não acha onde está o nonce, e a
  leitura precisa mudar antes de qualquer promoção.
- Nenhuma linha depois de uma chamada real ⇒ o hook não disparou: o shadow está cego, não limpo.

## Promoção (por evidência, nunca por prazo)

Nonce — critério: **≥1 `ok` por ação real de cada uma das três ferramentas e 0
`forma-desconhecida`** no log lido no ato. Antes do `hard`, um limite declarado: o hook não sabe
qual sessão é a maestra, e enquanto houver um ciclo com log vivo, `send_message` de outra sessão do
operador também é julgado. Promover exige primeiro um discriminador (a sessão da maestra gravada
junto do `retomar`, e o hook julgando só ela). `sem-acao-emitida`, `forma-desconhecida` e `erro`
nunca bloqueiam, nem em `hard`.

```bash
echo hard > <pastaDoModo>/conducao-nonce-guard-mode   # só com o critério e o discriminador
```

Fim da operária — critério: **≥1 sessão operária real julgada** no log; toda `teria-bloqueado`
lida no ato e reconhecida como fim que deveria ter sido recusado (filha que entregou ou devolveu e
caiu em `teria-bloqueado` é falso positivo: não promove, conserta a leitura); 0 `erro` de motivo
`interno`.

```bash
echo hard > <pastaDoModo>/operaria-stop-guard-mode    # só com o critério
```

## Recuo

- Nonce: `echo off > <pastaDoModo>/conducao-nonce-guard-mode` (não julga nem grava).
- Fim da operária: `echo shadow > <pastaDoModo>/operaria-stop-guard-mode` (ou apagar o arquivo)
  volta a só gravar. Filha presa recusando o fim em `hard`: o teto de 3 já a solta; arquivar a
  sessão pelo app também encerra.
- Desligar os três: `claude plugin disable altair`.
