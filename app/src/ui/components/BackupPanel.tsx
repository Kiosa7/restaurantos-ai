import { useRef, useState } from "react";
import { Lock, Download, Upload } from "lucide-react";
import { Button, Card, Field, Input } from "@ui/components/ui";
import { encryptBackup, decryptBackup } from "@app/usecases/encryptedBackup";
import { fetchBackupSnapshot } from "@infra/hub/hubApi";

/**
 * Backup cifrado (Fase 6 §10.7). Copia el flujo de pos-inteligente
 * (`EncryptedBackupSection.tsx`) sobre datos reales del hub: el snapshot
 * viene de `GET /backup/export`, se cifra en el navegador (AES-256-GCM,
 * `encryptedBackup.ts` — mismo módulo, sin cambios de algoritmo) y se
 * descarga como `.restaurantosbackup`.
 *
 * Restaurar: descifra y valida el archivo, pero NO reescribe la base del
 * hub todavía — reimportar de forma transaccional y segura sobre un hub ya
 * operando es una pieza más grande, diferida a Fase 7 (ver PLAN.md).
 */
export function BackupPanel({ apiUrl = "http://localhost:5190" }: { apiUrl?: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [encPwd, setEncPwd] = useState("");
  const [decPwd, setDecPwd] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleExport() {
    if (!encPwd) return;
    setExporting(true);
    setResult(null);
    try {
      const snapshot = await fetchBackupSnapshot(apiUrl);
      const bytes = await encryptBackup(JSON.stringify(snapshot), encPwd);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: `restaurantos-backup-${new Date().toISOString().slice(0, 10)}.restaurantosbackup`,
      });
      a.click();
      URL.revokeObjectURL(url);
      setResult({ ok: true, msg: "Respaldo cifrado descargado correctamente." });
      setEncPwd("");
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message });
    } finally {
      setExporting(false);
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !decPwd) return;
    setImporting(true);
    setResult(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        const json = await decryptBackup(bytes, decPwd);
        const snapshot = JSON.parse(json) as { exportedAt: number; tables: Record<string, unknown[]> };
        const resumen = Object.entries(snapshot.tables)
          .map(([tabla, filas]) => `${tabla}: ${filas.length}`)
          .join(", ");
        setResult({
          ok: true,
          msg: `Respaldo válido del ${new Date(snapshot.exportedAt).toLocaleString("es-MX")}. Contenido: ${resumen}. (Restaurar sobre el hub en vivo queda para Fase 7 — por ahora solo se valida y previsualiza.)`,
        });
        setDecPwd("");
      } catch (e) {
        setResult({ ok: false, msg: (e as Error).message });
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-800">
        <Lock className="h-4 w-4 text-brand" /> Respaldo cifrado
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        AES-256-GCM + PBKDF2. Solo con la contraseña se puede abrir el archivo <code>.restaurantosbackup</code>.
      </p>
      {result && <p className={`mb-3 text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.msg}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Field label="Exportar" hint="Contraseña para cifrar">
            {({ id }) => <Input id={id} type="password" value={encPwd} onChange={(e) => setEncPwd(e.target.value)} />}
          </Field>
          <Button fullWidth size="sm" leftIcon={Download} disabled={!encPwd || exporting} onClick={handleExport}>
            {exporting ? "Cifrando…" : "Descargar respaldo"}
          </Button>
        </div>
        <div className="space-y-2">
          <Field label="Restaurar" hint="Contraseña para descifrar">
            {({ id }) => <Input id={id} type="password" value={decPwd} onChange={(e) => setDecPwd(e.target.value)} />}
          </Field>
          <input ref={fileInputRef} type="file" accept=".restaurantosbackup" className="hidden" onChange={handleImportFile} />
          <Button fullWidth size="sm" variant="outline" leftIcon={Upload} disabled={!decPwd || importing} onClick={() => fileInputRef.current?.click()}>
            {importing ? "Descifrando…" : "Abrir respaldo"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
