# Contrato atual da condução — o que o código faz hoje

> Escrito na T2 do VEGA-29 (F0, contrato escrito do que existe), lido de `conducao.mjs` e `git-conducao.mjs`.
> **Conferido contra o código** por `__tests__/contrato-atual.test.mjs`: o teste extrai cada conjunto do código-fonte e exige igualdade com as tabelas abaixo. Ação, motivo, código de saída, marca ou trailer novo no código sem linha aqui ⇒ o teste falha nomeando o item; linha aqui sem par no código ⇒ falha também.
> O teste lê só a **primeira coluna** de cada tabela (e a segunda onde o par é a chave: motivo, expressão, regex, leitora). As outras colunas são prosa, sem conferência.
> Este arquivo descreve; não decide. Quando a reconstrução do núcleo (F1) mudar o código, o texto muda junto, na mesma task.

Alcance de cada conjunto:

- **Ações e motivos** — o caminho do `proximo`: as funções `decidir`, `decidirMaestra` (o nível da maestra, `--nivel maestra`), `proximo` e `erroComoPergunta` de `conducao.mjs`, e as regras de `regras.mjs`. Os verbos de git (`autorizar-ciclo`, `abrir`, `trazer`, …) também respondem `perguntar` com motivo próprio, mas ficam fora desta tabela.
- **Códigos de saída** — a função `main` de `conducao.mjs` (o CLI inteiro).
- **Marcas e trailers** — `lerMarcas` (`conducao.mjs`) e `ultimaAutorizacao` (`git-conducao.mjs`). A marca `trazida` vive em referência local fora do ramo e é lida por `lerTrazidas`, não por estas duas.

## Ações do proximo

| ação | o que a maestra faz |
| --- | --- |
| `arquivar` | arquiva a sessão da filha cujo aviso já foi decidido; vem antes de toda outra ação e o nonce não depende do HEAD; no nível da maestra, a condutora cuja fase já tem `Conducao-Encerrada` (ou toda condutora, com o ciclo encerrado) |
| `abrir` | grava o marcador de cada task da leva (`abrir T<k>`) e cria a filha com a `partida` |
| `trazer` | traz a tentativa avisada `OK` para o ramo do ciclo e confere |
| `esperar` | não faz nada agora; o `motivo` diz pelo quê |
| `perguntar` | leva a pergunta ao operador; o `motivo` diz qual |
| `cutucar` | manda a `mensagem` à filha caída (`sessao`) e passa `cutucadaEm` nessa filha da entrada seguinte (T18); no nível da maestra, à condutora caída (T39). O `cutucadaEm` vale só para a queda em curso (T40): com `caidaEm` na filha (o instante em que quem conduz a leu `FAILED` pela primeira vez nesta queda, gravado uma vez e não regravado enquanto ela seguir `FAILED`; posterior a `agora` é `entrada-invalida`), `cutucadaEm` anterior a ele é de queda velha e não conta, e a sessão que voltou e caiu de novo recebe o seu `cutucar`; sem `caidaEm`, vale o `cutucadaEm` como veio |
| `herdar-autorizacao` | grava a autorização herdada da fase (re-plano de ruling ou sim do ciclo), sem perguntar ao operador |
| `fazer-maestra` | executa ela mesma a task de estação `maestra` e registra com `--maestra` |
| `fechar-fase` | conduz a task de fechamento da fase |
| `encerrar-sessao` | grava o encerramento da fase anterior e entrega o texto da próxima sessão |
| `fechar-ciclo` | entrega o texto do `/close-cycle` em sessão limpa |
| `parar` | para a condução; o `motivo` diz por quê |
| `criar-condutora` | só no nível da maestra (`--nivel maestra`): cria a condutora da primeira fase sem `Conducao-Encerrada`, com `fase`, `modelo` do heading da fase e `texto` da sessão; inclusive a primeira fase do ciclo, sem condutora anterior a arquivar |
| `criar-fechamento` | só no nível da maestra: depois de `Conducao-Encerrada: ciclo`, cria a sessão de fechamento com o `texto` do `/close-cycle` |

A lista de ações do cabeçalho de `conducao.mjs` não cita `fazer-maestra`; o código a emite (task de estação `maestra`). Esta tabela segue o código.

## Motivos por ação

