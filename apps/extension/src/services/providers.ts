import {
  createDemoProviders,
  gatewayIdentifyImage,
  GatewaySearchProvider,
  parseDemoFixture,
  type DemoFixture,
  type Market,
  type ProductIdentity,
  type ResearchProviders,
} from '@productradar/core';
import { BraveSearchProvider } from '@productradar/core/providers/brave';
import { TavilySearchProvider } from '@productradar/core/providers/tavily';
import fixtureJson from '../../../../fixtures/explicitly-demo-data.json';
import { ExtensionPageFetcher } from './fetcher';
import { getInstallId, serviceStatus, type Secrets, type Settings } from './settings';

let demoFixture: DemoFixture | undefined;
export function getDemoFixture(): DemoFixture {
  demoFixture ??= parseDemoFixture(fixtureJson);
  return demoFixture;
}

export class NotConfiguredError extends Error {}

export async function createResearchProviders(settings: Settings, secrets: Secrets, demo: boolean): Promise<ResearchProviders> {
  if (demo) return createDemoProviders(getDemoFixture(), 380);
  const status = serviceStatus(settings, secrets);
  if (status.kind === 'unconfigured') throw new NotConfiguredError(status.reason);
  // En modo asistido la app no llama a esta función: las fichas las agrega el usuario.
  if (status.kind === 'assisted') throw new NotConfiguredError('La investigación asistida no usa un buscador automático: agrega fichas desde las tiendas.');
  const fetcher = new ExtensionPageFetcher();
  if (status.kind === 'gateway') {
    return {
      search: new GatewaySearchProvider({ baseUrl: status.url, accessCode: secrets.accessCode, installId: await getInstallId() }),
      fetcher,
    };
  }
  const search =
    status.search === 'tavily'
      ? new TavilySearchProvider({ apiKey: secrets.tavilyApiKey ?? '' })
      : new BraveSearchProvider({ apiKey: secrets.braveApiKey ?? '' });
  return { search, fetcher };
}

/** Proveedor de visión disponible; null en modo asistido o sin clave de Anthropic. */
export function visionProviderLabel(settings: Settings, secrets: Secrets): string | null {
  const status = serviceStatus(settings, secrets);
  if (status.kind === 'gateway') return 'el servicio de ProductRadar (Anthropic Claude)';
  if (status.kind === 'byok' && status.hasVision) return 'Anthropic (Claude) con tu clave';
  return null;
}

/** Identifica un producto en una foto con el proveedor configurado. */
export async function identifyPhoto(
  settings: Settings,
  secrets: Secrets,
  image: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' },
  market: Market,
  signal?: AbortSignal,
): Promise<ProductIdentity> {
  const { visionResultToIdentity, identifyWithClaude } = await import('@productradar/core/providers/anthropic-vision');
  const status = serviceStatus(settings, secrets);
  if (status.kind === 'gateway') {
    const { result } = await gatewayIdentifyImage(
      { baseUrl: status.url, accessCode: secrets.accessCode, installId: await getInstallId(), timeoutMs: 100_000 },
      { imageBase64: image.base64, mimeType: image.mimeType, market },
      signal,
    );
    return visionResultToIdentity(result);
  }
  if (status.kind === 'byok' && secrets.anthropicApiKey) {
    const { result } = await identifyWithClaude(
      { apiKey: secrets.anthropicApiKey, model: settings.visionModel, dangerouslyAllowBrowser: true },
      { imageBase64: image.base64, mimeType: image.mimeType },
      signal,
    );
    return visionResultToIdentity(result);
  }
  throw new NotConfiguredError('La identificación por foto requiere un proveedor de visión configurado.');
}
