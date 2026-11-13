"""Palavra-passe. Nenhum caso chega a criar a conta."""

from selenium.webdriver.common.by import By

from dados import A_CRIAR, BOTAO_CRIAR, PASSE_CURTA, PASSE_DIFERENTE, PERGUNTA_CONFIRMA, PERGUNTA_PASSE
from evidencias import recorte
from paginas.portao import Portao

PASSE_VALIDA = "Valido!1"
PASSE_SO_NUMEROS = "12345678"


def test_menos_de_oito_caracteres_fica_no_passo(navegador):
    portao = Portao(navegador)
    portao.ate_a_palavra_passe()
    portao.escrever_passe("abcdefg")
    portao.avancar()
    assert portao.pergunta() == PERGUNTA_PASSE
    assert portao.erro() == PASSE_CURTA
    recorte(navegador.find_element(By.CSS_SELECTOR, "form.setup-form p.error"), "recorte-passe-curta", portfolio_media=True)


def test_oito_caracteres_com_simbolo_avancam_para_a_confirmacao(navegador):
    portao = Portao(navegador)
    portao.ate_a_palavra_passe()
    assert len(PASSE_VALIDA) == 8
    portao.escrever_passe(PASSE_VALIDA)
    portao.avancar()
    portao.esperar_pergunta(PERGUNTA_CONFIRMA)
    assert portao.pergunta() != A_CRIAR


def test_so_digitos_com_oito_caracteres_passam_a_regra(navegador):
    portao = Portao(navegador)
    portao.ate_a_palavra_passe()
    portao.escrever_passe(PASSE_SO_NUMEROS)
    portao.avancar()
    portao.esperar_pergunta(PERGUNTA_CONFIRMA)
    assert navegador.find_element(By.CSS_SELECTOR, "form.setup-form button[type='submit']").text == BOTAO_CRIAR


def test_confirmacao_diferente_nao_cria_a_conta(navegador):
    portao = Portao(navegador)
    portao.ate_a_palavra_passe()
    portao.escrever_passe(PASSE_VALIDA)
    portao.avancar()
    portao.escrever_confirma("Valido!2")
    portao.avancar()
    assert portao.erro() == PASSE_DIFERENTE
    assert portao.pergunta() == PERGUNTA_CONFIRMA
    assert portao.pergunta() != A_CRIAR


def test_mostrar_revela_e_voltar_a_ocultar(navegador):
    portao = Portao(navegador)
    portao.ate_a_palavra_passe()
    portao.escrever_passe(PASSE_VALIDA)
    campo = portao.campo_passe()
    assert campo.get_attribute("type") == "password"
    navegador.find_element(By.CSS_SELECTOR, "button.reveal-toggle").click()
    assert portao.campo_passe().get_attribute("type") == "text"
    assert portao.campo_passe().get_attribute("value") == PASSE_VALIDA
    navegador.find_element(By.CSS_SELECTOR, "button.reveal-toggle").click()
    assert portao.campo_passe().get_attribute("type") == "password"
