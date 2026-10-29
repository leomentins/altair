/**
 * pergunta.mjs — a pergunta tipada da condução, numa forma só (VEGA-29 T12, AC-VEGA29-3).
 *
 * Toda parada da condução é uma decisão no molde do esboço do VEGA-19
 * (D-VEGA19-3, um tipo só): id, número da sessão, opções, recomendação e
 * destinatário. `perguntar` é o único construtor — as cinco formas que havia
 * (`acao("perguntar")` do `decidir`, `perguntar()` dos verbos, o objeto do
 * `conferir`, `erroComoPergunta` e o do modo da maestra no CLI; revisão
 * `3-codigo.md` §2) passam por ele. A saída do construtor mantém a forma que
 * a maestra já lê (`acao: "perguntar"`, `motivo`, os campos do chamador);
 * a decisão se deriva dela por `decisaoDe`, sem campo novo no JSON.
 *
 * Gravação (`gravar`) no destino que o adaptador declara (`pastaDaPergunta`,
 * D-VEGA29-4), como evento `acao: "pergunta"` do log v1. Só tokens passam
 * (D-VEGA29-20): id da decisão, número da sessão, ids das opções, id da
 * recomendada, papel destinatário e o `sha256` do texto. O texto das opções
 * e da recomendação nunca entra no log; segue onde a maestra o escreve, na
 * conversa. O banco do harness não ganha tipo nem verbo (ruling 26-a do
 * plan-review v1); o registro em catálogo fica com o VEGA-19.
 */
import { createHash } from "node:crypto";
import * as logEventos from "./log-eventos.mjs";

export const ACAO = "perguntar";
/** Ação do evento que a gravação deixa no log (≠ a intenção `perguntar`). */
export const EVENTO = "pergunta";
/** Papéis que recebem a pergunta (`dev-discipline.md` §Escalation). */
export const DESTINATARIOS = Object.freeze(["operador", "responsavel-clinico"]);

const MOTIVO = /^[A-Za-z0-9._:/+@-]{1,200}$/;
const ID_DE_OPCAO = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Saídas que nasceram do construtor; `gravar` só aceita estas. */
const CONSTRUIDAS = new WeakSet();

export class ErroPergunta extends Error {
  constructor(message) {
    super(message);
    this.name = "ErroPergunta";
  }
}

function conferirDecisao(saida) {
  if (saida.opcoes !== undefined) {
    if (!Array.isArray(saida.opcoes)) throw new ErroPergunta("opcoes: esperada lista");
    const ids = new Set();
    for (const [i, o] of saida.opcoes.entries()) {
      if (!o || typeof o !== "object" || !ID_DE_OPCAO.test(o.id ?? "")) throw new ErroPergunta(`opcoes[${i}].id: esperado token minúsculo`);
      if (o.texto !== undefined && typeof o.texto !== "string") throw new ErroPergunta(`opcoes[${i}].texto: esperado texto`);
      if (ids.has(o.id)) throw new ErroPergunta(`opcoes: id repetido ${o.id}`);
      ids.add(o.id);
    }
    if (saida.recomendada !== undefined && !ids.has(saida.recomendada)) throw new ErroPergunta(`recomendada: ${saida.recomendada} não é opção`);
  } else if (saida.recomendada !== undefined) throw new ErroPergunta("recomendada sem opcoes");
  if (saida.recomendacao !== undefined && typeof saida.recomendacao !== "string") throw new ErroPergunta("recomendacao: esperado texto");
  if (saida.destinatario !== undefined && !DESTINATARIOS.includes(saida.destinatario))
    throw new ErroPergunta(`destinatario: esperado ${DESTINATARIOS.join(" | ")}`);
  if (saida.numero !== undefined && !(Number.isInteger(saida.numero) && saida.numero > 0)) throw new ErroPergunta("numero: esperado inteiro positivo");
}

