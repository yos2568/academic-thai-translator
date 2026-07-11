# VPS deployment

This deployment runs the translator behind Caddy with automatic HTTPS and HTTP basic authentication. The application container has no published host port; only Caddy can reach it on the Compose network.

## 1. Prepare DNS

Create an `A` record for your chosen hostname (for example, `translate.example.com`) pointing to the VPS public IPv4 address. If you publish an `AAAA` record, it must point to the same VPS over IPv6.

## 2. Prepare the VPS

Install Docker Engine and the Docker Compose plugin using Docker's instructions for your Linux distribution. Confirm both commands work:

```bash
docker --version
docker compose version
```

Allow SSH, HTTP, and HTTPS only:

```bash
sudo ufw allow 22,80,443/tcp
sudo ufw enable
sudo ufw status
```

Keep SSH protected with keys and your provider's network firewall where available.

## 3. Configure and launch

```bash
git clone YOUR_REPOSITORY_URL academic-thai-translator
cd academic-thai-translator
cp .env.example .env
```

Generate the Caddy password hash (the single quotes prevent shell expansion):

```bash
docker run --rm caddy:2 caddy hash-password --plaintext 'choose-a-strong-password'
```

Edit `.env` and set `APP_DOMAIN`, `APP_USER`, and the generated `APP_PASSWORD_HASH`. Wrap the password hash in single quotes so Compose does not interpret its `$` characters, for example `APP_PASSWORD_HASH='$2a$14$...'`. A server-side Anthropic key is optional; omit it for BYOK-only operation.

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f caddy app
```

Open `https://your-domain.example`. Caddy obtains and renews the TLS certificate automatically. The browser must show the basic-auth prompt before the application loads.

Verify that port 3000 is not published:

```bash
docker compose ps
curl --fail http://127.0.0.1:3000
```

The `curl` command should fail because only Caddy exposes host ports.

Verify Thai OCR support inside the application container:

```bash
docker compose exec app tesseract --list-langs
```

The output must include `tha` and `eng`.

## 4. Optional Compose-local Ollama

Uncomment the `ollama` service and `ollama_models` volume in `docker-compose.yml`, set `ALLOW_PRIVATE_UPSTREAMS=true` in `.env`, and redeploy. In the application Settings panel, use `http://ollama:11434` as the Ollama base URL.

Only enable this flag on a trusted, password-gated deployment: it intentionally allows the application server to contact private network addresses.

## 5. Update

```bash
git pull
docker compose up -d --build
docker image prune
```

After an update, repeat the HTTPS, authentication, translation/export, and OCR checks.
