import { compareHardAttributes, extractHardAttributes } from './attributes';
import type { MatchType, ProductIdentity } from './schemas';
import { alphanumericKey, normalizeText, significantTokens } from './text';

export interface MatchCandidate {
  title: string;
  /** Texto adicional (fragmento, descripción) con menos peso que el título. */
  text?: string;
  brand?: string;
  gtin?: string;
  sku?: string;
  mpn?: string;
}

export interface MatchResult {
  matchType: MatchType;
  /** 0–1: cobertura de los términos de la identidad en la oferta. */
  score: number;
  reasons: string[];
  conflicts: string[];
}

/** Normaliza GTIN-8/12/13/14 a 14 dígitos para compararlos entre sí. */
export function normalizeGtin(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return undefined;
  return digits.padStart(14, '0');
}

/** Texto de la identidad usado para extraer atributos (nombre + atributos confirmados). */
export function identityText(identity: ProductIdentity): string {
  const attrs = Object.entries(identity.attributes)
    .map(([k, v]) => `${k} ${v}`)
    .join(' ');
  return [identity.name, identity.brand, identity.model, attrs].filter(Boolean).join(' ');
}

/**
 * Quita el modelo confirmado del texto antes de extraer atributos: nombres
 * como "Aura X2" o "Galaxy S23" no deben leerse como "paquete x2" o medidas.
 */
export function stripModel(text: string, model: string | undefined): string {
  if (!model || model.trim().length < 2) return text;
  const parts = model
    .trim()
    .split(/[\s\-_/]+/)
    .filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!parts.length) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s\\-_/]*')}(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(re, ' ');
}

/** Une número y unidad ("128 GB" → "128GB") para que la cobertura no dependa del espaciado. */
function joinUnits(text: string): string {
  return text.replace(/(\d)\s+(gb|tb|ml|lts?|l|cc|gr?|kg|lbs?|oz|w|mah|cm|mm)\b/gi, '$1$2');
}

/** ¿Aparece la frase como secuencia de palabras completas? */
function containsPhrase(haystackNormalized: string, phrase: string): boolean {
  const needle = normalizeText(phrase);
  if (!needle) return false;
  return ` ${haystackNormalized} `.includes(` ${needle} `);
}

/** Marca: palabra completa; o subcadena si es larga (≥5) para tolerar "SonyWH…". */
function mentionsBrand(candidateNormalized: string, candidateKey: string, brand: string): boolean {
  if (containsPhrase(candidateNormalized, brand)) return true;
  const key = alphanumericKey(brand);
  return key.length >= 5 && candidateKey.includes(key);
}

/** Modelo: frase completa, o código alfanumérico con dígitos (WH-1000XM5 ≈ wh1000xm5). */
function mentionsModel(candidateNormalized: string, candidateKey: string, model: string): boolean {
  if (containsPhrase(candidateNormalized, model)) return true;
  const key = alphanumericKey(model);
  return key.length >= 4 && /\d/.test(key) && /[a-z]/.test(key) && candidateKey.includes(key);
}

const UNIT_WORD = /^(gb|tb|mb|ml|l|lt|lts|litro|litros|cc|g|gr|grs|gramo|gramos|kg|kilo|kilos|lb|lbs|oz|w|watts|mah|cm|mm|m|pulgadas|pulg|in|unidades|unidad|und|unds|uds|piezas|pzs|pcs|x)$/;
const MEASURE_TOKEN = /^\d+(gb|tb|mb|ml|l|lt|cc|g|gr|kg|lb|oz|w|mah|cm|mm|m|pulgadas|in|und|uds|pcs|x)$/;
/** Niveles de producto: "Pro", "Max"… cambian el producto aunque el resto del nombre coincida. */
const TIER_WORDS = new Set(['pro', 'max', 'plus', 'ultra', 'mini', 'lite']);

/**
 * Tokens con dígitos que identifican modelo o versión (A54, 15, «etapa 3»).
 * Excluye medidas (se comparan aparte), años y códigos largos (SKU/EAN).
 */
export function identifierTokens(text: string): string[] {
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  tokens.forEach((t, i) => {
    if (!/\d/.test(t) || MEASURE_TOKEN.test(t)) return;
    if (/^\d+$/.test(t) && (UNIT_WORD.test(tokens[i + 1] ?? '') || t.length >= 5 || /^(19|20)\d{2}$/.test(t))) return;
    out.add(t);
  });
  return [...out];
}

