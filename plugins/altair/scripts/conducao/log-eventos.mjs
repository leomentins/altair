/**
 * log-eventos.mjs — o estado da condução como log de eventos por objeto (VEGA-22 T13).
 *
 * Modelo de D-GAME1-21 (canonico do GAME-1), para a planta Construção do
 * gêmeo consumir: JSONL append-only, um arquivo por ciclo conduzido em
 * `~/.local/state/altair/conducao/<ciclo>.jsonl`, no desenho OCEL 2.0 —
 * objeto, evento ligado a N objetos com qualificador, objeto→objeto e
 * histórico de atributo. Uma linha por elemento, discriminada por `linha`:
 *
 *   { linha: "objeto",   chave, quando, procedencia, id, tipo }
 *   { linha: "relacao",  chave, quando, procedencia, de, para, qualificador }
 *   { linha: "evento",   chave, quando, procedencia, acao, objetos: [{ id, tipo, qualificador }], atributos }
 *   { linha: "atributo", chave, quando, procedencia, objeto, nome, valor, evento }
 *
 * Procedência em toda linha: `intencao` (ação que o `proximo` emitiu, ou
 * pergunta de um verbo), `registrado` (o que um verbo de git gravou no ramo)
 * e `observado` (o que a maestra viu e trouxe por `registrar-evento`).
 * Intenção nunca gera histórico de atributo — só fato muda estado (D-GAME1-12).
 *
 * Escrita idempotente por chave: a chave é o hash do conteúdo sem o horário,
 * então o mesmo estado repetido (mesmo nonce) não duplica linha.
 *
 * Campos por allowlist (PHI não atravessa fronteira, §5 do canonico): só ids,
 * sha, nonce, ação, estado e horário UTC. Valor de atributo é token sem
 * espaço — texto de conversa, prompt, relato da filha, corpo de commit,
 * `--motivo` livre e diff de plano ficam fora, e a saída diz quais chaves caíram.
 *
 * O esquema do gêmeo mora em outro repositório (ausente no servidor, §2.2#15):
 * o teste fixa a forma descrita em D-GAME1-21 e a conferência contra o
 * esquema real fica com o consumidor (§7 R4).
 *
 * Log v1 (VEGA-29 T11, D-VEGA29-3): toda linha leva `v: 1`, o arquivo mora em
 * `<pasta>/<projeto>/<ciclo>.jsonl` (projeto da declaração do adaptador) e a
 * forma está em `log-v1.schema.json`, conferida na escrita sem `ajv` (núcleo
 * sem dependência). Os logs v0 da estação ficam em `<pasta>/<ciclo>.jsonl`,
 * só leitura (D-VEGA29-21): `lerLog` trata linha sem `v` como v0 e nunca a
 * reescreve, e `registrar` recusa acrescentar a um arquivo com linha v0.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Versão do log que este módulo escreve. */
export const VERSAO = 1;
export const ARQUIVO_DO_ESQUEMA = path.join(path.dirname(fileURLToPath(import.meta.url)), "log-v1.schema.json");

export const PROCEDENCIAS = Object.freeze(["intencao", "registrado", "observado"]);

/** Atributos de evento aceitos. Qualquer outra chave da saída cai. */
export const ATRIBUTOS = Object.freeze([
  "nonce",
  "nonceTentativa",
  "nonceArquivar",
  "sha",
  "head",
  "plano",
  "base",
  "antes",
  "depois",
  "copia",
  "ref",
  "tentativa",
  "estado",
  "motivo",
  "verificacao",
  "publicacao",
  "desfecho",
  "modo",
  "coberta",
  "vezes",
  "falhas",
  "aviso",
  // Pergunta tipada (T12, D-VEGA29-20): só tokens; o texto fica fora, só o hash.
  "decisao",
  "numero",
  "opcoes",
  "recomendada",
  "destinatario",
  "textoSha256",
]);

const TOKEN = /^[A-Za-z0-9._:/+@-]{1,200}$/;

/** Estado que cada fato registrado pelo git deixa no objeto (histórico de atributo). */
const ESTADO_REGISTRADO = Object.freeze({
  autorizada: ["fase", "autorizada"],
  aberta: ["tentativa", "aberta"],
  trazida: ["tentativa", "trazida"],
  conferida: ["task", "conferida"],
  "falha-registrada": ["tentativa", "falhou"],
  revertida: ["tentativa", "revertida"],
  "rodada-registrada": ["tentativa", "rodada"],
  "carimbo-registrado": ["tentativa", "carimbo"],
  "publicacao-recusada": ["task", "publicacao-recusada"],
});

