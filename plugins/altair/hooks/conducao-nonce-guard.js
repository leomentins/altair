"use strict";
// conducao-nonce-guard — toda ação da maestra sobre sessão cita o nonce que o script emitiu
// (VEGA-22 T15, AC-VEGA22-3, D-VEGA22-2). Nasce em SHADOW: grava a divergência e sai 0.
//
// O QUE COMPARA. `PreToolUse` sobre `create_session`, `send_message` e `archive_session` do
// conector remoto. A "última ação emitida" é o último evento de procedência `intencao` no log
// de eventos de cada ciclo conduzido (`log-eventos.mjs`, log v1: `<pasta>/<ciclo>.jsonl`, pasta =
// a do projeto da declaração do adaptador em `CLAUDE_PROJECT_DIR`, ou `ALTAIR_CONDUCAO_LOG_DIR`). Os
// nonces dela são `atributos.nonce`, cada item de `atributos.nonces` (o `abrir` de N tarefas)
// e `atributos.nonceArquivar`. Vale o de qualquer ciclo com log: a sessão da maestra não diz de
// qual ciclo é, e uma maestra por ciclo (skill `conducao` §1) deixa um log vivo por ciclo.
//
// DE ONDE SAI O NONCE DO INPUT (D-VEGA22-27). A forma do `tool_input` no conector remoto não
// foi medida (premissas-f0 §T2 provou só servidor MCP `stdio`). Por isso o hook lê QUALQUER
// campo texto do input, em qualquer profundidade, e procura token de 16 hex (o `nonce()` de
// `conducao.mjs`). Sem nenhum campo texto ⇒ `forma-desconhecida`, com as CHAVES vistas — nunca
// os valores: o `prompt` de `create_session` é a partida da task (o brief, nos scripts antigos).
//
// `archive_session` não tem onde citar nonce: a ferramenta recebe só `session_id` (e o
// `operaria-alcance-guard` pergunta diante de chave extra). Para ela o nonce é citado pela
// sessão: `session_id` igual à `sessao` da última ação `arquivar` emitida conta `ok`, com
// `via: sessao` no log — senão vale a regra geral.
//
// RESULTADOS (uma linha por chamada, inclusive no passe — log vazio nunca se lê como "tudo
// conforme"): `ok` · `divergencia` (`sem-nonce` | `nonce-diferente` | `sem-acao-emitida`) ·
// `forma-desconhecida` · `erro`. Critério de promoção: `INSTALL-conducao.md`.
//
// Modo: `<CLAUDE_PROJECT_DIR>/<guardas.pastaDoModo>/conducao-nonce-guard-mode`, na pasta que a
// declaração do adaptador aponta (`lib/modo-do-guarda.js`) — `shadow` (default; sem o campo,
// sem o arquivo ou valor desconhecido = shadow) · `hard` (divergência sai 2 e bloqueia a chamada) · `off`. `forma-
// desconhecida`, `erro` e `sem-acao-emitida` nunca bloqueiam, nem em `hard`: o hook não julga o
// que não sabe ler, e sem condução viva a chamada é de sessão que não é maestra.
//
// FORA DO ALCANCE: sessão operária — a que nasceu de um brief da condução (`lib/sessao-operaria.js`,
// pelo `transcript_path` do payload; a mesma regra do `operaria-stop-guard`). O aviso dela cita o
// nonce da tentativa, não o da última ação da maestra. Desde [[decisao/filha-herdeira-da-maestra]]
// a filha roda como o mesmo usuário da maestra e LÊ o mesmo log: o usuário do SO não a separa
// mais, o nascimento sim. Só a leitura POSITIVA de operária tira a chamada do alcance
// (`contratoDaSessao`): payload sem transcript, transcript que não se lê ou que passa do teto de
// bytes antes do pedido é julgado como de maestra — grava a linha de sempre e, em `hard`, uma
// divergência dessa sessão bloqueia a chamada. Ou seja: a dúvida cai do lado que julga, não do
// lado que deixa passar calado.
//
// Log: `<pasta do log de eventos>/conducao-nonce-guard.log` (JSONL), fora da árvore da sessão —
// a worktree da maestra é efêmera e o critério de promoção lê o log de várias sessões.
//
// NUNCA crash: erro interno ⇒ linha `erro` e exit 0.

