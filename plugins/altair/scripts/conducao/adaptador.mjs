/**
 * adaptador.mjs — a declaração do adaptador, lida do repositório (VEGA-29 T10, T20).
 *
 * O núcleo da condução não sabe de projeto nenhum: o que é do projeto vem de
 * `<repo>/.altair/adaptador.json`, lido via `--repo`. A forma está no esquema
 * versionado `adaptador.schema.json` (T20); este leitor é a mesma regra sem
 * dependência npm (o núcleo não carrega `ajv`):
 *
 *   versao      1 | 2 | 3               — OPCIONAL, default 1: a versão do esquema. A v1 é a
 *                                         declaração da F2, só de dados, e segue aceita como está;
 *                                         campo novo entra com versão nova, e a anterior segue valendo
 *   codigo      "<arquivo>.mjs" | "<nome>" — a partir da v2, OPCIONAL: o código do adaptador, para o projeto
 *                                         com formato de plano ou política própria (o leitor do plano,
 *                                         o brief, o carimbo, a publicação, os caminhos sensíveis).
 *                                         Terminado em `.mjs` ⇒ arquivo em `.altair/`; sem `/` e sem
 *                                         `.` ⇒ nome de um adaptador embutido no núcleo (`adaptadores/`,
 *                                         D-VEGA29-34); outro valor recusa (`entrada-invalida`).
 *                                         Forma conferida por `validarCodigo`
 *   pagina      "<caminho>"             — só na v3, OPCIONAL (T38, A18): a página do projeto, relativa
 *                                         à raiz do repositório; o brief do `abrir` cita o endereço, e
 *                                         dela a neta lê o destino do carimbo e a sonda do push do ramo
 *   projeto     "<token>"               — nome do projeto; segmento da pasta do log v1 (T11, D-VEGA29-3)
 *   operadores  [{ handle, nome }, ...] — quem decide; o primeiro é quem os textos do núcleo nomeiam
 *   estado      { pasta }               — pasta de estado do projeto, relativa a `$XDG_STATE_HOME`
 *   log         { pasta }               — pasta-base do log de eventos, relativa à pasta de estado;
 *                                         o log v1 grava em `<pasta>/<projeto>/` e a base guarda os v0
 *   pergunta    { destino: "log" } | { destino: "pasta", pasta } — onde a pergunta grava (D-VEGA29-4)
 *   conferencia [{ marca, arquivo?, sim?, nao? }, ...] — OPCIONAL (T14, 7-a): marcas do `satisfies`
 *                                         que fazem da task uma conferência do operador, além da do
 *                                         núcleo (`conferencia-do-operador`). Sem `arquivo`, o núcleo
 *                                         pergunta o resultado; com ele, a resposta é o `verdict:` do
 *                                         arquivo na pasta do ciclo (`sim`/`nao`: os valores de cada lado)
 *   ci          true | false            — OPCIONAL (T15, 5-a), default `true`: o projeto tem CI da
 *                                         proposta. `false` ⇒ a fase e o ciclo fecham pela Verificação
 *                                         verde da última tarefa (a do fechamento, conferida), sem
 *                                         esperar veredito de CI
 *   sessao      { modosSemClique }      — OPCIONAL (T15, D-VEGA29-29): modos de permissão da sessão
 *                                         que cria a filha que contam como sem clique (default
 *                                         `["auto"]`); fora da lista o `abrir` pergunta `modo-da-maestra`.
 *                                         O modo da ponte não entra: a filha herda o da criadora
 *   publicacao  { frasesLegadas }       — OPCIONAL (T16, AC-VEGA29-10): prefixos de linha do corpo da
 *                                         conferência que, nos commits gravados antes do trailer
 *                                         `Conducao-Publicacao-Dispensada`, valiam como dispensa de
 *                                         publicação (default `[]`). O núcleo casa só o trailer; a
 *                                         frase antiga, com o nome de quem dispensou, é dado do projeto
 *   verificacao { marcaSemCofre, variaveisDeProducao } — só na v4, OPCIONAL: a variável que a
 *                                         Verificação embrulhada liga (`<marca>=1`; default
 *                                         `ALTAIR_SEM_COFRE_PRODUCAO`), que o guard de cofre do projeto
 *                                         lê, e as variáveis de produção que o embrulho tira do
 *                                         ambiente (`env -u`; default nenhuma)
 *   guardas     { pastaDoModo }         — só na v4, OPCIONAL: pasta, relativa à raiz do repositório,
 *                                         onde os guards com modo leem `<guard>-mode`; sem o campo, ou
 *                                         sem o arquivo, o guard roda em `shadow`
 *
 * Campo desconhecido, em qualquer nível, é recusado: declaração que o leitor
 * não entende não é lida pela metade. Todo caminho que a declaração aponta
 * resolve por `realpath` dentro de `<repo>/.altair/` (código, para `import()`)
 * ou da pasta de estado declarada (escrita); fora disso é recusado — inclusive
 * por link simbólico que salte para fora.
 *
 * Repositório sem `.altair/adaptador.json` lê a declaração da árvore que
 * carrega o núcleo (`origem: "nucleo"`): no plugin não há nenhuma, e a leitura
 * recusa; sob `node --test` é a do projeto de teste das suítes (`raizDoNucleo`).
 * O default continua sendo dado, nunca literal no código.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as logEventos from "./log-eventos.mjs";

export const ARQUIVO = path.join(".altair", "adaptador.json");

/** Raiz do plugin que carrega o núcleo da condução (`<raiz>/scripts/conducao/`). */
export const RAIZ_DO_PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
export const PROJETO_DE_TESTE = path.join(path.dirname(fileURLToPath(import.meta.url)), "__tests__", "fixtures", "projeto-de-teste");

