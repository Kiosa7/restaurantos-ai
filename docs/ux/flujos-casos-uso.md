# Flujos UX, casos de uso e historias de usuario — RestaurantOS AI

## Flujo 1: Mesero toma una comanda

1. Mesero abre la PWA en su tablet (ya pareada) → ve el `FloorPlan` con
   colores por estado de mesa.
2. Toca una mesa libre → confirma número de comensales → mesa pasa a
   `ocupada`, se crea la `Order`.
3. Por cada platillo: busca/toca categoría → toca el platillo → si tiene
   modificadores, aparecen como botones grandes (nunca un dropdown) →
   confirma cantidad → el ítem aparece en la comanda en construcción con
   feedback optimista (< 100 ms percibidos, aunque el hub confirme después).
4. Toca "Enviar a cocina" → el comando `nueva_comanda`/`agregar_items` sale
   con UUID idempotente (spike 1) → si no hay respuesta en X ms, se reintenta
   con el MISMO UUID sin duplicar en el hub.
5. La comanda enviada aparece en el KDS en < 1 s (validado en spike 1).

**Meta de UX**: comanda completa en ≤ 3 toques por platillo (buscar/tocar
categoría → tocar platillo → confirmar modificador si aplica). Se valida en
Fase 3 con un prototipo clicable, no solo en el papel.

## Flujo 2: Cocina prepara y marca

1. KDS muestra tarjetas (`OrderTicket`) ordenadas por antigüedad, coloreadas
   por urgencia (verde→amarillo→rojo según tiempo transcurrido, calculado
   SIEMPRE contra el reloj del hub, nunca el de la pantalla del KDS).
2. Cocina toca la tarjeta al empezar → `en_preparacion` (dispara el descuento
   de inventario por receta, ver `docs/modelo-dominio.md` regla 3).
3. Cocina toca de nuevo al terminar → `listo` → bump, la tarjeta desaparece
   del KDS y se notifica a caja/mesero.
4. Si una tablet de KDS muere en pleno servicio: la comanda ya se imprimió en
   la impresora de cocina al enviarse (respaldo físico, PLAN.md §4) — el
   servicio no se detiene.

## Flujo 3: Caja cobra y cierra

1. Cajero/gerente abre la comanda de una mesa desde el hub.
2. Elige dividir (por comensal/por ítem/partes iguales) o cobrar completo.
3. Elige método de pago → si es efectivo, el ticket impreso abre el cajón
   automáticamente (spike 2); si es tarjeta, no.
4. Se genera la venta (inmutable, hash chain heredado de pos-inteligente),
   se registra en la caja del turno, se imprime la cuenta.
5. Al final del turno: arqueo (`domain/cash.ts closeSession`, ya probado en
   pos-inteligente) + reparto de propinas según configuración del turno.

## Flujo 4: Dueño consulta al copiloto de IA

1. Desde el hub (o eventualmente remoto en Fase 8), el dueño pregunta en
   lenguaje natural: "¿qué me está dejando más dinero esta semana?"
2. El LLM invoca una tool tipada (nunca escribe SQL) que consulta una vista
   de márgenes por platillo con el tenant/local ya inyectado.
3. Respuesta en segundos (confirmado por spike 4: ~1-3 s con los modelos de
   texto en hardware de referencia), citando la tool usada para trazabilidad.

## Casos de uso priorizados (para historias de usuario)

1. Como mesero, quiero tomar una comanda con modificadores sin perder tiempo
   con teclados, para no hacer esperar a la mesa siguiente.
2. Como cocinero, quiero ver cuánto tiempo lleva cada platillo sin tener que
   preguntarle a nadie, para priorizar lo que se está por retrasar.
3. Como cajero, quiero dividir una cuenta entre 5 personas de forma distinta
   (3 pagan parejo, 2 pagan lo suyo) sin recalcular a mano.
4. Como gerente, quiero que el sistema me avise qué se va a acabar durante el
   servicio ("86 predictivo") antes de que un mesero prometa un platillo que
   ya no hay.
5. Como dueño, quiero preguntarle al sistema en español qué platillo me
   conviene promocionar, sin tener que abrir un reporte y sacar cuentas.
6. Como mesero, si mi tablet pierde la conexión WiFi a media comanda, quiero
   que se reconecte sola y mande lo que tenía pendiente sin duplicar nada.

## Historias de usuario diferidas a fases posteriores (documentadas para no perderlas)

- Como cliente, quiero reservar una mesa desde el celular (Fase 7).
- Como dueño de 3 sucursales, quiero ver un reporte consolidado (Fase 8).
- Como mesero, quiero cobrar propina con tarjeta directo en la mesa (requiere
  terminal de pago integrada — fuera de alcance hasta que haya un proveedor
  de pagos elegido; no está en el roadmap actual, anotado como pendiente de
  decisión del dueño).
