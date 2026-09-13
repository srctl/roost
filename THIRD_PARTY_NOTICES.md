# Third-party notices

`src/components/ui/button.tsx` is adapted from shadcn/ui's Base UI button.
Its Tailwind styles have been replaced with StyleX, and unused variants removed.
`src/components/ui/scroll-area.tsx` and `collapsible.tsx` follow shadcn/ui’s
Base UI component composition, with locally owned StyleX styling.

Source: https://ui.shadcn.com/r/styles/base-nova/button.json

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## noVNC

The live desktop viewer bundles unmodified noVNC 1.5.0, licensed under MPL-2.0.
Its source is available at https://github.com/novnc/noVNC/tree/v1.5.0 and in the
`@novnc/novnc` npm package. Release archives include its license in `licenses/`.

## Fluent UI Charts

Dashboard dataset charts bundle Microsoft Fluent UI v9 (`@fluentui/react-charts`
9.3.25 and its provider/theme dependencies), licensed under MIT. Source and
license: https://github.com/microsoft/fluentui. Charts are adapted through Roost's
bounded data schema; the upstream chart implementations are unmodified.

## Tiptap

The shared note editor bundles unmodified Tiptap 3.31.3 React, StarterKit,
Placeholder, TaskList, TaskItem, and UniqueID extensions, licensed under MIT.
Source and license: https://github.com/ueberdosis/tiptap. ProseMirror dependencies
are also MIT licensed: https://github.com/ProseMirror. The application-owned
adapter persists validated blocks rather than HTML.
