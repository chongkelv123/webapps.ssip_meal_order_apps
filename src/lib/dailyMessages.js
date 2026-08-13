const DAILY_MESSAGES = [
  'Eat all you want lah. We handle the orders, you handle your weight. 😄',
  'Good food, no queue, no drama. Just order and go. 🍱',
  'Hungry already? Your next meal is a few taps away. 😋',
  'Don’t skip lunch lah, your wallet won’t even feel it. 💸',
  'Order now, thank yourself later. 🙌',
  'Rain or shine, your meal still comes on time. ☀️🌧️',
  'Eat well today, work hard tomorrow. 💪',
  'One order a day keeps the hunger away. 🍛',
  'Life’s too short for bad lunches. Order something good. 😎',
  'Treat yourself lah, you deserve a good meal today. 🎉',
];

// Tailwind class names must stay literal (not template-built) so the JIT scanner picks them up.
// Length is deliberately coprime with DAILY_MESSAGES.length so the message/color pairing
// doesn't repeat in the same pattern every cycle.
const DAILY_BANNER_COLORS = [
  'bg-blue-600',
  'bg-purple-600',
  'bg-teal-600',
  'bg-rose-500',
  'bg-indigo-600',
  'bg-emerald-600',
  'bg-orange-500',
];

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / 86400000);
}

export function getDailyMessage(date = new Date()) {
  const index = getDayOfYear(date) % DAILY_MESSAGES.length;
  return DAILY_MESSAGES[index];
}

export function getDailyBannerColor(date = new Date()) {
  const index = getDayOfYear(date) % DAILY_BANNER_COLORS.length;
  return DAILY_BANNER_COLORS[index];
}