const PROJETO = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Projeto como segmento de caminho: token minúsculo, sem ponto nem barra. */
export function validarProjeto(projeto) {
  if (typeof projeto !== "string" || !PROJETO.test(projeto)) throw new Error(`projeto inválido para o log: ${projeto}`);
  return projeto;
}

/**
 * Pasta do log. `ALTAIR_CONDUCAO_LOG_DIR` sobrepõe por inteiro (é a pasta
 * final, projeto já escolhido por quem a pôs); sob `node --test` sem override,
 * a base vai para o tmp — as suítes da condução chamam a CLI e não podem sujar
 * o estado real da estação. Sem `projeto`, devolve a base: a pasta antiga,
 * onde moram os logs v0 (D-VEGA29-21).
 */
export function pastaDoLog(env = process.env, projeto) {
  if (env.ALTAIR_CONDUCAO_LOG_DIR) return env.ALTAIR_CONDUCAO_LOG_DIR;
  const base = env.NODE_TEST_CONTEXT
    ? path.join(tmpdir(), "altair-conducao-log-teste")
    : path.join(env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "altair", "conducao");
  return projeto === undefined ? base : path.join(base, validarProjeto(projeto));
}

export function arquivoDoLog(ciclo, pasta = pastaDoLog()) {
  if (!TOKEN.test(ciclo ?? "") || ciclo.includes("/")) throw new Error(`ciclo inválido para o log: ${ciclo}`);
  return path.join(pasta, `${ciclo}.jsonl`);
}

function token(v) {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  return typeof v === "string" && TOKEN.test(v);
}

function hash(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 24);
}

// ── objetos ──────────────────────────────────────────────────────────────────

const id = {
  ciclo: (c) => `ciclo:${c}`,
  fase: (c, f) => `fase:${c}/${f}`,
  task: (c, t) => `task:${c}/${t}`,
  tentativa: (c, t, n) => `tentativa:${c}/${t}/${n}`,
  sessao: (s) => `sessao:${s}`,
};

/**
 * Objetos de uma saída da condução, com qualificador e as relações entre eles.
 * `tarefas` (o `abrir` do `proximo`) liga cada task e tentativa da leva.
 */
function objetosDa(saida) {
  const c = saida.ciclo;
  const objetos = [{ id: id.ciclo(c), tipo: "ciclo", qualificador: "conduzido" }];
  const relacoes = [];
  const add = (o) => {
    if (!objetos.some((x) => x.id === o.id)) objetos.push(o);
  };
  const fase = token(saida.fase) && /^F\d{1,2}$/.test(saida.fase) ? saida.fase : null;
  if (fase) {
    add({ id: id.fase(c, fase), tipo: "fase", qualificador: "da-fase" });
    relacoes.push([id.fase(c, fase), id.ciclo(c), "pertence-a"]);
  }
  const tasks = [];
  if (Array.isArray(saida.tarefas)) for (const x of saida.tarefas) tasks.push([x?.task, x?.tentativa]);
  else tasks.push([saida.task, saida.tentativa]);
  for (const [t, n] of tasks) {
    if (typeof t !== "string" || !/^T\d{1,3}$/.test(t)) continue;
    add({ id: id.task(c, t), tipo: "task", qualificador: "alvo" });
    if (fase) relacoes.push([id.task(c, t), id.fase(c, fase), "pertence-a"]);
    if (Number.isInteger(n) && n > 0) {
      add({ id: id.tentativa(c, t, n), tipo: "tentativa", qualificador: "tentativa" });
      relacoes.push([id.tentativa(c, t, n), id.task(c, t), "tentativa-de"]);
    }
  }
  if (token(saida.sessao) && typeof saida.sessao === "string") {
    add({ id: id.sessao(saida.sessao), tipo: "sessao", qualificador: "filha" });
    const tent = objetos.find((o) => o.tipo === "tentativa");
    if (tent) relacoes.push([id.sessao(saida.sessao), tent.id, "executa"]);
  }
  return { objetos, relacoes };
}

/** Atributos da saída que passam a allowlist; `descartados` são as chaves que caíram. */
export function filtrarAtributos(saida) {
  const ignorar = new Set(["acao", "ciclo", "fase", "task", "sessao", "tarefas"]);
  const atributos = {};
  const descartados = [];
  for (let [k, v] of Object.entries(saida)) {
    // `copia` dos verbos de git é `{ copia, anterior, empurrada }`: vale o sha.
    if (k === "copia" && v && typeof v === "object") v = v.copia;
    if (ignorar.has(k) || v === null || v === undefined) continue;
    if (ATRIBUTOS.includes(k) && token(v)) atributos[k] = v;
    else descartados.push(k);
  }
  if (Array.isArray(saida.tarefas)) atributos.nonces = saida.tarefas.map((x) => x?.nonce).filter(token).join("+") || undefined;
  if (atributos.nonces === undefined) delete atributos.nonces;
  return { atributos, descartados: descartados.sort() };
}

