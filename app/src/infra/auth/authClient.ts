/**
 * Autenticación por PIN contra el hub (Fase 6 §10.6). A diferencia de
 * pos-inteligente (PIN verificado en el mismo dispositivo), aquí el hub es
 * quien identifica al empleado — cualquier terminal debe poder autenticar a
 * cualquier empleado por su PIN, no solo "el dispositivo del dueño".
 */
export interface AuthenticatedEmployee {
  employeeId: string;
  nombre: string;
  roleId: string;
  roleNombre: string;
  permisos: string[];
}

export async function loginWithPin(pin: string, baseUrl = "http://localhost:5190"): Promise<AuthenticatedEmployee> {
  const res = await fetch(`${baseUrl}/auth/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "PIN incorrecto");
  return json;
}
