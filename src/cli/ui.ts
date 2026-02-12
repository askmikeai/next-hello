/**
 * CLI UI Utilities
 */

import chalk from "chalk";

export const colors = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
};

export const symbols = {
  check: chalk.green("✓"),
  cross: chalk.red("✗"),
  arrow: chalk.cyan("→"),
  dot: chalk.dim("·"),
  info: chalk.blue("ℹ"),
  warning: chalk.yellow("⚠"),
};

export function printBanner(): void {
  console.log("");
  console.log(colors.primary(`
  _   _           _   _   _      _ _
 | \\ | | _____  _| |_| | | | ___| | | ___
 |  \\| |/ _ \\ \\/ / __| |_| |/ _ \\ | |/ _ \\
 | |\\  |  __/>  <| |_|  _  |  __/ | | (_) |
 |_| \\_|\\___/_/\\_\\\\__|_| |_|\\___|_|_|\\___/
`));
  console.log(colors.warning("  AI-Powered Networking Assistant"));
  console.log("");
}

export function printSection(title: string): void {
  console.log("");
  console.log(colors.bold(colors.primary(`━━━ ${title} ━━━`)));
  console.log("");
}

export function printSuccess(message: string): void {
  console.log(`${symbols.check} ${message}`);
}

export function printError(message: string): void {
  console.log(`${symbols.cross} ${colors.error(message)}`);
}

export function printWarning(message: string): void {
  console.log(`${symbols.warning} ${colors.warning(message)}`);
}

export function printInfo(message: string): void {
  console.log(`${symbols.info} ${message}`);
}

export function printStep(step: number, total: number, message: string): void {
  console.log(`${colors.dim(`[${step}/${total}]`)} ${message}`);
}

export function printCommand(description: string, command: string): void {
  console.log(`  ${symbols.arrow} ${description}: ${colors.primary(command)}`);
}

export function printBox(lines: string[]): void {
  const maxLength = Math.max(...lines.map((l) => l.length));
  const border = colors.dim("─".repeat(maxLength + 4));

  console.log(colors.dim("┌") + border + colors.dim("┐"));
  for (const line of lines) {
    const padding = " ".repeat(maxLength - line.length);
    console.log(colors.dim("│") + `  ${line}${padding}  ` + colors.dim("│"));
  }
  console.log(colors.dim("└") + border + colors.dim("┘"));
}
