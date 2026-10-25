/* global d3, topojson */
import {
  ELEICOES, UFS, LimiteTSE, fetchResultado, fetchIndice, fetchMunicipiosExterior, fotoUrl,
  somar, pctApurado, pronto, resultadoVazio, fetchBoletimSecao, fetchSecoesExterior, pausadoAte,
} from './tse.js';
import { Cache } from './cache.js';
import { COUNTRIES, CITIES, CONTINENTES, flagEmoji, continenteDaCidade, continenteDoPais, nomePaisNoContinente } from './exterior.js';
import {
  urnasCidade, urnasCidades, urnasPais, urnasBrasil, resumoUrnas, horaBrasilia, faltam, fechamentoBrasil, definirSemVotacao, MINIMO_ELEITORES,
} from './urnas.js';

// O CDN do TSE guarda cada arquivo por ~52s (max-age); consultar mais rápido que isso não traz nada novo.
const INTERVALO = 60_000;
const ESPERA_MAXIMA = 10 * 60_000;
const CONCORRENCIA = 6;
// As 186 cidades mudam quase todas a cada minuto durante a apuração; o total do exterior
// (um arquivo só) segue de minuto a minuto, e o detalhe por cidade, a cada 3 minutos.
const INTERVALO_CIDADES = 3 * 60_000;
// Seção de presídio sem boletim ainda: confere de novo a cada 5 minutos. Boletim publicado não muda mais.
const INTERVALO_BU = 5 * 60_000;
const RECORTES = ['br', 'zz', ...Object.keys(UFS)];
const ANTARTIDA = '010';

const $ = sel => document.querySelector(sel);
const fmt = new Intl.NumberFormat('pt-BR');
const fmtPct = (v, casas = 2) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const dataEleicao = () => ELEICOES[state.ele].data;

// Na aba Mapa, sel = UF (estado) ou código do país; cidade = cidade do exterior; continente = recorte do exterior.
// multi: estados (e "zz", o exterior) somados com Ctrl/⌘ + clique; somando: o mesmo pelo clique simples (toque).
const state = { ele: '6258', aba: 'mapa', sel: null, cidade: null, multi: [], somando: false, continente: null, ordem: null, busca: '' };

const REGIOES = {
  norte: { sigla: 'N', nome: 'Norte', ufs: ['ac', 'ap', 'am', 'pa', 'ro', 'rr', 'to'] },
  nordeste: { sigla: 'NE', nome: 'Nordeste', ufs: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'] },
  'centro-oeste': { sigla: 'CO', nome: 'Centro-Oeste', ufs: ['df', 'go', 'mt', 'ms'] },
  sudeste: { sigla: 'SE', nome: 'Sudeste', ufs: ['es', 'mg', 'rj', 'sp'] },
  sul: { sigla: 'S', nome: 'Sul', ufs: ['pr', 'rs', 'sc'] },
};

// Ordem das listas: a escolhida, ou a padrão de cada lista. No exterior, antes dos votos, o fechamento das urnas.
const ordemAtual = (padrao = 'eleitorado') => state.ordem ?? padrao;
const ordemExterior = () => (dados.zz && !dados.zz.validos ? 'fechamento' : 'eleitorado');

let dados;
function novosDados(ele) {
  return {
    ele,
    cache: Cache.da(ele),
    br: null, ufs: {}, zz: null, munExterior: null, cidades: {}, paises: {},
    querCidades: false, sincronizando: null, cidadesEm: 0,
    presidios: {}, presidiosTotal: null, querPresidios: false, sincPresidios: null,
  };
}

/* ---------------- estado na URL ---------------- */

// A URL vem de fora (link colado): cada valor é conferido antes de virar estado. Object.hasOwn evita
// que nomes herdados ("constructor", "toString") passem por chave válida.
function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const de = (obj, v) => (v != null && Object.hasOwn(obj, v) ? v : null);
  state.ele = de(ELEICOES, p.get('e')) ?? state.ele;
  const aba = p.get('aba');
  if (aba === 'presidios') state.aba = 'presidios';
  else if (['mapa', 'estados', 'exterior'].includes(aba)) state.aba = 'mapa'; // estados e exterior: links antigos
  const sel = p.get('sel');
  state.sel = state.aba === 'mapa' ? de(UFS, sel) ?? de(COUNTRIES, sel)
    : de(UFS, sel) ?? (/^\d{5}-\d{1,4}-\d{1,4}$/.test(sel ?? '') ? sel : null);
  state.cidade = de(CITIES, p.get('cidade'));
  const ufs = (p.get('ufs') || '').split(',').filter(uf => uf === 'zz' || Object.hasOwn(UFS, uf));
  state.multi = [...new Set(ufs)];
  state.continente = de(CONTINENTES, p.get('cont'));
}

function gravarHash() {
  const p = new URLSearchParams({ e: state.ele, aba: state.aba });
  if (state.sel) p.set('sel', state.sel);
  if (state.cidade) p.set('cidade', state.cidade);
  if (state.multi.length) p.set('ufs', state.multi.join(','));
  if (state.continente) p.set('cont', state.continente);
  history.replaceState(null, '', `#${p}`);
}

/* ---------------- cores ---------------- */

const css = nome => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

function corCand(n) {
  return css(n === '13' || n === '22' ? `--cand-${n}` : '--cand-outro');
}

// Os dois candidatos que o mapa compara, em ordem fixa (número), para não trocarem de lado na apuração.
function duelo() {
  if (!dados.br) return [];
  return dados.br.cands.slice(0, 2).sort((a, b) => Number(a.n) - Number(b.n));
}

function votosDe(r, n) {
  return r.cands.find(c => c.n === n)?.votos ?? 0;
}

const FAIXAS = [5, 15, 30];          // vantagem em pontos percentuais dos votos válidos
const INTENSIDADE = [0.38, 0.6, 0.8, 1];

function faixa(margem) {
  const i = FAIXAS.findIndex(f => margem < f);
  return INTENSIDADE[i === -1 ? FAIXAS.length : i];
}

function corRegiao(r, urnas = null) {
  if (!r || !r.validos) {
    if (urnas?.estado === 'fechada') return css('--fechada');
    if (urnas?.estado === 'votando') return 'url(#listras)';
    return css('--nodata');
  }
  const [a, b] = duelo();
  const lider = r.cands[0];
  if (!a || (lider.n !== a.n && lider.n !== b.n)) return corCand(lider.n);
  const margem = Math.abs(votosDe(r, a.n) - votosDe(r, b.n)) / r.validos * 100;
  if (margem === 0) return css('--mid');
  return d3.interpolateLab(css('--mid'), corCand(lider.n))(faixa(margem));
}

/* ---------------- carga de dados ---------------- */

// Tudo o que a tela mostra sai do cache; a rede só alimenta o cache.
function aplicarCache() {
  const c = dados.cache;
  dados.br = c.get('br') ?? null;
  dados.zz = maisCompleto(c.get('zz') ?? null, boletinsExterior(Object.keys(c.get('cfg:secoesZz') ?? {})));
  for (const uf of Object.keys(UFS)) if (c.get(uf)) dados.ufs[uf] = c.get(uf);
  dados.munExterior ??= c.get('cfg:mun') ?? null;
  montarCidades();
  montarResultadosPresidios();
}

// Soma de cidades que avisa quando alguma veio dos boletins de urna, e não da totalização.
const somarCidades = rs => ({ ...somar(rs), boletins: rs.some(r => r.boletins) });

// O eleitorado de cada cidade vem do índice do TSE: abaixo do mínimo, a cidade não tem votação.
function atualizarSemVotacao(cache) {
  const eleitorado = cd => cache.get('cfg:eleitoradoZz')?.[cd] ?? cache.get(`zz:${cd}`)?.eleitorado ?? MINIMO_ELEITORES;
  definirSemVotacao(Object.keys(CITIES).filter(cd => eleitorado(cd) < MINIMO_ELEITORES));
}

function montarCidades() {
  atualizarSemVotacao(dados.cache);
  if (!dados.munExterior) return;
  const cidades = {};
  const porPais = {};
  for (const m of dados.munExterior) {
    const r = maisCompleto(dados.cache.get(`zz:${m.cd}`), boletinsExterior([m.cd]));
    const geo = CITIES[m.cd];
    if (!r) continue;
    if (!geo) { console.warn('Cidade do exterior sem país mapeado:', m.cd, m.nome); continue; }
    cidades[m.cd] = { ...m, pais: geo[0], lat: geo[1], lon: geo[2], r };
    (porPais[geo[0]] ??= []).push(r);
  }
  dados.cidades = cidades;
  dados.paises = Object.fromEntries(Object.entries(porPais).map(([id, lista]) => [id, somarCidades(lista)]));
}

// Baixa em lote; o limite de requisições simultâneas e a pausa depois de um 429 ficam em tse.js,
// valendo para a página inteira. Um 429 interrompe o lote (o que já chegou fica no cache), e um lote
// de uma eleição que deixou de estar na tela para de pegar itens novos.
async function pool(alvo, itens, fn) {
  let i = 0;
  let limite = null;
  await Promise.all(Array.from({ length: CONCORRENCIA }, async () => {
    while (i < itens.length && !limite && alvo === dados) {
      const item = itens[i++];
      try { await fn(item); } catch (err) { if (err instanceof LimiteTSE) limite = err; else console.warn(err); }
    }
  }));
  if (limite) throw limite;
}

async function baixarArquivos(alvo, itens, fn) {
  if (!itens.length) return;
  const el = $('#carregando');
  let feitos = 0;
  const mostrar = () => {
    if (alvo !== dados) return;
    el.hidden = false;
    el.firstElementChild.textContent = `Baixando do TSE… ${feitos}/${itens.length}`;
  };
  mostrar();
  try {
    await pool(alvo, itens, async x => { await fn(x); feitos++; mostrar(); });
  } finally {
    if (alvo === dados) el.hidden = true;
  }
}

// A versão (andamento, seções, comparecimento) pode não mudar numa correção de votos; por isso um
// resultado ainda em andamento é rebaixado de tempos em tempos mesmo com a versão igual.
const RECONCILIAR = 10 * 60_000;

function desatualizado(atual, ix) {
  if (pronto(atual)) return false; // resultado pronto não muda mais
  if (!atual || !ix || atual.versao !== ix.versao) return true;
  return ix.secoesTot > 0 && (!atual.baixadoEm || Date.now() - atual.baixadoEm > RECONCILIAR);
}

// Grava um resultado baixado, sem deixar uma cópia velha do CDN rebaixar um resultado pronto.
function guardar(cache, id, r) {
  if (pronto(cache.get(id)) && !pronto(r)) return;
  cache.set(id, { ...r, baixadoEm: Date.now() });
}

// O relógio diz onde já pode haver votos: nos estados, só depois das 17h de Brasília;
// em cada cidade do exterior, só depois das 17h no fuso dela.
function planoDeConsulta(alvo, agora = Date.now()) {
  const d = ELEICOES[alvo.ele].data;
  const cache = alvo.cache;
  const fechaBrasil = fechamentoBrasil(d);
  const brasilFechado = agora >= fechaBrasil;
  const fechadas = new Set();
  let proximo = brasilFechado ? Infinity : fechaBrasil;
  for (const cd of Object.keys(CITIES)) {
    const u = urnasCidade(cd, d, agora);
    if (u.estado === 'fechada') fechadas.add(cd);
    else if (u.estado !== 'sem-votacao') proximo = Math.min(proximo, u.fecha);
  }
  const proximosLugares = proximo === Infinity ? [] : [
    ...(!brasilFechado && fechaBrasil === proximo ? ['Brasil'] : []),
    ...new Set(Object.keys(CITIES).filter(cd => !fechadas.has(cd) && urnasCidade(cd, d, agora).estado !== 'sem-votacao' && urnasCidade(cd, d, agora).fecha === proximo).map(cd => COUNTRIES[CITIES[cd][0]].nome)),
  ];
  const estadosPendentes = brasilFechado && !['br', ...Object.keys(UFS)].every(id => pronto(cache.get(id)));
  // Com o detalhe por cidade na tela, só termina quando cada cidade fechada estiver pronta,
  // mesmo que o total do exterior já esteja (o CDN pode ter entregue uma cidade atrasada).
  const cidadesPendentes = [...fechadas].some(cd => !pronto(cache.get(`zz:${cd}`)));
  const exteriorPendente = fechadas.size > 0 && (!pronto(cache.get('zz')) || (alvo.querCidades && cidadesPendentes));
  const presidiosPendentes = brasilFechado && alvo.querPresidios && !!listaPresidios
    && listaPresidios.some(sec => !cache.get(`bu:${sec.id}`));
  return {
    brasilFechado,
    fechadas,
    podeMudar: estadosPendentes || exteriorPendente || presidiosPendentes,
    proximoFechamento: proximo === Infinity ? null : proximo,
    proximosLugares,
  };
}

