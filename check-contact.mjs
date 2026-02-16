import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

const result = await sql`
  SELECT id, phone_number, first_name, heygen_video_id, heygen_video_url, 
         swarm_metadata, status, created_at 
  FROM networking_contacts 
  WHERE id = '8b904da4-538a-44da-b859-b4e2e4848ec7'
`;

console.log(JSON.stringify(result[0], null, 2));
await sql.end();
