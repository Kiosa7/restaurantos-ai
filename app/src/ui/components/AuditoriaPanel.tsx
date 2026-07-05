import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Card } from "@ui/components/ui";
import { fetchAuditLog, verifyAuditChain, type AuditChainVerification, type AuditLogEntry } from "@infra/hub/hubApi";

/**
 * Auditoría avanzada (Fase 8 §10.2 punto 3): UI real sobre `audit_log`
 * (0001, hash-encadenado) — ya se escribe de verdad desde el punto 1 de
 * esta fase (conflictos LWW de sync). "Verificar integridad" recalcula la
 * cadena completa del lado del hub; si alguien edita/borra una fila
 * directamente en SQLite (sin pasar por el código), esto lo detecta.
 */
export function AuditoriaPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [entradas, setEntradas] = useState<AuditLogEntry[]>([]);
  const [verificacion, setVerificacion] = useState<AuditChainVerification | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    fetchAuditLog(undefined, apiUrl).then(setEntradas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  async function verificar() {
    setVerificando(true);
    try {
      setVerificacion(await verifyAuditChain(apiUrl));
    } finally {
      setVerificando(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <ShieldCheck className="h-4 w-4 text-brand" /> Auditoría
      </h2>
      <div className="mb-3 flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={verificar} loading={verificando}>
          Verificar integridad de la cadena
        </Button>
        {verificacion && (
          <p className={`text-xs ${verificacion.valid ? "text-emerald-600" : "text-red-600"}`}>
            {verificacion.valid
              ? `Cadena íntegra (${verificacion.totalRecords} registros).`
              : `Cadena rota en seq ${verificacion.brokenAtSeq}: ${verificacion.reason}`}
          </p>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="pb-1">Fecha</th>
            <th className="pb-1">Acción</th>
            <th className="pb-1">Entidad</th>
            <th className="pb-1">Origen</th>
          </tr>
        </thead>
        <tbody>
          {entradas.map((e) => (
            <tr key={e.id} className="border-t border-slate-100">
              <td className="py-1">{new Date(e.ts).toLocaleString("es-MX")}</td>
              <td className="py-1">{e.action}</td>
              <td className="py-1">{e.entity}{e.entityId ? ` · ${e.entityId.slice(0, 8)}…` : ""}</td>
              <td className="py-1 text-slate-400">{e.originNode}</td>
            </tr>
          ))}
          {entradas.length === 0 && (
            <tr><td colSpan={4} className="py-1 text-slate-400">Sin eventos de auditoría todavía.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
