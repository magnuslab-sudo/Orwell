#!/usr/bin/env python3
"""
A marca do Orwell: o O redigido.

Fonte única de todos os sítios onde a marca aparece — favicon do site, favicon
da aplicação, ícone da aplicação de secretária, ícones da barra do sistema e os
paths do componente `OrwellMark`. Um desenho num sítio só, porque quatro cópias
à mão divergem à primeira vez que alguém acertar numa faixa.

    python3 gerar-marca.py

Escreve por cima dos assets em `apps/` e do módulo `packages/ui/src/marca.gen.ts`,
de onde o `OrwellMark` lê as tarjas. Nada disto se edita à mão.

A GRELHA É DE 24 E NÃO É ARBITRÁRIA. As faixas medem 3 e os vãos 1.5, o que a
16 px — o tamanho a que isto tem de funcionar, e o que mata logótipos deste tipo
— dá exactamente 2 px de faixa e 1 px de vão, em fronteira de pixel. Mexer nestes
números sem refazer a conta devolve um borrão cinzento.
"""

from __future__ import annotations

import base64
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ACENTO = "#7a85f5"
FUNDO = "#0e0f13"
ACENTO_DEEP = "#3c43a8"

# --- the geometry, in units of the 24-unit grid -------------------------------

CENTRO = 12.0
# A_EXT is smaller than B_EXT because the sliding banner must fit inside the
# same box: the drawing takes 2·A_EXT + DESLOCA in width, and that whole set
# centers. With A_EXT = B_EXT the loose banner would escape the viewBox and touch the
# favicon edge.
A_EXT, B_EXT = 9.7, 10.5
A_INT, B_INT = 3.2, 5.6
RAIO = 0.85           # corner of a banner marker, not a capsule
K = 3.4               # superellipse exponent: a square O, not a circle

# Two optical variants of the same design, which is what any mark of this kind
# demands: the seven banners in the sketch blur into a smudge at 16 px, and the five in the
# small variant stay sparse when there is resolution for more.
#
#   n · banner height · gap · which one slipped off the banner
CHEIA = (7, 2.25, 0.875, 4)
COMPACTA = (5, 3.0, 1.5, 3)      # 3 e 1,5 → exactamente 2 px e 1 px a 16
DESLOCA = 1.6                     # how far the loose banner slides to the right

# The boundary between the two. Below this the full variant runs out of pixels
# for the six gaps, and what you see is a grey rectangle. Measured by eye at
# real pixel: at 32 the full one still blurs, at 48 it is clean.
LIMIAR_COMPACTA = 40


def _meia(a: float, b: float, y: float) -> float:
    if abs(y) >= b:
        return 0.0
    return a * (1 - abs(y / b) ** K) ** (1 / K)


def _tarja(x0: float, x1: float, y0: float, alt: float) -> str:
    r = min(RAIO, (x1 - x0) / 2, alt / 2)
    return (f"M{x0 + r:g} {y0:g}H{x1 - r:g}a{r:g} {r:g} 0 0 1 {r:g} {r:g}"
            f"V{y0 + alt - r:g}a{r:g} {r:g} 0 0 1 {-r:g} {r:g}H{x0 + r:g}"
            f"a{r:g} {r:g} 0 0 1 {-r:g} {-r:g}V{y0 + r:g}"
            f"a{r:g} {r:g} 0 0 1 {r:g} {-r:g}Z")


