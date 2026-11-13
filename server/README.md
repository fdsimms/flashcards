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
nano .env                                               # set DOMAIN, ANKI_USER, ANKI_PASSWORD and TZ
docker compose up -d --build
```

Check it's running: open `https://<your domain>/health` in a browser. A blank page (rather than an error) means the server is up and the certificate works. If not, `docker compose logs` says why. The first start can take a minute while Caddy gets the certificate.

Your collections and media live in Docker's `anki-data` volume, which survives restarts and upgrades. Anki on your computer keeps its own backups as well.

**Keep it up to date on its own:** run `sh install-auto-update.sh` once, in this folder. Every 15 minutes the server then checks GitHub, and when anything in `server/` changed on `main`, it pulls the change and rebuilds. Sync and the MCP are down for a few seconds while it restarts. `journalctl -u franki-update` shows what it did, `sh update.sh` updates right away, and `systemctl disable --now franki-update.timer` turns it off. It only ever fast-forwards: if you edited files here by hand, it stops and says so in that log rather than merge over them (`.env` is yours and never touched). If the repository is private, the server needs a read-only deploy key to fetch it: GitHub's repository settings, Deploy keys.

**Upgrading Anki on the server:** the version is `ANKI_VERSION` in `docker-compose.yml` (keep it at least as new as the newest Anki you sync with), so with automatic updates on, a change to it on `main` reaches the server by itself. Setting `ANKI_VERSION` in `.env` overrides it, and then automatic updates leave the version alone.

## Move your devices over

Do this once, in this order:

1. **Sync everything with AnkiWeb one last time**, on your computer and in AnkiMobile, so your computer has everything.
2. **Anki on your computer:** Tools > Preferences > Syncing. Set the self-hosted sync server to `https://<your domain>/`. Sync, and sign in with the `ANKI_USER` and `ANKI_PASSWORD` from `.env`. The server starts empty, so Anki asks to upload: choose **Upload**. Let it sync media too.
3. **AnkiMobile:** in its settings, under syncing, set the custom sync server to the same address. Sync, sign in the same way, and choose **Download** when it asks.
4. **Franki:** tap **Settings**, then **Anki**, then **Set up sync**, and enter the same address, user name and password. Franki downloads the collection, and from then on syncs on its own: when you open it, when you finish a deck, and when you leave the app.

If Franki has answers you gave before setting up sync that never went back to Anki, it asks before downloading, since a download would replace them. Choose **Upload Franki's** only if Franki has the newest copy of everything; it replaces what's on the server, and your other devices then download it.

## Use it from Claude

The same server can run an MCP: a connector that lets Claude read and change your collection, on the web, in the Claude apps on your phone and computer, and in Claude Code. It's one more Anki client of your sync server, using Anki's own engine, so anything it changes reaches Anki, AnkiMobile and Franki at their next sync. It can:

