/**
 * regras.mjs — regras nomeadas da decisão do `proximo` (VEGA-29 T6, T7).
 *
 * Cada regra é `(ctx) => ação | null`: devolve a ação que decide ou null para
 * a seguinte falar. Puras, sem git nem fs. `decidir` (conducao.mjs) fica só
 * com a lista ordenada delas (`ORDEM_DAS_REGRAS`) e o laço: monta o contexto
 * por `contextoDaDecisao` e devolve a primeira ação. A ordem é o contrato —
 * as de mais adiante assumem que as anteriores calaram (a fase em curso já
 * autorizada, a vigia já preencheu `reabrir`).
 *
 * Campos do contexto (os de `contextoDaDecisao`):
 *   ciclo, head, planoBlob — o que toda ação carrega;
 *   acao(tipo, alvo, tentativa, campos) — monta a ação com o nonce do HEAD;
 *   nonce, lerAviso e os auxiliares do plano (`diferencaDoPlano`,
 *     `mudancasQuePerguntam`, `mudancasDeAlcance`, `rulingDoReplano`,
 *     `tasksQueMudaramDeClasse`, `textoDaProximaSessao`, `textoDoFechamento`)
 *     — os de conducao.mjs e ler-plano.mjs, injetados para o núcleo não
 *     importar o CLI;
 *   e os campos próprios de cada regra, no comentário dela.
 */

function intersecta(a, b) {
  return a.some((x) => b.includes(x));
}

/**
 * Rede de arquivamento (D-VEGA22-25), antes de toda outra ação — libera a
 * vaga do teto antes de abrir. Só filha que avisou e cuja tentativa já foi
 * decidida (conferida, falha gravada ou revertida): sem aviso ela pode estar
 * empurrando. O nonce não depende do HEAD, para a mesma sessão e tentativa
 * darem sempre o mesmo `arquivar`; `arquivamentos` é a lista de nonces de
 * `arquivar` que a maestra já executou nela.
 *
 * Lê: `filhas` (com `estado` já normalizado), `decididos` (Set de nonces).
 */
export function regraArquivar(ctx) {
  const { ciclo, head, planoBlob, acao, nonce, lerAviso, filhas, decididos } = ctx;
  for (const f of filhas) {
    if (f.estado === "ARCHIVED" || !f.sessao) continue;
    const a = lerAviso(f.aviso);
    if (!a || a.nonce !== f.nonce || !decididos.has(a.nonce)) continue;
    const n = nonce(ciclo, `arquivar:${f.sessao}`, a.nonce, "");
    const campos = { sessao: f.sessao, task: a.task, tentativa: f.tentativa ?? null, nonceTentativa: a.nonce, aviso: a.tipo };
    const vezes = (Array.isArray(f.arquivamentos) ? f.arquivamentos : []).filter((x) => x === n).length;
    if (vezes >= 2) return acao("perguntar", `arquivar:${f.sessao}`, a.nonce, { ...campos, motivo: "falha-de-arquivamento", nonceArquivar: n, vezes });
    return { acao: "arquivar", nonce: n, ciclo, head, plano: planoBlob, ...campos };
  }
  return null;
}

/**
 * Trazer vence as perguntas da vigia: a primeira tentativa em voo, na ordem
 * das tasks da fase, com marcador válido e aviso `T<k>-OK` da filha dela.
 *
 * Lê: `fase`, `voo` (`[{ t, r }]` — task do plano e tentativa em voo), `filhas`.
 */
export function regraTrazer(ctx) {
  const { acao, lerAviso, fase, voo, filhas } = ctx;
  for (const { t, r } of voo) {
    if (!r.nonce) continue;
    const ok = filhas
      .filter((f) => f.nonce === r.nonce)
      .map((f) => ({ f, a: lerAviso(f.aviso) }))
      .find(({ a }) => a && a.task === t.id && a.nonce === r.nonce && a.tipo === "OK");
    if (!ok) continue;
    return acao("trazer", t.id, r.tentativa, {
      fase: fase.id,
      task: t.id,
      tentativa: r.tentativa,
      nonceTentativa: r.nonce,
      sha: ok.a.arg,
      sessao: ok.f.sessao ?? null,
      ref: r.ref,
      // Subpasso Publicar: o sim da fase não cobre a publicação (F4.17).
      publicacao: t.publicacao,
      simParaPublicar: t.publicacao.length > 0,
    });
  }
  return null;
}

/**
 * Vagas para abrir: o menor entre a largura do ciclo menos as tentativas em
 * voo ativas e o teto da ponte menos as filhas vivas.
 *
 * Lê: `filhas`, `tetoPonte` (da entrada, ou null), `tetoPadrao`, `largura`, `vooAtivo`.
 */
export function vagasDoTeto({ filhas, tetoPonte, tetoPadrao, largura, vooAtivo }) {
  const vivas = filhas.filter((f) => f.estado !== "ARCHIVED").length;
  const teto = Number.isInteger(tetoPonte) ? tetoPonte : tetoPadrao;
  const vagas = Math.max(0, Math.min(largura - vooAtivo.length, teto - vivas));
  return { vivas, teto, vagas };
}

/**
 * Abrir as tasks de servidor prontas que cabem nas vagas, sem Outputs em
 * comum com as em voo nem entre si; as a reabrir vêm na frente de `servidor`.
 * Task sensível sem o sim da fase nem aprovação pelo nonce da tentativa
 * pergunta antes de abrir.
 *
 * Lê: `plano` (`fases`, `porId`, `largura`), `fase`, `servidor`, `vooAtivo`,
 * `reabrir` (Map task → tentativa que caiu), `maxTent` (Map task → última
 * tentativa), `filhas`, `tetoPonte`, `tetoPadrao`, `cobertaPelaFase`,
 * `aprovacoes`, `ultimaAutorizacao`.
 */
export function regraAbrir(ctx) {
  const { ciclo, head, acao, nonce, plano, fase, servidor, vooAtivo, reabrir, maxTent, cobertaPelaFase, aprovacoes, ultimaAutorizacao } = ctx;
  const { vivas, teto, vagas } = vagasDoTeto({ ...ctx, largura: plano.largura });

  const ocupados = vooAtivo.flatMap(({ t }) => t.outputs);
  const selecionadas = [];
  for (const t of servidor) {
    if (selecionadas.length >= vagas) break;
    if (intersecta(t.outputs, ocupados)) continue;
    selecionadas.push(t);
    ocupados.push(...t.outputs);
  }
  if (!selecionadas.length) return null;

  const fase0 = plano.fases.find((f) => f.id === fase.id);
  const tarefas = selecionadas.map((t) => {
    const tentativa = (maxTent.get(t.id) ?? 0) + 1;
    const anterior = reabrir.get(t.id);
    return {
      task: t.id,
      tentativa,
      nonce: nonce(ciclo, t.id, tentativa, head),
      modelo: fase0.modelo,
      prazoMin: t.prazoMin,
      posMerge: t.posMerge,
      classe: t.classe,
      // `abrir --falhou <n> --coberta <sim|nao>` grava a falha antes do marcador.
      ...(anterior ? { falhaAnterior: anterior } : {}),
    };
  });
  const avisoLeo = tarefas
    .filter((x) => x.falhaAnterior?.coberta === "sim")
    .map((x) => `${x.task} tentativa ${x.falhaAnterior.tentativa} caiu no reinício da ponte; reaberta como ${x.tentativa}, sem contar falha`);
  const pendente = cobertaPelaFase
    ? null
    : tarefas.find((x) => x.classe === "sensivel" && !aprovacoes.some((a) => a.task === x.task && a.nonce === x.nonce));
  if (pendente) {
    const t = plano.porId.get(pendente.task);
    return acao("perguntar", t.id, pendente.tentativa, {
      motivo: "task-sensivel",
      fase: fase.id,
      task: t.id,
      tentativa: pendente.tentativa,
      publicacao: t.publicacao,
      caminhosClinicos: t.clinica,
    });
  }
  const alvo = tarefas.map((x) => x.task).join("+");
  const sensiveis = tarefas.filter((x) => x.classe === "sensivel").map((x) => x.task);
  return acao("abrir", alvo, tarefas.map((x) => x.tentativa).join("+"), {
    fase: fase.id,
    tarefas,
    ...(sensiveis.length && cobertaPelaFase ? { cobertasPelaFase: { autorizacao: ultimaAutorizacao.sha, tasks: sensiveis } } : {}),
    largura: { prontas: servidor.length, ciclo: plano.largura, teto, vivas, emVoo: vooAtivo.length, abertas: tarefas.length },
    ...(avisoLeo.length ? { avisoLeo } : {}),
  });
}

