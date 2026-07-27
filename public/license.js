(function () {
  const form = document.getElementById("license-form");
  const product = document.getElementById("product-id");
  const note = document.getElementById("product-note");
  const fields = document.getElementById("registration-fields");
  const result = document.getElementById("license-result");
  if (!form || !product || !note || !fields || !result) return;
  const catalog = {
    qwertylock: { note: "QwertyLock is free forever and hosted by SlendyStuff. No key registration is needed.", mode: "free" },
    "point-of-sale": { note: "Register the purchase key for Point of Sale.", mode: "license" },
    "event-organizer": { note: "Register the purchase key for Event Organizer.", mode: "license" },
    custom: { note: "Custom software uses separate billing and protection. Contact SlendyStuff to register it.", mode: "custom" }
  };
  function updateProduct() {
    const selected = catalog[product.value];
    note.textContent = selected ? selected.note : "Choose the product from your purchase.";
    const shouldShow = selected?.mode === "license";
    fields.hidden = !shouldShow;
    fields.style.display = shouldShow ? "block" : "none";
    document.getElementById("license-key").required = shouldShow;
  }
  product.addEventListener("change", updateProduct);
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (catalog[product.value]?.mode !== "license") return;
    result.className = "license-result is-loading";
    result.textContent = "Registering your key…";
    const payload = { productId: product.value, fullName: form.elements.fullName.value, businessName: form.elements.businessName.value, key: form.elements.key.value };
    try {
      const response = await fetch("/license-api/api/licenses/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!data.registered) { result.className = "license-result is-error"; result.textContent = data.error || "We could not register that key."; return; }
      result.className = "license-result is-success";
      result.innerHTML = "<strong>Key registered</strong><span>Product: " + String(data.product).replace(/[<>]/g, "") + "</span><span>Your purchase is now connected to the provided name or business.</span>";
      form.reset(); updateProduct();
    } catch (_error) { result.className = "license-result is-error"; result.textContent = "The licensing service is temporarily unavailable. Please try again shortly."; }
  });
  updateProduct();
}());
