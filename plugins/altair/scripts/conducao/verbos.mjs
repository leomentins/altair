/**
 * verbos.mjs — a política dos verbos da condução (VEGA-29 T8).
 *
 * O que `trazer`, `conferir-carimbo`, `registrar-conferencia` (com o modo da
 * maestra e o manual) e o rito de rodadas decidem, sem git: recebem o que a
 * casca de I/O (`git-conducao.mjs`) leu e devolvem a pergunta, o erro
 * (`ErroPlano`) ou o que gravar. O que só o git responde chega como valor ou
 * como função injetada (`descende`, `blob`, `approval`…), chamada no mesmo
 * ponto em que a casca a chamava — a ordem das recusas é o contrato. Subiu
 * como estava na T8; a T14 generalizou o rito de rodadas na conferência do
 * operador (§ conferência do operador).
 */
import { MARCA_DA_CONFERENCIA, PAPEL_DA_DISPENSA, TRAILER_DA_DISPENSA, codigoDoNucleo } from "./adaptador.mjs";
import { BOTOES } from "./botoes.mjs";
import { alcanca } from "./hooks-alcance.mjs";
import { ErroPlano, casaAlgum } from "./ler-plano.mjs";
import { perguntar as construirPergunta } from "./pergunta.mjs";

export const TASK_RE = /^T\d{1,3}$/;

export function exigir(cond, codigo, msg) {
  if (!cond) throw new ErroPlano(codigo, msg);
}

/** `acao` e `motivo` por último: campo `acao` do chamador nunca mascara a pergunta. Sai pelo construtor único (T12). */
export function perguntar(motivo, campos = {}) {
  return construirPergunta({ ...campos, acao: "perguntar", motivo });
}

// ── trazer ───────────────────────────────────────────────────────────────────

/** Paths do diff fora do que a task declara em `**Outputs:**` (exato, ou dentro de um diretório declarado). */
export function foraDosOutputs(caminhos, outputs) {
  return caminhos.filter((c) => !outputs.some((o) => c === o || c.startsWith(o.endsWith("/") ? o : `${o}/`)));
}

/**
 * Segmentos de tela clínica que os Steps nomeiam (P21/P24 do ATRM-51): o
 * diretório citado, ou o diretório do arquivo citado, desde que ele mesmo
 * fique dentro de `telasClinicasDosSteps` do adaptador (`codigo`; sem ele, o
 * da árvore do núcleo) — a raiz do módulo, ou um arquivo direto nela, nunca é
 * segmento.
 */
export function segmentosDosSteps(passos = [], codigo = codigoDoNucleo()) {
  const out = [];
  for (const p of passos) {
    const s = p.replace(/\/+$/, "");
    const base = s.split("/").at(-1) ?? "";
    const seg = /\.[A-Za-z0-9]+$/.test(base) ? s.slice(0, s.lastIndexOf("/")) : s;
    if (seg && casaAlgum(seg, codigo.telasClinicasDosSteps)) out.push(seg);
  }
  return [...new Set(out)];
}

/**
 * O que, no diff da filha, pede pergunta antes de trazer: o que os hooks de
 * commit da maestra executam (T8) e caminho clínico, os dois só fora dos
 * `**Outputs:**` da task, e o canonico do ciclo conduzido. Output declarado
 * que os hooks alcançam não pergunta (ruling 18.5a do operador, T18): o plano e o
 * "sim" da fase já o aprovaram, e a Verificação roda o mesmo código logo
 * depois de trazer (D-VEGA22-17). `alcance` é o leitor dos hooks
 * (`hooks-alcance.mjs`); injetável para o teste não depender da árvore.
 * Caminho clínico e tela dos Steps vêm do código do adaptador (`codigo`, T20).
 */
