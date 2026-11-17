# Orwell QA suite

Checks on the public Orwell site at [orwell.pt](https://orwell.pt), plus a local integration layer. Pass 1 watches the screen and the public HTTP routes. Pass 2 starts the real homeserver. No browser case creates an account. The words "Creating your account" fail the case.

The run book is this page. English first. [Portuguese (Portugal)](#português-pt-pt) follows.

## Commands

PowerShell. Browser and HTTP commands run from `qa/`. The integration command runs from the repository root.

First time, from `qa/`. Python 3.10+ and Google Chrome. Selenium Manager fetches ChromeDriver.

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

The default target is orwell.pt. `ORWELL_SITE_URL` and `ORWELL_APP_URL` point elsewhere. `ORWELL_HEADED=1` in `.env` shows the Chrome window. An empty value stays headless.

| Goal | Command |
| --- | --- |
| 15 browser cases | `python -m pytest` |
| One file | `python -m pytest testes/test_site.py` |
| One case | `python -m pytest testes/test_nome.py::test_nome_com_letras_avanca_para_a_fotografia` |
| GIF of one case | `$env:ORWELL_GIF = "1"; python -m pytest testes/test_site.py::test_homepage_mostra_heroi_e_entrada` |
| The two findings | `python -m pytest negativos` |
| Short gate clip | `python scripts/gravar_gif.py` |
| HTTP collection | `npx --yes newman run postman/Orwell_API.postman_collection.json -e postman/Orwell_orwell.pt.postman_environment.json` |
| Integration, from the repo root | `node .\node_modules\vitest\vitest.mjs run --config qa/integration/vitest.config.ts` |

`python -m pytest` with no path reads `pytest.ini` and collects only `testes/`. `negativos/` stays out of that run. Pass the folder when you want the two findings.

Each browser case saves the final screen under `artefactos/ecras/`. With `ORWELL_GIF=1`, the path is `artefactos/<test-name>.gif`. Git ignores `artefactos/`. The clips on this page are the published copies. After a new run, copy the GIF you want to keep over the file in `docs/media/` or `negativos/`.

## Browser clips

Six layout cases, headless, 1280×900, against orwell.pt on 17 November 2026. All six passed, in 3 min 56 s. On a page taller than the window, the recorder scrolls after the checks and returns to the top. The scroll shows the layout. The assertions have already finished.

Record the six again:

```powershell
$env:ORWELL_GIF = "1"
python -m pytest `
  testes/test_site.py::test_homepage_mostra_heroi_e_entrada `
  testes/test_site.py::test_link_pt_abre_a_homepage_em_portugues `
  testes/test_site.py::test_privacidade_abre_pelo_rodape `
  testes/test_nome.py::test_nome_com_letras_avanca_para_a_fotografia `
  testes/test_palavra_passe.py::test_menos_de_oito_caracteres_fica_no_passo `
  testes/test_palavra_passe.py::test_mostrar_revela_e_voltar_a_ocultar
```

`test_homepage_mostra_heroi_e_entrada` opens `/`. The visible title contains "Play, talk". The link "Sign in" points at `/app/`.

![Homepage: hero and Sign in, down the page, back to the top](docs/media/test_homepage_mostra_heroi_e_entrada.gif)

`test_link_pt_abre_a_homepage_em_portugues` follows `a[hreflang='pt']`. The title becomes "Joga, fala", the document is `lang="pt-PT"`, and the URL ends in `/pt`.

![From the English homepage to the Portuguese one](docs/media/test_link_pt_abre_a_homepage_em_portugues.gif)

`test_privacidade_abre_pelo_rodape` uses the footer link. The visible title is "Privacy" and the URL ends in `/privacy.html`.

![From the homepage to Privacy, through the footer](docs/media/test_privacidade_abre_pelo_rodape.gif)

`test_nome_com_letras_avanca_para_a_fotografia` chooses "No, create an account", types "Ana Silva", and moves on. The next step is the photo, and the initial is "A". The app follows the browser language, so these cases pin `?lingua=en`.

![From the other device to the photo, with the initial A](docs/media/test_nome_com_letras_avanca_para_a_fotografia.gif)

`test_menos_de_oito_caracteres_fica_no_passo` types `abcdefg`. The question stays "What is the password going to be?" and the error is "Type at least 8 characters."

![Seven characters stay on the step, with the error visible](docs/media/test_menos_de_oito_caracteres_fica_no_passo.gif)

`test_mostrar_revela_e_voltar_a_ocultar` types `Valido!1`. The field starts as `type="password"`. Show turns it into text. Hide turns it back.

![Show reveals Valido!1 and Hide covers it again](docs/media/test_mostrar_revela_e_voltar_a_ocultar.gif)

Two more site cases have no clip. The screen barely changes, and the check is that something does not happen.

| Case | What it locks |
| --- | --- |
| `test_caminho_desconhecido_nao_e_a_homepage` | `/esta-pagina-nao-existe-qa` is not the homepage. The observed response was a 404 with an empty body. |
| `test_marcacao_no_endereco_nao_e_executada` | A script in the query keeps the hero, opens no alert, and injects no image. |

The older gate clip, from the other device up to the password and without the error, is `docs/media/portao-nome.gif`. Regenerate it with `python scripts/gravar_gif.py`.

## Findings

Two cases pass and leave a problem on the screen. This suite has no red test and no demonstrated exploit. The other hostile cases pass because the control holds. Detail is in [`negativos/README.md`](negativos/README.md).

Run both, with a GIF of each:

```powershell
$env:ORWELL_GIF = "1"
python -m pytest negativos
```

That run, on 17 November 2026, passed in 41 s. No account was created. The published GIFs in `negativos/` are the copy to keep. The recorder still writes the new file under `artefactos/`.

### The gate does not cap the name

`test_nome_mais_longo_que_o_perfil_ainda_avanca`

The profile editor cuts a name at 32 (`NAME_MAX` in `packages/ui/src/screens/profile/ProfileEditor.tsx`). The gate field has no `maxLength`. Forty letters go in, Continue enables, and the photo step opens. The case stays green because it describes the product as it is. Closing the gap means changing the oracle: the field then refuses or cuts above 32.

```powershell
python -m pytest testes/test_nome.py::test_nome_mais_longo_que_o_perfil_ainda_avanca
```

![Forty N's in the name, Continue enabled, then the photo step](negativos/test_nome_mais_longo_que_o_perfil_ainda_avanca.gif)

### Eight digits are enough

`test_so_digitos_com_oito_caracteres_passam_a_regra`

`12345678` has no letter and no symbol, and it reaches "Confirm the password". The button already says "Create account". The suite stops there. The rule is eight characters. A letter, a digit, or a symbol is not required. This is a weak policy. It is not a broken account.

```powershell
python -m pytest testes/test_palavra_passe.py::test_so_digitos_com_oito_caracteres_passam_a_regra
```

![Eight digits reach confirmation, with Create account on screen](negativos/test_so_digitos_com_oito_caracteres_passam_a_regra.gif)

These hostile cases were reviewed and the control held: a script in the homepage URL, markup in the name, an empty name, a short password, a mismatched confirmation, an unknown path, a malformed federation envelope, a malformed report, an unsigned report, a preview of 127.0.0.1, a server outside the federation allowlist, a wrong vault passphrase, a taken SFU port, and a campaign page that is down. Digits, accents, and emoji in the name also advance. That case is in `testes/test_nome.py` and is not filed as a bug.

## Integration

Vitest, no browser. Each case starts the real homeserver. The vault uses production Argon2id. `integration/vitest.config.ts` does not load the fast derivation used by unit tests. This run is separate from `npm test` and from `pytest`.

From the repository root, Node 22 or newer, after `npx tsc -b`:

```powershell
node .\node_modules\vitest\vitest.mjs run --config qa/integration/vitest.config.ts
```

![One local run of the integration suite, eight tests](docs/media/integracao-vitest.gif)

| Theme | Where | What the run shows |
| --- | --- | --- |
| Link preview | `integration/ligacao.integracao.test.ts` | A page on 127.0.0.1 receives zero connections. Every blocked address comes back with the same reason. |
| Federation | `integration/federacao.integracao.test.ts` | Ciphertext leaves one homeserver, the other reads the key over HTTP, and the peer is stored. A server outside the allowlist gets 403 and leaves no peer. |
| Calls | `integration/sfu.integracao.test.ts` | With the media engine up, `hello.ok` advertises `sfu`. With the port taken, text still works and the hello omits `sfu`. |
| Report | `integration/denuncia.integracao.test.ts` | The same request is 401 before login and 200 after it. Sending those bytes again writes no second file. |
| Campaign bar | `integration/apoio.integracao.test.ts` | The watcher reads the fixture over HTTP and serves `/_enclave/apoiar.json`. With the campaign down, `/_enclave/health` stays ok. |
| Vault | `integration/cofre.integracao.test.ts` | The right passphrase opens the same account. The wrong passphrase leaves the vault locked. |

Eight tests, six files. In the recording, the vault takes most of the half minute. The two log lines in the image belong to the cases: the campaign page that could not be read, and the media port that was already taken.

The product calls `https://` for federation. The test rewrites that call onto the other homeserver on this machine, and only inside the test. Link preview keeps refusing loopback.

## HTTP

Import the collection and one environment (`Orwell — orwell.pt` or `Orwell — local`). The local environment needs `npm run server` and uses `localhost:8448`.

From `qa/`:

```powershell
npx --yes newman run postman/Orwell_API.postman_collection.json -e postman/Orwell_orwell.pt.postman_environment.json
```

Observed on orwell.pt, with the suite green on top of it: `GET /_enclave/health` returns `{"ok":true,"server":"orwell.pt"}`. A federation post with a number and a script returns 400 `malformed-envelope` and does not echo the script. A report with numeric fields returns 400 `malformed-report`. `POST /_enclave/denuncia` with `{}` returns 401 `unauthorized`.

## Scope

Five cases per theme in pass 1.

| Theme | Where | Cases | Oracle |
| --- | --- | --- | --- |
| Site | `testes/test_site.py` | 5 | Visible text, `lang`, URL, no alert |
| Name | `testes/test_nome.py` | 5 | The next step, the button, the photo initial |
| Password | `testes/test_palavra_passe.py` | 5 | The step, the error, the field `type` |
| API | `postman/Orwell_API.postman_collection.json` | 5 | Status and body |
| Phone | `manual/appium-telemovel.md` | The same gate | By hand, no Appium code |
| Integration | `integration/*.integracao.test.ts` | 8, in 6 files | The real homeserver |

Outside pass 1: creating the account, pairing, joining a community, sending a message, an invite, a call with media, the ciphertext on the WebSocket, `POST /_enclave/health`, "Advanced options" with a bad server, and automated Appium. The signed report, federation between two homeservers, the SFU port, the vault, and link preview are pass 2.

```text
conftest.py            a new Chrome per test, and the final screen
gravador.py            a GIF of the path when ORWELL_GIF=1
dados.py               URLs and the English catalogue
evidencias.py          screen, crop, folders
paginas/               page objects for the site and the gate
testes/                five cases per file, pass 1
negativos/             the two findings, with GIFs; outside the default pytest run
integration/           Vitest, the real homeserver, pass 2
postman/               collection and two environments
manual/                Appium script, no automation
scripts/gravar_gif.py  the short gate GIF
docs/media/            published GIFs and crops
artefactos/            screens and GIFs from the latest run, not in Git
```

---

# Português (PT-PT)

Verificação do site público do Orwell em [orwell.pt](https://orwell.pt), mais uma camada de integração local. A leva 1 olha para o ecrã e para o HTTP público. A leva 2 sobe o homeserver verdadeiro. Nenhum caso de browser cria conta. A frase "Creating your account" falha o caso.

O guia de execução é esta página. O inglês vem primeiro. Esta é a versão em português de Portugal.

## Comandos

PowerShell. Os comandos de browser e de HTTP correm a partir de `qa/`. O comando de integração corre a partir da raiz do repositório.

Na primeira vez, a partir de `qa/`. Python 3.10+ e Google Chrome. O Selenium Manager trata do ChromeDriver.

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

O alvo por omissão é orwell.pt. `ORWELL_SITE_URL` e `ORWELL_APP_URL` apontam para outro sítio. `ORWELL_HEADED=1` no `.env` abre a janela do Chrome. Vazio fica headless.

| Objectivo | Comando |
| --- | --- |
| 15 casos de browser | `python -m pytest` |
| Um ficheiro | `python -m pytest testes/test_site.py` |
| Um caso | `python -m pytest testes/test_nome.py::test_nome_com_letras_avanca_para_a_fotografia` |
| GIF de um caso | `$env:ORWELL_GIF = "1"; python -m pytest testes/test_site.py::test_homepage_mostra_heroi_e_entrada` |
| Os dois achados | `python -m pytest negativos` |
| Clip curto do portão | `python scripts/gravar_gif.py` |
| Coleção HTTP | `npx --yes newman run postman/Orwell_API.postman_collection.json -e postman/Orwell_orwell.pt.postman_environment.json` |
| Integração, na raiz do repositório | `node .\node_modules\vitest\vitest.mjs run --config qa/integration/vitest.config.ts` |

`python -m pytest` sem caminho lê o `pytest.ini` e só recolhe `testes/`. A pasta `negativos/` fica de fora dessa corrida. Passa a pasta quando quiseres os dois achados.

Cada caso de browser guarda o ecrã final em `artefactos/ecras/`. Com `ORWELL_GIF=1`, o percurso vai para `artefactos/<nome-do-teste>.gif`. O Git ignora `artefactos/`. Os clipes desta página são as cópias publicadas. Depois de uma corrida nova, copia o GIF que queres manter por cima do ficheiro em `docs/media/` ou em `negativos/`.

## Clipes de browser

Seis casos de layout, em headless, a 1280×900, contra orwell.pt em 17 de novembro de 2026. Os seis passaram, em 3 min 56 s. Numa página mais alta que a janela, o gravador desce e volta ao topo depois das verificações. O movimento mostra o layout. As asserções já terminaram.

Gravar os seis outra vez:

```powershell
$env:ORWELL_GIF = "1"
python -m pytest `
  testes/test_site.py::test_homepage_mostra_heroi_e_entrada `
  testes/test_site.py::test_link_pt_abre_a_homepage_em_portugues `
  testes/test_site.py::test_privacidade_abre_pelo_rodape `
  testes/test_nome.py::test_nome_com_letras_avanca_para_a_fotografia `
  testes/test_palavra_passe.py::test_menos_de_oito_caracteres_fica_no_passo `
  testes/test_palavra_passe.py::test_mostrar_revela_e_voltar_a_ocultar
```

`test_homepage_mostra_heroi_e_entrada` abre `/`. O título visível contém "Play, talk". O link "Sign in" aponta para `/app/`.

![Homepage: herói e Sign in, descida pela página, regresso ao topo](docs/media/test_homepage_mostra_heroi_e_entrada.gif)

`test_link_pt_abre_a_homepage_em_portugues` segue `a[hreflang='pt']`. O título passa a "Joga, fala", o documento fica `lang="pt-PT"` e o URL acaba em `/pt`.

![Da homepage inglesa para a portuguesa](docs/media/test_link_pt_abre_a_homepage_em_portugues.gif)

`test_privacidade_abre_pelo_rodape` usa o link do rodapé. O título visível é "Privacy" e o URL acaba em `/privacy.html`.

![Da homepage à página Privacy, pelo rodapé](docs/media/test_privacidade_abre_pelo_rodape.gif)

`test_nome_com_letras_avanca_para_a_fotografia` escolhe "No, create an account", escreve "Ana Silva" e avança. O passo seguinte é a fotografia e a inicial é "A". A app segue a língua do browser, por isso estes casos fixam `?lingua=en`.

![Do outro aparelho até à fotografia, com a inicial A](docs/media/test_nome_com_letras_avanca_para_a_fotografia.gif)

`test_menos_de_oito_caracteres_fica_no_passo` escreve `abcdefg`. A pergunta continua "What is the password going to be?" e o erro é "Type at least 8 characters."

![Sete caracteres ficam no passo, com o erro visível](docs/media/test_menos_de_oito_caracteres_fica_no_passo.gif)

`test_mostrar_revela_e_voltar_a_ocultar` escreve `Valido!1`. O campo nasce `type="password"`. Show passa-o a texto. Hide devolve o tipo anterior.

![Show revela Valido!1 e Hide volta a esconder](docs/media/test_mostrar_revela_e_voltar_a_ocultar.gif)

Há mais dois casos do site sem clipe. O ecrã quase não muda, e a verificação é a ausência de um efeito.

| Caso | O que confirma |
| --- | --- |
| `test_caminho_desconhecido_nao_e_a_homepage` | `/esta-pagina-nao-existe-qa` não é a homepage. A resposta observada foi 404 com corpo vazio. |
| `test_marcacao_no_endereco_nao_e_executada` | Um script na query mantém o herói, não abre alerta e não injecta imagem. |

O clip antigo do portão, do outro aparelho até à palavra-passe e sem o erro, está em `docs/media/portao-nome.gif`. Regenera-se com `python scripts/gravar_gif.py`.

## Achados

Dois casos passam e deixam um problema no ecrã. Nesta suíte não há teste vermelho nem exploit demonstrado. Os outros casos hostis passam porque o controlo segura. O detalhe está em [`negativos/README.md`](negativos/README.md).

Correr os dois, com um GIF de cada:

```powershell
$env:ORWELL_GIF = "1"
python -m pytest negativos
```

Essa corrida, em 17 de novembro de 2026, passou em 41 s. Nenhuma conta foi criada. Os GIFs publicados em `negativos/` são a cópia a manter. O gravador continua a escrever o ficheiro novo em `artefactos/`.

### O portão não corta o nome

`test_nome_mais_longo_que_o_perfil_ainda_avanca`

O editor de perfil corta o nome a 32 (`NAME_MAX` em `packages/ui/src/screens/profile/ProfileEditor.tsx`). O campo do portão não tem `maxLength`. Quarenta letras entram, o Continue acende e o passo da fotografia abre. O caso fica verde porque descreve o produto como está. Fechar a lacuna implica mudar o oráculo: o campo passa a recusar ou a cortar acima de 32.

```powershell
python -m pytest testes/test_nome.py::test_nome_mais_longo_que_o_perfil_ainda_avanca
```

![Quarenta N no nome, Continue activo, e a fotografia a seguir](negativos/test_nome_mais_longo_que_o_perfil_ainda_avanca.gif)

### Oito dígitos chegam

`test_so_digitos_com_oito_caracteres_passam_a_regra`

`12345678` não tem letra nem símbolo e chega a "Confirm the password". O botão já diz "Create account". A suíte pára aí. A regra é oito caracteres. Letra, dígito ou símbolo não são exigidos. É uma política fraca. A conta não fica partida.

```powershell
python -m pytest testes/test_palavra_passe.py::test_so_digitos_com_oito_caracteres_passam_a_regra
```

![Oito dígitos chegam à confirmação, com Create account à vista](negativos/test_so_digitos_com_oito_caracteres_passam_a_regra.gif)

Estes casos hostis foram revistos e o controlo segurou: script no URL da homepage, marcação no nome, nome vazio, palavra-passe curta, confirmação diferente, caminho desconhecido, envelope de federação mal formado, denúncia mal formada, denúncia sem assinatura, pré-visualização de 127.0.0.1, servidor fora da allowlist, frase errada no cofre, porto do SFU tomado e campanha de apoio em baixo. Dígitos, acentos e emoji no nome também avançam. Esse caso está em `testes/test_nome.py` e não está registado como bug.

## Integração

Vitest, sem browser. Cada caso sobe o homeserver verdadeiro. O cofre usa o Argon2id de produção. `integration/vitest.config.ts` não carrega a derivação rápida dos testes unitários. Esta corrida é à parte de `npm test` e de `pytest`.

A partir da raiz do repositório, com Node 22 ou mais recente, depois de `npx tsc -b`:

```powershell
node .\node_modules\vitest\vitest.mjs run --config qa/integration/vitest.config.ts
```

![Uma corrida local da suíte de integração, oito testes](docs/media/integracao-vitest.gif)

| Tema | Onde | O que a corrida mostra |
| --- | --- | --- |
| Pré-visualização | `integration/ligacao.integracao.test.ts` | A página em 127.0.0.1 recebe zero ligações. O motivo é o mesmo em todos os endereços bloqueados. |
| Federação | `integration/federacao.integracao.test.ts` | O ciphertext sai de um homeserver, o outro lê a chave por HTTP e fica com o par. Quem está fora da allowlist leva 403 e não fica inscrito. |
| Chamadas | `integration/sfu.integracao.test.ts` | Com o motor de pé, o `hello.ok` anuncia `sfu`. Com o porto tomado, o texto continua e o `hello` não traz `sfu`. |
| Denúncia | `integration/denuncia.integracao.test.ts` | O mesmo pedido leva 401 antes do login e 200 depois. O segundo envio não grava outro ficheiro. |
| Barra de apoio | `integration/apoio.integracao.test.ts` | A vigia lê a fixture por HTTP e serve `/_enclave/apoiar.json`. Com a campanha em baixo, `/_enclave/health` continua ok. |
| Cofre | `integration/cofre.integracao.test.ts` | A frase certa reabre a mesma conta. A frase errada deixa o cofre fechado. |

Oito testes, seis ficheiros. Na gravação, o cofre leva a maior parte do meio minuto. As duas linhas de registo na imagem pertencem aos casos: a campanha que não se leu, e o porto de média que já estava tomado.

O produto fala `https://` na federação. O teste reescreve essa chamada para o outro homeserver nesta máquina, e só dentro do teste. A pré-visualização continua a recusar loopback.

## HTTP

Importa a coleção e um ambiente (`Orwell — orwell.pt` ou `Orwell — local`). O ambiente local precisa de `npm run server` e usa `localhost:8448`.

A partir de `qa/`:

```powershell
npx --yes newman run postman/Orwell_API.postman_collection.json -e postman/Orwell_orwell.pt.postman_environment.json
```

Observado em orwell.pt, com a suíte verde por cima: `GET /_enclave/health` responde `{"ok":true,"server":"orwell.pt"}`. Um post de federação com número e script responde 400 `malformed-envelope` e não ecoa o script. Um relato com versão e texto numéricos responde 400 `malformed-report`. `POST /_enclave/denuncia` com `{}` responde 401 `unauthorized`.

## Âmbito

Cinco casos por tema na leva 1.

| Tema | Onde | Casos | Oráculo |
| --- | --- | --- | --- |
| Site | `testes/test_site.py` | 5 | Texto visível, `lang`, URL, ausência de alerta |
| Nome | `testes/test_nome.py` | 5 | O passo seguinte, o botão, a inicial da fotografia |
| Palavra-passe | `testes/test_palavra_passe.py` | 5 | O passo, o erro, o `type` do campo |
| API | `postman/Orwell_API.postman_collection.json` | 5 | Estado e corpo |
| Telemóvel | `manual/appium-telemovel.md` | O mesmo portão | À mão, sem código Appium |
| Integração | `integration/*.integracao.test.ts` | 8, em 6 ficheiros | O homeserver verdadeiro |

Fora da leva 1: criar a conta, emparelhar, entrar numa comunidade, enviar mensagem, convite, chamada com média, o ciphertext no WebSocket, `POST /_enclave/health`, "Advanced options" com um servidor inválido, e Appium automatizado. A denúncia assinada, a federação entre dois homeservers, o porto do SFU, o cofre e a pré-visualização estão na leva 2.

```text
conftest.py            Chrome novo por teste e ecrã final
gravador.py            percurso em GIF quando ORWELL_GIF=1
dados.py               URLs e frases do catálogo inglês
evidencias.py          ecrã, recorte e pastas
paginas/               page objects do site e do portão
testes/                cinco casos por ficheiro, leva 1
negativos/             os dois achados, com GIF; fora do pytest por omissão
integration/           Vitest, homeserver verdadeiro, leva 2
postman/               coleção e dois ambientes
manual/                roteiro Appium, sem automação
scripts/gravar_gif.py  GIF curto do portão
docs/media/            GIFs e recortes publicados
artefactos/            ecrãs e GIFs da última corrida, fora do Git
```
