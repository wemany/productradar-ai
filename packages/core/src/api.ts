import { z } from 'zod';
import { MarketSchema } from './schemas';

/**
 * Contrato del gateway interno (Cloudflare Worker). Compartido entre el
 * servidor y el cliente de la extensión para que no diverjan.
 */

export const API_VERSION = 'v1';

/** Modelo de visión por defecto (configurable en el gateway y en el modo desarrollo). */
export const DEFAULT_VISION_MODEL = 'claude-opus-5-5';

/** Límites de carga útil (también se aplican en el servidor). */
export const API_LIMITS = {
  maxQueriesPerRequest: 6,
  maxQueryLength: 300,
  maxResultsPerQuery: 20,
  /** ~1,5 MB de imagen tras compresión en la extensión (base64 ≈ 4/3 del binario). */
  maxImageBase64Length: 2_000_000,
  maxBodyBytes: 2_200_000,
} as const;

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const SearchResultItemSchema = z.object({
  title: z.string().max(500),
  url: z.string().max(2048),
  snippet: z.string().max(2000),
  extraSnippets: z.array(z.string().max(1000)).max(5).optional(),
  publisherName: z.string().max(200).optional(),
  age: z.string().max(100).optional(),
  structuredProduct: z
    .object({
      name: z.string().max(500).optional(),
      price: z.string().max(60).optional(),
      currency: z.string().max(8).optional(),
      gtin: z.string().max(20).optional(),
    })
    .optional(),
});

export const SearchMarketRequestSchema = z.object({
  queries: z.array(z.string().trim().min(1).max(API_LIMITS.maxQueryLength)).min(1).max(API_LIMITS.maxQueriesPerRequest),
  market: MarketSchema,
  count: z.number().int().min(1).max(API_LIMITS.maxResultsPerQuery).optional(),
});
export type SearchMarketRequest = z.infer<typeof SearchMarketRequestSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const SearchMarketResponseSchema = z.object({
  results: z.array(
    z.object({
      query: z.string(),
      ok: z.boolean(),
      items: z.array(SearchResultItemSchema).optional(),
      error: ApiErrorSchema.optional(),
    }),
  ),
});
export type SearchMarketResponse = z.infer<typeof SearchMarketResponseSchema>;

export const SearchAlibabaRequestSchema = z.object({
  query: z.string().trim().min(1).max(API_LIMITS.maxQueryLength),
  market: MarketSchema,
});

export const SearchAlibabaResponseSchema = z.object({
  items: z.array(SearchResultItemSchema),
});

export const IdentifyImageRequestSchema = z.object({
  imageBase64: z.string().min(100).max(API_LIMITS.maxImageBase64Length).regex(/^[A-Za-z0-9+/=]+$/, 'base64 inválido'),
  mimeType: z.enum(SUPPORTED_IMAGE_TYPES),
  market: MarketSchema,
});
export type IdentifyImageRequest = z.infer<typeof IdentifyImageRequestSchema>;

export const VisionAttributeSchema = z.object({
  name: z.string().max(60),
  value: z.string().max(120),
});

/** Salida estructurada del modelo de visión (validada siempre con Zod). */
export const VisionResultSchema = z.object({
  genericName: z.string().min(1).max(200),
  englishName: z.string().max(200).nullable(),
  brand: z.string().max(120).nullable(),
  model: z.string().max(120).nullable(),
  attributes: z.array(VisionAttributeSchema).max(15),
  searchKeywords: z.array(z.string().max(80)).max(10),
  uncertainties: z.array(z.string().max(200)).max(8),
  confidence: z.number().min(0).max(1),
  alternatives: z
    .array(
      z.object({
        name: z.string().max(200),
        brand: z.string().max(120).nullable(),
        model: z.string().max(120).nullable(),
      }),
    )
    .max(3),
  isProduct: z.boolean(),
});
export type VisionResult = z.infer<typeof VisionResultSchema>;

export const IdentifyImageResponseSchema = z.object({
  result: VisionResultSchema,
  model: z.string(),
});

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  providers: z.object({
    search: z.boolean(),
    vision: z.boolean(),
  }),
  accessCodeRequired: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