const fs = require("node:fs");
const path = require("node:path");
const { lerModoDoGuarda } = require(
  path.join(__dirname, "lib", "modo-do-guarda.js"),
);
const { contratoDaSessao } = require(
  path.join(__dirname, "lib", "sessao-operaria.js"),
);

// Forma do nonce: um dono só, na gramática das marcas da condução (VEGA-29 T5).
const { NONCE_RE } = require(
  path.join(__dirname, "..", "scripts", "conducao", "marcas.mjs"),
);

const NOME = "conducao-nonce-guard";
const FERRAMENTAS = Object.freeze({
  "mcp__claude-code-remote__create_session": "create_session",
  "mcp__claude-code-remote__send_message": "send_message",
  "mcp__claude-code-remote__archive_session": "archive_session",
});
const PROFUNDIDADE = 6;
const TETO_VISTOS = 8;

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

/** Campos texto do input: `{ textos, chaves }`. Chaves com caminho pontuado; valores nunca saem daqui. */
function lerInput(input) {
  const textos = [];
  const chaves = [];
  const andar = (v, prefixo, nivel) => {
    if (nivel > PROFUNDIDADE || v === null || v === undefined) return;
    if (typeof v === "string") {
      textos.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => andar(x, `${prefixo}[${i}]`, nivel + 1));
      return;
    }
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const nome = prefixo ? `${prefixo}.${k}` : k;
        chaves.push(nome);
        andar(x, nome, nivel + 1);
      }
    }
  };
  andar(input, "", 0);
  return { textos, chaves: chaves.slice(0, 40) };
}

function noncesDoTexto(textos) {
  const vistos = new Set();
  for (const t of textos)
    for (const m of t.matchAll(NONCE_RE)) vistos.add(m[0]);
  return [...vistos];
}

/** Última ação de procedência `intencao` de cada ciclo com log: `[{ ciclo, acao, nonces, sessoes }]`. */
function ultimasAcoes(pasta) {
  let arquivos;
  try {
    arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const acoes = [];
  for (const f of arquivos.sort()) {
    let ultima = null;
    let texto;
    try {
      texto = fs.readFileSync(path.join(pasta, f), "utf8");
    } catch {
      continue;
    }
    for (const l of texto.split("\n")) {
      if (!l) continue;
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        continue; // linha truncada por queda: o log-eventos a tolera, aqui também
      }
      if (o && o.linha === "evento" && o.procedencia === "intencao") ultima = o;
    }
    if (!ultima) continue;
    const a = ultima.atributos || {};
    const nonces = new Set();
    for (const k of ["nonce", "nonceArquivar"])
      if (typeof a[k] === "string") nonces.add(a[k]);
    if (typeof a.nonces === "string")
      for (const n of a.nonces.split("+")) if (n) nonces.add(n);
    const sessoes = (ultima.objetos || [])
      .filter((x) => x && x.tipo === "sessao" && typeof x.id === "string")
      .map((x) => x.id.replace(/^sessao:/, ""));
    acoes.push({
      ciclo: f.slice(0, -".jsonl".length),
      acao: ultima.acao,
      nonces: [...nonces],
      sessoes,
      quando: typeof ultima.quando === "string" ? ultima.quando : null,
    });
  }
  return acoes;
}

/**
 * Julgamento puro. `input` = payload do hook; `acoes` = `ultimasAcoes()`. Devolve a linha do
 * log (sem `ts`) ou `null` quando a ferramenta não é nenhuma das três.
 */
