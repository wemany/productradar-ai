import type { Market } from './schemas';

export interface MarketConfig {
  code: Market;
  /** Nombre del país en español, usado en consultas y en la interfaz. */
  name: string;
  currency: string;
  /** Decimales habituales en precios de consumo. */
  currencyDecimals: number;
  locale: string;
  searchLang: string;
  /**
   * Código de país para Brave Search. Brave no admite todos los países
   * (en la documentación consultada no aparecen CO ni PE); en ese caso se usa
   * `ALL` y la regionalización depende de los términos de la consulta y del
   * filtrado posterior. Esto se reporta como limitación de cobertura.
   */
  braveCountry: string;
  braveUiLang?: string;
  /** Sufijos de dominio que sugieren comercio local (no lo garantizan). */
  localTlds: string[];
  /** Comercios conocidos del país: dominio registrable → nombre visible. */
  knownRetailers: Record<string, string>;
}

export const MARKET_CONFIGS: Record<Market, MarketConfig> = {
  CO: {
    code: 'CO',
    name: 'Colombia',
    currency: 'COP',
    currencyDecimals: 0,
    locale: 'es-CO',
    searchLang: 'es',
    braveCountry: 'ALL',
    localTlds: ['.com.co', '.co'],
    knownRetailers: {
      'mercadolibre.com.co': 'Mercado Libre Colombia',
      'falabella.com.co': 'Falabella Colombia',
      'exito.com': 'Éxito',
      'alkosto.com': 'Alkosto',
      'ktronix.com': 'Ktronix',
      'alkomprar.com': 'Alkomprar',
      'homecenter.com.co': 'Homecenter',
      'olimpica.com': 'Olímpica',
      'tiendasjumbo.co': 'Jumbo',
      'carulla.com': 'Carulla',
      'panamericana.com.co': 'Panamericana',
      'dafiti.com.co': 'Dafiti Colombia',
      'pepeganga.com': 'Pepe Ganga',
      'mac-center.com': 'Mac Center',
      'linio.com.co': 'Linio Colombia',
      'colsubsidio.com': 'Colsubsidio',
      'larebajavirtual.com': 'La Rebaja',
      'cruzverde.com.co': 'Cruz Verde',
      'locatelcolombia.com': 'Locatel',
      'decathlon.com.co': 'Decathlon Colombia',
    },
  },
  MX: {
    code: 'MX',
    name: 'México',
    currency: 'MXN',
    currencyDecimals: 2,
    locale: 'es-MX',
    searchLang: 'es',
    braveCountry: 'MX',
    braveUiLang: 'es-MX',
    localTlds: ['.com.mx', '.mx'],
    knownRetailers: {
      'mercadolibre.com.mx': 'Mercado Libre México',
      'amazon.com.mx': 'Amazon México',
      'liverpool.com.mx': 'Liverpool',
      'coppel.com': 'Coppel',
      'walmart.com.mx': 'Walmart México',
      'elektra.com.mx': 'Elektra',
      'sears.com.mx': 'Sears México',
      'sanborns.com.mx': 'Sanborns',
      'elpalaciodehierro.com': 'El Palacio de Hierro',
      'bodegaaurrera.com.mx': 'Bodega Aurrera',
    },
  },
  PE: {
    code: 'PE',
    name: 'Perú',
    currency: 'PEN',
    currencyDecimals: 2,
    locale: 'es-PE',
    searchLang: 'es',
    braveCountry: 'ALL',
    localTlds: ['.com.pe', '.pe'],
    knownRetailers: {
      'mercadolibre.com.pe': 'Mercado Libre Perú',
      'falabella.com.pe': 'Falabella Perú',
      'ripley.com.pe': 'Ripley Perú',
      'plazavea.com.pe': 'Plaza Vea',
      'oechsle.pe': 'Oechsle',
      'promart.pe': 'Promart',
      'hiraoka.com.pe': 'Hiraoka',
      'coolbox.pe': 'Coolbox',
    },
  },
  CL: {
    code: 'CL',
    name: 'Chile',
    currency: 'CLP',
    currencyDecimals: 0,
    locale: 'es-CL',
    searchLang: 'es',
    braveCountry: 'CL',
    braveUiLang: 'es-CL',
    localTlds: ['.cl'],
    knownRetailers: {
      'mercadolibre.cl': 'Mercado Libre Chile',
      'falabella.com': 'Falabella Chile',
      'paris.cl': 'Paris',
      'ripley.cl': 'Ripley Chile',
      'lider.cl': 'Líder',
      'pcfactory.cl': 'PC Factory',
      'sodimac.cl': 'Sodimac Chile',
      'hites.com': 'Hites',
      'abcdin.cl': 'Abcdin',
    },
  },
};

/** Marketplaces internacionales: pueden despachar al país, pero no son comercio local. */
export const INTERNATIONAL_MARKETPLACES: Record<string, string> = {
  'amazon.com': 'Amazon (EE. UU.)',
  'ebay.com': 'eBay',
  'aliexpress.com': 'AliExpress',
  'aliexpress.us': 'AliExpress',
  'temu.com': 'Temu',
  'shein.com': 'Shein',
  'walmart.com': 'Walmart (EE. UU.)',
  'bestbuy.com': 'Best Buy (EE. UU.)',
  'newegg.com': 'Newegg',
  'wish.com': 'Wish',
  'banggood.com': 'Banggood',
  'dhgate.com': 'DHgate',
};

export function getMarketConfig(code: Market): MarketConfig {
  return MARKET_CONFIGS[code];
}

export const SUPPORTED_MARKETS = Object.values(MARKET_CONFIGS);