/**
 * Linhas do log para uma saída da condução (`proximo`, verbo de git ou
 * `registrar-evento`). Pura: não lê nem escreve arquivo.
 */
export function linhasDoEvento(saida, { procedencia, quando }) {
  if (!PROCEDENCIAS.includes(procedencia)) throw new Error(`procedência inválida: ${procedencia}`);
  if (!saida || typeof saida.acao !== "string" || !TOKEN.test(saida.acao)) throw new Error("evento sem acao");
  if (!token(saida.ciclo)) throw new Error("evento sem ciclo");
  const instante = new Date(quando ?? Date.now());
  if (Number.isNaN(instante.getTime())) throw new Error(`horário ilegível: ${quando}`);
  const iso = instante.toISOString();

  const { objetos, relacoes } = objetosDa(saida);
  const { atributos, descartados } = filtrarAtributos(saida);
  const corpoEvento = { linha: "evento", procedencia, acao: saida.acao, objetos, atributos };
  const chaveEvento = hash(corpoEvento);
  const linhas = [];
  for (const o of objetos) {
    const corpo = { linha: "objeto", id: o.id, tipo: o.tipo };
    linhas.push({ v: VERSAO, ...corpo, chave: hash(corpo), quando: iso, procedencia });
  }
  for (const [de, para, qualificador] of relacoes) {
    const corpo = { linha: "relacao", de, para, qualificador };
    linhas.push({ v: VERSAO, ...corpo, chave: hash(corpo), quando: iso, procedencia });
  }
  linhas.push({ v: VERSAO, ...corpoEvento, chave: chaveEvento, quando: iso });

  // Histórico de atributo: só fato (registrado/observado), nunca intenção.
  let alvoEstado = null;
  if (procedencia === "registrado" && ESTADO_REGISTRADO[saida.acao] && saida.nova !== false) {
    const [tipo, valor] = ESTADO_REGISTRADO[saida.acao];
    const o = objetos.find((x) => x.tipo === tipo);
    if (o) alvoEstado = [o.id, valor];
  } else if (procedencia === "observado" && token(saida.estado)) {
    const ordem = ["sessao", "tentativa", "task", "fase", "ciclo"];
    const o = ordem.map((t) => objetos.find((x) => x.tipo === t)).find(Boolean);
    alvoEstado = [o.id, saida.estado];
  }
  if (alvoEstado) {
    const corpo = { linha: "atributo", objeto: alvoEstado[0], nome: "estado", valor: alvoEstado[1], evento: chaveEvento };
    linhas.push({ v: VERSAO, ...corpo, chave: hash(corpo), quando: iso, procedencia });
  }
  return { linhas, chave: chaveEvento, descartados };
}

// ── esquema v1, conferido sem dependência ────────────────────────────────────

let esquema = null;
function esquemaV1() {
  esquema ??= JSON.parse(readFileSync(ARQUIVO_DO_ESQUEMA, "utf8"));
  return esquema;
}

function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/**
 * Subconjunto de JSON Schema que `log-v1.schema.json` usa: `$ref` local,
 * `oneOf`, `type`, `const`, `enum`, `pattern`, `minLength`, `maxLength`,
 * `required`, `properties`, `additionalProperties: false`, `items`.
 * Devolve a lista de erros (vazia ⇒ conforme). Palavra-chave fora de
 * `PALAVRAS_DO_ESQUEMA` não é conferida: o teste do log v1 recusa esquema que a use.
 */
export const PALAVRAS_DO_ESQUEMA = Object.freeze([
  "$schema", "$id", "$defs", "$ref", "title", "description",
  "oneOf", "type", "const", "enum", "pattern", "minLength", "maxLength",
  "required", "properties", "additionalProperties", "items",
]);

