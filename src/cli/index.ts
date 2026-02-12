#!/usr/bin/env node
/**
 * NextHello CLI
 *
 * Command-line interface for setting up and managing NextHello.
 *
 * Usage:
 *   nexthello setup     - Interactive configuration wizard
 *   nexthello connect   - Connect messaging channels (WhatsApp)
 *   nexthello start     - Start the server
 *   nexthello stop      - Stop the server
 *   nexthello status    - Check system status
 *   nexthello logs      - View logs
 */

import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { connectCommand } from "./commands/connect.js";
import { startCommand, stopCommand, logsCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { printBanner, colors } from "./ui.js";

const program = new Command();

program
  .name("nexthello")
  .description("AI-powered networking assistant")
  .version("1.0.0");

// Setup command
program
  .command("setup")
  .description("Interactive configuration wizard")
  .action(async () => {
    await setupCommand();
  });

// Connect command
program
  .command("connect [channel]")
  .description("Connect a messaging channel (whatsapp)")
  .action(async (channel?: string) => {
    await connectCommand(channel);
  });

// Start command
program
  .command("start")
  .description("Start the NextHello server")
  .option("-d, --detach", "Run in background")
  .option("--docker", "Use Docker")
  .option("--local", "Use local Node.js")
  .option("--with-whatsapp", "Also start WhatsApp connection")
  .action(async (options) => {
    await startCommand({
      docker: options.docker ? true : options.local ? false : undefined,
      detach: options.detach,
      withWhatsapp: options.withWhatsapp,
    });
  });

// Stop command
program
  .command("stop")
  .description("Stop the NextHello server")
  .action(async () => {
    await stopCommand();
  });

// Status command
program
  .command("status")
  .description("Check system status")
  .action(async () => {
    await statusCommand();
  });

// Logs command
program
  .command("logs")
  .description("View server logs")
  .option("-f, --follow", "Follow log output")
  .action(async (options) => {
    await logsCommand({ follow: options.follow });
  });

// Default action (show help with banner)
program.action(() => {
  printBanner();
  console.log(colors.bold("Commands:"));
  console.log("");
  console.log("  nexthello setup     Interactive configuration wizard");
  console.log("  nexthello connect   Connect messaging channels (WhatsApp)");
  console.log("  nexthello start     Start the server");
  console.log("  nexthello stop      Stop the server");
  console.log("  nexthello status    Check system status");
  console.log("  nexthello logs      View logs");
  console.log("");
  console.log(colors.dim("Run 'nexthello <command> --help' for more info"));
  console.log("");
});

program.parse();
