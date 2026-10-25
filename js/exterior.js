// Cidades do exterior (UF "zz" no TSE) → país.
// id = código ISO 3166-1 numérico, o mesmo usado nas geometrias do world-atlas.
// Caiena e Saint-Georges ficam na Guiana Francesa, que no mapa faz parte da França.

export const COUNTRIES = {
  '008': { iso2: 'AL', nome: 'Albânia' },
  '012': { iso2: 'DZ', nome: 'Argélia' },
  '024': { iso2: 'AO', nome: 'Angola' },
  '028': { iso2: 'AG', nome: 'Antígua e Barbuda' },
  '031': { iso2: 'AZ', nome: 'Azerbaijão' },
  '032': { iso2: 'AR', nome: 'Argentina' },
  '036': { iso2: 'AU', nome: 'Austrália' },
  '040': { iso2: 'AT', nome: 'Áustria' },
  '044': { iso2: 'BS', nome: 'Bahamas' },
  '048': { iso2: 'BH', nome: 'Bahrein' },
  '050': { iso2: 'BD', nome: 'Bangladesh' },
  '051': { iso2: 'AM', nome: 'Armênia' },
  '052': { iso2: 'BB', nome: 'Barbados' },
  '056': { iso2: 'BE', nome: 'Bélgica' },
  '068': { iso2: 'BO', nome: 'Bolívia' },
  '070': { iso2: 'BA', nome: 'Bósnia e Herzegovina' },
  '072': { iso2: 'BW', nome: 'Botsuana' },
  '084': { iso2: 'BZ', nome: 'Belize' },
  '100': { iso2: 'BG', nome: 'Bulgária' },
  '104': { iso2: 'MM', nome: 'Mianmar' },
  '120': { iso2: 'CM', nome: 'Camarões' },
  '124': { iso2: 'CA', nome: 'Canadá' },
  '132': { iso2: 'CV', nome: 'Cabo Verde' },
  '144': { iso2: 'LK', nome: 'Sri Lanka' },
  '152': { iso2: 'CL', nome: 'Chile' },
  '156': { iso2: 'CN', nome: 'China' },
  '158': { iso2: 'TW', nome: 'Taiwan' },
  '170': { iso2: 'CO', nome: 'Colômbia' },
  '178': { iso2: 'CG', nome: 'Congo' },
  '180': { iso2: 'CD', nome: 'RD Congo' },
  '188': { iso2: 'CR', nome: 'Costa Rica' },
  '191': { iso2: 'HR', nome: 'Croácia' },
  '192': { iso2: 'CU', nome: 'Cuba' },
  '196': { iso2: 'CY', nome: 'Chipre' },
  '203': { iso2: 'CZ', nome: 'Tchéquia' },
  '204': { iso2: 'BJ', nome: 'Benin' },
  '208': { iso2: 'DK', nome: 'Dinamarca' },
  '214': { iso2: 'DO', nome: 'República Dominicana' },
  '218': { iso2: 'EC', nome: 'Equador' },
  '222': { iso2: 'SV', nome: 'El Salvador' },
  '226': { iso2: 'GQ', nome: 'Guiné Equatorial' },
  '231': { iso2: 'ET', nome: 'Etiópia' },
  '233': { iso2: 'EE', nome: 'Estônia' },
  '246': { iso2: 'FI', nome: 'Finlândia' },
  '250': { iso2: 'FR', nome: 'França' },
  '266': { iso2: 'GA', nome: 'Gabão' },
  '268': { iso2: 'GE', nome: 'Geórgia' },
  '275': { iso2: 'PS', nome: 'Palestina' },
  '276': { iso2: 'DE', nome: 'Alemanha' },
  '288': { iso2: 'GH', nome: 'Gana' },
  '300': { iso2: 'GR', nome: 'Grécia' },
  '320': { iso2: 'GT', nome: 'Guatemala' },
  '324': { iso2: 'GN', nome: 'Guiné' },
  '328': { iso2: 'GY', nome: 'Guiana' },
  '332': { iso2: 'HT', nome: 'Haiti' },
  '340': { iso2: 'HN', nome: 'Honduras' },
  '344': { iso2: 'HK', nome: 'Hong Kong' },
  '348': { iso2: 'HU', nome: 'Hungria' },
  '356': { iso2: 'IN', nome: 'Índia' },
  '360': { iso2: 'ID', nome: 'Indonésia' },
  '364': { iso2: 'IR', nome: 'Irã' },
  '368': { iso2: 'IQ', nome: 'Iraque' },
  '372': { iso2: 'IE', nome: 'Irlanda' },
  '376': { iso2: 'IL', nome: 'Israel' },
  '380': { iso2: 'IT', nome: 'Itália' },
  '384': { iso2: 'CI', nome: 'Costa do Marfim' },
  '388': { iso2: 'JM', nome: 'Jamaica' },
  '392': { iso2: 'JP', nome: 'Japão' },
  '398': { iso2: 'KZ', nome: 'Cazaquistão' },
  '400': { iso2: 'JO', nome: 'Jordânia' },
  '404': { iso2: 'KE', nome: 'Quênia' },
  '408': { iso2: 'KP', nome: 'Coreia do Norte' },
  '410': { iso2: 'KR', nome: 'Coreia do Sul' },
  '414': { iso2: 'KW', nome: 'Kuwait' },
  '422': { iso2: 'LB', nome: 'Líbano' },
  '434': { iso2: 'LY', nome: 'Líbia' },
  '454': { iso2: 'MW', nome: 'Malawi' },
  '458': { iso2: 'MY', nome: 'Malásia' },
  '466': { iso2: 'ML', nome: 'Mali' },
  '484': { iso2: 'MX', nome: 'México' },
  '504': { iso2: 'MA', nome: 'Marrocos' },
  '508': { iso2: 'MZ', nome: 'Moçambique' },
  '512': { iso2: 'OM', nome: 'Omã' },
  '516': { iso2: 'NA', nome: 'Namíbia' },
  '524': { iso2: 'NP', nome: 'Nepal' },
  '528': { iso2: 'NL', nome: 'Países Baixos' },
  '554': { iso2: 'NZ', nome: 'Nova Zelândia' },
  '558': { iso2: 'NI', nome: 'Nicarágua' },
  '566': { iso2: 'NG', nome: 'Nigéria' },
  '578': { iso2: 'NO', nome: 'Noruega' },
  '586': { iso2: 'PK', nome: 'Paquistão' },
  '591': { iso2: 'PA', nome: 'Panamá' },
  '600': { iso2: 'PY', nome: 'Paraguai' },
  '604': { iso2: 'PE', nome: 'Peru' },
  '608': { iso2: 'PH', nome: 'Filipinas' },
  '616': { iso2: 'PL', nome: 'Polônia' },
  '620': { iso2: 'PT', nome: 'Portugal' },
  '624': { iso2: 'GW', nome: 'Guiné-Bissau' },
  '626': { iso2: 'TL', nome: 'Timor-Leste' },
  '634': { iso2: 'QA', nome: 'Catar' },
  '642': { iso2: 'RO', nome: 'Romênia' },
  '643': { iso2: 'RU', nome: 'Rússia' },
  '662': { iso2: 'LC', nome: 'Santa Lúcia' },
  '678': { iso2: 'ST', nome: 'São Tomé e Príncipe' },
  '682': { iso2: 'SA', nome: 'Arábia Saudita' },
  '686': { iso2: 'SN', nome: 'Senegal' },
  '688': { iso2: 'RS', nome: 'Sérvia' },
  '702': { iso2: 'SG', nome: 'Singapura' },
  '703': { iso2: 'SK', nome: 'Eslováquia' },
  '704': { iso2: 'VN', nome: 'Vietnã' },
  '705': { iso2: 'SI', nome: 'Eslovênia' },
  '710': { iso2: 'ZA', nome: 'África do Sul' },
  '716': { iso2: 'ZW', nome: 'Zimbábue' },
  '724': { iso2: 'ES', nome: 'Espanha' },
  '740': { iso2: 'SR', nome: 'Suriname' },
  '752': { iso2: 'SE', nome: 'Suécia' },
  '756': { iso2: 'CH', nome: 'Suíça' },
  '760': { iso2: 'SY', nome: 'Síria' },
  '764': { iso2: 'TH', nome: 'Tailândia' },
  '768': { iso2: 'TG', nome: 'Togo' },
  '780': { iso2: 'TT', nome: 'Trinidad e Tobago' },
  '784': { iso2: 'AE', nome: 'Emirados Árabes Unidos' },
  '788': { iso2: 'TN', nome: 'Tunísia' },
  '792': { iso2: 'TR', nome: 'Turquia' },
  '804': { iso2: 'UA', nome: 'Ucrânia' },
  '818': { iso2: 'EG', nome: 'Egito' },
  '826': { iso2: 'GB', nome: 'Reino Unido' },
  '834': { iso2: 'TZ', nome: 'Tanzânia' },
  '840': { iso2: 'US', nome: 'Estados Unidos' },
  '854': { iso2: 'BF', nome: 'Burkina Faso' },
  '858': { iso2: 'UY', nome: 'Uruguai' },
  '862': { iso2: 'VE', nome: 'Venezuela' },
  '894': { iso2: 'ZM', nome: 'Zâmbia' },
};

