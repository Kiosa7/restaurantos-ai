import { useEffect, useRef, useState } from "react";
import { Truck } from "lucide-react";
import { Button, Card, Input, useToast } from "@ui/components/ui";
import { formatMoney, cents } from "@domain/money";
import {
  createPurchase,
  createSupplier,
  fetchSuppliers,
  ocrInvoice,
  type OcrInvoiceLine,
  type Supplier,
} from "@infra/hub/hubApi";

/**
 * Compras y proveedores (Fase 7 §10.1 punto 4). Registrar una compra suma
 * inventario real (`create_purchase` en el hub). El OCR de factura
 * (`llava:7b`, ⚠️ 30-60s en CPU) extrae proveedor + líneas como AYUDA de
 * lectura — todavía no mapea automáticamente el nombre leído a un
 * `productId` del catálogo (requeriría fuzzy-match contra `products`, no
 * implementado); por ahora se muestra como referencia y la compra se
 * captura a mano con el id exacto del insumo.
 */
export function ComprasPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);
  const [ocrLines, setOcrLines] = useState<OcrInvoiceLine[] | null>(null);
  const [ocrProveedor, setOcrProveedor] = useState<string | null>(null);
  const [ocrCargando, setOcrCargando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchSuppliers(apiUrl).then(setSuppliers);
  }, [apiUrl]);

  async function agregarProveedor() {
    if (!nuevoProveedor.trim()) return;
    await createSupplier({ name: nuevoProveedor }, apiUrl);
    setNuevoProveedor("");
    setSuppliers(await fetchSuppliers(apiUrl));
  }

  async function registrarCompra() {
    if (!supplierId || !productId || !qty || !unitCost) return;
    try {
      const res = await createPurchase(
        { supplierId, items: [{ productId, qty: Number(qty), unitCostCents: Math.round(Number(unitCost) * 100) }] },
        apiUrl,
      );
      setResultado(`Compra ${res.folio} registrada por ${formatMoney(cents(res.totalCents))} — inventario actualizado.`);
      setProductId("");
      setQty("");
      setUnitCost("");
    } catch (e) {
      setResultado(`Error: ${(e as Error).message}`);
    }
  }

  async function subirFacturaParaOcr(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrCargando(true);
    setOcrLines(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await ocrInvoice(base64, apiUrl);
      setOcrProveedor(res.supplier);
      setOcrLines(res.lines);
    } catch (err) {
      toast(`No se pudo leer la factura: ${(err as Error).message}`, "warning");
    } finally {
      setOcrCargando(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <Truck className="h-4 w-4 text-brand" /> Compras y proveedores
      </h2>

      <div className="mb-4 flex gap-2">
        <select className="flex-1 rounded-[var(--radius-field)] border border-slate-300 px-3 py-2 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Selecciona proveedor…</option>
          {suppliers.map((s) => (
            <option key={s.supplierId} value={s.supplierId}>{s.nombre}</option>
          ))}
        </select>
        <Input value={nuevoProveedor} onChange={(e) => setNuevoProveedor(e.target.value)} placeholder="Nuevo proveedor" className="flex-1" />
        <Button size="sm" variant="outline" onClick={agregarProveedor}>Agregar</Button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="id de insumo (ej. insumo-carne-pastor)" className="col-span-3" />
        <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Cantidad" />
        <Input value={unitCost} onChange={(e) => setUnitCost(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Costo unitario ($)" />
        <Button size="sm" onClick={registrarCompra} disabled={!supplierId}>Registrar compra</Button>
      </div>
      {resultado && <p className="mb-3 text-sm text-slate-600">{resultado}</p>}

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs font-semibold text-slate-500">OCR de factura (foto → lectura de referencia)</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={subirFacturaParaOcr} />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} loading={ocrCargando}>
          {ocrCargando ? "Leyendo factura (puede tardar ~1 min)…" : "Subir foto de factura"}
        </Button>
        {ocrLines && (
          <div className="mt-2 text-sm">
            {ocrProveedor && <p className="text-slate-600">Proveedor detectado: {ocrProveedor}</p>}
            {ocrLines.length === 0 && <p className="text-slate-400">No se pudo leer ninguna línea.</p>}
            <ul className="mt-1 flex flex-col gap-1">
              {ocrLines.map((l, i) => (
                <li key={i} className="text-slate-600">{l.qty}× {l.name} — ${l.unitCost.toFixed(2)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
