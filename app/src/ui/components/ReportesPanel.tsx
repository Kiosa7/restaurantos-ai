import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Button, Card } from "@ui/components/ui";
import { formatMoney, cents } from "@domain/money";
import { fetchReportsDashboard, type ReportsDashboard } from "@infra/hub/hubApi";

/** Barra simple sin librería externa: SVG, una sola serie (sin leyenda —
 * el título ya la nombra). Barra tope ≤24px (nunca llena el carril aunque
 * haya pocos días de datos), extremo superior redondeado, línea base,
 * etiqueta de día por barra, tooltip nativo con el valor exacto. */
function VentasPorDiaChart({ datos }: { datos: ReportsDashboard["ventasPorDia"] }) {
  if (datos.length === 0) return <p className="text-sm text-slate-400">Sin ventas en los últimos 30 días.</p>;
  const max = Math.max(...datos.map((d) => d.totalCents), 1);
  const width = 640;
  const height = 170;
  const baselineY = height - 28;
  const barMaxWidth = 24;
  const slotWidth = width / datos.length;
  const barWidth = Math.min(barMaxWidth, slotWidth * 0.6);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Ventas por día, últimos 30 días">
      <line x1={0} y1={baselineY} x2={width} y2={baselineY} stroke="currentColor" className="text-slate-200" strokeWidth={1} />
      {datos.map((d, i) => {
        const barHeight = Math.max((d.totalCents / max) * (baselineY - 12), 2);
        const slotCenter = i * slotWidth + slotWidth / 2;
        const x = slotCenter - barWidth / 2;
        const y = baselineY - barHeight;
        const diaCorto = d.dia.slice(5); // MM-DD, el año no aporta en una ventana de 30 días
        return (
          <g key={d.dia}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={4} className="fill-brand">
              <title>{`${d.dia}: ${formatMoney(cents(d.totalCents))} (${d.numVentas} ventas)`}</title>
            </rect>
            {datos.length <= 15 && (
              <text x={slotCenter} y={height - 12} textAnchor="middle" fontSize={9} className="fill-slate-400">
                {diaCorto}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function descargarCsv(nombre: string, filas: (string | number)[][]) {
  const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Reportes avanzados (Fase 7 §10.1 punto 9): agrega las 6 vistas de 0016 +
 * ventas por día en una pantalla dedicada con gráfica + tablas + exportar
 * CSV. Las mismas vistas ya las usa el asistente de IA (Fase 6 punto 8)
 * para responder preguntas sueltas; esto es la versión "para mirar", no un
 * modelo de datos nuevo.
 */
export function ReportesPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [data, setData] = useState<ReportsDashboard | null>(null);

  useEffect(() => {
    fetchReportsDashboard(apiUrl).then(setData);
  }, [apiUrl]);

  if (!data) return <Card className="p-4 text-sm text-slate-400">Cargando reportes…</Card>;

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <BarChart3 className="h-4 w-4 text-brand" /> Reportes avanzados
      </h2>

      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-600">Ventas por día (30 días)</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => descargarCsv("ventas_por_dia.csv", [["dia", "numVentas", "totalCents"], ...data.ventasPorDia.map((d) => [d.dia, d.numVentas, d.totalCents])])}
          >
            Exportar CSV
          </Button>
        </div>
        <VentasPorDiaChart datos={data.ventasPorDia} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-600">Margen por platillo</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => descargarCsv("margen_por_platillo.csv", [["producto", "precioVentaCents", "costoRecetaCents", "margenCents"], ...data.margenPorPlatillo.map((m) => [m.producto, m.precioVentaCents, m.costoRecetaCents, m.margenCents])])}
            >
              CSV
            </Button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1">Platillo</th>
                <th className="pb-1 text-right">Precio</th>
                <th className="pb-1 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {data.margenPorPlatillo.map((m) => (
                <tr key={m.producto} className="border-t border-slate-100">
                  <td className="py-1">{m.producto}</td>
                  <td className="py-1 text-right">{formatMoney(cents(m.precioVentaCents))}</td>
                  <td className="py-1 text-right">{formatMoney(cents(Math.round(m.margenCents)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-600">Rotación de mesas</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => descargarCsv("rotacion_mesas.csv", [["mesa", "comandasCerradas", "minutosPromedioOcupacion"], ...data.rotacionMesas.map((r) => [r.mesa, r.comandasCerradas, r.minutosPromedioOcupacion])])}
            >
              CSV
            </Button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1">Mesa</th>
                <th className="pb-1 text-right">Comandas</th>
                <th className="pb-1 text-right">Min. prom.</th>
              </tr>
            </thead>
            <tbody>
              {data.rotacionMesas.map((r) => (
                <tr key={r.mesa} className="border-t border-slate-100">
                  <td className="py-1">{r.mesa}</td>
                  <td className="py-1 text-right">{r.comandasCerradas}</td>
                  <td className="py-1 text-right">{r.minutosPromedioOcupacion.toFixed(1)}</td>
                </tr>
              ))}
              {data.rotacionMesas.length === 0 && (
                <tr><td colSpan={3} className="py-1 text-slate-400">Sin comandas cerradas todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-600">Propinas por turno</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => descargarCsv("propinas_por_turno.csv", [["shiftId", "employeeId", "numPropinas", "totalPropinasCents"], ...data.propinasPorTurno.map((p) => [p.shiftId, p.employeeId, p.numPropinas, p.totalPropinasCents])])}
            >
              CSV
            </Button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1">Turno</th>
                <th className="pb-1 text-right">Propinas</th>
                <th className="pb-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.propinasPorTurno.map((p) => (
                <tr key={p.shiftId} className="border-t border-slate-100">
                  <td className="py-1">{new Date(p.startedAt).toLocaleDateString("es-MX")} · {p.employeeId}</td>
                  <td className="py-1 text-right">{p.numPropinas}</td>
                  <td className="py-1 text-right">{formatMoney(cents(p.totalPropinasCents))}</td>
                </tr>
              ))}
              {data.propinasPorTurno.length === 0 && (
                <tr><td colSpan={3} className="py-1 text-slate-400">Sin turnos con propinas todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
