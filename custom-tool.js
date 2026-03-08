(async () => {
  const app = window.SlendyApp;
  app.initHeaderMenu();

  const form = document.querySelector("[data-custom-tool-form]");
  const status = document.querySelector("[data-custom-tool-status]");
  const targetEmail = "Operations@slendystuff.com";

  try {
    const config = await app.fetchPublicConfig();
    app.injectAnalytics(config);
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = config.brand.name;
    });
    app.track("page_view", { page: "custom_tool" });
  } catch {
    // Keep page functional even without config.
  }

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const remoteOptions = formData.getAll("remoteOptions").map(String);
    const payload = {
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      toolType: String(formData.get("toolType") || ""),
      timeline: String(formData.get("timeline") || ""),
      whatWant: String(formData.get("whatWant") || ""),
      howUsed: String(formData.get("howUsed") || ""),
      remoteOptions,
      budget: String(formData.get("budget") || ""),
      notes: String(formData.get("notes") || ""),
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    try {
      await fetch("/api/tool-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch {
      // Ignore; fallback to email draft always happens.
    }

    const subject = encodeURIComponent(`Custom Tool Request - ${payload.toolType || "General"}`);
    const body = encodeURIComponent(
      `Name: ${payload.name}\nEmail: ${payload.email}\nRequest Type: ${payload.toolType}\nTimeline: ${payload.timeline}\nBudget: ${payload.budget || "Not provided"}\nTimezone: ${payload.clientTimezone}\n\nWhat do you want built?\n${payload.whatWant}\n\nHow will it be used?\n${payload.howUsed}\n\nRemote Management Tailoring:\n${payload.remoteOptions.join(", ") || "None selected"}\n\nProject Overview / Notes / Comments:\n${payload.notes || "None"}`
    );

    window.location.href = `mailto:${targetEmail}?subject=${subject}&body=${body}`;
    if (status) {
      status.textContent = "Email draft opened. Send it when ready.";
      status.className = "status ok";
    }

    app.track("custom_tool_request_drafted", {
      toolType: payload.toolType,
      remoteOptions: payload.remoteOptions
    });
  });
})();