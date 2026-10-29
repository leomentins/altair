/**
 * superpowers.mjs — o adaptador embutido do formato público de plano (VEGA-29 T21).
 *
 * Lê o plano que o `writing-plans` do superpowers escreve (o Deneb: `docs/planos/`;
 * o padrão do plugin: `docs/superpowers/plans/`), um arquivo por ciclo, com o id do
 * ciclo igual ao nome do arquivo sem `.md`. É a única exceção à regra de que o código
 * do adaptador mora em `<repo>/.altair/` (a restrição do plano): o formato é público, então o
 * leitor viaja com o núcleo. Mesma forma do código de qualquer adaptador, conferida por
 * `validarCodigo` (`adaptador.mjs`).
 *
 * O formato, fora de bloco de código:
 *
 *   **Fase:** F<n>                  — no topo, OPCIONAL (default F1): o arquivo é uma fase
 *   **Modelo:** <texto>             — no topo, OPCIONAL: o modelo da fase
 *   **Largura do ciclo:** <n>       — no topo, OPCIONAL: ausente cai no padrão do núcleo
 *   ### Tarefa <n>: <título>        — a tarefa `T<n>` (`### Task <n>:` também)
 *   **Arquivos:** / **Files:**      — a lista `- Criar|Modificar|Teste: \`caminho\`` vira os Outputs
 *   - [ ] **Passo <k>: …**          — os passos (Steps)
 *
 * e as anotações da tarefa, uma por linha, entre o título e o primeiro passo:
 *
 *   **Estação:** servidor | workstation | maestra   — OBRIGATÓRIA
 *   **Publicação:** sim | não                       — OBRIGATÓRIA
 *   **Sensível:** sim | não                         — OBRIGATÓRIA
 *   **Verificação:** `<comando>`                    — o único comando que a conferência roda
 *   **Marcas:** <marca>, …                          — as marcas do núcleo
 *                                                     (`fechamento-de-fase`, `conferencia-do-operador`)
 *   **Independente:** sim · **Prazo:** <n> min · **Verificação pós-merge:** sim
 *   **Commit:** <subject>                           — OPCIONAL: sem ela, o `-m "…"` do `git commit`
 *
 * Nada é adivinhado: estação, publicação e sensibilidade vêm só da anotação, nunca do
 * texto (o passo que diz `db push` ou "o operador abre no celular" não muda nada). Tarefa
 * sem uma das três, ou com valor fora do vocabulário, sai com o campo nulo e entra em
 * `declaracoes.invalidas` como a perguntar — e o núcleo, ao ler o plano para pedir o
 * sim, pergunta (`declaracao-invalida`) em vez de abrir filha. Verificação e commit
 * só explícitos, fechamento de fase só pela marca. Vai a perguntar também o plano que
 * sumiria em silêncio: sem tarefa, heading de tarefa fora do formato, numeração com
 * buraco, cerca de código aberta até o fim, anotação repetida ou depois do primeiro passo.
 *
 * O núcleo lê publicação nos trechos de `publicacao` dentro do texto da tarefa, e
 * sensibilidade nos Outputs que casam `caminhosClinicos`. A anotação vira um token
 * próprio em cada lado (`MARCA_PUBLICACAO` num campo, `MARCA_SENSIVEL` nos Outputs),
 * que nenhum caminho de arquivo casa: a regra do núcleo segue a mesma.
 *
 * O brief da operária é este arquivo como CLI: `node superpowers.mjs brief --plano
 * <arquivo> T<n> --nonce <x> --ref <ref>` — o contrato da operária (o mesmo modelo
 * do `task-brief.mjs`) à frente do bloco da tarefa, verbatim, e das seções
 * "Restrições globais" e "Foco de revisão" do plano.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESTE = fileURLToPath(import.meta.url);
const CONTRATO_OPERARIA = path.resolve(path.dirname(ESTE), "..", "..", "..", "skills", "conducao", "references", "brief-operaria.md");

export const MARCA_PUBLICACAO = "altair:publicacao";
export const MARCA_SENSIVEL = "altair:sensivel";
export const A_PERGUNTAR = "sem anotação — a perguntar";

const ESTACOES = Object.freeze(["servidor", "workstation", "maestra"]);
const OBRIGATORIAS = Object.freeze(["Estação", "Publicação", "Sensível"]);
const PASTAS = Object.freeze(["docs/planos/", "docs/superpowers/plans/"]);

const CERCA_RE = /^\s*(`{3,}|~{3,})/;
const TAREFA_RE = /^###\s+(?:Tarefa|Task)\s+(\d{1,3})(?:\s*[:—–-]\s*(.*?))?\s*$/;
/** Heading que parece tarefa: o que não casa `TAREFA_RE` vai a perguntar, nunca some. */
const PARECE_TAREFA_RE = /^#{1,6}\s*(?:Tarefa|Task)\b/i;
const SECAO_RE = /^#{1,3}\s/;
const ANOTACAO_RE = /^\s*(?:[-*]\s+)?\*\*([^*:]+):\*\*\s*(.*?)\s*$/;
const ARQUIVO_RE = /^\s*[-*]\s+[^:`]+:\s*(.*)$/;
const PASSO_RE = /^\s*[-*]\s+\[[ xX]\]\s+\*\*(?:Passo|Step)\b/;
const COMMIT_RE = /\bgit\s+commit\b[^\n]*?\s-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;
const PRAZO_RE = /^([1-9]\d*) min$/;
const LARGURA_RE = /^[1-9]\d*$/;
const FASE_RE = /^F\d{1,2}$/;
const MARCA_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Valor da anotação: sem crase e sem ponto final; o que vier depois de ` — ` é motivo,
 * mas só fora da crase (`\`echo a — b\`` fica inteiro).
 */
