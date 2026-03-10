(async () => {
  const app = window.SlendyApp;
  app.initHeaderMenu();

  try {
    const config = await app.fetchPublicConfig();
    app.injectAnalytics(config);
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = config.brand.name;
    });
  } catch {
    // Keep page usable even if config call fails.
  }

  app.track("page_view", { page: "about" });
})();