// código TSE do município → [id do país, lat, lon]
export const CITIES = {
  '29254': ['384', 5.36, -4.01],     // Abidjã
  '29262': ['784', 24.45, 54.38],    // Abu Dhabi
  '99198': ['566', 9.08, 7.4],       // Abuja
  '29270': ['288', 5.6, -0.19],      // Accra
  '99325': ['231', 9.03, 38.74],     // Adis Abeba
  '30457': ['528', 52.37, 4.9],      // Amsterdã
  '29289': ['400', 31.95, 35.93],    // Amã
  '29297': ['792', 39.93, 32.86],    // Ancara
  '29300': ['012', 36.75, 3.06],     // Argel
  '29319': ['858', -30.4, -56.47],   // Artigas
  '29327': ['600', -25.26, -57.58],  // Assunção
  '39241': ['398', 51.17, 71.45],    // Astana
  '29335': ['300', 37.98, 23.73],    // Atenas
  '39080': ['840', 33.75, -84.39],   // Atlanta
  '99171': ['368', 33.31, 44.36],    // Bagdá
  '39128': ['031', 40.41, 49.87],    // Baku
  '99350': ['466', 12.64, -8.0],     // Bamako
  '29343': ['764', 13.76, 100.5],    // Bangkok
  '29351': ['724', 41.39, 2.17],     // Barcelona
  '99473': ['048', 26.23, 50.59],    // Barein
  '29360': ['422', 33.89, 35.5],     // Beirute
  '29378': ['688', 44.79, 20.45],    // Belgrado
  '38881': ['084', 17.25, -88.76],   // Belmopan
  '29386': ['276', 52.52, 13.4],     // Berlim
  '29394': ['624', 11.86, -15.6],    // Bissau
  '29408': ['170', 4.71, -74.07],    // Bogotá
  '29416': ['840', 42.36, -71.06],   // Boston
  '39209': ['703', 48.15, 17.11],    // Bratislava
  '39187': ['178', -4.27, 15.28],    // Brazzaville
  '29424': ['052', 13.1, -59.62],    // Bridgetown
  '29432': ['056', 50.85, 4.35],     // Bruxelas
  '29440': ['642', 44.43, 26.1],     // Bucareste
  '29459': ['348', 47.5, 19.04],     // Budapeste
  '29467': ['032', -34.6, -58.38],   // Buenos Aires
  '29475': ['250', 4.92, -52.33],    // Caiena (Guiana Francesa)
  '29483': ['818', 30.04, 31.24],    // Cairo
  '29491': ['036', -35.28, 149.13],  // Camberra
  '30651': ['156', 23.13, 113.26],   // Cantão
  '29505': ['862', 10.48, -66.9],    // Caracas
  '99384': ['662', 14.01, -60.99],   // Castries
  '29513': ['840', 41.88, -87.63],   // Chicago
  '29521': ['858', -33.7, -53.46],   // Chuy
  '29530': ['710', -33.92, 18.42],   // Cidade do Cabo
  '29556': ['600', -25.51, -54.61],  // Ciudad del Este
  '29564': ['862', 8.35, -62.64],    // Ciudad Guayana
  '99210': ['068', -11.03, -68.77],  // Cobija
  '29572': ['068', -17.41, -66.16],  // Cochabamba
  '30929': ['144', 6.93, 79.86],     // Colombo
  '38903': ['324', 9.64, -13.58],    // Conacri
  '29580': ['600', -23.41, -57.43],  // Concepción
  '29599': ['208', 55.68, 12.57],    // Copenhague
  '38920': ['204', 6.37, 2.39],      // Cotonou
  '29602': ['032', -31.42, -64.18],  // Córdoba
  '29610': ['686', 14.72, -17.47],   // Dacar
  '29629': ['050', 23.81, 90.41],    // Dacca
  '29637': ['760', 33.51, 36.29],    // Damasco
  '38962': ['834', -6.79, 39.21],    // Dar es Salaam
  '29653': ['634', 25.29, 51.53],    // Doha
  '29661': ['372', 53.35, -6.26],    // Dublin
  '29645': ['626', -8.56, 125.57],   // Díli
  '99503': ['826', 55.95, -3.19],    // Edimburgo
  '29670': ['600', -27.33, -55.87],  // Encarnación
  '29688': ['752', 59.33, 18.07],    // Estocolmo
  '30961': ['620', 37.02, -7.93],    // Faro
  '29696': ['276', 50.11, 8.68],     // Frankfurt
  '30669': ['072', -24.65, 25.91],   // Gaborone
  '29700': ['756', 46.2, 6.14],      // Genebra
  '29718': ['328', 6.8, -58.16],     // Georgetown
  '98000': ['320', 14.63, -90.51],   // Guatemala
  '29742': ['392', 34.71, 137.73],   // Hamamatsu
  '29750': ['704', 21.03, 105.85],   // Hanói
  '29769': ['716', -17.83, 31.05],   // Harare
  '30902': ['840', 41.76, -72.68],   // Hartford
  '29777': ['192', 23.11, -82.37],   // Havana
  '29785': ['246', 60.17, 24.94],    // Helsinque
  '29793': ['344', 22.32, 114.17],   // Hong Kong
  '29807': ['840', 29.76, -95.37],   // Houston
  '29815': ['120', 3.85, 11.5],      // Iaundê
  '38989': ['051', 40.18, 44.51],    // Ierevan
  '29823': ['604', -3.75, -73.25],   // Iquitos
  '29831': ['586', 33.68, 73.05],    // Islamabade
  '39306': ['792', 41.01, 28.98],    // Istambul
  '29840': ['360', -6.21, 106.85],   // Jacarta
  '29173': ['524', 27.72, 85.32],    // Katmandu
  '29858': ['804', 50.45, 30.52],    // Kiev
  '99430': ['388', 18.0, -76.79],    // Kingston
  '29874': ['180', -4.44, 15.27],    // Kinshasa
  '29882': ['414', 29.38, 47.99],    // Kuaite
  '29890': ['458', 3.14, 101.69],    // Kuala Lumpur
  '29904': ['068', -16.5, -68.15],   // La Paz
  '29912': ['566', 6.52, 3.38],      // Lagos
  '29939': ['266', 0.42, 9.47],      // Libreville
  '99341': ['454', -13.96, 33.79],   // Lilongue
  '29947': ['604', -12.05, -77.04],  // Lima
  '29955': ['620', 38.72, -9.14],    // Lisboa
  '39160': ['705', 46.06, 14.51],    // Liubliana
  '29963': ['768', 6.13, 1.22],      // Lomé
  '29971': ['826', 51.51, -0.13],    // Londres
  '29980': ['840', 34.05, -118.24],  // Los Angeles
  '29998': ['024', -8.84, 13.23],    // Luanda
  '99287': ['894', -15.39, 28.32],   // Lusaca
  '30066': ['724', 40.42, -3.7],     // Madri
  '39263': ['226', 3.75, 8.78],      // Malabo
  '30082': ['608', 14.6, 120.98],    // Manila
  '30074': ['558', 12.11, -86.24],   // Manágua
  '30090': ['508', -25.97, 32.57],   // Maputo
  '99511': ['250', 43.3, 5.37],      // Marselha
  '39102': ['512', 23.59, 58.41],    // Mascate
  '39004': ['032', -32.89, -68.83],  // Mendoza
  '30104': ['484', 19.43, -99.13],   // México
  '30112': ['840', 25.76, -80.19],   // Miami
  '30120': ['380', 45.46, 9.19],     // Milão
  '30147': ['858', -34.9, -56.16],   // Montevidéu
  '30155': ['124', 45.5, -73.57],    // Montreal
  '30163': ['643', 55.76, 37.62],    // Moscou
  '30171': ['356', 19.08, 72.88],    // Mumbai
  '30180': ['276', 48.14, 11.58],    // Munique
  '30198': ['392', 35.18, 136.91],   // Nagóia
  '30201': ['404', -1.29, 36.82],    // Nairóbi
  '99180': ['044', 25.05, -77.34],   // Nassau
  '39322': ['196', 35.17, 33.36],    // Nicosia
  '30210': ['356', 28.61, 77.21],    // Nova Delhi
  '30228': ['840', 40.71, -74.01],   // Nova York
  '99490': ['840', 28.54, -81.38],   // Orlando
  '30244': ['578', 59.91, 10.75],    // Oslo
  '30252': ['124', 45.42, -75.7],    // Ottawa
  '30260': ['591', 8.98, -79.52],    // Panamá
  '30279': ['740', 5.85, -55.2],     // Paramaribo
  '30287': ['250', 48.86, 2.35],     // Paris
  '30295': ['032', -29.71, -57.09],  // Paso de los Libres
  '30309': ['600', -22.55, -55.73],  // Pedro Juan Caballero
  '30317': ['156', 39.9, 116.41],    // Pequim
  '30325': ['780', 10.65, -61.51],   // Port of Spain
  '30341': ['620', 41.15, -8.61],    // Porto
  '30333': ['332', 18.59, -72.31],   // Porto Príncipe
  '30350': ['203', 50.08, 14.44],    // Praga
  '30368': ['132', 14.93, -23.51],   // Praia
  '30376': ['710', -25.75, 28.19],   // Pretória
  '99155': ['032', -25.6, -54.57],   // Puerto Iguazú
  '99236': ['068', -17.78, -57.77],  // Puerto Quijarro
  '99295': ['408', 39.04, 125.76],   // Pyongyang
  '30392': ['218', -0.18, -78.47],   // Quito
  '30406': ['504', 34.02, -6.84],    // Rabat
  '30414': ['275', 31.9, 35.2],      // Ramallah
  '30422': ['682', 24.71, 46.68],    // Riade
  '30430': ['858', -32.6, -53.38],   // Río Branco (Uruguai)
  '99244': ['858', -30.9, -55.55],   // Rivera
  '30449': ['380', 41.9, 12.5],      // Roma
  '99147': ['028', 17.12, -61.85],   // Saint John's
  '30465': ['600', -24.06, -54.31],  // Salto del Guairá
  '30473': ['068', -17.78, -63.18],  // Santa Cruz de la Sierra
  '99279': ['862', 4.6, -61.11],     // Santa Elena de Uairén
  '30481': ['152', -33.45, -70.67],  // Santiago
  '30988': ['070', 43.86, 18.41],    // Sarajevo
  '30538': ['410', 37.57, 126.98],   // Seul
  '29548': ['702', 1.35, 103.82],    // Singapura
  '99333': ['250', 3.89, -51.8],     // Saint-Georges-de-l'Oyapock (Guiana Francesa)
  '30562': ['036', -33.87, 151.21],  // Sydney
  '30490': ['214', 18.49, -69.93],   // São Domingos
  '30503': ['840', 37.77, -122.42],  // São Francisco
  '30511': ['188', 9.93, -84.09],    // São José (Costa Rica)
  '30520': ['222', 13.69, -89.22],   // São Salvador (El Salvador)
  '39225': ['678', 0.34, 6.73],      // São Tomé
  '30546': ['100', 42.7, 23.32],     // Sófia
  '30570': ['158', 25.03, 121.57],   // Taipé
  '99317': ['233', 59.44, 24.75],    // Talin
  '99104': ['268', 41.72, 44.79],    // Tbilisi
  '30597': ['364', 35.69, 51.39],    // Teerã
  '30600': ['340', 14.07, -87.19],   // Tegucigalpa
  '30619': ['376', 32.09, 34.78],    // Tel Aviv
  '99139': ['008', 41.33, 19.82],    // Tirana
  '30635': ['124', 43.65, -79.38],   // Toronto
  '30686': ['434', 32.89, 13.19],    // Trípoli
  '30708': ['788', 36.81, 10.18],    // Túnis
  '30627': ['392', 35.68, 139.69],   // Tóquio
  '39284': ['854', 12.37, -1.52],    // Uagadugu
  '39063': ['124', 49.28, -123.12],  // Vancouver
  '30740': ['616', 52.23, 21.01],    // Varsóvia
  '30767': ['040', 48.21, 16.37],    // Viena
  '30783': ['840', 38.91, -77.04],   // Washington
  '30805': ['554', -41.29, 174.78],  // Wellington
  '30821': ['516', -22.56, 17.08],   // Windhoek
  '30848': ['156', 31.23, 121.47],   // Xangai
  '99376': ['104', 16.84, 96.17],    // Yangon
  '39020': ['191', 45.81, 15.98],    // Zagreb
  '30864': ['756', 47.38, 8.54],     // Zurique
};

