const live = () => document.getElementById("live");

async function poll() {
	const now = live();
	if (now?.dataset.live !== "1") return;
	try {
		const res = await fetch(location.pathname, { headers: { accept: "text/html" } });
		const next = new DOMParser().parseFromString(await res.text(), "text/html").getElementById("live");
		if (next) now.replaceWith(next);
	} catch {}
	setTimeout(poll, 1000);
}
setTimeout(poll, 1000);

if ("BarcodeDetector" in window) {
	for (const input of document.querySelectorAll("input[data-scan]")) {
		const file = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
		file.setAttribute("capture", "environment");
		const button = Object.assign(document.createElement("button"), { type: "button", className: "scan", textContent: "Scan a QR code" });
		button.onclick = () => file.click();
		file.onchange = async () => {
			const [code] = await new BarcodeDetector({ formats: ["qr_code"] }).detect(await createImageBitmap(file.files[0])).catch(() => []);
			if (code) input.value = code.rawValue;
			else button.textContent = "No QR code found, try again";
		};
		input.after(button, file);
	}
}
