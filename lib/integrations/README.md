# Integrações

Este diretório concentra adapters CommonJS e wrappers usados pelas rotas REST, pelo handler do bot e por integrações externas.

## Estrutura

- `apis/funcoes/*`: adapters CJS para serviços de mídia, pesquisa, upload, Pinterest, Instagram, Mediafire, Mercado Livre, Spotify e utilitários de imagem.
- `apis/index.ts`: wrappers ESM/TS para consumo controlado desses adapters.
- `../apis/yt.ts`: wrapper moderno de YouTube usado pelos endpoints novos.

Novas integrações devem ganhar wrapper tipado em TypeScript antes de serem expostas para rotas públicas.
