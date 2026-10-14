import { createReport } from '@productradar/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearHistory, deleteReport, listHistory, loadReport, MAX_REPORTS, saveReport } from '../src/services/history';

const product = { name: 'Licuadora Oster 600W', attributes: {}, searchQueries: [], uncertainties: [], identifiedBy: 'USER_INPUT' as const };
const report = (id: string, isDemo = false) => ({ ...createReport({ product, country: 'CO', isDemo, searchProvider: 'prueba', id }), status: 'COMPLETE' as const });

describe('historial local', () => {
  beforeEach(() => fakeBrowser.reset());

  it('guarda, lista y recupera reportes validados', async () => {
    await saveReport(report('a'));
    await saveReport(report('b', true));
    const list = await listHistory();
    expect(list.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(list.find((e) => e.id === 'b')?.isDemo).toBe(true);
    expect((await loadReport('a'))?.product.name).toBe('Licuadora Oster 600W');
  });

  it('actualizar un reporte no lo duplica', async () => {
    await saveReport(report('a'));
    await saveReport({ ...report('a'), verdict: 'CAUTION' });
    const list = await listHistory();
    expect(list).toHaveLength(1);
    expect(list[0]?.verdict).toBe('CAUTION');
  });

  it(`conserva como máximo ${MAX_REPORTS} reportes`, async () => {
    for (let i = 0; i < MAX_REPORTS + 3; i += 1) await saveReport(report(`r${i}`));
    expect(await listHistory()).toHaveLength(MAX_REPORTS);
    expect(await loadReport('r0')).toBeNull();
  });

  it('se puede borrar uno o todo el historial', async () => {
    await saveReport(report('a'));
    await saveReport(report('b'));
    await deleteReport('a');
    expect((await listHistory()).map((e) => e.id)).toEqual(['b']);
    await clearHistory();
    expect(await listHistory()).toEqual([]);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('ignora datos corruptos', async () => {
    await fakeBrowser.storage.local.set({ 'report:x': { basura: true } });
    expect(await loadReport('x')).toBeNull();
  });
});