// ── o contexto ──────────────────────────────────────────────────────────────

/**
 * Veredito do CI lido pela maestra, só quando é do HEAD: `verde` · `vermelho`
 * · null (ausente, em curso, de outro sha ou fora da forma `{ sha, veredito, run }`).
 */
function ciDoHead(ci, head) {
  if (!ci || typeof ci !== "object") return null;
  if (typeof ci.sha !== "string" || ci.sha.length < 7 || !head.startsWith(ci.sha)) return null;
  return ci.veredito === "verde" || ci.veredito === "vermelho" ? ci.veredito : null;
}

/**
 * O veredito que fecha fase e ciclo (T15, 5-a). Projeto com CI (`temCi`, o
 * default do adaptador): o do CI no HEAD. Projeto sem CI (`ci: false` no
 * adaptador): a Verificação da última tarefa — quem chama só pergunta depois
 * do fechamento conferido, e a conferência só grava com a Verificação verde
 * (vermelha reverte o trazido), então o veredito é `verde` sem esperar run.
 */
function vereditoDoFechamento(ctx) {
  if (ctx.temCi === false) return "verde";
  return ciDoHead(ctx.entrada.ci, ctx.head);
}

/**
 * O fechamento que conta numa fase (T27 passo 5): o último dela no plano, e as
 * tasks que vêm depois dele — fase reaberta cujo re-plano não trouxe
 * fechamento novo deixa task depois do fechamento já conferido.
 */
function fechamentoDaFase(plano, fase) {
  const tasks = fase.tasks.map((id) => plano.porId.get(id));
  const i = tasks.findLastIndex((t) => t.fechamento);
  return i < 0 ? null : { task: tasks[i], depois: tasks.slice(i + 1).map((t) => t.id) };
}

/**
 * O contexto da decisão: os parâmetros do `decidir` com nome (`params`), os
 * auxiliares injetados (`injetados`) e o que se deriva deles sem decidir nada.
 * `plano` é o congelado na última autorização; `planoHead` é o do HEAD, usado
 * só para a pergunta de (re)autorização; `diffPlano` é o `git diff` entre os
 * dois blobs, quando diferem. `agora` e `reinicioEm` são epoch em segundos (ou
 * null): o relógio da vigia e a hora do último reinício da ponte (T12).
 * `replanos` são os commits (`{ sha, subject }`) que mexeram no canonico entre
 * a última autorização e o HEAD — null quando o canonico mudou de caminho;
 * decidem a herança da autorização pelo re-plano de ruling (F4.17).
 *
 * `reabrir` (task → `{ tentativa, coberta, motivo }` da tentativa que caiu)
 * nasce vazio e é a `regraVigia` que o preenche; `vooAtivo`, `servidor`,
 * `workstation` e `daMaestra` são lidos depois dela.
 */
export function contextoDaDecisao(params, injetados) {
  const { estado, entrada, autorizacoes, plano, planoHead, planoHeadBlob, planoBlob, replanos, ciclo, reconhecer, autorizacaoDoCiclo, encerradas } = params;
  const { estadoDaFilha, mudancasQuePerguntam, mudancasDeAlcance, rulingDoReplano } = injetados;
  // `statusBucket` é o de `get_session` (`BLOCKED`, `FAILED`, …), normalizado como o estado.
  const filhas = (Array.isArray(entrada.filhas) ? entrada.filhas : []).map((f) => ({
    ...f,
    estado: estadoDaFilha(f?.estado),
    ...(f?.statusBucket !== undefined ? { statusBucket: estadoDaFilha(f.statusBucket) } : {}),
  }));
  const aprovacoes = Array.isArray(entrada.aprovacoes) ? entrada.aprovacoes : [];
  const trazidas = estado.trazidas ?? new Map();

  // O sim do operador ao ciclo (`autorizar-ciclo`, ruling de 27/10/2026): vale para
  // toda fase enquanto nenhuma task mudar de classe ou sensibilidade em relação
  // ao plano congelado nele. Os gates seguem pedindo: publicação por task, task
  // sensível de fase herdada pelo ciclo (por nonce), perguntas da vigia.
  const cicloCobre = Boolean(
    autorizacaoDoCiclo && planoHead && planoHeadBlob && !mudancasQuePerguntam(autorizacaoDoCiclo.plano, planoHead).length,
  );
  // Plano mudado desde a última autorização sem ser por ruling: o sim do ciclo
  // só o cobre sem mudança de alcance (`mudancasDeAlcance`).
  const replanoSoDeRuling =
    !planoHeadBlob || planoHeadBlob === planoBlob || (Array.isArray(replanos) && replanos.length > 0 && replanos.every((c) => rulingDoReplano(c.subject, ciclo, reconhecer)));
  const semMudarAlcance = !planoHead || !mudancasDeAlcance(plano, planoHead).length;

  const autorizadas = new Set(autorizacoes.map((a) => a.fase));
  // Fase autorizada mais de uma vez: só ela pode estar reaberta (T27). Plano
  // antigo com task depois do fechamento, autorizado uma vez, segue como antes.
  // A herdada (F4.17) não reabre fase: é a mesma autorização sob o plano novo.
  const vezesAutorizada = new Map();
  for (const a of autorizacoes) if (!a.herdada) vezesAutorizada.set(a.fase, (vezesAutorizada.get(a.fase) ?? 0) + 1);
  const reautorizada = (id) => (vezesAutorizada.get(id) ?? 0) > 1 && !encerradas.has(id);
  const iPrimeira = plano.fases.findIndex((f) => autorizadas.has(f.id));

  // Fases antes da primeira autorizada ficaram fora da condução (feitas à mão).
  const foraDaConducao = new Set(plano.fases.slice(0, Math.max(iPrimeira, 0)).flatMap((f) => f.tasks));
  const feita = (t) => estado.feitas.has(t) || foraDaConducao.has(t);
  const fase = iPrimeira < 0 ? null : plano.fases.slice(iPrimeira).find((f) => f.tasks.some((t) => !feita(t))) ?? null;
  const tasks = fase ? fase.tasks.map((id) => plano.porId.get(id)) : [];

  // O sim do operador à fase (F4.17, ruling de 23/10/2026): a última autorização é
  // a da fase em curso, e o plano congelado nela é o que a condução lê. Cobre
  // as tasks sensíveis da fase em toda tentativa; plano mudado nas tasks já
  // parou antes (`plano-mudou`) ou herdou (`herdar-autorizacao`).
  const ultimaAutorizacao = autorizacoes.at(-1) ?? null;
  const daFase = Boolean(fase) && ultimaAutorizacao?.fase === fase.id;
  // Só cobre as tasks sensíveis o sim dado a ESTA fase: a autorização herdada
  // aponta (`Conducao-Herdada`) a marca com o sim, e a herdada pelo sim do
  // ciclo aponta a marca de outra fase — a task sensível dela pergunta por nonce.
  const autoridade = ultimaAutorizacao?.herdada
    ? autorizacoes.find((a) => a.sha === ultimaAutorizacao.herdada) ?? null
    : ultimaAutorizacao;
  const cobertaPelaFase = daFase && autoridade?.fase === fase.id;

  const voo = tasks.filter((t) => estado.emVoo.has(t.id)).map((t) => ({ t, r: estado.emVoo.get(t.id) }));
  const reabrir = new Map();
  // Conjunto pronto (T6 passo 4), com as tasks a reabrir na frente. A tentativa
  // que caiu deixa de ocupar vaga e saídas: a nova toma o lugar dela.
  const prontas = () =>
    tasks.filter((t) => !feita(t.id) && (!estado.emVoo.has(t.id) || reabrir.has(t.id)) && !t.fechamento && t.deps.every(feita));

  return {
    ...params,
    ...injetados,
    filhas,
    aprovacoes,
    trazidas,
    decididos: estado.decididos ?? new Set(),
    cicloCobre,
    replanoSoDeRuling,
    semMudarAlcance,
    autorizadas,
    reautorizada,
    iPrimeira,
    feita,
    fase,
    tasks,
    ultimaAutorizacao,
    daFase,
    cobertaPelaFase,
    voo,
    reabrir,
    maxTent: estado.maxTent,
    tetoPonte: entrada.tetoPonte,
    get vooAtivo() {
      return voo.filter(({ t }) => !reabrir.has(t.id));
    },
    get servidor() {
      const p = prontas();
      return [...p.filter((t) => reabrir.has(t.id)), ...p.filter((t) => !reabrir.has(t.id))].filter((t) => t.estacao === "servidor");
    },
    get workstation() {
      return prontas().filter((t) => t.estacao === "workstation");
    },
    get daMaestra() {
      return prontas().filter((t) => t.estacao === "maestra");
    },
  };
}

