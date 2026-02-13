import { getDatabase } from './dist/src/database/client.js';
import { getVideoStatus } from './dist/src/integrations/heygen/client.js';
import { addJob } from './dist/src/queue/client.js';

function buildVideoCaption(firstName) {
  const name = firstName || "there";
  return `Hey ${name}! Look at this workflow - this video was created just for you by AI automation, or what I like to call a swarm of agents working on your behalf in the background. Let's connect so we can explore how AI can transform your business or personal life!`;
}

async function testPoller() {
  const sql = getDatabase();
  if (!sql) {
    console.log('Database not configured');
    process.exit(1);
  }

  // Find pending videos
  const data = await sql`
    SELECT phone_number, heygen_video_id, first_name, heygen_video_url
    FROM networking_contacts
    WHERE heygen_video_id IS NOT NULL
  `;

  console.log('Contacts with HeyGen video IDs:');
  for (const row of data || []) {
    console.log({
      phone: row.phone_number,
      videoId: row.heygen_video_id,
      name: row.first_name,
      hasUrl: !!row.heygen_video_url
    });
  }

  const pending = data?.filter(r => !r.heygen_video_url) || [];
  console.log('\nPending (no URL yet):', pending.length);

  if (pending.length === 0) {
    console.log('No pending videos to check');
    process.exit(0);
  }

  // Check each pending video
  for (const record of pending) {
    console.log(`\nChecking video ${record.heygen_video_id} for ${record.phone_number}...`);

    const result = await getVideoStatus(record.heygen_video_id);
    console.log('Status:', result);

    if (result.status === 'completed' && result.videoUrl) {
      console.log('Video ready! Updating database and queueing for send...');

      // Update contact
      await sql`
        UPDATE networking_contacts
        SET heygen_video_url = ${result.videoUrl},
            updated_at = NOW()
        WHERE heygen_video_id = ${record.heygen_video_id}
      `;

      console.log('Database updated with video URL');

      // Queue for sending
      const job = await addJob('outbound-messages', {
        correlationId: `test-${Date.now()}`,
        phoneNumber: record.phone_number,
        channel: 'whatsapp',
        messageType: 'video',
        content: result.videoUrl,
        caption: buildVideoCaption(record.first_name),
        metadata: { videoId: record.heygen_video_id },
      });
      console.log('Queued job:', job.id);
      console.log('Caption:', buildVideoCaption(record.first_name));
    }
  }

  process.exit(0);
}

testPoller().catch(e => {
  console.error(e);
  process.exit(1);
});
