#!/usr/bin/env tsx
/**
 * Manual test script for IntentParser
 * 
 * Run with: tsx scripts/test-parser.ts
 * 
 * Requires Ollama to be running with qwen2.5:7b model pulled
 */

import { OllamaClient } from '../src/lib/llm';
import { IntentParser } from '../src/lib/orchestrator/parser';
import { TEST_QUERIES } from '../tests/test-queries';

async function testParser() {
  console.log('Testing IntentParser with Ollama...\n');
  console.log('Make sure Ollama is running: ollama serve\n');

  const llm = new OllamaClient();
  const parser = new IntentParser(llm);

  // Test health check
  console.log('Checking Ollama connection...');
  const isHealthy = await llm.healthCheck();
  if (!isHealthy) {
    console.error('❌ Cannot connect to Ollama. Is it running?');
    console.error('   Start with: ollama serve');
    process.exit(1);
  }
  console.log('✓ Ollama is running\n');

  // Test a few queries
  const testQueries = TEST_QUERIES.slice(0, 5); // Test first 5 queries

  for (const query of testQueries) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Query: "${query}"`);
    console.log('-'.repeat(60));

    try {
      const start = performance.now();
      const result = await parser.parse(query);
      const elapsed = performance.now() - start;

      console.log('✓ Parsed successfully');
      console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`  Parse time: ${elapsed.toFixed(0)}ms`);
      console.log('\n  Structured Query:');
      console.log(JSON.stringify(result.query, null, 2));
    } catch (error) {
      console.error('✗ Parse failed');
      if (error instanceof Error) {
        console.error(`  Error: ${error.message}`);
      } else {
        console.error(`  Error: ${String(error)}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Testing complete!');
}

// Run tests
testParser().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