function julgar(input, acoes) {
  const ferramenta = FERRAMENTAS[input && input.tool_name];
  if (!ferramenta) return null;
  const args = input.tool_input;
  const { textos, chaves } = lerInput(
    args && typeof args === "object" ? args : {},
  );
  if (!textos.length)
    return { resultado: "forma-desconhecida", ferramenta, chaves };

  const vistos = noncesDoTexto(textos);
  const base = { ferramenta, chaves, vistos: vistos.slice(0, TETO_VISTOS) };
  if (!acoes.length)
    return { resultado: "divergencia", motivo: "sem-acao-emitida", ...base };

  for (const a of acoes) {
    const n = vistos.find((v) => a.nonces.includes(v));
    if (n)
      return {
        resultado: "ok",
        ciclo: a.ciclo,
        acao: a.acao,
        nonce: n,
        ...base,
      };
  }
  if (ferramenta === "archive_session" && typeof args.session_id === "string") {
    const sessao = args.session_id;
    const a = acoes.find(
      (x) => x.acao === "arquivar" && x.sessoes.includes(sessao),
    );
    if (a)
      return {
        resultado: "ok",
        via: "sessao",
        ciclo: a.ciclo,
        acao: a.acao,
        nonce: a.nonces[0] ?? null,
        ...base,
      };
  }
  return {
    resultado: "divergencia",
    motivo: vistos.length ? "nonce-diferente" : "sem-nonce",
    esperados: acoes.map((a) => ({
      ciclo: a.ciclo,
      acao: a.acao,
      nonces: a.nonces,
    })),
    ...base,
  };
}

function lerModo(raiz, env = process.env) {
  const v = lerModoDoGuarda(NOME, raiz, env).valor;
  return v === "hard" || v === "off" ? v : "shadow";
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
    return false;
  }
}

/** Corre o hook sobre um payload já lido. Devolve o exit code. */
function executar(raw, env = process.env) {
  const raiz = env.CLAUDE_PROJECT_DIR || process.cwd();
  const { pasta, erro: erroDoAdaptador } = pastaDoLog(env, raiz);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    gravar(pasta, {
      resultado: "erro",
      motivo: "payload-ilegivel",
      erro: String(e.message || e).slice(0, 200),
    });
    return 0;
  }
  const modo = lerModo(raiz, env);
  if (modo === "off") return 0;
  // Só as três ferramentas pagam a leitura do transcript; a operária fica fora.
  if (
    input &&
    FERRAMENTAS[input.tool_name] &&
    contratoDaSessao(input.transcript_path)
  )
    return 0;
  if (erroDoAdaptador && input && FERRAMENTAS[input.tool_name]) {
    gravar(pasta, {
      resultado: "erro",
      motivo: "adaptador-invalido",
      erro: erroDoAdaptador,
    });
    process.stderr.write(
      `CONDUCAO-NONCE [${modo}] adaptador-invalido — guard sem a pasta do log do projeto, não julga: ${erroDoAdaptador}\n`,
    );
    return 0;
  }
  let linha;
  try {
    linha = julgar(input, ultimasAcoes(pasta));
  } catch (e) {
    gravar(pasta, {
      resultado: "erro",
      motivo: "interno",
      erro: String(e.message || e).slice(0, 200),
    });
    return 0;
  }
  if (!linha) return 0;
  const gravou = gravar(pasta, { modo, sessao: path.basename(raiz), ...linha });
  if (linha.resultado !== "divergencia") return 0;
  const msg = `CONDUCAO-NONCE [${modo}] ${linha.ferramenta}: ${linha.motivo} — ação de sessão sem o nonce da última ação emitida por conducao.mjs proximo${gravou ? "" : " (falha ao gravar o log)"}\n`;
  process.stderr.write(msg);
  return modo === "hard" && linha.motivo !== "sem-acao-emitida" ? 2 : 0;
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.on("end", () => {
    let code = 0;
    try {
      code = executar(raw);
    } catch {
      code = 0;
    }
    process.exit(code);
  });
}

module.exports = {
  julgar,
  ultimasAcoes,
  lerInput,
  noncesDoTexto,
  executar,
  pastaDoLog,
  lerModo,
  FERRAMENTAS,
};
