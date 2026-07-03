/**
 * UUID v7: identificador único global y ORDENABLE POR TIEMPO.
 * Elegido como PK del sistema (ver docs/db/README.md):
 *  - sin colisiones entre sucursales/dispositivos (clave para el sync)
 *  - ordenable temporalmente → mejor localidad de índice que v4
 *
 * Layout (RFC 9562): 48 bits de timestamp ms | versión 7 | aleatorio.
 */
export function uuidv7(now: number = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));

  // 48 bits de timestamp (big-endian) en los primeros 6 bytes
  b[0] = Math.floor(now / 2 ** 40) & 0xff;
  b[1] = Math.floor(now / 2 ** 32) & 0xff;
  b[2] = Math.floor(now / 2 ** 24) & 0xff;
  b[3] = Math.floor(now / 2 ** 16) & 0xff;
  b[4] = Math.floor(now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;

  b[6] = (b[6] & 0x0f) | 0x70; // versión 7
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122

  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