def formas(variante=CHEIA) -> list[str]:
    """As tarjas da marca, na grelha de 24, já com o centro em (12,12)."""
    n, alt, vao, solta = variante
    saida: list[str] = []
    topo = CENTRO - (n * alt + (n - 1) * vao) / 2
    centrar = -DESLOCA / 2          # the set, with the loose banner, in the middle
    for i in range(n):
        y0 = topo + i * (alt + vao)
        yc = y0 + alt / 2 - CENTRO
        meia = _meia(A_EXT, B_EXT, yc)
        if meia < 0.5:
            continue
        interno = _meia(A_INT, B_INT, yc)
        dx = centrar + (DESLOCA if i == solta else 0.0)
        if interno < 1.0:                       # topo e base: a tarja atravessa
            saida.append(_tarja(CENTRO - meia + dx, CENTRO + meia + dx, y0, alt))
        else:                                   # middle: two stems, the open O
            saida.append(_tarja(CENTRO - meia + dx, CENTRO - interno + dx, y0, alt))
            saida.append(_tarja(CENTRO + interno + dx, CENTRO + meia + dx, y0, alt))
    return saida


# --- the files -----------------------------------------------------------

def marca_svg(lado: int = 24) -> str:
    """O favicon, com fundo. Vive em `apps/site/public/` e `apps/web/public/`.

    Variante compacta, porque um favicon é visto a 16 e a 32 e nunca a 96."""
    corpo = "\n".join(f'    <path d="{d}" />' for d in formas(COMPACTA))
    return f"""<!--
  O favicon, com fundo.

  Esteve como data-URI dentro do `index.html` da aplicação, e sem fundo: um
  traço lilás de dois píxeis sobre o que quer que o browser tenha por trás. Em
  separadores claros perde-se, e foi assim que se descobriu que "está sem
  favicon" era, na verdade, "está com um favicon que não se vê".

  Um ficheiro e não um data-URI porque agora é preciso em três sítios — a
  aplicação, a página e as páginas legais — e três cópias de uma cadeia de
  novecentos caracteres divergem à primeira vez que alguém acertar num traço.

  A grelha é de 24 e não de 32 de propósito: 24 para 16 é dois terços e 24 para
  32 é quatro terços, e nas duas as tarjas caem em fronteira de pixel. Com um
  factor de escala qualquer por cima, não caem, e o favicon fica um borrão.

  O NOME TRAZ A IMPRESSÃO DO DESENHO, e não é arrumação. O Chrome guarda os
  favicons numa base de dados própria, indexada pelo URL do ícone, e revisita-a
  ao fim de dias — o `no-cache` do Caddyfile manda no HTML e não lhe diz nada.
  Um desenho novo debaixo do mesmo nome fica invisível durante uma semana, que
  foi o que aconteceu à marca de 13 de Agosto. Com a impressão no nome, desenho
  novo é URL novo, e um URL novo não tem cópia velha para o browser preferir.

  NÃO EDITAR À MÃO: sai de `marca/gerar-marca.py`, que desenha o mesmo O para
  aqui, para o ícone da aplicação e para o `OrwellMark` da interface.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{lado}" height="{lado}">
  <rect width="24" height="24" rx="5.5" fill="{FUNDO}" />
  <g fill="{ACENTO}">
{corpo}
  </g>
</svg>
"""


def icone_svg(variante=CHEIA, lado: int = 1024) -> str:
    """O ícone da aplicação de secretária.

    O `lado` entra no `width`/`height` e não só no viewBox: o Chrome rasteriza
    um SVG ao tamanho INTRÍNSECO que ele declara, e uma janela mais pequena
    recorta-lhe o canto em vez de o encolher. Foi assim que os ícones de 16 e 32
    saíram como um pedaço do canto superior esquerdo do ícone de 1024."""
    corpo = "\n".join(f'    <path d="{d}" />' for d in formas(variante))
    return f"""<!--
  O ícone da aplicação: a marca sobre o fundo profundo da própria aplicação.

  As tarjas são as do `OrwellMark` (`packages/ui/src/icons.tsx`), geradas e não
  reimaginadas: o ícone no dock tem de ser a mesma coisa que o canto superior
  esquerdo da janela. O O é um O REDIGIDO — o texto tapado a marcador, virado do
  avesso: aqui a tarja protege quem escreve.

  Fundo com canto arredondado porque o macOS não o arredonda por nós no `.icns`,
  e um quadrado perfeito no dock lê-se como aplicação por acabar.

  Este é o desenho grande. Os 16 e os 32 do `.icns` e do `.ico` não saem daqui
  por redução — saem da variante compacta, rasterizados à medida. Encolher sete
  tarjas para 32 píxeis devolve um borrão, e é a 32 que este ícone aparece na
  lista de aplicações.

  NÃO EDITAR À MÃO: sai de `marca/gerar-marca.py`.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="{lado}" height="{lado}">
  <rect width="1024" height="1024" rx="228" fill="{FUNDO}" />
  <rect x="24" y="24" width="976" height="976" rx="206" fill="none" stroke="{ACENTO_DEEP}" stroke-width="8" />
  <g transform="translate(512 512) scale(33.5) translate(-12 -12)" fill="{ACENTO}">
{corpo}
  </g>
</svg>
"""


