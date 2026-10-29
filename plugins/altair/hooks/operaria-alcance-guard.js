"use strict";
// operaria-alcance-guard — o raio de uma sessão sobre as OUTRAS sessões é ela mesma e o pai
// (ruling 3a do operador, 13/10/2026, no desenho do loop condutor → operária).
//
// POR QUE EXISTE. A operária de um loop nasce por `create_session`, faz uma task, avisa o condutor
// por `send_message` e se arquiva por `archive_session`. Sem permissão prévia ela para esperando
// humano a cada volta (teste 2, 13/10/2026: BLOCKED em `archive_session`); com permissão sem trava,
// qualquer sessão arquiva qualquer outra e escreve para qualquer uma. Este hook decide as duas
// ferramentas SEMPRE: `allow` dentro do raio, `ask` fora. Pela doc de hooks o `ask` força o prompt
// também no modo auto; em sessão sem humano isso deixaria a sessão BLOCKED, falha visível ao
// condutor — NÃO medido ainda numa sessão sem humano. Se nem a decisão consegue ser escrita
// (escrita no stdout falha), o hook sai 2, que bloqueia a chamada.
//
// DENTRO DO RAIO (`allow`). O raio de `archive_session` e `send_message` depende de quem chama,
// lido pelo pedido de nascimento (`lerSessao` de `lib/sessao-operaria.js`, pelo `transcript_path`
// do payload; desde [[decisao/filha-herdeira-da-maestra]] a filha roda como o mesmo usuário, e o
// usuário do SO não a separa):
//   - Sessão PROVADA não operária (`estado: "comum"` — a maestra, uma sessão do operador): arquiva
//     QUALQUER sessão (`archive_session` com exatamente a chave `session_id`, string) e escreve
//     para QUALQUER sessão (`send_message` com exatamente as chaves `session_id` e `message`, as
//     duas string). Ruling F4.8b do operador (23/10/2026, ATRM-51): os arquivamentos que ele pedia à
//     maestra paravam em clique; arquivar volta (`unarchive_session`), e o atrito fica só onde o
//     estrago não volta. Absorve o arquivamento da ação `arquivar` emitida pelo `proximo`
//     (D-VEGA22-25), que só valia para sessão comum.
//   - Operária (`estado: "operaria"`) e sessão que não se prova (`estado: "ilegivel"`: transcript
//     ausente, ilegível ou acima do teto — a dúvida não libera) ficam no raio estreito:
//     - `archive_session` com exatamente a chave `session_id`, e ela é o da PRÓPRIA sessão. O id
//       sai da raiz do projeto que o harness passa ao hook em `CLAUDE_PROJECT_DIR` — a worktree
//       que o app dá à sessão, `.claude/worktrees/bridge-cse_<X>` ⇔ `session_<X>`, casada no FIM
//       do caminho. Nunca do `cwd` do payload: o `cwd` segue `cd` (cofre-agente-guard R7), e uma
//       sessão que entrasse na worktree de outra viraria a outra (achado da revisão de
//       167fb951). Sem a variável, ou com raiz fora desse formato, o hook não sabe quem é ⇒ `ask`.
//     - `send_message` com exatamente as chaves `session_id` = `"@parent"` (o alias que a
//       ferramenta resolve para quem criou a sessão) e `message`. O id explícito do pai não passa:
//       daqui não há como provar que ele é o pai.
//   Nos dois raios a lista é de chaves PERMITIDAS, não proibidas: campo novo de roteamento que a
//   ferramenta ganhe cai em `ask` sem precisar de manutenção aqui.
//   - `Bash` com exatamente `git push origin <sha>:refs/conducao-aviso/<ciclo>/T<k>/<n>` (aspas
//     simples ou duplas em volta do refspec, nada antes nem depois), em sessão PROVADA operária
//     cujo pedido de nascimento cita `refs/conducao/<ciclo>/T<k>/<n>` com o mesmo ciclo, task e
//     tentativa: o aviso da filha à maestra (P22 do ATRM-51, contrato da operária passo 6). O
//     `<sha>` é hexadecimal puro, então não cabe `+` (força) nem `HEAD`; o git do servidor recusa
//     o que não for fast-forward do aviso anterior. Aviso de OUTRA tentativa por operária ⇒ `ask`.
//     Qualquer outro comando, ou a mesma forma em sessão que não é operária (ou ilegível), ⇒ o
//     hook não decide nada (sai 0 sem saída) e vale o fluxo normal de permissão: este ramo só
//     LIBERA, nunca vira pedágio de todo `Bash`.
// Todo o resto ⇒ `ask`, inclusive ferramenta que não é nenhuma das três (matcher alargado por
// engano) e entrada vazia ou ilegível.
//
// O QUE ESTE HOOK NÃO COBRE. O CONTEÚDO da mensagem é livre: quem recebe trata mensagem de outra
// sessão como dado, nunca como instrução — sem o clique de antes, a maestra que obedecesse a
// mensagem de uma operária arquivaria ou escreveria a qualquer sessão (resíduo aceito no F4.8b).
// Nem a adulteração deliberada: a operária roda como o mesmo usuário e pode reescrever o próprio
// transcript até ser lida como `comum`; quem chega a isso já tem o mesmo usuário (e o `sudo`) da
// maestra, alcance maior que o que este hook guarda (revisão de segurança do F4.8b).
//
// Sem mode-file de propósito, como o publicacao-gate: desligar = tirar o wiring do settings.json.

const path = require("node:path");
const { lerSessao } = require(
  path.join(__dirname, "lib", "sessao-operaria.js"),
);

const ARQUIVAR = "mcp__claude-code-remote__archive_session";
const MENSAGEM = "mcp__claude-code-remote__send_message";
const CHAVES_DA_MENSAGEM = new Set(["session_id", "message"]);

