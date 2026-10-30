#!/usr/bin/env node
// Gera um QR Code a partir de um link web: desenha no terminal e salva um PNG.
// Não precisa instalar nada: o codificador de QR Code está neste mesmo arquivo.
//
// Uso: node gerar_qrcode.js https://example.com [-o arquivo.png]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseArgs } = require('node:util');

const BORDA = 4; // margem clara ao redor do QR Code, em módulos
const ESCALA = 10; // lado de cada módulo no PNG, em pixels

// ---------------------------------------------------------------------------
// Codificador de QR Code (ISO/IEC 18004): modo byte, correção de erros nível M,
// versões 1 a 40. A estrutura é inspirada na biblioteca de referência do Project Nayuki,
// boa leitura para entender o algoritmo: https://www.nayuki.io/page/qr-code-generator-library
// ---------------------------------------------------------------------------

// Índice = versão (1 a 40): bytes de correção de erros por bloco e número de blocos.
const ECC_POR_BLOCO = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22,
  26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
  26, 26, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28,
];
const NUM_BLOCOS = [
  0, 1, 1, 1, 2, 2, 4, 4, 4, 5,
  5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
  16, 17, 17, 18, 20, 21, 23, 25, 26, 28,
  29, 31, 33, 35, 37, 38, 40, 43, 45, 47,
  49,
];

const MASCARAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// Módulos disponíveis para dados e correção de erros (tudo, menos os padrões fixos).
function modulosDeDados(versao) {
  let n = (16 * versao + 128) * versao + 64;
  if (versao >= 2) {
    const alinhamentos = Math.floor(versao / 7) + 2;
    n -= (25 * alinhamentos - 10) * alinhamentos - 55;
    if (versao >= 7) n -= 36;
  }
  return n;
}

const palavrasTotais = (versao) => Math.floor(modulosDeDados(versao) / 8);
const palavrasDeDados = (versao) =>
  palavrasTotais(versao) - ECC_POR_BLOCO[versao] * NUM_BLOCOS[versao];

// Multiplicação em GF(2^8) com o polinômio 0x11D, usada na correção Reed-Solomon.
function multiplicarGF(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

// Bytes de correção de erros (resto da divisão polinomial) dos dados de um bloco.
function restoReedSolomon(dados, grau) {
  const divisor = Array(grau).fill(0);
  divisor[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < grau; j++) {
      divisor[j] = multiplicarGF(divisor[j], raiz);
      if (j + 1 < grau) divisor[j] ^= divisor[j + 1];
    }
    raiz = multiplicarGF(raiz, 2);
  }
  const resto = Array(grau).fill(0);
  for (const byte of dados) {
    const fator = byte ^ resto.shift();
    resto.push(0);
    divisor.forEach((coef, i) => {
      resto[i] ^= multiplicarGF(coef, fator);
    });
  }
  return resto;
}

