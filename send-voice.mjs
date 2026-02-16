import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

// Find contact "A S"
const contacts = await sql`
  SELECT id, phone_number, first_name, last_name
  FROM networking_contacts
  WHERE first_name ILIKE 'A%' AND last_name ILIKE 'S%'
  OR (first_name || ' ' || last_name) ILIKE '%A S%'
  LIMIT 5
`;

if (contacts.length === 0) {
  console.log('No contact found matching "A S"');
  await sql.end();
  process.exit(1);
}

console.log('Found contacts:');
for (let i = 0; i < contacts.length; i++) {
  const c = contacts[i];
  console.log((i + 1) + '. ' + c.first_name + ' ' + c.last_name + ' - ' + c.phone_number + ' (id: ' + c.id + ')');
}

await sql.end();