/**
 * Raiz da árvore cuja declaração vale quando o repositório não tem a sua. No
 * plugin é a raiz dele, que não carrega declaração nenhuma: repositório sem
 * `.altair/adaptador.json` recusa. Sob `node --test` é o projeto de teste das
 * suítes, como a raiz de estado e a pasta do log vão para o tmp.
 */
function raizDoNucleo(env = process.env) {
  return env.NODE_TEST_CONTEXT ? PROJETO_DE_TESTE : RAIZ_DO_PLUGIN;
}

export class ErroAdaptador extends Error {
  constructor(message, codigo = "adaptador-invalido") {
    super(message);
    this.name = "ErroAdaptador";
    this.codigo = codigo;
  }
}

/**
 * Adaptadores embutidos no núcleo (D-VEGA29-34): a lista fechada é a dos
 * arquivos `.mjs` de `adaptadores/`, lida do diretório. O nome declarado só
 * resolve contra um nome desta lista; o caminho sai da entrada da lista,
 * nunca do texto da declaração. Convenção do nome do arquivo: minúsculas,
 * dígitos e hífen (`NOME_EMBUTIDO`); outro nome nunca resolve. Pasta que não
 * se lê é defeito da instalação do núcleo, não do nome declarado: recusa
 * dizendo isso, em vez de responder "nenhum embutido".
 */
const PASTA_DOS_EMBUTIDOS = path.join(path.dirname(fileURLToPath(import.meta.url)), "adaptadores");
const NOME_EMBUTIDO = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function embutidos() {
  let entradas;
  try {
    entradas = readdirSync(PASTA_DOS_EMBUTIDOS, { withFileTypes: true });
  } catch (e) {
    throw new ErroAdaptador(`pasta dos adaptadores embutidos ilegível: ${PASTA_DOS_EMBUTIDOS} (${e.code ?? e.message})`);
  }
  const nomes = entradas.filter((e) => e.isFile() && e.name.endsWith(".mjs")).map((e) => e.name.slice(0, -".mjs".length));
  return Object.freeze(nomes.sort());
}

/** `codigo` tem a forma de nome de embutido (`NOME_EMBUTIDO`)? A forma só; a existência é de `caminhoDoEmbutido`. */
export function ehNomeEmbutido(codigo) {
  return typeof codigo === "string" && NOME_EMBUTIDO.test(codigo);
}

/** Caminho do embutido `nome`, montado da entrada da lista fechada; fora dela ⇒ `entrada-invalida`. */
export function caminhoDoEmbutido(nome) {
  const lista = embutidos();
  const achado = NOME_EMBUTIDO.test(nome) ? lista.find((n) => n === nome) : undefined;
  if (achado === undefined)
    throw new ErroAdaptador(`codigo: ${JSON.stringify(nome)} não é adaptador embutido (embutidos: ${lista.join(", ") || "nenhum"})`, "entrada-invalida");
  return path.join(PASTA_DOS_EMBUTIDOS, `${achado}.mjs`);
}