async function atualizar(alvo) {
  const { ele, cache } = alvo;
  // Na primeira visita o total nacional vem sempre: dá a lista de candidatos e o eleitorado.
  if (!cache.get('br')) guardar(cache, 'br', await fetchResultado(ele, 'br'));
  const plano = planoDeConsulta(alvo);
  const faltaBase = RECORTES.some(id => !cache.get(id));
  if (plano.podeMudar || faltaBase) {
    const indice = await fetchIndice(ele, 'br');
    if (alvo !== dados) return;
    const modelo = cache.get('br');
    const baixar = [];
    for (const id of RECORTES) {
      const ix = indice.get(id);
      const atual = cache.get(id);
      if (pronto(atual)) continue;
      // Nada apurado ainda: o índice basta (eleitorado e seções), sem baixar o arquivo.
      if (ix && ix.secoesTot === 0) {
        if (atual?.versao !== ix.versao) cache.set(id, resultadoVazio(ix, modelo));
        continue;
      }
      // Pelo relógio ainda não pode haver votos aqui: não baixa.
      if (UFS[id] && !plano.brasilFechado) continue;
      if (id === 'zz' && !plano.fechadas.size) continue;
      if (desatualizado(atual, ix)) baixar.push(id);
    }
    await baixarArquivos(alvo, baixar, id => fetchResultado(ele, id).then(r => guardar(cache, id, r)));
  }
  // Depois das 17h de Brasília quase tudo muda a cada minuto; aí as cidades vão a cada 3 minutos.
  const intervaloCidades = plano.brasilFechado ? INTERVALO_CIDADES : 0;
  // O total nacional e os estados já chegaram: mostra antes das cargas mais lentas (cidades, boletins).
  if (alvo === dados) { aplicarCache(); render(); }
  // As cidades vêm antes: o índice delas dá o eleitorado, e cidade com menos de 30 eleitores não tem boletim.
  if (alvo.querCidades && alvo === dados && Date.now() - alvo.cidadesEm >= intervaloCidades) await sincronizarCidades(alvo);
  if (alvo === dados) await sincronizarBoletinsExterior(alvo);
  if (alvo.querPresidios && alvo === dados) await sincronizarPresidios(alvo);
}

/* ---------------- presídios ---------------- */

// Seções especiais para presos provisórios e adolescentes internados (data/presidios.json, gerado do
// cadastro de locais de votação do TSE). Não há total por presídio na API: cada seção vem do seu
// boletim de urna, publicado depois que as urnas do Brasil fecham, às 17h de Brasília.
let listaPresidios = null;

async function carregarListaPresidios() {
  if (listaPresidios) return listaPresidios;
  const j = await d3.json('data/presidios.json');
  listaPresidios = j.secoes.map(sec => ({ ...sec, id: `${sec.mun}-${sec.zona}-${sec.secao}` }));
  return listaPresidios;
}

function sincronizarPresidios(alvo) {
  alvo.querPresidios = true;
  if (alvo.sincPresidios) return alvo.sincPresidios;
  const { ele, cache } = alvo;
  alvo.sincPresidios = (async () => {
    await carregarListaPresidios();
    // Pelo relógio, antes das 17h de Brasília nenhuma dessas seções tem boletim: não consulta nada.
    if (!planoDeConsulta(alvo).brasilFechado) return;
    const agora = Date.now();
    // Estado sem nenhuma seção apurada (pelo índice nacional, que já vem a cada ciclo) também não tem
    // boletim de presídio: só confere as seções de estados onde a apuração já começou.
    const pendentes = listaPresidios.filter(sec => !cache.get(`bu:${sec.id}`)
      && (cache.get(sec.uf)?.secoesTot ?? 0) > 0
      && agora - cache.tentativa(sec.id) >= INTERVALO_BU);
    await baixarArquivos(alvo, pendentes, sec => buscarBoletim(alvo, sec));
  })().finally(() => {
    alvo.sincPresidios = null;
    if (alvo === dados) montarResultadosPresidios();
  });
  return alvo.sincPresidios;
}

// Busca o boletim de uma seção, uma vez só por vez: confere cache, tentativa em andamento e prazo
// logo antes de pedir (dois lotes sobrepostos não pedem a mesma seção), e grava a tentativa antes da
// requisição. Vale para os presídios e para as seções do exterior.
async function buscarBoletim(alvo, sec) {
  const { cache } = alvo;
  alvo.buEmVoo ??= new Set();
  if (cache.get(`bu:${sec.id}`) || alvo.buEmVoo.has(sec.id)) return;
  if (Date.now() - cache.tentativa(sec.id) < INTERVALO_BU) return;
  // Durante a pausa depois de um 429 nada sai: não gasta o prazo da seção sem ter pedido.
  if (Date.now() < pausadoAte()) throw new LimiteTSE(429, pausadoAte());
  if (alvo !== dados) return;
  alvo.buEmVoo.add(sec.id);
  cache.marcarTentativa(sec.id);
  try {
    const bu = await fetchBoletimSecao(alvo.ele, sec);
    if (bu) cache.set(`bu:${sec.id}`, bu);
  } finally {
    alvo.buEmVoo.delete(sec.id);
  }
}

// Boletim → o mesmo formato de resultado do resto da página. Número fora da lista de candidatos
// (candidatura cancelada) entra como nulo, como na totalização.
function resultadoBoletim(bu, modelo) {
  const numeros = new Set(modelo.cands.map(c => c.n));
  let validos = 0;
  let foraDaLista = 0;
  for (const [n, q] of Object.entries(bu.votos)) {
    if (numeros.has(n)) validos += q; else foraDaLista += q;
  }
  const cands = modelo.cands.map(c => ({ ...c, votos: bu.votos[c.n] ?? 0 }));
  for (const c of cands) c.pct = validos ? (c.votos / validos) * 100 : 0;
  cands.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
  return {
    versao: 'bu', cands, eleitorado: bu.aptos, comparecimento: bu.comparecimento,
    abstencao: bu.aptos - bu.comparecimento, validos, brancos: bu.brancos, nulos: bu.nulos + foraDaLista,
    secoes: 1, secoesTot: 1, andamento: 'f', totalizado: '',
  };
}

const presidiosDaUF = uf => listaPresidios?.filter(sec => sec.uf === uf) ?? [];
const resultadoPresidiosUF = uf => somar(presidiosDaUF(uf).map(sec => dados.presidios[sec.id]).filter(Boolean));

function montarResultadosPresidios() {
  if (!listaPresidios || !dados.br) return;
  const modelo = dados.br;
  const vazio = {
    versao: '', cands: modelo.cands.map(c => ({ ...c, votos: 0, pct: 0 })), eleitorado: 0, comparecimento: 0,
    abstencao: 0, validos: 0, brancos: 0, nulos: 0, secoes: 1, secoesTot: 0, andamento: 'n', totalizado: '',
  };
  dados.presidios = Object.fromEntries(listaPresidios.map(sec => {
    const bu = dados.cache.get(`bu:${sec.id}`);
    return [sec.id, bu ? resultadoBoletim(bu, modelo) : vazio];
  }));
  dados.presidiosTotal = somar(Object.values(dados.presidios));
}

const TIPO_PRESIDIO = { prisional: 'Prisional', socioeducativo: 'Socioeducativo (adolescentes)' };

const SIGLAS = new Set(['CDP', 'CASE', 'CASA', 'FUNASE', 'IASES', 'UCR', 'CPP', 'PEM', 'CSE', 'UI', 'UIP', 'CR', 'CCPA',
  'CEJ', 'CRAMA', 'UNIP', 'UNIS', 'UFI', 'CASEM', 'SEJUS', 'SEJES', 'FASE', 'CENIP', 'CIA', 'ASP', 'IAPEN', 'SUMESE',
  'II', 'III', 'IV', 'PECAN', 'PREFEM', 'UNIRE', 'UISM', 'UIBRA', 'DF', 'SP', 'PB', 'MT', 'ES', 'MA', 'BA', 'LC-EST']);
const MINUSCULAS_LOCAL = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'AO']);