/** Fase em curso já autorizada: as regras de dentro da fase só falam nela. */
function emCurso(ctx) {
  return Boolean(ctx.fase) && ctx.autorizadas.has(ctx.fase.id);
}

// ── perguntar pelo plano ────────────────────────────────────────────────────

/**
 * Pergunta de plano mudado, uma forma só para o re-plano no meio da fase
 * (T22) e a fase reaberta (T27); `ids` são as tasks da fase cujas trazidas
 * a pergunta lista.
 */
function perguntaDoPlano(ctx, faseId, ids, tasksMudadas, campos = {}) {
  const { acao, plano, planoHead, planoHeadBlob, planoBlob, diffPlano, trazidas, tasksQueMudaramDeClasse } = ctx;
  return acao("perguntar", `plano:${faseId}`, 0, {
    motivo: "plano-mudou",
    fase: faseId,
    planoNovo: planoHeadBlob,
    planoAnterior: planoBlob,
    ...(diffPlano ? { diffPlano } : {}),
    tasksMudadas,
    mudaramDeClasse: tasksQueMudaramDeClasse(plano, planoHead),
    // Tentativa trazida e ainda sem conferência: o passo da maestra e a
    // conferência dela vêm depois da reautorização (skill §3).
    trazidas: ids
      .filter((id) => trazidas.has(id))
      .map((id) => {
        const r = trazidas.get(id);
        return { task: id, tentativa: r.tentativa, nonceTentativa: r.nonce, ref: r.ref };
      }),
    ...campos,
  });
}

/**
 * Fase reaberta por task nova (T27, D-VEGA22-34): a fase autorizada com o
 * último fechamento conferido e sem `Conducao-Encerrada` que ganha, no plano
 * do HEAD, task nascida nela e não feita volta pela pergunta de plano —
 * antes do CI, do `encerrar-sessao` e do `fechar-ciclo`. Task removida,
 * dependência, classe ou Outputs mudados sem task nova não reabrem.
 */
function reabrirFase(ctx, cand) {
  const { autorizadas, encerradas, plano, planoHead, planoHeadBlob, planoBlob, estado, diferencaDoPlano } = ctx;
  if (!cand || !autorizadas.has(cand.id) || encerradas.has(cand.id)) return null;
  if (!planoHead || !planoHeadBlob || planoHeadBlob === planoBlob) return null;
  const fech = fechamentoDaFase(plano, cand);
  if (!fech || !estado.feitas.has(fech.task.id)) return null;
  const tasksMudadas = diferencaDoPlano(plano, planoHead);
  const nascidas = tasksMudadas
    .filter((d) => d.mudou === "nasceu" && !estado.feitas.has(d.task))
    .map((d) => planoHead.porId.get(d.task))
    .filter((t) => t.fase === cand.id);
  if (!nascidas.length) return null;
  const ids = planoHead.fases.find((f) => f.id === cand.id)?.tasks ?? [];
  // O `/intra-plan` exige que toda fase termine em fechamento.
  const semFechamento = !nascidas.some((t) => t.fechamento);
  return perguntaDoPlano(ctx, cand.id, ids, tasksMudadas, {
    reaberta: true,
    ...(semFechamento ? { motivo: "fase-reaberta-sem-fechamento" } : {}),
  });
}

/**
 * Fase reaberta e reautorizada cujas tasks novas ficaram depois do último
 * fechamento: o fechamento conferido é o velho, e não encerra a fase.
 */
function semFechamentoNovo(ctx, f, alvo, campos = {}) {
  const { acao, plano, estado, reautorizada } = ctx;
  const fech = fechamentoDaFase(plano, f);
  if (!reautorizada(f.id) || !fech || !estado.feitas.has(fech.task.id) || !fech.depois.length) return null;
  return acao("perguntar", alvo, 0, { motivo: "fase-reaberta-sem-fechamento", fase: f.id, task: fech.task.id, depois: fech.depois, ...campos });
}

// ── antes da fase ───────────────────────────────────────────────────────────

/** Nenhuma fase do plano autorizada: a autorização veio de fora dele. Lê: `iPrimeira`, `autorizadas`. */
export function regraFaseForaDoPlano(ctx) {
  const { acao, iPrimeira, autorizadas } = ctx;
  if (iPrimeira >= 0) return null;
  return acao("perguntar", "ciclo", 0, { motivo: "fase-autorizada-fora-do-plano", fases: [...autorizadas] });
}

/**
 * Sem fase restante (T22): o fechamento do ciclo sai numa sessão limpa do
 * `/close-cycle`, aberta pelo texto que esta entrega — nunca `perguntar
 * squash` aqui; o squash é perguntado dentro do `/close-cycle` (D-SC7-2).
 *
 * Lê: `fase`, `iPrimeira`, `plano`, `autorizadas`, `encerradas`, `entrada`
 * (`proposta`, `ci`, `sessaoMaestra`), `repo`, `temCi`.
 */
