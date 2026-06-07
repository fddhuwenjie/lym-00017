function computeSimilarity(text1: string, text2: string): number {
  const tokens1 = new Set(text1.split(/\W+/));
  const words2 = new Set(text2.split(/\W+/));
  
  if (words1.size === 0 && words2.size === 0) return 1.0;
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// 示例用法
const sim = calculateSimilarity("hello world", "hello there");
console.log(`Similarity: ${sim}`);