def bandeja_png(lado: int, cor: str) -> bytes:
    """Ícone da barra do sistema: só a marca, sem fundo, à medida exacta."""
    corpo = "\n".join(f'    <path d="{d}" />' for d in formas(COMPACTA))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
           f'width="{lado}" height="{lado}">\n'
           f'  <g fill="{cor}">\n{corpo}\n  </g>\n</svg>\n')
    return rasterizar(svg, lado, lado)


def rasterizar(svg: str, largura: int, altura: int) -> bytes:
    """SVG → PNG com fundo transparente, pelo Chrome que já cá está."""
    with tempfile.TemporaryDirectory() as tmp:
        origem = Path(tmp) / "a.svg"
        destino = Path(tmp) / "a.png"
        origem.write_text(svg, encoding="utf-8")
        subprocess.run(
            [CHROME, "--headless", "--disable-gpu", f"--screenshot={destino}",
             f"--window-size={largura},{altura}", "--hide-scrollbars",
             "--default-background-color=00000000", f"file://{origem}"],
            check=True, capture_output=True,
        )
        return destino.read_bytes()


def icone_png(lado: int) -> bytes:
    """O ícone da aplicação a um tamanho concreto, rasterizado à medida e nunca
    reduzido de outro maior.

    Abaixo do limiar não é só a variante que muda: é a composição inteira. O
    ícone grande tem margem larga e um fio de contorno, e a 16 píxeis isso deixa
    onze píxeis úteis para cinco tarjas e quatro vãos — ilegível. Nesses
    tamanhos o ícone da aplicação É o favicon, que já está afinado ao pixel."""
    if lado < LIMIAR_COMPACTA:
        return rasterizar(marca_svg(lado), lado, lado)
    return rasterizar(icone_svg(CHEIA, lado), lado, lado)


def _ico(imagens: dict[int, bytes]) -> bytes:
    """ICO escrito à mão, com um PNG por tamanho.

    O Pillow sabe gravar ICO, mas só reduzindo uma imagem — e aqui os tamanhos
    pequenos são um desenho diferente, não uma redução do grande."""
    lados = sorted(imagens)
    cabecalho = b"\x00\x00\x01\x00" + len(lados).to_bytes(2, "little")
    entradas, corpo = b"", b""
    deslocamento = len(cabecalho) + 16 * len(lados)
    for lado in lados:
        png = imagens[lado]
        entradas += bytes([lado if lado < 256 else 0, lado if lado < 256 else 0, 0, 0])
        entradas += (1).to_bytes(2, "little") + (32).to_bytes(2, "little")
        entradas += len(png).to_bytes(4, "little") + deslocamento.to_bytes(4, "little")
        corpo += png
        deslocamento += len(png)
    return cabecalho + entradas + corpo


