#!/usr/bin/env node
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const path = (file) => join(process.env.CODEX_HOME, file);

const mode = () => readFileSync(path("mode"), "utf8");

const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");

const completed = (success) =>
  send({
    method: "account/login/completed",
    params: {
      loginId: "test-login",
      success,
      error: success
        ? null
        : "private upstream details must never reach the UI",
    },
  });

writeFileSync(path("pid"), String(process.pid));

let timer;

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line);
  if (method === "initialized") return;
  if (method === "account/login/start") {
    if (mode() === "early") completed(true);
    send({
      id,
      result: {
        type: "chatgptDeviceCode",
        loginId: "test-login",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "TEST-1234",
      },
    });
    timer = setInterval(() => {
      if (mode() === "waiting" || mode() === "early") return;
      clearInterval(timer);
      if (mode() === "exit") process.exit(1);
      completed(mode() === "success");
    }, 20);

    return;
  }
  if (method === "account/login/cancel") {
    clearInterval(timer);
    writeFileSync(path("cancelled"), "yes");
  }
  if (method === "account/read") {
    send({ id, result: { account: null } });

    return;
  }
  send({ id, result: {} });
});
