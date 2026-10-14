import { z } from 'zod';

/**
 * Zod sin compilación JIT: evita cualquier intento de `new Function` dentro de
 * la extensión (la CSP de Manifest V3 lo prohíbe). Importar antes que el resto.
 */
z.config({ jitless: true });
