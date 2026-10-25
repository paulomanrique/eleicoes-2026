# Eleições 2026 · Presidente — resultados por estado e por país

Página estática que lê ao vivo a API pública de resultados do TSE (`resultados.tse.jus.br`).

```bash
python3 -m http.server 8765   # depois abra http://localhost:8765
```

- **Estados**: mapa do Brasil por UF, com prévia ao passar o mouse e detalhe ao clicar.
- **Exterior**: mapa-múndi. O TSE apura o exterior por cidade (186 cidades, UF `zz`);
  `js/exterior.js` liga cada cidade ao seu país e a página soma os resultados por país.
  Clique num país para dar zoom e ver as cidades.
- Turno na URL: `#e=6258` (2º turno) ou `#e=6257` (1º turno). Seleção também vai na URL.
## Consultas ao TSE (para não tomar 429)

- **Relógio primeiro:** estados só a partir das 17h de Brasília; cada cidade do exterior só depois
  das 17h no fuso dela (`FUSOS` em `js/exterior.js`, votação das 8h às 17h locais). Se nenhum lugar
  com urna fechada está esperando resultado, a página não consulta nada e dorme até o próximo fechamento.
- **Índices:** a cada ciclo (60s, o CDN do TSE guarda por ~52s) só vem `br-e…-ab.json` (29 KB). Só são
  baixados os arquivos cuja versão mudou nesse índice. O índice das cidades (`zz-e…-ab.json`, 150 KB)
  só vem quando o total do exterior mudou. Lugar sem seção apurada é montado a partir do índice, sem baixar.
- **Cache local:** tudo fica no `localStorage`; resultado pronto (totalização encerrada) nunca é
  baixado de novo, e recarregar a página reaproveita o que já veio.
- **429/503:** recua exponencialmente (2, 4, 8… até 10 min) e mantém os últimos dados na tela.
- Depois das 17h de Brasília, o detalhe por cidade do exterior atualiza a cada 3 minutos.

## Exterior antes das 17h: boletins de urna

O TSE não totaliza nada antes das 17h de Brasília, nem o exterior: o índice e os arquivos das cidades
ficam zerados. Mas o boletim de urna de cada seção do exterior sai logo depois que ela fecha e transmite.
Enquanto a totalização do exterior não começa, a página soma esses boletins (`arquivo-urna/<pleito>/…`,
lista de seções em `config/zz/zz-p…-cs.json`, só as principais; as agregadas vêm no boletim da principal).

- Só seções de cidades já fechadas pelo fuso, as que fecharam primeiro na frente, no máximo 60 seções por
  ciclo (2 consultas cada). Seção sem boletim é reconferida a cada 5 minutos; boletim lido fica no cache para sempre.
- Cidade, país, continente e o total do exterior ficam com o mais completo entre a totalização e a soma dos
  boletins. Com o total nacional ainda zerado, o placar mostra a parcial do exterior, avisando que é só o exterior.
- Quando o TSE começa a totalizar o exterior, a página para de buscar boletins.

## Presídios

Seções especiais para presos provisórios e adolescentes internados (`CD_TIPO_LOCAL = 3` no cadastro de
locais de votação do TSE): 243 seções em 24 estados, em `data/presidios.json`, gerado por
`scripts/gera_presidios.py`. A classificação prisional × socioeducativo é feita pelo nome do local.

A API não tem total por presídio, então cada seção vem do seu boletim de urna (`arquivo-urna/<pleito>/…/
*-bu.dat`, lido por `js/bu.js`). Os boletins só saem depois das 17h de Brasília; a página só confere seções
de estados onde a apuração já começou, no máximo a cada 5 minutos por seção, e guarda o boletim publicado
para sempre no cache local.

## Zoom no Brasil: estado → município → zona → bairro/local

- Role ou belisque o mapa da aba Estados. A partir de certo zoom, os estados à vista (até 4) abrem em
  municípios (`data/mun/<uf>.json`, malha tbrugz/geodata-br ligada ao código TSE). Selecionar um
  município, ou aproximar bastante, abre as zonas eleitorais e os locais de votação dele
  (`data/locais/<uf>/<cd>.json`, do cadastro de locais do TSE).
- **Zonas:** o TSE não publica contorno de zona. A área desenhada é aproximada: células de Voronoi dos
  locais de votação, recortadas no município. O resultado de cada zona vem do arquivo da zona.
- **Bairro e local:** não há total na API; somam os boletins de urna das seções, carregados quando você
  clica (2 consultas por seção, guardados para sempre).
- **Consultas:** antes das 17h de Brasília, só o índice de cada estado aberto (uma vez, para o eleitorado).
  Depois, os municípios à vista entram numa fila com teto de 60 arquivos por minuto, maiores primeiro; o
  município selecionado e as zonas dele passam na frente. A fila continua sozinha até completar.
- Dados regenerados por `scripts/gera_dados_municipais.py` (comando no topo do script). 7 municípios
  criados depois de 2010 não têm polígono na malha e só aparecem na lista.

## Regiões e continentes

- **Regiões do Brasil** (aba Estados, painel do Brasil): Norte, Nordeste, Centro-Oeste, Sudeste e Sul.
  Clicar numa região soma os estados dela (é uma soma de estados pronta); Ctrl/⌘ + clique inclui ou
  tira a região inteira de uma soma em andamento.
- **Continentes** (aba Exterior): América do Norte, América Central e Caribe, América do Sul, Europa,
  África, Ásia e Oceania. A soma é por cidade, então Caiena e Saint-Georges (Guiana Francesa) contam na
  América do Sul. Oriente Médio, Turquia e Cáucaso estão em Ásia; Rússia e Chipre, em Europa.
- Nenhuma das duas faz consulta nova ao TSE: são somas do que já foi carregado.