export function regraFecharCiclo(ctx) {
  const { ciclo, acao, repo, plano, entrada, encerradas, autorizadas, iPrimeira, fase, textoDoFechamento } = ctx;
  if (iPrimeira < 0 || fase) return null;
  const conduzidas = plano.fases.slice(iPrimeira).filter((f) => autorizadas.has(f.id)).map((f) => f.id);
  const proposta = entrada.proposta && typeof entrada.proposta === "object" ? entrada.proposta : null;
  const campos = { fase: "ciclo", ultimaFase: plano.fases.at(-1).id, conduzidas, ci: entrada.ci ?? null, proposta };
  if (proposta?.state === "MERGED") return acao("esperar", "fechar:ciclo", 0, { ...campos, motivo: "mesclado" });
  if (encerradas.has("ciclo")) return acao("esperar", "fechar:ciclo", 0, { ...campos, motivo: "close-cycle-em-sessao-limpa" });
  const ultima = plano.fases.at(-1);
  const reaberta = reabrirFase(ctx, ultima) ?? semFechamentoNovo(ctx, ultima, "fechar:ciclo", { ultimaFase: ultima.id });
  if (reaberta) return reaberta;
  const veredito = vereditoDoFechamento(ctx);
  if (!veredito) return acao("esperar", "fechar:ciclo", 0, { ...campos, motivo: "ci-pendente" });
  if (veredito === "vermelho") return acao("perguntar", "fechar:ciclo", 0, { ...campos, motivo: "ci-vermelho" });
  // Encerramentos exigidos: os das fases já gravados no ramo e o do ciclo,
  // que a maestra grava ao executar esta ação — a auditoria do Ato A confere
  // que nenhum sumiu. Fase conduzida antes da T21 não tem marca: fica fora.
  const exigirEncerramentos = [...plano.fases.map((f) => f.id).filter((id) => encerradas.has(id)), "ciclo"];
  return acao("fechar-ciclo", "fechar:ciclo", 0, {
    ...campos,
    texto: textoDoFechamento({ ciclo, repo, sessao: entrada.sessaoMaestra ?? null, conduzidas, exigirEncerramentos }),
  });
}

/**
 * Uma fase por sessão maestra (D-VEGA22-31, T21): a fase anterior conduzida
 * com o fechamento conferido e sem a marca `Conducao-Encerrada` dela fecha a
 * sessão antes do pedido de autorização da fase seguinte — só com o CI verde
 * no HEAD, lido pela maestra. O fechamento que conta é o último da fase (T27):
 * o de uma fase reaberta só encerra quando o fechamento novo for conferido.
 *
 * Lê: `fase` (ainda não autorizada), `iPrimeira`, `plano`, `autorizadas`,
 * `estado.feitas`, `encerradas`, `entrada` (`ci`, `sessaoMaestra`), `cicloCobre`, `temCi`.
 */
export function regraEncerrarSessao(ctx) {
  const { ciclo, acao, repo, plano, estado, entrada, encerradas, autorizadas, iPrimeira, fase, cicloCobre, textoDaProximaSessao } = ctx;
  if (!fase || autorizadas.has(fase.id)) return null;
  const iFase = plano.fases.indexOf(fase);
  const anterior = iFase > iPrimeira ? plano.fases[iFase - 1] : null;
  const ultimoAnterior = anterior && autorizadas.has(anterior.id) ? fechamentoDaFase(plano, anterior)?.task : null;
  const fechamentoAnterior = ultimoAnterior && estado.feitas.has(ultimoAnterior.id) ? ultimoAnterior : null;
  if (!fechamentoAnterior || encerradas.has(anterior.id)) return null;
  const reaberta = reabrirFase(ctx, anterior) ?? semFechamentoNovo(ctx, anterior, `encerrar:${anterior.id}`, { faseSeguinte: fase.id });
  if (reaberta) return reaberta;
  const ci = entrada.ci && typeof entrada.ci === "object" ? entrada.ci : null;
  const veredito = vereditoDoFechamento(ctx);
  const campos = { fase: anterior.id, faseSeguinte: fase.id, task: fechamentoAnterior.id, ci };
  if (!veredito) return acao("esperar", `encerrar:${anterior.id}`, 0, { ...campos, motivo: "ci-pendente" });
  if (veredito === "vermelho") return acao("perguntar", `encerrar:${anterior.id}`, 0, { ...campos, motivo: "ci-vermelho" });
  return acao("encerrar-sessao", `encerrar:${anterior.id}`, 0, {
    ...campos,
    texto: textoDaProximaSessao({ ciclo, fase: fase.id, repo, sessao: entrada.sessaoMaestra ?? null, peloCiclo: cicloCobre }),
  });
}

/**
 * Fase nova ainda não autorizada: sob o sim do ciclo, a maestra grava a
 * autorização herdada (`herdar-autorizacao`, origem `ciclo`) sem perguntar a
 * o operador; fora dele (nenhum sim do ciclo, ou task que mudou de classe ou de
 * sensibilidade desde o sim), pede o sim do ciclo de novo: o sim por fase
 * foi aposentado (D-VEGA29-14).
 *
 * Lê: `fase`, `autorizadas`, `cicloCobre`, `replanoSoDeRuling`,
 * `semMudarAlcance`, `autorizacaoDoCiclo`, `plano`, `planoHead`, `diffPlano`, `entrada.ci`.
 */
export function regraAutorizarFase(ctx) {
  const { acao, plano, planoHead, planoHeadBlob, planoBlob, diffPlano, entrada, autorizadas, fase, cicloCobre, replanoSoDeRuling, semMudarAlcance, autorizacaoDoCiclo, tasksQueMudaramDeClasse } = ctx;
  if (!fase || autorizadas.has(fase.id)) return null;
  if (cicloCobre && (replanoSoDeRuling || semMudarAlcance))
    return acao("herdar-autorizacao", `herdar:${fase.id}`, 0, {
      fase: fase.id,
      origem: "ciclo",
      autorizacao: autorizacaoDoCiclo.sha,
      planoNovo: planoHeadBlob,
      planoAnterior: planoBlob,
      tasksMudadas: [],
      replanos: [],
      aviso: `${fase.id} autorizada pelo sim do ciclo de ${autorizacaoDoCiclo.sha.slice(0, 8)} (ruling de 27/10/2026)`,
    });
  const mudaram = planoHead ? tasksQueMudaramDeClasse(plano, planoHead) : [];
  return acao("perguntar", fase.id, 0, {
    motivo: "autorizar-ciclo",
    fase: fase.id,
    planoNovo: planoHeadBlob,
    planoAnterior: planoBlob,
    ...(diffPlano ? { diffPlano } : {}),
    mudaramDeClasse: mudaram,
    ci: entrada.ci ?? null,
  });
}

// ── dentro da fase ──────────────────────────────────────────────────────────

