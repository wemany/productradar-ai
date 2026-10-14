import { alphanumericKey, normalizeText } from './text';

/**
 * Atributos "duros": si difieren, dos fichas NO son el mismo producto aunque
 * el nombre se parezca (50 ml ≠ 100 ml, 128 GB ≠ 256 GB, paquete x3 ≠ 1 unidad).
 */
export interface HardAttributes {
  storageGb?: number;
  volumeMl?: number;
  weightG?: number;
  packCount?: number;
  screenInches?: number;
  batteryMah?: number;
  powerW?: number;
  /** Tokens con letras y dígitos que parecen modelos (wh1000xm5, a2342). */
  modelTokens: string[];
  isGenericOrCompatible: boolean;
  isUsedOrRefurbished: boolean;
  /** Funda, cargador, repuesto… para el producto, no el producto en sí. */
  isAccessory: boolean;
}

function num(value: string | undefined): number {
  return Number((value ?? '').replace(',', '.'));
}

const GENERIC_RE = /\b(generico|generica|genericos|compatible|compatibles|alternativo|alternativa|tipo original|replica|clon|imitacion|similar a)\b/;
const ACCESSORY_RE = /\b(funda|fundas|estuche|forro|case|protector|mica|vidrio templado|carcasa|cargador|cable|repuesto|repuestos|almohadillas|correa|soporte|adaptador|skin|sticker|lamina|bateria para|control para|accesorio|accesorios)\b/;
const USED_RE = /\b(usado|usada|usados|reacondicionado|reacondicionada|refurbished|renewed|seminuevo|seminueva|open box|exhibicion|de segunda)\b/;

