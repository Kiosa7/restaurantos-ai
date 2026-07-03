import { MeseroScreen } from "./screens/MeseroScreen";

/** Shell mínimo del prototipo de Fase 3. Fase 5/6 añaden ruteo por rol (mesero/KDS/caja) real. */
export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-brand">RestaurantOS AI</h1>
      </header>
      <MeseroScreen />
    </div>
  );
}
