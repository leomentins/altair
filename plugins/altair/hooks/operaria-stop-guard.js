"use strict";
// operaria-stop-guard — a operária não encerra sem entregar nem devolver (VEGA-22 T15).
//
// `Stop`, só em sessão operária: a que nasceu de um brief da condução (regra única em
// `lib/sessao-operaria.js` — a filha roda como o mesmo usuário da maestra desde
// [[decisao/filha-herdeira-da-maestra]], então o usuário do SO não distingue mais). A filha
// conduzida termina de um de dois jeitos (brief da operária, skill
// `conducao`): commit com o subject da task e aviso `T<k>-OK`, ou aviso `T<k>-FALHA … <nonce>`
// devolvido à maestra na primeira linha da resposta final. Encerrar sem nenhum dos dois deixa a maestra
// esperando até o prazo da vigia (T12) — este hook recusa o encerramento e diz o que falta.
// Sessão PROVADA não operária (transcript lido, sem contrato no pedido) sai 0 sem ler o resto e
// sem linha no log: o `Stop` corre a cada resposta de toda sessão do usuário. Transcript que vem
// no payload e não se lê (ou passa do teto de bytes antes do pedido) NÃO é lido como sessão
// comum: grava `{ resultado: "erro", motivo: "transcript-ilegivel" }` e avisa no stderr, e libera
// (o hook nunca recusa sem saber quem é).
//
// DE ONDE SAI CADA COISA.
//   - Task e nonce: o cabeçalho do contrato, `contrato da operária — T<k> · nonce \`<x>\``, no
//     PEDIDO com que a sessão nasceu (a primeira mensagem de usuário, `contratoDaSessao`). Sem
//     ele, a sessão não é operária conduzida e o hook sai 0.
//   - Commit "desde o início da sessão": na árvore do `cwd`, commits entre o HEAD e o marcador
//     `Conducao: abrir T<k> tentativa <n> nonce <x>` (o ponto de partida que o brief manda
//     buscar antes de tudo) cujo subject é `<ciclo>-F<n>/T<k> — …` (barra ou ponto). Marcador
//     fora do histórico do HEAD ⇒ nenhum commit conta: a filha não partiu da tentativa.
//   - Devolvida à maestra: a ÚLTIMA resposta de texto da filha (ou `last_assistant_message` do
//     payload) cuja primeira linha é `T<k>-FALHA <motivo…> <nonce>` — a maestra lê essa
//     resposta sem o conector (ruling 18.4a, T18: `send_message` da filha pede clique do operador).
//     `send_message @parent` com a mesma primeira linha segue valendo. A pergunta (`T<k>-FALHA pergunta <nonce>`) é uma delas;
//     qualquer FALHA conta, porque é pelo mesmo aviso que toda falha volta, e recusar o fim de
//     quem já avisou só a faria repetir o aviso.
//
// TETO. Recusa no máximo 3 vezes por sessão (contadas no log); a 4ª libera com
// `liberado-teto`, para um fim impossível — ferramenta de mensagem fora do ar — não virar laço.
// Log que não se lê (fora ENOENT) ou recusa que não se grava deixa o teto incontável: libera com
// `liberado-sem-log` e aviso no stderr, nunca recusa sem teto (ruling 16.4a).
//
// Log: `operaria-stop-guard.log` (JSONL) na pasta do log v1 do projeto (`<base>/<projeto>/`, a do adaptador),
// no home do usuário (o mesmo da maestra). Só ids, task, nonce, contagens e o resultado.
//
// Modo: `<CLAUDE_PROJECT_DIR>/<guardas.pastaDoModo>/operaria-stop-guard-mode`, na pasta que a
// declaração do adaptador aponta (`lib/modo-do-guarda.js`) — `shadow` (default; sem o campo,
// ausente, vazio ou valor desconhecido = shadow) · `hard` (recusa o fim, como descrito acima).
// Em shadow o julgamento é o mesmo, mas a recusa vira linha `teria-bloqueado` no log e o hook
// sai 0 sem decisão; linha que não se grava avisa no stderr (shadow que não grava está cego).
// `teria-bloqueado` não conta no teto: o teto conta só recusas de fato (`bloqueado`).
// Desligar = tirar o registro do settings.json.
// NUNCA crash: erro ⇒ linha `erro` e exit 0 (libera).

