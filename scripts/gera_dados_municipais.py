#!/usr/bin/env python3
"""Gera os dados estaticos por municipio: malhas (data/mun/<uf>.json) e locais de votacao
(data/locais/<uf>/<cd>.json).

Uso (rodar com -I, os insumos baixados sao dados nao confiaveis):

    python3 -I scripts/gera_dados_municipais.py \
        --csv /tmp/tse-locais/extraido/eleitorado_local_votacao_2026_BRASIL.csv \
        --geo /tmp/tse-geo \
        --tse-config /tmp/tse-cfg/mun.json \
        --out data

Insumos:
  --csv         cadastro de locais de votacao do TSE (Latin-1, ';'), so NR_TURNO == 2
  --geo         pasta com geojs-<codigo IBGE da UF>-mun.json (tbrugz/geodata-br, 27 arquivos)
  --tse-config  mun-e006258-cm.json (lista de municipios do TSE com o codigo IBGE em "cdi")
  --out         raiz de saida (data/)
Requer node/npx (usa `npx -y mapshaper@0.6`). As malhas sao baixadas a parte, ver README do
script no topo: curl de https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/.
"""
import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata

IBGE_UF = {
    'ro': 11, 'ac': 12, 'am': 13, 'rr': 14, 'pa': 15, 'ap': 16, 'to': 17, 'ma': 21, 'pi': 22,
    'ce': 23, 'rn': 24, 'pb': 25, 'pe': 26, 'al': 27, 'se': 28, 'ba': 29, 'mg': 31, 'es': 32,
    'rj': 33, 'sp': 35, 'pr': 41, 'sc': 42, 'rs': 43, 'ms': 50, 'mt': 51, 'go': 52, 'df': 53,
}
# alvo de tamanho (bytes) por UF
LIMITE = {'sp': 350_000, 'mg': 450_000}
LIMITE_PADRAO = 250_000
PERCENTUAIS = [30, 20, 15, 10, 7, 5, 4, 3, 2.5, 2, 1.5, 1, 0.7, 0.5]