export function motivosParaPerguntar({ caminhos, canonico, outputs, passos = [], alcance = alcanca, codigo = codigoDoNucleo() }) {
  const motivos = [];
  // Só Output declarado como ARQUIVO libera: diretório declarado (`.claude/`,
  // `.husky/`) liberaria todo hook embaixo dele sem pergunta.
  const hooks = alcance(caminhos).filter((c) => !outputs.includes(c));
  if (hooks.length) motivos.push({ motivo: "alcance-dos-hooks", caminhos: hooks });
  const instrucao = caminhos.filter((c) => casaAlgum(c, BOTOES.superficiesDeInstrucao));
  if (instrucao.length) motivos.push({ motivo: "superficie-de-instrucao", caminhos: instrucao });
  if (caminhos.includes(canonico)) motivos.push({ motivo: "canonico-do-ciclo", caminhos: [canonico] });
  const segmentos = segmentosDosSteps(passos, codigo);
  const clinicos = foraDosOutputs(caminhos.filter((c) => casaAlgum(c, codigo.caminhosClinicos)), outputs).filter(
    (c) =>
      !(
        casaAlgum(c, codigo.telasClinicasDosSteps) &&
        !casaAlgum(c, codigo.foraDasTelasDosSteps) &&
        segmentos.some((s) => c.startsWith(`${s}/`))
      ),
  );
  if (clinicos.length) motivos.push({ motivo: "caminho-clinico-fora-dos-outputs", caminhos: clinicos });
  return motivos;
}

export const SHA_PREFIXO_RE = /^[0-9a-f]{7,40}$/;

/**
 * `--aprovado` confere com a ponta: o SHA inteiro, ou prefixo de 7+ caracteres
 * da ponta que o git resolve sem ambiguidade para ela (P24 do ATRM-51).
 * Prefixo ambíguo no repositório não confere — o git não o resolve.
 * `resolver(prefixo)` é o `rev-parse` da casca (sha ou null), chamado só para prefixo.
 */
export function aprovadoConfere({ aprovado, ponta, resolver }) {
  if (!aprovado || !ponta) return false;
  const a = String(aprovado).trim().toLowerCase();
  if (!SHA_PREFIXO_RE.test(a) || !ponta.startsWith(a)) return false;
  return a.length === ponta.length || resolver(a) === ponta;
}

/**
 * A ponta buscada contra o aviso e o marcador: ponta diferente da avisada,
 * ponta igual ao marcador (nada trazido) e ponta que não descende do marcador
 * perguntam. `descende()` é o `merge-base --is-ancestor` da casca; null ⇒ segue.
 */
export function conferirPonta({ base, ponta, marcador, shaAvisado, descende }) {
  if (shaAvisado && !ponta.startsWith(shaAvisado)) return perguntar("ponta-diverge-do-aviso", { ...base, shaAvisado });
  if (ponta === marcador) return perguntar("sem-trabalho", base);
  if (descende() !== true) return perguntar("ponta-nao-descende-do-marcador", base);
  return null;
}

/**
 * O main só é buscado quando a faixa tem merge ou commit de fora do caminho
 * do marcador; a falha da busca vai junto da recusa, para rede caída não
 * parecer culpa da filha.
 */
export function precisaDoMain({ faixa, caminho, merges }) {
  return merges.length > 0 || faixa.some((c) => !caminho.has(c));
}

/**
 * Toda a faixa tem de descender do marcador: merge que puxa commit de fora
 * deixa `marcador..ponta` maior que o caminho de ancestralidade. Merge de
 * origin/main (C24 do VEGA-28: o plano da T9 do ATRM-52 mandava mesclar o
 * main): o que veio do main já está no main, revisado e mesclado por
 * proposta. Só ele é aceito fora do caminho do marcador; qualquer outro
 * commit de fora segue recusado, e merge só quando todo pai além do primeiro
 * está no main.
 *
 * Marca da condução só a maestra escreve: `lerMarcas` e `ultimaAutorizacao`
 * leem o histórico do HEAD, então uma marca trazida da filha (no subject ou
 * em linha do corpo) valeria como autorização ou conferência forjada. Do
 * main, conta o commit cujo SUBJECT é marca: é o que o `lerMarcas` leria.
 *
 * Da casca: `paisDoMerge(m)` (pais além do primeiro), `paiNoMain(p)` (ancestral
 * do main: true/false/null), `comMarca()` (Set dos commits com linha
 * `Conducao: `), `subjectDe(c)`.
 */
export function conferirFaixa({ base, faixa, caminho, merges, noMain, doMain, erroMain, paisDoMerge, paiNoMain, comMarca, subjectDe }) {
  const extra = erroMain ? { erroMain } : {};
  const fora = faixa.filter((c) => !caminho.has(c) && !noMain.has(c));
  if (fora.length) return perguntar("faixa-fora-do-marcador", { ...base, fora, ...extra });
  const mergeAlheio = merges.filter((m) => !doMain || paisDoMerge(m).some((p) => paiNoMain(p) !== true));
  if (mergeAlheio.length) return perguntar("faixa-com-merge", { ...base, merges: mergeAlheio, ...extra });
  const marcados = comMarca();
  const marcas = faixa.filter((c) => marcados.has(c) && (!noMain.has(c) || /^Conducao: /.test(subjectDe(c))));
  if (marcas.length) return perguntar("faixa-com-marca-da-conducao", { ...base, marcas });
  return null;
}

