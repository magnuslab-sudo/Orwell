# Orwell — suíte de QA

Selenium e pytest para o site e para o portão da app, coleção Postman para o HTTP público, um roteiro de telemóvel para correres à mão no Appium, e Vitest para a integração. O desenho segue os projetos anteriores: Page Object, pytest, captura no fim de cada caso, GIF e recortes no portefólio, coleção Postman com asserções.

A leva 1 tem **cinco casos por tema**. Não cria conta e não mexe em chamadas, convites nem mensagens cifradas. A leva 2 sobe o homeserver verdadeiro e lê o que o ecrã não mostra.

| Tema | Onde | Casos |
| --- | --- | --- |
| Site | `testes/test_site.py` | Herói e "Sign in"; PT pelo link; privacidade pelo rodapé; caminho que não existe; script no URL |
| Nome | `testes/test_nome.py` | Letras; vazio e espaços; dígitos no campo de nome; acentos, emoji e marcação; nome maior que 32 |
| Palavra-passe | `testes/test_palavra_passe.py` | Menos de 8; 8 com símbolo; só dígitos; confirmação diferente; mostrar e ocultar |
| API | `postman/Orwell_API.postman_collection.json` | Saúde; rota inexistente; federação mal formada; registo com tipos errados; denúncia sem assinatura |
| Telemóvel | `manual/appium-telemovel.md` | O mesmo portão, passo a passo, sem código Appium |

Os testes da app param antes de "Create account". A frase "Creating your account" é o que falha o caso, se aparecer.

## O que a corrida contra orwell.pt mostrou

- O nome no portão não tem `maxLength`. No editor de perfil o tecto é 32 (`NAME_MAX` em `packages/ui/src/screens/profile/ProfileEditor.tsx`). Quarenta letras ainda avançam. É a incompatibilidade desta leva.
- Dígitos, acentos e emoji no nome avançam. A marcação fica texto: não há alerta nem `<img src=x>`.
- A palavra-passe só exige 8 caracteres. `12345678` chega à confirmação. Não há regra de maiúscula, dígito ou símbolo.
- Nome vazio ou só espaços deixa "Continue" inactivo.
- `GET /_enclave/health` responde `{"ok":true,"server":"orwell.pt"}` e mais nada.
- `POST /_enclave/federation/v1/send` com número e script responde 400 `malformed-envelope` e não ecoa o script.
- `POST /_enclave/relato` com versão e texto numéricos responde 400 `malformed-report`.
- `POST /_enclave/denuncia` com `{}` responde 401 `unauthorized`.
- Um caminho que o site não tem responde 404 com corpo vazio.

## Fora da leva 1

- Criar a conta até ao fim no browser, emparelhar, entrar numa comunidade, enviar mensagem, convite, chamada com média.
- O corpo cifrado do WebSocket, lido pelo Postman.
- `POST /_enclave/health` (também 404, a rota só existe em GET) e o campo "Advanced options" com um servidor inválido.
- Appium automatizado.

A denúncia assinada, a federação entre dois homeservers, o porto do SFU, o cofre e a pré-visualização estão na leva 2.

## Leva 2 — integração

Vitest, sem browser. Cada caso sobe o homeserver verdadeiro (`levantarServidor`). O cofre usa o Argon2id de produção. A config está em `integration/vitest.config.ts`.

![Uma corrida da suíte de integração, oito testes](docs/media/integracao-vitest.gif)

| Tema | Onde | O que a corrida mostra |
| --- | --- | --- |
| Pré-visualização | `integration/ligacao.integracao.test.ts` | A página em 127.0.0.1 recebe zero ligações. O motivo é o mesmo em todos os endereços bloqueados. |
| Federação | `integration/federacao.integracao.test.ts` | O ciphertext sai de um homeserver, o outro lê a chave por HTTP e fica com o par. Quem está fora da allowlist leva 403 e não fica inscrito. |
| SFU | `integration/sfu.integracao.test.ts` | Com o motor de pé, o `hello.ok` anuncia `sfu`. Com o porto tomado, o texto continua e o `hello` não traz `sfu`. |
| Denúncia | `integration/denuncia.integracao.test.ts` | O mesmo pedido leva 401 antes do login e 200 depois. O segundo envio não grava outro ficheiro. |
| Apoio | `integration/apoio.integracao.test.ts` | A vigia lê a fixture por HTTP e serve `/_enclave/apoiar.json`. Com a campanha em baixo, `/_enclave/health` continua ok. |
| Cofre | `integration/cofre.integracao.test.ts` | A frase certa reabre a mesma conta. A frase errada deixa o cofre fechado. |

Oito testes, seis ficheiros. Na gravação, o cofre leva a maior parte do meio minuto.

Na mesma imagem aparecem duas linhas de registo. São o caso a funcionar: a campanha que não se leu, e o porto de média que já estava tomado.

A partir da raiz do repositório, com Node 22 ou mais recente, e os pacotes já compilados (`npx tsc -b`):

```powershell
node .\node_modules\vitest\vitest.mjs run --config qa/integration/vitest.config.ts
```

`npm test` percorre os pacotes. O pytest desta pasta só recolhe `testes/`.

## Correr o Selenium

Python 3.10+, Google Chrome. O Selenium Manager trata do ChromeDriver.

```powershell
cd qa
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m pytest
```

`ORWELL_HEADED=1` no `.env` abre o Chrome à vista. Sem isso corre em headless.

Cada caso guarda o ecrã em `qa/artefactos/ecras/`. Essa pasta não vai para o Git. Os recortes do portefólio ficam em `qa/docs/media/`.

Para gerar outra vez o GIF do portão, sem criar conta:

```powershell
python scripts/gravar_gif.py
```

O resultado é `qa/docs/media/portao-nome.gif`.

## Correr o Postman

Importa a coleção e um dos ambientes (`Orwell — orwell.pt` ou `Orwell — local`). O local precisa de `npm run server` e usa `localhost:8448`, que é o nome por omissão do homeserver.

Pelo Newman, a partir de `qa/`:

```powershell
npx --yes newman run postman/Orwell_API.postman_collection.json -e postman/Orwell_orwell.pt.postman_environment.json
```

## Representação

![Do outro aparelho até à palavra-passe, sem criar conta](docs/media/portao-nome.gif)

Recortes da mesma corrida: o herói do site, o campo do nome e o erro dos 7 caracteres.

![Herói](docs/media/recorte-heroi.png)
![Campo do nome](docs/media/recorte-campo-nome.png)
![Palavra-passe curta](docs/media/recorte-passe-curta.png)

## Layout

```text
conftest.py            Chrome por teste e captura final
dados.py               URLs e frases do catálogo inglês
evidencias.py          ecrã, recorte, pasta do GIF
paginas/site.py        page object do site
paginas/portao.py      page object do portão
testes/                cinco casos por ficheiro, leva 1
integration/           Vitest, homeserver verdadeiro, leva 2
postman/               coleção e dois ambientes
manual/                roteiro Appium, sem automação
scripts/gravar_gif.py  GIF do portão
docs/media/            GIFs e recortes
```