def escrever_icones_app(recursos: Path) -> None:
    """`icon.png` (1024), `icon.icns` (macOS) e `icon.ico` (Windows)."""
    (recursos / "icon.png").write_bytes(icone_png(1024))

    # .icns via iconutil, the only format Apple approves.
    with tempfile.TemporaryDirectory() as tmp:
        conjunto = Path(tmp) / "icon.iconset"
        conjunto.mkdir()
        for lado in (16, 32, 128, 256, 512):
            (conjunto / f"icon_{lado}x{lado}.png").write_bytes(icone_png(lado))
            (conjunto / f"icon_{lado}x{lado}@2x.png").write_bytes(icone_png(lado * 2))
        subprocess.run(["iconutil", "-c", "icns", str(conjunto),
                        "-o", str(recursos / "icon.icns")], check=True)

    (recursos / "icon.ico").write_bytes(
        _ico({lado: icone_png(lado) for lado in (16, 24, 32, 48, 64, 128, 256)}))


def escrever_bandeja(caminho: Path) -> None:
    """Reescreve os quatro data-URI de `apps/client/src/main/icone.ts`.

    Os que lá estavam eram de um desenho anterior ao próprio olho — um anel com
    pupila, ou seja, um olho ABERTO na barra de uma aplicação de privacidade."""
    texto = caminho.read_text(encoding="utf-8")
    valores = {
        "ICONE_ESCURO_16": bandeja_png(16, "#000000"),
        "ICONE_ESCURO_32": bandeja_png(32, "#000000"),
        "ICONE_CLARO_16": bandeja_png(16, "#ffffff"),
        "ICONE_CLARO_32": bandeja_png(32, "#ffffff"),
    }
    for nome, png in valores.items():
        b64 = base64.b64encode(png).decode("ascii")
        marca_inicio = f"export const {nome} =\n"
        i = texto.index(marca_inicio) + len(marca_inicio)
        j = texto.index("\n", i)
        texto = texto[:i] + f'  "{b64}"' + texto[j:]
    texto = texto.replace(
        " * Gerados por `scripts` fora da árvore (anel com pupila, 16 e 32 px, RGBA).",
        " * Gerados por `marca/gerar-marca.py` (o O redigido, 16 e 32 px, RGBA).")
    caminho.write_text(texto, encoding="utf-8")


def modulo_ts() -> str:
    """`packages/ui/src/marca.gen.ts` — as tarjas para a interface.

    Um módulo gerado e não paths colados no `icons.tsx`: colados à mão, a marca
    da janela e a marca do dock divergem à primeira correcção que alguém fizer
    num sítio e esquecer no outro."""
    def bloco(v) -> str:
        return "\n".join(f'  "{d}",' for d in formas(v))
    return f"""/**
 * A marca do Orwell, em tarjas — GERADO, não editar.
 *
 * Sai de `marca/gerar-marca.py`, que desenha o mesmo O para aqui, para os dois
 * favicons (`apps/site/public/marca.svg` e o mesmo em `apps/web`), para o ícone
 * da aplicação de secretária e para os ícones da barra do sistema. Correr o
 * gerador depois de mexer na geometria; a alternativa é a janela e o dock
 * deixarem de combinar.
 *
 * (Sem `glob` no caminho: um asterisco seguido de barra fecha este comentário
 * a meio, e o módulo inteiro deixa de compilar.)
 *
 * Coordenadas na grelha de 24, que é a de todos os ícones.
 */

/** Cinco tarjas: a variante para tamanho pequeno, onde os vãos são píxeis. */
export const MARCA_COMPACTA: readonly string[] = [
{bloco(COMPACTA)}
]

/** Sete tarjas: a variante para quando há resolução para o bloco de texto. */
export const MARCA_CHEIA: readonly string[] = [
{bloco(CHEIA)}
]

/**
 * A partir de quantos píxeis vale a pena a variante cheia.
 *
 * Abaixo disto os seis vãos não têm píxeis onde caber e o que se vê é um
 * rectângulo cinzento — medido no pixel real: a 32 borra, a 48 está limpa.
 */
export const LIMIAR_MARCA_CHEIA = {LIMIAR_COMPACTA}
"""