/**
 * Re-plano no meio da fase (T22): o plano do HEAD que mudou nas tasks em
 * relação ao congelado na autorização para a condução até o operador reautorizar a
 * fase sob o plano novo. Blob diferente com o plano parseado igual (§13,
 * nota, typo) segue calado.
 *
 * Herança (F4.17): re-plano que o operador invocou pelo `/intra-plan` — todo commit
 * que mexeu no canonico desde a autorização é de ruling —, sem task mudando
 * de classe e sem trazida pendente na fase, não reautoriza: a maestra grava a
 * autorização herdada e a condução segue. Qualquer outra mudança pergunta. A
 * classe não basta (review de segurança): task de estação maestra ou
 * workstation tem a estação por classe, e task já sensível pode trocar o que
 * publica ou o caminho clínico que toca, ou entrar na fase vinda de outra.
 * Para a herança, toda mudança de publicação ou caminho clínico, e toda task
 * sensível que muda de fase, contam como mudança de classe. Task nova comum
 * não conta (C24 do VEGA-28): `mudancasQuePerguntam`.
 *
 * Lê: `fase`, `plano`, `planoHead`, `planoHeadBlob`, `replanos`, `daFase`,
 * `cicloCobre`, `semMudarAlcance`, `ultimaAutorizacao`, `autorizacaoDoCiclo`.
 */
export function regraReplano(ctx) {
  const { ciclo, acao, plano, planoHead, planoHeadBlob, planoBlob, replanos, reconhecer, fase, daFase, cicloCobre, semMudarAlcance, ultimaAutorizacao, autorizacaoDoCiclo } = ctx;
  const { diferencaDoPlano, mudancasQuePerguntam, rulingDoReplano } = ctx;
  if (!emCurso(ctx) || !planoHead || !planoHeadBlob || planoHeadBlob === planoBlob) return null;
  const tasksMudadas = diferencaDoPlano(plano, planoHead);
  if (!tasksMudadas.length) return null;
  const pergunta = perguntaDoPlano(ctx, fase.id, fase.tasks, tasksMudadas);
  const mudou = mudancasQuePerguntam(plano, planoHead);
  const rulings = daFase && Array.isArray(replanos) && replanos.length
    ? replanos.map((c) => rulingDoReplano(c.subject, ciclo, reconhecer))
    : [];
  // Sob o sim do ciclo, o re-plano sem ruling (commit à mão, merge de main que
  // muda o canonico) também herda, desde que não mude classe nem sensibilidade.
  const porRuling = rulings.length > 0 && rulings.every(Boolean);
  const peloCiclo = daFase && cicloCobre && Array.isArray(replanos) && replanos.length > 0 && semMudarAlcance;
  if ((porRuling || peloCiclo) && !mudou.length && !pergunta.trazidas.length)
    return acao("herdar-autorizacao", `herdar:${fase.id}`, 0, {
      fase: fase.id,
      origem: porRuling ? "replano" : "ciclo",
      autorizacao: ultimaAutorizacao.herdada ?? ultimaAutorizacao.sha,
      planoNovo: planoHeadBlob,
      planoAnterior: planoBlob,
      tasksMudadas,
      replanos: replanos.map((c, i) => ({ sha: c.sha, ruling: rulings[i] ?? null })),
      aviso: `autorização de ${fase.id} herdada pelo re-plano ${replanos.map((c) => c.sha.slice(0, 8)).join(", ")} (${
        porRuling ? [...new Set(rulings)].join(", ") : `sim do ciclo de ${autorizacaoDoCiclo.sha.slice(0, 8)}`
      })`,
    });
  return pergunta;
}

/**
 * Fase reaberta e reautorizada sem fechamento novo: as tasks novas nunca
 * chegariam a um fechamento que encerre a fase.
 *
 * Lê: `fase`, `plano`, `reautorizada`, `feita`.
 */
export function regraReabertaSemFechamento(ctx) {
  const { acao, plano, fase, reautorizada, feita } = ctx;
  if (!emCurso(ctx)) return null;
  const fech = fechamentoDaFase(plano, fase);
  if (!reautorizada(fase.id) || !fech || !feita(fech.task.id)) return null;
  return acao("perguntar", `reaberta:${fase.id}`, 0, {
    motivo: "fase-reaberta-sem-fechamento",
    fase: fase.id,
    task: fech.task.id,
    pendentes: fase.tasks.filter((id) => !feita(id)),
  });
}

/** Publicação recusada pelo operador numa task da fase: a condução para. Lê: `tasks`, `estado.recusadas`. */
export function regraPublicacaoRecusada(ctx) {
  const { acao, fase, tasks, estado } = ctx;
  if (!emCurso(ctx)) return null;
  const recusada = tasks.find((t) => estado.recusadas.has(t.id));
  if (!recusada) return null;
  return acao("parar", recusada.id, 0, { motivo: "publicacao-recusada", fase: fase.id, task: recusada.id });
}

/**
 * Trazida sem conferência: o fluxo normal grava a conferência sob o nonce do
 * trazer, sem passar pelo `proximo` — vê-la aqui é interrupção no meio.
 *
 * Task de conferência do operador por pergunta (T14): a mesma parada é a
 * pergunta do resultado, `conferencia-do-operador`, com as opções sim · nao.
 *
 * Lê: `tasks`, `trazidas`, `conferencia` (casos do adaptador).
 */
export function regraTrazidaSemConferencia(ctx) {
  const { acao, fase, tasks, trazidas, conferencia, casoDeConferencia, opcoesDaConferencia } = ctx;
  if (!emCurso(ctx)) return null;
  const trazida = tasks.find((t) => trazidas.has(t.id));
  if (!trazida) return null;
  const r = trazidas.get(trazida.id);
  const base = { fase: fase.id, task: trazida.id, tentativa: r.tentativa, nonceTentativa: r.nonce, ref: r.ref };
  const caso = casoDeConferencia(trazida, conferencia);
  // Conferência do operador por pergunta (T14, 7-a): a parte da máquina
  // chegou; o resultado é do operador. Sim ⇒ conferência com `--operador`;
  // não ⇒ `--rodada nao`, e a tentativa seguinte é a rodada nova.
  if (caso && !caso.arquivo)
    return acao("perguntar", trazida.id, r.tentativa, { motivo: "conferencia-do-operador", ...base, marca: caso.marca, opcoes: opcoesDaConferencia(trazida.id) });
  return acao("perguntar", trazida.id, r.tentativa, {
    motivo: "trazida-sem-conferencia",
    ...base,
    // Caso por arquivo (por exemplo um gate de UX): o não do arquivo fecha a
    // rodada por `registrar-conferencia T<k> --rodada nao`, não pela conferência.
    // `liveUxGate` é o nome antigo, mantido no caso por arquivo.
    ...(caso ? { conferenciaDoOperador: caso.marca, liveUxGate: true } : {}),
  });
}

/**
 * O `cutucadaEm` da sessão caída, em epoch, só se for da queda em curso: com
 * `caidaEm` (o instante em que quem conduz viu esta queda pela primeira vez),
 * o `cutucadaEm` anterior a ele é de uma queda velha e não conta — a sessão
 * voltou e caiu de novo, e recebe o seu `cutucar`. Sem `caidaEm`, vale o
 * `cutucadaEm` como veio. `null` = sem cutucada desta queda.
 */
export function cutucadaDestaQueda(sessao, epoch) {
  const cutucadaEm = sessao.cutucadaEm == null ? null : epoch(sessao.cutucadaEm);
  if (cutucadaEm === null) return null;
  const caidaEm = sessao.caidaEm == null ? null : epoch(sessao.caidaEm);
  return caidaEm !== null && cutucadaEm < caidaEm ? null : cutucadaEm;
}