function valor(bruto) {
  const s = String(bruto ?? "").trim();
  const crase = /^`([^`]*)`(?:\s+—\s+.*)?\.?$/.exec(s);
  if (crase) return crase[1].trim();
  return s.replace(/\s+—\s+.*$/, "").replace(/\.$/, "").trim();
}

/** As chaves de anotação que o adaptador lê; `Estacao` e `estação` são `Estação`. */
const CHAVES = Object.freeze(["Estação", "Publicação", "Sensível", "Verificação", "Verificação pós-merge", "Marcas", "Independente", "Prazo", "Commit", "Arquivos", "Files"]);
const semAcento = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const PELA_FORMA = new Map(CHAVES.map((c) => [semAcento(c), c]));
function chave(campo) {
  return PELA_FORMA.get(semAcento(campo)) ?? null;
}

/** `sim`/`não` (com ou sem acento); qualquer outro valor ⇒ `undefined`. */
function simOuNao(v) {
  const x = v.toLowerCase();
  if (x === "sim") return true;
  if (x === "não" || x === "nao") return false;
  return undefined;
}

/**
 * Linhas com a marca de dentro-de-bloco-de-código; a cerca conta como dentro. A cerca
 * fecha só com o mesmo caractere e pelo menos o mesmo comprimento (CommonMark);
 * `cercaAberta` diz que o arquivo acabou dentro de um bloco.
 */
function linhasDo(texto) {
  let aberta = null;
  const L = String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((linha) => {
      const m = CERCA_RE.exec(linha);
      if (aberta) {
        if (m && m[1][0] === aberta[0] && m[1].length >= aberta.length && linha.trim() === m[1]) aberta = null;
        return { linha, codigo: true };
      }
      if (m) aberta = m[1];
      return { linha, codigo: Boolean(m) };
    });
  L.cercaAberta = aberta !== null;
  return L;
}

/** Caminhos entre crases, sem a faixa de linhas (`src/app.ts:12-30` ⇒ `src/app.ts`). */
function caminhos(texto) {
  return [...texto.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim().replace(/:\d+(?:-\d+)?$/, "")).filter((c) => c && !/\s/.test(c));
}

/** Topo, blocos de tarefa (linhas `[inicio, fim)`) e seções `##` do plano. */
function recortar(L) {
  const tarefas = [];
  const secoes = new Map();
  let aberta = null;
  let secao = null;
  for (const [i, { linha, codigo }] of L.entries()) {
    if (codigo || !SECAO_RE.test(linha)) continue;
    if (aberta) {
      aberta.fim = i;
      aberta = null;
    }
    const t = TAREFA_RE.exec(linha);
    if (secao && (t || /^#{1,2}\s/.test(linha))) {
      secao.fim = i;
      secao = null;
    }
    if (t) {
      aberta = { id: `T${Number(t[1])}`, titulo: t[2] ?? "", inicio: i, fim: L.length };
      tarefas.push(aberta);
    } else if (/^##\s/.test(linha)) {
      secao = { inicio: i, fim: L.length };
      secoes.set(linha.replace(/^##\s+/, "").trim(), secao);
    }
  }
  const topo = tarefas.length ? tarefas[0].inicio : L.length;
  return { topo, tarefas, secoes };
}

/** Anotações do topo: tudo antes da primeira tarefa, também sob um `## Contexto`. */
function lerTopo(L, fim) {
  const topo = new Map();
  for (const { linha, codigo } of L.slice(0, fim)) {
    if (codigo) continue;
    const a = ANOTACAO_RE.exec(linha);
    const campo = a && ({ fase: "Fase", modelo: "Modelo", "largura do ciclo": "Largura do ciclo" })[semAcento(a[1])];
    if (campo && !topo.has(campo)) topo.set(campo, valor(a[2]));
  }
  return topo;
}

/** Uma tarefa: anotações, arquivos, passos e o subject do commit. */
function lerTarefa(L, t) {
  const anotacoes = new Map();
  const problemas = [];
  const arquivos = [];
  const passos = [];
  let commit = null;
  let naLista = false;
  let nosPassos = false;
  for (const { linha, codigo } of L.slice(t.inicio + 1, t.fim)) {
    if (codigo) {
      naLista = false;
      if (!commit) {
        const m = COMMIT_RE.exec(linha);
        if (m) commit = (m[1] ?? m[2]).replace(/\\(.)/g, "$1");
      }
      continue;
    }
    if (PASSO_RE.test(linha)) {
      naLista = false;
      nosPassos = true;
      passos.push(linha.trim());
      continue;
    }
    if (naLista && /^\s*[-*]\s+/.test(linha)) {
      const m = ARQUIVO_RE.exec(linha.replaceAll("**", ""));
      if (m) {
        arquivos.push(...caminhos(m[1]));
        continue;
      }
    }
    const a = ANOTACAO_RE.exec(linha);
    const campo = a ? chave(a[1]) : null;
    // Anotação só antes do primeiro passo: depois dele, chave conhecida vai a perguntar
    // (o `**Esperado:**` do corpo de um passo não é chave, e segue sendo texto).
    if (campo && nosPassos) {
      problemas.push({ campo, valor: "depois do primeiro passo" });
      continue;
    }
    if (a && !nosPassos) {
      naLista = campo === "Arquivos" || campo === "Files";
      if (campo && !naLista) {
        if (anotacoes.has(campo)) problemas.push({ campo, valor: "repetida" });
        else anotacoes.set(campo, campo === "Commit" ? a[2].replace(/^`([^`]*)`$/, "$1").trim() : valor(a[2]));
      }
      continue;
    }
    if (naLista) {
      const m = ARQUIVO_RE.exec(linha);
      if (m) arquivos.push(...caminhos(m[1]));
      else if (linha.trim()) naLista = false;
    }
  }
  return { anotacoes, problemas, arquivos: [...new Set(arquivos)], passos, commit: anotacoes.get("Commit") || commit };
}

/**
 * Parse do plano no formato público: o mesmo contrato de `plano.ler` de qualquer adaptador
 * (`{ ciclo, fases, tasks, declaracoes }`), mais `declaracoes.anotacoes` (estação,
 * publicação e sensibilidade de cada tarefa, `null` quando faltam) e
 * `declaracoes.aPerguntar` (as tarefas que o núcleo pergunta antes do sim).
 */
export function lerPlanoPublico(texto) {
  const L = linhasDo(texto);
  const { topo: fimDoTopo, tarefas } = recortar(L);
  const topo = lerTopo(L, fimDoTopo);
  const invalidas = [];
  const ausentes = [];

  if (L.cercaAberta) invalidas.push({ campo: "Bloco de código", valor: "cerca aberta até o fim do arquivo — a perguntar" });
  for (const [i, { linha, codigo }] of L.entries())
    if (!codigo && PARECE_TAREFA_RE.test(linha) && !TAREFA_RE.test(linha)) invalidas.push({ campo: "Tarefa", valor: `linha ${i + 1} fora do formato: ${linha.trim()}` });
  if (!tarefas.length) invalidas.push({ campo: "Tarefa", valor: "nenhuma tarefa no plano — a perguntar" });
  // Numeração 1..n em ordem: tarefa que um bloco de código engoliu deixa o buraco à vista.
  const furo = tarefas.findIndex((t, i) => t.id !== `T${i + 1}`);
  if (furo >= 0) invalidas.push({ campo: "Tarefa", valor: `esperada T${furo + 1}, veio ${tarefas[furo].id} — a perguntar` });

  const fase = topo.get("Fase") ?? "F1";
  if (!FASE_RE.test(fase)) invalidas.push({ campo: "Fase", valor: fase });
  let largura = 1;
  if (!topo.has("Largura do ciclo")) ausentes.push({ campo: "Largura do ciclo" });
  else if (LARGURA_RE.test(topo.get("Largura do ciclo"))) largura = Number(topo.get("Largura do ciclo"));
  else invalidas.push({ campo: "Largura do ciclo", valor: topo.get("Largura do ciclo") });

  const tasks = [];
  const porTask = new Map();
  const anotacoes = new Map();
  const aPerguntar = new Set();
  const vistos = new Set();
  for (const t of tarefas) {
    if (vistos.has(t.id)) invalidas.push({ campo: "Tarefa", valor: `${t.id} repetida`, task: t.id });
    vistos.add(t.id);
    const lida = lerTarefa(L, t);
    const a = lida.anotacoes;
    for (const p of lida.problemas) invalidas.push({ ...p, task: t.id });
    if (!a.has("Verificação")) invalidas.push({ campo: "Verificação", valor: A_PERGUNTAR, task: t.id });
    else if (a.get("Verificação").includes("`")) invalidas.push({ campo: "Verificação", valor: a.get("Verificação"), task: t.id });
    if (!lida.commit) invalidas.push({ campo: "Commit", valor: "sem **Commit:** nem `git commit -m` — a perguntar", task: t.id });
    const perguntar = (campo, v) => {
      invalidas.push({ campo, valor: v, task: t.id });
      aPerguntar.add(t.id);
    };
    for (const campo of OBRIGATORIAS)
      if (!a.has(campo)) {
        ausentes.push({ campo, task: t.id });
        perguntar(campo, A_PERGUNTAR);
      }
    const estacao = a.has("Estação") && ESTACOES.includes(a.get("Estação")) ? a.get("Estação") : null;
    if (a.has("Estação") && !estacao) perguntar("Estação", a.get("Estação"));
    const lado = (campo) => {
      if (!a.has(campo)) return null;
      const v = simOuNao(a.get(campo));
      if (v === undefined) perguntar(campo, a.get(campo));
      return v ?? null;
    };
    const publicacao = lado("Publicação");
    const sensivel = lado("Sensível");
    anotacoes.set(t.id, Object.freeze({ estacao, publicacao, sensivel }));

    const d = { estacao, independente: false, verificacaoPosMerge: false, prazoMin: null };
    const opcional = (campo, aplicar) => {
      if (!a.has(campo)) return;
      if (!aplicar(a.get(campo))) invalidas.push({ campo, valor: a.get(campo), task: t.id });
    };
    opcional("Independente", (v) => v === "sim" && (d.independente = true));
    opcional("Verificação pós-merge", (v) => v === "sim" && (d.verificacaoPosMerge = true));
    opcional("Prazo", (v) => PRAZO_RE.test(v) && (d.prazoMin = Number(PRAZO_RE.exec(v)[1])));
    if (estacao === "maestra" && /\bfechamento-de-fase\b/.test(a.get("Marcas") ?? ""))
      invalidas.push({ campo: "Estação", valor: "maestra (fechamento de fase roda pela filha)", task: t.id });
    porTask.set(t.id, d);

    const marcas = (a.get("Marcas") ?? "").split(/[\s,]+/).filter(Boolean);
    const foraDoVocabulario = marcas.filter((m) => !MARCA_RE.test(m));
    if (foraDoVocabulario.length) invalidas.push({ campo: "Marcas", valor: foraDoVocabulario.join(", "), task: t.id });
    const bullets = new Map();
    bullets.set("Outputs", [...lida.arquivos, ...(sensivel ? [MARCA_SENSIVEL] : [])].map((c) => `\`${c}\``).join(" · "));
    bullets.set("Steps", lida.passos.join("\n"));
    if (a.has("Verificação")) bullets.set("Verificação", `\`${a.get("Verificação")}\``);
    if (publicacao) bullets.set("Publicação", MARCA_PUBLICACAO);
    if (lida.commit) bullets.set("Commit", lida.commit);
    tasks.push({ id: t.id, title: t.titulo, phase: fase, bullets, satisfiesRaw: marcas.length ? `(${marcas.join(", ")})` : "" });
  }
  if (tasks.length && !tasks.some((t) => /\bfechamento-de-fase\b/.test(t.satisfiesRaw)))
    invalidas.push({ campo: "Marcas", valor: `nenhuma tarefa de ${fase} com fechamento-de-fase — a perguntar` });

  return {
    ciclo: null,
    fases: [{ id: fase, model: topo.get("Modelo") ?? null }],
    tasks,
    declaracoes: { largura, porTask, invalidas, ausentes, anotacoes, aPerguntar: [...aPerguntar] },
  };
}

/** O plano do ciclo: `docs/planos/<ciclo>.md` ou `docs/superpowers/plans/<ciclo>.md`. */
function casa(caminho, ciclo) {
  return PASTAS.some((p) => caminho === `${p}${ciclo}.md`);
}

// ── brief da operária ────────────────────────────────────────────────────────

/** O contrato da operária do modelo, com os campos trocados (a mesma regra do `task-brief.mjs`). */
function contrato(modelo, campos) {
  const m = String(modelo).match(/<!-- contrato:inicio -->\r?\n([\s\S]*?)<!-- contrato:fim -->/);
  if (!m) throw new Error("contrato da operaria sem os marcadores <!-- contrato:inicio --> / <!-- contrato:fim -->");
  for (const k of ["task", "nonce", "ref", "commit", "ciclo"])
    if (!campos[k] || (k !== "commit" && /\s/.test(campos[k]))) throw new Error(`contrato da operaria: campo ${k} ausente ou com espaco`);
  const texto = m[1]
    .replaceAll("{{TASK}}", () => campos.task)
    .replaceAll("{{NONCE}}", () => campos.nonce)
    .replaceAll("{{REF}}", () => campos.ref)
    .replaceAll("{{COMMIT}}", () => campos.commit)
    .replaceAll("{{CICLO}}", () => campos.ciclo)
    .replaceAll("{{AVISO}}", () => campos.ref.replace(/^refs\/conducao\//, "refs/conducao-aviso/"))
    .replace(/\s+$/, "");
  const sobra = texto.match(/\{\{[^}]*\}\}/);
  if (sobra) throw new Error(`contrato da operaria: campo ${sobra[0]} sem valor`);
  return texto;
}

/** Brief da tarefa `task` do plano em `arquivo`: contrato, bloco verbatim e as seções globais. */
export function montarBrief(arquivo, task, { nonce, ref, modelo = readFileSync(CONTRATO_OPERARIA, "utf8") }) {
  const texto = readFileSync(arquivo, "utf8");
  const L = linhasDo(texto);
  const { tarefas, secoes } = recortar(L);
  const t = tarefas.find((x) => x.id === task);
  if (!t) throw new Error(`${task} não está em ${arquivo}`);
  if (!new RegExp(`/${task}/\\d+$`).test(ref)) throw new Error(`--ref ${ref} nao e de ${task}`);
  const { commit } = lerTarefa(L, t);
  if (!commit) throw new Error(`${task} sem **Commit:** nem \`git commit -m\` no bloco — a operaria nao tem subject para commitar`);
  const ciclo = path.basename(arquivo, ".md");
  const corte = (ini, fim) => L.slice(ini, fim).map((x) => x.linha).join("\n").replace(/\s+$/, "");
  const out = [
    `# brief · ${task} · ${arquivo}`,
    "",
    contrato(modelo, { task, nonce, ref, commit, ciclo }),
    "",
    `## tarefa (linhas ${t.inicio + 1}–${t.fim})`,
    corte(t.inicio, t.fim),
  ];
  for (const nome of ["Restrições globais", "Foco de revisão"]) {
    const s = [...secoes].find(([titulo]) => titulo.startsWith(nome))?.[1];
    if (s) out.push("", corte(s.inicio, s.fim));
  }
  return `${out.join("\n")}\n`;
}

function principal(args) {
  const [verbo, ...resto] = args;
  const flags = {};
  const posicionais = [];
  for (let i = 0; i < resto.length; i++) {
    if (["--plano", "--nonce", "--ref"].includes(resto[i])) flags[resto[i].slice(2)] = resto[++i];
    else posicionais.push(resto[i]);
  }
  if (verbo !== "brief" || !flags.plano || !flags.nonce || !flags.ref || posicionais.length !== 1) {
    process.stderr.write("uso: superpowers.mjs brief --plano <arquivo> T<n> --nonce <x> --ref refs/conducao/<ciclo>/T<n>/<k>\n");
    return 2;
  }
  try {
    process.stdout.write(montarBrief(flags.plano, posicionais[0], flags));
    return 0;
  } catch (e) {
    process.stderr.write(`superpowers: ${e.message}\n`);
    return 2;
  }
}

export default Object.freeze({
  plano: Object.freeze({
    /** Onde o núcleo procura o plano (`git ls-tree` a partir daqui). */
    raiz: "docs",
    casa,
    ler: lerPlanoPublico,
    /** Comando do brief da operária (`node <args>`): este arquivo como CLI. */
    brief: ({ canonico, task, nonce, ref }) => [ESTE, "brief", "--plano", canonico, task, "--nonce", nonce, "--ref", ref],
  }),
  /** Publicação só pela anotação: o token que `**Publicação:** sim` grava na tarefa. */
  publicacao: Object.freeze([MARCA_PUBLICACAO]),
  /** Sensibilidade só pela anotação: o token que `**Sensível:** sim` põe nos Outputs. */
  caminhosClinicos: Object.freeze([MARCA_SENSIVEL]),
  telasClinicasDosSteps: Object.freeze([]),
  foraDasTelasDosSteps: Object.freeze([]),
  /** O formato público não traz carimbo de revisão nem CI da proposta. */
  carimbo: null,
  ci: null,
  marcasDeRodadas: Object.freeze([]),
});

function souACli() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(ESTE);
  } catch {
    return false;
  }
}

if (souACli()) process.exitCode = principal(process.argv.slice(2));