/**
 * Base do marcador no ramo; e cherry-pick não reproduz merge: com merge do
 * main, só fast-forward traz. `baseNoRamo` é o `merge-base --is-ancestor` da casca.
 */
export function conferirBase({ base, head, paiMarcador, baseNoRamo, merges }) {
  if (baseNoRamo !== true) return perguntar("base-do-marcador-fora-do-ramo", { ...base, baseMarcador: paiMarcador, head });
  if (merges.length && head !== paiMarcador)
    return perguntar("merge-do-main-exige-fast-forward", { ...base, merges, head, baseMarcador: paiMarcador });
  return null;
}

/**
 * O diff que pede pergunta parte sempre do diff cru `marcador..ponta`. Com
 * merge do main, sai só o caminho que o main mudou desde a base comum E que
 * na ponta está igual à ponta do main: o resto — inclusive arquivo que a
 * resolução do merge devolveu a uma versão velha — segue contando (review do
 * hotfix: `diff-tree --cc` escondia a resolução igual a um dos pais).
 * `blob(rev, caminho)` e `baseComum()` são da casca.
 */
export function caminhosDoDiff({ cru, merges, marcador, ponta, doMain, baseComum, blob }) {
  if (!merges.length) return cru;
  const bc = baseComum();
  // Sai só o que é mudança SÓ do main: o ciclo não mexeu no caminho desde a
  // base (marcador == base) e a ponta ficou igual ao main. Caminho que os dois
  // mudaram, resolvido pela versão do main, desfaz o ciclo e segue contando.
  return cru.filter((p) => {
    const naBase = blob(bc, p);
    const noMainAgora = blob(doMain, p);
    const soDoMain = blob(marcador, p) === naBase && naBase !== noMainAgora;
    return !(soDoMain && blob(ponta, p) === noMainAgora);
  });
}

/** O canonico do ciclo conta pelo diff cru, mesmo quando veio igual ao do main. */
export function comCanonico({ cru, caminhos, canonico }) {
  return cru.includes(canonico) && !caminhos.includes(canonico) ? [...caminhos, canonico] : caminhos;
}

/**
 * Diff que pede pergunta só traz com `--aprovado` que confere com a ponta;
 * `--aprovado` que veio e não confere diz por quê (P24 do ATRM-51): antes,
 * repetia a pergunta calado.
 */
export function exigirAprovacao({ base, ponta, aprovado, motivos, confere }) {
  if (!motivos.length || confere()) return null;
  if (aprovado) return perguntar("aprovado-nao-confere", { ...base, sha: ponta, aprovado, motivos });
  return perguntar("trazer-exige-aprovacao", { ...base, sha: ponta, motivos });
}

/** Fast-forward quando o HEAD é o pai do marcador, senão `cherry-pick -x marcador..ponta` (§2.2#23). */
export function modoDeTrazer({ head, paiMarcador }) {
  return head === paiMarcador ? "fast-forward" : "cherry-pick";
}

// ── conferir-carimbo ─────────────────────────────────────────────────────────

