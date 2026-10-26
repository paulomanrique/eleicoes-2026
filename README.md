# Eleições 2026 · Presidente — resultados por estado e por país

Página estática que lê ao vivo a API pública de resultados do TSE (`resultados.tse.jus.br`).

```bash
python3 -m http.server 8765   # depois abra http://localhost:8765
```

- **Mapa**: um mapa-múndi só, com o Brasil dividido em estados e os outros países onde há seção
  eleitoral brasileira. Prévia ao passar o mouse e detalhe ao clicar. O TSE apura o exterior por cidade
  (186 cidades, UF `zz`); `js/exterior.js` liga cada cidade ao seu país e a página soma os resultados por
  país. Clique num país para dar zoom e ver as cidades.
- **Brasil**: só o mapa do Brasil por estado, com as siglas, soma de estados (Ctrl/⌘ + clique) e o painel
  só com regiões e estados.
- **Presídios**: as seções especiais, num mapa à parte.
- **Zonas**: Lula e Flávio Bolsonaro do 1º para o 2º turno, por zona eleitoral (abaixo).
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

## Regiões e continentes

- **Regiões do Brasil** (visão geral do painel): Norte, Nordeste, Centro-Oeste, Sudeste e Sul.
  Clicar numa região soma os estados dela (é uma soma de estados pronta); Ctrl/⌘ + clique inclui ou
  tira a região inteira de uma soma em andamento.
- **Continentes** (visão geral do painel): América do Norte, América Central e Caribe, América do Sul, Europa,
  África, Ásia e Oceania. A soma é por cidade, então Caiena e Saint-Georges (Guiana Francesa) contam na
  América do Sul. Oriente Médio, Turquia e Cáucaso estão em Ásia; Rússia e Chipre, em Europa.
- Nenhuma das duas faz consulta nova ao TSE: são somas do que já foi carregado.

## Comparar 1º e 2º turno

No painel de um estado ou país, "Comparar 1º e 2º turno" abre as fichas dos dois turnos lado a lado. O turno
na tela usa o que já foi carregado; o outro vem do cache dele e só consulta o TSE pelo que falta (um arquivo
por estado, um por cidade do país), respeitando o relógio. O 1º turno, encerrado, vem uma vez e fica guardado.

Na busca do painel (abas Mapa e Brasil) e na aba Zonas, digitar 3 letras ou mais lista as cidades do Brasil que batem
com o termo (nomes de `data/zonas.json`); clicar numa cidade abre o mesmo comparativo, com um arquivo do TSE por turno.

## Cidades com menos de 30 eleitores

No exterior, a seção só é instalada onde há pelo menos 30 eleitores (Código Eleitoral, art. 226); no 1º turno,
as 40 cidades abaixo disso saíram como "seção não instalada". A página lê o eleitorado de cada cidade no índice
do TSE e trata essas cidades como "sem votação": não entram nos horários de fechamento, não seguram a espera
por resultado e não têm boletim consultado.

## Zonas: 1º → 2º turno

Lula (13) e Flávio Bolsonaro (22) em cada zona eleitoral, nos dois turnos: percentual dos válidos, votos, variação em
pontos percentuais e quanto a vantagem andou (o "movimento"). No Brasil, uma linha por estado; num estado, uma por zona.
O agregado soma as zonas marcadas (clique na linha) ou, sem marca, tudo o que a tabela mostra (a busca filtra por zona
ou município).

- A API não tem total por zona: o TSE publica um arquivo por município e, nos municípios com mais de uma zona, um por
  município × zona. A zona é a soma desses pedaços (uma zona pode cobrir vários municípios).
- **1º turno**, encerrado: `data/zonas.json`, gerado por `scripts/gera_zonas.py` (a lista de pedaços vem da
  configuração de seções do 2º turno).
- **2º turno**, ao vivo, só do estado aberto: o índice do estado (`<uf>-e006258-ab.json`) diz quais municípios
  mudaram, e só eles são baixados, a cada 3 minutos enquanto o estado não estiver todo apurado. Os pedaços ficam no
  `localStorage` (`tse-zonas-v1:<uf>`) só com os números que a aba usa.