export function extractHardAttributes(rawText: string): HardAttributes {
  // `text` sirve para palabras clave; `measureText` conserva decimales para medidas.
  const text = normalizeText(rawText);
  const measureText = rawText
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    // Miles con punto: "2.500 g" → "2500 g", "1.000 ml" → "1000 ml" (no afecta "1.5 L" ni "0.125 kg").
    .replace(/\b([1-9]\d{0,2})((?:\.\d{3})+)(?!\d)/g, (_m, head: string, groups: string) => head + groups.replace(/\./g, ''));

  const attrs: HardAttributes = {
    modelTokens: [],
    isGenericOrCompatible: GENERIC_RE.test(text),
    isUsedOrRefurbished: USED_RE.test(text),
    isAccessory: ACCESSORY_RE.test(text),
  };

  // Almacenamiento: se toma el mayor valor en GB/TB que no esté marcado como RAM.
  const storage: number[] = [];
  for (const m of measureText.matchAll(/(\d+(?:\.\d+)?)\s?(gb|tb)\b(\s*(?:de\s*)?ram)?/g)) {
    if (m[3]) continue;
    const value = num(m[1]) * (m[2] === 'tb' ? 1000 : 1);
    if (value > 0) storage.push(value);
  }
  if (storage.length) attrs.storageGb = Math.max(...storage);

  const volume = measureText.match(/(\d+(?:\.\d+)?)\s?(ml|mililitros?|cc|l|lt|lts|litros?|fl\.?\s?oz|oz)\b/);
  if (volume) {
    const unit = volume[2] ?? '';
    const value = num(volume[1]);
    let ml = value;
    if (/^(l|lt|lts|litros?)$/.test(unit)) ml = value * 1000;
    else if (unit.includes('oz')) ml = Math.round(value * 29.5735);
    if (ml > 0) attrs.volumeMl = ml;
  }

  const weight = measureText.match(/(\d+(?:\.\d+)?)\s?(kg|kilos?|kilogramos?|g|gr|grs|gramos?|lb|lbs|libras?)\b/);
  if (weight) {
    const unit = weight[2] ?? '';
    const value = num(weight[1]);
    let grams = value;
    if (/^(kg|kilos?|kilogramos?)$/.test(unit)) grams = value * 1000;
    else if (/^(lb|lbs|libras?)$/.test(unit)) grams = Math.round(value * 453.592);
    // "5G" suele ser la red móvil, no un peso: exigir ≥10 g cuando la unidad es "g" pegada.
    const ambiguousG = unit === 'g' && value < 10;
    if (grams > 0 && !ambiguousG) attrs.weightG = grams;
  }

  const packPatterns: RegExp[] = [
    /\b(?:pack|paquete|kit|set|combo|caja|bolsa|lote|duo|trio)\s*(?:de|x|por)?\s*(\d{1,3})\b/,
    /\b(\d{1,3})\s*(?:unidades|unidad|unds?|uds?|piezas|pzs?|pcs|pares|pack)\b/,
    /(?<![\d.]\s?)\bx\s?(\d{1,2})\b(?!\s?(?:\d|mm|cm|m\b|gb|tb|"|pulg))/,
  ];
  for (const re of packPatterns) {
    const m = measureText.match(re);
    if (m) {
      const value = Number(m[1]);
      if (value >= 1 && value <= 500) {
        attrs.packCount = value;
        break;
      }
    }
  }

  const inches = measureText.match(/(\d{1,3}(?:\.\d)?)\s?(?:"|”|''|pulgadas|pulg|inch|in)(?![a-z])/);
  if (inches) {
    const value = num(inches[1]);
    if (value >= 3 && value <= 120) attrs.screenInches = value;
  }

  const mah = measureText.match(/(\d{1,2}[.,]\d{3}|\d{3,6})\s?mah\b/);
  if (mah) attrs.batteryMah = Number((mah[1] ?? '').replace(/[.,]/g, ''));

  const watts = measureText.match(/(\d{1,5})\s?(?:w|watts?|vatios?)\b/);
  if (watts) attrs.powerW = Number(watts[1]);

  const tokens = new Set<string>();
  for (const raw of rawText.split(/[\s,;/()[\]]+/)) {
    const key = alphanumericKey(raw);
    if (key.length < 3 || key.length > 24) continue;
    if (!/\d/.test(key) || !/[a-z]/.test(key)) continue;
    // Excluir medidas puras (128gb, 50ml, 2pack) que ya se comparan por separado.
    if (/^\d+(gb|tb|ml|cc|l|lt|kg|g|gr|mah|w|mm|cm|pulgadas|in|oz|x|pack|und|uds)$/.test(key)) continue;
    tokens.add(key);
  }
  attrs.modelTokens = [...tokens];
  return attrs;
}

export interface AttributeConflict {
  key: 'storage' | 'volume' | 'weight' | 'pack' | 'screen' | 'battery' | 'power';
  message: string;
}

function differs(a: number, b: number, tolerance = 0.02): boolean {
  return Math.abs(a - b) > Math.max(a, b) * tolerance;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

/**
 * Compara atributos duros de la identidad confirmada con los de una oferta.
 * `assumeSingleUnit`: si la identidad no indica paquete, se asume 1 unidad.
 */
export function compareHardAttributes(identity: HardAttributes, candidate: HardAttributes): AttributeConflict[] {
  const conflicts: AttributeConflict[] = [];
  const pairs: Array<[AttributeConflict['key'], number | undefined, number | undefined, string, string]> = [
    ['storage', identity.storageGb, candidate.storageGb, 'Capacidad distinta', 'GB'],
    ['volume', identity.volumeMl, candidate.volumeMl, 'Volumen distinto', 'ml'],
    ['weight', identity.weightG, candidate.weightG, 'Peso/contenido distinto', 'g'],
    ['screen', identity.screenInches, candidate.screenInches, 'Tamaño de pantalla distinto', '"'],
    ['battery', identity.batteryMah, candidate.batteryMah, 'Batería distinta', 'mAh'],
    ['power', identity.powerW, candidate.powerW, 'Potencia distinta', 'W'],
  ];
  for (const [key, a, b, label, unit] of pairs) {
    if (a !== undefined && b !== undefined && differs(a, b)) {
      conflicts.push({ key, message: `${label}: ${fmt(b)} ${unit} frente a ${fmt(a)} ${unit}` });
    }
  }
  const idPack = identity.packCount ?? 1;
  if (candidate.packCount !== undefined && candidate.packCount !== idPack) {
    conflicts.push({
      key: 'pack',
      message: `Presentación distinta: ${candidate.packCount} unidades frente a ${idPack}`,
    });
  }
  return conflicts;
}
