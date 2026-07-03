import { MeseroScreen } from "./screens/MeseroScreen";
import { CocinaScreen } from "./screens/CocinaScreen";

/**
 * Ruteo por rol vía `?role=` (PLAN.md §4: la PWA se sirve desde el mismo
 * hub, distinta ruta de entrada según rol). `role=kds` conecta directo al
 * hub como cocina; cualquier otro valor (o ausente) es la pantalla de
 * mesero. Caja completa (hub Tauri) llega en Fase 6.
 */
export function App() {
  const role = new URLSearchParams(window.location.search).get("role");

  if (role === "kds") return <CocinaScreen />;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-brand">RestaurantOS AI</h1>
      </header>
      <MeseroScreen />
    </div>
  );
}
