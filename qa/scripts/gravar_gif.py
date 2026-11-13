"""Grava o GIF do portefólio: a pergunta do outro aparelho até à palavra-passe, sem criar conta.

Corre a partir de qa/:

    python scripts/gravar_gif.py
"""

from __future__ import annotations

import sys
import time
from io import BytesIO
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from conftest import criar_navegador  # noqa: E402
from dados import CRIAR_CONTA, PERGUNTA_FOTO, PERGUNTA_NOME, PERGUNTA_OUTRO, PERGUNTA_PASSE, url_da_app  # noqa: E402
from evidencias import PORTFOLIO, recorte  # noqa: E402
from paginas.portao import Portao  # noqa: E402


def _fotograma(driver) -> Image.Image:
    imagem = Image.open(BytesIO(driver.get_screenshot_as_png())).convert("RGB")
    largura = 960
    altura = round(imagem.height * (largura / imagem.width))
    return imagem.resize((largura, altura), Image.Resampling.LANCZOS)


def main() -> None:
    PORTFOLIO.mkdir(parents=True, exist_ok=True)
    driver = criar_navegador()
    fotogramas: list[Image.Image] = []
    try:
        portao = Portao(driver)
        driver.get(url_da_app())
        portao.esperar_pergunta(PERGUNTA_OUTRO)
        time.sleep(0.4)
        fotogramas.append(_fotograma(driver))
        portao.botao_com_texto(CRIAR_CONTA).click()
        portao.esperar_pergunta(PERGUNTA_NOME)
        time.sleep(0.3)
        fotogramas.append(_fotograma(driver))
        portao.escrever_nome("Ana Silva")
        time.sleep(0.3)
        recorte(portao.campo_nome(), "recorte-campo-nome", portfolio_media=True)
        fotogramas.append(_fotograma(driver))
        portao.avancar()
        portao.esperar_pergunta(PERGUNTA_FOTO)
        time.sleep(0.3)
        fotogramas.append(_fotograma(driver))
        portao.avancar()
        portao.esperar_pergunta(PERGUNTA_PASSE)
        time.sleep(0.3)
        fotogramas.append(_fotograma(driver))
        portao.escrever_passe("Valido!1")
        time.sleep(0.3)
        fotogramas.append(_fotograma(driver))
    finally:
        driver.quit()

    destino = PORTFOLIO / "portao-nome.gif"
    fotogramas[0].save(
        destino,
        save_all=True,
        append_images=fotogramas[1:],
        duration=900,
        loop=0,
        optimize=True,
    )
    print(destino)


if __name__ == "__main__":
    main()