export function flagEmoji(iso2) {
  return String.fromCodePoint(...[...iso2].map(c => 0x1f1a5 + c.charCodeAt(0)));
}

// Fuso horário de cada cidade: a votação no exterior vai das 8h às 17h no horário local.
export const FUSOS = {
  '29254': 'Africa/Abidjan', '29262': 'Asia/Dubai', '99198': 'Africa/Lagos',
  '29270': 'Africa/Accra', '99325': 'Africa/Addis_Ababa', '30457': 'Europe/Amsterdam',
  '29289': 'Asia/Amman', '29297': 'Europe/Istanbul', '29300': 'Africa/Algiers',
  '29319': 'America/Montevideo', '29327': 'America/Asuncion', '39241': 'Asia/Almaty',
  '29335': 'Europe/Athens', '39080': 'America/New_York', '99171': 'Asia/Baghdad',
  '39128': 'Asia/Baku', '99350': 'Africa/Bamako', '29343': 'Asia/Bangkok',
  '29351': 'Europe/Madrid', '99473': 'Asia/Bahrain', '29360': 'Asia/Beirut',
  '29378': 'Europe/Belgrade', '38881': 'America/Belize', '29386': 'Europe/Berlin',
  '29394': 'Africa/Bissau', '29408': 'America/Bogota', '29416': 'America/New_York',
  '39209': 'Europe/Bratislava', '39187': 'Africa/Brazzaville', '29424': 'America/Barbados',
  '29432': 'Europe/Brussels', '29440': 'Europe/Bucharest', '29459': 'Europe/Budapest',
  '29467': 'America/Argentina/Buenos_Aires', '29475': 'America/Cayenne', '29483': 'Africa/Cairo',
  '29491': 'Australia/Sydney', '30651': 'Asia/Shanghai', '29505': 'America/Caracas',
  '99384': 'America/St_Lucia', '29513': 'America/Chicago', '29521': 'America/Montevideo',
  '29530': 'Africa/Johannesburg', '29556': 'America/Asuncion', '29564': 'America/Caracas',
  '99210': 'America/La_Paz', '29572': 'America/La_Paz', '30929': 'Asia/Colombo',
  '38903': 'Africa/Conakry', '29580': 'America/Asuncion', '29599': 'Europe/Copenhagen',
  '38920': 'Africa/Porto-Novo', '29602': 'America/Argentina/Cordoba', '29610': 'Africa/Dakar',
  '29629': 'Asia/Dhaka', '29637': 'Asia/Damascus', '38962': 'Africa/Dar_es_Salaam',
  '29653': 'Asia/Qatar', '29661': 'Europe/Dublin', '29645': 'Asia/Dili',
  '99503': 'Europe/London', '29670': 'America/Asuncion', '29688': 'Europe/Stockholm',
  '30961': 'Europe/Lisbon', '29696': 'Europe/Berlin', '30669': 'Africa/Gaborone',
  '29700': 'Europe/Zurich', '29718': 'America/Guyana', '98000': 'America/Guatemala',
  '29742': 'Asia/Tokyo', '29750': 'Asia/Ho_Chi_Minh', '29769': 'Africa/Harare',
  '30902': 'America/New_York', '29777': 'America/Havana', '29785': 'Europe/Helsinki',
  '29793': 'Asia/Hong_Kong', '29807': 'America/Chicago', '29815': 'Africa/Douala',
  '38989': 'Asia/Yerevan', '29823': 'America/Lima', '29831': 'Asia/Karachi',
  '39306': 'Europe/Istanbul', '29840': 'Asia/Jakarta', '29173': 'Asia/Kathmandu',
  '29858': 'Europe/Kiev', '99430': 'America/Jamaica', '29874': 'Africa/Kinshasa',
  '29882': 'Asia/Kuwait', '29890': 'Asia/Kuala_Lumpur', '29904': 'America/La_Paz',
  '29912': 'Africa/Lagos', '29939': 'Africa/Libreville', '99341': 'Africa/Blantyre',
  '29947': 'America/Lima', '29955': 'Europe/Lisbon', '39160': 'Europe/Ljubljana',
  '29963': 'Africa/Lome', '29971': 'Europe/London', '29980': 'America/Los_Angeles',
  '29998': 'Africa/Luanda', '99287': 'Africa/Lusaka', '30066': 'Europe/Madrid',
  '39263': 'Africa/Malabo', '30082': 'Asia/Manila', '30074': 'America/Managua',
  '30090': 'Africa/Maputo', '99511': 'Europe/Paris', '39102': 'Asia/Muscat',
  '39004': 'America/Argentina/Mendoza', '30104': 'America/Mexico_City', '30112': 'America/New_York',
  '30120': 'Europe/Rome', '30147': 'America/Montevideo', '30155': 'America/Toronto',
  '30163': 'Europe/Moscow', '30171': 'Asia/Kolkata', '30180': 'Europe/Berlin',
  '30198': 'Asia/Tokyo', '30201': 'Africa/Nairobi', '99180': 'America/Nassau',
  '39322': 'Asia/Nicosia', '30210': 'Asia/Kolkata', '30228': 'America/New_York',
  '99490': 'America/New_York', '30244': 'Europe/Oslo', '30252': 'America/Toronto',
  '30260': 'America/Panama', '30279': 'America/Paramaribo', '30287': 'Europe/Paris',
  '30295': 'America/Argentina/Cordoba', '30309': 'America/Asuncion', '30317': 'Asia/Shanghai',
  '30325': 'America/Port_of_Spain', '30341': 'Europe/Lisbon', '30333': 'America/Port-au-Prince',
  '30350': 'Europe/Prague', '30368': 'Atlantic/Cape_Verde', '30376': 'Africa/Johannesburg',
  '99155': 'America/Argentina/Cordoba', '99236': 'America/La_Paz', '99295': 'Asia/Pyongyang',
  '30392': 'America/Guayaquil', '30406': 'Africa/Casablanca', '30414': 'Asia/Hebron',
  '30422': 'Asia/Riyadh', '30430': 'America/Montevideo', '99244': 'America/Montevideo',
  '30449': 'Europe/Rome', '99147': 'America/Antigua', '30465': 'America/Asuncion',
  '30473': 'America/La_Paz', '99279': 'America/Caracas', '30481': 'America/Santiago',
  '30988': 'Europe/Sarajevo', '30538': 'Asia/Seoul', '29548': 'Asia/Singapore',
  '99333': 'America/Cayenne', '30562': 'Australia/Sydney', '30490': 'America/Santo_Domingo',
  '30503': 'America/Los_Angeles', '30511': 'America/Costa_Rica', '30520': 'America/El_Salvador',
  '39225': 'Africa/Sao_Tome', '30546': 'Europe/Sofia', '30570': 'Asia/Taipei',
  '99317': 'Europe/Tallinn', '99104': 'Asia/Tbilisi', '30597': 'Asia/Tehran',
  '30600': 'America/Tegucigalpa', '30619': 'Asia/Jerusalem', '99139': 'Europe/Tirane',
  '30635': 'America/Toronto', '30686': 'Africa/Tripoli', '30708': 'Africa/Tunis',
  '30627': 'Asia/Tokyo', '39284': 'Africa/Ouagadougou', '39063': 'America/Vancouver',
  '30740': 'Europe/Warsaw', '30767': 'Europe/Vienna', '30783': 'America/New_York',
  '30805': 'Pacific/Auckland', '30821': 'Africa/Windhoek', '30848': 'Asia/Shanghai',
  '99376': 'Asia/Yangon', '39020': 'Europe/Zagreb', '30864': 'Europe/Zurich',
};

