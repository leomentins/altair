#!/usr/bin/env node
/**
 * brief-canonico.mjs — o brief da operária do projeto de teste, como CLI.
 *
 *   node brief-canonico.mjs --canonico <arquivo> T<k> --operaria --nonce <x> --ref refs/conducao/<ciclo>/T<k>/<n>
 *
 * Saída: o cabeçalho `# brief · T<k> · …`, o contrato da operária do plugin
 * (`skills/conducao/references/brief-operaria.md`, campos trocados) e o recorte
 * da fase e da tarefa, verbatim. Exit 2 com o motivo no stderr quando a tarefa,
 * o commit, o ciclo ou o contrato faltam.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESTE = fileURLToPath(import.meta.url);
const RAIZ_DO_PLUGIN = path.resolve(path.dirname(ESTE), "..", "..", "..", "..", "..", "..");
export const CONTRATO_OPERARIA = path.join(RAIZ_DO_PLUGIN, "skills", "conducao", "references", "brief-operaria.md");

/** Contrato da operária do modelo, com os campos trocados; `{ ok:false, erro }` quando falta algo. */
export function contratoDaOperaria(modelo, campos) {
  const m = String(modelo ?? "").match(/<!-- contrato:inicio -->\r?\n([\s\S]*?)<!-- contrato:fim -->/);
  if (!m) return { ok: false, erro: "contrato da operaria sem os marcadores <!-- contrato:inicio --> / <!-- contrato:fim -->" };
  for (const k of ["task", "nonce", "ref", "commit", "ciclo"])
    if (!campos?.[k] || (k !== "commit" && /\s/.test(campos[k]))) return { ok: false, erro: `contrato da operaria: campo ${k} ausente ou com espaco` };
  const texto = m[1]
    .replaceAll("{{TASK}}", () => campos.task)
    .replaceAll("{{NONCE}}", () => campos.nonce)
    .replaceAll("{{REF}}", () => campos.ref)
    .replaceAll("{{COMMIT}}", () => campos.commit)
    .replaceAll("{{CICLO}}", () => campos.ciclo)
    .replaceAll("{{AVISO}}", () => campos.ref.replace(/^refs\/conducao\//, "refs/conducao-aviso/"))
    .replace(/\s+$/, "");
  const sobra = texto.match(/\{\{[^}]*\}\}/);
  if (sobra) return { ok: false, erro: `contrato da operaria: campo ${sobra[0]} sem valor` };
  return { ok: true, texto };
}

const fimDaFaixa = (L, inicio, re) => {
  for (let i = inicio; i < L.length; i++) if (re.test(L[i])) return i;
  return L.length;
};

/** Monta o brief a partir do texto do plano. Puro. */
export function montarBrief(texto, task, { origem = "canonico.md", operaria }) {
  const id = String(task || "").toUpperCase();
  if (!/^T\d+$/.test(id)) return { ok: false, erro: `task invalida: ${JSON.stringify(task)}` };
  const L = texto.split(/\r?\n/);
  const iTask = L.findIndex((l) => new RegExp(`^#### ${id}(?!\\d)\\b`).test(l));
  if (iTask < 0) return { ok: false, erro: `${id} nao existe em ${origem}` };
  const fTask = fimDaFaixa(L, iTask + 1, /^#{1,4} /);
  const bloco = L.slice(iTask, fTask);
  while (bloco.length && !bloco.at(-1).trim()) bloco.pop();
  let iFase = -1;
  for (let i = iTask; i >= 0; i--)
    if (/^### /.test(L[i])) {
      iFase = i;
      break;
    }
  const commit = bloco.join("\n").match(/\*\*Commit:\*\*\s*`([^`]+)`/)?.[1] ?? null;
  const ciclo = texto.match(/^cycle:\s*(\S+)/m)?.[1] ?? null;
  if (!commit) return { ok: false, erro: `${id} sem **Commit:** no bloco` };
  if (!ciclo) return { ok: false, erro: `${origem} sem 'cycle:' no frontmatter` };
  const c = contratoDaOperaria(operaria.modelo, { task: id, nonce: operaria.nonce, ref: operaria.ref, commit, ciclo });
  if (!c.ok) return c;
  const out = [
    `# brief · ${id} · ${origem} · bloco nas linhas ${iTask + 1}–${fTask} de ${L.length}`,
    "> Recorte VERBATIM do plano. O plano segue sendo o arquivo; isto e so o que esta task cita.",
    "",
    c.texto,
    "",
    "## fase",
    iFase >= 0 ? L[iFase] : "(task fora de heading de fase)",
    "",
    `## task (linhas ${iTask + 1}–${fTask})`,
    ...bloco,
  ];
  return { ok: true, texto: out.join("\n") };
}

function principal(args) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--operaria") flags.operaria = true;
    else if (["--canonico", "--nonce", "--ref"].includes(args[i])) flags[args[i].slice(2)] = args[++i];
    else pos.push(args[i]);
  }
  if (!flags.canonico || !flags.operaria || !flags.nonce || !flags.ref || pos.length !== 1) {
    process.stderr.write("uso: brief-canonico.mjs --canonico <arquivo> T<k> --operaria --nonce <x> --ref refs/conducao/<ciclo>/T<k>/<n>\n");
    return 2;
  }
  if (!/^refs\/conducao\/[^\s/]+\/T\d+\/\d+$/.test(flags.ref) || !new RegExp(`/${pos[0].toUpperCase()}/\\d+$`).test(flags.ref)) {
    process.stderr.write(`--ref fora da forma ou de outra task: ${flags.ref}\n`);
    return 2;
  }
  let modelo;
  try {
    modelo = readFileSync(CONTRATO_OPERARIA, "utf8");
  } catch (e) {
    process.stderr.write(`contrato da operaria ilegivel em ${CONTRATO_OPERARIA}: ${e.code || e.message}\n`);
    return 2;
  }
  let texto;
  try {
    texto = readFileSync(flags.canonico, "utf8");
  } catch (e) {
    process.stderr.write(`plano ilegivel: ${flags.canonico} (${e.code || e.message})\n`);
    return 2;
  }
  const r = montarBrief(texto, pos[0], { origem: flags.canonico.replace(/\\/g, "/"), operaria: { nonce: flags.nonce, ref: flags.ref, modelo } });
  if (!r.ok) {
    process.stderr.write(`${r.erro}\n`);
    return 2;
  }
  process.stdout.write(`${r.texto}\n`);
  return 0;
}

function souACli() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(ESTE);
  } catch {
    return false;
  }
}

if (souACli()) process.exitCode = principal(process.argv.slice(2));
