# Gera data/zonas.json: os pedaços município × zona eleitoral de cada estado, com o resultado de Lula (13) e
# Flávio Bolsonaro (22) no 1º turno, que já terminou e não muda mais. O 2º turno a página busca ao vivo.
# A lista de pedaços vem da configuração de seções do 2º turno (arquivo-urna/3221/config/<uf>/…-cs.json).
# Município com uma zona só usa o arquivo do município; com várias, o arquivo de cada zona.
# Uso: python3 -I scripts/gera_zonas.py data/zonas.json [pasta de rascunho]
# Cada estado pronto fica na pasta de rascunho (padrão /tmp/zonas-1t): rodar de novo retoma de onde parou.

import json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

BASE = 'https://resultados.tse.jus.br/oficial/ele2026'
UFS = 'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split()
ELE1, PLEITO2 = '6257', '3221'
LULA, FLAVIO = '13', '22'

def get(path):
    for tentativa in range(8):
        try:
            with urllib.request.urlopen(f'{BASE}/{path}', timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) and e.code < 500: raise
            print('  ', e.code, path, file=sys.stderr, flush=True)
        except (urllib.error.URLError, TimeoutError) as e:
            print('  ', e, path, file=sys.stderr, flush=True)
        time.sleep(min(60, 2 ** tentativa))
    raise RuntimeError(f'falhou: {path}')

def titulo(s):
    menores = {'de', 'da', 'do', 'das', 'dos', 'e', 'del'}
    return ' '.join(w if (i and w in menores) else w.capitalize() for i, w in enumerate(s.lower().split()))

def resultado(j):
    votos = {c['n']: int(c['vap'] or 0) for a in j['carg'][0]['agr'] for p in a['par'] for c in p['cand']}
    num = lambda v: int(v or 0)
    return [votos.get(LULA, 0), votos.get(FLAVIO, 0), num(j['v']['vv']), num(j['e']['c']), num(j['e']['te'])]

cm = get(f'6258/config/mun-e006258-cm.json')
nomes = {a['cd'].lower(): {m['cd']: titulo(m['nm']) for m in a['mu']} for a in cm['abr']}

rascunho = sys.argv[2] if len(sys.argv) > 2 else '/tmp/zonas-1t'
os.makedirs(rascunho, exist_ok=True)
saida = {'geradoEm': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'ufs': {}}
with ThreadPoolExecutor(6) as pool:
    for uf in UFS:
        arq = os.path.join(rascunho, f'{uf}.json')
        if os.path.exists(arq):
            saida['ufs'][uf] = json.load(open(arq))
            print(uf, 'do rascunho', file=sys.stderr, flush=True)
            continue
        cs = get(f'arquivo-urna/{PLEITO2}/config/{uf}/{uf}-p00{PLEITO2}-cs.json')
        mus = next(a for a in cs['abr'] if a['cd'].lower() == uf)['mu']
        pares = [(m['cd'], z['cd'], len(m['zon'])) for m in mus for z in m['zon']]
        def baixar(par):
            mun, zona, qtd = par
            z = '' if qtd == 1 else f'-z{zona}'
            return [mun, zona, *resultado(get(f'{ELE1}/dados/{uf}/{uf}{mun}{z}-c0001-e00{ELE1}-u.json'))]
        pecas = sorted(pool.map(baixar, pares), key=lambda p: (int(p[1]), p[0]))
        saida['ufs'][uf] = {'mun': {m['cd']: nomes[uf].get(m['cd'], m['cd']) for m in mus}, 'pecas': pecas}
        json.dump(saida['ufs'][uf], open(arq, 'w'), ensure_ascii=False)
        print(uf, len(mus), 'municípios', len(pecas), 'pedaços', len({p[1] for p in pecas}), 'zonas', file=sys.stderr, flush=True)

with open(sys.argv[1], 'w') as fh:
    json.dump(saida, fh, ensure_ascii=False, separators=(',', ':'))
