"""Capturas de ecrã, recortes e pasta do GIF.

`artefactos/` é local e está no .gitignore.
`docs/media/` é o que fica no repositório: recortes e o GIF.
"""

from __future__ import annotations

from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ARTEFACTOS = RAIZ / "artefactos" / "ecras"
PORTFOLIO = RAIZ / "docs" / "media"


def nome_seguro(nome: str) -> str:
    limpo = "".join(caracter if caracter.isalnum() or caracter in "-_" else "_" for caracter in nome)
    return limpo.strip("_")[:120] or "captura"


def ecra(driver, nome: str) -> Path:
    ARTEFACTOS.mkdir(parents=True, exist_ok=True)
    caminho = ARTEFACTOS / f"{nome_seguro(nome)}.png"
    driver.save_screenshot(str(caminho))
    return caminho


def portfolio(driver, nome: str) -> Path:
    PORTFOLIO.mkdir(parents=True, exist_ok=True)
    caminho = PORTFOLIO / f"{nome}.png"
    driver.save_screenshot(str(caminho))
    return caminho


def recorte(elemento, nome: str, *, portfolio_media: bool = False) -> Path:
    pasta = PORTFOLIO if portfolio_media else ARTEFACTOS
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / f"{nome}.png"
    elemento.screenshot(str(caminho))
    return caminho
