import { getDatabase } from './dist/src/database/client.js';
import { addJob } from './dist/src/queue/client.js';

function buildVideoCaption(firstName) {
  const name = firstName || "there";
  return `Hey ${name}! Look at this workflow - this video was created just for you by AI automation, or what I like to call a swarm of agents working on your behalf in the background. Let's connect so we can explore how AI can transform your business or personal life!`;
}

async function requeueVideos() {
  const sql = getDatabase();
  if (!sql) {
    console.log('Database not configured');
    process.exit(1);
  }

  // Find contacts with completed videos
  const data = await sql`
    SELECT phone_number, heygen_video_id, heygen_video_url, first_name
    FROM networking_contacts
    WHERE heygen_video_id IS NOT NULL
    AND heygen_video_url IS NOT NULL
  `;

  console.log('Found', data?.length || 0, 'contacts with completed videos');

  for (const record of data || []) {
    console.log(`\nQueuing video for ${record.first_name || 'Unknown'} (${record.phone_number})...`);

    const caption = buildVideoCaption(record.first_name);
    console.log('Caption:', caption);

    const job = await addJob('outbound-messages', {
      correlationId: `requeue-${Date.now()}`,
      phoneNumber: record.phone_number,
      channel: 'whatsapp',
      messageType: 'video',
      content: record.heygen_video_url,
      caption: caption,
      metadata: { videoId: record.heygen_video_id },
    });

    console.log('Queued job:', job.id);
  }

  console.log('\nDone! Start the WhatsApp worker to send the videos.');
  process.exit(0);
}

requeueVideos().catch(e => {
  console.error(e);
  process.exit(1);
});
