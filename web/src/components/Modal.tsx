import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
	title: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	wide?: boolean;
}

export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return (
		<div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				className={`modal-card${wide ? " modal-card--wide" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="modal-title"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="modal-header">
					<h2 id="modal-title">{title}</h2>
					<button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>
						<X size={18} />
					</button>
				</header>
				<div className="modal-body">{children}</div>
				{footer ? <footer className="modal-footer">{footer}</footer> : null}
			</section>
		</div>
	);
}