/**
 * O construtor único. Recebe a saída com `motivo` e os campos do chamador;
 * `acao` vira `perguntar` (campo `acao` do chamador nunca mascara a pergunta).
 * Campos da decisão, todos opcionais: `opcoes` ([{ id, texto }]),
 * `recomendada` (id de uma opção), `recomendacao` (texto), `destinatario`
 * (papel, default `operador`) e `numero` (o da sessão, que a maestra dá).
 */
export function perguntar(saida) {
  if (!saida || typeof saida !== "object" || Array.isArray(saida)) throw new ErroPergunta("pergunta: esperado objeto");
  if (typeof saida.motivo !== "string" || !MOTIVO.test(saida.motivo)) throw new ErroPergunta(`pergunta sem motivo legível: ${JSON.stringify(saida.motivo ?? null)}`);
  conferirDecisao(saida);
  const p = { ...saida, acao: ACAO, motivo: saida.motivo };
  CONSTRUIDAS.add(p);
  return p;
}

/**
 * Embrulha uma fábrica de ações `(tipo, …) => ação` (a do `decidir`): a de
 * tipo `perguntar` sai pelo construtor; as demais, como vieram.
 */
export function comPergunta(fabrica) {
  return (tipo, ...resto) => {
    const a = fabrica(tipo, ...resto);
    return tipo === ACAO ? perguntar(a) : a;
  };
}

/** A saída nasceu do construtor? */
export function foiConstruida(saida) {
  return Boolean(saida && typeof saida === "object" && CONSTRUIDAS.has(saida));
}

function sha256(texto) {
  return createHash("sha256").update(texto).digest("hex");
}

/**
 * A decisão da pergunta: id determinístico (o mesmo estado dá o mesmo id —
 * nonce, quando a ação tem, senão ciclo, task, tentativa e motivo), número da
 * sessão, ids das opções, recomendada, destinatário e o `sha256` do texto
 * (opções e recomendação, nessa ordem). O texto fica só aqui, nunca no log.
 */
export function decisaoDe(saida) {
  if (!foiConstruida(saida)) throw new ErroPergunta("decisão de saída que não passou pelo construtor");
  const opcoes = (saida.opcoes ?? []).map((o) => ({ id: o.id, texto: o.texto ?? null }));
  const chave = { ciclo: saida.ciclo ?? null, motivo: saida.motivo, nonce: saida.nonce ?? null, fase: saida.fase ?? null, task: saida.task ?? null, tentativa: saida.tentativa ?? null };
  return {
    id: `d-${sha256(JSON.stringify(chave)).slice(0, 16)}`,
    numero: saida.numero ?? null,
    opcoes,
    recomendada: saida.recomendada ?? null,
    destinatario: saida.destinatario ?? "operador",
    texto: sha256(JSON.stringify({ opcoes: opcoes.map((o) => [o.id, o.texto]), recomendacao: saida.recomendacao ?? null })),
  };
}

/** O evento `pergunta` do log: só tokens, nenhum texto. */
export function eventoDa(saida) {
  const d = decisaoDe(saida);
  const evento = {
    acao: EVENTO,
    ciclo: saida.ciclo,
    motivo: saida.motivo,
    decisao: d.id,
    destinatario: d.destinatario,
    textoSha256: d.texto,
  };
  for (const k of ["fase", "task", "tentativa", "nonce"]) if (saida[k] !== undefined && saida[k] !== null) evento[k] = saida[k];
  if (d.numero !== null) evento.numero = d.numero;
  if (d.opcoes.length) evento.opcoes = d.opcoes.map((o) => o.id).join("+");
  if (d.recomendada !== null) evento.recomendada = d.recomendada;
  return evento;
}

/**
 * Grava a pergunta no destino do adaptador (`decl.pastaDaPergunta`). Saída
 * que não passou pelo construtor é recusada: a forma é uma só.
 */
export function gravar(saida, decl, { quando } = {}) {
  if (!decl?.pastaDaPergunta) throw new ErroPergunta("adaptador sem pastaDaPergunta");
  return logEventos.registrar(eventoDa(saida), { procedencia: "intencao", quando, pasta: decl.pastaDaPergunta });
}
