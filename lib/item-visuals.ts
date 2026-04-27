const ITEM_ICON_RULES: Array<{ emoji: string; keywords: string[] }> = [
  { emoji: '🥛', keywords: ['milk'] },
  { emoji: '🍞', keywords: ['bread', 'toast'] },
  { emoji: '🥣', keywords: ['dahi', 'curd', 'yogurt'] },
  { emoji: '🧀', keywords: ['paneer', 'cheese'] },
  { emoji: '🌻', keywords: ['seed', 'mix seed', 'flax', 'chia'] },
  { emoji: '🍚', keywords: ['rice'] },
  { emoji: '🌾', keywords: ['atta', 'flour'] },
  { emoji: '🫘', keywords: ['dal', 'lentil', 'rajma', 'chana'] },
  { emoji: '🫒', keywords: ['oil', 'ghee'] },
  { emoji: '🍵', keywords: ['tea'] },
  { emoji: '☕', keywords: ['coffee'] },
  { emoji: '🥚', keywords: ['egg'] },
  { emoji: '🍌', keywords: ['banana'] },
  { emoji: '🍎', keywords: ['apple'] },
  { emoji: '🧅', keywords: ['onion'] },
  { emoji: '🍅', keywords: ['tomato'] },
  { emoji: '🥔', keywords: ['potato', 'aloo'] },
  { emoji: '🧼', keywords: ['soap'] },
  { emoji: '🧴', keywords: ['shampoo', 'lotion', 'cream'] },
  { emoji: '🪥', keywords: ['toothpaste', 'brush'] },
  { emoji: '🍪', keywords: ['biscuit', 'cookie'] },
];

export function getItemEmoji(title: string): string {
  const normalized = title.trim().toLowerCase();
  for (const rule of ITEM_ICON_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.emoji;
    }
  }
  return '🛒';
}
