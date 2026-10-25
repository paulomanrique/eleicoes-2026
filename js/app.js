/* global d3, topojson */
import {
  ELEICOES, UFS, LimiteTSE, fetchResultado, fetchIndice, fetchMunicipiosExterior, fotoUrl,
  somar, pctApurado, pronto, resultadoVazio, fetchBoletimSecao, fetchSecoesExterior, pausadoAte,
} from './tse.js';
import { Cache } from './cache.js';
import { COUNTRIES, CITIES, CONTINENTES, flagEmoji, continenteDaCidade, continenteDoPais, nomePaisNoContinente } from './exterior.js';
import { urnasCidade, urnasCidades, urnasPais, urnasBrasil, resumoUrnas, horaBrasilia, faltam, fechamentoBrasil } from './urnas.js';

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

// Na aba Estados, sel = UF; abaixo dela: mun (código TSE), zona, bairro e local ("zona-local").
// multi: estados (e "zz", o exterior) somados com Ctrl/⌘ + clique; somando: o mesmo pelo clique simples (toque).
// continente: recorte do exterior por continente (aba Exterior).
const state = { ele: '6258', aba: 'estados', sel: null, cidade: null, mun: null, zona: null, bairro: null, local: null, multi: [], somando: false, continente: null, ordem: null, busca: '' };

const REGIOES = {
  norte: { sigla: 'N', nome: 'Norte', ufs: ['ac', 'ap', 'am', 'pa', 'ro', 'rr', 'to'] },
  nordeste: { sigla: 'NE', nome: 'Nordeste', ufs: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'] },
  'centro-oeste': { sigla: 'CO', nome: 'Centro-Oeste', ufs: ['df', 'go', 'mt', 'ms'] },
  sudeste: { sigla: 'SE', nome: 'Sudeste', ufs: ['es', 'mg', 'rj', 'sp'] },
  sul: { sigla: 'S', nome: 'Sul', ufs: ['pr', 'rs', 'sc'] },
};

// Sem ordem escolhida: no exterior, antes dos votos, a lista segue o fechamento das urnas.
const ordemAtual = () => state.ordem ?? (state.aba === 'exterior' && dados.zz && !dados.zz.validos ? 'fechamento' : 'eleitorado');

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
  if (['estados', 'exterior', 'presidios'].includes(p.get('aba'))) state.aba = p.get('aba');
  const sel = p.get('sel');
  state.sel = state.aba === 'estados' ? de(UFS, sel)
    : state.aba === 'exterior' ? de(COUNTRIES, sel)
    : /^\d{5}-\d{1,4}-\d{1,4}$/.test(sel ?? '') ? sel : null;
  state.cidade = de(CITIES, p.get('cidade'));
  state.mun = /^\d{5}$/.test(p.get('mun') ?? '') ? p.get('mun') : null;
  const zona = Number(p.get('zona'));
  state.zona = Number.isInteger(zona) && zona > 0 ? zona : null;
  state.bairro = p.get('bairro') || null;
  state.local = /^\d{1,4}-\d{1,5}$/.test(p.get('local') ?? '') ? p.get('local') : null;
  const ufs = (p.get('ufs') || '').split(',').filter(uf => uf === 'zz' || Object.hasOwn(UFS, uf));
  state.multi = [...new Set(ufs)];
  state.continente = de(CONTINENTES, p.get('cont'));
}

