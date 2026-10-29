/**
 * git-conducao.mjs — os verbos de git da condução (VEGA-22 T10).
 *
 * A filha chega ao ciclo só por referência de tentativa, e só a maestra traz.
 * Todo verbo roda git na árvore da maestra (`--repo`), nunca na da filha; nada
 * de `reset`, `checkout --` ou `clean` sobre trabalho de filha — o que desfaz
 * trabalho trazido é `git revert`.
 *
 * Referências (§2.2#28: a do ciclo é irmã das de task, nunca prefixo delas):
 *   origin  refs/conducao/<ciclo>/T<k>/<n>        tentativa: nasce no marcador; a filha empurra por cima
 *   origin  refs/conducao/<ciclo>/copia           cópia do ramo do ciclo — só avança
 *   local   refs/conducao-local/<ciclo>/T<k>/<n>  o marcador que a maestra gravou: a única fonte do `trazer`
 *   local   refs/conducao-local/<ciclo>/copia     o último valor empurrado da cópia (o lease do próximo push)
 *   origin  refs/conducao-brief/<ciclo>/T<k>/<n>  brief da filha: commit filho do marcador (mesma árvore)
 *           cujo corpo é o brief inteiro do `task-brief.mjs --operaria` — o conteúdo chega à filha
 *           pelo git, e o prompt de nascimento é só a partida (`partidaDoBrief`). Irmã pelo mesmo
 *           motivo do aviso, e fora do ramo: o marcador e os leitores do estado não mudam
 *   origin  refs/conducao-aviso/<ciclo>/T<k>/<n>  aviso da filha: commit vazio cujo subject é a 1ª linha
 *           da resposta final; o seguinte é filho do anterior (P22 do ATRM-51). Irmã, nunca
 *           `…/T<k>/<n>/aviso`: uma referência não é arquivo e pasta ao mesmo tempo
 *   local   refs/conducao-local/<ciclo>/aviso/T<k>/<n>  o último aviso que a espera devolveu
 *   local   refs/conducao-local/<ciclo>/trazida/T<k>/<n>
 *           registro do que foi trazido (objeto de commit fora do ramo, com
 *           trailers): sustenta `conferir-carimbo`, `registrar-conferencia` e
 *           `reverter-trazido`, e impede o `proximo` de reabrir a task na
 *           janela entre trazer e conferir. Sai quando a conferência ou o
 *           revert é gravado.
 *
 * A referência do origin nunca é fonte: o `trazer` a busca só para conferir
 * que a faixa descende do marcador da referência local.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { codigoDoAdaptador, lerAdaptador, nomeDoOperador, paginaDoProjeto } from "./adaptador.mjs";
import { ENV_GIT, PRAZO_REDE_MS, git as rodar, tentarGit as tentar } from "./git-exec.mjs";
import { ErroPlano, caminhoDoCanonico, lerPlanoCongelado, lerPlanoNoCommit } from "./ler-plano.mjs";
import { RE, lerMarcas, ultimaAutorizacao } from "./marcas.mjs";
import * as verbos from "./verbos.mjs";

const { TASK_RE, SHA_PREFIXO_RE, exigir, perguntar, shaDoCherryPick } = verbos;

// A política dos verbos mora em `verbos.mjs` (VEGA-29 T8); daqui saem só os
// nomes que o CLI e os testes já importavam deste módulo.
export { lerApproval, segmentosDosSteps, TETO_RODADAS_GATE, vereditoAprova } from "./verbos.mjs";

function revOuNull(repo, ref) {
  const r = tentar(repo, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
  return r.status === 0 && r.saida ? r.saida : null;
}

/** `true` / `false` / `null` (objeto ausente — nunca lido como "não é ancestral"). */
function ancestral(repo, a, b) {
  const r = tentar(repo, ["merge-base", "--is-ancestor", a, b]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

// ── nomes ────────────────────────────────────────────────────────────────────

const FASE_RE = /^F\d{1,2}$/;
const NONCE_RE = /^[0-9A-Za-z_-]{4,64}$/;

export const refs = {
  tentativa: (ciclo, task, n) => `refs/conducao/${ciclo}/${task}/${n}`,
  tentativaLocal: (ciclo, task, n) => `refs/conducao-local/${ciclo}/${task}/${n}`,
  copia: (ciclo) => `refs/conducao/${ciclo}/copia`,
  copiaLocal: (ciclo) => `refs/conducao-local/${ciclo}/copia`,
  trazida: (ciclo, task, n) => `refs/conducao-local/${ciclo}/trazida/${task}/${n}`,
  busca: (ciclo, task, n) => `refs/conducao-busca/${ciclo}/${task}/${n}`,
  brief: (ciclo, task, n) => `refs/conducao-brief/${ciclo}/${task}/${n}`,
  aviso: (ciclo, task, n) => `refs/conducao-aviso/${ciclo}/${task}/${n}`,
  avisoVisto: (ciclo, task, n) => `refs/conducao-local/${ciclo}/aviso/${task}/${n}`,
  buscaAviso: (ciclo, task, n) => `refs/conducao-busca/${ciclo}/aviso/${task}/${n}`,
};

// ── commits vazios da condução ───────────────────────────────────────────────

/**
 * Commit vazio no ramo do ciclo: subject, corpo livre (o "sim" do operador, quando
 * houver) e trailers no último parágrafo — `%(trailers)` do `lerMarcas` só
 * acha trailer no parágrafo final.
 */
function commitVazio(repo, subject, { corpo, trailers = {} } = {}) {
  const args = ["commit", "-q", "--allow-empty", "-m", subject];
  if (corpo && corpo.trim()) args.push("-m", corpo.trim());
  const linhas = Object.entries(trailers).map(([k, v]) => `${k}: ${v}`);
  if (linhas.length) args.push("-m", linhas.join("\n"));
  rodar(repo, args);
  return rodar(repo, ["rev-parse", "HEAD"]);
}

// ── cópia do ciclo ───────────────────────────────────────────────────────────

/**
 * Empurra o HEAD para `refs/conducao/<ciclo>/copia`. Só avança: o HEAD tem de
 * descender do último valor empurrado (o espelho local), e o push leva
 * `--force-with-lease` com esse valor — ou vazio, no primeiro, e aí falha se
 * a referência já existe no origin.
 */
export function empurrarCopia({ repo, ciclo }) {
  const head = rodar(repo, ["rev-parse", "HEAD"]);
  const anterior = revOuNull(repo, refs.copiaLocal(ciclo));
  if (anterior === head) return { copia: head, anterior, empurrada: false };
  if (anterior) {
    const anc = ancestral(repo, anterior, head);
    exigir(anc === true, "copia-nao-avanca", `HEAD ${head} não descende da cópia ${anterior} — a cópia só avança`);
  }
  const ref = refs.copia(ciclo);
  const push = tentar(repo, ["push", "--porcelain", `--force-with-lease=${ref}:${anterior ?? ""}`, "origin", `${head}:${ref}`], { rede: true });
  if (push.status !== 0) {
    // C18b do VEGA-28: o `pre-push-proposta-guard` barra o push da cópia quando o
    // ramo já está no origin sem proposta. A ordem que funciona é push do ramo →
    // `gh pr create --draft` → `empurrar-copia`; a recusa diz esse passo.
    if (/\[proposta-guard\]/.test(push.erro)) {
      const ramo = tentar(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).saida || "<ramo do ciclo>";
      throw new ErroPlano(
        "copia-sem-proposta",
        `o proposta-guard recusou o push da cópia: ${ramo} está no origin sem proposta aberta. Abra a proposta como rascunho (gh pr create --draft --fill --head ${ramo}) e rode empurrar-copia de novo — o que já foi gravado no ramo fica; só a cópia não subiu.`,
      );
    }
    throw new ErroPlano(
      "copia-push-falhou",
      `push da cópia ${ref} falhou: ${push.erro.split("\n").slice(-3).join(" | ")} — o que já foi gravado no ramo (HEAD ${head.slice(0, 8)}) fica; conserte e rode só empurrar-copia, sem repetir o verbo que gravou`,
    );
  }
  rodar(repo, ["update-ref", refs.copiaLocal(ciclo), head, ...(anterior ? [anterior] : [])]);
  return { copia: head, anterior, empurrada: true };
}

/** Recusas do `empurrarCopia` que deixam a escrita já feita no ramo de pé. */
const RECUSAS_DA_COPIA = new Set(["copia-push-falhou", "copia-sem-proposta"]);
export const DESFECHO_SEM_COPIA = "registrado-sem-copia";

/**
 * A saída do verbo com a cópia empurrada — ou, quando a marca já foi gravada
 * no ramo e só a cópia não subiu, o desfecho próprio da escrita parcial
 * (T17, 20-a): `acao: registrado-sem-copia`, `desfecho` = a ação que gravou,
 * o que gravou nos mesmos campos, e o remédio. Antes a recusa subia como
 * `ErroPlano` e o chamador recebia só stderr para algo que estava feito.
 */
export function comCopia(repo, ciclo, saida) {
  try {
    return { ...saida, copia: empurrarCopia({ repo, ciclo }) };
  } catch (e) {
    if (!(e instanceof ErroPlano) || !RECUSAS_DA_COPIA.has(e.codigo)) throw e;
    return { ...saida, acao: DESFECHO_SEM_COPIA, desfecho: saida.acao, motivo: e.codigo, detalhe: e.message, remedio: "empurrar-copia", copia: null };
  }
}

function copiaNoOrigin(repo, ciclo) {
  const ref = refs.copia(ciclo);
  const linha = rodar(repo, ["ls-remote", "origin", ref], { rede: true });
  const [sha, nome] = linha.split("\t");
  return nome === ref ? sha : null;
}

// ── 0. autorizar-fase ────────────────────────────────────────────────────────

/**
 * `Conducao: F<n> autorizada`, com o texto do "sim" do operador no corpo e o blob
 * do canonico no HEAD em `Conducao-Plano` — o plano que a T6 congela. A
 * maestra só chama depois da resposta dele, num turno dele.
 */
export function autorizarFase({ repo, ciclo, fase, sim, doCiclo = false }) {
  const verbo = doCiclo ? "autorizar-ciclo" : "autorizar-fase";
  exigir(FASE_RE.test(fase ?? ""), "uso", `${verbo} exige a fase F<n>, veio ${JSON.stringify(fase ?? null)}`);
  exigir(sim && sim.trim(), "sim-ausente", `${verbo} exige o texto do sim de ${nomeDoOperador(repo)} (--sim)`);
  const { blob, plano } = lerPlanoNoCommit(repo, "HEAD", ciclo);
  exigir(plano.fases.some((f) => f.id === fase), "fase-ausente", `${fase} não está no plano ${blob}`);
  const trailers = { "Conducao-Plano": blob, ...(doCiclo ? { "Conducao-Ciclo": "sim" } : {}) };
  const sha = commitVazio(repo, `Conducao: ${fase} autorizada`, { corpo: sim, trailers });
  return comCopia(repo, ciclo, { acao: "autorizada", ciclo, fase, sha, plano: blob, ...(doCiclo ? { doCiclo: true } : {}) });
}

/**
 * `autorizar-ciclo F<n> --sim <texto>` (ruling do operador, 27/10/2026: "esse sim
 * da condução pode ser expandido para o ciclo inteiro (a maestra recebe e
 * distribui), salvo os gates"). Grava a autorização da fase de partida, como
 * o `autorizar-fase`, com o trailer `Conducao-Ciclo: sim`: o `proximo` passa a
 * emitir `herdar-autorizacao` (origem `ciclo`) para cada fase seguinte e para
 * re-plano sem ruling, enquanto nenhuma task mudar de classe ou sensibilidade
 * em relação ao plano congelado aqui. Seguem pedindo: publicação por task,
 * task sensível de fase herdada (por nonce) e as perguntas da vigia.
 */
export function autorizarCiclo({ repo, ciclo, fase, sim }) {
  return autorizarFase({ repo, ciclo, fase, sim, doCiclo: true });
}

/**
 * Autorização herdada pelo re-plano de ruling (F4.17): `Conducao: F<n>
 * autorizada` sob o plano do HEAD, sem sim novo — o corpo e o trailer
 * `Conducao-Herdada` apontam a marca com o sim do operador, `Conducao-Replano` os
 * commits do re-plano. Quem decide a herança é o `herdar-autorizacao` de
 * `conducao.mjs`, que refaz o `proximo`; aqui só se confere que o plano do
 * HEAD é o que ele viu.
 */
export function registrarHeranca({ repo, ciclo, fase, autorizacao, replanos, planoNovo, origem = "replano" }) {
  exigir(FASE_RE.test(fase ?? ""), "uso", `fase inválida: ${fase}`);
  exigir(/^[0-9a-f]{40}$/.test(autorizacao ?? ""), "uso", `autorização herdada sem sha: ${autorizacao}`);
  exigir(origem === "replano" || origem === "ciclo", "uso", `origem da herança inválida: ${origem}`);
  // Só a herança pelo sim do ciclo existe sem commit de re-plano (fase nova).
  exigir(Array.isArray(replanos) && (replanos.length > 0 || origem === "ciclo"), "uso", "herança sem commit de re-plano");
  const { blob } = lerPlanoNoCommit(repo, "HEAD", ciclo);
  exigir(blob === planoNovo, "plano-divergente", `plano do HEAD ${blob}, a herança decidiu sobre ${planoNovo}`);
  const lista = replanos.map((r) => `${r.sha.slice(0, 8)} (${r.ruling ?? "sem ruling"})`).join(", ");
  const corpo =
    origem === "ciclo"
      ? `Autorizada pelo sim do ciclo de ${autorizacao.slice(0, 8)} (autorizar-ciclo, ruling de 27/10/2026)${lista ? `, re-plano ${lista}` : ""}: nenhuma task mudou de classe ou sensibilidade desde o sim. Task sensível desta fase segue pedindo o sim por task.`
      : `Herdada pelo re-plano ${lista}: o sim do operador de ${autorizacao.slice(0, 8)} segue valendo — nenhuma task mudou de classe e nenhuma trazida está pendente (F4.17).`;
  const sha = commitVazio(repo, `Conducao: ${fase} autorizada`, {
    corpo,
    trailers: {
      "Conducao-Plano": blob,
      "Conducao-Herdada": autorizacao,
      ...(replanos.length ? { "Conducao-Replano": replanos.map((r) => r.sha).join(" ") } : {}),
      ...(origem === "ciclo" ? { "Conducao-Origem": "ciclo" } : {}),
    },
  });
  return comCopia(repo, ciclo, { acao: "autorizacao-herdada", ciclo, fase, sha, plano: blob, herdada: autorizacao, origem });
}

// ── 1. abrir ─────────────────────────────────────────────────────────────────

/**
 * Marcador = commit vazio `Conducao: abrir T<k> tentativa <n> nonce <x>` sobre
 * o HEAD, fora do ramo. Só abre com a cópia no origin igual ao HEAD: a filha
 * nasce do mesmo commit que o origin mostra. A referência do origin sai com
 * lease vazio (falha se existe) e é espelhada na local. Junto, no mesmo push
 * atômico, o brief da filha na referência irmã `refs/conducao-brief/…`; a
 * saída leva `partida`, o prompt curto do `create_session`.
 */
export function abrir({ repo, ciclo, task, tentativa, nonce, falhou = null }) {
  exigir(TASK_RE.test(task ?? ""), "uso", `task inválida: ${task}`);
  exigir(Number.isInteger(tentativa) && tentativa > 0, "uso", `tentativa inválida: ${tentativa}`);
  exigir(NONCE_RE.test(nonce ?? ""), "uso", `nonce inválido: ${nonce}`);
  // Tentativa nova depois de falha decidida (T12): a falha da anterior entra
  // no ramo antes do marcador, para a contagem nunca depender da maestra.
  let falha = null;
  if (falhou) {
    exigir(Number.isInteger(falhou.tentativa) && falhou.tentativa < tentativa, "uso", `--falhou ${falhou.tentativa} não é anterior à tentativa ${tentativa}`);
    falha = registrarFalha({ repo, ciclo, task, tentativa: falhou.tentativa, coberta: falhou.coberta, motivo: falhou.motivo });
    if (falha.acao === "perguntar") return falha;
  }
  const head = rodar(repo, ["rev-parse", "HEAD"]);
  const copia = copiaNoOrigin(repo, ciclo);
  if (copia !== head) {
    // Cópia só atrás do HEAD = commit da própria maestra (nota, percalço) sem empurrar a cópia:
    // o remédio é o verbo `empurrar-copia`, que só avança (P13 do ATRM-51). Fora disso, gate.
    const atras = copia !== null && ancestral(repo, copia, head) === true;
    return perguntar("copia-diverge-do-head", { ciclo, task, tentativa, head, copia, ...(atras ? { remedio: "empurrar-copia" } : {}) });
  }

  const local = refs.tentativaLocal(ciclo, task, tentativa);
  if (revOuNull(repo, local)) return perguntar("tentativa-ja-existe", { ciclo, task, tentativa, ref: local });

  const ref = refs.tentativa(ciclo, task, tentativa);
  const refBrief = refs.brief(ciclo, task, tentativa);
  // O brief sai antes do marcador: sem brief inteiro, nada vai ao origin.
  const b = gerarBrief({ repo, ciclo, task, nonce, ref, tentativa });
  if (!b.ok) return perguntar(b.motivo, { ciclo, task, tentativa, detalhe: b.detalhe });
  const partida = partidaDoBrief(b.brief, { ciclo, task, tentativa, nonce, ref, refBrief });
  if (!partida) return perguntar("brief-sem-contrato", { ciclo, task, tentativa, detalhe: "cabeçalho do contrato ou passo 1 não achado no brief" });

  const tree = rodar(repo, ["rev-parse", "HEAD^{tree}"]);
  const marcador = rodar(repo, ["commit-tree", tree, "-p", head, "-m", `Conducao: abrir ${task} tentativa ${tentativa} nonce ${nonce}`]);
  // Commit do brief: filho do marcador, mesma árvore, mensagem pelo stdin (o `commit-tree` a
  // grava sem limpeza). Sem o `\n` final, que o `git log --format=%b` da filha devolve.
  const commitBrief = rodar(repo, ["commit-tree", tree, "-p", marcador], {
    entrada: `Brief da operaria: ${task} tentativa ${tentativa} nonce ${nonce}\n\n${b.brief.replace(/\n$/, "")}`,
  });
  // Relê o corpo como a filha vai ler: o que vai ao origin é o brief, byte a byte, ou nada vai.
  const lido = rodar(repo, ["log", "-1", "--format=%b", commitBrief], { cru: true });
  if (lido !== b.brief.replace(/\n$/, "") + "\n")
    return perguntar("brief-divergente-no-commit", { ciclo, task, tentativa, detalhe: `${lido.length} de ${b.brief.length} caracteres lidos de volta` });
  // Atômico: as duas referências nascem juntas ou nenhuma (lease vazio = falha se já existe).
  const push = tentar(
    repo,
    ["push", "--porcelain", "--atomic", `--force-with-lease=${ref}:`, `--force-with-lease=${refBrief}:`, "origin", `${marcador}:${ref}`, `${commitBrief}:${refBrief}`],
    { rede: true },
  );
  if (push.status !== 0)
    return perguntar("tentativa-recusada-no-origin", { ciclo, task, tentativa, ref, detalhe: push.erro.split("\n").slice(-3).join(" | ") });
  // Zero como valor antigo: cria, nunca sobrescreve.
  rodar(repo, ["update-ref", local, marcador, "0".repeat(40)]);
  return {
    acao: "aberta",
    ciclo,
    task,
    tentativa,
    nonce,
    ref,
    refLocal: local,
    marcador,
    base: head,
    brief: { ref: refBrief, commit: commitBrief, linhas: b.brief.replace(/\n$/, "").split("\n").length },
    partida,
    ...(falha ? { falha } : {}),
  };
}

/**
 * Brief da operária pelo comando que o código do adaptador dá (`plano.brief`), sobre o plano da
 * árvore conduzida — o mesmo texto que a maestra gerava à mão. O plano da árvore tem de ser o
 * do HEAD: a filha faz checkout do marcador, e brief de plano não commitado mentiria para ela.
 * Ao fim, os anexos da T38 (`anexarAoBrief`): a página que o adaptador declara e, na tentativa
 * seguinte a um não do operador por pergunta, o texto desse não.
 */
export function gerarBrief({ repo, ciclo, task, nonce, ref, tentativa = 1 }) {
  let caminho;
  let codigo;
  let pagina;
  let nao;
  try {
    codigo = codigoDoAdaptador(repo);
    pagina = paginaDoProjeto(repo);
    caminho = caminhoDoCanonico(repo, "HEAD", ciclo, codigo);
    nao = naoDoOperador(repo, task, tentativa);
  } catch (e) {
    // O código tipado do erro (`entrada-invalida` do adaptador, o do `ErroPlano`) é o motivo; sem código, o genérico.
    return { ok: false, motivo: typeof e.codigo === "string" && e.codigo ? e.codigo : "brief-indisponivel", detalhe: e.message };
  }
  const sujo = tentar(repo, ["diff", "--quiet", "HEAD", "--", caminho]);
  if (sujo.status === 1) return { ok: false, motivo: "canonico-difere-do-head", detalhe: caminho };
  if (sujo.status !== 0) return { ok: false, motivo: "brief-indisponivel", detalhe: `git diff ${caminho}: ${sujo.erro.split("\n").at(-1)}` };
  // A página declarada tem de estar no HEAD, que é o que a filha recebe: ponteiro morto não vai ao brief.
  if (pagina && tentar(repo, ["cat-file", "-e", `HEAD:${pagina}`]).status !== 0)
    return { ok: false, motivo: "pagina-inexistente", detalhe: `pagina: ${pagina} não está no HEAD de ${repo}` };
  const r = spawnSync(
    process.execPath,
    codigo.plano.brief({ canonico: path.join(repo, caminho), task, nonce, ref }),
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: ENV_GIT, timeout: PRAZO_REDE_MS },
  );
  if (r.status !== 0 || !r.stdout)
    return { ok: false, motivo: "brief-indisponivel", detalhe: `task-brief exit ${r.status ?? r.error?.code}: ${(r.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}` };
  return { ok: true, brief: anexarAoBrief(r.stdout, { pagina, nao }) };
}

const PREFIXO_DO_NAO = "Não, pelo operador: ";

/**
 * O texto do não do operador que abriu a tentativa `tentativa` (A9): o corpo da marca
 * `Conducao: T<k> tentativa <n-1> rodada` no HEAD (uma por tentativa: a rodada fecha a
 * trazida), sem o prefixo e sem os trailers, como o `git commit` o gravou. Primeira
 * tentativa, sem a marca, ou marca do caso por arquivo (só trailers: o brief segue o rito
 * pelo git) ⇒ `null`. Marca com corpo sem o prefixo ⇒ `nao-ilegivel`, nunca o não sumido.
 */
export function naoDoOperador(repo, task, tentativa) {
  if (!Number.isInteger(tentativa) || tentativa < 2) return null;
  const assunto = `Conducao: ${task} tentativa ${tentativa - 1} rodada`;
  const sha = rodar(repo, ["log", "--format=%H%x1f%s", "--fixed-strings", `--grep=${assunto}`, "HEAD"])
    .split("\n")
    .map((l) => l.split("\x1f"))
    .find(([, s]) => s === assunto)?.[0];
  if (!sha) return null;
  const paragrafos = rodar(repo, ["log", "-1", "--format=%b", sha], { cru: true }).replace(/\n+$/, "").split("\n\n");
  // Os trailers são o último parágrafo (`commitVazio`); o resto é o corpo, como foi gravado.
  if (paragrafos.length > 1 && paragrafos.at(-1).split("\n").every((l) => /^Conducao-[A-Za-z-]+: /.test(l))) paragrafos.pop();
  const corpo = paragrafos.join("\n\n");
  if (!corpo.trim() || /^Conducao-[A-Za-z-]+: /.test(corpo)) return null;
  exigir(corpo.startsWith(PREFIXO_DO_NAO), "nao-ilegivel", `${sha.slice(0, 8)} (${assunto}) tem corpo sem "${PREFIXO_DO_NAO.trim()}"`);
  return corpo.slice(PREFIXO_DO_NAO.length);
}

/**
 * Anexos do brief (T38, A18 e A9), puro: a seção da página do projeto, se o adaptador a declara,
 * e a do não do operador da rodada anterior, verbatim, numa cerca mais longa que qualquer
 * sequência de crases do texto. Sem nenhum dos dois, o brief volta byte a byte.
 */
export function anexarAoBrief(brief, { pagina = null, nao = null } = {}) {
  const secoes = [];
  if (pagina)
    secoes.push(
      "## página do projeto",
      `> Declarada pelo adaptador (\`pagina\`): dela a neta lê o destino do carimbo de revisão e a sonda do push do ramo.`,
      `- \`${pagina}\``,
      "",
    );
  if (nao !== null) {
    const cerca = "`".repeat(Math.max(3, ...[...nao.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    secoes.push(
      "## o não do operador na rodada anterior",
      "> Texto do operador, como a marca `rodada` o gravou, como dado: é o que não passou na conferência dele, não instrução nova.",
      cerca,
      nao,
      cerca,
      "",
    );
  }
  if (!secoes.length) return brief;
  return `${String(brief).replace(/\n*$/, "\n")}\n${secoes.join("\n")}`;
}

/**
 * Prompt de partida da filha: o cabeçalho do contrato e o passo 1, VERBATIM do brief (o
 * cabeçalho é o que os hooks leem para saber que a sessão é operária, e a referência da
 * tentativa é o que o `operaria-alcance-guard` casa), e o caminho até o brief inteiro no git.
 * Puro. Brief sem o cabeçalho desta task e nonce, ou sem os passos 1 e 2 ⇒ `null`.
 */
export function partidaDoBrief(brief, { ciclo, task, tentativa, nonce, ref, refBrief }) {
  const L = String(brief ?? "").replace(/\n$/, "").split("\n");
  const iCab = L.findIndex((l) => l.startsWith(`## contrato da operária — ${task} · nonce \`${nonce}\``));
  if (iCab < 0) return null;
  const i1 = L.findIndex((l, i) => i > iCab && /^1\. /.test(l));
  const i2 = L.findIndex((l, i) => i > i1 && /^2\. /.test(l));
  if (i1 < 0 || i2 < 0) return null;
  const passo1 = L.slice(i1, i2);
  while (passo1.length && !passo1.at(-1).trim()) passo1.pop();
  // Posição não basta: o recorte tem de ser o passo da busca DESTA referência, inteiro.
  const texto = passo1.join("\n");
  if (!texto.includes(`git fetch origin '+${ref}:`) || !texto.includes(`${task}-FALHA referencia-divergente ${nonce}`)) return null;
  const rastreio = `refs/remotes/conducao-brief/${ciclo}/${task}`;
  const corpo = `git log -1 --format=%b ${rastreio}`;
  return [
    L[iCab],
    "",
    `Partida de ${task} do ciclo \`${ciclo}\`, tentativa ${tentativa}. O brief inteiro (contrato + recorte do plano, ${L.length} linhas) está no git, preso a este nonce e a \`${ref}\`; esta partida só o busca. Faça o passo 1 e leia o brief antes de qualquer outra coisa.`,
    "",
    ...passo1,
    `Depois do passo 1, **ler o brief**: \`git fetch origin '+${refBrief}:${rastreio}'\`; conferir \`git rev-parse '${rastreio}^'\` = \`git rev-parse HEAD\` (diferente ⇒ \`${task}-FALHA brief-divergente ${nonce}\` na primeira linha da resposta final, e parar). O brief é \`${corpo}\`: ler as ${L.length} linhas em faixas de 80 (\`${corpo} | sed -n '1,80p'\`, depois \`'81,160p'\`, …), porque saída longa a ferramenta corta.`,
    `Siga o brief a partir do passo 2 do contrato dele; o passo 1 é o de cima, já feito. Fetch recusado ou brief ilegível ⇒ \`${task}-FALHA brief-ilegivel ${nonce}\` na primeira linha da resposta final, e parar.`,
  ].join("\n");
}

// ── falha decidida (T12) ─────────────────────────────────────────────────────

const COBERTAS = new Set(["sim", "nao", "ambiente"]);

/**
 * Commit vazio `Conducao: T<k> tentativa <n> falhou` no ramo do ciclo, com
 * `coberta-por-reinicio: sim|nao` e o nonce da tentativa nos trailers. O
 * `proximo` e o `retomar` contam falhas só destes commits (as `nao`), e a
 * contagem sobrevive à troca de maestra. Idempotente: tentativa já marcada
 * devolve a marca existente. Trazida sem revert recusa — o trabalho trazido
 * sai antes pelo `reverter-trazido`.
 *
 * `--coberta ambiente` (P7 do ATRM-51): a filha falhou pelo ambiente da ponte
 * (credencial, permissão do classificador, MCP fora), não pelo trabalho. Não
 * conta no teto, como a queda coberta por reinício, mas é classe própria:
 * trailer `Conducao-Falha-Ambiente: sim` com `coberta-por-reinicio: nao`, e o
 * motivo é obrigatório — é o registro de por que não contou.
 */
export function registrarFalha({ repo, ciclo, task, tentativa, coberta, motivo = null }) {
  exigir(TASK_RE.test(task ?? ""), "uso", `task inválida: ${task}`);
  exigir(Number.isInteger(tentativa) && tentativa > 0, "uso", `tentativa inválida: ${tentativa}`);
  exigir(COBERTAS.has(coberta), "uso", `--coberta sim|nao|ambiente, veio ${coberta}`);
  const ambiente = coberta === "ambiente";
  exigir(!ambiente || (motivo && motivo.trim()), "motivo-ausente", "--coberta ambiente exige --motivo com o que falhou no ambiente");
  const subjectFalha = `Conducao: ${task} tentativa ${tentativa} falhou`;
  const ja = rodar(repo, ["log", "--fixed-strings", `--grep=${subjectFalha}`, "--format=%H%x1f%s", "HEAD"])
    .split("\n")
    .map((l) => l.split("\x1f"))
    .find(([, s]) => s === subjectFalha);
  if (ja) return { acao: "falha-registrada", ciclo, task, tentativa, sha: ja[0], nova: false };
  const trazida = lerTrazidas(repo, ciclo).find((r) => r.task === task && r.tentativa === tentativa);
  if (trazida) return perguntar("trazida-sem-revert", { ciclo, task, tentativa, ref: trazida.ref });
  const local = revOuNull(repo, refs.tentativaLocal(ciclo, task, tentativa));
  const nonceTentativa = local ? RE.marcador.exec(subject(repo, local))?.[3] ?? null : null;
  const sha = commitVazio(repo, subjectFalha, {
    corpo: motivo,
    trailers: {
      "Conducao-Task": task,
      ...(nonceTentativa ? { "Conducao-Nonce": nonceTentativa } : {}),
      "coberta-por-reinicio": ambiente ? "nao" : coberta,
      ...(ambiente ? { "Conducao-Falha-Ambiente": "sim" } : {}),
    },
  });
  return comCopia(repo, ciclo, { acao: "falha-registrada", ciclo, task, tentativa, coberta, nonce: nonceTentativa, sha, nova: true });
}

// ── 3. trazer ────────────────────────────────────────────────────────────────

function subject(repo, sha) {
  return rodar(repo, ["log", "-1", "--format=%s", sha]);
}

/**
 * `--aprovado` confere com a ponta (`verbos.aprovadoConfere`); o prefixo
 * resolve pelo `rev-parse` deste repositório.
 */
export function aprovadoConfere(repo, aprovado, ponta) {
  return verbos.aprovadoConfere({ aprovado, ponta, resolver: (a) => revOuNull(repo, a) });
}

function apagarBusca(repo, ciclo, task, n) {
  tentar(repo, ["update-ref", "-d", refs.busca(ciclo, task, n)]);
}

/**
 * Ponta do `main` no origin, buscada para uma referência temporária (o `main`
 * local da árvore pode estar velho). `{ sha: null, erro }` sem `main` no
 * origin ou com a rede falhando — aí o `trazer` recusa todo merge, como antes,
 * e diz o erro da busca.
 */
function buscarMain(repo, ciclo) {
  // O ramo base é do projeto (`ci.ramoBase` do adaptador); sem CI declarado, `main`.
  const ramo = codigoDoAdaptador(repo).ci?.ramoBase ?? "main";
  const busca = `refs/conducao-busca/${ciclo}/main`;
  const f = tentar(repo, ["fetch", "--no-tags", "--quiet", "origin", `+refs/heads/${ramo}:${busca}`], { rede: true });
  const sha = f.status === 0 ? revOuNull(repo, busca) : null;
  tentar(repo, ["update-ref", "-d", busca]);
  if (sha) return { sha, erro: null };
  return { sha: null, erro: f.status === 0 ? "main buscado sem commit" : f.erro.split("\n").at(-1) || `git fetch do main saiu ${f.status ?? "sem status (prazo de rede)"}` };
}

/** Blob do caminho no commit, ou null quando o caminho não existe nele. */
function blobOuNull(repo, rev, caminho) {
  const r = tentar(repo, ["rev-parse", "--verify", "-q", `${rev}:${caminho}`]);
  return r.status === 0 && r.saida ? r.saida : null;
}

const linhas = (s) => s.split("\n").filter(Boolean);

/**
 * Traz a tentativa `<n>` da task. Recusa (`perguntar`) ponta que não descende
 * do marcador da referência local, faixa com commit que não descende dele
 * (merge de fora), commit com marca da condução, base do marcador fora do
 * ramo, ponta diferente da avisada,
 * diff que pede pergunta sem aprovação para aquele sha, e conflito. Traz por
 * fast-forward quando o HEAD é o pai do marcador, senão por
 * `cherry-pick -x marcador..ponta` (§2.2#23). Trazida, apaga a referência da
 * tentativa (origin e local) e grava o registro `trazida`. Quem recusa e
 * quando: `verbos.mjs` (§ trazer); aqui, o git que alimenta cada decisão.
 */
export function trazer({ repo, ciclo, task, tentativa, shaAvisado = null, sessao = null, aprovado = null }) {
  exigir(TASK_RE.test(task ?? ""), "uso", `task inválida: ${task}`);
  exigir(Number.isInteger(tentativa) && tentativa > 0, "uso", `tentativa inválida: ${tentativa}`);
  const base = { ciclo, task, tentativa };
  const local = refs.tentativaLocal(ciclo, task, tentativa);
  const marcador = revOuNull(repo, local);
  if (!marcador) return perguntar("sem-referencia-local", { ...base, ref: local });
  const mk = RE.marcador.exec(subject(repo, marcador));
  if (!mk || mk[1] !== task || Number(mk[2]) !== tentativa)
    return perguntar("marcador-invalido", { ...base, ref: local, marcador });
  const nonce = mk[3];
  Object.assign(base, { nonce, marcador });

  const ref = refs.tentativa(ciclo, task, tentativa);
  const busca = refs.busca(ciclo, task, tentativa);
  const f = tentar(repo, ["fetch", "--no-tags", "--quiet", "origin", `+${ref}:${busca}`], { rede: true });
  if (f.status !== 0) return perguntar("referencia-ausente-no-origin", { ...base, ref, detalhe: f.erro.split("\n").at(-1) });
  const ponta = revOuNull(repo, busca);
  apagarBusca(repo, ciclo, task, tentativa);
  Object.assign(base, { ponta });

  const naPonta = verbos.conferirPonta({ base, ponta, marcador, shaAvisado, descende: () => ancestral(repo, marcador, ponta) });
  if (naPonta) return naPonta;
  const faixa = linhas(rodar(repo, ["rev-list", "--reverse", `${marcador}..${ponta}`]));
  const caminho = new Set(linhas(rodar(repo, ["rev-list", "--ancestry-path", `${marcador}..${ponta}`])));
  const merges = linhas(rodar(repo, ["rev-list", "--merges", `${marcador}..${ponta}`]));
  const main = verbos.precisaDoMain({ faixa, caminho, merges }) ? buscarMain(repo, ciclo) : { sha: null, erro: null };
  const doMain = main.sha;
  const noMain = new Set(doMain ? linhas(rodar(repo, ["rev-list", `${marcador}..${doMain}`])) : []);
  const naFaixa = verbos.conferirFaixa({
    base,
    faixa,
    caminho,
    merges,
    noMain,
    doMain,
    erroMain: main.erro,
    paisDoMerge: (m) => rodar(repo, ["rev-list", "--parents", "-n", "1", m]).split(" ").slice(2),
    paiNoMain: (p) => ancestral(repo, p, doMain),
    comMarca: () => new Set(linhas(rodar(repo, ["rev-list", "--extended-regexp", "--grep=^Conducao: ", `${marcador}..${ponta}`]))),
    subjectDe: (c) => subject(repo, c),
  });
  if (naFaixa) return naFaixa;

  const head = rodar(repo, ["rev-parse", "HEAD"]);
  const paiMarcador = rodar(repo, ["rev-parse", `${marcador}^`]);
  const naBase = verbos.conferirBase({ base, head, paiMarcador, baseNoRamo: ancestral(repo, paiMarcador, head), merges });
  if (naBase) return naBase;

  const cru = linhas(rodar(repo, ["-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", marcador, ponta]));
  let caminhos = verbos.caminhosDoDiff({
    cru,
    merges,
    marcador,
    ponta,
    doMain,
    baseComum: () => rodar(repo, ["merge-base", marcador, doMain]),
    blob: (rev, p) => blobOuNull(repo, rev, p),
  });
  const autorizacao = ultimaAutorizacao(lerMarcas(repo));
  exigir(autorizacao, "sem-autorizacao", `nenhuma fase de ${ciclo} autorizada — trazer lê o plano congelado`);
  const { plano } = lerPlanoCongelado(repo, ciclo, autorizacao);
  const t = plano.porId.get(task);
  exigir(t, "task-ausente", `${task} não está no plano congelado`);
  const canonico = caminhoDoCanonico(repo, "HEAD", ciclo);
  caminhos = verbos.comCanonico({ cru, caminhos, canonico });
  const motivos = verbos.motivosParaPerguntar({
    caminhos,
    canonico,
    outputs: t.outputs,
    passos: t.passos ?? [],
    codigo: codigoDoAdaptador(repo),
    instrucoes: lerAdaptador(repo).sessao.instrucoes,
  });
  const semAprovacao = verbos.exigirAprovacao({ base, ponta, aprovado, motivos, confere: () => aprovadoConfere(repo, aprovado, ponta) });
  if (semAprovacao) return semAprovacao;

  const modo = verbos.modoDeTrazer({ head, paiMarcador });
  if (modo === "fast-forward") {
    rodar(repo, ["merge", "--ff-only", "--quiet", ponta]);
  } else {
    const cp = tentar(repo, ["cherry-pick", "-x", "--allow-empty", `${marcador}..${ponta}`]);
    if (cp.status !== 0) {
      const ab = tentar(repo, ["cherry-pick", "--abort"]);
      return perguntar("conflito", { ...base, detalhe: cp.erro.split("\n").slice(-3).join(" | "), abortado: ab.status === 0 });
    }
  }
  const ate = rodar(repo, ["rev-parse", "HEAD"]);
  // Só aviso: erro ao calculá-lo não pode deixar o cherry-pick aplicado sem o registro `trazida`.
  let carimboOrfao = null;
  if (modo === "cherry-pick") {
    try {
      carimboOrfao = carimboOrfaoDoCherryPick(repo, { faixa, ponta, antes: head, depois: ate });
    } catch (e) {
      carimboOrfao = { erro: String(e?.message ?? e).split("\n")[0] };
    }
  }

  const registro = gravarTrazida(repo, { ciclo, task, tentativa, nonce, marcador, ponta, sessao, base: head, ate, modo });
  const apagada = apagarTentativa(repo, ciclo, task, tentativa);
  return comCopia(repo, ciclo, { acao: "trazida", ...base, modo, antes: head, depois: ate, ...(carimboOrfao ? { carimboOrfao } : {}), registro, apagada });
}

// `core.quotePath=false`: caminho não-ASCII sai cru, não entre aspas — senão foge do `PROSA_RE` e da allowlist de carimbo.
const SEM_ASPAS = ["-c", "core.quotePath=false"];

/** Carimbo do adaptador do repositório; projeto sem carimbo declarado ⇒ `perguntar` pelo `ErroPlano`. */
function carimboDo(repo) {
  const { carimbo } = codigoDoAdaptador(repo);
  exigir(carimbo, "sem-carimbo-no-adaptador", `o adaptador de ${repo} não declara carimbo`);
  return carimbo;
}

/** Classe do commit pelo carimbo do adaptador (`codigo`/prosa); sem carimbo declarado, todo commit é código. */
function classeDoCommit(repo, arquivos) {
  const { carimbo } = codigoDoAdaptador(repo);
  return carimbo ? carimbo.classeDoCommit(arquivos) : "codigo";
}

function arquivosDoCommit(repo, c) {
  return rodar(repo, [...SEM_ASPAS, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", c]).split("\n").filter(Boolean);
}

/** Último commit de código (`classeDoCommit`) da lista, do mais velho ao mais novo; null se só prosa. */
function ultimoCommitDeCodigo(repo, commits) {
  for (let i = commits.length - 1; i >= 0; i--) if (classeDoCommit(repo, arquivosDoCommit(repo, commits[i])) === "codigo") return commits[i];
  return null;
}

/** Último commit de código no histórico do HEAD (primeiro pai), do mais novo para trás; null se nenhum. */
function ultimoCodigoNoHead(repo) {
  for (const c of rodar(repo, ["rev-list", "--first-parent", "HEAD"]).split("\n").filter(Boolean))
    if (classeDoCommit(repo, arquivosDoCommit(repo, c)) === "codigo") return c;
  return null;
}

/**
 * Cherry-pick muda o sha de todo commit trazido: carimbo que a filha gravou
 * para o último commit de código dela fica órfão no ramo, e o rito do brief
 * (que procura `<sha8>.md` do último commit não-prosa por `ls-tree`) refaz a
 * rodada B só para carimbar o sha novo. `{ de, para, carimbo }` quando a ponta
 * tem carimbo para o sha da filha e ele não é o do commit trazido; `para`
 * nulo quando nenhum commit trazido cita o sha da filha no `cherry picked from`.
 */
function carimboOrfaoDoCherryPick(repo, { faixa, ponta, antes, depois }) {
  const de = ultimoCommitDeCodigo(repo, faixa);
  if (!de) return null;
  const achar = codigoDoAdaptador(repo).carimbo?.achar;
  if (!achar) return null;
  const carimbo = achar({
    sha: de,
    arquivosDoHead: rodar(repo, ["ls-tree", "-r", "--name-only", ponta]).split("\n"),
    lerArquivo: (p) => rodar(repo, ["show", `${ponta}:${p}`]),
  });
  if (!carimbo) return null;
  const trazidos = rodar(repo, ["rev-list", `${antes}..${depois}`]).split("\n").filter(Boolean);
  const para = trazidos.find((c) => shaDoCherryPick(rodar(repo, ["log", "-1", "--format=%B", c])) === de) ?? null;
  return para === de ? null : { de, para, carimbo };
}

// ── registro da trazida ──────────────────────────────────────────────────────

/**
 * Objeto de commit fora do ramo (árvore vazia, pai = ponta da filha, o que
 * mantém os commits dela alcançáveis até a conferência), com os dados do
 * trazer nos trailers.
 */
function gravarTrazida(repo, d) {
  const vazia = rodar(repo, ["mktree"], { entrada: "" });
  const msg = [
    `Conducao: ${d.task} tentativa ${d.tentativa} trazida`,
    "",
    [
      `Conducao-Task: ${d.task}`,
      `Conducao-Tentativa: ${d.tentativa}`,
      `Conducao-Nonce: ${d.nonce}`,
      `Conducao-Marcador: ${d.marcador}`,
      `Conducao-Sha-Filha: ${d.ponta}`,
      `Conducao-Sessao-Filha: ${d.sessao ?? "-"}`,
      `Conducao-Base: ${d.base}`,
      `Conducao-Ate: ${d.ate}`,
      `Conducao-Modo: ${d.modo}`,
    ].join("\n"),
  ].join("\n");
  const obj = rodar(repo, ["commit-tree", vazia, "-p", d.ponta, "-m", msg]);
  const ref = refs.trazida(d.ciclo, d.task, d.tentativa);
  rodar(repo, ["update-ref", ref, obj, "0".repeat(40)]);
  return ref;
}

/** Registros `trazida` pendentes do ciclo (sem conferência nem revert gravados). */
export function lerTrazidas(repo, ciclo) {
  const prefixo = `refs/conducao-local/${ciclo}/trazida/`;
  const bruto = rodar(repo, ["for-each-ref", "--format=%(refname)%1f%(objectname)%1f%(trailers:only=true,unfold=true)%1e", prefixo]);
  const out = [];
  for (const reg of bruto.split("\x1e")) {
    const [nome, obj, bloco = ""] = reg.replace(/^\n/, "").split("\x1f");
    if (!nome) continue;
    const m = /\/(T\d{1,3})\/(\d+)$/.exec(nome);
    if (!m) continue;
    const tr = {};
    for (const l of bloco.split("\n")) {
      const k = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(l.trim());
      if (k) tr[k[1]] = k[2];
    }
    out.push({
      ref: nome,
      objeto: obj,
      task: m[1],
      tentativa: Number(m[2]),
      nonce: tr["Conducao-Nonce"] ?? null,
      marcador: tr["Conducao-Marcador"] ?? null,
      ponta: tr["Conducao-Sha-Filha"] ?? null,
      sessao: tr["Conducao-Sessao-Filha"] && tr["Conducao-Sessao-Filha"] !== "-" ? tr["Conducao-Sessao-Filha"] : null,
      base: tr["Conducao-Base"] ?? null,
      ate: tr["Conducao-Ate"] ?? null,
      modo: tr["Conducao-Modo"] ?? null,
    });
  }
  return out;
}

function trazidaDaTask(repo, ciclo, task) {
  const delas = lerTrazidas(repo, ciclo).filter((r) => r.task === task);
  exigir(delas.length === 1, delas.length ? "trazida-ambigua" : "sem-trazida", `${delas.length} registro(s) trazida de ${task} (esperado 1)`);
  const r = delas[0];
  exigir(r.base && r.ate && r.ponta && r.nonce, "trazida-incompleta", `registro ${r.ref} sem base/ate/ponta/nonce`);
  return r;
}

// ── 5. apagar ────────────────────────────────────────────────────────────────

/** Apaga a referência da tentativa no origin e a local. */
export function apagarTentativa(repo, ciclo, task, n) {
  const ref = refs.tentativa(ciclo, task, n);
  const push = tentar(repo, ["push", "--porcelain", "origin", `:${ref}`], { rede: true });
  const origin = push.status === 0 ? "apagada" : /remote ref does not exist|unable to delete/.test(push.erro) ? "ausente" : "falhou";
  exigir(origin !== "falhou", "apagar-falhou", `push de remoção de ${ref} falhou: ${push.erro.split("\n").at(-1)}`);
  tentar(repo, ["update-ref", "-d", refs.tentativaLocal(ciclo, task, n)]);
  // O brief não sustenta estado: remoção que falha fica dita na saída e o `limpar` a varre.
  const refBrief = refs.brief(ciclo, task, n);
  const pb = tentar(repo, ["push", "--porcelain", "origin", `:${refBrief}`], { rede: true });
  // Só "não existe" é ausente (tentativa de script anterior ao brief); recusa de outro tipo é falha dita.
  const brief = pb.status === 0 ? "apagada" : /remote ref does not exist/.test(pb.erro) ? "ausente" : "falhou";
  return {
    ref,
    origin,
    local: refs.tentativaLocal(ciclo, task, n),
    brief: { ref: refBrief, origin: brief, ...(brief === "falhou" ? { detalhe: pb.erro.split("\n").at(-1) } : {}) },
  };
}

// ── 4. conferir-carimbo · registrar-conferencia · recusa · revert ───────────

/**
 * Carimbo que a filha gravou para o que foi trazido: o último commit não-prosa
 * da faixa trazida (pelo sha da filha — o `cherry picked from`, quando houve
 * cherry-pick) tem de ter carimbo na árvore do HEAD, com `sha:` igual a ele e
 * `veredito:` que aprova. Faixa só de prosa não exige carimbo, como no guard
 * de pre-push. Falta ou falha ⇒ `perguntar` (D-VEGA22-23); a decisão é
 * `verbos.desfechoDoCarimbo`.
 */
export function conferirCarimbo({ repo, ciclo, task }) {
  const r = trazidaDaTask(repo, ciclo, task);
  const base = { acao: "conferir-carimbo", ciclo, task, tentativa: r.tentativa, nonce: r.nonce };
  const commits = rodar(repo, ["rev-list", "--reverse", `${r.base}..${r.ate}`]).split("\n").filter(Boolean);
  const ultimo = ultimoCommitDeCodigo(repo, commits);
  const lerArquivo = (p) => rodar(repo, ["show", `HEAD:${p}`]);
  return verbos.desfechoDoCarimbo({
    base,
    ultimo,
    modo: r.modo,
    corpo: () => rodar(repo, ["log", "-1", "--format=%B", ultimo]),
    achar: (sha) => carimboDo(repo).achar({ sha, arquivosDoHead: rodar(repo, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n"), lerArquivo }),
    ler: lerArquivo,
  });
}

function taskDoPlano(repo, ciclo, task) {
  const autorizacao = ultimaAutorizacao(lerMarcas(repo));
  exigir(autorizacao, "sem-autorizacao", `nenhuma fase de ${ciclo} autorizada`);
  const { plano } = lerPlanoCongelado(repo, ciclo, autorizacao);
  const t = plano.porId.get(task);
  exigir(t, "task-ausente", `${task} não está no plano congelado`);
  return t;
}

/** Caso de conferência do operador da task, com os casos que o adaptador do repositório declara (T14). */
function casoDaTask(repo, t) {
  const caso = verbos.casoDeConferencia(t, lerAdaptador(repo).conferencia);
  // Task de rodadas (marca de `marcasDeRodadas` do código do adaptador) sem caso
  // declarado viraria task comum e fecharia sem o approval: recusa.
  exigir(
    caso || !t.rodadas,
    "conferencia-nao-declarada",
    `${t.id} é de rodadas no plano (${t.marcas.join(", ")}), mas o adaptador de ${repo} não declara o caso em \`conferencia\``,
  );
  return caso;
}

/**
 * `Conducao: T<k> conferida` com os trailers que o `auditar` cobra: manual
 * (workstation), maestra (estação maestra) ou da filha, lendo o registro
 * `trazida` e o apagando. O que se exige de cada modo — Verificação e
 * publicação contra o plano congelado, o sim do operador — é
 * `verbos.politicaDaConferencia`.
 */
export function registrarConferencia({ repo, ciclo, task, verificacao, publicacao, manual = false, maestra = false, sim = null, sessao = null, operador = null }) {
  verbos.exigirUsoDaConferencia({ task, manual, maestra, publicacao });
  const t = taskDoPlano(repo, ciclo, task);
  const caso = casoDaTask(repo, t);
  const p = verbos.politicaDaConferencia({
    task,
    t,
    verificacao,
    publicacao,
    manual,
    maestra,
    sim,
    sessao,
    caso,
    operador,
    nomeDoOperador: nomeDoOperador(repo),
    approval: () => {
      const caminho = caminhoDoApproval(repo, ciclo, caso.arquivo);
      return { caminho, verdict: approvalNoHead(repo, caminho)?.verdict };
    },
  });
  // Conferência do operador por pergunta, sem a resposta dele: nada grava.
  if (p.acao === "perguntar") {
    // A mesma pergunta do `proximo`: com a tentativa trazida, quando há.
    const r = lerTrazidas(repo, ciclo).filter((x) => x.task === task).at(-1);
    return perguntar(p.motivo, { ...p, ciclo, ...(r ? { tentativa: r.tentativa, nonceTentativa: r.nonce, ref: r.ref } : {}) });
  }
  if (p.via !== "filha") {
    const sha = commitVazio(repo, p.subject, { corpo: p.corpo, trailers: p.trailers });
    return comCopia(repo, ciclo, { acao: "conferida", ciclo, task, sha, ...p.saida });
  }
  const r = trazidaDaTask(repo, ciclo, task);
  exigir(ancestral(repo, r.ate, "HEAD") === true, "trazido-fora-do-ramo", `${r.ate} (trazido de ${task}) não está no HEAD`);
  const sessaoFilha = verbos.sessaoDaFilha({ task, sessao, r });
  const sha = commitVazio(repo, p.subject, { corpo: p.corpo, trailers: verbos.trailersDaFilha({ task, r, sessaoFilha, verificacao, publicacao, dispensa: p.dispensa }) });
  rodar(repo, ["update-ref", "-d", r.ref]);
  return comCopia(repo, ciclo, { acao: "conferida", ciclo, task, tentativa: r.tentativa, nonce: r.nonce, sha, ...p.saida });
}

/** Approval no HEAD (`{ verdict, rodada }`) ou null quando o caminho não está lá; erro do git sobe. */
function approvalNoHead(repo, caminho) {
  if (!rodar(repo, ["ls-tree", "--name-only", "HEAD", "--", caminho])) return null;
  return verbos.lerApproval(rodar(repo, ["show", `HEAD:${caminho}`]));
}

/** O arquivo de resposta do caso (`arquivo` do adaptador), na pasta do ciclo. */
function caminhoDoApproval(repo, ciclo, arquivo) {
  return path.posix.join(path.posix.dirname(caminhoDoCanonico(repo, "HEAD", ciclo)), arquivo);
}

/** Marcas `Conducao: T<k> tentativa <n> rodada` da task no HEAD (pelo subject). */
function marcasDeRodada(repo, task) {
  return rodar(repo, ["log", "--format=%s", `--grep=^Conducao: ${task} tentativa `, "HEAD"])
    .split("\n")
    .filter((s) => RE.rodada.exec(s)?.[1] === task).length;
}

/**
 * O não do operador numa task de conferência do operador (T14, 7-a):
 * desfecho registrável que não é conferência nem falha. Grava `Conducao: T<k>
 * tentativa <n> rodada` (trailer `Conducao-Rodada`), apaga o registro
 * `trazida` e mantém o trabalho trazido; o `proximo` abre a tentativa n+1.
 * Por pergunta, o não é o texto do operador (`--operador`, no corpo); por
 * arquivo (por exemplo um gate de UX), é o arquivo lido no HEAD, e o brief
 * entrega a rodada B ou C pelo estado do git. O teto não abre rodada além
 * dele: `perguntar teto-de-rodadas`. A política é `verbos.mjs`.
 */
export function registrarRodada({ repo, ciclo, task, rodada, sessao = null, operador = null }) {
  verbos.exigirUsoDaRodada({ task, rodada });
  const t = taskDoPlano(repo, ciclo, task);
  const caso = casoDaTask(repo, t);
  verbos.exigirTaskDeRodada({ task, caso, rodada, operador });
  const r = trazidaDaTask(repo, ciclo, task);
  exigir(ancestral(repo, r.ate, "HEAD") === true, "trazido-fora-do-ramo", `${r.ate} (trazido de ${task}) não está no HEAD`);
  if (!caso.arquivo) return registrarRodadaPorPergunta({ repo, ciclo, task, r, sessao, rodada, operador });
  const approval = caminhoDoApproval(repo, ciclo, caso.arquivo);
  const a = approvalNoHead(repo, approval);
  verbos.exigirApprovalDeRodada({ caminho: approval, a, caso });
  if (rodada === "carimbo") return registrarRodadaDeCarimbo({ repo, ciclo, task, r, sessao, approval, rodadaDoApproval: a.rodada });
  const anteriores = marcasDeRodada(repo, task);
  const base = { ciclo, task, tentativa: r.tentativa, nonce: r.nonce, approval, rodadaDoApproval: a.rodada, rodadasRegistradas: anteriores };
  const fora = verbos.conferirRodada({ base, anteriores, rodadaDoApproval: a.rodada, ref: r.ref });
  if (fora) return fora;
  const sessaoFilha = verbos.sessaoDaFilha({ task, sessao, r });
  const sha = commitVazio(repo, `Conducao: ${task} tentativa ${r.tentativa} rodada`, {
    trailers: verbos.trailersDaRodada({ task, r, sessaoFilha, rodada, rodadaDoApproval: a.rodada }),
  });
  rodar(repo, ["update-ref", "-d", r.ref]);
  return comCopia(repo, ciclo, { acao: "rodada-registrada", ...base, rodada, sha });
}

/** O não por pergunta: o texto do operador vai no corpo da marca `rodada`. */
function registrarRodadaPorPergunta({ repo, ciclo, task, r, sessao, rodada, operador }) {
  const anteriores = marcasDeRodada(repo, task);
  const base = { ciclo, task, tentativa: r.tentativa, nonce: r.nonce, rodadasRegistradas: anteriores };
  const fora = verbos.conferirRodadaPorPergunta({ base, anteriores, ref: r.ref });
  if (fora) return fora;
  const sessaoFilha = verbos.sessaoDaFilha({ task, sessao, r });
  const sha = commitVazio(repo, `Conducao: ${task} tentativa ${r.tentativa} rodada`, {
    corpo: `Não, pelo operador: ${operador.trim()}`,
    trailers: verbos.trailersDaRodada({ task, r, sessaoFilha, rodada }),
  });
  rodar(repo, ["update-ref", "-d", r.ref]);
  return comCopia(repo, ciclo, { acao: "rodada-registrada", ...base, rodada, sha });
}

/**
 * `--rodada carimbo`: grava `Conducao: T<k> tentativa <n> carimbo`, que o
 * `marcasDeRodada` não conta: não consome rodada nem teto, e o brief da n+1
 * segue o rito pelo git (com o carimbo do conserto no HEAD, a C). Que a faixa
 * só traga carimbo, e que ele cubra o conserto: `verbos.carimbosDaFaixa` e
 * `verbos.exigirCarimboDoConserto`.
 */
function registrarRodadaDeCarimbo({ repo, ciclo, task, r, sessao, approval, rodadaDoApproval }) {
  const codigo = codigoDoAdaptador(repo);
  const carimbo = carimboDo(repo);
  const notas = carimbo.notas(path.posix.dirname(caminhoDoCanonico(repo, "HEAD", ciclo, codigo)));
  // Por commit, não pelo diff base..ate: arquivo mudado e desfeito na faixa também conta.
  // A faixa não tem merge (o `trazer` recusa `faixa-com-merge`), então o `log` sem `-m` vê todo arquivo.
  const mudancas = verbos.mudancasDoLog(rodar(repo, [...SEM_ASPAS, "log", "--format=", "--name-status", "--no-renames", `${r.base}..${r.ate}`]));
  const carimbos = verbos.carimbosDaFaixa({ task, tentativa: r.tentativa, mudancas, notas, codigo });
  const conserto = ultimoCodigoNoHead(repo);
  const cobre = conserto
    ? carimbo.achar({ sha: conserto, arquivosDoHead: carimbos, lerArquivo: (p) => rodar(repo, ["show", `HEAD:${p}`]) })
    : null;
  verbos.exigirCarimboDoConserto({ carimbos, conserto, cobre });
  const sessaoFilha = verbos.sessaoDaFilha({ task, sessao, r });
  const sha = commitVazio(repo, `Conducao: ${task} tentativa ${r.tentativa} carimbo`, {
    corpo: carimbos.map((c) => `Carimbo: ${c}`).join("\n"),
    trailers: verbos.trailersDaRodada({ task, r, sessaoFilha, rodada: "carimbo", rodadaDoApproval }),
  });
  rodar(repo, ["update-ref", "-d", r.ref]);
  return comCopia(repo, ciclo, {
    acao: "carimbo-registrado",
    ciclo,
    task,
    tentativa: r.tentativa,
    nonce: r.nonce,
    approval,
    rodadaDoApproval,
    rodada: "carimbo",
    carimbos,
    sha,
  });
}

/** Publicação recusada no gate: `Conducao: T<k> publicacao recusada` — o `proximo` passa a emitir `parar`. */
export function recusarPublicacao({ repo, ciclo, task, motivo }) {
  const r = trazidaDaTask(repo, ciclo, task);
  const sha = commitVazio(repo, `Conducao: ${task} publicacao recusada`, {
    corpo: motivo,
    trailers: { "Conducao-Task": task, "Conducao-Nonce": r.nonce },
  });
  return comCopia(repo, ciclo, { acao: "publicacao-recusada", ciclo, task, nonce: r.nonce, sha });
}

/**
 * Verificação vermelha depois de trazer: `git revert` dos commits trazidos
 * daquela tentativa (os que mudam árvore, do mais novo ao mais velho) num
 * commit só, `Conducao: T<k> tentativa <n> revertida`. Nunca `reset`.
 */
export function reverterTrazido({ repo, ciclo, task, motivo }) {
  const r = trazidaDaTask(repo, ciclo, task);
  exigir(ancestral(repo, r.ate, "HEAD") === true, "trazido-fora-do-ramo", `${r.ate} (trazido de ${task}) não está no HEAD`);
  const commits = rodar(repo, ["rev-list", "--no-merges", `${r.base}..${r.ate}`]).split("\n").filter(Boolean);
  const comMudanca = commits.filter((c) => tentar(repo, ["diff-tree", "--quiet", `${c}^`, c]).status === 1);
  if (comMudanca.length) {
    const rv = tentar(repo, ["revert", "--no-commit", "--no-edit", ...comMudanca]);
    if (rv.status !== 0) {
      tentar(repo, ["revert", "--abort"]);
      return perguntar("revert-em-conflito", { ciclo, task, tentativa: r.tentativa, detalhe: rv.erro.split("\n").slice(-3).join(" | ") });
    }
  }
  const sha = commitVazio(repo, `Conducao: ${task} tentativa ${r.tentativa} revertida`, {
    corpo: [motivo, ...comMudanca.map((c) => `Reverte ${c}`)].filter(Boolean).join("\n"),
    trailers: { "Conducao-Task": task, "Conducao-Nonce": r.nonce },
  });
  rodar(repo, ["update-ref", "-d", r.ref]);
  return comCopia(repo, ciclo, { acao: "revertida", ciclo, task, tentativa: r.tentativa, nonce: r.nonce, sha, revertidos: comMudanca });
}

// ── 4-bis. esperar-filha ─────────────────────────────────────────────────────

function dormirSegundos(s) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);
}

/**
 * Espera a filha empurrar (ruling 18.4a do operador, T18): a maestra roda isto em
 * segundo plano e é reinvocada quando ele sai — a filha não manda
 * `send_message`, que pede clique do operador a cada chamada. Lê só o `ls-remote`
 * da referência da tentativa contra o marcador local e sai quando a ponta
 * anda (`andou`), quando a referência some (`referencia-sumiu`) ou no prazo
 * (`prazo`), ou depois de `FALHAS_REDE_SEGUIDAS` sondagens seguidas com erro
 * (`rede-falhou` — nunca confundido com filha lenta).
 *
 * Aviso (P22 do ATRM-51): o mesmo `ls-remote` lê também a referência irmã
 * `refs/conducao-aviso/<ciclo>/T<k>/<n>`. Ponta dela diferente do último aviso
 * já devolvido (`refs/conducao-local/<ciclo>/aviso/T<k>/<n>`) ⇒ busca o commit,
 * grava-o como visto e sai `avisou` com `linha` = o subject (a 1ª linha da
 * resposta final da filha) e `confere` = a linha é `T<k>-OK|FALHA … <nonce da
 * tentativa>`; se a referência de trabalho também andou, `ponta` vem junto.
 * O aviso vence o `andou`: é ele que diz se a filha terminou. Filha sem
 * referência de aviso (contrato anterior, ou ciclo em voo com os scripts do
 * próprio ramo) cai no comportamento de antes: FALHA sem empurrar só aparece no
 * `prazo`, e aí a maestra lê a sessão da filha antes de rearmar.
 * Esta espera só olha referências: filha barrada antes de gravar o aviso
 * (classificador, pedido de permissão) não a acorda. Esse caso chega à maestra
 * pela mensagem da filha para `@parent` (contrato da operária, passo 6a), e a
 * maestra para esta espera (SKILL `conducao` §2, Aviso por mensagem).
 * Não decide nada: a linha vai ao `proximo` como o aviso de sempre.
 */
const FALHAS_REDE_SEGUIDAS = 3;

/** Busca o aviso no origin para uma referência temporária e lê o subject. Nunca lança. */
function buscarAviso(repo, ciclo, task, n) {
  const busca = refs.buscaAviso(ciclo, task, n);
  const f = tentar(repo, ["fetch", "--no-tags", "--quiet", "origin", `+${refs.aviso(ciclo, task, n)}:${busca}`], { rede: true });
  if (f.status !== 0) return { ok: false, erro: f.erro.split("\n").at(-1) || `git fetch saiu ${f.status ?? "sem status (prazo de rede)"}` };
  const sha = revOuNull(repo, busca);
  tentar(repo, ["update-ref", "-d", busca]);
  if (!sha) return { ok: false, erro: "aviso buscado sem commit" };
  const r = tentar(repo, ["log", "-1", "--format=%s", sha]);
  if (r.status !== 0) return { ok: false, erro: r.erro.split("\n").at(-1) || "subject do aviso ilegível" };
  return { ok: true, sha, linha: r.saida };
}

/** A linha do aviso é desta tentativa: `T<k>-OK|FALHA <…> <nonce do marcador>`. */
export function avisoConfere(linha, task, nonce) {
  if (!nonce) return false;
  const partes = String(linha ?? "").trim().split(/\s+/);
  return partes.length >= 3 && (partes[0] === `${task}-OK` || partes[0] === `${task}-FALHA`) && partes.at(-1) === nonce;
}

export function esperarFilha({ repo, ciclo, task, tentativa, maxMin = 10, tetoChamadorMin, intervaloS = 30, desde = null, avisoTratado = null, dormir = dormirSegundos }) {
  exigir(TASK_RE.test(task ?? ""), "uso", `task inválida: ${task}`);
  // P25/P27 do ATRM-51, C18c do VEGA-28: rearmada, a espera voltava com o que a
  // maestra já tinha tratado. `--desde <sha>`: a ponta já vista não conta como
  // `andou`. `--aviso-tratado <linha>`: o aviso com essa linha (o que chegou
  // antes por mensagem, ou a pergunta já respondida) é marcado como visto e
  // a espera segue — a mesma linha é o mesmo aviso (skill §2).
  exigir(desde === null || SHA_PREFIXO_RE.test(String(desde)), "uso", `--desde exige sha (7+ hex), veio ${JSON.stringify(desde)}`);
  exigir(avisoTratado === null || String(avisoTratado).trim() !== "", "uso", "--aviso-tratado exige a linha do aviso");
  const tratado = avisoTratado === null ? null : String(avisoTratado).trim();
  const desdeMin = desde === null ? null : String(desde).toLowerCase();
  exigir(Number.isInteger(tentativa) && tentativa > 0, "uso", `tentativa inválida: ${tentativa}`);
  exigir(Number.isInteger(maxMin) && maxMin >= 0, "uso", `--max-min inválido: ${maxMin}`);
  // Achado T13 da T18: a espera de 60 min rodou sob o timeout de 30 do Bash em
  // segundo plano e morreu calada. Quem chama declara o próprio teto; prazo
  // acima dele é recusado antes de esperar.
  exigir(Number.isInteger(tetoChamadorMin) && tetoChamadorMin > 0, "teto-do-chamador", `--teto-chamador-min <n> é obrigatório (o timeout, em minutos, de quem roda a espera); veio ${tetoChamadorMin ?? "nada"}`);
  exigir(maxMin <= tetoChamadorMin, "teto-do-chamador", `--max-min ${maxMin} passa do teto do chamador (${tetoChamadorMin} min): a espera morreria calada antes do prazo`);
  exigir(Number.isInteger(intervaloS) && intervaloS > 0, "uso", `--intervalo-s inválido: ${intervaloS}`);
  const base = { acao: "espera", ciclo, task, tentativa };
  const marcador = revOuNull(repo, refs.tentativaLocal(ciclo, task, tentativa));
  if (!marcador) return { ...base, desfecho: "sem-referencia-local" };
  const ref = refs.tentativa(ciclo, task, tentativa);
  const refAviso = refs.aviso(ciclo, task, tentativa);
  const vistoRef = refs.avisoVisto(ciclo, task, tentativa);
  const nonce = RE.marcador.exec(subject(repo, marcador))?.[3] ?? null;
  const fim = Date.now() + maxMin * 60_000;
  let falhasSeguidas = 0;
  for (;;) {
    const r = tentar(repo, ["ls-remote", "origin", ref, refAviso], { rede: true });
    let erroRede = r.status === 0 ? null : r.erro.split("\n").at(-1) || `git ls-remote saiu ${r.status ?? "sem status (prazo de rede)"}`;
    if (r.status === 0) {
      // `ls-remote` casa padrão por sufixo: só a linha da referência exata vale.
      const colunas = r.saida.split("\n").map((l) => l.split(/\s+/));
      const ponta = colunas.find((c) => c[1] === ref)?.[0] || null;
      const avisoNoOrigin = colunas.find((c) => c[1] === refAviso)?.[0] || null;
      const andou = ponta !== null && ponta !== marcador && !(desdeMin && ponta.startsWith(desdeMin));
      let avisoNovo = Boolean(avisoNoOrigin && avisoNoOrigin !== revOuNull(repo, vistoRef));
      if (avisoNovo) {
        const a = buscarAviso(repo, ciclo, task, tentativa);
        if (a.ok) {
          rodar(repo, ["update-ref", vistoRef, a.sha]);
          if (tratado !== null && a.linha.trim() === tratado) avisoNovo = false;
          else
            return { ...base, desfecho: "avisou", marcador, aviso: a.sha, linha: a.linha, confere: avisoConfere(a.linha, task, nonce), ...(andou ? { ponta } : {}) };
        } else erroRede = `aviso em ${refAviso} não buscado: ${a.erro}`;
      }
      if (!avisoNovo && erroRede === null) {
        falhasSeguidas = 0;
        if (!ponta) return { ...base, desfecho: "referencia-sumiu", marcador };
        if (andou) return { ...base, desfecho: "andou", marcador, ponta };
      }
    }
    if (erroRede !== null && ++falhasSeguidas >= FALHAS_REDE_SEGUIDAS) {
      return { ...base, desfecho: "rede-falhou", marcador, falhas: falhasSeguidas, erro: erroRede };
    }
    const restante = fim - Date.now();
    if (restante <= 0) return { ...base, desfecho: "prazo", marcador };
    dormir(Math.min(intervaloS, Math.ceil(restante / 1000)));
  }
}

// ── 5. limpar --ciclo ────────────────────────────────────────────────────────

/**
 * Para o `/close-cycle` (T15): apaga no origin as tentativas que sobraram —
 * encerradas (falhou/revertida) —, a cópia e os avisos das filhas, e localmente tudo sob
 * `refs/conducao-local/<ciclo>/`. Recusa enquanto houver tentativa em voo ou
 * trazida sem conferência: essas não são rastro morto.
 */
export function limpar({ repo, ciclo, emVoo = [], trazidas = lerTrazidas(repo, ciclo) }) {
  if (emVoo.length || trazidas.length)
    return perguntar("conducao-viva", { ciclo, emVoo: emVoo.map((r) => r.ref), trazidas: trazidas.map((r) => r.ref) });
  // Os avisos das filhas (P22) e os briefs moram nas árvores irmãs `refs/conducao-aviso/<ciclo>/` e `refs/conducao-brief/<ciclo>/`.
  const prefixos = [`refs/conducao/${ciclo}/`, `refs/conducao-aviso/${ciclo}/`, `refs/conducao-brief/${ciclo}/`];
  const noOrigin = rodar(repo, ["ls-remote", "origin", ...prefixos.map((p) => `${p}*`)], { rede: true })
    .split("\n")
    .map((l) => l.split("\t")[1])
    .filter((n) => prefixos.some((p) => n?.startsWith(p)));
  if (noOrigin.length) rodar(repo, ["push", "--porcelain", "origin", ...noOrigin.map((n) => `:${n}`)], { rede: true });
  const locais = rodar(repo, ["for-each-ref", "--format=%(refname)", `refs/conducao-local/${ciclo}/`]).split("\n").filter(Boolean);
  if (locais.length) rodar(repo, ["update-ref", "--stdin"], { entrada: locais.map((n) => `delete ${n}\n`).join("") });
  return { acao: "limpo", ciclo, origin: noOrigin, locais };
}
