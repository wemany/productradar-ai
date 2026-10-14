import type { PageSnapshot } from '@productradar/core';

/**
 * Entrada pendiente que el service worker deja para el panel (menú contextual
 * o atajo de teclado). Vive en storage.session: se borra al cerrar Chrome y
 * solo es accesible desde contextos de la extensión.
 */
export type PendingInput =
  | { kind: 'snapshot'; snapshot: PageSnapshot }
  /** Ficha que el usuario quiere agregar a la investigación asistida abierta. */
  | { kind: 'addOffer'; snapshot: PageSnapshot }
  | { kind: 'url'; url: string }
  | { kind: 'imageUrl'; url: string; pageUrl?: string }
  | { kind: 'error'; message: string };

const KEY = 'pending:input';

export async function setPendingInput(input: PendingInput): Promise<void> {
  await browser.storage.session.set({ [KEY]: { ...input, at: Date.now() } });
}

export async function takePendingInput(): Promise<PendingInput | null> {
  const data = await browser.storage.session.get(KEY);
  const value = data[KEY] as (PendingInput & { at: number }) | undefined;
  if (!value) return null;
  await browser.storage.session.remove(KEY);
  // Ignorar entradas viejas (más de 2 minutos).
  if (Date.now() - value.at > 120_000) return null;
  return value;
}

export function onPendingInput(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'session' && KEY in changes) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
