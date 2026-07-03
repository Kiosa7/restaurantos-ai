# Spike 3 — CFDI sandbox (Facturama vs. SW Sapien)

**Estado: 🟡 Investigación + contrato de cliente VERDE. Llamada real contra
sandbox ⛔ BLOQUEADA** (requiere crear cuenta y obtener credenciales — acción
que solo el dueño del proyecto puede autorizar/pagar, aunque el sandbox en sí
es gratuito). Prototipo en `spikes/cfdi/` (`node test.mjs`).

## Comparación

| | Facturama | SW Sapien |
|---|---|---|
| Sandbox | Gratuito, ambiente separado (`apisandbox.facturama.mx`) | Gratuito, "igual a producción" (`services.test.sw.com.mx`), no consume timbres ni queda registrado en el SAT |
| Auth | Basic (API key/password) | Bearer token (endpoint de autenticación propio) |
| Formato | JSON propio (no es el XML crudo del CFDI) | JSON con complemento `jsontoxml`, más apegado a la estructura oficial del CFDI |
| Endpoint timbrado | `POST /3/cfdis` | `POST /v3/cfdi33/issue/json/{version}` |
| Endpoint cancelación | `DELETE /3/cfdis/{id}?motive=` | `POST /v3/cfdi33/cancel/csd` |
| Precio (folios) | $1,650 MXN/año incluye 100 folios; >50,000 folios a $0.40 MXN c/u | No publicado en la documentación pública consultada — requiere cotización directa |
| Documentación | Guías de alto nivel, pocos ejemplos de payload completos | Documentación técnica más detallada (knowledge base con ejemplos JSON) |

Fuentes: [apisandbox.facturama.mx/guias](https://apisandbox.facturama.mx/guias),
[apisandbox.facturama.mx/costos](https://apisandbox.facturama.mx/costos),
[developers.sw.com.mx – Emisión Timbrado JSON](https://developers.sw.com.mx/knowledge-base/emision-timbrado-json-cfdi/),
[developers.sw.com.mx – Autenticación v2](https://developers.sw.com.mx/knowledge-base/autenticacion-v2/).

## Qué se construyó (sin credenciales reales)

`spikes/cfdi/client.mjs`: dos clientes (`FacturamaClient`, `SwSapienClient`)
detrás de una interfaz común `PacClient { stamp(cfdiJson), cancel(uuid, motivo) }`,
armados **contra la documentación pública** de cada proveedor (URLs, headers,
forma del payload, dónde viene el UUID del timbre). `spikes/cfdi/test.mjs`
valida con `fetch` mockeado: armado correcto del payload (p. ej. SW Sapien
exige `Sello`/`Certificado`/`NoCertificado` vacíos porque los llena el PAC),
extracción del UUID, y traducción de errores 4xx a un `PacError` con el
mensaje del SAT.

## DECISIÓN AUTÓNOMA: elegir SW Sapien como PAC primario, Facturama como fallback

Criterio: la interfaz `PacClient` ya abstrae al resto del sistema del
proveedor concreto (Fase 7 solo depende de `stamp`/`cancel`), así que la
elección no bloquea nada — pero hay que fijar un default:

- **SW Sapien** como primario: sandbox declarado "igual a producción" (menor
  sorpresa al pasar a producción), payload más apegado a la estructura oficial
  del CFDI (más fácil de auditar/depurar), documentación técnica más completa.
- **Facturama** queda como fallback/alternativa documentada (precio de folios
  sí está publicado, lo cual ayuda a presupuestar) — si SW Sapien no da buena
  experiencia en el spike de hardware/cuenta real, se cambia sin rediseñar
  nada gracias a `PacClient`.

## ⛔ Qué falta para desbloquear (acción del dueño, no técnica)

1. Crear cuenta sandbox en SW Sapien (gratuita) — https://developers.sw.com.mx
   → obtener `token` de autenticación.
2. Repetir `spikes/cfdi/test.mjs` con `fetchImpl` real (quitar el mock) y un
   RFC/CSD de pruebas (el SAT publica CSDs y RFCs genéricos para pruebas,
   p. ej. `EKU9003173C9`) para timbrar un CFDI de prueba real.
3. Documentar el flujo de cancelación real (plazos, motivos válidos 01–04,
   aceptación del receptor si aplica) una vez validado contra el sandbox.
4. Cuando el dueño decida modelo de negocio (¿el restaurante paga sus propios
   timbres o se revende como parte de una suscripción?), confirmar plan de
   folios — impacta precio pero no arquitectura.

## No bloquea Fase 4/7

El **modelo de datos** para CFDI (Fase 4: emisor, receptor, conceptos,
impuestos, complemento de pago, relación con la venta) se puede diseñar ya
mismo sobre la estructura oficial del CFDI 4.0 (documentada públicamente por
el SAT, independiente del PAC). El PAC solo se conecta al final del flujo de
Fase 7 (timbrado); su implementación real espera la cuenta.
