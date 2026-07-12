import { useState } from "react";
import { Modal } from "./Modal";

interface QuickEntryDialogProps {
	title: string;
	label: string;
	placeholder: string;
	initialValue?: string;
	submitLabel: string;
	onSubmit: (value: string) => void;
	onClose: () => void;
}

export function QuickEntryDialog({ title, label, placeholder, initialValue = "", submitLabel, onSubmit, onClose }: QuickEntryDialogProps) {
	const [value, setValue] = useState(initialValue);
	const submit = () => {
		if (!value.trim()) return;
		onSubmit(value.trim());
	};
	return (
		<Modal
			title={title}
			onClose={onClose}
			footer={<><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button type="button" className="button-primary" disabled={!value.trim()} onClick={submit}>{submitLabel}</button></>}
		>
			<label className="field-label">
				<span>{label}</span>
				<input autoFocus value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
			</label>
		</Modal>
	);
}
