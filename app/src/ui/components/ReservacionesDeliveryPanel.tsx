import { useEffect, useState } from "react";
import { CalendarClock, Bike } from "lucide-react";
import { Button, Card, Input } from "@ui/components/ui";
import {
  createDeliveryOrder,
  createReservation,
  fetchDeliveryOrders,
  fetchReservations,
  updateDeliveryStatus,
  updateReservationStatus,
  type DeliveryOrder,
  type Reservation,
} from "@infra/hub/hubApi";

/**
 * Reservaciones y delivery/para llevar (Fase 7 §10.1 puntos 5/6). Delivery
 * reutiliza el pipeline de comandas vía mesas virtuales (mesa 90/91) — un
 * pedido a domicilio creado aquí aparece igual en `CajaScreen` como
 * "Mesa 91" y se cobra con el mismo flujo de siempre.
 */
export function ReservacionesDeliveryPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryOrder[]>([]);
  const [resName, setResName] = useState("");
  const [resPeople, setResPeople] = useState("2");
  const [resWhen, setResWhen] = useState("");
  const [delChannel, setDelChannel] = useState<"para_llevar" | "domicilio">("para_llevar");
  const [delName, setDelName] = useState("");
  const [delAddress, setDelAddress] = useState("");
  const [delProduct, setDelProduct] = useState("");
  const [delQty, setDelQty] = useState("1");
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function refrescar() {
    setReservations(await fetchReservations(apiUrl));
    setDeliveries(await fetchDeliveryOrders(apiUrl));
  }

  useEffect(() => {
    refrescar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  async function agregarReservacion() {
    if (!resName.trim() || !resWhen) return;
    await createReservation({ customerName: resName, partySize: Number(resPeople), reservedAt: new Date(resWhen).getTime() }, apiUrl);
    setResName("");
    setResWhen("");
    await refrescar();
  }

  async function crearDelivery() {
    if (!delName.trim() || !delProduct.trim()) return;
    try {
      await createDeliveryOrder(
        {
          channel: delChannel,
          customerName: delName,
          address: delChannel === "domicilio" ? delAddress : undefined,
          items: [{ productId: delProduct, cantidad: Number(delQty) || 1 }],
        },
        apiUrl,
      );
      setMensaje("Pedido creado — ya aparece en Caja para cobrarse igual que cualquier mesa.");
      setDelName("");
      setDelAddress("");
      setDelProduct("");
      await refrescar();
    } catch (e) {
      setMensaje(`Error: ${(e as Error).message}`);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
          <CalendarClock className="h-4 w-4 text-brand" /> Reservaciones
        </h2>
        <div className="mb-3 flex flex-col gap-2">
          <Input value={resName} onChange={(e) => setResName(e.target.value)} placeholder="Nombre del cliente" />
          <div className="flex gap-2">
            <Input value={resPeople} onChange={(e) => setResPeople(e.target.value.replace(/\D/g, ""))} placeholder="Personas" />
            <Input type="datetime-local" value={resWhen} onChange={(e) => setResWhen(e.target.value)} />
          </div>
          <Button size="sm" onClick={agregarReservacion}>Reservar</Button>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {reservations.map((r) => (
            <li key={r.reservationId} className="flex items-center justify-between border-b border-slate-100 py-1">
              <span>{r.cliente} · {r.personas}p · {new Date(r.horaReservada).toLocaleString("es-MX")}</span>
              <select
                className="rounded border border-slate-200 text-xs"
                value={r.estado}
                onChange={(e) => updateReservationStatus(r.reservationId, e.target.value as Reservation["estado"], apiUrl).then(refrescar)}
              >
                <option value="confirmada">Confirmada</option>
                <option value="sentada">Sentada</option>
                <option value="cancelada">Cancelada</option>
                <option value="no_show">No llegó</option>
              </select>
            </li>
          ))}
          {reservations.length === 0 && <li className="text-slate-400">Sin reservaciones.</li>}
        </ul>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
          <Bike className="h-4 w-4 text-brand" /> Delivery / para llevar
        </h2>
        <div className="mb-3 flex flex-col gap-2">
          <select className="rounded-[var(--radius-field)] border border-slate-300 px-3 py-2 text-sm" value={delChannel} onChange={(e) => setDelChannel(e.target.value as "para_llevar" | "domicilio")}>
            <option value="para_llevar">Para llevar</option>
            <option value="domicilio">A domicilio</option>
          </select>
          <Input value={delName} onChange={(e) => setDelName(e.target.value)} placeholder="Nombre del cliente" />
          {delChannel === "domicilio" && <Input value={delAddress} onChange={(e) => setDelAddress(e.target.value)} placeholder="Dirección" />}
          <div className="flex gap-2">
            <Input value={delProduct} onChange={(e) => setDelProduct(e.target.value)} placeholder="id de platillo (ej. mi_tacos_pastor)" className="flex-1" />
            <Input value={delQty} onChange={(e) => setDelQty(e.target.value.replace(/\D/g, ""))} placeholder="Cant." />
          </div>
          <Button size="sm" onClick={crearDelivery}>Crear pedido</Button>
        </div>
        {mensaje && <p className="mb-2 text-xs text-slate-500">{mensaje}</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {deliveries.map((d) => (
            <li key={d.deliveryOrderId} className="flex items-center justify-between border-b border-slate-100 py-1">
              <span>{d.canal === "domicilio" ? "🚴" : "🥡"} {d.cliente}</span>
              <select
                className="rounded border border-slate-200 text-xs"
                value={d.estado}
                onChange={(e) => updateDeliveryStatus(d.deliveryOrderId, e.target.value as DeliveryOrder["estado"], apiUrl).then(refrescar)}
              >
                <option value="recibido">Recibido</option>
                <option value="preparando">Preparando</option>
                <option value="listo">Listo</option>
                <option value="en_camino">En camino</option>
                <option value="entregado">Entregado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </li>
          ))}
          {deliveries.length === 0 && <li className="text-slate-400">Sin pedidos.</li>}
        </ul>
      </Card>
    </div>
  );
}
