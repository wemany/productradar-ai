import { describe, expect, it } from 'vitest';
import { extractHardAttributes } from '../src/attributes';
import { classifyMatch, normalizeGtin } from '../src/matching';
import type { ProductIdentity } from '../src/schemas';

function identity(partial: Partial<ProductIdentity> & { name: string }): ProductIdentity {
  return { attributes: {}, searchQueries: [], uncertainties: [], identifiedBy: 'USER_INPUT', ...partial };
}

describe('extractHardAttributes', () => {
  it('extrae capacidad sin confundir la RAM', () => {
    expect(extractHardAttributes('Celular Samsung A55 8GB RAM 256GB').storageGb).toBe(256);
  });

  it('normaliza volumen y peso', () => {
    expect(extractHardAttributes('Perfume 100 ml').volumeMl).toBe(100);
    expect(extractHardAttributes('Botella 1,5 L').volumeMl).toBe(1500);
    expect(extractHardAttributes('Café molido 500 g').weightG).toBe(500);
    expect(extractHardAttributes('Proteína 2 kg').weightG).toBe(2000);
  });

  it('no confunde 5G (red móvil) con un peso', () => {
    expect(extractHardAttributes('Celular 5G 128GB').weightG).toBeUndefined();
  });

  it('detecta presentaciones en paquete', () => {
    expect(extractHardAttributes('Pack x3 medias deportivas').packCount).toBe(3);
    expect(extractHardAttributes('Kit de 2 cepillos').packCount).toBe(2);
    expect(extractHardAttributes('Jabón 6 unidades').packCount).toBe(6);
    expect(extractHardAttributes('Monitor 1920x1080').packCount).toBeUndefined();
  });

  it('detecta genéricos, usados y accesorios', () => {
    expect(extractHardAttributes('Cargador genérico compatible').isGenericOrCompatible).toBe(true);
    expect(extractHardAttributes('iPhone reacondicionado').isUsedOrRefurbished).toBe(true);
    expect(extractHardAttributes('Estuche para audífonos').isAccessory).toBe(true);
  });

  it('extrae baterías con separador de miles', () => {
    expect(extractHardAttributes('Power bank 10.000 mAh').batteryMah).toBe(10000);
  });
});

describe('classifyMatch — reglas de equivalencia', () => {
  it('perfume de 50 ml NO es el mismo producto que el de 100 ml', () => {
    const id = identity({ name: 'Perfume Dior Sauvage EDT 100 ml', brand: 'Dior', model: 'Sauvage' });
    const r = classifyMatch(id, { title: 'Perfume Dior Sauvage EDT 50 ml' });
    expect(r.matchType).toBe('VARIANT');
    expect(r.conflicts.join(' ')).toMatch(/Volumen distinto/);
  });

  it('celular de 128 GB NO es el mismo que el de 256 GB', () => {
    const id = identity({ name: 'Samsung Galaxy A55 256GB', brand: 'Samsung', model: 'Galaxy A55' });
    const r = classifyMatch(id, { title: 'Samsung Galaxy A55 128GB Azul' });
    expect(r.matchType).toBe('VARIANT');
  });

  it('paquete de 3 NO equivale a 1 unidad', () => {
    const id = identity({ name: 'Cepillo dental Oral-B Pro Clean', brand: 'Oral-B', model: 'Pro Clean' });
    const r = classifyMatch(id, { title: 'Pack x3 Cepillo dental Oral-B Pro Clean' });
    expect(r.matchType).toBe('VARIANT');
    expect(r.conflicts.join(' ')).toMatch(/Presentación distinta/);
  });

  it('repuesto genérico NO equivale al original', () => {
    const id = identity({ name: 'Filtro de agua Brita Maxtra', brand: 'Brita', model: 'Maxtra' });
    const r = classifyMatch(id, { title: 'Filtro genérico compatible Brita Maxtra' });
    expect(r.matchType).toBe('SIMILAR');
  });

  it('un accesorio para el producto no es el producto', () => {
    const id = identity({ name: 'Audífonos Sony WH-1000XM5', brand: 'Sony', model: 'WH-1000XM5' });
    const r = classifyMatch(id, { title: 'Estuche rígido para Sony WH-1000XM5' });
    expect(r.matchType).toBe('SIMILAR');
  });

  it('reconoce el mismo modelo aunque cambie la escritura', () => {
    const id = identity({ name: 'Audífonos inalámbricos Sony WH-1000XM5', brand: 'Sony', model: 'WH-1000XM5' });
    const r = classifyMatch(id, { title: 'Sony WH1000XM5 Noise Cancelling Negro' });
    expect(r.matchType).toBe('EXACT');
  });

  it('otro modelo de la misma marca no es exacto', () => {
    const id = identity({ name: 'Audífonos Sony WH-1000XM5', brand: 'Sony', model: 'WH-1000XM5' });
    const r = classifyMatch(id, { title: 'Audífonos Sony WH-1000XM4' });
    expect(r.matchType).not.toBe('EXACT');
  });

  it('GTIN igual → exacto; GTIN distinto → nunca exacto', () => {
    const id = identity({ name: 'Crema hidratante Nivea 400 ml', brand: 'Nivea', gtin: '4005900000000' });
    expect(classifyMatch(id, { title: 'Nivea crema', gtin: '04005900000000' }).matchType).toBe('EXACT');
    expect(classifyMatch(id, { title: 'Crema hidratante Nivea 400 ml', gtin: '4005900000999' }).matchType).toBe('VARIANT');
  });

  it('un modelo con "X2" no se confunde con "paquete x2"', () => {
    const id = identity({ name: 'Audífonos DemoSonic Aura X2', brand: 'DemoSonic', model: 'Aura X2' });
    expect(classifyMatch(id, { title: 'DemoSonic Aura X2 Negro' }).matchType).toBe('EXACT');
    expect(classifyMatch(id, { title: 'Pack x2 Audífonos DemoSonic Aura X2' }).matchType).toBe('VARIANT');
  });

  it('producto usado frente a nuevo es variante', () => {
    const id = identity({ name: 'Consola PlayStation 5 Slim', brand: 'Sony', model: 'PlayStation 5 Slim' });
    expect(classifyMatch(id, { title: 'PlayStation 5 Slim Sony usado' }).matchType).toBe('VARIANT');
  });

  it('marca corta no coincide dentro de otra palabra (LG ≠ algodón)', () => {
    const id = identity({ name: 'Televisor LG 55 pulgadas', brand: 'LG' });
    const r = classifyMatch(id, { title: 'Toalla de algodón 55 cm' });
    expect(r.matchType).toBe('UNRELATED');
  });

  it('sin marca ni modelo exige mucha coincidencia para ser exacto', () => {
    const id = identity({ name: 'Lámpara LED de escritorio plegable' });
    expect(classifyMatch(id, { title: 'Lámpara LED escritorio plegable recargable' }).matchType).toBe('EXACT');
    expect(classifyMatch(id, { title: 'Lámpara de pie LED' }).matchType).toBe('SIMILAR');
  });

  it('no relaciona productos distintos', () => {
    const id = identity({ name: 'Licuadora Oster 600W', brand: 'Oster' });
    expect(classifyMatch(id, { title: 'Zapatos deportivos para correr' }).matchType).toBe('UNRELATED');
  });
});