/** Veredito de carimbo que aprova: o começo do texto, antes de qualquer ressalva. Fora daqui ⇒ perguntar. */
const VEREDITO_APROVA_RE = /^["']?\s*(aprovad[oa]|approved?\b|verde\b|pass\b|pass-with-warnings\b|ready\b|0 critical)/i;

export function vereditoAprova(texto) {
  return VEREDITO_APROVA_RE.test(String(texto ?? "").trim());
}

// O `-x` acrescenta a linha no FIM da mensagem; uma igual no corpo é texto da filha.
const CHERRY_RE = /^\(cherry picked from commit ([0-9a-f]{40})\)$/gm;

/** SHA da última linha `(cherry picked from commit …)` do corpo, ou null. */
export function shaDoCherryPick(corpo) {
  return [...corpo.matchAll(CHERRY_RE)].at(-1)?.[1] ?? null;
}

/** Linha `veredito:` do carimbo, aparada; vazia quando não há. */
export function vereditoDoCarimbo(texto) {
  return /^veredito:[ \t]*(.*)$/m.exec(texto)?.[1]?.trim() ?? "";
}

/**
 * Desfecho do `conferir-carimbo` para o último commit não-prosa trazido
 * (`ultimo`, null ⇒ só prosa). Na casca: `corpo` do commit, `achar(sha)` (o
 * `acharCarimbo` sobre a árvore do HEAD) e `ler(caminho)`. Falta ou falha ⇒
 * `perguntar` (D-VEGA22-23).
 */
export function desfechoDoCarimbo({ base, ultimo, modo, corpo, achar, ler }) {
  if (!ultimo) return { ...base, desfecho: "so-prosa" };
  const texto = corpo();
  const shaFilha = modo === "cherry-pick" ? shaDoCherryPick(texto) : ultimo;
  if (!shaFilha) return perguntar("trazido-sem-cherry-picked-from", { ...base, commit: ultimo });
  const carimbo = achar(shaFilha);
  if (!carimbo) return perguntar("sem-carimbo", { ...base, sha: shaFilha });
  const veredito = vereditoDoCarimbo(ler(carimbo));
  if (!vereditoAprova(veredito)) return perguntar("carimbo-nao-aprova", { ...base, sha: shaFilha, carimbo, veredito });
  return { ...base, desfecho: "carimbado", sha: shaFilha, carimbo, veredito };
}

// ── registrar-conferencia ────────────────────────────────────────────────────

export const VERIFICACOES = new Set(["verde", "declarada-pos-merge"]);

/**
 * A dispensa de publicação (T16, AC-VEGA29-10): task que o plano liga a
 * publicação e fecha `nao-se-aplica` leva este trailer, com o papel de quem
 * dispensou. O `auditar` casa só ele; a frase dos commits já gravados é do
 * adaptador (`publicacao.frasesLegadas`), nunca do núcleo.
 */
export { TRAILER_DA_DISPENSA, PAPEL_DA_DISPENSA };
export const PUBLICACOES = new Set(["feita", "nao-se-aplica"]);

/** O uso que se confere antes de ler o plano. */
export function exigirUsoDaConferencia({ task, manual, maestra, publicacao }) {
  exigir(TASK_RE.test(task ?? ""), "uso", `task inválida: ${task}`);
  exigir(!(manual && maestra), "uso", "--manual e --maestra são exclusivos");
  exigir(PUBLICACOES.has(publicacao), "uso", `--publicacao feita|nao-se-aplica (veio ${publicacao})`);
}

/**
 * O que a conferência grava, contra a task `t` do plano congelado. Com
 * `manual`, fecha task de estação workstation feita à mão (sem filha); com
 * `maestra`, fecha task de estação maestra feita pela própria maestra; sem os
 * dois (`via: "filha"`), a casca lê o registro `trazida` e completa os
 * trailers por `trailersDaFilha`. A Verificação e a publicação têm de bater
 * com o plano: pós-merge declarado ⇒ `declarada-pos-merge`; task que cita
 * publicação ⇒ `feita`, ou `nao-se-aplica` com `sim` = o texto do operador, num
 * turno dele, dizendo que a task não publica — a citação vem de texto do
 * plano e pega também passo que só *menciona* o verbo (T7 do NODUS-4 imprime
 * a dica do deploy; ruling 18.7, T18). O texto vai no corpo do commit de
 * conferência. `feita` exige `sim` = o texto do operador, num turno dele,
 * autorizando a publicação daquela task: o sim da fase não cobre publicação
 * (F4.17), e é aqui que isso se confere.
 *
 * Conferência do operador (`caso`, de `casoDeConferencia`): com resposta por
 * arquivo, `approval()` devolve `{ caminho, verdict }` do arquivo no HEAD (ou
 * `{ caminho, verdict: undefined }` sem ele) e o não recusa; com resposta por
 * pergunta, sem `operador` (o texto do operador dizendo sim) a conferência
 * não grava e devolve a pergunta `conferencia-do-operador`.
 */
export function politicaDaConferencia({ task, t, verificacao, publicacao, manual = false, maestra = false, sim = null, sessao = null, approval, caso = null, operador = null, nomeDoOperador = "o operador" }) {
  const temPublicacao = t.publicacao.length > 0;
  const semPublicacaoComSim = temPublicacao && publicacao === "nao-se-aplica" && !manual && Boolean(sim && sim.trim());
  if (temPublicacao && publicacao !== "feita" && !semPublicacaoComSim)
    throw new ErroPlano(
      "publicacao-pendente",
      `${task} cita publicação (${t.publicacao.join(", ")}) — conferência só depois dela, ou --publicacao nao-se-aplica --sim <texto de ${nomeDoOperador} dizendo que a task não publica>`,
    );
  if (!temPublicacao && publicacao === "feita")
    throw new ErroPlano("publicacao-fora-do-plano", `${task} não cita publicação no plano congelado`);
  const publicadaComSim = publicacao === "feita" && Boolean(sim && sim.trim());
  if (publicacao === "feita" && !manual && !publicadaComSim)
    throw new ErroPlano(
      "sim-da-publicacao-ausente",
      `${task} publicou — --publicacao feita exige --sim <texto de ${nomeDoOperador} autorizando a publicação desta task> (o sim da fase não cobre publicação)`,
    );
  const temOperador = textoDoOperador(operador);
  exigir(
    !temOperador || (caso && !caso.arquivo),
    "operador-fora-da-conferencia",
    `${task} não é conferência do operador por pergunta — --operador é só para ela`,
  );
  const linhasDoCorpo = [
    semPublicacaoComSim ? `Sem publicação: ${sim.trim()}` : publicadaComSim ? `Publicada com o sim do operador: ${sim.trim()}` : null,
    temOperador ? `Conferida pelo operador: ${operador.trim()}` : null,
  ].filter(Boolean);
  const corpoDoSim = linhasDoCorpo.length ? { corpo: linhasDoCorpo.join("\n\n") } : {};
  // A dispensa é campo, com o papel de quem dispensou — nunca o nome (T16, AC-VEGA29-10).
  const dispensa = semPublicacaoComSim ? { [TRAILER_DA_DISPENSA]: PAPEL_DA_DISPENSA } : {};
  const subject = `Conducao: ${task} conferida`;

  if (manual) {
    exigir(t.estacao === "workstation", "manual-fora-de-workstation", `${task} é de estação ${t.estacao} — --manual é só para workstation`);
    exigir(sim && sim.trim(), "sim-ausente", `--manual exige o texto de ${nomeDoOperador} dizendo que a task terminou (--sim)`);
    return {
      via: "manual",
      subject,
      corpo: sim,
      trailers: { "Conducao-Task": task, "Conducao-Verificacao": "manual", "Conducao-Publicacao": publicacao },
      saida: { verificacao: "manual", publicacao },
    };
  }

  exigir(t.estacao !== "workstation", "workstation-sem-manual", `${task} é de estação workstation — fecha só com --manual`);
  exigir(VERIFICACOES.has(verificacao), "uso", `--verificacao verde|declarada-pos-merge (veio ${verificacao})`);
  const esperada = t.posMerge ? "declarada-pos-merge" : "verde";
  exigir(verificacao === esperada, "verificacao-diverge-do-plano", `${task} pede ${esperada}, veio ${verificacao}`);
  // Resposta por pergunta ainda sem o operador: nada grava, depois das recusas de estação.
  let pendente = null;
  if (caso?.arquivo) {
    const a = approval();
    const resposta = respostaDoArquivo(caso, a.verdict);
    exigir(
      resposta !== "nao",
      "approval-pede-rodada",
      `${a.caminho} está em ${a.verdict} — o operador disse não: a rodada fecha por --rodada nao, nunca pela conferência`,
    );
    // Só o sim declarado fecha: approval ausente ou com valor fora dos dois lados não é resposta.
    exigir(
      resposta === "sim",
      "approval-sem-resposta",
      `${a.caminho} ${a.verdict === undefined ? "não está no HEAD" : `tem verdict ${a.verdict ?? "ausente"}`} — só ${caso.sim.join("/")} fecha pela conferência`,
    );
  } else if (caso && !temOperador) pendente = perguntaDaConferencia({ task, marca: caso.marca });

  // Estação maestra: feita pela própria maestra na worktree do ciclo — sem
  // filha, sem referência de tentativa e sem trazida; a sessão gravada é a dela.
  if (maestra) {
    exigir(t.estacao === "maestra", "maestra-fora-da-estacao", `${task} é de estação ${t.estacao} — --maestra é só para estação maestra`);
    exigir(sessao, "sessao-ausente", "--maestra exige --sessao <id da sessão maestra>");
    if (pendente) return pendente;
    return {
      via: "maestra",
      subject,
      ...corpoDoSim,
      trailers: {
        "Conducao-Task": task,
        "Conducao-Executor": "maestra",
        "Conducao-Sessao-Maestra": sessao,
        "Conducao-Verificacao": verificacao,
        "Conducao-Publicacao": publicacao,
        ...dispensa,
      },
      saida: { executor: "maestra", verificacao, publicacao },
    };
  }
  exigir(t.estacao !== "maestra", "maestra-sem-flag", `${task} é de estação maestra — fecha só com --maestra`);
  if (pendente) return pendente;
  return { via: "filha", subject, ...corpoDoSim, dispensa, saida: { verificacao, publicacao } };
}

/** Sessão da filha: a passada agora, ou a gravada no `trazer`; nenhuma ⇒ erro. */
export function sessaoDaFilha({ task, sessao, r }) {
  const s = sessao ?? r.sessao;
  exigir(s, "sessao-ausente", `sessão da filha de ${task} ausente — passe --sessao no trazer ou aqui`);
  return s;
}

/** Trailers da conferência de task trazida de filha (`r` = registro `trazida`). */
export function trailersDaFilha({ task, r, sessaoFilha, verificacao, publicacao, dispensa = {} }) {
  return {
    "Conducao-Task": task,
    "Conducao-Sha-Filha": r.ponta,
    "Conducao-Sessao-Filha": sessaoFilha,
    "Conducao-Nonce": r.nonce,
    "Conducao-Verificacao": verificacao,
    "Conducao-Publicacao": publicacao,
    ...dispensa,
  };
}

// ── conferência do operador (T14, 7-a) ───────────────────────────────────────
//
// Task que só o operador confere (subir algo no celular, olhar uma tela): a
// filha faz a parte da máquina, o núcleo pergunta o resultado, e um não abre
// rodada nova — a tentativa seguinte da mesma task. A task se marca no
// `satisfies` com `(conferencia-do-operador)`, ou com uma marca que o
// adaptador declara em `conferencia`. A resposta vem de um de dois lugares:
//   - pergunta (a marca do núcleo, ou caso declarado sem `arquivo`): o núcleo
//     pergunta pela pergunta tipada; sim ⇒ `registrar-conferencia … --operador
//     <texto>`, não ⇒ `registrar-conferencia … --rodada nao --operador <texto>`;
//   - arquivo (caso declarado com `arquivo`, por exemplo um gate de UX): o
//     operador respondeu na sessão da filha, e o `verdict:` do arquivo na pasta
//     do ciclo é a resposta (`sim`/`nao` do caso). O rito A · B · C e a rodada
//     de carimbo são deste lugar: B conserta sem regravar o arquivo.

/**
 * O texto do operador (`--operador`) está presente? Vazio ou só espaço é
 * ausente; valor que começa por `--` é outra flag lida no lugar dele (o
 * `flag()` do CLI pega o argv seguinte), e recusa.
 */
export function textoDoOperador(operador) {
  const s = typeof operador === "string" ? operador.trim() : "";
  exigir(!s.startsWith("--"), "uso", `--operador sem texto (veio ${s}) — o valor é o texto do operador`);
  return s.length > 0;
}

/** O caso de conferência do operador da task `t` (null: task comum). A marca do núcleo vale em todo projeto. */
export function casoDeConferencia(t, casos = []) {
  const marcas = t?.marcas ?? [];
  if (marcas.includes(MARCA_DA_CONFERENCIA)) return { marca: MARCA_DA_CONFERENCIA };
  return casos.find((c) => marcas.includes(c.marca)) ?? null;
}

/** A resposta que o arquivo do caso dá: `sim`, `nao`, ou null (sem arquivo, ou valor fora dos dois lados). */
export function respostaDoArquivo(caso, verdict) {
  if (caso.sim.includes(verdict)) return "sim";
  if (caso.nao.includes(verdict)) return "nao";
  return null;
}

/** As duas opções da pergunta do resultado, as mesmas no `proximo` e na conferência. */
export function opcoesDaConferencia(task) {
  return [
    { id: "sim", texto: `conferido: registrar-conferencia ${task} … --operador <texto do operador>` },
    { id: "nao", texto: `nova rodada: registrar-conferencia ${task} --rodada nao --operador <texto do operador>` },
  ];
}

/** A pergunta do resultado ao operador (por pergunta). Sem recomendada: só o operador sabe. */
export function perguntaDaConferencia({ task, marca, ...campos }) {
  return perguntar("conferencia-do-operador", { ...campos, task, marca, opcoes: opcoesDaConferencia(task) });
}

// ── rito de rodadas (`--rodada`) ─────────────────────────────────────────────

/** `nao` é o não do operador; `needs-rework` é o mesmo não, no nome do `/live-ux-gate`; `carimbo` fecha a B só de carimbo. */
export const RODADAS = new Set(["nao", "needs-rework", "carimbo"]);
/** Teto de rodadas (task-brief.mjs `contratoDeRodadas`): o 3º não escala ao operador, nunca abre a 4ª. */
export const TETO_RODADAS_GATE = 3;

/**
 * Frontmatter do `live-ux-gate-approval.md`: `verdict` e `rodada` (ausente
 * conta como 1, como no rito). `rodada` que não é inteiro positivo sai `NaN`.
 */
export function lerApproval(texto) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(texto ?? ""))?.[1];
  if (fm === undefined) return { verdict: null, rodada: null };
  const verdict = /^verdict:[ \t]*["']?([A-Z_]+)["']?[ \t]*$/m.exec(fm)?.[1] ?? null;
  const bruta = /^rodada:[ \t]*(.*?)[ \t]*$/m.exec(fm)?.[1];
  const rodada = bruta === undefined ? 1 : /^[1-9]\d*$/.test(bruta) ? Number(bruta) : Number.NaN;
  return { verdict, rodada };
}

