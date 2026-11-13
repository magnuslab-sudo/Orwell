"""Portão de criação de conta. Pára antes de 'Create account'.

Os seletores seguem o texto do catálogo inglês e os `name` dos campos
em packages/ui/src/screens/gate/Setup.tsx. Não há ids estáveis.
"""

from __future__ import annotations

from selenium.common.exceptions import NoAlertPresentException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from dados import (
    CRIAR_CONTA,
    PASSE_CURTA,
    PASSE_DIFERENTE,
    PERGUNTA_CONFIRMA,
    PERGUNTA_FOTO,
    PERGUNTA_NOME,
    PERGUNTA_OUTRO,
    PERGUNTA_PASSE,
    url_da_app,
)


class Portao:
    def __init__(self, driver: WebDriver) -> None:
        self.driver = driver
        self.espera = WebDriverWait(driver, 45)

    def abrir(self) -> None:
        self.driver.get(url_da_app())
        self.espera.until(
            EC.any_of(
                EC.text_to_be_present_in_element((By.TAG_NAME, "h1"), PERGUNTA_OUTRO),
                EC.text_to_be_present_in_element((By.TAG_NAME, "h1"), PERGUNTA_NOME),
            )
        )
        if PERGUNTA_OUTRO in self.pergunta():
            self.botao_com_texto(CRIAR_CONTA).click()
            self.esperar_pergunta(PERGUNTA_NOME)

    def pergunta(self) -> str:
        return self.driver.find_element(By.TAG_NAME, "h1").text

    def esperar_pergunta(self, texto: str) -> None:
        self.espera.until(EC.text_to_be_present_in_element((By.TAG_NAME, "h1"), texto))

    def campo_nome(self) -> WebElement:
        return self.espera.until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "form.setup-form input:not([type])"))
        )

    def escrever_nome(self, valor: str) -> None:
        self._escrever(self.campo_nome(), valor)

    def botao_avancar(self) -> WebElement:
        return self.driver.find_element(By.CSS_SELECTOR, "form.setup-form button[type='submit']")

    def avancar(self) -> None:
        self.botao_avancar().click()

    def botao_com_texto(self, texto: str) -> WebElement:
        return self.espera.until(
            EC.element_to_be_clickable((By.XPATH, f"//button[normalize-space()='{texto}']"))
        )

    def ate_a_palavra_passe(self, nome: str = "Ana Silva") -> None:
        self.abrir()
        self.escrever_nome(nome)
        self.avancar()
        self.esperar_pergunta(PERGUNTA_FOTO)
        self.avancar()
        self.esperar_pergunta(PERGUNTA_PASSE)

    def campo_passe(self) -> WebElement:
        return self.driver.find_element(By.CSS_SELECTOR, "input[name='new-password']")

    def campo_confirma(self) -> WebElement:
        return self.driver.find_element(By.CSS_SELECTOR, "input[name='confirm-password']")

    def escrever_passe(self, valor: str) -> None:
        self._escrever(self.campo_passe(), valor)

    def escrever_confirma(self, valor: str) -> None:
        self.esperar_pergunta(PERGUNTA_CONFIRMA)
        self._escrever(self.campo_confirma(), valor)

    def _escrever(self, campo: WebElement, valor: str) -> None:
        """O setter nativo mais o evento `input`, para o React ver o valor.

        `send_keys` falha em emoji fora do BMP e, num input controlado, o
        `clear()` às vezes não chega ao estado.
        """
        self.driver.execute_script(
            """
            const campo = arguments[0];
            const valor = arguments[1];
            const definir = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            definir.call(campo, valor);
            campo.dispatchEvent(new Event('input', { bubbles: true }));
            """,
            campo,
            valor,
        )

    def erro(self) -> str:
        elemento = self.espera.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "form.setup-form p.error")))
        return elemento.text

    def sem_alerta(self) -> None:
        try:
            alerta = self.driver.switch_to.alert
        except NoAlertPresentException:
            return
        texto = alerta.text
        alerta.dismiss()
        raise AssertionError(f"a página abriu um alerta: {texto}")

    def texto_de_erro_conhecido(self) -> str:
        texto = self.erro()
        if texto not in {PASSE_CURTA, PASSE_DIFERENTE}:
            raise AssertionError(f"erro inesperado: {texto}")
        return texto
