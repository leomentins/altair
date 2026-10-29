/**
 * regras.test.mjs — tabela das regras nomeadas da decisão do `proximo`
 * (VEGA-29 T6: abrir, trazer e arquivar; T7: perguntar, esperar, CI e
 * fechamento). Sem git e sem fs: o plano, o estado e a entrada são objetos
 * montados aqui. A ordem passa pelo `decidir`: trocar duas regras de lugar
 * muda a ação de um caso e o teste falha; e `decidir` não tem ramo próprio.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORDEM_DAS_REGRAS, contextoDoProximo, decidir, lerAviso, nonce } from "../conducao.mjs";
import * as regras from "../regras.mjs";
import { regraAbrir, regraArquivar, regraTrazer, vagasDoTeto } from "../regras.mjs";

const CICLO = "TESTE-1-regras";
const HEAD = "d".repeat(40);
const BLOB = "b".repeat(40);

const acao = (tipo, alvo, tentativa, campos) => ({ acao: tipo, nonce: nonce(CICLO, alvo, tentativa, HEAD), ciclo: CICLO, head: HEAD, plano: BLOB, ...campos });
const base = { ciclo: CICLO, head: HEAD, planoBlob: BLOB, acao, nonce, lerAviso };

function task(id, extra = {}) {
  return { id, fase: "F1", deps: [], outputs: [`a/${id}.mjs`], estacao: "servidor", fechamento: false, publicacao: [], clinica: [], classe: "comum", prazoMin: 120, posMerge: false, ...extra };
}
function plano(tasks, largura = 2) {
  return { largura, fases: [{ id: "F1", modelo: "opus", tasks: tasks.map((t) => t.id) }], porId: new Map(tasks.map((t) => [t.id, t])) };
}
const nT = (t, n) => nonce(CICLO, t, n, HEAD);
const filha = (t, n, aviso, extra = {}) => ({ sessao: `s-${t}-${n}`, nonce: nT(t, n), tentativa: n, estado: "RUNNING", aviso, ...extra });
const ok = (t, n) => `${t}-OK 1234abcd ${nT(t, n)}`;
const falha = (t, n) => `${t}-FALHA verificacao-vermelha ${nT(t, n)}`;

// ── arquivar ────────────────────────────────────────────────────────────────

const ARQUIVAR = [
  { caso: "sem filhas", filhas: [], decididos: [], espera: null },
  { caso: "filha avisou e a tentativa foi decidida", filhas: [filha("T1", 1, ok("T1", 1))], decididos: [nT("T1", 1)], espera: "arquivar" },
  { caso: "aviso de FALHA decidido também arquiva", filhas: [filha("T1", 1, falha("T1", 1))], decididos: [nT("T1", 1)], espera: "arquivar" },
  { caso: "tentativa ainda não decidida", filhas: [filha("T1", 1, ok("T1", 1))], decididos: [], espera: null },
  { caso: "sem aviso", filhas: [filha("T1", 1, null)], decididos: [nT("T1", 1)], espera: null },
  { caso: "aviso de outro nonce", filhas: [filha("T1", 1, ok("T1", 2))], decididos: [nT("T1", 2)], espera: null },
  { caso: "já arquivada", filhas: [filha("T1", 1, ok("T1", 1), { estado: "ARCHIVED" })], decididos: [nT("T1", 1)], espera: null },
  { caso: "sem sessão", filhas: [filha("T1", 1, ok("T1", 1), { sessao: null })], decididos: [nT("T1", 1)], espera: null },
];

for (const c of ARQUIVAR)
  test(`regraArquivar — ${c.caso} ⇒ ${c.espera ?? "null"}`, () => {
    const r = regraArquivar({ ...base, filhas: c.filhas, decididos: new Set(c.decididos) });
    assert.equal(r?.acao ?? null, c.espera, JSON.stringify(r));
  });

test("regraArquivar — nonce sem HEAD, igual em HEADs diferentes; 2ª execução repetida pergunta", () => {
  const f = filha("T1", 1, ok("T1", 1));
  const r = regraArquivar({ ...base, filhas: [f], decididos: new Set([nT("T1", 1)]) });
  assert.equal(r.nonce, nonce(CICLO, `arquivar:${f.sessao}`, nT("T1", 1), ""));
  assert.deepEqual(
    { sessao: r.sessao, task: r.task, tentativa: r.tentativa, nonceTentativa: r.nonceTentativa, aviso: r.aviso },
    { sessao: f.sessao, task: "T1", tentativa: 1, nonceTentativa: nT("T1", 1), aviso: "OK" },
  );
  const outroHead = regraArquivar({ ...base, head: "e".repeat(40), filhas: [f], decididos: new Set([nT("T1", 1)]) });
  assert.equal(outroHead.nonce, r.nonce);

  const uma = regraArquivar({ ...base, filhas: [{ ...f, arquivamentos: [r.nonce] }], decididos: new Set([nT("T1", 1)]) });
  assert.equal(uma.acao, "arquivar");
  const duas = regraArquivar({ ...base, filhas: [{ ...f, arquivamentos: [r.nonce, r.nonce] }], decididos: new Set([nT("T1", 1)]) });
  assert.equal(duas.acao, "perguntar");
  assert.equal(duas.motivo, "falha-de-arquivamento");
  assert.equal(duas.vezes, 2);
});

// ── trazer ──────────────────────────────────────────────────────────────────

const T1 = task("T1", { publicacao: ["db push"] });
const T2 = task("T2");
const voo = (...ts) => ts.map(([t, n]) => ({ t, r: { tentativa: n, nonce: nT(t.id, n), ref: `refs/conducao/${CICLO}/${t.id}/${n}` } }));

const TRAZER = [
  { caso: "nada em voo", voo: [], filhas: [], espera: null },
  { caso: "em voo sem aviso", voo: voo([T1, 1]), filhas: [filha("T1", 1, null)], espera: null },
  { caso: "em voo com FALHA", voo: voo([T1, 1]), filhas: [filha("T1", 1, falha("T1", 1))], espera: null },
  { caso: "OK de outra tentativa", voo: voo([T1, 2]), filhas: [filha("T1", 1, ok("T1", 1))], espera: null },
  { caso: "marcador sem nonce", voo: [{ t: T1, r: { tentativa: 1, nonce: null } }], filhas: [filha("T1", 1, ok("T1", 1))], espera: null },
  { caso: "OK da tentativa em voo", voo: voo([T1, 1]), filhas: [filha("T1", 1, ok("T1", 1))], espera: "T1" },
  { caso: "a primeira OK na ordem das tasks", voo: voo([T1, 1], [T2, 1]), filhas: [filha("T2", 1, ok("T2", 1)), filha("T1", 1, ok("T1", 1))], espera: "T1" },
  { caso: "pula a sem aviso e traz a seguinte", voo: voo([T1, 1], [T2, 1]), filhas: [filha("T2", 1, ok("T2", 1))], espera: "T2" },
];

for (const c of TRAZER)
  test(`regraTrazer — ${c.caso} ⇒ ${c.espera ?? "null"}`, () => {
    const r = regraTrazer({ ...base, fase: { id: "F1" }, voo: c.voo, filhas: c.filhas });
    assert.equal(r ? `${r.acao}:${r.task}` : null, c.espera ? `trazer:${c.espera}` : null, JSON.stringify(r));
  });

test("regraTrazer — campos da ação: sha do aviso, sessão, ref e o sim para publicar", () => {
  const r = regraTrazer({ ...base, fase: { id: "F1" }, voo: voo([T1, 1]), filhas: [filha("T1", 1, ok("T1", 1))] });
  assert.equal(r.nonce, nonce(CICLO, "T1", 1, HEAD));
  assert.deepEqual(
    { fase: r.fase, tentativa: r.tentativa, nonceTentativa: r.nonceTentativa, sha: r.sha, sessao: r.sessao, ref: r.ref, publicacao: r.publicacao, simParaPublicar: r.simParaPublicar },
    { fase: "F1", tentativa: 1, nonceTentativa: nT("T1", 1), sha: "1234abcd", sessao: "s-T1-1", ref: `refs/conducao/${CICLO}/T1/1`, publicacao: ["db push"], simParaPublicar: true },
  );
});

// ── abrir ───────────────────────────────────────────────────────────────────

const abrirCtx = (over = {}) => {
  const ts = over.tasks ?? [task("T1"), task("T2")];
  const p = plano(ts, over.largura ?? 2);
  return {
    ...base,
    plano: p,
    fase: { id: "F1" },
    servidor: over.servidor ?? ts,
    vooAtivo: over.vooAtivo ?? [],
    reabrir: over.reabrir ?? new Map(),
    maxTent: over.maxTent ?? new Map(),
    filhas: over.filhas ?? [],
    tetoPonte: over.tetoPonte ?? null,
    tetoPadrao: 3,
    cobertaPelaFase: over.cobertaPelaFase ?? false,
    aprovacoes: over.aprovacoes ?? [],
    ultimaAutorizacao: { sha: "a".repeat(40), fase: "F1" },
  };
};
const vivas = (n) => Array.from({ length: n }, (_, i) => ({ sessao: `v${i}`, estado: "RUNNING" }));
const sensivel = task("T1", { classe: "sensivel", publicacao: ["db push"] });

const ABRIR = [
  { caso: "nada pronto", over: { servidor: [] }, espera: null },
  { caso: "duas prontas, largura 2", over: {}, espera: "abrir:T1+T2" },
  { caso: "largura 1 abre só a primeira", over: { largura: 1 }, espera: "abrir:T1" },
  { caso: "teto da ponte cheio", over: { filhas: vivas(3) }, espera: null },
  { caso: "tetoPonte da entrada vence o padrão", over: { tetoPonte: 4, filhas: vivas(3) }, espera: "abrir:T1" },
  { caso: "filha arquivada não ocupa vaga", over: { filhas: vivas(3).map((f, i) => (i ? f : { ...f, estado: "ARCHIVED" })) }, espera: "abrir:T1" },
  { caso: "Outputs em comum com a em voo pula a task", over: { tasks: [task("T1", { outputs: ["x"] }), task("T2")], vooAtivo: [{ t: task("T9", { outputs: ["x"] }) }], largura: 3 }, espera: "abrir:T2" },
  { caso: "Outputs em comum entre prontas abre só a primeira", over: { tasks: [task("T1", { outputs: ["x"] }), task("T2", { outputs: ["x"] })] }, espera: "abrir:T1" },
  { caso: "sensível sem sim pergunta", over: { tasks: [sensivel] }, espera: "perguntar:task-sensivel" },
  { caso: "sensível coberta pela fase abre", over: { tasks: [sensivel], cobertaPelaFase: true }, espera: "abrir:T1" },
  { caso: "sensível aprovada pelo nonce da tentativa abre", over: { tasks: [sensivel], aprovacoes: [{ task: "T1", nonce: nT("T1", 1) }] }, espera: "abrir:T1" },
  { caso: "aprovação de outra tentativa não vale", over: { tasks: [sensivel], aprovacoes: [{ task: "T1", nonce: nT("T1", 2) }] }, espera: "perguntar:task-sensivel" },
];

for (const c of ABRIR)
  test(`regraAbrir — ${c.caso} ⇒ ${c.espera ?? "null"}`, () => {
    const r = regraAbrir(abrirCtx(c.over));
    const got = r ? (r.acao === "abrir" ? `abrir:${r.tarefas.map((x) => x.task).join("+")}` : `${r.acao}:${r.motivo}`) : null;
    assert.equal(got, c.espera, JSON.stringify(r));
  });

test("regraAbrir — tentativa seguinte, falha anterior, aviso do reinício e cobertas pela fase", () => {
  const r = regraAbrir(
    abrirCtx({
      tasks: [sensivel],
      cobertaPelaFase: true,
      maxTent: new Map([["T1", 2]]),
      reabrir: new Map([["T1", { tentativa: 2, coberta: "sim", motivo: "reinicio-da-ponte" }]]),
    }),
  );
  assert.equal(r.acao, "abrir");
  assert.equal(r.nonce, nonce(CICLO, "T1", "3", HEAD));
  const [x] = r.tarefas;
  assert.deepEqual(
    { tentativa: x.tentativa, nonce: x.nonce, modelo: x.modelo, falhaAnterior: x.falhaAnterior },
    { tentativa: 3, nonce: nT("T1", 3), modelo: "opus", falhaAnterior: { tentativa: 2, coberta: "sim", motivo: "reinicio-da-ponte" } },
  );
  assert.deepEqual(r.avisoLeo, ["T1 tentativa 2 caiu no reinício da ponte; reaberta como 3, sem contar falha"]);
  assert.deepEqual(r.cobertasPelaFase, { autorizacao: "a".repeat(40), tasks: ["T1"] });
  assert.deepEqual(r.largura, { prontas: 1, ciclo: 2, teto: 3, vivas: 0, emVoo: 0, abertas: 1 });
});

test("vagasDoTeto — menor entre largura livre e teto livre, nunca negativo", () => {
  const v = (filhas, largura, emVoo, tetoPonte = null) => vagasDoTeto({ filhas, tetoPonte, tetoPadrao: 3, largura, vooAtivo: Array(emVoo).fill({}) }).vagas;
  assert.equal(v([], 2, 0), 2);
  assert.equal(v(vivas(2), 4, 0), 1);
  assert.equal(v([], 2, 2), 0);
  assert.equal(v(vivas(5), 2, 0), 0);
  assert.equal(v(vivas(5), 2, 0, 9), 2);
});

// ── a ordem, pelo decidir ───────────────────────────────────────────────────

function estado({ emVoo = [], decididos = [], maxTent = [], falhas = [] } = {}) {
  return {
    feitas: new Set(),
    recusadas: new Set(),
    emVoo: new Map(emVoo.map(([t, n]) => [t, { tentativa: n, nonce: nT(t, n), ref: `refs/conducao/${CICLO}/${t}/${n}`, abertaEm: null }])),
    falhas: new Map(falhas),
    falhasAmbiente: new Map(),
    maxTent: new Map(maxTent),
    trazidas: new Map(),
    decididos: new Set(decididos),
    revertidasSemFalha: new Map(),
  };
}
const decidirCom = (ts, est, filhas, largura = 3) =>
  decidir({
    ciclo: CICLO,
    head: HEAD,
    plano: plano(ts, largura),
    planoBlob: BLOB,
    planoHead: null,
    planoHeadBlob: null,
    diffPlano: null,
    autorizacoes: [{ tipo: "autorizada", sha: "a".repeat(40), fase: "F1", plano: BLOB, herdada: null }],
    estado: est,
    entrada: { filhas },
  });

const ORDEM = [
  {
    caso: "arquivar vem antes de trazer",
    tasks: [task("T1"), task("T2")],
    estado: estado({ emVoo: [["T2", 1]], decididos: [nT("T1", 1)], maxTent: [["T1", 1], ["T2", 1]] }),
    filhas: [filha("T1", 1, ok("T1", 1)), filha("T2", 1, ok("T2", 1))],
    espera: "arquivar",
  },
  {
    caso: "trazer vem antes da pergunta da vigia",
    tasks: [task("T1"), task("T2")],
    estado: estado({ emVoo: [["T1", 2], ["T2", 1]], maxTent: [["T1", 2], ["T2", 1]], falhas: [["T1", 1]] }),
    filhas: [filha("T1", 2, falha("T1", 2)), filha("T2", 1, ok("T2", 1))],
    espera: "trazer",
  },
  {
    caso: "trazer vem antes de abrir",
    tasks: [task("T1"), task("T2")],
    estado: estado({ emVoo: [["T1", 1]], maxTent: [["T1", 1]] }),
    filhas: [filha("T1", 1, ok("T1", 1))],
    espera: "trazer",
  },
  {
    caso: "a pergunta da vigia vem antes de abrir",
    tasks: [task("T1"), task("T2")],
    estado: estado({ emVoo: [["T1", 2]], maxTent: [["T1", 2]], falhas: [["T1", 1]] }),
    filhas: [filha("T1", 2, falha("T1", 2))],
    espera: "perguntar",
  },
  {
    caso: "sem aviso, abre a pronta ao lado da em voo",
    tasks: [task("T1"), task("T2")],
    estado: estado({ emVoo: [["T1", 1]], maxTent: [["T1", 1]] }),
    filhas: [filha("T1", 1, null)],
    espera: "abrir",
  },
];

for (const c of ORDEM)
  test(`ordem — ${c.caso}`, () => {
    const r = decidirCom(c.tasks, c.estado, c.filhas);
    assert.equal(r.acao, c.espera, JSON.stringify(r));
  });

// ── perguntar, esperar, CI e fechamento (T7), pelo contexto do `proximo` ─────

const AUT = (fase, extra = {}) => ({ tipo: "autorizada", sha: "a".repeat(40), fase, plano: BLOB, herdada: null, ...extra });
function planoDe(fases, largura = 3) {
  const ts = fases.flatMap(([id, tasks]) => tasks.map((t) => ({ ...t, fase: id })));
  return { largura, fases: fases.map(([id, tasks]) => ({ id, modelo: "opus", tasks: tasks.map((t) => t.id) })), porId: new Map(ts.map((t) => [t.id, t])) };
}
function est(e = {}) {
  const tent = ([t, n, extra = {}]) => [t, { tentativa: n, nonce: nT(t, n), ref: `refs/conducao/${CICLO}/${t}/${n}`, abertaEm: null, ...extra }];
  return {
    feitas: new Set(e.feitas ?? []),
    recusadas: new Set(e.recusadas ?? []),
    emVoo: new Map((e.emVoo ?? []).map(tent)),
    falhas: new Map(e.falhas ?? []),
    falhasAmbiente: new Map(e.falhasAmbiente ?? []),
    maxTent: new Map(e.maxTent ?? []),
    trazidas: new Map((e.trazidas ?? []).map(tent)),
    decididos: new Set(),
    revertidasSemFalha: new Map(),
  };
}
/** Contexto do `proximo`; `fasesHead` monta o plano do HEAD (blob outro); `cicloSim` dá o sim do ciclo sobre o plano. */
function ctxDe({ fases, fasesHead = null, cicloSim = false, autorizacoes = [AUT("F1")], estado: e = {}, entrada = {}, encerradas = [], replanos = null }) {
  const p = planoDe(fases);
  const planoHead = fasesHead ? planoDe(fasesHead) : cicloSim ? p : null;
  return contextoDoProximo(
    {
      ciclo: CICLO,
      head: HEAD,
      plano: p,
      planoBlob: BLOB,
      planoHead,
      planoHeadBlob: fasesHead ? "c".repeat(40) : cicloSim ? BLOB : null,
      diffPlano: null,
      autorizacoes,
      estado: est(e),
      entrada,
      encerradas: new Set(encerradas),
      replanos,
      autorizacaoDoCiclo: cicloSim ? { sha: "e".repeat(40), plano: p } : null,
    },
    acao,
  );
}
const forma = (r) => (r ? (r.motivo ? `${r.acao}:${r.motivo}` : r.acao) : null);

