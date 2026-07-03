// Codificador ESC/POS mínimo (sin dependencias). Genera los mismos bytes que
// entenderían impresoras térmicas 80mm genéricas (Epson TM-T20 y compatibles
// "clon" chinas, que son lo más común en restaurantes mexicanos).
// Referencia de comandos: Epson ESC/POS Command Reference.

const ESC = 0x1b;
const GS = 0x1d;

export class TicketBuilder {
  constructor() {
    /** @type {number[]} */
    this.bytes = [];
  }
  raw(...b) {
    this.bytes.push(...b);
    return this;
  }
  init() {
    return this.raw(ESC, 0x40); // ESC @
  }
  align(a) {
    const n = a === "center" ? 1 : a === "right" ? 2 : 0;
    return this.raw(ESC, 0x61, n); // ESC a n
  }
  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0); // ESC E n
  }
  /** width/height 1..8 (1 = normal) */
  size(width = 1, height = 1) {
    const n = ((width - 1) & 0x07) << 4 | ((height - 1) & 0x07);
    return this.raw(GS, 0x21, n); // GS ! n
  }
  text(str) {
    // CP437/ASCII: las impresoras térmicas baratas no traen UTF-8 por default.
    // Se normalizan acentos a ASCII plano — riesgo documentado abajo (§4).
    const ascii = stripAccents(str);
    for (let i = 0; i < ascii.length; i++) this.bytes.push(ascii.charCodeAt(i) & 0xff);
    return this;
  }
  line(str = "") {
    return this.text(str).feed(1);
  }
  feed(lines = 1) {
    for (let i = 0; i < lines; i++) this.bytes.push(0x0a);
    return this;
  }
  hr(width = 42, ch = "-") {
    return this.line(ch.repeat(width));
  }
  /** Corte parcial (deja una pestaña); el estándar para tickets de restaurante. */
  cutPartial() {
    return this.raw(GS, 0x56, 0x01);
  }
  cutFull() {
    return this.raw(GS, 0x56, 0x00);
  }
  /** Abre el cajón de dinero conectado al puerto RJ11 de la impresora. */
  openDrawer(pin = 0, onMs = 25, offMs = 250) {
    return this.raw(ESC, 0x70, pin, onMs, offMs); // ESC p m t1 t2
  }
  build() {
    return Uint8Array.from(this.bytes);
  }
}

function stripAccents(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/gi, (m) => (m === "ñ" ? "n" : "N"));
}
