"""A arte do ecrã de arranque (direcção B, «Tarjas»), para `arte-do-arranque.gen.ts`.

Uso, a partir da raiz do repositório:

    python apps/client/scripts/gerar-arte-do-arranque.py <arte-original.png>

A arte original é a geração do Higgsfield de 3/11/2026 (`B_tarjas_original.png`,
1360×2048, sem texto). Fica fora do repositório: pesa 3,4 MB e só serve para
voltar a gerar isto. Precisa de Pillow (com WebP) e de fontTools com brotli.

O que sai, tudo em `data:` URI, porque a página do arranque não fala com a rede:
  - a arte, em WebP a 2x (640×560), já fundida no fundo da casa em baixo;
  - a Space Grotesk, cortada aos caracteres latinos, com o eixo do peso;
  - as tarjas da marca, lidas de `packages/ui/src/marca.gen.ts` (a cheia).

A composição é a da folha que o dono escolheu: o recorte 4:5 do topo, reduzido
a 84 %, com as margens esbatidas, e a metade de baixo fundida em #080c1a.
"""
import base64
import io
import re
import sys
from pathlib import Path

from fontTools import subset
from PIL import Image

RAIZ = Path(__file__).resolve().parents[3]
SAIDA = RAIZ / "apps/client/src/main/arte-do-arranque.gen.ts"
FONTE = RAIZ / "packages/ui/src/fontes/space-grotesk-latin-wght-normal.woff2"
MARCA = RAIZ / "packages/ui/src/marca.gen.ts"

FUNDO = (8, 12, 26)  # #080c1a
X = 2                # Density: the art comes out at 2x for screens at 125-200%.
LARGURA, ALTURA = 320, 400  # a janela
ALTURA_DA_ARTE = 280        # Below this is solid background, and isn't worth the bytes.
ESCALA = 0.84
PENA = 0.24
QUALIDADE = 72


def pena(w: int, h: int, borda: float) -> Image.Image:
    m = Image.new("L", (w, h))
    bx, by = max(1, int(w * borda)), max(1, int(h * borda))
    px = m.load()
    for y in range(h):
        for x in range(w):
            a = min(1, x / bx, (w - 1 - x) / bx, y / by, (h - 1 - y) / by)
            px[x, y] = int(255 * max(0, a))
    return m


def esbater(im: Image.Image, inicio: float, fim: float) -> Image.Image:
    w, h = im.size
    coluna = Image.new("L", (1, h))
    for y in range(h):
        t = y / h
        a = 0 if t <= inicio else 255 if t >= fim else int(255 * ((t - inicio) / (fim - inicio)) ** 1.4)
        coluna.putpixel((0, y), a)
    return Image.composite(Image.new("RGB", (w, h), FUNDO), im, coluna.resize((w, h)))


def arte(original: Path) -> bytes:
    im = Image.open(original).convert("RGB")
    W, H = im.size
    ratio = LARGURA / ALTURA
    w, h = (round(H * ratio), H) if W / H > ratio else (W, round(W / ratio))
    corte = im.crop(((W - w) // 2, 0, (W - w) // 2 + w, h))
    lw, lh = LARGURA * X, ALTURA * X
    pw, ph = round(lw * ESCALA), round(lh * ESCALA)
    peq = corte.resize((pw, ph), Image.LANCZOS)
    base = Image.new("RGB", (lw, lh), FUNDO)
    base.paste(peq, ((lw - pw) // 2, 6 * X), pena(pw, ph, PENA))
    base = esbater(base, 0.50, 0.70).crop((0, 0, lw, ALTURA_DA_ARTE * X))
    saida = io.BytesIO()
    base.save(saida, "WEBP", quality=QUALIDADE, method=6)
    return saida.getvalue()


def fonte() -> bytes:
    opcoes = subset.Options()
    opcoes.flavor = "woff2"
    opcoes.layout_features = ["kern", "liga"]
    opcoes.name_IDs = ["*"]
    f = subset.load_font(str(FONTE), opcoes)
    s = subset.Subsetter(opcoes)
    s.populate(unicodes=list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)))
    s.subset(f)
    saida = io.BytesIO()
    subset.save_font(f, saida, opcoes)
    return saida.getvalue()


def tarjas() -> list[str]:
    texto = MARCA.read_text()
    bloco = texto[texto.index("export const MARCA_CHEIA"):]
    bloco = bloco[bloco.index("= [") + 3:]
    bloco = bloco[: bloco.index("]")]
    return re.findall(r'"([^"]+)"', bloco)


def uri(tipo: str, dados: bytes) -> str:
    return f"data:{tipo};base64,{base64.b64encode(dados).decode()}"


def main() -> None:
    a, f, t = arte(Path(sys.argv[1])), fonte(), tarjas()
    linhas = "\n".join(f'  "{d}",' for d in t)
    SAIDA.write_text(f"""/**
 * A arte do ecrã de arranque — GERADO, não editar.
 *
 * Sai de `apps/client/scripts/gerar-arte-do-arranque.py`. A arte é a direcção
 * B («Tarjas»), escolhida pelo dono a 3/11/2026; a fonte é a Space Grotesk da
 * aplicação (OFL 1.1, `packages/ui/src/fontes/`), cortada aos caracteres
 * latinos; as tarjas são a `MARCA_CHEIA` de `packages/ui/src/marca.gen.ts`.
 *
 * Arte: {len(a)} bytes de WebP. Fonte: {len(f)} bytes de WOFF2.
 */

/** A ilustração, {LARGURA}×{ALTURA_DA_ARTE} a {X}x, já fundida em #080c1a at the bottom. */
export const ARTE_DO_ARRANQUE = "{uri("image/webp", a)}"

/** A Space Grotesk, só latim, com o eixo do peso. */
export const FONTE_DO_ARRANQUE = "{uri("font/woff2", f)}"

/** As tarjas do O redigido, na grelha de 24. */
export const TARJAS_DO_ARRANQUE: readonly string[] = [
{linhas}
]
""")
    print(f"arte {len(a)} B, fonte {len(f)} B, {len(t)} tarjas -> {SAIDA}")


main()
