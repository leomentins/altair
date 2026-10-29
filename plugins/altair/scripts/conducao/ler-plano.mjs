/**
 * ler-plano.mjs — o único leitor do plano para todos os verbos da condução
 * (VEGA-22 T6).
 *
 * O plano que vale é o `canonico.md` no commit da marca de fase autorizada
 * (`git show <marca>:<caminho>`), nunca a árvore: a marca grava o blob no
 * trailer `Conducao-Plano`, e plano mudado depois — por filha ou por
 * `/intra-plan` — só vale com nova autorização (ruling 2a e 11a do plan-review
 * v1). O formato do plano é do projeto (T20): o código do adaptador diz onde
 * o plano mora (`plano.raiz`/`plano.casa`) e o parseia (`plano.ler`: fases,
 * tasks, declarações da T5); daqui para baixo a regra é do núcleo, e o que o
 * plano não declara cai na leitura conservadora.
 */
import { TIERS, TIER_PADRAO, codigoDoAdaptador, codigoDoNucleo } from "./adaptador.mjs";
import { git as gitExec } from "./git-exec.mjs";
import { BOTOES } from "./botoes.mjs";

/** Erro de leitura do plano com código estável, para a ação `perguntar`. */
export class ErroPlano extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Saída crua (sem aparar), pelo executor único: com prazo e `git-prazo-estourado` no estouro (T17). */
export function git(repo, args) {
  return gitExec(repo, args, { cru: true });
}

/** Mesma regra do `plan-check` (`FECHA_FASE`): task que fecha fase não abre filha. */
const FECHA_FASE_RE = /\b(fechamento-de-fase|review-gate)\b/;
/**
 * `review-gate` só fecha a fase quando é o último da cadeia: com task da mesma
 * fase dependendo dele (UI-heavy: review-gate → live-ux-gate → fechamento), é
 * task comum. Sem isso a task do meio nunca abre e a fase dá `sem-saida`.
 */
const FECHAMENTO_DE_FASE_RE = /\bfechamento-de-fase\b/;
/**
 * Task de rodadas: uma marca de `marcasDeRodadas` do adaptador abrindo um
 * parêntese do `satisfies` (a marca é token `[a-z0-9-]`, conferido pelo
 * `validarCodigo` — nada a escapar).
 */
function deRodadas(satisfies, marcas) {
  return marcas.some((m) => new RegExp(`\\(${m}\\b`, "i").test(satisfies));
}
/**
 * Marcas entre parênteses do `satisfies` (`(fechamento-de-fase)`,
 * `(conferencia-do-operador)`…), minúsculas — todo token do parêntese, também
 * em `(review-gate, live-ux-gate)` ou `(a + b)`.
 */
const PARENTESE_RE = /\(([^()]*)\)/g;
const MARCA_RE = /^[a-z0-9][a-z0-9-]*$/;
function marcasDo(satisfies) {
  const tokens = [...satisfies.matchAll(PARENTESE_RE)].flatMap((m) => m[1].toLowerCase().split(/[\s,+;/]+/));
  return [...new Set(tokens.filter((x) => MARCA_RE.test(x)))];
}