export const CONTINENTES = {
  'america-norte': 'América do Norte',
  'america-central': 'América Central e Caribe',
  'america-sul': 'América do Sul',
  europa: 'Europa',
  africa: 'África',
  asia: 'Ásia',
  oceania: 'Oceania',
};

// Continente de cada país. Oriente Médio, Turquia e Cáucaso contam como Ásia; Rússia e Chipre, Europa.
const CONTINENTE_PAIS = {
  'america-norte': ['124', '840', '484'],
  'america-central': ['084', '320', '340', '222', '558', '188', '591', '192', '332', '214', '388', '044', '052', '780', '662', '028'],
  'america-sul': ['032', '068', '152', '170', '218', '328', '600', '604', '740', '858', '862'],
  europa: ['008', '040', '056', '070', '100', '191', '196', '203', '208', '233', '246', '250', '276', '300', '348', '372', '380', '528',
    '578', '616', '620', '642', '643', '688', '703', '705', '724', '752', '756', '804', '826'],
  africa: ['012', '024', '072', '120', '132', '178', '180', '204', '226', '231', '266', '288', '324', '384', '404', '434', '454', '466',
    '504', '508', '516', '566', '624', '678', '686', '710', '716', '768', '788', '818', '834', '854', '894'],
  asia: ['031', '048', '050', '051', '104', '144', '156', '158', '268', '275', '344', '356', '360', '364', '368', '376', '392', '398',
    '400', '408', '410', '414', '422', '458', '512', '524', '586', '608', '626', '634', '682', '702', '704', '760', '764', '784', '792'],
  oceania: ['036', '554'],
};
const PAIS_CONTINENTE = Object.fromEntries(Object.entries(CONTINENTE_PAIS).flatMap(([c, ids]) => ids.map(id => [id, c])));

// Caiena e Saint-Georges são da França, mas ficam na América do Sul (Guiana Francesa).
const CONTINENTE_CIDADE = { 29475: 'america-sul', 99333: 'america-sul' };

export const continenteDoPais = id => PAIS_CONTINENTE[id];

export const continenteDaCidade = cd => CONTINENTE_CIDADE[cd] ?? PAIS_CONTINENTE[CITIES[cd]?.[0]];

// Nome do país dentro de um continente que não é o "dele" (França na América do Sul).
export const nomePaisNoContinente = (id, continente) =>
  (id === '250' && continente === 'america-sul' ? 'Guiana Francesa (França)' : COUNTRIES[id]?.nome);
