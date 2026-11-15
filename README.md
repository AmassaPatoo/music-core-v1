# Music Core

Player web/PWA que reúne num só lugar o **Spotify** (com a conta de cada usuário), o **Audius** e o **Internet Archive**. Não copia arquivos do catálogo, não baixa músicas e não contorna DRM: cada faixa toca direto da plataforma de origem, pelos meios oficiais dela.

Site: https://amassapatoo.github.io/music-core-v1/

## Funcionalidades

- **Explorar** músicas completas e gratuitas do **Audius** (artistas independentes) e do **Internet Archive** (domínio público, Creative Commons, shows ao vivo autorizados), pelas APIs públicas dessas plataformas.
- **Canal Spotify**: cada pessoa entra com a própria conta (login oficial PKCE). Busca no catálogo, playlists e músicas curtidas, reprodução pelo Web Playback SDK oficial. Tocar exige Spotify Premium e navegador de computador (Chrome, Edge ou Firefox).
- Biblioteca, busca, favoritas, playlists, fila, avanço, retorno, modo aleatório e repetição.
- Instalação como PWA em navegadores compatíveis.

## Privacidade

Não existe servidor do Music Core. Biblioteca, playlists, favoritos e o login do Spotify ficam apenas no navegador de cada pessoa (IndexedDB/localStorage). Ninguém — nem o administrador — vê o que outra pessoa escuta ou salva. Nenhuma senha ou Client Secret passa pelo app.

## Spotify para várias pessoas

1. No app criado em https://developer.spotify.com/dashboard, o **Redirect URI** deve ser `https://amassapatoo.github.io/music-core-v1/`, com **Web API** e **Web Playback SDK** marcados.
2. Coloque o Client ID na constante `SPOTIFY_CLIENT_ID` em `app.js` para que os visitantes não precisem colar nada.
3. Em **Settings → User Management**, adicione o nome e o e-mail do Spotify de cada pessoa. Em modo de desenvolvimento o Spotify permite até 5 usuários e exige que o dono do app tenha Premium; o modo estendido (sem limite) só é concedido a empresas com pelo menos 250 mil usuários ativos mensais.

Audius e Internet Archive funcionam para qualquer número de pessoas, sem cadastro.

## Rodar localmente

Na pasta do projeto, execute `python -m http.server 8000` e acesse `http://localhost:8000`.

## Limitações

- Os dados ficam só no navegador atual: limpar os dados do site, trocar de aparelho ou usar modo anônimo apaga biblioteca e playlists.
- As faixas tocam pela internet; se a plataforma de origem remover uma música, ela deixa de tocar aqui.