const FECH = task("T9", { fechamento: true });
const CI_VERDE = { sha: HEAD, veredito: "verde", run: 1 };
const CI_VERMELHO = { sha: HEAD, veredito: "vermelho", run: 1 };
const DUAS_FASES = [["F1", [task("T1"), FECH]], ["F2", [task("T2")]]];
const F1_FECHADA = { feitas: ["T1", "T9"] };

const TABELA = {
  regraFaseForaDoPlano: [
    { caso: "autorização de fase que o plano não tem", ctx: { fases: [["F1", [task("T1")]]], autorizacoes: [AUT("F9")] }, espera: "perguntar:fase-autorizada-fora-do-plano" },
    { caso: "fase do plano autorizada", ctx: { fases: [["F1", [task("T1")]]] }, espera: null },
  ],
  regraFecharCiclo: [
    { caso: "task pendente", ctx: { fases: [["F1", [task("T1")]]] }, espera: null },
    { caso: "tudo feito, CI ausente", ctx: { fases: [["F1", [task("T1")]]], estado: { feitas: ["T1"] } }, espera: "esperar:ci-pendente" },
    { caso: "tudo feito, CI de outro sha", ctx: { fases: [["F1", [task("T1")]]], estado: { feitas: ["T1"] }, entrada: { ci: { sha: "f".repeat(40), veredito: "verde" } } }, espera: "esperar:ci-pendente" },
    { caso: "tudo feito, CI vermelho", ctx: { fases: [["F1", [task("T1")]]], estado: { feitas: ["T1"] }, entrada: { ci: CI_VERMELHO } }, espera: "perguntar:ci-vermelho" },
    { caso: "tudo feito, CI verde", ctx: { fases: [["F1", [task("T1")]]], estado: { feitas: ["T1"] }, entrada: { ci: CI_VERDE } }, espera: "fechar-ciclo" },
    { caso: "proposta mesclada", ctx: { fases: [["F1", [task("T1")]]], estado: { feitas: ["T1"] }, entrada: { ci: CI_VERDE, proposta: { state: "MERGED" } } }, espera: "esperar:mesclado" },
    { caso: "ciclo encerrado", ctx: { fases: [["F1", [task("T1")]]], estado: { feitas: ["T1"] }, encerradas: ["ciclo"] }, espera: "esperar:close-cycle-em-sessao-limpa" },
    { caso: "última fase reaberta sem fechamento novo", ctx: { fases: [["F1", [FECH, task("T1")]]], estado: { feitas: ["T9", "T1"] }, autorizacoes: [AUT("F1"), AUT("F1")] }, espera: "perguntar:fase-reaberta-sem-fechamento" },
    { caso: "última fase reaberta por task nascida no plano do HEAD", ctx: { fases: [["F1", [FECH]]], fasesHead: [["F1", [FECH, task("T5", { fechamento: true })]]], estado: { feitas: ["T9"] } }, espera: "perguntar:plano-mudou" },
  ],
  regraEncerrarSessao: [
    { caso: "fase anterior fechada, CI ausente", ctx: { fases: DUAS_FASES, estado: F1_FECHADA }, espera: "esperar:ci-pendente" },
    { caso: "fase anterior fechada, CI vermelho", ctx: { fases: DUAS_FASES, estado: F1_FECHADA, entrada: { ci: CI_VERMELHO } }, espera: "perguntar:ci-vermelho" },
    { caso: "fase anterior fechada, CI verde", ctx: { fases: DUAS_FASES, estado: F1_FECHADA, entrada: { ci: CI_VERDE } }, espera: "encerrar-sessao" },
    { caso: "fase anterior já encerrada", ctx: { fases: DUAS_FASES, estado: F1_FECHADA, encerradas: ["F1"] }, espera: null },
    { caso: "fase em curso autorizada", ctx: { fases: DUAS_FASES }, espera: null },
  ],
  regraAutorizarFase: [
    { caso: "fase nova sem sim", ctx: { fases: DUAS_FASES, estado: F1_FECHADA, encerradas: ["F1"] }, espera: "perguntar:autorizar-ciclo" },
    { caso: "fase nova sob o sim do ciclo", ctx: { fases: DUAS_FASES, estado: F1_FECHADA, encerradas: ["F1"], cicloSim: true }, espera: "herdar-autorizacao" },
    { caso: "fase em curso autorizada", ctx: { fases: DUAS_FASES }, espera: null },
  ],
  regraReplano: [
    { caso: "plano do HEAD igual", ctx: { fases: [["F1", [task("T1")]]] }, espera: null },
    { caso: "task nova no meio da fase, sem ruling", ctx: { fases: [["F1", [task("T1")]]], fasesHead: [["F1", [task("T1"), task("T3")]]] }, espera: "perguntar:plano-mudou" },
    {
      caso: "re-plano de ruling sem mudar classe herda",
      ctx: { fases: [["F1", [task("T1")]]], fasesHead: [["F1", [task("T1"), task("T3")]]], replanos: [{ sha: "1".repeat(40), subject: `${CICLO}-F1/D-TESTE1-2 — re-plano de T3: tarefa nova` }] },
      espera: "herdar-autorizacao",
    },
    { caso: "blob outro com o plano parseado igual", ctx: { fases: [["F1", [task("T1")]]], fasesHead: [["F1", [task("T1")]]] }, espera: null },
  ],
  regraReabertaSemFechamento: [
    { caso: "reautorizada com o fechamento velho feito", ctx: { fases: [["F1", [FECH, task("T1")]]], estado: { feitas: ["T9"] }, autorizacoes: [AUT("F1"), AUT("F1")] }, espera: "perguntar:fase-reaberta-sem-fechamento" },
    { caso: "autorizada uma vez", ctx: { fases: [["F1", [FECH, task("T1")]]], estado: { feitas: ["T9"] } }, espera: null },
  ],
  regraPublicacaoRecusada: [
    { caso: "publicação recusada", ctx: { fases: [["F1", [task("T1")]]], estado: { recusadas: ["T1"] } }, espera: "parar:publicacao-recusada" },
    { caso: "nada recusado", ctx: { fases: [["F1", [task("T1")]]] }, espera: null },
  ],
  regraTrazidaSemConferencia: [
    { caso: "trazida sem conferência", ctx: { fases: [["F1", [task("T1")]]], estado: { trazidas: [["T1", 1]] } }, espera: "perguntar:trazida-sem-conferencia" },
    { caso: "nada trazido", ctx: { fases: [["F1", [task("T1")]]] }, espera: null },
  ],
  regraVigia: [
    { caso: "em voo, filha viva sem aviso", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 1]] }, entrada: { filhas: [filha("T1", 1, null)] } }, espera: null },
    { caso: "marcador sem nonce", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 1, { nonce: null }]] } }, espera: "perguntar:marcador-invalido" },
    { caso: "tentativa sem filha", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 1]] } }, espera: "perguntar:tentativa-sem-filha" },
    { caso: "filha arquivada sem aviso", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 1]] }, entrada: { filhas: [filha("T1", 1, null, { estado: "ARCHIVED" })] } }, espera: "perguntar:filha-sumiu" },
    { caso: "pergunta da filha", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 1]] }, entrada: { filhas: [filha("T1", 1, `T1-FALHA pergunta ${nT("T1", 1)}`)] } }, espera: "perguntar:pergunta-da-filha" },
    { caso: "primeira falha reabre", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 1]] }, entrada: { filhas: [filha("T1", 1, falha("T1", 1))] } }, espera: null },
    { caso: "segunda falha pergunta", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 2]], falhas: [["T1", 1]] }, entrada: { filhas: [filha("T1", 2, falha("T1", 2))] } }, espera: "perguntar:segunda-falha" },
    { caso: "prazo vencido", ctx: { fases: [["F1", [task("T1", { prazoMin: 1 })]]], estado: { emVoo: [["T1", 1, { abertaEm: 0 }]] }, entrada: { filhas: [filha("T1", 1, null)] } }, agora: 3600, espera: "perguntar:prazo-vencido" },
    { caso: "teto de falhas", ctx: { fases: [["F1", [task("T1")]]], estado: { falhas: [["T1", 2]], maxTent: [["T1", 2]] } }, espera: "perguntar:teto-de-falhas" },
    { caso: "teto de falhas de ambiente", ctx: { fases: [["F1", [task("T1")]]], estado: { falhasAmbiente: [["T1", 99]] } }, espera: "perguntar:teto-de-falhas-ambiente" },
  ],
  regraFazerMaestra: [
    { caso: "task da maestra", ctx: { fases: [["F1", [task("T1", { estacao: "maestra" })]]] }, espera: "fazer-maestra" },
    { caso: "task da maestra sensível sem sim", ctx: { fases: [["F1", [task("T1", { estacao: "maestra", publicacao: ["db push"] })]]], autorizacoes: [AUT("F0"), AUT("F1", { herdada: "a".repeat(40) })] }, espera: "perguntar:task-sensivel" },
    { caso: "só task de servidor", ctx: { fases: [["F1", [task("T1")]]] }, espera: null },
  ],
  regraEsperar: [
    { caso: "filha em voo", ctx: { fases: [["F1", [task("T1")]]], estado: { emVoo: [["T1", 1]] }, entrada: { filhas: [filha("T1", 1, null)] } }, espera: "esperar:filhas-em-voo" },
    { caso: "pronta sem vaga no teto", ctx: { fases: [["F1", [task("T1")]]], entrada: { filhas: vivas(3) } }, espera: "esperar:sem-vaga" },
    { caso: "nada em voo nem pronto", ctx: { fases: [["F1", [task("T1", { estacao: "workstation" })]]] }, espera: null },
  ],
  regraWorkstation: [
    { caso: "task de workstation pronta", ctx: { fases: [["F1", [task("T1", { estacao: "workstation" })]]] }, espera: "parar:workstation" },
    { caso: "só task de servidor", ctx: { fases: [["F1", [task("T1")]]] }, espera: null },
  ],
  regraFecharFase: [
    { caso: "só o fechamento resta", ctx: { fases: [["F1", [task("T1"), FECH]]], estado: { feitas: ["T1"] } }, espera: "fechar-fase" },
    { caso: "task comum pendente", ctx: { fases: [["F1", [task("T1"), FECH]]] }, espera: null },
  ],
  regraSemSaida: [{ caso: "dependência que nunca fica pronta", ctx: { fases: [["F1", [task("T1", { deps: ["T0"] })]]] }, espera: "perguntar:sem-saida" }],
};

