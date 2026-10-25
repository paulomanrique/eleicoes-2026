# Gera data/presidios.json a partir do cadastro de locais de votação do TSE:
#   https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip
# Uso: python3 -I scripts/gera_presidios.py eleitorado_local_votacao_2026_BRASIL.csv data/presidios.json

import csv, json, re, sys, collections
src, out = sys.argv[1], sys.argv[2]
SOCIO = re.compile(r"SOCIO|SÓCIO|\bCASE\b|FUNDAÇÃO CASA|FUNASE|INTERNA|IASES|C\.S\.E\.A\.S|EDUCACIONAL DO JOVEM|^CASA (RIBEIR|TRES|FEMININO)|\bCSE\b|CASEM|UI/UIP|UIBRA|SUMESE")
def num(s):
    try: return float(s.replace(',', '.'))
    except ValueError: return None
coords = collections.defaultdict(list)
presos = {1: {}, 2: {}}
todas = {}
with open(src, encoding='latin1', newline='') as fh:
    for r in csv.DictReader(fh, delimiter=';'):
        turno = int(r['NR_TURNO'])
        lat, lon = num(r['NR_LATITUDE']), num(r['NR_LONGITUDE'])
        mun = r['CD_MUNICIPIO']
        if turno == 2 and lat not in (None, -1) and lon not in (None, -1):
            coords[mun].append((lat, lon))
        if turno == 2:
            todas[(r['SG_UF'], mun, r['NR_ZONA'], r['NR_SECAO'])] = r['CD_TIPO_LOCAL']
        if r['CD_TIPO_LOCAL'] == '3':
            presos[turno][(r['SG_UF'], mun, r['NR_ZONA'], r['NR_SECAO'])] = r
print('turno1', len(presos[1]), 'turno2', len(presos[2]), 'mesmas seções:', set(presos[1]) == set(presos[2]), file=sys.stderr)
def titulo(s):
    menores = {'de', 'da', 'do', 'das', 'dos', 'e'}
    return ' '.join(w if (i and w in menores) else w.capitalize() for i, w in enumerate(s.lower().split()))
secoes = {}
fora = []
for k, r in presos[2].items():
    uf, mun, z, s = k
    if r['DS_TIPO_SECAO_AGREGADA'] == 'Agregada':
        principal = (uf, mun, z, r['NR_SECAO_PRINCIPAL'])
        if principal in presos[2]:
            secoes.setdefault(principal, {}).setdefault('agregadas', []).append(int(s))
        else:
            fora.append(f"{r['NM_LOCAL_VOTACAO']} ({uf}, zona {z}, seção {s} -> principal {r['NR_SECAO_PRINCIPAL']}, tipo {todas.get(principal)})")
        continue
    lat, lon = num(r['NR_LATITUDE']), num(r['NR_LONGITUDE'])
    aprox = lat in (None, -1) or lon in (None, -1)
    if aprox and coords.get(mun):
        pts = coords[mun]; lat = sum(p[0] for p in pts) / len(pts); lon = sum(p[1] for p in pts) / len(pts)
    elif aprox:
        lat = lon = None
    nome = r['NM_LOCAL_VOTACAO'].strip()
    d = secoes.setdefault(k, {})
    d.update({
        'uf': uf.lower(), 'mun': mun, 'municipio': titulo(r['NM_MUNICIPIO']), 'zona': int(z), 'secao': int(s),
        'local': int(r['NR_LOCAL_VOTACAO']), 'nome': nome,
        'tipo': 'socioeducativo' if SOCIO.search(nome) else 'prisional',
        'lat': round(lat, 5) if lat is not None else None, 'lon': round(lon, 5) if lon is not None else None,
        'aprox': aprox,
    })
lista = sorted(secoes.values(), key=lambda d: (d['uf'], d['municipio'], d['zona'], d['secao']))
print('principais', len(lista), 'agregadas anexadas', sum(len(d.get('agregadas', [])) for d in lista), 'fora:', fora, file=sys.stderr)
print('sem coordenada nenhuma', sum(1 for d in lista if d['lat'] is None), 'aproximadas', sum(1 for d in lista if d['aprox']), file=sys.stderr)
print(collections.Counter(d['tipo'] for d in lista), file=sys.stderr)
json.dump({'fonte': 'TSE, eleitorado_local_votacao_2026 (CD_TIPO_LOCAL 3 = Preso provisório)', 'secoes': lista}, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
