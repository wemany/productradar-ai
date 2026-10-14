import { IdentifyImageResponseSchema, type VisionResult } from '@productradar/core';
import { describe, expect, it, vi } from 'vitest';
import { usageKey } from '../src/security/quota';
import { call, fakeImageBase64, fakeKv, fetchedHosts, jsonReply, makeEnv, mockFetch } from './helpers';

const VISION_RESULT: VisionResult = {
  genericName: 'Audífonos inalámbricos de diadema',
  englishName: 'wireless over-ear headphones',
  brand: null,
  model: null,
  attributes: [{ name: 'color', value: 'negro' }],
  searchKeywords: ['audífonos inalámbricos'],
  uncertainties: ['Marca no visible'],
  confidence: 0.82,
  alternatives: [],
  isProduct: true,
};

function anthropicReply(result: unknown, extra: Record<string, unknown> = {}) {
  return jsonReply(
    {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(result) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      ...extra,
    },
    200,
    { 'request-id': 'req_test' },
  );
}

function anthropicError(status: number, type: string) {
  return jsonReply({ type: 'error', error: { type, message: 'detalle interno de upstream sk-ant-xxx' } }, status, { 'x-should-retry': 'false' });
}

const validBody = () => ({ imageBase64: fakeImageBase64('jpeg'), mimeType: 'image/jpeg', market: 'CO' });

describe('POST /v1/identify-image', () => {
  it('503 NOT_CONFIGURED sin ANTHROPIC_API_KEY (sin llamar a nadie)', async () => {
    const fetchMock = mockFetch(() => anthropicReply(VISION_RESULT));
    const { status, json } = await call('/v1/identify-image', { body: validBody(), env: makeEnv({ ANTHROPIC_API_KEY: undefined }) });
    expect(status).toBe(503);
    expect(json.error?.code).toBe('NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 con tipo MIME no admitido, base64 inválido o firma que no coincide', async () => {
    const fetchMock = mockFetch(() => anthropicReply(VISION_RESULT));
    const cases = [
      { ...validBody(), mimeType: 'image/gif' },
      { ...validBody(), imageBase64: `${'A'.repeat(120)}!$` },
      { ...validBody(), imageBase64: 'QUFB' },
      { ...validBody(), imageBase64: `${fakeImageBase64('jpeg').slice(0, 40)}==${'A'.repeat(80)}` },
      { ...validBody(), mimeType: 'image/png' },
      { ...validBody(), imageBase64: btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.repeat(3)) },
    ];
    for (const body of cases) {
      const { status, json } = await call('/v1/identify-image', { body });
      expect(status).toBe(400);
      expect(json.error?.code).toBe('BAD_REQUEST');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('devuelve { result, model } validado y solo llama a api.anthropic.com', async () => {
    const fetchMock = mockFetch(() => anthropicReply(VISION_RESULT));
    const { status, json, response } = await call('/v1/identify-image', { body: validBody() });
    expect(status).toBe(200);
    expect(IdentifyImageResponseSchema.parse(json)).toEqual({ result: VISION_RESULT, model: 'claude-opus-5-5' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchedHosts(fetchMock)).toEqual(['api.anthropic.com']);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('x-api-key')).toBe('test-anthropic-key');
    const sent = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: Array<{ source?: { data: string } }> }> };
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.messages[0]?.content[0]?.source?.data).toBe(validBody().imageBase64);
  });

  it('usa VISION_MODEL si está definido', async () => {
    const fetchMock = mockFetch(() => anthropicReply(VISION_RESULT));
    await call('/v1/identify-image', { body: validBody(), env: makeEnv({ VISION_MODEL: 'claude-otro-modelo' }) });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).model).toBe('claude-otro-modelo');
  });

  it('mapea errores del proveedor sin revelar detalles de la clave', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cases: Array<[Response, number, string]> = [
      [anthropicError(401, 'authentication_error'), 503, 'NOT_CONFIGURED'],
      [anthropicError(429, 'rate_limit_error'), 429, 'RATE_LIMITED'],
      [anthropicError(400, 'invalid_request_error'), 400, 'BAD_REQUEST'],
      [anthropicReply({ ...VISION_RESULT, isProduct: false }), 422, 'NOT_A_PRODUCT'],
      [anthropicReply(VISION_RESULT, { stop_reason: 'refusal' }), 422, 'REFUSED'],
      [anthropicReply({ nada: true }), 502, 'BAD_OUTPUT'],
    ];
    for (const [reply, expectedStatus, expectedCode] of cases) {
      mockFetch(() => reply.clone());
      const { status, json } = await call('/v1/identify-image', { body: validBody() });
      expect([status, json.error?.code]).toEqual([expectedStatus, expectedCode]);
      expect(JSON.stringify(json)).not.toMatch(/sk-ant|x-api-key|detalle interno/);
    }
  });

  it('respeta el presupuesto diario de visión y cuenta cada intento', async () => {
    const kv = fakeKv({ [usageKey('vision')]: '2' });
    const env = makeEnv({ USAGE_KV: kv, DAILY_VISION_LIMIT: '3' });
    const fetchMock = mockFetch(() => anthropicReply(VISION_RESULT));
    expect((await call('/v1/identify-image', { body: validBody(), env })).status).toBe(200);
    expect(kv.store.get(usageKey('vision'))).toBe('3');
    const { status, json, response } = await call('/v1/identify-image', { body: validBody(), env });
    expect(status).toBe(429);
    expect(json.error?.code).toBe('QUOTA_EXCEEDED');
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