for (const [nome, casos] of Object.entries(TABELA))
  for (const c of casos)
    test(`${nome} — ${c.caso} ⇒ ${c.espera ?? "null"}`, () => {
      const ctx = ctxDe(c.ctx);
      if (c.agora !== undefined) ctx.agora = c.agora;
      const r = regras[nome](ctx);
      assert.equal(forma(r), c.espera, JSON.stringify(r));
    });

test("regraVigia — a falha avisada e a queda no reinício preenchem `reabrir`, que o abrir leva na frente", () => {
  const ctx = ctxDe({ fases: [["F1", [task("T1"), task("T2")]]], estado: { emVoo: [["T1", 1], ["T2", 1, { abertaEm: 10 }]], maxTent: [["T1", 1], ["T2", 1]] }, entrada: { filhas: [filha("T1", 1, falha("T1", 1))] } });
  ctx.reinicioEm = 20;
  assert.equal(regras.regraVigia(ctx), null);
  assert.deepEqual(Object.fromEntries(ctx.reabrir), {
    T1: { tentativa: 1, coberta: "nao", motivo: "falha-avisada" },
    T2: { tentativa: 1, coberta: "sim", motivo: "reinicio-da-ponte" },
  });
  const r = regraAbrir(ctx);
  assert.deepEqual(r.tarefas.map((x) => [x.task, x.tentativa]), [["T1", 2], ["T2", 2]]);
});

