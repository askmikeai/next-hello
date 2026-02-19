#!/usr/bin/env node
/**
 * Test script to send an email via Gmail OAuth2
 */

import { config } from "dotenv";
config();

import nodemailer from "nodemailer";
import { google } from "googleapis";

const gmailConfig = {
  user: process.env.GMAIL_USER,
  clientId: process.env.GMAIL_CLIENT_ID,
  clientSecret: process.env.GMAIL_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN,
};

console.log("Gmail config check:");
console.log("  GMAIL_USER:", gmailConfig.user ? "set" : "missing");
console.log("  GMAIL_CLIENT_ID:", gmailConfig.clientId ? "set" : "missing");
console.log("  GMAIL_CLIENT_SECRET:", gmailConfig.clientSecret ? "set" : "missing");
console.log("  GMAIL_REFRESH_TOKEN:", gmailConfig.refreshToken ? "set" : "missing");

if (!gmailConfig.user || !gmailConfig.clientId || !gmailConfig.clientSecret || !gmailConfig.refreshToken) {
  console.error("\nMissing Gmail OAuth2 credentials. Set them in .env");
  process.exit(1);
}

async function sendTestEmail() {
  console.log("\nCreating OAuth2 client...");

  const oauth2Client = new google.auth.OAuth2(
    gmailConfig.clientId,
    gmailConfig.clientSecret,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: gmailConfig.refreshToken,
  });

  console.log("Getting access token...");
  const { token } = await oauth2Client.getAccessToken();

  if (!token) {
    console.error("Failed to get access token");
    process.exit(1);
  }
  console.log("Access token obtained successfully");

  console.log("Creating transporter...");
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: gmailConfig.user,
      clientId: gmailConfig.clientId,
      clientSecret: gmailConfig.clientSecret,
      refreshToken: gmailConfig.refreshToken,
      accessToken: token,
    },
  });

  const mailOptions = {
    from: gmailConfig.user,
    to: "hollywoodfl23@gmail.com",
    subject: "Test Email from NextHello",
    text: "This is a test email sent via Gmail OAuth2 from the NextHello system.\n\nIf you received this, the email integration is working!",
    html: `
      <h2>Test Email from NextHello</h2>
      <p>This is a test email sent via Gmail OAuth2 from the NextHello system.</p>
      <p>If you received this, the email integration is working!</p>
      <hr>
      <p style="color: #666; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
    `,
  };

  console.log("Sending email to hollywoodfl23@gmail.com...");
  const result = await transporter.sendMail(mailOptions);

  console.log("\nEmail sent successfully!");
  console.log("Message ID:", result.messageId);
  console.log("Response:", result.response);
}

sendTestEmail().catch((error) => {
  console.error("\nError sending email:", error.message);
  if (error.code) console.error("Error code:", error.code);
  process.exit(1);
});
