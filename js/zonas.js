// Evolução de Lula (13) e Flávio Bolsonaro (22) do 1º para o 2º turno, por zona eleitoral.
// O 1º turno, encerrado, vem de data/zonas.json (scripts/gera_zonas.py): cada pedaço município × zona.
// O 2º turno vem ao vivo do TSE, um estado por vez: o índice do estado diz quais municípios mudaram, e só
// esses são baixados (o arquivo do município, ou o de cada zona quando o município tem mais de uma).
// Cada pedaço fica guardado só com os números que a aba usa, numa chave própria do localStorage.

import { ELEICOES, LimiteTSE, fetchIndice, fetchResultado } from './tse.js';
import { fechamentoBrasil } from './urnas.js';

export const ELE_2T = '6258';
export const LULA = '13';
export const FLAVIO = '22';

const PREFIXO = 'tse-zonas-v1:';
const SIMULTANEAS = 6;
// Município em andamento com a versão igual no índice: rebaixa de tempos em tempos (correções de votos).
const RECONCILIAR = 10 * 60_000;

let base = null;
let carregando = null;
export function carregarZonas() {
  carregando ??= fetch('data/zonas.json')
    .then(r => {
      if (!r.ok) throw new Error(`data/zonas.json: ${r.status}`);
      return r.json();
    })
    .then(j => { base = j; return j; }, err => { carregando = null; throw err; });
  return carregando;
}
export const zonasCarregadas = () => !!base;
export const temZonas = uf => !!base?.ufs[uf];

// Pedaço: [l, f, válidos, comparecimento, eleitorado, seções, seções apuradas].
const vazio = () => [0, 0, 0, 0, 0, 0, 0];
const somarEm = (acc, p) => { for (let i = 0; i < acc.length; i++) acc[i] += p[i] ?? 0; return acc; };

export function compactar(r) {
  const v = n => r.cands.find(c => c.n === n)?.votos ?? 0;
  return [v(LULA), v(FLAVIO), r.validos, r.comparecimento, r.eleitorado, r.secoes, r.secoesTot];
}
const piecePronta = (r) => r.andamento === 'f' && r.secoes > 0 && r.secoesTot === r.secoes;

/* ----- cache do 2º turno, por estado ----- */

const caches = {};
function cacheUF(uf) {
  if (!caches[uf]) {
    let itens = {};
    try { itens = JSON.parse(localStorage.getItem(PREFIXO + uf))?.itens ?? {}; } catch { /* sem localStorage */ }
    caches[uf] = itens;
  }
  return caches[uf];
}
function salvarUF(uf) {
  try { localStorage.setItem(PREFIXO + uf, JSON.stringify({ salvo: Date.now(), itens: caches[uf] })); } catch { /* cota cheia: fica em memória */ }
}

const munsDaUF = uf => {
  const porMun = {};
  for (const [mun, zona] of base.ufs[uf].pecas) (porMun[mun] ??= []).push(zona);
  return porMun;
};

// Tudo do estado já está pronto no 2º turno? Então não há o que consultar.
export function ufPronta(uf) {
  if (!base) return false;
  const c = cacheUF(uf);
  return Object.keys(base.ufs[uf].mun).every(mun => c[mun]?.pronto);
}

// Antes das 17h de Brasília do dia do 2º turno não há voto: nem consulta.
export const segundoTurnoComVotos = () => Date.now() >= fechamentoBrasil(ELEICOES[ELE_2T].data);

// Baixa do TSE o que mudou no 2º turno de um estado. progresso(feitos, total) a cada arquivo.
// Um 429 interrompe o lote (o que chegou fica guardado) e é relançado para quem chamou; continuar() falso
// (trocou de estado ou de aba) para de pegar municípios novos.
export async function sincronizarUF(uf, progresso = () => {}, continuar = () => true) {
  await carregarZonas();
  if (!segundoTurnoComVotos()) return;
  const c = cacheUF(uf);
  const indice = await fetchIndice(ELE_2T, uf);
  const porMun = munsDaUF(uf);
  const agora = Date.now();
  const fila = Object.keys(porMun).filter(mun => {
    const atual = c[mun];
    const ix = indice.get(mun);
    if (atual?.pronto) return false;
    if (!ix) return !atual;
    if (atual?.versao !== ix.versao) return true;
    return ix.secoesTot > 0 && agora - (atual.em ?? 0) > RECONCILIAR;
  });
  let i = 0;
  let feitos = 0;
  let limite = null;
  progresso(0, fila.length);
  await Promise.all(Array.from({ length: SIMULTANEAS }, async () => {
    while (i < fila.length && !limite && continuar()) {
      const mun = fila[i++];
      const zonas = porMun[mun];
      try {
        // Município com uma zona só: o arquivo do município é o da zona. Com várias, uma zona por vez,
        // para que trocar de estado ou de aba pare de pedir as que faltam.
        const rs = [];
        if (zonas.length === 1) rs.push(await fetchResultado(ELE_2T, uf, mun));
        else for (const z of zonas) { if (!continuar()) break; rs.push(await fetchResultado(ELE_2T, uf, mun, Number(z))); }
        if (rs.length === zonas.length) guardarMun(c, mun, zonas, rs, indice.get(mun));
      } catch (err) {
        if (err instanceof LimiteTSE) limite = err; else console.warn(err);
      }
      feitos++;
      progresso(feitos, fila.length);
      if (feitos % 50 === 0) salvarUF(uf);
    }
  }));
  if (fila.length) salvarUF(uf);
  if (limite) throw limite;
}