| ação | motivo | quando |
| --- | --- | --- |
| `perguntar` | `autorizar-ciclo` | fase seguinte sem autorização (ou nenhuma autorização ainda, com `sugestao`) e sem sim do ciclo que a cubra — inclusive task que mudou de classe ou de sensibilidade desde o sim; pede o sim do ciclo, porque o `autorizar-fase` foi aposentado (D-VEGA29-14, T13) |
| `perguntar` | `entrada-invalida` | a entrada da maestra (`--entrada`) não se lê ou tem forma errada (`problemasDaEntrada`: campo desconhecido, lista que não é lista, tipo errado); vem antes de toda decisão, com `problemas` (T17) |
| `perguntar` | `plano-mudou` | o canonico no HEAD difere do plano congelado na autorização, sem herança possível |
| `perguntar` | `fase-autorizada-fora-do-plano` | nenhuma fase autorizada existe no plano congelado |
| `perguntar` | `fase-reaberta-sem-fechamento` | fase reaberta cujas tasks novas não terminam em fechamento, ou reautorizada com o fechamento velho já conferido |
| `perguntar` | `falha-de-arquivamento` | o mesmo `arquivar` executado 2 vezes sem a filha chegar a `ARCHIVED` |
| `perguntar` | `ci-vermelho` | CI vermelho no HEAD antes do `encerrar-sessao` ou do `fechar-ciclo` |
| `perguntar` | `trazida-sem-conferencia` | tentativa trazida sem conferência gravada (interrupção no meio do trazer); na task de conferência do operador por arquivo, traz `conferenciaDoOperador` (e `liveUxGate: true`, o nome antigo, mantido no caso por arquivo) |
| `perguntar` | `conferencia-do-operador` | tentativa trazida de task de conferência do operador por pergunta (T14, 7-a): o resultado é do operador — opções `sim` (conferência com `--operador`) e `nao` (`--rodada nao --operador`, rodada nova) |
| `perguntar` | `task-sensivel` | task com publicação ou caminho clínico, sem sim da fase que a cubra nem aprovação pelo nonce |
| `perguntar` | `sem-saida` | nenhuma regra decide: tasks pendentes com dependências não feitas |
| `perguntar` | `marcador-invalido` | tentativa em voo sem nonce legível no marcador |
| `perguntar` | `pergunta-da-filha` | a filha avisou `T<k>-FALHA pergunta <nonce>` |
| `perguntar` | `segunda-falha` | falha avisada, ou Verificação vermelha revertida, numa task que já tem 1 falha contada |
| `perguntar` | `filha-sumiu` | as filhas da tentativa estão `ARCHIVED` sem aviso, fora do reinício da ponte |
| `perguntar` | `tentativa-sem-filha` | tentativa em voo sem filha nenhuma na entrada, fora do reinício da ponte |
| `perguntar` | `filha-esperando-clique` | filha viva da tentativa com `statusBucket` `BLOCKED` (ou estado `REQUIRES_ACTION`), sem aviso: no primeiro ciclo da vigia, sem falha a gravar (T18) |
| `perguntar` | `prazo-vencido` | tentativa aberta há mais que o `prazoMin` da task |
| `perguntar` | `teto-de-falhas` | task com 2 falhas contadas |
| `perguntar` | `teto-de-falhas-ambiente` | task no teto próprio de falhas de ambiente (`BOTOES.tetoFalhasAmbiente`) |
| `perguntar` | `condutora-caida` | no nível da maestra, condutora viva que não anda (T39), com `situacao`: `bloqueada` (`statusBucket` `BLOCKED` ou estado `REQUIRES_ACTION`, já), `fase-fora-do-plano` (`fase` que o plano do HEAD não tem, ou o fechamento, `ciclo`, antes de `Conducao-Encerrada: ciclo`) ou `caida` (`FAILED` por `BOTOES.silencioCondutoraCaidaMin` depois do `cutucadaEm` desta queda, T40) |
| `cutucar` | `filha-caida` | todas as filhas vivas da tentativa com `statusBucket` `FAILED`, sem aviso e sem `cutucadaEm` desta queda (T40): a mensagem vem antes de contar falha de ambiente (T18) |
| `cutucar` | `condutora-falhou` | no nível da maestra, condutora viva com `statusBucket` (ou, sem ele, estado) `FAILED` e sem `cutucadaEm` desta queda (T40): a mensagem vem antes da pergunta (T39) |
| `esperar` | `mesclado` | a proposta do ciclo está `MERGED`: depois do merge o `proximo` não emite nada |
| `esperar` | `close-cycle-em-sessao-limpa` | o ciclo já tem a marca de encerramento; o fechamento roda em outra sessão |
| `esperar` | `ci-pendente` | sem veredito de CI no HEAD antes do `encerrar-sessao` ou do `fechar-ciclo` |
| `esperar` | `filhas-em-voo` | nada a abrir agora e há filhas em voo na fase |
| `esperar` | `condutora-viva` | no nível da maestra: uma condutora (ou a sessão de fechamento) ainda vive e a vigia não a pegou (T39); a maestra espera o fim dela |
| `esperar` | `sem-vaga` | há task pronta no servidor e nenhuma vaga (largura do ciclo ou teto da ponte) |
| `parar` | `publicacao-recusada` | a fase tem task com `Conducao: T<k> publicacao recusada` |
| `parar` | `workstation` | só resta task de estação `workstation` |

