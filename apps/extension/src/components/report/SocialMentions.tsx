import { safeHref, truncate, type SourceEvidence } from '@productradar/core';
import { ExternalLink, MessageCircle } from 'lucide-react';

/**
 * Menciones públicas en Facebook, Instagram y TikTok halladas por el buscador.
 * Solo muestra fragmentos del buscador como texto plano; nunca se presentan
 * como anuncios ni como conteo publicitario.
 */
export function SocialMentions({ evidence }: { evidence: SourceEvidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <div className="space-y-2">
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <MessageCircle className="size-3.5 shrink-0 text-muted" aria-hidden />
          Menciones públicas encontradas por el buscador ({evidence.length})
        </h3>
        <p className="mt-0.5 text-[11.5px] font-semibold text-ink-2">Son menciones públicas en redes, NO un conteo de anuncios.</p>
      </div>
      <ul className="space-y-1.5">
        {evidence.map((e) => {
          const href = safeHref(e.url);
          const body = (
            <>
              <span className="min-w-0">
                <span className="block truncate font-mono text-[10.5px] text-muted">{e.publisher}</span>
                {e.extractedText && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-2">{truncate(e.extractedText, 160)}</span>}
              </span>
              {href && <ExternalLink className="size-3.5 shrink-0 text-accent" aria-hidden />}
            </>
          );
          return (
            <li key={e.url}>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2 no-underline hover:border-accent"
                >
                  {body}
                </a>
              ) : (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
