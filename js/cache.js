// Cache dos resultados por eleição, em memória e no localStorage.
// Recarregar a página reaproveita tudo; só o que o índice do TSE disser que mudou é baixado de novo.
// Nada aqui pode lançar erro: sem localStorage (modo privado, cota cheia), o cache fica só em memória.
// Os boletins de urna ("bu:…") nunca mudam depois de publicados: ficam numa chave própria, que a
// limpeza por falta de espaço não apaga.

const PREFIXO = 'tse-cache-v1:';
const PREFIXO_BU = 'tse-bu-v1:';
const PREFIXO_TENTATIVA = 'tse-tentativa-v1:';
const instancias = new Map();

function gravar(chave, texto) {
  try {
    localStorage.setItem(chave, texto);
    return true;
  } catch {
    return false;
  }
}

function ler(chave) {
  try {
    return JSON.parse(localStorage.getItem(chave))?.itens ?? {};
  } catch {
    return {};
  }
}

const ehBoletim = id => id.startsWith('bu:');

export class Cache {
  // Uma instância por eleição: trocar de turno e voltar continua escrevendo no mesmo cache.
  static da(ele) {
    if (!instancias.has(ele)) instancias.set(ele, new Cache(ele));
    return instancias.get(ele);
  }

  constructor(ele) {
    this.chave = PREFIXO + ele;
    this.chaveBu = PREFIXO_BU + ele;
    this.itens = { ...ler(this.chave), ...ler(this.chaveBu) };
    this.sujo = false;
    this.sujoBu = false;
    this.chaveTentativa = PREFIXO_TENTATIVA + ele;
    this.tentativas = ler(this.chaveTentativa);
  }

  // Quando cada seção foi pedida pela última vez. Gravado na hora (chave pequena), para uma recarga
  // da página no meio de um lote não liberar novas tentativas antes do prazo.
  tentativa(id) {
    return this.tentativas[id] ?? 0;
  }

  marcarTentativa(id) {
    this.tentativas[id] = Date.now();
    gravar(this.chaveTentativa, JSON.stringify({ itens: this.tentativas }));
  }

  get(id) {
    return this.itens[id];
  }

  set(id, valor) {
    this.itens[id] = valor;
    if (ehBoletim(id)) this.sujoBu = true; else this.sujo = true;
  }

  salvar() {
    if (this.sujoBu) {
      const bus = Object.fromEntries(Object.entries(this.itens).filter(([id]) => ehBoletim(id)));
      if (gravar(this.chaveBu, JSON.stringify({ salvo: Date.now(), itens: bus }))) this.sujoBu = false;
    }
    if (!this.sujo) return;
    const texto = JSON.stringify({ salvo: Date.now(), itens: Object.fromEntries(Object.entries(this.itens).filter(([id]) => !ehBoletim(id))) });
    if (gravar(this.chave, texto)) { this.sujo = false; return; }
    // Sem espaço: abre mão dos agregados das outras eleições (os boletins ficam) e tenta de novo.
    try {
      Object.keys(localStorage).filter(k => k.startsWith(PREFIXO) && k !== this.chave).forEach(k => localStorage.removeItem(k));
    } catch { /* localStorage indisponível */ }
    if (gravar(this.chave, texto)) this.sujo = false;
  }
}
