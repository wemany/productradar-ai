import { getMarketConfig, identityFromSnapshot, type Market, type ProductIdentity, type ResearchReport } from '@productradar/core';
import { Clock, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DemoBanner } from './components/DemoBanner';
import { RadarMark } from './components/RadarMark';
import { IconButton, Spinner } from './components/ui';
import { useResearch } from './hooks/useResearch';
import { useSettings } from './hooks/useSettings';
import { es } from './i18n/es';
import { ConfirmScreen } from './screens/ConfirmScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HomeScreen, type HomeTab } from './screens/HomeScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { ReportScreen } from './screens/ReportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { loadReport, saveReport } from './services/history';
import { onPendingInput, takePendingInput, type PendingInput } from './services/pending-input';
import { getDemoFixture, NotConfiguredError } from './services/providers';

type View =
  | { name: 'home'; notice?: string; tab?: HomeTab; url?: string; imageUrl?: string }
  | { name: 'confirm'; draft: ProductIdentity; demo: boolean }
  | { name: 'progress'; productName: string; demo: boolean }
  | { name: 'report'; report: ResearchReport }
  | { name: 'settings' }
  | { name: 'history' };

export function App() {
  const settingsState = useSettings();
  const research = useResearch();
  const [view, setView] = useState<View>({ name: 'home' });
  const [market, setMarket] = useState<Market>('CO');
  const mainRef = useRef<HTMLElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (settingsState.loaded) setMarket(settingsState.settings.market);
  }, [settingsState.loaded, settingsState.settings.market]);

  const go = useCallback((next: View) => {
    setView(next);
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, []);

  // Entradas que deja el service worker (menú contextual / atajo de teclado).
  const handlePending = useCallback(
    (input: PendingInput) => {
      const currency = getMarketConfig(market).currency;
      if (input.kind === 'snapshot') go({ name: 'confirm', draft: identityFromSnapshot(input.snapshot, currency), demo: false });
      else if (input.kind === 'url') go({ name: 'home', tab: 'url', url: input.url });
      else if (input.kind === 'imageUrl') go({ name: 'home', tab: 'photo', imageUrl: input.url });
      else go({ name: 'home', notice: input.message });
    },
    [go, market],
  );
  useEffect(() => {
    const check = () => void takePendingInput().then((p) => p && !research.running && handlePending(p));
    check();
    return onPendingInput(check);
  }, [handlePending, research.running]);

  const changeMarket = (m: Market) => {
    setMarket(m);
    void settingsState.updateSettings({ market: m });
  };

  const openDemo = () => go({ name: 'confirm', draft: getDemoFixture().product, demo: true });

  const startResearch = async (identity: ProductIdentity, m: Market, demo: boolean) => {
    go({ name: 'progress', productName: identity.name, demo });
    try {
      const final = await research.start({ product: identity, country: m, settings: settingsState.settings, secrets: settingsState.secrets, demo });
      go({ name: 'report', report: final });
    } catch (e) {
      const message = e instanceof NotConfiguredError ? e.message : `No fue posible completar la investigación: ${e instanceof Error ? e.message : 'error desconocido'}`;
      go({ name: 'home', notice: message });
    }
  };

  const updateReport = (report: ResearchReport) => {
    setView({ name: 'report', report });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveReport(report), 400);
  };

  const openReport = async (id: string) => {
    const report = await loadReport(id);
    if (report) go({ name: 'report', report });
    else go({ name: 'home', notice: 'No se pudo abrir ese reporte (puede estar dañado o haber sido borrado).' });
  };

  const demoActive =
    (view.name === 'confirm' && view.demo) || (view.name === 'progress' && view.demo) || (view.name === 'report' && view.report.isDemo);

  return (
    <div className="min-h-screen">
      {demoActive && <DemoBanner />}
      <header className="flex items-center justify-between gap-2 border-b border-line bg-paper/90 px-4 py-2.5 backdrop-blur">
        <button type="button" className="flex items-center gap-2.5 rounded-lg text-left" onClick={() => !research.running && go({ name: 'home' })} aria-label="Ir al inicio">
          <RadarMark size={30} scanning={research.running} />
          <span>
            <span className="block text-[14px] leading-tight font-semibold tracking-[-0.01em] text-ink">{es.app.name}</span>
            <span className="block text-[11px] leading-tight text-muted">{es.app.tagline}</span>
          </span>
        </button>
        <nav className="flex items-center gap-0.5" aria-label="Navegación">
          <IconButton label={es.nav.history} disabled={research.running} onClick={() => go({ name: 'history' })}>
            <Clock className="size-[18px]" />
          </IconButton>
          <IconButton label={es.nav.settings} disabled={research.running} onClick={() => go({ name: 'settings' })}>
            <Settings2 className="size-[18px]" />
          </IconButton>
        </nav>
      </header>

      <main ref={mainRef} className="mx-auto max-w-[560px] px-4 pt-4 pb-10">
        {!settingsState.loaded ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6" />
          </div>
        ) : view.name === 'home' ? (
          <HomeScreen
            market={market}
            onMarketChange={changeMarket}
            status={settingsState.status}
            settings={settingsState.settings}
            secrets={settingsState.secrets}
            notice={view.notice}
            initialTab={view.tab}
            initialUrl={view.url}
            initialImageUrl={view.imageUrl}
            onIdentity={(draft) => go({ name: 'confirm', draft, demo: false })}
            onOpenDemo={openDemo}
            onOpenSettings={() => go({ name: 'settings' })}
            onOpenHistory={() => go({ name: 'history' })}
            onOpenReport={(id) => void openReport(id)}
            onPhotoConsent={() => void settingsState.updateSettings({ photoConsent: true })}
          />
        ) : view.name === 'confirm' ? (
          <ConfirmScreen
            key={view.draft.name + view.draft.identifiedBy}
            draft={view.draft}
            demo={view.demo}
            market={view.demo ? 'CO' : market}
            maxQueries={settingsState.settings.maxQueries}
            status={settingsState.status}
            onMarketChange={changeMarket}
            onBack={() => go({ name: 'home' })}
            onSubmit={(identity, m) => void startResearch(identity, m, view.demo)}
            onOpenSettings={() => go({ name: 'settings' })}
            onOpenDemo={openDemo}
          />
        ) : view.name === 'progress' ? (
          <ProgressScreen productName={view.productName} report={research.report} prompt={research.prompt} onCancel={research.cancel} />
        ) : view.name === 'report' ? (
          <ReportScreen
            report={view.report}
            onChange={updateReport}
            onNew={() => go({ name: 'home' })}
            onBack={() => go({ name: 'home' })}
            onOpenSettings={() => go({ name: 'settings' })}
          />
        ) : view.name === 'settings' ? (
          <SettingsScreen state={settingsState} onBack={() => go({ name: 'home' })} onOpenDemo={openDemo} />
        ) : (
          <HistoryScreen onBack={() => go({ name: 'home' })} onOpen={(id) => void openReport(id)} />
        )}
      </main>
    </div>
  );
}