def escrever_symbol_do_site(pagina: Path) -> None:
    """Substitui o `<symbol id="i-marca">` das páginas estáticas.

    A página não corre React e por isso não pode importar o `marca.gen.ts`; o
    que a impede de divergir é sair daqui, e não de alguém se lembrar. Usa a
    variante compacta: `.marca-desenho` tem 26 px."""
    texto = pagina.read_text(encoding="utf-8")
    abre = '<symbol id="i-marca" viewBox="0 0 24 24">'
    i = texto.index(abre) + len(abre)
    j = texto.index("</symbol>", i)
    recuo = " " * 10
    corpo = "\n".join(f'{recuo}<path d="{d}" />' for d in formas(COMPACTA))
    pagina.write_text(texto[:i] + "\n" + corpo + "\n" + " " * 8 + texto[j:],
                      encoding="utf-8")


# --- the favicon, with the drawing baked into the name -------------------------
#
# A favicon with a fixed name is a mark that changes in the repository but not
# on anyone's screen. Chrome does not cache favicons in HTTP cache: it stores
# them in its own database, indexed by the icon URL, and only revisits it after
# days, the `Cache-Control: no-cache` in the Caddyfile, which controls the HTML, tells it
# nothing. This is how the O redigido entered the repository on 13 August and
# the closed eye stayed in the tabs of everyone who had been there.
#
# The fix is not to ask anyone to clear the cache: the URL must depend on the
# drawing. `marca.<impressão>.svg`, if the drawing changes, the URL changes, and a new URL
# has no old copy for the browser to prefer. It is the same discipline that
# Vite already applies to bundle assets, applied to the file that was outside
# it by living in `public/`.

PAGINAS_DO_SITE = ("index.html", "negocio.html", "donativos.html",
                   "privacidade.html", "termos.html", "embaixadores.html")

# Every place that writes the favicon `href`. Missing a file from this list means
# a page requesting an icon that no longer exists, a 404 and a tab with no brand,
# which is worse than a stale brand.
REFERENCIAS_AO_FAVICON = (
    *(f"apps/site/{nome}" for nome in PAGINAS_DO_SITE),
    "apps/web/index.html",
    # The downloads page, written by this script from a template.
    "scripts/publicar-instaladores.mjs",
)

# `marca.svg` (the old name, no hash) or `marca.<hex>.svg`.
HREF_DO_FAVICON = re.compile(r'(href="\.?/)marca(?:\.[0-9a-f]+)?\.svg(")')


def nome_do_favicon(svg: str) -> str:
    """`marca.<impressão>.svg` — oito hexadecimais do SHA-256 do desenho.

    Oito e não trinta e dois: isto não defende de ninguém, só tem de mudar
    quando o desenho muda. Colisão a oito é de mil milhões, e uma colisão aqui
    devolveria exactamente o desenho que já lá estava."""
    return f"marca.{hashlib.sha256(svg.encode('utf-8')).hexdigest()[:8]}.svg"


def escrever_favicons() -> str:
    """Escreve o favicon nas duas pastas públicas e reescreve quem lhe aponta.

    Devolve o nome do ficheiro. Limpa os anteriores: sem isso, cada mudança de
    desenho deixava mais um SVG órfão em `public/`, que o Vite copia para o
    `dist` e o servidor serve para sempre."""
    svg = marca_svg()
    nome = nome_do_favicon(svg)
    for pasta in (REPO / "apps/site/public", REPO / "apps/web/public"):
        for velho in pasta.glob("marca*.svg"):
            if velho.name != nome:
                velho.unlink()
        (pasta / nome).write_text(svg, encoding="utf-8")
        print(f"· {pasta.relative_to(REPO)}/{nome}")

    for caminho in REFERENCIAS_AO_FAVICON:
        ficheiro = REPO / caminho
        antes = ficheiro.read_text(encoding="utf-8")
        depois, quantos = HREF_DO_FAVICON.subn(rf"\g<1>{nome}\g<2>", antes)
        if quantos == 0:
            raise SystemExit(f"{caminho}: nenhum href de favicon para reescrever. "
                             "Ou o ficheiro deixou de o ter, ou o padrão mudou — "
                             "e um favicon por reescrever é um 404.")
        if depois != antes:
            ficheiro.write_text(depois, encoding="utf-8")
        print(f"· {caminho} — href do favicon ({quantos})")
    return nome


