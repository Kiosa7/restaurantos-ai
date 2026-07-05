import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { Card } from "@ui/components/ui";
import { fetchPlugins, togglePlugin, type Plugin } from "@infra/hub/hubApi";

/**
 * Registro de plugins (Fase 8 §10.2 punto 2, docs/permisos-plugins.md) —
 * dogfooding del propio modelo: los módulos de Fase 7 que un restaurante
 * puede razonablemente no necesitar (no hace delivery, no factura) se
 * pueden apagar sin tocar código. `CajaScreen` lee este mismo listado para
 * decidir qué paneles renderizar.
 */
export function PluginsPanel({ apiUrl = "http://localhost:5190", onChange }: { apiUrl?: string; onChange?: () => void }) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);

  async function refrescar() {
    setPlugins(await fetchPlugins(apiUrl));
  }

  useEffect(() => {
    refrescar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  async function alternar(id: string, enabled: boolean) {
    await togglePlugin(id, enabled, apiUrl);
    await refrescar();
    onChange?.();
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <Puzzle className="h-4 w-4 text-brand" /> Plugins
      </h2>
      <ul className="flex flex-col gap-2 text-sm">
        {plugins.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1">
            <div>
              <p className="font-medium text-slate-700">{p.name}</p>
              <p className="text-xs text-slate-400">{p.description}</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={p.enabled} onChange={(e) => alternar(p.id, e.target.checked)} />
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
