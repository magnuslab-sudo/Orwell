"""Chrome novo por teste, para o cofre da app não passar de um caso ao outro."""

from __future__ import annotations

import os

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from evidencias import ecra


def criar_navegador() -> webdriver.Chrome:
    opcoes = Options()
    if os.getenv("ORWELL_HEADED") != "1":
        opcoes.add_argument("--headless=new")
    opcoes.add_argument("--window-size=1280,900")
    opcoes.add_argument("--lang=en-US")
    opcoes.add_argument("--disable-gpu")
    opcoes.add_argument("--disable-search-engine-choice-screen")
    opcoes.add_experimental_option(
        "prefs",
        {
            "credentials_enable_service": False,
            "profile.password_manager_enabled": False,
            "profile.default_content_setting_values.notifications": 2,
        },
    )
    navegador = webdriver.Chrome(options=opcoes)
    navegador.set_window_size(1280, 900)
    navegador.set_page_load_timeout(45)
    return navegador


@pytest.fixture
def navegador(request: pytest.FixtureRequest):
    driver = criar_navegador()
    gravador = None
    exposto = driver
    if os.getenv("ORWELL_GIF") == "1":
        from gravador import Gravador

        gravador = Gravador()
        exposto = gravador.embrulhar(driver)
    yield exposto
    try:
        ecra(driver, request.node.name)
        if gravador is not None:
            gravador.guardar(driver, request.node.name)
    finally:
        driver.quit()
