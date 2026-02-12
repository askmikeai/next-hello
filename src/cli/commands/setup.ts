/**
 * Setup Command
 *
 * Interactive wizard to configure NextHello
 * Only asks for values not already present in environment
 */

import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  printBanner,
  printSection,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  printStep,
  printCommand,
  colors,
} from "../ui.js";

interface SetupAnswers {
  // Required
  supabaseUrl: string;
  supabaseKey: string;

  // AI Provider
  aiProvider: "openai" | "anthropic" | "both";
  openaiKey?: string;
  anthropicKey?: string;

  // App Config
  ownerName: string;
  eventName: string;
  calendlyLink?: string;

  // Integrations
  enableHeygen: boolean;
  heygenKey?: string;
  enableHubspot: boolean;
  hubspotKey?: string;
  enableSendgrid: boolean;
  sendgridKey?: string;
  enableProxycurl: boolean;
  proxycurlKey?: string;
}

/**
 * Get value from environment, return empty string if not set
 */
function getEnv(key: string): string {
  return process.env[key] ?? "";
}

/**
 * Check if environment variable is set and non-empty
 */
function hasEnv(key: string): boolean {
  const val = process.env[key];
  return val !== undefined && val !== "";
}

export async function setupCommand(): Promise<void> {
  printBanner();

  console.log(colors.bold("Welcome to NextHello Setup!"));
  console.log("This wizard will help you configure your networking assistant.");
  console.log("Values already set in .env will be preserved (shown as defaults).");
  console.log("");

  // Track which values we already have
  const existingValues = {
    supabaseUrl: getEnv("SUPABASE_URL"),
    supabaseKey: getEnv("SUPABASE_KEY"),
    supabaseTable: getEnv("SUPABASE_TABLE") || "tech_founders_contacts",
    openaiKey: getEnv("OPENAI_API_KEY"),
    anthropicKey: getEnv("ANTHROPIC_API_KEY"),
    ownerName: getEnv("NEXTHELLO_OWNER_NAME"),
    eventName: getEnv("NEXTHELLO_EVENT_NAME"),
    calendlyLink: getEnv("NEXTHELLO_CALENDLY_LINK"),
    heygenKey: getEnv("HEYGEN_API_KEY"),
    hubspotKey: getEnv("HUBSPOT_API_KEY"),
    sendgridKey: getEnv("SENDGRID_API_KEY"),
    proxycurlKey: getEnv("PROXYCURL_API_KEY"),
    calendlyKey: getEnv("CALENDLY_API_KEY"),
    webhookSecret: getEnv("WEBHOOK_SECRET"),
    port: getEnv("PORT") || "3000",
  };

  // Count how many required values are missing
  const missingRequired = [
    !existingValues.supabaseUrl,
    !existingValues.supabaseKey,
    !existingValues.openaiKey && !existingValues.anthropicKey,
  ].filter(Boolean).length;

  if (missingRequired === 0) {
    printSuccess("All required values are already configured in environment!");
    const { continueSetup } = await inquirer.prompt([
      {
        type: "confirm",
        name: "continueSetup",
        message: "Do you want to review/update the configuration?",
        default: false,
      },
    ]);

    if (!continueSetup) {
      printInfo("Keeping existing configuration.");
      return;
    }
  }

  // Check if .env already exists
  if (fs.existsSync(".env")) {
    printInfo("Found existing .env file. New values will be merged.");
    console.log("");
  }

  // Database section - only ask for missing values
  printSection("Step 1: Database");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbQuestions: any[] = [];

  if (!existingValues.supabaseUrl) {
    dbQuestions.push({
      type: "input",
      name: "supabaseUrl",
      message: "Supabase URL:",
      validate: (input: string) =>
        input.includes("supabase") || "Please enter a valid Supabase URL",
    });
  } else {
    printInfo(`Supabase URL: ${existingValues.supabaseUrl.substring(0, 30)}... (from env)`);
  }

  if (!existingValues.supabaseKey) {
    dbQuestions.push({
      type: "password",
      name: "supabaseKey",
      message: "Supabase API Key:",
      mask: "*",
      validate: (input: string) => input.length > 10 || "Please enter a valid API key",
    });
  } else {
    printInfo("Supabase API Key: ******* (from env)");
  }

  dbQuestions.push({
    type: "input",
    name: "supabaseTable",
    message: "Contacts table name:",
    default: existingValues.supabaseTable,
  });

  const dbAnswers = dbQuestions.length > 0
    ? await inquirer.prompt(dbQuestions)
    : {} as Record<string, string>;

  // AI Provider section
  printSection("Step 2: AI Provider");

  let openaiKey = existingValues.openaiKey;
  let anthropicKey = existingValues.anthropicKey;

  // Determine current AI provider based on existing keys
  let currentProvider: "openai" | "anthropic" | "both" | null = null;
  if (openaiKey && anthropicKey) {
    currentProvider = "both";
  } else if (openaiKey) {
    currentProvider = "openai";
  } else if (anthropicKey) {
    currentProvider = "anthropic";
  }

  if (currentProvider) {
    printInfo(`Current AI provider: ${currentProvider} (from env)`);
    const { changeProvider } = await inquirer.prompt([
      {
        type: "confirm",
        name: "changeProvider",
        message: "Do you want to change the AI provider configuration?",
        default: false,
      },
    ]);

    if (!changeProvider) {
      // Keep existing keys
    } else {
      currentProvider = null; // Force re-prompt
    }
  }

  if (!currentProvider) {
    const aiAnswers = await inquirer.prompt([
      {
        type: "list",
        name: "aiProvider",
        message: "Which AI provider will you use?",
        choices: [
          { name: "OpenAI (GPT-4)", value: "openai" },
          { name: "Anthropic (Claude)", value: "anthropic" },
          { name: "Both", value: "both" },
        ],
      },
    ]);

    if (aiAnswers.aiProvider === "openai" || aiAnswers.aiProvider === "both") {
      if (!openaiKey) {
        const { key } = await inquirer.prompt([
          {
            type: "password",
            name: "key",
            message: "OpenAI API Key:",
            mask: "*",
          },
        ]);
        openaiKey = key;
      }
    } else {
      openaiKey = ""; // Clear if not selected
    }

    if (aiAnswers.aiProvider === "anthropic" || aiAnswers.aiProvider === "both") {
      if (!anthropicKey) {
        const { key } = await inquirer.prompt([
          {
            type: "password",
            name: "key",
            message: "Anthropic API Key:",
            mask: "*",
          },
        ]);
        anthropicKey = key;
      }
    } else {
      anthropicKey = ""; // Clear if not selected
    }
  }

  // App config section
  printSection("Step 3: Your Info");

  const appQuestions = [
    {
      type: "input",
      name: "ownerName",
      message: existingValues.ownerName
        ? `Your name [${existingValues.ownerName}]:`
        : "Your name:",
      default: existingValues.ownerName || "Team",
    },
    {
      type: "input",
      name: "eventName",
      message: existingValues.eventName
        ? `Event name [${existingValues.eventName}]:`
        : "Event name (e.g., 'AI Summit 2024'):",
      default: existingValues.eventName || "Conference 2024",
    },
    {
      type: "input",
      name: "calendlyLink",
      message: "Calendly scheduling link (optional):",
      default: existingValues.calendlyLink || "",
    },
  ];

  const appAnswers = await inquirer.prompt(appQuestions);

  // Integrations section
  printSection("Step 4: Integrations");

  // Pre-select integrations that already have keys
  const defaultIntegrations: string[] = [];
  if (existingValues.heygenKey) defaultIntegrations.push("heygen");
  if (existingValues.hubspotKey) defaultIntegrations.push("hubspot");
  if (existingValues.sendgridKey) defaultIntegrations.push("sendgrid");
  if (existingValues.proxycurlKey) defaultIntegrations.push("proxycurl");

  if (defaultIntegrations.length > 0) {
    printInfo(`Currently configured: ${defaultIntegrations.join(", ")}`);
  }

  const integrationAnswers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "integrations",
      message: "Which integrations do you want to enable?",
      choices: [
        { name: "HeyGen (AI video generation)", value: "heygen", checked: !!existingValues.heygenKey },
        { name: "HubSpot (CRM sync)", value: "hubspot", checked: !!existingValues.hubspotKey },
        { name: "SendGrid (Email)", value: "sendgrid", checked: !!existingValues.sendgridKey },
        { name: "Proxycurl (LinkedIn enrichment)", value: "proxycurl", checked: !!existingValues.proxycurlKey },
      ],
    },
  ]);

  const integrations = integrationAnswers.integrations as string[];
  const integrationKeys: Record<string, string> = {
    heygen: existingValues.heygenKey,
    hubspot: existingValues.hubspotKey,
    sendgrid: existingValues.sendgridKey,
    proxycurl: existingValues.proxycurlKey,
  };

  // Only ask for keys for newly selected integrations that don't have keys
  for (const integration of integrations) {
    if (!integrationKeys[integration]) {
      const { key } = await inquirer.prompt([
        {
          type: "password",
          name: "key",
          message: `${integration.charAt(0).toUpperCase() + integration.slice(1)} API Key:`,
          mask: "*",
        },
      ]);
      integrationKeys[integration] = key;
    } else {
      printInfo(`${integration}: Using existing key from env`);
    }
  }

  // Clear keys for deselected integrations
  for (const key of Object.keys(integrationKeys)) {
    if (!integrations.includes(key)) {
      integrationKeys[key] = "";
    }
  }

  printSection("Creating Configuration");

  // Generate webhook secret only if not already set
  const webhookSecret = existingValues.webhookSecret || crypto.randomBytes(32).toString("hex");

  // Merge answers with existing values
  const finalValues = {
    supabaseUrl: dbAnswers.supabaseUrl || existingValues.supabaseUrl,
    supabaseKey: dbAnswers.supabaseKey || existingValues.supabaseKey,
    supabaseTable: dbAnswers.supabaseTable || existingValues.supabaseTable,
    openaiKey: openaiKey || "",
    anthropicKey: anthropicKey || "",
    ownerName: appAnswers.ownerName || existingValues.ownerName,
    eventName: appAnswers.eventName || existingValues.eventName,
    calendlyLink: appAnswers.calendlyLink || existingValues.calendlyLink || "",
    heygenKey: integrationKeys.heygen || "",
    hubspotKey: integrationKeys.hubspot || "",
    sendgridKey: integrationKeys.sendgrid || "",
    proxycurlKey: integrationKeys.proxycurl || "",
    calendlyKey: existingValues.calendlyKey || "",
    port: existingValues.port,
  };

  // Create .env content
  const envContent = `# NextHello Configuration
# Generated by: nexthello setup
# Date: ${new Date().toISOString()}

# ===========================================
# Database (Required)
# ===========================================
SUPABASE_URL=${finalValues.supabaseUrl}
SUPABASE_KEY=${finalValues.supabaseKey}
SUPABASE_TABLE=${finalValues.supabaseTable}

# ===========================================
# AI Providers
# ===========================================
OPENAI_API_KEY=${finalValues.openaiKey}
ANTHROPIC_API_KEY=${finalValues.anthropicKey}

# ===========================================
# App Configuration
# ===========================================
NEXTHELLO_OWNER_NAME=${finalValues.ownerName}
NEXTHELLO_EVENT_NAME=${finalValues.eventName}
NEXTHELLO_CALENDLY_LINK=${finalValues.calendlyLink}

# ===========================================
# Integrations
# ===========================================
HEYGEN_API_KEY=${finalValues.heygenKey}
HUBSPOT_API_KEY=${finalValues.hubspotKey}
SENDGRID_API_KEY=${finalValues.sendgridKey}
PROXYCURL_API_KEY=${finalValues.proxycurlKey}
CALENDLY_API_KEY=${finalValues.calendlyKey}

# ===========================================
# Security
# ===========================================
WEBHOOK_SECRET=${webhookSecret}

# ===========================================
# Server
# ===========================================
PORT=${finalValues.port}
HOST=0.0.0.0
`;

  fs.writeFileSync(".env", envContent);
  printSuccess("Created .env file");

  // Create config.json if it doesn't exist
  if (!fs.existsSync("nexthello.config.json")) {
    const configContent = {
      enabled: true,
      eventName: appAnswers.eventName,
      ownerName: appAnswers.ownerName,
      requiredFields: ["email", "company_name", "job_title"],
      heygen: {
        avatarId: "YOUR_AVATAR_ID",
        voiceId: "YOUR_VOICE_ID",
      },
      calendly: {
        schedulingLink: appAnswers.calendlyLink || "https://calendly.com/your-link",
      },
      crm: {
        provider: integrations.includes("hubspot") ? "hubspot" : null,
      },
      messages: {
        welcome: "Hey! Great meeting you at {{eventName}}! Here's a quick video from me:",
        collectEmail: "What's your email? I'll send over some resources we discussed.",
        collectCompany: "And which company are you with?",
        collectTitle: "What's your role there?",
        complete:
          "Perfect! Looking forward to connecting more. Feel free to book a time to chat!",
      },
    };

    fs.writeFileSync("nexthello.config.json", JSON.stringify(configContent, null, 2));
    printSuccess("Created nexthello.config.json");
  }

  printSection("Setup Complete!");

  console.log("");
  printSuccess("NextHello is configured and ready to go!");
  console.log("");

  console.log(colors.bold("Next steps:"));
  console.log("");
  printCommand("Connect WhatsApp", "nexthello connect");
  printCommand("Start server", "nexthello start");
  printCommand("View status", "nexthello status");
  console.log("");

  if (integrations.includes("heygen")) {
    printWarning("Don't forget to update your HeyGen avatar/voice IDs in nexthello.config.json");
  }

  console.log("");
}
