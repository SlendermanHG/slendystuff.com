const pageName = document.body.dataset.page || "";
const siteConfigKey = "slendystuff.site.config";
const adminPasswordKey = "slendystuff.admin.password";
const defaultSiteConfig = {
  supportEmail: "support@slendystuff.com",
  discordUrl: "https://discord.gg/your-invite",
  twitchUrl: "https://twitch.tv/slendermanhg",
  youtubeUrl: "https://youtube.com/@slendermanhg",
  schedulerUrl: ""
};

function getSiteConfig() {
  try {
    const raw = window.localStorage.getItem(siteConfigKey);
    if (!raw) return { ...defaultSiteConfig };
    const parsed = JSON.parse(raw);
    return { ...defaultSiteConfig, ...parsed };
  } catch (_error) {
    return { ...defaultSiteConfig };
  }
}

function setSiteConfig(config) {
  window.localStorage.setItem(siteConfigKey, JSON.stringify(config));
}

function getAdminPassword() {
  return window.sessionStorage.getItem(adminPasswordKey) || "";
}

function setAdminPassword(value) {
  if (!value) {
    window.sessionStorage.removeItem(adminPasswordKey);
    return;
  }
  window.sessionStorage.setItem(adminPasswordKey, value);
}

async function fetchServerConfig(password) {
  const headers = {};
  if (password) headers["x-admin-password"] = password;
  const response = await fetch(password ? "/api/admin/config" : "/api/site-config", { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to load config.");
  }
  const data = await response.json();
  return data.config;
}

async function saveServerConfig(config, password) {
  const response = await fetch("/api/admin/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": password
    },
    body: JSON.stringify(config)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to save config.");
  }
  return data.config;
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

function initAdminForm() {
  const form = document.querySelector("[data-admin-form]");
  if (!form) return;

  const status = document.querySelector("[data-admin-status]");
  const passwordField = form.elements.namedItem("adminPassword");
  const config = getSiteConfig();
  const currentPassword = getAdminPassword();

  Object.entries(config).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  });
  if (passwordField) passwordField.value = currentPassword;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = String(formData.get("adminPassword") || "").trim();
    const nextConfig = { ...defaultSiteConfig };
    formData.forEach((value, key) => {
      if (key === "adminPassword") return;
      nextConfig[key] = String(value).trim();
    });
    try {
      if (!password) throw new Error("Admin password is required.");
      const savedConfig = await saveServerConfig(nextConfig, password);
      setSiteConfig(savedConfig);
      setAdminPassword(password);
      applySiteConfig(savedConfig);
      if (status) {
        status.textContent = "Saved to the server config.";
        status.classList.add("is-visible");
      }
    } catch (error) {
      if (status) {
        status.textContent = error.message.includes("Failed to fetch")
          ? "Server unavailable. Saved in this browser only as a fallback preview."
          : error.message;
        status.classList.add("is-visible");
      }
      setSiteConfig(nextConfig);
      applySiteConfig(nextConfig);
    }
  });

  const syncButton = document.querySelector("[data-admin-sync]");
  if (syncButton) {
    syncButton.addEventListener("click", async () => {
      const password = passwordField ? String(passwordField.value || "").trim() : getAdminPassword();
      try {
        const remoteConfig = await fetchServerConfig(password);
        Object.entries(remoteConfig).forEach(([key, value]) => {
          const field = form.elements.namedItem(key);
          if (field) field.value = value;
        });
        setSiteConfig(remoteConfig);
        if (password) setAdminPassword(password);
        applySiteConfig(remoteConfig);
        if (status) {
          status.textContent = "Loaded current server config.";
          status.classList.add("is-visible");
        }
      } catch (error) {
        if (status) {
          status.textContent = error.message;
          status.classList.add("is-visible");
        }
      }
    });
  }

  const resetButton = document.querySelector("[data-admin-reset]");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      window.localStorage.removeItem(siteConfigKey);
      window.sessionStorage.removeItem(adminPasswordKey);
      window.location.reload();
    });
  }
}

fetchServerConfig()
  .then((config) => {
    setSiteConfig(config);
    applySiteConfig(config);
  })
  .catch(() => {
    applySiteConfig();
  });

initNav();
initReveal();
initRotator();
initSecretPortal();
initMailtoForms();
initYear();
initAdminForm();
