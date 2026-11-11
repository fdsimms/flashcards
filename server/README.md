# Your own Anki sync server

Anki's own sync server, run on a small cloud server, with HTTPS. Anki on your computer, AnkiMobile and Franki all sync with it instead of AnkiWeb, so they stay in step with each other. (Franki can't sync with AnkiWeb: its terms allow only Anki's own apps.)

It's the server built into Anki (from the `anki` Python package), behind [Caddy](https://caddyserver.com), which gets and renews the HTTPS certificate by itself.

## What you need

- **A small Linux server** with a public IP address: 1 GB of memory is plenty. Any cloud provider's cheapest plan works (Hetzner, DigitalOcean, Vultr and so on, around $5 a month), with Ubuntu or Debian.
- **A domain name pointing at it**: an `A` record from a name you own (for example `anki.yourdomain.com`) to the server's IP address. If you don't have a domain, [DuckDNS](https://www.duckdns.org) gives out free ones (`yourname.duckdns.org`).
- Ports 80 and 443 open to the internet (Caddy needs 80 to get the certificate).

## Set it up

On the server:

```bash
curl -fsSL https://get.docker.com | sh                  # installs Docker
git clone https://github.com/fdsimms/flashcards.git     # or copy just this server/ folder over
cd flashcards/server
cp .env.example .env
nano .env                                               # set DOMAIN, ANKI_USER and ANKI_PASSWORD
docker compose up -d --build
```

Check it's running: open `https://<your domain>/health` in a browser. A blank page (rather than an error) means the server is up and the certificate works. If not, `docker compose logs` says why. The first start can take a minute while Caddy gets the certificate.

Your collections and media live in Docker's `anki-data` volume, which survives restarts and upgrades. Anki on your computer keeps its own backups as well.

**Upgrading Anki on the server:** set `ANKI_VERSION` in `.env` to the newer version (it should be at least as new as the newest Anki you sync with) and run `docker compose up -d --build` again.

## Move your devices over

Do this once, in this order:

1. **Sync everything with AnkiWeb one last time**, on your computer and in AnkiMobile, so your computer has everything.
2. **Anki on your computer:** Tools > Preferences > Syncing. Set the self-hosted sync server to `https://<your domain>/`. Sync, and sign in with the `ANKI_USER` and `ANKI_PASSWORD` from `.env`. The server starts empty, so Anki asks to upload: choose **Upload**. Let it sync media too.
3. **AnkiMobile:** in its settings, under syncing, set the custom sync server to the same address. Sync, sign in the same way, and choose **Download** when it asks.
4. **Franki:** tap **Anki**, then **Set up sync**, and enter the same address, user name and password. Franki downloads the collection, and from then on syncs on its own: when you open it, when you finish a deck, and when you leave the app.

If Franki has answers you gave before setting up sync that never went back to Anki, it asks before downloading, since a download would replace them. Choose **Upload Franki's** only if Franki has the newest copy of everything; it replaces what's on the server, and your other devices then download it.