function gravarHash() {
  const p = new URLSearchParams({ e: state.ele, aba: state.aba });
  if (state.sel) p.set('sel', state.sel);
  if (state.cidade) p.set('cidade', state.cidade);
  for (const k of ['mun', 'zona', 'bairro', 'local']) if (state[k] != null) p.set(k, state[k]);
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

function montarCidades() {
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
    else proximo = Math.min(proximo, u.fecha);
  }
  const proximosLugares = proximo === Infinity ? [] : [
    ...(!brasilFechado && fechaBrasil === proximo ? ['Brasil'] : []),
    ...new Set(Object.keys(CITIES).filter(cd => !fechadas.has(cd) && urnasCidade(cd, d, agora).fecha === proximo).map(cd => COUNTRIES[CITIES[cd][0]].nome)),
  ];
  const estadosPendentes = brasilFechado && !['br', ...Object.keys(UFS)].every(id => pronto(cache.get(id)));
  // Com o detalhe por cidade na tela, só termina quando cada cidade fechada estiver pronta,
  // mesmo que o total do exterior já esteja (o CDN pode ter entregue uma cidade atrasada).
  const cidadesPendentes = [...fechadas].some(cd => !pronto(cache.get(`zz:${cd}`)));
  const exteriorPendente = fechadas.size > 0 && (!pronto(cache.get('zz')) || (alvo.querCidades && cidadesPendentes));
  const presidiosPendentes = brasilFechado && alvo.querPresidios && !!listaPresidios
    && listaPresidios.some(sec => !cache.get(`bu:${sec.id}`));
  const detalhePendente = brasilFechado && state.aba === 'estados' && alvo === dados && detalheIncompleto(alvo);
  return {
    brasilFechado,
    fechadas,
    podeMudar: estadosPendentes || exteriorPendente || presidiosPendentes || detalhePendente,
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
  if (alvo === dados) await sincronizarBoletinsExterior(alvo, plano);
  if (alvo.querCidades && alvo === dados && Date.now() - alvo.cidadesEm >= intervaloCidades) await sincronizarCidades(alvo);
  if (alvo.querPresidios && alvo === dados) await sincronizarPresidios(alvo);
  if (state.aba === 'estados' && alvo === dados) await atualizarDetalhe(alvo);
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
// requisição. Vale para presídios, bairros e locais.
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

async function sincronizarBoletinsExterior(alvo, plano) {
  const { ele, cache } = alvo;
  const zz = cache.get('zz');
  if (!plano.fechadas.size || !zz || zz.secoesTot > 0) return;
  if (!cache.get('cfg:secoesZz')) cache.set('cfg:secoesZz', await fetchSecoesExterior(ele));
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

const secoesExterior = (cd, cache = dados.cache) => (cache.get('cfg:secoesZz')?.[cd] ?? [])
  .map(([zona, secao]) => ({ uf: 'zz', mun: cd, zona, secao, id: `zz-${cd}-${zona}-${secao}` }));

// Soma dos boletins já publicados das cidades; null enquanto nenhum chegou.
function boletinsExterior(cds) {
  const secoes = cds.flatMap(cd => secoesExterior(cd));
  if (!dados.br || !secoes.some(sec => dados.cache.get(`bu:${sec.id}`))) return null;
  return { ...resultadoSecoes(secoes), versao: 'bu', andamento: 'p', boletins: true };
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

// Ligou um detalhe (cidades do exterior, presídios): o plano muda, então reavalia já, sem esperar o timer
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

/* ---------------- render: topo, aviso, placar ---------------- */

function render() {
  renderTopo();
  renderStatus();
  renderAviso();
  renderPlacar();
  renderLegenda();
  pintarEstados();
  pintarMundo();
  pintarPresidios();
  renderLateral();
}

function renderTopo() {
  $('#titulo-turno').textContent = ELEICOES[state.ele].nome;
  document.querySelectorAll('[data-ele]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ele === state.ele)));
  document.querySelectorAll('[data-aba]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === state.aba)));
  $('#mapa-estados').hidden = state.aba !== 'estados';
  $('#mapa-mundo').hidden = state.aba !== 'exterior';
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

function renderAviso() {
  const el = $('#aviso');
  const semVotos = dados.br && !dados.br.secoesTot;
  if (state.ele === '6258' && semVotos) {
    el.hidden = false;
    el.innerHTML = `<span>${avisoExterior()}<br>O TSE só totaliza a partir das <b>17h de Brasília</b>; até lá, cada país entra pelos boletins de urna, publicados seção a seção depois que as urnas fecham lá. A página só consulta o TSE onde o horário já permite haver votos.</span>
      <button type="button" data-ir-ele="6257">Ver o 1º turno enquanto isso</button>`;
  } else {
    el.hidden = true;
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

function textoUrnas(u) {
  const d = dataEleicao();
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

function renderPlacar() {
  const el = $('#placar');
  if (!dados.br) { el.innerHTML = ''; return; }
  const r = parcialExterior() ? dados.zz : dados.br;
  // Os dois do duelo, com os votos do recorte mostrado (o nacional ou a parcial do exterior).
  const [a, b] = duelo().map(d => r.cands.find(c => c.n === d.n) ?? d);
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
  if (state.aba === 'exterior' && dados.zz && !dados.zz.validos) {
    $('#legenda').innerHTML = `
      <div class="legenda-titulo"><span>Urnas no exterior · votação das 8h às 17h locais</span></div>
      <div class="legenda-urnas">
        <span><i class="urna-st e-antes"></i>ainda não abriu</span>
        <span><i class="urna-st e-votando"></i>votando agora</span>
        <span><i class="urna-st e-fechada"></i>urnas fechadas, aguardando apuração</span>
      </div>`;
    return;
  }
  const mid = css('--mid');
  const passos = c => INTENSIDADE.map(t => d3.interpolateLab(mid, corCand(c.n))(t));
  const esq = passos(a).reverse();
  const dir = passos(b);
  const sw = cores => cores.map(c => `<span style="background:${c}"></span>`).join('');
  const extraPresidios = state.aba !== 'presidios' ? '' : `
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
    corpo = `<div class="tt-sub">${state.aba === 'exterior' && !dados.sincronizando ? 'Sem seção eleitoral brasileira' : 'Carregando resultados…'}</div>`;
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

/* ---------------- mapa dos estados ---------------- */

// Um mapa só, com zoom: estados → municípios (dos estados à vista) → zonas e locais de votação
// (do município em foco). Cada nível só carrega o que está na tela.
const K_MUNICIPIOS = 2.2;   // a partir deste zoom, os estados à vista abrem os municípios
const K_FOCO = 40;          // a partir deste, o município no centro da tela vira o "em foco"
const MAX_ESTADOS_ABERTOS = 4;
const TETO_POR_MINUTO = 60; // arquivos de município/zona por minuto, no máximo
const INTERVALO_DETALHE = 3 * 60_000;

let mapaBR = null;
const geoMun = {};      // uf → { features, porCd }
const locaisMun = {};   // cd → { uf, locais, zonas, bairros }
let consultasDetalhe = [];

async function montarEstados() {
  const topo = await d3.json('data/br-uf.json');
  const fc = topojson.feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
  const W = 600, H = 560;
  const proj = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], fc);
  const path = d3.geoPath(proj);
  const svg = d3.select('#mapa-estados').append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const recorte = svg.append('defs').append('clipPath').attr('id', 'recorte-mun').append('path');
  const fundo = svg.append('rect').attr('width', W).attr('height', H).style('fill', 'var(--ocean)');
  const g = svg.append('g');
  const gEstados = g.append('g');
  const gMun = g.append('g');
  const gZonas = g.append('g').attr('clip-path', 'url(#recorte-mun)');
  const gBordasZona = g.append('g').attr('class', 'bordas-zona');
  const gBordasUF = g.append('g').attr('class', 'bordas-uf');
  const gLocais = g.append('g');
  const gRotulos = g.append('g');
  const uf = f => f.properties.sigla.toLowerCase();
  for (const f of fc.features) f.caixa = path.bounds(f);

  const paths = gEstados.selectAll('path').data(fc.features).join('path')
    .attr('class', 'regiao ativa')
    .attr('d', path)
    .attr('data-id', uf)
    .on('mouseenter mousemove', (ev, f) => mostrarTooltip(ev, { titulo: UFS[uf(f)], icone: `<span class="linha-ic">${uf(f).toUpperCase()}</span>`, r: dados.ufs[uf(f)] }))
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, f) => { if (somar_(ev)) alternarMulti(uf(f)); else selecionar(uf(f)); })
    .on('contextmenu', (ev, f) => { if (ev.ctrlKey) { ev.preventDefault(); alternarMulti(uf(f)); } });
  gBordasUF.selectAll('path').data(fc.features).join('path').attr('d', path);
  const rotulosUF = gRotulos.append('g').selectAll('text').data(fc.features).join('text')
    .attr('class', 'rotulo-uf')
    .attr('transform', f => `translate(${path.centroid(f)})`)
    .text(f => f.properties.sigla);
  const gRotulosMun = gRotulos.append('g');

  fundo.on('click', () => subirNivel());
  let quadro = 0;
  const zoom = d3.zoom().scaleExtent([1, 4000]).translateExtent([[-W, -H], [2 * W, 2 * H]])
    .on('zoom', ev => {
      mapaBR.t = ev.transform;
      g.attr('transform', ev.transform);
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(ajustarEscalaBR);
    })
    .on('end', () => { desenharDetalhe(); agendarDetalhe(); });
  svg.call(zoom).on('dblclick.zoom', null);

  document.querySelectorAll('[data-zoom]').forEach(btn => btn.addEventListener('click', () => {
    if (state.aba !== 'estados') return;
    const acao = btn.dataset.zoom;
    if (acao === 'reset') { selecionar(null); return; }
    svg.transition().duration(300).call(zoom.scaleBy, acao === 'in' ? 1.8 : 1 / 1.8);
  }));

  mapaBR = {
    svg, g, W, H, proj, path, zoom, recorte, fc, porUF: new Map(fc.features.map(f => [uf(f), f])),
    gMun, gZonas, gBordasZona, gLocais, gRotulosMun, paths, rotulosUF, t: d3.zoomIdentity, enquadrado: null,
  };
  pintarEstados();
}

// Parte do mapa (em coordenadas do mapa, sem zoom) que está na tela.
function janelaVisivel() {
  const { t, W, H } = mapaBR;
  return [[t.invertX(0), t.invertY(0)], [t.invertX(W), t.invertY(H)]];
}

const cruza = (a, b) => a[0][0] < b[1][0] && a[1][0] > b[0][0] && a[0][1] < b[1][1] && a[1][1] > b[0][1];

function estadosAbertos() {
  // Somando estados, o mapa fica no nível de estado: o destaque é a seleção, não os municípios.
  if (!mapaBR || state.multi.length) return [];
  const abertos = new Set();
  if (state.sel && UFS[state.sel]) abertos.add(state.sel);
  if (mapaBR.t.k >= K_MUNICIPIOS) {
    const j = janelaVisivel();
    const visiveis = [...mapaBR.porUF.entries()].filter(([, f]) => cruza(f.caixa, j))
      .map(([uf, f]) => {
        const [[x0, y0], [x1, y1]] = f.caixa;
        const area = Math.max(0, Math.min(x1, j[1][0]) - Math.max(x0, j[0][0])) * Math.max(0, Math.min(y1, j[1][1]) - Math.max(y0, j[0][1]));
        return [uf, area];
      })
      .sort((a, b) => b[1] - a[1]);
    for (const [u] of visiveis) { if (abertos.size >= MAX_ESTADOS_ABERTOS) break; abertos.add(u); }
  }
  return [...abertos];
}

async function carregarGeoMun(uf) {
  if (geoMun[uf]) return geoMun[uf];
  const topo = await d3.json(`data/mun/${uf}.json`);
  const features = topojson.feature(topo, topo.objects.mun).features;
  for (const f of features) {
    f.uf = uf;
    f.d = mapaBR.path(f);
    f.caixa = mapaBR.path.bounds(f);
    f.area = mapaBR.path.area(f);
    f.centro = mapaBR.path.centroid(f);
  }
  geoMun[uf] = { features, porCd: new Map(features.map(f => [f.properties.cd, f])) };
  return geoMun[uf];
}

function featureMun(cd) {
  for (const g of Object.values(geoMun)) if (g.porCd.has(cd)) return g.porCd.get(cd);
  return null;
}

async function carregarLocais(uf, cd) {
  if (locaisMun[cd]) return locaisMun[cd];
  const j = await d3.json(`data/locais/${uf}/${cd}.json`);
  const locais = j.locais.map(l => ({
    ...l, id: `${l.z}-${l.l}`, uf, cd,
    xy: l.lat != null ? mapaBR.proj([l.lon, l.lat]) : null,
  }));
  const zonas = [...new Set(locais.map(l => l.z))].sort((a, b) => a - b);
  const bairros = d3.group(locais, l => l.b || '(sem bairro)');
  locaisMun[cd] = { uf, cd, locais, zonas, bairros, porId: new Map(locais.map(l => [l.id, l])) };
  return locaisMun[cd];
}

// Município em foco: o selecionado ou, com bastante zoom, o que está no centro da tela.
function municipioEmFoco() {
  if (state.mun) return featureMun(state.mun);
  if (!mapaBR || mapaBR.t.k < K_FOCO) return null;
  const { t, W, H } = mapaBR;
  const centro = [t.invertX(W / 2), t.invertY(H / 2)];
  const lonlat = mapaBR.proj.invert(centro);
  for (const uf of estadosAbertos()) {
    const g = geoMun[uf];
    if (!g) continue;
    for (const f of g.features) {
      const [[x0, y0], [x1, y1]] = f.caixa;
      if (centro[0] < x0 || centro[0] > x1 || centro[1] < y0 || centro[1] > y1) continue;
      if (d3.geoContains(f, lonlat)) return f;
    }
  }
  return null;
}

/* ----- resultados por município, zona, bairro e local ----- */

function resultadoMun(uf, cd) {
  const r = dados.cache.get(`mu:${cd}`);
  if (r) return r;
  // Só o índice: zerado de verdade quando nada foi apurado; com seções apuradas, ainda não sabemos os votos.
  const ix = dados.cache.get(`idx:${uf}`)?.[cd];
  return ix && dados.br && ix.secoesTot === 0 ? resultadoVazio(ix, dados.br) : null;
}

function resultadoZona(cd, z) {
  const r = dados.cache.get(`zn:${cd}:${z}`);
  if (r) return r;
  const lm = locaisMun[cd];
  if (lm?.zonas.length === 1) return resultadoMun(lm.uf, cd);
  // Antes das 17h, ou com o município sem nada apurado, a zona não é consultada: mostra zerada, não "carregando".
  const ix = lm ? dados.cache.get(`idx:${lm.uf}`)?.[cd] : null;
  const esperando = urnasBrasil(dataEleicao()).estado !== 'fechada' || ix?.secoesTot === 0;
  if (!esperando || !lm || !dados.br) return null;
  const locais = lm.locais.filter(l => l.z === Number(z));
  return resultadoVazio({
    versao: '', eleitorado: locais.reduce((a, l) => a + l.el, 0), secoes: locais.reduce((a, l) => a + l.s.length, 0), andamento: 'n',
  }, dados.br);
}

function secoesDeLocais(locais) {
  return locais.flatMap(l => l.s.map(secao => ({ uf: l.uf, mun: l.cd, zona: l.z, secao, id: `${l.cd}-${l.z}-${secao}` })));
}

// Bairro e local não têm total na API: somam os boletins de urna das seções já carregadas.
function resultadoSecoes(secoes) {
  if (!dados.br) return null;
  const modelo = dados.br;
  const vazio = {
    versao: '', cands: modelo.cands.map(c => ({ ...c, votos: 0, pct: 0 })), eleitorado: 0, comparecimento: 0,
    abstencao: 0, validos: 0, brancos: 0, nulos: 0, secoes: 1, secoesTot: 0, andamento: 'n', totalizado: '',
  };
  return somar(secoes.map(sec => {
    const bu = dados.cache.get(`bu:${sec.id}`);
    return bu ? resultadoBoletim(bu, modelo) : vazio;
  }));
}

/* ----- carga do detalhe (fila com teto por minuto) ----- */

function folgaDetalhe() {
  const agora = Date.now();
  consultasDetalhe = consultasDetalhe.filter(t => agora - t < 60_000);
  return Math.max(0, TETO_POR_MINUTO - consultasDetalhe.length);
}

let timerDetalhe = null;
function agendarDetalhe() {
  clearTimeout(timerDetalhe);
  timerDetalhe = setTimeout(() => {
    const alvo = dados;
    atualizarDetalhe(alvo)
      .catch(err => { if (alvo === dados) registrarFalha(err); })
      .finally(() => {
        alvo.cache.salvar();
        if (alvo !== dados) return;
        render();
        // Sobrou fila por causa do teto: continua sozinho quando a janela de um minuto liberar.
        if (alvo.detalheRestante > 0 && state.aba === 'estados') {
          clearTimeout(timerFila);
          timerFila = setTimeout(agendarDetalhe, 61_000);
        }
        // O ciclo principal tinha parado (tudo pronto), mas o detalhe ainda espera algo: religa.
        if (!proximaEm && planoDeConsulta(alvo).podeMudar) reavaliar();
      });
  }, 350);
}
let timerFila = null;

function atualizarDetalhe(alvo) {
  if (alvo.detalhe) return alvo.detalhe;
  alvo.detalhe = (async () => {
    if (!mapaBR || state.aba !== 'estados') return;
    const { ele, cache } = alvo;
    const plano = planoDeConsulta(alvo);
    const abertos = estadosAbertos();
    await Promise.all(abertos.map(carregarGeoMun));
    const foco = municipioEmFoco();
    if (foco) await carregarLocais(foco.uf, foco.properties.cd);
    if (alvo !== dados) return;
    desenharDetalhe();

    // Índice do estado: uma vez (dá o eleitorado de cada município); depois das 17h, a cada ciclo
    // enquanto o estado não terminou, e mais uma vez depois que ele termina.
    for (const uf of abertos) {
      const idx = cache.get(`idx:${uf}`);
      const velho = Date.now() - (cache.get(`idxEm:${uf}`) ?? 0) >= INTERVALO;
      const precisa = !idx || (plano.brasilFechado && !cache.get(`idxPronto:${uf}`) && velho);
      // Uma falha não vira nova tentativa a cada zoom: no máximo uma por minuto.
      alvo.idxTentado ??= {};
      if (!precisa || Date.now() - (alvo.idxTentado[uf] ?? 0) < INTERVALO) continue;
      alvo.idxTentado[uf] = Date.now();
      const m = await fetchIndice(ele, uf);
      const municipios = Object.fromEntries([...m].filter(([cd]) => cd !== uf));
      cache.set(`idx:${uf}`, municipios);
      cache.set(`idxEm:${uf}`, Date.now());
      // Só para de atualizar o índice quando cada município nele estiver encerrado (o estado pode
      // terminar antes de um índice atrasado do CDN mostrar isso).
      const todosProntos = Object.values(municipios).every(ix => ix.andamento === 'f' && ix.secoesTot === ix.secoes);
      if (pronto(cache.get(uf)) && todosProntos) cache.set(`idxPronto:${uf}`, true);
    }
    // Antes das 17h de Brasília não há voto de município nem de zona: o índice basta.
    if (!plano.brasilFechado) return;

    const baixar = [];
    let prioritarios = 0;
    const quer = (chave, atual, ix, executar, exigeIndice = true) => {
      if (pronto(atual)) return;
      if (exigeIndice && !ix) return; // fora do índice (ainda): espera o índice, não baixa às cegas
      if (Date.now() - (alvo.falhouEm?.[chave] ?? 0) < INTERVALO) return; // falhou há pouco
      if (ix && ix.secoesTot === 0) return; // nada apurado: o índice basta
      const final = ix && ix.andamento === 'f' && ix.secoesTot === ix.secoes;
      if (atual?.baixadoEm && Date.now() - atual.baixadoEm < INTERVALO_DETALHE && !final) return;
      if (atual && ix && !desatualizado(atual, ix)) return;
      baixar.push({ chave, executar });
    };
    // Prioridade: o município em foco e as zonas dele; depois os municípios à vista, maiores primeiro.
    // O que você selecionou ou aproximou (município em foco e zonas dele) fica fora do teto por minuto.
    if (foco) {
      const cd = foco.properties.cd;
      const ix = cache.get(`idx:${foco.uf}`)?.[cd];
      quer(`mu:${cd}`, cache.get(`mu:${cd}`), ix, () => fetchResultado(ele, foco.uf, cd));
      const lm = locaisMun[cd];
      if (lm && lm.zonas.length > 1 && ix?.secoesTot > 0) {
        for (const z of lm.zonas) quer(`zn:${cd}:${z}`, cache.get(`zn:${cd}:${z}`), null, () => fetchResultado(ele, foco.uf, cd, z), false);
      }
      prioritarios = baixar.length;
    }
    const j = janelaVisivel();
    const visiveis = abertos.flatMap(uf => geoMun[uf]?.features ?? []).filter(f => cruza(f.caixa, j))
      .map(f => ({ f, ix: cache.get(`idx:${f.uf}`)?.[f.properties.cd] }))
      .sort((a, b) => (b.ix?.eleitorado ?? 0) - (a.ix?.eleitorado ?? 0));
    for (const { f, ix } of visiveis) {
      const cd = f.properties.cd;
      if (foco && cd === foco.properties.cd) continue;
      quer(`mu:${cd}`, cache.get(`mu:${cd}`), ix, () => fetchResultado(ele, f.uf, cd));
    }
    const lote = [...baixar.slice(0, prioritarios), ...baixar.slice(prioritarios, prioritarios + folgaDetalhe())];
    alvo.detalheRestante = baixar.length - lote.length;
    await baixarArquivos(alvo, lote, async item => {
      consultasDetalhe.push(Date.now());
      try {
        guardar(cache, item.chave, await item.executar());
      } catch (err) {
        (alvo.falhouEm ??= {})[item.chave] = Date.now();
        throw err;
      }
    });
    // Bairro ou local selecionado: boletins que ainda faltam entram em toda rodada (cada seção respeita o prazo).
    await pool(alvo, secoesSelecionadas(), sec => buscarBoletim(alvo, sec));
  })().finally(() => { alvo.detalhe = null; });
  return alvo.detalhe;
}

// Boletins de urna sob demanda (bairro ou local clicado): só depois das 17h, cada seção no máximo
// a cada 5 minutos, e o boletim publicado fica guardado para sempre.
function carregarBoletins(secoes) {
  const alvo = dados;
  if (!planoDeConsulta(alvo).brasilFechado) return;
  const agora = Date.now();
  const faltam = secoes.filter(sec => !alvo.cache.get(`bu:${sec.id}`) && agora - alvo.cache.tentativa(sec.id) >= INTERVALO_BU);
  if (!faltam.length) return;
  baixarArquivos(alvo, faltam, async sec => {
    await buscarBoletim(alvo, sec);
    if (alvo === dados) renderLateral();
  })
    .catch(err => { if (alvo === dados) registrarFalha(err); })
    .finally(() => { alvo.cache.salvar(); if (alvo === dados) render(); });
}

// Seções do bairro ou local selecionado.
function secoesSelecionadas() {
  const lm = state.mun ? locaisMun[state.mun] : null;
  if (!lm) return [];
  if (state.local) return secoesDeLocais([lm.porId.get(state.local)].filter(Boolean));
  if (state.bairro) return secoesDeLocais(lm.bairros.get(state.bairro) ?? []);
  return [];
}

// Algo à vista (municípios dos estados abertos, zonas do município em foco, boletins da seleção) ainda
// pode mudar: mantém o ciclo vivo depois das 17h.
function detalheIncompleto(alvo) {
  const { cache } = alvo;
  const abertos = estadosAbertos();
  if (abertos.some(uf => !cache.get(`idxPronto:${uf}`))) return true;
  const j = mapaBR ? janelaVisivel() : null;
  for (const uf of abertos) {
    for (const f of geoMun[uf]?.features ?? []) {
      if (j && !cruza(f.caixa, j)) continue;
      const ix = cache.get(`idx:${uf}`)?.[f.properties.cd];
      if (ix?.secoesTot > 0 && !pronto(cache.get(`mu:${f.properties.cd}`))) return true;
    }
  }
  const foco = municipioEmFoco();
  if (foco) {
    const ix = cache.get(`idx:${foco.uf}`)?.[foco.properties.cd];
    if (ix?.secoesTot > 0 && !pronto(cache.get(`mu:${foco.properties.cd}`))) return true;
  }
  const lm = foco ? locaisMun[foco.properties.cd] : null;
  if (lm && lm.zonas.length > 1 && lm.zonas.some(z => !pronto(cache.get(`zn:${lm.cd}:${z}`)))) return true;
  return secoesSelecionadas().some(sec => !cache.get(`bu:${sec.id}`));
}

/* ----- desenho ----- */

function desenharDetalhe() {
  if (!mapaBR) return;
  const abertos = estadosAbertos();
  const feats = abertos.flatMap(uf => geoMun[uf]?.features ?? []);
  mapaBR.gMun.selectAll('path').data(feats, f => f.properties.cd).join(entra => entra.append('path')
    .attr('class', 'regiao ativa mun')
    .attr('d', f => f.d)
    .attr('data-id', f => f.properties.cd)
    .on('mouseenter mousemove', (ev, f) => mostrarTooltip(ev, {
      titulo: f.properties.nome,
      icone: `<span class="linha-ic">${f.uf.toUpperCase()}</span>`,
      r: resultadoMun(f.uf, f.properties.cd),
      urnas: urnasBrasil(dataEleicao()),
    }))
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, f) => { ev.stopPropagation(); if (somar_(ev)) alternarMulti(f.uf); else selecionarMun(f.uf, f.properties.cd); })
    .on('contextmenu', (ev, f) => { if (ev.ctrlKey) { ev.preventDefault(); ev.stopPropagation(); alternarMulti(f.uf); } }));

  // Zonas: área aproximada, das células de Voronoi dos locais de votação, recortada no município.
  const foco = municipioEmFoco();
  const lm = foco ? locaisMun[foco.properties.cd] : null;
  const comXY = lm ? lm.locais.filter(l => l.xy) : [];
  let celulas = [];
  let bordas = [];
  if (lm && lm.zonas.length > 1 && comXY.length > 2) {
    mapaBR.recorte.attr('d', foco.d);
    const [[x0, y0], [x1, y1]] = foco.caixa;
    const delaunay = d3.Delaunay.from(comXY, l => l.xy[0], l => l.xy[1]);
    const voronoi = delaunay.voronoi([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
    celulas = comXY.map((l, i) => ({ l, d: voronoi.renderCell(i), poli: voronoi.cellPolygon(i) }));
    const igual = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    for (let i = 0; i < comXY.length; i++) {
      for (const jn of delaunay.neighbors(i)) {
        if (jn <= i || comXY[jn].z === comXY[i].z || !celulas[i].poli || !celulas[jn].poli) continue;
        const comuns = celulas[i].poli.filter(p => celulas[jn].poli.some(q => igual(p, q)));
        if (comuns.length >= 2) bordas.push([comuns[0], comuns[1]]);
      }
    }
  }
  mapaBR.gZonas.selectAll('path').data(celulas).join('path')
    .attr('class', 'celula-zona')
    .attr('d', c => c.d)
    .attr('data-zona', c => c.l.z)
    .on('mouseenter mousemove', (ev, c) => mostrarTooltip(ev, {
      titulo: `Zona ${c.l.z}`,
      icone: `<span class="linha-ic">${c.l.uf.toUpperCase()}</span>`,
      r: resultadoZona(c.l.cd, c.l.z),
      urnas: urnasBrasil(dataEleicao()),
      extra: `<div class="tt-sub" style="margin:6px 0 0">${esc(foco.properties.nome)} · área aproximada, desenhada a partir dos locais de votação</div>`,
    }))
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, c) => { ev.stopPropagation(); selecionarZona(c.l.z); });
  mapaBR.gBordasZona.selectAll('path').data(bordas).join('path').attr('d', ([a, b]) => `M${a}L${b}`);

  mapaBR.gLocais.selectAll('circle').data(comXY, l => l.id).join('circle')
    .attr('class', 'local')
    .attr('cx', l => l.xy[0]).attr('cy', l => l.xy[1])
    .attr('data-id', l => l.id)
    .on('mouseenter mousemove', (ev, l) => {
      const r = resultadoSecoes(secoesDeLocais([l]));
      mostrarTooltip(ev, {
        titulo: nomeLocal(l.n),
        icone: '',
        r: r?.validos ? r : null,
        extra: `<div class="tt-sub" style="margin:6px 0 0">${esc(nomeLocal(l.b || ''))} · zona ${l.z} · ${l.s.length} ${l.s.length > 1 ? 'seções' : 'seção'} · ${fmt.format(l.el)} eleitores${r?.validos ? '' : '<br>Clique para carregar os boletins de urna'}</div>`,
      });
    })
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, l) => { ev.stopPropagation(); selecionarLocal(l.id); });

  // Rótulos de município: só os que já aparecem grandes na tela, no máximo 80.
  const k = mapaBR.t.k;
  const j = janelaVisivel();
  const rotulos = k < K_MUNICIPIOS ? [] : feats
    .filter(f => f.area * k * k > 2500 && f.centro[0] > j[0][0] && f.centro[0] < j[1][0] && f.centro[1] > j[0][1] && f.centro[1] < j[1][1])
    .sort((a, b) => b.area - a.area).slice(0, 80);
  mapaBR.gRotulosMun.selectAll('text').data(rotulos, f => f.properties.cd).join('text')
    .attr('class', 'rotulo-mun')
    .attr('transform', f => `translate(${f.centro})`)
    .text(f => f.properties.nome);
  ajustarEscalaBR();
  pintarEstados();
}

// Mantém tamanho de tela constante para pontos e rótulos durante o zoom.
function ajustarEscalaBR() {
  if (!mapaBR) return;
  const k = mapaBR.t.k;
  mapaBR.rotulosUF.style('display', k >= K_MUNICIPIOS ? 'none' : null)
    .style('font-size', `${10.5 / Math.sqrt(k)}px`).style('stroke-width', `${3 / Math.sqrt(k)}px`);
  mapaBR.gRotulosMun.selectAll('text').style('font-size', `${11 / k}px`).style('stroke-width', `${3 / k}px`);
  mapaBR.gLocais.selectAll('circle').attr('r', 4 / k);
}

function pintarEstados() {
  if (!mapaBR) return;
  const abertos = new Set(estadosAbertos());
  const naAba = state.aba === 'estados';
  mapaBR.paths
    .style('fill', f => corRegiao(dados.ufs[f.properties.sigla.toLowerCase()]))
    .classed('sel', f => naAba && !state.mun && (state.sel === f.properties.sigla.toLowerCase() || state.multi.includes(f.properties.sigla.toLowerCase())))
    .classed('aberto', f => abertos.has(f.properties.sigla.toLowerCase()));
  const u = urnasBrasil(dataEleicao());
  const urnas = u.estado === 'fechada' ? u : { estado: 'antes' };
  // Sem resultado ainda carregado: cinza claro. O cinza-escuro fica para "urna fechada, nada apurado".
  const cor = r => corRegiao(r, r ? urnas : null);
  mapaBR.gMun.selectAll('path')
    .style('fill', f => cor(resultadoMun(f.uf, f.properties.cd)))
    .classed('sel', f => naAba && state.mun === f.properties.cd && state.zona == null && !state.bairro && !state.local);
  mapaBR.gZonas.selectAll('path')
    .style('fill', c => cor(resultadoZona(c.l.cd, c.l.z)))
    .classed('sel', c => naAba && state.zona === c.l.z);
  const bairroSel = state.bairro;
  mapaBR.gLocais.selectAll('circle')
    .style('fill', l => {
      const r = resultadoSecoes(secoesDeLocais([l]));
      return r?.validos ? corRegiao(r) : 'var(--surface)';
    })
    .classed('sel', l => naAba && (state.local === l.id || (bairroSel && (l.b || '(sem bairro)') === bairroSel)));
  if (naAba) enquadrarSelecao();
}

// Aproxima o mapa da seleção do painel (estado, município, zona, bairro ou local).
function enquadrarSelecao() {
  const chave = [state.sel, state.mun, state.zona, state.bairro, state.local, state.multi.join(',')].join('|');
  if (mapaBR.enquadrado === chave) return;
  let caixa = null;
  let kMin = 1;
  const lm = state.mun ? locaisMun[state.mun] : null;
  if (state.local && lm?.porId.get(state.local)?.xy) {
    const [x, y] = lm.porId.get(state.local).xy;
    caixa = [[x - 0.4, y - 0.4], [x + 0.4, y + 0.4]];
  } else if ((state.bairro || state.zona != null) && lm) {
    const sel = lm.locais.filter(l => l.xy && (state.bairro ? (l.b || '(sem bairro)') === state.bairro : l.z === state.zona));
    if (sel.length) {
      const xs = sel.map(l => l.xy[0]);
      const ys = sel.map(l => l.xy[1]);
      caixa = [[Math.min(...xs) - 0.3, Math.min(...ys) - 0.3], [Math.max(...xs) + 0.3, Math.max(...ys) + 0.3]];
    }
  } else if (state.mun) {
    caixa = featureMun(state.mun)?.caixa ?? null;
    if (!caixa) return; // a malha do estado ainda não chegou; tenta no próximo desenho
  } else if (state.multi.some(uf => mapaBR.porUF.has(uf))) {
    const caixas = state.multi.filter(uf => mapaBR.porUF.has(uf)).map(uf => mapaBR.porUF.get(uf).caixa);
    caixa = [[d3.min(caixas, c => c[0][0]), d3.min(caixas, c => c[0][1])], [d3.max(caixas, c => c[1][0]), d3.max(caixas, c => c[1][1])]];
  } else if (state.sel && mapaBR.porUF.has(state.sel)) {
    caixa = mapaBR.porUF.get(state.sel).caixa;
    kMin = K_MUNICIPIOS;
  }
  mapaBR.enquadrado = chave;
  const { svg, zoom, W, H } = mapaBR;
  if (!caixa) { svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity); return; }
  const [[x0, y0], [x1, y1]] = caixa;
  const escala = Math.min(3000, Math.max(kMin, 0.85 / Math.max((x1 - x0) / W, (y1 - y0) / H, 1e-6)));
  const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  svg.transition().duration(750).call(zoom.transform, t);
}

/* ---------------- mapa-múndi ---------------- */

let mundo = null;

async function montarMundo() {
  const topo = await d3.json('data/countries-50m.json');
  const features = topojson.feature(topo, topo.objects.countries).features.filter(f => f.id !== ANTARTIDA);
  const W = 960, H = 500;
  const proj = d3.geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'FeatureCollection', features });
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

  // Países pequenos demais para clicar no mapa ganham um marcador na cidade principal.
  const porId = new Map(features.map(f => [f.id, f]));
  const primeiraCidade = {};
  for (const [cd, [pais, lat, lon]] of Object.entries(CITIES)) primeiraCidade[pais] ??= { cd, lat, lon };
  const pequenos = Object.keys(COUNTRIES).filter(id => !porId.has(id) || path.area(porId.get(id)) < 30)
    .map(id => ({ id, ...primeiraCidade[id], xy: proj([primeiraCidade[id].lon, primeiraCidade[id].lat]) }));
  const marcadores = gMarcadores.selectAll('circle').data(pequenos).join('circle')
    .attr('class', 'marcador')
    .attr('cx', d => d.xy[0]).attr('cy', d => d.xy[1])
    .on('mouseenter mousemove', (ev, d) => previewPais(ev, d.id, COUNTRIES[d.id].nome))
    .on('mouseleave', esconderTooltip)
    .on('click', (ev, d) => selecionar(d.id));

  let k = 1;
  const zoom = d3.zoom().scaleExtent([1, 60]).translateExtent([[0, 0], [W, H]])
    .on('zoom', ev => {
      k = ev.transform.k;
      g.attr('transform', ev.transform);
      listras.attr('patternTransform', `rotate(45) scale(${1 / k})`);
      escalarMarcas();
    });
  svg.call(zoom).on('dblclick.zoom', null);
  fundo.on('click', () => selecionar(null));

  function escalarMarcas() {
    marcadores.attr('r', 4.5 / Math.sqrt(k));
    gCidades.selectAll('circle').attr('r', 5.5 / k);
    gCidades.selectAll('text').style('font-size', `${11 / k}px`).style('stroke-width', `${3 / k}px`).attr('dx', 8 / k).attr('dy', 4 / k);
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
    const [[x0, y0], [x1, y1]] = bounds;
    const escala = Math.min(40, 0.75 / Math.max((x1 - x0) / W, (y1 - y0) / H, 1e-3));
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(750).call(zoom.transform, t);
  }

  const resetar = () => svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);

  // Enquadra um grupo de cidades (continente), com folga em volta.
  function enquadrarCidades(cds) {
    if (!cds.length) { resetar(); return; }
    const pts = cds.map(cd => proj([CITIES[cd][2], CITIES[cd][1]]));
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 25, Math.max(...xs) + 25, Math.min(...ys) - 25, Math.max(...ys) + 25];
    const escala = Math.min(12, 0.9 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(750).call(zoom.transform, t);
  }

  document.querySelectorAll('[data-zoom]').forEach(btn => btn.addEventListener('click', () => {
    if (state.aba !== 'exterior') return;
    const acao = btn.dataset.zoom;
    if (acao === 'reset') { selecionar(null); return; }
    svg.transition().duration(300).call(zoom.scaleBy, acao === 'in' ? 1.8 : 1 / 1.8);
  }));

  mundo = { svg, paths, marcadores, gCidades, proj, enquadrar, enquadrarCidades, resetar, escalarMarcas, enquadrado: null };
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
  g.append('g').selectAll('path').data(fc.features).join('path')
    .attr('class', 'regiao').attr('d', path).style('fill', 'var(--land)');
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

  // Seleção pela lista: aproxima o ponto.
  const enquadrar = sec => {
    if (!sec || sec.lat == null) return;
    const [x, y] = proj([sec.lon, sec.lat]);
    const escala = Math.max(k, 6);
    svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-x, -y));
  };
  mapaPresidios = { pontos, enquadrar, enquadrado: null };
  pintarPresidios();
}

function pintarPresidios() {
  if (!mapaPresidios) return;
  const u = urnasBrasil(dataEleicao());
  // Ponto pequeno não leva hachura: antes das 17h ele fica no cinza claro de "ainda votando".
  const urnas = u.estado === 'fechada' ? u : { estado: 'antes' };
  const sel = state.aba === 'presidios' ? state.sel : null;
  mapaPresidios.pontos
    .style('fill', sec => corRegiao(dados.presidios[sec.id], urnas))
    .classed('sel', sec => sec.id === sel);
  // O selecionado vai para cima dos vizinhos.
  mapaPresidios.pontos.filter(sec => sec.id === sel).raise();
  if (state.aba === 'presidios' && mapaPresidios.enquadrado !== sel) {
    mapaPresidios.enquadrado = sel;
    if (sel) mapaPresidios.enquadrar(listaPresidios.find(sec => sec.id === sel));
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
  const paisSel = state.aba === 'exterior' ? state.sel : null;
  const doContinente = new Set(state.aba === 'exterior' && state.continente && !paisSel ? paisesDoContinente(state.continente) : []);
  mundo.paths
    .style('fill', f => (COUNTRIES[f.id] ? corRegiao(dados.paises[f.id], urnasPais(f.id, dataEleicao())) : css('--land')))
    .classed('sel', f => f.id === paisSel || doContinente.has(f.id));
  mundo.marcadores
    .style('fill', d => corRegiao(dados.paises[d.id], urnasPais(d.id, dataEleicao())))
    .classed('sel', d => d.id === paisSel || doContinente.has(d.id));

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

  const alvoMapa = paisSel ?? (state.continente ? `cont:${state.continente}` : null);
  if (state.aba === 'exterior' && mundo.enquadrado !== alvoMapa) {
    mundo.enquadrado = alvoMapa;
    if (paisSel) mundo.enquadrar(paisSel);
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

function candidatosHtml(r) {
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
      ${fotoTag(state.ele, c, 'p')}
      <div><div class="cand-nome">${esc(c.nome)}</div><div class="cand-partido">${esc(c.partido)} · ${esc(c.n)}</div></div>
      <div><div class="cand-pct">${fmtPct(c.pct)}</div><div class="cand-votos">${fmt.format(c.votos)}</div></div>
      <div class="cand-barra"><span style="width:${c.pct}%;background:${corCand(c.n)}"></span></div>
    </li>`).join('')}${linhaOutros}</ol>`;
}

function statsHtml(r) {
  const comp = r.comparecimento;
  const base = comp + r.abstencao;
  const p = (v, b) => (r.secoesTot && b ? `<small>${fmtPct(v / b * 100, 1)}</small>` : '');
  return `<dl class="stats">
    <div><dt>Eleitorado</dt><dd>${fmt.format(r.eleitorado)}</dd></div>
    <div><dt>Votos válidos</dt><dd>${fmt.format(r.validos)}</dd></div>
    <div><dt>Comparecimento</dt><dd>${fmt.format(comp)}${p(comp, base)}</dd></div>
    <div><dt>Abstenção</dt><dd>${fmt.format(r.abstencao)}${p(r.abstencao, base)}</dd></div>
    <div><dt>Brancos</dt><dd>${fmt.format(r.brancos)}${p(r.brancos, comp)}</dd></div>
    <div><dt>Nulos</dt><dd>${fmt.format(r.nulos)}${p(r.nulos, comp)}</dd></div>
  </dl>`;
}

function detalheHtml({ voltar, icone, titulo, sub, r, urnas = null }) {
  const linhaUrnas = urnas && (!r || !r.validos) ? `<p class="urnas-linha">${marcaUrna(urnas)}<span>${textoUrnas(urnas)}</span></p>` : '';
  return `${voltar ? `<button type="button" class="lat-voltar" data-voltar>← ${esc(voltar)}</button>` : ''}
    <div class="lat-cab">${icone || ''}<div><h2 class="lat-titulo">${esc(titulo)}</h2>${sub ? `<p class="lat-sub">${sub}</p>` : ''}</div></div>
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

function ordenar(linhas) {
  const por = {
    eleitorado: (x, y) => (y.r?.eleitorado ?? 0) - (x.r?.eleitorado ?? 0) || x.nome.localeCompare(y.nome, 'pt-BR'),
    vantagem: (x, y) => vantagem(y.r) - vantagem(x.r),
    nome: (x, y) => x.nome.localeCompare(y.nome, 'pt-BR'),
    fechamento: (x, y) => (x.urnas?.fecha ?? 0) - (y.urnas?.fecha ?? 0) || x.nome.localeCompare(y.nome, 'pt-BR'),
  };
  return linhas.sort(por[ordemAtual()]);
}

const ROTULO_ORDEM = { eleitorado: 'eleitorado', vantagem: 'vantagem', fechamento: 'fechamento (Brasília)', nome: 'A–Z' };
const PROXIMA_ORDEM = { eleitorado: 'vantagem', vantagem: 'fechamento', fechamento: 'nome', nome: 'eleitorado' };

function listaHtml(titulo, linhas) {
  const [a] = duelo();
  const dicaOrdem = ordemAtual() === 'vantagem' && a ? ` (${esc(a.nome)} primeiro)` : '';
  return `<div class="lista-cab"><h3>${esc(titulo)}</h3>
      <button type="button" class="ordem" data-ordem>Ordem: ${ROTULO_ORDEM[ordemAtual()]}${dicaOrdem} ↕</button></div>
    <ul class="linhas">${ordenar(linhas).map(l => `
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
  const chave = `${state.ele}|${state.aba}|${state.sel}|${state.cidade}`;
  if (chave !== chaveLateral) { chaveLateral = chave; el.scrollTop = 0; }
  if (!dados.br) { el.innerHTML = '<p class="vazio">Carregando resultados do TSE…</p>'; return; }
  const focoBusca = document.activeElement?.id === 'busca';
  el.innerHTML = state.aba === 'estados' ? lateralEstados() : state.aba === 'exterior' ? lateralExterior() : lateralPresidios();
  if (focoBusca) {
    const b = $('#busca');
    b.focus();
    b.setSelectionRange(b.value.length, b.value.length);
  }
}

function lateralEstados() {
  if (state.multi.length) return painelSelecao();
  if (state.local) return painelLocal();
  if (state.bairro) return painelBairro();
  if (state.zona != null) return painelZona();
  if (state.mun) return painelMunicipio();
  if (state.sel && UFS[state.sel]) return painelEstado();
  const linhas = Object.entries(UFS).map(([uf, nome]) => ({ id: uf, tipo: 'uf', icone: uf.toUpperCase(), nome, r: dados.ufs[uf] }));
  const ext = `<li><button type="button" class="linha" data-ir-aba="exterior" data-uf="zz">
      <span class="linha-ic bandeira">🌎</span><span class="linha-nome">Exterior<small>ver por país →</small></span>
      ${miniBarra(dados.zz)}<span class="linha-pct">${liderPct(dados.zz)}</span></button></li>`;
  return `<div class="lat-cab"><div><h2 class="lat-titulo">Brasil</h2><p class="lat-sub">Role ou belisque o mapa para aproximar: os estados abrem em municípios, e um município, em zonas eleitorais e locais de votação.</p></div></div>
    ${botaoSomar()}
    ${progressoHtml(dados.br)}
    ${listaHtml('Por região', linhasRegioes())}
    ${listaHtml('Estados', linhas).replace('</ul>', `${ext}</ul>`)}`;
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
  let atual = state.multi.length ? [...state.multi] : (state.sel && UFS[state.sel] && !state.mun ? [state.sel] : []);
  atual = lista.every(id => atual.includes(id)) ? atual.filter(x => !lista.includes(x)) : [...atual, ...lista.filter(id => !atual.includes(id))];
  limparDetalhe();
  state.busca = '';
  // A soma vale desde o primeiro estado; vazia, volta para o Brasil.
  state.multi = atual;
  state.sel = null;
  esconderTooltip();
  gravarHash();
  render();
  agendarDetalhe();
}

function selecionarRegiao(id) {
  state.multi = [...REGIOES[id].ufs];
  state.sel = null;
  state.busca = '';
  limparDetalhe();
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
    voltar: 'Brasil', icone: '<span class="lat-uf">Σ</span>', titulo,
    sub: `${esc(ids.map(nomeRecorte).join(', '))} · ${fmtPct(pctEleitorado, 1)} do eleitorado`,
    r: total,
  }) + `<p class="dica-soma"><button type="button" class="chip" data-limpar-soma>Limpar seleção</button>${botaoSomar().replace(/^<p class="dica-soma">|<\/p>$/g, '')}</p>`
    + listaHtml('Regiões · Ctrl/⌘ + clique inclui ou tira', linhasRegioes())
    + listaHtml('Estados · Ctrl/⌘ + clique inclui ou tira', linhas);
}

const MAX_LINHAS = 200;

function cortarLista(linhas, titulo) {
  const termo = normalizar(state.busca);
  const filtradas = linhas.filter(l => !termo || normalizar(l.nome).includes(termo));
  const extra = filtradas.length > MAX_LINHAS ? `<p class="vazio">Mostrando ${MAX_LINHAS} de ${filtradas.length}; use a busca para achar os outros.</p>` : '';
  const ordenadas = ordenar(filtradas).slice(0, MAX_LINHAS);
  return `<input id="busca" class="busca" type="search" placeholder="Buscar…" value="${esc(state.busca)}" autocomplete="off">`
    + listaHtml(titulo, ordenadas) + extra;
}

function painelEstado() {
  const uf = state.sel;
  const geo = geoMun[uf];
  const linhas = geo ? geo.features.map(f => ({ id: f.properties.cd, tipo: 'mun', icone: '', nome: f.properties.nome, r: resultadoMun(uf, f.properties.cd) })) : [];
  return detalheHtml({ voltar: 'Brasil', icone: `<span class="lat-uf">${uf.toUpperCase()}</span>`, titulo: UFS[uf], sub: 'Estado · aproxime o mapa ou escolha um município', r: dados.ufs[uf] })
    + (geo ? cortarLista(linhas, `Municípios (${linhas.length})`) : '<p class="vazio">Carregando os municípios…</p>');
}

function avisoBoletins() {
  return urnasBrasil(dataEleicao()).estado === 'fechada'
    ? '<p class="urnas-resumo">Bairros e locais não têm total na API do TSE: o resultado deles soma os boletins de urna de cada seção, carregados quando você clica.</p>'
    : '<p class="urnas-resumo">Bairros e locais somam os boletins de urna de cada seção, que só saem depois das 17h de Brasília.</p>';
}

function painelMunicipio() {
  const f = featureMun(state.mun);
  const lm = locaisMun[state.mun];
  if (!f) return '<p class="vazio">Carregando o município…</p>';
  const uf = f.uf;
  const ix = dados.cache.get(`idx:${uf}`)?.[state.mun];
  let html = detalheHtml({
    voltar: UFS[uf], icone: `<span class="lat-uf">${uf.toUpperCase()}</span>`, titulo: f.properties.nome,
    sub: `Município · ${UFS[uf]}${lm ? ` · ${lm.zonas.length} ${lm.zonas.length > 1 ? 'zonas' : 'zona'}, ${lm.locais.length} locais de votação` : ''}`,
    r: resultadoMun(uf, state.mun), urnas: urnasBrasil(dataEleicao()),
  });
  if (!lm) return `${html}<p class="vazio">Carregando zonas e locais…</p>`;
  if (lm.zonas.length > 1) {
    html += listaHtml(`Zonas eleitorais (${lm.zonas.length})`, lm.zonas.map(z => ({
      id: String(z), tipo: 'zona', icone: 'Z', nome: `Zona ${z}`, nota: `${lm.locais.filter(l => l.z === z).length} locais`, r: resultadoZona(state.mun, z),
    })));
  }
  const bairros = [...lm.bairros.entries()].map(([b, ls]) => ({
    id: b, tipo: 'bairro', icone: '•', nome: nomeLocal(b), nota: `${ls.length} ${ls.length > 1 ? 'locais' : 'local'}`,
    r: (() => { const r = resultadoSecoes(secoesDeLocais(ls)); return r?.secoesTot === r?.secoes ? r : { ...r, eleitorado: ls.reduce((a, l) => a + l.el, 0), validos: 0 }; })(),
  }));
  return html + avisoBoletins() + cortarLista(bairros, `Bairros (${bairros.length})`);
}

function linhasLocais(locais) {
  return locais.map(l => {
    const r = resultadoSecoes(secoesDeLocais([l]));
    return { id: l.id, tipo: 'local', icone: '•', nome: nomeLocal(l.n), nota: `zona ${l.z}`, r: r?.validos ? r : { ...r, eleitorado: l.el, validos: 0 } };
  });
}

function painelZona() {
  const lm = locaisMun[state.mun];
  const f = featureMun(state.mun);
  if (!lm || !f) return '<p class="vazio">Carregando a zona…</p>';
  const locais = lm.locais.filter(l => l.z === state.zona);
  return detalheHtml({
    voltar: f.properties.nome, icone: '<span class="lat-uf">Z</span>', titulo: `Zona ${state.zona}`,
    sub: `Zona eleitoral · ${esc(f.properties.nome)}/${f.uf.toUpperCase()} · ${locais.length} locais de votação. A área no mapa é aproximada.`,
    r: resultadoZona(state.mun, state.zona), urnas: urnasBrasil(dataEleicao()),
  }) + avisoBoletins() + cortarLista(linhasLocais(locais), `Locais de votação (${locais.length})`);
}

function painelBairro() {
  const lm = locaisMun[state.mun];
  const f = featureMun(state.mun);
  if (!lm || !f) return '<p class="vazio">Carregando o bairro…</p>';
  const locais = lm.bairros.get(state.bairro) ?? [];
  const secoes = secoesDeLocais(locais);
  return detalheHtml({
    voltar: f.properties.nome, icone: '<span class="lat-uf">B</span>', titulo: nomeLocal(state.bairro),
    sub: `Bairro · ${esc(f.properties.nome)}/${f.uf.toUpperCase()} · ${locais.length} locais, ${secoes.length} seções. Soma dos boletins de urna.`,
    r: resultadoSecoes(secoes), urnas: urnasBrasil(dataEleicao()),
  }) + cortarLista(linhasLocais(locais), `Locais de votação (${locais.length})`);
}

function painelLocal() {
  const lm = locaisMun[state.mun];
  const l = lm?.porId.get(state.local);
  if (!l) return '<p class="vazio">Carregando o local…</p>';
  const secoes = secoesDeLocais([l]);
  const voltar = state.bairro ? nomeLocal(state.bairro) : state.zona != null ? `Zona ${state.zona}` : featureMun(state.mun)?.properties.nome;
  return detalheHtml({
    voltar, icone: '<span class="lat-uf">L</span>', titulo: nomeLocal(l.n),
    sub: `${esc(nomeLocal(l.e || ''))}${l.b ? ` · ${esc(nomeLocal(l.b))}` : ''} · zona ${l.z} · seções ${l.s.join(', ')} · ${fmt.format(l.el)} eleitores`,
    r: resultadoSecoes(secoes), urnas: urnasBrasil(dataEleicao()),
  }) + (l.xy ? '' : '<p class="urnas-resumo">O cadastro do TSE não traz as coordenadas deste local.</p>');
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
    voltar: 'Exterior', icone: '<span class="lat-uf">🌐</span>', titulo: CONTINENTES[cont],
    sub: `${porPais.size} ${porPais.size > 1 ? 'países' : 'país'} · ${cds.length} ${cds.length > 1 ? 'cidades' : 'cidade'} com seção eleitoral`,
    r: resultadoCidades(cds), urnas: urnasCidades(cds, dataEleicao()),
  }) + listaHtml(`Países (${porPais.size})`, linhas);
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
      voltar: cont ? CONTINENTES[cont] : 'Todos os países', icone: `<span class="lat-bandeira">${flagEmoji(p.iso2)}</span>`,
      titulo: cont ? nomePaisNoContinente(state.sel, cont) : p.nome, sub,
      r: cont ? resultadoCidades(cds) : dados.paises[state.sel],
      urnas: cont ? urnasCidades(cds, dataEleicao()) : urnasPais(state.sel, dataEleicao()),
    });
    if (cidades.length > 1) {
      html += listaHtml('Cidades', cidades.map(c => ({ id: c.cd, tipo: 'cidade', icone: '•', nome: c.nome, r: c.r, urnas: urnasCidade(c.cd, dataEleicao()) })));
    }
    return html;
  }
  const qtd = {};
  for (const c of Object.values(dados.cidades)) qtd[c.pais] = (qtd[c.pais] ?? 0) + 1;
  const termo = normalizar(state.busca);
  const linhas = Object.entries(COUNTRIES)
    .filter(([, p]) => !termo || normalizar(p.nome).includes(termo))
    .map(([id, p]) => ({ id, tipo: 'pais', icone: flagEmoji(p.iso2), bandeira: true, nome: p.nome, nota: qtd[id] > 1 ? `${qtd[id]} cidades` : '', r: dados.paises[id], urnas: urnasPais(id, dataEleicao()) }));
  const semVotos = dados.zz && !dados.zz.validos;
  return detalheHtml({ voltar: 'Estados', titulo: 'Exterior', sub: 'Brasileiros votando fora do país', r: dados.zz })
    + (semVotos ? `<p class="urnas-resumo">${avisoExterior()}</p>` : '')
    + listaHtml('Por continente', linhasContinentes())
    + `<input id="busca" class="busca" type="search" placeholder="Buscar país…" value="${esc(state.busca)}" autocomplete="off">`
    + listaHtml(`Países (${Object.keys(COUNTRIES).length})`, linhas);
}

function lateralPresidios() {
  if (!listaPresidios || !dados.presidiosTotal) return '<p class="vazio">Carregando a lista de seções…</p>';
  const u = urnasBrasil(dataEleicao());
  const sec = state.sel && listaPresidios.find(x => x.id === state.sel);
  if (sec) {
    const agregadas = sec.agregadas?.length ? ` (inclui a seção ${sec.agregadas.join(', ')}, agregada)` : '';
    const sub = `${TIPO_PRESIDIO[sec.tipo]} · ${esc(sec.municipio)}/${sec.uf.toUpperCase()} · zona ${sec.zona}, seção ${sec.secao}${agregadas}`;
    return detalheHtml({ voltar: 'Todos os presídios', icone: `<span class="lat-uf">${sec.uf.toUpperCase()}</span>`, titulo: nomeLocal(sec.nome), sub, r: dados.presidios[sec.id], urnas: u })
      + (sec.aprox ? '<p class="urnas-resumo">Localização aproximada: o cadastro do TSE não traz as coordenadas deste local, então o ponto fica no centro do município.</p>' : '');
  }
  const total = dados.presidiosTotal;
  const ufs = new Set(listaPresidios.map(x => x.uf)).size;
  const porTipo = Object.keys(TIPO_PRESIDIO).map(tipo => {
    const doTipo = listaPresidios.filter(x => x.tipo === tipo);
    return { tipo, qtd: doTipo.length, r: somar(doTipo.map(x => dados.presidios[x.id])) };
  });
  const termo = normalizar(state.busca);
  const linhas = listaPresidios
    .filter(x => !termo || normalizar(`${x.nome} ${x.municipio} ${x.uf}`).includes(termo))
    .map(x => ({ id: x.id, tipo: 'presidio', icone: x.uf.toUpperCase(), nome: nomeLocal(x.nome), nota: x.municipio, r: dados.presidios[x.id] }));
  const antes = u.estado !== 'fechada'
    ? `<p class="urnas-resumo">Os boletins dessas seções só saem depois que as urnas do Brasil fecham, às <b>17h de Brasília</b>. Até lá a página não consulta nada delas; depois, confere cada seção ainda sem boletim a cada 5 minutos.</p>`
    : '';
  return detalheHtml({
    titulo: 'Presídios',
    sub: `Seções para presos provisórios e adolescentes internados · ${listaPresidios.length} seções em ${ufs} estados. Resultado somado dos boletins de urna já publicados.`,
    r: total,
  }) + antes
    + `<div class="lista-cab"><h3>Por tipo de unidade</h3></div>
      <ul class="linhas">${porTipo.map(t => `
        <li><div class="linha estatica">
          <span class="linha-ic">${t.tipo === 'socioeducativo' ? '■' : '●'}</span>
          <span class="linha-nome">${TIPO_PRESIDIO[t.tipo]}<small>${t.qtd} seções</small></span>
          ${miniBarra(t.r)}<span class="linha-pct">${liderPct(t.r)}</span>
        </div></li>`).join('')}</ul>`
    + `<input id="busca" class="busca" type="search" placeholder="Buscar presídio ou cidade…" value="${esc(state.busca)}" autocomplete="off">`
    + listaHtml(`Seções (${listaPresidios.length})`, linhas);
}

const normalizar = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* ---------------- interação ---------------- */

function limparDetalhe() {
  state.mun = null;
  state.zona = null;
  state.bairro = null;
  state.local = null;
}

function selecionar(id) {
  state.sel = id;
  state.multi = [];
  state.continente = null;
  state.cidade = null;
  state.busca = '';
  limparDetalhe();
  esconderTooltip();
  gravarHash();
  render();
  if (state.aba === 'estados') agendarDetalhe();
}

function irPara(mudancas) {
  Object.assign(state, mudancas);
  state.busca = '';
  esconderTooltip();
  gravarHash();
  render();
  agendarDetalhe();
}

function selecionarMun(uf, cd) {
  irPara({ sel: uf, mun: cd, zona: null, bairro: null, local: null });
}

function selecionarZona(z) {
  if (!state.mun) { const f = municipioEmFoco(); if (!f) return; state.sel = f.uf; state.mun = f.properties.cd; }
  irPara({ zona: Number(z), bairro: null, local: null });
}

function selecionarBairro(b) {
  irPara({ bairro: b, zona: null, local: null });
  const lm = locaisMun[state.mun];
  if (lm) carregarBoletins(secoesDeLocais(lm.bairros.get(b) ?? []));
}

function selecionarLocal(id) {
  if (!state.mun) { const f = municipioEmFoco(); if (!f) return; state.sel = f.uf; state.mun = f.properties.cd; }
  irPara({ local: id });
  const l = locaisMun[state.mun]?.porId.get(id);
  if (l) carregarBoletins(secoesDeLocais([l]));
}

// Volta um nível: local → bairro/zona → município → estado → Brasil.
function subirNivel() {
  if (state.multi.length) selecionar(null);
  else if (state.local) irPara({ local: null });
  else if (state.bairro || state.zona != null) irPara({ bairro: null, zona: null });
  else if (state.mun) irPara({ mun: null });
  else if (state.sel) selecionar(null);
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
  limparDetalhe();
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
  if (aba === 'exterior' && !dados.querCidades) {
    dados.querCidades = true;
    reavaliar();
  }
}

function trocarEleicao(ele) {
  if (ele === state.ele) return;
  state.ele = ele;
  dados = novosDados(ele);
  aplicarCache();
  dados.querCidades = state.aba === 'exterior';
  dados.querPresidios = state.aba === 'presidios';
  if (mundo) mundo.enquadrado = undefined;
  gravarHash();
  render();
  ciclo();
}

function realcar(id, ligado) {
  const svgSel = { estados: '#mapa-estados', exterior: '#mapa-mundo', presidios: '#mapa-presidios' }[state.aba];
  document.querySelectorAll(`${svgSel} [data-id="${CSS.escape(id)}"]`).forEach(n => n.classList.toggle('sel', ligado || n.dataset.id === state.sel || state.multi.includes(n.dataset.id)));
}

// Ctrl/⌘ + clique (ou modo soma) numa linha de estado ou do exterior: entra/sai da soma.
function cliqueDeSoma(ev, t) {
  if (state.aba !== 'estados' || !somar_(ev)) return false;
  const id = t.dataset.uf ?? (t.dataset.tipo === 'uf' ? t.dataset.ir : t.dataset.tipo === 'regiao' ? REGIOES[t.dataset.ir]?.ufs : null);
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
  if (t.dataset.ele) trocarEleicao(t.dataset.ele);
  else if (t.dataset.irEle) trocarEleicao(t.dataset.irEle);
  else if (t.dataset.aba) trocarAba(t.dataset.aba);
  else if (t.dataset.irAba) trocarAba(t.dataset.irAba);
  else if (t.hasAttribute('data-ordem')) { state.ordem = PROXIMA_ORDEM[ordemAtual()]; renderLateral(); }
  else if (t.hasAttribute('data-voltar')) {
    if (state.aba === 'estados') subirNivel();
    else voltarExterior();
  } else if (t.dataset.ir) {
    const tipo = t.dataset.tipo;
    if (tipo === 'cidade') selecionarCidade(t.dataset.ir);
    else if (tipo === 'mun') selecionarMun(state.sel, t.dataset.ir);
    else if (tipo === 'zona') selecionarZona(t.dataset.ir);
    else if (tipo === 'bairro') selecionarBairro(t.dataset.ir);
    else if (tipo === 'local') selecionarLocal(t.dataset.ir);
    else if (tipo === 'regiao') selecionarRegiao(t.dataset.ir);
    else if (tipo === 'continente') selecionarContinente(t.dataset.ir);
    else if (tipo === 'pais' && state.continente) irPara({ sel: t.dataset.ir, cidade: null });
    else if (t.dataset.ir === 'zz') trocarAba('exterior');
    else selecionar(t.dataset.ir);
  }
});

// Passar o mouse numa linha da lista destaca a região no mapa.
// Região e continente realçam todos os membros.
function membrosDaLinha(t) {
  if (t.dataset.tipo === 'regiao') return REGIOES[t.dataset.ir]?.ufs ?? [];
  if (t.dataset.tipo === 'continente') return paisesDoContinente(t.dataset.ir);
  if (['cidade', 'zona', 'bairro'].includes(t.dataset.tipo)) return [];
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
  if (ev.key !== 'Escape') return;
  if (state.aba === 'estados') subirNivel();
  else voltarExterior();
});