// A apuração só anda: uma cópia que soma menos seções apuradas que a guardada (CDN atrasado, ou um lote
// antigo que terminou depois de um novo) não substitui a guardada. A versão do índice só é anotada quando os
// arquivos já chegaram até ela; senão, o município volta para a fila na próxima consulta.
function guardarMun(c, mun, zonas, rs, ix) {
  const apuradas = rs.reduce((s, r) => s + r.secoesTot, 0);
  const atual = c[mun];
  const apuradasAtual = atual ? Object.values(atual.pecas).reduce((s, p) => s + p[6], 0) : -1;
  if (atual && (atual.pronto || apuradas < apuradasAtual)) return;
  c[mun] = {
    versao: !ix || apuradas >= ix.secoesTot ? ix?.versao ?? rs[0].versao : 'atrasada',
    em: Date.now(),
    pronto: rs.every(piecePronta),
    pecas: Object.fromEntries(zonas.map((z, k) => [z, compactar(rs[k])])),
  };
}

/* ----- busca de municípios ----- */

const normalizar = t => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
let indiceMun = null;

// Municípios cujo nome contém o termo (em um estado só, se uf vier): primeiro os que começam com ele,
// depois os de maior eleitorado.
export function buscarMunicipios(termo, { uf = null, limite = 12 } = {}) {
  const t = normalizar(termo);
  if (!base || t.length < 3) return [];
  if (!indiceMun) {
    indiceMun = [];
    for (const [u, dados] of Object.entries(base.ufs)) {
      const el = {};
      for (const [mun, , , , , , eleitorado] of dados.pecas) el[mun] = (el[mun] ?? 0) + eleitorado;
      for (const [mun, nome] of Object.entries(dados.mun)) indiceMun.push({ uf: u, mun, nome, chave: normalizar(nome), eleitorado: el[mun] ?? 0 });
    }
  }
  return indiceMun
    .filter(m => (!uf || m.uf === uf) && m.chave.includes(t))
    .sort((a, b) => b.chave.startsWith(t) - a.chave.startsWith(t) || b.eleitorado - a.eleitorado)
    .slice(0, limite);
}

/* ----- agregados ----- */

// Zonas de um estado: os municípios de cada uma e as somas dos dois turnos.
// t1/t2: [l, f, válidos, comparecimento, eleitorado(, seções, seções apuradas)]; t2 = null sem nenhum
// pedaço do 2º turno baixado ainda. falta2: pedaços da zona ainda sem o 2º turno.
export function zonasDaUF(uf) {
  const c = cacheUF(uf);
  const zonas = new Map();
  for (const [mun, zona, ...t1] of base.ufs[uf].pecas) {
    const z = zonas.get(zona) ?? { id: zona, uf, muns: [], t1: [0, 0, 0, 0, 0], t2: null, falta2: 0 };
    z.muns.push(mun);
    somarEm(z.t1, t1);
    const p2 = c[mun]?.pecas?.[zona];
    if (p2) z.t2 = somarEm(z.t2 ?? vazio(), p2); else z.falta2++;
    zonas.set(zona, z);
  }
  return [...zonas.values()];
}

export const nomeMun = (uf, mun) => base.ufs[uf].mun[mun] ?? mun;

// 1º turno de um estado inteiro, somando os pedaços.
export function total1UF(uf) {
  return base.ufs[uf].pecas.reduce((acc, [, , ...t1]) => somarEm(acc, t1), [0, 0, 0, 0, 0]);
}

// Soma de zonas (ou de estados) já agregados.
export function somarZonas(lista) {
  const out = { t1: [0, 0, 0, 0, 0], t2: null, falta2: 0 };
  for (const z of lista) {
    somarEm(out.t1, z.t1);
    if (z.t2) out.t2 = somarEm(out.t2 ?? vazio(), z.t2);
    out.falta2 += z.falta2;
  }
  return out;
}
