// Horário de votação no exterior: das 8h às 17h no horário local de cada cidade.
import { CITIES, FUSOS } from './exterior.js';

const BRASILIA = 'America/Sao_Paulo';

// No exterior, seção só é instalada onde há pelo menos 30 eleitores (Código Eleitoral, art. 226). As cidades
// abaixo disso não têm votação: não entram no relógio, nos fechamentos nem na espera por resultado.
export const MINIMO_ELEITORES = 30;
let semVotacao = new Set();

export function definirSemVotacao(cds) {
  semVotacao = new Set(cds);
}

function offsetMs(tz, instante) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instante;
}

// Instante (ms UTC) de uma hora cheia local numa data, respeitando horário de verão.
function horaLocal(dataISO, hora, tz) {
  const [y, m, d] = dataISO.split('-').map(Number);
  const palpite = Date.UTC(y, m - 1, d, hora);
  const t = palpite - offsetMs(tz, palpite);
  return palpite - offsetMs(tz, t);
}

// No Brasil as urnas fecham às 17h de Brasília em todos os estados; antes disso o TSE não tem votos dos estados.
export function fechamentoBrasil(dataISO) {
  return horaLocal(dataISO, 17, BRASILIA);
}

// Urnas do Brasil: das 8h às 17h de Brasília (o mesmo horário em todos os estados).
export function urnasBrasil(dataISO, agora = Date.now()) {
  const abre = horaLocal(dataISO, 8, BRASILIA);
  const fecha = horaLocal(dataISO, 17, BRASILIA);
  return { abre, fecha, estado: agora < abre ? 'antes' : agora < fecha ? 'votando' : 'fechada' };
}

export function urnasCidade(cd, dataISO, agora = Date.now()) {
  const tz = FUSOS[cd];
  if (!tz) return null;
  const abre = horaLocal(dataISO, 8, tz);
  const fecha = horaLocal(dataISO, 17, tz);
  if (semVotacao.has(cd)) return { abre, fecha, estado: 'sem-votacao' };
  return { abre, fecha, estado: agora < abre ? 'antes' : agora < fecha ? 'votando' : 'fechada' };
}

// Situação de um país: "fechada" só quando todas as cidades fecharam.
export function urnasPais(id, dataISO, agora = Date.now()) {
  return urnasCidades(Object.keys(CITIES).filter(cd => CITIES[cd][0] === id), dataISO, agora);
}

// Situação de um grupo de cidades (país, continente): "fechada" só quando todas fecharam. As cidades sem
// votação não contam; um grupo só delas fica "sem-votacao".
export function urnasCidades(cds, dataISO, agora = Date.now()) {
  const todas = cds.map(cd => urnasCidade(cd, dataISO, agora)).filter(Boolean);
  if (!todas.length) return null;
  const cidades = todas.filter(c => c.estado !== 'sem-votacao');
  if (!cidades.length) return { ...todas[0], estado: 'sem-votacao', fechadas: 0, total: 0 };
  const fechadas = cidades.filter(c => c.estado === 'fechada').length;
  const votando = cidades.some(c => c.estado === 'votando');
  const fecha = Math.max(...cidades.map(c => c.fecha));
  const abre = Math.min(...cidades.map(c => c.abre));
  const estado = fechadas === cidades.length ? 'fechada' : (votando || fechadas) ? 'votando' : 'antes';
  return { abre, fecha, primeiraFecha: Math.min(...cidades.map(c => c.fecha)), estado, fechadas, total: cidades.length };
}

export function resumoUrnas(dataISO, agora = Date.now()) {
  const cidades = Object.keys(CITIES).map(cd => ({ cd, pais: CITIES[cd][0], ...urnasCidade(cd, dataISO, agora) }))
    .filter(c => c.estado !== 'sem-votacao');
  const fechadas = cidades.filter(c => c.estado === 'fechada');
  const pendentes = new Set(cidades.filter(c => c.estado !== 'fechada').map(c => c.pais));
  const paisesFechados = new Set(fechadas.map(c => c.pais).filter(id => !pendentes.has(id)));
  const proximas = cidades.filter(c => c.estado !== 'fechada').sort((a, b) => a.fecha - b.fecha);
  const proxima = proximas.length ? proximas.filter(c => c.fecha === proximas[0].fecha) : [];
  return { total: cidades.length, fechadas: fechadas.length, paisesFechados, proxima, abertura: Math.min(...cidades.map(c => c.abre)) };
}

const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: BRASILIA, hour: '2-digit', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: BRASILIA, weekday: 'short' });
const fmtData = new Intl.DateTimeFormat('en-CA', { timeZone: BRASILIA });

// "01:00", ou "sáb 16:00" quando cai em outro dia (em Brasília) que não o da eleição.
export function horaBrasilia(ms, dataISO) {
  const hora = fmtHora.format(ms);
  return fmtData.format(ms) === dataISO ? hora : `${fmtDia.format(ms).replace('.', '')} ${hora}`;
}

export function faltam(ms, agora = Date.now()) {
  const min = Math.max(0, Math.round((ms - agora) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
