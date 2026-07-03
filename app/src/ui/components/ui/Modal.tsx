import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@ui/lib/cn";
import { IconButton } from "./IconButton";

type Size = "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: Size;
  /** Contenido fijo al pie (ej. botones de acción). */
  footer?: React.ReactNode;
  /** Si false, no cierra al hacer clic en el fondo (acciones críticas). */
  dismissable?: boolean;
  children?: React.ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Modal accesible reutilizable: bloquea el scroll del fondo, atrapa el foco
 * (Tab/Shift+Tab), cierra con Esc, restaura el foco al cerrar y expone
 * role="dialog" con aria. Reemplaza los 7 overlays `inset-0` hechos a mano.
 */
export function Modal({
  open, onClose, title, description, size = "md",
  footer, dismissable = true, children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Enfoca el primer elemento del panel al abrir.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null);
      if (nodes.length === 0) return;
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      prevFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const titleId = title ? "modal-title" : undefined;
  const descId = description ? "modal-desc" : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
        onClick={dismissable ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[90dvh] w-full flex-col overflow-hidden outline-none",
          "rounded-[var(--radius-card)] bg-white shadow-2xl",
          "duration-200 animate-[modal-in_.2s_ease]",
          SIZES[size],
        )}
      >
        {(title || dismissable) && (
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
              )}
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-slate-500">{description}</p>
              )}
            </div>
            {dismissable && (
              <IconButton label="Cerrar" icon={X} size="sm" onClick={onClose} className="-mr-1 -mt-1" />
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
