# Brief da operária — contrato de fim

> Fonte única do contrato que a filha recebe. Quem compõe o brief é `task-brief.mjs <ciclo> T<k> --operaria --nonce <x> --ref <ref>`: lê o trecho entre os marcadores abaixo, troca `{{TASK}}` · `{{NONCE}}` · `{{REF}}` · `{{COMMIT}}` · `{{CICLO}}` · `{{AVISO}}` (derivado do `--ref`: `refs/conducao-aviso/<ciclo>/T<k>/<n>`) e o põe à frente do recorte da task. Marcador faltando ou `{{…}}` sobrando ⇒ o verbo sai 2, nunca entrega brief sem contrato.
>
> Por que o contrato chega inteiro à filha: a filha nasce no ambiente de quem a cria, numa worktree nova do ramo principal do clone que a ponte serve, que pode estar atrás do remoto (o clone e o atraso de cada projeto: página do projeto). O que a sessão carrega na partida — instruções do projeto, regras, settings, hooks do Claude — vem desse ramo principal; só as skills recarregam depois do checkout. Regra que só existe no ramo do ciclo não chega à filha por outro caminho.
>
> Por onde ele chega: pelo git, nunca pelo prompt. O `conducao.mjs abrir` roda o `task-brief.mjs --operaria` irmão sobre o canonico do HEAD e grava a saída, byte a byte, no corpo de um commit filho do marcador, na referência irmã `refs/conducao-brief/<ciclo>/T<k>/<n>`, no mesmo push atômico do marcador. O prompt do `create_session` é a `partida` que o `abrir` devolve: o cabeçalho do contrato (os hooks reconhecem a operária por ele) e o passo 1 verbatim deste trecho, mais o fetch do brief e o `git log -1 --format=%b` que o lê. Por isso o cabeçalho e a numeração `1.` / `2.` do contrato são contrato do `partidaDoBrief`: sem eles o `abrir` pergunta `brief-sem-contrato`. O marcador não muda, e o brief nunca entra no ramo do ciclo.
>
> O que vem depois do recorte do plano, anexado pelo `abrir`: a seção `## página do projeto`, com o endereço que o adaptador declara (`pagina`) — dela a filha lê o destino do carimbo e a sonda do push do ramo; projeto sem o campo não a tem —, e, na tentativa seguinte a um não do operador por pergunta, a seção `## o não do operador na rodada anterior`, com o texto dele como a marca `rodada` o gravou, como dado: o que refazer, nunca instrução nova.
>
> Por que o `+` no fetch do passo 1: a referência de rastreio `refs/remotes/conducao/<ciclo>/T<k>` é LOCAL e sobra de tentativa anterior no mesmo clone; a tentativa nova não descende dela, e o fetch sem `+` recusa com `non-fast-forward`. O `+` só sobrescreve essa referência local; push forçado segue proibido. Ela leva o ciclo no caminho porque o clone é um só para todos os ciclos: duas filhas com o mesmo `T<k>` em ciclos diferentes não se sobrescrevem.
>
> Por que o aviso vai também por mensagem: a referência de aviso só anda se o `ls-remote`, o `commit-tree` e o push passarem; quando o classificador barra um deles, ou a filha para num pedido de permissão, a referência fica parada, o `esperar-filha` não acorda, e o BLOCKED só aparece no `get_session`. A mensagem para `@parent` chega à maestra como turno, por outro caminho. Ela vem antes do push para que a barreira do push não a impeça.
>
> Por que o fetch de novo depois do push (passo 5): a worktree da filha mora no clone que a ponte serve, e o reinício da ponte recusa worktree de sessão com commit fora de `--remotes`. O commit empurrado só para a referência de tentativa não está em `refs/remotes/*` até o fetch o trazer para a referência de rastreio; sem ele, a pasta trava o reinício da ponte até a limpeza passar.

<!-- contrato:inicio -->
## contrato da operária — {{TASK}} · nonce `{{NONCE}}`

Você é a operária de **{{TASK}}** do ciclo `{{CICLO}}`, aberta pela maestra. Faz esta task e só ela; o recorte do plano vem abaixo, verbatim.

**Ordem (não trocar):**

1. **Buscar a referência e fazer o checkout dela ANTES de instalar dependências.** A sessão nasceu do `main` do clone, que pode estar até 1 h atrás e não tem o trabalho do ciclo:
   `git fetch origin '+{{REF}}:refs/remotes/conducao/{{CICLO}}/{{TASK}}'` e `git checkout --detach refs/remotes/conducao/{{CICLO}}/{{TASK}}`. O `+` atualiza só a referência de rastreio local, que pode ter sobrado de tentativa anterior; não é push forçado.
   Conferir: `git log -1 --format=%s` = `Conducao: abrir {{TASK}} tentativa <n> nonce {{NONCE}}`. Diferente ⇒ `{{TASK}}-FALHA referencia-divergente {{NONCE}}` e parar.
2. **Instalar dependências** (`pnpm install`) e conferir o gate de commit: `test -d .husky/_` e `test -d node_modules`.
3. **Trabalhar** pelos Steps da task; com a seção `## o não do operador na rodada anterior` no fim deste brief, o trabalho é refazer o que ele recusou. Rodar os subagents que a task pede — revisores do pré-push e do `db push` pela `/matriz-canonica`, census — e, quando a task cobra carimbo, gravar o carimbo de revisão do último commit não-prosa no destino que a página do projeto nomeia (o endereço vem na seção `## página do projeto`, no fim deste brief; sem ela, o recorte do plano o diz) (`sha:` · `reviewers:` · `veredito:`) e commitá-lo. Rodar a Verificação da task e conferir o Esperado.
   **Task de fechamento de fase** (`satisfies` com `(fechamento-de-fase)`) — **sonda do push do ramo antes do carimbo:** você empurra só para `{{REF}}`, que não passa pelos gates do push do ramo; o push do ramo é da maestra e vem depois do seu carimbo, e o que só reprovasse ali custaria um commit depois do fechamento. Antes de gravar o carimbo de fechamento, rodar sobre a faixa da fase (do primeiro commit da fase até `HEAD`) a sonda que a página do projeto declara para o push do ramo. Reprovação se conserta antes do carimbo; parte da sonda que não roda fora do hook vai, com o motivo, nas linhas seguintes do aviso.