test("a tabela cobre toda regra, e a ordem do decidir é a lista inteira, com sem-saida por último", () => {
  const exportadas = Object.keys(regras).filter((n) => n.startsWith("regra"));
  const comTabela = new Set([...Object.keys(TABELA), "regraArquivar", "regraTrazer", "regraAbrir"]);
  assert.deepEqual(exportadas.filter((n) => !comTabela.has(n)), [], "regra sem caso na tabela");
  assert.deepEqual([...ORDEM_DAS_REGRAS.map((f) => f.name)].sort(), [...exportadas].sort(), "regra fora da ordem, ou nome repetido");
  assert.equal(new Set(ORDEM_DAS_REGRAS).size, ORDEM_DAS_REGRAS.length);
  assert.equal(ORDEM_DAS_REGRAS.at(-1), regras.regraSemSaida);
});

test("decidir não tem ramo próprio: o corpo é a fábrica de ações e o laço sobre a ordem", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "conducao.mjs"), "utf8");
  const ini = src.indexOf("export function decidir(");
  assert.ok(ini >= 0, "decidir não encontrada");
  const corpo = src.slice(ini, src.indexOf("\n}\n", ini));
  assert.deepEqual(corpo.match(/\bif\b|\?\s|\bswitch\b|&&|\|\|/g), ["if"], corpo);
  assert.match(corpo, /for \(const regra of ORDEM_DAS_REGRAS\)/);
});
