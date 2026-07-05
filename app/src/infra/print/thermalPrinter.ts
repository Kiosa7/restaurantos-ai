/**
 * Abstracción sobre WebUSB y Web Serial para impresoras térmicas.
 * Solo disponible en Chromium/WebView2 (Tauri y Chrome moderno).
 * Estado: singleton a nivel de módulo (la conexión no se puede serializar).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrinterHandle =
  | { kind: "usb"; device: any; endpoint: number }
  | { kind: "serial"; port: any };

let _handle: PrinterHandle | null = null;

export type PrinterStatus = "connected" | "disconnected" | "unsupported";

export function getPrinterStatus(): PrinterStatus {
  if (_handle) return "connected";
  if (typeof navigator === "undefined") return "unsupported";
  if (!("usb" in navigator) && !("serial" in navigator)) return "unsupported";
  return "disconnected";
}

export function getPrinterKind(): "usb" | "serial" | null {
  return _handle?.kind ?? null;
}

/** Solicita acceso a una impresora USB (class 7 = Printer). */
export async function connectUsb(): Promise<void> {
  const nav = navigator as any;
  if (!nav.usb) throw new Error("WebUSB no disponible en este entorno");
  const device = await nav.usb.requestDevice({ filters: [{ classCode: 7 }] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces[0];
  await device.claimInterface(iface.interfaceNumber);
  const ep = iface.alternates[0].endpoints.find(
    (e: any) => e.direction === "out" && e.type === "bulk",
  );
  if (!ep) throw new Error("No se encontró endpoint OUT en la impresora USB");
  _handle = { kind: "usb", device, endpoint: ep.endpointNumber };
}

/** Solicita acceso a un puerto serial (impresora con cable RS-232). */
export async function connectSerial(baudRate = 9600): Promise<void> {
  const nav = navigator as any;
  if (!nav.serial) throw new Error("Web Serial no disponible en este entorno");
  const port = await nav.serial.requestPort({ filters: [] });
  await port.open({ baudRate });
  _handle = { kind: "serial", port };
}

/**
 * Intenta reconectar automáticamente a una impresora que ya había sido
 * autorizada en sesiones anteriores. Devuelve true si tuvo éxito.
 */
export async function tryReconnect(): Promise<boolean> {
  const nav = navigator as any;
  if (nav.usb) {
    const devices: any[] = await nav.usb.getDevices();
    const printer = devices.find((d: any) =>
      d.deviceClass === 7 ||
      d.configurations?.[0]?.interfaces?.some?.(
        (i: any) => i.alternates?.[0]?.interfaceClass === 7,
      ),
    );
    if (printer) {
      try {
        await printer.open();
        if (printer.configuration === null) await printer.selectConfiguration(1);
        const iface = printer.configuration.interfaces[0];
        await printer.claimInterface(iface.interfaceNumber);
        const ep = iface.alternates[0].endpoints.find(
          (e: any) => e.direction === "out" && e.type === "bulk",
        );
        if (ep) {
          _handle = { kind: "usb", device: printer, endpoint: ep.endpointNumber };
          return true;
        }
      } catch { /* impresora no disponible aún */ }
    }
  }
  if (nav.serial) {
    const ports: any[] = await nav.serial.getPorts();
    if (ports[0]) {
      try {
        await ports[0].open({ baudRate: 9600 });
        _handle = { kind: "serial", port: ports[0] };
        return true;
      } catch { /* puerto ocupado o desconectado */ }
    }
  }
  return false;
}

/** Envía bytes crudos ESC/POS a la impresora conectada. */
export async function sendRaw(data: Uint8Array): Promise<void> {
  if (!_handle) throw new Error("Impresora no conectada");
  if (_handle.kind === "usb") {
    await _handle.device.transferOut(_handle.endpoint, data);
  } else {
    const writer = _handle.port.writable!.getWriter();
    try { await writer.write(data); } finally { writer.releaseLock(); }
  }
}

export function disconnect(): void {
  if (_handle?.kind === "usb") _handle.device.close().catch(() => {});
  _handle = null;
}