# --- the PWA icons ---------------------------------------------------------
#
# The web app installs on the phone (`apps/web/public/manifest.webmanifest`)
# and the icon that stays on the home screen is the brand: it comes from here,
# like the others.
#
# Four files, and two designs:
#
#   · 192 and 512, `purpose: any`: the desktop app icon as is, with rounded
#     corners and stroke. The platform does not alter it.
#   · 512 `maskable` and the 180 `apple-touch-icon`: the full design. Android
#     crops the icon to whatever shape the launcher wants (circle, teardrop,
#     rounded square) and iOS rounds the corners on its own; on both, a corner
#     already rounded and transparent looks like an icon inside another icon, and
#     on iOS transparency turns BLACK. So the background goes corner to corner,
#     no `rx` and no stroke, and the only difference between the two is the size
#     of the brand.
#
# The safe zone for maskable is the central circle at 80% of the side (radius 40%):
# the launcher can crop outside it. The brand must fit entirely inside, including
# the sliding banner, and the check is done in `_raio_da_marca()` not by eye:
# `escrever_icones_pwa()` refuses to write if it does not fit.

ESCALA_ICONE = 33.5        # for the app icon: iOS only rounds the corners
ESCALA_MASKABLE = 27.0     # smaller: the entire brand inside the safe zone
RAIO_SEGURO = 0.40 * 1024  # the 80% circle that no launcher cuts

PUBLICO_DA_WEB = "apps/web/public"

# Who writes the names of these files, and which ones. Like the favicon: one
# fewer entry in this list means a requested icon that no longer exists. iOS
# does not read icons from the manifest, and the manifest has nowhere to put
# `apple-touch-icon`, so each file points only to itself.
REFERENCIAS_AOS_ICONES_PWA = {
    "apps/web/public/manifest.webmanifest": ("icone-192", "icone-512", "icone-maskable-512"),
    "apps/web/index.html": ("apple-touch-icon",),
}


def _raio_da_marca() -> float:
    """A distância do centro ao ponto mais afastado da marca, na grelha de 24.

    Varre o contorno da superelipse exterior e soma-lhe o que a tarja solta
    desliza: é um majorante, e é o que se quer de uma margem de segurança."""
    maior = 0.0
    passos = 400
    for i in range(passos + 1):
        y = -B_EXT + 2 * B_EXT * i / passos
        x = _meia(A_EXT, B_EXT, y) + DESLOCA
        maior = max(maior, (x * x + y * y) ** 0.5)
    return maior


def icone_pleno_svg(escala: float, lado: int) -> str:
    """A marca sobre o fundo de canto a canto: sem `rx`, sem fio, sem alfa."""
    corpo = "\n".join(f'    <path d="{d}" />' for d in formas(CHEIA))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="{lado}" height="{lado}">\n'
            f'  <rect width="1024" height="1024" fill="{FUNDO}" />\n'
            f'  <g transform="translate(512 512) scale({escala:g}) translate(-12 -12)" '
            f'fill="{ACENTO}">\n{corpo}\n  </g>\n</svg>\n')


def _nome_com_impressao(prefixo: str, png: bytes) -> str:
    """`<prefixo>.<impressão>.png`, pela mesma razão do favicon: o Chrome e o
    iOS guardam o ícone de uma aplicação instalada pelo URL, e um desenho novo
    debaixo do mesmo nome não chega a quem já instalou."""
    return f"{prefixo}.{hashlib.sha256(png).hexdigest()[:8]}.png"


