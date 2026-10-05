// The importer's AI, behind one function so the provider can be switched in .env:
//   AI_PROVIDER=ollama  free, runs on this computer (https://ollama.com); slower, no usage limits
//   AI_PROVIDER=claude  Anthropic's Claude API (ANTHROPIC_API_KEY); faster and more accurate, paid
// Unset: Claude when ANTHROPIC_API_KEY is set, otherwise Ollama.
import Anthropic from '@anthropic-ai/sdk';
import { extractText, getDocumentProxy } from 'unpdf';

const OLLAMA_URL = () => (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_TEXT_MODEL = () => process.env.OLLAMA_TEXT_MODEL || 'qwen2.5:3b';
const OLLAMA_VISION_MODEL = () => process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:3b';
// A small model on a laptop CPU can take a few minutes over a big screenshot
const OLLAMA_TIMEOUT_MS = () => Number(process.env.OLLAMA_TIMEOUT_SECONDS || 600) * 1000;

export const aiProvider = () => process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'ollama');

// Error whose message is safe to show the user
export class ReadError extends Error {}

// ---- Claude ----

let anthropic;
const getAnthropic = () => (anthropic ??= new Anthropic());

async function askClaude({ prompt, image, pdf, schema, effort, maxTokens }) {
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } });
  content.push({ type: 'text', text: prompt });

  let message;
  try {
    const stream = getAnthropic().beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || /api key|apiKey|authToken|credentials/i.test(err.message)) {
      throw new ReadError('AI reading is not set up on this server (ANTHROPIC_API_KEY is missing or invalid).');
    }
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
      throw new ReadError('The AI reader is busy right now. Please try again in a minute.');
    }
    if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
      console.error('Claude API:', err.message);
      throw new ReadError('AI reading is unavailable: the Claude API account has run out of credit (add credit at platform.claude.com, or set AI_PROVIDER=ollama).');
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error('Claude API rejected the request:', err.message);
      throw new ReadError('That file could not be read by the AI reader. Try a clearer screenshot, or a smaller file.');
    }
    throw err;
  }

  if (message.stop_reason === 'refusal') throw new ReadError('That file could not be read.');
  if (message.stop_reason === 'max_tokens') {
    throw new ReadError('That file has too much in it to read in one go. Split it into smaller parts, or upload the spreadsheet itself.');
  }
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ---- Ollama (local) ----

// Exported PDFs carry their text; local models can't open PDFs, so they get the text instead
async function pdfText(buffer) {
  try {
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(doc, { mergePages: true });
    return String(text).trim();
  } catch {
    throw new ReadError('That PDF could not be opened.');
  }
}

async function askOllama({ prompt, image, pdf, schema }) {
  let content = prompt;
  if (pdf) {
    const text = await pdfText(pdf);
    if (!text) throw new ReadError('This PDF is a scanned picture with no text in it. Take a screenshot of it and upload that instead.');
    content = `${prompt}\n\nThe document is a PDF; here is its text, page by page:\n\n${text.slice(0, 60000)}`;
  }
  const model = image ? OLLAMA_VISION_MODEL() : OLLAMA_TEXT_MODEL();

  let res;
  try {
    res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: schema, // Ollama constrains the output to this JSON schema
        options: { temperature: 0, num_ctx: 8192 },
        messages: [{ role: 'user', content, ...(image ? { images: [image.data] } : {}) }],
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS()),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new ReadError('The local AI took too long. Try a smaller screenshot (crop it to just the table), or upload the spreadsheet itself.');
    }
    throw new ReadError(`The local AI (Ollama) isn't running. Start Ollama on the server, then try again.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 || /not found/i.test(body)) {
      throw new ReadError(`The local AI model "${model}" isn't installed. On the server, run: ollama pull ${model}`);
    }
    console.error('Ollama error:', res.status, body.slice(0, 500));
    throw new ReadError('The local AI could not read that file. Try a clearer screenshot, or upload the spreadsheet itself.');
  }
  const data = await res.json();
  return data.message?.content ?? '';
}

// Sends the prompt (plus an image { data: base64, mediaType } or a PDF buffer) and returns the JSON
// object the model wrote, constrained to `schema`
export async function askAiJson({ prompt, image, pdf, schema, effort = 'medium', maxTokens = 16000 }) {
  const provider = aiProvider();
  const text =
    provider === 'claude'
      ? await askClaude({ prompt, image, pdf, schema, effort, maxTokens })
      : await askOllama({ prompt, image, pdf, schema });
  try {
    return JSON.parse(text);
  } catch {
    throw new ReadError('The AI reader returned something unexpected. Please try again.');
  }
}