// Transforma os bytes do link nas palavras-código finais: dados + correção, intercalados.
function montarPalavras(dados) {
  let versao = 1;
  while (4 + (versao < 10 ? 8 : 16) + 8 * dados.length > 8 * palavrasDeDados(versao)) {
    if (++versao > 40) throw new Error('Link longo demais para caber em um QR Code.');
  }

  const bits = [];
  const empilhar = (valor, qtd) => {
    for (let i = qtd - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  empilhar(0b0100, 4); // modo byte
  empilhar(dados.length, versao < 10 ? 8 : 16); // quantidade de bytes
  for (const byte of dados) empilhar(byte, 8);
  const capacidade = 8 * palavrasDeDados(versao);
  empilhar(0, Math.min(4, capacidade - bits.length)); // terminador
  empilhar(0, (8 - (bits.length % 8)) % 8); // completa o último byte
  for (let pad = 0xec; bits.length < capacidade; pad ^= 0xec ^ 0x11) empilhar(pad, 8);

  const palavras = [];
  for (let i = 0; i < bits.length; i += 8) {
    palavras.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }

  // Divide em blocos, calcula a correção de cada um e intercala os bytes.
  const nBlocos = NUM_BLOCOS[versao];
  const tamEcc = ECC_POR_BLOCO[versao];
  const nCurtos = nBlocos - (palavrasTotais(versao) % nBlocos);
  const tamCurto = Math.floor(palavrasTotais(versao) / nBlocos);
  const blocos = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const dado = palavras.slice(k, k + tamCurto - tamEcc + (i < nCurtos ? 0 : 1));
    k += dado.length;
    const ecc = restoReedSolomon(dado, tamEcc);
    if (i < nCurtos) dado.push(0); // preenchimento: descartado na intercalação
    blocos.push(dado.concat(ecc));
  }
  const intercaladas = [];
  for (let i = 0; i < blocos[0].length; i++) {
    blocos.forEach((bloco, j) => {
      if (i !== tamCurto - tamEcc || j >= nCurtos) intercaladas.push(bloco[i]);
    });
  }
  return { versao, palavras: intercaladas };
}

class Matriz {
  constructor(versao, palavras, mascara) {
    this.versao = versao;
    this.tam = versao * 4 + 17;
    this.escuro = Array.from({ length: this.tam }, () => Array(this.tam).fill(false));
    this.fixo = Array.from({ length: this.tam }, () => Array(this.tam).fill(false)); // não leva dados
    this.desenharPadroes();
    this.posicionar(palavras);

    // Sem máscara definida, testa as 8 e fica com a de menor penalidade.
    if (mascara === undefined) {
      let menor = Infinity;
      for (let m = 0; m < 8; m++) {
        this.mascarar(m);
        const pontos = this.penalidade();
        this.mascarar(m); // desfaz
        if (pontos < menor) [menor, mascara] = [pontos, m];
      }
    }
    this.mascarar(mascara);
  }

  definir(x, y, escuro) {
    this.escuro[y][x] = escuro;
    this.fixo[y][x] = true;
  }

  // Quadrados concêntricos centrados em (cx, cy); a cor depende da distância ao centro.
  quadrado(cx, cy, raio, escuroNaDistancia) {
    for (let dy = -raio; dy <= raio; dy++) {
      for (let dx = -raio; dx <= raio; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.tam && y >= 0 && y < this.tam) {
          this.definir(x, y, escuroNaDistancia(Math.max(Math.abs(dx), Math.abs(dy))));
        }
      }
    }
  }

  desenharPadroes() {
    const { tam, versao } = this;
    for (let i = 0; i < tam; i++) {
      this.definir(6, i, i % 2 === 0); // linhas de temporização
      this.definir(i, 6, i % 2 === 0);
    }
    for (const [x, y] of [[3, 3], [tam - 4, 3], [3, tam - 4]]) {
      this.quadrado(x, y, 4, (d) => d !== 2 && d !== 4); // localizadores e separadores
    }
    if (versao > 1) {
      const n = Math.floor(versao / 7) + 2;
      const passo = versao === 32 ? 26 : Math.ceil((versao * 4 + 4) / (n * 2 - 2)) * 2;
      const pos = [6];
      for (let p = tam - 7; pos.length < n; p -= passo) pos.splice(1, 0, p);
      for (const x of pos) {
        for (const y of pos) {
          const sobreLocalizador =
            (x === 6 && y === 6) || (x === 6 && y === tam - 7) || (x === tam - 7 && y === 6);
          if (!sobreLocalizador) this.quadrado(x, y, 2, (d) => d !== 1); // alinhamento
        }
      }
    }
    this.desenharFormato(0); // só reserva o lugar; os bits reais vêm com a máscara
    if (versao >= 7) {
      let resto = versao;
      for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
      const bits = (versao << 12) | resto;
      for (let i = 0; i < 18; i++) {
        const escuro = ((bits >>> i) & 1) === 1;
        const a = tam - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.definir(a, b, escuro);
        this.definir(b, a, escuro);
      }
    }
  }

  // Bits de formato: nível de correção (M = 0b00) + máscara, com código BCH.
  desenharFormato(mascara) {
    const { tam } = this;
    const dados = (0b00 << 3) | mascara;
    let resto = dados;
    for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
    const bits = ((dados << 10) | resto) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.definir(8, i, bit(i));
    this.definir(8, 7, bit(6));
    this.definir(8, 8, bit(7));
    this.definir(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.definir(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.definir(tam - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.definir(8, tam - 15 + i, bit(i));
    this.definir(8, tam - 8, true); // módulo escuro fixo
  }

  // Escreve os bits em zigue-zague, de duas em duas colunas, começando embaixo à direita.
  posicionar(palavras) {
    const { tam } = this;
    let i = 0;
    for (let direita = tam - 1; direita >= 1; direita -= 2) {
      if (direita === 6) direita = 5; // pula a coluna de temporização
      for (let vert = 0; vert < tam; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = direita - j;
          const sobe = ((direita + 1) & 2) === 0;
          const y = sobe ? tam - 1 - vert : vert;
          if (!this.fixo[y][x] && i < palavras.length * 8) {
            this.escuro[y][x] = ((palavras[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  // Inverte os módulos de dados conforme a máscara (aplicar duas vezes desfaz).
  mascarar(m) {
    for (let y = 0; y < this.tam; y++) {
      for (let x = 0; x < this.tam; x++) {
        if (!this.fixo[y][x] && MASCARAS[m](x, y)) this.escuro[y][x] = !this.escuro[y][x];
      }
    }
    this.desenharFormato(m);
  }

  // Pontuação de penalidade da ISO 18004: quanto menor, mais fácil de ler.
  penalidade() {
    const { tam, escuro } = this;
    const linhas = escuro.map((l) => l.map(Number).join(''));
    const colunas = escuro.map((_, x) => escuro.map((l) => Number(l[x])).join(''));
    let pontos = 0;
    for (const s of [...linhas, ...colunas]) {
      for (const [corrida] of s.matchAll(/0{5,}|1{5,}/g)) pontos += corrida.length - 2; // sequências
      pontos += 40 * [...s.matchAll(/(?=00001011101|10111010000)/g)].length; // tipo localizador
    }
    for (let y = 0; y < tam - 1; y++) {
      for (let x = 0; x < tam - 1; x++) {
        const c = escuro[y][x]; // bloco 2x2 da mesma cor
        if (c === escuro[y][x + 1] && c === escuro[y + 1][x] && c === escuro[y + 1][x + 1]) {
          pontos += 3;
        }
      }
    }
    const escuros = escuro.flat().filter(Boolean).length; // equilíbrio escuros x claros
    pontos += (Math.ceil(Math.abs(escuros * 20 - tam * tam * 10) / (tam * tam)) - 1) * 10;
    return pontos;
  }
}

// Devolve a matriz do QR Code: escuro[y][x] === true para módulos escuros.
// `mascara` (0 a 7) é opcional; sem ela, usa a de menor penalidade.
function gerarQR(texto, mascara) {
  const { versao, palavras } = montarPalavras(Buffer.from(texto, 'utf8'));
  return new Matriz(versao, palavras, mascara).escuro;
}

// ---------------------------------------------------------------------------
// Saídas: terminal e PNG
// ---------------------------------------------------------------------------

// Cada caractere (█ ▀ ▄) vale dois módulos na vertical. A margem e os módulos claros viram
// blocos preenchidos e os escuros ficam vazios: o certo para terminais de fundo escuro.
function paraTerminal(escuro) {
  const lado = escuro.length + 2 * BORDA;
  const claro = (x, y) => y < lado && escuro[y - BORDA]?.[x - BORDA] !== true;
  const linhas = [];
  for (let y = 0; y < lado; y += 2) {
    let linha = '';
    for (let x = 0; x < lado; x++) {
      const topo = claro(x, y);
      const base = claro(x, y + 1);
      linha += topo ? (base ? '█' : '▀') : base ? '▄' : ' ';
    }
    linhas.push(linha);
  }
  return linhas.join('\n');
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunkPNG(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

// PNG em tons de cinza (8 bits), preto sobre branco, só com o zlib do Node.
function paraPNG(escuro) {
  const lado = (escuro.length + 2 * BORDA) * ESCALA;
  const bruto = Buffer.alloc((lado + 1) * lado, 255); // por linha: byte de filtro (0) + pixels
  for (let py = 0; py < lado; py++) {
    const inicio = py * (lado + 1);
    bruto[inicio] = 0;
    const linha = escuro[Math.floor(py / ESCALA) - BORDA];
    if (!linha) continue;
    for (let px = 0; px < lado; px++) {
      if (linha[Math.floor(px / ESCALA) - BORDA]) bruto[inicio + 1 + px] = 0;
    }
  }
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(lado, 0); // largura
  cabecalho.writeUInt32BE(lado, 4); // altura
  cabecalho[8] = 8; // bits por pixel
  cabecalho[9] = 0; // tons de cinza
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPNG('IHDR', cabecalho),
    chunkPNG('IDAT', zlib.deflateSync(bruto)),
    chunkPNG('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

const AJUDA = `Uso: node gerar_qrcode.js LINK [-o ARQUIVO.png]

Gera um QR Code a partir de um link web, mostra no terminal e salva uma imagem PNG.

Argumentos:
  LINK                 link web, ex.: https://example.com
  -o, --saida ARQUIVO  arquivo PNG de saída (padrão: qrcode.png)
  -h, --help           mostra esta ajuda`;

function falhar(mensagem) {
  console.error(mensagem);
  process.exitCode = 1;
}

function linkValido(link) {
  if (!/^https?:\/\//i.test(link)) return false;
  try {
    return new URL(link).host !== '';
  } catch {
    return false;
  }
}

function main() {
  let args;
  try {
    args = parseArgs({
      options: { saida: { type: 'string', short: 'o' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
    });
  } catch (erro) {
    return falhar(`${erro.message}\n\n${AJUDA}`);
  }
  if (args.values.help) {
    console.log(AJUDA);
    return;
  }
  if (args.positionals.length !== 1) return falhar(`Informe exatamente um link.\n\n${AJUDA}`);

  const link = args.positionals[0].trim();
  if (!linkValido(link)) {
    return falhar(
      `Link inválido: '${link}'\n` +
        'Informe o endereço completo, começando com http:// ou https:// (ex.: https://example.com)',
    );
  }

  let saida = args.values.saida ?? 'qrcode.png';
  if (!saida.toLowerCase().endsWith('.png')) saida += '.png';

  let escuro;
  try {
    escuro = gerarQR(link);
  } catch (erro) {
    return falhar(erro.message);
  }

  console.log(paraTerminal(escuro));
  try {
    fs.writeFileSync(saida, paraPNG(escuro));
  } catch (erro) {
    return falhar(`Não foi possível salvar '${saida}': ${erro.message}`);
  }
  console.log(`Link: ${link}`);
  console.log(`PNG salvo em: ${path.resolve(saida)}`);
}

if (require.main === module) main();
