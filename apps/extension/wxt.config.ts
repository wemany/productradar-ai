import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * URL pública del gateway (opcional). Se define al compilar:
 *   WXT_GATEWAY_URL=https://productradar-gateway.<cuenta>.workers.dev pnpm build
 * Sin ella, la extensión arranca en modo "sin configurar" y ofrece la demo y
 * la configuración manual. Nunca se incluyen claves en el paquete.
 */
const gatewayUrl = process.env.WXT_GATEWAY_URL?.trim() ?? '';

function gatewayHostPermission(url: string): string[] {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? [`${parsed.origin}/*`] : [];
  } catch {
    return [];
  }
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __GATEWAY_URL__: JSON.stringify(gatewayUrl),
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
    },
    build: {
      // Sin código remoto: todo el JS va dentro del paquete (requisito MV3).
      target: 'chrome116',
    },
  }),
  manifest: {
    name: 'ProductRadar AI',
    description: 'Investiga productos: precios de competencia con fuentes, referencias de Alibaba y escenarios de rentabilidad.',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel', 'contextMenus'],
    host_permissions: gatewayHostPermission(gatewayUrl),
    // Acceso opcional y puntual: se solicita sitio por sitio, solo tras una acción del usuario.
    optional_host_permissions: ['https://*/*'],
    action: {
      default_title: 'Analizar producto con ProductRadar',
    },
    commands: {
      'analyze-page': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Analizar el producto de esta página',
      },
    },
  },
  zip: {
    artifactTemplate: 'productradar-ai-{{version}}-chrome.zip',
  },
});
