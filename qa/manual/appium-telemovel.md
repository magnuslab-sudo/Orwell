# Telemóvel — roteiro manual no Appium

Esta leva não traz testes Appium. O telemóvel fica para correres tu, passo a passo, no Inspector ou numa sessão manual. O mesmo texto da suíte Selenium serve de oráculo: a app no telefone é a de `https://orwell.pt/app/?lingua=en`. Não cries a conta no fim. Para no passo da confirmação.

Arranque sugerido no Inspector: Chrome ou Safari no aparelho, `browserName` do telemóvel, sem app nativa. A PWA abre no browser. Língua presa com `?lingua=en`, senão o texto sai em português e as frases abaixo não batem.

## Arranque

1. Abre `https://orwell.pt/app/?lingua=en`.
2. Espera sair de "Opening…".
3. Confirma a pergunta "Do you already use Orwell on another device?".
4. Toca em "No, create an account".
5. Confirma "How do you want your name shown?" e o campo com o exemplo "How you want to appear".

Resultado que falha o caso: a app abre logo dentro de uma conta antiga deste browser, ou o botão de criar conta não aparece.

## Nome — cinco provas

1. Com o campo vazio, "Continue" está inactivo. Escreve três espaços. Continua inactivo.
2. Apaga e escreve `Ana Silva`. "Continue" fica activo. Avança. A pergunta passa a "Do you want a profile picture?" e a inicial no círculo é `A`. Volta atrás.
3. Escreve `123456`. Avança. A inicial é `1`. Dígitos num campo de nome passam. Volta atrás.
4. Escreve `Ção 🧪 <img src=x onerror=alert(1)>`. Não pode aparecer um alerta. Avança. A inicial é `Ç` e não surge uma imagem partida. Volta atrás.
5. Escreve 40 letras `N`. O campo aceita as 40 (não há tecto de 32, ao contrário do editor de perfil). "Continue" fica activo.

Tira um recorte do campo em cada prova.

## Palavra-passe — cinco provas

Chega aqui com um nome curto, toca em "Skip" na fotografia.

1. Escreve `abcdefg` (7). "Continue". A frase é "Type at least 8 characters." e a pergunta não muda.
2. Apaga e escreve `Valido!1` (8, com símbolo). Avança para "Confirm the password". Não toques em "Create account". Volta atrás.
3. Escreve `12345678`. Avança outra vez até à confirmação. Só dígitos, com 8 caracteres, passam a regra. Volta atrás.
4. Escreve `Valido!1`, avança, na confirmação escreve `Valido!2` e submete. A frase é "The two passwords are different." O ecrã não passa a "Creating your account".
5. Volta à palavra-passe, escreve `Valido!1`, toca em "Show". O campo deixa de estar mascarado e o texto é o que escreveste. Toca em "Hide". Volta a ficar mascarado.

Não toques em "Create account". Isso gravaria uma conta real em orwell.pt.

## O que anotar à parte

- Roda o telemóvel no passo do nome e no da palavra-passe. O campo e o botão têm de continuar alcançáveis.
- O teclado não pode tapar "Continue" sem haver forma de o ver (scroll ou o botão a subir).
- Se o aparelho já tiver uma conta neste browser, o portão mostra que já existe uma conta. Apaga os dados do site antes de repetir. Não uses "Start over" numa conta que te interesse.