function tokensWithPairs(text: string): Set<string> {
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  const set = new Set(tokens);
  for (let i = 0; i < tokens.length - 1; i += 1) set.add(`${tokens[i]}${tokens[i + 1]}`);
  return set;
}

function tiersOf(raw: string): Set<string> {
  const tiers = new Set(normalizeText(raw).split(' ').filter((t) => TIER_WORDS.has(t)));
  if (/[a-z0-9]\+(?![+\d])/i.test(raw)) tiers.add('plus'); // "S24+"
  return tiers;
}

const COLOR_CANON: Record<string, string> = {
  negro: 'negro', negra: 'negro', black: 'negro',
  blanco: 'blanco', blanca: 'blanco', white: 'blanco',
  rojo: 'rojo', roja: 'rojo', red: 'rojo',
  azul: 'azul', blue: 'azul', celeste: 'celeste',
  verde: 'verde', green: 'verde',
  gris: 'gris', gray: 'gris', grey: 'gris', grafito: 'gris',
  rosado: 'rosado', rosada: 'rosado', rosa: 'rosado', pink: 'rosado', fucsia: 'fucsia',
  morado: 'morado', morada: 'morado', lila: 'morado', purple: 'morado',
  amarillo: 'amarillo', amarilla: 'amarillo', yellow: 'amarillo',
  naranja: 'naranja', orange: 'naranja',
  dorado: 'dorado', dorada: 'dorado', oro: 'dorado', gold: 'dorado',
  plateado: 'plateado', plateada: 'plateado', plata: 'plateado', silver: 'plateado',
  beige: 'beige', cafe: 'cafe', marron: 'cafe', vinotinto: 'vinotinto', turquesa: 'turquesa',
};
const NUMERIC_ATTRIBUTE_KEY = /capacidad|volumen|peso|contenido|unidades|paquete|pantalla|bateria|potencia|categoria/;

function colorsIn(text: string): string[] {
  return [...new Set(normalizeText(text).split(' ').map((t) => COLOR_CANON[t]).filter((c): c is string => Boolean(c)))];
}

/**
 * Compara los atributos que el usuario confirmó (color, talla, sabor…) con lo
 * que la oferta declara en su título. Solo hay conflicto si la oferta indica
 * OTRO valor; si no lo menciona, no se asume nada.
 */
export function attributeConflicts(identity: ProductIdentity, candidateTitle: string): string[] {
  const out: string[] = [];
  const cand = ` ${normalizeText(candidateTitle)} `;
  for (const [rawKey, rawValue] of Object.entries(identity.attributes)) {
    const key = normalizeText(rawKey);
    const value = normalizeText(rawValue);
    if (!key || !value || NUMERIC_ATTRIBUTE_KEY.test(key)) continue;
    if (/color|colour/.test(key)) {
      const wanted = colorsIn(value);
      const offered = colorsIn(candidateTitle);
      if (wanted.length && offered.length && !offered.some((c) => wanted.includes(c))) out.push(`${rawKey} distinto: ${offered.join('/')} frente a ${rawValue}`);
      continue;
    }
    const match = cand.match(new RegExp(` ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ([a-z0-9]+) `));
    const first = value.split(' ')[0];
    if (match?.[1] && first && match[1] !== first) out.push(`${rawKey} distinto: ${match[1]} frente a ${rawValue}`);
  }
  return out;
}

// Umbrales de cobertura de términos (documentados en docs/architecture.md).
export const MATCH_THRESHOLDS = {
  exactWithModel: 0.4,
  exactWithBrand: 0.8,
  exactNoBrand: 0.85,
  variant: 0.5,
  similar: 0.35,
} as const;

/**
 * Clasifica la relación entre la identidad confirmada y una oferta.
 *
 * Reglas deterministas, en orden:
 * 1. GTIN igual → EXACT (salvo usado/reacondicionado o presentación distinta → VARIANT).
 *    GTIN distinto → nunca EXACT.
 * 2. Accesorio/repuesto o genérico "compatible" frente a producto de marca → como máximo SIMILAR.
 * 3. Atributos duros distintos (capacidad, volumen, paquete…) o condición usada → como máximo VARIANT.
 * 4. Si la identidad tiene modelo, debe aparecer en la oferta para ser EXACT; si tiene marca, también.
 * 5. Cobertura de términos para el resto.
 */
