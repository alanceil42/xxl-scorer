# Installing xxl-scorer on your own server

A step-by-step guide for a Debian-style Linux server with nginx and systemd. Other setups work
too (it is a static site, see the README); this is the one the files in `contrib/` are written
for.

The examples put the site in **`/opt/xxl-scorer`** and serve it under **`/xxl/`**. Other places
work, but then change the paths in three files: `contrib/nginx/xxl-scorer.conf` (alias),
`contrib/systemd/xxl-scorer-gm.service` (ExecStart, WorkingDirectory, ReadWritePaths) and the
commands below.

Everything is run as root.


## 1. Get the files

Pick a release: the newest is at https://github.com/alanceil42/xxl-scorer/releases/latest
(main may hold changes that aren't released yet).

    apt install nginx curl jq                 # curl and jq only for step 3
    v=1.0                                     # the release to install
    git clone --branch v$v https://github.com/alanceil42/xxl-scorer.git /opt/xxl-scorer

Or without git, from the release archive:

    curl -fL -o /tmp/xxl-scorer.tgz \
        https://github.com/alanceil42/xxl-scorer/archive/refs/tags/v$v.tar.gz
    mkdir /opt/xxl-scorer && tar xzf /tmp/xxl-scorer.tgz -C /opt/xxl-scorer --strip-components=1

Nothing in there runs on the server: it is HTML, CSS and JavaScript for the browser, plus
the tools of step 3.


## 2. nginx

    cp /opt/xxl-scorer/contrib/nginx/xxl-scorer.conf /etc/nginx/snippets/xxl-scorer.conf

Then, in the `server { }` block of your site, add

    include snippets/xxl-scorer.conf;

and turn on gzip for JavaScript and JSON if it isn't on yet (the text recognition engine is
3.9 MB, 1.5 MB gzipped), in the `http { }` or `server { }` block:

    gzip on;
    gzip_types application/javascript text/javascript application/json;

    nginx -t && systemctl reload nginx

Open `https://your.host/xxl/`. It works now: the browser fetches the game data from GitHub
itself.

Better still, give it a host name of its own (`xxl.your.host`, with `location /` and the alias
in a `server { }` block of its own): browsers share stored data and logins between everything
on one host name.


## 3. Optional: game data from your own server

Without this, every visitor's browser downloads the game data from GitHub once a week. With
it, your server builds the file every Monday and the browsers fetch it from you.

    install -D -m 0644 /opt/xxl-scorer/contrib/sysusers.d/xxl-scorer.conf \
        /etc/sysusers.d/xxl-scorer.conf
    systemd-sysusers                          # creates the system user xxl-scorer
    install -d -o xxl-scorer -g xxl-scorer -m 0755 /opt/xxl-scorer/local/data
    cp /opt/xxl-scorer/contrib/systemd/xxl-scorer-gm.service \
        /opt/xxl-scorer/contrib/systemd/xxl-scorer-gm.timer /etc/systemd/system/
    systemctl daemon-reload
    systemctl start xxl-scorer-gm.service     # the first build, a few seconds
    journalctl -u xxl-scorer-gm -n 5          # "Wrote .../gm.json: 1024 species, ..."
    systemctl enable --now xxl-scorer-gm.timer

Point the page at the file:

    echo '{"gm": "local/data/gm.json"}' > /opt/xxl-scorer/local/config.json

The user xxl-scorer may write `local/data/` only, not the site and not `local/config.json`.
`systemd-analyze security xxl-scorer-gm.service` should say "OK".


## 4. Updating

Your settings and data live in `local/`, which no update touches.

What changed, and whether a file in `contrib/` has to be copied again: CHANGELOG.md, or the
release's page on GitHub. A new major version (2.0.0) means something has to be done; the
changelog says what.

With git:

    v=1.1                                     # the new release
    cd /opt/xxl-scorer && git fetch --tags && git checkout v$v

From the release archive: unpack the new version next to the old one, move `local/` over, swap:

    v=1.1
    curl -fL -o /tmp/xxl-scorer.tgz \
        https://github.com/alanceil42/xxl-scorer/archive/refs/tags/v$v.tar.gz
    rm -rf /tmp/xxl-scorer && mkdir /tmp/xxl-scorer
    tar xzf /tmp/xxl-scorer.tgz -C /tmp/xxl-scorer --strip-components=1 --no-same-permissions
    mv /opt/xxl-scorer/local /tmp/xxl-scorer/ 2>/dev/null
    rm -rf /opt/xxl-scorer.old && mv /opt/xxl-scorer /opt/xxl-scorer.old && mv /tmp/xxl-scorer /opt/

The previous version stays in `/opt/xxl-scorer.old` until the next update. If an update
changes a file in `contrib/`, copy it again.


## Removing it

    systemctl disable --now xxl-scorer-gm.timer
    rm /etc/systemd/system/xxl-scorer-gm.service /etc/systemd/system/xxl-scorer-gm.timer
    systemctl daemon-reload
    rm /etc/sysusers.d/xxl-scorer.conf && userdel xxl-scorer
    rm /etc/nginx/snippets/xxl-scorer.conf    # and the include line
    nginx -t && systemctl reload nginx
    rm -rf /opt/xxl-scorer /opt/xxl-scorer.old