const fs = require("node:fs");
const path = require("node:path");
const { lerModoDoGuarda } = require(
  path.join(__dirname, "lib", "modo-do-guarda.js"),
);
const { CONTRATO_RE, lerSessao, contratoDoTranscript } = require(
  path.join(__dirname, "lib", "sessao-operaria.js"),
);

// Gramática das marcas e executor git: um dono só, no núcleo da condução (VEGA-29 T5).
const { ehMarcadorDe } = require(
  path.join(__dirname, "..", "scripts", "conducao", "marcas.mjs"),
);
const { tentarGit } = require(
  path.join(__dirname, "..", "scripts", "conducao", "git-exec.mjs"),
);

const NOME = "operaria-stop-guard";
const TETO = 3;

// Pasta do log v1 (VEGA-29 T11): a mesma que `registrar` usa — `<base>/<projeto>/`, com o
// projeto da declaração do adaptador da raiz. Sem a cópia CJS de antes, que lia a pasta-base
// (onde só ficam os v0) e via `sem-acao-emitida` para sempre.
// O `require` dos dois ESM é preguiçoso e dentro do try: falha de carga (arquivo ausente,
// sintaxe, Node sem require de ESM) vira linha `erro` e exit 0, nunca exit 1 sem rastro.

/** Pasta-base sem o núcleo: só para o log do próprio hook quando nada mais carrega. */
function pastaBase(env) {
  if (env.ALTAIR_CONDUCAO_LOG_DIR) return env.ALTAIR_CONDUCAO_LOG_DIR;
  return path.join(
    env.XDG_STATE_HOME ||
      path.join(require("node:os").homedir(), ".local", "state"),
    "altair",
    "conducao",
  );
}

/**
 * `{ pasta, erro }` — `pasta` do log do projeto em `raiz`; declaração ilegível (ou núcleo
 * que não carrega) devolve a pasta-base (só para o log do próprio hook) e `erro`.
 */
function pastaDoLog(
  env = process.env,
  raiz = env.CLAUDE_PROJECT_DIR || process.cwd(),
) {
  try {
    const { lerAdaptador } = require(
      path.join(__dirname, "..", "scripts", "conducao", "adaptador.mjs"),
    );
    return { pasta: lerAdaptador(raiz, { env }).pastaDoLog, erro: null };
  } catch (e) {
    return {
      pasta: pastaBase(env),
      erro: String(e.message || e).slice(0, 300),
    };
  }
}

/** `{ modo, lido }` — `lido` é o valor cru do mode-file, `ausente` ou `sem-campo`. */
function lerModo(raiz, env = process.env) {
  const { lido } = lerModoDoGuarda(NOME, raiz, env);
  return { modo: lido === "hard" ? "hard" : "shadow", lido };
}

function textosDe(conteudo) {
  if (typeof conteudo === "string") return [conteudo];
  if (!Array.isArray(conteudo)) return [];
  return conteudo
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text);
}

/**
 * Do transcript (JSONL): `{ task, nonce, avisos }` — task e nonce pela regra de
 * `lib/sessao-operaria.js`; avisos = primeiras linhas mandadas a @parent, mais a primeira linha
 * da última resposta de texto da filha.
 */
function lerTranscript(texto) {
  const contrato = contratoDoTranscript(texto);
  const task = contrato ? contrato.task : null;
  const nonce = contrato ? contrato.nonce : null;
  const avisos = [];
  let ultimaResposta = null;
  for (const l of String(texto).split("\n")) {
    if (!l) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const msg = o && o.message;
    if (!msg) continue;
    if (o.type === "assistant" && Array.isArray(msg.content)) {
      // Toda mensagem assistant redefine a resposta final: a que só chama
      // ferramenta zera (a filha seguiu trabalhando depois do texto), e da que
      // tem texto vale o ÚLTIMO bloco.
      const textos = textosDe(msg.content).filter((x) => x.trim());
      ultimaResposta = textos.length
        ? textos[textos.length - 1].trim().split("\n")[0].trim()
        : null;
      for (const p of msg.content) {
        if (
          !p ||
          p.type !== "tool_use" ||
          typeof p.name !== "string" ||
          !p.name.endsWith("send_message")
        )
          continue;
        const i = p.input || {};
        if (i.session_id === "@parent" && typeof i.message === "string")
          avisos.push(i.message.split("\n")[0].trim());
      }
    }
  }
  const enviados = [...avisos];
  if (ultimaResposta) avisos.push(ultimaResposta);
  return { task, nonce, avisos, enviados };
}

