(async () => {
  const app = window.SlendyApp;
  app.initHeaderMenu();

  const contentNode = document.querySelector("[data-product-content]");
  const notFoundNode = document.querySelector("[data-product-not-found]");

  try {
    const config = await app.fetchPublicConfig();
    app.injectAnalytics(config);

    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = config.brand.name;
    });

    const params = new URLSearchParams(window.location.search);
    const productIdFromQuery = params.get("id");
    const productIdFromPage = document.body.getAttribute("data-product-id");
    const productId = productIdFromQuery || productIdFromPage;

    const product = (config.products || []).find((item) => item.id === productId);
    if (!product) {
      if (contentNode) contentNode.classList.add("hidden");
      if (notFoundNode) notFoundNode.classList.remove("hidden");
      app.track("product_not_found", { productId: productId || "empty" });
      return;
    }

    document.title = `${product.title} | ${config.brand.name || "slendystuff"}`;

    const allow = !product.requires18Plus || (await app.promptAgeGate(product.id));
    if (!allow) {
      if (contentNode) {
        contentNode.innerHTML = `
          <article class="card">
            <h2>Age Confirmation Required</h2>
            <p class="muted">This item is available only to visitors who are 18 or older.</p>
            <a class="btn" href="/">Return Home</a>
          </article>
        `;
      }
      return;
    }

    if (contentNode) {
      contentNode.innerHTML = `
        <article class="card">
          <p class="eyebrow">${escapeHtml(product.category)}</p>
          <h1>${escapeHtml(product.title)}</h1>
          <p class="muted">${escapeHtml(product.summary)}</p>
          <div class="kicker-row">
            <span class="kicker">${escapeHtml(product.priceLabel || "")}</span>
            ${
              product.requires18Plus
                ? '<span class="kicker">18+ Verified</span>'
                : '<span class="kicker">All Ages</span>'
            }
          </div>
          <div class="inline-actions">
            <a class="btn" href="${escapeHtml(app.getCheckoutPageUrl(product.id))}" data-track="product_checkout">Checkout</a>
            <button class="btn btn-ghost" type="button" data-track="add_to_cart">Add To Cart</button>
            <a class="btn btn-ghost" href="/cart.html">Open Cart</a>
            <a class="btn btn-ghost" href="${escapeHtml(product.ctaUrl || "/support.html")}" target="_blank" rel="noopener" data-track="product_cta">${escapeHtml(product.ctaLabel || "Need setup help?")}</a>
          </div>
        </article>
      `;

      contentNode.querySelectorAll("[data-track='product_cta']").forEach((node) => {
        node.addEventListener("click", () => {
          app.track("product_cta", { productId: product.id });
        });
      });

      const checkoutButton = contentNode.querySelector("[data-track='product_checkout']");
      if (checkoutButton) {
        checkoutButton.addEventListener("click", () => {
          app.track("product_checkout", { productId: product.id });
        });
      }

      const addToCartButton = contentNode.querySelector("[data-track='add_to_cart']");
      if (addToCartButton) {
        addToCartButton.addEventListener("click", () => {
          app.addToCart(product.id, 1);
          app.track("product_add_to_cart", { productId: product.id });
          addToCartButton.textContent = "Added";
          setTimeout(() => {
            addToCartButton.textContent = "Add To Cart";
          }, 1400);
        });
      }
    }

    app.track("product_view", { productId: product.id, requires18Plus: product.requires18Plus });
  } catch (error) {
    if (contentNode) {
      contentNode.innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
