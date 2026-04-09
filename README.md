## VyaparAI WhatsApp Bot (Backend Only)

WhatsApp-native Kirana store management bot.
No website, no frontend.

### Tech stack
- Node.js + Express
- Twilio WhatsApp API
- Supabase

## First feature implemented
If owner sends:

`Sharma ji 500 udhaar`

Bot will:
1. Save entry in Supabase table `udhaar_logs`
2. Reply:
`✅ Sharma ji ka ₹500 udhaar logged!`

## Project structure
- `src/server.js` - starts Express server
- `src/app.js` - Express app setup + routes
- `src/routes/webhookRoutes.js` - WhatsApp webhook routes
- `src/controllers/webhookController.js` - webhook verify + message handling
- `src/services/udhaarService.js` - Supabase insert logic
- `src/services/whatsappService.js` - send WhatsApp message via Twilio API
- `src/utils/parseUdhaarMessage.js` - parses text like "`name amount udhaar`"
- `src/config/env.js` - loads and validates env vars
- `src/config/supabase.js` - initializes Supabase client
- `.env.example` - env template

## Setup
1. Install:
```bash
npm install
```

2. Create env file:
```bash
cp .env.example .env
```
On Windows PowerShell:
```powershell
Copy-Item .env.example .env
```

3. Fill all values in `.env`

4. Run:
```bash
npm run dev
```

5. Configure webhook in Twilio:
- Webhook URL: `https://your-domain.com/webhook`

## Test quickly
Send WhatsApp message from allowed test number:

`Sharma ji 500 udhaar`

Check Supabase table `udhaar_logs`.
