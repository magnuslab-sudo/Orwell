"""Nome no portão. Letras, vazio, dígitos, marcação e o tecto que o perfil tem e o portão não."""

from selenium.webdriver.common.by import By

from dados import NOME_MAX_NO_PERFIL, PERGUNTA_FOTO, PERGUNTA_NOME
from evidencias import recorte
from paginas.portao import Portao


def test_nome_com_letras_avanca_para_a_fotografia(navegador):
    portao = Portao(navegador)
    portao.abrir()
    assert portao.pergunta() == PERGUNTA_NOME
    portao.escrever_nome("Ana Silva")
    recorte(portao.campo_nome(), "recorte-campo-nome", portfolio_media=True)
    assert portao.botao_avancar().is_enabled()
    portao.avancar()
    portao.esperar_pergunta(PERGUNTA_FOTO)
    inicial = navegador.find_element(By.CSS_SELECTOR, ".setup-foto .avatar-preview span").text
    assert inicial == "A"


def test_nome_vazio_ou_so_espacos_nao_avanca(navegador):
    portao = Portao(navegador)
    portao.abrir()
    assert portao.botao_avancar().is_enabled() is False
    portao.escrever_nome("   ")
    assert portao.campo_nome().get_attribute("value") == "   "
    assert portao.botao_avancar().is_enabled() is False
    assert portao.pergunta() == PERGUNTA_NOME


def test_digitos_no_campo_de_nome_sao_aceites(navegador):
    portao = Portao(navegador)
    portao.abrir()
    portao.escrever_nome("123456")
    assert portao.botao_avancar().is_enabled()
    portao.avancar()
    portao.esperar_pergunta(PERGUNTA_FOTO)
    inicial = navegador.find_element(By.CSS_SELECTOR, ".setup-foto .avatar-preview span").text
    assert inicial == "1"


def test_acentos_emoji_e_marcacao_nao_sao_executados(navegador):
    portao = Portao(navegador)
    portao.abrir()
    valor = "Ção 🧪 <img src=x onerror=alert(1)>"
    portao.escrever_nome(valor)
    portao.sem_alerta()
    assert portao.campo_nome().get_attribute("value") == valor
    portao.avancar()
    portao.esperar_pergunta(PERGUNTA_FOTO)
    portao.sem_alerta()
    injectados = navegador.execute_script('return document.querySelectorAll(\'img[src="x"]\').length')
    assert injectados == 0
    inicial = navegador.find_element(By.CSS_SELECTOR, ".setup-foto .avatar-preview span").text
    assert inicial == "Ç"


def test_nome_mais_longo_que_o_perfil_ainda_avanca(navegador):
    """Lacuna: ProfileEditor corta a 32. O campo do portão não tem maxLength."""
    portao = Portao(navegador)
    portao.abrir()
    campo = portao.campo_nome()
    assert campo.get_attribute("maxlength") in (None, "")
    valor = "N" * (NOME_MAX_NO_PERFIL + 8)
    portao.escrever_nome(valor)
    assert portao.campo_nome().get_attribute("value") == valor
    assert len(valor) > NOME_MAX_NO_PERFIL
    assert portao.botao_avancar().is_enabled()
    portao.avancar()
    portao.esperar_pergunta(PERGUNTA_FOTO)
