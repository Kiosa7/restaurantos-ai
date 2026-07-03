# Modelo de permisos y modelo de plugins — RestaurantOS AI

## Modelo de permisos (RBAC + PIN, heredado de pos-inteligente + extendido)

Roles nuevos sobre el RBAC existente (Web Crypto + PIN de pos-inteligente):

| Rol | Dispositivo típico | Puede |
|---|---|---|
| `mesero` | tablet PWA | abrir mesa, tomar/editar comanda propia, enviar a cocina, ver estado de sus mesas |
| `cocina` | KDS | ver comandas enrutadas a su estación, marcar `en_preparacion`/`listo` (bump) |
| `cajero` | hub o caja secundaria | cobrar, dividir cuenta, abrir/cerrar caja, reimprimir |
| `gerente` | hub | todo lo anterior + reportes, ajustes de menú/recetas, ver IA copiloto, gestionar turnos y reparto de propinas |
| `dueño` | hub o remoto (nube, Fase 8) | todo + configuración de licencia, multi-sucursal, facturación |

**Permiso por dispositivo, no solo por usuario**: el pairing (spike 1 más
Fase 5) asocia un rol al `deviceId` — una tablet pareada como KDS no puede,
aunque alguien la manipule, mandar comandos de cobro. Esto es una capa extra
sobre el PIN de usuario, pensada para el escenario real de tablets
compartidas en un restaurante (nadie hace login individual en el KDS).

**Principio heredado no negociable**: el LLM nunca tiene permisos propios —
las tools que invoca reciben tenant/local/rol ya inyectados por el núcleo
(`docs/ai/tools-conversacional.md` de pos-inteligente); un mesero que le
pregunta algo al asistente solo puede obtener datos que su rol ya podría ver
por la UI normal.

## Modelo de plugins (base para Fase 8, diseñado ahora para no cerrar puertas)

Mismo principio que pos-inteligente: **núcleo + plugins por vertical**. Un
plugin es un paquete que puede:

1. Registrar nuevas tools de IA (function-calling) sobre vistas propias.
2. Añadir pantallas/rutas a la PWA sin tocar el núcleo (mesero/KDS/caja son,
   arquitectónicamente, plugins del núcleo genérico "hub multi-terminal" —
   dogfooding del propio modelo de plugins).
3. Suscribirse a eventos del bus del hub (spike 1) sin poder mutarlos
   directamente — solo el núcleo escribe a SQLite; un plugin reacciona a
   eventos y emite sus propios comandos por el mismo protocolo idempotente.
4. Declarar sus propias migraciones de esquema, con su propio prefijo de
   tabla, para no chocar con el núcleo ni con otros plugins.

**Ejemplos de plugins futuros** (no se construyen en el MVP, pero el diseño
de puntos de extensión debe soportarlos sin reescritura): delivery/agregador
externo (Fase 7), reservaciones (Fase 7), fidelización (Fase 7), franquicias/
multi-marca (Fase 8), integraciones de contabilidad.

**Frontera dura**: un plugin nunca tiene acceso directo a SQLite ni al
proceso Rust — solo a los puertos (`app/ports.ts`) y al bus de eventos. Esto
es lo que permite que el núcleo evolucione (p. ej. cambiar de SQLite a otro
motor en el futuro) sin romper plugins de terceros.