## Motivos não literais

| ação | expressão | de onde vem |
| --- | --- | --- |
| `perguntar` | `e.codigo` | `erroComoPergunta`: o plano no HEAD ou o congelado não se lê; o motivo é o código do `ErroPlano` de `ler-plano.mjs` |
| `perguntar` | `motivo` | `{ motivo, … }` abreviado em `decidir`: o 1º elemento da tupla de `perguntasDaVigia` (os literais estão em §Motivos por ação; o teste exige que a vigia só cresça por `push([…])` com motivo literal) |

## Motivos da falha anterior

Não são motivos de ação: vão no campo `falhaAnterior` de cada tarefa do `abrir`, que grava a falha da tentativa que caiu antes do marcador novo.

| motivo | quando |
| --- | --- |
| `falha-avisada` | a filha avisou `FALHA` (que não é pergunta) e a task não tinha falha contada |
| `reinicio-da-ponte` | a filha sumiu numa tentativa aberta antes do reinício confirmado da ponte; `coberta: sim`, não conta falha |
| `filha-caida-em-silencio` | a filha caída seguiu `FAILED` por `BOTOES.silencioFilhaCaidaMin` depois do `cutucadaEm` desta queda (T40); `coberta: ambiente`, conta no teto de ambiente (T18) |
| `verificacao-vermelha` | a tentativa trazida foi revertida pela Verificação vermelha e a task não tinha falha contada |

## Códigos de saída

| código | quando |
| --- | --- |
| `0` | saída normal de qualquer verbo, inclusive `perguntar` do `proximo` (`entrada-invalida` também); `ci` com entrada legível sai sempre 0, e `registrar-evento` também, salvo a recusa do log v0 |
| `1` | resposta `perguntar` de verbo de git, do `conferir` ou do `ci` (entrada ilegível); `registrado-sem-copia` de verbo de git; `perguntar git-prazo-estourado` de qualquer verbo; `auditar` com violação; `conferir-workflows` com workflow reprovado; `reinicio-valido` não confirmado; `ErroPlano` com código diferente de `teto-do-chamador`; `perguntar` do `ErroAdaptador` (`adaptador-invalido`, ou `entrada-invalida` no campo `codigo`, D-VEGA29-34) ou do `ErroLogV0` (`log-v0-so-leitura`) |
| `2` | uso: flag obrigatória ausente, `--ciclo` ausente, verbo desconhecido; `ErroPlano` `teto-do-chamador` (o `esperar-filha` sem teto de quem chama ou acima dele); exceção inesperada |

## Desfechos da fronteira (T17)

Fora do caminho do `proximo`, por isso fora das tabelas que o teste lê; o teste deles é `__tests__/fronteira.test.mjs`.

- **`perguntar entrada-invalida` do `ci`** — `--pr` ou `--runs` que não se lê (arquivo ausente, JSON ilegível): JSON com `problemas` no stdout, exit 1. Antes saía exit 2 com a pilha.
- **`perguntar git-prazo-estourado`** — um `git` do executor único (`git-exec.mjs`, também o `git` de `ler-plano.mjs`) passou do prazo (`PRAZO_GIT_MS` local, `PRAZO_REDE_MS` rede) e foi morto com `SIGKILL`: JSON com `comando`, `prazoMs` e `locks` (os `*.lock` sob o git-dir) no stdout, linha no stderr, exit 1. O `tentarGit` não lança: devolve `status: null`, `prazoEstourado: true` e os `locks`.
- **`perguntar` do adaptador e do log v0** (T36) — `ErroAdaptador` (declaração ou código do adaptador inválido) e `ErroLogV0` (`registrar-evento` sobre pasta do log que já tem log v0: o arquivo, quantas linhas sem versão, e que o v0 é só leitura, D-VEGA29-21) saem como `perguntar` com `motivo` = o código do erro e a mensagem no `detalhe`, JSON no stdout, a mesma linha de antes no stderr, exit 1, sem ir ao log. Antes saíam exit 1 só com stderr (o adaptador) ou exit 2 com a pilha (o log v0). O `brief-indisponivel` do `abrir` leva o código do erro quando ele tem um (`entrada-invalida` do adaptador, o do `ErroPlano`, o `nao-ilegivel` da marca `rodada` cujo corpo não traz o prefixo do não), a página declarada (`pagina`) fora do HEAD sai `pagina-inexistente` (T38), e o `ci.veredito` ilegível escreve o erro no stderr antes de voltar ao padrão.
- **`registrado-sem-copia`** — o verbo de git gravou a marca no ramo e o push da cópia foi recusado (`copia-push-falhou`, `copia-sem-proposta`): a saída do verbo com `acao: registrado-sem-copia`, `desfecho` = a ação que gravou, `motivo` = o código da recusa, `remedio: empurrar-copia` e `copia: null`, exit 1. Antes subia como `ErroPlano` e o chamador recebia só stderr para algo que estava feito.

