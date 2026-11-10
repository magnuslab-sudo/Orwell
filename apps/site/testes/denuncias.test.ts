import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The reports in the terms and privacy, checked (Task 12).
 *
 * The DSA (arts. 11, 12, 14 and 16-18) requires the terms to say how to report, which we
 * do, the contact points and remedies. The GDPR (arts. 13 and 14) requires privacy to say
 * who is responsible, the legal bases, the period and the rights. This is where what breaks
 * silently gets caught: a section that vanishes in one language, a reason that changes in
 * the app and grows stale on the page, or a blank field that sneaks back in.
 */
const pasta = fileURLToPath(new URL("..", import.meta.url))
const ler = (ficheiro: string): string => readFileSync(`${pasta}${ficheiro}`, "utf8")

/** The exact reasons from the report sheet (`packages/ui/src/linguas/*.ts`). */
const MOTIVOS = {
  pt: [
    "Abuso sexual de menores",
    "Ameaças ou incitamento à violência",
    "Assédio ou perseguição",
    "Imagens íntimas sem consentimento",
    "Burla, phishing ou spam",
    "Discurso de ódio",
    "Outro conteúdo ilegal",
    "Outro (nota obrigatória)",
  ],
  en: [
    "Sexual abuse of children",
    "Threats or incitement to violence",
    "Harassment or stalking",
    "Intimate images without consent",
    "Fraud, phishing or spam",
    "Hate speech",
    "Other illegal content",
    "Other (note required)",
  ],
} as const

const TERMOS = [
  {
    ficheiro: "pt/termos.html",
    lingua: "pt" as const,
    seccoes: ["<h2>Denúncias</h2>", "<h2>Contacto</h2>"],
    frases: ["Não varremos nada, porque não conseguimos.", "30 dias", "90 dias", "ordem judicial"],
  },
  {
    ficheiro: "terms.html",
    lingua: "en" as const,
    seccoes: ["<h2>Reports</h2>", "<h2>Contact</h2>"],
    frases: ["We scan nothing, because we cannot.", "30 days", "90 days", "court order"],
  },
]

const PRIVACIDADE = [
  {
    ficheiro: "pt/privacidade.html",
    seccoes: ["<h2>Quem é o responsável</h2>", "<h2>Quando denuncias</h2>"],
    artigo: "6.º",
  },
  {
    ficheiro: "privacy.html",
    seccoes: ["<h2>Who is responsible</h2>", "<h2>When you report</h2>"],
    artigo: "Article 6",
  },
]

/** The page text without tags and with spaces joined, for phrases that wrap lines. */
const texto = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe.each(TERMOS)("$ficheiro", (pagina) => {
  const html = ler(pagina.ficheiro)
  it("tem as secções das denúncias e do contacto", () => {
    for (const seccao of pagina.seccoes) expect(html).toContain(seccao)
  })
  it("diz o contacto, a ANACOM e as frases que comprometem", () => {
    expect(html).toContain("orwell.eu@proton.me")
    expect(html).not.toMatch(/contacto@orwell\.pt/)
    expect(html).toContain("ANACOM")
    for (const frase of pagina.frases) expect(texto(html)).toContain(frase)
  })
  it("lista os 8 motivos com as palavras da app", () => {
    for (const motivo of MOTIVOS[pagina.lingua]) expect(texto(html)).toContain(motivo)
  })
})

describe.each(PRIVACIDADE)("$ficheiro", (pagina) => {
  const html = ler(pagina.ficheiro)
  it("tem a secção do responsável e a das denúncias", () => {
    for (const seccao of pagina.seccoes) expect(html).toContain(seccao)
  })
  it("diz o contacto, a CNPD, o prazo de 90 dias e a base legal", () => {
    expect(html).toContain("orwell.eu@proton.me")
    expect(html).not.toMatch(/contacto@orwell\.pt/)
    expect(html).toContain("ANACOM")
    expect(html).toContain("CNPD")
    expect(texto(html)).toMatch(/\b90\b/)
    expect(html).toContain(pagina.artigo)
  })
  it("diz quem é o responsável, sem campos por preencher nem notas para o dono", () => {
    // Owner's decision (4/11/2026): the responsible person is "Duarte Bivar", with no tax ID and no address.
    expect(html).toContain("Duarte Bivar")
    expect(html).not.toMatch(/por preencher|to be filled in|legal-por-preencher|\[dono\]/i)
    expect(texto(html)).not.toMatch(/\bNIF\b|tax number/i)
  })
})

describe.each([...TERMOS, ...PRIVACIDADE].map((p) => p.ficheiro))("%s", (ficheiro) => {
  const html = ler(ficheiro)
  it("não tem aspas angulares nem travessões", () => {
    expect(html).not.toMatch(/[«»]/)
    expect(html).not.toMatch(/[—–]/)
  })
  it("não fala da licença do código nem de revisão por advogado", () => {
    // Owner's orders (4/11/2026): no mention of AGPL, and published without legal review.
    expect(html).not.toMatch(/AGPL/i)
    expect(html).not.toMatch(/advogado|jurídico antes de publicar|lawyer/i)
  })
})
