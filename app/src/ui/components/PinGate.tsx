import { useEffect, useState } from "react";
import { Button, Card } from "@ui/components/ui";
import { NumPad } from "@ui/components/restaurant";
import { loginWithPin, type AuthenticatedEmployee } from "@infra/auth/authClient";

export interface PinGateProps {
  /** Capacidad requerida para esta pantalla (docs/permisos-plugins.md). */
  requiredPermission: string;
  apiUrl?: string;
  children: (auth: AuthenticatedEmployee) => React.ReactNode;
}

/**
 * Bloquea una pantalla hasta que se ingrese un PIN válido CON el permiso
 * requerido. El PIN se verifica en el hub (`POST /auth/pin`), no en el
 * cliente — así cualquier terminal pareada puede identificar a cualquier
 * empleado. Sesión solo en memoria de la pestaña (se pierde al recargar);
 * persistirla es un refinamiento de Fase 7+, no un requisito del MVP.
 */
export function PinGate({ requiredPermission, apiUrl = "http://localhost:5190", children }: PinGateProps) {
  const [pin, setPin] = useState("");
  const [auth, setAuth] = useState<AuthenticatedEmployee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    if (pin.length !== 4) return;
    let cancelled = false;
    setVerificando(true);
    setError(null);
    loginWithPin(pin, apiUrl)
      .then((emp) => {
        if (cancelled) return;
        if (!emp.permisos.includes(requiredPermission)) {
          setError(`${emp.nombre} (${emp.roleNombre}) no tiene acceso a esta pantalla.`);
          setPin("");
          return;
        }
        setAuth(emp);
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setPin("");
        }
      })
      .finally(() => !cancelled && setVerificando(false));
    return () => {
      cancelled = true;
    };
  }, [pin, apiUrl, requiredPermission]);

  if (auth) {
    return (
      <div>
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-sm">
          <span className="text-slate-600">{auth.nombre} · {auth.roleNombre}</span>
          <button type="button" className="text-brand underline" onClick={() => setAuth(null)}>Cerrar sesión</button>
        </div>
        {children(auth)}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xs flex-col items-center gap-4 p-8">
      <Card className="w-full p-6 text-center">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Ingresa tu PIN</h2>
        <p className="mb-4 text-sm text-slate-500">4 dígitos</p>
        <div className="mb-4 flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-3 w-3 rounded-full ${pin.length > i ? "bg-brand" : "bg-slate-200"}`} />
          ))}
        </div>
        {verificando && <p className="mb-2 text-sm text-slate-500">Verificando…</p>}
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        <NumPad value={pin} decimals={0} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))} />
        {pin.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPin("")}>Borrar todo</Button>
        )}
      </Card>
    </div>
  );
}
