"""Endereços e texto da interface que os testes comparam.

A app segue a língua do browser. Nesta máquina isso é português, por isso
os testes da app fixam `?lingua=en` e comparam o catálogo inglês.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent
load_dotenv(RAIZ / ".env")

SITE = os.getenv("ORWELL_SITE_URL", "https://orwell.pt").rstrip("/")
_APP = os.getenv("ORWELL_APP_URL", "https://orwell.pt/app/").strip()


def url_da_app() -> str:
    """A app com a língua presa em inglês, sem perder um caminho que já exista."""
    partes = urlsplit(_APP if "://" in _APP else f"https://{_APP}")
    caminho = partes.path or "/"
    if not caminho.endswith("/"):
        caminho += "/"
    consulta = partes.query
    lingua = "lingua=en"
    if "lingua=" not in consulta:
        consulta = f"{consulta}&{lingua}" if consulta else lingua
    return urlunsplit((partes.scheme or "https", partes.netloc, caminho, consulta, ""))


# Site
HEROI_EN = "Play, talk"
HEROI_PT = "Joga, fala"
TITULO_EN = "A European alternative to Discord"
TITULO_PT = "Uma alternativa europeia ao Discord"

# Portão. Catálogo em packages/ui/src/linguas/en.ts, chave `gate`.
PERGUNTA_OUTRO = "Do you already use Orwell on another device?"
CRIAR_CONTA = "No, create an account"
PERGUNTA_NOME = "How do you want your name shown?"
PERGUNTA_FOTO = "Do you want a profile picture?"
PERGUNTA_PASSE = "What is the password going to be?"
PERGUNTA_CONFIRMA = "Confirm the password"
A_CRIAR = "Creating your account"
CONTINUAR = "Continue"
SALTAR = "Skip"
BOTAO_CRIAR = "Create account"
MOSTRAR = "Show"
PASSE_CURTA = "Type at least 8 characters."
PASSE_DIFERENTE = "The two passwords are different."

# O editor de perfil corta o nome a 32. O portão, nesta leva, não corta.
NOME_MAX_NO_PERFIL = 32
