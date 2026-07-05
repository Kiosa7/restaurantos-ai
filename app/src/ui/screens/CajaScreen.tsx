import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Segmented, useToast } from "@ui/components/ui";
import { SplitBillSheet, TipSelector, type SplitMode } from "@ui/components/restaurant";
import { formatMoney, cents } from "@domain/money";
import { HubClient } from "@infra/hub/hubClient";
import { checkout, closeShift, fetchCustomers, fetchOpenOrders, generateCfdi, openShift, type Customer, type OpenOrder } from "@infra/hub/hubApi";
import { cuentaTicket } from "@infra/print/tickets";
import { printTicket } from "@infra/print/printClient";
import { BackupPanel } from "@ui/components/BackupPanel";
import { AsistentePanel } from "@ui/components/AsistentePanel";
import { PairingPanel } from "@ui/components/PairingPanel";
import { ComprasPanel } from "@ui/components/ComprasPanel";
import { ReservacionesDeliveryPanel } from "@ui/components/ReservacionesDeliveryPanel";
import { FacturaGlobalPanel } from "@ui/components/FacturaGlobalPanel";

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
  const [ultimaSaleId, setUltimaSaleId] = useState<string | null>(null);
  const [rfcReceptor, setRfcReceptor] = useState("XAXX010101000");
  const [nombreReceptor, setNombreReceptor] = useState("PUBLICO EN GENERAL");
  const [facturando, setFacturando] = useState(false);
  const [factura, setFactura] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const hubRef = useRef<HubClient | null>(null);
  const { toast } = useToast();

  async function refrescarOrdenes() {
    setOrders(await fetchOpenOrders(apiUrl));
  }

  useEffect(() => {
    refrescarOrdenes();
    fetchCustomers(apiUrl).then(setCustomers);
    const client = new HubClient({ url: `${hubUrl}?role=caja&device=caja-1`, onEvent: () => refrescarOrdenes() });
    hubRef.current = client;
    return () => client.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubUrl, apiUrl]);

  const clienteElegido = customers.find((c) => c.customerId === customerId) ?? null;

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
        {
          orderId: selected.orderId, splitMode: mode, partes, paymentMethod, tipCents, shiftId: shiftId ?? undefined,
          customerId: customerId || undefined,
          redeemPoints: redeemPoints ? Number(redeemPoints) : undefined,
        },
        apiUrl,
      );
      const descuento = res.discountCents ? ` (descuento ${formatMoney(cents(res.discountCents))})` : "";
      const puntos = res.puntosGanados ? ` · ${res.puntosGanados} puntos ganados` : "";
      setUltimoCobro(`Mesa ${res.mesa}: ${res.partes} venta(s) por ${formatMoney(cents(res.totalCents))} total${descuento}${puntos}.`);
      setCustomerId("");
      setRedeemPoints("");
      setUltimaSaleId(res.saleIds[0]);
      setFactura(null);
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

  /** Genera el CFDI 4.0 de la última venta (Fase 7). ⛔ Solo genera el
   * documento — timbrarlo de verdad contra un PAC sigue bloqueado (spike 3,
   * falta cuenta de SW Sapien/Facturama). */
  async function facturar() {
    if (!ultimaSaleId) return;
    setFacturando(true);
    try {
      const doc = await generateCfdi({ saleId: ultimaSaleId, rfcReceptor, nombreReceptor }, apiUrl);
      setFactura(`CFDI folio ${doc.folio} generado (estado: ${doc.estado}). ${doc.nota ?? ""}`);
    } catch (e) {
      setFactura(`No se pudo generar el CFDI: ${(e as Error).message}`);
    } finally {
      setFacturando(false);
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

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-600" htmlFor="cliente-select">Cliente (opcional — fidelización)</label>
              <select
                id="cliente-select"
                className="w-full rounded-[var(--radius-field)] border border-slate-300 bg-white px-3 py-2 text-sm"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Sin cliente</option>
                {customers.map((c) => (
                  <option key={c.customerId} value={c.customerId}>{c.nombre} ({c.puntos} pts)</option>
                ))}
              </select>
              {clienteElegido && clienteElegido.puntos > 0 && (
                <Input
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value.replace(/\D/g, ""))}
                  placeholder={`Puntos a redimir (máx. ${clienteElegido.puntos})`}
                />
              )}
            </div>

            <TipSelector totalCents={cents(selected.totalCents)} value={tipPct} onChange={setTipPct} />

            <SplitBillSheet totalCents={cents(selected.totalCents + tipCents)} onConfirm={cobrar} />
            {cobrando && <p className="text-sm text-slate-500">Procesando cobro…</p>}
          </div>
        )}
        {ultimoCobro && (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-slate-600">{ultimoCobro}</p>
            {ultimaCuenta && (
              <Button size="sm" variant="outline" onClick={imprimirCuenta}>Imprimir cuenta</Button>
            )}
            {ultimaSaleId && !factura && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-field)] border border-slate-200 p-3">
                <p className="text-xs font-semibold text-slate-500">Facturar (CFDI 4.0)</p>
                <Input value={rfcReceptor} onChange={(e) => setRfcReceptor(e.target.value.toUpperCase())} placeholder="RFC receptor" />
                <Input value={nombreReceptor} onChange={(e) => setNombreReceptor(e.target.value)} placeholder="Nombre / razón social" />
                <Button size="sm" onClick={facturar} loading={facturando}>Generar factura</Button>
              </div>
            )}
            {factura && <p className="text-xs text-slate-500">{factura}</p>}
          </div>
        )}
      </Card>

      <div className="md:col-span-2">
        <ReservacionesDeliveryPanel apiUrl={apiUrl} />
      </div>
      <div className="md:col-span-2">
        <ComprasPanel apiUrl={apiUrl} />
      </div>
      <div className="md:col-span-2">
        <FacturaGlobalPanel apiUrl={apiUrl} />
      </div>
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
