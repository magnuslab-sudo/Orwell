"""Percurso do Chrome em GIF, só quando o teste corre com ORWELL_GIF=1.

O ecrã final continua em artefactos/ecras/. O GIF fica ao lado, em artefactos/,
e não entra no Git.
"""

from __future__ import annotations

import time
from io import BytesIO

from PIL import Image, ImageChops

from evidencias import PASTA_ARTEFACTOS, nome_seguro


def _fotograma(driver) -> Image.Image:
    imagem = Image.open(BytesIO(driver.get_screenshot_as_png())).convert("RGB")
    largura = 960
    altura = round(imagem.height * (largura / imagem.width))
    return imagem.resize((largura, altura), Image.Resampling.LANCZOS)


def _em_branco(imagem: Image.Image) -> bool:
    amostra = list(imagem.resize((32, 18)).convert("L").tobytes())
    media = sum(amostra) / len(amostra)
    variancia = sum((ponto - media) ** 2 for ponto in amostra) / len(amostra)
    return variancia < 20 and (media > 240 or media < 8)


def _mudou(anterior: Image.Image, nova: Image.Image) -> bool:
    """Uma letra no campo muda poucos pixéis. A média da página esconde isso."""
    diferenca = ImageChops.difference(anterior, nova).convert("L")
    blocos = diferenca.resize((160, 90), Image.Resampling.BOX)
    return max(blocos.tobytes()) > 12


class _Elemento:
    def __init__(self, elemento, gravador: Gravador, driver) -> None:
        self._elemento = elemento
        self._gravador = gravador
        self._driver = driver

    def click(self) -> None:
        self._gravador.capturar(self._driver)
        self._elemento.click()
        time.sleep(0.45)
        self._gravador.capturar(self._driver)

    def __getattr__(self, nome: str):
        return getattr(self._elemento, nome)


def _valor_real(valor):
    if isinstance(valor, _Elemento):
        return valor._elemento
    if isinstance(valor, list):
        return [_valor_real(item) for item in valor]
    if isinstance(valor, dict):
        return {chave: _valor_real(item) for chave, item in valor.items()}
    return valor


class _Navegador:
    def __init__(self, driver, gravador: Gravador) -> None:
        self._driver = driver
        self._gravador = gravador

    def get(self, url: str) -> None:
        self._driver.get(url)
        time.sleep(0.35)
        self._gravador.capturar(self._driver)

    def execute_script(self, script: str, *args):
        resultado = self._driver.execute_script(script, *[_valor_real(arg) for arg in args])
        self._gravador.capturar(self._driver)
        return resultado

    def find_element(self, by: str, value: str) -> _Elemento:
        return _Elemento(self._driver.find_element(by, value), self._gravador, self._driver)

    def find_elements(self, by: str, value: str) -> list[_Elemento]:
        return [
            _Elemento(elemento, self._gravador, self._driver)
            for elemento in self._driver.find_elements(by, value)
        ]

    def __getattr__(self, nome: str):
        return getattr(self._driver, nome)


class Gravador:
    _until_original = None
    _activo: Gravador | None = None

    def __init__(self) -> None:
        self.fotogramas: list[Image.Image] = []
        self._ultimo: Image.Image | None = None
        self._a_capturar = False
        self._avisou = False

    def embrulhar(self, driver) -> _Navegador:
        self._instalar_until()
        Gravador._activo = self
        return _Navegador(driver, self)

    def capturar(self, driver) -> None:
        if self._a_capturar or Gravador._activo is not self:
            return
        self._a_capturar = True
        try:
            real = driver._driver if isinstance(driver, _Navegador) else driver
            imagem = _fotograma(real)
            if _em_branco(imagem):
                return
            if self._ultimo is not None and not _mudou(self._ultimo, imagem):
                return
            self.fotogramas.append(imagem)
            self._ultimo = imagem
        except Exception as erro:
            if not self._avisou:
                print(f"gravador: captura falhou: {erro}")
                self._avisou = True
        finally:
            self._a_capturar = False

    def _real(self, driver):
        return driver._driver if isinstance(driver, _Navegador) else driver

    def _percorrer(self, driver) -> None:
        """A homepage é mais alta que a janela. O portão cabe no ecrã e fica quieto."""
        real = self._real(driver)
        try:
            pontos = real.execute_script(
                """
                const doc = document.scrollingElement || document.documentElement;
                const total = doc.scrollHeight;
                const vista = window.innerHeight;
                if (total <= vista * 1.4) return [];
                const passos = 3;
                const pontos = [];
                for (let i = 1; i <= passos; i++) {
                    pontos.push(Math.round((total - vista) * (i / passos)));
                }
                return pontos;
                """
            )
        except Exception:
            return
        for ponto in pontos or []:
            real.execute_script("window.scrollTo(0, arguments[0])", int(ponto))
            time.sleep(0.4)
            self.capturar(real)
        if pontos:
            real.execute_script("window.scrollTo(0, 0)")
            time.sleep(0.3)
            self.capturar(real)

    def guardar(self, driver, nome: str):
        self._percorrer(driver)
        self.capturar(driver)
        Gravador._activo = None
        if not self.fotogramas:
            print(f"gravador: {nome} ficou sem fotogramas")
            return None
        PASTA_ARTEFACTOS.mkdir(parents=True, exist_ok=True)
        destino = PASTA_ARTEFACTOS / f"{nome_seguro(nome)}.gif"
        duracao = 900
        self.fotogramas[0].save(
            destino,
            save_all=True,
            append_images=self.fotogramas[1:],
            duration=duracao,
            loop=0,
            optimize=True,
        )
        print(f"{destino} ({len(self.fotogramas)} fotogramas)")
        return destino

    @classmethod
    def _instalar_until(cls) -> None:
        if cls._until_original is not None:
            return
        from selenium.webdriver.support.ui import WebDriverWait

        cls._until_original = WebDriverWait.until

        def until(espera, method, message: str = ""):
            resultado = cls._until_original(espera, method, message)
            activo = cls._activo
            if activo is not None:
                time.sleep(0.2)
                activo.capturar(espera._driver)
            return resultado

        WebDriverWait.until = until
