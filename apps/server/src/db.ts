import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

/**
 * Homeserver storage.
 *
 * Read this schema as a statement of what an operator can be compelled to hand
 * over, because that is what it is. Every column here is either opaque
 * ciphertext or the minimum routing state needed to deliver it. There is
 * deliberately no messages table with an author column, no display names, no
 * channel names, no reactions, no read receipts, no attachment filenames: all
 * of that exists only inside `ciphertext`.
 *
 * The one uncomfortable table is `subscriptions`: to deliver to an offline
 * member we must remember that a local account follows a channel. That is real
 * social-graph metadata and docs/THREAT-MODEL.md says so plainly rather than
 * pretending otherwise.
 */

export interface StoredEvent {
  channel: string
  seq: number
  kind: string
  ciphertext: string
  recipient: string | null
  receivedAtMinute: number
}

/**
 * Uses Node's built-in SQLite rather than `better-sqlite3`.
 *
 * One fewer native dependency to compile, and (more to the point) one fewer
 * third-party package with build scripts sitting underneath a server whose whole
 * value proposition is that you can audit what it does with your data.
 */
export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)

  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  // Durability matters more than throughput here: a lost commit desynchronises
  // an MLS group, which is far more disruptive than a slow write.
  db.exec("PRAGMA synchronous = FULL")

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      address        TEXT PRIMARY KEY,
      -- Ed25519 public key. Registered on first login and then immutable:
      -- the account id is a hash of this key, so a change means a new account.
      signing_key    BLOB NOT NULL,
      created_minute INTEGER NOT NULL
    );

    -- Os aparelhos de cada conta.
    --
    -- Uma conta é uma chave; um aparelho é outra chave, certificada por ela. O
    -- servidor guarda as chaves de aparelho porque é ele que serve os key
    -- packages e tem de saber a quem pertencem — mas não pode inventar um
    -- aparelho: sem a chave de conta ninguém produz um certificado que feche, e
    -- é cada cliente que valida a cadeia antes de admitir uma folha. O ataque do
    -- aparelho fantasma acrescentado pelo servidor morre na credencial, não
    -- aqui.
    --
    -- O que esta tabela ensina ao operador, e o modelo de ameaças di-lo: quantos
    -- aparelhos tem cada conta, e o minuto em que cada um entrou.
    --
    -- Até quatro linhas por conta (APARELHOS_POR_CONTA, no protocolo); acima
    -- disso sai a mais antiga por added_minute. Foi uma linha por conta até
    -- 22 de Setembro de 2026, mantida por um DELETE a cada login que já não
    -- existe. Ver Store.registerDevice.
    CREATE TABLE IF NOT EXISTS devices (
      address      TEXT NOT NULL,
      device_key   BLOB NOT NULL,
      added_minute INTEGER NOT NULL,
      PRIMARY KEY (address, device_key)
    );

    -- O manifesto de aparelhos de cada conta: a lista das chaves de aparelho
    -- que falam por ela, assinada pela chave de CONTA, com versão que só sobe.
    --
    -- Uma linha por conta, a mais recente. O servidor guarda-a se a assinatura
    -- fechar e a versão for maior do que a que tem (Store.putDeviceManifest), e
    -- serve-a a quem a pedir (manifest.get). O que ele NAO pode: escrever uma
    -- que a conta não assinou, porque não tem a chave. O que pode, e o modelo
    -- de ameaças di-lo: servir esta linha depois de a conta ter publicado uma
    -- mais nova que aqui nunca chegou, a quem nunca viu a mais nova.
    --
    -- O que esta tabela ensina ao operador: o mesmo que a de cima (que chaves
    -- de aparelho tem cada conta), agora pela palavra da conta e não pela
    -- observação do login, mais o minuto de cada publicação.
    CREATE TABLE IF NOT EXISTS device_manifests (
      address          TEXT PRIMARY KEY,
      version          INTEGER NOT NULL,
      -- A forma do fio (DeviceManifestWire), em JSON, tal como chegou.
      manifest         TEXT NOT NULL,
      published_minute INTEGER NOT NULL
    );

    -- Os aparelhos que cada conta tirou do seu manifesto: revogados, para sempre.
    --
    -- Ninguém escreve aqui directamente. Store.putDeviceManifest compara o
    -- manifesto novo com o que tinha guardado, e cada chave que estava no velho,
    -- falta no novo E vem na lista "revoke" da trama entra aqui na mesma
    -- transacção. O manifesto novo foi assinado pela conta, portanto o servidor
    -- não inventa uma revogação sem a chave de conta. O que sai sem vir na lista
    -- (o corte pelo tecto de um cliente 0.5.7) só sai: não entra aqui.
    --
    -- O que esta tabela decide: um aparelho daqui não entra (auth.begin), não
    -- reclama nem publica key packages, e não volta a nenhum manifesto da conta.
    -- O que ensina ao operador: quantos aparelhos cada conta tirou, e em que
    -- minuto. Nada que o manifesto antigo não ensinasse já.
    CREATE TABLE IF NOT EXISTS revoked_devices (
      address        TEXT NOT NULL,
      device_key     TEXT NOT NULL,
      revoked_minute INTEGER NOT NULL,
      PRIMARY KEY (address, device_key)
    );

    -- A geração de posse de cada aparelho (ver auth.finish no protocolo).
    -- Importar um ficheiro de conta copia o aparelho que o exportou, com a
    -- mesma chave; a cópia importada sobe a geração, e a que ficar abaixo é
    -- recusada no login. Sem linha, a geração é zero.
    -- O que ensina ao operador: quantas vezes cada aparelho foi importado.
    -- A marca é a da importação que assumiu esta geração: a mesma cópia a
    -- pedir outra vez (duas ligações ao mesmo tempo) não sobe a geração.
    CREATE TABLE IF NOT EXISTS device_posse (
      address    TEXT NOT NULL,
      device_key TEXT NOT NULL,
      geracao    INTEGER NOT NULL,
      marca      TEXT NOT NULL,
      PRIMARY KEY (address, device_key)
    );

    -- Opaque MLS frames. The server cannot read any of them and does not try.
    CREATE TABLE IF NOT EXISTS events (
      channel            TEXT NOT NULL,
      seq                INTEGER NOT NULL,
      kind               TEXT NOT NULL CHECK (kind IN ('application','handshake','welcome')),
      ciphertext         BLOB NOT NULL,
      -- Set only for 'welcome', which is addressed to a single joining member.
      recipient          TEXT,
      -- Minute resolution, not milliseconds. Precise arrival times are a
      -- traffic-analysis primitive and nothing here needs them.
      received_minute    INTEGER NOT NULL,
      PRIMARY KEY (channel, seq)
    );

    CREATE INDEX IF NOT EXISTS events_by_age ON events (received_minute);

    -- Que este canal alguma vez foi usado. Uma linha por canal, escrita à
    -- primeira mensagem e nunca apagada.
    --
    -- Existe porque a retenção apaga eventos: passados os trinta dias, uma sala
    -- privada que ficou calada volta a ter zero eventos e fica indistinguível
    -- de uma acabada de criar. A tolerância que deixa qualquer conta subscrever
    -- e escrever num canal vazio — sem a qual não seria possível criar canal
    -- nenhum — reabria-se então sobre uma sala com história. Isto é a memória
    -- de que houve história, e é a única coisa que aqui fica: nem quantos
    -- eventos, nem quando, nem de quem.
    CREATE TABLE IF NOT EXISTS channel_activity (
      channel TEXT PRIMARY KEY
    );

    -- Which local accounts to wake for a channel. See the note above.
    CREATE TABLE IF NOT EXISTS subscriptions (
      channel TEXT NOT NULL,
      address TEXT NOT NULL,
      PRIMARY KEY (channel, address)
    );

    -- Which *servers* a channel reaches. Federation routes on this, never on
    -- remote user addresses, so a peer never learns our membership list.
    CREATE TABLE IF NOT EXISTS channel_peers (
      channel TEXT NOT NULL,
      server  TEXT NOT NULL,
      PRIMARY KEY (channel, server)
    );

    -- Single-use MLS key packages, so someone can be added to a group while offline.
    --
    -- device é a chave pública do APARELHO que assina as folhas destes
    -- pacotes, para os servir por aparelho (Store.claimBundle). NULL nas linhas
    -- de antes de 22 de Setembro de 2026 e nas de um cliente que entrou sem
    -- cadeia: um pacote de aparelho desconhecido, que se serve como sempre se
    -- serviu (o singular, o mais recente) e que replace apaga junto com os
    -- do próprio aparelho. A coluna nasce aqui para bases novas e por
    -- migrarKeyPackages para as que já existiam: o primeiro ALTER TABLE
    -- deste projecto.
    --
    -- O que esta coluna ensina ao operador: quantos pacotes por reclamar tem
    -- cada aparelho, que é o mesmo que já sabia por conta, agora por máquina.
    CREATE TABLE IF NOT EXISTS key_packages (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      address  TEXT NOT NULL,
      package  BLOB NOT NULL,
      claimed  INTEGER NOT NULL DEFAULT 0,
      device   BLOB
    );

    CREATE INDEX IF NOT EXISTS key_packages_available ON key_packages (address, claimed);

    -- Invite codes, stored only as hashes.
    --
    -- The server never sees a usable code. It holds the policy because expiry
    -- and use limits are routing decisions; admission itself remains a
    -- member's commit, which this server has no key to produce.
    --
    -- Correcção da 1.0 «Arca», fatia 2: o comentário antigo dizia que levar
    -- esta tabela não abria canal nenhum. Era falso: o invite.redeem aceitava o
    -- code_hash, que está aqui, e o membro online admitia quem o trouxesse.
    -- Agora o convite guarda code_key, a chave PÚBLICA derivada do código
    -- (prova-do-convite.ts), e o resgate pede uma assinatura com a privada:
    -- com a pública não se assina, e uma cópia da tabela deixa de chegar para
    -- entrar. code_key é NULL nos convites de clientes 0.9.x, e esses já não
    -- se resgatam (1.0 «Arca», fatia 6a): o hash sozinho nunca abre nada.
    --
    -- short_code (1.0 «Arca», fatia 4): o código curto das ligações
    -- orwell.pt/c#<8>, que o servidor dá a quem cria o convite e resolve em
    -- canal e code_hash (invite.resolve). É um segredo ao portador como a
    -- ligação inteira, e fica aqui em claro: dá o canal e o code_hash, que
    -- quem lê esta tabela já tinha, e nenhum dos dois resgata o convite sem a
    -- prova do código (que nunca chega ao servidor). NULL nos convites de antes da coluna, que
    -- continuam a valer pela ligação longa. Ver migrarInvites.
    --
    -- selo (1.0 «Arca», fatia 5c): o nome do canal (e o de quem convida),
    -- cifrado com uma chave que só sai do código (selo-do-convite.ts). O
    -- servidor guarda-o e devolve-o, e não o lê: sem o código, que nunca cá
    -- chega, é ruído de tamanho fixo. NULL nos convites sem selo.
    CREATE TABLE IF NOT EXISTS invites (
      code_hash    TEXT PRIMARY KEY,
      channel      TEXT NOT NULL,
      -- Unix seconds; NULL means it does not expire on its own.
      expires_at   INTEGER,
      -- NULL means unlimited.
      max_uses     INTEGER,
      uses         INTEGER NOT NULL DEFAULT 0,
      created_second INTEGER NOT NULL,
      short_code   TEXT,
      code_key     TEXT,
      selo         TEXT
    );

    CREATE INDEX IF NOT EXISTS invites_by_channel ON invites (channel);

    -- Replay defence for inbound federation. Rows age out with the skew window.
    -- Metadados do próprio servidor. Hoje guarda uma coisa só: quando o
    -- armazenamento foi reiniciado, para os clientes saberem que o estado de
    -- grupo que têm no cofre deixou de ter par deste lado.
    CREATE TABLE IF NOT EXISTS server_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Quem ficou encarregado de criar um canal.
    --
    -- Existe para uma corrida só, e é a que a sala comum tem por natureza:
    -- várias pessoas a chegar ao mesmo tempo a um servidor onde a sala ainda
    -- não existe. Sem árbitro, cada uma cria o seu grupo MLS com o mesmo
    -- identificador e ficam todas numa sala com o nome certo e gente nenhuma
    -- lá dentro. O servidor não pode criar o grupo (não tem as chaves), mas
    -- pode dizer quem o cria: o primeiro a pedir ganha, os outros pedem
    -- entrada a esse.
    CREATE TABLE IF NOT EXISTS channel_claims (
      channel   TEXT PRIMARY KEY,
      owner     TEXT NOT NULL,
      at_second INTEGER NOT NULL
    );

    -- O cartão de entrada da sala comum: um GroupInfo com iniciação externa.
    --
    -- Guardado em claro porque é para ser lido por quem ainda não tem chave
    -- nenhuma: é essa a sua função. O que ele diz é quem são os membros e as
    -- chaves públicas das folhas deles, e não uma sílaba do que lá se disse.
    --
    -- Uma linha por canal, e só para o canal que este servidor anuncia como
    -- comum. A guarda está no gateway e é a que separa uma sala pública de uma
    -- porta aberta: num canal privado, publicar isto seria dar entrada a quem
    -- lhe deitasse a mão, porque quem entra por aqui não é convidado por
    -- ninguém.
    CREATE TABLE IF NOT EXISTS group_infos (
      channel   TEXT PRIMARY KEY,
      info      BLOB NOT NULL,
      at_minute INTEGER NOT NULL
    );

    -- A próxima epoch em que cada canal aceita um commit.
    --
    -- Existe para impedir que um grupo MLS se parta em ramos. Dois commits
    -- guardados para a mesma epoch são dois futuros para o grupo, e cada autor
    -- aplica o seu: foi assim que a sala comum acabou com gente nas epochs 12,
    -- 16 e 17 ao mesmo tempo, sem ninguém se ver nem se ouvir. O servidor aceita
    -- o primeiro commit de cada epoch e recusa os outros ao autor.
    --
    -- O que isto ensina ao operador: quantos commits cada canal teve. É o que
    -- já se contava pelos handshakes guardados, e ao contrário deles não caduca
    -- com a retenção — tem de não caducar, ou um canal calado há um mês voltava
    -- a aceitar commits velhos. A epoch viaja em claro no cabeçalho MLS; nada
    -- aqui foi decifrado para a ter. Ver cabecalho-mls.ts.
    CREATE TABLE IF NOT EXISTS channel_epochs (
      channel TEXT PRIMARY KEY,
      epoch   INTEGER NOT NULL
    );

    -- O cofre cifrado (fase 3a do plano do estado cifrado): o estado de cada
    -- canal e de cada conta, uma entrada por facto, cifrado pelos clientes.
    --
    -- escopo: 'canal:<morada>' ou 'conta:<endereço>'. A morada já está em
    -- subscriptions e o endereço em accounts: o escopo não ensina nomes novos.
    -- chave: opaca, o HMAC da chave lógica sob a chave do cofre, que o servidor
    -- não tem. Nunca 'sala:geral': o molde do fio só deixa passar 22
    -- caracteres base64url.
    -- versao: a do escopo no momento da escrita. Sobe a cada escrita e a cada
    -- lápide, e é por ela que se lê o delta.
    -- conteudo: cifra acolchoada a múltiplos de 1024 bytes. Vazio numa lápide.
    -- lapide: 1 quando a entrada foi apagada. Fica, com versão, para quem lê por
    -- delta saber que saiu; as mais antigas podam-se (ver Store.cofrePut).
    -- epoch: reservada para a fase 3c (a epoch declarada numa escrita
    -- assinada). A 3a não a escreve: fica NULL.
    -- at_minute: o minuto da escrita, à resolução de sempre.
    --
    -- O que esta tabela ensina ao operador, e o modelo de ameaças di-lo na
    -- secção «Cofre cifrado no servidor»: quantas entradas tem cada canal e
    -- cada conta, o tamanho de cada uma em baldes de 1 KiB, e em que minuto
    -- mudou. Nunca o que dizem, e nunca quem as escreveu: o servidor vê a conta
    -- no momento da escrita (aplica-lhe o tecto) e não a guarda. Não há coluna
    -- de autor aqui, pela mesma razão de não haver em events.
    CREATE TABLE IF NOT EXISTS cofres (
      escopo    TEXT NOT NULL,
      chave     TEXT NOT NULL,
      versao    INTEGER NOT NULL,
      conteudo  BLOB NOT NULL,
      lapide    INTEGER NOT NULL DEFAULT 0,
      epoch     INTEGER,
      at_minute INTEGER NOT NULL,
      PRIMARY KEY (escopo, chave)
    );

    CREATE INDEX IF NOT EXISTS cofres_por_escopo ON cofres (escopo, versao);

    -- Os contadores de cada escopo, para os tectos não custarem um varrimento.
    --
    -- versao_global: a versão mais alta já dada neste escopo. bytes e entradas:
    -- o que está vivo (sem lápides). lapides: quantas lápides há. podado_ate: a
    -- versão mais alta de uma lápide já podada; uma leitura por delta de antes
    -- dela recebe o cofre inteiro, porque o delta já não diz tudo o que saiu.
    -- chave_de_escrita e epoch: reservadas para a fase 3c (a chave pública de
    -- escrita da epoch corrente). sem_subscritores_desde: o minuto em que o
    -- varrimento viu o canal sem ninguém subscrito, para o apagar ao fim de
    -- ENCLAVE_COFRE_GC_DIAS (desligado por omissão).
    CREATE TABLE IF NOT EXISTS cofres_meta (
      escopo                 TEXT PRIMARY KEY,
      versao_global          INTEGER NOT NULL DEFAULT 0,
      bytes                  INTEGER NOT NULL DEFAULT 0,
      entradas               INTEGER NOT NULL DEFAULT 0,
      lapides                INTEGER NOT NULL DEFAULT 0,
      podado_ate             INTEGER NOT NULL DEFAULT 0,
      chave_de_escrita       TEXT,
      epoch                  INTEGER,
      sem_subscritores_desde INTEGER
    );

    CREATE TABLE IF NOT EXISTS federation_nonces (
      origin      TEXT NOT NULL,
      nonce       TEXT NOT NULL,
      seen_second INTEGER NOT NULL,
      PRIMARY KEY (origin, nonce)
    );

    CREATE INDEX IF NOT EXISTS federation_nonces_by_age ON federation_nonces (seen_second);

    -- Verify keys advertised by peer servers, cached until they expire.
    CREATE TABLE IF NOT EXISTS peer_keys (
      server       TEXT NOT NULL,
      key_id       TEXT NOT NULL,
      public_key   BLOB NOT NULL,
      valid_until  INTEGER NOT NULL,
      PRIMARY KEY (server, key_id)
    );

    -- Outbound federation, retried until delivered or abandoned.
    CREATE TABLE IF NOT EXISTS outbox (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      destination  TEXT NOT NULL,
      payload      TEXT NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0,
      next_try     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS outbox_ready ON outbox (next_try);

    -- As contas suspensas (denúncias, §8). Só o guião do VPS, corrido por uma
    -- pessoa, escreve aqui (Store.suspender e Store.levantar): nenhuma contagem
    -- de denúncias suspende ninguém. Levantar põe activa a 0 e não apaga nada.
    -- O que esta tabela decide: a conta não entra no gateway, não envia, e os
    -- key packages dela não se servem. O aviso (motivo, factos, norma) vive
    -- em <dados>/denuncias/suspensoes/, fora da base e fora do backup.
    -- O que ensina ao operador: que contas suspendeu, por que denúncia, e
    -- desde que segundo. ate_second é o fim (--ate, o último segundo desse
    -- dia em UTC), ou NULL: até à revisão. Depois do fim a conta volta a
    -- entrar sem ninguém mexer na linha, e activa fica a 1.
    CREATE TABLE IF NOT EXISTS suspensoes (
      address    TEXT PRIMARY KEY,
      activa     INTEGER NOT NULL,
      denuncia   INTEGER,
      at_second  INTEGER NOT NULL,
      ate_second INTEGER
    );
  `)

  migrarKeyPackages(db)
  migrarInvites(db)

  return db
}

/**
 * The `key_packages.device` column in a database created without it.
 *
 * `CREATE TABLE IF NOT EXISTS` does not add columns to a table that already
 * exists, and the production one has existed since 14 August 2026. This is the first
 * migration step for this project, and the smallest one that holds up: read
 * the columns and add the missing one. `ADD COLUMN` without DEFAULT does not
 * rewrite the table (SQLite only changes the schema; old rows read NULL), so it
 * runs in milliseconds whatever the pool size, and does not touch the existing
 * rows. Without `PRAGMA user_version` or an ordered list of steps, this is a
 * debt documented in docs/PENDENTES.md: as long as a column can be detected by
 * its absence, it works; the day a step depends on another, it does not.
 *
 * The index comes AFTER the column and outside the big `exec`, because an index
 * on a column that does not yet exist is an error that would abort startup.
 *
 * Idempotent: opening the same database twice does nothing the second time.
 */
function migrarKeyPackages(db: DatabaseSync): void {
  const colunas = db.prepare("PRAGMA table_info(key_packages)").all() as { name: string }[]
  if (!colunas.some((coluna) => coluna.name === "device")) {
    db.exec("ALTER TABLE key_packages ADD COLUMN device BLOB")
  }
  db.exec("CREATE INDEX IF NOT EXISTS key_packages_by_device ON key_packages (address, device, claimed)")
}

/**
 * The `invites.short_code` column in a database created without it (a 0.9
 * one).
 *
 * The same step as `migrarKeyPackages`, for the same reason: read the columns
 * and add the missing one, without DEFAULT to avoid rewriting the table. The
 * index is UNIQUE, and it ensures that two invites never share a short code
 * (the generator retries when it hits one, see `Store.createInvite`). In SQLite
 * a unique index accepts multiple NULLs, which lets old invites stay without a
 * code. It comes after the column and outside the big `exec` for the same reason
 * as the `key_packages` index.
 *
 * Idempotent: opening the same database twice does nothing the second time.
 */
function migrarInvites(db: DatabaseSync): void {
  const colunas = db.prepare("PRAGMA table_info(invites)").all() as { name: string }[]
  if (!colunas.some((coluna) => coluna.name === "short_code")) {
    db.exec("ALTER TABLE invites ADD COLUMN short_code TEXT")
  }
  // The public key of the code proof (1.0 "Arca", slice 2). NULL in old rows,
  // which are redeemed by hash until the cutoff.
  if (!colunas.some((coluna) => coluna.name === "code_key")) {
    db.exec("ALTER TABLE invites ADD COLUMN code_key TEXT")
  }
  // The channel name seal (1.0 "Arca", slice 5c). NULL in old rows.
  if (!colunas.some((coluna) => coluna.name === "selo")) {
    db.exec("ALTER TABLE invites ADD COLUMN selo TEXT")
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS invites_by_short_code ON invites (short_code)")
}

export function currentMinute(): number {
  return Math.floor(Date.now() / 60_000)
}

export function currentSecond(): number {
  return Math.floor(Date.now() / 1000)
}
