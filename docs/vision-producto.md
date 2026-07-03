# Visión de producto — RestaurantOS AI

## Problema

Los restaurantes independientes en México (el segmento objetivo, no cadenas)
operan hoy con una de tres opciones: papel y lápiz, un POS de mostrador
genérico sin noción de mesas/comandas/cocina, o un SaaS en la nube que deja
de funcionar cuando cae el Internet del local — justo en la hora pico de un
viernes en la noche. Ninguna de las tres resuelve el problema real: **una
comanda que viaja de la mesa a la cocina sin perderse, sin duplicarse, y sin
depender de que el router del restaurante tenga buen día.**

## Producto

RestaurantOS AI es un sistema operativo de restaurante Local-First: una PC
modesta en el local es la única fuente de verdad y el negocio opera 100% sin
Internet — caja, mesas, comandas, cocina, cortes. La nube es un lujo, no una
dependencia: respalda, sincroniza multi-sucursal, gestiona licencias y
factura. La IA corre local (Ollama) como copiloto del dueño, nunca como
requisito para vender.

## A quién sirve (personas)

1. **El mesero**: necesita tomar una comanda completa en menos tiempo del que
   tarda en caminar a la cocina. Modificadores como botones grandes, nunca
   formularios.
2. **La cocina**: necesita ver qué se pidió, en qué orden, y cuánto tiempo
   lleva cada platillo — legible a 2 metros, sin tocar nada con las manos
   sucias salvo un botón grande de "listo".
3. **El dueño/gerente en caja**: necesita cerrar la cuenta rápido, dividir
   entre comensales, cuadrar la caja al final del turno, y — cuando tiene un
   minuto — preguntarle a la IA qué le está dejando dinero y qué no.

## Qué NO es este producto (para no perder el foco)

- No es un ERP de cadena de restaurantes (eso es Fase 8, y solo si el
  producto de un solo local ya funciona de verdad).
- No es una app de delivery — se integra con ellas en Fase 7, no las
  reemplaza.
- No depende de que haya Internet para vender. Si una función lo requiere
  (CFDI, sync), esa función se degrada a "cola offline", nunca bloquea la
  venta.

## Criterio de éxito del producto (no de una fase)

Un restaurante real elige RestaurantOS AI sobre papel y lápiz porque es más
rápido, y sobre un SaaS en la nube porque nunca lo deja parado un viernes en
la noche. El primer indicador honesto de que el producto sirve es el mismo
criterio del MVP (PLAN.md §9): un restaurante piloto opera un servicio de
viernes completo sin tocar papel.
