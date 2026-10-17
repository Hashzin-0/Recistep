# Recistep Media Extractor

Serviço Python isolado para resolver URLs de vídeo público do Instagram e TikTok com yt-dlp. Ele **não baixa nem armazena** o arquivo: devolve uma URL direta de MP4 para o Recistep validar e encaminhar ao Gemini. Não usa cookies, sessões de navegador, proxies ou contorno de login/DRM.

## Executar localmente

```bash
docker build -t recistep-media-extractor ./services/media-extractor
docker run --rm -p 8000:8000 \
  -e MEDIA_EXTRACTOR_API_KEY='gere-uma-chave-aleatoria-forte' \
  recistep-media-extractor
```

Verifique `GET http://localhost:8000/healthz`. O endpoint de extração exige `Authorization: Bearer <chave>`.

## Configurar o Recistep

No serviço Python, configure `MEDIA_EXTRACTOR_API_KEY`. Na Vercel, no projeto Recistep, configure:

- `MEDIA_EXTRACTOR_URL`: URL HTTPS pública do serviço, sem o caminho `/v1/extract`.
- `MEDIA_EXTRACTOR_API_KEY`: a mesma chave secreta configurada no serviço Python.

As variáveis são server-only; não use o prefixo `NEXT_PUBLIC_`. Sem essas duas variáveis, o Recistep continua usando os conectores públicos já existentes. A configuração e o deploy deste serviço são separados do deploy Next.js na Vercel.

## Limites de segurança e operação

- Só aceita URLs HTTPS de posts/reels/vídeos únicos do Instagram e TikTok; perfis, playlists e outras plataformas são recusados.
- Só retorna MP4 direto em hosts CDN permitidos. O Recistep revalida host, redirecionamentos, disponibilidade e tamanho antes de usar a URL.
- Não usa cookies, credenciais de usuário, proxies, navegador automatizado nem métodos para acessar conteúdo privado.
- Limita a duas extrações simultâneas por instância e usa timeouts/retries curtos.
- URLs assinadas podem expirar rapidamente. O Recistep chama o serviço imediatamente antes da análise; falhas retornam ao conector existente ou ao fluxo de transcrição.
- O limite de 15 MiB é verificado quando a plataforma informa o tamanho. A verificação do CDN no Recistep é a validação final.
- Disponibilidade depende do suporte atual do yt-dlp e das regras de acesso das plataformas. Conteúdo privado, removido, bloqueado ou que exige login não é suportado.

## Testes

```bash
python -m pip install -r services/media-extractor/requirements.txt -r services/media-extractor/requirements-dev.txt
python -m pytest services/media-extractor/test_main.py
```
