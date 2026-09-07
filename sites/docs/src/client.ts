export {};

document.documentElement.classList.add("js");

const menuToggle =
  document.querySelector<HTMLButtonElement>("[data-menu-toggle]");
menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("menu-open", open);
});

for (const block of document.querySelectorAll<HTMLPreElement>(".prose pre")) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-code";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy code to clipboard");
  button.addEventListener("click", async () => {
    const code = block.querySelector("code");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent || "");
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select code";
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    window.setTimeout(() => {
      button.textContent = "Copy";
    }, 1800);
  });
  block.append(button);
}

interface SearchPage {
  title: string;
  url: string;
  description: string;
  text: string;
}

const dialog = document.querySelector<HTMLDialogElement>(".search-dialog");
const input = document.querySelector<HTMLInputElement>("#docs-search");
const results = document.querySelector<HTMLElement>(".search-results");
const status = document.querySelector<HTMLElement>(".search-status");
let index: SearchPage[] | undefined;

function search() {
  if (!results || !status || !input || !index) return;
  const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = index
    .filter((page) =>
      terms.every((term) => page.text.toLowerCase().includes(term)),
    )
    .sort((left, right) => {
      const score = (page: SearchPage) =>
        terms.filter((term) => page.title.toLowerCase().includes(term)).length;
      return score(right) - score(left);
    })
    .slice(0, 8);
  results.replaceChildren();
  status.textContent = terms.length
    ? matches.length
      ? `${matches.length} ${matches.length === 1 ? "guide" : "guides"} found`
      : "No matching guides. Try another word."
    : "Browse the guides, or type to search.";
  for (const page of matches) {
    const link = document.createElement("a");
    link.href = page.url;
    const title = document.createElement("strong");
    title.textContent = page.title;
    const summary = document.createElement("span");
    summary.textContent = page.description;
    link.append(title, summary);
    results.append(link);
  }
}

async function openSearch() {
  if (!dialog || !input || !status) return;
  dialog.showModal();
  input.focus();
  if (index) {
    search();
    return;
  }
  status.textContent = "Loading guides…";
  try {
    const response = await fetch("/search-index.json");
    if (!response.ok) throw new Error("Search index is unavailable.");
    index = (await response.json()) as SearchPage[];
    search();
  } catch {
    status.textContent =
      "Search could not load. Use the page navigation to browse the docs.";
  }
}

document
  .querySelector("[data-search-open]")
  ?.addEventListener("click", openSearch);
document
  .querySelector("[data-search-close]")
  ?.addEventListener("click", () => dialog?.close());
input?.addEventListener("input", search);
dialog?.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement) &&
    !(target instanceof HTMLElement && target.isContentEditable)
  ) {
    event.preventDefault();
    void openSearch();
  }
  if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
    menuToggle?.click();
    menuToggle?.focus();
  }
});
