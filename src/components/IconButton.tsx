import type { ReactNode } from "react";

type IconButtonProps = {
  label: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
};

export function IconButton(props: IconButtonProps) {
  const { label, title, onClick, disabled, active, children } = props;

  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
