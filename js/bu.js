// Leitor do boletim de urna (arquivo "-bu.dat" do TSE): um envelope DER (ASN.1) com o boletim
// dentro de uma OCTET STRING. Só extrai o que a página usa: aptos, comparecimento e, para o cargo
// majoritário da eleição pedida (Presidente), votos por número, brancos e nulos.

const UNIVERSAL = 0;
const T_INTEIRO = 2;
const T_OCTETOS = 4;
const T_ENUM = 10;
const T_SEQUENCIA = 16;

// Tipos de voto do boletim.
const NOMINAL = 1;
const BRANCO = 2;
const NULO = 3;
const LEGENDA = 4;

function lerTLV(b, i) {
  const t = b[i++];
  let tag = t & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let x;
    do { x = b[i++]; tag = (tag << 7) | (x & 0x7f); } while (x & 0x80);
  }
  let len = b[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + b[i++];
  }
  if (i + len > b.length) throw new Error('boletim truncado');
  return { classe: t >> 6, construido: !!(t & 0x20), tag, ini: i, fim: i + len };
}

function filhos(b, no) {
  const out = [];
  for (let i = no.ini; i < no.fim;) {
    const f = lerTLV(b, i);
    out.push(f);
    i = f.fim;
  }
  return out;
}

function inteiro(b, no) {
  let v = 0;
  for (let i = no.ini; i < no.fim; i++) v = v * 256 + b[i];
  if (no.fim > no.ini && b[no.ini] & 0x80) v -= 2 ** (8 * (no.fim - no.ini));
  return v;
}

const eh = (no, tag) => no.classe === UNIVERSAL && no.tag === tag;

// Acha o "resultado por eleição": SEQUENCE cujo primeiro filho é o INTEGER com o código da eleição.
function acharEleicao(b, no, idEleicao, profundidade = 0) {
  if (!no.construido || profundidade > 4) return null;
  const fs = filhos(b, no);
  if (eh(no, T_SEQUENCIA) && fs.length > 2 && eh(fs[0], T_INTEIRO) && inteiro(b, fs[0]) === idEleicao && fs.some(f => eh(f, T_SEQUENCIA))) {
    return fs;
  }
  for (const f of fs) {
    const achado = acharEleicao(b, f, idEleicao, profundidade + 1);
    if (achado) return achado;
  }
  return null;
}

export function lerBoletim(buffer, idEleicao) {
  const b = new Uint8Array(buffer);
  const envelope = lerTLV(b, 0);
  const conteudo = filhos(b, envelope).find(n => eh(n, T_OCTETOS) && n.fim - n.ini > 100);
  if (!conteudo) throw new Error('boletim sem conteúdo');
  const bu = lerTLV(b, conteudo.ini);
  const eleicao = acharEleicao(b, bu, Number(idEleicao));
  if (!eleicao) throw new Error(`boletim sem a eleição ${idEleicao}`);

  const aptos = inteiro(b, eleicao[1]);
  const resultados = filhos(b, eleicao.find(f => eh(f, T_SEQUENCIA)));
  // ResultadoVotacao: [tipo de cargo (ENUM), comparecimento, totais por cargo]. O majoritário é o tipo 1.
  const majoritario = resultados.map(r => filhos(b, r)).find(fs => eh(fs[0], T_ENUM) && inteiro(b, fs[0]) === 1);
  if (!majoritario) throw new Error('boletim sem cargo majoritário');
  const comparecimento = inteiro(b, majoritario[1]);
  // TotalVotosCargo: [código do cargo, ordem de impressão, votos]. Presidente é o cargo 1.
  const cargos = filhos(b, majoritario[2]).map(c => filhos(b, c));
  const presidente = cargos.length === 1 ? cargos[0] : cargos.find(fs => inteiro(b, fs[0]) === 1);
  if (!presidente) throw new Error('boletim sem o cargo de Presidente');

  const votos = {};
  let brancos = 0;
  let nulos = 0;
  for (const v of filhos(b, presidente.find(f => eh(f, T_SEQUENCIA)))) {
    // TotalVotosVotavel: [1] tipo, [2] quantidade, [3] identificação (partido, número).
    const campos = Object.fromEntries(filhos(b, v).filter(f => f.classe === 2).map(f => [f.tag, f]));
    const tipo = inteiro(b, campos[1]);
    const qtd = inteiro(b, campos[2]);
    if ((tipo === NOMINAL || tipo === LEGENDA) && campos[3]) {
      const id = filhos(b, campos[3]);
      const numero = String(inteiro(b, id[id.length - 1]));
      votos[numero] = (votos[numero] ?? 0) + qtd;
    } else if (tipo === BRANCO) {
      brancos += qtd;
    } else if (tipo === NULO) {
      nulos += qtd;
    } else {
      nulos += qtd; // anulados e afins contam como nulos no total
    }
  }
  // Conferência antes de aceitar: um boletim lido errado ficaria guardado para sempre.
  const soma = Object.values(votos).reduce((a, q) => a + q, 0) + brancos + nulos;
  const contagens = [aptos, comparecimento, brancos, nulos, ...Object.values(votos)];
  if (!contagens.every(n => Number.isInteger(n) && n >= 0) || comparecimento > aptos || soma !== comparecimento) {
    throw new Error(`boletim inconsistente: soma ${soma}, comparecimento ${comparecimento}, aptos ${aptos}`);
  }
  return { aptos, comparecimento, votos, brancos, nulos };
}
