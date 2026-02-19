#!/usr/bin/env node
/**
 * Test script to read emails via Gmail IMAP with OAuth2
 */

import { config } from "dotenv";
config();

import Imap from "imap";
import { simpleParser } from "mailparser";
import { google } from "googleapis";

const gmailConfig = {
  user: process.env.GMAIL_USER,
  clientId: process.env.GMAIL_CLIENT_ID,
  clientSecret: process.env.GMAIL_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN,
};

async function getAccessToken() {
  const oauth2Client = new google.auth.OAuth2(
    gmailConfig.clientId,
    gmailConfig.clientSecret,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: gmailConfig.refreshToken,
  });

  const { token } = await oauth2Client.getAccessToken();
  return token;
}

async function readEmails(limit = 3) {
  console.log("Getting access token...");
  const accessToken = await getAccessToken();

  if (!accessToken) {
    console.error("Failed to get access token");
    return;
  }

  console.log("Connecting to Gmail IMAP...");

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: gmailConfig.user,
      xoauth2: Buffer.from(
        `user=${gmailConfig.user}\x01auth=Bearer ${accessToken}\x01\x01`
      ).toString("base64"),
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails = [];

    imap.once("ready", () => {
      console.log("Connected to IMAP");

      imap.openBox("INBOX", true, (err, box) => {
        if (err) {
          reject(err);
          return;
        }

        console.log(`Inbox has ${box.messages.total} messages`);

        // Get the last N messages
        const total = box.messages.total;
        const start = Math.max(1, total - limit + 1);
        const range = `${start}:${total}`;

        console.log(`Fetching messages ${range}...`);

        const fetch = imap.seq.fetch(range, {
          bodies: "",
          struct: true,
        });

        fetch.on("message", (msg, seqno) => {
          let buffer = "";

          msg.on("body", (stream) => {
            stream.on("data", (chunk) => {
              buffer += chunk.toString("utf8");
            });
          });

          msg.once("end", async () => {
            try {
              const parsed = await simpleParser(buffer);
              emails.push({
                seqno,
                from: parsed.from?.text || "Unknown",
                subject: parsed.subject || "(No subject)",
                date: parsed.date?.toISOString() || "Unknown date",
                preview: (parsed.text || "").substring(0, 150).replace(/\n/g, " "),
              });
            } catch (e) {
              console.error(`Failed to parse message ${seqno}:`, e.message);
            }
          });
        });

        fetch.once("error", (err) => {
          console.error("Fetch error:", err);
          reject(err);
        });

        fetch.once("end", () => {
          console.log("Fetch complete");
          imap.end();
        });
      });
    });

    imap.once("error", (err) => {
      console.error("IMAP error:", err);
      reject(err);
    });

    imap.once("end", () => {
      console.log("IMAP connection closed");
      // Sort by seqno descending (newest first)
      emails.sort((a, b) => b.seqno - a.seqno);
      resolve(emails);
    });

    imap.connect();
  });
}

// Run
readEmails(3)
  .then((emails) => {
    console.log("\n=== Last 3 Emails ===\n");
    emails.forEach((email, i) => {
      console.log(`${i + 1}. From: ${email.from}`);
      console.log(`   Subject: ${email.subject}`);
      console.log(`   Date: ${email.date}`);
      console.log(`   Preview: ${email.preview}...`);
      console.log();
    });
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