/** O uso de `--rodada`, antes de ler o plano. */
export function exigirUsoDaRodada({ task, rodada }) {
  exigir(TASK_RE.test(task ?? ""), "uso", `task inválida: ${task}`);
  exigir(RODADAS.has(rodada), "uso", `--rodada nao|needs-rework|carimbo (veio ${rodada})`);
}

/**
 * Só task de conferência do operador (`caso`) tem rodada; a de carimbo, só
 * com resposta por arquivo; `--operador` só com resposta por pergunta, onde
 * ele é obrigatório (o não é do operador, nunca da maestra).
 */
export function exigirTaskDeRodada({ task, caso, rodada = "nao", operador = null }) {
  exigir(caso, "rodada-fora-da-conferencia", `${task} não é conferência do operador no plano congelado — --rodada é só da task que o operador confere`);
  if (caso.arquivo) {
    exigir(!textoDoOperador(operador), "uso", `${task} lê a resposta do operador em ${caso.arquivo} — --operador não se aplica`);
    return;
  }
  exigir(rodada !== "carimbo", "uso", `${task} pergunta o resultado ao operador — --rodada carimbo é só do caso com arquivo`);
  exigir(textoDoOperador(operador), "operador-ausente", `--rodada ${rodada} em ${task} exige --operador <texto do operador dizendo não>`);
}

