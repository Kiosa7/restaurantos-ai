/**
 * Cifrado AES-256-GCM del snapshot JSON usando Web Crypto API. Copiado tal
 * cual de pos-inteligente (`app/src/app/usecases/encryptedBackup.ts`, ADR-1
 * §2.1) — el algoritmo no cambia, solo el magic header del archivo (para no
 * confundir backups de un producto con el otro) y qué JSON se cifra (aquí,
 * el snapshot de `GET /backup/export` del hub, no el de pos-inteligente).
 * Sin dependencias externas. La contraseña se convierte en clave con PBKDF2.
 *
 * Formato del archivo cifrado (.restaurantosbackup):
 *   [4 bytes  versión "RES1"]
 *   [16 bytes salt PBKDF2]
 *   [12 bytes IV AES-GCM]
 *   [N bytes  ciphertext + 16-byte auth tag]
 */

const MAGIC = new Uint8Array([0x52, 0x45, 0x53, 0x31]); // "RES1"
const PBKDF2_ITER = 200_000;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"],
  );
  // salt.buffer.slice(0) retorna un ArrayBuffer (no ArrayBufferLike) → compatible con Web Crypto
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer.slice(0) as ArrayBuffer, iterations: PBKDF2_ITER, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Cifra el JSON del snapshot y retorna los bytes del archivo .restaurantosbackup. */
export async function encryptBackup(json: string, password: string): Promise<Uint8Array> {
  // Crear buffers con ArrayBuffer explícito para evitar problemas de tipo con SharedArrayBuffer
  const salt = new Uint8Array(16); crypto.getRandomValues(salt);
  const iv   = new Uint8Array(12); crypto.getRandomValues(iv);
  const key  = await deriveKey(password, salt);

  const plaintext = new TextEncoder().encode(json);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );

  // Ensamblar: magic + salt + iv + ciphertext
  const out = new Uint8Array(4 + 16 + 12 + ciphertext.byteLength);
  let offset = 0;
  out.set(MAGIC, offset);      offset += 4;
  out.set(salt, offset);       offset += 16;
  out.set(iv, offset);         offset += 12;
  out.set(ciphertext, offset);
  return out;
}

/** Descifra un archivo .restaurantosbackup y retorna el JSON original. */
export async function decryptBackup(bytes: Uint8Array, password: string): Promise<string> {
  if (bytes.length < 4 + 16 + 12 + 16) throw new Error("Archivo inválido o corrupto.");

  const magic = bytes.slice(0, 4);
  if (!magic.every((b, i) => b === MAGIC[i])) {
    throw new Error("No es un backup de RestaurantOS AI (cabecera inválida).");
  }

  let offset = 4;
  const salt       = bytes.slice(offset, offset + 16); offset += 16;
  const iv         = bytes.slice(offset, offset + 12); offset += 12;
  const ciphertext = bytes.slice(offset);

  const key = await deriveKey(password, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    throw new Error("Contraseña incorrecta o archivo dañado.");
  }
  return new TextDecoder().decode(plaintext);
}
