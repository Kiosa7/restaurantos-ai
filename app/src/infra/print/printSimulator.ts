/**
 * "Impresora" simulada (puerto TS de spikes/escpos/simulator.mjs): decodifica
 * bytes ESC/POS a comandos estructurados + preview ASCII, para probar sin
 * hardware físico. Sigue sin sustituir la validación con impresora real
 * (⛔ spike 2, docs/spikes/spike-2-escpos.md).
 */
export type SimCommand =
  | { op: "init" }
  | { op: "align"; value: "left" | "center" | "right" }
  | { op: "bold"; value: boolean }
  | { op: "size"; width: number; height: number }
  | { op: "cutPartial" }
  | { op: "cutFull" }
  | { op: "openDrawer"; pin: number; onMs: number; offMs: number }
  | { op: "feed" };

export function simulate(bytes: Uint8Array): { cmds: SimCommand[]; preview: string } {
  const cmds: SimCommand[] = [];
  const lines: string[] = [];
  let current = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x1b && bytes[i + 1] === 0x40) {
      cmds.push({ op: "init" });
      i += 2;
    } else if (b === 0x1b && bytes[i + 1] === 0x61) {
      cmds.push({ op: "align", value: (["left", "center", "right"] as const)[bytes[i + 2]] });
      i += 3;
    } else if (b === 0x1b && bytes[i + 1] === 0x45) {
      cmds.push({ op: "bold", value: bytes[i + 2] === 1 });
      i += 3;
    } else if (b === 0x1d && bytes[i + 1] === 0x21) {
      const n = bytes[i + 2];
      cmds.push({ op: "size", width: ((n >> 4) & 0x07) + 1, height: (n & 0x07) + 1 });
      i += 3;
    } else if (b === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x01) {
      cmds.push({ op: "cutPartial" });
      i += 3;
    } else if (b === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x00) {
      cmds.push({ op: "cutFull" });
      i += 3;
    } else if (b === 0x1b && bytes[i + 1] === 0x70) {
      cmds.push({ op: "openDrawer", pin: bytes[i + 2], onMs: bytes[i + 3], offMs: bytes[i + 4] });
      i += 5;
    } else if (b === 0x0a) {
      lines.push(current);
      current = "";
      cmds.push({ op: "feed" });
      i += 1;
    } else {
      current += String.fromCharCode(b);
      i += 1;
    }
  }
  if (current) lines.push(current);
  return { cmds, preview: lines.join("\n") };
}
