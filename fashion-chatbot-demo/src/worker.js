// Madman Los Angeles - Cloudflare Worker
// Chatbot API with real-time inventory from Shopify

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(updateInventory(env));
  },

  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Serve static files from public directory (for Vercel)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML_CONTENT, {
        headers: { 'Content-Type': 'text/html', ...corsHeaders },
      });
    }

    // Products API
    if (url.pathname === '/api/products' && request.method === 'GET') {
      try {
        let inventoryData = await env.INVENTORY?.get('current_inventory', { type: 'json' });
        if (!inventoryData) {
          inventoryData = getDefaultInventoryData();
        }
        return new Response(JSON.stringify(inventoryData), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify(getDefaultInventoryData()), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // Chat API
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const { message } = await request.json();

        let inventoryData = null;
        try {
          inventoryData = await env.INVENTORY?.get('current_inventory', { type: 'json' });
        } catch (e) {
          console.error('KV fetch error:', e);
        }

        if (!inventoryData) {
          inventoryData = getDefaultInventoryData();
        }

        const inventoryPrompt = formatInventoryForPrompt(inventoryData);

        // Call Gemini API
        const geminiResponse = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + env.GEMINI_API_KEY,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              generationConfig: {
                maxOutputTokens: 1024,
                temperature: 0.7,
              },
              contents: [{
                parts: [{
                  text: `You are the personal style assistant for Madman Los Angeles, an edgy streetwear brand from LA. Your tone is cool, confident, and slightly mysterious - matching the brand's "What's Done in the Dark Must Come to Light" tagline.

PERSONALITY:
- Cool and confident, never overly enthusiastic
- Mysterious edge, like you know something others don't
- Direct and helpful, no fluff
- Use occasional slang but keep it natural
- Never use markdown formatting (no ** or * or #)
- Never use emojis

PRODUCT FORMATTING:
- When recommending products, use this EXACT format on its own line:
PRODUCT:Product Name
- The frontend will automatically display product cards with images
- Example response:
"Check out the Forsaken Hoodie - perfect for that dark aesthetic.

PRODUCT:Forsaken Hoodie

Goes hard with basically anything."

BRAND INFO:
- Madman Los Angeles is an edgy streetwear brand
- Tagline: "What's Done in the Dark Must Come to Light"
- Based in Los Angeles
- Aesthetic: Dark, rebellious, punk-influenced streetwear
- Free shipping on orders over $200
- Website: madmanlosangeles.com

${inventoryPrompt}

RULES:
- Only recommend products that are IN STOCK
- Never recommend sold out items
- If asked about sold out items, suggest similar available alternatives
- Keep responses concise and cool
- For sizing questions, recommend checking the size chart on the product page
- Contact: DM on Instagram @madmanlosangeles

Customer says: ${message}`
                }]
              }],
            }),
          }
        );

        const data = await geminiResponse.json();

        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          let reply = data.candidates[0].content.parts[0].text;
          reply = reply.replace(/\*\*/g, '').replace(/\*/g, '').replace(/###/g, '').replace(/##/g, '').replace(/#/g, '');
          reply = reply.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

          // Extract products mentioned for direct card display
          const productMatches = reply.match(/PRODUCT:([^\n]+)/g) || [];
          const products = productMatches.map(match => {
            const productName = match.replace('PRODUCT:', '').trim();
            return findProductByName(inventoryData, productName);
          }).filter(Boolean);

          return new Response(JSON.stringify({ reply, products }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } else {
          throw new Error('Invalid Gemini response');
        }
      } catch (error) {
        console.error('Chat error:', error);
        return new Response(JSON.stringify({
          reply: "Having some issues right now. Try again in a sec.",
          products: []
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};

function findProductByName(inventoryData, name) {
  if (!inventoryData?.products) return null;
  const searchName = name.toLowerCase();
  return inventoryData.products.find(p =>
    p.name.toLowerCase().includes(searchName) ||
    searchName.includes(p.name.toLowerCase())
  );
}

async function updateInventory(env) {
  try {
    const inventoryData = await fetchMadmanInventory();
    if (env.INVENTORY) {
      await env.INVENTORY.put('current_inventory', JSON.stringify(inventoryData), {
        expirationTtl: 3600,
      });
    }
    return inventoryData;
  } catch (error) {
    console.error('Inventory update error:', error);
    return getDefaultInventoryData();
  }
}

async function fetchMadmanInventory() {
  try {
    // Fetch from Shopify storefront
    const response = await fetch('https://madmanlosangeles.com/collections/all/products.json');
    if (!response.ok) throw new Error('Failed to fetch products');

    const data = await response.json();
    return parseShopifyProducts(data.products || []);
  } catch (error) {
    console.error('Shopify fetch error:', error);
    return getDefaultInventoryData();
  }
}

function parseShopifyProducts(products) {
  const available = [];
  const soldOut = [];

  products.forEach(product => {
    const name = product.title;
    const price = product.variants?.[0]?.price ? `$${product.variants[0].price}` : 'Price TBD';
    const comparePrice = product.variants?.[0]?.compare_at_price;
    const salePrice = comparePrice ? `$${product.variants[0].price}` : null;
    const originalPrice = comparePrice ? `$${comparePrice}` : price;

    // Check stock across all variants
    const totalStock = product.variants?.reduce((sum, v) => {
      return sum + (v.inventory_quantity || 0);
    }, 0) || 0;

    const isAvailable = product.variants?.some(v => v.available) || false;

    // Get image
    const imageUrl = product.images?.[0]?.src || product.image?.src || '';

    // Get product URL
    const url = `https://madmanlosangeles.com/products/${product.handle}`;

    const productData = {
      name,
      price: originalPrice,
      salePrice: salePrice,
      url,
      imageUrl,
      stock: totalStock,
      available: isAvailable,
      handle: product.handle,
      tags: product.tags || [],
    };

    if (isAvailable) {
      available.push(productData);
    } else {
      soldOut.push(name);
    }
  });

  return {
    products: available,
    soldOut,
    lastUpdated: new Date().toISOString(),
  };
}

function formatInventoryForPrompt(inventoryData) {
  if (!inventoryData?.products) return getDefaultInventory();

  let prompt = `CURRENT INVENTORY (Last Updated: ${new Date(inventoryData.lastUpdated).toLocaleString()}):

IN STOCK PRODUCTS:
`;

  inventoryData.products.forEach(product => {
    const stockInfo = product.stock > 20 ? 'In Stock' :
                      product.stock > 5 ? 'Limited Stock' :
                      product.stock > 0 ? `Low Stock (${product.stock} left)` : 'In Stock';
    prompt += `- ${product.name} - ${product.price} [${stockInfo}]\n`;
  });

  if (inventoryData.soldOut?.length > 0) {
    prompt += `
SOLD OUT (DO NOT RECOMMEND):
`;
    inventoryData.soldOut.forEach(item => {
      prompt += `- ${item}\n`;
    });
  }

  return prompt;
}

function getDefaultInventory() {
  return `CURRENT INVENTORY:

IN STOCK:
- Forsaken Hoodie - $95 [In Stock] - Black hoodie with edgy distressed graphics
- Forsaken Sweats - $95 [In Stock] - Matching sweats for the Forsaken set
- Carpenter Pants - $170 [In Stock] - Premium workwear-inspired pants
- Carpenter Shorts - $120 [Limited Stock] - Workwear shorts
- Hendrixx Tee - $54 [In Stock] - Graphic tee with vintage-inspired design
- Punk Tee - $54 [In Stock] - Bold punk aesthetic graphic tee
- Washed Logo Tee - $54 [In Stock] - Vintage washed logo tee
- Medallion Bracelet - $280 [In Stock] - Premium silver medallion bracelet
- Star Pendant - $360 [In Stock] - Statement star pendant necklace

SOLD OUT:
- 'Have I Gone Mad?' Hoodie - sold out all sizes
- 'Have I Gone Mad?' Sweats - sold out all sizes
- Chaos Erupts Tee - sold out all sizes
- Da Vinci Work Jacket - sold out all sizes`;
}

function getDefaultInventoryData() {
  return {
    products: [
      {
        name: "Forsaken Hoodie",
        price: "$95.00",
        url: "https://madmanlosangeles.com/products/madman-forsaken-hoodie",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/forsaken_hoodie_front.png",
        stock: 40,
        available: true
      },
      {
        name: "Forsaken Sweats",
        price: "$95.00",
        url: "https://madmanlosangeles.com/products/madman-forsaken-sweats",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/forsaken_sweats_front.png",
        stock: 40,
        available: true
      },
      {
        name: "Carpenter Pants",
        price: "$170.00",
        url: "https://madmanlosangeles.com/products/madman-carpenter-pants",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/carpenter_pants_front.png",
        stock: 30,
        available: true
      },
      {
        name: "Carpenter Shorts",
        price: "$120.00",
        url: "https://madmanlosangeles.com/products/carpenter-pants-copy",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/carpenter_shorts_front.png",
        stock: 15,
        available: true
      },
      {
        name: "Hendrixx Tee",
        price: "$54.00",
        url: "https://madmanlosangeles.com/products/hendrixx-cut-off-tee",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/HendrixFront.png",
        stock: 35,
        available: true
      },
      {
        name: "Punk Tee",
        price: "$54.00",
        url: "https://madmanlosangeles.com/products/punk-tee",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/punk_tee_front.png",
        stock: 35,
        available: true
      },
      {
        name: "Washed Logo Tee",
        price: "$54.00",
        url: "https://madmanlosangeles.com/products/washed-logo-tee",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/washed_logo_front.png",
        stock: 30,
        available: true
      },
      {
        name: "Medallion Bracelet",
        price: "$280.00",
        url: "https://madmanlosangeles.com/products/medallion-bracelet",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/MADMANBRACELETWEB.png",
        stock: 20,
        available: true
      },
      {
        name: "Star Pendant",
        price: "$360.00",
        url: "https://madmanlosangeles.com/products/star-pendant",
        imageUrl: "https://cdn.shopify.com/s/files/1/0438/3621/1356/files/MADMANCHAINWEB.png",
        stock: 15,
        available: true
      }
    ],
    soldOut: [
      "'Have I Gone Mad?' Hoodie",
      "'Have I Gone Mad?' Sweats",
      "Chaos Erupts Tee",
      "Da Vinci Work Jacket"
    ],
    lastUpdated: new Date().toISOString()
  };
}

// Inline HTML for Cloudflare Workers deployment
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Madman Los Angeles | Style Assistant</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #000;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .chat-container {
            background: #000;
            border: 1px solid #333;
            border-radius: 16px;
            width: 100%;
            max-width: 420px;
            height: 650px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 25px 80px rgba(255,255,255,0.05);
        }
        .chat-header {
            background: #000;
            color: #fff;
            padding: 20px 24px;
            border-bottom: 1px solid #222;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .brand-logo {
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .header-subtitle {
            font-size: 11px;
            font-weight: 500;
            opacity: 0.6;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        .header-controls { display: flex; gap: 12px; }
        .header-btn {
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            font-size: 18px;
            padding: 4px;
            transition: color 0.2s;
        }
        .header-btn:hover { color: #fff; }
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #0a0a0a;
            scrollbar-width: thin;
            scrollbar-color: #333 #0a0a0a;
        }
        .message {
            margin-bottom: 16px;
            display: flex;
            align-items: flex-start;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message.bot { flex-direction: row; }
        .message.user { flex-direction: row-reverse; }
        .message-bubble {
            max-width: 80%;
            padding: 14px 18px;
            border-radius: 16px;
            font-size: 14px;
            line-height: 1.5;
        }
        .message.bot .message-bubble {
            background: #1a1a1a;
            color: #e5e5e5;
            border: 1px solid #2a2a2a;
            border-bottom-left-radius: 4px;
        }
        .message.user .message-bubble {
            background: #fff;
            color: #000;
            border-bottom-right-radius: 4px;
        }
        .product-card {
            background: #141414;
            border: 1px solid #2a2a2a;
            border-radius: 12px;
            overflow: hidden;
            margin: 12px 0;
            max-width: 280px;
            transition: border-color 0.2s;
        }
        .product-card:hover { border-color: #444; }
        .product-card a { text-decoration: none; color: inherit; }
        .product-image {
            width: 100%;
            height: 200px;
            object-fit: cover;
            background: #1a1a1a;
        }
        .product-info { padding: 14px; }
        .product-name {
            font-size: 13px;
            font-weight: 600;
            color: #fff;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .product-price {
            font-size: 14px;
            color: #888;
            font-weight: 500;
        }
        .product-price .sale { color: #ff4444; margin-right: 8px; }
        .product-price .original { text-decoration: line-through; color: #555; }
        .suggestions {
            padding: 12px 16px;
            background: #000;
            border-top: 1px solid #222;
            display: flex;
            gap: 8px;
            overflow-x: auto;
            scrollbar-width: none;
        }
        .suggestions::-webkit-scrollbar { display: none; }
        .suggestion-chip {
            padding: 10px 16px;
            background: transparent;
            border: 1px solid #333;
            border-radius: 24px;
            font-size: 12px;
            font-weight: 500;
            color: #999;
            white-space: nowrap;
            cursor: pointer;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .suggestion-chip:hover {
            background: #fff;
            color: #000;
            border-color: #fff;
        }
        .chat-input-container {
            padding: 16px;
            background: #000;
            border-top: 1px solid #222;
            display: flex;
            gap: 12px;
            align-items: center;
        }
        .chat-input {
            flex: 1;
            padding: 14px 18px;
            background: #111;
            border: 1px solid #333;
            border-radius: 24px;
            font-size: 14px;
            color: #fff;
            outline: none;
            font-family: inherit;
        }
        .chat-input::placeholder { color: #555; }
        .chat-input:focus { border-color: #666; }
        .send-button {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: #fff;
            color: #000;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .send-button:hover { background: #e5e5e5; transform: scale(1.05); }
        .send-button:disabled { background: #333; color: #666; cursor: not-allowed; }
        .typing-indicator { display: none; padding: 12px 20px; }
        .typing-indicator.active { display: block; }
        .typing-bubble {
            background: #1a1a1a;
            border: 1px solid #2a2a2a;
            border-radius: 16px;
            border-bottom-left-radius: 4px;
            padding: 14px 18px;
            display: inline-flex;
            gap: 4px;
        }
        .typing-dot {
            width: 6px;
            height: 6px;
            background: #555;
            border-radius: 50%;
            animation: typingPulse 1.4s infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingPulse {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
            30% { transform: translateY(-6px); opacity: 1; }
        }
        .powered-by {
            text-align: center;
            padding: 8px;
            font-size: 10px;
            color: #444;
            letter-spacing: 0.5px;
            border-top: 1px solid #1a1a1a;
        }
        .powered-by a { color: #666; text-decoration: none; }
        .powered-by a:hover { color: #999; }
        @media (max-width: 480px) {
            body { padding: 0; }
            .chat-container {
                height: 100vh;
                height: 100dvh;
                max-width: 100%;
                border-radius: 0;
                border: none;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div>
                <div class="brand-logo">Madman</div>
                <div class="header-subtitle">Style Assistant</div>
            </div>
            <div class="header-controls">
                <button class="header-btn" title="Minimize">-</button>
                <button class="header-btn" title="Close">x</button>
            </div>
        </div>
        <div class="chat-messages" id="chatMessages"></div>
        <div class="typing-indicator" id="typingIndicator">
            <div class="typing-bubble">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
        <div class="suggestions" id="suggestions">
            <div class="suggestion-chip" onclick="sendSuggestion('What are your best sellers?')">Best sellers?</div>
            <div class="suggestion-chip" onclick="sendSuggestion('Show me your hoodies')">Hoodies</div>
            <div class="suggestion-chip" onclick="sendSuggestion('What tees do you have?')">T-Shirts</div>
            <div class="suggestion-chip" onclick="sendSuggestion('Show me your pants')">Pants</div>
            <div class="suggestion-chip" onclick="sendSuggestion('What accessories do you have?')">Accessories</div>
        </div>
        <div class="chat-input-container">
            <input type="text" class="chat-input" id="chatInput" placeholder="Ask about style, products, sizing..." onkeypress="handleKeyPress(event)" />
            <button class="send-button" id="sendButton" onclick="sendMessage()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
            </button>
        </div>
        
    </div>
    <script>
        let productInventory = null;
        const chatMessages = document.getElementById('chatMessages');
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        const typingIndicator = document.getElementById('typingIndicator');
        const suggestions = document.getElementById('suggestions');

        async function loadInventory() {
            try {
                const response = await fetch('/api/products');
                if (response.ok) productInventory = await response.json();
            } catch (error) {
                console.error('Failed to load inventory:', error);
            }
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        }

        function sendSuggestion(text) {
            chatInput.value = text;
            sendMessage();
        }

        async function sendMessage() {
            const message = chatInput.value.trim();
            if (!message) return;
            addMessage(message, 'user');
            chatInput.value = '';
            sendButton.disabled = true;
            if (suggestions.style.display !== 'none') suggestions.style.display = 'none';
            typingIndicator.classList.add('active');
            chatMessages.scrollTop = chatMessages.scrollHeight;
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message }),
                });
                const data = await response.json();
                typingIndicator.classList.remove('active');
                addBotResponse(data.reply, data.products || []);
            } catch (error) {
                typingIndicator.classList.remove('active');
                addMessage("Connection issue. Please try again.", 'bot');
            } finally {
                sendButton.disabled = false;
                chatInput.focus();
            }
        }

        function addMessage(text, sender) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender;
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.textContent = text;
            messageDiv.appendChild(bubble);
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function addBotResponse(text, products) {
            let processedText = text.replace(/PRODUCT:[^\\n]+\\n?/g, '').trim();
            if (processedText) addMessage(processedText, 'bot');
            products.forEach(product => {
                if (product) addProductCard(product);
            });
        }

        function addProductCard(product) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message bot';
            const card = document.createElement('div');
            card.className = 'product-card';
            const link = document.createElement('a');
            link.href = product.url || 'https://madmanlosangeles.com';
            link.target = '_blank';
            if (product.imageUrl) {
                const img = document.createElement('img');
                img.className = 'product-image';
                img.src = product.imageUrl;
                img.alt = product.name;
                img.onerror = function() { this.style.display = 'none'; };
                link.appendChild(img);
            }
            const info = document.createElement('div');
            info.className = 'product-info';
            const name = document.createElement('div');
            name.className = 'product-name';
            name.textContent = product.name;
            info.appendChild(name);
            const price = document.createElement('div');
            price.className = 'product-price';
            if (product.salePrice && product.salePrice !== product.price) {
                price.innerHTML = '<span class="sale">' + product.salePrice + '</span><span class="original">' + product.price + '</span>';
            } else {
                price.textContent = product.price;
            }
            info.appendChild(price);
            link.appendChild(info);
            card.appendChild(link);
            messageDiv.appendChild(card);
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function initializeChat() {
            const messages = [
                "What's done in the dark must come to light.",
                "I'm your style assistant for Madman Los Angeles.",
                "Ask me about our drops, sizing, or let me help you find your next piece."
            ];
            let delay = 0;
            messages.forEach(msg => {
                setTimeout(() => addMessage(msg, 'bot'), delay);
                delay += 600;
            });
        }

        loadInventory();
        initializeChat();
        chatInput.focus();
    </script>
</body>
</html>`;
