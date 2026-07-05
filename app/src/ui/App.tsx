import { MeseroScreen } from "./screens/MeseroScreen";
import { CocinaScreen } from "./screens/CocinaScreen";
import { CajaScreen } from "./screens/CajaScreen";

/**
 * Ruteo por rol vía `?role=` (PLAN.md §4: la PWA se sirve desde el mismo
 * hub, distinta ruta de entrada según rol). `role=kds` conecta directo al
 * hub como cocina, `role=caja` como caja; cualquier otro valor (o ausente)
 * es la pantalla de mesero.
 */
export function App() {
  const role = new URLSearchParams(window.location.search).get("role");

  if (role === "kds") return <CocinaScreen />;
  if (role === "caja") {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white px-4 py-3">
          <h1 className="text-lg font-bold text-brand">RestaurantOS AI — Caja</h1>
        </header>
        <CajaScreen />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-brand">RestaurantOS AI</h1>
      </header>
      <MeseroScreen />
    </div>
  );
}
