import type { Availability, IdentifiedBy, MarketFit, ModuleStatus, Verification } from '@productradar/core';

/**
 * Textos de interfaz en español. Centralizados para facilitar otros idiomas
 * en el futuro (los mensajes de dominio viven en @productradar/core).
 */
export const es = {
  app: {
    name: 'ProductRadar AI',
    tagline: 'Investigador de productos',
  },
  nav: {
    history: 'Mis investigaciones',
    settings: 'Configuración',
    back: 'Volver',
    newResearch: 'Nueva investigación',
  },
  home: {
    market: 'País para vender',
    tabs: { page: 'Esta página', url: 'Pegar URL', photo: 'Subir foto' },
    analyze: 'Analizar producto',
    demo: 'Abrir demostración (datos ficticios)',
  },
  confirm: {
    eyebrow: 'Confirma que encontramos el producto correcto',
    search: (country: string) => `Buscar competencia en ${country}`,
  },
  identifiedBy: {
    PAGE_STRUCTURED_DATA: 'Datos estructurados de la página',
    PAGE_METADATA: 'Metadatos de la página',
    URL_SLUG: 'Deducido de la dirección web',
    VISION_AI: 'Propuesto por IA a partir de la foto',
    USER_INPUT: 'Ingresado por ti',
    DEMO_FIXTURE: 'Demostración (ficticio)',
  } satisfies Record<IdentifiedBy, string>,
  verification: {
    PAGE_VERIFIED: 'Verificado en ficha',
    SEARCH_SNIPPET_ONLY: 'Visible solo en buscador',
    UNAVAILABLE: 'No disponible',
  } satisfies Record<Verification, string>,
  availability: {
    IN_STOCK: 'Disponible',
    OUT_OF_STOCK: 'Agotado',
    UNKNOWN: 'Disponibilidad desconocida',
  } satisfies Record<Availability, string>,
  marketFit: {
    LOCAL: 'Comercio local',
    LIKELY_LOCAL: 'Probablemente local',
    UNKNOWN: 'Origen sin confirmar',
    FOREIGN: 'Vendedor internacional',
  } satisfies Record<MarketFit, string>,
  moduleStatus: {
    PENDING: 'Pendiente',
    RUNNING: 'En curso',
    OK: 'Listo',
    PARTIAL: 'Parcial',
    FAILED: 'Falló',
    SKIPPED: 'Omitido',
  } satisfies Record<ModuleStatus, string>,
  demo: {
    banner: 'DATOS DE DEMOSTRACIÓN',
    detail: 'Ficticios · no son búsquedas reales',
  },
};
