"""Página pública de orwell.pt. O markup vive em apps/site/."""

from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from dados import SITE


class Site:
    def __init__(self, driver: WebDriver) -> None:
        self.driver = driver
        self.espera = WebDriverWait(driver, 20)

    def abrir(self, caminho: str = "/") -> None:
        if not caminho.startswith("/"):
            caminho = f"/{caminho}"
        self.driver.get(f"{SITE}{caminho}")

    def titulo_visivel(self) -> str:
        self.espera.until(EC.presence_of_element_located((By.TAG_NAME, "h1")))
        return self.driver.find_element(By.TAG_NAME, "h1").text

    def clicar(self, selector: str) -> None:
        elemento = self.espera.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
        elemento.click()

    def heroi(self):
        return self.espera.until(EC.presence_of_element_located((By.CSS_SELECTOR, "figure.heroi-captura img")))
