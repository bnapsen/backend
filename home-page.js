const gameCards = document.querySelectorAll(".game-card");

for (const card of gameCards) {
  const primaryLink = card.querySelector(".btn-card");
  if (!primaryLink) {
    continue;
  }

  const href = primaryLink.getAttribute("href");
  if (!href) {
    continue;
  }

  card.style.setProperty("--glow-x", "50%");
  card.style.setProperty("--glow-y", "50%");

  const goToGame = () => {
    window.location.href = href;
  };

  card.addEventListener("pointermove", (event) => {
    const bounds = card.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    card.style.setProperty("--glow-x", `${x}%`);
    card.style.setProperty("--glow-y", `${y}%`);
    card.classList.add("is-hovering");
  });

  card.addEventListener("pointerleave", () => {
    card.classList.remove("is-hovering");
    card.style.setProperty("--glow-x", "50%");
    card.style.setProperty("--glow-y", "50%");
  });

  card.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, select, textarea, summary")) {
      return;
    }
    if (window.getSelection && window.getSelection().toString()) {
      return;
    }
    goToGame();
  });
}