MINUSCULAS = {'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'a', 'o', 'à', 'ao'}


def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def chave(s):
    return re.sub(r'[^a-z0-9]', '', sem_acento(s).lower())


def title_pt(nome):
    """SAO JOSE DOS CAMPOS -> São José dos Campos (nome ja vem acentuado do TSE)."""
    def palavra(p, primeira):
        base = p.lower()
        if not primeira and base in MINUSCULAS:
            return base
        # apostrofo e hifen: d'Oeste -> D'Oeste, Passa-Vinte
        return re.sub(r"(^|['-])([^'-])", lambda m: m.group(1) + m.group(2).upper(), base)
    partes = nome.split()
    return ' '.join(palavra(p, i == 0) for i, p in enumerate(partes))


def limpa(s):
    return re.sub(r'\s+', ' ', (s or '').strip())


def num(s):
    s = (s or '').strip().replace(',', '.')
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    if v == -1:
        return None
    return round(v, 5)


def mapshaper(*args):
    return subprocess.run(['npx', '-y', 'mapshaper@0.6', *args], check=True, capture_output=True, text=True)


def gera_malhas(geo_dir, tse, out):
    sem_poligono = []   # municipios TSE sem poligono
    sem_tse = []        # poligonos sem municipio TSE
    pasta_mun = os.path.join(out, 'mun')
    os.makedirs(pasta_mun, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='tse-mun-')
    relatorio = {}
    try:
        for uf, ibge_uf in sorted(IBGE_UF.items()):
            munis = tse[uf]
            por_ibge = {m['cdi']: m for m in munis}
            with open(os.path.join(geo_dir, 'geojs-%d-mun.json' % ibge_uf), encoding='utf-8') as f:
                gj = json.load(f)
            feats = []
            achados = set()
            for ft in gj['features']:
                pid = str(ft['properties']['id'])
                m = por_ibge.get(pid)
                if not m:
                    sem_tse.append((uf, pid, ft['properties'].get('name')))
                    continue
                achados.add(pid)
                nome_tbrugz = (ft['properties'].get('name') or '').strip()
                nome_tse = title_pt(m['nm'])
                # tbrugz ja traz a caixa certa; so vale se for o mesmo nome (sem acento/pontuacao)
                nome = nome_tbrugz if chave(nome_tbrugz) == chave(nome_tse) else nome_tse
                feats.append({'type': 'Feature', 'properties': {'cd': m['cd'], 'nome': nome},
                              'geometry': ft['geometry']})
            for m in munis:
                if m['cdi'] not in achados:
                    sem_poligono.append((uf, m['cd'], m['cdi'], m['nm']))
            entrada = os.path.join(tmp, uf + '.geojson')
            with open(entrada, 'w', encoding='utf-8') as f:
                json.dump({'type': 'FeatureCollection', 'features': feats}, f, ensure_ascii=False)
            limite = LIMITE.get(uf, LIMITE_PADRAO)
            destino = os.path.join(pasta_mun, uf + '.json')
            escolhido = None
            for pct in PERCENTUAIS:
                saida = os.path.join(tmp, uf + '.topo.json')
                mapshaper(entrada, '-simplify', 'visvalingam', 'keep-shapes', '%s%%' % pct,
                          '-filter-fields', 'cd,nome', '-rename-layers', 'mun',
                          '-o', saida, 'format=topojson', 'quantization=1e5')
                tam = os.path.getsize(saida)
                escolhido = (pct, tam)
                if tam <= limite:
                    break
            shutil.copyfile(saida, destino)
            relatorio[uf] = (len(feats), escolhido[0], escolhido[1], limite)
            print('mun/%s: %d feicoes, %s%%, %d bytes (limite %d)' % (uf, len(feats), escolhido[0], escolhido[1], limite),
                  flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return sem_poligono, sem_tse, relatorio


def le_locais(csv_path, tse):
    codigos = {m['cd']: uf for uf, ms in tse.items() for m in ms}
    locais = {}  # (cd) -> {(zona, local): dict}
    desconhecidos = {}
    linhas = 0
    with open(csv_path, encoding='latin-1', newline='') as f:
        rd = csv.DictReader(f, delimiter=';', quotechar='"')
        for r in rd:
            if r['NR_TURNO'] != '2':
                continue
            if r['SG_UF'] == 'ZZ':
                continue
            linhas += 1
            cd = r['CD_MUNICIPIO'].strip()
            if cd not in codigos:
                desconhecidos[cd] = (r['SG_UF'], r['NM_MUNICIPIO'])
                continue
            zona = int(r['NR_ZONA'])
            loc = int(r['NR_LOCAL_VOTACAO'])
            mun = locais.setdefault(cd, {})
            p = mun.get((zona, loc))
            if p is None:
                p = {'z': zona, 'l': loc, 'n': limpa(r['NM_LOCAL_VOTACAO']), 'b': limpa(r['NM_BAIRRO']),
                     'e': limpa(r['DS_ENDERECO']), 'lat': num(r['NR_LATITUDE']), 'lon': num(r['NR_LONGITUDE']),
                     's': set(), 'el': 0, 't': int(r['CD_TIPO_LOCAL'])}
                mun[(zona, loc)] = p
            elif p['lat'] is None and num(r['NR_LATITUDE']) is not None and num(r['NR_LONGITUDE']) is not None:
                p['lat'], p['lon'] = num(r['NR_LATITUDE']), num(r['NR_LONGITUDE'])
            p['el'] += int(r['QT_ELEITOR_SECAO'] or 0)
            if r['DS_TIPO_SECAO_AGREGADA'].strip() == 'Principal':
                p['s'].add(int(r['NR_SECAO']))
    return locais, desconhecidos, linhas


def escreve_locais(locais, tse, out):
    n_arq = n_locais = n_nulos = 0
    sem_dados = []
    for uf, munis in sorted(tse.items()):
        pasta = os.path.join(out, 'locais', uf)
        os.makedirs(pasta, exist_ok=True)
        for m in munis:
            mun = locais.get(m['cd'])
            if not mun:
                sem_dados.append((uf, m['cd'], m['nm']))
                mun = {}
            lista = []
            for k in sorted(mun):
                p = dict(mun[k])
                p['s'] = sorted(p['s'])
                if p['lat'] is None or p['lon'] is None:
                    p['lat'] = p['lon'] = None
                    n_nulos += 1
                lista.append({'z': p['z'], 'l': p['l'], 'n': p['n'], 'b': p['b'], 'e': p['e'],
                              'lat': p['lat'], 'lon': p['lon'], 's': p['s'], 'el': p['el'], 't': p['t']})
            with open(os.path.join(pasta, m['cd'] + '.json'), 'w', encoding='utf-8') as f:
                json.dump({'locais': lista}, f, ensure_ascii=False, separators=(',', ':'))
            n_arq += 1
            n_locais += len(lista)
    return n_arq, n_locais, n_nulos, sem_dados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True)
    ap.add_argument('--geo', required=True)
    ap.add_argument('--tse-config', required=True)
    ap.add_argument('--out', default='data')
    a = ap.parse_args()

    with open(a.tse_config, encoding='utf-8') as f:
        cfg = json.load(f)
    tse = {ab['cd']: ab['mu'] for ab in cfg['abr'] if ab['cd'] != 'zz'}
    assert set(tse) == set(IBGE_UF), set(tse) ^ set(IBGE_UF)
    print('municipios TSE: %d' % sum(len(v) for v in tse.values()))

    sem_poligono, sem_tse, rel = gera_malhas(a.geo, tse, a.out)
    locais, desconhecidos, linhas = le_locais(a.csv, tse)
    n_arq, n_locais, n_nulos, sem_dados = escreve_locais(locais, tse, a.out)

    print('\n== resumo ==')
    print('linhas turno 2 lidas (sem exterior): %d' % linhas)
    print('arquivos de locais: %d, locais: %d, locais sem coordenada: %d' % (n_arq, n_locais, n_nulos))
    print('municipios TSE sem poligono (%d):' % len(sem_poligono))
    for x in sem_poligono:
        print('  ', x)
    print('poligonos sem municipio TSE (%d):' % len(sem_tse))
    for x in sem_tse:
        print('  ', x)
    print('municipios do CSV fora da lista TSE (%d): %s' % (len(desconhecidos), desconhecidos))
    print('municipios TSE sem linhas no CSV (%d): %s' % (len(sem_dados), sem_dados))


if __name__ == '__main__':
    sys.exit(main())