const CAMPOS = Object.freeze({
  raiz: ["projeto", "operadores", "estado", "log", "pergunta"],
  opcionais: ["versao", "codigo", "pagina", "conferencia", "ci", "sessao", "publicacao", "verificacao", "guardas"],
  sessao: ["modosSemClique"],
  verificacao: ["marcaSemCofre", "variaveisDeProducao"],
  guardas: ["pastaDoModo"],
  publicacao: ["frasesLegadas"],
  conferencia: { pergunta: ["marca"], arquivo: ["marca", "arquivo", "sim", "nao"] },
  operador: ["handle", "nome"],
  estado: ["pasta"],
  log: ["pasta"],
  pergunta: { log: ["destino"], pasta: ["destino", "pasta"] },
});

const TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

/** Versões do esquema que este leitor aceita; a anterior segue valendo (T20). */
export const VERSOES = Object.freeze([1, 2, 3, 4]);

function objeto(v, onde) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ErroAdaptador(`${onde}: esperado objeto`);
  return v;
}

function soCampos(v, aceitos, onde, opcionais = []) {
  const demais = Object.keys(v).filter((k) => !aceitos.includes(k) && !opcionais.includes(k));
  if (demais.length) throw new ErroAdaptador(`${onde}: campo desconhecido ${demais.join(", ")}`);
  for (const k of aceitos) if (!(k in v)) throw new ErroAdaptador(`${onde}: falta o campo ${k}`);
}

function relativo(v, onde) {
  if (typeof v !== "string" || !v.trim()) throw new ErroAdaptador(`${onde}: esperado caminho relativo`);
  if (path.isAbsolute(v) || v.split(/[\\/]/).includes("..")) throw new ErroAdaptador(`${onde}: caminho fora da raiz (${v})`);
  return v;
}

/**
 * `realpath` de um caminho que pode ainda não existir: o do ancestral
 * existente mais próximo, com o resto do caminho por cima.
 */
function realpathDoQueExiste(p) {
  const resto = [];
  let atual = path.resolve(p);
  while (!existsSync(atual)) {
    const pai = path.dirname(atual);
    if (pai === atual) break;
    resto.unshift(path.basename(atual));
    atual = pai;
  }
  return path.join(realpathSync(atual), ...resto);
}

function dentro(base, alvo) {
  const r = path.relative(base, alvo);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
}

/** Caminho de escrita: resolve por `realpath` dentro de `base`; fora ⇒ recusa. */
export function caminhoDeEscrita(base, rel, onde = "caminho de escrita") {
  relativo(rel, onde);
  const raiz = realpathDoQueExiste(base);
  const alvo = realpathDoQueExiste(path.join(raiz, rel));
  if (!dentro(raiz, alvo)) throw new ErroAdaptador(`${onde}: ${rel} resolve fora de ${raiz}`);
  return alvo;
}

/** Caminho de código (para `import()`): existe e resolve por `realpath` dentro de `<repo>/.altair/`. */
export function caminhoDeCodigo(repo, rel, onde = "caminho de código") {
  relativo(rel, onde);
  const raiz = realpathSync(path.join(repo, ".altair"));
  // `.altair` que é link para fora do repositório não vira raiz de confinamento.
  if (!dentro(realpathSync(repo), raiz)) throw new ErroAdaptador(`${onde}: ${path.join(repo, ".altair")} resolve fora do repositório`);
  const bruto = path.join(raiz, rel);
  if (!existsSync(bruto)) throw new ErroAdaptador(`${onde}: ${rel} não existe em ${raiz}`);
  const alvo = realpathSync(bruto);
  if (!dentro(raiz, alvo)) throw new ErroAdaptador(`${onde}: ${rel} resolve fora de ${raiz}`);
  return alvo;
}

/**
 * Raiz de onde a pasta de estado declarada pendura. Sob `node --test` vai
 * para o tmp, como o log (as suítes chamam a CLI e não podem sujar a estação).
 */
export function raizDeEstado(env = process.env) {
  if (env.NODE_TEST_CONTEXT) return path.join(tmpdir(), "altair-conducao-estado-teste");
  return env.XDG_STATE_HOME || path.join(homedir(), ".local", "state");
}