/** Commits da task depois do marcador da tentativa, a partir do HEAD de `cwd`. */
function commitsDaTask(cwd, task, nonce) {
  const r = tentarGit(cwd, ["log", "-n", "500", "--format=%H%x1f%s", "HEAD"]);
  if (r.status !== 0)
    return {
      marcador: false,
      commits: 0,
      erro: r.erro.split("\n").at(-1) || "git log falhou",
    };
  const taskRe = new RegExp(`^\\S+-F\\d{1,2}[/.]${task} — `);
  let commits = 0;
  for (const linha of r.saida.split("\n")) {
    const subject = linha.split("\x1f")[1];
    if (subject === undefined) continue;
    if (ehMarcadorDe(subject, task, nonce)) return { marcador: true, commits };
    if (taskRe.test(subject)) commits++;
  }
  return { marcador: false, commits: 0 };
}

/** Julgamento puro: `{ resultado, motivo? }` — `liberado` | `bloqueado` | `fora-da-conducao`. */
function julgar({ task, nonce, avisos, git }) {
  if (!task) return { resultado: "fora-da-conducao" };
  const falhaRe = new RegExp(`^${task}-FALHA \\S.* ${nonce}$`);
  const devolvida = avisos.some((a) => falhaRe.test(a));
  if (git.commits > 0)
    return { resultado: "liberado", motivo: "commit-da-task" };
  if (devolvida)
    return { resultado: "liberado", motivo: "devolvida-a-maestra" };
  return {
    resultado: "bloqueado",
    motivo: git.marcador ? "sem-commit-da-task" : "fora-do-marcador",
  };
}

/** Recusas já gravadas desde o início da sessão; `null` quando o log existe e não se lê. */
function bloqueiosAnteriores(pasta, sessao) {
  try {
    return fs
      .readFileSync(path.join(pasta, `${NOME}.log`), "utf8")
      .split("\n")
      .filter((l) => {
        try {
          const o = JSON.parse(l);
          return o.sessao === sessao && o.resultado === "bloqueado";
        } catch {
          return false;
        }
      }).length;
  } catch (e) {
    return e && e.code === "ENOENT" ? 0 : null;
  }
}

function gravar(pasta, linha) {
  try {
    fs.mkdirSync(pasta, { recursive: true });
    fs.appendFileSync(
      path.join(pasta, `${NOME}.log`),
      `${JSON.stringify({ ts: new Date().toISOString(), ...linha })}\n`,
    );
    return true;
  } catch {
    // log é auxiliar no caminho que libera; no que recusa, quem chama confere
    return false;
  }
}

function razao(task, nonce, motivo) {
  const onde =
    motivo === "fora-do-marcador"
      ? `o HEAD não descende do marcador da tentativa (\`Conducao: abrir ${task} tentativa <n> nonce ${nonce}\`) — o passo 1 do contrato não foi feito`
      : `nenhum commit com o subject de ${task} depois do marcador da tentativa`;
  return (
    `Operária de ${task} não encerra assim: ${onde}, e nenhum aviso \`${task}-FALHA … ${nonce}\` foi devolvido à maestra. ` +
    `Ou commita a task e avisa \`${task}-OK <sha8> ${nonce}\`, ou encerra com a resposta final cuja primeira linha é ` +
    `\`${task}-FALHA pergunta ${nonce}\` (ou outro motivo) e a dúvida nas linhas seguintes.`
  );
}

