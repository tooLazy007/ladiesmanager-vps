# Ladies Manager - VPS Deployment Guide

Komplette Anleitung für das Setup auf deinem Hostinger VPS.

---

## 📋 Übersicht

**Was wird installiert:**
- Express Web Server (Port 3000)
- PM2 Process Manager (Auto-Restart)
- Nginx Reverse Proxy (Port 80/443)
- SSL Certificate (Let's Encrypt)
- Automatischer Download aller generierten Bilder/Videos

**VPS Info:**
- IP: `92.113.21.7`
- OS: Ubuntu 24.04 LTS
- URL: `https://ladiesmanager.srv879239.hstgr.cloud`

---

## 🚀 Installation (Step-by-Step)

### Schritt 1: SSH Login

```bash
ssh root@92.113.21.7
```

Passwort eingeben.

---

### Schritt 2: Dateien hochladen

**Option A: Via SCP (von deinem lokalen PC)**

```bash
# Alle Dateien in einen Ordner (z.B. ladiesmanager-vps)
scp -r ladiesmanager-vps root@92.113.21.7:/root/
```

**Option B: Via SFTP (FileZilla/WinSCP)**

1. Host: `92.113.21.7`
2. User: `root`
3. Port: `22`
4. Alle Dateien hochladen nach: `/root/ladiesmanager-vps/`

**Option C: Via Git (empfohlen)**

```bash
# Auf dem VPS:
cd /root
git clone <dein-repo-url> ladiesmanager-vps
cd ladiesmanager-vps
```

---

### Schritt 3: Setup-Script ausführen

```bash
cd /root/ladiesmanager-vps
chmod +x setup-vps.sh
./setup-vps.sh
```

**Das Script macht automatisch:**
- ✅ System Update
- ✅ Zombie Cleanup
- ✅ Node.js Installation (falls nicht vorhanden)
- ✅ PM2 Installation
- ✅ Nginx Installation & Konfiguration
- ✅ Firewall Setup
- ✅ Service Start

**Dauer:** ~5-10 Minuten

---

### Schritt 4: Airtable Credentials eintragen

```bash
nano config.json
```

**Trage ein:**
1. `token`: Dein Airtable API Token
2. `baseId`: Deine Airtable Base ID

**So bekommst du die Werte:**

**Airtable Token:**
1. Gehe zu: https://airtable.com/create/tokens
2. Klicke "Create new token"
3. Name: `Ladies Manager VPS`
4. Add Scopes: **ALLE auswählen** (data.records:read, data.records:write, etc.)
5. Add Access: Wähle deine Base (Ladies Manager)
6. Create Token
7. **Kopiere Token** (wird nur einmal angezeigt!)

**Base ID:**
1. Öffne deine Airtable Base
2. URL sieht so aus: `https://airtable.com/app1234567890ABC/tbl...`
3. Kopiere den Teil `app1234567890ABC`

**Speichern:**
- `Strg + O` → Enter
- `Strg + X`

---

### Schritt 5: API Keys in Airtable eintragen

Öffne deine Airtable Base → **Configuration** Tabelle:

**Pflichtfelder:**
1. **FAL_API_KEY**
   - Gehe zu: https://fal.ai/
   - Login → Settings → API Keys
   - Create Key → Kopieren

2. **Gemini_API_Key** (optional, aber empfohlen)
   - Gehe zu: https://aistudio.google.com/app/apikey
   - Create API Key
   - Kopieren

3. **Face_Reference** (2 Bilder)
   - Upload 2 Gesichts-Referenzbilder
   - Sollten das Gesicht deines AI Influencers zeigen

4. **Body_Reference** (2 Bilder)
   - Upload 2 Körper-Referenzbilder
   - Sollten den Körper deines AI Influencers zeigen

**Weitere Einstellungen:**
- `Enable_NSFW`: ☑️ / ☐
- `Image_Size`: `2048x2048`
- `num_images`: `6` (1-6)
- `Enable_Video`: ☑️ / ☐
- `Video_Duration`: `5` oder `10`

---

### Schritt 6: Service starten

```bash
pm2 restart ladiesmanager
pm2 save
```

**Status prüfen:**
```bash
pm2 list
pm2 logs ladiesmanager
```

---

### Schritt 7: SSL Certificate einrichten (Optional)

**Nur wenn du HTTPS willst:**

```bash
certbot --nginx -d ladiesmanager.srv879239.hstgr.cloud
```

**Fragen beantworten:**
- Email: Deine E-Mail
- Terms: `Y`
- HTTPS redirect: `Y`

**Fertig!** Deine Seite ist jetzt unter HTTPS erreichbar.

---

## 🎯 Nutzung

### User Workflow:

1. **Prompts in Airtable eintragen**
   - Öffne Airtable → Generation Table
   - Füge neue Zeilen mit Prompts hinzu
   - Optional: Upload Prompt_Image für Gemini-Analyse

2. **Generation starten**
   - Browser öffnen: `https://ladiesmanager.srv879239.hstgr.cloud`
   - Seite lädt → Generation startet automatisch
   - Live Progress wird angezeigt

3. **Warten & Download**
   - Nach 2-10 Min (je nach Anzahl): Fertig!
   - Button erscheint: "📦 Alle Bilder & Videos herunterladen"
   - Klicken → ZIP-Download startet

4. **Ergebnisse in Airtable**
   - Alle Bilder/Videos sind auch in Airtable sichtbar
   - Einzeln downloadbar oder ansehbar

---

## 🛠️ Wichtige Kommandos

### PM2 (Process Management)

```bash
# Service Status
pm2 list

# Logs ansehen (Live)
pm2 logs ladiesmanager

# Service neu starten
pm2 restart ladiesmanager

# Service stoppen
pm2 stop ladiesmanager

# Service komplett entfernen
pm2 delete ladiesmanager

# Auto-Start aktivieren
pm2 save
pm2 startup

# Ressourcen-Monitor
pm2 monit
```

### Nginx (Web Server)

```bash
# Status prüfen
systemctl status nginx

# Neu starten
systemctl restart nginx

# Config testen
nginx -t

# Logs ansehen
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Logs prüfen

```bash
# PM2 Logs
pm2 logs ladiesmanager --lines 100

# System Logs
journalctl -u nginx -f

# Disk Space
df -h

# Memory Usage
free -h

# Running Processes
htop
```

---

## 🔧 Troubleshooting

### Problem: "Cannot connect to server"

**Lösung 1: Service prüfen**
```bash
pm2 list
# Falls gestoppt:
pm2 restart ladiesmanager
```

**Lösung 2: Port prüfen**
```bash
netstat -tulpn | grep 3000
# Sollte zeigen: node listening on 0.0.0.0:3000
```

**Lösung 3: Nginx prüfen**
```bash
systemctl status nginx
nginx -t
systemctl restart nginx
```

---

### Problem: "Generation startet nicht"

**Check 1: Airtable Credentials**
```bash
cat config.json
# Token und baseId korrekt?
```

**Check 2: API Keys in Airtable**
- Öffne Airtable → Configuration
- FAL_API_KEY vorhanden?
- Face_Reference & Body_Reference hochgeladen?

**Check 3: Logs prüfen**
```bash
pm2 logs ladiesmanager --lines 50
# Fehlermeldungen?
```

---

### Problem: "Out of Memory"

**Lösung: Swap Space erhöhen**
```bash
# 2GB Swap anlegen
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Permanent machen
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

### Problem: "Zombie Processes"

**Lösung:**
```bash
# Zombies anzeigen
ps aux | grep Z

# Zombies killen
ps aux | grep 'Z' | awk '{print $2}' | xargs -r kill -9

# Oder Script neu ausführen
./setup-vps.sh
```

---

### Problem: "n8n läuft nicht mehr"

**Check:**
```bash
pm2 list
# n8n sollte in der Liste sein

# Falls nicht:
systemctl status n8n

# Oder manuell starten (falls du weißt wie)
```

**Wichtig:** Das Setup-Script schützt n8n automatisch!

---

### Problem: "SSL Certificate Error"

**Lösung 1: Erneut anlegen**
```bash
certbot --nginx -d ladiesmanager.srv879239.hstgr.cloud --force-renewal
```

**Lösung 2: DNS prüfen**
```bash
dig ladiesmanager.srv879239.hstgr.cloud
# Sollte zu 92.113.21.7 auflösen
```

---

### Problem: "Download funktioniert nicht"

**Check 1: Downloads Ordner**
```bash
ls -la /root/ladiesmanager-vps/downloads/
# Bilder vorhanden?
```

**Check 2: Permissions**
```bash
chmod -R 755 /root/ladiesmanager-vps/downloads/
```

**Check 3: Disk Space**
```bash
df -h
# Genug Platz auf /root?
```

---

## 📊 Performance Tuning

### Für viele parallele Generierungen:

**1. Erhöhe Memory Limit (PM2)**
```bash
pm2 stop ladiesmanager
pm2 start server.js --name ladiesmanager --max-memory-restart 1G
pm2 save
```

**2. Nginx Timeouts erhöhen**
```bash
nano /etc/nginx/sites-available/ladiesmanager
```

Füge hinzu:
```nginx
proxy_read_timeout 1200s;
proxy_connect_timeout 1200s;
proxy_send_timeout 1200s;
```

```bash
nginx -t
systemctl reload nginx
```

---

## 🔐 Sicherheit

### Firewall Status

```bash
ufw status
```

**Sollte zeigen:**
```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

### Logs regelmäßig prüfen

```bash
# Wer hat auf den Server zugegriffen?
tail -f /var/log/nginx/access.log

# Fehlgeschlagene SSH-Logins?
tail -f /var/log/auth.log
```

---

## 🔄 Updates

### System Updates

```bash
apt-get update
apt-get upgrade -y
```

### Node.js Updates

```bash
npm install -g n
n latest
```

### Code Updates (falls du Änderungen machst)

```bash
cd /root/ladiesmanager-vps
git pull  # Falls Git
pm2 restart ladiesmanager
```

---

## 📁 Dateistruktur

```
/root/ladiesmanager-vps/
├── server.js                    # Express Web Server
├── batch-processor-vps.js       # Batch Processor (nur FAL.ai)
├── config.json                  # Airtable Credentials
├── package.json                 # Dependencies
├── ecosystem.config.js          # PM2 Config
├── setup-vps.sh                 # Setup Script
├── public/
│   └── index.html               # Frontend UI
├── downloads/                   # Generierte Bilder/Videos
└── logs/                        # PM2 Logs
```

---

## 🆘 Support

### Logs teilen (für Debugging)

```bash
# Letzte 100 Zeilen PM2 Logs
pm2 logs ladiesmanager --lines 100 > debug.log

# Nginx Error Log
tail -100 /var/log/nginx/error.log > nginx-debug.log

# System Info
uname -a > system-info.txt
free -h >> system-info.txt
df -h >> system-info.txt
```

### Hilfreiche Links

- Airtable Docs: https://airtable.com/developers/web/api
- FAL.ai Docs: https://fal.ai/models
- PM2 Docs: https://pm2.keymetrics.io/docs/usage/quick-start/
- Nginx Docs: https://nginx.org/en/docs/

---

## ✅ Checkliste nach Setup

- [ ] `./setup-vps.sh` ausgeführt
- [ ] `config.json` ausgefüllt (token + baseId)
- [ ] Airtable Configuration Table ausgefüllt (FAL_API_KEY, Face/Body Reference)
- [ ] `pm2 list` zeigt "ladiesmanager" als "online"
- [ ] Browser: `http://ladiesmanager.srv879239.hstgr.cloud` erreichbar
- [ ] Optional: SSL mit `certbot` eingerichtet
- [ ] n8n läuft weiterhin (falls du es nutzt)
- [ ] Test-Generation durchgeführt

---

**🎉 Fertig! Dein Ladies Manager läuft jetzt 24/7 auf deinem VPS!**
