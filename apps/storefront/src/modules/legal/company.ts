/**
 * Company identity used by the legal pages (Aviso de privacidad and Términos y
 * condiciones). Keep these values in ONE place so both documents always name
 * the same responsible party, address, and contact channel.
 *
 * The business is operated by an individual (persona física), so `LEGAL_NAME`
 * is the owner's full name and `LEGAL_IDENTITY` is how both documents introduce
 * him. The RFC is intentionally omitted: neither the privacy law nor consumer
 * law requires publishing it.
 */
export const LEGAL_COMPANY = {
  BRAND: "MANDI",
  LEGAL_NAME: "David Téllez López",
  LEGAL_IDENTITY:
    "David Téllez López, persona física con actividad empresarial que opera bajo el nombre comercial MANDI",
  ADDRESS:
    "Planetas 1, Col. El Rosario, C.P. 02100, Alcaldía Azcapotzalco, Ciudad de México, México",
  EMAIL: "comercial@mandimexico.com",
  PHONE: "55 2913 0187",
  WEBSITE: "mandimexico.com",
  /** Date shown as "Última actualización" on both documents. */
  LAST_UPDATED: "27 de noviembre de 2026",
} as const
