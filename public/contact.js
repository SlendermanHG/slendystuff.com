(async () => {
  const app = window.SlendyApp;
  app.initHeaderMenu();

  const form = document.querySelector("[data-contact-form]");
  const status = document.querySelector("[data-contact-status]");
  const targetEmail = "Help@slendystuff.com";

  try {
    const config = await app.fetchPublicConfig();
    app.injectAnalytics(config);
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = config.brand.name;
    });
    app.track("page_view", { page: "contact" });
  } catch {
    // Page should still function without config.
  }

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      subject: String(formData.get("subject") || ""),
      message: String(formData.get("message") || ""),
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    try {
      await fetch("/api/contact-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch {
      // Ignore; fallback email draft still used.
    }

    const subject = encodeURIComponent(payload.subject || "General Contact");
    const body = encodeURIComponent(
      `Name: ${payload.name}\nEmail: ${payload.email}\nTimezone: ${payload.clientTimezone}\n\nMessage:\n${payload.message}`
    );

    window.location.href = `mailto:${targetEmail}?subject=${subject}&body=${body}`;
    if (status) {
      status.textContent = "Email draft opened. Send it when ready.";
      status.className = "status ok";
    }

    app.track("contact_message_drafted", { hasSubject: Boolean(payload.subject) });
  });
})();