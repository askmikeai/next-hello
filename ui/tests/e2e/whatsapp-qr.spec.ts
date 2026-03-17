import { expect, test } from "@playwright/test";

test("hollywood user sees WhatsApp QR when disconnected", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "nexthello.auth.users",
      JSON.stringify([
        {
          name: "Hollywood User",
          email: "hollywoodfl23@gmail.com",
          password: "Testing123$",
        },
      ])
    );
    localStorage.removeItem("nexthello.auth.session");
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.locator('input[type="email"]').fill("hollywoodfl23@gmail.com");
  await page.locator('input[type="password"]').fill("Testing123$");
  await page.getByRole("button", { name: "Enter Dashboard" }).click();

  await expect(page.getByRole("heading", { name: "NextHello Swarm Dashboard" })).toBeVisible();
  await expect(page.locator(".qr-status")).toContainText("Not connected yet");

  await page.waitForTimeout(3000);
  await expect(page.locator("img.qr-image")).toBeVisible();
});
