/**
 * Punto único para imprimir bytes ESC/POS: intenta reconectar a una
 * impresora ya autorizada, y si no hay ninguna, pide una nueva (WebUSB/Serial,
 * requiere gesto del usuario — por eso esto SIEMPRE se llama desde un
 * onClick, nunca automáticamente). Sin impresora física conectada (⛔ spike 2,
 * pendiente conseguir), esto lanza un error legible en vez de fallar en silencio.
 */
import { connectUsb, getPrinterStatus, sendRaw, tryReconnect } from "./thermalPrinter";

export async function printTicket(bytes: Uint8Array): Promise<void> {
  if (getPrinterStatus() === "unsupported") {
    throw new Error("Este navegador no soporta WebUSB/Web Serial — usa Chrome/Edge en el hub Tauri.");
  }
  if (getPrinterStatus() !== "connected") {
    const reconnected = await tryReconnect();
    if (!reconnected) await connectUsb();
  }
  await sendRaw(bytes);
}
