/**
 * CLI UI Utilities
 */

import chalk from "chalk";

// Miami Vice color palette
const miami = {
  pink: chalk.hex("#FF6EC7"),      // Hot pink
  cyan: chalk.hex("#00FFFF"),      // Cyan/turquoise
  orange: chalk.hex("#FF6B35"),    // Sunset orange
  purple: chalk.hex("#9B5DE5"),    // Purple
  yellow: chalk.hex("#FFD93D"),    // Sun yellow
};

export const colors = {
  primary: miami.pink,
  success: miami.cyan,
  warning: miami.orange,
  error: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
};

export const symbols = {
  check: miami.cyan("✓"),
  cross: chalk.red("✗"),
  arrow: miami.pink("→"),
  dot: chalk.dim("·"),
  info: miami.purple("ℹ"),
  warning: miami.orange("⚠"),
};

export function printBanner(): void {
  console.log("");
  console.log(colors.primary(`
  _   _           _   _   _      _ _        `) + miami.cyan(`⣿⣿⣿⣿⣿⣿⣿⣿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿`));
  console.log(colors.primary(` | \\ | | _____  _| |_| | | | ___| | | ___   `) + miami.cyan(`⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠙⠿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿`));
  console.log(colors.primary(` |  \\| |/ _ \\ \\/ / __| |_| |/ _ \\ | |/ _ \\  `) + miami.cyan(`⣿⣿⣿⣿⣿⣿⡀⠀⣠⣴⣶⣿⣿⣿⣿⣶⣮⣝⠻⢿⣿⣿⣿⣿⣿`));
  console.log(colors.primary(` | |\\  |  __/>  <| |_|  _  |  __/ | | (_) | `) + miami.cyan(`⣿⣿⣿⣿⣿⡟⣡⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠙⢿`));
  console.log(colors.primary(` |_| \\_|\\___/_/\\_\\\\__|_| |_|\\___|_|_|\\___/  `) + miami.cyan(`⣿⠿⣿⣿⡿⢰⣿⡿⠋⠉⠉⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⣸`));
  console.log(`                                            ` + miami.cyan(`⠁⠀⠀⠙⠃⢿⣿⡅⠀⠀⢀⣼⣿⣿⣿⣿⠟⠛⠻⣿⣿⣷⢀⣴⣿`));
  console.log(miami.orange(`  NextHello`) + `                                 ` + miami.cyan(`⡀⠀⠀⠀⠀⠸⣿⣛⣳⣾⣿⢿⡍⢉⣻⡇⠰⠀⠀⣿⣿⣿⢸⣿⣿`));
  console.log(miami.cyan(`  AI Networking Swarm`) + `                       ` + miami.cyan(`⣷⡀⠀⠀⠀⠀⠈⠻⢿⣿⣿⣷⣶⣬⣽⣿⣦⣤⣤⣟⣿⢇⣾⣿⣿`));
  console.log(miami.yellow(`    🌴`) + miami.pink(` Made in Miami`) + `                         ` + miami.cyan(`⣿⣿⣄⠀⠀⠀⠀⠀⠀⠈⠙⠻⠿⣿⣿⣿⣿⣮⣿⠟⣡⣾⣿⣿⣿`));
  console.log(`                                            ` + miami.cyan(`⣿⣿⣿⡇⢰⣶⣤⣤⣤⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿`));
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
