// Acesso à API pública de resultados do TSE (resultados.tse.jus.br).
// Os arquivos "-u.json" são os mesmos que o app oficial consome; o bucket libera CORS.
// Os índices "-ab.json" dizem o andamento de cada recorte, então só baixamos o que mudou.

import { lerBoletim } from './bu.js';

const BASE = 'https://resultados.tse.jus.br/oficial';
const CICLO = 'ele2026';
const CARGO_PRESIDENTE = '0001';

export const ELEICOES = {
  '6258': { turno: 2, nome: '2º turno', data: '2026-10-25', pleito: '3221' },
  '6257': { turno: 1, nome: '1º turno', data: '2026-10-04', pleito: '3220' },
};

export const UFS = {
  ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará',
  df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão',
  mt: 'Mato Grosso', ms: 'Mato Grosso do Sul', mg: 'Minas Gerais', pa: 'Pará',
  pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco', pi: 'Piauí', rj: 'Rio de Janeiro',
  rn: 'Rio Grande do Norte', rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima',
  sc: 'Santa Catarina', sp: 'São Paulo', se: 'Sergipe', to: 'Tocantins',
};

const pad = (v, n) => String(v).padStart(n, '0');
const num = v => (v == null || v === '' ? 0 : Number(String(v).replace(',', '.')));

// 429 (ou 503 de sobrecarga): o TSE pediu para irmos mais devagar. "ate" é quando dá para tentar de novo.
export class LimiteTSE extends Error {
  constructor(status, ate) {
    super(`TSE respondeu ${status}`);
    this.status = status;
    this.ate = ate;
  }
}

// Limite de requisições simultâneas e pausa depois de 429/503, valendo para a página inteira.
const SIMULTANEAS = 6;
const PAUSA_BASE = 60_000;
const PAUSA_MAXIMA = 10 * 60_000;
let ativas = 0;
const fila = [];
let pausaAte = 0;
let pausas = 0;
let ultimoStatus = 429;

const vaga = () => (ativas < SIMULTANEAS ? (ativas++, Promise.resolve()) : new Promise(r => fila.push(r)));
const liberar = () => { const proxima = fila.shift(); if (proxima) proxima(); else ativas--; };

// opcional: 404 vira null (arquivo que ainda não foi publicado, como o boletim de uma seção).
async function pedir(path, { binario = false, opcional = false } = {}) {
  if (Date.now() < pausaAte) throw new LimiteTSE(ultimoStatus, pausaAte);
  await vaga();
  try {
    if (Date.now() < pausaAte) throw new LimiteTSE(ultimoStatus, pausaAte);
    // no-cache revalida com o CDN do TSE (ETag) em vez de reaproveitar uma cópia velha.
    const res = await fetch(`${BASE}/${CICLO}/${path}`, { cache: 'no-cache' });
    if (res.status === 429 || res.status === 503) {
      pausas++;
      ultimoStatus = res.status;
      pausaAte = Date.now() + Math.min(PAUSA_MAXIMA, PAUSA_BASE * 2 ** pausas) * (0.8 + Math.random() * 0.4);
      throw new LimiteTSE(res.status, pausaAte);
    }
    if (opcional && (res.status === 404 || res.status === 403)) return null;
    if (!res.ok) throw new Error(`TSE ${res.status}: ${path}`);
    pausas = 0;
    return binario ? await res.arrayBuffer() : await res.json();
  } finally {
    liberar();
  }
}

const getJson = path => pedir(path);

export const pausadoAte = () => pausaAte;

// Mesma "versão" calculada do índice e do arquivo de resultado: muda quando a totalização anda.
const versao = (and, s, e) => `${and}|${num(s.st)}|${num(e.c)}`;

// Sem município: total do estado (ou "br"/"zz"). Com zona: só aquela zona eleitoral do município.
export function fetchResultado(ele, uf, municipio = '', zona = null) {
  const z = zona != null ? `-z${pad(zona, 4)}` : '';
  const file = `${uf}${municipio}${z}-c${CARGO_PRESIDENTE}-e${pad(ele, 6)}-u.json`;
  return getJson(`${ele}/dados/${uf}/${file}`).then(parse);
}

// Índice de andamento: "br" lista UFs, exterior e Brasil; "zz" lista as cidades do exterior.
export async function fetchIndice(ele, uf) {
  const j = await getJson(`${ele}/dados/${uf}/${uf}-e${pad(ele, 6)}-ab.json`);
  return new Map(j.abr.map(a => [a.cdabr, {
    versao: versao(a.and, a.s, a.e),
    andamento: a.and,
    secoes: num(a.s.ts),
    secoesTot: num(a.s.st),
    eleitorado: num(a.e.te),
  }]));
}

export async function fetchMunicipiosExterior(ele) {
  const cfg = await getJson(`${ele}/config/mun-e${pad(ele, 6)}-cm.json`);
  const zz = cfg.abr.find(a => a.cd === 'zz');
  return zz ? zz.mu.map(m => ({ cd: m.cd, nome: tituloCidade(m.nm) })) : [];
}

// Seções principais de cada cidade do exterior, { cidade: [[zona, seção]] }. As agregadas ficam de
// fora: os votos delas vêm no boletim da principal.
export async function fetchSecoesExterior(ele) {
  const pleito = ELEICOES[ele].pleito;
  const cfg = await getJson(`arquivo-urna/${pleito}/config/zz/zz-p${pad(pleito, 6)}-cs.json`);
  const zz = cfg.abr.find(a => a.cd === 'zz');
  return Object.fromEntries((zz?.mu ?? []).map(m => [m.cd, m.zon.flatMap(z => z.sec.filter(s => !s.nsp).map(s => [z.cd, s.ns]))]));
}

