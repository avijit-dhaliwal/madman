# Madman Los Angeles Chatbot

AI-powered style assistant for Madman Los Angeles streetwear brand. Features real-time inventory from Shopify and product card displays.

## Features

- Dark, edgy design matching Madman's aesthetic
- Real-time inventory sync from madmanlosangeles.com
- Product cards with images and prices
- AI-powered style recommendations via Google Gemini
- Cloudflare Workers backend with KV caching
- Vercel-ready frontend deployment

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Gemini API Key

```bash
npx wrangler secret put GEMINI_API_KEY
# Paste your Gemini API key when prompted
```

Get a key at: https://makersuite.google.com/app/apikey

### 3. Local Development

```bash
npm run dev
```

Visit http://localhost:8787

### 4. Deploy to Cloudflare

```bash
npm run deploy
```

### 5. Deploy Frontend to Vercel

1. Push this repo to GitHub
2. Import to Vercel
3. It will automatically use `public/` as the output directory
4. The API calls will be proxied to your Cloudflare Worker

## Products (Current Inventory)

The chatbot knows about these Madman products:

**In Stock:**
- Forsaken Hoodie - $95
- Forsaken Sweats - $95
- Carpenter Pants - $170 (Sale: $154)
- Carpenter Shorts - $120
- Hendrixx Tee - $54
- Punk Tee - $54
- Medallion Bracelet - $280
- Star Pendant - $360

**Sold Out:**
- 'Have I Gone Mad?' Hoodie
- 'Have I Gone Mad?' Sweats
- Chaos Erupts Tee
- Da Vinci Work Jacket

## Example Questions

- "What are your best sellers?"
- "Show me your hoodies"
- "What tees do you have?"
- "What's good for a night out?"
- "Show me your accessories"

## Architecture

```
public/
  index.html    - Frontend UI
  script.js     - Client-side logic
src/
  worker.js     - Cloudflare Worker (API + inventory)
```

## Brand Info

- Website: https://madmanlosangeles.com
- Instagram: @madmanlosangeles
- Tagline: "What's Done in the Dark Must Come to Light"
- Free shipping on orders over $200
