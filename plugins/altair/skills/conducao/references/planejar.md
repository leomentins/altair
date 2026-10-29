# Planejar — o mínimo para chegar a um plano conduzível

> Dois passos, em qualquer projeto: desenhar com quem decide (brainstorm) e escrever o plano no formato que a condução lê (`conduzivel.md`). É o piso: o projeto que tem processo próprio de desenho e plano segue o dele, desde que o plano final passe no contrato de `conduzivel.md`.

## 1. Brainstorm — desenhar antes de planejar

Objetivo: sair com um design aprovado por quem decide, uma decisão por vez.

1. **Entender o pedido.** Ler o que já existe (código, notas, o pedido escrito) antes de perguntar. Dizer em duas linhas o que se entendeu e o que ainda é pergunta.
2. **Uma pergunta por vez.** Cada pergunta traz as opções concretas e uma recomendação com o motivo em meia linha. Não empilhar perguntas: a resposta de uma muda a seguinte.
3. **Fronteira escrita.** O que entra, o que fica de fora, e o que é critério de pronto observável ("QUANDO … ENTÃO … DEVE …").
4. **Riscos cedo.** Para cada premissa que, se falsa, derruba o design: como medir, e quanto custa medir. Premissa barata de medir vira tarefa de sonda no plano (§2, passo 3).
5. **Design aprovado.** Resumir o design em poucas linhas e pedir o sim explícito. Sem sim, não há plano.

## 2. Escrever o plano conduzível

Objetivo: um arquivo por ciclo que o adaptador declarado lê sem adivinhar nada.

1. **Fases.** Agrupar as tarefas em fases que entregam algo conferível. Cada fase termina numa tarefa com a marca `fechamento-de-fase`.
2. **Tarefas pequenas e conferíveis.** Cada tarefa tem um resultado que um comando prova: a `Verificação` é esse comando, e ele precisa falhar antes da tarefa e passar depois. Tarefa sem comando que prove não é tarefa conduzível — é conversa.
3. **Procurar ativamente tarefas independentes.** Sempre há candidatas, mesmo pequenas; a disciplina de uma tarefa por sessão empurra o plano para a fila única, e é preciso resistir a isso de propósito. Para cada tarefa, perguntar: ela **lê** algo que outra escreve? Se não, é independente (`Independente: sim`). Procurar em especial:
   - **sondas e medições** que reduzem risco — confirmar uma premissa, medir um tempo, provar que uma ferramenta faz o que o design supõe. Elas quase nunca leem o trabalho das outras tarefas e valem mais quanto mais cedo rodam: põe-se no começo, independentes;
   - **documentação e testes** de algo já existente;
   - **peças em lugares diferentes** que só se encontram numa tarefa de integração depois.
   Dependência de ordem ("vem depois no texto") não é dependência: declarar só a de dado (`conduzivel.md` §Dependência de dado e dependência de ordem).
4. **Anotar cada tarefa.** `Estação`, `Publicação`, `Sensível`, `Verificação` e o subject do commit, explícitos — nunca deixar para o núcleo deduzir do texto (`conduzivel.md` §Anotações obrigatórias).
5. **Outputs pelo arquivo.** Listar cada arquivo que a tarefa cria ou muda, com o caminho onde ele mora; peça que a tarefa pode precisar tocar entra como `Modificar` (`conduzivel.md` §Outputs).
6. **Conferir antes de entregar.** Ler o plano com o adaptador declarado: tarefa sem anotação obrigatória, fase sem fechamento, ou heading fora do formato voltam como pergunta — consertar no plano, não no núcleo.
