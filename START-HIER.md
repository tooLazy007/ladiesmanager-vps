# 🚀 Ladies Manager - VPS Setup

**Status:** ✅ Alle 8 Dateien erstellt und bereit zum Deployment!

---

## 📦 Was du gerade heruntergeladen hast:

```
ladiesmanager-vps/
├── START-HIER.md               ← DU BIST HIER!
├── VPS-DEPLOYMENT.md           ← KOMPLETTE Anleitung (lies das als erstes!)
├── server.js                   ← Express Web Server
├── batch-processor-vps.js      ← Batch Processor (FAL.ai only)
├── config.json                 ← Airtable Credentials (musst du ausfüllen!)
├── package.json                ← npm Dependencies
├── ecosystem.config.js         ← PM2 Config
├── setup-vps.sh                ← Automatisches Setup Script
└── public/
    └── index.html              ← Frontend UI
```

---

## ⚡ Quick Start (5 Minuten)

### 1️⃣ Dateien auf VPS hochladen

**Option A: Via SCP (Terminal/CMD)**
```bash
scp -r ladiesmanager-vps root@92.113.21.7:/root/
```

**Option B: Via FileZilla/WinSCP**
- Host: `92.113.21.7`
- User: `root`
- Port: `22`
- Hochladen nach: `/root/`

---

### 2️⃣ SSH Login & Setup ausführen

```bash
ssh root@92.113.21.7
cd /root/ladiesmanager-vps
chmod +x setup-vps.sh
./setup-vps.sh
```

**Das Script macht ALLES automatisch!** (5-10 Min)

---

### 3️⃣ Config ausfüllen

```bash
nano config.json
```

Trage ein:
- **token**: Dein Airtable API Token
- **baseId**: Deine Airtable Base ID

[Wie du die bekommst → siehe VPS-DEPLOYMENT.md Schritt 4]

---

### 4️⃣ Service starten

```bash
pm2 restart ladiesmanager
pm2 save
```

---

### 5️⃣ Testen!

**Browser öffnen:**
```
http://ladiesmanager.srv879239.hstgr.cloud
```

**Generation startet automatisch!** ✨

---

## 📚 Wichtige Dokumente

1. **VPS-DEPLOYMENT.md** ← Komplette Step-by-Step Anleitung
   - Installation
   - Konfiguration
   - Troubleshooting
   - Alle Kommandos

2. **config.json** ← Hier trägst du deine Airtable Credentials ein

3. **setup-vps.sh** ← Automatisches Setup Script

---

## ⚙️ Was wurde geändert?

### ✅ Entfernt:
- ❌ Wavespeed AI (nur noch FAL.ai)
- ❌ Cloudflare Worker Code
- ❌ Lokale .bat Dateien

### ✅ Neu hinzugefügt:
- ✅ Express Web Server (Port 3000)
- ✅ HTML Frontend mit Live Progress
- ✅ ZIP-Download aller Bilder/Videos
- ✅ PM2 Auto-Restart
- ✅ Nginx Reverse Proxy
- ✅ SSL-Ready (Let's Encrypt)

### ✅ Behalten:
- ✅ FAL.ai Seedream (Bilder)
- ✅ FAL.ai Kling (Videos)
- ✅ Google Gemini (Prompt-Generierung)
- ✅ Alle Airtable Features
- ✅ Rate Limiting & Circuit Breaker
- ✅ Face + Body + Prompt_Image References

---

## 🎯 User Workflow (nach Setup):

1. **Prompts in Airtable eintragen**
   → Generation Table → Neue Zeilen hinzufügen

2. **Browser öffnen**
   → `https://ladiesmanager.srv879239.hstgr.cloud`

3. **Warten**
   → Live Progress wird angezeigt (2-10 Min)

4. **Download**
   → Button "📦 Alle Bilder herunterladen" → ZIP-Download

**So einfach ist das!** 🎉

---

## 🆘 Hilfe

**Problem beim Setup?**
→ Lies **VPS-DEPLOYMENT.md** → Abschnitt "Troubleshooting"

**Service läuft nicht?**
```bash
pm2 logs ladiesmanager
```

**n8n kaputt?**
→ Das Setup-Script schützt n8n automatisch, sollte nicht passieren!

**Andere Fragen?**
→ Schau in **VPS-DEPLOYMENT.md** → Alle Kommandos & Lösungen

---

## ✅ Next Steps

1. [ ] Dateien auf VPS hochgeladen
2. [ ] `setup-vps.sh` ausgeführt
3. [ ] `config.json` ausgefüllt
4. [ ] Airtable Configuration Table ausgefüllt (FAL_API_KEY, etc.)
5. [ ] Service läuft (`pm2 list`)
6. [ ] URL im Browser getestet
7. [ ] Erste Test-Generation erfolgreich

---

**🎉 Viel Erfolg! Bei Fragen → VPS-DEPLOYMENT.md lesen!**
