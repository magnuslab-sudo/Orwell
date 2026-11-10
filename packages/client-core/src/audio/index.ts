/**
 * What the voice chain shows outside the core. The control lives in
 * `Call.audio`; from here come the types and lists for the interface to draw.
 */
export {
  CHAVES_DE_PREFERENCIA,
  ControloDeVoz,
  LIMIAR_MAXIMO_DB,
  LIMIAR_MINIMO_DB,
  type EstadoDoAudio,
  type FonteDePreferenciasDeAudio,
  type MedidaDoAudio,
} from "./controlo.js"
export {
  ETAPAS_DE_AUDIO,
  PERFIL_DE_AUDIO_POR_OMISSAO,
  PERFIS_DE_AUDIO,
  type EtapasDaCadeia,
  type NomeDaEtapa,
  type PerfilDeAudio,
} from "./perfis.js"
