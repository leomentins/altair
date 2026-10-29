/**
 * pre-voo.mjs — o pré-voo da condução (VEGA-29 T30, D-VEGA29-15, AC-VEGA29-12).
 *
 * Antes de abrir filha, quem conduz confere o host em que a condução vai rodar:
 *
 *   plugin-carregado   a CLI do host (`sessao.cli`, argv sem shell, na raiz do projeto)
 *                      lista o plugin da condução ligado
 *   instalacao-unica   o plugin aparece uma vez só na lista, e nenhum `settings` do
 *                      projeto (`sessao.settings`) registra um hook do plugin à mão;
 *                      entrada de escopo de projeto com `projectPath` de OUTRO projeto
 *                      não conta (nem aqui nem em `plugin-carregado`): a lista do host
 *                      é da máquina, e a instalação de um vizinho não é deste projeto;
 *                      sem como provar que é de outro (git mudo, caminho que não
 *                      resolve), a entrada conta
 *   ponte-com-restart  `systemctl --user show <sessao.ponte.unidade>` dá `Restart` ≠ `no`;
 *                      sem a unidade declarada sai `nao-declarada`, como aviso
 *   trafego-ligado     a variável que desliga o tráfego não essencial
 *                      (`sessao.variavelDoTrafego`) não está definida no ambiente do
 *                      processo nem no `env` de um `settings`
 *
 * Alguma falha ⇒ pergunta tipada (`motivo: "pre-voo"`) com `{ conferencia,
 * encontrado, remedio }` por falha, e nenhuma filha abre. Tudo verde ⇒
 * `{ acao: "pre-voo", ok: true, conferencias, avisos }`.
 *
 * Aviso de tier, com `--ciclo`: o plano no HEAD diz o tier de cada tarefa
 * (`**Tier:**`, ou o da fase; default `inherit`). Tarefa que pede julgamento —
 * fechamento de fase ou review-gate, conferência do operador, ou classe
 * sensível — e resolve para `mecanico` sai em `avisos` com `{ task, tier,
 * modelo }`, sem parar. Tarefa comum em `mecanico` não avisa: o barato basta.
 *
 * O núcleo não nomeia host, ponte, modelo nem fornecedor: o binário, os
 * arquivos de configuração, a variável, a unidade e o mapa tier → modelo vêm
 * da declaração (v5). Toda execução externa vai por `spawnSync` sem shell, com
 * prazo; comando ausente vira falha com remédio, nunca exceção crua.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import * as adaptador from "./adaptador.mjs";
import { ErroPlano, lerPlanoNoCommit } from "./ler-plano.mjs";
import * as pergunta from "./pergunta.mjs";
import { casoDeConferencia } from "./verbos.mjs";

/** O nome do plugin da condução, como o host o lista (`<nome>@<marketplace>`). */
export const NOME_DO_PLUGIN = "altair";
export const PRAZO_MS = 15_000;
export const CONFERENCIAS = Object.freeze(["plugin-carregado", "instalacao-unica", "ponte-com-restart", "trafego-ligado"]);
/** Marcas do `satisfies` que fazem da tarefa um fechamento ou um gate: pedem julgamento. */
const MARCAS_DE_JULGAMENTO = Object.freeze(["fechamento-de-fase", "review-gate"]);
const HOOKS_DO_PLUGIN = path.join(adaptador.RAIZ_DO_PLUGIN, "hooks", "hooks.json");
const SCRIPT_RE = /[\w.-]+\.(?:js|mjs|cjs)\b/g;

/** Roda `argv` sem shell, com prazo; `{ ok, stdout }` ou `{ ok: false, encontrado, ausente }`. */
export function rodar(argv, { cwd, env, prazoMs = PRAZO_MS }) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: "utf8", timeout: prazoMs, shell: false, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
  const linha = argv.join(" ");
  if (r.error?.code === "ENOENT") return { ok: false, ausente: true, encontrado: `comando ausente: ${argv[0]}` };
  if (r.error?.code === "ETIMEDOUT" || (r.signal && !r.error)) return { ok: false, encontrado: `sem resposta em ${prazoMs} ms: ${linha}` };
  if (r.error) return { ok: false, encontrado: `${linha}: ${r.error.code ?? r.error.message}` };
  if (r.status !== 0) return { ok: false, encontrado: `${linha} saiu ${r.status}${r.stderr?.trim() ? `: ${r.stderr.trim().slice(0, 200)}` : ""}` };
  return { ok: true, stdout: r.stdout };
}

