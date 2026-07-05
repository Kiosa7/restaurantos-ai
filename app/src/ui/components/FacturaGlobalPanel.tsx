import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { Button, Card, useToast } from "@ui/components/ui";
import { formatMoney, cents } from "@domain/money";
import { fetchUninvoicedSales, generateGlobalInvoice, type UninvoicedSale } from "@infra/hub/hubApi";

/**
 * Factura global (Fase 7 §10.1 punto 2): agrupa varias ventas del día que
 * nadie pidió facturar individualmente en un solo CFDI (`sale_id NULL`,
 * modelo ya previsto desde 0015). El complemento de pago (para CFDI PPD)
 * queda ⛔ documentado como bloqueado en PLAN.md — depende de un UUID
 * fiscal real, que solo existe tras el timbrado real (mismo bloqueo que
 * §10.1 punto 1, sin cuenta de PAC).
 */
export function FacturaGlobalPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [ventas, setVentas] = useState<UninvoicedSale[]>([]);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const { toast } = useToast();

  async function refrescar() {
    setVentas(await fetchUninvoicedSales(apiUrl));
  }

  useEffect(() => {
    refrescar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  function alternar(saleId: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(saleId)) next.delete(saleId);
      else next.add(saleId);
      return next;
    });
  }

  async function generar() {
    if (seleccionadas.size === 0) return;
    setGenerando(true);
    setResultado(null);
    try {
      const doc = await generateGlobalInvoice({ saleIds: [...seleccionadas] }, apiUrl);
      setResultado(`Factura global ${doc.folio} generada por ${formatMoney(cents(doc.totalCents))} (${doc.ventasIncluidas} ventas). Pendiente de timbrado real.`);
      setSeleccionadas(new Set());
      await refrescar();
    } catch (e) {
      toast(`No se pudo generar la factura global: ${(e as Error).message}`, "warning");
    } finally {
      setGenerando(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <Receipt className="h-4 w-4 text-brand" /> Factura global
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Ventas sin CFDI individual — selecciona las que se van a agrupar en una sola factura.
      </p>
      <ul className="mb-3 flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
        {ventas.map((v) => (
          <li key={v.saleId} className="flex items-center gap-2 border-b border-slate-100 py-1">
            <input type="checkbox" checked={seleccionadas.has(v.saleId)} onChange={() => alternar(v.saleId)} />
            <span>{v.folio} · {formatMoney(cents(v.totalCents))} · {new Date(v.datetime).toLocaleString("es-MX")}</span>
          </li>
        ))}
        {ventas.length === 0 && <li className="text-slate-400">No hay ventas pendientes de facturar.</li>}
      </ul>
      <Button size="sm" onClick={generar} loading={generando} disabled={seleccionadas.size === 0}>
        Generar factura global ({seleccionadas.size})
      </Button>
      {resultado && <p className="mt-2 text-xs text-slate-500">{resultado}</p>}
    </Card>
  );
}
