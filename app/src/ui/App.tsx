import { MeseroScreen } from "./screens/MeseroScreen";
import { CocinaScreen } from "./screens/CocinaScreen";
import { CajaScreen } from "./screens/CajaScreen";
import { PinGate } from "./components/PinGate";

/**
 * Ruteo por rol vía `?role=` (PLAN.md §4: la PWA se sirve desde el mismo
 * hub, distinta ruta de entrada según rol). `role=kds` conecta directo al
 * hub como cocina, `role=caja` como caja; cualquier otro valor (o ausente)
 * es la pantalla de mesero. Cada ruta exige el PIN de un empleado con el
 * permiso correspondiente (Fase 6 §10.6, docs/permisos-plugins.md) — el hub
 * verifica el PIN, no el cliente.
 */
export function App() {
  const role = new URLSearchParams(window.location.search).get("role");

  if (role === "kds") {
    return (
      <PinGate requiredPermission="kitchen.bump">
        {() => <CocinaScreen />}
      </PinGate>
    );
  }
  if (role === "caja") {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white px-4 py-3">
          <h1 className="text-lg font-bold text-brand">RestaurantOS AI — Caja</h1>
        </header>
        <PinGate requiredPermission="cash.checkout">
          {() => <CajaScreen />}
        </PinGate>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-brand">RestaurantOS AI</h1>
      </header>
      <PinGate requiredPermission="order.create">
        {() => <MeseroScreen />}
      </PinGate>
    </div>
  );
}
