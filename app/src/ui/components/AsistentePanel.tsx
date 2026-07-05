import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card, Input } from "@ui/components/ui";
import { askAssistant } from "@infra/hub/hubApi";

const SUGERENCIAS = [
  "¿Qué platillo deja más margen?",
  "¿Qué hay pendiente en cocina?",
  "¿Qué mesas están libres?",
  "¿Cómo van las propinas?",
];

/** Copiloto del dueño (Fase 6 §10.8) — pregunta en español, el hub decide qué tool usar. */
export function AsistentePanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [pregunta, setPregunta] = useState("");
  const [respuesta, setRespuesta] = useState<{ answer: string; toolsUsadas: string[] } | null>(null);
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preguntar(q: string) {
    if (!q.trim()) return;
    setPensando(true);
    setError(null);
    setRespuesta(null);
    try {
      const res = await askAssistant(q, apiUrl);
      setRespuesta(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPensando(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <Sparkles className="h-4 w-4 text-brand" /> Copiloto (IA local)
      </h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {SUGERENCIAS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setPregunta(s); preguntar(s); }}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && preguntar(pregunta)}
          placeholder="Pregúntale algo a tu negocio…"
        />
        <Button onClick={() => preguntar(pregunta)} loading={pensando} disabled={!pregunta.trim()}>
          Preguntar
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-danger">No se pudo consultar al asistente: {error}</p>}
      {respuesta && (
        <div className="mt-3 rounded-[var(--radius-field)] bg-brand-soft p-3 text-sm text-slate-800">
          <p>{respuesta.answer}</p>
          {respuesta.toolsUsadas.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">Fuente: {respuesta.toolsUsadas.join(", ")}</p>
          )}
        </div>
      )}
    </Card>
  );
}