describe('normalizeGtin', () => {
  it('rellena a 14 dígitos y rechaza longitudes inválidas', () => {
    expect(normalizeGtin('7701234567890')).toBe('07701234567890');
    expect(normalizeGtin('123')).toBeUndefined();
  });
});

describe('classifyMatch — versiones y atributos (revisión)', () => {
  it.each([
    ['iPhone 15 Pro', 'Apple', 'iPhone 15 Pro', 'Apple iPhone 15 Pro Max 256 GB'],
    ['Galaxy A54 128 GB', 'Samsung', undefined, 'Samsung Galaxy A34 128 GB'],
    ['Redmi Note 13', 'Xiaomi', 'Redmi Note 13', 'Xiaomi Redmi Note 13 Pro'],
    ['Pañales Huggies Natural Care Etapa 3', 'Huggies', undefined, 'Pañales Huggies Natural Care Etapa 4'],
    ['Samsung Galaxy S24', 'Samsung', 'Galaxy S24', 'Samsung Galaxy S24+ 256GB'],
    ['iPhone 15 Pro', 'Apple', 'iPhone 15 Pro', 'Apple iPhone 15 128GB'],
  ])('%s ≠ %s', (name, brand, model, title) => {
    const id = identity({ name, brand, model });
    expect(classifyMatch(id, { title }).matchType).not.toBe('EXACT');
  });

  it('el mismo modelo sigue siendo exacto aunque cambie la escritura o falten palabras genéricas', () => {
    const id = identity({ name: 'Samsung Galaxy A54 128 GB', brand: 'Samsung' });
    expect(classifyMatch(id, { title: 'Celular Samsung Galaxy A54 5G 128GB Negro' }).matchType).toBe('EXACT');
  });

  it('compara color y talla confirmados por el usuario solo si la oferta indica otro valor', () => {
    const id = identity({ name: 'Camiseta deportiva Nike Dri-FIT', brand: 'Nike', attributes: { Talla: 'M', Color: 'Rojo' } });
    expect(classifyMatch(id, { title: 'Camiseta deportiva Nike Dri-FIT Talla L Azul' }).matchType).toBe('VARIANT');
    expect(classifyMatch(id, { title: 'Camiseta deportiva Nike Dri-FIT talla M roja' }).matchType).toBe('EXACT');
    expect(classifyMatch(id, { title: 'Camiseta deportiva Nike Dri-FIT' }).matchType).toBe('EXACT');
  });

  it('un GTIN igual manda aunque el título omita el número de modelo', () => {
    const id = identity({ name: 'Samsung Galaxy A54 128 GB', brand: 'Samsung', gtin: '8806094937000' });
    expect(classifyMatch(id, { title: 'Celular Samsung Galaxy', gtin: '8806094937000' }).matchType).toBe('EXACT');
  });
});

describe('extractHardAttributes — miles con punto', () => {
  it('lee "2.500 g", "1.000 ml" y "3.000 W" como enteros', () => {
    expect(extractHardAttributes('Café 2.500 g').weightG).toBe(2500);
    expect(extractHardAttributes('Botella 1.000 ml').volumeMl).toBe(1000);
    expect(extractHardAttributes('Aspiradora 3.000 W').powerW).toBe(3000);
    expect(extractHardAttributes('Gaseosa 1.5 L').volumeMl).toBe(1500);
  });

  it('500 g no equivale a 2.500 g', () => {
    const id = identity({ name: 'Café molido Juan Valdez 500 g', brand: 'Juan Valdez' });
    expect(classifyMatch(id, { title: 'Café molido Juan Valdez 2.500 g' }).matchType).toBe('VARIANT');
  });
});
