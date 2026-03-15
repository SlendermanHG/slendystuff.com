(() => {
  const body = document.body;
  if (!body || !body.classList.contains("chaos-mode")) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    return;
  }

  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const lowMemory = typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4;
  const lowCpu = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const lowPowerMode = isCoarsePointer || lowMemory || lowCpu;

  const revealNodes = Array.from(document.querySelectorAll(".chaos-reveal, .maze-block, .tilt-card"));
  if (revealNodes.length > 0) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-on");
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -4% 0px" }
    );
    revealNodes.forEach((node) => revealObserver.observe(node));
  }

  const orbitNodes = Array.from(document.querySelectorAll(".orbit"));
  const floatingNodes = Array.from(
    document.querySelectorAll(".hero-copy, .hero-aside, .tilt-card, .story-chip")
  ).slice(0, lowPowerMode ? 4 : 8);

  const enableParallax = !lowPowerMode && orbitNodes.length > 0;
  const enableFloat = floatingNodes.length > 0;
  const enableHeadingScramble = !lowPowerMode && !isCoarsePointer;

  let rafId = 0;
  let pointerRafId = 0;
  let lastFrame = 0;
  let visible = document.visibilityState !== "hidden";
  let targetPointerX = 0;
  let targetPointerY = 0;
  let pointerX = 0;
  let pointerY = 0;
  const frameIntervalMs = lowPowerMode ? 1000 / 20 : 1000 / 30;

  function animate(time) {
    if (!visible) {
      return;
    }

    if (time - lastFrame < frameIntervalMs) {
      rafId = window.requestAnimationFrame(animate);
      return;
    }
    lastFrame = time;

    const t = time / 1000;
    const motionScale = lowPowerMode ? 0.6 : 1;

    if (enableFloat) {
      floatingNodes.forEach((node, index) => {
        const speed = 0.35 + ((index % 4) * 0.07);
        const x = Math.sin(t * speed + index * 0.8) * 2.8 * motionScale;
        const y = Math.cos(t * (speed + 0.1) + index * 0.5) * 3.2 * motionScale;
        const r = Math.sin(t * (speed + 0.15) + index) * 0.35 * motionScale;
        node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${r}deg)`;
      });
    }

    if (enableParallax) {
      pointerX += (targetPointerX - pointerX) * 0.14;
      pointerY += (targetPointerY - pointerY) * 0.14;
      orbitNodes.forEach((node, index) => {
        const factor = 3 + index * 2.2;
        node.style.transform = `translate3d(${(pointerX * factor).toFixed(2)}px, ${(pointerY * factor).toFixed(2)}px, 0)`;
      });
    }

    rafId = window.requestAnimationFrame(animate);
  }

  function onPointerMove(event) {
    targetPointerX = (event.clientX / window.innerWidth - 0.5) * 2;
    targetPointerY = (event.clientY / window.innerHeight - 0.5) * 2;
    if (!pointerRafId) {
      pointerRafId = window.requestAnimationFrame(() => {
        pointerRafId = 0;
      });
    }
  }

  function onVisibilityChange() {
    visible = document.visibilityState !== "hidden";
    if (visible && !rafId) {
      lastFrame = 0;
      rafId = window.requestAnimationFrame(animate);
    }
  }

  if (enableParallax) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
  }

  if (enableFloat || enableParallax) {
    rafId = window.requestAnimationFrame(animate);
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  if (enableHeadingScramble) {
    const headingNodes = Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 6);
    headingNodes.forEach((node) => {
      const original = node.textContent || "";
      let scrambleTimer = null;

      node.addEventListener("mouseenter", () => {
        if (!original || scrambleTimer) {
          return;
        }

        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
        let frame = 0;
        scrambleTimer = window.setInterval(() => {
          frame += 1;
          const revealCount = Math.floor(frame / 2);
          node.textContent = original
            .split("")
            .map((ch, index) => {
              if (index < revealCount || ch === " ") {
                return ch;
              }
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join("");

          if (revealCount >= original.length) {
            window.clearInterval(scrambleTimer);
            scrambleTimer = null;
            node.textContent = original;
          }
        }, 40);
      });

      node.addEventListener("mouseleave", () => {
        if (scrambleTimer) {
          window.clearInterval(scrambleTimer);
          scrambleTimer = null;
        }
        node.textContent = original;
      });
    });
  }

  window.addEventListener("beforeunload", () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
    }
    if (pointerRafId) {
      window.cancelAnimationFrame(pointerRafId);
    }
    if (enableParallax) {
      window.removeEventListener("pointermove", onPointerMove);
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });
})();
