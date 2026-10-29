/**
 * Servidores ICE usados pelo WebRTC (PeerJS).
 *
 * STUN basta pra maioria das redes domésticas. Se algum amigo estiver atrás de NAT simétrico /
 * rede corporativa e não conectar, adicione um servidor TURN aqui (ou via variáveis de ambiente
 * VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS no build).
 */
const env = (import.meta as any).env ?? {};

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN (exemplo):
  // { urls: 'turn:meu-turn.exemplo.com:3478', username: 'user', credential: 'senha' },
];

if (env.VITE_TURN_URL) {
  ICE_SERVERS.push({ urls: env.VITE_TURN_URL as string, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
}
