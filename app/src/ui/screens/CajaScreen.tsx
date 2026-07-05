import { useEffect, useRef, useState } from "react";
import { Button, Card, Segmented, useToast } from "@ui/components/ui";
import { SplitBillSheet, TipSelector, type SplitMode } from "@ui/components/restaurant";
import { formatMoney, cents } from "@domain/money";
import { HubClient } from "@infra/hub/hubClient";
import { checkout, closeShift, fetchOpenOrders, openShift, type OpenOrder } from "@infra/hub/hubApi";
import { cuentaTicket } from "@infra/print/tickets";
import { printTicket } from "@infra/print/printClient";
import { BackupPanel } from "@ui/components/BackupPanel";
import { AsistentePanel } from "@ui/components/AsistentePanel";
import { PairingPanel } from "@ui/components/PairingPanel";

// MVP (Fase 6 §10.5): un solo mesero de turno del seed demo. RBAC/PIN (§10.6)
// ya autentica a quien opera la Caja (ver PinGate en App.tsx), pero el turno
// se sigue abriendo a nombre de este empleado fijo — usar el mesero real
// (otro PIN, distinto del cajero) queda para Fase 7.
const EMPLOYEE_MESERO = "e-mesero";

/** Caja: ve las comandas abiertas del hub, divide y cobra (Fase 6 §10.2). */
export function CajaScreen({ hubUrl = "ws://localhost:5190/ws", apiUrl = "http://localhost:5190" }: { hubUrl?: string; apiUrl?: string }) {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "tarjeta">("efectivo");
  const [tipPct, setTipPct] = useState<number | "otro" | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [ultimoCobro, setUltimoCobro] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [turnoResumen, setTurnoResumen] = useState<string | null>(null);
  const [ultimaCuenta, setUltimaCuenta] = useState<Uint8Array | null>(null);
  const hubRef = useRef<HubClient | null>(null);
  const { toast } = useToast();

  async function refrescarOrdenes() {
    setOrders(await fetchOpenOrders(apiUrl));
  }

  useEffect(() => {
    refrescarOrdenes();
    const client = new HubClient({ url: `${hubUrl}?role=caja&device=caja-1`, onEvent: () => refrescarOrdenes() });
    hubRef.current = client;
    return () => client.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubUrl, apiUrl]);

  const selected = orders.find((o) => o.orderId === selectedId) ?? null;
  const tipCents = selected && tipPct && tipPct !== "otro" ? Math.round((selected.totalCents * tipPct) / 100) : 0;

  async function abrirTurno() {
    const r = await openShift(EMPLOYEE_MESERO, apiUrl);
    setShiftId(r.shiftId);
    setTurnoResumen(null);
  }

  async function cerrarTurno() {
    if (!shiftId) return;
    const r = await closeShift(shiftId, apiUrl);
    setTurnoResumen(`Turno cerrado. Propinas repartidas: ${formatMoney(cents(r.totalTipsCents))}`);
    setShiftId(null);
  }

  async function cobrar(mode: SplitMode, partes: number) {
    if (!selected) return;
    setCobrando(true);
    try {
      const res = await checkout(
        { orderId: selected.orderId, splitMode: mode, partes, paymentMethod, tipCents, shiftId: shiftId ?? undefined },
        apiUrl,
      );
      setUltimoCobro(`Mesa ${res.mesa}: ${res.partes} venta(s) por ${formatMoney(cents(res.totalCents))} total.`);
      setUltimaCuenta(
        cuentaTicket({
          folio: res.saleIds[0].slice(0, 8),
          mesa: res.mesa,
          items: selected.items.map((it) => ({ cantidad: it.cantidad, nombre: it.nombre, lineTotalCents: it.lineTotalCents })),
          totalCents: res.totalCents,
          propinaSugeridaPct: mode === "completo" ? [10, 15, 20] : undefined,
          metodoPago: paymentMethod,
        }),
      );
      setSelectedId(null);
      setTipPct(null);
      await refrescarOrdenes();
    } catch (e) {
      setUltimoCobro(`Error al cobrar: ${(e as Error).message}`);
    } finally {
      setCobrando(false);
    }
  }

  /** ⛔ Requiere impresora térmica 80mm real (spike 2, pendiente conseguir);
   * sin ella falla con mensaje legible en vez de romper la pantalla. */
  async function imprimirCuenta() {
    if (!ultimaCuenta) return;
    try {
      await printTicket(ultimaCuenta);
      toast("Cuenta enviada a la impresora", "success");
    } catch (e) {
      toast(`No se pudo imprimir: ${(e as Error).message}`, "warning");
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-[1fr_22rem]">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Caja — comandas abiertas</h1>
          <div className="flex items-center gap-2">
            {shiftId ? (
              <Button size="sm" variant="outline" onClick={cerrarTurno}>Cerrar turno</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={abrirTurno}>Abrir turno</Button>
            )}
          </div>
        </div>
        {turnoResumen && <p className="mb-3 text-sm text-success">{turnoResumen}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((o) => (
            <button
              key={o.orderId}
              type="button"
              onClick={() => { setSelectedId(o.orderId); setTipPct(null); }}
              className={`min-h-[var(--spacing-touch)] rounded-[var(--radius-card)] border-2 p-4 text-left shadow-sm transition-all active:scale-[0.98] ${
                selectedId === o.orderId ? "border-brand bg-brand-soft" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <p className="text-lg font-semibold text-slate-800">Mesa {o.mesa}</p>
              <p className="text-sm text-slate-500">{o.items.length} platillo(s)</p>
              <p className="font-bold text-slate-800">{formatMoney(cents(o.totalCents))}</p>
            </button>
          ))}
          {orders.length === 0 && <p className="text-slate-400">No hay comandas abiertas.</p>}
        </div>
      </div>

      <Card className="h-fit p-4">
        {!selected && <p className="text-slate-400">Selecciona una mesa para cobrar.</p>}
        {selected && (
          <div className="flex flex-col gap-4">
            <h2 className="font-semibold text-slate-800">Mesa {selected.mesa}</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {selected.items.map((it) => (
                <li key={it.orderItemId} className="flex justify-between border-b border-slate-100 pb-1">
                  <span>{it.cantidad}× {it.nombre}</span>
                  <span className="text-slate-500">{formatMoney(cents(it.lineTotalCents))}</span>
                </li>
              ))}
            </ul>

            <Segmented
              value={paymentMethod}
              onChange={(v) => setPaymentMethod(v as "efectivo" | "tarjeta")}
              options={[{ value: "efectivo", label: "Efectivo" }, { value: "tarjeta", label: "Tarjeta" }]}
            />

            <TipSelector totalCents={cents(selected.totalCents)} value={tipPct} onChange={setTipPct} />

            <SplitBillSheet totalCents={cents(selected.totalCents + tipCents)} onConfirm={cobrar} />
            {cobrando && <p className="text-sm text-slate-500">Procesando cobro…</p>}
          </div>
        )}
        {ultimoCobro && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm text-slate-600">{ultimoCobro}</p>
            {ultimaCuenta && (
              <Button size="sm" variant="outline" onClick={imprimirCuenta}>Imprimir cuenta</Button>
            )}
          </div>
        )}
      </Card>

      <div className="md:col-span-2">
        <AsistentePanel apiUrl={apiUrl} />
      </div>
      <div className="md:col-span-2">
        <PairingPanel apiUrl={apiUrl} />
      </div>
      <div className="md:col-span-2">
        <BackupPanel apiUrl={apiUrl} />
      </div>
    </div>
  );
}