const conferida = (conferencia, estado, encontrado, remedio = null) => ({ conferencia, estado, encontrado, ...(remedio ? { remedio } : {}) });
const naoDeclarado = (conferencia, campo) =>
  conferida(conferencia, "falha", `${campo} não declarado`, `declarar ${campo} (versão 5 do esquema) em .altair/adaptador.json`);

/**
 * As raízes que contam como "este projeto" para o `projectPath` da lista: a árvore
 * conduzida e, quando ela é worktree, a árvore principal do mesmo repositório (o
 * host grava a instalação de projeto contra a principal). `inconclusivo` quando o
 * git não disse qual é a principal: aí nenhuma entrada sai do filtro (o pré-voo
 * fica no lado que recusa, nunca no que deixa passar calado).
 */
export function raizesDoProjeto(repo, { env, prazoMs } = {}) {
  const raizes = new Set([path.resolve(repo)]);
  try {
    raizes.add(realpathSync(repo));
  } catch {
    return { raizes, inconclusivo: true };
  }
  const r = rodar(["git", "-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { env, prazoMs });
  if (!r.ok || !r.stdout.trim()) return { raizes, inconclusivo: true };
  const principal = path.dirname(r.stdout.trim());
  raizes.add(principal);
  try {
    raizes.add(realpathSync(principal));
  } catch {
    return { raizes, inconclusivo: true };
  }
  return { raizes, inconclusivo: false };
}

/**
 * A entrada é deste projeto: sem `projectPath` (user, local, pasta de skills), com ele
 * numa das raízes, ou quando não dá para dizer que é de outro (raízes inconclusivas,
 * `projectPath` que não resolve no disco). `projectPath` relativo resolve contra `repo`.
 */
export function doProjeto(entrada, { raizes, inconclusivo }, repo) {
  const p = entrada?.projectPath;
  if (typeof p !== "string" || !p || inconclusivo) return true;
  const absoluto = path.resolve(repo, p);
  if (raizes.has(absoluto)) return true;
  try {
    return raizes.has(realpathSync(absoluto));
  } catch {
    return true;
  }
}

/** A lista de plugins do host: `{ entradas }` (as do plugin da condução, deste projeto) ou `{ erro }`. */
function lerLista(decl, { repo, env, prazoMs }) {
  const r = rodar(decl.sessao.cli, { cwd: repo, env, prazoMs });
  if (!r.ok) return { erro: r.encontrado, ausente: r.ausente };
  let lista;
  try {
    lista = JSON.parse(r.stdout);
  } catch (e) {
    return { erro: `${decl.sessao.cli.join(" ")} não devolveu JSON (${e.message})` };
  }
  if (!Array.isArray(lista)) return { erro: `${decl.sessao.cli.join(" ")} não devolveu lista` };
  const nome = (e) => String(e?.name ?? e?.id ?? "").split("@")[0];
  const raizes = raizesDoProjeto(repo, { env, prazoMs });
  return { entradas: lista.filter((e) => e && typeof e === "object" && nome(e) === NOME_DO_PLUGIN && doProjeto(e, raizes, repo)) };
}

function pluginCarregado(decl, lista) {
  const C = "plugin-carregado";
  if (!decl.sessao.cli) return naoDeclarado(C, "sessao.cli");
  const comando = decl.sessao.cli.join(" ");
  if (lista.erro)
    return conferida(C, "falha", lista.erro, lista.ausente ? `instalar a CLI do host, ou corrigir sessao.cli na declaração (${comando})` : `rodar ${comando} na raiz do projeto e corrigir o que ela diz`);
  const ligadas = lista.entradas.filter((e) => e.enabled !== false);
  if (ligadas.length) return conferida(C, "ok", `${NOME_DO_PLUGIN} ligado (${ligadas.map((e) => e.scope ?? "?").join(", ")})`);
  if (lista.entradas.length)
    return conferida(C, "falha", `${NOME_DO_PLUGIN} instalado e desligado (${lista.entradas.map((e) => e.scope ?? "?").join(", ")})`, `ligar o plugin ${NOME_DO_PLUGIN} no projeto e conferir com ${comando}`);
  return conferida(C, "falha", `${NOME_DO_PLUGIN} fora da lista de ${comando}`, `instalar o plugin ${NOME_DO_PLUGIN} pelo marketplace, ligá-lo no projeto e conferir com ${comando}`);
}

/** Os `settings` declarados que existem: `[{ rel, json }]`, ou `{ erro }` no primeiro ilegível. */
function lerSettings(decl, repo) {
  const lidos = [];
  for (const rel of decl.sessao.settings) {
    const arquivo = path.join(repo, rel);
    if (!existsSync(arquivo)) continue;
    try {
      lidos.push({ rel, json: JSON.parse(readFileSync(arquivo, "utf8")) });
    } catch (e) {
      return { erro: `${rel} ilegível (${e.message})`, rel };
    }
  }
  return { lidos };
}

/** Todo `command` (texto) sob `hooks` de um settings, em qualquer profundidade. */
function comandosDeHook(no, out = []) {
  if (Array.isArray(no)) for (const x of no) comandosDeHook(x, out);
  else if (no && typeof no === "object")
    for (const [k, v] of Object.entries(no)) {
      if (k === "command" && typeof v === "string") out.push(v);
      else comandosDeHook(v, out);
    }
  return out;
}

/** Os `command` de `hooks/hooks.json` do plugin e os scripts que eles chamam. */
function hooksDoPlugin() {
  const comandos = comandosDeHook(JSON.parse(readFileSync(HOOKS_DO_PLUGIN, "utf8")).hooks);
  return { comandos, scripts: [...new Set(comandos.flatMap((c) => c.match(SCRIPT_RE) ?? []))] };
}

function instalacaoUnica(decl, lista, settings) {
  const C = "instalacao-unica";
  if (!decl.sessao.settings.length) return naoDeclarado(C, "sessao.settings");
  if (settings.erro) return conferida(C, "falha", settings.erro, `corrigir o JSON de ${settings.rel}`);
  const problemas = [];
  if (!lista.erro && lista.entradas.length > 1)
    problemas.push(`${lista.entradas.length} instalações de ${NOME_DO_PLUGIN} (${lista.entradas.map((e) => e.scope ?? "?").join(", ")})`);
  const { comandos, scripts } = hooksDoPlugin();
  for (const { rel, json } of settings.lidos) {
    const doPlugin = comandosDeHook(json?.hooks).filter((c) => comandos.includes(c) || scripts.some((s) => (c.match(SCRIPT_RE) ?? []).includes(s)));
    if (doPlugin.length) problemas.push(`${rel} registra hook do plugin: ${[...new Set(doPlugin)].join(" · ")}`);
  }
  if (problemas.length)
    return conferida(C, "falha", problemas.join("; "), `deixar uma instalação só do plugin e tirar dos settings do projeto os hooks que o plugin já registra`);
  return conferida(C, "ok", lista.erro ? "settings sem hook do plugin (lista do host não lida)" : `${lista.entradas.length} instalação(ões) na lista, settings sem hook do plugin`);
}

/** `systemctl --user show <unidade> -p Restart -p LoadState` → `Restart` ≠ `no`. */
function ponteComRestart(decl, { env, prazoMs }) {
  const C = "ponte-com-restart";
  const unidade = decl.sessao.ponte?.unidade;
  if (!unidade) return conferida(C, "nao-declarada", "sessao.ponte.unidade não declarada", "declarar sessao.ponte.unidade para conferir a ponte");
  const r = rodar(["systemctl", "--user", "show", unidade, "-p", "Restart", "-p", "LoadState"], { env, prazoMs });
  if (!r.ok) return conferida(C, "falha", r.encontrado, r.ausente ? "rodar a condução numa máquina com systemd de usuário, ou tirar sessao.ponte da declaração" : `conferir a unidade com systemctl --user status ${unidade}`);
  const props = Object.fromEntries(
    r.stdout
      .split("\n")
      .map((l) => /^([A-Za-z]+)=(.*)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );
  if (props.LoadState === "not-found") return conferida(C, "falha", `${unidade} não existe (LoadState=not-found)`, `instalar a unidade ${unidade} ou corrigir sessao.ponte.unidade`);
  const restart = props.Restart ?? "";
  if (!restart || restart === "no")
    return conferida(C, "falha", `${unidade} com Restart=${restart || "(vazio)"}`, `systemctl --user edit ${unidade} com [Service] Restart=always, depois systemctl --user daemon-reload e restart da unidade`);
  return conferida(C, "ok", `${unidade} com Restart=${restart}`);
}

function trafegoLigado(decl, settings, env) {
  const C = "trafego-ligado";
  const v = decl.sessao.variavelDoTrafego;
  if (!v) return naoDeclarado(C, "sessao.variavelDoTrafego");
  if (!decl.sessao.settings.length) return naoDeclarado(C, "sessao.settings");
  if (settings.erro) return conferida(C, "falha", settings.erro, `corrigir o JSON de ${settings.rel}`);
  const onde = [];
  if (env[v] !== undefined) onde.push("no ambiente do processo");
  for (const { rel, json } of settings.lidos)
    if (json?.env && typeof json.env === "object" && Object.hasOwn(json.env, v)) onde.push(`no env de ${rel}`);
  if (onde.length)
    return conferida(C, "falha", `${v} definida ${onde.join(" e ")}`, `tirar ${v} do ambiente da sessão (perfil do shell, unidade da ponte) e do env dos settings do projeto`);
  return conferida(C, "ok", `${v} ausente`);
}

/** A tarefa pede julgamento: fechamento ou review-gate, conferência do operador, ou classe sensível. */
export function pedeJulgamento(t, conferencia = []) {
  return Boolean(t.fechamento || (t.marcas ?? []).some((m) => MARCAS_DE_JULGAMENTO.includes(m)) || casoDeConferencia(t, conferencia) || t.classe === "sensivel");
}

/** Avisos de tier do plano: julgamento em `mecanico`, com o modelo que a declaração mapeia. */
export function avisosDeTier(plano, decl) {
  return plano.tasks
    .filter((t) => t.tier === "mecanico" && pedeJulgamento(t, decl.conferencia))
    .map((t) => ({ tipo: "tier", task: t.id, tier: t.tier, modelo: decl.tiers[t.tier] ?? null }));
}

/**
 * O pré-voo. `env` é o ambiente conferido e o das execuções (PATH incluso);
 * `ciclo` liga o aviso de tier. Devolve a saída do verbo, pronta para o JSON.
 */
export function preVoo({ repo, ciclo = null, env = process.env, prazoMs = PRAZO_MS }) {
  const decl = adaptador.lerAdaptador(repo, { env });
  const lista = decl.sessao.cli ? lerLista(decl, { repo, env, prazoMs }) : { erro: "sessao.cli não declarado" };
  const settings = decl.sessao.settings.length ? lerSettings(decl, repo) : { lidos: [] };
  const conferencias = [pluginCarregado(decl, lista), instalacaoUnica(decl, lista, settings), ponteComRestart(decl, { env, prazoMs }), trafegoLigado(decl, settings, env)];
  const avisos = conferencias.filter((c) => c.estado === "nao-declarada").map((c) => ({ tipo: "nao-declarada", conferencia: c.conferencia, remedio: c.remedio }));
  if (ciclo) {
    try {
      avisos.push(...avisosDeTier(lerPlanoNoCommit(repo, "HEAD", ciclo).plano, decl));
    } catch (e) {
      if (!(e instanceof ErroPlano)) throw e;
      avisos.push({ tipo: "plano-ilegivel", motivo: e.codigo, detalhe: e.message });
    }
  }
  const falhas = conferencias.filter((c) => c.estado === "falha").map(({ conferencia, encontrado, remedio }) => ({ conferencia, encontrado, remedio }));
  const base = { ...(ciclo ? { ciclo } : {}), conferencias, avisos };
  if (!falhas.length) return { acao: "pre-voo", ok: true, ...base };
  return pergunta.perguntar({
    acao: "perguntar",
    motivo: "pre-voo",
    ...base,
    falhas,
    detalhe: `o pré-voo falhou (${falhas.map((f) => f.conferencia).join(", ")}): nenhuma filha abre. Dizer a ${decl.operador.nome} o que falhou e o remédio de cada falha, e rodar o pré-voo de novo depois.`,
  });
}
