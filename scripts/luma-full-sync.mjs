/**
 * Luma Full Sync Script
 *
 * Scrapes all events and saves to database.
 * Run: node scripts/luma-full-sync.mjs
 */

import 'dotenv/config';
import { hasValidSession, getUserEvents, scrapeEventGuests, closeBrowser } from '../dist/src/integrations/luma/scraper.js';
import { saveScrapedEvent, autoMatchContacts } from '../dist/src/integrations/luma/repo.js';

async function main() {
  console.log('=== Luma Full Sync ===\n');

  const hasSession = await hasValidSession();
  if (!hasSession) {
    console.log('❌ No valid session. Need to login first.');
    await closeBrowser();
    process.exit(1);
  }

  console.log('📋 Getting events...');
  const events = await getUserEvents();
  console.log(`Found ${events.length} events\n`);

  let totalHosts = 0;
  let totalGuests = 0;

  for (const event of events) {
    console.log(`🔍 Scraping: ${event.name || event.slug}`);
    const scraped = await scrapeEventGuests(event.slug);

    if (scraped) {
      console.log(`   Hosts: ${scraped.hosts.length}`);
      console.log(`   Guests: ${scraped.guests.length}`);

      // Save to database
      try {
        const { guestCount } = await saveScrapedEvent(scraped);
        console.log(`   ✅ Saved ${guestCount} guests to database`);
      } catch (error) {
        console.log(`   ⚠️ Error saving: ${error.message}`);
      }

      totalHosts += scraped.hosts.length;
      totalGuests += scraped.guests.length;
    } else {
      console.log('   ❌ Failed to scrape');
    }
    console.log('');
  }

  // Run contact matching
  console.log('🔗 Running contact matching...');
  const matchedContacts = await autoMatchContacts();
  console.log(`   Matched ${matchedContacts} contacts\n`);

  await closeBrowser();

  console.log('=== Summary ===');
  console.log(`Events: ${events.length}`);
  console.log(`Hosts: ${totalHosts}`);
  console.log(`Guests: ${totalGuests}`);
  console.log(`Contacts matched: ${matchedContacts}`);
  console.log('\n✅ Done!');
}

main().catch(error => {
  console.error('Error:', error);
  closeBrowser().finally(() => process.exit(1));
});
