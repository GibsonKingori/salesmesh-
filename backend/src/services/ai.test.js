import { jest } from '@jest/globals';
import { aiProvider, askAiJson, ReadError } from './ai.js';

const schema = { type: 'object', properties: { rows: { type: 'array' } }, required: ['rows'], additionalProperties: false };
const realFetch = global.fetch;

beforeEach(() => {
  process.env.AI_PROVIDER = 'ollama';
  delete process.env.OLLAMA_VISION_MODEL;
});
afterAll(() => {
  global.fetch = realFetch;
  delete process.env.AI_PROVIDER;
});

test('uses Claude when an API key is set, otherwise the free local model', () => {
  delete process.env.AI_PROVIDER;
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  expect(aiProvider()).toBe('ollama');
  process.env.ANTHROPIC_API_KEY = 'x';
  expect(aiProvider()).toBe('claude');
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
});

describe('Ollama', () => {
  test('sends a screenshot to the vision model with the JSON schema, and returns the parsed answer', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ message: { content: '{"rows":[{"title":"Sofa"}]}' } }) }));

    const result = await askAiJson({ prompt: 'Read this', image: { data: 'aW1n', mediaType: 'image/png' }, schema });

    expect(result).toEqual({ rows: [{ title: 'Sofa' }] });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'qwen2.5vl:3b', stream: false, format: schema });
    expect(body.messages[0]).toEqual({ role: 'user', content: 'Read this', images: ['aW1n'] });
  });

  test('text-only questions use the smaller text model', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ message: { content: '{"rows":[]}' } }) }));
    await askAiJson({ prompt: 'Match columns', schema });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('qwen2.5:3b');
  });

  test('explains when Ollama is not running', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(askAiJson({ prompt: 'x', schema })).rejects.toThrow(/isn't running/);
  });

  test('explains how to install a missing model', async () => {
    process.env.OLLAMA_VISION_MODEL = 'gemma3:4b';
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => '{"error":"model \\"gemma3:4b\\" not found"}' }));
    const err = await askAiJson({ prompt: 'x', image: { data: 'a', mediaType: 'image/png' }, schema }).catch((e) => e);
    expect(err).toBeInstanceOf(ReadError);
    expect(err.message).toMatch(/ollama pull gemma3:4b/);
  });

  test("a PDF that can't be opened gets a clear message instead of a crash", async () => {
    global.fetch = jest.fn();
    await expect(askAiJson({ prompt: 'x', pdf: Buffer.from('not a pdf'), schema })).rejects.toBeInstanceOf(ReadError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
