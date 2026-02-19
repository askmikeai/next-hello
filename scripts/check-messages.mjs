import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const phone = process.argv[2] || '17544220907';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { data } = await supabase
  .from('message_history')
  .select('created_at, direction, content')
  .eq('phone_number', phone)
  .order('created_at', { ascending: false })
  .limit(20);

data?.reverse().forEach(m => {
  const time = new Date(m.created_at).toLocaleTimeString('en-US', { hour12: false });
  const dir = m.direction === 'inbound' ? '👤 USER' : '🤖 AI  ';
  const content = m.content?.substring(0, 250) || '(no content)';
  console.log(`${time} ${dir}: ${content}`);
  console.log('');
});