/** O arquivo do caso lido no HEAD (`a`, null sem ele) tem de dizer não e ter `rodada:` válida. */
export function exigirApprovalDeRodada({ caminho, a, caso }) {
  exigir(a, "approval-ausente", `${caminho} não está no HEAD — sem approval não há rodada a registrar`);
  exigir(
    respostaDoArquivo(caso, a.verdict) === "nao",
    "approval-nao-pede-rodada",
    `${caminho} tem verdict ${a.verdict ?? "ausente"} — só ${caso.nao.join("/")} é rodada; ${caso.sim.join("/")} fecha pela conferência verde`,
  );
  exigir(Number.isInteger(a.rodada), "approval-rodada-invalida", `${caminho} tem \`rodada:\` que não é inteiro positivo`);
}

/**
 * `needs-rework` contra o rito: contador independente do approval — A e C
 * emitem rodada, B não; depois de k marcas `rodada` da task (`anteriores`),
 * o approval da vez tem de dizer floor(k/2)+1. Approval que não andou (C sem
 * regravar) ou que recuou pergunta ao operador, e o teto conta pelas marcas mesmo
 * se o approval mentir. null ⇒ a rodada se grava.
 */
export function conferirRodada({ base, anteriores, rodadaDoApproval, ref }) {
  const esperada = Math.floor(anteriores / 2) + 1;
  if (rodadaDoApproval >= TETO_RODADAS_GATE || esperada >= TETO_RODADAS_GATE)
    return perguntar("teto-de-rodadas", { ...base, teto: TETO_RODADAS_GATE, ref });
  if (rodadaDoApproval !== esperada) return perguntar("approval-fora-do-rito", { ...base, rodadaEsperada: esperada, ref });
  return null;
}

