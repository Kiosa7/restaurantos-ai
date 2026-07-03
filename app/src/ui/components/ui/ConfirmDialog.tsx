import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Usa el estilo peligroso para acciones destructivas. */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación para acciones críticas (borrar, cerrar caja, etc.).
 * Principio UX: confirmar solo lo irreversible, nunca lo cotidiano.
 */
export function ConfirmDialog({
  open, title, description, confirmLabel = "Confirmar", cancelLabel = "Cancelar",
  danger, loading, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      dismissable={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
