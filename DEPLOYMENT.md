# Deployment Guide
## Voice Reader Phase 2 → Netlify

**Timestamp:** 2:20PM, 12.10.24  
**Document ID:** VR-DOC-Deployment-Guide-241210-1420

---

## 🎯 **Prerequisites**

Before deploying, ensure you have:

✅ Netlify account (free tier works)  
✅ API keys for providers you want to use:
   - OpenAI: https://platform.openai.com/api-keys
   - Azure Speech: https://azure.microsoft.com/en-us/services/cognitive-services/speech-services/
   - ElevenLabs: https://elevenlabs.io/app/settings/api-keys
✅ Git repository (GitHub, GitLab, or Bitbucket)  
✅ Node.js 18+ installed locally

---

## 🚀 **Deployment Method 1: Netlify CLI (Recommended)**

### **Step 1: Install Netlify CLI**
```bash
npm install -g netlify-cli
```

### **Step 2: Login to Netlify**
```bash
netlify login
```
This opens a browser window to authenticate.

### **Step 3: Initialize Site**
```bash
cd voice-reader-phase2
netlify init
```

Follow the prompts:
- Create new site or link existing?
- Choose your team
- Site name (optional)
- Build command: (leave blank or press Enter)
- Publish directory: `public`
- Functions directory: `api`

### **Step 4: Add Environment Variables**
```bash
# Add each API key
netlify env:set OPENAI_API_KEY "sk_your_key_here"
netlify env:set AZURE_SPEECH_KEY "your_azure_key"
netlify env:set ELEVENLABS_API_KEY "your_elevenlabs_key"
```

Or add via Netlify UI:
1. Go to Site settings → Environment variables
2. Add each key

### **Step 5: Deploy**
```bash
# Deploy to draft URL first
netlify deploy

# If everything works, deploy to production
netlify deploy --prod
```

### **Step 6: Test Deployment**
```bash
# Your site will be live at:
# https://your-site-name.netlify.app
```

Test the API endpoints:
```bash
# Test voices endpoint
curl https://your-site-name.netlify.app/.netlify/functions/get-voices

# Test cost estimate
curl -X POST https://your-site-name.netlify.app/.netlify/functions/cost-estimate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world","providers":["openai","azure"]}'
```

---

## 🌐 **Deployment Method 2: Git-based Deploy**

### **Step 1: Push to GitHub**
```bash
cd voice-reader-phase2
git init
git add .
git commit -m "Phase 2 complete architecture"
git remote add origin https://github.com/your-username/voice-reader.git
git push -u origin main
```

### **Step 2: Connect to Netlify**
1. Go to https://app.netlify.com
2. Click "Add new site" → "Import an existing project"
3. Choose your Git provider (GitHub)
4. Select your repository
5. Configure build settings:
   - **Build command:** (leave blank)
   - **Publish directory:** `public`
   - **Functions directory:** `api`

### **Step 3: Add Environment Variables**
1. Go to Site settings → Environment variables
2. Add each API key:
   - `OPENAI_API_KEY`
   - `AZURE_SPEECH_KEY`
   - `ELEVENLABS_API_KEY`

### **Step 4: Deploy**
Click "Deploy site" - it will auto-deploy on every push to main.

---

## 📁 **File Structure for Deployment**

Make sure your repository has this structure:
```
voice-reader-phase2/
├── api/                    # ← Functions (Netlify will find these)
│   ├── tts-proxy.js
│   ├── cost-estimate.js
│   └── get-voices.js
├── core/                   # ← Imported by functions
│   ├── cost-estimator.js
│   ├── error-handler.js
│   └── ...
├── config/                 # ← Imported by functions
│   └── providers.js
├── utils/                  # ← Imported by functions
│   └── logger.js
├── public/                 # ← Static files (HTML, CSS, JS)
│   └── index.html
├── netlify.toml           # ← Netlify config
├── package.json
└── README.md
```

---

## 🔧 **Environment Variables Checklist**

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Optional | OpenAI TTS API access |
| `AZURE_SPEECH_KEY` | Optional | Azure Speech Services |
| `ELEVENLABS_API_KEY` | Optional | ElevenLabs API access |

