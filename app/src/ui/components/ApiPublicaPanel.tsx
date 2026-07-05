import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, Card, Input, useToast } from "@ui/components/ui";
import { createApiKey, fetchApiKeys, revokeApiKey, type ApiKey } from "@infra/hub/hubApi";

const SCOPES = ["sales.read", "menu.read"] as const;

/**
 * API pública (Fase 8 §10.2 punto 4): integraciones de terceros
 * (contabilidad, agregadores de delivery reales) contra `/api/v1/*`,
 * protegido por API key + scopes — NO el hub LAN completo, que asume red
 * de restaurante confiable. La key en claro solo se muestra UNA vez, al
 * crearla (mismo principio que un pairing code o un PIN: el hub solo
 * guarda el hash).
 */
export function ApiPublicaPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [keyRecienCreada, setKeyRecienCreada] = useState<string | null>(null);
  const { toast } = useToast();

  async function refrescar() {
    setKeys(await fetchApiKeys(apiUrl));
  }

  useEffect(() => {
    refrescar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  function alternarScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  async function crear() {
    if (!name.trim() || scopes.length === 0) return;
    try {
      const creada = await createApiKey({ name, scopes }, apiUrl);
      setKeyRecienCreada(creada.key);
      setName("");
      setScopes([]);
      await refrescar();
    } catch (e) {
      toast(`No se pudo crear la API key: ${(e as Error).message}`, "warning");
    }
  }

  async function revocar(id: string) {
    await revokeApiKey(id, apiUrl);
    await refrescar();
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <KeyRound className="h-4 w-4 text-brand" /> API pública
      </h2>

      {keyRecienCreada && (
        <div className="mb-3 rounded-[var(--radius-field)] border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">Guarda esta key ahora — no se vuelve a mostrar:</p>
          <code className="break-all">{keyRecienCreada}</code>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la integración (ej. Contpaqi)" />
        <div className="flex gap-3 text-xs">
          {SCOPES.map((s) => (
            <label key={s} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => alternarScope(s)} /> {s}
            </label>
          ))}
        </div>
        <Button size="sm" onClick={crear}>Generar API key</Button>
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        {keys.map((k) => (
          <li key={k.id} className="flex items-center justify-between border-b border-slate-100 py-1">
            <span>
              {k.name} · {k.scopes.join(", ")} {k.revokedAt && <span className="text-red-500">(revocada)</span>}
            </span>
            {!k.revokedAt && (
              <Button size="sm" variant="outline" onClick={() => revocar(k.id)}>Revocar</Button>
            )}
          </li>
        ))}
        {keys.length === 0 && <li className="text-slate-400">Sin API keys todavía.</li>}
      </ul>
    </Card>
  );
}
