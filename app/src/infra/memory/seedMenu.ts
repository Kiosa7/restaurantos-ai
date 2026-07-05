// Fixture de solo-lectura para tests de dominio puro (comandaFlow.test.ts).
// La UI real ya NO usa este archivo: desde Fase 6 §10.1 el menú viene de
// `GET /menu` sobre el hub (mismos ids, ver app/src-tauri/src/seed.rs).
import { fromMajor } from "@domain/money";
import type { Categoria, MenuItem } from "@domain/menu";

export const categoriasSeed: Categoria[] = [
  { id: "cat_entradas", nombre: "Entradas" },
  { id: "cat_fuertes", nombre: "Fuertes" },
  { id: "cat_bebidas", nombre: "Bebidas" },
  { id: "cat_postres", nombre: "Postres" },
];

export const menuSeed: MenuItem[] = [
  {
    id: "mi_tacos_pastor",
    nombre: "Tacos al pastor",
    categoria: "cat_fuertes",
    tiempo: "fuerte",
    precioCents: fromMajor(90),
    modifierGroups: [
      {
        id: "mg_salsa",
        nombre: "Salsa",
        seleccionUnica: true,
        requerido: true,
        opciones: [
          { id: "op_salsa_verde", nombre: "Verde", ajusteCents: fromMajor(0) },
          { id: "op_salsa_roja", nombre: "Roja", ajusteCents: fromMajor(0) },
          { id: "op_salsa_ambas", nombre: "Ambas", ajusteCents: fromMajor(0) },
        ],
      },
    ],
  },
  {
    id: "mi_quesadilla_flor",
    nombre: "Quesadilla de flor de calabaza",
    categoria: "cat_entradas",
    tiempo: "entrada",
    precioCents: fromMajor(65),
    modifierGroups: [],
  },
  {
    id: "mi_agua_horchata",
    nombre: "Agua de horchata",
    categoria: "cat_bebidas",
    tiempo: "bebida",
    precioCents: fromMajor(35),
    modifierGroups: [
      {
        id: "mg_tamano",
        nombre: "Tamaño",
        seleccionUnica: true,
        requerido: true,
        opciones: [
          { id: "op_chica", nombre: "Chica", ajusteCents: fromMajor(0) },
          { id: "op_grande", nombre: "Grande", ajusteCents: fromMajor(15) },
        ],
      },
    ],
  },
  {
    id: "mi_flan",
    nombre: "Flan napolitano",
    categoria: "cat_postres",
    tiempo: "postre",
    precioCents: fromMajor(45),
    modifierGroups: [],
  },
];