**Note:** At least one provider key is required for the app to work (or use Local provider which needs no key).

---

## 🧪 **Testing Your Deployment**

### **Test 1: Functions Work**
```bash
curl https://your-site.netlify.app/.netlify/functions/get-voices
```
Should return: `{"success":true,"providers":[...]}`

### **Test 2: Cost Estimate**
```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/cost-estimate \
  -H "Content-Type: application/json" \
  -d '{"text":"Test","providers":["openai"]}'
```
Should return cost estimate.

### **Test 3: TTS Generation**
```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/tts-proxy \
  -H "Content-Type: application/json" \
  -d '{
    "providerId":"openai",
    "text":"Hello world",
    "voice":"alloy"
  }'
```
Should return base64 audio.

---

## 🐛 **Troubleshooting**

### **Problem: "Function not found"**
**Solution:**
1. Check `netlify.toml` has correct functions directory
2. Verify files are in `/api` folder
3. Redeploy: `netlify deploy --prod`

### **Problem: "API key not configured"**
**Solution:**
1. Go to Site settings → Environment variables
2. Add missing API key
3. Redeploy (environment changes require redeploy)

### **Problem: "Module not found"**
**Solution:**
1. Check `included_files` in `netlify.toml`
2. Ensure all imported modules are in the repo
3. Verify imports use correct relative paths

### **Problem: "CORS errors"**
**Solution:**
1. Check `netlify.toml` has CORS headers
2. Verify `api/*` endpoints include CORS in response
3. Check browser console for specific error

### **Problem: Rate limit errors**
**Solution:**
1. Implement request throttling in frontend
2. Consider caching responses
3. Check provider rate limits are correctly configured

---

## 📊 **Monitoring Your Deployment**

### **Netlify Dashboard**
- **Functions:** See invocation count, errors, duration
- **Logs:** Real-time function logs
- **Analytics:** Traffic, bandwidth, build minutes

### **Enable Function Logs**
Functions automatically log to Netlify. View them:
1. Go to Site → Functions
2. Click on a function
3. View logs in real-time

---

## 🔐 **Security Checklist**

Before going live:

- [ ] API keys stored ONLY in Netlify environment variables
- [ ] No API keys in code or git history
- [ ] CORS headers properly configured
- [ ] Rate limiting enabled
- [ ] Error messages don't expose sensitive data
- [ ] Functions validate all inputs

---

## 🚀 **Optimization Tips**

### **1. Enable Caching**
Add to `netlify.toml`:
```toml
[[headers]]
  for = "/.netlify/functions/get-voices"
  [headers.values]
    Cache-Control = "public, max-age=3600"
```

### **2. Use Edge Functions (Future)**
For even faster response times, consider migrating to Netlify Edge Functions.

### **3. Enable Compression**
Netlify automatically compresses responses, but ensure large payloads are handled efficiently.

---

## 📱 **Custom Domain (Optional)**

### **Step 1: Add Domain in Netlify**
1. Go to Site settings → Domain management
2. Click "Add custom domain"
3. Enter your domain

### **Step 2: Configure DNS**
Point your domain's DNS to Netlify:
- CNAME: `your-site.netlify.app`

### **Step 3: Enable HTTPS**
Netlify automatically provisions SSL certificates via Let's Encrypt.

---

## 🎓 **Next Steps**

After successful deployment:

1. ✅ Test all endpoints
2. ✅ Monitor function logs
3. ✅ Set up error alerting
4. ✅ Document API for frontend team
5. ✅ Begin Phase 3 planning (authentication, billing)

---

## 📞 **Support Resources**

- **Netlify Docs:** https://docs.netlify.com
- **Netlify Community:** https://answers.netlify.com
- **Netlify Status:** https://netlifystatus.com
- **This Project:** [Internal documentation]

---

**Deployment Guide Complete**

*Ready to deploy? Run `netlify deploy --prod` and go live! 🚀*

---

**Timestamp:** 2:20PM, 12.10.24  
**Document ID:** VR-DOC-Deployment-Guide-241210-1420
