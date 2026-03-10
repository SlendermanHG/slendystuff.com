(async () => {
  const app = window.SlendyApp;
  app.initHeaderMenu();

  const couponInput = document.querySelector("[data-coupon-input]");
  const applyCouponButton = document.querySelector("[data-apply-coupon]");
  const removeCouponButton = document.querySelector("[data-remove-coupon]");
  const payLink = document.querySelector("[data-pay-link]");
  const freeCheckoutButton = document.querySelector("[data-free-checkout]");
  const statusNode = document.querySelector("[data-checkout-status]");
  const productNode = document.querySelector("[data-checkout-product]");
  const baseNode = document.querySelector("[data-checkout-base]");
  const discountNode = document.querySelector("[data-checkout-discount]");
  const totalNode = document.querySelector("[data-checkout-total]");
  const titleNode = document.querySelector("[data-checkout-title]");

  const COUPON_CODE = "SLENDERFAM";
  let config = null;
  let product = null;
  let basePrice = 0;
  let discount = 0;

  try {
    config = await app.fetchPublicConfig();
    app.injectAnalytics(config);
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = config.brand.name || "slendystuff";
    });

    const params = new URLSearchParams(window.location.search);
    const productId = String(params.get("id") || "").trim();
    product = (config.products || []).find((item) => item.id === productId) || null;

    if (!product) {
      setStatus("No product selected. Please choose a product from the catalog.", "error");
      if (productNode) productNode.textContent = "No product selected";
      if (payLink) payLink.classList.add("hidden");
      if (freeCheckoutButton) freeCheckoutButton.classList.add("hidden");
      return;
    }

    basePrice = extractBasePrice(product.priceLabel);
    if (productNode) productNode.textContent = product.title;
    if (titleNode) titleNode.textContent = `Checkout: ${product.title}`;

    const initialCode = String(params.get("code") || "").trim();
    if (initialCode) {
      couponInput.value = initialCode;
    }

    updateTotals();
    app.track("page_view", { page: "checkout", productId: product.id });
  } catch (error) {
    setStatus(error.message || "Checkout could not load.", "error");
  }

  if (applyCouponButton) {
    applyCouponButton.addEventListener("click", () => {
      const code = String((couponInput && couponInput.value) || "").trim().toUpperCase();
      if (code === COUPON_CODE) {
        discount = basePrice;
        setStatus("Coupon applied. Total is now $0.00.", "ok");
        app.track("coupon_applied", { productId: product ? product.id : "none", code });
      } else {
        discount = 0;
        setStatus("Invalid coupon code.", "error");
      }
      updateTotals();
    });
  }

  if (removeCouponButton) {
    removeCouponButton.addEventListener("click", () => {
      discount = 0;
      if (couponInput) {
        couponInput.value = "";
      }
      setStatus("Coupon removed.", "");
      updateTotals();
    });
  }

  if (freeCheckoutButton) {
    freeCheckoutButton.addEventListener("click", () => {
      if (!product) {
        return;
      }
      app.track("free_checkout_complete", { productId: product.id, coupon: COUPON_CODE });
      app.updateCartQty(product.id, 0);
      setStatus("Free checkout completed. I will follow up with setup details.", "ok");
      freeCheckoutButton.classList.add("hidden");
      if (payLink) {
        payLink.classList.add("hidden");
      }
    });
  }

  function updateTotals() {
    const total = Math.max(0, basePrice - discount);
    const checkoutUrl = product ? app.getCheckoutUrl(product, (config && config.stripeLinks) || {}) : "#";

    if (baseNode) baseNode.textContent = basePrice.toFixed(2);
    if (discountNode) discountNode.textContent = discount.toFixed(2);
    if (totalNode) totalNode.textContent = total.toFixed(2);

    if (payLink) {
      payLink.href = checkoutUrl;
      payLink.classList.toggle("hidden", total <= 0);
    }

    if (freeCheckoutButton) {
      freeCheckoutButton.classList.toggle("hidden", total > 0);
    }
  }

  function extractBasePrice(priceLabel) {
    const match = String(priceLabel || "").match(/([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!match) {
      return 0;
    }
    return Number(match[1]) || 0;
  }

  function setStatus(message, state = "") {
    if (!statusNode) {
      return;
    }
    statusNode.textContent = message;
    statusNode.className = state ? `status ${state}` : "status";
  }
})();
