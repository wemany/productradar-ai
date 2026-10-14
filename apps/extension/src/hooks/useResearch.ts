import { emptyFinancialInputs, getMarketConfig, originPattern, runResearch, type Market, type ProductIdentity, type ResearchReport } from '@productradar/core';
import { useCallback, useRef, useState } from 'react';
import { saveReport } from '../services/history';
import { missingOrigins, originsFor } from '../services/permissions';
import { createResearchProviders, getDemoFixture } from '../services/providers';
import type { Secrets, Settings } from '../services/settings';

export interface PermissionPrompt {
  origins: string[];
  resolve: (granted: boolean) => void;
}

export interface StartOptions {
  product: ProductIdentity;
  country: Market;
  settings: Settings;
  secrets: Secrets;
  demo: boolean;
}

/**
 * Ejecuta la investigación con resultados parciales en vivo. Antes de leer
 * páginas de competidores pide (una sola vez) permiso para esos sitios; el
 * usuario puede negarlo y seguir solo con datos del buscador.
 */
export function useResearch() {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [running, setRunning] = useState(false);
  const [prompt, setPrompt] = useState<PermissionPrompt | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const promptRef = useRef<PermissionPrompt | null>(null);

  const start = useCallback(async ({ product, country, settings, secrets, demo }: StartOptions): Promise<ResearchReport> => {
    const providers = await createResearchProviders(settings, secrets, demo);
    const controller = new AbortController();
    controllerRef.current = controller;
    setReport(null);
    setRunning(true);
    try {
      const final = await runResearch({
        product,
        country,
        providers,
        signal: controller.signal,
        isDemo: demo,
        maxQueries: settings.maxQueries,
        maxPagesToVerify: settings.maxPagesToVerify,
        financials: demo ? getDemoFixture().financials : emptyFinancialInputs(getMarketConfig(country).currency),
        requestVerification: demo
          ? undefined
          : async (urls) => {
              const origins = originsFor(urls);
              const missing = await missingOrigins(origins);
              if (missing.length === 0) return () => true;
              const granted = await new Promise<boolean>((resolve) => {
                const p = { origins: missing, resolve };
                promptRef.current = p;
                setPrompt(p);
              });
              promptRef.current = null;
              setPrompt(null);
              if (granted) return () => true;
              const allowed = new Set(origins.filter((o) => !missing.includes(o)));
              return (url) => allowed.has(originPattern(url) ?? '');
            },
        onUpdate: setReport,
      });
      setReport(final);
      await saveReport(final);
      return final;
    } finally {
      setRunning(false);
      controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    promptRef.current?.resolve(false);
  }, []);

  return { report, running, prompt, start, cancel };
}
