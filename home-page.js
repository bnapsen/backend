const gameCards = document.querySelectorAll(".game-card");

for (const card of gameCards) {
  const primaryLink = card.querySelector(".btn-card");
  if (!primaryLink) {
    continue;
  }

  const href = primaryLink.getAttribute("href");
  const title = card.querySelector("h3")?.textContent?.trim() || "game";
  if (!href) {
    continue;
  }

  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", `Open ${title}`);

  const goToGame = () => {
    window.location.href = href;
  };

  card.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, select, textarea, summary")) {
      return;
    }
    if (window.getSelection && window.getSelection().toString()) {
      return;
    }
    goToGame();
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      goToGame();
    }
  });
}