/**
 * Rodada por pergunta: cada não é uma rodada, contada pelas marcas
 * (`anteriores`). O não que seria o 3º pergunta ao operador e não abre a 4ª.
 */
export function conferirRodadaPorPergunta({ base, anteriores, ref }) {
  if (anteriores + 1 >= TETO_RODADAS_GATE) return perguntar("teto-de-rodadas", { ...base, teto: TETO_RODADAS_GATE, ref });
  return null;
}

/** Trailers da marca `Conducao: T<k> tentativa <n> rodada|carimbo`; sem arquivo (por pergunta), sem `Conducao-Rodada-Approval`. */
export function trailersDaRodada({ task, r, sessaoFilha, rodada, rodadaDoApproval }) {
  return {
    "Conducao-Task": task,
    "Conducao-Sha-Filha": r.ponta,
    "Conducao-Sessao-Filha": sessaoFilha,
    "Conducao-Nonce": r.nonce,
    "Conducao-Rodada": rodada,
    ...(rodadaDoApproval === undefined ? {} : { "Conducao-Rodada-Approval": String(rodadaDoApproval) }),
  };
}


/** Saída de `git log --format= --name-status --no-renames` em `{ status, caminho }`. */
export function mudancasDoLog(texto) {
  return texto
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("\t");
      return { status: l.slice(0, i), caminho: l.slice(i + 1) };
    });
}

