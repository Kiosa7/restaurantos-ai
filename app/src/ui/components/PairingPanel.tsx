import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";
import { Button, Card, Segmented } from "@ui/components/ui";
import { generatePairing, fetchPairedDevices, type PairedDevice } from "@infra/hub/hubApi";

/**
 * Pairing real de dispositivos (Fase 6 §10.9): genera un código de 6 dígitos
 * de un solo uso, válido 5 minutos, para que una tablet nueva se identifique
 * con un `deviceId` persistente. ⛔ El lado de "canjear el código" no está
 * cableado todavía en Mesero/KDS (las pantallas siguen conectando con
 * `?device=` libre) — generar y persistir el pairing ya es real, exigirlo en
 * el WS es el siguiente paso (ver PLAN.md).
 */
export function PairingPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [role, setRole] = useState<"mesero" | "kds" | "caja">("mesero");
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [, forceTick] = useState(0);

  useEffect(() => {
    fetchPairedDevices(apiUrl).then(setDevices);
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [apiUrl]);

  async function generar() {
    const res = await generatePairing(role, apiUrl);
    setCode(res);
  }

  const segundosRestantes = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000)) : 0;

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <Wifi className="h-4 w-4 text-brand" /> Emparejar dispositivo nuevo
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Segmented
            ariaLabel="Rol del dispositivo"
            value={role}
            onChange={setRole}
            options={[
              { value: "mesero", label: "Mesero" },
              { value: "kds", label: "Cocina" },
              { value: "caja", label: "Caja" },
            ]}
          />
        </div>
        <Button onClick={generar}>Generar código</Button>
      </div>
      {code && (
        <div className="mt-4 rounded-[var(--radius-field)] bg-brand-soft p-4 text-center">
          <p className="font-mono text-3xl font-bold tracking-widest text-brand">{code.code}</p>
          <p className="mt-1 text-xs text-slate-500">
            {segundosRestantes > 0 ? `Válido ${segundosRestantes}s más` : "Expirado — genera uno nuevo"}
          </p>
        </div>
      )}
      {devices.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-slate-500">Dispositivos ya emparejados</p>
          <ul className="flex flex-col gap-1 text-sm">
            {devices.map((d) => (
              <li key={d.deviceId} className="flex justify-between text-slate-600">
                <span>{d.label ?? d.deviceId.slice(0, 8)} · {d.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
