# Music Core — V1 (biblioteca independente)

Player web/PWA para arquivos de áudio próprios ou devidamente autorizados, com busca integrada em plataformas de música aberta. Não se conecta ao streaming do Spotify, não copia arquivos do catálogo e não contorna DRM.

## Funcionalidades

- **Explorar músicas online**: busca e reprodução de músicas completas e gratuitas do **Audius** (artistas independentes) e do **Internet Archive** (domínio público, Creative Commons, shows ao vivo autorizados), usando as APIs públicas dessas plataformas. As faixas podem ser salvas na biblioteca, adicionadas a playlists e favoritadas; o áudio é transmitido pela internet direto da plataforma de origem.
- **Canal Spotify (sua própria conta)**: em Explorar → Spotify, cole o Client ID de um app criado em developer.spotify.com/dashboard (Redirect URI = endereço do site, ex.: `https://amassapatoo.github.io/music-core-v1/`, com Web API e Web Playback SDK marcados) e clique em Entrar com Spotify. Permite buscar no catálogo, abrir suas playlists e músicas curtidas e tocar pelo player oficial do Spotify. Tocar exige Spotify Premium e navegador de computador (Chrome, Edge ou Firefox); as faixas não são baixadas, ficam como atalhos para o Spotify.
- Importar MP3, WAV, OGG, AAC, FLAC etc. (quando o navegador suporta), incluindo arrastar e soltar.
- Guardar arquivos em IndexedDB no próprio navegador; reprodução com `HTMLAudioElement`.
- Biblioteca, busca, músicas favoritas, playlists locais, fila, avanço, retorno, modo aleatório e repetição.
- Reproduzir áudio demonstrativo criado exclusivamente para este pacote.
- Importar, como **metadados apenas**, um arquivo JSON com `data.playlistV2.content.items`; cria uma playlist local que preserva ordem e UIDs de cada ocorrência, além de total, limite, offset e revisão da página.
- Instalação como PWA em navegadores compatíveis via HTTPS ou localhost.

## Rodar localmente

Abra a pasta em um terminal e execute `python -m http.server 8000`. Em seguida, acesse `http://localhost:8000`. Também pode publicar **todo o conteúdo** desta pasta em um repositório GitHub Pages; o `index.html` deve ficar na raiz publicada.

Na primeira visita, o aplicativo adiciona uma faixa de demonstração para validar o player. Use `＋ Importar músicas` para escolher seus arquivos; em Início ou Biblioteca, use `Importar metadados JSON` para visualizar uma exportação JSON de playlist sem importar arquivos de áudio de terceiros.

## Limitações desta primeira versão

- Dados estão apenas no navegador atual. Desinstalar, limpar o site, usar outro dispositivo ou um navegador em modo anônimo pode eliminar músicas e playlists. Faça backup dos arquivos originais.
- O JSON externo só fornece dados de catálogo, não links de música. Um campo `playable` verdadeiro no serviço de origem **não** significa que a faixa possa tocar aqui.
- O login do Spotify usa o fluxo oficial PKCE: nenhuma senha ou Client Secret passa pelo app; o token fica apenas no navegador.
- Nenhuma integração com Supabase, sincronização de conta ou colaboradores reais nesta versão.
- A importação do formato `playlistV2` é um adaptador para estudo de dados fornecidos manualmente; o formato externo pode mudar.
- O volume de arquivos armazenáveis depende da cota do navegador. Em produção, usar storage com autenticação, autorização e políticas RLS.
- Antes de redistribuir imagens/capas, verificar os direitos e termos da fonte.

## Estrutura

- `index.html`, `styles.css`, `app.js`: interface e lógica
- `sw.js`, `manifest.webmanifest`, `assets/icon-*.png`: instalação e cache offline da casca do app
- `assets/demo-original.wav`: sinal de teste original
- `examples/playlist-metadata-normalized.json`: catálogo extraído de forma seletiva da amostra do usuário; **não** contém URLs de áudio, usuários ou links de compartilhamento
