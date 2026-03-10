(async () => {
  const app = window.SlendyApp;
  app.initHeaderMenu();

  try {
    const config = await app.fetchPublicConfig();
    app.injectAnalytics(config);

    document.title = `${config.brand.name} | Software Tools and Support`;

    const brandTargets = document.querySelectorAll("[data-brand-name]");
    brandTargets.forEach((node) => {
      node.textContent = config.brand.name;
    });

    const tagline = document.querySelector("[data-tagline]");
    const heroTitle = document.querySelector("[data-hero-title]");
    const heroSubtitle = document.querySelector("[data-hero-subtitle]");

    if (tagline) tagline.textContent = config.brand.tagline;
    if (heroTitle) heroTitle.textContent = config.brand.heroTitle;
    if (heroSubtitle) heroSubtitle.textContent = config.brand.heroSubtitle;

    renderProducts(config.products || []);
    renderStripeLinks(config.stripeLinks || {});
    initIdeaLab(config.products || [], config.stripeLinks || {}, config.support || {});

    app.track("page_view", { page: "home" });
  } catch (error) {
    const mount = document.querySelector("[data-products-mount]");
    if (mount) {
      mount.innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderStripeLinks(links) {
    const starter = document.querySelector("[data-stripe='starter']");
    const pro = document.querySelector("[data-stripe='pro']");
    const reset = document.querySelector("[data-stripe='reset']");

    if (starter) starter.href = links.starter || "#";
    if (pro) pro.href = links.pro || "#";
    if (reset) reset.href = links.reset || "#";
  }

  function renderProducts(products) {
    const mount = document.querySelector("[data-products-mount]");
    if (!mount) {
      return;
    }

    if (!products.length) {
      mount.innerHTML = "<p class='muted'>The catalog is being refreshed right now. Please check back soon.</p>";
      return;
    }

    const groups = products.reduce((acc, item) => {
      const category = item.category || "Uncategorized";
      acc[category] = acc[category] || [];
      acc[category].push(item);
      return acc;
    }, {});

    const categories = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const html = categories
      .map((category) => {
        const cards = groups[category]
          .map((item) => {
            const adultBadge = item.requires18Plus
              ? '<span class="badge warning">18+ Verification</span>'
              : '<span class="badge">All Ages</span>';

            return `
              <article class="card" id="product-${escapeHtml(item.id)}">
                <h3>${escapeHtml(item.title)}</h3>
                <p class="muted">${escapeHtml(item.summary)}</p>
                <div class="product-meta">
                  <strong>${escapeHtml(item.priceLabel || "")}</strong>
                  ${adultBadge}
                </div>
                <div class="product-actions">
                  <a class="btn" href="/product.html?id=${encodeURIComponent(item.id)}" data-action="product_open" data-product-id="${escapeHtml(item.id)}">View Details</a>
                  <a class="btn btn-ghost" href="${escapeHtml(item.ctaUrl || "#")}" target="_blank" rel="noopener" data-action="product_cta" data-product-id="${escapeHtml(item.id)}">${escapeHtml(item.ctaLabel || "Learn More")}</a>
                </div>
              </article>
            `;
          })
          .join("\n");

        return `
          <section class="section" id="cat-${slugify(category)}">
            <div class="section-head">
              <p class="eyebrow">Category</p>
              <h2>${escapeHtml(category)}</h2>
            </div>
            <div class="grid two">${cards}</div>
          </section>
        `;
      })
      .join("\n");

    mount.innerHTML = html;

    mount.querySelectorAll("[data-action]").forEach((node) => {
      node.addEventListener("click", () => {
        app.track(node.dataset.action, {
          productId: node.dataset.productId || "unknown"
        });
      });
    });
  }

  function initIdeaLab(products, stripeLinks, supportConfig) {
    const ideaButton = document.querySelector("[data-idea-generate]");
    const pricingButton = document.querySelector("[data-pricing-generate]");
    const ideaResultsNode = document.querySelector("[data-idea-results]");
    const pricingResultsNode = document.querySelector("[data-pricing-results]");

    if (!ideaButton || !pricingButton || !ideaResultsNode || !pricingResultsNode) {
      return;
    }

    const ideaAudienceInput = document.querySelector("[data-idea-audience]");
    const ideaGoalInput = document.querySelector("[data-idea-goal]");
    const ideaStageInput = document.querySelector("[data-idea-stage]");
    const ideaTimelineInput = document.querySelector("[data-idea-timeline]");

    const priceBudgetInput = document.querySelector("[data-price-budget]");
    const priceAudienceInput = document.querySelector("[data-price-audience]");
    const priceGoalInput = document.querySelector("[data-price-goal]");
    const priceRiskInput = document.querySelector("[data-price-risk]");

    const supportEmail = safeSupportEmail(supportConfig.supportEmail);
    const productPool = normalizeProducts(products);

    ideaButton.addEventListener("click", () => {
      const answers = {
        audience: readValue(ideaAudienceInput),
        goal: readValue(ideaGoalInput),
        stage: readValue(ideaStageInput),
        timeline: readValue(ideaTimelineInput)
      };

      const missing = [];
      if (!answers.audience) missing.push("Who are you trying to help?");
      if (!answers.goal) missing.push("What outcome matters most?");
      if (!answers.stage) missing.push("Where are you right now?");
      if (!answers.timeline) missing.push("How fast do you want results?");

      if (missing.length > 0) {
        renderPromptCard(
          ideaResultsNode,
          "Answer these before rolling your adventure:",
          missing
        );
        app.track("idea_lab_missing_answers", { area: "idea", missingCount: missing.length });
        return;
      }

      const adventures = [1, 2, 3].map((index) => {
        const product = pickProductForStage(productPool, answers.stage, index);
        return buildIdeaAdventure(index, answers, product, supportEmail);
      });

      ideaResultsNode.innerHTML = adventures.map((item) => renderIdeaAdventureCard(item)).join("");
      bindAdventureTracking(ideaResultsNode);
      app.track("idea_lab_roll_idea", {
        audience: answers.audience,
        stage: answers.stage,
        timeline: answers.timeline
      });
    });

    pricingButton.addEventListener("click", () => {
      const answers = {
        budget: Number(readValue(priceBudgetInput)),
        audience: readValue(priceAudienceInput),
        goal: readValue(priceGoalInput),
        risk: readValue(priceRiskInput)
      };

      const missing = [];
      if (!Number.isFinite(answers.budget) || answers.budget < 19) missing.push("Set a realistic starting budget (minimum $19).");
      if (!answers.audience) missing.push("Who is your primary buyer?");
      if (!answers.goal) missing.push("What is your main pricing goal?");
      if (!answers.risk) missing.push("How aggressive can your launch be?");

      if (missing.length > 0) {
        renderPromptCard(
          pricingResultsNode,
          "Answer these before rolling pricing adventure:",
          missing
        );
        app.track("idea_lab_missing_answers", { area: "pricing", missingCount: missing.length });
        return;
      }

      const pricingAdventure = buildPricingAdventure(answers, stripeLinks, supportEmail);
      pricingResultsNode.innerHTML = renderPricingAdventureCard(pricingAdventure);
      bindAdventureTracking(pricingResultsNode);
      app.track("idea_lab_roll_pricing", {
        budget: answers.budget,
        goal: answers.goal,
        risk: answers.risk
      });
    });
  }

  function normalizeProducts(products) {
    if (!Array.isArray(products)) {
      return [];
    }

    return products
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || "").trim(),
        title: String(item.title || "Featured Solution").trim(),
        category: String(item.category || "Solution").trim(),
        summary: String(item.summary || "").trim(),
        ctaLabel: String(item.ctaLabel || "Get Started").trim()
      }));
  }

  function pickProductForStage(products, stage, index) {
    const fallback = {
      id: "",
      title: "Featured Solution",
      category: "Solution",
      summary: "A practical solution designed for fast results.",
      ctaLabel: "Get Started"
    };
    if (!products.length) {
      return fallback;
    }

    const lowerStage = String(stage || "").toLowerCase();
    const stageFiltered = products.filter((item) => {
      const category = item.category.toLowerCase();
      if (lowerStage === "new") return category.includes("program");
      if (lowerStage === "active") return category.includes("bot");
      if (lowerStage === "stalled") return category.includes("program") || category.includes("bot");
      return true;
    });

    const list = stageFiltered.length ? stageFiltered : products;
    return list[(index - 1) % list.length] || fallback;
  }

  function buildIdeaAdventure(index, answers, product, supportEmail) {
    const timelineActions = {
      "48h": "Book a setup call today and launch your first use-case within 48 hours.",
      "7d": "Run a focused 7-day implementation sprint with one measurable win.",
      "30d": "Roll out in phases and stack wins through a 30-day growth plan."
    };

    const momentumMoves = [
      "Publish one clear offer message and send it to your warm audience today.",
      "Create a simple onboarding checklist so buyers see value in their first session.",
      "Track one KPI daily to prove momentum and make fast improvements."
    ];

    const productHref = product.id ? `/product.html?id=${encodeURIComponent(product.id)}` : "/#products";
    const supportHref = `/support.html?from=idea-lab&product=${encodeURIComponent(product.title)}`;
    const contactHref = `mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent(`Adventure ${index} Setup Request`)}&body=${encodeURIComponent(`Hi, I want help starting Adventure ${index} for ${product.title}. Audience: ${answers.audience}. Goal: ${answers.goal}.`)}`;

    return {
      title: `Adventure ${index}: ${product.title}`,
      audience: answers.audience,
      target: answers.goal,
      firstMove: `Start with ${product.title} for ${answers.audience} and focus on: ${answers.goal}.`,
      nextStep: timelineActions[answers.timeline] || timelineActions["7d"],
      momentum: momentumMoves[(index - 1) % momentumMoves.length],
      productHref,
      supportHref,
      contactHref,
      productId: product.id,
      productCta: `Open ${product.title}`
    };
  }

  function buildPricingAdventure(answers, stripeLinks, supportEmail) {
    const riskMultiplier = {
      safe: 0.9,
      balanced: 1,
      aggressive: 1.2
    };
    const goalSpread = {
      conversion: { starter: 1, growth: 1.7, scale: 2.8 },
      margin: { starter: 1.2, growth: 2.1, scale: 3.4 },
      retention: { starter: 1.1, growth: 1.9, scale: 3.1 }
    };

    const multiplier = riskMultiplier[answers.risk] || 1;
    const spread = goalSpread[answers.goal] || goalSpread.conversion;
    const base = Math.max(19, Number(answers.budget) * multiplier);
    const starter = roundToStep(base * spread.starter, 5);
    const growth = roundToStep(base * spread.growth, 10);
    const scale = roundToStep(base * spread.scale, 10);

    const primaryCheckoutHref = answers.goal === "conversion"
      ? normalizeLink(stripeLinks.starter)
      : normalizeLink(stripeLinks.pro || stripeLinks.starter);
    const compareCheckoutHref = answers.goal === "margin"
      ? normalizeLink(stripeLinks.pro || stripeLinks.starter)
      : normalizeLink(stripeLinks.reset || stripeLinks.pro || stripeLinks.starter);
    const supportHref = `/support.html?from=pricing-adventure&audience=${encodeURIComponent(answers.audience)}`;
    const referenceCode = `START-${Math.floor(1000 + Math.random() * 9000)}`;

    const launchTracks = {
      conversion: [
        "Day 1: Launch the Starter tier with a strong low-friction outcome promise.",
        "Day 3: Add a clear upgrade trigger tied to saved time or faster results.",
        "Day 7: Promote Growth tier to buyers who completed onboarding."
      ],
      margin: [
        "Day 1: Position value around ROI and implementation speed.",
        "Day 3: Add paid add-ons for premium support and priority setup.",
        "Day 7: Move best-fit leads into Growth or Scale with proof snapshots."
      ],
      retention: [
        "Day 1: Sell Starter with a 30-day success roadmap.",
        "Day 3: Introduce loyalty incentive to move users into Growth.",
        "Day 7: Offer Scale tier with ongoing optimization checkpoints."
      ]
    };

    const steps = launchTracks[answers.goal] || launchTracks.conversion;

    return {
      headline: `Pricing Adventure for ${answers.audience}`,
      starterPlan: `$${starter} entry path focused on fast initial wins.`,
      growthPlan: `$${growth} expansion path with deeper capability and support.`,
      scalePlan: `$${scale} premium path for sustained performance and priority execution.`,
      day1: steps[0],
      day3: steps[1],
      day7: steps[2],
      primaryCheckoutHref,
      compareCheckoutHref,
      supportHref,
      contactHref: `mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent(`Pricing Adventure ${referenceCode}`)}`,
      referenceCode
    };
  }

  function renderIdeaAdventureCard(item) {
    return `
      <article class="idea-result-item">
        <strong>${escapeHtml(item.title)}</strong>
        <p><strong>Customer:</strong> ${escapeHtml(item.audience)}</p>
        <p><strong>Target:</strong> ${escapeHtml(item.target)}</p>
        <p><strong>Step 1:</strong> ${escapeHtml(item.firstMove)}</p>
        <p><strong>Step 2:</strong> ${escapeHtml(item.nextStep)}</p>
        <p><strong>Step 3:</strong> ${escapeHtml(item.momentum)}</p>
        <div class="inline-actions">
          <a class="btn" href="${escapeHtml(item.productHref)}" data-adventure-action="idea_open_product" data-product-id="${escapeHtml(item.productId || "unknown")}">${escapeHtml(item.productCta)}</a>
          <a class="btn btn-ghost" href="${escapeHtml(item.supportHref)}" data-adventure-action="idea_open_support" data-product-id="${escapeHtml(item.productId || "unknown")}">Request Setup Help</a>
          <a class="btn btn-ghost" href="${escapeHtml(item.contactHref)}" data-adventure-action="idea_email_support" data-product-id="${escapeHtml(item.productId || "unknown")}">Email Support</a>
        </div>
      </article>
    `;
  }

  function renderPricingAdventureCard(item) {
    return `
      <article class="idea-result-item">
        <strong>${escapeHtml(item.headline)}</strong>
        <p><strong>Starter:</strong> ${escapeHtml(item.starterPlan)}</p>
        <p><strong>Growth:</strong> ${escapeHtml(item.growthPlan)}</p>
        <p><strong>Scale:</strong> ${escapeHtml(item.scalePlan)}</p>
        <p><strong>Launch sequence:</strong></p>
        <ul class="list">
          <li>${escapeHtml(item.day1)}</li>
          <li>${escapeHtml(item.day3)}</li>
          <li>${escapeHtml(item.day7)}</li>
        </ul>
        <div class="inline-actions">
          <a class="btn" href="${escapeHtml(item.primaryCheckoutHref)}" target="_blank" rel="noopener" data-adventure-action="pricing_checkout_primary">Start Checkout</a>
          <a class="btn btn-ghost" href="${escapeHtml(item.compareCheckoutHref)}" target="_blank" rel="noopener" data-adventure-action="pricing_checkout_compare">Compare Next Tier</a>
          <a class="btn btn-ghost" href="${escapeHtml(item.supportHref)}" data-adventure-action="pricing_open_support">Get Launch Help</a>
          <a class="btn btn-ghost" href="${escapeHtml(item.contactHref)}" data-adventure-action="pricing_email_support">Email Me</a>
        </div>
        <p class="muted">Reference code: ${escapeHtml(item.referenceCode)}</p>
      </article>
    `;
  }

  function bindAdventureTracking(container) {
    container.querySelectorAll("[data-adventure-action]").forEach((node) => {
      node.addEventListener("click", () => {
        app.track(node.dataset.adventureAction, {
          productId: node.dataset.productId || "unknown"
        });
      });
    });
  }

  function renderPromptCard(node, heading, questions) {
    node.innerHTML = `
      <article class="idea-result-item">
        <strong>${escapeHtml(heading)}</strong>
        <ul class="list">
          ${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}
        </ul>
      </article>
    `;
  }

  function readValue(inputNode) {
    return String((inputNode && inputNode.value) || "").trim();
  }

  function safeSupportEmail(value) {
    const candidate = String(value || "").trim();
    if (!candidate || !candidate.includes("@")) {
      return "support@slendystuff.com";
    }
    return candidate;
  }

  function normalizeLink(value) {
    const link = String(value || "").trim();
    return link || "#";
  }

  function roundToStep(value, step) {
    const numeric = Number(value);
    const size = Math.max(1, Number(step) || 1);
    const rounded = Math.round(numeric / size) * size;
    return Math.max(19, rounded);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
})();
