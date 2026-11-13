"""Site público. Cinco casos: página, língua, privacidade, caminho inexistente, marcação no URL."""

from selenium.common.exceptions import NoAlertPresentException
from selenium.webdriver.common.by import By

from dados import HEROI_EN, HEROI_PT, TITULO_EN, TITULO_PT
from evidencias import recorte
from paginas.site import Site


def test_homepage_mostra_heroi_e_entrada(navegador):
    site = Site(navegador)
    site.abrir("/")
    assert HEROI_EN in site.titulo_visivel()
    assert TITULO_EN in navegador.title
    entrada = navegador.find_element(By.CSS_SELECTOR, "a.topo-entrar")
    assert entrada.text == "Sign in"
    assert "/app/" in entrada.get_attribute("href")
    recorte(site.heroi(), "recorte-heroi", portfolio_media=True)


def test_link_pt_abre_a_homepage_em_portugues(navegador):
    site = Site(navegador)
    site.abrir("/")
    site.clicar("a[hreflang='pt']")
    assert HEROI_PT in site.titulo_visivel()
    assert TITULO_PT in navegador.title
    assert navegador.find_element(By.TAG_NAME, "html").get_attribute("lang") == "pt-PT"
    assert navegador.current_url.rstrip("/").endswith("/pt")


def test_privacidade_abre_pelo_rodape(navegador):
    site = Site(navegador)
    site.abrir("/")
    site.clicar("footer a[href='/privacy.html']")
    assert site.titulo_visivel() == "Privacy"
    assert navegador.current_url.endswith("/privacy.html")


def test_caminho_desconhecido_nao_e_a_homepage(navegador):
    site = Site(navegador)
    site.abrir("/esta-pagina-nao-existe-qa")
    assert HEROI_EN not in navegador.page_source
    assert TITULO_EN not in navegador.title


def test_marcacao_no_endereco_nao_e_executada(navegador):
    site = Site(navegador)
    site.abrir("/?q=%3Cscript%3Ealert(1)%3C/script%3E")
    assert HEROI_EN in site.titulo_visivel()
    try:
        navegador.switch_to.alert
    except NoAlertPresentException:
        pass
    else:
        raise AssertionError("o URL com script abriu um alerta")
    injectados = navegador.execute_script("return document.querySelectorAll('img[src=\"x\"]').length")
    assert injectados == 0
