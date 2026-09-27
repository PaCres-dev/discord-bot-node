// Texto de WhatsApp para un tweet:
// 🔁 @quien retuiteó
// *Nombre* (@usuario) · ↩️ respuesta a @otro
// texto
// link
export function formatTweet(tweet) {
  const lines = [];
  if (tweet.retweetedBy) lines.push(`🔁 @${tweet.retweetedBy} retuiteó`);
  const reply = tweet.replyTo ? ` · ↩️ respuesta a @${tweet.replyTo}` : '';
  lines.push(`*${tweet.author.name || tweet.author.username}* (@${tweet.author.username})${reply}`);
  if (tweet.text) lines.push(tweet.text);
  lines.push(tweet.url);
  return lines.join('\n');
}