/**
 * `--rodada carimbo`: a tentativa trazida só acrescentou carimbo — a rodada B
 * refeita para carimbar o conserto que o cherry-pick re-shaou (carimbo órfão,
 * F4 do ATRM-51). Todo arquivo da faixa trazida (`mudancas`, por commit: o
 * mudado e desfeito também conta) tem de ser carimbo acrescentado ou alterado
 * num destino do carimbo do adaptador (`codigo.carimbo.ehCarimbo`, com
 * `notas` = a pasta de carimbos do ciclo); qualquer outro, ou carimbo
 * apagado, recusa — código no meio é rodada B de verdade, por `needs-rework`.
 * Devolve os carimbos, ordenados.
 */
export function carimbosDaFaixa({ task, tentativa, mudancas, notas, codigo = codigoDoNucleo() }) {
  exigir(codigo.carimbo, "sem-carimbo-no-adaptador", `${task}: --rodada carimbo, mas o adaptador não declara carimbo`);
  const ehCarimbo = (p) => codigo.carimbo.ehCarimbo(p, notas);
  const fora = [...new Set(mudancas.filter((m) => !(ehCarimbo(m.caminho) && (m.status === "A" || m.status === "M"))).map((m) => `${m.status} ${m.caminho}`))];
  exigir(
    fora.length === 0,
    "rodada-carimbo-fora-do-carimbo",
    `${task} tentativa ${tentativa} muda mais que carimbo (${fora.join(", ")}) — --rodada carimbo é só para tentativa que acrescenta carimbo; o resto fecha por --rodada needs-rework`,
  );
  const carimbos = [...new Set(mudancas.map((m) => m.caminho))].sort();
  exigir(carimbos.length > 0, "rodada-carimbo-sem-carimbo", `${task} tentativa ${tentativa} não traz arquivo nenhum — nada a registrar como carimbo`);
  return carimbos;
}

/**
 * O carimbo trazido tem de cobrir o conserto: o último commit de código do
 * HEAD (`conserto`), com `sha:` e reviewer válidos (`cobre`, o `acharCarimbo`
 * da casca). Carimbo de sha alheio fecharia a tentativa e o rito refaria a B de novo.
 */
export function exigirCarimboDoConserto({ carimbos, conserto, cobre }) {
  exigir(
    cobre,
    "rodada-carimbo-nao-cobre-o-conserto",
    `nenhum carimbo trazido (${carimbos.join(", ")}) cobre o último commit de código do HEAD (${conserto ?? "nenhum"})`,
  );
}
