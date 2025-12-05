// Madman Los Angeles Chatbot - Frontend Script

// API Configuration - Use Cloudflare Worker for production
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const WORKER_URL = 'https://madman-chatbot.avijit-dhaliwal.workers.dev';
const API_BASE = IS_LOCAL ? '' : WORKER_URL;
const API_URL = API_BASE + '/api/chat';

// Product inventory (will be loaded from API)
let productInventory = null;

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');
const typingIndicator = document.getElementById('typingIndicator');
const suggestions = document.getElementById('suggestions');

// Load product inventory on startup
async function loadInventory() {
    try {
        const response = await fetch(API_BASE + '/api/products');
        if (response.ok) {
            productInventory = await response.json();
            console.log('Inventory loaded:', productInventory);
        }
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

    // Add user message
    addMessage(message, 'user');

    // Clear input and disable send button
    chatInput.value = '';
    sendButton.disabled = true;

    // Hide suggestions after first message
    if (suggestions.style.display !== 'none') {
        suggestions.style.display = 'none';
    }

    // Show typing indicator
    typingIndicator.classList.add('active');
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });

        const data = await response.json();

        // Hide typing indicator
        typingIndicator.classList.remove('active');

        // Process and add bot response with product cards
        addBotResponse(data.reply, data.products || []);
    } catch (error) {
        console.error('Error:', error);
        typingIndicator.classList.remove('active');
        addMessage("Connection issue. Please try again.", 'bot');
    } finally {
        sendButton.disabled = false;
        chatInput.focus();
    }
}

function addMessage(text, sender, isHtml = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (isHtml) {
        bubble.innerHTML = text;
    } else {
        bubble.textContent = text;
    }

    messageDiv.appendChild(bubble);
    chatMessages.appendChild(messageDiv);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addBotResponse(text, products = []) {
    // Parse the response for PRODUCT: tags
    let processedText = text;
    const productMatches = text.match(/PRODUCT:([^\n]+)/g) || [];

    // Remove PRODUCT: tags from display text
    processedText = processedText.replace(/PRODUCT:[^\n]+\n?/g, '').trim();

    // Add the text message if there's content
    if (processedText) {
        addMessage(processedText, 'bot');
    }

    // Add product cards for each matched product
    productMatches.forEach(match => {
        const productName = match.replace('PRODUCT:', '').trim();
        const product = findProduct(productName);
        if (product) {
            addProductCard(product);
        }
    });

    // Also add any products passed directly from the API
    products.forEach(product => {
        addProductCard(product);
    });
}

function findProduct(name) {
    if (!productInventory || !productInventory.products) return null;

    const searchName = name.toLowerCase();
    return productInventory.products.find(p =>
        p.name.toLowerCase().includes(searchName) ||
        searchName.includes(p.name.toLowerCase())
    );
}

function addProductCard(product) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot';

    const card = document.createElement('div');
    card.className = 'product-card';

    const link = document.createElement('a');
    link.href = product.url || `https://madmanlosangeles.com/collections/all`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    // Product image
    if (product.imageUrl) {
        const img = document.createElement('img');
        img.className = 'product-image';
        img.src = product.imageUrl;
        img.alt = product.name;
        img.loading = 'lazy';
        img.onerror = function() {
            this.style.display = 'none';
        };
        link.appendChild(img);
    }

    // Product info
    const info = document.createElement('div');
    info.className = 'product-info';

    const name = document.createElement('div');
    name.className = 'product-name';
    name.textContent = product.name;
    info.appendChild(name);

    const price = document.createElement('div');
    price.className = 'product-price';
    if (product.salePrice && product.salePrice !== product.price) {
        price.innerHTML = `<span class="sale">${product.salePrice}</span><span class="original">${product.price}</span>`;
    } else {
        price.textContent = product.price;
    }
    info.appendChild(price);

    // Stock status
    if (product.stock !== undefined) {
        const status = document.createElement('div');
        status.className = 'product-status';
        if (product.stock === 0) {
            status.className += ' sold-out';
            status.textContent = 'Sold Out';
        } else if (product.stock < 5) {
            status.className += ' low-stock';
            status.textContent = `Only ${product.stock} left`;
        }
        if (status.textContent) {
            info.appendChild(status);
        }
    }

    link.appendChild(info);
    card.appendChild(link);
    messageDiv.appendChild(card);
    chatMessages.appendChild(messageDiv);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Initialize chat with greeting
function initializeChat() {
    const greetings = [
        "What's done in the dark must come to light.",
        "Welcome to Madman.",
        "Step into the darkness."
    ];
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];

    const messages = [
        greeting,
        "I'm your personal style assistant for Madman Los Angeles.",
        "Ask me about our latest drops, sizing, or let me help you find your next piece."
    ];

    let delay = 0;
    messages.forEach(msg => {
        setTimeout(() => {
            addMessage(msg, 'bot');
        }, delay);
        delay += 600;
    });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    loadInventory();
    initializeChat();
    chatInput.focus();
});