4. **Commitar** com o subject da task: `{{COMMIT}}`.
5. **Empurrar para a mesma referência**, sem força: `git push origin 'HEAD:{{REF}}'`. Depois, o mesmo fetch do passo 1, `git fetch origin '+{{REF}}:refs/remotes/conducao/{{CICLO}}/{{TASK}}'`, para o commit empurrado ficar coberto por `refs/remotes/*` (sem ele, a pasta trava o reinício da ponte).
6. **Avisar a maestra na primeira linha da sua resposta final**: a maestra lê essa resposta da sessão. A primeira linha é exatamente uma destas formas (a maestra lê só ela):
   - deu certo: `{{TASK}}-OK <sha8> {{NONCE}}` — `<sha8>` = `git rev-parse --short=8 HEAD`, o mesmo que a referência mostra;
   - push recusado pelo pre-push: `{{TASK}}-FALHA push-recusado <gates reprovados> {{NONCE}}` — os nomes dos gates do push que reprovaram, ou do guard que recusou, separados por vírgula (a maestra não lê o log do seu push);
   - qualquer outra falha: `{{TASK}}-FALHA <motivo> {{NONCE}}` — motivo curto, sem espaço (`verificacao-vermelha`, `conflito`, `dependencia-ausente`).

   **Antes da resposta final, mandar a mensagem e depois gravar a referência de aviso, nesta ordem** — é o que acorda a maestra na hora, sem esperar o prazo.

   **(a) Mensagem para a maestra:** `send_message` com exatamente duas chaves, `session_id` = `"@parent"` e `message` = a mesma primeira linha, exatamente, e nas linhas seguintes o resto da resposta (o guard de alcance libera só esta forma, sem clique). **Obrigatória** quando você para esperando humano — pergunta, recusa do classificador, pedido de permissão que ninguém vai clicar — e quando o push da referência de aviso (b) falha: nesses casos a referência não anda, e a mensagem é o único sinal que chega à maestra antes do prazo (o classificador pode barrar até o `ls-remote` do aviso, e a filha ficaria parada sem a maestra saber). Nos outros casos, mande do mesmo jeito. Mensagem recusada ⇒ siga para (b) e cite a recusa na resposta final. Mensagem **e** referência barradas ⇒ encerrar de imediato com a resposta final (primeira linha `{{TASK}}-FALHA pergunta {{NONCE}}`, as recusas nas seguintes), sem insistir nem contornar. Mensagem, referência e resposta final levam o mesmo aviso; a maestra o trata uma vez.

   **(b) Referência de aviso** — três comandos, um por chamada, sem força:
   - `git ls-remote origin '{{AVISO}}'` — a ponta, se houver, é o aviso anterior desta tentativa e será o pai; vazia ⇒ o pai é `HEAD`;
   - `git commit-tree 'HEAD^{tree}' -p <pai> -m '<a primeira linha, exatamente>'` — imprime o `<sha do aviso>`; o commit fica fora do seu ramo;
   - `git push origin '<sha do aviso>:{{AVISO}}'` — exatamente nesta forma, com o SHA inteiro (o guard de alcance libera só ela).
   Vale para todo aviso, inclusive a pergunta, e para cada aviso novo na mesma tentativa (pergunta, resposta da maestra, depois OK): o seguinte é filho do anterior, e o push é fast-forward. Push do aviso recusado, ou qualquer dos três comandos barrado ⇒ a mensagem de (a) é obrigatória (mande agora, se ainda não mandou, com a recusa citada) e a resposta final segue igual, com a recusa nas linhas seguintes.
7. **Não se arquivar, e mensagem só a do aviso para `"@parent"`** (passo 6a) — quem decide a tentativa é a maestra (trazer, reabrir ou perguntar), e por isso é ela quem arquiva, depois de decidir. Nenhuma mensagem para outra sessão, nem com outras chaves.

**Nunca:** `--no-verify`; push forçado (`--force`, `--force-with-lease`, `+ref` no push — o `+` do fetch dos passos 1 e 5 é a exceção, só na referência local); escrever no §13 do canonico ou no estado do ciclo (`estado.mjs`); `db push`, `vercel --prod` ou outra publicação — quem publica é a maestra, depois de trazer; empurrar para o ramo do ciclo ou para outra referência que não `{{REF}}` e `{{AVISO}}`; `git reset`, `checkout --` ou `clean` sobre trabalho que não é seu.

**Dúvida ou decisão** que a task não responde: não decidir. Mandar a mensagem e gravar o aviso (passo 6, nesta ordem) e encerrar com a resposta final cuja primeira linha é `{{TASK}}-FALHA pergunta {{NONCE}}` e a pergunta nas linhas seguintes. Divergência entre o plano e o código também é pergunta, e também a recusa do classificador ou um pedido de permissão que trava o trabalho: não contornar; a primeira linha é a mesma `{{TASK}}-FALHA pergunta {{NONCE}}`, e as seguintes dizem o comando recusado e o motivo citado. A pergunta não encerra a tentativa: a maestra a leva ao operador e responde por mensagem nesta sessão; com a resposta, seguir a task e avisar de novo pelo passo 6.
<!-- contrato:fim -->