// "25/10/2026" + "01:51:38", no horário de Brasília (sem horário de verão desde 2019) → ms UTC.
function horaDoTse(data, hora) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data ?? '');
  const t = m && /^\d{2}:\d{2}:\d{2}$/.test(hora ?? '') ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${hora}-03:00`) : NaN;
  return Number.isFinite(t) ? t : null;
}

// Boletim de urna de uma seção: o "aux" diz se já foi publicado e onde está o arquivo.
// Devolve null enquanto a seção não tiver boletim.
export async function fetchBoletimSecao(ele, s) {
  const pleito = ELEICOES[ele].pleito;
  const z = pad(s.zona, 4);
  const sec = pad(s.secao, 4);
  const dir = `arquivo-urna/${pleito}/dados/${s.uf}/${s.mun}/${z}/${sec}`;
  const aux = await pedir(`${dir}/p${pad(pleito, 6)}-${s.uf}-m${s.mun}-z${z}-s${sec}-aux.json`, { opcional: true });
  const hashes = aux?.hashes ?? [];
  const valido = [...hashes].reverse().find(h => /totaliz/i.test(h.st ?? '')) ?? hashes.at(-1);
  const arq = valido?.arq?.find(a => a.tp === 'bu');
  if (!arq) return null;
  const bin = await pedir(`${dir}/${valido.hash}/${arq.nm}`, { binario: true, opcional: true });
  return bin ? { ...lerBoletim(bin, ele), recebidoEm: horaDoTse(valido.dr, valido.hr) } : null;
}

export function fotoUrl(ele, sqcand) {
  return `${BASE}/${CICLO}/${ele}/fotos/br/${sqcand}.jpeg`;
}

function parse(j) {
  const cargo = j.carg[0];
  const validos = num(j.v.vv);
  const cands = cargo.agr.flatMap(a => a.par.flatMap(p => p.cand.map(c => ({
    n: c.n,
    sq: c.sqcand,
    nome: titulo(c.nmu),
    partido: p.sg,
    seq: num(c.seq),
    votos: num(c.vap),
    situacao: c.st || '',
  }))));
  for (const c of cands) c.pct = validos ? (c.votos / validos) * 100 : 0;
  cands.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
  return {
    versao: versao(j.and, j.s, j.e),
    cands,
    eleitorado: num(j.e.te),
    comparecimento: num(j.e.c),
    abstencao: num(j.e.a),
    validos,
    brancos: num(j.v.vb),
    nulos: num(j.v.tvn),
    secoes: num(j.s.ts),
    secoesTot: num(j.s.st),
    andamento: j.and, // n = não iniciada, f = finalizada
    totalizado: j.dt ? `${j.dt} ${j.ht}` : '',
  };
}

// Resultado pronto: totalização encerrada e todas as seções apuradas. Nunca mais muda.
export const pronto = r => !!r && r.andamento === 'f' && r.secoes > 0 && r.secoesTot === r.secoes;

// Cidade ainda sem nenhuma seção apurada: dá para montar o resultado (zerado) só com o índice,
// sem baixar o arquivo da cidade.
export function resultadoVazio(indice, modelo, versao = indice.versao) {
  return {
    versao,
    cands: modelo.cands.map(c => ({ ...c, votos: 0, pct: 0 })),
    eleitorado: indice.eleitorado,
    comparecimento: 0, abstencao: 0, validos: 0, brancos: 0, nulos: 0,
    secoes: indice.secoes,
    secoesTot: 0,
    andamento: indice.andamento,
    totalizado: '',
  };
}

// Soma resultados (cidades de um mesmo país) recalculando os percentuais.
export function somar(lista) {
  const out = {
    cands: [], eleitorado: 0, comparecimento: 0, abstencao: 0, validos: 0,
    brancos: 0, nulos: 0, secoes: 0, secoesTot: 0, andamento: 'f', totalizado: '',
  };
  const porNumero = new Map();
  for (const r of lista) {
    for (const k of ['eleitorado', 'comparecimento', 'abstencao', 'validos', 'brancos', 'nulos', 'secoes', 'secoesTot']) {
      out[k] += r[k];
    }
    if (r.andamento !== 'f') out.andamento = r.andamento;
    if (r.totalizado > out.totalizado) out.totalizado = r.totalizado;
    for (const c of r.cands) {
      const acc = porNumero.get(c.n);
      if (acc) acc.votos += c.votos;
      else porNumero.set(c.n, { ...c });
    }
  }
  out.cands = [...porNumero.values()];
  for (const c of out.cands) c.pct = out.validos ? (c.votos / out.validos) * 100 : 0;
  out.cands.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
  return out;
}

export const pctApurado = r => (r.secoes ? (r.secoesTot / r.secoes) * 100 : 0);

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'del', 'la', 'los', 'e']);

function titulo(s) {
  return s.toLowerCase().split(' ')
    .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function tituloCidade(s) {
  if (s === 'KINGSTON-JAMAICA') return 'Kingston';
  if (s === 'ST GEORGES DE LOYAPOCK') return "Saint-Georges-de-l'Oyapock";
  if (s === 'MEXICO') return 'Cidade do México';
  if (s === 'PANAMA') return 'Cidade do Panamá';
  if (s === 'GUATEMALA') return 'Cidade da Guatemala';
  if (s === 'BAREIN') return 'Manama';
  if (s === 'KUAITE') return 'Cidade do Kuwait';
  return titulo(s);
}
