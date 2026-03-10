(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    return;
  }

  const floatingNodes = Array.from(
    document.querySelectorAll(".tilt-card, .maze-block, .story-chip, .hero-copy, .hero-aside")
  );
  const orbitNodes = Array.from(document.querySelectorAll(".orbit"));
  const revealNodes = Array.from(document.querySelectorAll(".chaos-reveal, .maze-block, .tilt-card"));

  let pointerX = 0;
  let pointerY = 0;
  let rafId = 0;

  if (floatingNodes.length > 0) {
    const animate = (time) => {
      const t = time / 1000;
      floatingNodes.forEach((node, index) => {
        const speed = 0.45 + ((index % 5) * 0.08);
        const x = Math.sin(t * speed + index * 0.7) * 4;
        const y = Math.cos(t * (speed + 0.12) + index * 0.5) * 5;
        const r = Math.sin(t * (speed + 0.18) + index) * 0.8;
        node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${r}deg)`;
      });
      rafId = window.requestAnimationFrame(animate);
    };
    rafId = window.requestAnimationFrame(animate);
  }

  if (orbitNodes.length > 0) {
    window.addEventListener("pointermove", (event) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 2;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 2;

      orbitNodes.forEach((node, index) => {
        const factor = (index + 1) * 7;
        const x = pointerX * factor;
        const y = pointerY * factor;
        node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      });
    });
  }

  if (revealNodes.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-on");
          }
        });
      },
      {
        threshold: 0.18
      }
    );

    revealNodes.forEach((node) => observer.observe(node));
  }

  const headingNodes = Array.from(document.querySelectorAll("h1, h2, h3"));
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
      }, 28);
    });

    node.addEventListener("mouseleave", () => {
      if (scrambleTimer) {
        window.clearInterval(scrambleTimer);
        scrambleTimer = null;
      }
      node.textContent = original;
    });
  });

  window.addEventListener("beforeunload", () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
    }
  });
})();