export function classifyMatch(identity: ProductIdentity, candidate: MatchCandidate): MatchResult {
  const reasons: string[] = [];
  const titleAndBrand = [candidate.title, candidate.brand, candidate.mpn].filter(Boolean).join(' ');
  const titleNormalized = normalizeText(titleAndBrand);
  const titleKey = alphanumericKey(titleAndBrand);
  const textNormalized = normalizeText(candidate.text ?? '');
  const textKey = alphanumericKey(candidate.text ?? '');

  const idAttrs = extractHardAttributes(stripModel(identityText(identity), identity.model));
  // Atributos de la oferta: manda el título; el fragmento solo completa capacidad/volumen.
  const titleAttrs = extractHardAttributes(stripModel(titleAndBrand, identity.model));
  const textAttrs = candidate.text ? extractHardAttributes(stripModel(candidate.text, identity.model)) : undefined;
  const candAttrs = {
    ...titleAttrs,
    storageGb: titleAttrs.storageGb ?? textAttrs?.storageGb,
    volumeMl: titleAttrs.volumeMl ?? textAttrs?.volumeMl,
  };

  const conflicts = compareHardAttributes(idAttrs, candAttrs).map((c) => c.message);
  const conditionMismatch = (titleAttrs.isUsedOrRefurbished || Boolean(textAttrs?.isUsedOrRefurbished)) && !idAttrs.isUsedOrRefurbished;
  if (conditionMismatch) conflicts.push('Producto usado o reacondicionado');
  const isAccessory = titleAttrs.isAccessory && !idAttrs.isAccessory;
  const isGeneric = titleAttrs.isGenericOrCompatible && !idAttrs.isGenericOrCompatible && Boolean(identity.brand);
  const downgrade: string[] = [];
  if (isAccessory) downgrade.push('Parece un accesorio o repuesto, no el producto');
  if (isGeneric) downgrade.push('Parece genérico o “compatible”, no el original de marca');

  // Cobertura: tokens de la identidad presentes en el título (1) o solo en el fragmento (0,5).
  const idTokens = significantTokens(joinUnits([identity.name, identity.brand, identity.model].filter(Boolean).join(' ')));
  const titleTokens = new Set(normalizeText(joinUnits(titleAndBrand)).split(' '));
  const textTokens = new Set(normalizeText(joinUnits(candidate.text ?? '')).split(' '));
  const inSet = (token: string, set: Set<string>, key: string) => set.has(token) || (token.length >= 4 && key.includes(token));
  let covered = 0;
  for (const token of idTokens) {
    if (inSet(token, titleTokens, titleKey)) covered += 1;
    else if (inSet(token, textTokens, textKey)) covered += 0.5;
  }
  const coverage = idTokens.length ? covered / idTokens.length : 0;
  const score = Math.round(Math.min(1, coverage) * 100) / 100;

  const brandMatch = identity.brand ? mentionsBrand(`${titleNormalized} ${textNormalized}`, `${titleKey}${textKey}`, identity.brand) : false;
  const modelMatch = identity.model ? mentionsModel(titleNormalized, titleKey, identity.model) || mentionsModel(textNormalized, textKey, identity.model) : false;

  const idGtin = normalizeGtin(identity.gtin);
  const candGtin = normalizeGtin(candidate.gtin);
  const skuKey = identity.sku ? alphanumericKey(identity.sku) : '';
  const skuMatch =
    skuKey.length >= 4 &&
    [candidate.sku, candidate.mpn].some((v) => v !== undefined && alphanumericKey(v) === skuKey);

  if (identity.brand) reasons.push(brandMatch ? `Marca coincide (${identity.brand})` : `No menciona la marca ${identity.brand}`);
  if (identity.model) reasons.push(modelMatch ? `Mismo modelo (${identity.model})` : `No se encontró el modelo ${identity.model}`);
  reasons.push(`Coincidencia de términos: ${Math.round(coverage * 100)} %`);

  // Versión: identificadores con dígitos ausentes (A54 vs A34, «etapa 3» vs «etapa 4») y niveles (Pro, Max, Plus…).
  const versionConflicts: string[] = [];
  const brandTokens = new Set(normalizeText(identity.brand ?? '').split(' '));
  const idIdentifiers = identifierTokens([identity.name, identity.model].filter(Boolean).join(' ')).filter((t) => !brandTokens.has(t));
  const candTokens = tokensWithPairs(`${titleAndBrand} ${candidate.text ?? ''}`);
  const modelKeyFull = identity.model ? alphanumericKey(identity.model) : '';
  const missing = idIdentifiers.filter(
    (t) => !candTokens.has(t) && !(t.length >= 4 && `${titleKey}${textKey}`.includes(t)) && !(modelMatch && modelKeyFull.includes(t)),
  );
  if (missing.length) versionConflicts.push(`No menciona «${missing.join(', ')}»: posible otro modelo o versión`);
  const idTiers = tiersOf([identity.name, identity.model].filter(Boolean).join(' '));
  const candTiers = tiersOf(titleAndBrand);
  const extraTiers = [...candTiers].filter((t) => !idTiers.has(t));
  const lackingTiers = [...idTiers].filter((t) => !candTiers.has(t) && !tiersOf(candidate.text ?? '').has(t));
  if (extraTiers.length) versionConflicts.push(`Versión distinta: ${extraTiers.join(', ')}`);
  if (lackingTiers.length) versionConflicts.push(`No indica la versión ${lackingTiers.join(', ')}`);
  versionConflicts.push(...attributeConflicts(identity, titleAndBrand));

  const allConflicts = [...downgrade, ...conflicts, ...versionConflicts];

  // 1. Códigos de producto
  if (idGtin && candGtin) {
    if (idGtin === candGtin && downgrade.length === 0) {
      reasons.unshift('Mismo código GTIN/EAN');
      // El código manda: si el título omite el número de modelo no es un conflicto.
      const codeConflicts = [...downgrade, ...conflicts];
      return conflicts.length === 0
        ? { matchType: 'EXACT', score: 1, reasons, conflicts: codeConflicts }
        : { matchType: 'VARIANT', score: Math.max(score, 0.7), reasons, conflicts: codeConflicts };
    }
    if (idGtin !== candGtin) {
      reasons.unshift('Código GTIN/EAN distinto');
      if ((coverage >= MATCH_THRESHOLDS.variant || modelMatch) && downgrade.length === 0) {
        allConflicts.push('Código GTIN/EAN distinto: probablemente otra versión o presentación');
        return { matchType: 'VARIANT', score, reasons, conflicts: allConflicts };
      }
      return { matchType: coverage >= MATCH_THRESHOLDS.similar ? 'SIMILAR' : 'UNRELATED', score, reasons, conflicts: allConflicts };
    }
  }
  if (skuMatch) reasons.unshift('Mismo SKU/MPN');

  // 2. Accesorios y genéricos
  if (downgrade.length > 0) {
    const related = coverage >= MATCH_THRESHOLDS.similar * 0.6 || brandMatch || modelMatch;
    return { matchType: related ? 'SIMILAR' : 'UNRELATED', score, reasons, conflicts: allConflicts };
  }

  const brandOk = identity.brand ? brandMatch : true;
  let strongIdentity: boolean;
  if (identity.model) strongIdentity = modelMatch && coverage >= MATCH_THRESHOLDS.exactWithModel;
  else if (identity.brand) strongIdentity = brandMatch && coverage >= MATCH_THRESHOLDS.exactWithBrand;
  else strongIdentity = coverage >= MATCH_THRESHOLDS.exactNoBrand;

  // 3 y 4. Exacto solo sin conflictos.
  if (conflicts.length === 0 && brandOk && (skuMatch || (strongIdentity && versionConflicts.length === 0))) {
    return { matchType: 'EXACT', score, reasons, conflicts: skuMatch ? [...downgrade, ...conflicts] : allConflicts };
  }
  if (conflicts.length + versionConflicts.length > 0 && brandOk && (coverage >= MATCH_THRESHOLDS.variant || modelMatch || skuMatch)) {
    return { matchType: 'VARIANT', score, reasons, conflicts: allConflicts };
  }
  if (coverage >= MATCH_THRESHOLDS.similar || (brandMatch && coverage >= 0.25) || modelMatch) {
    return { matchType: 'SIMILAR', score, reasons, conflicts: allConflicts };
  }
  return { matchType: 'UNRELATED', score, reasons, conflicts: allConflicts };
}

/** Resumen legible de una clasificación para mostrar en la tarjeta. */
export function describeMatch(result: MatchResult): string {
  return [...result.conflicts, ...result.reasons].slice(0, 4).join(' · ');
}

export const MATCH_LABELS: Record<MatchType, string> = {
  EXACT: 'Mismo producto',
  VARIANT: 'Variante distinta',
  SIMILAR: 'Producto parecido',
  UNRELATED: 'No relacionado',
};

/** Orden para mostrar primero las coincidencias más útiles. */
export function matchRank(type: MatchType): number {
  return { EXACT: 0, VARIANT: 1, SIMILAR: 2, UNRELATED: 3 }[type];
}
