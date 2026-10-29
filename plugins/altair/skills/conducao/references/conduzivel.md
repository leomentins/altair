# Plano conduzível — o que um plano precisa declarar para ser conduzido

> Contrato do plano que a condução aceita, em qualquer projeto. O núcleo lê o plano pelo código do adaptador (`codigo` na declaração `.altair/adaptador.json`): o do projeto, em `.altair/`, ou o embutido do formato público, declarado por nome (`"codigo": "superpowers"`). O leitor muda; o que ele precisa achar em cada tarefa, não.
> **Conferido** por `scripts/conducao/__tests__/conduzivel.test.mjs`: o plano de exemplo (`__tests__/fixtures/exemplo-superpowers.md`) passa lido pelo embutido declarado por nome, e cada anotação da tabela §Anotações obrigatórias, tirada de uma tarefa, faz o plano ser recusado.

## Regra de leitura: nada é adivinhado

O núcleo decide abrir sessão, trazer, publicar e perguntar pelo que o plano **declara**, nunca pelo que o texto dá a entender. Um passo que diz "publicar" ou "o operador abre no celular" não muda a tarefa; a anotação muda. Anotação obrigatória ausente, ou valor fora do vocabulário, não vira default: o plano é recusado com `declaracao-invalida` antes de qualquer sessão abrir, e a pergunta nomeia a tarefa e o campo.

## Anotações obrigatórias de cada tarefa

| anotação | valores | o que o núcleo faz com ela |
| --- | --- | --- |
| `Estação` | `servidor` · `workstation` · `maestra` | onde a tarefa roda: na sessão filha do servidor, na estação do operador, ou pela própria maestra |
| `Publicação` | `sim` · `não` | `sim` ⇒ a tarefa publica (banco, deploy, envio para fora do repositório) e só a maestra publica, depois de trazer |
| `Sensível` | `sim` · `não` | `sim` ⇒ a tarefa toca dado ou caminho sensível do projeto e pede o sim de quem decide antes de abrir |
| `Verificação` | um comando, entre crases | o único comando que a conferência roda depois de trazer; exit 0 é verde |
| `Commit` | o subject do commit | o subject que a tarefa grava; no formato público, sem a anotação, vale o `-m "…"` do `git commit` do passo |

## Anotações opcionais

| anotação | valores | efeito |
| --- | --- | --- |
| `Marcas` | `fechamento-de-fase` · `conferencia-do-operador` · as que o adaptador declara | `fechamento-de-fase` marca a tarefa que fecha a fase — **toda fase precisa de uma**, ou o plano é recusado; `conferencia-do-operador` faz o núcleo perguntar o resultado a quem decide |
| `Independente` | `sim` | a tarefa não depende da anterior (§Dependência de dado e dependência de ordem) |
| `Prazo` | `<n> min` | o prazo da sessão filha; ausente ⇒ o padrão do núcleo |
| `Verificação pós-merge` | `sim` | a Verificação só fica verde depois do merge do ramo |

No topo do plano: `Fase` (`F<n>`, default `F1`), `Modelo` e `Largura do ciclo` (quantas tarefas correm ao mesmo tempo; ausente ⇒ o padrão do núcleo).

## Outputs: o arquivo, não o assunto

A lista de arquivos da tarefa (no formato público, `**Arquivos:**` com `Criar` · `Modificar` · `Teste`) é o alcance que o sim aprovou. Ao trazer, o núcleo compara o diff da filha com ela: arquivo mudado fora da lista que os hooks de commit executam, ou que é caminho sensível, faz o `trazer` **parar e perguntar** (`alcance-dos-hooks`, caminho sensível). Só arquivo declarado libera; diretório declarado não libera nada embaixo dele.

**Núcleo dividido por lugar.** Quando o código que a tarefa muda mora em mais de um lugar — o núcleo em uma pasta, o leitor em outra, o contrato escrito numa terceira —, declarar **cada arquivo onde ele mora**, não o assunto da tarefa. "Mudar a regra de autorização" é assunto; os Outputs são os três arquivos que a regra atravessa, com o caminho real de cada um. Se a tarefa *pode* precisar tocar uma peça (o leitor, quando a regra muda a forma do dado), declarar a peça como `Modificar`: arquivo declarado e não mudado não custa nada; arquivo mudado e não declarado custa uma parada e uma pergunta. Na dúvida sobre onde o código mora, ler os imports antes de escrever a lista, não depois de a filha parar.

## Dependência de dado e dependência de ordem

São coisas diferentes, e o plano declara as duas de jeitos diferentes:

- **Dependência de dado** — a tarefa **lê** o que outra escreveu: um arquivo criado, uma decisão gravada, um resultado medido. Declara-se nos **Inputs** da tarefa, citando a tarefa de origem (`T3`). O núcleo só abre a tarefa depois que todas as citadas foram conferidas.
- **Dependência de ordem** — a tarefa não lê nada da outra; só "vem depois" no texto. Sem Inputs que citem tarefa e sem `Independente: sim`, o núcleo lê a tarefa como dependente da anterior (leitura conservadora). Isso serializa o plano sem motivo.

Antes de fechar o plano, para cada tarefa: ela lê algo de uma tarefa anterior? Se não lê, declarar `Independente: sim` — ela corre em paralelo dentro da largura do ciclo. Se lê, citar nos Inputs exatamente as tarefas de que lê, não "a anterior" por hábito. O formato público não tem campo de Inputs: lá a tarefa é `Independente: sim` ou depende da anterior — quem lê de uma tarefa que não é a anterior vem logo depois dela no plano.

## Formato público (adaptador embutido `superpowers`)

O plano que o `writing-plans` do superpowers escreve é lido pelo adaptador embutido, sem código do projeto: a declaração v2 traz `"codigo": "superpowers"` e o plano mora em `docs/planos/<ciclo>.md` ou `docs/superpowers/plans/<ciclo>.md`, um arquivo por ciclo. A tarefa é `### Tarefa <n>: <título>` (ou `### Task <n>:`), as anotações vão uma por linha, `**Campo:** valor`, entre o título e o primeiro passo, e os passos são `- [ ] **Passo <k>: …**`. O que está dentro de bloco de código não é tarefa nem anotação. Vai a perguntar também o plano que sumiria em silêncio: sem tarefa, heading de tarefa fora do formato, numeração com buraco, cerca de código aberta até o fim, anotação repetida ou depois do primeiro passo.
