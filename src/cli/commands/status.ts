/**
 * Status Command
 *
 * Show status of NextHello services
 */

import fs from "fs";
import path from "path";
import {
  printBanner,
  printSection,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  colors,
  symbols,
} from "../ui.js";

interface StatusCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
}

export async function statusCommand(): Promise<void> {
  printBanner();
  printSection("System Status");

  const checks: StatusCheck[] = [];

  // Check .env file
  if (fs.existsSync(".env")) {
    const envContent = fs.readFileSync(".env", "utf-8");
    const hasSupabase = envContent.includes("SUPABASE_URL=") && !envContent.includes("SUPABASE_URL=\n");
    const hasAI = envContent.includes("OPENAI_API_KEY=") || envContent.includes("ANTHROPIC_API_KEY=");

    checks.push({
      name: "Configuration",
      status: hasSupabase ? "ok" : "error",
      message: hasSupabase ? ".env file configured" : "Missing Supabase configuration",
    });

    checks.push({
      name: "AI Provider",
      status: hasAI ? "ok" : "warning",
      message: hasAI ? "AI provider configured" : "No AI provider configured",
    });
  } else {
    checks.push({
      name: "Configuration",
      status: "error",
      message: "No .env file found. Run 'nexthello setup' to configure.",
    });
  }

  // Check config file
  if (fs.existsSync("nexthello.config.json")) {
    checks.push({
      name: "App Config",
      status: "ok",
      message: "nexthello.config.json found",
    });
  } else {
    checks.push({
      name: "App Config",
      status: "warning",
      message: "No nexthello.config.json found (using defaults)",
    });
  }

  // Check WhatsApp auth
  const authDir = process.env.WHATSAPP_AUTH_DIR ?? "./data/auth/whatsapp";
  if (fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0) {
    checks.push({
      name: "WhatsApp",
      status: "ok",
      message: "Session data found",
    });
  } else {
    checks.push({
      name: "WhatsApp",
      status: "warning",
      message: "Not connected. Run 'nexthello connect' to link.",
    });
  }

  // Check if server is running (works both inside and outside container)
  try {
    const http = await import("http");
    const serverRunning = await new Promise<boolean>((resolve) => {
      const req = http.get("http://localhost:3000/health", (res) => {
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });

    if (serverRunning) {
      checks.push({
        name: "Server",
        status: "ok",
        message: "Running on port 3000",
      });
    } else {
      checks.push({
        name: "Server",
        status: "warning",
        message: "Not running. Run 'nexthello start' to start.",
      });
    }
  } catch {
    checks.push({
      name: "Server",
      status: "warning",
      message: "Could not check server status",
    });
  }

  // Print results
  for (const check of checks) {
    const icon =
      check.status === "ok"
        ? symbols.check
        : check.status === "warning"
          ? symbols.warning
          : symbols.cross;
    const color =
      check.status === "ok"
        ? colors.success
        : check.status === "warning"
          ? colors.warning
          : colors.error;

    console.log(`${icon} ${colors.bold(check.name)}: ${color(check.message)}`);
  }

  console.log("");

  // Summary
  const errors = checks.filter((c) => c.status === "error");
  const warnings = checks.filter((c) => c.status === "warning");

  if (errors.length > 0) {
    printError(`${errors.length} error(s) found. Please fix before running.`);
  } else if (warnings.length > 0) {
    printWarning(`${warnings.length} warning(s). NextHello may work with limited features.`);
  } else {
    printSuccess("All systems operational!");
  }

  console.log("");
}
