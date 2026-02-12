/**
 * Start Command
 *
 * Start the NextHello server
 */

import { spawn } from "child_process";
import fs from "fs";
import ora from "ora";
import inquirer from "inquirer";
import {
  printBanner,
  printSection,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  printCommand,
  colors,
  symbols,
} from "../ui.js";

interface StartOptions {
  docker?: boolean;
  detach?: boolean;
  withWhatsapp?: boolean;
}

export async function startCommand(options: StartOptions = {}): Promise<void> {
  printBanner();
  printSection("Starting NextHello");

  // Check if configuration exists
  if (!fs.existsSync(".env")) {
    printError("No configuration found.");
    printInfo("Run 'nexthello setup' first to configure.");
    process.exit(1);
  }

  // Determine start mode
  let useDocker = options.docker;

  if (useDocker === undefined) {
    // Check if Docker is available
    try {
      const { execSync } = await import("child_process");
      execSync("docker info", { stdio: "ignore" });

      const { mode } = await inquirer.prompt([
        {
          type: "list",
          name: "mode",
          message: "How do you want to run NextHello?",
          choices: [
            { name: "Docker (recommended)", value: "docker" },
            { name: "Local Node.js", value: "local" },
          ],
        },
      ]);
      useDocker = mode === "docker";
    } catch {
      useDocker = false;
      printInfo("Docker not available, using local Node.js");
    }
  }

  if (useDocker) {
    await startDocker(options);
  } else {
    await startLocal(options);
  }
}

async function startDocker(options: StartOptions): Promise<void> {
  const spinner = ora("Starting Docker containers...").start();

  try {
    const { execSync, spawn } = await import("child_process");

    // Build if needed
    try {
      execSync("docker compose build", { stdio: "ignore" });
    } catch {
      spinner.fail("Failed to build Docker image");
      printError("Run 'docker compose build' to see the error.");
      process.exit(1);
    }

    // Start containers
    if (options.detach) {
      execSync("docker compose up -d", { stdio: "ignore" });
      spinner.succeed("NextHello is running in the background");

      console.log("");
      printCommand("View logs", "nexthello logs");
      printCommand("Stop", "nexthello stop");
      printCommand("Connect WhatsApp", "docker exec -it nexthello node dist/src/channels/whatsapp/connect.js");
    } else {
      spinner.succeed("Starting NextHello...");
      console.log("");

      const proc = spawn("docker", ["compose", "up"], {
        stdio: "inherit",
      });

      proc.on("close", (code) => {
        process.exit(code ?? 0);
      });
    }
  } catch (error) {
    spinner.fail("Failed to start Docker");
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function startLocal(options: StartOptions): Promise<void> {
  const spinner = ora("Starting NextHello server...").start();

  try {
    // Check if built
    if (!fs.existsSync("dist/src/server.js")) {
      spinner.text = "Building TypeScript...";
      const { execSync } = await import("child_process");
      execSync("npm run build", { stdio: "ignore" });
    }

    spinner.succeed("Starting NextHello server...");
    console.log("");

    // Import and start server
    const serverPath = new URL("../../server.js", import.meta.url).pathname;

    if (options.withWhatsapp) {
      // Start both server and WhatsApp
      const { fork } = await import("child_process");

      // Start server
      const server = fork(serverPath, [], { stdio: "inherit" });

      // Start WhatsApp
      const whatsapp = fork(
        new URL("../../channels/whatsapp/connect.js", import.meta.url).pathname,
        [],
        { stdio: "inherit" },
      );

      const shutdown = () => {
        server.kill();
        whatsapp.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else {
      // Just start server
      const server = spawn("node", [serverPath], {
        stdio: "inherit",
        env: { ...process.env },
      });

      server.on("close", (code) => {
        process.exit(code ?? 0);
      });
    }
  } catch (error) {
    spinner.fail("Failed to start server");
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function stopCommand(): Promise<void> {
  printBanner();

  const spinner = ora("Stopping NextHello...").start();

  try {
    const { execSync } = await import("child_process");

    // Check if docker is available
    try {
      execSync("docker --version", { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      spinner.fail("Docker not available");
      printInfo("If you're inside the container, exit and run: docker compose down");
      return;
    }

    execSync("docker compose down", { stdio: ["pipe", "pipe", "pipe"] });
    spinner.succeed("NextHello stopped");
  } catch {
    spinner.fail("Failed to stop (is it running?)");
  }
}

export async function logsCommand(options: { follow?: boolean } = {}): Promise<void> {
  try {
    const { execSync } = await import("child_process");

    // Check if docker is available
    try {
      execSync("docker --version", { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      printError("Docker not available.");
      printInfo("If you're inside the container, logs are sent to stdout.");
      printInfo("Run from outside: docker compose logs -f nexthello");
      process.exit(1);
    }

    const { spawn } = await import("child_process");
    const args = ["compose", "logs"];
    if (options.follow) {
      args.push("-f");
    }
    args.push("nexthello");

    const proc = spawn("docker", args, { stdio: "inherit" });

    proc.on("error", () => {
      printError("Failed to run docker command");
      process.exit(1);
    });

    proc.on("close", (code) => {
      process.exit(code ?? 0);
    });
  } catch (error) {
    printError("Failed to get logs");
    process.exit(1);
  }
}
