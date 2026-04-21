const pageName = document.body.dataset.page || "";
const defaultSiteConfig = {
  supportEmail: "support@slendystuff.com",
  discordUrl: "https://discord.gg/your-invite",
  twitchUrl: "https://twitch.tv/slendermanhg",
  youtubeUrl: "https://youtube.com/@slendermanhg",
  schedulerUrl: ""
};

let activeSiteConfig = { ...defaultSiteConfig };

function getSiteConfig() {
  return { ...activeSiteConfig };
}

function setSiteConfig(config) {
  activeSiteConfig = { ...defaultSiteConfig, ...config };
}

async function fetchStaticConfig() {
  const response = await fetch("/site-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load site config.");
  }
  const data = await response.json();
  return { ...defaultSiteConfig, ...data };
}

function initNav() {
  const nav = document.querySelector("[data-nav]");
  const toggle = document.querySelector("[data-nav-toggle]");
  if (!nav || !toggle) return;

  toggle.addEventListener("click", () => {
    nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", nav.classList.contains("is-open") ? "true" : "false");
  });

  nav.querySelectorAll("a").forEach((link) => {
    if (link.dataset.page === pageName) link.classList.add("active");
    link.addEventListener("click", () => nav.classList.remove("is-open"));
  });
}

function initReveal() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (!targets.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  targets.forEach((target) => observer.observe(target));
}

function initRotator() {
  const node = document.querySelector("[data-rotate]");
  if (!node) return;
  const phrases = [
    "Remote support for people who need help now.",
    "Website fixes, rebuilds, and maintenance that stay manageable.",
    "Custom bots and automations for communities with specific needs.",
    "Technical help that explains the issue instead of talking around it."
  ];
  let index = 0;
  setInterval(() => {
    index = (index + 1) % phrases.length;
    node.textContent = phrases[index];
  }, 3200);
}

function initSecretPortal() {
  document.querySelectorAll(".brand-lockup").forEach((brand) => {
    const mark = brand.querySelector(".brand-mark");
    if (!mark) return;
    brand.addEventListener("click", (event) => {
      const rect = mark.getBoundingClientRect();
      const withinMark = event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
      if (!withinMark) return;

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inSecretZone = x >= rect.width * 0.58 && y <= rect.height * 0.42;
      if (!inSecretZone) return;

      event.preventDefault();
      window.location.href = "/spiralism.html";
    });
  });
}

function initMailtoForms() {
  const forms = document.querySelectorAll("[data-mailto-form]");
  if (!forms.length) return;

  forms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const config = getSiteConfig();
      const data = new FormData(form);
      const targetKey = form.dataset.mailtoKey;
      const target = targetKey ? (config[targetKey] || defaultSiteConfig[targetKey]) : (form.dataset.mailto || defaultSiteConfig.supportEmail);
      const subject = data.get("subject") || "SlendyStuff Inquiry";
      const lines = [];
      data.forEach((value, key) => {
        if (key === "subject") return;
        lines.push(`${key}: ${value}`);
      });
      const href = `mailto:${encodeURIComponent(target)}?subject=${encodeURIComponent(String(subject))}&body=${encodeURIComponent(lines.join("\n"))}`;
      window.location.href = href;
    });
  });
}

function applySiteConfig(config = getSiteConfig()) {

  document.querySelectorAll("[data-config-link]").forEach((node) => {
    const key = node.dataset.configLink;
    const value = config[key];
    if (value) node.setAttribute("href", value);
  });

  document.querySelectorAll("[data-config-email]").forEach((node) => {
    const key = node.dataset.configEmail;
    const value = config[key];
    if (!value) return;
    if (node.tagName === "A") node.setAttribute("href", `mailto:${value}`);
    node.textContent = value;
  });

  document.querySelectorAll("[data-config-text]").forEach((node) => {
    const key = node.dataset.configText;
    const value = config[key];
    if (value) node.textContent = value;
  });

  document.querySelectorAll("[data-config-optional-link]").forEach((node) => {
    const key = node.dataset.configOptionalLink;
    const value = config[key];
    if (!value) {
      node.classList.add("is-disabled");
      node.setAttribute("aria-disabled", "true");
      node.removeAttribute("href");
      return;
    }
    node.classList.remove("is-disabled");
    node.removeAttribute("aria-disabled");
    node.setAttribute("href", value);
  });
}

function initYear() {
  document.querySelectorAll("[data-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}

fetchStaticConfig()
  .then((config) => {
    setSiteConfig(config);
    applySiteConfig(config);
  })
  .catch(() => {
    setSiteConfig(defaultSiteConfig);
    applySiteConfig();
  });

initNav();
initReveal();
initRotator();
initSecretPortal();
initMailtoForms();
initYear();