export function conferirEsquema(valor, no = esquemaV1(), raiz = esquemaV1(), onde = "$") {
  if (no.$ref) {
    const alvo = no.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], raiz);
    if (!alvo) return [`${onde}: $ref sem alvo ${no.$ref}`];
    return conferirEsquema(valor, alvo, raiz, onde);
  }
  if (no.oneOf) {
    const porForma = no.oneOf.map((s) => conferirEsquema(valor, s, raiz, onde));
    const casam = porForma.filter((e) => e.length === 0).length;
    if (casam === 1) return [];
    // Nenhuma casa: os erros da forma mais próxima dizem o que falta.
    if (casam === 0) return porForma.reduce((a, b) => (b.length < a.length ? b : a));
    return [`${onde}: casa ${casam} das formas de oneOf (esperado 1)`];
  }
  const erros = [];
  if (no.type) {
    const tipos = [no.type].flat();
    const t = tipoDe(valor);
    if (!tipos.includes(t) && !(t === "integer" && tipos.includes("number"))) return [`${onde}: tipo ${t}, esperado ${tipos.join("|")}`];
  }
  if ("const" in no && valor !== no.const) erros.push(`${onde}: esperado ${JSON.stringify(no.const)}`);
  if (no.enum && !no.enum.includes(valor)) erros.push(`${onde}: fora de ${no.enum.join("|")}`);
  if (typeof valor === "string") {
    if (no.pattern && !new RegExp(no.pattern, "u").test(valor)) erros.push(`${onde}: não casa ${no.pattern}`);
    if (no.minLength !== undefined && valor.length < no.minLength) erros.push(`${onde}: curto demais`);
    if (no.maxLength !== undefined && valor.length > no.maxLength) erros.push(`${onde}: longo demais`);
  }
  if (tipoDe(valor) === "object") {
    for (const k of no.required ?? []) if (valor[k] === undefined) erros.push(`${onde}: falta ${k}`);
    for (const [k, v] of Object.entries(valor)) {
      const sub = no.properties?.[k];
      if (sub) erros.push(...conferirEsquema(v, sub, raiz, `${onde}.${k}`));
      else if (no.additionalProperties === false) erros.push(`${onde}: chave fora do esquema ${k}`);
    }
  }
  if (Array.isArray(valor) && no.items) valor.forEach((v, i) => erros.push(...conferirEsquema(v, no.items, raiz, `${onde}[${i}]`)));
  return erros;
}

/** Recusa na escrita a linha que não é v1 conforme o esquema. */
export function validarLinha(linha) {
  if (!linha || linha.v !== VERSAO) throw new Error(`linha sem versão ${VERSAO}: o log v1 não aceita evento sem versão`);
  const erros = conferirEsquema(linha);
  if (erros.length) throw new Error(`linha fora do esquema v1: ${erros.slice(0, 3).join("; ")}`);
  return linha;
}

/**
 * Lê um arquivo de log: linha sem `v` volta como v0 (`v: 0`), as demais como
 * estão. Só leitura — nunca reescreve o arquivo (D-VEGA29-21). Linha truncada
 * por queda é pulada.
 */
export function lerLog(arquivo) {
  if (!existsSync(arquivo)) return [];
  const linhas = [];
  for (const l of readFileSync(arquivo, "utf8").split("\n")) {
    if (!l) continue;
    try {
      const o = JSON.parse(l);
      if (o && typeof o === "object") linhas.push("v" in o ? o : { v: 0, ...o });
    } catch {
      // linha truncada por queda: fica, e a chave dela pode ser regravada
    }
  }
  return linhas;
}

/**
 * Recusa de gravar num arquivo que já tem linha v0 (D-VEGA29-21): diz o que
 * achou (quantas linhas sem versão), onde (o arquivo) e que o v0 é só
 * leitura. Tipada (`codigo`) para o CLI sair com recusa, nunca com a pilha.
 */
export class ErroLogV0 extends Error {
  constructor(arquivo, linhas) {
    super(
      `${arquivo} é log v0: só leitura (D-VEGA29-21), com ${linhas} linha(s) sem versão; o v1 não grava nele, ` +
        "grava na pasta do projeto — a pasta do log aponta para a pasta antiga",
    );
    this.name = "ErroLogV0";
    this.codigo = "log-v0-so-leitura";
    this.arquivo = arquivo;
    this.linhas = linhas;
  }
}

/**
 * Grava o evento de uma saída no log do ciclo. Devolve o arquivo, a chave do
 * evento, se ele é novo e as chaves da saída que a allowlist descartou.
 */
export function registrar(saida, { procedencia, quando, pasta = pastaDoLog() } = {}) {
  const arquivo = arquivoDoLog(saida?.ciclo, pasta);
  const { linhas, chave, descartados } = linhasDoEvento(saida, { procedencia, quando });
  linhas.forEach(validarLinha);
  const gravadas = lerLog(arquivo);
  const v0 = gravadas.filter((l) => l.v === 0).length;
  if (v0) throw new ErroLogV0(arquivo, v0);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const ja = new Set(gravadas.map((l) => l.chave).filter(Boolean));
  const novas = linhas.filter((l) => !ja.has(l.chave));
  if (novas.length) appendFileSync(arquivo, novas.map((l) => `${JSON.stringify(l)}\n`).join(""));
  return { arquivo, chave, novo: !ja.has(chave), linhas: novas.length, descartados };
}