def escrever_icones_pwa() -> dict[str, str]:
    """Os quatro PNG do PWA em `apps/web/public/`, e quem lhes aponta.

    Devolve prefixo → nome do ficheiro. Apaga os anteriores, como o favicon."""
    if _raio_da_marca() * ESCALA_MASKABLE > RAIO_SEGURO:
        raise SystemExit("o ícone maskable não cabe na zona segura: "
                         f"{_raio_da_marca() * ESCALA_MASKABLE:.0f} > {RAIO_SEGURO:.0f}. "
                         "Baixar ESCALA_MASKABLE.")

    pasta = REPO / PUBLICO_DA_WEB
    desenhos = {
        "icone-192": icone_png(192),
        "icone-512": icone_png(512),
        "icone-maskable-512": rasterizar(icone_pleno_svg(ESCALA_MASKABLE, 512), 512, 512),
        "apple-touch-icon": rasterizar(icone_pleno_svg(ESCALA_ICONE, 180), 180, 180),
    }
    nomes: dict[str, str] = {}
    for prefixo, png in desenhos.items():
        nome = _nome_com_impressao(prefixo, png)
        for velho in pasta.glob(f"{prefixo}.*png"):
            if velho.name != nome:
                velho.unlink()
        (pasta / nome).write_bytes(png)
        nomes[prefixo] = nome
        print(f"· {PUBLICO_DA_WEB}/{nome}")

    for caminho, prefixos in REFERENCIAS_AOS_ICONES_PWA.items():
        ficheiro = REPO / caminho
        texto = ficheiro.read_text(encoding="utf-8")
        original = texto
        for prefixo in prefixos:
            nome = nomes[prefixo]
            # The prefix must start the filename: without the lookbehind, `icone-512` would
            # also match the end of `icone-maskable-512`.
            padrao = re.compile(rf'(?<![\w-]){re.escape(prefixo)}(?:\.[0-9a-f]+)?\.png')
            texto, quantos = padrao.subn(nome, texto)
            if quantos == 0:
                raise SystemExit(f"{caminho}: nenhuma referência a {prefixo} para "
                                 "reescrever. Um ícone por reescrever é um 404.")
        if texto != original:
            ficheiro.write_text(texto, encoding="utf-8")
        print(f"· {caminho}: ícones do PWA")
    return nomes


def main() -> None:
    (REPO / "packages/ui/src/marca.gen.ts").write_text(modulo_ts(), encoding="utf-8")
    print("· packages/ui/src/marca.gen.ts")
    escrever_favicons()
    escrever_icones_pwa()

    recursos = REPO / "apps/client/recursos"
    (recursos / "icone.svg").write_text(icone_svg(), encoding="utf-8")
    escrever_icones_app(recursos)
    print("· apps/client/recursos/{icone.svg,icon.png,icon.icns,icon.ico}")

    escrever_bandeja(REPO / "apps/client/src/main/icone.ts")
    print("· apps/client/src/main/icone.ts")

    for nome in PAGINAS_DO_SITE:
        escrever_symbol_do_site(REPO / "apps/site" / nome)
    print("· apps/site/{index,negocio,donativos,privacidade,termos,embaixadores}.html — symbol i-marca")

    print("\nFeito. O `OrwellMark` lê as tarjas de `marca.gen.ts`.")


if __name__ == "__main__":
    # `--favicon` generates only the favicon and what points to it.
    #
    # The rest of the generator rasterizes with Chrome, and two different Chrome
    # versions return byte-for-byte different PNGs for the same drawing: running
    # everything to rename a file would dirty the app icons with a difference that
    # is not a real change. Anyone who touches GEOMETRY runs the full generator,
    # which is the only thing that regenerates `.icns`, `.ico`, and the system tray.
    #
    # `--pwa` follows the same logic for PWA icons: generates only those four and
    # leaves the desktop app icons alone. Their render is the PNG, so a different
    # Chrome gives them a new name without the drawing changing: it is harmless
    # (new URL, same drawing), but do not run it without reason.
    if "--favicon" in sys.argv:
        escrever_favicons()
    elif "--pwa" in sys.argv:
        escrever_icones_pwa()
    else:
        main()
