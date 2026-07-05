/**
 * Codificador ESC/POS (puerto TS de spikes/escpos/encoder.mjs, Fase 6 §10.4).
 * Sin dependencias — genera los mismos bytes que entienden impresoras
 * térmicas 80mm genéricas (Epson TM-T20 y compatibles "clon" chinas).
 * Transporte real (WebUSB/Serial) en `./thermalPrinter.ts`.
 */
const ESC = 0x1b;
const GS = 0x1d;

export class TicketBuilder {
  private bytes: number[] = [];

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  init(): this {
    return this.raw(ESC, 0x40); // ESC @
  }
  align(a: "left" | "center" | "right"): this {
    const n = a === "center" ? 1 : a === "right" ? 2 : 0;
    return this.raw(ESC, 0x61, n); // ESC a n
  }
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0); // ESC E n
  }
  /** width/height 1..8 (1 = normal) */
  size(width = 1, height = 1): this {
    const n = (((width - 1) & 0x07) << 4) | ((height - 1) & 0x07);
    return this.raw(GS, 0x21, n); // GS ! n
  }
  text(str: string): this {
    // CP437/ASCII: las impresoras térmicas baratas no traen UTF-8 por default
    // (ver limitación documentada en docs/spikes/spike-2-escpos.md).
    const ascii = stripAccents(str);
    for (let i = 0; i < ascii.length; i++) this.bytes.push(ascii.charCodeAt(i) & 0xff);
    return this;
  }
  line(str = ""): this {
    return this.text(str).feed(1);
  }
  feed(lines = 1): this {
    for (let i = 0; i < lines; i++) this.bytes.push(0x0a);
    return this;
  }
  hr(width = 42, ch = "-"): this {
    return this.line(ch.repeat(width));
  }
  /** Corte parcial (deja una pestaña); el estándar para tickets de restaurante. */
  cutPartial(): this {
    return this.raw(GS, 0x56, 0x01);
  }
  cutFull(): this {
    return this.raw(GS, 0x56, 0x00);
  }
  /** Abre el cajón de dinero conectado al puerto RJ11 de la impresora. */
  openDrawer(pin = 0, onMs = 25, offMs = 250): this {
    return this.raw(ESC, 0x70, pin, onMs, offMs); // ESC p m t1 t2
  }
  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/gi, (m) => (m === "ñ" ? "n" : "N"));
}
