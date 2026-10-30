#!/usr/bin/env python3
"""Gera um QR Code a partir de um link web.

Mostra o QR Code no terminal e salva uma imagem PNG.

Uso: python gerar_qrcode.py https://example.com [-o arquivo.png]
"""
import argparse
import os
import sys
from urllib.parse import urlparse

# Os blocos do QR e os acentos precisam de UTF-8; em pipes (ex.: Git Bash) o Windows usaria cp1252.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

try:
    import qrcode
except ImportError:
    sys.exit('A biblioteca "qrcode" não está instalada. Instale com:\n  pip install "qrcode[pil]"')


def validar_link(link):
    partes = urlparse(link)
    if partes.scheme not in ("http", "https") or not partes.netloc:
        sys.exit(
            f"Link inválido: {link!r}\n"
            "Informe o endereço completo, começando com http:// ou https:// "
            "(ex.: https://example.com)"
        )


def main():
    parser = argparse.ArgumentParser(description="Gera um QR Code a partir de um link web.")
    parser.add_argument("link", help="link web, ex.: https://example.com")
    parser.add_argument(
        "-o", "--saida", default="qrcode.png", help="arquivo PNG de saída (padrão: qrcode.png)"
    )
    args = parser.parse_args()

    link = args.link.strip()
    validar_link(link)

    saida = args.saida
    if not saida.lower().endswith(".png"):
        saida += ".png"

    qr = qrcode.QRCode()
    qr.add_data(link)
    qr.make()

    # invert=True: módulos escuros ficam "vazios" e o fundo é desenhado claro,
    # o que escaneia corretamente em terminais de fundo escuro.
    qr.print_ascii(invert=True)

    try:
        qr.make_image().save(saida)
    except OSError as erro:
        sys.exit(f"Não foi possível salvar {saida!r}: {erro}")

    print(f"Link: {link}")
    print(f"PNG salvo em: {os.path.abspath(saida)}")


if __name__ == "__main__":
    main()