- list decks and note types, and search notes with Anki's search syntax
- change a note type's card templates and styling, and build filtered decks
- add notes (with Anki's duplicate check), edit them, delete them, and manage tags
- suspend, bury, flag, move, reschedule, forget and reposition cards
- study a deck with you: it shows each question, then the answer, and rates the card only with your say-so
- show statistics and a card's FSRS memory state, and read, change and optimize a deck's FSRS settings
- store and delete images and sounds, and record audio for notes with Azure's voices, leveled to one loudness (ffmpeg, built into the image), and level the loudness of audio notes already have (`normalize_audio`)

**Turn it on.** In `.env`, remove the `#` in front of `COMPOSE_PROFILES=mcp` and set `MCP_PASSWORD` to a long password of its own (not the Anki one). For audio, also set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`: in the Azure portal, create a Speech resource (it has a free tier) and copy a key and its region (for example `westeurope`) from its Keys and Endpoint page. Then run `docker compose up -d --build` again. Check `https://<your domain>/mcp-health` shows `{"ok":true}`.

**Connect Claude.** The address is `https://<your domain>/mcp`.

- **Claude on the web, phone or desktop:** Settings > Connectors > Add custom connector, with that address. Claude opens a page asking for `MCP_PASSWORD`; enter it and choose **Connect**. A connector added on the web shows up in the apps too.
- **Claude Code:** `claude mcp add --transport http franki https://<your domain>/mcp`, then `/mcp` in Claude Code to sign in the same way.

Each Claude app asks for the password once; after that it stays signed in (it's asked again after 90 days without use). Changing `MCP_PASSWORD` doesn't sign out apps already connected: to do that, stop the MCP, delete `signins.sqlite` from its volume (`docker compose run --rm mcp rm /data/signins.sqlite`), and start it again.

**What it keeps.** The MCP keeps its own copy of the collection and its media in Docker's `mcp-data` volume, so the server holds your media twice. It syncs before it reads and after every change. If another device replaces the server's collection (a full sync), the MCP takes the new one, unless it has changes of its own that never reached the server, in which case it stops and says so rather than overwrite either.

**Upgrading:** the MCP's Anki version is in `mcp/requirements.txt`; keep it the same as `ANKI_VERSION`.

## Read & Listen

The same server can run Read & Listen's server (`reader/`): it writes short Thai and Spanish dialogues and stories from the words in your deck, checks they're mostly words you know, and records them with Azure's voices. It's one more Anki client of your sync server, and it only reads: it never answers, adds or changes cards. Its design is in `docs/read-and-listen/` at the top of this repository.

It needs more memory than the rest (up to about 350 MB with both languages), so the server may need **2 GB**. After the first texts are written, `docker stats --no-stream` shows how much each part uses. If it stops answering, `docker compose ps` shows it as unhealthy, and the update timer (above, `install-auto-update.sh`) restarts it within about 15 minutes.

**Turn it on.** In `.env`, add `reader` to `COMPOSE_PROFILES` (for example `COMPOSE_PROFILES=mcp,reader`) and set:

- `READER_PASSPHRASE`: a long passphrase of its own, typed once in the app. The MCP uses it too, to tell Claude what Read & Listen costs (`read_and_listen_costs`)
- `ANTHROPIC_API_KEY`: a Claude API key, for writing the texts
- `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`: the same ones as the MCP's audio (above). Both use the same Azure client (`speech/`). `AZURE_SPEECH_ENDPOINT` (optional, for both) replaces the region's own address, for a custom domain.
- `AZURE_VOICE_MALE` and `AZURE_VOICE_FEMALE` (optional): Thai's man's and woman's voices, when not `th-TH-NiwatNeural` and `th-TH-PremwadeeNeural` (renamed from `AZURE_VOICE_A` and `AZURE_VOICE_B`; a text now says which speaker is a man or a woman).
- `READER_BUCKET_*` (optional, recommended): an S3-compatible bucket that the database is backed up to continuously. When the database is missing (a new server, a lost volume), it's restored from there.

Then run `docker compose up -d --build`. Check `https://<your domain>/reader/health` shows `{"status":"ok"}`. Then in Franki, open **Settings**, **Read & Listen**, and enter the passphrase. Franki finds the server at `https://<your domain>/reader` by itself, from the sync settings.

**Show what's due in dundundun.** dundundun can add a "Franki" task when reviews are waiting, and a Read & Listen task when a text is waiting and none was read today. It reads `https://<your domain>/reader/api/status`, which says what's due (Anki's own counts) and nothing else. Set `READER_STATUS_TOKEN` in `.env` to a long key of its own and run `docker compose up -d` again, then enter that address and key in dundundun. The key opens that one route only, so dundundun never holds the passphrase. Set `TZ` too (above): the counts are for the study day in that time zone. For dundundun to count new cards the way Franki's deck list does (progress gates included), turn on **Share today's counts** in Franki's Settings, Read & Listen.

### Moving it from Fly

Read & Listen used to run on Fly.io, with its database backed up to a Tigris bucket. Keep using that bucket and the first start here restores everything (topics, texts, the reading log) from it. Only one server may write to the bucket at a time, so stop the Fly one first.

1. Copy the bucket's settings from the Fly machine while it's still running: `fly ssh console -a ailing -C "printenv BUCKET_NAME AWS_ENDPOINT_URL_S3 AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY"`. They go in `.env` in that order, as `READER_BUCKET_NAME`, `READER_BUCKET_ENDPOINT`, `READER_BUCKET_REGION`, `READER_BUCKET_KEY_ID` and `READER_BUCKET_SECRET`. Copy `ANTHROPIC_API_KEY` and the passphrase (`APP_PASSPHRASE` there, `READER_PASSPHRASE` here) from your password manager.
2. Stop the Fly server: `fly scale count 0 -a ailing`. Litestream sends its last changes as it stops.
3. Turn Read & Listen on here, as above. `docker compose logs reader` shows Litestream restoring the database, then the server starting.
4. In Franki, turn on Read & Listen with the same passphrase (Settings, Read & Listen). The old Read & Listen app can be deleted from the phone.
5. Leave the Fly app stopped rather than deleting it until you've checked the bucket survives without it: it was made with `fly storage create` for that app.

Audio already recorded on Fly isn't moved: each line is recorded again the first time it's played.