## Campo `codigo` da declaração (D-VEGA29-34)

Fora do caminho do `proximo`, por isso fora das tabelas que o teste deste arquivo lê; o teste dele é `__tests__/adaptador.test.mjs`. Lido de `adaptador.mjs` (`validar`, `codigoDoAdaptador`). O `codigo` existe só na versão 2 do esquema.

| valor de `codigo` | o núcleo carrega |
| --- | --- |
| terminado em `.mjs` | o arquivo em `<repo>/.altair/`, por `realpath` (segmento `..`, caminho absoluto ou link que salte para fora ⇒ `adaptador-invalido`); por exemplo `projeto.mjs` |
| nome embutido (minúsculas, dígitos e hífen, `NOME_EMBUTIDO`, ex. `superpowers`; a mesma régua no esquema) | o adaptador embutido no núcleo, `adaptadores/<nome>.mjs`: o nome só resolve contra a lista fechada dos arquivos de `adaptadores/`, e o caminho sai da entrada da lista, nunca do texto declarado; nome fora da lista ⇒ `entrada-invalida` |
| ausente | o código da árvore do núcleo, como hoje |
| outro valor (`../x`, `x.js`, `a/b`, `Foo`, `a\b`, `-x`) | nada: a declaração recusa com `entrada-invalida` (exit 1 no CLI, pelo `ErroAdaptador`) |

## Marcas pelo subject

O subject inteiro casa a regex; o corpo não conta (o `--grep` do git só filtra candidatos). `lerMarcas` lê o histórico do HEAD em ordem cronológica (`--reverse --topo-order`); `ultimaAutorizacao` pega a mais recente.

| tipo | subject (regex) | lida por |
| --- | --- | --- |
| `autorizada` | `^Conducao: (F\d{1,2}) autorizada$` | lerMarcas, ultimaAutorizacao |
| `conferida` | `^Conducao: (T\d{1,3}) conferida$` | lerMarcas |
| `falhou` | `^Conducao: (T\d{1,3}) tentativa (\d+) falhou$` | lerMarcas |
| `revertida` | `^Conducao: (T\d{1,3}) tentativa (\d+) revertida$` | lerMarcas |
| `rodada` | `^Conducao: (T\d{1,3}) tentativa (\d+) rodada$` | lerMarcas |
| `carimbo` | `^Conducao: (T\d{1,3}) tentativa (\d+) carimbo$` | lerMarcas |
| `recusada` | `^Conducao: (T\d{1,3}) publicacao recusada$` | lerMarcas |
| `marcador` | `^Conducao: abrir (T\d{1,3}) tentativa (\d+) nonce (\S+)$` | lerMarcas |
| `encerrada` | `^Conducao: (F\d{1,2}\|ciclo) sessao encerrada$` | lerMarcas |

A marca `encerrada` só conta com o trailer `Conducao-Encerrada` igual à fase do subject.

## Trailers lidos

| trailer | lido por | efeito |
| --- | --- | --- |
| `Conducao-Plano` | lerMarcas, ultimaAutorizacao | blob do canonico congelado na autorização |
| `Conducao-Herdada` | lerMarcas | autorização herdada: aponta a marca com o sim do operador |
| `Conducao-Ciclo` | lerMarcas | `sim` ⇒ a autorização é o sim do ciclo (`autorizar-ciclo`) |
| `coberta-por-reinicio` | lerMarcas | `sim` ⇒ a falha caiu no reinício da ponte e não conta no teto |
| `Conducao-Falha-Ambiente` | lerMarcas | `sim` ⇒ falha de ambiente: não conta no teto de falhas, conta no próprio |
| `Conducao-Rodada` | lerMarcas | o não do operador gravado na marca `rodada` (`nao`, ou `needs-rework` no caso `(live-ux-gate)`) |
| `Conducao-Encerrada` | lerMarcas | precisa igualar a fase do subject para a marca `encerrada` valer |
| `Conducao-Nonce` | lerMarcas | nonce da ação `encerrar-sessao` que gravou a marca `encerrada` |

`lerMarcas` guarda também o bloco inteiro de trailers em `conferida`, `falhou`, `revertida`, `rodada` e `carimbo`, para o `auditar` ler (`Conducao-Task`, `Conducao-Verificacao`, `Conducao-Publicacao`, `Conducao-Executor`, e `Conducao-Publicacao-Dispensada: operador` — a dispensa de publicação de task `nao-se-aplica` que o plano liga a publicação, T16; commit antigo sem ele vale pela frase que o adaptador lista em `publicacao.frasesLegadas`); a tabela lista só o que `lerMarcas` e `ultimaAutorizacao` consultam por nome.
