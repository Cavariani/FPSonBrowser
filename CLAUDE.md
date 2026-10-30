# FPS do CLT (CLTfps)

FPS multiplayer de navegador, low-poly, feito por tédio pra jogar com os amigos no trabalho. Projeto **bem early e cru**: muita coisa ainda vai mudar. Online em https://cavariani.github.io/FPSonBrowser/

## Stack

Three.js + TypeScript + Vite · PeerJS (P2P via WebRTC, host autoritativo, sem servidor/conta) · áudio procedural (Web Audio, `synth.worker.ts`) · arte/texturas/modelos procedurais em código (sem assets externos).

## Comandos

- `npm run dev`: dev server na **porta 5199** (config `dev` em `.claude/launch.json`)
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: typecheck + vite build

Não há testes automatizados.

## Mapa do código (`src/`)

- `game/`: lógica (Game, Match, Player, Bots, Weapons, World, Cheats). `game/special/` = armas malucas (defs, Specials, Projectiles, Status, Pickups, msgs)
- `net/`: Net (host/cliente), protocol, ice
- `fx/`: visual (Character, ViewModel, Effects, partículas). `fx/special/` e `fx/vm/specialRig.ts` = visual das armas malucas
- `audio/`: `recipes*.ts` = sons procedurais por receita; `dsp.ts` = blocos de síntese
- `render/`: Renderer, PostFX (CRT), MapBuilder, props, texturas
- `maps/`: mapas (hoje só `dust`)
- `ui/`: Menu, HUD, Minimap, CheatsHud (+ css)
- `core/`: Input, Settings, event bus (`events.ts`)

## Regras do projeto

- **Armas malucas e P2P sem servidor são pilares**: não remover nem trocar sem o Pedro pedir. Todo o resto (loja, cheats por killstreak, balanceamento, mapas, UI) está aberto a mudança.
- Ids de arma especial (`SpecialId` em `game/special/defs.ts`) são fixos e usados por arte, áudio e HUD: ao adicionar/renomear, atualizar os três.
- Números de balanceamento ficam em `defs.ts` (`SPECIALS`, `p: {...}`); mexa ali, não espalhe constantes.
- Rede: o host é autoritativo. **Não precisa manter compatibilidade entre versões**: pode mudar o protocolo à vontade, todo mundo recarrega a página.
- Sem backend, sem contas, sem dependências pesadas novas sem necessidade. Assets sempre procedurais.
- Linguagem do jogo: PT-BR, tom normal de FPS (sem tema de escritório forçado). Comentários e textos de UI em português.
- Estilo: seguir o código ao redor (comentários curtos em PT explicando o "porquê", sem JSDoc exagerado).

## Direção de design (escada de malucas + loja de comuns, implementado)

- **Escada:** 14 malucas, da mais fraca à mais forte (`LADDER` em `src/game/shop.ts`, ordem estimada pelos números, sem playtest). Todo mundo nasce com a do seu nível; 1 kill sobe um nível; quem mata no último nível (Tijolo) vence.
- **Loja (tecla B, sem rounds):** só armas comuns (faca, pistola, smg, escopeta, fuzil, sniper) e extras (colete, vida cheia, munição das malucas). Malucas NÃO se vendem. Comprar uma comum substitui a maluca na mão até morrer; ao respawnar volta a maluca do nível. Compra validada no host (`Match.buy`, `canBuy`).
- **Dinheiro:** $500 inicial, $300 por kill (`shop.ts`). Colete absorve 50% do dano até 100 pontos.
- **Munição das malucas regenera sozinha**, devagar (`regenAmmo` em `Specials.ts`; `REGEN_FULL`/`regen` em `defs.ts`).
- **Powerups fixos no mapa (estilo Doom/Quake), só na loja:** 12 pontos espalhados, voltam depois de pegos (`src/game/special/Powerups.ts`): marmita (+50 vida), capacete (+50 colete), energético (velocidade x1,4, 10 s), pilha (munição infinita, 10 s), PIX (+$300), cachaça (dano x2, 12 s). Host decide; buffs são `Actor.buffs` (segundos).
- Sem pickups de armas no mapa no modo da loja. O id do modo continua `'gungame'` (nome antigo) e significa "modo da loja"; `'treino'` é o sandbox (pickups no mapa + 1-6 troca arma).

## Fluxo de trabalho

- Depois de editar, rodar `npm run typecheck`. Se a mudança for visível/jogável, subir o dev server (porta 5199, via `preview_start`) e checar console e visual no navegador antes de dizer que terminou.
- **Sempre commitar e dar push ao terminar cada mudança, sem perguntar** (pedido explícito do Pedro). Atenção: push na `main` dispara deploy no GitHub Pages (`.github/workflows/deploy.yml`), ou seja, vai pro ar pros amigos. Só dar push com typecheck/build passando.
- Mensagens de commit em português, curtas, descrevendo o que mudou no jogo.
- Versão em `package.json` aparece no menu (`__APP_VERSION__`); subir quando fizer sentido marcar uma release.
- Nunca usar a porta 5173 (é de outro projeto, o ERP).