/** Corre o hook. Devolve `{ code, saida }` — `saida` vai ao stdout quando há recusa. */
function executar(raw, env = process.env) {
  // Aqui a pasta só guarda o log do próprio hook (contagem do teto): declaração ilegível cai
  // na pasta-base, sem mudar o julgamento.
  const { pasta, erro: erroDoAdaptador } = pastaDoLog(env);
  if (erroDoAdaptador)
    gravar(pasta, {
      resultado: "erro",
      motivo: "adaptador-invalido",
      erro: erroDoAdaptador,
    });
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    gravar(pasta, { resultado: "erro", motivo: "payload-ilegivel" });
    return { code: 0 };
  }
  const sessao =
    input && typeof input.session_id === "string" ? input.session_id : null;
  // Filtro barato antes de tudo: só o pedido de nascimento. Provado não operária ⇒ nem log.
  const leitura = lerSessao(input && input.transcript_path);
  if (leitura.estado === "comum") return { code: 0 };
  if (leitura.estado === "ilegivel") {
    // Payload sem transcript: não há o que ler nem de quem falar. Com caminho, a dúvida fica no log.
    if (leitura.motivo === "sem-caminho") return { code: 0 };
    gravar(pasta, {
      sessao,
      resultado: "erro",
      motivo: "transcript-ilegivel",
      leitura: leitura.motivo,
    });
    return {
      code: 0,
      aviso: `${NOME}: transcript ilegível (${leitura.motivo}) — sem saber se a sessão é operária, libera`,
    };
  }
  try {
    const transcript = fs.readFileSync(input.transcript_path, "utf8");
    const lido = lerTranscript(transcript);
    const { task, nonce } = lido;
    // `last_assistant_message` do payload é a resposta final de fato: quando
    // vem, substitui a que o transcript (que pode estar atrasado) sugere.
    const avisos =
      typeof input.last_assistant_message === "string" &&
      input.last_assistant_message.trim()
        ? [
            ...lido.enviados,
            input.last_assistant_message.trim().split("\n")[0].trim(),
          ]
        : lido.avisos;
    if (!task) {
      gravar(pasta, { sessao, resultado: "fora-da-conducao" });
      return { code: 0 };
    }
    const git = commitsDaTask(input.cwd || process.cwd(), task, nonce);
    const v = julgar({ task, nonce, avisos, git });
    // O modo lido vai em toda linha julgada: é como a promoção a hard se prova pelo log
    // (mode-file com erro de digitação, ou lido de outra árvore, aparece em `modo_lido`).
    const m = lerModo(env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(), env);
    const base = {
      sessao,
      task,
      nonce,
      commits: git.commits,
      marcador: git.marcador,
      avisos: avisos.length,
      modo: m.modo,
      modo_lido: m.lido,
    };
    if (v.resultado !== "bloqueado") {
      gravar(pasta, { ...base, ...v });
      return { code: 0 };
    }
    if (m.modo !== "hard") {
      const linha = {
        ...base,
        resultado: "teria-bloqueado",
        motivo: v.motivo,
        ...(git.erro ? { erro: git.erro } : {}),
      };
      if (gravar(pasta, linha)) return { code: 0 };
      return {
        code: 0,
        aviso: `${NOME}: shadow sem log em ${pasta} — teria recusado ${task} (${v.motivo}) e não ficou registrado`,
      };
    }
    const anteriores = bloqueiosAnteriores(pasta, sessao);
    if (anteriores !== null && anteriores >= TETO) {
      gravar(pasta, { ...base, resultado: "liberado-teto", motivo: v.motivo });
      return { code: 0 };
    }
    // O teto só se conta pelo log: recusa que não fica gravada repetiria sem fim (ruling 16.4a).
    if (
      anteriores === null ||
      !gravar(pasta, { ...base, ...v, ...(git.erro ? { erro: git.erro } : {}) })
    ) {
      gravar(pasta, {
        ...base,
        resultado: "liberado-sem-log",
        motivo: v.motivo,
      });
      return {
        code: 0,
        aviso: `${NOME}: log ilegível em ${pasta} — sem como contar o teto de ${TETO} recusas, libera (${task} ${v.motivo})`,
      };
    }
    return {
      code: 0,
      saida: { decision: "block", reason: razao(task, nonce, v.motivo) },
    };
  } catch (e) {
    gravar(pasta, {
      sessao,
      resultado: "erro",
      motivo: "interno",
      erro: String(e.message || e).slice(0, 200),
    });
    return { code: 0 };
  }
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.on("end", () => {
    let r = { code: 0 };
    try {
      r = executar(raw);
    } catch {
      r = { code: 0 };
    }
    if (r.aviso) {
      try {
        fs.writeSync(2, `${r.aviso}\n`);
      } catch {
        // sem stderr, nada a fazer
      }
    }
    if (r.saida) {
      try {
        fs.writeSync(1, `${JSON.stringify(r.saida)}\n`);
      } catch {
        // sem como recusar, libera
      }
    }
    process.exit(r.code);
  });
}

module.exports = {
  julgar,
  lerModo,
  lerTranscript,
  commitsDaTask,
  executar,
  CONTRATO_RE,
  pastaDoLog,
};
