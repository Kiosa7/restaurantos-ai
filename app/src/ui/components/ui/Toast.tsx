import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { cn } from "@ui/lib/cn";

type ToastTone = "success" | "warning" | "danger" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ICONS: Record<ToastTone, React.ElementType> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger:  XCircle,
  info:    Info,
};

const ACCENT: Record<ToastTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger:  "text-danger",
  info:    "text-info",
};

interface ToastApi {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Hook para lanzar notificaciones elegantes desde cualquier pantalla. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
        role="region"
        aria-live="polite"
        aria-label="Notificaciones"
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={() => setItems((p) => p.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon = ICONS[item.tone];
  const [shown, setShown] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white",
        "px-4 py-2.5 shadow-lg transition-all duration-200",
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0", ACCENT[item.tone])} aria-hidden />
      <span className="text-sm font-medium text-slate-800">{item.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Descartar"
        className="ml-1 rounded p-0.5 text-slate-300 hover:text-slate-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
