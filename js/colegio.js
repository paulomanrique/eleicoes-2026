// Simulação: e se o Brasil escolhesse o presidente como os EUA, por um colégio eleitoral?
// Cada estado (e o DF, como Washington nos EUA) tem tantos delegados quanto deputados federais mais senadores,
// e quem tem mais votos no estado leva todos os delegados dele. Vence quem passar da metade.
// Deputados: a distribuição em vigor desde 1994 (513 cadeiras), mantida pelo STF para 2026.
// O exterior fica de fora: no modelo americano, só estados têm delegados.

export const DEPUTADOS = {
  sp: 70, mg: 53, rj: 46, ba: 39, rs: 31, pr: 30, pe: 25, ce: 22, ma: 18, go: 17, pa: 17, sc: 16, pb: 12,
  es: 10, pi: 10, al: 9, ac: 8, am: 8, ap: 8, df: 8, ms: 8, mt: 8, rn: 8, ro: 8, rr: 8, se: 8, to: 8,
};

export const delegados = (uf, senadores) => DEPUTADOS[uf] + senadores;

// ufs: { uf: resultado do TSE }. Para cada estado, quem leva e por quanto; no total, os delegados de cada
// candidato, a maioria necessária, o vencedor (se alguém chegou lá) e o estado decisivo: na ordem das vitórias
// mais folgadas do vencedor para as mais apertadas, o estado que o fez passar da metade.
export function apurarColegio(ufs, senadores) {
  const estados = Object.keys(DEPUTADOS).map(uf => {
    const r = ufs[uf];
    const n = delegados(uf, senadores);
    if (!r?.validos) return { uf, n, r, vencedor: null };
    const [p, s] = r.cands;
    // Empate no estado: ninguém leva os delegados.
    if (s && p.votos === s.votos) return { uf, n, r, vencedor: null, empate: true };
    return { uf, n, r, vencedor: p.n, margemVotos: p.votos - (s?.votos ?? 0), margem: (p.votos - (s?.votos ?? 0)) / r.validos * 100 };
  });
  const total = estados.reduce((acc, e) => acc + e.n, 0);
  const maioria = Math.floor(total / 2) + 1;
  const porCand = new Map();
  for (const e of estados) {
    if (!e.vencedor) continue;
    const c = porCand.get(e.vencedor) ?? { delegados: 0, estados: 0 };
    c.delegados += e.n;
    c.estados++;
    porCand.set(e.vencedor, c);
  }
  const vencedor = [...porCand].find(([, c]) => c.delegados >= maioria)?.[0] ?? null;
  let decisivo = null;
  if (vencedor) {
    let soma = 0;
    for (const e of estados.filter(x => x.vencedor === vencedor).sort((x, y) => y.margem - x.margem)) {
      soma += e.n;
      if (soma >= maioria) { decisivo = e; break; }
    }
  }
  return { estados, porCand, total, maioria, vencedor, decisivo, semVotos: estados.filter(e => !e.vencedor && !e.empate).reduce((acc, e) => acc + e.n, 0),
    empatados: estados.filter(e => e.empate).reduce((acc, e) => acc + e.n, 0) };
}
