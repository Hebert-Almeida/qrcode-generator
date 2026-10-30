# Gerador de QR Code para a linha de comando

Gera o QR Code de um link web: ele é desenhado direto no terminal e também salvo como imagem PNG. Cada versão do programa é um único arquivo:

| Versão | Arquivo | O que precisa |
|---|---|---|
| Node.js (principal) | `gerar_qrcode.js` | Node.js 18.3 ou superior. Nada mais: não há dependências. |
| Python | `gerar_qrcode.py` | Python 3.9 ou superior e a biblioteca `qrcode`. |

As duas aceitam os mesmos argumentos e fazem a mesma coisa. Os exemplos abaixo usam a versão Node.js; para usar a Python, troque `node gerar_qrcode.js` por `python gerar_qrcode.py`.

## Instalação

**Node.js:** não há nada para instalar além do próprio Node.js (testado nas versões 18, 20 e 25). Para conferir se ele está disponível:

```bash
node --version
```

Se o comando não for reconhecido, instale o Node.js em <https://nodejs.org> e abra um terminal novo.

**Python (opcional):** instale a dependência uma única vez:

```bash
pip install "qrcode[pil]"
```

## Como usar

```bash
node gerar_qrcode.js LINK [-o ARQUIVO.png]
```

### Exemplos

```bash
# QR Code simples: aparece no terminal e é salvo em qrcode.png (pasta atual)
node gerar_qrcode.js https://example.com

# Escolhendo o nome do arquivo PNG
node gerar_qrcode.js https://example.com -o meu_site.png

# Links com caracteres especiais (como & ou ?) devem ficar entre aspas
node gerar_qrcode.js "https://example.com/busca?q=qrcode&pagina=2"
```

Ao rodar, o programa:

1. desenha o QR Code no terminal (com caracteres de bloco), para você apontar a câmera do celular direto na tela;
2. salva a imagem PNG;
3. mostra o link usado e o caminho completo do arquivo gerado:

```
Link: https://example.com
PNG salvo em: C:\pasta\atual\qrcode.png
```

### Argumentos

| Argumento | Descrição |
|---|---|
| `LINK` | Link web a ser codificado. Precisa começar com `http://` ou `https://`. |
| `-o`, `--saida` | Nome do arquivo PNG de saída. Padrão: `qrcode.png`. Se você não colocar a extensão `.png`, ela é acrescentada. A pasta informada precisa existir. |
| `-h`, `--help` | Mostra a ajuda. |

## Observações

- **Aspas no link:** `&` tem significado especial no PowerShell, no CMD e no Bash. Sempre que o link tiver `&`, coloque-o entre aspas, senão o shell corta o link ou nem executa o comando.
- **Arquivo existente:** se já houver um arquivo com o mesmo nome, ele é sobrescrito.
- **Terminal claro ou escuro:** o desenho do terminal é feito para fundo escuro. Em terminais de fundo claro ele aparece invertido, e alguns leitores de QR Code não conseguem lê-lo. Nesse caso, use o PNG, que sempre sai em preto sobre branco.
- **Links longos** geram QR Codes maiores, que podem não caber na janela do terminal. Use o PNG.
- **Limite de tamanho:** um QR Code comporta no máximo 2331 bytes de link. A versão Node.js avisa quando o link passa disso.
- **Nome do script Python:** não renomeie `gerar_qrcode.py` para `qrcode.py`. O Python passaria a importar o próprio script no lugar da biblioteca.

## Como a versão Node.js funciona sem dependências

O codificador de QR Code (padrão ISO/IEC 18004, modo byte, correção de erros nível M) e o gravador de PNG estão dentro do próprio `gerar_qrcode.js` e usam apenas módulos que já vêm com o Node.js. Por isso não existe `package.json` nem `node_modules`: basta copiar o arquivo e rodar.

## Solução de problemas

| Problema | O que fazer |
|---|---|
| `node` não é reconhecido como comando | Instale o Node.js (<https://nodejs.org>) e abra um terminal novo. |
| `python` não é reconhecido como comando | No Windows, tente `py gerar_qrcode.py ...`. No Linux e no macOS, use `python3 gerar_qrcode.py ...`. |
| `A biblioteca "qrcode" não está instalada` (Python) | Rode `pip install "qrcode[pil]"`. |
| `Link inválido` | Informe o endereço completo, começando com `http://` ou `https://`. |
| `Link longo demais para caber em um QR Code` (Node.js) | O limite é de 2331 bytes. Use um encurtador de links. |
| `Não foi possível salvar ...` | Confira se a pasta de destino existe e se você tem permissão para gravar nela. |
| `Unknown option ...` ou `argument missing` (Node.js) | São mensagens do próprio Node.js para argumentos errados. Confira o uso com `node gerar_qrcode.js --help`; o `-o` precisa vir seguido do nome do arquivo. |
| A câmera não lê o QR Code do terminal | Algumas fontes deixam espaço entre as linhas. Aumente o zoom do terminal ou escaneie o PNG. |