/** Valida a declaração já parseada; devolve a forma normalizada, congelada. */
export function validar(bruto) {
  const d = objeto(bruto, "declaração");
  soCampos(d, CAMPOS.raiz, "declaração", CAMPOS.opcionais);
  const versao = d.versao ?? 1;
  if (!VERSOES.includes(versao)) throw new ErroAdaptador(`versao: esperado ${VERSOES.join(" ou ")} (veio ${JSON.stringify(d.versao)})`);
  if (d.codigo !== undefined) {
    if (versao < 2) throw new ErroAdaptador("codigo: só na versao 2 do esquema ou posterior");
    if (typeof d.codigo === "string" && /\.mjs$/.test(d.codigo)) relativo(d.codigo, "codigo");
    else if (ehNomeEmbutido(d.codigo)) caminhoDoEmbutido(d.codigo);
    else
      throw new ErroAdaptador(
        `codigo: esperado arquivo .mjs em .altair/ ou nome de adaptador embutido, minúsculas, dígitos e hífen (veio ${JSON.stringify(d.codigo)})`,
        "entrada-invalida",
      );
  }
  if (d.pagina !== undefined) {
    if (versao < 3) throw new ErroAdaptador("pagina: só na versao 3 do esquema ou posterior");
    relativo(d.pagina, "pagina");
    // O brief a cita entre crases, numa linha: crase ou quebra de linha quebraria a seção.
    if (/[`\r\n]/.test(d.pagina)) throw new ErroAdaptador("pagina: caminho com crase ou quebra de linha");
  }
  try {
    logEventos.validarProjeto(d.projeto);
  } catch {
    throw new ErroAdaptador("projeto: esperado token minúsculo sem espaço, ponto nem barra");
  }
  if (!Array.isArray(d.operadores) || !d.operadores.length) throw new ErroAdaptador("operadores: esperada lista não vazia");
  const operadores = d.operadores.map((o, i) => {
    const onde = `operadores[${i}]`;
    objeto(o, onde);
    soCampos(o, CAMPOS.operador, onde);
    if (!TOKEN.test(o.handle ?? "")) throw new ErroAdaptador(`${onde}.handle: esperado token sem espaço`);
    if (typeof o.nome !== "string" || !o.nome.trim()) throw new ErroAdaptador(`${onde}.nome: esperado texto`);
    return Object.freeze({ handle: o.handle, nome: o.nome.trim() });
  });
  objeto(d.estado, "estado");
  soCampos(d.estado, CAMPOS.estado, "estado");
  relativo(d.estado.pasta, "estado.pasta");
  objeto(d.log, "log");
  soCampos(d.log, CAMPOS.log, "log");
  relativo(d.log.pasta, "log.pasta");
  const p = objeto(d.pergunta, "pergunta");
  const aceitos = CAMPOS.pergunta[p.destino];
  if (!aceitos) throw new ErroAdaptador(`pergunta.destino: esperado ${Object.keys(CAMPOS.pergunta).join(" | ")}`);
  soCampos(p, aceitos, "pergunta");
  if (p.destino === "pasta") relativo(p.pasta, "pergunta.pasta");
  const conferencia = validarConferencia(d.conferencia);
  if (d.ci !== undefined && typeof d.ci !== "boolean") throw new ErroAdaptador("ci: esperado true ou false");
  const sessao = validarSessao(d.sessao);
  const publicacao = validarPublicacao(d.publicacao);
  const verificacao = validarVerificacao(d.verificacao, versao);
  const guardas = validarGuardas(d.guardas, versao);
  return Object.freeze({
    versao,
    ...(d.codigo === undefined ? {} : { codigo: d.codigo }),
    ...(d.pagina === undefined ? {} : { pagina: d.pagina }),
    projeto: d.projeto,
    operadores: Object.freeze(operadores),
    estado: Object.freeze({ pasta: d.estado.pasta }),
    log: Object.freeze({ pasta: d.log.pasta }),
    pergunta: Object.freeze(p.destino === "pasta" ? { destino: "pasta", pasta: p.pasta } : { destino: "log" }),
    conferencia,
    ci: d.ci ?? true,
    sessao,
    publicacao,
    verificacao,
    guardas,
  });
}

/** O campo da dispensa de publicação e o papel que ele carrega (T16, AC-VEGA29-10): nunca o nome. */
export const TRAILER_DA_DISPENSA = "Conducao-Publicacao-Dispensada";
export const PAPEL_DA_DISPENSA = "operador";

/**
 * `publicacao.frasesLegadas` (T16): ausente ⇒ lista vazia, só o trailer
 * dispensa. Cada frase é um prefixo de linha não vazio, de uma linha só.
 */
function validarPublicacao(p) {
  if (p === undefined) return Object.freeze({ frasesLegadas: Object.freeze([]) });
  objeto(p, "publicacao");
  soCampos(p, CAMPOS.publicacao, "publicacao");
  const f = p.frasesLegadas;
  if (!Array.isArray(f) || !f.every((x) => typeof x === "string" && x.trim() && !/[\r\n]/.test(x)))
    throw new ErroAdaptador("publicacao.frasesLegadas: esperada lista de frases de uma linha");
  return Object.freeze({ frasesLegadas: Object.freeze([...new Set(f)]) });
}

/** A variável que a Verificação embrulhada liga, sem a declaração dizer outra. */
export const MARCA_SEM_COFRE_PADRAO = "ALTAIR_SEM_COFRE_PRODUCAO";
const VARIAVEL = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/**
 * `verificacao` (v4): a marca que o embrulho da Verificação liga e as variáveis
 * de produção que ele tira do ambiente. Ausente ⇒ a marca padrão e nenhuma variável.
 */
function validarVerificacao(v, versao) {
  if (v === undefined) return Object.freeze({ marcaSemCofre: MARCA_SEM_COFRE_PADRAO, variaveisDeProducao: Object.freeze([]) });
  if (versao < 4) throw new ErroAdaptador("verificacao: só na versao 4 do esquema");
  objeto(v, "verificacao");
  soCampos(v, [], "verificacao", CAMPOS.verificacao);
  const marca = v.marcaSemCofre ?? MARCA_SEM_COFRE_PADRAO;
  if (typeof marca !== "string" || !VARIAVEL.test(marca)) throw new ErroAdaptador("verificacao.marcaSemCofre: esperado nome de variável de ambiente");
  const lista = v.variaveisDeProducao ?? [];
  if (!Array.isArray(lista) || !lista.every((x) => typeof x === "string" && VARIAVEL.test(x)))
    throw new ErroAdaptador("verificacao.variaveisDeProducao: esperada lista de nomes de variável de ambiente");
  return Object.freeze({ marcaSemCofre: marca, variaveisDeProducao: Object.freeze([...new Set(lista)]) });
}

/** `guardas` (v4): a pasta do `<guard>-mode`, relativa à raiz do repositório; ausente ⇒ `null`. */
function validarGuardas(g, versao) {
  if (g === undefined) return Object.freeze({ pastaDoModo: null });
  if (versao < 4) throw new ErroAdaptador("guardas: só na versao 4 do esquema");
  objeto(g, "guardas");
  soCampos(g, CAMPOS.guardas, "guardas");
  relativo(g.pastaDoModo, "guardas.pastaDoModo");
  return Object.freeze({ pastaDoModo: g.pastaDoModo });
}

/**
 * A conferência dispensou a publicação? Trailer do núcleo com o papel, ou —
 * só em commit antigo — uma linha do corpo que começa por uma frase legada
 * declarada e traz texto logo depois dela (o mesmo que o antigo `^<frase>\S`).
 */
export function dispensouPublicacao(declaracao, { trailers = {}, corpo = "" } = {}) {
  if (trailers[TRAILER_DA_DISPENSA] === PAPEL_DA_DISPENSA) return true;
  const linhas = String(corpo).split("\n");
  return declaracao.publicacao.frasesLegadas.some((frase) => linhas.some((l) => l.startsWith(frase) && /^\S/.test(l.slice(frase.length))));
}

/** Modos de permissão do `create_session`/`get_session` (`auto`, `bypassPermissions`, …). */
const MODO = /^[A-Za-z][A-Za-z_]{1,47}$/;
export const MODOS_SEM_CLIQUE_PADRAO = Object.freeze(["auto"]);

/**
 * `sessao.modosSemClique` (T15, D-VEGA29-29): ausente ⇒ `["auto"]`. Lista vazia
 * recusa — nenhuma filha abriria; o modo vem como o `get_session` o escreve.
 */
function validarSessao(s) {
  if (s === undefined) return Object.freeze({ modosSemClique: MODOS_SEM_CLIQUE_PADRAO });
  objeto(s, "sessao");
  soCampos(s, CAMPOS.sessao, "sessao");
  const m = s.modosSemClique;
  if (!Array.isArray(m) || !m.length || !m.every((x) => typeof x === "string" && MODO.test(x)))
    throw new ErroAdaptador("sessao.modosSemClique: esperada lista não vazia de modos de permissão");
  return Object.freeze({ modosSemClique: Object.freeze([...new Set(m)]) });
}

/**
 * O modo como o `abrir` o compara: sem o prefixo `permission_mode_`, sem
 * caixa e sem `_` — `bypassPermissions`, `BYPASS_PERMISSIONS` e
 * `permission_mode_bypass_permissions` são o mesmo modo.
 */
export function normalizarModo(modo) {
  return String(modo ?? "").trim().toLowerCase().replace(/^permission_mode_/, "").replaceAll("_", "");
}

/** O modo da sessão criadora conta como sem clique na declaração (T15, D-VEGA29-29)? */
export function modoSemClique(declaracao, modo) {
  const alvo = normalizarModo(modo);
  return Boolean(alvo) && declaracao.sessao.modosSemClique.some((m) => normalizarModo(m) === alvo);
}

/** Marca do núcleo: task com ela é conferida pelo operador em todo projeto, e o resultado se pergunta. */
export const MARCA_DA_CONFERENCIA = "conferencia-do-operador";
const MARCA = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALOR = /^[A-Za-z0-9_-]{1,64}$/;

function valores(v, onde) {
  if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === "string" && VALOR.test(x)))
    throw new ErroAdaptador(`${onde}: esperada lista não vazia de tokens`);
  return Object.freeze([...v]);
}

/**
 * Os casos declarados de conferência do operador (T14, 7-a). Ausente ⇒ lista
 * vazia: só a marca do núcleo vale. Marca repetida, ou a do núcleo
 * redeclarada, recusa; o mesmo valor dos dois lados (`sim` e `nao`) também.
 */
function validarConferencia(lista) {
  if (lista === undefined) return Object.freeze([]);
  if (!Array.isArray(lista)) throw new ErroAdaptador("conferencia: esperada lista");
  const vistas = new Set([MARCA_DA_CONFERENCIA]);
  return Object.freeze(
    lista.map((c, i) => {
      const onde = `conferencia[${i}]`;
      objeto(c, onde);
      soCampos(c, "arquivo" in c ? CAMPOS.conferencia.arquivo : CAMPOS.conferencia.pergunta, onde);
      if (typeof c.marca !== "string" || !MARCA.test(c.marca)) throw new ErroAdaptador(`${onde}.marca: esperado token minúsculo`);
      if (vistas.has(c.marca)) throw new ErroAdaptador(`${onde}.marca: ${c.marca} repetida ou do núcleo`);
      vistas.add(c.marca);
      if (!("arquivo" in c)) return Object.freeze({ marca: c.marca });
      const arquivo = relativo(c.arquivo, `${onde}.arquivo`);
      const sim = valores(c.sim, `${onde}.sim`);
      const nao = valores(c.nao, `${onde}.nao`);
      if (sim.some((v) => nao.includes(v))) throw new ErroAdaptador(`${onde}: valor nos dois lados (sim e nao)`);
      return Object.freeze({ marca: c.marca, arquivo, sim, nao });
    }),
  );
}

/**
 * Lê a declaração de `<repo>/.altair/adaptador.json` (ou, ausente, a da árvore
 * do núcleo) e resolve os caminhos de escrita. `env` decide a raiz de estado e
 * o override do log (`ALTAIR_CONDUCAO_LOG_DIR`, que segue sobrepondo).
 */
function lerDeclaracao(raiz) {
  let origem = "repo";
  let arquivo = path.join(raiz, ARQUIVO);
  if (!existsSync(arquivo)) {
    origem = "nucleo";
    arquivo = path.join(raizDoNucleo(), ARQUIVO);
    if (!existsSync(arquivo)) throw new ErroAdaptador(`sem declaração: nem ${path.join(raiz, ARQUIVO)} nem a do núcleo`);
  }
  let bruto;
  try {
    bruto = JSON.parse(readFileSync(arquivo, "utf8"));
  } catch (e) {
    throw new ErroAdaptador(`${arquivo}: JSON ilegível (${e.message})`);
  }
  return { origem, arquivo, validada: validar(bruto) };
}

export function lerAdaptador(repo, { env = process.env } = {}) {
  const { origem, arquivo, validada: declaracao } = lerDeclaracao(path.resolve(repo ?? process.cwd()));
  const pastaDeEstado = caminhoDeEscrita(raizDeEstado(env), declaracao.estado.pasta, "estado.pasta");
  // Log v1: `<base>/<projeto>/` (T11). O override segue sendo a pasta final.
  const pastaDoLog =
    env.ALTAIR_CONDUCAO_LOG_DIR || env.NODE_TEST_CONTEXT
      ? logEventos.pastaDoLog(env, declaracao.projeto)
      : caminhoDeEscrita(caminhoDeEscrita(pastaDeEstado, declaracao.log.pasta, "log.pasta"), declaracao.projeto, "projeto");
  const pastaDaPergunta =
    declaracao.pergunta.destino === "log" ? pastaDoLog : caminhoDeEscrita(pastaDeEstado, declaracao.pergunta.pasta, "pergunta.pasta");
  return Object.freeze({
    origem,
    arquivo,
    ...declaracao,
    operador: declaracao.operadores[0],
    pastaDeEstado,
    pastaDoLog,
    pastaDaPergunta,
  });
}

/**
 * A página do projeto que a declaração DO REPOSITÓRIO aponta (T38, A18), ou
 * `null` sem o campo. A declaração do núcleo, quando o repositório não tem a
 * sua, não vale aqui: a página dela é de outro projeto e não existe na árvore
 * conduzida. Só a declaração: não resolve a pasta de estado, que o brief não usa.
 */
export function paginaDoProjeto(repo) {
  const { origem, validada } = lerDeclaracao(path.resolve(repo ?? process.cwd()));
  return origem === "repo" ? (validada.pagina ?? null) : null;
}

/**
 * O embrulho da Verificação que a declaração pede (v4): a marca que ele liga e
 * as variáveis de produção que ele tira. Sem o campo, o padrão do núcleo.
 */
export function verificacaoDoProjeto(repo) {
  return lerDeclaracao(path.resolve(repo ?? process.cwd())).validada.verificacao;
}

/** Nome de quem decide, para os textos do núcleo; declaração ilegível cai no papel genérico. */
export function nomeDoOperador(repo, opcoes) {
  try {
    return lerAdaptador(repo, opcoes).operador.nome;
  } catch {
    return "o operador";
  }
}

// ── código do adaptador (T20) ────────────────────────────────────────────────

function lista(v, onde) {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.trim()))
    throw new ErroAdaptador(`${onde}: esperada lista de textos`);
  return Object.freeze([...v]);
}

function funcao(v, onde) {
  if (typeof v !== "function") throw new ErroAdaptador(`${onde}: esperada função`);
  return v;
}

/**
 * Confere a forma do código do adaptador (o `default` do módulo) e devolve a
 * forma normalizada, congelada. Obrigatórios: `plano` (`raiz`, `casa`, `ler`,
 * `brief`), `publicacao`, `caminhosClinicos`, `telasClinicasDosSteps` e
 * `foraDasTelasDosSteps` — lista vazia vale, campo ausente não: o projeto diz
 * que não tem caminho sensível, o núcleo não supõe. `carimbo` e `ci` podem ser
 * `null` (o projeto não exige carimbo, ou não tem CI da proposta);
 * `marcasDeRodadas` é opcional (default `[]`).
 */
export function validarCodigo(bruto, onde = "código do adaptador") {
  const c = objeto(bruto, onde);
  const conhecidos = ["plano", "publicacao", "caminhosClinicos", "telasClinicasDosSteps", "foraDasTelasDosSteps", "carimbo", "ci", "marcasDeRodadas"];
  soCampos(c, conhecidos.slice(0, 7), onde, ["marcasDeRodadas"]);
  const p = objeto(c.plano, `${onde}.plano`);
  soCampos(p, ["raiz", "casa", "ler", "brief"], `${onde}.plano`);
  relativo(p.raiz, `${onde}.plano.raiz`);
  let carimbo = null;
  if (c.carimbo !== null) {
    const k = objeto(c.carimbo, `${onde}.carimbo`);
    soCampos(k, ["achar", "classeDoCommit", "notas", "ehCarimbo", "destinos"], `${onde}.carimbo`);
    for (const f of ["achar", "classeDoCommit", "notas", "ehCarimbo"]) funcao(k[f], `${onde}.carimbo.${f}`);
    if (typeof k.destinos !== "string" || !k.destinos.trim()) throw new ErroAdaptador(`${onde}.carimbo.destinos: esperado texto`);
    carimbo = Object.freeze({ ...k });
  }
  let ci = null;
  if (c.ci !== null) {
    const k = objeto(c.ci, `${onde}.ci`);
    soCampos(k, ["ramoBase", "veredito"], `${onde}.ci`);
    if (!/^[A-Za-z0-9._/-]{1,128}$/.test(k.ramoBase ?? "") || k.ramoBase.includes("..")) throw new ErroAdaptador(`${onde}.ci.ramoBase: esperado nome de ramo`);
    if (typeof k.veredito !== "string" || !k.veredito.trim()) throw new ErroAdaptador(`${onde}.ci.veredito: esperado texto`);
    ci = Object.freeze({ ramoBase: k.ramoBase, veredito: k.veredito });
  }
  const marcas = c.marcasDeRodadas === undefined ? Object.freeze([]) : lista(c.marcasDeRodadas, `${onde}.marcasDeRodadas`);
  if (!marcas.every((m) => MARCA.test(m))) throw new ErroAdaptador(`${onde}.marcasDeRodadas: esperados tokens minúsculos`);
  return Object.freeze({
    plano: Object.freeze({ raiz: p.raiz, casa: funcao(p.casa, `${onde}.plano.casa`), ler: funcao(p.ler, `${onde}.plano.ler`), brief: funcao(p.brief, `${onde}.plano.brief`) }),
    publicacao: lista(c.publicacao, `${onde}.publicacao`),
    caminhosClinicos: lista(c.caminhosClinicos, `${onde}.caminhosClinicos`),
    telasClinicasDosSteps: lista(c.telasClinicasDosSteps, `${onde}.telasClinicasDosSteps`),
    foraDasTelasDosSteps: lista(c.foraDasTelasDosSteps, `${onde}.foraDasTelasDosSteps`),
    carimbo,
    ci,
    marcasDeRodadas: marcas,
  });
}

const requerer = createRequire(import.meta.url);
const CODIGOS = new Map();

/** Carrega (uma vez por caminho) e confere o código do adaptador em `caminho`. */
function carregarCodigo(caminho) {
  if (!CODIGOS.has(caminho)) {
    let mod;
    try {
      mod = requerer(caminho);
    } catch (e) {
      throw new ErroAdaptador(`${caminho}: código do adaptador não carrega (${e.message})`);
    }
    CODIGOS.set(caminho, validarCodigo(mod?.default, caminho));
  }
  return CODIGOS.get(caminho);
}

/**
 * Caminho do código declarado: em `<repo>/.altair/`, por `realpath` (fora,
 * inexistente ou por link que salte ⇒ recusa). Única exceção: a declaração
 * do núcleo (sob `node --test`, a do projeto de teste) copiada para outro
 * repositório — as suítes montam repositórios de mentira com ela — acha o
 * código na árvore do núcleo, e só quando o nome declarado
 * é o mesmo que a declaração do núcleo aponta. Nome errado num repositório
 * qualquer recusa, em vez de herdar o código de outro projeto.
 */
function caminhoDoCodigoDeclarado(repo, rel) {
  if (existsSync(path.join(path.resolve(repo), ".altair", rel))) return caminhoDeCodigo(repo, rel, "codigo");
  let doNucleo = null;
  try {
    doNucleo = lerDeclaracao(raizDoNucleo()).validada.codigo ?? null;
  } catch {
    doNucleo = null;
  }
  if (doNucleo !== rel) throw new ErroAdaptador(`codigo: ${rel} não existe em ${path.join(repo, ".altair")}`);
  return caminhoDeCodigo(raizDoNucleo(), rel, "codigo");
}

/** Código do adaptador da árvore que carrega o núcleo (os chamadores sem `--repo`, como as suítes). */
export function codigoDoNucleo() {
  return codigoDoAdaptador(raizDoNucleo());
}

/**
 * Código do adaptador do repositório: o que a declaração aponta em `codigo` —
 * o arquivo em `.altair/` ou, por nome, o embutido no núcleo (D-VEGA29-34).
 * Declaração sem `codigo` (v1, ou v2 só de dados) usa o da árvore do núcleo,
 * como a declaração ausente usa a dele; sem código nenhum ⇒ recusa, porque
 * o núcleo não lê plano sem leitor.
 */
export function codigoDoAdaptador(repo) {
  const raiz = path.resolve(repo ?? process.cwd());
  const declaracao = lerDeclaracao(raiz);
  const { codigo } = declaracao.validada;
  if (codigo && ehNomeEmbutido(codigo)) return carregarCodigo(caminhoDoEmbutido(codigo));
  if (codigo) return carregarCodigo(caminhoDoCodigoDeclarado(raiz, codigo));
  if (raiz !== raizDoNucleo()) return codigoDoNucleo();
  throw new ErroAdaptador(`${declaracao.arquivo}: sem \`codigo\` — o núcleo não tem leitor de plano próprio`);
}
