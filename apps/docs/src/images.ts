import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

// All published guides live directly under docs/. Keep images under that root.
export function documentImagePath(href: string | undefined) {
  if (!href || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href)) return undefined;
  const url = new URL(href, "https://docs.invalid/docs/");
  const path = decodeURIComponent(url.pathname);
  if (
    !path.startsWith("/docs/") ||
    !/\.(?:png|jpe?g|webp|gif|svg)$/i.test(path)
  )
    return undefined;
  return `/media/${path.slice("/docs/".length)}`;
}

export function documentImages(
  documents: { markdown: string }[],
  directory: string,
) {
  const images = new Map<string, Buffer>();
  function collect(href: string | undefined) {
    const path = documentImagePath(href);
    if (path && !images.has(path)) {
      const file = resolve(directory, path.slice("/media/".length));
      if (!file.startsWith(`${resolve(directory)}/`))
        throw new Error("Documentation image must stay inside docs/.");
      images.set(path, readFileSync(file));
    }
  }
  for (const document of documents) {
    renderToStaticMarkup(
      createElement(
        Markdown,
        {
          components: {
            img: ({ src }) => {
              collect(typeof src === "string" ? src : undefined);
              return null;
            },
            a: ({ href, children }) => {
              collect(href);
              return createElement("span", null, children);
            },
          },
        },
        document.markdown,
      ),
    );
  }
  return images;
}
