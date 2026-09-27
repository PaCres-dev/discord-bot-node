// Si existe HTTPS_PROXY, todo el tráfico (fetch, WebSocket y subida de media) pasa por él.
import { HttpsProxyAgent } from 'https-proxy-agent';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;

// fetch global (búsqueda y descarga de imágenes, versión de WhatsApp Web).
if (proxyUrl) setGlobalDispatcher(new EnvHttpProxyAgent());

// Agente para el WebSocket y las subidas de media de Baileys (usa https.request).
export const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
