/**
 * marcas.mjs — dono único da gramática das marcas da condução no git (VEGA-29 T5).
 *
 * Uma marca é um commit cujo SUBJECT inteiro casa uma regex de `RE`; o corpo
 * não conta (o `--grep` do git só filtra candidatos). Daqui leem o
 * `conducao.mjs`, o `git-conducao.mjs` e os hooks `operaria-stop-guard.js` e
 * `conducao-nonce-guard.js`. A tabela pública é `contrato-atual.md` §Marcas
 * pelo subject e §Trailers lidos, conferida por `contrato-atual.test.mjs`.
 *
 * Uma leitura só: `lerMarcas` (ordem cronológica, `--reverse --topo-order`);
 * a autorização vigente é a última `autorizada` dessa lista.
 */
import { git } from "./git-exec.mjs";

export const RE = {
  autorizada: /^Conducao: (F\d{1,2}) autorizada$/,
  conferida: /^Conducao: (T\d{1,3}) conferida$/,
  falhou: /^Conducao: (T\d{1,3}) tentativa (\d+) falhou$/,
  revertida: /^Conducao: (T\d{1,3}) tentativa (\d+) revertida$/,
  rodada: /^Conducao: (T\d{1,3}) tentativa (\d+) rodada$/,
  carimbo: /^Conducao: (T\d{1,3}) tentativa (\d+) carimbo$/,
  recusada: /^Conducao: (T\d{1,3}) publicacao recusada$/,
  marcador: /^Conducao: abrir (T\d{1,3}) tentativa (\d+) nonce (\S+)$/,
  encerrada: /^Conducao: (F\d{1,2}|ciclo) sessao encerrada$/,
};

/** Nonce de ação da maestra: 16 hex, a saída de `nonce()` em `conducao.mjs`. Global: use com `matchAll`. */
export const NONCE_RE = /\b[0-9a-f]{16}\b/g;

/** Trailers `Chave: valor` de um bloco; com chave repetida, o primeiro vence. */
export function trailers(bloco) {
  const out = {};
  for (const l of bloco.split("\n")) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(l.trim());
    if (m && !(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/** `subject` é o marcador da tentativa de `task` com `nonce` (qualquer tentativa). */
export function ehMarcadorDe(subject, task, nonce) {
  const m = RE.marcador.exec(subject ?? "");
  return !!m && m[1] === task && m[3] === nonce;
}

/**
 * Marcas de uma saída de `git log --format=%H%x1f%s%x1f%(trailers:only=true,unfold=true)%x1e`,
 * na ordem da saída. Sem git: o teste de tabela entra por aqui.
 */
export function marcasDoLog(bruto) {
  const marcas = [];
  for (const reg of bruto.split("\x1e")) {
    const [sha, subject, bloco = ""] = reg.replace(/^\n/, "").split("\x1f");
    if (!sha || !subject) continue;
    const tr = trailers(bloco);
    let m;
    if ((m = RE.autorizada.exec(subject)))
      marcas.push({
        tipo: "autorizada",
        sha,
        fase: m[1],
        plano: tr["Conducao-Plano"] ?? null,
        // Autorização herdada por re-plano de ruling (F4.17): aponta a marca com o sim do operador.
        herdada: tr["Conducao-Herdada"] ?? null,
        // `autorizar-ciclo`: o sim do operador vale para as fases seguintes (ruling de 27/10/2026).
        ciclo: tr["Conducao-Ciclo"] === "sim",
      });
    else if ((m = RE.conferida.exec(subject))) marcas.push({ tipo: "conferida", sha, task: m[1], trailers: tr });
    else if ((m = RE.falhou.exec(subject)))
      marcas.push({
        tipo: "falhou",
        sha,
        task: m[1],
        tentativa: Number(m[2]),
        // Não conta no teto: queda coberta por reinício (T12) ou falha de ambiente (P7 do ATRM-51).
        coberta: tr["coberta-por-reinicio"] === "sim" || tr["Conducao-Falha-Ambiente"] === "sim",
        ambiente: tr["Conducao-Falha-Ambiente"] === "sim",
        trailers: tr,
      });
    else if ((m = RE.revertida.exec(subject))) marcas.push({ tipo: "revertida", sha, task: m[1], tentativa: Number(m[2]), trailers: tr });
    // Pelo subject, como `falhou`: só a maestra escreve marca (o `trazer` recusa faixa com marca).
    else if ((m = RE.rodada.exec(subject)))
      marcas.push({ tipo: "rodada", sha, task: m[1], tentativa: Number(m[2]), rodada: tr["Conducao-Rodada"], trailers: tr });
    // Tentativa que só trouxe carimbo (`--rodada carimbo`): encerra como a rodada, sem contar como uma.
    else if ((m = RE.carimbo.exec(subject))) marcas.push({ tipo: "carimbo", sha, task: m[1], tentativa: Number(m[2]), trailers: tr });
    else if ((m = RE.recusada.exec(subject))) marcas.push({ tipo: "recusada", sha, task: m[1] });
    else if ((m = RE.marcador.exec(subject))) marcas.push({ tipo: "marcador", sha, task: m[1], tentativa: Number(m[2]), nonce: m[3] });
    else if ((m = RE.encerrada.exec(subject)) && tr["Conducao-Encerrada"] === m[1])
      marcas.push({ tipo: "encerrada", sha, fase: m[1], nonce: tr["Conducao-Nonce"] ?? null });
  }
  return marcas;
}

/**
 * Marcas da condução no histórico de `ref`, em ordem cronológica. Commit com o
 * subject de uma task NUNCA é prova de "feita" (§2.2#24): uma task tem vários
 * commits, e feita é só o commit de conferência da maestra.
 */
export function lerMarcas(repo, ref = "HEAD") {
  return marcasDoLog(
    git(repo, [
      "log",
      "--reverse",
      "--topo-order",
      "--extended-regexp",
      "--grep=^Conducao: ",
      "--format=%H%x1f%s%x1f%(trailers:only=true,unfold=true)%x1e",
      ref,
    ]),
  );
}

/** A autorização vigente: a última `autorizada` de `marcas` (de `lerMarcas`), ou `null`. */
export function ultimaAutorizacao(marcas) {
  const a = marcas.findLast((m) => m.tipo === "autorizada");
  return a ? { tipo: "autorizada", sha: a.sha, fase: a.fase, plano: a.plano || null } : null;
}
