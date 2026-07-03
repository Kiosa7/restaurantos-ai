# Spike 2 — Impresión ESC/POS (comanda + cuenta)

**Estado: 🟡 VERDE en software, ⛔ BLOQUEADO en hardware real.**
Prototipo en `spikes/escpos/` (`node test.mjs`, sin dependencias).

## Qué se construyó

1. `encoder.mjs` — codificador ESC/POS mínimo (init, align, bold, tamaño,
   corte parcial/total, apertura de cajón) sin dependencias de terceros.
   Reutiliza el transporte ya existente en
   `~/pos-inteligente/app/src/infra/thermalPrinter.ts` (WebUSB/WebSerial) —
   ese archivo resuelve "cómo mandar bytes"; a este spike le faltaba "qué
   bytes mandar", que es lo que se construyó aquí.
2. `tickets.mjs` — dos plantillas de negocio sobre el encoder:
   - **Comanda de cocina**: SIN precios, fuente grande, tiempo del platillo
     (entrada/fuerte/postre), modificadores y notas como líneas propias,
     termina en corte parcial, **nunca** abre el cajón.
   - **Cuenta de caja**: encabezado del negocio, desglose con IVA 16%
     incluido, propina sugerida (10/15/20%, informativa, no se suma al
     total — coherente con "propina no gravada" del ADR-3), corte parcial,
     y **apertura de cajón SOLO si `metodoPago === "efectivo"`**.
3. `simulator.mjs` — decodifica los bytes de vuelta a comandos estructurados
   + preview ASCII, permitiendo probar la lógica de negocio (qué se imprime,
   cuándo se abre el cajón, cuándo se corta) sin una impresora física.

## Resultado de los tests (5+4 aserciones, todas verdes)

- Comanda: inicializa, corta, **nunca** abre cajón, mesa visible, modificadores
  en su propia línea.
- Cuenta en efectivo: corta y **sí** abre cajón.
- Cuenta con tarjeta: corta y **NO** abre cajón (bug común en integraciones
  reales — aquí queda cubierto por test desde el día 1).
- Totales formateados correctamente en pesos.

## ⛔ Bloqueo real: no hay impresora térmica 80mm física en esta máquina

El PLAN.md (§11.3) ya lo marcaba como pendiente de conseguir. Este spike NO
puede validar (y por lo tanto el diseño de impresión NO debe congelarse del
todo hasta tenerlo):

- Ancho real de columna en la impresora del cliente (asumido 42 caracteres a
  fuente normal — típico en 80mm, pero varía por firmware/marca).
- Soporte real de `GS V 1` (corte parcial) vs. solo `GS V 0` — algunas clonas
  chinas ignoran el parámetro y siempre cortan total.
- Codificación de caracteres: se optó por **normalizar acentos a ASCII plano**
  (`café` → `cafe`) porque la mayoría de térmicas baratas no traen tabla de
  código UTF-8 por default (usan CP437 o Windows-1252 vía comando `ESC t n`,
  que varía por fabricante). Esto es una limitación conocida y aceptada para
  el MVP; revisar `ESC t` por modelo de impresora cuando se pruebe con
  hardware real — puede que valga la pena soportarlo por marca detectada.
- Timing real de apertura de cajón (`t1=25ms, t2=250ms` son valores típicos
  de la hoja de datos Epson; el cajón real del restaurante puede necesitar
  otros).
- USB vs. Ethernet: el WebUSB de `thermalPrinter.ts` cubre USB; impresoras de
  cocina en Ethernet (recomendadas para no depender de que la tablet de
  mesero esté conectada) necesitan un cliente TCP crudo al puerto 9100 —
  **no prototipado aún**, es una tarea nueva de Fase 5/6, no de este spike.

**Para desbloquear:** conseguir una impresora térmica 80mm (USB o Ethernet,
ideal: una de cada para cubrir ambos casos) y repetir `node test.mjs` con
`thermalPrinter.sendRaw()` real en vez del simulador.

## Decisión tomada sin bloquear

El **formato y contenido** de comanda/cuenta (qué se imprime y cuándo se abre
el cajón) queda validado por tests y puede avanzar a Fase 4/6. Lo que queda
pendiente es puramente de **compatibilidad de firmware**, que es barato de
ajustar después (son ~10 líneas en `encoder.mjs`) y no debe bloquear el resto
del roadmap.