/**
 * Vigia das filhas em voo (depois do `trazer`). Regra de falha, uma só
 * (esboço §Vigia de filha; T12):
 *   (1) filha some sem aviso — arquivada, ausente ou prazo vencido ⇒ perguntar;
 *   (2) `T<k>-FALHA` ou Verificação vermelha ⇒ tentativa nova automática;
 *       a 2ª falha contada da mesma task ⇒ perguntar, nunca 3ª tentativa;
 *   (3) queda de tentativa aberta antes do último reinício da ponte
 *       ⇒ reabre sem contar falha, com aviso ao operador.
 *   (4) filha esperando clique (`status_bucket` `BLOCKED`, `REQUIRES_ACTION`)
 *       ⇒ perguntar já, no primeiro ciclo, nunca no fim do prazo (T18, sota
 *       E2.A2/A3: em `auto` o classificador volta a pedir clique, e o pedido
 *       encaminhado não expira);
 *   (5) filha caída (`status_bucket` `FAILED`, sem aviso) ⇒ `cutucar`: a
 *       maestra manda uma mensagem e grava `cutucadaEm` na filha da entrada
 *       (só o desta queda conta: `cutucadaDestaQueda`);
 *       só depois de `silencioFilhaCaidaMin` sem ela voltar a tentativa
 *       reabre como falha de ambiente (T18, sota E2.B2).
 * O estado `ARCHIVED` sozinho nunca decide término (§2.2#29): término é aviso.
 *
 * Preenche `reabrir` com as tentativas que caíram e reabrem (o `abrir` as
 * leva na frente); devolve a primeira pergunta, se houver.
 *
 * Lê: `tasks`, `voo`, `filhas`, `estado` (`falhas`, `falhasAmbiente`,
 * `revertidasSemFalha`, `emVoo`, `maxTent`), `agora`, `reinicioEm`,
 * `feita`, `tetoFalhasAmbiente`, `silencioFilhaCaidaMin`, `epoch`. Escreve: `reabrir`.
 */
export function regraVigia(ctx) {
  const { acao, lerAviso, fase, tasks, voo, filhas, estado, agora, reinicioEm, feita, reabrir, tetoFalhasAmbiente, silencioFilhaCaidaMin, epoch } = ctx;
  if (!emCurso(ctx)) return null;
  const falhasDe = (t) => estado.falhas.get(t) ?? 0;
  const cobertaPorReinicio = (r) => reinicioEm !== null && r.abertaEm != null && r.abertaEm <= reinicioEm;
  const perguntasDaVigia = [];
  const cutucar = [];
  const registrar = (t, r) => ({ registrarFalha: { task: t.id, tentativa: r.tentativa, coberta: "nao" } });
  for (const { t, r } of voo) {
    if (!r.nonce) {
      perguntasDaVigia.push(["marcador-invalido", t, r]);
      continue;
    }
    const delas = filhas.filter((f) => f.nonce === r.nonce);
    const avisos = delas.map((f) => ({ f, a: lerAviso(f.aviso) })).filter(({ a }) => a && a.task === t.id && a.nonce === r.nonce);
    // Pergunta da filha (P22 do ATRM-51): não é falha de trabalho. Vai ao operador
    // sem `registrarFalha` nem `abrir`; a tentativa segue aberta e a maestra
    // responde à filha por mensagem na mesma sessão (skill §3).
    const pergunta = avisos.find(({ a }) => a.tipo === "FALHA" && a.arg === "pergunta");
    if (pergunta) {
      perguntasDaVigia.push(["pergunta-da-filha", t, r, { sessao: pergunta.f.sessao ?? null, nonceTentativa: r.nonce, aviso: String(pergunta.f.aviso).trim() }]);
      continue;
    }
    if (avisos.some(({ a }) => a.tipo === "FALHA")) {
      if (falhasDe(t.id) >= 1) perguntasDaVigia.push(["segunda-falha", t, r, registrar(t, r)]);
      else reabrir.set(t.id, { tentativa: r.tentativa, coberta: "nao", motivo: "falha-avisada" });
      continue;
    }
    if (!delas.length || delas.every((f) => f.estado === "ARCHIVED")) {
      if (cobertaPorReinicio(r)) reabrir.set(t.id, { tentativa: r.tentativa, coberta: "sim", motivo: "reinicio-da-ponte" });
      else perguntasDaVigia.push([delas.length ? "filha-sumiu" : "tentativa-sem-filha", t, r, registrar(t, r)]);
      continue;
    }
    const vivas = delas.filter((f) => f.estado !== "ARCHIVED");
    // Esperando clique (T18): ninguém clica na filha, e a referência não anda até o prazo.
    const bloqueada = vivas.find((f) => f.statusBucket === "BLOCKED" || f.estado === "REQUIRES_ACTION");
    if (bloqueada) {
      perguntasDaVigia.push(["filha-esperando-clique", t, r, { sessao: bloqueada.sessao ?? null, nonceTentativa: r.nonce }]);
      continue;
    }
    // Caída (T18): mensagem antes; falha de ambiente só depois do silêncio.
    if (vivas.every((f) => f.statusBucket === "FAILED")) {
      const caida = vivas[0];
      const cutucadaEm = cutucadaDestaQueda(caida, epoch);
      if (cutucadaEm === null) {
        cutucar.push({ t, r, f: caida });
        continue;
      }
      if (agora !== null && agora - cutucadaEm >= silencioFilhaCaidaMin * 60) {
        reabrir.set(t.id, { tentativa: r.tentativa, coberta: "ambiente", motivo: "filha-caida-em-silencio" });
        continue;
      }
    }
    if (agora !== null && r.abertaEm != null && agora - r.abertaEm > t.prazoMin * 60)
      perguntasDaVigia.push(["prazo-vencido", t, r, { prazoMin: t.prazoMin, abertaEm: r.abertaEm, ...registrar(t, r) }]);
  }
  // Verificação vermelha: o `reverter-trazido` já tirou o trabalho; falta a falha.
  for (const t of tasks) {
    const rv = estado.revertidasSemFalha?.get(t.id);
    if (!rv || estado.emVoo.has(t.id)) continue;
    if (falhasDe(t.id) >= 1) perguntasDaVigia.push(["segunda-falha", t, rv, registrar(t, rv)]);
    else reabrir.set(t.id, { tentativa: rv.tentativa, coberta: "nao", motivo: "verificacao-vermelha" });
  }
  // Teto de 2 tentativas contadas: a task fica parada até o operador decidir.
  for (const t of tasks)
    if (!feita(t.id) && !estado.emVoo.has(t.id) && falhasDe(t.id) >= 2)
      perguntasDaVigia.push(["teto-de-falhas", t, { tentativa: estado.maxTent.get(t.id) ?? 0 }, { falhas: falhasDe(t.id) }]);
  // Teto próprio da falha de ambiente (P7 do ATRM-51): não conta no de cima, mas não reabre sem fim.
  for (const t of tasks) {
    const amb = estado.falhasAmbiente?.get(t.id) ?? 0;
    if (!feita(t.id) && !estado.emVoo.has(t.id) && amb >= tetoFalhasAmbiente)
      perguntasDaVigia.push(["teto-de-falhas-ambiente", t, { tentativa: estado.maxTent.get(t.id) ?? 0 }, { falhasAmbiente: amb }]);
  }
  if (!perguntasDaVigia.length) {
    if (!cutucar.length) return null;
    const { t, r, f } = cutucar[0];
    return acao("cutucar", t.id, r.tentativa, {
      motivo: "filha-caida",
      fase: fase.id,
      task: t.id,
      tentativa: r.tentativa,
      sessao: f.sessao ?? null,
      nonceTentativa: r.nonce,
      mensagem: `Sua sessão caiu antes do aviso de ${t.id} (nonce ${r.nonce}). Retome do ponto em que parou e avise pelo passo 6 do contrato.`,
    });
  }
  const [motivo, t, r, extra = {}] = perguntasDaVigia[0];
  return acao("perguntar", t.id, r.tentativa, { motivo, fase: fase.id, task: t.id, tentativa: r.tentativa, ref: r.ref ?? null, falhas: falhasDe(t.id), ...extra });
}

