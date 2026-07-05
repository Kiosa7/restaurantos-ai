import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@ui/components/ui";
import { FloorPlan, ModifierPicker, type FloorTable } from "@ui/components/restaurant";
import { formatMoney } from "@domain/money";
import { createDraftOrder, orderTotalCents, type DraftOrder } from "@domain/order";
import type { Categoria, MenuItem } from "@domain/menu";
import { addItemByTapping } from "@ui/flows/comandaFlow";
import { HubClient } from "@infra/hub/hubClient";
import { fetchMenu, fetchTables } from "@infra/hub/hubApi";

type Vista = { paso: "mesas" } | { paso: "categorias" } | { paso: "platillos"; categoriaId: string } | { paso: "modificadores"; item: MenuItem };

/**
 * Pantalla del mesero: FloorPlan → categoría → platillo → (modificadores) →
 * comanda. Flujo 1 de docs/ux/flujos-casos-uso.md. El menú y las mesas vienen
 * del hub real (`GET /menu`, `GET /tables` — Fase 6 §10.1), no de datos
 * locales: lo que el mesero ve es el catálogo persistido en SQLite.
 */
export function MeseroScreen({ hubUrl = "ws://localhost:5190/ws", apiUrl = "http://localhost:5190" }: { hubUrl?: string; apiUrl?: string }) {
  const [mesas, setMesas] = useState<FloorTable[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cargando, setCargando] = useState(true);

  const [mesa, setMesa] = useState<FloorTable | null>(null);
  const [order, setOrder] = useState<DraftOrder | null>(null);
  const [vista, setVista] = useState<Vista>({ paso: "mesas" });
  const [ultimoConteo, setUltimoConteo] = useState<number | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [conectado, setConectado] = useState(false);
  const hubRef = useRef<HubClient | null>(null);

  useEffect(() => {
    Promise.all([fetchMenu(apiUrl), fetchTables(apiUrl)])
      .then(([menu, tables]) => {
        setCategorias(menu.categorias);
        setMenuItems(menu.items);
        setMesas(tables);
      })
      .finally(() => setCargando(false));
  }, [apiUrl]);

  useEffect(() => {
    const client = new HubClient({ url: `${hubUrl}?role=mesero&device=tablet-1`, onHello: () => setConectado(true), onEvent: () => {} });
    hubRef.current = client;
    return () => client.close();
  }, [hubUrl]);

  function enviarAcocina() {
    if (!order || order.items.length === 0) return;
    hubRef.current?.sendCommand("nueva_comanda", {
      tableNumber: order.mesa,
      items: order.items.map((it) => ({
        productId: it.menuItemId,
        cantidad: it.cantidad,
        modificadores: it.modificadores.map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
        notas: it.notas || undefined,
      })),
    });
    setEnviado(true);
  }

  function seleccionarMesa(t: FloorTable) {
    setMesa(t);
    setOrder(createDraftOrder(t.numero));
    setVista({ paso: "categorias" });
  }

  function agregarPlatillo(item: MenuItem, chosen: Record<string, string>) {
    if (!order) return;
    const { order: next, taps } = addItemByTapping(order, item, chosen);
    setOrder(next);
    setUltimoConteo(taps);
    setEnviado(false);
    setVista({ paso: "categorias" });
  }

  if (cargando) {
    return <p className="p-4 text-slate-500">Cargando menú y mesas del hub…</p>;
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 md:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="mb-4 text-2xl font-bold text-slate-800">
          {mesa ? `Mesa ${mesa.numero}` : "Selecciona una mesa"}
        </h1>

        {vista.paso === "mesas" && <FloorPlan tables={mesas} onSelect={seleccionarMesa} selectedTableId={mesa?.id} />}

        {vista.paso === "categorias" && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {categorias.map((c) => (
              <Button key={c.id} variant="outline" size="lg" onClick={() => setVista({ paso: "platillos", categoriaId: c.id })}>
                {c.nombre}
              </Button>
            ))}
            <Button variant="ghost" size="lg" onClick={() => setVista({ paso: "mesas" })}>
              ← Mesas
            </Button>
          </div>
        )}

        {vista.paso === "platillos" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {menuItems
              .filter((m) => m.categoria === vista.categoriaId)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    item.modifierGroups.some((g) => g.requerido)
                      ? setVista({ paso: "modificadores", item })
                      : agregarPlatillo(item, {})
                  }
                  className="min-h-[var(--spacing-touch)] rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 text-left shadow-sm transition-all active:scale-[0.98] hover:bg-slate-50"
                >
                  <p className="font-semibold text-slate-800">{item.nombre}</p>
                  <p className="text-sm text-slate-500">{formatMoney(item.precioCents)}</p>
                </button>
              ))}
            <Button variant="ghost" onClick={() => setVista({ paso: "categorias" })}>
              ← Categorías
            </Button>
          </div>
        )}

        {vista.paso === "modificadores" && (
          <Card className="p-4">
            <ModifierPicker
              menuItemNombre={vista.item.nombre}
              groups={vista.item.modifierGroups}
              onComplete={(chosen) => agregarPlatillo(vista.item, chosen)}
              onCancel={() => setVista({ paso: "categorias" })}
            />
          </Card>
        )}
      </div>

      <Card className="h-fit p-4">
        <h2 className="mb-3 font-semibold text-slate-800">Comanda en construcción</h2>
        {ultimoConteo !== null && (
          <p className="mb-2 text-xs text-slate-500">Último platillo agregado en {ultimoConteo} toque(s).</p>
        )}
        <ul className="mb-3 flex flex-col gap-2 text-sm">
          {order?.items.map((it) => (
            <li key={it.id} className="flex justify-between border-b border-slate-100 pb-1">
              <span>{it.cantidad}× {it.nombre}</span>
              <span className="text-slate-500">{formatMoney(it.precioBaseCents)}</span>
            </li>
          ))}
          {!order?.items.length && <li className="text-slate-400">Sin platillos aún</li>}
        </ul>
        {order && (
          <p className="mb-3 text-right font-bold text-slate-800">Total: {formatMoney(orderTotalCents(order))}</p>
        )}
        {order && order.items.length > 0 && (
          <Button fullWidth onClick={enviarAcocina} disabled={!conectado} variant={enviado ? "secondary" : "primary"}>
            {enviado ? "Enviado a cocina ✓" : conectado ? "Enviar a cocina" : "Conectando al hub…"}
          </Button>
        )}
      </Card>
    </div>
  );
}
