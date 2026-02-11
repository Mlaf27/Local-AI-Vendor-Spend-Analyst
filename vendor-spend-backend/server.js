const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
// We use 127.0.0.1 to be very specific
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to talk to Ollama
async function generateAIResponse(prompt, model = 'mistral') {
    console.log(`Creating order for AI... (Model: ${model})`);
    try {
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                stream: false
            })
        });
        
        if (!response.ok) {
            throw new Error(`Ollama refused the connection: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.response;
    } catch (error) {
        console.error('CRITICAL AI ERROR:', error.message);
        return "Error: Could not connect to local AI.";
    }
}

// 1. Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', models: ['mistral'], hasRequiredModel: true });
});

// 2. Explain Price Creep
app.post('/api/explain', async (req, res) => {
    const { vendor, increasePercentage, currentSpend } = req.body;
    const prompt = `Act as a financial analyst. Analyze why ${vendor} costs increased by ${increasePercentage}%. Current spend is $${currentSpend}. Give 3 brief potential reasons and 1 recommendation.`;
    const aiResponse = await generateAIResponse(prompt);
    res.json({ explanation: aiResponse });
});

// 3. NEW: General Chat Endpoint
app.post('/api/chat', async (req, res) => {
    const { message, context } = req.body;
    const prompt = `Act as a helpful CFO Assistant.
    Context about the user's data: ${context}
    
    User Question: "${message}"
    
    Provide a professional, concise answer (max 3 sentences).`;
    
    const aiResponse = await generateAIResponse(prompt);
    res.json({ response: aiResponse });
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n=== SERVER STARTED ===`);
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log(`Targeting Ollama at: ${OLLAMA_URL}`);
    console.log(`======================\n`);
});