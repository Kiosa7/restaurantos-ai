/**
 * Design System — primitivas reutilizables del POS.
 * Punto único de importación: `import { Button, Modal, ... } from "@ui/components/ui"`.
 * Consumen los tokens de src/index.css (@theme). No contienen lógica de negocio.
 */
export { Button, type ButtonProps } from "./Button";
export { IconButton, type IconButtonProps } from "./IconButton";
export { Input, Field, type InputProps, type FieldProps } from "./Input";
export { Card, StatCard, type StatCardProps } from "./Card";
export { Badge, type BadgeProps } from "./Badge";
export { Modal, type ModalProps } from "./Modal";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { Segmented, type SegmentedOption, type SegmentedProps } from "./Segmented";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { Spinner, type SpinnerProps } from "./Spinner";
export { ToastProvider, useToast } from "./Toast";
