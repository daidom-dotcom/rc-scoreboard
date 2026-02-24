# Rachao dos Crias - Scoreboard

## Requisitos
- Node.js 18+
- Conta no Supabase

## Setup local
```bash
npm install
cp .env.example .env
# edite .env com o URL e ANON KEY do Supabase
npm run dev
```

## Build
```bash
npm run build
```

A pasta `dist/` sera gerada.

## Deploy na Hostinger
1. Rode o build (`npm run build`).
2. Suba o conteudo de `dist/` para `public_html/` via FTP ou Gerenciador de Arquivos.
3. Crie o arquivo `.htaccess` em `public_html/` com o conteudo abaixo para o React Router:

```
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

## Migração de histórico
Exporte a aba "Historico" do Google Sheets para CSV e rode:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/import_csv.js caminho/para/historico.csv
```

