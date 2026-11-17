"""Achados da leva 1. O caso continua verde e o defeito fica visível.

São os mesmos testes de `testes/`. Aqui só se corre o subconjunto que, ao
passar, mostra um problema do produto. `python -m pytest` sem caminho não
entra nesta pasta: o `testpaths` é `testes`.
"""

from testes.test_nome import test_nome_mais_longo_que_o_perfil_ainda_avanca
from testes.test_palavra_passe import test_so_digitos_com_oito_caracteres_passam_a_regra

__all__ = [
    "test_nome_mais_longo_que_o_perfil_ainda_avanca",
    "test_so_digitos_com_oito_caracteres_passam_a_regra",
]
