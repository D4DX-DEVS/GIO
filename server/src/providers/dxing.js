// DXing WhatsApp provider adapter.
//
// POST {DXING_BASE_URL}/send/whatsapp with secret/account in the JSON body;
// success when the response body has status === 200. Verify these against the
// DXing API details for your account before going live. Only this file knows
// about DXing; the rest of the app calls sendText / sendImage.
const { env } = require('../config/env');

class ProviderError extends Error {
  constructor(message, { retryable = true, details } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
    this.details = details;
  }
}

// Messages captured in mock mode (inspected by tests and logged in dev).
const mockOutbox = [];

function describeResponse(data) {
  if (!data || typeof data !== 'object') return String(data || '').slice(0, 300);
  const msg = data.message || data.error || data.data?.message;
  return typeof msg === 'string' ? msg.slice(0, 300) : JSON.stringify(data).slice(0, 300);
}

async function post(payload) {
  const { mode, baseUrl, secret, account, timeoutMs } = env.dxing;

  if (mode === 'mock') {
    const entry = { ...payload, at: new Date(), id: `mock-${mockOutbox.length + 1}` };
    mockOutbox.push(entry);
    if (env.nodeEnv !== 'test') console.log(`[dxing:mock] ${payload.type} to ${payload.recipient}`);
    return { messageId: entry.id };
  }

  if (!secret || !account) {
    throw new ProviderError('WhatsApp sending is not configured (DXING_API_KEY / DXING_INSTANCE_ID).', {
      retryable: false,
    });
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/send/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ secret, account, ...payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new ProviderError(
      timedOut ? 'WhatsApp provider did not respond in time.' : 'Could not reach the WhatsApp provider.',
      { details: err.message }
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ProviderError(`WhatsApp provider returned HTTP ${response.status}: ${describeResponse(data)}`, {
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  if (!data || Number(data.status) !== 200) {
    throw new ProviderError(`WhatsApp provider rejected the message: ${describeResponse(data)}`, {
      retryable: false,
      details: data,
    });
  }

  const id = data.data?.messageId ?? data.data?.id ?? data.messageId ?? '';
  return { messageId: String(id || '') };
}

/** @param {string} recipient digits with country code, no "+" */
function sendText(recipient, message) {
  return post({ recipient, type: 'text', message });
}

/** @param {string} mediaUrl must be downloadable by DXing over the internet */
function sendImage(recipient, mediaUrl, caption) {
  return post({ recipient, type: 'media', message: caption, media_url: mediaUrl, media_type: 'image' });
}

module.exports = { sendText, sendImage, ProviderError, mockOutbox };
