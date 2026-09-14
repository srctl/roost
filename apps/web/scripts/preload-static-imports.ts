import type { Plugin, Rollup } from "vite";

export function expandStaticImports(bundle: Rollup.OutputBundle) {
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== "chunk") continue;
    const seen = new Set([chunk.fileName]);
    const imports: string[] = [];
    const pending = [...chunk.imports];
    for (const name of pending) {
      if (seen.has(name)) continue;
      seen.add(name);
      imports.push(name);
      const dependency = bundle[name];
      if (dependency?.type === "chunk") pending.push(...dependency.imports);
    }
    chunk.imports = imports;
  }
}

export function preloadStaticImports(): Plugin {
  return {
    name: "roost-preload-static-imports",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle: {
      // Start's manifest currently lists only direct imports. Include static
      // descendants before it captures the bundle, keeping lazy imports lazy.
      order: "pre",
      handler(_options, bundle) {
        expandStaticImports(bundle);
      },
    },
  };
}
