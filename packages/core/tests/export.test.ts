import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../fixtures/explicitly-demo-data.json';
import { createDemoProviders, parseDemoFixture } from '../src/demo';
import { csvCell, DEMO_LABEL, offersToCsv, renderPrintableReport, reportToJson } from '../src/export';
import { migrateReport } from '../src/report';
import { runResearch } from '../src/research';
import { makeOffer } from './helpers';

const fixture = parseDemoFixture(fixtureJson);

async function demoReport() {
  return runResearch({ product: fixture.product, country: 'CO', providers: createDemoProviders(fixture), isDemo: true, financials: fixture.financials });
}

describe('csvCell', () => {
  it('escapa comillas, comas y saltos de línea', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });

  it('neutraliza fórmulas de hoja de cálculo', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('exportaciones', () => {
  it('CSV con BOM, cabecera y aviso de demo', async () => {
    const report = await demoReport();
    const csv = offersToCsv(report);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(DEMO_LABEL);
    expect(csv).toContain('vendedor,dominio,titulo,url');
    expect(csv.split('\r\n').filter(Boolean).length).toBe(report.offers.length + 2);
  });

  it('JSON reimportable y con advertencia', async () => {
    const report = await demoReport();
    const json = JSON.parse(reportToJson(report));
    expect(json.demo).toBe(DEMO_LABEL);
    expect(json.disclaimer).toMatch(/No garantiza ventas/);
    expect(migrateReport(json.report)?.id).toBe(report.id);
  });

  it('HTML imprimible escapa contenido externo y bloquea enlaces peligrosos', async () => {
    const report = await demoReport();
    const malicious = makeOffer({
      amount: 1,
      title: '<img src=x onerror=alert(1)>',
      url: 'javascript:alert(1)',
      seller: '<script>alert(2)</script>',
    });
    const html = renderPrintableReport({ ...report, offers: [...report.offers, malicious] });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain(DEMO_LABEL);
    expect(html).toContain('no verificable');
    expect(html).toContain('Tiendas encontradas en la muestra');
  });
});

describe('migrateReport', () => {
  it('rechaza datos corruptos', () => {
    expect(migrateReport(null)).toBeNull();
    expect(migrateReport({ id: 1 })).toBeNull();
  });

  it('migra un reporte v0 sin schemaVersion', async () => {
    const report = await demoReport();
    const { schemaVersion: _omit, discarded: _d, notes: _n, ...v0 } = report;
    expect(migrateReport(v0)?.schemaVersion).toBe(1);
  });
});
