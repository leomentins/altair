/**
 * leitor-canonico.mjs — o leitor do plano do projeto de teste (formato "canonico").
 *
 * O projeto de teste das suítes escreve o plano num markdown com frontmatter
 * (`cycle:`, `opened:`), seção numerada `## 3.` com as fases (`### F<n> — … (**Modelo:** x)`)
 * e as tarefas (`#### T<k> — …`) como bullets `- **Rótulo:** valor`, e as declarações
 * da condução: `**Largura do ciclo:**` em `### 1.5`, e por tarefa `**Estação:**`,
 * `**Independente:**`, `**Prazo:**` e `**Verificação pós-merge:**`.
 *
 * Saída na forma que o núcleo lê (`ler-plano.mjs`): `{ ciclo, fases, tasks, declaracoes }`.
 * É código do projeto, não do núcleo: o núcleo o carrega pelo `codigo` da declaração.
 */

/** Rótulos que podem vir colados no valor de `Verificação` (`… → **Esperado:** …`). */
export const REQUIRED_TASK_BULLETS = Object.freeze([
  "Objetivo",
  "satisfies",
  "Inputs",
  "Outputs",
  "Steps",
  "Verificação",
  "Esperado",
  "Falha-se",
  "Commit",
]);

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
/** Único rótulo que hospeda rótulo inline. */
const INLINE_HOST_RE = /^Verifica[cç][aã]o\b/i;
/** As formas de fecho antes do rótulo inline — nunca conector nem pontuação de frase. */
const INLINE_SEP_RE = /[→.`—]\s*$/;
/** Substância do valor: rótulo sem letra/dígito depois é citação, não declaração. */
const INLINE_VALOR_RE = /[\p{L}\p{N}]/u;
const INLINE_BULLET_RE = new RegExp(`\\*\\*(${REQUIRED_TASK_BULLETS.map((b) => b.replace(ESCAPE_RE, "\\$&")).join("|")}):?\\*\\*:?`, "g");

/** Rótulos de um bloco de task → Map(label → valor); a primeira ocorrência vence. */
export function collectTaskBullets(body) {
  const bullets = new Map();
  for (const l of body) {
    const mb = /^\s*-\s+\*\*([^:*]+):?\*\*:?\s*(.*)$/.exec(l);
    if (!mb) continue;
    const rest = mb[2];
    let label = mb[1].trim().replace(/:$/, "");
    let cursor = 0;
    const segmentos = [];
    if (INLINE_HOST_RE.test(label)) {
      INLINE_BULLET_RE.lastIndex = 0;
      const hits = [];
      let m;
      while ((m = INLINE_BULLET_RE.exec(rest)) !== null) hits.push({ label: m[1].trim(), from: m.index, to: m.index + m[0].length });
      for (const [k, h] of hits.entries()) {
        const antes = rest.slice(cursor, h.from);
        if (!INLINE_SEP_RE.test(antes)) continue;
        const fim = hits[k + 1]?.from ?? rest.length;
        const valor = rest.slice(h.to, fim);
        const quebraDeLinha = fim === rest.length && valor.trim() === "";
        if (!quebraDeLinha && !INLINE_VALOR_RE.test(valor)) continue;
        segmentos.push([label, antes]);
        label = h.label;
        cursor = h.to;
      }
    }
    segmentos.push([label, rest.slice(cursor)]);
    for (const [k, v] of segmentos) if (!bullets.has(k)) bullets.set(k, v.trim());
  }
  return bullets;
}

// `2-bis` primeiro na alternação: `\d+` casaria o "2" de "2-bis.".
const SECTION_NUMBER_RE = /^(2-bis|\d+(?:\.\d+)*)\b/;

/** Headings fora de cerca de código, com número de seção quando houver. */
export function parseHeadings(text) {
  const lines = text.split(/\r?\n/);
  const heads = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    const title = m[2].trim();
    const num = SECTION_NUMBER_RE.exec(title.replace(/^#+\s*/, ""));
    heads.push({ level: m[1].length, title, line: i, number: num ? num[1] : null });
  }
  return { lines, heads };
}

/** Corpo de uma seção: do heading até o próximo heading de nível <= o dela. */
export function sectionSpan(parsed, number) {
  const { lines, heads } = parsed;
  const idx = heads.findIndex((h) => h.number === number);
  if (idx < 0) return null;
  const head = heads[idx];
  let end = lines.length;
  for (let j = idx + 1; j < heads.length; j++) {
    if (heads[j].level <= head.level) {
      end = heads[j].line;
      break;
    }
  }
  return { head, from: head.line + 1, to: end, text: lines.slice(head.line + 1, end).join("\n") };
}

/** Tasks de §3, com fase dona, bullets e satisfies. */
export function parseTasks(parsed) {
  const { lines, heads } = parsed;
  const s3 = sectionSpan(parsed, "3");
  if (!s3) return { phases: [], tasks: [] };
  const inside = heads.filter((h) => h.line > s3.head.line && h.line < s3.to);
  const phases = [];
  const tasks = [];
  let fase = null;
  for (const [i, h] of inside.entries()) {
    const mFase = /^(F\d{1,2})\s+—\s+(.*)$/.exec(h.title);
    const mTask = /^(T\d{1,3})\s+—\s+(.*)$/.exec(h.title);
    const nextLine = inside[i + 1]?.line ?? s3.to;
    if (mFase) {
      fase = {
        id: mFase[1],
        title: mFase[2],
        model: /\*\*Modelo:\*\*\s*([a-z]+)/.exec(h.title)?.[1] ?? null,
        mode: /\*\*Modo:\*\*\s*([a-z]+)/.exec(h.title)?.[1] ?? null,
        line: h.line,
      };
      phases.push(fase);
      continue;
    }
    if (!mTask) continue;
    const body = lines.slice(h.line + 1, nextLine);
    const bullets = collectTaskBullets(body);
    const satisfiesRaw = bullets.get("satisfies") ?? "";
    const satisfies = [...satisfiesRaw.matchAll(/\bAC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{1,3}\b/g)].map((m) => m[0]);
    tasks.push({ id: mTask[1], title: mTask[2], phase: fase?.id ?? null, bullets, satisfies, satisfiesRaw, line: h.line });
  }
  return { phases, tasks };
}

export const DECLARACOES_PADRAO = Object.freeze({
  largura: 1,
  estacao: "servidor",
  independente: false,
  verificacaoPosMerge: false,
  prazoMin: null, // null = prazo padrão da condução (`botoes.mjs`)
});
const ESTACOES = Object.freeze(["servidor", "workstation", "maestra"]);
// Valor da declaração, com ou sem crase; o que vier depois de ` — ` é motivo.
const DECL_VALOR_RE = /^`?([^`—]*?)`?(?:\s+—\s+.*)?\.?$/;
const LARGURA_RE = /^\*\*Largura do ciclo:\*\*\s*(.*)$/m;
const INTEIRO_POSITIVO_RE = /^[1-9]\d*$/;
const PRAZO_RE = /^([1-9]\d*) min$/;
/** Slot ainda por preencher: não conta como valor inválido. */
const SLOT_PENDENTE_RE = /^<preencher:[a-z0-9-]+>$/;

function valorDeclarado(bruto) {
  return DECL_VALOR_RE.exec(bruto.trim())?.[1].trim() ?? bruto.trim();
}

/**
 * Declarações da condução lidas do plano, com a leitura conservadora no que
 * faltar. `invalidas` lista o que foi declarado fora do vocabulário (o valor
 * cai no padrão); `ausentes`, o que não foi declarado.
 */
export function lerDeclaracoesConducao(parsed, tasks) {
  const invalidas = [];
  const ausentes = [];
  const s15 = sectionSpan(parsed, "1.5");
  const larguraBruta = s15 ? LARGURA_RE.exec(s15.text)?.[1] : undefined;
  let largura = DECLARACOES_PADRAO.largura;
  if (larguraBruta === undefined) ausentes.push({ campo: "Largura do ciclo" });
  else {
    const v = valorDeclarado(larguraBruta);
    if (INTEIRO_POSITIVO_RE.test(v)) largura = Number(v);
    else if (!SLOT_PENDENTE_RE.test(v)) invalidas.push({ campo: "Largura do ciclo", valor: v });
  }
  const porTask = new Map();
  for (const t of tasks) {
    const d = { ...DECLARACOES_PADRAO };
    delete d.largura;
    const ler = (campo, valido, aplicar) => {
      if (!t.bullets.has(campo)) return false;
      const v = valorDeclarado(t.bullets.get(campo));
      if (valido(v)) aplicar(v);
      else if (!SLOT_PENDENTE_RE.test(v)) invalidas.push({ campo, valor: v, task: t.id });
      return true;
    };
    if (!ler("Estação", (v) => ESTACOES.includes(v), (v) => (d.estacao = v))) ausentes.push({ campo: "Estação", task: t.id });
    // Fechamento de fase roda pela filha (`fechar-fase`); a maestra só empurra e lê o CI depois.
    if (d.estacao === "maestra" && /\(fechamento-de-fase\b/i.test(t.satisfiesRaw ?? ""))
      invalidas.push({ campo: "Estação", valor: "maestra (fechamento de fase roda pela filha)", task: t.id });
    ler("Independente", (v) => v === "sim", () => (d.independente = true));
    ler("Verificação pós-merge", (v) => v === "sim", () => (d.verificacaoPosMerge = true));
    ler("Prazo", (v) => PRAZO_RE.test(v), (v) => (d.prazoMin = Number(PRAZO_RE.exec(v)[1])));
    porTask.set(t.id, d);
  }
  return { largura, porTask, invalidas, ausentes };
}
