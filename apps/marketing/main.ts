const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const agentButtons =
  document.querySelectorAll<HTMLButtonElement>(".preview-agent");
const examplePanels = document.querySelectorAll<HTMLElement>(
  ".preview-conversation",
);
const exampleCaption = document.querySelector("#example-caption");

for (const button of agentButtons) {
  button.addEventListener("click", () => {
    for (const agentButton of agentButtons) {
      agentButton.setAttribute("aria-pressed", String(agentButton === button));
    }
    for (const panel of examplePanels) {
      panel.hidden = panel.id !== button.getAttribute("aria-controls");
    }
    if (exampleCaption) {
      exampleCaption.textContent = button.dataset.caption ?? "";
    }
  });
}

const computerControl =
  document.querySelector<HTMLButtonElement>(".computer-control");
const computerExample = document.querySelector(".computer-example");
const computerStatus = document.querySelector(".computer-status");

computerControl?.addEventListener("click", () => {
  const takingControl = computerControl.getAttribute("aria-pressed") !== "true";
  computerControl.setAttribute("aria-pressed", String(takingControl));
  computerControl.textContent = takingControl
    ? "Return control"
    : "Take control";
  computerExample?.classList.toggle("user-controlling", takingControl);
  if (computerStatus) {
    computerStatus.textContent = takingControl
      ? "You’re in control · Wisp is paused."
      : "View only · Wisp is using the computer.";
  }
});

if (!reducedMotion.matches && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.08 },
  );
  for (const section of document.querySelectorAll(".reveal")) {
    section.classList.add("will-reveal");
    observer.observe(section);
  }
}