// O cadastro vem em maiúsculas; deixa legível sem estragar as siglas (CDP, CASE, FUNASE…).
function nomeLocal(nome) {
  return nome.replace(/\s+/g, ' ').split(' ').map((w, i) => {
    const limpa = w.replace(/[()'".,/-]+$|^[()'".,/-]+/g, '');
    if (SIGLAS.has(limpa) || !/[AEIOUÁÉÍÓÚÂÊÔÃÕ]/.test(limpa) || /^(CDP|UCR|CPF)/.test(limpa)) return w;
    if (i > 0 && MINUSCULAS_LOCAL.has(w)) return w.toLowerCase();
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}

function sincronizarCidades(alvo) {
  alvo.querCidades = true;
  if (alvo.sincronizando) return alvo.sincronizando;
  const { ele, cache } = alvo;
  alvo.sincronizando = (async () => {
    if (!alvo.munExterior) {
      alvo.munExterior = await fetchMunicipiosExterior(ele);
      cache.set('cfg:mun', alvo.munExterior);
    }
    // Recalculado aqui, logo antes de baixar, para a eleição desta sincronização.
    const plano = planoDeConsulta(alvo);
    const zz = cache.get('zz');
    const ids = alvo.munExterior.map(m => m.cd);
    const fechada = cd => plano.fechadas.has(cd);
    const daCidade = cd => cache.get(`zz:${cd}`);
    const completas = ids.every(daCidade);
    const esperando = ids.some(cd => fechada(cd) && !pronto(daCidade(cd)));
    const vencida = r => !!r && !pronto(r) && !!r.baixadoEm && Date.now() - r.baixadoEm > RECONCILIAR;
    const reabrir = ids.some(cd => fechada(cd) && (daCidade(cd)?.versao === 'aberta' || vencida(daCidade(cd))));
    // O índice das cidades (~150 KB) vem uma vez para montar o mapa (eleitorado de cada cidade);
    // depois, quando há urna fechada esperando resultado e o total do exterior mudou, quando uma
    // cidade marcada como "aberta" já fechou, ou quando um resultado em andamento passou da hora de conferir.
    // Com cidade fechada ainda incompleta, o índice também é reconferido de tempos em tempos, mesmo
    // sem o total do exterior mudar (uma cidade zerada não pode ficar presa).
    const indiceVelho = Date.now() - (cache.get('cfg:indiceCidadesEm') ?? 0) > RECONCILIAR;
    if (zz && (!completas || reabrir || (esperando && (cache.get('cfg:versaoCidades') !== zz.versao || indiceVelho)))) {
      const indice = await fetchIndice(ele, 'zz');
      cache.set('cfg:indiceCidadesEm', Date.now());
      cache.set('cfg:eleitoradoZz', Object.fromEntries([...indice].map(([cd, ix]) => [cd, ix.eleitorado])));
      atualizarSemVotacao(cache);
      if (alvo !== dados) return;
      const baixar = [];
      for (const cd of ids) {
        const ix = indice.get(cd);
        const atual = daCidade(cd);
        if (pronto(atual)) continue;
        if (!fechada(cd)) {
          // Urna ainda aberta pelo fuso local: nunca baixa. Se o índice já tiver seções (não deveria),
          // a versão "aberta" força a conferência quando ela fechar.
          if (ix && atual?.versao !== ix.versao) cache.set(`zz:${cd}`, resultadoVazio(ix, zz, ix.secoesTot ? 'aberta' : ix.versao));
          continue;
        }
        if (!ix) continue; // fora do índice: tenta de novo na próxima
        if (ix.secoesTot === 0) {
          if (atual?.versao !== ix.versao) cache.set(`zz:${cd}`, resultadoVazio(ix, zz));
          continue;
        }
        if (desatualizado(atual, ix)) baixar.push(cd);
      }
      await baixarArquivos(alvo, baixar, cd => fetchResultado(ele, 'zz', cd).then(r => guardar(cache, `zz:${cd}`, r)));
      // O CDN pode entregar um arquivo mais velho que o índice; nesse caso tenta de novo no próximo ciclo.
      const emDia = ids.every(cd => !fechada(cd) || pronto(daCidade(cd)) || daCidade(cd)?.versao === indice.get(cd)?.versao);
      if (emDia) cache.set('cfg:versaoCidades', zz.versao);
    }
    alvo.cidadesEm = Date.now();
  })().finally(() => {
    alvo.sincronizando = null;
    if (alvo === dados) montarCidades();
  });
  return alvo.sincronizando;
}

/* ---------------- exterior pelos boletins de urna ---------------- */

// O TSE só totaliza depois das 17h de Brasília, mas publica o boletim de cada seção do exterior assim que
// a urna fecha e transmite. Enquanto a totalização do exterior não começa, a página soma esses boletins.
const TETO_BU_EXTERIOR = 60; // seções por ciclo (2 consultas cada)

async function sincronizarBoletinsExterior(alvo) {
  const { ele, cache } = alvo;
  let plano = planoDeConsulta(alvo);
  const zz = cache.get('zz');
  if (!plano.fechadas.size || !zz || zz.secoesTot > 0) return;
  if (!cache.get('cfg:secoesZz')) cache.set('cfg:secoesZz', await fetchSecoesExterior(ele));
  // Sem o eleitorado das cidades (aba Presídios, que não carrega as cidades), não dá para saber quais têm
  // menos de 30 eleitores: o índice das cidades vem uma vez só para isso (o eleitorado não muda).
  if (!cache.get('cfg:eleitoradoZz')) {
    const indice = await fetchIndice(ele, 'zz');
    cache.set('cfg:eleitoradoZz', Object.fromEntries([...indice].map(([cd, ix]) => [cd, ix.eleitorado])));
    atualizarSemVotacao(cache);
    plano = planoDeConsulta(alvo);
  }
  if (alvo !== dados) return;
  const d = ELEICOES[ele].data;
  const agora = Date.now();
  // Seção sem boletim é reconferida a cada 5 minutos. Nunca consultadas e as consultadas há mais tempo passam
  // na frente (com o teto, uma fila fixa reconsultaria sempre as mesmas); no empate, a cidade que fechou antes.
  const pendentes = [...plano.fechadas]
    .sort((a, b) => urnasCidade(a, d).fecha - urnasCidade(b, d).fecha)
    .flatMap(cd => secoesExterior(cd, cache))
    .filter(sec => !cache.get(`bu:${sec.id}`) && agora - cache.tentativa(sec.id) >= INTERVALO_BU)
    .sort((a, b) => cache.tentativa(a.id) - cache.tentativa(b.id))
    .slice(0, TETO_BU_EXTERIOR);
  await baixarArquivos(alvo, pendentes, sec => buscarBoletim(alvo, sec));
}

// Soma os boletins de urna já carregados das seções; seção sem boletim entra zerada.
function resultadoSecoes(secoes, cache = dados.cache, modelo = dados.br) {
  if (!modelo) return null;
  const vazio = {
    versao: '', cands: modelo.cands.map(c => ({ ...c, votos: 0, pct: 0 })), eleitorado: 0, comparecimento: 0,
    abstencao: 0, validos: 0, brancos: 0, nulos: 0, secoes: 1, secoesTot: 0, andamento: 'n', totalizado: '',
  };
  return somar(secoes.map(sec => {
    const bu = cache.get(`bu:${sec.id}`);
    return bu ? resultadoBoletim(bu, modelo) : vazio;
  }));
}

const secoesExterior = (cd, cache = dados.cache) => (cache.get('cfg:secoesZz')?.[cd] ?? [])
  .map(([zona, secao]) => ({ uf: 'zz', mun: cd, zona, secao, id: `zz-${cd}-${zona}-${secao}` }));

// Soma dos boletins já publicados das cidades; null enquanto nenhum chegou.
function boletinsExterior(cds, cache = dados.cache, modelo = dados.br) {
  const secoes = cds.flatMap(cd => secoesExterior(cd, cache));
  if (!modelo || !secoes.some(sec => cache.get(`bu:${sec.id}`))) return null;
  return { ...resultadoSecoes(secoes, cache, modelo), versao: 'bu', andamento: 'p', boletins: true };
}

// Fica com o que tiver mais seções: a totalização do TSE ou a soma dos boletins. O eleitorado vem do
// TSE (a soma dos boletins só conhece o das seções já lidas).
function maisCompleto(tse, bu) {
  if (!bu || bu.secoesTot <= (tse?.secoesTot ?? 0)) return tse;
  return tse ? { ...bu, eleitorado: tse.eleitorado, secoes: tse.secoes || bu.secoes } : bu;
}

/* ---------------- ciclo de atualização ---------------- */

// Depois de uma urna fechar, o TSE ainda leva um tempo para totalizar; não adianta consultar no minuto exato.
const FOLGA_APOS_FECHAR = 60_000;

let timer = null;
let proximaEm = 0;
let dormindo = null; // { ate, lugares } quando nada pode ter mudado até o próximo fechamento
let falhas = 0;
let ultimoErro = null;

function encerrada() {
  return pronto(dados.br);
}

function registrarFalha(err) {
  console.error(err);
  falhas++;
  ultimoErro = err;
}

let rodando = false;
let rodarDeNovo = false;

async function ciclo() {
  if (rodando) { rodarDeNovo = true; return; }
  rodando = true;
  try {
    await umCiclo();
  } finally {
    rodando = false;
    if (rodarDeNovo) { rodarDeNovo = false; ciclo(); }
  }
}

// Ligou uma carga (cidades do exterior, presídios): o plano muda, então reavalia já, sem esperar o timer
// (que pode nem existir, se a apuração já tinha terminado).
function reavaliar() {
  clearTimeout(timer);
  ciclo();
}

async function umCiclo() {
  clearTimeout(timer);
  const alvo = dados;
  let erro = null;
  try {
    await atualizar(alvo);
  } catch (err) {
    erro = err;
  }
  alvo.cache.salvar(); // salva mesmo se a eleição foi trocada no meio
  if (alvo !== dados) return; // o ciclo da eleição nova já está rodando
  if (erro) registrarFalha(erro);
  else { falhas = 0; ultimoErro = null; }
  aplicarCache();
  const plano = planoDeConsulta(alvo);
  dormindo = null;
  let espera = INTERVALO;
  if (erro instanceof LimiteTSE) {
    espera = Math.max(INTERVALO, erro.ate - Date.now()); // tse.js já calculou o recuo
  } else if (erro) {
    espera = Math.min(ESPERA_MAXIMA, INTERVALO * 2 ** falhas) * (0.8 + Math.random() * 0.4);
  } else if (!plano.podeMudar) {
    if (!plano.proximoFechamento) { proximaEm = 0; render(); return; } // tudo apurado
    // Nenhum lugar com urna fechada esperando resultado: nem consulta, dorme até o próximo fechamento.
    espera = Math.max(INTERVALO, plano.proximoFechamento - Date.now() + FOLGA_APOS_FECHAR);
    dormindo = { ate: Date.now() + espera, lugares: plano.proximosLugares };
  }
  proximaEm = Date.now() + espera;
  timer = setTimeout(ciclo, espera);
  render();
}

setInterval(() => { if (proximaEm) renderStatus(); }, 1000);
setInterval(() => renderTicker(), 30_000); // tira da faixa o que passou de 10 minutos

/* ---------------- faixa das últimas urnas ---------------- */

// Boletins de urna que o TSE recebeu nos últimos 10 minutos (pelo horário de recebimento do próprio TSE),
// das seções que a página lê boletim: exterior e presídios. Sem nenhum, a faixa some.
const JANELA_FAIXA = 10 * 60_000;
let chaveFaixa = '';

function itensDaFaixa() {
  const agora = Date.now();
  const [a, b] = duelo();
  if (!a) return [];
  const presidio = id => listaPresidios?.find(sec => sec.id === id);
  const nomeCidade = cd => dados.cidades[cd]?.nome ?? dados.munExterior?.find(m => m.cd === cd)?.nome ?? COUNTRIES[CITIES[cd]?.[0]]?.nome;
  return Object.entries(dados.cache.itens)
    .filter(([k, bu]) => k.startsWith('bu:') && bu?.recebidoEm && agora - bu.recebidoEm < JANELA_FAIXA && agora >= bu.recebidoEm - 60_000)
    .map(([k, bu]) => {
      const id = k.slice(3);
      let icone = '';
      let lugar;
      let secao;
      const ext = /^zz-(\d+)-\d+-(\d+)$/.exec(id);
      if (ext) {
        const pais = COUNTRIES[CITIES[ext[1]]?.[0]];
        icone = pais ? flagEmoji(pais.iso2) : '🌎';
        lugar = nomeCidade(ext[1]) ?? 'Exterior';
        secao = ext[2];
      } else {
        const sec = presidio(id);
        if (!sec) return null;
        icone = sec.uf.toUpperCase();
        lugar = nomeLocal(sec.nome);
        secao = sec.secao;
      }
      return { id, cidade: ext?.[1] ?? null, quando: bu.recebidoEm, icone, lugar, secao, va: bu.votos[a.n] ?? 0, vb: bu.votos[b.n] ?? 0 };
    })
    .filter(Boolean)
    .sort((x, y) => y.quando - x.quando);
}

function renderTicker() {
  const el = $('#ticker');
  const itens = itensDaFaixa();
  const chave = `${state.ele}|${itens.map(i => i.id).join(',')}`;
  if (chave === chaveFaixa) return; // mesma lista: não reinicia a animação
  chaveFaixa = chave;
  el.hidden = !itens.length;
  if (!itens.length) { el.querySelector('.faixa-trilho').innerHTML = ''; return; }
  const [a, b] = duelo();
  const item = i => `<span class="faixa-item" role="button" tabindex="-1" ${i.cidade ? `data-faixa-cidade="${esc(i.cidade)}"` : `data-faixa-presidio="${esc(i.id)}"`} title="Ver ${esc(i.lugar)}">
      <span class="faixa-ic">${esc(i.icone)}</span><b>${esc(i.lugar)}</b> · seção ${esc(i.secao)} · ${horaBrasilia(i.quando, dataEleicao())}
      <span class="faixa-voto" style="--cor:${corCand(a.n)}">${esc(a.nome)} ${fmt.format(i.va)}</span>
      <span class="faixa-voto" style="--cor:${corCand(b.n)}">${esc(b.nome)} ${fmt.format(i.vb)}</span>
    </span>`;
  const lista = itens.map(item).join('');
  // Duas cópias seguidas: a animação anda metade da largura e recomeça sem emenda.
  el.querySelector('.faixa-trilho').innerHTML = `<div class="faixa-rolo" style="--duracao:${Math.max(25, itens.length * 7)}s">${lista}<span aria-hidden="true" class="faixa-copia">${lista}</span></div>`;
  el.querySelector('.faixa-qtd').textContent = `${itens.length} ${itens.length > 1 ? 'urnas' : 'urna'} nos últimos 10 min`;
}

// Clique numa urna da faixa: abre a cidade (aba Mapa) ou o presídio (aba Presídios).
$('#ticker').addEventListener('click', ev => {
  const it = ev.target.closest('.faixa-item');
  if (!it) return;
  const cd = it.dataset.faixaCidade;
  const presidio = it.dataset.faixaPresidio;
  if (cd && CITIES[cd]) {
    trocarAba('mapa');
    // A cidade abre assim que as cidades do exterior chegarem; até lá, o painel mostra o país dela.
    irPara({ sel: CITIES[cd][0], cidade: cd, continente: null, multi: [] });
  } else if (presidio) {
    trocarAba('presidios');
    selecionar(presidio);
  }
  window.scrollTo({ top: $('.painel').offsetTop - $('.fixo').offsetHeight - 8, behavior: 'smooth' });
});

/* ---------------- render: topo e placar ---------------- */

function render() {
  renderTicker();
  renderTopo();
  renderStatus();
  renderPlacar();
  renderLegenda();
  pintarMundo();
  pintarPresidios();
  renderLateral();
}

function renderTopo() {
  $('#titulo-turno').textContent = ELEICOES[state.ele].nome;
  document.querySelectorAll('[data-ele]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ele === state.ele)));
  document.querySelectorAll('[data-aba]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === state.aba)));
  $('#mapa-mundo').hidden = state.aba !== 'mapa';
  $('#mapa-presidios').hidden = state.aba !== 'presidios';
  $('#zoom-ctrl').hidden = false;
}

function renderStatus() {
  const r = dados.br;
  const el = $('#status');
  if (!r) { el.textContent = ultimoErro ? 'Não foi possível falar com o TSE. Tentando de novo…' : 'Carregando…'; return; }
  const seg = proximaEm ? Math.max(0, Math.round((proximaEm - Date.now()) / 1000)) : 0;
  const prox = !proximaEm ? ''
    : dormindo ? ` · próxima consulta às ${horaBrasilia(dormindo.ate, dataEleicao())}, depois que fecham as urnas em ${esc(dormindo.lugares.join(', '))}`
    : ` · atualiza em ${seg < 120 ? `${seg}s` : faltam(proximaEm)}`;
  const falha = ultimoErro instanceof LimiteTSE
    ? ` · o TSE limitou as consultas (${ultimoErro.status}), esperando para tentar de novo`
    : ultimoErro ? ' · a última consulta ao TSE falhou' : '';
  if (r.andamento === 'n' || !r.secoesTot) {
    el.innerHTML = parcialExterior()
      ? `<span class="pulso"></span>Exterior pelos boletins de urna · ${fmt.format(dados.zz.secoesTot)} de ${fmt.format(dados.zz.secoes)} seções${prox}${falha}`
      : `Apuração não iniciada${prox}${falha}`;
  } else if (encerrada()) {
    el.innerHTML = `Apuração encerrada · ${fmtPct(100)} das seções · totalizado ${esc(r.totalizado)}`;
  } else {
    el.innerHTML = `<span class="pulso"></span>Ao vivo · ${fmtPct(pctApurado(r))} das seções · ${esc(r.totalizado.split(' ')[1] || '')}${prox}${falha}`;
  }
}

const nomesPaises = ids => {
  const nomes = [...new Set(ids)].map(id => COUNTRIES[id].nome);
  return nomes.length > 4 ? `${nomes.slice(0, 4).join(', ')} e mais ${nomes.length - 4}` : nomes.join(', ').replace(/, ([^,]*)$/, ' e $1');
};

function avisoExterior() {
  const d = dataEleicao();
  const u = resumoUrnas(d);
  const prox = u.proxima.length
    ? `próximo fechamento: <b>${esc(nomesPaises(u.proxima.map(c => c.pais)))}</b> às ${horaBrasilia(u.proxima[0].fecha, d)}, em ${faltam(u.proxima[0].fecha)}`
    : '';
  if (!u.fechadas) {
    return Date.now() < u.abertura
      ? `No exterior, a votação começa às <b>${horaBrasilia(u.abertura, d)}</b> (Brasília), na Nova Zelândia.`
      : `No exterior a votação já começou; ${prox}.`;
  }
  const n = u.paisesFechados.size;
  return `No exterior, as urnas já fecharam em <b>${n} ${n === 1 ? 'país' : 'países'}</b> (${esc(nomesPaises([...u.paisesFechados]))}), ${u.fechadas} de ${u.total} cidades${prox ? `; ${prox}` : ''}.`;
}

const TEXTO_SEM_VOTACAO = `Sem votação: menos de ${MINIMO_ELEITORES} eleitores, o mínimo para instalar uma seção no exterior`;

function textoUrnas(u) {
  const d = dataEleicao();
  if (u.estado === 'sem-votacao') return TEXTO_SEM_VOTACAO;
  if (u.total > 1 && u.fechadas > 0 && u.estado !== 'fechada') {
    return `Urnas fechadas em ${u.fechadas} de ${u.total} cidades; a última fecha às ${horaBrasilia(u.fecha, d)} (Brasília)`;
  }
  if (u.estado === 'fechada') return `Urnas fechadas às ${horaBrasilia(u.fecha, d)} (Brasília), aguardando a apuração`;
  const fecha = u.primeiraFecha && u.primeiraFecha !== u.fecha
    ? `fecham entre ${horaBrasilia(u.primeiraFecha, d)} e ${horaBrasilia(u.fecha, d)}`
    : `fecha às ${horaBrasilia(u.fecha, d)}`;
  if (u.estado === 'votando') return `Votação em andamento; ${fecha} (Brasília), em ${faltam(u.primeiraFecha ?? u.fecha)}`;
  return `Votação das 8h às 17h locais; abre às ${horaBrasilia(u.abre, d)} e ${fecha} (Brasília)`;
}

const marcaUrna = u => `<i class="urna-st e-${u.estado}"></i>`;

function fotoTag(ele, c, classe = '') {
  return `<img class="foto ${classe}" style="--cor:${corCand(c.n)}" src="${fotoUrl(ele, c.sq)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

// Antes das 17h de Brasília o total nacional está zerado; se já há boletins do exterior, o placar mostra
// a parcial deles, avisando que é só o exterior.
const parcialExterior = () => !!dados.br && !dados.br.secoesTot && !!dados.zz?.boletins;

// Barra mínima, sempre no topo: os dois do duelo e quanto já foi apurado.
function renderMiniPlacar(r, a, b) {
  const el = $('#mini-placar');
  el.hidden = !r.secoesTot;
  if (el.hidden) return;
  const meio = `${r.boletins ? 'só exterior · ' : ''}${fmtPct(pctApurado(r), 1)} apurado`;
  el.innerHTML = `<span class="mini-cand" style="--cor:${corCand(a.n)}"><b>${esc(a.nome)}</b> ${fmtPct(a.pct)} <small>${fmt.format(a.votos)}</small></span>
    <span class="mini-meio">
      <span class="mini-barra"><span style="width:${a.pct}%;background:${corCand(a.n)}"></span><span style="flex:1"></span><span style="width:${b.pct}%;background:${corCand(b.n)}"></span><i></i></span>
      <small>${meio}</small>
    </span>
    <span class="mini-cand dir" style="--cor:${corCand(b.n)}"><small>${fmt.format(b.votos)}</small> ${fmtPct(b.pct)} <b>${esc(b.nome)}</b></span>`;
}

function renderPlacar() {
  const el = $('#placar');
  if (!dados.br) { el.innerHTML = ''; $('#mini-placar').hidden = true; return; }
  const r = parcialExterior() ? dados.zz : dados.br;
  // Os dois do duelo, com os votos do recorte mostrado (o nacional ou a parcial do exterior).
  const [a, b] = duelo().map(d => r.cands.find(c => c.n === d.n) ?? d);
  renderMiniPlacar(r, a, b);
  const bloco = (c, lado) => `
    <div class="duelo-cand ${lado}">
      ${fotoTag(state.ele, c)}
      <div class="duelo-num">
        <span class="duelo-nome">${esc(c.nome)}</span>
        <span class="duelo-partido">${esc(c.partido)} · ${esc(c.n)}${c.situacao === 'Eleito' ? ' · <b>Eleito</b>' : ''}</span>
        <span class="duelo-pct">${fmtPct(c.pct)}</span>
        <span class="duelo-votos">${fmt.format(c.votos)} votos</span>
      </div>
    </div>`;
  const outros = r.cands.filter(c => c.n !== a.n && c.n !== b.n && c.votos > 0);
  const linhaOutros = outros.length
    ? `<p class="outros-linha">Demais candidatos: ${outros.slice(0, 6).map(c => `${esc(c.nome)} ${fmtPct(c.pct, 1)}`).join(' · ')}${outros.length > 6 ? ` · +${outros.length - 6}` : ''}</p>`
    : '';
  const comp = r.comparecimento;
  el.innerHTML = `
    <div class="duelo">
      ${bloco(a, 'esq')}
      <div class="duelo-meio">${r.boletins ? `só exterior<br>${fmtPct(pctApurado(r))}` : r.secoesTot ? `${fmtPct(pctApurado(r))}<br>apurado` : 'aguardando<br>apuração'}</div>
      ${bloco(b, 'dir')}
    </div>
    <div class="barra-dupla" role="img" aria-label="${esc(a.nome)} ${fmtPct(a.pct)}, ${esc(b.nome)} ${fmtPct(b.pct)}">
      <span style="width:${a.pct}%;background:${corCand(a.n)}"></span>
      <span style="flex:1"></span>
      <span style="width:${b.pct}%;background:${corCand(b.n)}"></span>
      <i class="meio"></i>
    </div>
    ${linhaOutros}
    ${r.boletins ? '<p class="outros-linha">Parcial do <b>exterior</b>, somando os boletins de urna já publicados. O TSE só totaliza a partir das 17h de Brasília.</p>' : ''}
    <dl class="kpis">
      <div class="kpi"><dt>${r.boletins ? 'Seções do exterior' : 'Seções apuradas'}</dt><dd>${fmtPct(pctApurado(r))}<small>${fmt.format(r.secoesTot)} de ${fmt.format(r.secoes)}</small></dd></div>
      <div class="kpi"><dt>Eleitorado</dt><dd>${fmt.format(r.eleitorado)}</dd></div>
      <div class="kpi"><dt>Comparecimento</dt><dd>${fmt.format(comp)}<small>${r.secoesTot ? fmtPct(comp / Math.max(1, comp + r.abstencao) * 100, 1) : ''}</small></dd></div>
      <div class="kpi"><dt>Abstenção</dt><dd>${fmt.format(r.abstencao)}<small>${r.secoesTot ? fmtPct(r.abstencao / Math.max(1, comp + r.abstencao) * 100, 1) : ''}</small></dd></div>
      <div class="kpi"><dt>Brancos</dt><dd>${fmt.format(r.brancos)}<small>${comp ? fmtPct(r.brancos / comp * 100, 1) : ''}</small></dd></div>
      <div class="kpi"><dt>Nulos</dt><dd>${fmt.format(r.nulos)}<small>${comp ? fmtPct(r.nulos / comp * 100, 1) : ''}</small></dd></div>
    </dl>`;
}

function renderLegenda() {
  const [a, b] = duelo();
  if (!a) { $('#legenda').innerHTML = ''; return; }
  const mid = css('--mid');
  const passos = c => INTENSIDADE.map(t => d3.interpolateLab(mid, corCand(c.n))(t));
  const esq = passos(a).reverse();
  const dir = passos(b);
  const sw = cores => cores.map(c => `<span style="background:${c}"></span>`).join('');
  // Enquanto o Brasil não tem voto apurado, o mapa mostra também onde ainda se vota (8h às 17h locais).
  const extraUrnas = state.aba !== 'mapa' || dados.br?.validos ? '' : `
    <div class="legenda-urnas" style="margin-top:6px">
      <span><i class="urna-st e-antes"></i>ainda não abriu</span>
      <span><i class="urna-st e-votando"></i>votando agora</span>
      <span><i class="urna-st e-fechada"></i>urnas fechadas, sem votos apurados</span>
    </div>`;
  const extraPresidios = state.aba !== 'presidios' ? extraUrnas : `
    <div class="legenda-urnas" style="margin-top:6px">
      <span><i class="forma circulo"></i>prisional</span>
      <span><i class="forma quadrado"></i>socioeducativo</span>
      <span><i class="urna-st e-fechada"></i>urna fechada, boletim ainda não publicado</span>
    </div>`;
  $('#legenda').innerHTML = `
    <div class="legenda-titulo"><span>← ${esc(a.nome)}</span><span>${esc(b.nome)} →</span></div>
    <div class="legenda-escala">${sw(esq)}${sw(dir)}</div>
    <div class="legenda-marcas"><span>30+</span><span>15</span><span>5</span><span>0</span><span>5</span><span>15</span><span>30+</span></div>
    <div class="legenda-sem"><i></i>sem votos apurados · vantagem em pontos percentuais</div>${extraPresidios}`;
}

/* ---------------- tooltip (preview) ---------------- */

const tip = $('#tooltip');

function mostrarTooltip(ev, { titulo, icone = '', r, extra = '', urnas = null }) {
  const [a, b] = duelo();
  let corpo;
  if (!r) {
    corpo = '<div class="tt-sub">Carregando resultados…</div>';
  } else if (!r.secoesTot) {
    corpo = `<div class="tt-sub">${r.eleitorado ? `${fmt.format(r.eleitorado)} eleitores · apuração não iniciada` : 'Boletim de urna ainda não publicado'}</div>`;
  } else {
    const linha = c => `<div class="tt-linha"><i class="ponto" style="--cor:${corCand(c.n)}"></i><span>${esc(c.nome)}</span><span><b>${fmtPct(c.pct, 1)}</b><span class="v">${fmt.format(c.votos)}</span></span></div>`;
    const ca = r.cands.find(c => c.n === a.n);
    const cb = r.cands.find(c => c.n === b.n);
    const outros = r.cands.filter(c => c.n !== a.n && c.n !== b.n).reduce((s, c) => s + c.pct, 0);
    corpo = `<div class="tt-sub">${fmtPct(pctApurado(r), 1)} apurado · ${fmt.format(r.eleitorado)} eleitores</div>
      ${[ca, cb].filter(Boolean).sort((x, y) => y.votos - x.votos).map(linha).join('')}
      ${outros > 0.05 ? `<div class="tt-linha"><i class="ponto" style="--cor:${corCand('')}"></i><span>Outros</span><span><b>${fmtPct(outros, 1)}</b></span></div>` : ''}`;
  }
  const linhaUrnas = urnas && (!r || !r.validos) ? `<div class="tt-urnas">${marcaUrna(urnas)}<span>${textoUrnas(urnas)}</span></div>` : '';
  tip.innerHTML = `<div class="tt-cab">${icone}<span>${esc(titulo)}</span></div>${corpo}${linhaUrnas}${extra}<div class="tt-dica">Clique para ver detalhes</div>`;
  tip.hidden = false;
  moverTooltip(ev);
}

function moverTooltip(ev) {
  const pad = 14;
  const { width, height } = tip.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + width > innerWidth - 8) x = ev.clientX - width - pad;
  if (y + height > innerHeight - 8) y = ev.clientY - height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

const esconderTooltip = () => { tip.hidden = true; };

/* ---------------- mapa: o mundo, com o Brasil por estado ---------------- */

// Um mapa só: o Brasil dividido em estados e, em volta, os países onde há seção eleitoral brasileira.
// Ao escolher um país, aparecem as cidades dele com seção.
const BRASIL = '076';
const K_ROTULOS_UF = 3; // a partir deste zoom, os estados ganham a sigla

let mundo = null;

async function montarMundo() {
  const [topo, topoUF] = await Promise.all([d3.json('data/countries-50m.json'), d3.json('data/br-uf.json')]);
  const features = topojson.feature(topo, topo.objects.countries).features.filter(f => f.id !== ANTARTIDA && f.id !== BRASIL);
  const estados = topojson.feature(topoUF, topoUF.objects[Object.keys(topoUF.objects)[0]]).features;
  const W = 960, H = 500;
  const proj = d3.geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'FeatureCollection', features: [...features, ...estados] });
  const path = d3.geoPath(proj);

  const svg = d3.select('#mapa-mundo').append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const listras = svg.append('defs').append('pattern')
    .attr('id', 'listras').attr('patternUnits', 'userSpaceOnUse').attr('width', 5).attr('height', 5)
    .attr('patternTransform', 'rotate(45)');
  listras.append('rect').attr('width', 5).attr('height', 5).style('fill', 'var(--nodata)');
  listras.append('rect').attr('width', 2).attr('height', 5).style('fill', 'var(--fechada)');
  const fundo = svg.append('rect').attr('width', W).attr('height', H).style('fill', 'var(--ocean)');
  const g = svg.append('g');
  const gPaises = g.append('g');
  const gEstados = g.append('g');
  const gRotulosUF = g.append('g');
  const gMarcadores = g.append('g');
  const gCidades = g.append('g');

  const nome = f => COUNTRIES[f.id]?.nome ?? f.properties.name;
  const icone = id => (COUNTRIES[id] ? `<span class="lat-bandeira" style="font-size:18px">${flagEmoji(COUNTRIES[id].iso2)}</span>` : '');
  const previewPais = (ev, id, n) => {
    const qtd = Object.values(dados.cidades).filter(c => c.pais === id).length;
    mostrarTooltip(ev, { titulo: n, icone: icone(id), r: dados.paises[id], urnas: urnasPais(id, dataEleicao()), extra: qtd > 1 ? `<div class="tt-sub" style="margin:6px 0 0">${qtd} cidades com seção eleitoral</div>` : '' });
  };

  const paths = gPaises.selectAll('path').data(features).join('path')
    .attr('d', path)
    .attr('data-id', f => f.id)
    .attr('class', f => `regiao${COUNTRIES[f.id] ? ' ativa' : ''}`)
    .on('mouseenter mousemove', (ev, f) => { if (COUNTRIES[f.id]) previewPais(ev, f.id, nome(f)); })
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, f) => { if (COUNTRIES[f.id]) selecionar(f.id); });

  const uf = f => f.properties.sigla.toLowerCase();
  const pathsUF = gEstados.selectAll('path').data(estados).join('path')
    .attr('class', 'regiao ativa')
    .attr('d', path)
    .attr('data-id', uf)
    .on('mouseenter mousemove', (ev, f) => mostrarTooltip(ev, {
      titulo: UFS[uf(f)], icone: `<span class="linha-ic">${uf(f).toUpperCase()}</span>`, r: dados.ufs[uf(f)], urnas: urnasBrasil(dataEleicao()),
    }))
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, f) => { if (somar_(ev)) alternarMulti(uf(f)); else selecionar(uf(f)); })
    .on('contextmenu', (ev, f) => { if (ev.ctrlKey) { ev.preventDefault(); alternarMulti(uf(f)); } });
  const rotulosUF = gRotulosUF.selectAll('text').data(estados).join('text')
    .attr('class', 'rotulo-uf')
    .attr('transform', f => `translate(${path.centroid(f)})`)
    .text(f => f.properties.sigla);
  const caixaUF = new Map(estados.map(f => [uf(f), path.bounds(f)]));

  // Países pequenos demais para clicar no mapa ganham um marcador na cidade principal.
  const porId = new Map(features.map(f => [f.id, f]));
  const primeiraCidade = {};
  for (const [cd, [pais, lat, lon]] of Object.entries(CITIES)) primeiraCidade[pais] ??= { cd, lat, lon };
  const pequenos = Object.keys(COUNTRIES).filter(id => !porId.has(id) || path.area(porId.get(id)) < 30)
    .map(id => ({ id, ...primeiraCidade[id], xy: proj([primeiraCidade[id].lon, primeiraCidade[id].lat]) }));
  const marcadores = gMarcadores.selectAll('circle').data(pequenos).join('circle')
    .attr('class', 'marcador')
    .attr('cx', d => d.xy[0]).attr('cy', d => d.xy[1])
    .attr('data-id', d => d.id)
    .on('mouseenter mousemove', (ev, d) => previewPais(ev, d.id, COUNTRIES[d.id].nome))
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, d) => selecionar(d.id));

  let k = 1;
  const zoom = d3.zoom().scaleExtent([1, 150]).translateExtent([[0, 0], [W, H]])
    .on('zoom', ev => {
      k = ev.transform.k;
      g.attr('transform', ev.transform);
      listras.attr('patternTransform', `rotate(45) scale(${1 / k})`);
      escalarMarcas();
    });
  svg.call(zoom).on('dblclick.zoom', null);
  fundo.on('click', () => voltar());

  // Pontos e rótulos ficam do mesmo tamanho na tela em qualquer zoom.
  function escalarMarcas() {
    marcadores.attr('r', 4.5 / Math.sqrt(k));
    rotulosUF.style('display', k >= K_ROTULOS_UF ? null : 'none')
      .style('font-size', `${10.5 / k}px`).style('stroke-width', `${3 / k}px`);
    gCidades.selectAll('circle').attr('r', 5.5 / k);
    gCidades.selectAll('text').style('font-size', `${11 / k}px`).style('stroke-width', `${3 / k}px`).attr('dx', 8 / k).attr('dy', 4 / k);
  }

  function enquadrarCaixa([[x0, y0], [x1, y1]], folga, max) {
    const escala = Math.min(max, folga / Math.max((x1 - x0) / W, (y1 - y0) / H, 1e-3));
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(750).call(zoom.transform, t);
  }

  function enquadrar(id) {
    const f = porId.get(id);
    let pontos = Object.values(CITIES).filter(c => c[0] === id).map(([, lat, lon]) => proj([lon, lat]));
    let bounds;
    if (f) {
      const maior = maiorPoligono(f);
      bounds = path.bounds(maior);
      // Ignora cidades muito longe do território principal (ex.: Guiana Francesa para a França).
      const [, latC] = d3.geoCentroid(maior);
      pontos = Object.values(CITIES).filter(c => c[0] === id && Math.abs(c[1] - latC) < 30).map(([, lat, lon]) => proj([lon, lat]));
    } else {
      bounds = [pontos[0], pontos[0]];
    }
    for (const [x, y] of pontos) {
      bounds = [[Math.min(bounds[0][0], x), Math.min(bounds[0][1], y)], [Math.max(bounds[1][0], x), Math.max(bounds[1][1], y)]];
    }
    enquadrarCaixa(bounds, 0.75, 40);
  }

  // Um ou mais estados (soma), com folga em volta.
  function enquadrarEstados(ufs) {
    const cs = ufs.map(u => caixaUF.get(u)).filter(Boolean);
    if (!cs.length) { resetar(); return; }
    enquadrarCaixa([[d3.min(cs, c => c[0][0]), d3.min(cs, c => c[0][1])], [d3.max(cs, c => c[1][0]), d3.max(cs, c => c[1][1])]], 0.8, 150);
  }

  const resetar = () => svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);

  // Enquadra um grupo de cidades (continente), com folga em volta.
  function enquadrarCidades(cds) {
    if (!cds.length) { resetar(); return; }
    const pts = cds.map(cd => proj([CITIES[cd][2], CITIES[cd][1]]));
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    enquadrarCaixa([[Math.min(...xs) - 25, Math.min(...ys) - 25], [Math.max(...xs) + 25, Math.max(...ys) + 25]], 0.9, 12);
  }

  document.querySelectorAll('[data-zoom]').forEach(btn => btn.addEventListener('click', () => {
    if (state.aba !== 'mapa') return;
    const acao = btn.dataset.zoom;
    if (acao === 'reset') { selecionar(null); return; }
    svg.transition().duration(300).call(zoom.scaleBy, acao === 'in' ? 1.8 : 1 / 1.8);
  }));

  mundo = { svg, paths, pathsUF, marcadores, gCidades, proj, enquadrar, enquadrarEstados, enquadrarCidades, resetar, escalarMarcas, enquadrado: null };
  escalarMarcas();
  pintarMundo();
}

/* ---------------- mapa dos presídios ---------------- */

let mapaPresidios = null;

async function montarPresidios() {
  const [topo] = await Promise.all([d3.json('data/br-uf.json'), carregarListaPresidios()]);
  const fc = topojson.feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
  const W = 600, H = 560;
  const proj = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], fc);
  const path = d3.geoPath(proj);
  const svg = d3.select('#mapa-presidios').append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const fundo = svg.append('rect').attr('width', W).attr('height', H).style('fill', 'var(--ocean)');
  const g = svg.append('g');
  // Estados pintados pela soma dos presídios de cada um, com a mesma escala do mapa principal; clicar
  // num estado mostra a soma e a lista dele. Estado sem seção em presídio fica neutro e não é clicável.
  const uf = f => f.properties.sigla.toLowerCase();
  const temPresidio = new Set(listaPresidios.map(sec => sec.uf));
  const estados = g.append('g').selectAll('path').data(fc.features).join('path')
    .attr('class', f => `regiao${temPresidio.has(uf(f)) ? ' ativa' : ''}`)
    .attr('d', path)
    .attr('data-id', uf)
    .on('mouseenter mousemove', (ev, f) => {
      const qtd = presidiosDaUF(uf(f)).length;
      mostrarTooltip(ev, {
        titulo: UFS[uf(f)], icone: `<span class="linha-ic">${uf(f).toUpperCase()}</span>`,
        r: qtd ? resultadoPresidiosUF(uf(f)) : null, urnas: urnasBrasil(dataEleicao()),
        extra: `<div class="tt-sub" style="margin:6px 0 0">${qtd ? `${qtd} ${qtd > 1 ? 'seções' : 'seção'} em presídios` : 'Sem seção em presídio'}</div>`,
      });
    })
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, f) => { if (temPresidio.has(uf(f))) selecionar(uf(f)); });
  const caixaUF = new Map(fc.features.map(f => [uf(f), path.bounds(f)]));
  const comCoordenada = listaPresidios.filter(sec => sec.lat != null);
  const forma = sec => d3.symbol().type(sec.tipo === 'socioeducativo' ? d3.symbolSquare : d3.symbolCircle).size(sec.tipo === 'socioeducativo' ? 70 : 80)();
  const pontos = g.append('g').selectAll('path').data(comCoordenada, sec => sec.id).join('path')
    .attr('class', 'presidio')
    .attr('data-id', sec => sec.id)
    .attr('d', forma)
    .on('mouseenter mousemove', (ev, sec) => mostrarTooltip(ev, {
      titulo: nomeLocal(sec.nome),
      icone: `<span class="linha-ic">${sec.uf.toUpperCase()}</span>`,
      r: dados.presidios[sec.id],
      urnas: urnasBrasil(dataEleicao()),
      extra: `<div class="tt-sub" style="margin:6px 0 0">${TIPO_PRESIDIO[sec.tipo]} · ${esc(sec.municipio)}/${sec.uf.toUpperCase()}</div>`,
    }))
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, sec) => { ev.stopPropagation(); selecionar(sec.id); });

  let k = 1;
  // Ao aproximar, o ponto cresce só um pouco na tela (k^0,15), para separar vizinhos sem virar bolha.
  const posicionar = () => pontos.attr('transform', sec => `translate(${proj([sec.lon, sec.lat])}) scale(${k ** -0.85})`);
  const zoom = d3.zoom().scaleExtent([1, 40]).translateExtent([[0, 0], [W, H]])
    .on('zoom', ev => { k = ev.transform.k; g.attr('transform', ev.transform); posicionar(); });
  svg.call(zoom).on('dblclick.zoom', null);
  fundo.on('click', () => selecionar(null));
  posicionar();

  document.querySelectorAll('[data-zoom]').forEach(btn => btn.addEventListener('click', () => {
    if (state.aba !== 'presidios') return;
    const acao = btn.dataset.zoom;
    if (acao === 'reset') { selecionar(null); svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity); return; }
    svg.transition().duration(300).call(zoom.scaleBy, acao === 'in' ? 1.8 : 1 / 1.8);
  }));

  // Seleção pela lista: aproxima o ponto, ou o estado inteiro.
  const enquadrar = sec => {
    if (!sec || sec.lat == null) return;
    const [x, y] = proj([sec.lon, sec.lat]);
    const escala = Math.max(k, 6);
    svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-x, -y));
  };
  const enquadrarUF = u => {
    const caixa = caixaUF.get(u);
    if (!caixa) return;
    const [[x0, y0], [x1, y1]] = caixa;
    const escala = Math.min(40, 0.85 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  };
  const resetar = () => svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity);
  mapaPresidios = { pontos, estados, enquadrar, enquadrarUF, resetar, enquadrado: null };
  pintarPresidios();
}

function pintarPresidios() {
  if (!mapaPresidios) return;
  const u = urnasBrasil(dataEleicao());
  // Ponto pequeno não leva hachura: antes das 17h ele fica no cinza claro de "ainda votando".
  const urnas = u.estado === 'fechada' ? u : { estado: 'antes' };
  const sel = state.aba === 'presidios' ? state.sel : null;
  const ufSel = UFS[sel] ? sel : null;
  mapaPresidios.estados
    .style('fill', f => {
      const u = f.properties.sigla.toLowerCase();
      return presidiosDaUF(u).length ? corRegiao(resultadoPresidiosUF(u), urnas) : css('--land');
    })
    .classed('sel', f => f.properties.sigla.toLowerCase() === ufSel);
  mapaPresidios.pontos
    .style('fill', sec => corRegiao(dados.presidios[sec.id], urnas))
    .classed('sel', sec => sec.id === sel);
  // O selecionado vai para cima dos vizinhos.
  mapaPresidios.pontos.filter(sec => sec.id === sel).raise();
  if (state.aba === 'presidios' && mapaPresidios.enquadrado !== sel) {
    // Do estado para um presídio dele, aproxima o ponto; voltar do presídio para o estado reenquadra o estado.
    mapaPresidios.enquadrado = sel;
    if (ufSel) mapaPresidios.enquadrarUF(ufSel);
    else if (sel) mapaPresidios.enquadrar(listaPresidios.find(sec => sec.id === sel));
    else mapaPresidios.resetar();
  }
}

function maiorPoligono(f) {
  if (f.geometry.type !== 'MultiPolygon') return f;
  let melhor = null;
  let area = -1;
  for (const coordinates of f.geometry.coordinates) {
    const p = { type: 'Polygon', coordinates };
    const a = d3.geoArea(p);
    if (a > area) { area = a; melhor = p; }
  }
  return melhor;
}

function pintarMundo() {
  if (!mundo) return;
  const naAba = state.aba === 'mapa';
  const paisSel = naAba && COUNTRIES[state.sel] ? state.sel : null;
  const ufSel = naAba && UFS[state.sel] ? state.sel : null;
  const multi = naAba ? state.multi : [];
  const doContinente = new Set(naAba && state.continente && !paisSel ? paisesDoContinente(state.continente) : []);
  // "Exterior" na soma acende todos os países com seção.
  const somaExterior = multi.includes('zz');
  const marcado = id => id === paisSel || doContinente.has(id) || (somaExterior && !!COUNTRIES[id]);
  const urnasBR = urnasBrasil(dataEleicao());
  mundo.pathsUF
    .style('fill', f => corRegiao(dados.ufs[f.properties.sigla.toLowerCase()], urnasBR))
    .classed('sel', f => { const u = f.properties.sigla.toLowerCase(); return u === ufSel || multi.includes(u); });
  mundo.paths
    .style('fill', f => (COUNTRIES[f.id] ? corRegiao(dados.paises[f.id], urnasPais(f.id, dataEleicao())) : css('--land')))
    .classed('sel', f => marcado(f.id));
  mundo.marcadores
    .style('fill', d => corRegiao(dados.paises[d.id], urnasPais(d.id, dataEleicao())))
    .classed('sel', d => marcado(d.id));

  const cidades = paisSel ? Object.values(dados.cidades).filter(c => c.pais === paisSel && (!state.continente || continenteDaCidade(c.cd) === state.continente)) : [];
  const grupos = mundo.gCidades.selectAll('g.cid').data(cidades, c => c.cd).join(entrar => {
    const gg = entrar.append('g').attr('class', 'cid');
    gg.append('circle').attr('class', 'cidade')
      .on('mouseenter mousemove', (ev, c) => mostrarTooltip(ev, { titulo: c.nome, icone: '', r: c.r, urnas: urnasCidade(c.cd, dataEleicao()) }))
      .on('mouseleave', esconderTooltip)
      .on('click', (ev, c) => { ev.stopPropagation(); selecionarCidade(c.cd); });
    gg.append('text').attr('class', 'rotulo-cidade');
    return gg;
  });
  grupos.attr('transform', c => `translate(${mundo.proj([c.lon, c.lat])})`);
  grupos.select('circle').style('fill', c => corRegiao(c.r, urnasCidade(c.cd, dataEleicao()))).classed('sel', c => c.cd === state.cidade);
  grupos.select('text').text(c => c.nome);
  mundo.escalarMarcas();

  // Aproxima o mapa do que está escolhido no painel (escolher uma cidade não mexe no enquadramento).
  const alvoMapa = !naAba ? null
    : multi.length ? `soma:${multi.join(',')}`
    : ufSel ? `uf:${ufSel}`
    : paisSel ? `pais:${paisSel}`
    : state.continente ? `cont:${state.continente}` : null;
  if (naAba && mundo.enquadrado !== alvoMapa) {
    mundo.enquadrado = alvoMapa;
    if (multi.length) mundo.enquadrarEstados(multi.filter(u => UFS[u]));
    else if (ufSel) mundo.enquadrarEstados([ufSel]);
    else if (paisSel) mundo.enquadrar(paisSel);
    else if (state.continente) mundo.enquadrarCidades(cidadesDoContinente(state.continente));
    else mundo.resetar();
  }
}

/* ---------------- painel lateral ---------------- */

function progressoHtml(r) {
  const p = pctApurado(r);
  const txt = r.boletins ? `${fmtPct(p)} das seções, pelos boletins de urna`
    : r.secoesTot ? `${fmtPct(p)} das seções apuradas` : 'Apuração não iniciada';
  return `<div class="progresso">
    <div class="progresso-trilho"><span style="width:${p}%"></span></div>
    <div class="progresso-txt"><span>${txt}</span><span>${fmt.format(r.secoesTot)}/${fmt.format(r.secoes)}</span></div>
  </div>`;
}

const MAX_CANDS = 4;

// Diferença para o turno anterior, à esquerda do número: verde quando subiu, laranja quando caiu.
function deltaHtml(agora, antes, pct = false) {
  if (antes == null) return '';
  const d = agora - antes;
  const sinal = d > 0 ? '+' : d < 0 ? '−' : '±';
  const valor = pct ? fmtPct(Math.abs(d)) : fmt.format(Math.abs(d));
  return `<small class="delta${d > 0 ? ' mais' : d < 0 ? ' menos' : ''}">(${sinal}${valor})</small>`;
}

// antes: o resultado do turno anterior no mesmo lugar (na comparação), para mostrar a diferença.
function candidatosHtml(r, ele = state.ele, antes = null) {
  const doAntes = c => antes?.cands.find(x => x.n === c.n);
  const outros = r.cands.slice(MAX_CANDS);
  const somaOutros = outros.reduce((s, c) => s + c.votos, 0);
  const linhaOutros = outros.length > 1 ? `
    <li class="cand compacto">
      <i class="ponto" style="--cor:${corCand('')}"></i>
      <div><div class="cand-nome">Outros ${outros.length} candidatos</div><div class="cand-partido">${outros.slice(0, 3).map(c => esc(c.nome)).join(', ')}…</div></div>
      <div><div class="cand-pct">${fmtPct(r.validos ? somaOutros / r.validos * 100 : 0)}</div><div class="cand-votos">${fmt.format(somaOutros)}</div></div>
    </li>` : '';
  const visiveis = outros.length > 1 ? r.cands.slice(0, MAX_CANDS) : r.cands;
  return `<ol class="cands">${visiveis.map(c => `
    <li class="cand">
      ${fotoTag(ele, c, 'p')}
      <div><div class="cand-nome">${esc(c.nome)}</div><div class="cand-partido">${esc(c.partido)} · ${esc(c.n)}</div></div>
      <div><div class="cand-pct">${deltaHtml(c.pct, doAntes(c)?.pct, true)}${fmtPct(c.pct)}</div><div class="cand-votos">${deltaHtml(c.votos, doAntes(c)?.votos)}${fmt.format(c.votos)}</div></div>
      <div class="cand-barra"><span style="width:${c.pct}%;background:${corCand(c.n)}"></span></div>
    </li>`).join('')}${linhaOutros}</ol>`;
}

function statsHtml(r, antes = null) {
  const comp = r.comparecimento;
  const base = comp + r.abstencao;
  const p = (v, b) => (r.secoesTot && b ? `<small>${fmtPct(v / b * 100, 1)}</small>` : '');
  const n = k => `${deltaHtml(r[k], antes?.[k])}${fmt.format(r[k])}`;
  return `<dl class="stats">
    <div><dt>Eleitorado</dt><dd>${n('eleitorado')}</dd></div>
    <div><dt>Votos válidos</dt><dd>${n('validos')}</dd></div>
    <div><dt>Comparecimento</dt><dd>${n('comparecimento')}${p(comp, base)}</dd></div>
    <div><dt>Abstenção</dt><dd>${n('abstencao')}${p(r.abstencao, base)}</dd></div>
    <div><dt>Brancos</dt><dd>${n('brancos')}${p(r.brancos, comp)}</dd></div>
    <div><dt>Nulos</dt><dd>${n('nulos')}${p(r.nulos, comp)}</dd></div>
  </dl>`;
}

function detalheHtml({ voltar, icone, titulo, sub, r, urnas = null, comparar = false }) {
  const linhaUrnas = urnas && (!r || !r.validos) ? `<p class="urnas-linha">${marcaUrna(urnas)}<span>${textoUrnas(urnas)}</span></p>` : '';
  return `${voltar ? `<button type="button" class="lat-voltar" data-voltar>← ${esc(voltar)}</button>` : ''}
    <div class="lat-cab">${icone || ''}<div><h2 class="lat-titulo">${esc(titulo)}</h2>${sub ? `<p class="lat-sub">${sub}</p>` : ''}</div></div>
    ${comparar ? '<p class="dica-soma"><button type="button" class="chip" data-comparar>Comparar 1º e 2º turno</button></p>' : ''}
    ${linhaUrnas}
    ${r ? progressoHtml(r) + candidatosHtml(r) + statsHtml(r) : '<p class="vazio">Carregando resultados…</p>'}`;
}

function miniBarra(r) {
  const [a, b] = duelo();
  const ca = r ? r.cands.find(c => c.n === a.n) : null;
  const cb = r ? r.cands.find(c => c.n === b.n) : null;
  if (!ca || !cb || !r.validos) return '<div class="mini"></div>';
  return `<div class="mini"><span style="width:${ca.pct}%;background:${corCand(a.n)}"></span><span style="flex:1"></span><span style="width:${cb.pct}%;background:${corCand(b.n)}"></span></div>`;
}

function liderPct(r, urnas = null) {
  if ((!r || !r.validos) && urnas?.estado === 'sem-votacao') return `<span style="color:var(--ink-3)" title="${esc(TEXTO_SEM_VOTACAO)}">sem votação</span>`;
  if ((!r || !r.validos) && urnas) return `<span title="${esc(textoUrnas(urnas))}">${marcaUrna(urnas)}${horaBrasilia(urnas.fecha, dataEleicao())}</span>`;
  if (!r || !r.validos) return r ? '<span style="color:var(--ink-3)">—</span>' : '';
  const c = r.cands[0];
  return `<i class="ponto" style="--cor:${corCand(c.n)};display:inline-block;width:7px;height:7px;margin-right:5px;vertical-align:1px"></i>${fmtPct(c.pct, 1)}`;
}

function vantagem(r) {
  const [a, b] = duelo();
  if (!r || !r.validos) return -Infinity;
  return (votosDe(r, a.n) - votosDe(r, b.n)) / r.validos;
}

function ordenar(linhas, ordem) {
  const por = {
    eleitorado: (x, y) => (y.r?.eleitorado ?? 0) - (x.r?.eleitorado ?? 0) || x.nome.localeCompare(y.nome, 'pt-BR'),
    vantagem: (x, y) => vantagem(y.r) - vantagem(x.r),
    nome: (x, y) => x.nome.localeCompare(y.nome, 'pt-BR'),
    fechamento: (x, y) => (x.urnas?.fecha ?? 0) - (y.urnas?.fecha ?? 0) || x.nome.localeCompare(y.nome, 'pt-BR'),
  };
  return linhas.sort(por[ordem]);
}

const ROTULO_ORDEM = { eleitorado: 'eleitorado', vantagem: 'vantagem', fechamento: 'fechamento (Brasília)', nome: 'A–Z' };
const PROXIMA_ORDEM = { eleitorado: 'vantagem', vantagem: 'fechamento', fechamento: 'nome', nome: 'eleitorado' };

function listaHtml(titulo, linhas, padrao = 'eleitorado') {
  const [a] = duelo();
  const ordem = ordemAtual(padrao);
  const dicaOrdem = ordem === 'vantagem' && a ? ` (${esc(a.nome)} primeiro)` : '';
  return `<div class="lista-cab"><h3>${esc(titulo)}</h3>
      <button type="button" class="ordem" data-ordem="${ordem}">Ordem: ${ROTULO_ORDEM[ordem]}${dicaOrdem} ↕</button></div>
    <ul class="linhas">${ordenar(linhas, ordem).map(l => `
      <li><button type="button" class="linha${l.marcada ? ' marcada' : ''}" data-ir="${esc(l.id)}" data-tipo="${l.tipo}"${l.marcada != null ? ` aria-pressed="${l.marcada}"` : ''}>
        <span class="linha-ic${l.bandeira ? ' bandeira' : ''}">${l.icone}</span>
        <span class="linha-nome">${esc(l.nome)}${l.nota ? `<small>${esc(l.nota)}</small>` : ''}</span>
        ${miniBarra(l.r)}
        <span class="linha-pct">${liderPct(l.r, l.urnas)}</span>
      </button></li>`).join('') || '<li class="vazio">Nada encontrado.</li>'}</ul>`;
}

let chaveLateral = '';

function renderLateral() {
  const el = $('#lateral');
  const chave = `${state.ele}|${state.aba}|${state.sel}|${state.cidade}|${state.continente}|${state.multi.length > 0}`;
  if (chave !== chaveLateral) { chaveLateral = chave; el.scrollTop = 0; }
  if (!dados.br) { el.innerHTML = '<p class="vazio">Carregando resultados do TSE…</p>'; return; }
  const focoBusca = document.activeElement?.id === 'busca';
  el.innerHTML = state.aba === 'presidios' ? lateralPresidios() : lateralMapa();
  if (focoBusca) {
    const b = $('#busca');
    b.focus();
    b.setSelectionRange(b.value.length, b.value.length);
  }
}

function lateralMapa() {
  if (state.multi.length) return painelSelecao();
  if (state.sel && UFS[state.sel]) return painelEstado();
  if (state.cidade || state.continente || (state.sel && COUNTRIES[state.sel])) return lateralExterior();
  return painelGeral();
}

// Visão geral: o Brasil (regiões e estados) e o exterior (continentes e países), com uma busca para os dois.
function painelGeral() {
  const termo = normalizar(state.busca);
  const acha = l => !termo || normalizar(l.nome).includes(termo);
  const estados = Object.entries(UFS).map(([uf, nome]) => ({ id: uf, tipo: 'uf', icone: uf.toUpperCase(), nome, r: dados.ufs[uf] })).filter(acha);
  const qtd = {};
  for (const c of Object.values(dados.cidades)) qtd[c.pais] = (qtd[c.pais] ?? 0) + 1;
  const paises = Object.entries(COUNTRIES)
    .map(([id, p]) => ({ id, tipo: 'pais', icone: flagEmoji(p.iso2), bandeira: true, nome: p.nome, nota: qtd[id] > 1 ? `${qtd[id]} cidades` : '', r: dados.paises[id], urnas: urnasPais(id, dataEleicao()) }))
    .filter(acha);
  const zz = dados.zz;
  return `<div class="lat-cab"><div><h2 class="lat-titulo">Brasil</h2><p class="lat-sub">Clique num estado ou país, no mapa ou na lista, para ver o resultado dele; num país, aparecem as cidades com seção eleitoral.</p></div></div>
    ${progressoHtml(dados.br)}
    ${botaoSomar()}
    <input id="busca" class="busca" type="search" placeholder="Buscar estado ou país…" value="${esc(state.busca)}" autocomplete="off">
    ${termo ? '' : listaHtml('Por região', linhasRegioes())}
    ${listaHtml(`Estados (${estados.length})`, estados)}
    <div class="lat-cab lat-secao"><span class="lat-uf">🌎</span><div><h2 class="lat-titulo">Exterior</h2><p class="lat-sub">Brasileiros votando fora do país</p></div></div>
    ${zz ? progressoHtml(zz) + (zz.validos ? candidatosHtml(zz) : '') : ''}
    ${zz && !zz.validos ? `<p class="urnas-resumo">${avisoExterior()}</p>` : ''}
    ${termo ? '' : listaHtml('Por continente', linhasContinentes(), ordemExterior())}
    ${listaHtml(`Países (${paises.length})`, paises, ordemExterior())}`;
}

function painelEstado() {
  const uf = state.sel;
  const regiao = Object.entries(REGIOES).find(([, reg]) => reg.ufs.includes(uf));
  return detalheHtml({
    voltar: 'Visão geral', icone: `<span class="lat-uf">${uf.toUpperCase()}</span>`, titulo: UFS[uf],
    sub: `Estado · Região ${regiao[1].nome}`, r: dados.ufs[uf], urnas: urnasBrasil(dataEleicao()), comparar: true,
  }) + botaoSomar() + listaHtml(`Região ${regiao[1].nome}`, regiao[1].ufs.map(u => ({ id: u, tipo: 'uf', icone: u.toUpperCase(), nome: UFS[u], r: dados.ufs[u], marcada: u === uf ? true : undefined })));
}

/* ----- soma de estados (Ctrl/⌘ + clique) ----- */

const somar_ = ev => ev.metaKey || ev.ctrlKey || state.somando;
const nomeRecorte = id => (id === 'zz' ? 'Exterior' : UFS[id]);
const resultadoRecorte = id => (id === 'zz' ? dados.zz : dados.ufs[id]);

function botaoSomar() {
  const tecla = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  return `<p class="dica-soma"><button type="button" class="chip${state.somando ? ' ligado' : ''}" data-somar aria-pressed="${state.somando}">${state.somando ? '✓ Somando estados' : 'Somar estados'}</button>
    <span>ou ${tecla} + clique nos estados (no mapa ou na lista) para ver o total da seleção.</span></p>`;
}

// Um estado, ou vários de uma vez (uma região: se todos já estão, saem todos; senão, entram os que faltam).
function alternarMulti(ids) {
  const lista = [].concat(ids);
  let atual = state.multi.length ? [...state.multi] : (state.sel && UFS[state.sel] ? [state.sel] : []);
  atual = lista.every(id => atual.includes(id)) ? atual.filter(x => !lista.includes(x)) : [...atual, ...lista.filter(id => !atual.includes(id))];
  state.busca = '';
  // A soma vale desde o primeiro estado; vazia, volta para o Brasil.
  state.multi = atual;
  state.sel = null;
  state.continente = null;
  state.cidade = null;
  esconderTooltip();
  gravarHash();
  render();
}

function selecionarRegiao(id) {
  state.multi = [...REGIOES[id].ufs];
  state.sel = null;
  state.continente = null;
  state.cidade = null;
  state.busca = '';
  esconderTooltip();
  gravarHash();
  render();
}

function linhasRegioes() {
  return Object.entries(REGIOES).map(([id, reg]) => ({
    id, tipo: 'regiao', icone: reg.sigla, nome: reg.nome, nota: `${reg.ufs.length} estados`,
    r: reg.ufs.every(uf => dados.ufs[uf]) ? somar(reg.ufs.map(uf => dados.ufs[uf])) : null,
    marcada: state.multi.length ? reg.ufs.every(uf => state.multi.includes(uf)) : undefined,
  }));
}

function painelSelecao() {
  const ids = state.multi;
  const rs = ids.map(resultadoRecorte).filter(Boolean);
  if (rs.length < ids.length) return '<p class="vazio">Carregando os resultados da seleção…</p>';
  const total = somar(rs);
  const estados = ids.filter(id => id !== 'zz').length;
  // A seleção é exatamente uma região? Então ela leva o nome da região.
  const regiao = Object.values(REGIOES).find(reg => reg.ufs.length === ids.length && reg.ufs.every(uf => ids.includes(uf)));
  const titulo = regiao ? `Região ${regiao.nome}` : `Seleção: ${estados} ${estados === 1 ? 'estado' : 'estados'}${ids.includes('zz') ? ' + exterior' : ''}`;
  // Lista completa (estados e exterior), com os da soma marcados, para seguir somando por ela.
  const linhas = [...Object.keys(UFS), 'zz'].map(id => ({
    id, tipo: 'uf', icone: id === 'zz' ? '🌎' : id.toUpperCase(), bandeira: id === 'zz', nome: nomeRecorte(id), r: resultadoRecorte(id), marcada: ids.includes(id),
  }));
  const pctEleitorado = dados.br?.eleitorado ? (total.eleitorado / dados.br.eleitorado) * 100 : 0;
  return detalheHtml({
    voltar: 'Visão geral', icone: '<span class="lat-uf">Σ</span>', titulo,
    sub: `${esc(ids.map(nomeRecorte).join(', '))} · ${fmtPct(pctEleitorado, 1)} do eleitorado`,
    r: total,
  }) + `<p class="dica-soma"><button type="button" class="chip" data-limpar-soma>Limpar seleção</button>${botaoSomar().replace(/^<p class="dica-soma">|<\/p>$/g, '')}</p>`
    + listaHtml('Regiões · Ctrl/⌘ + clique inclui ou tira', linhasRegioes())
    + listaHtml('Estados · Ctrl/⌘ + clique inclui ou tira', linhas);
}

// Cidades do exterior por continente (Caiena e Saint-Georges na América do Sul, não na Europa).
const cidadesDoContinente = cont => Object.keys(CITIES).filter(cd => continenteDaCidade(cd) === cont);
// Países destacados no mapa: os que têm o continente como "casa" (a França não acende na América do Sul).
const paisesDoContinente = cont => [...new Set(cidadesDoContinente(cont).map(cd => CITIES[cd][0]))].filter(id => continenteDoPais(id) === cont);

function resultadoCidades(cds) {
  const rs = cds.map(cd => dados.cidades[cd]?.r);
  return rs.length && rs.every(Boolean) ? somarCidades(rs) : null;
}

function linhasContinentes() {
  return Object.entries(CONTINENTES).map(([id, nome]) => {
    const cds = cidadesDoContinente(id);
    const paises = new Set(cds.map(cd => CITIES[cd][0])).size;
    return { id, tipo: 'continente', icone: '🌐', bandeira: true, nome, nota: `${paises} ${paises > 1 ? 'países' : 'país'}`, r: resultadoCidades(cds), urnas: urnasCidades(cds, dataEleicao()) };
  });
}

function selecionarContinente(id) {
  state.continente = id;
  state.sel = null;
  state.cidade = null;
  state.busca = '';
  esconderTooltip();
  gravarHash();
  render();
}

function painelContinente() {
  const cont = state.continente;
  const cds = cidadesDoContinente(cont);
  const porPais = d3.group(cds, cd => CITIES[cd][0]);
  const linhas = [...porPais].map(([id, doPais]) => ({
    id, tipo: 'pais', icone: flagEmoji(COUNTRIES[id].iso2), bandeira: true, nome: nomePaisNoContinente(id, cont),
    nota: doPais.length > 1 ? `${doPais.length} cidades` : '', r: resultadoCidades(doPais), urnas: urnasCidades(doPais, dataEleicao()),
  }));
  return detalheHtml({
    voltar: 'Visão geral', icone: '<span class="lat-uf">🌐</span>', titulo: CONTINENTES[cont],
    sub: `${porPais.size} ${porPais.size > 1 ? 'países' : 'país'} · ${cds.length} ${cds.length > 1 ? 'cidades' : 'cidade'} com seção eleitoral`,
    r: resultadoCidades(cds), urnas: urnasCidades(cds, dataEleicao()),
  }) + listaHtml(`Países (${porPais.size})`, linhas, ordemExterior());
}

function lateralExterior() {
  const cidadesDo = id => Object.values(dados.cidades).filter(c => c.pais === id);
  if (state.continente && !state.sel && !state.cidade) return painelContinente();
  if (state.cidade && dados.cidades[state.cidade]) {
    const c = dados.cidades[state.cidade];
    const p = COUNTRIES[c.pais];
    return detalheHtml({ voltar: p.nome, icone: `<span class="lat-bandeira">${flagEmoji(p.iso2)}</span>`, titulo: c.nome, sub: `Cidade · ${esc(p.nome)}`, r: c.r, urnas: urnasCidade(c.cd, dataEleicao()) });
  }
  if (state.sel && COUNTRIES[state.sel]) {
    const p = COUNTRIES[state.sel];
    const cont = state.continente;
    // Aberto de dentro de um continente: o país só com as cidades daquele continente (Guiana Francesa ≠ França europeia).
    const cidades = cidadesDo(state.sel).filter(c => !cont || continenteDaCidade(c.cd) === cont);
    const cds = cidades.map(c => c.cd);
    const sub = cidades.length ? `${cidades.length} ${cidades.length > 1 ? 'cidades' : 'cidade'} com seção eleitoral${cont ? ` · ${CONTINENTES[cont]}` : ''}` : '';
    let html = detalheHtml({
      voltar: cont ? CONTINENTES[cont] : 'Visão geral', icone: `<span class="lat-bandeira">${flagEmoji(p.iso2)}</span>`,
      titulo: cont ? nomePaisNoContinente(state.sel, cont) : p.nome, sub,
      r: cont ? resultadoCidades(cds) : dados.paises[state.sel],
      urnas: cont ? urnasCidades(cds, dataEleicao()) : urnasPais(state.sel, dataEleicao()),
      comparar: true,
    });
    if (cidades.length > 1) {
      html += listaHtml('Cidades', cidades.map(c => ({ id: c.cd, tipo: 'cidade', icone: '•', nome: c.nome, r: c.r, urnas: urnasCidade(c.cd, dataEleicao()) })));
    }
    return html;
  }
  return painelGeral();
}

// Lista "por tipo de unidade" e a lista de seções (com busca) de um grupo de presídios.
function listasPresidios(secoes) {
  const porTipo = Object.keys(TIPO_PRESIDIO).map(tipo => {
    const doTipo = secoes.filter(x => x.tipo === tipo);
    return { tipo, qtd: doTipo.length, r: somar(doTipo.map(x => dados.presidios[x.id])) };
  }).filter(t => t.qtd);
  const termo = normalizar(state.busca);
  const linhas = secoes
    .filter(x => !termo || normalizar(`${x.nome} ${x.municipio} ${x.uf}`).includes(termo))
    .map(x => ({ id: x.id, tipo: 'presidio', icone: x.uf.toUpperCase(), nome: nomeLocal(x.nome), nota: x.municipio, r: dados.presidios[x.id] }));
  return `<div class="lista-cab"><h3>Por tipo de unidade</h3></div>
      <ul class="linhas">${porTipo.map(t => `
        <li><div class="linha estatica">
          <span class="linha-ic">${t.tipo === 'socioeducativo' ? '■' : '●'}</span>
          <span class="linha-nome">${TIPO_PRESIDIO[t.tipo]}<small>${t.qtd} ${t.qtd > 1 ? 'seções' : 'seção'}</small></span>
          ${miniBarra(t.r)}<span class="linha-pct">${liderPct(t.r)}</span>
        </div></li>`).join('')}</ul>`
    + `<input id="busca" class="busca" type="search" placeholder="Buscar presídio ou cidade…" value="${esc(state.busca)}" autocomplete="off">`
    + listaHtml(`Seções (${secoes.length})`, linhas);
}

function lateralPresidios() {
  if (!listaPresidios || !dados.presidiosTotal) return '<p class="vazio">Carregando a lista de seções…</p>';
  const u = urnasBrasil(dataEleicao());
  const sec = state.sel && listaPresidios.find(x => x.id === state.sel);
  if (sec) {
    const agregadas = sec.agregadas?.length ? ` (inclui a seção ${sec.agregadas.join(', ')}, agregada)` : '';
    const sub = `${TIPO_PRESIDIO[sec.tipo]} · ${esc(sec.municipio)}/${sec.uf.toUpperCase()} · zona ${sec.zona}, seção ${sec.secao}${agregadas}`;
    return detalheHtml({ voltar: UFS[sec.uf], icone: `<span class="lat-uf">${sec.uf.toUpperCase()}</span>`, titulo: nomeLocal(sec.nome), sub, r: dados.presidios[sec.id], urnas: u })
      + (sec.aprox ? '<p class="urnas-resumo">Localização aproximada: o cadastro do TSE não traz as coordenadas deste local, então o ponto fica no centro do município.</p>' : '');
  }
  const antes = u.estado !== 'fechada'
    ? `<p class="urnas-resumo">Os boletins dessas seções só saem depois que as urnas do Brasil fecham, às <b>17h de Brasília</b>. Até lá a página não consulta nada delas; depois, confere cada seção ainda sem boletim a cada 5 minutos.</p>`
    : '';
  if (UFS[state.sel]) {
    const uf = state.sel;
    const doEstado = presidiosDaUF(uf);
    return detalheHtml({
      voltar: 'Todos os presídios', icone: `<span class="lat-uf">${uf.toUpperCase()}</span>`, titulo: UFS[uf],
      sub: `Presídios do estado · ${doEstado.length} ${doEstado.length > 1 ? 'seções' : 'seção'}. Resultado somado dos boletins de urna já publicados.`,
      r: resultadoPresidiosUF(uf), urnas: u,
    }) + antes + listasPresidios(doEstado);
  }
  const ufs = [...new Set(listaPresidios.map(x => x.uf))];
  const porEstado = ufs.map(uf => ({ id: uf, tipo: 'uf', icone: uf.toUpperCase(), nome: UFS[uf], nota: `${presidiosDaUF(uf).length} seções`, r: resultadoPresidiosUF(uf) }));
  return detalheHtml({
    titulo: 'Presídios',
    sub: `Seções para presos provisórios e adolescentes internados · ${listaPresidios.length} seções em ${ufs.length} estados. Resultado somado dos boletins de urna já publicados. Clique num estado para ver a soma dele.`,
    r: dados.presidiosTotal,
  }) + antes + listaHtml(`Por estado (${ufs.length})`, porEstado) + listasPresidios(listaPresidios);
}

const normalizar = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* ---------------- comparar 1º e 2º turno ---------------- */

// Popup com as fichas dos dois turnos lado a lado, para o estado ou país aberto no painel. O turno que está
// na tela vem do que já foi carregado; o outro sai do cache dele e só consulta o TSE pelo que falta (o 1º
// turno, encerrado, vem uma vez e fica guardado).
const TURNOS = ['6257', '6258'];
const dialogo = $('#comparar');
let pedidoComparacao = 0;

// Cidades do país (aberto de dentro de um continente: só as daquele continente).
const cidadesDoPais = (id, cont) => Object.keys(CITIES).filter(cd => CITIES[cd][0] === id && (!cont || continenteDaCidade(cd) === cont));

// Baixa um resultado do outro turno para a comparação: pronto não baixa mais; em andamento, no máximo uma
// vez por minuto (como o ciclo); e o mesmo pedido em andamento é reaproveitado se o popup for reaberto.
const emVooComparacao = new Map();

function baixarParaComparar(ele, cache, id, buscar) {
  const atual = cache.get(id);
  if (pronto(atual) || (atual?.baixadoEm && Date.now() - atual.baixadoEm < INTERVALO)) return null;
  const chave = `${ele}|${id}`;
  if (!emVooComparacao.has(chave)) {
    emVooComparacao.set(chave, buscar().then(r => guardar(cache, id, r)).finally(() => emVooComparacao.delete(chave)));
  }
  return emVooComparacao.get(chave);
}

async function fichaDoTurno(ele, alvo) {
  if (ele === dados.ele) return alvo.uf ? dados.ufs[alvo.uf] ?? null : resultadoCidades(alvo.cds);
  const cache = Cache.da(ele);
  const d = ELEICOES[ele].data;
  if (!cache.get('br')) await baixarParaComparar(ele, cache, 'br', () => fetchResultado(ele, 'br'));
  const modelo = cache.get('br');
  // Pelo relógio, onde a urna ainda não fechou não há o que baixar.
  if (alvo.uf) {
    if (urnasBrasil(d).estado === 'fechada') await baixarParaComparar(ele, cache, alvo.uf, () => fetchResultado(ele, alvo.uf));
    return cache.get(alvo.uf) ?? null;
  }
  const vazio = resultadoVazio({ versao: '', eleitorado: 0, secoes: 0, andamento: 'n' }, modelo);
  const rs = await Promise.all(alvo.cds.map(async cd => {
    const id = `zz:${cd}`;
    const u = urnasCidade(cd, d);
    // Cidade sem votação (menos de 30 eleitores) entra zerada, sem consulta: não derruba a soma do país.
    if (u.estado === 'sem-votacao') return cache.get(id) ?? vazio;
    if (u.estado === 'fechada') await baixarParaComparar(ele, cache, id, () => fetchResultado(ele, 'zz', cd));
    return maisCompleto(cache.get(id) ?? null, boletinsExterior([cd], cache, modelo));
  }));
  return rs.length && rs.every(Boolean) ? somarCidades(rs) : null;
}

// antes: a ficha do 1º turno, quando esta é a do 2º (as diferenças aparecem ao lado de cada número).
function fichaHtml(ele, f, antes = null) {
  const e = ELEICOES[ele];
  const [ano, mes, dia] = e.data.split('-');
  const cab = `<h3 class="cmp-turno">${e.nome}<small>${dia}/${mes}/${ano}</small></h3>`;
  if (!f) return `${cab}<p class="vazio">Carregando…</p>`;
  if (f.erro) return `${cab}<p class="vazio">${f.erro}</p>`;
  if (!f.r?.validos) return `${cab}<p class="vazio">Sem votos apurados ainda.</p>`;
  const base = antes?.r?.validos ? antes.r : null;
  return cab + progressoHtml(f.r) + candidatosHtml(f.r, ele, base) + statsHtml(f.r, base);
}

async function abrirComparacao() {
  const uf = UFS[state.sel] ? state.sel : null;
  const pais = COUNTRIES[state.sel] ? state.sel : null;
  if (!uf && !pais) return;
  const alvo = uf ? { uf } : { cds: cidadesDoPais(pais, state.continente) };
  const titulo = uf ? UFS[uf] : state.continente ? nomePaisNoContinente(pais, state.continente) : COUNTRIES[pais].nome;
  const icone = uf ? `<span class="lat-uf">${uf.toUpperCase()}</span>` : `<span class="lat-bandeira">${flagEmoji(COUNTRIES[pais].iso2)}</span>`;
  const pedido = ++pedidoComparacao;
  const fichas = {};
  const desenhar = () => {
    dialogo.innerHTML = `<div class="cmp-cab">${icone}<h2 class="lat-titulo" id="cmp-titulo">${esc(titulo)}</h2>
        <button type="button" class="cmp-fechar" data-fechar aria-label="Fechar">×</button></div>
      <div class="cmp-grade">${TURNOS.map((ele, i) => `<section>${fichaHtml(ele, fichas[ele], i ? fichas[TURNOS[i - 1]] : null)}</section>`).join('')}</div>`;
  };
  desenhar();
  if (!dialogo.open) dialogo.showModal();
  await Promise.all(TURNOS.map(async ele => {
    try {
      fichas[ele] = { r: await fichaDoTurno(ele, alvo) };
    } catch (err) {
      fichas[ele] = { erro: err instanceof LimiteTSE ? 'O TSE limitou as consultas; tente de novo em alguns minutos.' : 'Não foi possível carregar este turno.' };
    }
    Cache.da(ele).salvar();
    if (pedido === pedidoComparacao && dialogo.open) desenhar();
  }));
}

dialogo.addEventListener('click', ev => {
  if (ev.target === dialogo || ev.target.closest('[data-fechar]')) dialogo.close();
});

/* ---------------- interação ---------------- */

function selecionar(id) {
  state.sel = id;
  state.multi = [];
  state.continente = null;
  state.cidade = null;
  state.busca = '';
  esconderTooltip();
  gravarHash();
  render();
}

function irPara(mudancas) {
  Object.assign(state, mudancas);
  state.busca = '';
  esconderTooltip();
  gravarHash();
  render();
}

// Volta um nível: cidade → país → continente → visão geral; presídio → estado; estado e soma → visão geral.
function voltar() {
  const presidio = state.aba === 'presidios' ? listaPresidios?.find(x => x.id === state.sel) : null;
  if (presidio) selecionar(presidio.uf);
  else if (state.cidade) irPara({ cidade: null });
  else if (state.sel && COUNTRIES[state.sel] && state.continente) irPara({ sel: null });
  else if (state.sel || state.continente || state.multi.length) selecionar(null);
}

function selecionarCidade(cd) {
  const c = dados.cidades[cd];
  if (!c) return;
  state.sel = c.pais;
  state.cidade = cd;
  gravarHash();
  render();
}

function trocarAba(aba) {
  if (aba === state.aba) return;
  state.aba = aba;
  state.sel = null;
  state.multi = [];
  state.somando = false;
  state.continente = null;
  state.cidade = null;
  state.busca = '';
  gravarHash();
  render();
  ativarAba(aba);
}

// Liga a carga que a aba precisa (cidades do exterior, presídios) e reavalia o ciclo.
function ativarAba(aba) {
  if (aba === 'presidios' && !dados.querPresidios) {
    dados.querPresidios = true;
    reavaliar();
  }
  if (aba === 'mapa' && !dados.querCidades) {
    dados.querCidades = true;
    reavaliar();
  }
}

function trocarEleicao(ele) {
  if (ele === state.ele) return;
  state.ele = ele;
  dados = novosDados(ele);
  aplicarCache();
  dados.querCidades = state.aba === 'mapa';
  dados.querPresidios = state.aba === 'presidios';
  if (mundo) mundo.enquadrado = undefined;
  gravarHash();
  render();
  ciclo();
}

function realcar(id, ligado) {
  const svgSel = state.aba === 'presidios' ? '#mapa-presidios' : '#mapa-mundo';
  document.querySelectorAll(`${svgSel} [data-id="${CSS.escape(id)}"]`).forEach(n => n.classList.toggle('sel', ligado || n.dataset.id === state.sel || state.multi.includes(n.dataset.id)));
}

// Ctrl/⌘ + clique (ou modo soma) numa linha de estado, região ou do exterior: entra/sai da soma.
function cliqueDeSoma(ev, t) {
  if (state.aba !== 'mapa' || !somar_(ev)) return false;
  const id = t.dataset.tipo === 'uf' ? t.dataset.ir : t.dataset.tipo === 'regiao' ? REGIOES[t.dataset.ir]?.ufs : null;
  if (!id) return false;
  ev.preventDefault();
  alternarMulti(id);
  return true;
}

document.addEventListener('contextmenu', ev => {
  const t = ev.target.closest('button.linha');
  if (t && ev.ctrlKey) cliqueDeSoma(ev, t);
});

document.addEventListener('click', ev => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (cliqueDeSoma(ev, t)) return;
  if (t.hasAttribute('data-somar')) { state.somando = !state.somando; renderLateral(); return; }
  if (t.hasAttribute('data-limpar-soma')) { state.somando = false; selecionar(null); return; }
  if (t.hasAttribute('data-comparar')) { abrirComparacao(); return; }
  if (t.dataset.ele) trocarEleicao(t.dataset.ele);
  else if (t.dataset.aba) trocarAba(t.dataset.aba);
  else if (t.hasAttribute('data-ordem')) { state.ordem = PROXIMA_ORDEM[t.dataset.ordem] ?? 'eleitorado'; renderLateral(); }
  else if (t.hasAttribute('data-voltar')) voltar();
  else if (t.dataset.ir) {
    const tipo = t.dataset.tipo;
    if (tipo === 'cidade') selecionarCidade(t.dataset.ir);
    else if (tipo === 'regiao') selecionarRegiao(t.dataset.ir);
    else if (tipo === 'continente') selecionarContinente(t.dataset.ir);
    else if (tipo === 'pais' && state.continente) irPara({ sel: t.dataset.ir, cidade: null });
    else if (t.dataset.ir === 'zz') selecionar(null); // o exterior está na visão geral
    else selecionar(t.dataset.ir);
  }
});

// Passar o mouse numa linha da lista destaca a região no mapa.
// Região e continente realçam todos os membros.
function membrosDaLinha(t) {
  if (t.dataset.tipo === 'regiao') return REGIOES[t.dataset.ir]?.ufs ?? [];
  if (t.dataset.tipo === 'continente') return paisesDoContinente(t.dataset.ir);
  if (t.dataset.tipo === 'cidade') return [];
  return [t.dataset.ir];
}
$('#lateral').addEventListener('mouseover', ev => {
  const t = ev.target.closest('.linha[data-ir]');
  if (t) membrosDaLinha(t).forEach(id => realcar(id, true));
});
$('#lateral').addEventListener('mouseout', ev => {
  const t = ev.target.closest('.linha[data-ir]');
  if (t) membrosDaLinha(t).forEach(id => realcar(id, false));
});

$('#lateral').addEventListener('input', ev => {
  if (ev.target.id !== 'busca') return;
  state.busca = ev.target.value;
  renderLateral();
});

document.addEventListener('keydown', ev => {
  // Com o popup aberto, o Esc fecha só o popup (o navegador cuida disso).
  if (ev.key === 'Escape' && !dialogo.open) voltar();
});

// Tema claro/escuro: segue o sistema até alguém escolher no botão; a escolha fica guardada.
const temaDoSistema = matchMedia('(prefers-color-scheme: dark)');
const ICONE_LUA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICONE_SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const temaEscuro = () => (document.documentElement.dataset.tema ?? (temaDoSistema.matches ? 'escuro' : 'claro')) === 'escuro';

function renderTema() {
  const escuro = temaEscuro();
  const botao = $('#tema');
  botao.innerHTML = escuro ? ICONE_SOL : ICONE_LUA;
  botao.setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
  botao.title = botao.getAttribute('aria-label');
}

$('#tema').addEventListener('click', () => {
  const tema = temaEscuro() ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = tema;
  try { localStorage.setItem('tse-tema', tema); } catch { /* sem localStorage: vale só nesta visita */ }
  renderTema();
  render(); // as cores do mapa são lidas do CSS
});
temaDoSistema.addEventListener('change', () => { renderTema(); render(); });
renderTema();

// Link colado na mesma aba (só o # muda): relê a URL e segue dali.
window.addEventListener('hashchange', () => {
  const antes = state.ele;
  lerHash();
  if (state.ele !== antes) {
    const ele = state.ele;
    state.ele = antes;
    trocarEleicao(ele);
    return;
  }
  if (mundo) mundo.enquadrado = undefined;
  render();
  ativarAba(state.aba);
});

/* ---------------- início ---------------- */

lerHash();
gravarHash(); // links antigos (aba=estados, aba=exterior) passam a apontar para a aba Mapa
dados = novosDados(state.ele);
aplicarCache();
dados.querCidades = state.aba === 'mapa';
dados.querPresidios = state.aba === 'presidios';
render();
await Promise.all([montarMundo(), montarPresidios()]);
aplicarCache();
ciclo();
