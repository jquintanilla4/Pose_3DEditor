import { spawn } from "node:child_process";

const processes = [];
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function startScript(label, scriptName) {
  const child = spawn(npmCmd, ["run", scriptName], {
    stdio: "inherit",
    env: process.env,
  });
  processes.push({ label, child });
  child.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") return;
    shutdown(code ?? 0);
  });
}

function shutdown(code = 0) {
  for (const { child } of processes) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

startScript("pyserver", "pyserver");
startScript("dev:frontend", "dev:frontend");