function propriaSessao(raizDoProjeto) {
  // Raiz absoluta (POSIX ou drive Windows), uma linha só; o id é casado no fim do caminho.
  if (
    typeof raizDoProjeto !== "string" ||
    /[\r\n]/.test(raizDoProjeto) ||
    !/^(?:\/|[A-Za-z]:[\\/])/.test(raizDoProjeto)
  ) {
    return null;
  }
  const m =
    /[\\/]\.claude[\\/]worktrees[\\/]bridge-cse_([A-Za-z0-9]+)[\\/]?$/.exec(
      typeof raizDoProjeto === "string" ? raizDoProjeto : "",
    );
  return m ? `session_${m[1]}` : null;
}

function pergunta(reason) {
  return { decisao: "ask", reason: `Alcance da operária: ${reason}` };
}

const PUSH_DE_AVISO_RE =
  /^[ \t]*git[ \t]+push[ \t]+origin[ \t]+(['"]?)([0-9a-f]{7,40}):refs\/conducao-aviso\/([A-Za-z0-9._-]+)\/(T\d{1,3})\/([1-9]\d*)\1[ \t]*$/;

/** `Bash`: `allow` só para o push do aviso da própria tentativa; `null` = não decide. */
function decidirBash(input, args) {
  const m =
    typeof args.command === "string"
      ? PUSH_DE_AVISO_RE.exec(args.command)
      : null;
  if (!m) return null;
  const [, , , ciclo, task, n] = m;
  const sessao = lerSessao(input.transcript_path);
  if (sessao.estado !== "operaria") return null;
  if (
    sessao.ciclo === ciclo &&
    sessao.task === task &&
    sessao.tentativa === Number(n)
  ) {
    return {
      decisao: "allow",
      reason: `Alcance da operária: aviso de ${task}/${n} de ${ciclo} à maestra (refs/conducao-aviso).`,
    };
  }
  return pergunta(
    `push de aviso para ${ciclo}/${task}/${n}, mas esta operária é de ${sessao.ciclo ?? "?"}/${sessao.task}/${sessao.tentativa ?? "?"}. Confirme só se foi pedido.`,
  );
}

function decidir(input, env = process.env) {
  const tool = input && typeof input === "object" ? input.tool_name : undefined;
  const args =
    input && input.tool_input && typeof input.tool_input === "object"
      ? input.tool_input
      : {};
  if (tool === "Bash") return decidirBash(input, args);
  // Forma exata de cada ferramenta: só as chaves permitidas, com o tipo certo e alvo não vazio.
  const alvoValido =
    typeof args.session_id === "string" && args.session_id.trim() !== "";
  const soId = Object.keys(args).length === 1 && alvoValido;
  const outras = Object.keys(args).filter((k) => !CHAVES_DA_MENSAGEM.has(k));
  const mensagemSimples =
    outras.length === 0 && alvoValido && typeof args.message === "string";
  if ((tool === ARQUIVAR && soId) || (tool === MENSAGEM && mensagemSimples)) {
    // Ruling F4.8b: só leitura positiva de sessão comum ganha o raio largo; operária e ilegível
    // caem no raio estreito abaixo.
    if (lerSessao(input.transcript_path).estado === "comum") {
      return {
        decisao: "allow",
        reason:
          tool === ARQUIVAR
            ? `Alcance da sessão: arquivar ${args.session_id} por sessão que não é operária (volta por unarchive_session).`
            : `Alcance da sessão: mensagem para ${args.session_id} de sessão que não é operária.`,
      };
    }
  }
  if (tool === ARQUIVAR) {
    const eu = propriaSessao(env.CLAUDE_PROJECT_DIR);
    if (!eu) {
      return pergunta(
        "não sei o id desta sessão (CLAUDE_PROJECT_DIR fora de .claude/worktrees/bridge-cse_*). Confirme o arquivamento.",
      );
    }
    if (soId && args.session_id === eu) {
      return {
        decisao: "allow",
        reason: `Alcance da operária: ${eu} arquiva a si mesma.`,
      };
    }
    return pergunta(
      `arquivar ${String(args.session_id || "(sem id)")} não é arquivar a si mesma (${eu}), e a chamada tem forma fora do raio ou vem de sessão operária ou não provada comum. Confirme só se foi pedido.`,
    );
  }
  if (tool === MENSAGEM) {
    if (mensagemSimples && args.session_id === "@parent") {
      return {
        decisao: "allow",
        reason: "Alcance da operária: mensagem para @parent.",
      };
    }
    return pergunta(
      `mensagem para ${String(args.session_id || "(sem alvo)")}${outras.length ? ` com ${outras.join(", ")}` : ""} — sessão comum passa com alvo e texto e nada mais; operária, ou sessão não provada comum, só com "@parent" e texto.`,
    );
  }
  return pergunta(
    `ferramenta ${String(tool || "(sem nome)")} chegou a este hook, que só decide archive_session, send_message e o push de aviso por Bash. Confirme a chamada.`,
  );
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let d;
    try {
      d = decidir(JSON.parse(raw));
    } catch {
      d = pergunta("entrada do hook ilegível; confirme a chamada.");
    }
    if (d === null) process.exit(0); // `Bash` fora do aviso: não decide, vale o fluxo normal
    try {
      require("node:fs").writeSync(
        1,
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: d.decisao,
            permissionDecisionReason: d.reason,
          },
        }) + "\n",
      );
    } catch {
      process.exit(2); // sem decisão escrita, bloquear é o único fail-closed que resta
    }
    process.exit(0);
  });
}

module.exports = { decidir, propriaSessao };
