# Environment Quick Reference

## 🎯 TL;DR

### **On Your Laptop**
```bash
# Your .env is already set for laptop (32GB RAM, 8 threads)
npm run electron:dev
```

### **On Production Server**
```bash
# First time setup on server:
npm run env:prod
# Edit .env to set server paths
# Then start:
npm run all
```

---

## 📋 Quick Commands

| What You Want | Command |
|---------------|---------|
| Start app on laptop | `npm run electron:dev` |
| Start services on server | `npm run all` |
| Switch to laptop settings | `npm run env:dev` |
| Switch to server settings | `npm run env:prod` |
| Check current environment | `npm run env:status` |
| View full config | `npm run config` |

---

## 🔄 Deployment Workflow

```bash
# 1. On Laptop: Make changes and push
git add .
git commit -m "your changes"
git push

# 2. On Server: Pull and restart
git pull
npm run all
```

**Your `.env` files are NEVER overwritten!** ✅

---

## ⚙️ Settings Comparison

| Setting | Laptop (Dev) | Server (Prod) |
|---------|--------------|---------------|
| RAM | 32GB | 64GB+ |
| VIPS Threads | 12 | 36 |
| VIPS Memory | 12GB | 45GB |
| Node Heap | 3GB | 4GB |
| Conversion Time (2GB file) | 20-30 min | 8-11 min |

---

## 📁 File Structure

```
.env                        ← Active config (gitignored, stays local)
.env.development.example    ← Laptop template (tracked in git)
.env.production.example     ← Server template (tracked in git)
```

**Key Point**: Your local `.env` never gets committed or overwritten!

---

For detailed information, see **ENVIRONMENT_SETUP.md**
