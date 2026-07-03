import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Trash2 } from "lucide-react";
import {
  Button, IconButton, Input, Field, Card, StatCard, Badge,
  Modal, ConfirmDialog, Segmented, EmptyState, Spinner,
} from "./index";

/** Render estático (SSR), mismo patrón que smoke.test.tsx (sin jsdom). */
const html = (el: React.ReactElement) => renderToString(el);

describe("Design System — primitivas", () => {
  it("Button renderiza texto y marca aria-busy al cargar", () => {
    expect(html(<Button>Cobrar</Button>)).toContain("Cobrar");
    expect(html(<Button loading>Cobrar</Button>)).toContain('aria-busy="true"');
  });

  it("IconButton expone aria-label accesible", () => {
    expect(html(<IconButton label="Quitar" icon={Trash2} />)).toContain('aria-label="Quitar"');
  });

  it("Field enlaza label ↔ input y muestra error", () => {
    const out = html(
      <Field label="Nombre" error="Requerido">
        {({ id, invalid }) => <Input id={id} invalid={invalid} />}
      </Field>,
    );
    expect(out).toContain("Nombre");
    expect(out).toContain("Requerido");
    expect(out).toContain('aria-invalid="true"');
  });

  it("StatCard renderiza etiqueta y valor", () => {
    const out = html(<Card><StatCard label="Ventas" value="$100" /></Card>);
    expect(out).toContain("Ventas");
    expect(out).toContain("$100");
  });

  it("Badge muestra texto (no depende solo del color)", () => {
    expect(html(<Badge tone="danger" dot>Agotado</Badge>)).toContain("Agotado");
  });

  it("Segmented es un radiogroup con opciones", () => {
    const out = html(
      <Segmented
        ariaLabel="Opciones"
        value="a"
        onChange={() => {}}
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
      />,
    );
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-checked="true"'); // opción activa
  });

  it("Modal cerrado no renderiza contenido; abierto expone dialog", () => {
    expect(html(<Modal open={false} onClose={() => {}} title="X" />)).toBe("");
    const out = html(<Modal open onClose={() => {}} title="Título" description="desc" />);
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain("Título");
  });

  it("ConfirmDialog muestra acciones", () => {
    const out = html(
      <ConfirmDialog open title="¿Borrar?" danger onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain("¿Borrar?");
    expect(out).toContain("Confirmar");
    expect(out).toContain("Cancelar");
  });

  it("EmptyState y Spinner son accesibles", () => {
    expect(html(<EmptyState title="Sin datos" />)).toContain("Sin datos");
    expect(html(<Spinner />)).toContain('role="status"');
  });
});
