import { randomBytes } from "node:crypto";
import client from "./client.js?raw";

// This small, independent page never executes private app loaders before login.
export function authPage() {
  const nonce = randomBytes(24).toString("base64");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Roost</title><style nonce="${nonce}">
  :root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#fafbf8;color:#252b24}*{box-sizing:border-box}body{margin:0;padding:64px 24px}main{max-width:480px;margin:8vh auto}h1{font-size:30px;font-weight:500;letter-spacing:-.8px;margin:24px 0 12px}h2{font-size:16px;font-weight:600;margin-top:32px}p,small{color:#64705f;line-height:1.6}small{display:block;margin-top:32px}button,input{font:inherit;border:1px solid #cdd3c9;border-radius:8px;padding:10px 14px}button{background:#e5eddf;color:inherit;cursor:pointer;margin:8px 0}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #59734b;outline-offset:3px}label{display:block;font-size:13px;margin-top:20px}input{display:block;width:100%;margin:8px 0;background:transparent;color:inherit}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #dfe4db;padding:6px 0;font-size:13px}.row button{font-size:12px;background:transparent;padding:6px 10px}a{color:inherit;font-size:14px}#status{min-height:24px;color:#a03b32}#brand{font-size:18px;letter-spacing:-.5px}@media(prefers-color-scheme:dark){:root{background:#20221e;color:#eff1eb}p,small{color:#a6afa0}button{background:#3d4935}button,input,.row{border-color:#47513f}#status{color:#f1a99e}}@media(max-width:600px){body{padding:24px}main{margin:8vh auto}}
  </style></head><body><main><div id="brand">roost</div><div id="content"></div><p id="status" role="status" aria-live="polite"></p></main><script nonce="${nonce}">${client}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      },
    },
  );
}
