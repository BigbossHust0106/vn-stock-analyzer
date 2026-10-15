import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
it('workerd thật: RSS/LLM không theo redirect, phân tích có bằng chứng và không sai chế độ redirect', async () => {
  const stamp = '2026-10-15T08:00:00Z',
    title = 'DPR công bố kết quả kinh doanh quý III';
  const output = await build({
    stdin: {
      contents: `import {collectNews} from './worker/src/news/sync';import {createClient} from '@supabase/supabase-js';export default {async fetch(){const db=createClient('https://db.example.test','runtime-test-key',{auth:{persistSession:false,autoRefreshToken:false}});const result=await collectNews(db,{NEWS_RSS_PERMISSION:'personal-nonprofit',NEWS_LLM_API_KEY:'runtime-test-not-real',NEWS_LLM_BASE_URL:'https://llm.example.test/v1',NEWS_LLM_MODEL:'runtime-test'},Date.parse('${stamp}'));return Response.json(result);}}`,
      resolveDir: process.cwd(),
      sourcefile: 'runtime-test.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  let redirectLlm = false;
  const writes: { table: string; body: unknown }[] = [],
    calls: string[] = [];
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'news-runtime',
          compatibilityDate: '2026-10-12',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'test.js',
            modules: {
              'test.js': { type: 'esm', contents: output.outputFiles[0]!.text },
            },
          },
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            handler: async (request) => {
              const url = new URL(request.url);
              calls.push(request.url);
              if (url.hostname === 'db.example.test') {
                if (url.pathname.endsWith('/claim_news_ingestion'))
                  return Response.json(true);
                if (url.pathname.endsWith('/release_news_ingestion'))
                  return Response.json(null);
                const table = url.pathname.split('/').at(-1)!;
                if (request.method === 'POST')
                  writes.push({ table, body: await request.json() });
                if (table === 'stocks')
                  return Response.json([
                    {
                      id: 's',
                      symbol: 'DPR',
                      name: 'Cao su Đồng Phú',
                      sector: 'Cao su',
                    },
                  ]);
                return Response.json([]);
              }
              if (url.hostname === 'llm.example.test' && redirectLlm)
                return new Response(null, {
                  status: 303,
                  headers: { Location: 'https://should-not-fetch.invalid' },
                });
              if (url.hostname === 'llm.example.test')
                return Response.json({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          summary: title,
                          evidence: title,
                          sentiment: 'positive',
                          impact: 'high',
                          horizon: 'short',
                        }),
                      },
                    },
                  ],
                });
              if (url.pathname === '/robots.txt')
                return new Response('User-agent: *\nAllow: /');
              return new Response(
                `<rss version="2.0"><channel><item><title>${title}</title><link>https://${url.hostname}/news</link><pubDate>Thu, 15 Oct 2026 14:00:00 +0700</pubDate><description>DPR ghi nhận kết quả năm 2026.</description></item></channel></rss>`,
              );
            },
          },
        },
      },
    ],
  });
  try {
    const response = await mf.dispatchFetch('https://test.local');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inserted: 1,
      analyzed: 1,
      sourceFailures: 0,
      llmConfigured: true,
    });
    expect(calls.filter((x) => x.includes('chat/completions'))).toHaveLength(1);
    const scores = writes
      .filter((w) => w.table === 'news_scores')
      .flatMap((w) => w.body as { score: number | null }[]);
    expect(scores[0]?.score).toBe(100);
    expect(writes.some((w) => w.table === 'news_feed_articles')).toBe(true);
    redirectLlm = true;
    const rejected = await mf.dispatchFetch('https://test.local');
    expect(await rejected.json()).toMatchObject({ analyzed: 0 });
    expect(calls.some((x) => x.includes('should-not-fetch.invalid'))).toBe(
      false,
    );
  } finally {
    await mf.dispose();
  }
}, 30000);