/**
 * Estação maestra: a própria maestra executa a task na worktree do ciclo
 * (push do ramo, proposta, leitura de CI — o que o contrato da filha
 * proíbe), roda a Verificação e registra com `--maestra`. Vem antes do
 * `abrir`: é ação curta da maestra, e as filhas abrem no turno seguinte.
 * `simParaPublicar`: o sim da fase não cobre a publicação (F4.17) — antes de
 * cada verbo de publicação, o sim do operador para esta task, num turno dele.
 *
 * Lê: `daMaestra`, `cobertaPelaFase`, `aprovacoes`.
 */
export function regraFazerMaestra(ctx) {
  const { ciclo, head, acao, nonce, fase, daMaestra, cobertaPelaFase, aprovacoes } = ctx;
  if (!emCurso(ctx) || !daMaestra.length) return null;
  const t = daMaestra[0];
  const sensivel = t.publicacao.length > 0 || t.clinica.length > 0;
  if (sensivel && !cobertaPelaFase && !aprovacoes.some((a) => a.task === t.id && a.nonce === nonce(ciclo, t.id, 0, head)))
    return acao("perguntar", t.id, 0, {
      motivo: "task-sensivel",
      fase: fase.id,
      task: t.id,
      tentativa: 0,
      publicacao: t.publicacao,
      caminhosClinicos: t.clinica,
    });
  return acao("fazer-maestra", t.id, 0, {
    fase: fase.id,
    task: t.id,
    posMerge: t.posMerge,
    publicacao: t.publicacao,
    simParaPublicar: t.publicacao.length > 0,
  });
}

/**
 * Nada a abrir com a fase ainda andando: filhas em voo, ou prontas sem vaga
 * no teto da ponte.
 *
 * Lê: `vooAtivo`, `servidor`, `filhas`, `tetoPonte`, `tetoPadrao`, `plano.largura`.
 */
export function regraEsperar(ctx) {
  const { acao, fase, plano, filhas, tetoPonte, tetoPadrao, vooAtivo, servidor } = ctx;
  if (!emCurso(ctx)) return null;
  if (vooAtivo.length) return acao("esperar", fase.id, 0, { motivo: "filhas-em-voo", fase: fase.id, emVoo: vooAtivo.map(({ t }) => t.id) });
  if (!servidor.length) return null;
  const { vivas, teto } = vagasDoTeto({ filhas, tetoPonte, tetoPadrao, largura: plano.largura, vooAtivo });
  return acao("esperar", fase.id, 0, { motivo: "sem-vaga", fase: fase.id, teto, vivas });
}

/** Task de workstation pronta: a condução para e o operador a roda na estação dele. Lê: `workstation`. */
export function regraWorkstation(ctx) {
  const { acao, fase, workstation } = ctx;
  if (!emCurso(ctx) || !workstation.length) return null;
  return acao("parar", workstation[0].id, 0, { motivo: "workstation", fase: fase.id, task: workstation[0].id });
}

/** Só o fechamento resta na fase: a maestra o faz. Lê: `tasks`, `feita`, `entrada.ci`. */
export function regraFecharFase(ctx) {
  const { acao, fase, tasks, feita, entrada } = ctx;
  if (!emCurso(ctx)) return null;
  const fechamento = tasks.find((t) => t.fechamento && !feita(t.id));
  if (!fechamento || !tasks.every((t) => t.fechamento || feita(t.id))) return null;
  return acao("fechar-fase", fase.id, 0, { fase: fase.id, task: fechamento.id, ci: entrada.ci ?? null });
}

/** A última da lista, sempre decide: nenhuma outra regra achou saída. Lê: `tasks`, `feita`. */
export function regraSemSaida(ctx) {
  const { acao, fase, tasks, feita } = ctx;
  return acao("perguntar", fase.id, 0, {
    motivo: "sem-saida",
    fase: fase.id,
    pendentes: tasks.filter((t) => !feita(t.id)).map((t) => ({ task: t.id, deps: t.deps.filter((d) => !feita(d)) })),
  });
}

// ── nível da maestra ────────────────────────────────────────────────────────
//
// `proximo --nivel maestra`: a maestra não abre neta; cria uma condutora por
// fase e a sessão de fechamento do ciclo. As `filhas` da entrada são as
// condutoras que ela criou, cada uma com a `fase` (`ciclo` para a sessão de
// fechamento). Contexto (`contextoDaMaestra`, conducao.mjs): `ciclo`, `head`,
// `planoBlob`, `acao`, `nonce`, `repo`, `plano` (o do HEAD), `encerradas`,
// `autorizadas`, `cicloAutorizado`, `entrada`, `condutoras` (estado e
// `statusBucket` normalizados), `agora`, `silencioCondutoraCaidaMin`, `epoch`,
// `textoDaProximaSessao`, `textoDoFechamento`. O prefixo
// `maestra…` as separa das `regra…`, que são a ordem do laço da condutora.

const viva = (c) => c.estado !== "ARCHIVED";

/**
 * A condutora cuja fase já tem `Conducao-Encerrada` (ou de qualquer fase, com
 * o ciclo encerrado) é arquivada antes de toda outra ação: libera a vaga para
 * a condutora seguinte. A sessão de fechamento (`fase: ciclo`) não entra. O
 * nonce não depende do HEAD; `arquivamentos` como na rede das filhas.
 *
 * Lê: `condutoras`, `encerradas`.
 */
export function maestraArquivarCondutora(ctx) {
  const { ciclo, head, planoBlob, acao, nonce, condutoras, encerradas } = ctx;
  for (const c of condutoras) {
    if (!viva(c) || !c.sessao || c.fase === "ciclo") continue;
    if (!encerradas.has(c.fase) && !encerradas.has("ciclo")) continue;
    const n = nonce(ciclo, `arquivar:${c.sessao}`, c.fase ?? "", "");
    const campos = { sessao: c.sessao, fase: c.fase ?? null, aviso: `${c.fase} encerrada` };
    const vezes = (Array.isArray(c.arquivamentos) ? c.arquivamentos : []).filter((x) => x === n).length;
    if (vezes >= 2) return acao("perguntar", `arquivar:${c.sessao}`, 0, { ...campos, motivo: "falha-de-arquivamento", nonceArquivar: n, vezes });
    return { acao: "arquivar", nonce: n, ciclo, head, plano: planoBlob, ...campos };
  }
  return null;
}