// Exterior e presídios: cidade → país → continente → lista; da lista do exterior, para Estados.
function voltarExterior() {
  if (state.cidade) irPara({ cidade: null });
  else if (state.sel && state.continente) irPara({ sel: null });
  else if (state.sel || state.continente) selecionar(null);
  else if (state.aba === 'exterior') trocarAba('estados');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

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
  if (state.aba === 'estados') agendarDetalhe();
});

/* ---------------- início ---------------- */

lerHash();
dados = novosDados(state.ele);
aplicarCache();
dados.querCidades = state.aba === 'exterior';
dados.querPresidios = state.aba === 'presidios';
render();
await Promise.all([montarEstados(), montarMundo(), montarPresidios()]);
aplicarCache();
if (state.aba === 'estados') agendarDetalhe();
ciclo();
// Abriu direto num local ou bairro (link compartilhado): carrega os boletins dele.
if (state.aba === 'estados' && state.mun && (state.local || state.bairro)) {
  const f = await carregarGeoMun(state.sel).then(() => featureMun(state.mun));
  const lm = f ? await carregarLocais(f.uf, state.mun) : null;
  if (lm) carregarBoletins(secoesDeLocais(state.local ? [lm.porId.get(state.local)].filter(Boolean) : lm.bairros.get(state.bairro) ?? []));
  render();
}