/** Tasks citadas em `**Inputs:**`, fora de crase (path citado não é dependência). */
function tasksEmInputs(inputs) {
  return [...inputs.replace(/`[^`]*`/g, "").matchAll(/\bT\d{1,3}\b/g)].map((m) => m[0]);
}

/** Paths entre crases de um bullet (`**Outputs:**`). */
function pathsEntreCrases(valor) {
  return [...valor.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter((v) => !/\s/.test(v));
}

/**
 * Comando da Verificação: o único trecho em crase da linha. Mais de um trecho
 * é prosa com comando dentro — fundir os trechos entregaria crase solta ao
 * `bash -c` do `conferir`, que a executaria como substituição de comando; sem
 * trecho único, `null` (o `conferir` recusa com `verificacao-ausente`).
 */
export function comandoDaVerificacao(valor) {
  const trechos = [...valor.matchAll(/`([^`]+)`/g)];
  return trechos.length === 1 ? trechos[0][1] : null;
}

/**
 * Tier declarado (T30, D-VEGA29-15): o valor de `**Tier:**`, sem crase nem
 * caixa; ausente ⇒ `null`. Fora de `TIERS` vai a `invalidas`, como toda
 * declaração fora do vocabulário — nunca vira o default calado.
 */
function tierDeclarado(valor) {
  if (valor === undefined || valor === null) return null;
  const v = String(valor).replaceAll("`", "").trim().toLowerCase();
  return v || null;
}

/** Glob dos botões → RegExp: `**` qualquer profundidade, `*` um segmento. */
export function globParaRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `**/` casa zero ou mais diretórios; `**` no fim casa o resto.
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function casaAlgum(caminho, globs) {
  return globs.some((g) => globParaRegex(g).test(caminho));
}

/**
 * Classe da task na regra do conjunto pronto (T6 passo 4): `workstation` sai
 * como `parar`; `maestra` sai como `fazer-maestra` (a maestra executa na
 * worktree do ciclo, sem filha); `sensivel` (publicação ou caminho clínico)
 * pergunta antes de abrir; `fechamento` vira `fechar-fase`; `comum` abre direto.
 */
function classificar(t) {
  if (t.estacao === "workstation") return "workstation";
  if (t.estacao === "maestra") return "maestra";
  if (t.publicacao.length || t.clinica.length) return "sensivel";
  if (t.fechamento) return "fechamento";
  return "comum";
}

/**
 * Plano parseado a partir do texto (puro — sem git). `codigo` é o código do
 * adaptador (`codigoDoAdaptador(repo)`); sem ele, o da árvore do núcleo.
 */
export function lerPlano(texto, codigo = codigoDoNucleo()) {
  const { ciclo, fases: phases, tasks, declaracoes: decl } = codigo.plano.ler(texto);
  // Tier (T30): da tarefa (`**Tier:**`), senão da fase (o heading, lido pelo adaptador como `tier`), senão `inherit`.
  const invalidasDeTier = [];
  const tierDaFase = new Map();
  for (const f of phases) {
    const v = tierDeclarado(f.tier);
    if (v && !TIERS.includes(v)) invalidasDeTier.push({ campo: "Tier", valor: `${f.id}: ${v}` });
    tierDaFase.set(f.id, v && TIERS.includes(v) ? v : null);
  }
  const larguraDeclarada = !decl.ausentes.some((a) => a.campo === "Largura do ciclo");

  const lista = [];
  for (const [i, t] of tasks.entries()) {
    const d = decl.porTask.get(t.id);
    const explicitas = tasksEmInputs(t.bullets.get("Inputs") ?? "");
    // Leitura conservadora: sem task em Inputs e sem independência declarada,
    // depende da anterior no §3.
    const deps = explicitas.length
      ? explicitas
      : d.independente || i === 0
        ? []
        : [tasks[i - 1].id];
    const texto = [t.title, ...t.bullets.values()].join("\n");
    const outputs = pathsEntreCrases(t.bullets.get("Outputs") ?? "");
    const task = {
      id: t.id,
      titulo: t.title,
      fase: t.phase,
      deps,
      independente: d.independente,
      estacao: d.estacao,
      posMerge: d.verificacaoPosMerge,
      prazoMin: d.prazoMin ?? BOTOES.prazoPadraoMin,
      outputs,
      // Caminhos entre crases dos Steps: o `trazer` lê neles os segmentos de tela que a task muda (P21/P24).
      passos: pathsEntreCrases(t.bullets.get("Steps") ?? ""),
      verificacao: comandoDaVerificacao(t.bullets.get("Verificação") ?? ""),
      fechamento: FECHA_FASE_RE.test(t.satisfiesRaw),
      // Task de rodadas (`marcasDeRodadas` do adaptador): A · B · C, uma tentativa por rodada.
      rodadas: deRodadas(t.satisfiesRaw, codigo.marcasDeRodadas),
      // Marcas do `satisfies`: a conferência do operador (T14) casa por elas com o adaptador.
      marcas: marcasDo(t.satisfiesRaw),
      publicacao: codigo.publicacao.filter((p) => texto.includes(p)),
      clinica: outputs.filter((o) => casaAlgum(o, codigo.caminhosClinicos)),
      tier: tierDaFase.get(t.phase) ?? TIER_PADRAO,
    };
    const tierDaTask = tierDeclarado(t.bullets.get("Tier"));
    if (tierDaTask && !TIERS.includes(tierDaTask)) invalidasDeTier.push({ campo: "Tier", valor: tierDaTask, task: t.id });
    else if (tierDaTask) task.tier = tierDaTask;
    lista.push(task);
  }
  const rebaixadas = lista.filter(
    (task, i) =>
      task.fechamento &&
      !FECHAMENTO_DE_FASE_RE.test(tasks[i].satisfiesRaw) &&
      lista.some((o) => o.fase === task.fase && o.deps.includes(task.id)),
  );
  for (const task of rebaixadas) task.fechamento = false;
  // Fase que ficaria sem fechamento nenhum guarda o último review-gate: plano
  // torto segue dando `sem-saida` alto, como antes, em vez de nunca encerrar.
  for (const fase of new Set(rebaixadas.map((t) => t.fase)))
    if (!lista.some((t) => t.fase === fase && t.fechamento)) rebaixadas.findLast((t) => t.fase === fase).fechamento = true;
  for (const task of lista) task.classe = classificar(task);
  const plano = {
    ciclo,
    invalidas: [...decl.invalidas, ...invalidasDeTier],
    largura: larguraDeclarada ? decl.largura : BOTOES.larguraPadrao,
    larguraDeclarada,
    fases: phases.map((f) => ({
      id: f.id,
      modelo: f.model,
      tier: tierDaFase.get(f.id) ?? TIER_PADRAO,
      tasks: lista.filter((t) => t.fase === f.id).map((t) => t.id),
    })),
    tasks: lista,
    porId: new Map(lista.map((t) => [t.id, t])),
  };
  // O código que leu o plano viaja com ele, fora da enumeração (não entra em
  // JSON nem em comparação): quem compara dois planos lê as telas dele.
  Object.defineProperty(plano, "codigo", { value: codigo });
  return plano;
}

/** Código do adaptador que leu o plano; plano montado à mão cai no da árvore do núcleo. */
export function codigoDoPlano(plano) {
  return plano?.codigo ?? codigoDoNucleo();
}

/** Caminho do plano vivo do ciclo na árvore de um commit, onde o adaptador diz (`plano.raiz`/`plano.casa`). */
export function caminhoDoCanonico(repo, commit, ciclo, codigo = codigoDoAdaptador(repo)) {
  const arquivos = git(repo, ["ls-tree", "-r", "--name-only", commit, "--", codigo.plano.raiz]).split("\n");
  const hits = arquivos.filter((p) => p && codigo.plano.casa(p, ciclo));
  if (hits.length !== 1)
    throw new ErroPlano(
      "canonico-ausente",
      `${hits.length} canonico(s) de ${ciclo} em ${commit} (esperado 1)`,
    );
  return hits[0];
}

/** Plano de um commit: caminho, blob e o plano parseado. */
export function lerPlanoNoCommit(repo, commit, ciclo) {
  const codigo = codigoDoAdaptador(repo);
  const caminho = caminhoDoCanonico(repo, commit, ciclo, codigo);
  const blob = git(repo, ["rev-parse", `${commit}:${caminho}`]).trim();
  const texto = git(repo, ["show", `${commit}:${caminho}`]);
  const plano = lerPlano(texto, codigo);
  // Ausente cai na leitura conservadora (T5); declarado fora do vocabulário
  // não: `Workstation` lido como `servidor` abriria filha onde a task não roda.
  if (plano.invalidas.length)
    throw new ErroPlano(
      "declaracao-invalida",
      plano.invalidas.map((d) => `${d.task ?? "§1.5"} ${d.campo}: ${d.valor}`).join(" · "),
    );
  if (plano.ciclo && plano.ciclo !== ciclo)
    throw new ErroPlano("ciclo-divergente", `canonico declara cycle: ${plano.ciclo}, pedido ${ciclo}`);
  return { caminho, blob, plano };
}

/**
 * Plano congelado na marca de autorização: lido do commit da marca e
 * conferido contra o blob do trailer `Conducao-Plano`. Marca sem trailer ou
 * com blob diferente do da própria árvore não autoriza plano nenhum.
 */
export function lerPlanoCongelado(repo, ciclo, marca) {
  if (!marca.plano)
    throw new ErroPlano("marca-sem-plano", `autorização de ${marca.fase} (${marca.sha}) sem trailer Conducao-Plano`);
  const lido = lerPlanoNoCommit(repo, marca.sha, ciclo);
  if (lido.blob !== marca.plano)
    throw new ErroPlano(
      "plano-divergente",
      `autorização de ${marca.fase} (${marca.sha}) grava Conducao-Plano ${marca.plano}, a árvore dela tem ${lido.blob}`,
    );
  return lido;
}

/** Tasks que mudaram de classe entre dois planos (inclui as que nasceram ou sumiram). */
export function tasksQueMudaramDeClasse(antigo, novo) {
  const ids = [...new Set([...antigo.porId.keys(), ...novo.porId.keys()])];
  const out = [];
  for (const id of ids) {
    const de = antigo.porId.get(id)?.classe ?? null;
    const para = novo.porId.get(id)?.classe ?? null;
    if (de !== para) out.push({ task: id, de, para });
  }
  return out;
}