/**
 * Vigia da condutora (T39, no molde da `regraVigia` da T18): condutora viva
 * nunca deixa a maestra em `esperar condutora-viva` sem teto.
 *   - `statusBucket` `BLOCKED` (ou estado `REQUIRES_ACTION`) ⇒ `perguntar
 *     condutora-caida` já, `situacao: bloqueada`: ninguém clica nela;
 *   - `fase` fora do plano do HEAD (a sessão de fechamento, `ciclo`, só
 *     conta antes de `Conducao-Encerrada: ciclo`) ⇒ a mesma pergunta,
 *     `situacao: fase-fora-do-plano`: nenhuma marca a encerraria, e a
 *     maestra esperaria por ela para sempre;
 *   - `statusBucket` (ou, sem ele, o estado) `FAILED` sem `cutucadaEm` ⇒ `cutucar condutora-falhou`: a maestra manda
 *     uma mensagem e grava `cutucadaEm` na condutora da entrada; ainda
 *     `FAILED` depois de `silencioCondutoraCaidaMin` desde o `cutucadaEm` ⇒
 *     a pergunta, `situacao: caida`. A condutora que volta sai do `FAILED`;
 *     se cai de novo, o `cutucadaEm` velho não conta (`cutucadaDestaQueda`).
 * Pergunta vem antes do `cutucar`, como na vigia das filhas.
 *
 * Lê: `plano`, `encerradas`, `condutoras`, `agora`, `silencioCondutoraCaidaMin`, `epoch`.
 */
export function maestraVigiarCondutora(ctx) {
  const { acao, plano, encerradas, condutoras, agora, silencioCondutoraCaidaMin, epoch } = ctx;
  const fases = new Set(plano.fases.map((f) => f.id));
  // `episodio` separa as quedas cutucadas da mesma condutora: nonce próprio para cada uma.
  const perguntar = (c, situacao, detalhe, extra = {}, episodio = "") =>
    acao("perguntar", `vigia:${c.sessao}:${situacao}${episodio}`, 0, { motivo: "condutora-caida", fase: c.fase ?? null, sessao: c.sessao ?? null, situacao, detalhe, ...extra });
  let caida = null;
  for (const c of condutoras) {
    if (!viva(c)) continue;
    if (c.statusBucket === "BLOCKED" || c.estado === "REQUIRES_ACTION")
      return perguntar(c, "bloqueada", `a condutora de ${c.fase} está parada esperando um clique que ninguém dá; a fase não anda até alguém decidir o pedido dela.`);
    if (c.fase === "ciclo" ? !encerradas.has("ciclo") : !fases.has(c.fase))
      return perguntar(c, "fase-fora-do-plano", `a condutora ${c.sessao} conduz ${c.fase}, que não existe no plano de agora; nenhuma marca a encerraria, e a maestra esperaria por ela sem fim.`);
    if ((c.statusBucket ?? c.estado) !== "FAILED") continue;
    const cutucadaEm = cutucadaDestaQueda(c, epoch);
    if (cutucadaEm === null) {
      caida ??= c;
      continue;
    }
    if (agora !== null && agora - cutucadaEm >= silencioCondutoraCaidaMin * 60)
      return perguntar(c, "caida", `a condutora de ${c.fase} caiu, recebeu a mensagem e seguiu calada por ${silencioCondutoraCaidaMin} minutos; a fase está parada sem quem a conduza.`, {
        cutucadaEm: c.cutucadaEm,
        silencioMin: silencioCondutoraCaidaMin,
      }, `:${cutucadaEm}`);
  }
  if (!caida) return null;
  return acao("cutucar", `cutucar:${caida.sessao}`, 0, {
    motivo: "condutora-falhou",
    fase: caida.fase ?? null,
    sessao: caida.sessao ?? null,
    mensagem: `Sua sessão caiu antes de encerrar ${caida.fase}. Retome a condução do ponto em que parou, pelo proximo da fase.`,
  });
}

/**
 * Depois de `Conducao-Encerrada: ciclo`, a sessão de fechamento do ciclo, uma
 * só: criada com o `textoDoFechamento`; viva ⇒ esperar; já arquivada ⇒ o
 * `/close-cycle` correu nela.
 *
 * Lê: `encerradas`, `condutoras`, `plano`, `autorizadas`, `entrada.proposta`.
 */
export function maestraCriarFechamento(ctx) {
  const { ciclo, repo, acao, plano, encerradas, autorizadas, condutoras, entrada, textoDoFechamento } = ctx;
  if (!encerradas.has("ciclo")) return null;
  const campos = { fase: "ciclo", ultimaFase: plano.fases.at(-1)?.id ?? null };
  if (entrada.proposta?.state === "MERGED") return acao("esperar", "fechamento", 0, { ...campos, motivo: "mesclado" });
  const sessoes = condutoras.filter((c) => c.fase === "ciclo");
  const aberta = sessoes.find(viva);
  if (aberta) return acao("esperar", "fechamento", 0, { ...campos, motivo: "condutora-viva", sessao: aberta.sessao ?? null });
  if (sessoes.length) return acao("esperar", "fechamento", 0, { ...campos, motivo: "close-cycle-em-sessao-limpa" });
  const conduzidas = plano.fases.filter((f) => autorizadas.has(f.id)).map((f) => f.id);
  const exigirEncerramentos = [...plano.fases.map((f) => f.id).filter((id) => encerradas.has(id)), "ciclo"];
  const anterior = condutoras.filter((c) => c.fase !== "ciclo").at(-1)?.sessao ?? null;
  return acao("criar-fechamento", "fechamento", 0, {
    ...campos,
    conduzidas,
    texto: textoDoFechamento({ ciclo, repo, sessao: anterior, conduzidas, exigirEncerramentos, anterior: "condutora anterior" }),
  });
}

/**
 * A primeira fase do plano sem `Conducao-Encerrada` ganha condutora quando
 * nenhuma condutora vive — inclusive a primeira fase do ciclo, sem sessão
 * anterior a arquivar. Condutora viva ⇒ esperar: uma condutora por vez.
 *
 * Lê: `plano`, `encerradas`, `autorizadas`, `cicloAutorizado`, `condutoras`.
 */
export function maestraCriarCondutora(ctx) {
  const { ciclo, repo, acao, plano, encerradas, autorizadas, cicloAutorizado, condutoras, textoDaProximaSessao } = ctx;
  const fase = plano.fases.find((f) => !encerradas.has(f.id));
  if (!fase) return acao("perguntar", "ciclo", 0, { motivo: "sem-saida", fase: "ciclo", pendentes: [] });
  const aberta = condutoras.find((c) => viva(c) && c.fase !== "ciclo");
  if (aberta) return acao("esperar", `condutora:${aberta.fase}`, 0, { motivo: "condutora-viva", fase: aberta.fase ?? null, sessao: aberta.sessao ?? null });
  const daFase = condutoras.filter((c) => c.fase === fase.id);
  const i = plano.fases.indexOf(fase);
  const daAnterior = i > 0 ? condutoras.filter((c) => c.fase === plano.fases[i - 1].id) : [];
  const anterior = (daFase.at(-1) ?? daAnterior.at(-1))?.sessao ?? null;
  // Condutora que caiu sem encerrar a fase é recriada com tentativa nova: o
  // nonce muda, e a maestra que desduplica por nonce não a confunde com a morta.
  return acao("criar-condutora", `condutora:${fase.id}`, daFase.length, {
    fase: fase.id,
    modelo: fase.modelo,
    tentativa: daFase.length + 1,
    texto: textoDaProximaSessao({
      ciclo,
      fase: fase.id,
      repo,
      sessao: anterior,
      peloCiclo: cicloAutorizado,
      anterior: "condutora anterior",
      primeira: i === 0 && !daFase.length,
      autorizada: autorizadas.has(fase.id),
    }),
  });
}
